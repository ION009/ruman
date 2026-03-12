package httpapi

import (
	"context"
	"crypto/sha1"
	"encoding/base64"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/storage"
)

const (
	dashboardImportBodyLimit = 12 << 20
	maxImportFileBytes       = 8 << 20
	maxImportExpandedEvents  = 100000
	maxImportPreviewRows     = 5
	maxImportStoredErrors    = 100
)

type dashboardImportPayload struct {
	Platform       string            `json:"platform"`
	FileName       string            `json:"fileName"`
	ContentType    string            `json:"contentType"`
	ContentBase64  string            `json:"contentBase64"`
	Mapping        map[string]string `json:"mapping"`
	ImportTimezone string            `json:"importTimezone"`
}

type dashboardImportPreviewResponse struct {
	Platform       string                       `json:"platform"`
	FileName       string                       `json:"fileName"`
	DetectedFormat string                       `json:"detectedFormat"`
	TotalRows      int                          `json:"totalRows"`
	ValidRows      int                          `json:"validRows"`
	InvalidRows    int                          `json:"invalidRows"`
	Mapping        map[string]string            `json:"mapping"`
	Suggestions    []dashboardImportSuggestion  `json:"suggestions"`
	SampleRows     []map[string]any             `json:"sampleRows"`
	Errors         []dashboardImportErrorRecord `json:"errors"`
}

type dashboardImportSuggestion struct {
	CanonicalField string  `json:"canonicalField"`
	SourceField    string  `json:"sourceField"`
	Confidence     float64 `json:"confidence"`
}

type dashboardImportErrorRecord struct {
	RowNumber int            `json:"rowNumber"`
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	RawRecord map[string]any `json:"rawRecord,omitempty"`
}

type dashboardImportJobRecord struct {
	ID                string
	SiteID            string
	Platform          string
	Status            string
	Phase             string
	SourceFileName    string
	SourceContentType *string
	SourceSizeBytes   int64
	MappingJSON       []byte
	SummaryJSON       []byte
	ProgressPercent   int
	ProcessedRows     int
	ImportedRows      int
	InvalidRows       int
	ErrorMessage      *string
	StartedAt         *time.Time
	CompletedAt       *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

type dashboardImportPlan struct {
	Platform       string
	FileName       string
	DetectedFormat string
	RawSizeBytes   int64
	Mapping        map[string]string
	Suggestions    []dashboardImportSuggestion
	SampleRows     []map[string]any
	Errors         []dashboardImportErrorRecord
	TotalRows      int
	ValidRows      int
	InvalidRows    int
	Events         []storage.LegacyImportEvent
	Paths          []string
	Timezone       string
}

type siteImportDefaults struct {
	Mapping  map[string]string
	Timezone string
}

func (s *Server) handleDashboardImportPreview(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "imports require control-plane storage"})
		return
	}

	site, ok, err := s.dashboardSiteFromRequest(r)
	if err != nil {
		writeAPIError(w, errSiteLookupFailed)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown site id"})
		return
	}

	payload := dashboardImportPayload{}
	if err := decodeJSON(w, r, dashboardImportBodyLimit, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	defaults, err := s.loadSiteImportDefaults(r.Context(), site.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load import defaults"})
		return
	}

	plan, err := s.prepareDashboardImportPlan(site, payload, defaults)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, dashboardImportPreviewResponse{
		Platform:       plan.Platform,
		FileName:       plan.FileName,
		DetectedFormat: plan.DetectedFormat,
		TotalRows:      plan.TotalRows,
		ValidRows:      plan.ValidRows,
		InvalidRows:    plan.InvalidRows,
		Mapping:        plan.Mapping,
		Suggestions:    plan.Suggestions,
		SampleRows:     plan.SampleRows,
		Errors:         plan.Errors,
	})
}

func (s *Server) handleDashboardImportJobs(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil || s.clickhouse == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "imports require clickhouse and control-plane storage"})
		return
	}

	site, ok, err := s.dashboardSiteFromRequest(r)
	if err != nil {
		writeAPIError(w, errSiteLookupFailed)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown site id"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		jobs, err := s.listDashboardImportJobs(r.Context(), site.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load import jobs"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"jobs": jobs})
	case http.MethodPost:
		payload := dashboardImportPayload{}
		if err := decodeJSON(w, r, dashboardImportBodyLimit, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		defaults, err := s.loadSiteImportDefaults(r.Context(), site.ID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load import defaults"})
			return
		}
		plan, err := s.prepareDashboardImportPlan(site, payload, defaults)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if len(plan.Events) == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "no valid rows to import"})
			return
		}

		userID := strings.TrimSpace(r.Header.Get("X-User-ID"))
		job, err := s.createDashboardImportJob(r.Context(), site.ID, userID, payload, plan)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create import job"})
			return
		}

		go s.runDashboardImportJob(site, job, plan)

		writeJSON(w, http.StatusAccepted, s.dashboardImportJobResponse(job, plan.Errors))
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardImportJobByID(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "imports require control-plane storage"})
		return
	}

	site, ok, err := s.dashboardSiteFromRequest(r)
	if err != nil {
		writeAPIError(w, errSiteLookupFailed)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown site id"})
		return
	}

	importID := strings.TrimSpace(r.PathValue("importId"))
	if importID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "import id is required"})
		return
	}

	job, errorsList, err := s.getDashboardImportJob(r.Context(), site.ID, importID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errImportJobNotFound) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": "failed to load import job"})
		return
	}

	writeJSON(w, http.StatusOK, s.dashboardImportJobResponse(job, errorsList))
}

var errImportJobNotFound = errors.New("import job not found")

func (s *Server) prepareDashboardImportPlan(site config.Site, payload dashboardImportPayload, defaults siteImportDefaults) (dashboardImportPlan, error) {
	platform := normalizeImportPlatform(payload.Platform)
	if platform == "" {
		return dashboardImportPlan{}, errors.New("platform is required")
	}
	fileName := strings.TrimSpace(payload.FileName)
	if fileName == "" {
		fileName = "import"
	}

	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(payload.ContentBase64))
	if err != nil {
		return dashboardImportPlan{}, errors.New("contentBase64 must be valid base64")
	}
	if len(raw) == 0 {
		return dashboardImportPlan{}, errors.New("import file is empty")
	}
	if len(raw) > maxImportFileBytes {
		return dashboardImportPlan{}, fmt.Errorf("import file exceeds %d MB", maxImportFileBytes>>20)
	}

	detectedFormat, rows, err := parseDashboardImportRows(fileName, payload.ContentType, raw)
	if err != nil {
		return dashboardImportPlan{}, err
	}
	if len(rows) == 0 {
		return dashboardImportPlan{}, errors.New("import file contains no rows")
	}

	headers := collectImportHeaders(rows)
	mapping, suggestions := buildDashboardImportMapping(platform, headers, defaults.Mapping, payload.Mapping)
	timezone := strings.TrimSpace(payload.ImportTimezone)
	if timezone == "" {
		timezone = defaults.Timezone
	}
	if timezone == "" {
		timezone = "UTC"
	}

	plan := dashboardImportPlan{
		Platform:       platform,
		FileName:       fileName,
		DetectedFormat: detectedFormat,
		RawSizeBytes:   int64(len(raw)),
		Mapping:        mapping,
		Suggestions:    suggestions,
		SampleRows:     sampleDashboardImportRows(rows),
		Timezone:       timezone,
		TotalRows:      len(rows),
	}

	seenPaths := map[string]struct{}{}
	for index, row := range rows {
		imported, rowErrors, err := buildLegacyImportEvents(site, row, mapping, timezone, index+1)
		if err != nil {
			return dashboardImportPlan{}, err
		}
		if len(rowErrors) > 0 {
			plan.InvalidRows++
			if len(plan.Errors) < maxImportStoredErrors {
				plan.Errors = append(plan.Errors, rowErrors...)
			}
			continue
		}
		for _, item := range imported {
			plan.Events = append(plan.Events, item)
			if item.Path != "" {
				seenPaths[item.Path] = struct{}{}
			}
			if len(plan.Events) > maxImportExpandedEvents {
				return dashboardImportPlan{}, fmt.Errorf("import expands to more than %d events", maxImportExpandedEvents)
			}
		}
		plan.ValidRows++
	}

	plan.Paths = make([]string, 0, len(seenPaths))
	for path := range seenPaths {
		plan.Paths = append(plan.Paths, path)
	}
	sort.Strings(plan.Paths)
	return plan, nil
}

func parseDashboardImportRows(fileName, contentType string, raw []byte) (string, []map[string]string, error) {
	trimmed := strings.TrimSpace(string(raw))
	switch {
	case strings.HasSuffix(strings.ToLower(fileName), ".json"),
		strings.Contains(strings.ToLower(contentType), "json"),
		strings.HasPrefix(trimmed, "["),
		strings.HasPrefix(trimmed, "{"):
		rows, err := parseDashboardImportJSON([]byte(trimmed))
		return "json", rows, err
	default:
		rows, err := parseDashboardImportCSV(strings.NewReader(trimmed))
		return "csv", rows, err
	}
}

func parseDashboardImportCSV(reader io.Reader) ([]map[string]string, error) {
	csvReader := csv.NewReader(reader)
	csvReader.FieldsPerRecord = -1
	records, err := csvReader.ReadAll()
	if err != nil {
		return nil, errors.New("failed to parse CSV file")
	}
	if len(records) < 2 {
		return nil, errors.New("csv file must include a header row and at least one data row")
	}

	headers := make([]string, 0, len(records[0]))
	for _, header := range records[0] {
		headers = append(headers, strings.TrimSpace(header))
	}

	rows := make([]map[string]string, 0, len(records)-1)
	for _, record := range records[1:] {
		row := map[string]string{}
		for index, header := range headers {
			if header == "" {
				continue
			}
			if index < len(record) {
				row[header] = strings.TrimSpace(record[index])
			} else {
				row[header] = ""
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func parseDashboardImportJSON(raw []byte) ([]map[string]string, error) {
	var payload any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, errors.New("failed to parse JSON file")
	}

	records := extractDashboardImportJSONArray(payload)
	if len(records) == 0 {
		return nil, errors.New("json file must contain an array of objects")
	}

	rows := make([]map[string]string, 0, len(records))
	for _, record := range records {
		row := map[string]string{}
		for key, value := range record {
			row[key] = stringifyImportValue(value)
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func extractDashboardImportJSONArray(payload any) []map[string]any {
	switch typed := payload.(type) {
	case []any:
		return coerceDashboardImportRecords(typed)
	case map[string]any:
		for _, key := range []string{"rows", "data", "events", "items", "results"} {
			if nested, ok := typed[key]; ok {
				return extractDashboardImportJSONArray(nested)
			}
		}
		return nil
	default:
		return nil
	}
}

func coerceDashboardImportRecords(items []any) []map[string]any {
	rows := make([]map[string]any, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		rows = append(rows, record)
	}
	return rows
}

func stringifyImportValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		raw, _ := json.Marshal(typed)
		return strings.TrimSpace(string(raw))
	}
}

func collectImportHeaders(rows []map[string]string) []string {
	seen := map[string]struct{}{}
	headers := make([]string, 0)
	for _, row := range rows {
		for key := range row {
			trimmed := strings.TrimSpace(key)
			if trimmed == "" {
				continue
			}
			if _, ok := seen[trimmed]; ok {
				continue
			}
			seen[trimmed] = struct{}{}
			headers = append(headers, trimmed)
		}
	}
	sort.Strings(headers)
	return headers
}

func buildDashboardImportMapping(platform string, headers []string, defaultMapping, requested map[string]string) (map[string]string, []dashboardImportSuggestion) {
	mapping := map[string]string{}
	suggestions := make([]dashboardImportSuggestion, 0)
	normalizedHeaders := map[string]string{}
	for _, header := range headers {
		normalizedHeaders[normalizeImportKey(header)] = header
	}

	for canonical, source := range defaultMapping {
		if source = strings.TrimSpace(source); source != "" {
			mapping[canonical] = source
		}
	}
	for canonical, source := range requested {
		if source = strings.TrimSpace(source); source != "" {
			mapping[canonical] = source
		}
	}

	for canonical, aliases := range importFieldAliases(platform) {
		if _, ok := mapping[canonical]; ok {
			continue
		}
		for index, alias := range aliases {
			if source, ok := normalizedHeaders[normalizeImportKey(alias)]; ok {
				confidence := 0.72
				if index == 0 {
					confidence = 0.98
				}
				mapping[canonical] = source
				suggestions = append(suggestions, dashboardImportSuggestion{
					CanonicalField: canonical,
					SourceField:    source,
					Confidence:     confidence,
				})
				break
			}
		}
	}
	return mapping, suggestions
}

func importFieldAliases(platform string) map[string][]string {
	aliases := map[string][]string{
		"timestamp":    {"timestamp", "datetime", "date", "datehour", "datehourminute", "event_time", "occurred_at", "created_at", "time"},
		"path":         {"path", "page", "page_path", "pagepath", "pathname", "landing_page", "url_path"},
		"url":          {"url", "page_url", "page_location", "full_url", "location"},
		"title":        {"title", "page_title", "pagetitle"},
		"referrer":     {"referrer", "page_referrer", "referrer_url", "source_url"},
		"event_name":   {"event_name", "event", "name"},
		"visitor_id":   {"visitor_id", "visitor", "user_id", "client_id", "distinct_id", "anonymous_id", "user_pseudo_id"},
		"session_id":   {"session_id", "session", "visit_id"},
		"country":      {"country", "country_code"},
		"region":       {"region", "state", "province"},
		"city":         {"city"},
		"browser":      {"browser", "browser_name"},
		"os":           {"os", "operating_system", "platform"},
		"device_type":  {"device_type", "device", "device_category"},
		"utm_source":   {"utm_source", "source"},
		"utm_medium":   {"utm_medium", "medium"},
		"utm_campaign": {"utm_campaign", "campaign"},
		"utm_term":     {"utm_term", "term"},
		"utm_content":  {"utm_content", "content"},
		"pageviews":    {"pageviews", "views", "screen_page_views"},
		"sessions":     {"sessions", "visits"},
		"visitors":     {"visitors", "users", "unique_visitors"},
	}

	switch platform {
	case "google-analytics":
		aliases["timestamp"] = append([]string{"datehourminute", "datehour", "date"}, aliases["timestamp"]...)
		aliases["path"] = append([]string{"page_path"}, aliases["path"]...)
		aliases["url"] = append([]string{"page_location"}, aliases["url"]...)
		aliases["event_name"] = append([]string{"event_name"}, aliases["event_name"]...)
		aliases["visitor_id"] = append([]string{"user_pseudo_id"}, aliases["visitor_id"]...)
		aliases["device_type"] = append([]string{"device_category"}, aliases["device_type"]...)
	case "plausible":
		aliases["path"] = append([]string{"page"}, aliases["path"]...)
	case "umami":
		aliases["path"] = append([]string{"url_path"}, aliases["path"]...)
	case "simple-analytics":
		aliases["path"] = append([]string{"page"}, aliases["path"]...)
	case "matomo":
		aliases["url"] = append([]string{"page_url"}, aliases["url"]...)
	case "fathom":
		aliases["path"] = append([]string{"page"}, aliases["path"]...)
	}

	return aliases
}

func normalizeImportKey(value string) string {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	if trimmed == "" {
		return ""
	}
	replacer := strings.NewReplacer(" ", "_", "-", "_", ".", "_", "/", "_")
	return replacer.Replace(trimmed)
}

func sampleDashboardImportRows(rows []map[string]string) []map[string]any {
	limit := maxImportPreviewRows
	if len(rows) < limit {
		limit = len(rows)
	}
	samples := make([]map[string]any, 0, limit)
	for index := 0; index < limit; index++ {
		row := map[string]any{}
		for key, value := range rows[index] {
			row[key] = value
		}
		samples = append(samples, row)
	}
	return samples
}

func buildLegacyImportEvents(
	site config.Site,
	row map[string]string,
	mapping map[string]string,
	timezone string,
	rowNumber int,
) ([]storage.LegacyImportEvent, []dashboardImportErrorRecord, error) {
	rawRecord := map[string]any{}
	for key, value := range row {
		rawRecord[key] = value
	}

	timestampValue := readMappedValue(row, mapping, "timestamp")
	baseTime, err := parseImportTimestamp(timestampValue, timezone)
	if err != nil {
		return nil, []dashboardImportErrorRecord{{
			RowNumber: rowNumber,
			Code:      "invalid_timestamp",
			Message:   "A valid timestamp or date column is required.",
			RawRecord: rawRecord,
		}}, nil
	}

	path := normalizeImportedPath(readMappedValue(row, mapping, "path"))
	urlValue := readMappedValue(row, mapping, "url")
	if path == "" && urlValue != "" {
		path = normalizeImportedPath(pathFromURL(urlValue))
	}
	if path == "" {
		return nil, []dashboardImportErrorRecord{{
			RowNumber: rowNumber,
			Code:      "missing_path",
			Message:   "A page path or URL column is required.",
			RawRecord: rawRecord,
		}}, nil
	}

	eventName := strings.TrimSpace(readMappedValue(row, mapping, "event_name"))
	if eventName == "" {
		eventName = "pageview"
	}
	eventType := "custom"
	if strings.EqualFold(eventName, "pageview") {
		eventType = "pageview"
	}

	pageviews := parseImportPositiveInt(readMappedValue(row, mapping, "pageviews"))
	sessions := parseImportPositiveInt(readMappedValue(row, mapping, "sessions"))
	visitors := parseImportPositiveInt(readMappedValue(row, mapping, "visitors"))
	eventCount := 1
	if pageviews > 0 {
		eventCount = pageviews
	}
	if eventCount <= 0 {
		eventCount = 1
	}
	if sessions <= 0 {
		if visitors > 0 {
			sessions = visitors
		} else if eventCount > 1 {
			sessions = maxImportInt(1, eventCount/2)
		} else {
			sessions = 1
		}
	}
	if visitors <= 0 {
		if sessions > 1 {
			visitors = maxImportInt(1, sessions/2)
		} else {
			visitors = 1
		}
	}

	if eventCount > maxImportExpandedEvents {
		return nil, nil, fmt.Errorf("row %d expands to more than %d events", rowNumber, maxImportExpandedEvents)
	}

	title := strings.TrimSpace(readMappedValue(row, mapping, "title"))
	referrer := strings.TrimSpace(readMappedValue(row, mapping, "referrer"))
	if urlValue == "" {
		urlValue = buildImportedURL(site, path)
	}
	if urlValue == "" {
		urlValue = path
	}

	visitorIDValue := strings.TrimSpace(readMappedValue(row, mapping, "visitor_id"))
	sessionIDValue := strings.TrimSpace(readMappedValue(row, mapping, "session_id"))
	country := strings.ToUpper(strings.TrimSpace(readMappedValue(row, mapping, "country")))
	region := strings.ToUpper(strings.TrimSpace(readMappedValue(row, mapping, "region")))
	city := strings.TrimSpace(readMappedValue(row, mapping, "city"))
	browser := strings.TrimSpace(readMappedValue(row, mapping, "browser"))
	osName := strings.TrimSpace(readMappedValue(row, mapping, "os"))
	deviceType := normalizeImportDeviceType(readMappedValue(row, mapping, "device_type"))
	utmSource := strings.TrimSpace(readMappedValue(row, mapping, "utm_source"))
	utmMedium := strings.TrimSpace(readMappedValue(row, mapping, "utm_medium"))
	utmCampaign := strings.TrimSpace(readMappedValue(row, mapping, "utm_campaign"))
	utmTerm := strings.TrimSpace(readMappedValue(row, mapping, "utm_term"))
	utmContent := strings.TrimSpace(readMappedValue(row, mapping, "utm_content"))

	events := make([]storage.LegacyImportEvent, 0, eventCount)
	spacing := time.Second
	if eventCount > 1 {
		spacing = (24 * time.Hour) / time.Duration(eventCount+1)
	}
	rowSeed := importRowSeed(path, eventName, rowNumber)
	for index := 0; index < eventCount; index++ {
		sessionOrdinal := index % maxImportInt(1, sessions)
		visitorOrdinal := sessionOrdinal % maxImportInt(1, visitors)
		sessionID := sessionIDValue
		if sessionID == "" {
			sessionID = deterministicImportID(rowSeed, "session", sessionOrdinal)
		}
		visitorID := visitorIDValue
		if visitorID == "" {
			visitorID = deterministicImportID(rowSeed, "visitor", visitorOrdinal)
		}
		eventID := deterministicImportID(rowSeed, "event", index)
		eventTime := baseTime.Add(spacing * time.Duration(index+1)).UTC()
		meta := map[string]any{
			"vid": visitorID,
		}
		if referrer != "" {
			meta["r"] = referrer
		}
		if browser != "" {
			meta["br"] = browser
		}
		if osName != "" {
			meta["os"] = osName
		}
		if deviceType != "" {
			meta["dt"] = deviceType
		}
		if country != "" {
			meta["gcc"] = country
		}
		if region != "" {
			meta["grc"] = region
		}
		if city != "" {
			meta["gci"] = city
		}
		metaJSON, err := json.Marshal(meta)
		if err != nil {
			return nil, nil, fmt.Errorf("encode import metadata: %w", err)
		}

		events = append(events, storage.LegacyImportEvent{
			EventID:        eventID,
			Type:           eventType,
			Name:           eventName,
			Timestamp:      eventTime.Format("2006-01-02 15:04:05.000"),
			Path:           path,
			URL:            urlValue,
			Title:          title,
			Referrer:       referrer,
			ScreenWidth:    0,
			ScreenHeight:   0,
			ViewportWidth:  0,
			ViewportHeight: 0,
			Language:       "",
			TimezoneOffset: 0,
			UTMSource:      utmSource,
			UTMMedium:      utmMedium,
			UTMCampaign:    utmCampaign,
			UTMTerm:        utmTerm,
			UTMContent:     utmContent,
			Props: map[string]string{
				"meta": string(metaJSON),
			},
			VisitorID:  visitorID,
			SessionID:  sessionID,
			Browser:    browser,
			OS:         osName,
			DeviceType: deviceType,
			Country:    country,
			Region:     region,
			City:       city,
		})
	}
	return events, nil, nil
}

func readMappedValue(row map[string]string, mapping map[string]string, canonical string) string {
	source := strings.TrimSpace(mapping[canonical])
	if source == "" {
		return ""
	}
	if value, ok := row[source]; ok {
		return strings.TrimSpace(value)
	}
	for key, value := range row {
		if strings.EqualFold(strings.TrimSpace(key), source) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func parseImportTimestamp(value, fallbackTimezone string) (time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}, errors.New("timestamp required")
	}
	if seconds, err := strconv.ParseInt(trimmed, 10, 64); err == nil {
		switch {
		case len(trimmed) >= 13:
			return time.UnixMilli(seconds).UTC(), nil
		case len(trimmed) == 10:
			return time.Unix(seconds, 0).UTC(), nil
		}
	}

	layouts := []string{
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
		"2006/01/02",
		"200601021504",
		"2006010215",
		"20060102",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, trimmed); err == nil {
			return parsed.UTC(), nil
		}
	}

	location := time.UTC
	if fallbackTimezone = strings.TrimSpace(fallbackTimezone); fallbackTimezone != "" {
		if loaded, err := time.LoadLocation(fallbackTimezone); err == nil {
			location = loaded
		}
	}
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
		"2006/01/02 15:04:05",
		"2006/01/02 15:04",
		"2006/01/02",
	} {
		if parsed, err := time.ParseInLocation(layout, trimmed, location); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, errors.New("unrecognized timestamp")
}

func pathFromURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return parsed.Path
}

func normalizeImportedPath(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "http://") || strings.HasPrefix(trimmed, "https://") {
		trimmed = pathFromURL(trimmed)
	}
	if trimmed == "" {
		return ""
	}
	if !strings.HasPrefix(trimmed, "/") {
		trimmed = "/" + trimmed
	}
	trimmed = strings.ReplaceAll(trimmed, "//", "/")
	if len(trimmed) > 1 && strings.HasSuffix(trimmed, "/") {
		trimmed = strings.TrimSuffix(trimmed, "/")
	}
	return trimmed
}

func buildImportedURL(site config.Site, path string) string {
	for _, origin := range site.Origins {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			return strings.TrimRight(trimmed, "/") + path
		}
	}
	return path
}

func parseImportPositiveInt(value string) int {
	if trimmed := strings.TrimSpace(value); trimmed != "" {
		if parsed, err := strconv.Atoi(trimmed); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 0
}

func normalizeImportDeviceType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "desktop", "mobile", "tablet":
		return strings.ToLower(strings.TrimSpace(value))
	case "phone":
		return "mobile"
	default:
		return ""
	}
}

func importRowSeed(path, eventName string, rowNumber int) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%d", path, eventName, rowNumber)))
	return hex.EncodeToString(sum[:8])
}

func deterministicImportID(seed, kind string, ordinal int) string {
	sum := sha1.Sum([]byte(fmt.Sprintf("%s|%s|%d", seed, kind, ordinal)))
	return hex.EncodeToString(sum[:16])
}

func maxImportInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func normalizeImportPlatform(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "google-analytics", "google_analytics", "ga4":
		return "google-analytics"
	case "plausible":
		return "plausible"
	case "umami":
		return "umami"
	case "simple-analytics", "simple_analytics":
		return "simple-analytics"
	case "matomo":
		return "matomo"
	case "fathom":
		return "fathom"
	case "custom":
		return "custom"
	default:
		return ""
	}
}

func (s *Server) loadSiteImportDefaults(ctx context.Context, siteID string) (siteImportDefaults, error) {
	defaults := siteImportDefaults{
		Mapping:  map[string]string{},
		Timezone: "UTC",
	}
	if s.neonPool == nil {
		return defaults, nil
	}

	var mappingRaw []byte
	var timezone string
	err := s.neonPool.QueryRow(ctx, `
		SELECT COALESCE(import_default_mapping, '{}'::jsonb), COALESCE(import_default_timezone, 'UTC')
		FROM analytics_site_settings
		WHERE site_id = $1
		LIMIT 1
	`, siteID).Scan(&mappingRaw, &timezone)
	if err != nil {
		return defaults, nil
	}
	if len(mappingRaw) > 0 {
		_ = json.Unmarshal(mappingRaw, &defaults.Mapping)
	}
	if strings.TrimSpace(timezone) != "" {
		defaults.Timezone = strings.TrimSpace(timezone)
	}
	return defaults, nil
}

func (s *Server) createDashboardImportJob(
	ctx context.Context,
	siteID, userID string,
	payload dashboardImportPayload,
	plan dashboardImportPlan,
) (dashboardImportJobRecord, error) {
	jobID := deterministicImportID(siteID+"|"+payload.FileName+"|"+time.Now().UTC().Format(time.RFC3339Nano), "job", 0)
	mappingJSON, _ := json.Marshal(plan.Mapping)
	summaryJSON, _ := json.Marshal(map[string]any{
		"detectedFormat": plan.DetectedFormat,
		"totalRows":      plan.TotalRows,
		"validRows":      plan.ValidRows,
		"invalidRows":    plan.InvalidRows,
		"mapping":        plan.Mapping,
		"timezone":       plan.Timezone,
		"paths":          plan.Paths,
	})

	tx, err := s.neonPool.Begin(ctx)
	if err != nil {
		return dashboardImportJobRecord{}, err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	var job dashboardImportJobRecord
	err = tx.QueryRow(ctx, `
		INSERT INTO analytics_import_jobs
		(
			id, site_id, created_by_user_id, platform, status, phase, source_file_name, source_content_type, source_size_bytes,
			mapping_json, summary_json, progress_percent, processed_rows, imported_rows, invalid_rows, started_at, created_at, updated_at
		)
		VALUES
		(
			$1, $2, NULLIF($3, ''), $4, 'processing', 'importing', $5, NULLIF($6, ''), $7,
			$8::jsonb, $9::jsonb, 60, $10, 0, $11, NOW(), NOW(), NOW()
		)
		RETURNING
			id, site_id, platform, status, phase, source_file_name, source_content_type, source_size_bytes,
			progress_percent, processed_rows, imported_rows, invalid_rows,
			error_message, started_at, completed_at, created_at, updated_at
	`, jobID, siteID, userID, plan.Platform, plan.FileName, payload.ContentType, plan.RawSizeBytes, string(mappingJSON), string(summaryJSON), plan.TotalRows, plan.InvalidRows).
		Scan(
			&job.ID,
			&job.SiteID,
			&job.Platform,
			&job.Status,
			&job.Phase,
			&job.SourceFileName,
			&job.SourceContentType,
			&job.SourceSizeBytes,
			&job.ProgressPercent,
			&job.ProcessedRows,
			&job.ImportedRows,
			&job.InvalidRows,
			&job.ErrorMessage,
			&job.StartedAt,
			&job.CompletedAt,
			&job.CreatedAt,
			&job.UpdatedAt,
		)
	if err != nil {
		return dashboardImportJobRecord{}, err
	}
	job.MappingJSON = mappingJSON
	job.SummaryJSON = summaryJSON

	for _, item := range plan.Errors {
		rawJSON, _ := json.Marshal(item.RawRecord)
		if _, err := tx.Exec(ctx, `
			INSERT INTO analytics_import_job_errors (job_id, row_number, code, message, raw_record)
			VALUES ($1, $2, $3, $4, NULLIF($5::text, '')::jsonb)
			ON CONFLICT (job_id, row_number, code) DO NOTHING
		`, jobID, item.RowNumber, item.Code, item.Message, string(rawJSON)); err != nil {
			return dashboardImportJobRecord{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return dashboardImportJobRecord{}, err
	}
	return job, nil
}

func (s *Server) runDashboardImportJob(site config.Site, job dashboardImportJobRecord, plan dashboardImportPlan) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	if s.clickhouse == nil {
		_ = s.failDashboardImportJob(ctx, job.ID, "clickhouse storage is not configured")
		return
	}

	if err := s.clickhouse.ImportLegacyEvents(ctx, site.ID, plan.Events); err != nil {
		_ = s.failDashboardImportJob(ctx, job.ID, err.Error())
		return
	}

	_ = s.updateDashboardImportJobProgress(ctx, job.ID, "finalizing", 85, len(plan.Events))
	if err := s.upsertImportedSitePages(ctx, site.ID, plan.Paths); err != nil {
		s.logger.Warn("import site page upsert failed", "site_id", site.ID, "job_id", job.ID, "error", err)
	}

	_ = s.completeDashboardImportJob(ctx, job.ID, len(plan.Events))
}

func (s *Server) upsertImportedSitePages(ctx context.Context, siteID string, paths []string) error {
	if s.neonPool == nil || len(paths) == 0 {
		return nil
	}
	tx, err := s.neonPool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO analytics_site_pages (site_id, path, source, first_seen_at, last_seen_at, updated_at)
			VALUES ($1, $2, 'manual', NOW(), NOW(), NOW())
			ON CONFLICT (site_id, path) DO UPDATE
			SET last_seen_at = NOW(), updated_at = NOW()
		`, siteID, path); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Server) updateDashboardImportJobProgress(ctx context.Context, jobID, phase string, progress, importedRows int) error {
	if s.neonPool == nil {
		return nil
	}
	_, err := s.neonPool.Exec(ctx, `
		UPDATE analytics_import_jobs
		SET phase = $2, progress_percent = $3, imported_rows = $4, updated_at = NOW()
		WHERE id = $1
	`, jobID, phase, progress, importedRows)
	return err
}

func (s *Server) completeDashboardImportJob(ctx context.Context, jobID string, importedRows int) error {
	if s.neonPool == nil {
		return nil
	}
	_, err := s.neonPool.Exec(ctx, `
		UPDATE analytics_import_jobs
		SET status = 'completed', phase = 'completed', progress_percent = 100, imported_rows = $2, completed_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID, importedRows)
	return err
}

func (s *Server) failDashboardImportJob(ctx context.Context, jobID, message string) error {
	if s.neonPool == nil {
		return nil
	}
	_, err := s.neonPool.Exec(ctx, `
		UPDATE analytics_import_jobs
		SET status = 'failed', phase = 'failed', error_message = $2, completed_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID, trimImportError(message))
	return err
}

func (s *Server) listDashboardImportJobs(ctx context.Context, siteID string) ([]map[string]any, error) {
	rows, err := s.neonPool.Query(ctx, `
		SELECT
			id, site_id, platform, status, phase, source_file_name, source_content_type, source_size_bytes,
			mapping_json::text, summary_json::text, progress_percent, processed_rows, imported_rows, invalid_rows,
			error_message, started_at, completed_at, created_at, updated_at
		FROM analytics_import_jobs
		WHERE site_id = $1
		ORDER BY created_at DESC
		LIMIT 25
	`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	output := make([]map[string]any, 0)
	for rows.Next() {
		record, err := scanDashboardImportJob(rows)
		if err != nil {
			return nil, err
		}
		output = append(output, s.dashboardImportJobResponse(record, nil))
	}
	return output, rows.Err()
}

func (s *Server) getDashboardImportJob(ctx context.Context, siteID, jobID string) (dashboardImportJobRecord, []dashboardImportErrorRecord, error) {
	rows, err := s.neonPool.Query(ctx, `
		SELECT
			id, site_id, platform, status, phase, source_file_name, source_content_type, source_size_bytes,
			mapping_json::text, summary_json::text, progress_percent, processed_rows, imported_rows, invalid_rows,
			error_message, started_at, completed_at, created_at, updated_at
		FROM analytics_import_jobs
		WHERE site_id = $1 AND id = $2
		LIMIT 1
	`, siteID, jobID)
	if err != nil {
		return dashboardImportJobRecord{}, nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return dashboardImportJobRecord{}, nil, errImportJobNotFound
	}
	record, err := scanDashboardImportJob(rows)
	if err != nil {
		return dashboardImportJobRecord{}, nil, err
	}

	errorRows, err := s.neonPool.Query(ctx, `
		SELECT row_number, code, message, raw_record::text
		FROM analytics_import_job_errors
		WHERE job_id = $1
		ORDER BY row_number ASC
		LIMIT $2
	`, jobID, maxImportStoredErrors)
	if err != nil {
		return dashboardImportJobRecord{}, nil, err
	}
	defer errorRows.Close()

	errorsList := make([]dashboardImportErrorRecord, 0)
	for errorRows.Next() {
		var rowNumber int
		var code string
		var message string
		var rawRecordText *string
		if err := errorRows.Scan(&rowNumber, &code, &message, &rawRecordText); err != nil {
			return dashboardImportJobRecord{}, nil, err
		}
		item := dashboardImportErrorRecord{
			RowNumber: rowNumber,
			Code:      code,
			Message:   message,
		}
		if rawRecordText != nil && strings.TrimSpace(*rawRecordText) != "" {
			rawRecord := map[string]any{}
			_ = json.Unmarshal([]byte(*rawRecordText), &rawRecord)
			item.RawRecord = rawRecord
		}
		errorsList = append(errorsList, item)
	}
	return record, errorsList, errorRows.Err()
}

func scanDashboardImportJob(rows interface{ Scan(...any) error }) (dashboardImportJobRecord, error) {
	record := dashboardImportJobRecord{}
	var mappingText string
	var summaryText string
	if err := rows.Scan(
		&record.ID,
		&record.SiteID,
		&record.Platform,
		&record.Status,
		&record.Phase,
		&record.SourceFileName,
		&record.SourceContentType,
		&record.SourceSizeBytes,
		&mappingText,
		&summaryText,
		&record.ProgressPercent,
		&record.ProcessedRows,
		&record.ImportedRows,
		&record.InvalidRows,
		&record.ErrorMessage,
		&record.StartedAt,
		&record.CompletedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return dashboardImportJobRecord{}, err
	}
	record.MappingJSON = []byte(mappingText)
	record.SummaryJSON = []byte(summaryText)
	return record, nil
}

func (s *Server) dashboardImportJobResponse(job dashboardImportJobRecord, errorsList []dashboardImportErrorRecord) map[string]any {
	mapping := map[string]string{}
	_ = json.Unmarshal(job.MappingJSON, &mapping)
	summary := map[string]any{}
	_ = json.Unmarshal(job.SummaryJSON, &summary)
	payload := map[string]any{
		"id":                job.ID,
		"siteId":            job.SiteID,
		"platform":          job.Platform,
		"status":            job.Status,
		"phase":             job.Phase,
		"sourceFileName":    job.SourceFileName,
		"sourceContentType": derefString(job.SourceContentType),
		"sourceSizeBytes":   job.SourceSizeBytes,
		"progressPercent":   job.ProgressPercent,
		"processedRows":     job.ProcessedRows,
		"importedRows":      job.ImportedRows,
		"invalidRows":       job.InvalidRows,
		"mapping":           mapping,
		"summary":           summary,
		"errorMessage":      derefString(job.ErrorMessage),
		"startedAt":         timePtrString(job.StartedAt),
		"completedAt":       timePtrString(job.CompletedAt),
		"createdAt":         job.CreatedAt.UTC().Format(time.RFC3339),
		"updatedAt":         job.UpdatedAt.UTC().Format(time.RFC3339),
	}
	if len(errorsList) > 0 {
		payload["errors"] = errorsList
	}
	return payload
}

func trimImportError(value string) string {
	trimmed := strings.TrimSpace(value)
	if len(trimmed) <= 500 {
		return trimmed
	}
	return trimmed[:500]
}

func derefString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func timePtrString(value *time.Time) any {
	if value == nil {
		return nil
	}
	text := value.UTC().Format(time.RFC3339)
	return text
}

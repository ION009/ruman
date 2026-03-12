package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"anlticsheat/api/internal/ingest"
)

type ClickHouseStore struct {
	baseURL  string
	database string
	username string
	password string
	client   *http.Client
	inserted atomic.Int64
}

type clickHousePhase2Row struct {
	SiteID string   `json:"site_id"`
	TS     string   `json:"ts"`
	SID    string   `json:"sid"`
	Event  string   `json:"e"`
	Path   string   `json:"path"`
	X      *float32 `json:"x"`
	Y      *float32 `json:"y"`
	Sel    *string  `json:"sel"`
	Depth  *uint8   `json:"depth"`
	Meta   string   `json:"meta"`
}

type clickHouseLegacyRow struct {
	SiteID         string            `json:"site_id"`
	EventID        string            `json:"event_id"`
	Type           string            `json:"type"`
	Name           string            `json:"name"`
	Timestamp      string            `json:"timestamp"`
	Path           string            `json:"path"`
	URL            string            `json:"url"`
	Title          string            `json:"title"`
	Referrer       string            `json:"referrer"`
	ScreenWidth    uint16            `json:"screen_width"`
	ScreenHeight   uint16            `json:"screen_height"`
	ViewportWidth  uint16            `json:"viewport_width"`
	ViewportHeight uint16            `json:"viewport_height"`
	Language       string            `json:"language"`
	TimezoneOffset int16             `json:"timezone_offset"`
	UTMSource      string            `json:"utm_source"`
	UTMMedium      string            `json:"utm_medium"`
	UTMCampaign    string            `json:"utm_campaign"`
	UTMTerm        string            `json:"utm_term"`
	UTMContent     string            `json:"utm_content"`
	Props          map[string]string `json:"props"`
	VisitorID      string            `json:"visitor_id"`
	SessionID      string            `json:"session_id"`
	Browser        string            `json:"browser"`
	BrowserVersion string            `json:"browser_version"`
	OS             string            `json:"os"`
	OSVersion      string            `json:"os_version"`
	DeviceType     string            `json:"device_type"`
	Country        string            `json:"country"`
	Region         string            `json:"region"`
	City           string            `json:"city"`
}

func NewClickHouseStore(rawDSN string) (*ClickHouseStore, error) {
	if strings.TrimSpace(rawDSN) == "" {
		return nil, fmt.Errorf("clickhouse dsn is required")
	}

	parsed, err := url.Parse(rawDSN)
	if err != nil {
		return nil, fmt.Errorf("parse clickhouse dsn: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("clickhouse dsn must include scheme and host")
	}

	database := strings.TrimPrefix(parsed.Path, "/")
	if database == "" {
		database = strings.TrimSpace(parsed.Query().Get("database"))
	}
	if database == "" {
		database = "default"
	}

	baseURL := *parsed
	baseURL.Path = ""
	baseURL.RawQuery = ""
	baseURL.Fragment = ""

	password, _ := parsed.User.Password()
	return &ClickHouseStore{
		baseURL:  strings.TrimRight(baseURL.String(), "/"),
		database: database,
		username: parsed.User.Username(),
		password: password,
		client: &http.Client{
			Transport: &http.Transport{
				MaxIdleConns:        20,
				MaxIdleConnsPerHost: 20,
				IdleConnTimeout:     90 * time.Second,
			},
			Timeout: 30 * time.Second,
		},
	}, nil
}

func (s *ClickHouseStore) Exec(ctx context.Context, statement string) error {
	return s.executeStatement(ctx, statement)
}

func (s *ClickHouseStore) Close() error {
	if s == nil || s.client == nil {
		return nil
	}
	if transport, ok := s.client.Transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
	return nil
}

func (s *ClickHouseStore) QueryStrings(ctx context.Context, statement string) ([]string, error) {
	queryURL := fmt.Sprintf(
		"%s/?database=%s&query=%s",
		s.baseURL,
		url.QueryEscape(s.database),
		url.QueryEscape(statement),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, queryURL, http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("create clickhouse query request: %w", err)
	}
	if s.username != "" {
		request.SetBasicAuth(s.username, s.password)
	}

	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("query clickhouse strings: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("clickhouse query failed: %s", strings.TrimSpace(string(message)))
	}

	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, fmt.Errorf("read clickhouse query response: %w", err)
	}
	lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
	values := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		values = append(values, trimmed)
	}
	return values, nil
}

func (s *ClickHouseStore) WriteBatch(ctx context.Context, batch ingest.WriteBatch) error {
	if len(batch.Events) == 0 {
		return nil
	}

	if err := s.writeBatchPhase2(ctx, batch); err != nil {
		if !isClickHouseSchemaMismatch(err) {
			return err
		}
		if fallbackErr := s.writeBatchLegacy(ctx, batch); fallbackErr != nil {
			return fallbackErr
		}
	}

	s.inserted.Add(int64(len(batch.Events)))
	return nil
}

func (s *ClickHouseStore) writeBatchPhase2(ctx context.Context, batch ingest.WriteBatch) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, event := range batch.Events {
		if err := encoder.Encode(clickHousePhase2Row{
			SiteID: event.SiteID,
			TS:     event.Timestamp.UTC().Format("2006-01-02 15:04:05.000"),
			SID:    event.SessionID,
			Event:  event.Name,
			Path:   event.Path,
			X:      event.X,
			Y:      event.Y,
			Sel:    event.Selector,
			Depth:  event.Depth,
			Meta:   event.Meta,
		}); err != nil {
			return fmt.Errorf("encode clickhouse batch: %w", err)
		}
	}

	if err := s.executeInsert(ctx, "INSERT INTO events FORMAT JSONEachRow", &body); err != nil {
		return fmt.Errorf("write clickhouse phase2 batch: %w", err)
	}
	return nil
}

func (s *ClickHouseStore) writeBatchLegacy(ctx context.Context, batch ingest.WriteBatch) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for index, event := range batch.Events {
		row := buildLegacyRow(event, index)
		if err := encoder.Encode(row); err != nil {
			return fmt.Errorf("encode clickhouse legacy batch: %w", err)
		}
	}

	if err := s.executeInsert(ctx, "INSERT INTO events FORMAT JSONEachRow", &body); err != nil {
		return fmt.Errorf("write clickhouse legacy batch: %w", err)
	}
	return nil
}

func (s *ClickHouseStore) executeInsert(ctx context.Context, statement string, body *bytes.Buffer) error {
	insertURL := fmt.Sprintf(
		"%s/?database=%s&date_time_input_format=best_effort&query=%s",
		s.baseURL,
		url.QueryEscape(s.database),
		url.QueryEscape(statement),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, insertURL, body)
	if err != nil {
		return fmt.Errorf("create clickhouse request: %w", err)
	}
	request.Header.Set("Content-Type", "application/x-ndjson")
	if s.username != "" {
		request.SetBasicAuth(s.username, s.password)
	}

	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("write clickhouse batch: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("clickhouse insert failed: %s", strings.TrimSpace(string(message)))
	}
	return nil
}

func (s *ClickHouseStore) executeStatement(ctx context.Context, statement string) error {
	queryURL := fmt.Sprintf(
		"%s/?database=%s&date_time_input_format=best_effort&query=%s",
		s.baseURL,
		url.QueryEscape(s.database),
		url.QueryEscape(statement),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, queryURL, http.NoBody)
	if err != nil {
		return fmt.Errorf("create clickhouse request: %w", err)
	}
	if s.username != "" {
		request.SetBasicAuth(s.username, s.password)
	}

	response, err := s.client.Do(request)
	if err != nil {
		return fmt.Errorf("execute clickhouse statement: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("clickhouse statement failed: %s", strings.TrimSpace(string(message)))
	}
	return nil
}

func isClickHouseSchemaMismatch(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unknown identifier") ||
		strings.Contains(message, "unknown expression or function identifier") ||
		strings.Contains(message, "unknown column") ||
		strings.Contains(message, "code: 47")
}

func buildLegacyRow(event ingest.StoredEvent, index int) clickHouseLegacyRow {
	meta := map[string]any{}
	if strings.TrimSpace(event.Meta) != "" {
		_ = json.Unmarshal([]byte(event.Meta), &meta)
	}

	props := map[string]string{}
	if strings.TrimSpace(event.Meta) != "" {
		props["meta"] = event.Meta
	}
	if event.X != nil {
		props["x"] = strconv.FormatFloat(float64(*event.X), 'f', -1, 32)
	}
	if event.Y != nil {
		props["y"] = strconv.FormatFloat(float64(*event.Y), 'f', -1, 32)
	}
	if event.Selector != nil && strings.TrimSpace(*event.Selector) != "" {
		props["sel"] = strings.TrimSpace(*event.Selector)
	}
	if event.Depth != nil {
		props["depth"] = strconv.FormatUint(uint64(*event.Depth), 10)
	}
	if _, ok := meta["rg"]; ok {
		if metaBool(meta, "rg") {
			props["rg"] = "1"
		} else {
			props["rg"] = "0"
		}
	}
	if len(props) == 0 {
		props["meta"] = "{}"
	}

	eventType := "custom"
	eventName := strings.TrimSpace(event.Name)
	if eventName == "pageview" {
		eventType = "pageview"
		eventName = ""
	}

	visitorID := strings.TrimSpace(event.VisitorID)
	if visitorID == "" {
		visitorID = strings.TrimSpace(event.AnonymizedIP)
	}
	if visitorID == "" {
		visitorID = strings.TrimSpace(event.SessionID)
	}

	return clickHouseLegacyRow{
		SiteID:         event.SiteID,
		EventID:        fmt.Sprintf("%s-%d-%d", strings.TrimSpace(event.SessionID), event.Timestamp.UTC().UnixMilli(), index),
		Type:           eventType,
		Name:           eventName,
		Timestamp:      event.Timestamp.UTC().Format("2006-01-02 15:04:05.000"),
		Path:           event.Path,
		URL:            event.Path,
		Title:          metaString(meta, "ti"),
		Referrer:       metaString(meta, "r"),
		ScreenWidth:    clampUint16(metaInt(meta, "sw")),
		ScreenHeight:   clampUint16(metaInt(meta, "sh")),
		ViewportWidth:  clampUint16(metaInt(meta, "vw")),
		ViewportHeight: clampUint16(metaInt(meta, "vh")),
		Language:       metaString(meta, "l"),
		TimezoneOffset: clampInt16(metaInt(meta, "tz")),
		UTMSource:      metaString(meta, "us"),
		UTMMedium:      metaString(meta, "um"),
		UTMCampaign:    metaString(meta, "uc"),
		UTMTerm:        metaString(meta, "ut"),
		UTMContent:     metaString(meta, "uo"),
		Props:          props,
		VisitorID:      visitorID,
		SessionID:      strings.TrimSpace(event.SessionID),
		Browser:        metaString(meta, "br"),
		BrowserVersion: metaString(meta, "brv"),
		OS:             metaString(meta, "os"),
		OSVersion:      metaString(meta, "osv"),
		DeviceType:     metaString(meta, "dt"),
		Country:        firstNonEmptyMeta(meta, "ctn", "ct", "gct"),
		Region:         firstNonEmptyMeta(meta, "rgn", "rgc", "grn"),
		City:           firstNonEmptyMeta(meta, "city", "gci"),
	}
}

func firstNonEmptyMeta(meta map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := metaString(meta, key); value != "" {
			return value
		}
	}
	return ""
}

func metaString(meta map[string]any, key string) string {
	value, ok := meta[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func metaInt(meta map[string]any, key string) int {
	value, ok := meta[key]
	if !ok || value == nil {
		return 0
	}

	switch typed := value.(type) {
	case int:
		return typed
	case int8:
		return int(typed)
	case int16:
		return int(typed)
	case int32:
		return int(typed)
	case int64:
		return int(typed)
	case uint:
		return int(typed)
	case uint8:
		return int(typed)
	case uint16:
		return int(typed)
	case uint32:
		return int(typed)
	case uint64:
		return int(typed)
	case float32:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		if intValue, err := typed.Int64(); err == nil {
			return int(intValue)
		}
		if floatValue, err := typed.Float64(); err == nil {
			return int(floatValue)
		}
		return 0
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(typed))
		if err != nil {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func metaBool(meta map[string]any, key string) bool {
	value, ok := meta[key]
	if !ok || value == nil {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.TrimSpace(strings.ToLower(typed))
		return normalized == "true" || normalized == "1" || normalized == "yes"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return false
	}
}

func clampUint16(value int) uint16 {
	if value < 0 {
		return 0
	}
	if value > 65535 {
		return 65535
	}
	return uint16(value)
}

func clampInt16(value int) int16 {
	if value < -32768 {
		return -32768
	}
	if value > 32767 {
		return 32767
	}
	return int16(value)
}

func (s *ClickHouseStore) Stats() Stats {
	return Stats{
		Events: int(s.inserted.Load()),
	}
}

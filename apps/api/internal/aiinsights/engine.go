package aiinsights

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/storage"
)

const (
	defaultProvider      = "longcat"
	defaultPromptVersion = "ai-insights-v2"
)

var ErrDisabled = errors.New("ai insights are disabled")
var ErrUnsupportedProvider = errors.New("ai insights provider is not allowed for this endpoint")

type Engine struct {
	enabled        bool
	provider       string
	baseURL        string
	apiKey         string
	model          string
	zeroRetention  bool
	maxItems       int
	promptVersion  string
	requestTimeout time.Duration
	httpClient     *http.Client
}

type Request struct {
	SiteID             string                              `json:"siteId"`
	Range              string                              `json:"range"`
	Overview           storage.OverviewMetrics             `json:"overview"`
	OverviewComparison storage.DashboardOverviewComparison `json:"overviewComparison"`
	Derived            storage.DashboardDerivedMetrics     `json:"derived"`
	TopPages           []storage.PageMetric                `json:"topPages"`
	ScrollFunnel       []storage.DepthMetric               `json:"scrollFunnel"`
	Referrers          []storage.ReferrerMetric            `json:"referrers"`
	Devices            []storage.DeviceMetric              `json:"devices"`
	Browsers           []storage.BrowserMetric             `json:"browsers"`
	OperatingSystems   []storage.OperatingSystemMetric     `json:"operatingSystems"`
	Heatmaps           []HeatmapSummary                    `json:"heatmaps"`
	EventPatterns      []EventPattern                      `json:"eventPatterns"`
	Journeys           JourneyDigest                       `json:"journeys"`
	Retention          RetentionDigest                     `json:"retention"`
	RuleFlags          []RuleFlag                          `json:"ruleFlags"`
	ConfidenceNotes    []string                            `json:"confidenceNotes"`
	FreshnessNotes     []string                            `json:"freshnessNotes"`
}

type EventPattern struct {
	Name            string   `json:"name"`
	Family          string   `json:"family"`
	Count           int      `json:"count"`
	Trend           float64  `json:"trend"`
	ConfidenceScore int      `json:"confidenceScore"`
	TopPages        []string `json:"topPages"`
	TopDevices      []string `json:"topDevices"`
	TopCountries    []string `json:"topCountries"`
}

type JourneyDigest struct {
	Sessions     int      `json:"sessions"`
	TopPathShare float64  `json:"topPathShare"`
	CommonPaths  []string `json:"commonPaths"`
	EntryPages   []string `json:"entryPages"`
	ExitPages    []string `json:"exitPages"`
}

type RetentionDigest struct {
	Users          int     `json:"users"`
	Cohorts        int     `json:"cohorts"`
	Day1Rate       float64 `json:"day1Rate"`
	Day7Rate       float64 `json:"day7Rate"`
	Day14Rate      float64 `json:"day14Rate"`
	Day30Rate      float64 `json:"day30Rate"`
	Confidence     float64 `json:"confidence"`
	ConfidenceText string  `json:"confidenceText"`
}

type HeatmapSummary struct {
	Path            string            `json:"path"`
	Clicks          int               `json:"clicks"`
	RageClicks      int               `json:"rageClicks"`
	DeadClicks      int               `json:"deadClicks"`
	ErrorClicks     int               `json:"errorClicks"`
	MoveEvents      int               `json:"moveEvents"`
	ScrollEvents    int               `json:"scrollEvents"`
	TopSelectors    []SelectorSummary `json:"topSelectors"`
	QuadrantShare   QuadrantShare     `json:"quadrantShare"`
	AvgScrollDepth  float64           `json:"avgScrollDepth"`
	LowEngagementAt string            `json:"lowEngagementAt,omitempty"`
}

type SelectorSummary struct {
	Selector   string `json:"selector"`
	Clicks     int    `json:"clicks"`
	RageClicks int    `json:"rageClicks"`
	DeadClicks int    `json:"deadClicks"`
}

type QuadrantShare struct {
	TopLeft     float64 `json:"topLeft"`
	TopRight    float64 `json:"topRight"`
	BottomLeft  float64 `json:"bottomLeft"`
	BottomRight float64 `json:"bottomRight"`
}

type RuleFlag struct {
	Severity string `json:"severity"`
	Category string `json:"category"`
	Path     string `json:"path"`
	Reason   string `json:"reason"`
	Evidence string `json:"evidence"`
	Score    int    `json:"score"`
}

type Item struct {
	Severity string `json:"severity"`
	Category string `json:"category"`
	Path     string `json:"path"`
	Title    string `json:"title"`
	Problem  string `json:"problem"`
	Impact   string `json:"impact"`
	Fix      string `json:"fix"`
	Evidence string `json:"evidence"`
	Score    int    `json:"score"`
}

type Analysis struct {
	Narrative  string `json:"narrative"`
	Confidence string `json:"confidence"`
	Evidence   string `json:"evidence"`
}

type Action struct {
	Title          string `json:"title"`
	Priority       string `json:"priority"`
	ExpectedImpact string `json:"expectedImpact"`
	Path           string `json:"path"`
	Evidence       string `json:"evidence"`
}

type PageOpportunity struct {
	Path           string `json:"path"`
	Title          string `json:"title"`
	Opportunity    string `json:"opportunity"`
	Recommendation string `json:"recommendation"`
	Evidence       string `json:"evidence"`
}

type Audit struct {
	Enabled           bool     `json:"enabled"`
	Provider          string   `json:"provider"`
	Model             string   `json:"model"`
	PromptVersion     string   `json:"promptVersion"`
	ZeroRetention     bool     `json:"zeroRetention"`
	InputHash         string   `json:"inputHash"`
	FieldsSent        []string `json:"fieldsSent"`
	FieldsExcluded    []string `json:"fieldsExcluded"`
	DurationMS        int64    `json:"durationMs"`
	RequestID         string   `json:"requestId,omitempty"`
	Error             string   `json:"error,omitempty"`
	FallbackActivated bool     `json:"fallbackActivated"`
}

type Response struct {
	Analysis          Analysis          `json:"analysis"`
	Actions           []Action          `json:"actions"`
	PageOpportunities []PageOpportunity `json:"pageOpportunities"`
	Items             []Item            `json:"items"`
	Audit             Audit             `json:"audit"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	Store       *bool         `json:"store,omitempty"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message struct {
			Content any `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type outputEnvelope struct {
	Analysis          Analysis          `json:"analysis"`
	Actions           []Action          `json:"actions"`
	PageOpportunities []PageOpportunity `json:"pageOpportunities"`
	Insights          []Item            `json:"insights"`
	Items             []Item            `json:"items"`
	Findings          []Item            `json:"findings"`
}

func New(cfg config.Config) *Engine {
	engine := &Engine{
		enabled:        cfg.AIInsightsEnabled,
		provider:       strings.TrimSpace(cfg.AIInsightsProvider),
		baseURL:        strings.TrimSuffix(strings.TrimSpace(cfg.AIInsightsBaseURL), "/"),
		apiKey:         strings.TrimSpace(cfg.AIInsightsAPIKey),
		model:          strings.TrimSpace(cfg.AIInsightsModel),
		zeroRetention:  cfg.AIInsightsZeroRetention,
		maxItems:       cfg.AIInsightsMaxItems,
		promptVersion:  defaultPromptVersion,
		requestTimeout: cfg.AIInsightsTimeout,
	}

	if engine.provider == "" {
		engine.provider = defaultProvider
	}
	if engine.maxItems <= 0 {
		engine.maxItems = 6
	}
	if engine.requestTimeout <= 0 {
		engine.requestTimeout = 20 * time.Second
	}
	if !engine.enabled || engine.baseURL == "" || engine.apiKey == "" || engine.model == "" {
		engine.enabled = false
	}
	if strings.Contains(strings.ToLower(engine.provider), "groq") || strings.Contains(strings.ToLower(engine.baseURL), "groq") || strings.Contains(strings.ToLower(engine.model), "groq") {
		engine.enabled = false
	}

	engine.httpClient = &http.Client{Timeout: engine.requestTimeout}
	return engine
}

func (e *Engine) Enabled() bool {
	return e != nil && e.enabled
}

func (e *Engine) Generate(ctx context.Context, input Request) (Response, error) {
	audit := Audit{
		Enabled:        e.Enabled(),
		Provider:       e.provider,
		Model:          e.model,
		PromptVersion:  e.promptVersion,
		ZeroRetention:  e.zeroRetention,
		FieldsSent:     []string{"overview", "topPages", "scrollFunnel", "referrers", "devices", "heatmaps", "ruleFlags", "range", "siteId"},
		FieldsExcluded: []string{"raw events", "session replay", "visitor identifiers", "IP", "cookies", "full DOM", "form text", "free text content"},
	}

	if !e.Enabled() {
		audit.FallbackActivated = true
		audit.Error = ErrDisabled.Error()
		return Response{Audit: audit}, ErrDisabled
	}
	if strings.Contains(strings.ToLower(e.provider), "groq") || strings.Contains(strings.ToLower(e.baseURL), "groq") || strings.Contains(strings.ToLower(e.model), "groq") {
		audit.FallbackActivated = true
		audit.Error = ErrUnsupportedProvider.Error()
		return Response{Audit: audit}, ErrUnsupportedProvider
	}

	hashInput, err := json.Marshal(input)
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}
	sum := sha256.Sum256(hashInput)
	audit.InputHash = hex.EncodeToString(sum[:])

	systemPrompt, userPrompt := e.buildPrompt(input)
	store := !e.zeroRetention
	requestBody, err := json.Marshal(chatRequest{
		Model: e.model,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		Temperature: 0.2,
		MaxTokens:   1200,
		Store:       &store,
	})
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	start := time.Now()
	requestCtx, cancel := context.WithTimeout(ctx, e.requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, e.baseURL+"/chat/completions", bytes.NewReader(requestBody))
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.apiKey)

	resp, err := e.httpClient.Do(req)
	audit.DurationMS = time.Since(start).Milliseconds()
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}
	defer resp.Body.Close()

	rawResponse, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	var decoded chatResponse
	if err := json.Unmarshal(rawResponse, &decoded); err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	if decoded.ID != "" {
		audit.RequestID = decoded.ID
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(rawResponse))
		if decoded.Error != nil && strings.TrimSpace(decoded.Error.Message) != "" {
			message = decoded.Error.Message
		}
		err := fmt.Errorf("ai insights request failed (%d): %s", resp.StatusCode, message)
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	if len(decoded.Choices) == 0 {
		err := errors.New("ai insights request returned no choices")
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	content := extractMessageContent(decoded.Choices[0].Message.Content)
	envelope, err := parseEnvelope(content, e.maxItems)
	if err != nil {
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	if len(envelope.Insights) == 0 && strings.TrimSpace(envelope.Analysis.Narrative) == "" {
		err := errors.New("ai insights request returned no valid items")
		audit.FallbackActivated = true
		audit.Error = err.Error()
		return Response{Audit: audit}, err
	}

	return Response{
		Analysis:          envelope.Analysis,
		Actions:           envelope.Actions,
		PageOpportunities: envelope.PageOpportunities,
		Items:             envelope.Insights,
		Audit:             audit,
	}, nil
}

func (e *Engine) buildPrompt(input Request) (string, string) {
	system := strings.Join([]string{
		"You are a senior analytics strategist for a privacy-first product.",
		"You only receive aggregated, anonymized metrics. Never request or infer personal data.",
		"This endpoint is LongCat-only. Do not mention or rely on Groq.",
		"Return genuine site-specific analysis in strict JSON.",
		"Every conclusion must cite concrete evidence from the provided context.",
	}, " ")
	context := e.buildContext(input)
	user := strings.Join([]string{
		"Analyze this anonymized site snapshot and produce a narrative plus prioritized actions.",
		"Each insight must include: severity, category, path, title, problem, impact, fix, evidence, score.",
		"Return narrative analysis first, then prioritized actions, then page-specific opportunities, then insight items.",
		"Severity must be one of: critical, warning, info.",
		"Score must be an integer between 1 and 100.",
		"Return JSON only with this shape:",
		`{"analysis":{"narrative":"string","confidence":"string","evidence":"string"},"actions":[{"title":"string","priority":"high|medium|low","expectedImpact":"string","path":"/path","evidence":"string"}],"pageOpportunities":[{"path":"/path","title":"string","opportunity":"string","recommendation":"string","evidence":"string"}],"insights":[{"severity":"critical|warning|info","category":"string","path":"/path","title":"string","problem":"string","impact":"string","fix":"string","evidence":"string","score":72}]}`,
		"Do not include markdown fences.",
		"Context:",
		context,
	}, "\n")

	return system, user
}

func (e *Engine) buildContext(input Request) string {
	builder := &strings.Builder{}
	builder.WriteString("Overview\n")
	builder.WriteString(fmt.Sprintf(
		"- Range: %s\n- Visitors: %d\n- Sessions: %d\n- Pageviews: %d\n- Bounce rate: %.1f%%\n- Avg scroll depth: %.1f%%\n- Rage clicks: %d\n",
		input.Range,
		input.Overview.UniqueVisitors,
		input.Overview.Sessions,
		input.Overview.Pageviews,
		input.Overview.BounceRate,
		input.Overview.AvgScrollDepth,
		input.Overview.RageClicks,
	))
	builder.WriteString(fmt.Sprintf(
		"- Trends vs previous period: visitors %.1f%%, sessions %.1f%%, pageviews %.1f%%, bounce %.1f%%\n",
		input.OverviewComparison.UniqueVisitors.Delta,
		input.OverviewComparison.Sessions.Delta,
		input.OverviewComparison.Pageviews.Delta,
		input.OverviewComparison.BounceRate.Delta,
	))

	if len(input.TopPages) > 0 {
		builder.WriteString("\nTop pages\n")
		for _, page := range input.TopPages[:minInt(len(input.TopPages), 5)] {
			builder.WriteString(fmt.Sprintf(
				"- %s: %d pageviews, %d sessions, %.1f%% avg scroll depth, %d rage clicks\n",
				page.Path,
				page.Pageviews,
				page.Sessions,
				page.AvgScrollDepth,
				page.RageClicks,
			))
		}
	}

	if len(input.Referrers) > 0 {
		builder.WriteString("\nReferrers\n")
		for _, referrer := range input.Referrers[:minInt(len(input.Referrers), 4)] {
			builder.WriteString(fmt.Sprintf("- %s: %d pageviews\n", referrer.Source, referrer.Pageviews))
		}
	}

	if len(input.Devices) > 0 || len(input.Browsers) > 0 || len(input.OperatingSystems) > 0 {
		builder.WriteString("\nTechnology mix\n")
		for _, device := range input.Devices[:minInt(len(input.Devices), 3)] {
			builder.WriteString(fmt.Sprintf("- Device %s: %d pageviews\n", device.Device, device.Pageviews))
		}
		for _, browser := range input.Browsers[:minInt(len(input.Browsers), 3)] {
			builder.WriteString(fmt.Sprintf("- Browser %s: %d pageviews\n", browser.Browser, browser.Pageviews))
		}
		for _, operatingSystem := range input.OperatingSystems[:minInt(len(input.OperatingSystems), 3)] {
			builder.WriteString(fmt.Sprintf("- OS %s: %d pageviews\n", operatingSystem.OS, operatingSystem.Pageviews))
		}
	}

	if len(input.EventPatterns) > 0 {
		builder.WriteString("\nEvent patterns\n")
		for _, pattern := range input.EventPatterns[:minInt(len(input.EventPatterns), 5)] {
			builder.WriteString(fmt.Sprintf(
				"- %s (%s): %d events, trend %.1f%%, confidence %d, top pages %s\n",
				pattern.Name,
				pattern.Family,
				pattern.Count,
				pattern.Trend,
				pattern.ConfidenceScore,
				strings.Join(pattern.TopPages, ", "),
			))
		}
	}

	if len(input.Heatmaps) > 0 {
		builder.WriteString("\nHeatmap summaries\n")
		for _, heatmap := range input.Heatmaps[:minInt(len(input.Heatmaps), 4)] {
			builder.WriteString(fmt.Sprintf(
				"- %s: %d clicks, %d rage clicks, %d dead clicks, %d error clicks, avg scroll %.1f%%\n",
				heatmap.Path,
				heatmap.Clicks,
				heatmap.RageClicks,
				heatmap.DeadClicks,
				heatmap.ErrorClicks,
				heatmap.AvgScrollDepth,
			))
		}
	}

	builder.WriteString("\nJourneys and retention\n")
	builder.WriteString(fmt.Sprintf(
		"- Journeys: %d sessions, top path share %.1f%%, common paths %s\n",
		input.Journeys.Sessions,
		input.Journeys.TopPathShare,
		strings.Join(input.Journeys.CommonPaths, " | "),
	))
	builder.WriteString(fmt.Sprintf(
		"- Retention: day1 %.1f%%, day7 %.1f%%, day14 %.1f%%, day30 %.1f%%, confidence %s\n",
		input.Retention.Day1Rate,
		input.Retention.Day7Rate,
		input.Retention.Day14Rate,
		input.Retention.Day30Rate,
		input.Retention.ConfidenceText,
	))

	if len(input.RuleFlags) > 0 {
		builder.WriteString("\nRule flags\n")
		for _, flag := range input.RuleFlags[:minInt(len(input.RuleFlags), 6)] {
			builder.WriteString(fmt.Sprintf("- [%s] %s on %s: %s\n", flag.Severity, flag.Category, flag.Path, flag.Evidence))
		}
	}

	if len(input.ConfidenceNotes) > 0 {
		builder.WriteString("\nConfidence notes\n")
		for _, note := range input.ConfidenceNotes {
			builder.WriteString("- " + note + "\n")
		}
	}
	if len(input.FreshnessNotes) > 0 {
		builder.WriteString("\nFreshness notes\n")
		for _, note := range input.FreshnessNotes {
			builder.WriteString("- " + note + "\n")
		}
	}

	builder.WriteString("\nPrivacy exclusions enforced: no raw events, replay payloads, visitor IDs, IPs, cookies, DOM, form text, or personal data.\n")
	return strings.TrimSpace(builder.String())
}

func extractMessageContent(raw any) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	case []any:
		parts := make([]string, 0, len(value))
		for _, item := range value {
			mapped, ok := item.(map[string]any)
			if !ok {
				continue
			}
			if text, ok := mapped["text"].(string); ok {
				parts = append(parts, text)
			}
		}
		return strings.TrimSpace(strings.Join(parts, "\n"))
	default:
		return ""
	}
}

func parseEnvelope(content string, limit int) (outputEnvelope, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return outputEnvelope{}, errors.New("ai insights content was empty")
	}

	candidates := []string{content}
	if extracted := extractJSONObject(content); extracted != "" && extracted != content {
		candidates = append([]string{extracted}, candidates...)
	}

	var envelope outputEnvelope
	var parseErr error
	for _, candidate := range candidates {
		if err := json.Unmarshal([]byte(candidate), &envelope); err == nil {
			parseErr = nil
			break
		} else {
			parseErr = err
		}
	}
	if parseErr != nil {
		return outputEnvelope{}, fmt.Errorf("failed to parse ai insights json: %w", parseErr)
	}

	rawItems := envelope.Insights
	if len(rawItems) == 0 {
		rawItems = envelope.Items
	}
	if len(rawItems) == 0 {
		rawItems = envelope.Findings
	}

	items := make([]Item, 0, len(rawItems))
	for _, rawItem := range rawItems {
		normalized, ok := normalizeItem(rawItem)
		if !ok {
			continue
		}
		items = append(items, normalized)
		if limit > 0 && len(items) >= limit {
			break
		}
	}

	envelope.Insights = items
	return envelope, nil
}

func normalizeItem(input Item) (Item, bool) {
	item := Item{
		Severity: normalizeSeverity(input.Severity, input.Score),
		Category: sanitizeCategory(input.Category),
		Path:     normalizePath(input.Path),
		Title:    strings.TrimSpace(input.Title),
		Problem:  strings.TrimSpace(input.Problem),
		Impact:   strings.TrimSpace(input.Impact),
		Fix:      strings.TrimSpace(input.Fix),
		Evidence: strings.TrimSpace(input.Evidence),
		Score:    clampScore(input.Score),
	}

	if item.Score == 0 {
		switch item.Severity {
		case "critical":
			item.Score = 85
		case "warning":
			item.Score = 65
		default:
			item.Score = 45
		}
	}

	if item.Title == "" {
		switch item.Category {
		case "rage_click":
			item.Title = "Users are hitting interaction friction"
		case "scroll_dropoff":
			item.Title = "Important content is missed below the fold"
		case "high_bounce":
			item.Title = "Sessions are exiting too early"
		default:
			item.Title = "Actionable UX opportunity detected"
		}
	}

	if item.Problem == "" && item.Impact == "" && item.Fix == "" {
		return Item{}, false
	}

	return item, true
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func normalizeSeverity(value string, score int) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "critical", "high":
		return "critical"
	case "warning", "medium":
		return "warning"
	case "info", "low":
		return "info"
	}

	switch {
	case score >= 80:
		return "critical"
	case score >= 50:
		return "warning"
	default:
		return "info"
	}
}

func sanitizeCategory(value string) string {
	replacer := strings.NewReplacer(" ", "_", "-", "_", "/", "_")
	clean := replacer.Replace(strings.ToLower(strings.TrimSpace(value)))
	if clean == "" {
		return "ux"
	}
	return clean
}

func normalizePath(value string) string {
	path := strings.TrimSpace(value)
	if path == "" {
		return "All pages"
	}
	return path
}

func clampScore(value int) int {
	switch {
	case value < 0:
		return 0
	case value > 100:
		return 100
	default:
		return value
	}
}

func extractJSONObject(content string) string {
	start := strings.Index(content, "{")
	if start == -1 {
		return ""
	}

	depth := 0
	inString := false
	escaped := false
	for index := start; index < len(content); index += 1 {
		char := content[index]
		if escaped {
			escaped = false
			continue
		}
		if char == '\\' {
			escaped = true
			continue
		}
		if char == '"' {
			inString = !inString
			continue
		}
		if inString {
			continue
		}
		switch char {
		case '{':
			depth += 1
		case '}':
			depth -= 1
			if depth == 0 {
				return content[start : index+1]
			}
		}
	}
	return ""
}

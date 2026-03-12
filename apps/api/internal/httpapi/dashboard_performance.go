package httpapi

import (
	"encoding/json"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/storage"
)

type dashboardPerformanceResponse struct {
	Range        string                           `json:"range"`
	Capture      dashboardPerformanceCapture      `json:"capture"`
	Vitals       []dashboardPerformanceVital      `json:"vitals"`
	Pages        []dashboardPerformancePageSignal `json:"pages"`
	ProxySummary dashboardPerformanceProxySummary `json:"proxySummary"`
}

type dashboardPerformanceCapture struct {
	PerformanceTrackingEnabled bool   `json:"performanceTrackingEnabled"`
	SignalMode                 string `json:"signalMode"`
	Note                       string `json:"note"`
	RealSampleCount            int    `json:"realSampleCount"`
	ProxySignalCount           int    `json:"proxySignalCount"`
}

type dashboardPerformanceVital struct {
	Metric      string   `json:"metric"`
	Label       string   `json:"label"`
	P75         *float64 `json:"p75,omitempty"`
	SampleCount int      `json:"sampleCount"`
	Source      string   `json:"source"`
	Status      string   `json:"status"`
}

type dashboardPerformancePageSignal struct {
	Path           string   `json:"path"`
	Source         string   `json:"source"`
	SampleCount    int      `json:"sampleCount"`
	LCPP75         *float64 `json:"lcpP75,omitempty"`
	INPP75         *float64 `json:"inpP75,omitempty"`
	CLSP75         *float64 `json:"clsP75,omitempty"`
	TTFBP75        *float64 `json:"ttfbP75,omitempty"`
	ReplayFailures int      `json:"replayFailures"`
	RageClicks     int      `json:"rageClicks"`
	InsightCount   int      `json:"insightCount"`
	Note           string   `json:"note"`
}

type dashboardPerformanceProxySummary struct {
	ReplayFailures      int `json:"replayFailures"`
	PerformanceInsights int `json:"performanceInsights"`
	RageClicks          int `json:"rageClicks"`
}

type pagePerformanceAccumulator struct {
	Path           string
	PerfValues     map[string][]float64
	ReplayFailures int
	RageClicks     int
	InsightCount   int
}

func (s *Server) handleDashboardPerformance(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.export == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "performance analytics are not configured"})
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

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	cacheKey := "performance:" + strings.TrimSpace(site.ID) + ":" + rangeValue.String()
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	now := time.Now().UTC()
	events, err := s.export.ExportEvents(r.Context(), site.ID, rangeValue, now)
	if err != nil {
		s.logger.Error("dashboard performance export failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load performance signals"})
		return
	}
	insights, _ := s.dashboard.Insights(r.Context(), site.ID, rangeValue, now)
	replays := storage.ReplaySessionList{}
	if s.replay != nil {
		if current, replayErr := s.replay.ReplaySessions(r.Context(), site.ID, rangeValue, now); replayErr == nil {
			replays = current
		}
	}

	view := buildDashboardPerformanceView(site, rangeValue, events, insights, replays)
	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func buildDashboardPerformanceView(
	site config.Site,
	rangeValue storage.TimeRange,
	events []storage.ExportEvent,
	insights storage.InsightsView,
	replays storage.ReplaySessionList,
) dashboardPerformanceResponse {
	pageIndex := map[string]*pagePerformanceAccumulator{}
	sitePerf := map[string][]float64{}
	replayFailureTotal := 0
	rageClickTotal := 0
	performanceInsightCount := 0

	for _, event := range events {
		path := normalizePerformancePath(event.Path)
		current := ensurePerformancePage(pageIndex, path)
		switch event.Name {
		case "click":
			if metaBool(event.Meta, "rg") {
				current.RageClicks += 1
				rageClickTotal += 1
			}
		case "perf_lcp", "perf_inp", "perf_cls", "perf_ttfb":
			if value, ok := exportPerformanceMetricValue(event.Meta); ok {
				current.PerfValues[event.Name] = append(current.PerfValues[event.Name], value)
				sitePerf[event.Name] = append(sitePerf[event.Name], value)
			}
		}
	}

	for _, item := range insights.Items {
		if !strings.EqualFold(strings.TrimSpace(item.Category), "performance") {
			continue
		}
		page := ensurePerformancePage(pageIndex, normalizePerformancePath(item.Path))
		page.InsightCount += 1
		performanceInsightCount += 1
	}

	for _, session := range replays.Sessions {
		failures := session.ConsoleErrorCount + session.NetworkFailureCount
		if failures <= 0 {
			continue
		}
		replayFailureTotal += failures
		paths := session.Paths
		if len(paths) == 0 {
			paths = []string{session.EntryPath}
		}
		for _, path := range paths {
			if strings.TrimSpace(path) == "" {
				continue
			}
			page := ensurePerformancePage(pageIndex, normalizePerformancePath(path))
			page.ReplayFailures += failures
		}
	}

	realSampleCount := 0
	for _, values := range sitePerf {
		realSampleCount += len(values)
	}
	proxySignalCount := replayFailureTotal + performanceInsightCount + rageClickTotal
	signalMode := "proxy"
	note := "No web vital samples were collected for the selected range, so this view is using replay and insight proxy signals."
	if !site.PerformanceTrackingEnabled {
		signalMode = "disabled"
		note = "Performance tracking is disabled in site settings. Only replay and insight proxy signals remain available."
	} else if realSampleCount > 0 {
		signalMode = "real"
		note = "Web vital samples are captured from tracker events. Replay and insight signals are kept as supporting context."
	}

	vitals := []dashboardPerformanceVital{
		buildPerformanceVital("lcp", "Largest Contentful Paint", sitePerf["perf_lcp"], signalMode),
		buildPerformanceVital("inp", "Interaction to Next Paint", sitePerf["perf_inp"], signalMode),
		buildPerformanceVital("cls", "Cumulative Layout Shift", sitePerf["perf_cls"], signalMode),
		buildPerformanceVital("ttfb", "Time to First Byte", sitePerf["perf_ttfb"], signalMode),
	}

	pages := make([]dashboardPerformancePageSignal, 0, len(pageIndex))
	for _, page := range pageIndex {
		var lcpP75 *float64
		if value, ok := performanceP75(page.PerfValues["perf_lcp"]); ok {
			lcpP75 = &value
		}
		var inpP75 *float64
		if value, ok := performanceP75(page.PerfValues["perf_inp"]); ok {
			inpP75 = &value
		}
		var clsP75 *float64
		if value, ok := performanceP75(page.PerfValues["perf_cls"]); ok {
			clsP75 = &value
		}
		var ttfbP75 *float64
		if value, ok := performanceP75(page.PerfValues["perf_ttfb"]); ok {
			ttfbP75 = &value
		}
		source := "proxy"
		note := "Only proxy signals are available for this page."
		sampleCount := 0
		for _, values := range page.PerfValues {
			sampleCount += len(values)
		}
		if !site.PerformanceTrackingEnabled {
			source = "disabled"
			note = "Performance capture is disabled for this site."
		} else if sampleCount > 0 {
			source = "real"
			note = "Web vital samples are available for this page."
		}
		pages = append(pages, dashboardPerformancePageSignal{
			Path:           page.Path,
			Source:         source,
			SampleCount:    sampleCount,
			LCPP75:         lcpP75,
			INPP75:         inpP75,
			CLSP75:         clsP75,
			TTFBP75:        ttfbP75,
			ReplayFailures: page.ReplayFailures,
			RageClicks:     page.RageClicks,
			InsightCount:   page.InsightCount,
			Note:           note,
		})
	}
	slices.SortFunc(pages, func(a, b dashboardPerformancePageSignal) int {
		scoreA := a.ReplayFailures + a.RageClicks + a.InsightCount + a.SampleCount
		scoreB := b.ReplayFailures + b.RageClicks + b.InsightCount + b.SampleCount
		if scoreA == scoreB {
			return strings.Compare(a.Path, b.Path)
		}
		if scoreA > scoreB {
			return -1
		}
		return 1
	})
	if len(pages) > 10 {
		pages = pages[:10]
	}

	return dashboardPerformanceResponse{
		Range: rangeValue.String(),
		Capture: dashboardPerformanceCapture{
			PerformanceTrackingEnabled: site.PerformanceTrackingEnabled,
			SignalMode:                 signalMode,
			Note:                       note,
			RealSampleCount:            realSampleCount,
			ProxySignalCount:           proxySignalCount,
		},
		Vitals: vitals,
		Pages:  pages,
		ProxySummary: dashboardPerformanceProxySummary{
			ReplayFailures:      replayFailureTotal,
			PerformanceInsights: performanceInsightCount,
			RageClicks:          rageClickTotal,
		},
	}
}

func ensurePerformancePage(index map[string]*pagePerformanceAccumulator, path string) *pagePerformanceAccumulator {
	current := index[path]
	if current != nil {
		return current
	}
	current = &pagePerformanceAccumulator{
		Path:       path,
		PerfValues: map[string][]float64{},
	}
	index[path] = current
	return current
}

func normalizePerformancePath(path string) string {
	trimmed := strings.TrimSpace(path)
	if trimmed == "" {
		return "/"
	}
	if !strings.HasPrefix(trimmed, "/") {
		return "/" + trimmed
	}
	return trimmed
}

func metaBool(meta map[string]any, key string) bool {
	if meta == nil {
		return false
	}
	value, ok := meta[key]
	if !ok {
		return false
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(strings.TrimSpace(typed), "true") || strings.TrimSpace(typed) == "1"
	default:
		return false
	}
}

func exportPerformanceMetricValue(meta map[string]any) (float64, bool) {
	if meta == nil {
		return 0, false
	}
	props, ok := meta["pr"].(map[string]any)
	if !ok {
		return 0, false
	}
	switch value := props["v"].(type) {
	case float64:
		return value, true
	case int:
		return float64(value), true
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func performanceP75(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}
	clone := slices.Clone(values)
	slices.Sort(clone)
	index := int(math.Ceil(0.75*float64(len(clone)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(clone) {
		index = len(clone) - 1
	}
	return math.Round(clone[index]*100) / 100, true
}

func buildPerformanceVital(metric, label string, values []float64, signalMode string) dashboardPerformanceVital {
	vital := dashboardPerformanceVital{
		Metric:      metric,
		Label:       label,
		SampleCount: len(values),
		Source:      "proxy",
		Status:      "unavailable",
	}
	if signalMode == "disabled" {
		vital.Source = "disabled"
		return vital
	}
	if value, ok := performanceP75(values); ok {
		vital.Source = "real"
		vital.P75 = &value
		vital.Status = performanceVitalStatus(metric, value)
		return vital
	}
	vital.Source = signalMode
	return vital
}

func performanceVitalStatus(metric string, value float64) string {
	switch metric {
	case "lcp":
		switch {
		case value <= 2500:
			return "good"
		case value <= 4000:
			return "needs-improvement"
		default:
			return "poor"
		}
	case "inp":
		switch {
		case value <= 200:
			return "good"
		case value <= 500:
			return "needs-improvement"
		default:
			return "poor"
		}
	case "cls":
		switch {
		case value <= 0.1:
			return "good"
		case value <= 0.25:
			return "needs-improvement"
		default:
			return "poor"
		}
	case "ttfb":
		switch {
		case value <= 800:
			return "good"
		case value <= 1800:
			return "needs-improvement"
		default:
			return "poor"
		}
	default:
		return "unavailable"
	}
}

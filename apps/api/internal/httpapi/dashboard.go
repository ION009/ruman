package httpapi

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/aiinsights"
	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/storage"
)

type dashboardSite struct {
	ID      string   `json:"id"`
	Name    string   `json:"name,omitempty"`
	Origins []string `json:"origins"`
}

type dashboardContextResponse struct {
	Product       string          `json:"product"`
	DefaultSiteID string          `json:"defaultSiteId"`
	Sites         []dashboardSite `json:"sites"`
	Ranges        []string        `json:"ranges"`
}

type dashboardRetention struct {
	EventsDays    int                          `json:"eventsDays"`
	HeatmapDays   int                          `json:"heatmapDays"`
	ReplayDays    int                          `json:"replayDays"`
	InsightsDays  int                          `json:"insightsDays"`
	SiteOverrides *dashboardRetentionOverrides `json:"siteOverrides,omitempty"`
}

type dashboardRetentionOverrides struct {
	EventsDays   *int `json:"eventsDays"`
	HeatmapDays  *int `json:"heatmapDays"`
	ReplayDays   *int `json:"replayDays"`
	InsightsDays *int `json:"insightsDays"`
}

type dashboardRealtimeResponse struct {
	Visitors int `json:"visitors"`
}

type dashboardSettingsResponse struct {
	Sites          []dashboardSite         `json:"sites"`
	Site           dashboardSite           `json:"site"`
	TrackerSnippet string                  `json:"trackerSnippet"`
	TrackerScript  trackerScriptBlock      `json:"trackerScript"`
	Privacy        dashboardPrivacy        `json:"privacy"`
	Tracking       dashboardTracking       `json:"tracking"`
	Retention      dashboardRetention      `json:"retention"`
	ImportDefaults dashboardImportDefaults `json:"importDefaults"`
	Stats          storage.SiteStats       `json:"stats"`
}

type trackerScriptBlock struct {
	SiteID          string  `json:"siteId"`
	InstallOrigin   string  `json:"installOrigin"`
	CollectorOrigin string  `json:"collectorOrigin"`
	ScriptSrc       string  `json:"scriptSrc"`
	ScriptTag       string  `json:"scriptTag"`
	IsPersisted     bool    `json:"isPersisted"`
	UpdatedAt       *string `json:"updatedAt"`
}

type dashboardPrivacy struct {
	DomSnapshotsEnabled  bool `json:"domSnapshotsEnabled"`
	VisitorCookieEnabled bool `json:"visitorCookieEnabled"`
}

type dashboardTracking struct {
	BlockBotTrafficEnabled     bool `json:"blockBotTrafficEnabled"`
	DomSnapshotsEnabled        bool `json:"domSnapshotsEnabled"`
	VisitorCookieEnabled       bool `json:"visitorCookieEnabled"`
	ReplayMaskTextEnabled      bool `json:"replayMaskTextEnabled"`
	SPATrackingEnabled         bool `json:"spaTrackingEnabled"`
	ErrorTrackingEnabled       bool `json:"errorTrackingEnabled"`
	PerformanceTrackingEnabled bool `json:"performanceTrackingEnabled"`
}

type dashboardImportDefaults struct {
	Mapping  map[string]string `json:"mapping"`
	Timezone string            `json:"timezone"`
}

type aiInsightsEngine struct {
	Mode        string `json:"mode"`
	Provider    string `json:"provider"`
	Model       string `json:"model"`
	RuleCount   int    `json:"ruleCount"`
	AIItemCount int    `json:"aiItemCount"`
}

type aiInsightItem struct {
	Severity       string `json:"severity"`
	Category       string `json:"category"`
	Path           string `json:"path"`
	Title          string `json:"title"`
	Problem        string `json:"problem"`
	Impact         string `json:"impact"`
	Fix            string `json:"fix"`
	Finding        string `json:"finding"`
	Recommendation string `json:"recommendation"`
	Evidence       string `json:"evidence"`
	Score          int    `json:"score"`
	Source         string `json:"source"`
}

type aiInsightSnapshot struct {
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
	Heatmaps           []aiinsights.HeatmapSummary         `json:"heatmaps"`
	EventPatterns      []aiinsights.EventPattern           `json:"eventPatterns"`
	Journeys           aiinsights.JourneyDigest            `json:"journeys"`
	Retention          aiinsights.RetentionDigest          `json:"retention"`
	ConfidenceNotes    []string                            `json:"confidenceNotes"`
	FreshnessNotes     []string                            `json:"freshnessNotes"`
}

type aiInsightAnalysis struct {
	Narrative  string `json:"narrative"`
	Confidence string `json:"confidence"`
	Evidence   string `json:"evidence"`
}

type aiInsightAction struct {
	Title          string `json:"title"`
	Priority       string `json:"priority"`
	ExpectedImpact string `json:"expectedImpact"`
	Path           string `json:"path"`
	Evidence       string `json:"evidence"`
}

type aiInsightOpportunity struct {
	Path           string `json:"path"`
	Title          string `json:"title"`
	Opportunity    string `json:"opportunity"`
	Recommendation string `json:"recommendation"`
	Evidence       string `json:"evidence"`
}

type aiInsightsResponse struct {
	Range             string                 `json:"range"`
	GeneratedAt       string                 `json:"generatedAt"`
	Engine            aiInsightsEngine       `json:"engine"`
	Summary           storage.InsightSummary `json:"summary"`
	Analysis          aiInsightAnalysis      `json:"analysis"`
	Actions           []aiInsightAction      `json:"actions"`
	PageOpportunities []aiInsightOpportunity `json:"pageOpportunities"`
	Items             []aiInsightItem        `json:"items"`
	Pages             []storage.PageOption   `json:"pages"`
	RuleFlags         []aiinsights.RuleFlag  `json:"ruleFlags"`
	Snapshot          aiInsightSnapshot      `json:"snapshot"`
	Audit             aiinsights.Audit       `json:"audit"`
}

func (s *Server) handleDashboardContext(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}

	writeJSON(w, http.StatusOK, dashboardContextResponse{
		Product:       "AnlticsHeat",
		DefaultSiteID: s.defaultSiteID(),
		Sites:         s.dashboardSites(),
		Ranges:        []string{storage.Range24Hours.String(), storage.Range7Days.String(), storage.Range30Days.String(), storage.Range90Days.String()},
	})
}

func (s *Server) handleDashboardSummary(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	cacheKey := fmt.Sprintf("summary:%s:%s", site.ID, rangeValue)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		var summary storage.DashboardSummary
		if err := json.Unmarshal(cached, &summary); err == nil {
			summary.Overview.RealtimeVisitors = s.currentRealtimeVisitors(site.ID)
			if payload, marshalErr := json.Marshal(summary); marshalErr == nil {
				w.Header().Set("X-Cache", "hit")
				writeJSONBytes(w, http.StatusOK, payload)
				return
			}
		}
	}

	summary, err := s.dashboard.DashboardSummary(r.Context(), site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard summary failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load dashboard summary"})
		return
	}

	summary.Overview.RealtimeVisitors = 0
	cached, err := json.Marshal(summary)
	if err == nil {
		s.cacheBytesSet(cacheKey, cached)
	}
	summary.Overview.RealtimeVisitors = s.currentRealtimeVisitors(site.ID)

	payload, err := json.Marshal(summary)
	if err != nil {
		writeJSON(w, http.StatusOK, summary)
		return
	}
	w.Header().Set("X-Cache", "miss")
	writeJSONBytes(w, http.StatusOK, payload)
}

func (s *Server) handleDashboardMap(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	cacheKey := fmt.Sprintf("map:%s:%s", site.ID, rangeValue)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.Map(r.Context(), site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard map failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load map"})
		return
	}

	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardJourneys(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	query := storage.JourneyQuery{
		DeviceFilter:  strings.TrimSpace(r.URL.Query().Get("device")),
		CountryFilter: strings.TrimSpace(r.URL.Query().Get("country")),
	}
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsedLimit, parseErr := strconv.Atoi(rawLimit); parseErr == nil {
			query.Limit = parsedLimit
		}
	}

	if s.replay != nil {
		replays, replayErr := s.replay.ReplaySessions(r.Context(), site.ID, rangeValue, time.Now().UTC())
		if replayErr == nil {
			query.ReplaySessionIDs = make([]string, 0, len(replays.Sessions))
			for _, session := range replays.Sessions {
				if strings.TrimSpace(session.SessionID) == "" {
					continue
				}
				query.ReplaySessionIDs = append(query.ReplaySessionIDs, session.SessionID)
			}
		}
	}

	cacheKey := fmt.Sprintf(
		"journeys:%s:%s:%s:%s:%d",
		site.ID,
		rangeValue,
		query.DeviceFilter,
		query.CountryFilter,
		query.Limit,
	)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.Journeys(r.Context(), site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard journeys failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load journeys"})
		return
	}
	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func retentionQueryFromRequest(r *http.Request) storage.RetentionQuery {
	query := storage.RetentionQuery{
		Cadence:       strings.TrimSpace(r.URL.Query().Get("cadence")),
		DeviceFilter:  strings.TrimSpace(r.URL.Query().Get("device")),
		CountryFilter: strings.TrimSpace(r.URL.Query().Get("country")),
	}
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		if parsedLimit, parseErr := strconv.Atoi(rawLimit); parseErr == nil {
			query.Limit = parsedLimit
		}
	}
	return query
}

func (s *Server) handleDashboardRetention(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	query := retentionQueryFromRequest(r)
	cacheKey := fmt.Sprintf("retention:%s:%s:%s:%s:%s:%d", site.ID, rangeValue, query.Cadence, query.DeviceFilter, query.CountryFilter, query.Limit)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.RetentionReport(r.Context(), site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard retention failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load retention"})
		return
	}
	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardRetentionTrend(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	query := retentionQueryFromRequest(r)
	cacheKey := fmt.Sprintf("retention-trend:%s:%s:%s:%s:%s", site.ID, rangeValue, query.Cadence, query.DeviceFilter, query.CountryFilter)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.RetentionTrend(r.Context(), site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard retention trend failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load retention trend"})
		return
	}
	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardHeatmap(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	mode := storage.ParseHeatmapMode(r.URL.Query().Get("mode"))
	clickFilter := storage.ParseHeatmapClickFilter(r.URL.Query().Get("clickFilter"))
	viewportSegment := storage.ParseHeatmapViewportSegment(r.URL.Query().Get("viewport"))
	cacheKey := fmt.Sprintf("heatmap:%s:%s:%s:%s:%s:%s", site.ID, rangeValue, r.URL.Query().Get("path"), mode, clickFilter, viewportSegment)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.Heatmap(
		r.Context(),
		site.ID,
		r.URL.Query().Get("path"),
		rangeValue,
		mode,
		clickFilter,
		viewportSegment,
		time.Now().UTC(),
	)
	if err != nil {
		s.logger.Error("dashboard heatmap failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load heatmap"})
		return
	}
	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardReplays(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.replay == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "replay storage is not configured"})
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
	cacheKey := fmt.Sprintf("replays:%s:%s", site.ID, rangeValue)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}
	replays, err := s.replay.ReplaySessions(r.Context(), site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard replays failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load replays"})
		return
	}
	if payload, err := json.Marshal(replays); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, replays)
}

func (s *Server) handleDashboardReplay(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.replay == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "replay storage is not configured"})
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

	sessionID := strings.TrimSpace(r.URL.Query().Get("session"))
	if sessionID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session is required"})
		return
	}
	cacheKey := fmt.Sprintf("replay:%s:%s", site.ID, sessionID)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	replay, err := s.replay.ReplaySession(r.Context(), site.ID, sessionID)
	if err != nil {
		s.logger.Error("dashboard replay detail failed", "site_id", site.ID, "session_id", sessionID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load replay"})
		return
	}
	if strings.TrimSpace(replay.Session.SessionID) == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "replay session not found"})
		return
	}
	if payload, err := json.Marshal(replay); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, replay)
}

func (s *Server) handleDashboardAIInsights(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	cacheKey := fmt.Sprintf("ai-insight:%s:%s", site.ID, rangeValue)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}
	now := time.Now().UTC()
	ruleView, err := s.dashboard.Insights(r.Context(), site.ID, rangeValue, now)
	if err != nil {
		s.logger.Error("dashboard ai insight rules failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load ai insights"})
		return
	}

	summaryView, err := s.dashboard.DashboardSummary(r.Context(), site.ID, rangeValue, now)
	if err != nil {
		s.logger.Error("dashboard ai insight summary failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load ai insights"})
		return
	}

	ruleFlags := buildRuleFlags(ruleView.Items)
	heatmapSummaries := s.collectAIHeatmapSummaries(r.Context(), site.ID, summaryView, rangeValue, now)
	eventPatterns := []aiinsights.EventPattern{}
	if eventView, eventErr := s.dashboard.EventExplorer(r.Context(), site.ID, storage.EventExplorerQuery{}, rangeValue, now); eventErr == nil {
		eventPatterns = summarizeAIEventPatterns(eventView)
	}
	journeysDigest := aiinsights.JourneyDigest{}
	confidenceNotes := []string{
		fmt.Sprintf("Insight items are built from aggregated site data across a %s window.", rangeValue.String()),
	}
	freshnessNotes := []string{}
	if journeysView, journeysErr := s.dashboard.Journeys(r.Context(), site.ID, storage.JourneyQuery{Limit: 6}, rangeValue, now); journeysErr == nil {
		journeysDigest = aiinsights.JourneyDigest{
			Sessions:     journeysView.Summary.Sessions,
			TopPathShare: journeysView.Summary.TopPathShare,
			CommonPaths:  limitJourneyPaths(journeysView.CommonPaths, 4),
			EntryPages:   limitJourneyDistribution(journeysView.EntryDistribution, 4),
			ExitPages:    limitJourneyDistribution(journeysView.ExitDistribution, 4),
		}
		confidenceNotes = append(confidenceNotes, fmt.Sprintf("Journey model includes %d sessions and %d clustered paths.", journeysView.Summary.Sessions, journeysView.Summary.UniqueCommonPaths))
	}
	retentionDigest := aiinsights.RetentionDigest{}
	if retentionTrend, retentionErr := s.dashboard.RetentionTrend(r.Context(), site.ID, storage.RetentionQuery{Cadence: string(storage.RetentionCadenceWeekly)}, rangeValue, now); retentionErr == nil {
		retentionDigest = aiinsights.RetentionDigest{
			Users:          retentionTrend.Summary.Users,
			Cohorts:        retentionTrend.Summary.Cohorts,
			Day1Rate:       retentionTrend.Summary.Day1Rate,
			Day7Rate:       retentionTrend.Summary.Day7Rate,
			Day14Rate:      retentionTrend.Summary.Day14Rate,
			Day30Rate:      retentionTrend.Summary.Day30Rate,
			Confidence:     retentionTrend.Summary.Confidence,
			ConfidenceText: retentionTrend.Summary.ConfidenceText,
		}
		confidenceNotes = append(confidenceNotes, fmt.Sprintf("Retention confidence is %.1f (%s).", retentionTrend.Summary.Confidence, retentionTrend.Summary.ConfidenceText))
	}
	for _, heatmap := range heatmapSummaries {
		if strings.TrimSpace(heatmap.LowEngagementAt) != "" {
			freshnessNotes = append(freshnessNotes, fmt.Sprintf("%s has lower engagement concentration around %s.", heatmap.Path, heatmap.LowEngagementAt))
		}
	}
	snapshot := aiInsightSnapshot{
		SiteID:             site.ID,
		Range:              rangeValue.String(),
		Overview:           summaryView.Overview,
		OverviewComparison: summaryView.OverviewComparison,
		Derived:            summaryView.Derived,
		TopPages:           slices.Clone(summaryView.TopPages),
		ScrollFunnel:       slices.Clone(summaryView.ScrollFunnel),
		Referrers:          slices.Clone(summaryView.Referrers),
		Devices:            slices.Clone(summaryView.Devices),
		Browsers:           slices.Clone(summaryView.Browsers),
		OperatingSystems:   slices.Clone(summaryView.OperatingSystems),
		Heatmaps:           slices.Clone(heatmapSummaries),
		EventPatterns:      slices.Clone(eventPatterns),
		Journeys:           journeysDigest,
		Retention:          retentionDigest,
		ConfidenceNotes:    slices.Clone(confidenceNotes),
		FreshnessNotes:     slices.Clone(freshnessNotes),
	}

	mergedItems := convertRuleItems(ruleView.Items)
	aiItemCount := 0
	engineMode := "rules_only"
	provider := strings.TrimSpace(s.cfg.AIInsightsProvider)
	if provider == "" {
		provider = "longcat"
	}
	model := strings.TrimSpace(s.cfg.AIInsightsModel)

	audit := aiinsights.Audit{
		Enabled:           false,
		Provider:          provider,
		Model:             model,
		PromptVersion:     "ai-insights-v2",
		ZeroRetention:     s.cfg.AIInsightsZeroRetention,
		FieldsSent:        []string{"overview", "overviewComparison", "derived", "topPages", "scrollFunnel", "referrers", "devices", "browsers", "operatingSystems", "heatmaps", "eventPatterns", "journeys", "retention", "ruleFlags", "confidenceNotes", "freshnessNotes", "range", "siteId"},
		FieldsExcluded:    []string{"raw events", "session replay", "visitor identifiers", "IP", "cookies", "full DOM", "form text", "free text content"},
		FallbackActivated: true,
		Error:             aiinsights.ErrDisabled.Error(),
	}
	analysis := fallbackAIInsightAnalysis(summaryView, mergedItems, journeysDigest, retentionDigest)
	actions := fallbackAIInsightActions(mergedItems)
	pageOpportunities := fallbackAIInsightOpportunities(mergedItems)

	if s.aiInsights != nil && s.aiInsights.Enabled() {
		aiResult, aiErr := s.aiInsights.Generate(r.Context(), aiinsights.Request{
			SiteID:             site.ID,
			Range:              rangeValue.String(),
			Overview:           summaryView.Overview,
			OverviewComparison: summaryView.OverviewComparison,
			Derived:            summaryView.Derived,
			TopPages:           summaryView.TopPages,
			ScrollFunnel:       summaryView.ScrollFunnel,
			Referrers:          summaryView.Referrers,
			Devices:            summaryView.Devices,
			Browsers:           summaryView.Browsers,
			OperatingSystems:   summaryView.OperatingSystems,
			Heatmaps:           heatmapSummaries,
			EventPatterns:      eventPatterns,
			Journeys:           journeysDigest,
			Retention:          retentionDigest,
			RuleFlags:          ruleFlags,
			ConfidenceNotes:    confidenceNotes,
			FreshnessNotes:     freshnessNotes,
		})
		audit = aiResult.Audit
		if strings.TrimSpace(audit.Provider) != "" {
			provider = strings.TrimSpace(audit.Provider)
		}
		if strings.TrimSpace(audit.Model) != "" {
			model = strings.TrimSpace(audit.Model)
		}

		if aiErr != nil {
			s.logger.Error("dashboard ai insight generation failed", "site_id", site.ID, "error", aiErr)
		} else {
			aiItems := convertAIItems(aiResult.Items)
			aiItemCount = len(aiItems)
			if aiItemCount > 0 {
				engineMode = "ai_plus_rules"
			}
			if strings.TrimSpace(aiResult.Analysis.Narrative) != "" {
				analysis = aiInsightAnalysis{
					Narrative:  strings.TrimSpace(aiResult.Analysis.Narrative),
					Confidence: strings.TrimSpace(aiResult.Analysis.Confidence),
					Evidence:   strings.TrimSpace(aiResult.Analysis.Evidence),
				}
			}
			if len(aiResult.Actions) > 0 {
				actions = convertAIActions(aiResult.Actions)
			}
			if len(aiResult.PageOpportunities) > 0 {
				pageOpportunities = convertAIPageOpportunities(aiResult.PageOpportunities)
			}
			mergedItems = mergeAIInsightItems(mergedItems, aiItems, 12)
		}
	}

	mergedSummary := summarizeAIInsightItems(mergedItems)
	response := aiInsightsResponse{
		Range:       rangeValue.String(),
		GeneratedAt: now.Format(time.RFC3339),
		Engine: aiInsightsEngine{
			Mode:        engineMode,
			Provider:    provider,
			Model:       model,
			RuleCount:   len(ruleView.Items),
			AIItemCount: aiItemCount,
		},
		Summary:           mergedSummary,
		Analysis:          analysis,
		Actions:           actions,
		PageOpportunities: pageOpportunities,
		Items:             mergedItems,
		Pages:             slices.Clone(ruleView.Pages),
		RuleFlags:         ruleFlags,
		Snapshot:          snapshot,
		Audit:             audit,
	}
	if payload, err := json.Marshal(response); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleDashboardRealtime(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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

	w.Header().Set("Deprecation", "true")
	w.Header().Set("Link", "</api/v1/dashboard/events/explorer>; rel=\"successor-version\"")
	writeJSON(w, http.StatusOK, dashboardRealtimeResponse{
		Visitors: s.currentRealtimeVisitors(site.ID),
	})
}

func (s *Server) handleDashboardExport(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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

	kind := strings.TrimSpace(r.PathValue("kind"))
	format := strings.TrimSpace(strings.ToLower(r.URL.Query().Get("format")))
	if format == "" {
		format = "json"
	}
	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))

	switch kind {
	case "summary":
		summary, err := s.dashboard.DashboardSummary(r.Context(), site.ID, rangeValue, time.Now().UTC())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to export summary"})
			return
		}
		summary.Overview.RealtimeVisitors = s.currentRealtimeVisitors(site.ID)
		s.writeExport(w, format, fmt.Sprintf("summary-%s", rangeValue), summary, writeSummaryCSV)
	case "events":
		if s.export == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "event export is not configured"})
			return
		}
		events, err := s.export.ExportEvents(r.Context(), site.ID, rangeValue, time.Now().UTC())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to export events"})
			return
		}
		s.writeExport(w, format, fmt.Sprintf("events-%s", rangeValue), events, writeEventsCSV)
	case "heatmap":
		view, err := s.dashboard.Heatmap(
			r.Context(),
			site.ID,
			r.URL.Query().Get("path"),
			rangeValue,
			storage.ParseHeatmapMode(r.URL.Query().Get("mode")),
			storage.ParseHeatmapClickFilter(r.URL.Query().Get("clickFilter")),
			storage.ParseHeatmapViewportSegment(r.URL.Query().Get("viewport")),
			time.Now().UTC(),
		)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to export heatmap"})
			return
		}
		s.writeExport(w, format, fmt.Sprintf("heatmap-%s", rangeValue), view, writeHeatmapCSV)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown export kind"})
	}
}

func (s *Server) handleDashboardFunnel(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	payload := storage.FunnelQuery{}
	if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if len(payload.Steps) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "at least two funnel steps are required"})
		return
	}
	if len(payload.Steps) > 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "funnel supports up to eight steps"})
		return
	}
	if payload.WindowMinutes < 0 || payload.WindowMinutes > 1440 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "windowMinutes must be between 0 and 1440"})
		return
	}

	for index, step := range payload.Steps {
		if strings.TrimSpace(step.Value) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d is missing a value", index+1)})
			return
		}

		kind := storage.ParseFunnelStepKind(step.Kind)
		matchType := storage.ParseFunnelStepMatchType(step.MatchType)
		if kind == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d has an unsupported kind", index+1)})
			return
		}
		if matchType == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d has an unsupported matchType", index+1)})
			return
		}
	}

	if mode := storage.ParseFunnelCountMode(payload.CountMode); mode == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "countMode must be sessions or visitors"})
		return
	}

	report, err := s.dashboard.FunnelReport(r.Context(), site.ID, payload, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard funnel failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load funnel"})
		return
	}

	writeJSON(w, http.StatusOK, report)
}

func (s *Server) handleDashboardFunnelEntities(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	stepIndex, parseErr := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("step")))
	if parseErr != nil || stepIndex < 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "step must be a zero-based index"})
		return
	}

	status := storage.ParseFunnelEntityStatus(r.URL.Query().Get("status"))
	page := 1
	if rawPage := strings.TrimSpace(r.URL.Query().Get("page")); rawPage != "" {
		parsedPage, err := strconv.Atoi(rawPage)
		if err != nil || parsedPage < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "page must be a positive integer"})
			return
		}
		page = parsedPage
	}

	limit := 12
	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		parsedLimit, err := strconv.Atoi(rawLimit)
		if err != nil || parsedLimit < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "limit must be a positive integer"})
			return
		}
		limit = parsedLimit
	}

	payload := storage.FunnelQuery{}
	if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	if len(payload.Steps) < 2 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "at least two funnel steps are required"})
		return
	}
	if len(payload.Steps) > 8 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "funnel supports up to eight steps"})
		return
	}
	if stepIndex >= len(payload.Steps) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "step is outside the funnel definition"})
		return
	}
	if status == storage.FunnelEntityStatusDropped && stepIndex == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "the first funnel step cannot have dropped entities"})
		return
	}
	if payload.WindowMinutes < 0 || payload.WindowMinutes > 1440 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "windowMinutes must be between 0 and 1440"})
		return
	}

	for index, step := range payload.Steps {
		if strings.TrimSpace(step.Value) == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d is missing a value", index+1)})
			return
		}

		kind := storage.ParseFunnelStepKind(step.Kind)
		matchType := storage.ParseFunnelStepMatchType(step.MatchType)
		if kind == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d has an unsupported kind", index+1)})
			return
		}
		if matchType == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": fmt.Sprintf("step %d has an unsupported matchType", index+1)})
			return
		}
	}

	if mode := storage.ParseFunnelCountMode(payload.CountMode); mode == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "countMode must be sessions or visitors"})
		return
	}

	entities, err := s.dashboard.FunnelEntities(
		r.Context(),
		site.ID,
		payload,
		stepIndex,
		status,
		page,
		limit,
		rangeValue,
		time.Now().UTC(),
	)
	if err != nil {
		s.logger.Error("dashboard funnel entities failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load funnel entities"})
		return
	}

	writeJSON(w, http.StatusOK, entities)
}

func (s *Server) handleDashboardEventNames(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	cacheKey := fmt.Sprintf("events:%s:%s", site.ID, rangeValue)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	events, err := s.dashboard.EventNames(r.Context(), site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard event names failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load event names"})
		return
	}

	if payload, err := json.Marshal(events); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}

	writeJSON(w, http.StatusOK, events)
}

func (s *Server) handleDashboardEventExplorer(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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
	query := storage.EventExplorerQuery{
		Path: strings.TrimSpace(r.URL.Query().Get("path")),
	}
	cacheKey := fmt.Sprintf("events-explorer:%s:%s:%s", site.ID, rangeValue, query.Path)
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.dashboard.EventExplorer(r.Context(), site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard event explorer failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load event explorer"})
		return
	}

	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}

	writeJSON(w, http.StatusOK, view)
}

func buildRuleFlags(items []storage.InsightItem) []aiinsights.RuleFlag {
	flags := make([]aiinsights.RuleFlag, 0, len(items))
	for _, item := range items {
		flags = append(flags, aiinsights.RuleFlag{
			Severity: normalizeInsightSeverity(item.Severity, item.Score),
			Category: strings.TrimSpace(item.Category),
			Path:     strings.TrimSpace(item.Path),
			Reason:   strings.TrimSpace(item.Finding),
			Evidence: strings.TrimSpace(item.Evidence),
			Score:    item.Score,
		})
	}

	slices.SortFunc(flags, func(a, b aiinsights.RuleFlag) int {
		switch {
		case insightSeverityRank(a.Severity) != insightSeverityRank(b.Severity):
			return insightSeverityRank(a.Severity) - insightSeverityRank(b.Severity)
		case a.Score != b.Score:
			return b.Score - a.Score
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	if len(flags) > 12 {
		return flags[:12]
	}
	return flags
}

func convertRuleItems(items []storage.InsightItem) []aiInsightItem {
	converted := make([]aiInsightItem, 0, len(items))
	for _, item := range items {
		problem := strings.TrimSpace(item.Title)
		impact := strings.TrimSpace(item.Finding)
		fix := strings.TrimSpace(item.Recommendation)
		if problem == "" {
			problem = impact
		}
		if problem == "" && fix == "" {
			continue
		}

		converted = append(converted, aiInsightItem{
			Severity:       normalizeInsightSeverity(item.Severity, item.Score),
			Category:       strings.TrimSpace(item.Category),
			Path:           normalizeInsightPath(item.Path),
			Title:          strings.TrimSpace(item.Title),
			Problem:        problem,
			Impact:         impact,
			Fix:            fix,
			Finding:        strings.TrimSpace(item.Finding),
			Recommendation: strings.TrimSpace(item.Recommendation),
			Evidence:       strings.TrimSpace(item.Evidence),
			Score:          clampInsightScore(item.Score),
			Source:         "rules",
		})
	}
	return converted
}

func convertAIItems(items []aiinsights.Item) []aiInsightItem {
	converted := make([]aiInsightItem, 0, len(items))
	for _, item := range items {
		severity := normalizeInsightSeverity(item.Severity, item.Score)
		score := clampInsightScore(item.Score)
		problem := strings.TrimSpace(item.Problem)
		impact := strings.TrimSpace(item.Impact)
		fix := strings.TrimSpace(item.Fix)
		if problem == "" && impact == "" && fix == "" {
			continue
		}
		if score == 0 {
			switch severity {
			case "critical":
				score = 85
			case "warning":
				score = 65
			default:
				score = 45
			}
		}

		converted = append(converted, aiInsightItem{
			Severity:       severity,
			Category:       strings.TrimSpace(item.Category),
			Path:           normalizeInsightPath(item.Path),
			Title:          strings.TrimSpace(item.Title),
			Problem:        problem,
			Impact:         impact,
			Fix:            fix,
			Finding:        problem,
			Recommendation: fix,
			Evidence:       strings.TrimSpace(item.Evidence),
			Score:          score,
			Source:         "ai",
		})
	}
	return converted
}

func convertAIActions(actions []aiinsights.Action) []aiInsightAction {
	converted := make([]aiInsightAction, 0, len(actions))
	for _, action := range actions {
		title := strings.TrimSpace(action.Title)
		if title == "" {
			continue
		}
		priority := strings.TrimSpace(strings.ToLower(action.Priority))
		if priority != "high" && priority != "medium" {
			priority = "low"
		}
		converted = append(converted, aiInsightAction{
			Title:          title,
			Priority:       priority,
			ExpectedImpact: strings.TrimSpace(action.ExpectedImpact),
			Path:           normalizeInsightPath(action.Path),
			Evidence:       strings.TrimSpace(action.Evidence),
		})
	}
	return converted
}

func convertAIPageOpportunities(items []aiinsights.PageOpportunity) []aiInsightOpportunity {
	converted := make([]aiInsightOpportunity, 0, len(items))
	for _, item := range items {
		title := strings.TrimSpace(item.Title)
		if title == "" {
			continue
		}
		converted = append(converted, aiInsightOpportunity{
			Path:           normalizeInsightPath(item.Path),
			Title:          title,
			Opportunity:    strings.TrimSpace(item.Opportunity),
			Recommendation: strings.TrimSpace(item.Recommendation),
			Evidence:       strings.TrimSpace(item.Evidence),
		})
	}
	return converted
}

func fallbackAIInsightAnalysis(
	summary storage.DashboardSummary,
	items []aiInsightItem,
	journeys aiinsights.JourneyDigest,
	retention aiinsights.RetentionDigest,
) aiInsightAnalysis {
	if len(items) == 0 {
		return aiInsightAnalysis{
			Narrative:  "Traffic is active, but the current signal set does not show a dominant issue cluster yet.",
			Confidence: "Baseline confidence",
			Evidence:   fmt.Sprintf("%d sessions analysed with %.1f%% bounce rate.", summary.Overview.Sessions, summary.Overview.BounceRate),
		}
	}

	topItem := items[0]
	narrative := fmt.Sprintf(
		"Primary friction is clustering around %s on %s. The biggest opportunities are to reduce bounce, improve interaction quality, and strengthen follow-through on the paths users reach most often.",
		topItem.Category,
		topItem.Path,
	)
	confidence := fmt.Sprintf(
		"Journey share %.1f%% and retention day 7 %.1f%% provide moderate confidence.",
		journeys.TopPathShare,
		retention.Day7Rate,
	)
	evidence := strings.TrimSpace(topItem.Evidence)
	if evidence == "" {
		evidence = fmt.Sprintf("Sessions: %d, bounce rate: %.1f%%, rage clicks: %d.", summary.Overview.Sessions, summary.Overview.BounceRate, summary.Overview.RageClicks)
	}
	return aiInsightAnalysis{
		Narrative:  narrative,
		Confidence: confidence,
		Evidence:   evidence,
	}
}

func fallbackAIInsightActions(items []aiInsightItem) []aiInsightAction {
	actions := make([]aiInsightAction, 0, minInt(4, len(items)))
	for index, item := range items {
		if index >= 4 {
			break
		}
		priority := "low"
		switch item.Severity {
		case "critical":
			priority = "high"
		case "warning":
			priority = "medium"
		}
		actions = append(actions, aiInsightAction{
			Title:          firstNonEmpty(item.Title, item.Category),
			Priority:       priority,
			ExpectedImpact: firstNonEmpty(item.Impact, item.Finding),
			Path:           normalizeInsightPath(item.Path),
			Evidence:       strings.TrimSpace(item.Evidence),
		})
	}
	return actions
}

func fallbackAIInsightOpportunities(items []aiInsightItem) []aiInsightOpportunity {
	opportunities := make([]aiInsightOpportunity, 0, minInt(4, len(items)))
	seenPaths := map[string]struct{}{}
	for _, item := range items {
		path := normalizeInsightPath(item.Path)
		if path == "" || path == "All pages" {
			continue
		}
		if _, ok := seenPaths[path]; ok {
			continue
		}
		seenPaths[path] = struct{}{}
		opportunities = append(opportunities, aiInsightOpportunity{
			Path:           path,
			Title:          firstNonEmpty(item.Title, item.Category),
			Opportunity:    firstNonEmpty(item.Finding, item.Problem),
			Recommendation: firstNonEmpty(item.Recommendation, item.Fix),
			Evidence:       strings.TrimSpace(item.Evidence),
		})
		if len(opportunities) >= 4 {
			break
		}
	}
	return opportunities
}

func summarizeAIEventPatterns(view storage.EventExplorerView) []aiinsights.EventPattern {
	patterns := make([]aiinsights.EventPattern, 0, minInt(5, len(view.Catalog)))
	for _, entry := range view.Catalog {
		topPages := make([]string, 0, minInt(3, len(entry.TopPages)))
		for _, page := range entry.TopPages {
			topPages = append(topPages, strings.TrimSpace(page.Label))
			if len(topPages) >= 3 {
				break
			}
		}
		topDevices := make([]string, 0, minInt(2, len(entry.TopDevices)))
		for _, device := range entry.TopDevices {
			topDevices = append(topDevices, strings.TrimSpace(device.Label))
			if len(topDevices) >= 2 {
				break
			}
		}
		topCountries := make([]string, 0, minInt(2, len(entry.TopCountries)))
		for _, country := range entry.TopCountries {
			topCountries = append(topCountries, strings.TrimSpace(country.Label))
			if len(topCountries) >= 2 {
				break
			}
		}
		patterns = append(patterns, aiinsights.EventPattern{
			Name:            strings.TrimSpace(entry.Name),
			Family:          strings.TrimSpace(entry.Family),
			Count:           entry.Count,
			Trend:           entry.Trend,
			ConfidenceScore: int(entry.ConfidenceScore),
			TopPages:        topPages,
			TopDevices:      topDevices,
			TopCountries:    topCountries,
		})
		if len(patterns) >= 5 {
			break
		}
	}
	return patterns
}

func limitJourneyPaths(paths []storage.JourneyPath, limit int) []string {
	output := make([]string, 0, minInt(limit, len(paths)))
	for _, path := range paths {
		output = append(output, strings.Join(path.Paths, " -> "))
		if len(output) >= limit {
			break
		}
	}
	return output
}

func limitJourneyDistribution(items []storage.JourneyDistributionItem, limit int) []string {
	output := make([]string, 0, minInt(limit, len(items)))
	for _, item := range items {
		output = append(output, strings.TrimSpace(item.Path))
		if len(output) >= limit {
			break
		}
	}
	return output
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func mergeAIInsightItems(ruleItems, aiItems []aiInsightItem, limit int) []aiInsightItem {
	merged := make([]aiInsightItem, 0, len(ruleItems)+len(aiItems))
	index := map[string]int{}

	appendItem := func(item aiInsightItem) {
		key := strings.ToLower(strings.TrimSpace(item.Path) + "|" + strings.TrimSpace(item.Category) + "|" + strings.TrimSpace(item.Title))
		if existingIndex, ok := index[key]; ok {
			existing := merged[existingIndex]
			if item.Score > existing.Score || (item.Source == "ai" && existing.Source != "ai") {
				merged[existingIndex] = item
			}
			return
		}
		index[key] = len(merged)
		merged = append(merged, item)
	}

	for _, item := range ruleItems {
		appendItem(item)
	}
	for _, item := range aiItems {
		appendItem(item)
	}

	slices.SortFunc(merged, func(a, b aiInsightItem) int {
		switch {
		case insightSeverityRank(a.Severity) != insightSeverityRank(b.Severity):
			return insightSeverityRank(a.Severity) - insightSeverityRank(b.Severity)
		case a.Score != b.Score:
			return b.Score - a.Score
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	if limit > 0 && len(merged) > limit {
		return merged[:limit]
	}
	return merged
}

func summarizeAIInsightItems(items []aiInsightItem) storage.InsightSummary {
	summary := storage.InsightSummary{Total: len(items)}
	for _, item := range items {
		switch normalizeInsightSeverity(item.Severity, item.Score) {
		case "critical":
			summary.Critical += 1
		case "warning":
			summary.Warning += 1
		default:
			summary.Info += 1
		}
	}
	return summary
}

func (s *Server) collectAIHeatmapSummaries(
	ctx context.Context,
	siteID string,
	summary storage.DashboardSummary,
	rangeValue storage.TimeRange,
	now time.Time,
) []aiinsights.HeatmapSummary {
	paths := make([]string, 0, 3)
	appendPath := func(path string) {
		normalized := strings.TrimSpace(path)
		if normalized == "" || slices.Contains(paths, normalized) {
			return
		}
		paths = append(paths, normalized)
	}

	for _, page := range summary.TopPages {
		appendPath(page.Path)
		if len(paths) >= 3 {
			break
		}
	}
	for _, page := range summary.Pages {
		appendPath(page.Path)
		if len(paths) >= 3 {
			break
		}
	}

	heatmaps := make([]aiinsights.HeatmapSummary, 0, len(paths))
	for _, path := range paths {
		view, err := s.dashboard.Heatmap(
			ctx,
			siteID,
			path,
			rangeValue,
			storage.HeatmapModeEngagement,
			storage.HeatmapClickFilterAll,
			storage.HeatmapViewportSegmentAll,
			now,
		)
		if err != nil {
			s.logger.Error("dashboard ai insight heatmap summary failed", "site_id", siteID, "path", path, "error", err)
			continue
		}
		heatmaps = append(heatmaps, summarizeHeatmapView(view))
	}

	return heatmaps
}

func summarizeHeatmapView(view storage.HeatmapView) aiinsights.HeatmapSummary {
	totalClicks := 0
	topLeft := 0
	topRight := 0
	bottomLeft := 0
	bottomRight := 0
	for _, bucket := range view.Buckets {
		totalClicks += bucket.Count
		switch {
		case bucket.X < 50 && bucket.Y < 50:
			topLeft += bucket.Count
		case bucket.X >= 50 && bucket.Y < 50:
			topRight += bucket.Count
		case bucket.X < 50 && bucket.Y >= 50:
			bottomLeft += bucket.Count
		default:
			bottomRight += bucket.Count
		}
	}

	toShare := func(value int) float64 {
		if totalClicks <= 0 {
			return 0
		}
		return float64(value) * 100 / float64(totalClicks)
	}

	scrollWeighted := 0
	scrollSessions := 0
	for _, step := range view.ScrollFunnel {
		scrollWeighted += step.Depth * step.Sessions
		scrollSessions += step.Sessions
	}
	avgScrollDepth := 0.0
	if scrollSessions > 0 {
		avgScrollDepth = float64(scrollWeighted) / float64(scrollSessions)
	}

	topSelectors := make([]aiinsights.SelectorSummary, 0, len(view.Selectors))
	for _, selector := range view.Selectors {
		topSelectors = append(topSelectors, aiinsights.SelectorSummary{
			Selector:   selector.Selector,
			Clicks:     selector.Clicks,
			RageClicks: selector.RageClicks,
			DeadClicks: selector.DeadClicks,
		})
		if len(topSelectors) >= 5 {
			break
		}
	}

	lowEngagementAt := ""
	bottomShare := toShare(bottomLeft + bottomRight)
	if totalClicks > 0 && bottomShare < 10 {
		lowEngagementAt = "below_fold"
	}

	return aiinsights.HeatmapSummary{
		Path:         view.Path,
		Clicks:       view.Totals.Clicks,
		RageClicks:   view.Totals.RageClicks,
		DeadClicks:   view.Totals.DeadClicks,
		ErrorClicks:  view.Totals.ErrorClicks,
		MoveEvents:   view.Totals.MoveEvents,
		ScrollEvents: view.Totals.ScrollEvents,
		TopSelectors: topSelectors,
		QuadrantShare: aiinsights.QuadrantShare{
			TopLeft:     toShare(topLeft),
			TopRight:    toShare(topRight),
			BottomLeft:  toShare(bottomLeft),
			BottomRight: toShare(bottomRight),
		},
		AvgScrollDepth:  avgScrollDepth,
		LowEngagementAt: lowEngagementAt,
	}
}

func normalizeInsightSeverity(value string, score int) string {
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

func insightSeverityRank(value string) int {
	switch normalizeInsightSeverity(value, 0) {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func clampInsightScore(value int) int {
	switch {
	case value < 0:
		return 0
	case value > 100:
		return 100
	default:
		return value
	}
}

func normalizeInsightPath(path string) string {
	value := strings.TrimSpace(path)
	if value == "" {
		return "All pages"
	}
	return value
}

func (s *Server) handleDashboardSettings(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
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

	stats, err := s.dashboard.SiteStats(r.Context(), site.ID)
	if err != nil {
		s.logger.Error("dashboard site stats failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load site settings"})
		return
	}

	writeJSON(w, http.StatusOK, dashboardSettingsResponse{
		Sites: s.dashboardSites(),
		Site: dashboardSite{
			ID:      site.ID,
			Name:    site.Name,
			Origins: slices.Clone(site.Origins),
		},
		TrackerSnippet: s.trackerSnippet(r, site),
		TrackerScript:  s.trackerScript(r, site),
		Privacy: dashboardPrivacy{
			DomSnapshotsEnabled:  site.DomSnapshotsEnabled,
			VisitorCookieEnabled: site.VisitorCookieEnabled,
		},
		Tracking: dashboardTracking{
			BlockBotTrafficEnabled:     site.BlockBotTrafficEnabled,
			DomSnapshotsEnabled:        site.DomSnapshotsEnabled,
			VisitorCookieEnabled:       site.VisitorCookieEnabled,
			ReplayMaskTextEnabled:      site.ReplayMaskTextEnabled,
			SPATrackingEnabled:         site.SPATrackingEnabled,
			ErrorTrackingEnabled:       site.ErrorTrackingEnabled,
			PerformanceTrackingEnabled: site.PerformanceTrackingEnabled,
		},
		Retention: dashboardRetention{
			EventsDays:   s.cfg.EventRetentionDays,
			HeatmapDays:  s.cfg.HeatmapRetentionDays,
			ReplayDays:   s.cfg.ReplayRetentionDays,
			InsightsDays: s.cfg.InsightRetentionDays,
		},
		ImportDefaults: dashboardImportDefaults{
			Mapping:  map[string]string{},
			Timezone: "UTC",
		},
		Stats: stats,
	})
}

func (s *Server) cacheBytes(key string) ([]byte, bool) {
	if s.responseCache == nil || strings.TrimSpace(key) == "" {
		return nil, false
	}
	return s.responseCache.Get(key)
}

func (s *Server) cacheBytesSet(key string, payload []byte) {
	if s.responseCache == nil || strings.TrimSpace(key) == "" || len(payload) == 0 {
		return
	}
	s.responseCache.Set(key, payload)
}

func (s *Server) currentRealtimeVisitors(siteID string) int {
	if s.realtime == nil {
		return 0
	}
	return s.realtime.Count(siteID)
}

func (s *Server) writeExport(
	w http.ResponseWriter,
	format string,
	baseName string,
	payload any,
	csvWriter func(*csv.Writer, any) error,
) {
	switch format {
	case "csv":
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.csv"`, baseName))
		writer := csv.NewWriter(w)
		if err := csvWriter(writer, payload); err != nil {
			writer.Flush()
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writer.Flush()
	default:
		raw, err := json.Marshal(payload)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.json"`, baseName))
		writeJSONBytes(w, http.StatusOK, raw)
	}
}

func writeSummaryCSV(writer *csv.Writer, value any) error {
	summary, ok := value.(storage.DashboardSummary)
	if !ok {
		return fmt.Errorf("invalid summary export payload")
	}

	records := [][]string{
		{"section", "metric", "value"},
		{"meta", "comparison_range", summary.ComparisonRange},
		{"overview", "realtime_visitors", fmt.Sprintf("%d", summary.Overview.RealtimeVisitors)},
		{"overview", "unique_visitors", fmt.Sprintf("%d", summary.Overview.UniqueVisitors)},
		{"overview", "pageviews", fmt.Sprintf("%d", summary.Overview.Pageviews)},
		{"overview", "sessions", fmt.Sprintf("%d", summary.Overview.Sessions)},
		{"overview", "bounce_rate", fmt.Sprintf("%.2f", summary.Overview.BounceRate)},
		{"overview", "avg_scroll_depth", fmt.Sprintf("%.2f", summary.Overview.AvgScrollDepth)},
		{"overview", "rage_clicks", fmt.Sprintf("%d", summary.Overview.RageClicks)},
		{"overview_comparison", "unique_visitors_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.UniqueVisitors.Delta)},
		{"overview_comparison", "pageviews_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.Pageviews.Delta)},
		{"overview_comparison", "sessions_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.Sessions.Delta)},
		{"overview_comparison", "bounce_rate_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.BounceRate.Delta)},
		{"overview_comparison", "avg_scroll_depth_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.AvgScrollDepth.Delta)},
		{"overview_comparison", "rage_clicks_delta", fmt.Sprintf("%.2f", summary.OverviewComparison.RageClicks.Delta)},
		{"derived", "engaged_sessions", fmt.Sprintf("%.2f", summary.Derived.EngagedSessions.Current)},
		{"derived", "returning_visitor_ratio", fmt.Sprintf("%.2f", summary.Derived.ReturningVisitorRatio.Ratio.Current)},
		{"derived", "friction_score", fmt.Sprintf("%.2f", summary.Derived.FrictionScore.Current)},
		{"derived", "referrer_quality_score", fmt.Sprintf("%.2f", summary.Derived.ReferrerQualityScore.Current)},
		{"derived", "page_focus_score", fmt.Sprintf("%.2f", summary.Derived.PageFocusScore.Current)},
		{"derived", "session_duration_seconds", fmt.Sprintf("%.2f", summary.Derived.SessionDuration.Current)},
	}
	for _, row := range summary.Timeseries {
		records = append(records, []string{"timeseries", row.Timestamp, fmt.Sprintf("%d", row.Pageviews), fmt.Sprintf("%d", row.Sessions)})
	}
	for _, row := range summary.TopPages {
		records = append(records, []string{
			"top_page",
			row.Path,
			fmt.Sprintf("%d", row.Pageviews),
			fmt.Sprintf("%d", row.Sessions),
			fmt.Sprintf("%.2f", row.AvgScrollDepth),
			fmt.Sprintf("%d", row.RageClicks),
			fmt.Sprintf("%d", row.DeadClicks),
			fmt.Sprintf("%.2f", row.FocusScore),
			fmt.Sprintf("%.2f", row.ConversionAssistScore),
		})
	}
	for _, row := range summary.Referrers {
		records = append(records, []string{
			"referrer",
			row.Source,
			fmt.Sprintf("%d", row.Pageviews),
			fmt.Sprintf("%d", row.Sessions),
			fmt.Sprintf("%d", row.EngagedSessions),
			fmt.Sprintf("%d", row.BounceSessions),
			fmt.Sprintf("%.2f", row.QualityScore),
		})
	}
	for _, row := range summary.Derived.TopPathMomentum {
		records = append(records, []string{
			"top_path_momentum",
			row.Path,
			fmt.Sprintf("%d", row.Pageviews),
			fmt.Sprintf("%d", row.PreviousPageviews),
			fmt.Sprintf("%d", row.DeltaPageviews),
			fmt.Sprintf("%.2f", row.GrowthVsPrevious),
		})
	}
	for _, row := range summary.Derived.ConversionAssist {
		records = append(records, []string{
			"conversion_assist",
			row.Path,
			fmt.Sprintf("%d", row.AssistedConversions),
			fmt.Sprintf("%.2f", row.ConversionShare),
		})
	}
	for _, row := range summary.Devices {
		records = append(records, []string{"device", row.Device, fmt.Sprintf("%d", row.Pageviews)})
	}
	for _, row := range summary.ScrollFunnel {
		records = append(records, []string{"scroll_funnel", fmt.Sprintf("%d", row.Depth), fmt.Sprintf("%d", row.Sessions)})
	}
	return writer.WriteAll(records)
}

func writeEventsCSV(writer *csv.Writer, value any) error {
	events, ok := value.([]storage.ExportEvent)
	if !ok {
		return fmt.Errorf("invalid events export payload")
	}

	records := [][]string{{"timestamp", "name", "path", "session_id", "x", "y", "selector", "depth"}}
	for _, event := range events {
		depth := ""
		if event.HasDepth {
			depth = fmt.Sprintf("%d", event.Depth)
		}
		x := ""
		if event.X != nil {
			x = fmt.Sprintf("%.2f", *event.X)
		}
		y := ""
		if event.Y != nil {
			y = fmt.Sprintf("%.2f", *event.Y)
		}
		records = append(records, []string{
			event.Timestamp,
			event.Name,
			event.Path,
			event.SessionID,
			x,
			y,
			event.Selector,
			depth,
		})
	}
	return writer.WriteAll(records)
}

func writeHeatmapCSV(writer *csv.Writer, value any) error {
	view, ok := value.(storage.HeatmapView)
	if !ok {
		return fmt.Errorf("invalid heatmap export payload")
	}

	records := [][]string{{"layer", "x", "y", "count", "weight", "sessions", "visitors", "rage_count", "dead_count", "error_count"}}
	for _, bucket := range view.Buckets {
		records = append(records, []string{
			"click",
			fmt.Sprintf("%.2f", bucket.X),
			fmt.Sprintf("%.2f", bucket.Y),
			fmt.Sprintf("%d", bucket.Count),
			fmt.Sprintf("%.2f", bucket.Weight),
			fmt.Sprintf("%d", bucket.Sessions),
			fmt.Sprintf("%d", bucket.Visitors),
			fmt.Sprintf("%d", bucket.RageCount),
			fmt.Sprintf("%d", bucket.DeadCount),
			fmt.Sprintf("%d", bucket.ErrorCount),
		})
	}
	for _, bucket := range view.MoveBuckets {
		records = append(records, []string{
			"move",
			fmt.Sprintf("%.2f", bucket.X),
			fmt.Sprintf("%.2f", bucket.Y),
			fmt.Sprintf("%d", bucket.Count),
			fmt.Sprintf("%.2f", bucket.Weight),
			fmt.Sprintf("%d", bucket.Sessions),
			fmt.Sprintf("%d", bucket.Visitors),
			fmt.Sprintf("%d", bucket.RageCount),
			fmt.Sprintf("%d", bucket.DeadCount),
			fmt.Sprintf("%d", bucket.ErrorCount),
		})
	}
	return writer.WriteAll(records)
}

func (s *Server) authorizeDashboard(w http.ResponseWriter, r *http.Request) bool {
	expectedTokens := []string{}
	for _, token := range []string{s.cfg.AnalyticsServiceToken, s.cfg.DashboardToken} {
		token = strings.TrimSpace(token)
		if token == "" || slices.Contains(expectedTokens, token) {
			continue
		}
		expectedTokens = append(expectedTokens, token)
	}

	if len(expectedTokens) == 0 {
		return true
	}

	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Dashboard-Token"))
	}

	if !slices.Contains(expectedTokens, token) {
		writeAPIError(w, errUnauthorized.WithMessage("Dashboard token required."))
		return false
	}
	return true
}

func (s *Server) authorizeAdmin(w http.ResponseWriter, r *http.Request) bool {
	expectedToken := strings.TrimSpace(s.cfg.AdminToken)
	if expectedToken == "" {
		writeAPIError(w, errUnauthorized.WithMessage("Admin token is not configured."))
		return false
	}

	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Admin-Token"))
	}
	if token != expectedToken {
		writeAPIError(w, errUnauthorized.WithMessage("Admin token required."))
		return false
	}
	return true
}

func (s *Server) dashboardSiteFromRequest(r *http.Request) (config.Site, bool, error) {
	siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("site"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("id"),
	))
	if siteID == "" {
		siteID = s.defaultSiteID()
	}
	if siteID == "" {
		return config.Site{}, false, nil
	}

	site, ok, err := s.sites.GetSite(r.Context(), siteID)
	if err != nil {
		s.logger.Warn("resolve dashboard site failed", "site_id", siteID, "error", err)
		return config.Site{}, false, err
	}
	if !ok {
		s.logger.Warn("dashboard site missing from registry", "site_id", siteID)
		return config.Site{}, false, nil
	}
	return site, true, nil
}

func (s *Server) defaultSiteID() string {
	sites := s.dashboardSites()
	if len(sites) == 0 {
		return ""
	}
	return sites[0].ID
}

func (s *Server) dashboardSites() []dashboardSite {
	available, err := s.sites.ListSites(context.Background())
	if err != nil {
		s.logger.Error("list dashboard sites failed", "error", err)
		return nil
	}

	sites := make([]dashboardSite, 0, len(available))
	for _, site := range available {
		sites = append(sites, dashboardSite{
			ID:      site.ID,
			Name:    site.Name,
			Origins: slices.Clone(site.Origins),
		})
	}

	slices.SortFunc(sites, func(a, b dashboardSite) int {
		return strings.Compare(a.ID, b.ID)
	})
	return sites
}

func (s *Server) trackerSnippet(r *http.Request, site config.Site) string {
	attrs := `data-site="%s"`
	if site.DomSnapshotsEnabled {
		attrs += ` data-snapshots="true"`
	}
	attrs += ` data-replay="true" data-replay-sample-rate="1"`
	attrs += ` data-spa="%t" data-errors="%t" data-performance="%t" data-replay-mask-text="%t"`
	return fmt.Sprintf(
		`<script defer src="%s" `+attrs+`></script>`,
		s.trackerScriptSrc(r, site),
		site.ID,
		site.SPATrackingEnabled,
		site.ErrorTrackingEnabled,
		site.PerformanceTrackingEnabled,
		site.ReplayMaskTextEnabled,
	)
}

func (s *Server) trackerCollectorOrigin(r *http.Request) string {
	origin := strings.TrimSpace(s.cfg.TrackerPublicOrigin)
	if origin == "" {
		origin = requestBaseURL(r)
	}
	return origin
}

func (s *Server) trackerScript(r *http.Request, site config.Site) trackerScriptBlock {
	collectorOrigin := strings.TrimRight(s.trackerCollectorOrigin(r), "/")
	installOrigin := requestBaseURL(r)
	if len(site.Origins) > 0 && strings.TrimSpace(site.Origins[0]) != "" {
		installOrigin = strings.TrimSpace(site.Origins[0])
	}
	src := s.trackerScriptSrc(r, site)
	return trackerScriptBlock{
		SiteID:          site.ID,
		InstallOrigin:   installOrigin,
		CollectorOrigin: collectorOrigin,
		ScriptSrc:       src,
		ScriptTag:       s.trackerSnippet(r, site),
		IsPersisted:     false,
		UpdatedAt:       nil,
	}
}

func (s *Server) trackerScriptSrc(r *http.Request, site config.Site) string {
	src := fmt.Sprintf("%s/t.js?id=%s", strings.TrimRight(s.trackerCollectorOrigin(r), "/"), url.QueryEscape(site.ID))
	src += "&replay=1"
	src += "&replay_sample=1"
	src += "&spa="
	if site.SPATrackingEnabled {
		src += "1"
	} else {
		src += "0"
	}
	src += "&err="
	if site.ErrorTrackingEnabled {
		src += "1"
	} else {
		src += "0"
	}
	src += "&perf="
	if site.PerformanceTrackingEnabled {
		src += "1"
	} else {
		src += "0"
	}
	src += "&replay_mask_text="
	if site.ReplayMaskTextEnabled {
		src += "1"
	} else {
		src += "0"
	}
	snapshotOrigin := strings.TrimRight(strings.TrimSpace(s.cfg.SnapshotPublicOrigin), "/")
	if !site.DomSnapshotsEnabled || snapshotOrigin == "" {
		return src
	}
	return src + "&snapshot_origin=" + url.QueryEscape(snapshotOrigin)
}

func requestBaseURL(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}

	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}

	return proto + "://" + host
}

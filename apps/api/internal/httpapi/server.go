package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/aiinsights"
	internalcache "anlticsheat/api/internal/cache"
	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/controlplane"
	"anlticsheat/api/internal/geo"
	"anlticsheat/api/internal/identity"
	"anlticsheat/api/internal/ingest"
	"anlticsheat/api/internal/metrics"
	"anlticsheat/api/internal/ratelimit"
	"anlticsheat/api/internal/realtime"
	"anlticsheat/api/internal/storage"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed assets/tracker.js
var trackerAsset []byte

const (
	visitorCookieName = "_vid"
	visitorCookieTTL  = 365 * 24 * time.Hour
	collectBodyLimit  = 128 << 10
	replayBodyLimit   = 8 << 20
)

type collectPayload struct {
	Events    []ingest.Event `json:"events"`
	StorageID string         `json:"storageId"`
	Reason    string         `json:"reason"`
}

type identityPayload struct {
	StorageID string `json:"storageId"`
}

type replaySessionPayload struct {
	SessionID           string                 `json:"sessionId"`
	SampleRate          float64                `json:"sampleRate"`
	StartedAt           string                 `json:"startedAt"`
	UpdatedAt           string                 `json:"updatedAt"`
	DurationMS          int                    `json:"durationMs"`
	EntryPath           string                 `json:"entryPath"`
	ExitPath            string                 `json:"exitPath"`
	PageCount           int                    `json:"pageCount"`
	RouteCount          int                    `json:"routeCount"`
	ChunkCount          int                    `json:"chunkCount"`
	EventCount          int                    `json:"eventCount"`
	ErrorCount          int                    `json:"errorCount"`
	ConsoleErrorCount   int                    `json:"consoleErrorCount"`
	NetworkFailureCount int                    `json:"networkFailureCount"`
	RageClickCount      int                    `json:"rageClickCount"`
	DeadClickCount      int                    `json:"deadClickCount"`
	CustomEventCount    int                    `json:"customEventCount"`
	DeviceType          string                 `json:"deviceType"`
	Browser             string                 `json:"browser"`
	OS                  string                 `json:"os"`
	Viewport            storage.ReplayViewport `json:"viewport"`
	Paths               []string               `json:"paths"`
}

type replayChunkPayload struct {
	Index      int                        `json:"index"`
	Reason     string                     `json:"reason"`
	StartedAt  string                     `json:"startedAt"`
	EndedAt    string                     `json:"endedAt"`
	Path       string                     `json:"path"`
	EventCount int                        `json:"eventCount"`
	Summary    storage.ReplayChunkSummary `json:"summary"`
	Events     json.RawMessage            `json:"events"`
}

type replayPayload struct {
	SiteID    string               `json:"siteId"`
	StorageID string               `json:"storageId"`
	Reason    string               `json:"reason"`
	Session   replaySessionPayload `json:"session"`
	Chunks    []replayChunkPayload `json:"chunks"`
}

type Server struct {
	cfg           config.Config
	sites         controlplane.SiteRegistry
	identity      *identity.Resolver
	geo           geo.Resolver
	ingestHealth  *ingest.HealthTracker
	batcher       ingest.BatchEnqueuer
	stats         storage.StatsProvider
	dashboard     storage.DashboardProvider
	users         storage.UsersProvider
	export        storage.ExportProvider
	replay        storage.ReplayProvider
	privacy       storage.PrivacyProvider
	errors        storage.ErrorProvider
	aiInsights    *aiinsights.Engine
	logger        *slog.Logger
	trackerETag   string
	limiter       *ratelimit.Limiter
	responseCache *internalcache.Cache
	realtime      *realtime.Counter
	metrics       *metrics.Metrics
	neonPool      *pgxpool.Pool
	statsLimiter  *ratelimit.Limiter
	clickhouse    *storage.ClickHouseStore
}

func New(
	cfg config.Config,
	sites controlplane.SiteRegistry,
	identityResolver *identity.Resolver,
	geoResolver geo.Resolver,
	batcher ingest.BatchEnqueuer,
	stats storage.StatsProvider,
	dashboard storage.DashboardProvider,
	export storage.ExportProvider,
	replay storage.ReplayProvider,
	privacy storage.PrivacyProvider,
	neonPool *pgxpool.Pool,
	metricRegistry *metrics.Metrics,
	logger *slog.Logger,
) *Server {
	if identityResolver == nil {
		identityResolver = identity.NewResolver(cfg.IdentityCacheSize, cfg.IdentityCacheTTL)
	}
	if geoResolver == nil {
		geoResolver = geo.NewResolver(cfg, logger)
	}
	if metricRegistry == nil {
		metricRegistry = metrics.New()
	}

	etag := sha256.Sum256(trackerAsset)
	server := &Server{
		cfg:          cfg,
		sites:        sites,
		identity:     identityResolver,
		geo:          geoResolver,
		ingestHealth: ingest.NewHealthTracker(),
		batcher:      batcher,
		stats:        stats,
		dashboard:    dashboard,
		users:        nil,
		export:       export,
		replay:       replay,
		privacy:      privacy,
		aiInsights:   aiinsights.New(cfg),
		logger:       logger,
		trackerETag:  `"` + hex.EncodeToString(etag[:]) + `"`,
		limiter: ratelimit.New(
			cfg.RateLimitPerSite,
			cfg.RateLimitBurst,
			cfg.RateLimitInterval,
			cfg.RateLimitTrackedSites,
		),
		responseCache: internalcache.NewCache(cfg.CacheMaxEntries, cfg.CacheTTL),
		realtime:      realtime.NewCounter(5*time.Minute, 50000),
		metrics:       metricRegistry,
		neonPool:      neonPool,
		statsLimiter:  ratelimit.New(60, 0, time.Minute, 10000),
	}
	if clickhouseStore, ok := dashboard.(*storage.ClickHouseStore); ok {
		server.clickhouse = clickhouseStore
	}
	if usersProvider, ok := dashboard.(storage.UsersProvider); ok {
		server.users = usersProvider
	}
	if errorProvider, ok := dashboard.(storage.ErrorProvider); ok {
		server.errors = errorProvider
	}
	server.metrics.SetQueueDepthFunc(server.batcher.QueueDepth)
	server.metrics.SetIdentityCacheSizeFunc(server.identity.Len)
	server.metrics.SetCacheEntriesFunc(server.responseCache.Len)
	server.metrics.SetRealtimeVisitorsFunc(server.currentRealtimeVisitors, server.metricSiteIDs)
	return server
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.handleHealth)
	mux.HandleFunc("GET /metrics", s.handleMetrics)
	mux.HandleFunc("GET /api/v1/dashboard/context", s.handleDashboardContext)
	mux.HandleFunc("GET /api/v1/dashboard/summary", s.handleDashboardSummary)
	mux.HandleFunc("GET /api/v1/dashboard/map", s.handleDashboardMap)
	mux.HandleFunc("GET /api/v1/dashboard/journeys", s.handleDashboardJourneys)
	mux.HandleFunc("GET /api/v1/dashboard/retention", s.handleDashboardRetention)
	mux.HandleFunc("GET /api/v1/dashboard/retention/trend", s.handleDashboardRetentionTrend)
	mux.HandleFunc("POST /api/v1/dashboard/funnel", s.handleDashboardFunnel)
	mux.HandleFunc("POST /api/v1/dashboard/funnel/entities", s.handleDashboardFunnelEntities)
	mux.HandleFunc("GET /api/v1/dashboard/users", s.handleDashboardUsers)
	mux.HandleFunc("GET /api/v1/dashboard/users/{userHash}", s.handleDashboardUserDetail)
	mux.HandleFunc("GET /api/v1/dashboard/segments", s.handleDashboardSegments)
	mux.HandleFunc("POST /api/v1/dashboard/segments", s.handleDashboardSegments)
	mux.HandleFunc("POST /api/v1/dashboard/segments/preview", s.handleDashboardSegmentPreview)
	mux.HandleFunc("GET /api/v1/dashboard/segments/{segmentId}", s.handleDashboardSegmentByID)
	mux.HandleFunc("PUT /api/v1/dashboard/segments/{segmentId}", s.handleDashboardSegmentByID)
	mux.HandleFunc("DELETE /api/v1/dashboard/segments/{segmentId}", s.handleDashboardSegmentByID)
	mux.HandleFunc("GET /api/v1/dashboard/segments/{segmentId}/members", s.handleDashboardSegmentMembers)
	mux.HandleFunc("POST /api/v1/dashboard/cohorts/report", s.handleDashboardCohortReport)
	mux.HandleFunc("GET /api/v1/dashboard/alerts", s.handleDashboardAlerts)
	mux.HandleFunc("POST /api/v1/dashboard/alerts", s.handleDashboardAlerts)
	mux.HandleFunc("GET /api/v1/dashboard/alerts/{alertId}", s.handleDashboardAlertByID)
	mux.HandleFunc("PUT /api/v1/dashboard/alerts/{alertId}", s.handleDashboardAlertByID)
	mux.HandleFunc("DELETE /api/v1/dashboard/alerts/{alertId}", s.handleDashboardAlertByID)
	mux.HandleFunc("GET /api/v1/dashboard/alerts/{alertId}/history", s.handleDashboardAlertHistory)
	mux.HandleFunc("GET /api/v1/dashboard/integrations", s.handleDashboardIntegrations)
	mux.HandleFunc("POST /api/v1/dashboard/integrations", s.handleDashboardIntegrations)
	mux.HandleFunc("POST /api/v1/dashboard/integrations/{integrationId}/reconnect", s.handleDashboardIntegrationAction)
	mux.HandleFunc("POST /api/v1/dashboard/integrations/{integrationId}/rotate", s.handleDashboardIntegrationAction)
	mux.HandleFunc("POST /api/v1/dashboard/integrations/{integrationId}/disconnect", s.handleDashboardIntegrationAction)
	mux.HandleFunc("GET /api/v1/dashboard/events", s.handleDashboardEventNames)
	mux.HandleFunc("GET /api/v1/dashboard/events/explorer", s.handleDashboardEventExplorer)
	mux.HandleFunc("GET /api/v1/dashboard/heatmap", s.handleDashboardHeatmap)
	mux.HandleFunc("GET /api/v1/dashboard/replays", s.handleDashboardReplays)
	mux.HandleFunc("GET /api/v1/dashboard/replay", s.handleDashboardReplay)
	mux.HandleFunc("GET /api/v1/dashboard/errors", s.handleDashboardErrors)
	mux.HandleFunc("GET /api/v1/dashboard/performance", s.handleDashboardPerformance)
	mux.HandleFunc("GET /api/v1/dashboard/ai-insight", s.handleDashboardAIInsights)
	mux.HandleFunc("GET /api/v1/dashboard/neo/tools", s.handleDashboardNeoTools)
	mux.HandleFunc("POST /api/v1/dashboard/neo/chat", s.handleDashboardNeoChat)
	mux.HandleFunc("GET /api/v1/dashboard/settings", s.handleDashboardSettings)
	mux.HandleFunc("GET /api/v1/dashboard/realtime", s.handleDashboardRealtime)
	mux.HandleFunc("GET /api/v1/dashboard/export/{kind}", s.handleDashboardExport)
	mux.HandleFunc("GET /api/v1/dashboard/imports", s.handleDashboardImportJobs)
	mux.HandleFunc("POST /api/v1/dashboard/imports", s.handleDashboardImportJobs)
	mux.HandleFunc("POST /api/v1/dashboard/imports/preview", s.handleDashboardImportPreview)
	mux.HandleFunc("GET /api/v1/dashboard/imports/{importId}", s.handleDashboardImportJobByID)
	mux.HandleFunc("GET /api/v1/stats/summary", s.handlePublicStatsSummary)
	mux.HandleFunc("GET /api/v1/stats/pages", s.handlePublicStatsPages)
	mux.HandleFunc("GET /api/v1/stats/referrers", s.handlePublicStatsReferrers)
	mux.HandleFunc("GET /api/v1/stats/realtime", s.handlePublicStatsRealtime)
	mux.HandleFunc("GET /api/v1/admin/visitor/{visitorId}/export", s.handleAdminVisitorExport)
	mux.HandleFunc("DELETE /api/v1/admin/visitor/{visitorId}", s.handleAdminVisitorDelete)
	mux.HandleFunc("GET /t.js", s.handleTracker)
	mux.HandleFunc("POST /identity", s.handleIdentity)
	mux.HandleFunc("POST /collect", s.handleCollect)
	mux.HandleFunc("POST /replay", s.handleReplay)
	mux.HandleFunc("OPTIONS /identity", s.handleOptions)
	mux.HandleFunc("OPTIONS /collect", s.handleOptions)
	mux.HandleFunc("OPTIONS /replay", s.handleOptions)

	return s.recover(s.logRequest(s.securityHeaders(s.limitRequestBodies(mux))))
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	ingestSnapshot := ingest.HealthSnapshot{}
	if s.ingestHealth != nil {
		ingestSnapshot = s.ingestHealth.Snapshot()
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "ok",
		"queueDepth": s.batcher.QueueDepth(),
		"storage":    s.stats.Stats(),
		"ingest":     ingestSnapshot,
	})
}

func (s *Server) handleTracker(w http.ResponseWriter, r *http.Request) {
	if match := r.Header.Get("If-None-Match"); match != "" && match == s.trackerETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age="+durationSeconds(s.cfg.TrackerCacheTTL)+", stale-while-revalidate=60")
	w.Header().Set("ETag", s.trackerETag)

	if siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("id"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("site"),
	)); siteID != "" {
		if _, ok, err := s.sites.GetSite(r.Context(), siteID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to resolve site"})
			return
		} else if !ok {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown site id"})
			return
		}

		prefix := []byte("window.__ANLTICSHEAT_DEFAULT_SITE__=" + strconvQuote(siteID) + ";\n")
		_, _ = w.Write(prefix)
	}

	_, _ = w.Write(trackerAsset)
}

func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeMetrics(w, r) {
		return
	}
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
	_, _ = w.Write(s.metrics.Render())
}

func (s *Server) handleOptions(w http.ResponseWriter, r *http.Request) {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("site"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("id"),
		r.Header.Get("X-Site-ID"),
	))
	if siteID == "" {
		writeAPIError(w, errSiteRequired)
		return
	}

	site, ok, err := s.sites.GetSite(r.Context(), siteID)
	if err != nil {
		writeAPIError(w, errInvalidSite.WithMessage("Failed to resolve site."))
		return
	}
	if !ok {
		writeAPIError(w, errInvalidSite)
		return
	}
	if !site.AllowsOrigin(origin) {
		writeAPIError(w, errInvalidOrigin)
		return
	}

	s.writeCORSHeaders(w, origin)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleIdentity(w http.ResponseWriter, r *http.Request) {
	siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("site"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("id"),
		r.Header.Get("X-Site-ID"),
	))
	if siteID == "" {
		writeAPIError(w, errSiteRequired)
		return
	}

	site, ok, err := s.sites.GetSite(r.Context(), siteID)
	if err != nil {
		writeAPIError(w, errInvalidSite.WithMessage("Failed to resolve site."))
		return
	}
	if !ok {
		writeAPIError(w, errInvalidSite)
		return
	}

	headerOrigin := strings.TrimSpace(r.Header.Get("Origin"))
	if requestOrigin := originForValidation(r); !site.AllowsOrigin(requestOrigin) {
		writeAPIError(w, errInvalidOrigin)
		return
	}

	s.writeCORSHeaders(w, headerOrigin)

	if isPrivacyOptOut(r) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	payload := identityPayload{}
	if err := decodeJSON(w, r, 8<<10, &payload); err != nil {
		writeAPIError(w, errInvalidPayload.WithMessage(err.Error()))
		return
	}

	resolved := s.identity.Resolve(identity.ResolveInput{
		CookieID:  readVisitorCookieForSite(r, site),
		StorageID: strings.TrimSpace(payload.StorageID),
		DailyHash: dailyVisitorHash(site, clientIP(r), r.UserAgent()),
	})
	s.writeVisitorCookie(w, r, site, resolved.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"id":         resolved.ID,
		"confidence": resolved.Confidence,
		"source":     resolved.Source,
		"isNew":      resolved.IsNew,
	})
}

func (s *Server) handleCollect(w http.ResponseWriter, r *http.Request) {
	siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("site"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("id"),
		r.Header.Get("X-Site-ID"),
	))
	if siteID == "" {
		writeAPIError(w, errSiteRequired)
		return
	}

	site, ok, err := s.sites.GetSite(r.Context(), siteID)
	if err != nil {
		writeAPIError(w, errInvalidSite.WithMessage("Failed to resolve site."))
		return
	}
	if !ok {
		writeAPIError(w, errInvalidSite)
		return
	}

	headerOrigin := strings.TrimSpace(r.Header.Get("Origin"))
	if requestOrigin := originForValidation(r); !site.AllowsOrigin(requestOrigin) {
		writeAPIError(w, errInvalidOrigin)
		return
	}

	s.writeCORSHeaders(w, headerOrigin)

	if isPrivacyOptOut(r) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if allowed, retryAfter := s.allowSiteRequest(site.ID); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(maxInt(int(retryAfter.Seconds()), 1)))
		writeAPIError(w, errRateLimited)
		return
	}

	if site.BlockBotTrafficEnabled {
		switch ingest.ValidateUserAgent(r.UserAgent()) {
		case nil:
		case ingest.ErrMissingUserAgent, ingest.ErrBlockedUserAgent:
			w.WriteHeader(http.StatusNoContent)
			return
		default:
			writeAPIError(w, errInvalidPayload.WithMessage("Invalid user-agent."))
			return
		}
	}

	payload, err := decodeCollectPayload(w, r)
	if err != nil {
		writeAPIError(w, errInvalidPayload.WithMessage(err.Error()))
		return
	}

	events := payload.Events
	if s.metrics != nil {
		s.metrics.RecordEventsReceived(site.ID, len(events))
	}
	now := time.Now().UTC()
	events, fallbackCount := normalizeEventTimestamps(events, now)
	if fallbackCount > 0 && s.ingestHealth != nil {
		s.ingestHealth.RecordTimestampFallback(fallbackCount)
	}
	if err := ingest.ValidateEvents(events, now); err != nil {
		if s.metrics != nil {
			s.metrics.RecordEventsDropped("validation", len(events))
		}
		writeAPIError(w, errInvalidPayload.WithMessage(err.Error()))
		return
	}

	requestIP := clientIP(r)
	resolved := s.identity.Resolve(identity.ResolveInput{
		CookieID:  readVisitorCookieForSite(r, site),
		StorageID: strings.TrimSpace(payload.StorageID),
		DailyHash: dailyVisitorHash(site, requestIP, r.UserAgent()),
	})
	s.writeVisitorCookie(w, r, site, resolved.ID)

	anonymizedIP := anonymizeIP(requestIP)
	location := geo.Location{}
	if s.geo != nil {
		location = s.geo.Lookup(requestIP, r.Header)
	}
	batch := ingest.WriteBatch{Events: make([]ingest.StoredEvent, 0, len(events))}
	duplicates := 0

	for _, event := range events {
		if s.ingestHealth != nil {
			if decision := s.ingestHealth.Observe(event, now); decision.Duplicate {
				duplicates += 1
				continue
			}
		}

		metaJSON, err := encodeMeta(event.Meta, resolved.ID, event.Sequence, location)
		if err != nil {
			writeAPIError(w, errInvalidPayload.WithMessage(err.Error()))
			return
		}

		batch.Events = append(batch.Events, ingest.StoredEvent{
			SiteID:       site.ID,
			Timestamp:    time.UnixMilli(event.Timestamp).UTC(),
			SessionID:    truncate(event.SessionID, ingest.MaxFieldLength),
			Name:         truncate(event.Name, ingest.MaxFieldLength),
			Path:         truncate(event.Path, ingest.MaxFieldLength),
			X:            float32Ptr(event.X),
			Y:            float32Ptr(event.Y),
			Selector:     truncatePtr(event.Selector, ingest.MaxFieldLength),
			Depth:        event.Depth,
			Meta:         metaJSON,
			AnonymizedIP: anonymizedIP,
			VisitorID:    resolved.ID,
		})
	}

	if err := s.batcher.Enqueue(r.Context(), batch); err != nil {
		if s.metrics != nil {
			s.metrics.RecordEventsDropped("queue_full", len(batch.Events))
		}
		writeAPIError(w, errQueueFullAPI.WithMessage(err.Error()))
		return
	}
	if s.realtime != nil {
		s.realtime.Touch(site.ID, resolved.ID)
	}
	if s.metrics != nil {
		s.metrics.RecordEventsAccepted(site.ID, len(batch.Events))
		if duplicates > 0 {
			s.metrics.RecordEventsDropped("duplicate", duplicates)
		}
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"received":   len(events),
		"accepted":   len(batch.Events),
		"duplicates": duplicates,
		"queueDepth": s.batcher.QueueDepth(),
		"visitor": map[string]any{
			"id":         resolved.ID,
			"confidence": resolved.Confidence,
			"source":     resolved.Source,
			"isNew":      resolved.IsNew,
		},
	})
}

func (s *Server) handleReplay(w http.ResponseWriter, r *http.Request) {
	siteID := strings.TrimSpace(firstNonEmpty(
		r.URL.Query().Get("site"),
		r.URL.Query().Get("site_id"),
		r.URL.Query().Get("id"),
		r.Header.Get("X-Site-ID"),
	))
	if siteID == "" {
		writeAPIError(w, errSiteRequired)
		return
	}

	site, ok, err := s.sites.GetSite(r.Context(), siteID)
	if err != nil {
		writeAPIError(w, errInvalidSite.WithMessage("Failed to resolve site."))
		return
	}
	if !ok {
		writeAPIError(w, errInvalidSite)
		return
	}

	headerOrigin := strings.TrimSpace(r.Header.Get("Origin"))
	if requestOrigin := originForValidation(r); !site.AllowsOrigin(requestOrigin) {
		writeAPIError(w, errInvalidOrigin)
		return
	}

	s.writeCORSHeaders(w, headerOrigin)

	if isPrivacyOptOut(r) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if allowed, retryAfter := s.allowSiteRequest(site.ID); !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(maxInt(int(retryAfter.Seconds()), 1)))
		writeAPIError(w, errRateLimited)
		return
	}

	if site.BlockBotTrafficEnabled {
		switch ingest.ValidateUserAgent(r.UserAgent()) {
		case nil:
		case ingest.ErrMissingUserAgent, ingest.ErrBlockedUserAgent:
			w.WriteHeader(http.StatusNoContent)
			return
		default:
			writeAPIError(w, errInvalidPayload.WithMessage("Invalid user-agent."))
			return
		}
	}

	if s.replay == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "replay storage is not configured"})
		return
	}

	payload := replayPayload{}
	if err := decodeJSON(w, r, 2<<20, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if strings.TrimSpace(payload.Session.SessionID) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "session.sessionId is required"})
		return
	}
	if len(payload.Chunks) == 0 {
		writeJSON(w, http.StatusAccepted, map[string]any{"received": 0, "accepted": 0})
		return
	}

	resolved := s.identity.Resolve(identity.ResolveInput{
		CookieID:  readVisitorCookieForSite(r, site),
		StorageID: strings.TrimSpace(payload.StorageID),
		DailyHash: dailyVisitorHash(site, clientIP(r), r.UserAgent()),
	})
	s.writeVisitorCookie(w, r, site, resolved.ID)

	now := time.Now().UTC()
	sessionStartedAt := parseReplayTime(payload.Session.StartedAt, now)
	sessionUpdatedAt := parseReplayTime(payload.Session.UpdatedAt, now)
	writeBatch := storage.ReplayWriteBatch{
		Session: storage.ReplayWriteSession{
			SiteID:              site.ID,
			SessionID:           truncate(payload.Session.SessionID, ingest.MaxFieldLength),
			VisitorID:           resolved.ID,
			StartedAt:           sessionStartedAt,
			UpdatedAt:           sessionUpdatedAt,
			DurationMS:          maxInt(payload.Session.DurationMS, 0),
			EntryPath:           truncate(payload.Session.EntryPath, ingest.MaxFieldLength),
			ExitPath:            truncate(payload.Session.ExitPath, ingest.MaxFieldLength),
			PageCount:           maxInt(payload.Session.PageCount, 0),
			RouteCount:          maxInt(payload.Session.RouteCount, 0),
			ChunkCount:          maxInt(payload.Session.ChunkCount, 0),
			EventCount:          maxInt(payload.Session.EventCount, 0),
			ErrorCount:          maxInt(payload.Session.ErrorCount, 0),
			ConsoleErrorCount:   maxInt(payload.Session.ConsoleErrorCount, 0),
			NetworkFailureCount: maxInt(payload.Session.NetworkFailureCount, 0),
			RageClickCount:      maxInt(payload.Session.RageClickCount, 0),
			DeadClickCount:      maxInt(payload.Session.DeadClickCount, 0),
			CustomEventCount:    maxInt(payload.Session.CustomEventCount, 0),
			DeviceType:          truncate(payload.Session.DeviceType, ingest.MaxFieldLength),
			Browser:             truncate(payload.Session.Browser, ingest.MaxFieldLength),
			OS:                  truncate(payload.Session.OS, ingest.MaxFieldLength),
			Viewport: storage.ReplayViewport{
				Width:  maxInt(payload.Session.Viewport.Width, 0),
				Height: maxInt(payload.Session.Viewport.Height, 0),
				Bucket: truncate(payload.Session.Viewport.Bucket, ingest.MaxFieldLength),
			},
			Paths:      replayPathsPayload(payload.Session.Paths),
			SampleRate: clampFloat(payload.Session.SampleRate, 0, 1),
		},
		Chunks: make([]storage.ReplayWriteChunk, 0, len(payload.Chunks)),
	}

	for _, chunk := range payload.Chunks {
		eventsJSON := strings.TrimSpace(string(chunk.Events))
		if eventsJSON == "" {
			eventsJSON = "[]"
		}
		writeBatch.Chunks = append(writeBatch.Chunks, storage.ReplayWriteChunk{
			SiteID:     site.ID,
			SessionID:  writeBatch.Session.SessionID,
			VisitorID:  resolved.ID,
			Index:      maxInt(chunk.Index, 0),
			Reason:     truncate(firstNonEmpty(chunk.Reason, payload.Reason), ingest.MaxFieldLength),
			StartedAt:  parseReplayTime(chunk.StartedAt, sessionStartedAt),
			EndedAt:    parseReplayTime(chunk.EndedAt, sessionUpdatedAt),
			Path:       truncate(chunk.Path, ingest.MaxFieldLength),
			EventCount: maxInt(chunk.EventCount, 0),
			Summary:    chunk.Summary,
			EventsJSON: eventsJSON,
		})
	}

	if err := s.replay.WriteReplay(r.Context(), writeBatch); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"received": len(writeBatch.Chunks),
		"accepted": len(writeBatch.Chunks),
		"visitor": map[string]any{
			"id":         resolved.ID,
			"confidence": resolved.Confidence,
			"source":     resolved.Source,
			"isNew":      resolved.IsNew,
		},
	})
}

func (s *Server) handleAdminVisitorExport(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAdmin(w, r) {
		return
	}
	if s.privacy == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "privacy export is not configured"})
		return
	}

	visitorID := strings.TrimSpace(r.PathValue("visitorId"))
	if visitorID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visitor id is required"})
		return
	}

	export, err := s.privacy.ExportVisitor(r.Context(), visitorID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, export)
}

func (s *Server) handleAdminVisitorDelete(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeAdmin(w, r) {
		return
	}
	if s.privacy == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "privacy deletion is not configured"})
		return
	}

	visitorID := strings.TrimSpace(r.PathValue("visitorId"))
	if visitorID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visitor id is required"})
		return
	}

	result, err := s.privacy.DeleteVisitor(r.Context(), visitorID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusAccepted, result)
}

func isPrivacyOptOut(r *http.Request) bool {
	return strings.TrimSpace(r.Header.Get("DNT")) == "1" ||
		strings.TrimSpace(r.Header.Get("Sec-GPC")) == "1"
}

func (s *Server) allowSiteRequest(siteID string) (bool, time.Duration) {
	if s.limiter == nil {
		return true, 0
	}
	return s.limiter.Check(siteID)
}

func (s *Server) authorizeMetrics(w http.ResponseWriter, r *http.Request) bool {
	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if token == "" {
		token = strings.TrimSpace(r.Header.Get("X-Admin-Token"))
	}

	accepted := []string{}
	for _, candidate := range []string{s.cfg.AdminToken, s.cfg.AnalyticsServiceToken, s.cfg.DashboardToken} {
		trimmed := strings.TrimSpace(candidate)
		if trimmed == "" || slices.Contains(accepted, trimmed) {
			continue
		}
		accepted = append(accepted, trimmed)
	}

	if len(accepted) == 0 || !slices.Contains(accepted, token) {
		writeAPIError(w, errMetricsUnauthorized)
		return false
	}
	return true
}

func (s *Server) metricSiteIDs() []string {
	if s.sites == nil {
		return nil
	}
	sites, err := s.sites.ListSites(context.Background())
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(sites))
	for _, site := range sites {
		ids = append(ids, strings.TrimSpace(site.ID))
	}
	return ids
}

func (s *Server) writeCORSHeaders(w http.ResponseWriter, origin string) {
	if origin == "" {
		return
	}
	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, DNT, Sec-GPC, X-Site-ID")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Vary", "Origin")
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		if cookieSecure(r) {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) limitRequestBodies(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/collect":
			r.Body = http.MaxBytesReader(w, r.Body, collectBodyLimit)
		case "/replay":
			r.Body = http.MaxBytesReader(w, r.Body, replayBodyLimit)
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) logRequest(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		if s.metrics != nil {
			s.metrics.RecordHTTPRequest(r.Method, metrics.PathLabel(r), recorder.status, time.Since(start))
		}
		s.logger.Debug("request complete",
			slog.String("method", r.Method),
			slog.String("path", r.URL.Path),
			slog.Duration("duration", time.Since(start)),
		)
	})
}

func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if recovered := recover(); recovered != nil {
				s.logger.Error("panic recovered", slog.Any("panic", recovered))
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal server error"})
			}
		}()

		next.ServeHTTP(w, r)
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(target); err != nil {
		return err
	}

	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain a single JSON value")
		}
		return err
	}

	return nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeJSONBytes(w http.ResponseWriter, status int, payload []byte) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(payload)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func clientIP(r *http.Request) string {
	for _, header := range []string{"CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			parts := strings.Split(value, ",")
			if len(parts) > 0 {
				return strings.TrimSpace(parts[0])
			}
		}
		return value
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func anonymizeIP(raw string) string {
	addr, err := netip.ParseAddr(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}

	if addr.Is4() {
		bytes := addr.As4()
		bytes[3] = 0
		return netip.AddrFrom4(bytes).String()
	}

	bytes := addr.As16()
	for index := 8; index < len(bytes); index += 1 {
		bytes[index] = 0
	}
	return netip.AddrFrom16(bytes).String()
}

func originForValidation(r *http.Request) string {
	if origin := strings.TrimSpace(r.Header.Get("Origin")); origin != "" {
		return origin
	}

	referrer := strings.TrimSpace(r.Referer())
	if referrer == "" {
		return ""
	}

	parsed, err := url.Parse(referrer)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}

	return parsed.Scheme + "://" + parsed.Host
}

func encodeMeta(meta map[string]any, visitorID string, sequence uint64, location geo.Location) (string, error) {
	encoded := make(map[string]any, len(meta)+1)
	for key, value := range meta {
		encoded[key] = value
	}
	if strings.TrimSpace(visitorID) != "" {
		encoded["vid"] = strings.TrimSpace(visitorID)
	}
	if sequence > 0 {
		encoded["sq"] = sequence
	}
	if strings.TrimSpace(location.CountryCode) != "" {
		encoded["gcc"] = location.CountryCode
	}
	if strings.TrimSpace(location.CountryName) != "" {
		encoded["gct"] = location.CountryName
	}
	if strings.TrimSpace(location.Continent) != "" {
		encoded["gco"] = location.Continent
	}
	if strings.TrimSpace(location.RegionCode) != "" {
		encoded["grc"] = location.RegionCode
	}
	if strings.TrimSpace(location.RegionName) != "" {
		encoded["grn"] = location.RegionName
	}
	if strings.TrimSpace(location.City) != "" {
		encoded["gci"] = location.City
	}
	if strings.TrimSpace(location.Timezone) != "" {
		encoded["gtz"] = location.Timezone
	}
	if strings.TrimSpace(location.Precision) != "" {
		encoded["gp"] = location.Precision
	}
	if strings.TrimSpace(location.CountryCode) == "" {
		delete(encoded, "gcc")
		delete(encoded, "gct")
		delete(encoded, "gco")
		delete(encoded, "grc")
		delete(encoded, "grn")
		delete(encoded, "gci")
		delete(encoded, "gtz")
		delete(encoded, "gp")
	}

	raw, err := json.Marshal(encoded)
	if err != nil {
		return "", err
	}
	if len(raw) > ingest.MaxFieldLength {
		return "", errors.New("meta exceeds 500 chars")
	}
	return string(raw), nil
}

func decodeCollectPayload(w http.ResponseWriter, r *http.Request) (collectPayload, error) {
	var raw json.RawMessage
	if err := decodeJSON(w, r, 64<<10, &raw); err != nil {
		return collectPayload{}, err
	}

	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return collectPayload{}, errors.New("request body cannot be empty")
	}

	switch trimmed[0] {
	case '[':
		var events []ingest.Event
		if err := unmarshalStrictJSON(trimmed, &events); err != nil {
			return collectPayload{}, err
		}
		return collectPayload{Events: events}, nil
	case '{':
		var payload collectPayload
		if err := unmarshalStrictJSON(trimmed, &payload); err != nil {
			return collectPayload{}, err
		}
		return payload, nil
	default:
		return collectPayload{}, errors.New("request body must be a JSON object or array")
	}
}

func unmarshalStrictJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(target); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain a single JSON value")
		}
		return err
	}
	return nil
}

func readVisitorCookie(r *http.Request) string {
	cookie, err := r.Cookie(visitorCookieName)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func readVisitorCookieForSite(r *http.Request, site config.Site) string {
	if !site.VisitorCookieEnabled {
		return ""
	}
	return readVisitorCookie(r)
}

func (s *Server) writeVisitorCookie(w http.ResponseWriter, r *http.Request, site config.Site, visitorID string) {
	if !site.VisitorCookieEnabled {
		return
	}
	if strings.TrimSpace(visitorID) == "" {
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     visitorCookieName,
		Value:    strings.TrimSpace(visitorID),
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteStrictMode,
		Secure:   cookieSecure(r),
		MaxAge:   int(visitorCookieTTL / time.Second),
		Expires:  time.Now().UTC().Add(visitorCookieTTL),
	})
}

func cookieSecure(r *http.Request) bool {
	host := strings.ToLower(strings.TrimSpace(r.Host))
	hostname := host
	if strings.Contains(host, ":") {
		if parsed, _, err := net.SplitHostPort(host); err == nil {
			hostname = parsed
		}
	}

	switch hostname {
	case "localhost", "127.0.0.1", "::1":
		return false
	}

	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "http") {
		return false
	}
	return true
}

func dailyVisitorHash(site config.Site, ip, userAgent string) string {
	anonymizedIP := anonymizeIP(ip)
	if anonymizedIP == "" && strings.TrimSpace(userAgent) == "" {
		return ""
	}
	date := time.Now().UTC().Format("2006-01-02")
	input := siteSalt(site) + ":" + date + ":" + anonymizedIP + ":" + strings.TrimSpace(userAgent)
	sum := sha256.Sum256([]byte(input))
	return hex.EncodeToString(sum[:16])
}

func siteSalt(site config.Site) string {
	if strings.TrimSpace(site.Salt) != "" {
		return strings.TrimSpace(site.Salt)
	}
	if strings.TrimSpace(site.ID) != "" {
		return strings.TrimSpace(site.ID)
	}
	return "anlticsheat"
}

func float32Ptr(value *float64) *float32 {
	if value == nil {
		return nil
	}
	v := float32(*value)
	return &v
}

func truncatePtr(value *string, limit int) *string {
	if value == nil {
		return nil
	}
	trimmed := truncate(*value, limit)
	return &trimmed
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func truncate(value string, limit int) string {
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func maxInt(value, minimum int) int {
	if value < minimum {
		return minimum
	}
	return value
}

func clampFloat(value, minimum, maximum float64) float64 {
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}

func parseReplayTime(raw string, fallback time.Time) time.Time {
	value := strings.TrimSpace(raw)
	if value == "" {
		return fallback.UTC()
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return fallback.UTC()
	}
	return parsed.UTC()
}

func replayPathsPayload(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}
	output := make([]string, 0, len(paths))
	seen := map[string]struct{}{}
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		trimmed = truncate(trimmed, ingest.MaxFieldLength)
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		output = append(output, trimmed)
		if len(output) >= 16 {
			break
		}
	}
	return output
}

func durationSeconds(value time.Duration) string {
	return strconv.FormatInt(int64(value/time.Second), 10)
}

func normalizeEventTimestamps(events []ingest.Event, now time.Time) ([]ingest.Event, int) {
	corrected := 0
	if len(events) == 0 {
		return events, corrected
	}

	now = now.UTC()
	for index := range events {
		ts := events[index].Timestamp
		if ts <= 0 {
			events[index].Timestamp = now.UnixMilli()
			if events[index].Meta == nil {
				events[index].Meta = map[string]any{}
			}
			events[index].Meta["tsf"] = true
			corrected += 1
			continue
		}

		eventTime := time.UnixMilli(ts).UTC()
		if eventTime.Before(now.Add(-ingest.MaxEventAge)) || eventTime.After(now.Add(15*time.Minute)) {
			events[index].Timestamp = now.UnixMilli()
			if events[index].Meta == nil {
				events[index].Meta = map[string]any{}
			}
			events[index].Meta["tsf"] = true
			corrected += 1
		}
	}

	return events, corrected
}

func strconvQuote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

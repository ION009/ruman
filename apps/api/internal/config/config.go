package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultHTTPPort              = "8080"
	defaultStorage               = "memory"
	defaultAllowMemoryStorage    = false
	defaultFlushInterval         = 500 * time.Millisecond
	defaultQueueCapacity         = 2048
	defaultBatchMaxItems         = 500
	defaultShutdownTimeout       = 10 * time.Second
	defaultTrackerTTL            = time.Hour
	defaultSiteID                = "demo-site"
	defaultSiteSalt              = "dev-only-change-me"
	defaultDashboardToken        = "demo-dashboard-token"
	defaultAnalyticsServiceToken = defaultDashboardToken
	defaultAdminToken            = "demo-admin-token"
	defaultRateLimitPerSite      = 1000
	defaultRateLimitBurst        = 200
	defaultRateLimitInterval     = time.Minute
	defaultRateLimitTrackedSites = 10000
	defaultIdentityCacheSize     = 100000
	defaultIdentityCacheTTL      = 24 * time.Hour
	defaultCacheTTL              = 60 * time.Second
	defaultCacheMaxEntries       = 500
	defaultEventRetentionDays    = 365
	defaultHeatmapRetentionDays  = 90
	defaultReplayRetentionDays   = 30
	defaultInsightRetentionDays  = 180
	defaultSiteRegistryRefresh   = 30 * time.Second
	defaultAIInsightsEnabled     = false
	defaultAIInsightsProvider    = "longcat"
	defaultAIInsightsBaseURL     = "https://api.longcat.chat/openai"
	defaultAIInsightsModel       = "LongCat-Flash-Thinking-2601"
	defaultAIInsightsTimeout     = 25 * time.Second
	defaultAIInsightsMaxItems    = 6
	defaultAIInsightsZDR         = true
	defaultNeoGroqBaseURL        = "https://api.groq.com/openai/v1"
	defaultNeoGroqModel          = "qwen/qwen3-32b"
	defaultNeoGroqTemperature    = 0.2
	defaultNeoGroqMaxTokens      = 2048
	defaultNeoGroqReasoning      = "default"
	defaultNeoLongCatModel       = "LongCat-Flash-Lite"
	defaultNeoLongCatTemperature = 0.2
	defaultNeoLongCatMaxTokens   = 4096
)

type Site struct {
	ID                         string   `json:"id"`
	Name                       string   `json:"name"`
	Salt                       string   `json:"salt"`
	Origins                    []string `json:"origins"`
	BlockBotTrafficEnabled     bool     `json:"blockBotTrafficEnabled"`
	VisitorCookieEnabled       bool     `json:"visitorCookieEnabled"`
	DomSnapshotsEnabled        bool     `json:"domSnapshotsEnabled"`
	ReplayMaskTextEnabled      bool     `json:"replayMaskTextEnabled"`
	SPATrackingEnabled         bool     `json:"spaTrackingEnabled"`
	ErrorTrackingEnabled       bool     `json:"errorTrackingEnabled"`
	PerformanceTrackingEnabled bool     `json:"performanceTrackingEnabled"`
}

func (s Site) AllowsOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	if len(s.Origins) == 0 {
		return true
	}
	for _, allowed := range s.Origins {
		if allowed == "*" || strings.EqualFold(allowed, origin) || originsMatch(allowed, origin) {
			return true
		}
	}
	return false
}

func originsMatch(a, b string) bool {
	aScheme, aHostPort, aHost, okA := normalizeOriginForCompare(a)
	bScheme, bHostPort, bHost, okB := normalizeOriginForCompare(b)
	if !okA || !okB {
		return false
	}

	if isLoopbackHost(aHost) && isLoopbackHost(bHost) {
		return aScheme == bScheme
	}
	return aScheme == bScheme && aHostPort == bHostPort
}

func normalizeOriginForCompare(raw string) (scheme string, hostPort string, host string, ok bool) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", "", "", false
	}

	scheme = strings.ToLower(parsed.Scheme)
	host = strings.ToLower(parsed.Hostname())
	if host == "" {
		return "", "", "", false
	}

	if isLoopbackHost(host) {
		host = "localhost"
	}

	port := parsed.Port()
	if port == "" {
		switch scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		}
	}

	hostPort = host
	if port != "" {
		hostPort = net.JoinHostPort(host, port)
	}

	return scheme, hostPort, host, true
}

func isLoopbackHost(host string) bool {
	switch strings.TrimSpace(strings.ToLower(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

type Config struct {
	HTTPPort                string
	Storage                 string
	AllowMemoryStorage      bool
	ClickHouseDSN           string
	GeoIPDBPath             string
	DevGeoCountryCode       string
	DevGeoCountryName       string
	DevGeoContinent         string
	DevGeoRegionCode        string
	DevGeoRegionName        string
	DevGeoCity              string
	DevGeoTimezone          string
	FlushInterval           time.Duration
	QueueCapacity           int
	BatchMaxItems           int
	ShutdownTimeout         time.Duration
	TrackerCacheTTL         time.Duration
	DashboardToken          string
	AnalyticsServiceToken   string
	AdminToken              string
	RateLimitPerSite        int
	RateLimitBurst          int
	RateLimitInterval       time.Duration
	RateLimitTrackedSites   int
	IdentityCacheSize       int
	IdentityCacheTTL        time.Duration
	CacheTTL                time.Duration
	CacheMaxEntries         int
	EventRetentionDays      int
	HeatmapRetentionDays    int
	ReplayRetentionDays     int
	InsightRetentionDays    int
	TrackerPublicOrigin     string
	SnapshotPublicOrigin    string
	NeonDatabaseURL         string
	SiteRegistryRefresh     time.Duration
	AIInsightsEnabled       bool
	AIInsightsProvider      string
	AIInsightsBaseURL       string
	AIInsightsAPIKey        string
	AIInsightsModel         string
	AIInsightsTimeout       time.Duration
	AIInsightsMaxItems      int
	AIInsightsZeroRetention bool
	NeoGroqBaseURL          string
	NeoGroqAPIKey           string
	NeoGroqModel            string
	NeoGroqTemperature      float64
	NeoGroqMaxTokens        int
	NeoGroqReasoningEffort  string
	NeoLongCatBaseURL       string
	NeoLongCatAPIKey        string
	NeoLongCatModel         string
	NeoLongCatTemperature   float64
	NeoLongCatMaxTokens     int
	AlertSMTPAddr           string
	AlertSMTPUsername       string
	AlertSMTPPassword       string
	AlertSMTPFrom           string
	WALDir                  string
	Sites                   map[string]Site
}

func (c Config) SiteByID(id string) (Site, bool) {
	site, ok := c.Sites[id]
	return site, ok
}

func (c Config) AllowsAnyOrigin(origin string) bool {
	if origin == "" {
		return true
	}
	for _, site := range c.Sites {
		if site.AllowsOrigin(origin) {
			return true
		}
	}
	return false
}

func Load() (Config, error) {
	flushInterval, err := durationFromEnv("ANLTICSHEAT_FLUSH_INTERVAL", defaultFlushInterval)
	if err != nil {
		return Config{}, err
	}

	trackerTTL, err := durationFromEnv("ANLTICSHEAT_TRACKER_CACHE_TTL", defaultTrackerTTL)
	if err != nil {
		return Config{}, err
	}

	queueCapacity, err := intFromEnv("ANLTICSHEAT_QUEUE_CAPACITY", defaultQueueCapacity)
	if err != nil {
		return Config{}, err
	}

	batchMaxItems, err := intFromEnv("ANLTICSHEAT_BATCH_MAX_ITEMS", defaultBatchMaxItems)
	if err != nil {
		return Config{}, err
	}

	shutdownTimeout, err := durationFromEnv("ANLTICSHEAT_SHUTDOWN_TIMEOUT", defaultShutdownTimeout)
	if err != nil {
		return Config{}, err
	}

	rateLimitPerSite, err := intFromEnv("ANLTICSHEAT_RATE_LIMIT_PER_SITE", defaultRateLimitPerSite)
	if err != nil {
		return Config{}, err
	}

	rateLimitBurst, err := intFromEnv("ANLTICSHEAT_RATE_LIMIT_BURST", defaultRateLimitBurst)
	if err != nil {
		return Config{}, err
	}

	rateLimitInterval, err := durationFromEnv("ANLTICSHEAT_RATE_LIMIT_INTERVAL", defaultRateLimitInterval)
	if err != nil {
		return Config{}, err
	}

	rateLimitTrackedSites, err := intFromEnv("ANLTICSHEAT_RATE_LIMIT_TRACKED_SITES", defaultRateLimitTrackedSites)
	if err != nil {
		return Config{}, err
	}

	identityCacheSize, err := intFromEnv("ANLTICSHEAT_IDENTITY_CACHE_SIZE", defaultIdentityCacheSize)
	if err != nil {
		return Config{}, err
	}

	identityCacheTTL, err := durationFromEnv("ANLTICSHEAT_IDENTITY_CACHE_TTL", defaultIdentityCacheTTL)
	if err != nil {
		return Config{}, err
	}

	cacheTTL, err := durationFromEnv("ANLTICSHEAT_CACHE_TTL", defaultCacheTTL)
	if err != nil {
		return Config{}, err
	}

	cacheMaxEntries, err := intFromEnv("ANLTICSHEAT_CACHE_MAX_ENTRIES", defaultCacheMaxEntries)
	if err != nil {
		return Config{}, err
	}

	eventRetentionDays, err := intFromEnv("ANLTICSHEAT_EVENT_RETENTION_DAYS", defaultEventRetentionDays)
	if err != nil {
		return Config{}, err
	}

	heatmapRetentionDays, err := intFromEnv("ANLTICSHEAT_HEATMAP_RETENTION_DAYS", defaultHeatmapRetentionDays)
	if err != nil {
		return Config{}, err
	}

	replayRetentionDays, err := intFromEnv("ANLTICSHEAT_REPLAY_RETENTION_DAYS", defaultReplayRetentionDays)
	if err != nil {
		return Config{}, err
	}

	insightRetentionDays, err := intFromEnv("ANLTICSHEAT_INSIGHT_RETENTION_DAYS", defaultInsightRetentionDays)
	if err != nil {
		return Config{}, err
	}

	siteRegistryRefresh, err := durationFromEnv("ANLTICSHEAT_SITE_REGISTRY_REFRESH", defaultSiteRegistryRefresh)
	if err != nil {
		return Config{}, err
	}

	aiInsightsTimeout, err := durationFromEnv("ANLTICSHEAT_AI_INSIGHTS_TIMEOUT", defaultAIInsightsTimeout)
	if err != nil {
		return Config{}, err
	}

	aiInsightsMaxItems, err := intFromEnv("ANLTICSHEAT_AI_INSIGHTS_MAX_ITEMS", defaultAIInsightsMaxItems)
	if err != nil {
		return Config{}, err
	}

	neoGroqTemperature, err := float64FromEnv("ANLTICSHEAT_NEO_GROQ_TEMPERATURE", defaultNeoGroqTemperature)
	if err != nil {
		return Config{}, err
	}

	neoGroqMaxTokens, err := intFromEnv("ANLTICSHEAT_NEO_GROQ_MAX_COMPLETION_TOKENS", defaultNeoGroqMaxTokens)
	if err != nil {
		return Config{}, err
	}

	neoLongCatTemperature, err := float64FromEnv("ANLTICSHEAT_NEO_LONGCAT_TEMPERATURE", defaultNeoLongCatTemperature)
	if err != nil {
		return Config{}, err
	}

	neoLongCatMaxTokens, err := intFromEnv("ANLTICSHEAT_NEO_LONGCAT_MAX_TOKENS", defaultNeoLongCatMaxTokens)
	if err != nil {
		return Config{}, err
	}

	sites, err := parseSites(os.Getenv("ANLTICSHEAT_SITES_JSON"))
	if err != nil {
		return Config{}, err
	}

	snapshotPublicOrigin := strings.TrimSpace(os.Getenv("ANLTICSHEAT_SNAPSHOT_PUBLIC_ORIGIN"))
	if snapshotPublicOrigin == "" {
		snapshotPublicOrigin = strings.TrimSpace(os.Getenv("ANLTICSHEAT_WEB_PUBLIC_ORIGIN"))
	}

	rawAIInsightsAPIKey := strings.TrimSpace(os.Getenv("ANLTICSHEAT_AI_INSIGHTS_API_KEY"))
	rawNeoLongCatAPIKey := strings.TrimSpace(os.Getenv("ANLTICSHEAT_NEO_LONGCAT_API_KEY"))
	aiInsightsAPIKey := rawAIInsightsAPIKey
	if aiInsightsAPIKey == "" {
		aiInsightsAPIKey = rawNeoLongCatAPIKey
	}
	neoLongCatBaseURL := strings.TrimSpace(os.Getenv("ANLTICSHEAT_NEO_LONGCAT_BASE_URL"))
	if neoLongCatBaseURL == "" {
		neoLongCatBaseURL = stringFromEnv("ANLTICSHEAT_AI_INSIGHTS_BASE_URL", defaultAIInsightsBaseURL)
	}
	neoLongCatAPIKey := rawNeoLongCatAPIKey
	if neoLongCatAPIKey == "" {
		neoLongCatAPIKey = aiInsightsAPIKey
	}
	neoLongCatModel := strings.TrimSpace(os.Getenv("ANLTICSHEAT_NEO_LONGCAT_MODEL"))
	if neoLongCatModel == "" {
		neoLongCatModel = defaultNeoLongCatModel
	}

	return Config{
		HTTPPort:                stringFromEnv("ANLTICSHEAT_HTTP_PORT", defaultHTTPPort),
		Storage:                 stringFromEnv("ANLTICSHEAT_STORAGE", defaultStorage),
		AllowMemoryStorage:      boolFromEnv("ANLTICSHEAT_ALLOW_MEMORY_STORAGE", defaultAllowMemoryStorage),
		ClickHouseDSN:           os.Getenv("ANLTICSHEAT_CLICKHOUSE_DSN"),
		GeoIPDBPath:             strings.TrimSpace(os.Getenv("ANLTICSHEAT_GEOIP_DB_PATH")),
		DevGeoCountryCode:       strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_COUNTRY_CODE")),
		DevGeoCountryName:       strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_COUNTRY_NAME")),
		DevGeoContinent:         strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_CONTINENT")),
		DevGeoRegionCode:        strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_REGION_CODE")),
		DevGeoRegionName:        strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_REGION_NAME")),
		DevGeoCity:              strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_CITY")),
		DevGeoTimezone:          strings.TrimSpace(os.Getenv("ANLTICSHEAT_DEV_GEO_TIMEZONE")),
		FlushInterval:           flushInterval,
		QueueCapacity:           queueCapacity,
		BatchMaxItems:           batchMaxItems,
		ShutdownTimeout:         shutdownTimeout,
		TrackerCacheTTL:         trackerTTL,
		DashboardToken:          stringFromEnv("ANLTICSHEAT_DASHBOARD_TOKEN", defaultDashboardToken),
		AnalyticsServiceToken:   stringFromEnv("ANLTICSHEAT_ANALYTICS_SERVICE_TOKEN", defaultAnalyticsServiceToken),
		AdminToken:              stringFromEnv("ANLTICSHEAT_ADMIN_TOKEN", defaultAdminToken),
		RateLimitPerSite:        rateLimitPerSite,
		RateLimitBurst:          rateLimitBurst,
		RateLimitInterval:       rateLimitInterval,
		RateLimitTrackedSites:   rateLimitTrackedSites,
		IdentityCacheSize:       identityCacheSize,
		IdentityCacheTTL:        identityCacheTTL,
		CacheTTL:                cacheTTL,
		CacheMaxEntries:         cacheMaxEntries,
		EventRetentionDays:      eventRetentionDays,
		HeatmapRetentionDays:    heatmapRetentionDays,
		ReplayRetentionDays:     replayRetentionDays,
		InsightRetentionDays:    insightRetentionDays,
		TrackerPublicOrigin:     strings.TrimSpace(os.Getenv("ANLTICSHEAT_TRACKER_PUBLIC_ORIGIN")),
		SnapshotPublicOrigin:    snapshotPublicOrigin,
		NeonDatabaseURL:         strings.TrimSpace(os.Getenv("ANLTICSHEAT_NEON_DATABASE_URL")),
		SiteRegistryRefresh:     siteRegistryRefresh,
		AIInsightsEnabled:       boolFromEnv("ANLTICSHEAT_AI_INSIGHTS_ENABLED", defaultAIInsightsEnabled),
		AIInsightsProvider:      stringFromEnv("ANLTICSHEAT_AI_INSIGHTS_PROVIDER", defaultAIInsightsProvider),
		AIInsightsBaseURL:       stringFromEnv("ANLTICSHEAT_AI_INSIGHTS_BASE_URL", defaultAIInsightsBaseURL),
		AIInsightsAPIKey:        aiInsightsAPIKey,
		AIInsightsModel:         stringFromEnv("ANLTICSHEAT_AI_INSIGHTS_MODEL", defaultAIInsightsModel),
		AIInsightsTimeout:       aiInsightsTimeout,
		AIInsightsMaxItems:      aiInsightsMaxItems,
		AIInsightsZeroRetention: boolFromEnv("ANLTICSHEAT_AI_INSIGHTS_ZERO_RETENTION", defaultAIInsightsZDR),
		NeoGroqBaseURL:          stringFromEnv("ANLTICSHEAT_NEO_GROQ_BASE_URL", defaultNeoGroqBaseURL),
		NeoGroqAPIKey:           strings.TrimSpace(os.Getenv("ANLTICSHEAT_NEO_GROQ_API_KEY")),
		NeoGroqModel:            stringFromEnv("ANLTICSHEAT_NEO_GROQ_MODEL", defaultNeoGroqModel),
		NeoGroqTemperature:      neoGroqTemperature,
		NeoGroqMaxTokens:        neoGroqMaxTokens,
		NeoGroqReasoningEffort:  stringFromEnv("ANLTICSHEAT_NEO_GROQ_REASONING_EFFORT", defaultNeoGroqReasoning),
		NeoLongCatBaseURL:       neoLongCatBaseURL,
		NeoLongCatAPIKey:        neoLongCatAPIKey,
		NeoLongCatModel:         neoLongCatModel,
		NeoLongCatTemperature:   neoLongCatTemperature,
		NeoLongCatMaxTokens:     neoLongCatMaxTokens,
		AlertSMTPAddr:           strings.TrimSpace(os.Getenv("ANLTICSHEAT_ALERT_SMTP_ADDR")),
		AlertSMTPUsername:       strings.TrimSpace(os.Getenv("ANLTICSHEAT_ALERT_SMTP_USERNAME")),
		AlertSMTPPassword:       strings.TrimSpace(os.Getenv("ANLTICSHEAT_ALERT_SMTP_PASSWORD")),
		AlertSMTPFrom:           strings.TrimSpace(os.Getenv("ANLTICSHEAT_ALERT_SMTP_FROM")),
		WALDir:                  strings.TrimSpace(os.Getenv("ANLTICSHEAT_WAL_DIR")),
		Sites:                   sites,
	}, nil
}

func parseSites(raw string) (map[string]Site, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]Site{
			defaultSiteID: {
				ID:                         defaultSiteID,
				Name:                       "Demo Site",
				Salt:                       defaultSiteSalt,
				Origins:                    []string{"http://localhost:3000", "http://localhost:5173"},
				BlockBotTrafficEnabled:     true,
				SPATrackingEnabled:         true,
				ErrorTrackingEnabled:       true,
				PerformanceTrackingEnabled: true,
			},
		}, nil
	}

	var sites []Site
	if err := json.Unmarshal([]byte(raw), &sites); err != nil {
		return nil, fmt.Errorf("parse ANLTICSHEAT_SITES_JSON: %w", err)
	}

	if len(sites) == 0 {
		return nil, errors.New("ANLTICSHEAT_SITES_JSON must contain at least one site")
	}

	indexed := make(map[string]Site, len(sites))
	for _, site := range sites {
		if site.ID == "" {
			return nil, errors.New("site id cannot be empty")
		}
		if site.Name == "" {
			site.Name = site.ID
		}
		if site.Salt == "" {
			return nil, fmt.Errorf("site %q must define a salt", site.ID)
		}
		indexed[site.ID] = site
	}

	return indexed, nil
}

func durationFromEnv(key string, fallback time.Duration) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return parsed, nil
}

func intFromEnv(key string, fallback int) (int, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return parsed, nil
}

func float64FromEnv(key string, fallback float64) (float64, error) {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return parsed, nil
}

func stringFromEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func boolFromEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}
	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

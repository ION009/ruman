-- 001: Events table — page views + custom events
-- ORDER BY (site_id, date, path) for dashboard queries
-- Partitioned monthly, TTL 365 days

CREATE TABLE IF NOT EXISTS default.events
(
    -- Identity
    site_id             LowCardinality(String),
    event_id            String,
    type                LowCardinality(String) DEFAULT 'pageview',  -- pageview | custom
    name                LowCardinality(String) DEFAULT '',           -- custom event name

    timestamp           DateTime64(3),

    -- Page context (from tracker core.js)
    path                LowCardinality(String),
    url                 String,
    title               String DEFAULT '',
    referrer            String DEFAULT '',

    -- Screen & viewport (from tracker)
    screen_width        UInt16 DEFAULT 0,
    screen_height       UInt16 DEFAULT 0,
    viewport_width      UInt16 DEFAULT 0,
    viewport_height     UInt16 DEFAULT 0,

    -- Locale (from tracker)
    language            LowCardinality(String) DEFAULT '',
    timezone_offset     Int16 DEFAULT 0,

    -- UTM params (from tracker)
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        LowCardinality(String) DEFAULT '',
    utm_term            LowCardinality(String) DEFAULT '',
    utm_content         LowCardinality(String) DEFAULT '',

    -- Custom event properties (type=custom only)
    props               Map(String, String),

    -- Server-side enrichment (Go API populates these)
    visitor_id          String DEFAULT '',
    session_id          String DEFAULT '',
    browser             LowCardinality(String) DEFAULT '',
    browser_version     LowCardinality(String) DEFAULT '',
    os                  LowCardinality(String) DEFAULT '',
    os_version          LowCardinality(String) DEFAULT '',
    device_type         LowCardinality(String) DEFAULT '',  -- desktop | mobile | tablet
    country             LowCardinality(String) DEFAULT '',
    region              LowCardinality(String) DEFAULT '',
    city                LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (site_id, toDate(timestamp), path)
TTL toDateTime(timestamp) + INTERVAL 365 DAY
SETTINGS index_granularity = 8192;

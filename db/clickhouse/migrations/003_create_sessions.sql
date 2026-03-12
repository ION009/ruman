-- 003: Sessions table — session metadata (computed server-side)
-- ReplacingMergeTree: sessions are updated as more events arrive,
-- deduplicated by (site_id, date, session_id), latest ended_at wins

CREATE TABLE IF NOT EXISTS default.sessions
(
    site_id             LowCardinality(String),
    session_id          String,
    visitor_id          String,

    created_at          DateTime64(3),
    ended_at            DateTime64(3),
    duration_seconds    UInt32 DEFAULT 0,

    page_count          UInt16 DEFAULT 0,
    event_count         UInt16 DEFAULT 0,
    entry_path          LowCardinality(String) DEFAULT '',
    exit_path           LowCardinality(String) DEFAULT '',
    is_bounce           UInt8 DEFAULT 0,

    -- Attribution (from first event in session)
    referrer            String DEFAULT '',
    utm_source          LowCardinality(String) DEFAULT '',
    utm_medium          LowCardinality(String) DEFAULT '',
    utm_campaign        LowCardinality(String) DEFAULT '',

    -- Device & geo (server-side enrichment)
    browser             LowCardinality(String) DEFAULT '',
    os                  LowCardinality(String) DEFAULT '',
    device_type         LowCardinality(String) DEFAULT '',
    country             LowCardinality(String) DEFAULT '',
    region              LowCardinality(String) DEFAULT '',
    city                LowCardinality(String) DEFAULT '',

    -- Session replay metadata
    has_replay          UInt8 DEFAULT 0,
    replay_chunk_count  UInt16 DEFAULT 0
)
ENGINE = ReplacingMergeTree(ended_at)
ORDER BY (site_id, toDate(created_at), session_id)
SETTINGS index_granularity = 8192;

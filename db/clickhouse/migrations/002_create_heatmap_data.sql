-- 002: Heatmap data — click/move/scroll coordinates + viewport
-- ORDER BY (site_id, path, date) for per-page heatmap rendering
-- TTL 90 days (raw coordinate data expires faster)

CREATE TABLE IF NOT EXISTS default.heatmap_data
(
    site_id             LowCardinality(String),
    kind                LowCardinality(String),   -- click | move | scroll
    timestamp           DateTime64(3),
    path                LowCardinality(String),

    -- Coordinates (from tracker heatmap.js)
    x                   UInt16 DEFAULT 0,
    y                   UInt16 DEFAULT 0,

    -- Viewport & document dimensions (for normalization)
    viewport_width      UInt16 DEFAULT 0,
    viewport_height     UInt16 DEFAULT 0,
    document_width      UInt32 DEFAULT 0,
    document_height     UInt32 DEFAULT 0,
    scroll_x            UInt32 DEFAULT 0,
    scroll_y            UInt32 DEFAULT 0,

    -- Click target info (kind='click' only)
    target_tag          LowCardinality(String) DEFAULT '',
    target_id           String DEFAULT '',
    target_classes      Array(String),

    -- Server-side enrichment
    visitor_id          String DEFAULT '',
    session_id          String DEFAULT '',
    device_type         LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree
ORDER BY (site_id, path, toDate(timestamp))
TTL toDateTime(timestamp) + INTERVAL 90 DAY
SETTINGS index_granularity = 8192;

CREATE TABLE IF NOT EXISTS replay_sessions
(
    site_id               LowCardinality(String),
    session_id            String,
    visitor_id            String,
    started_at            DateTime64(3),
    updated_at            DateTime64(3),
    duration_ms           UInt32,
    entry_path            String,
    exit_path             String,
    page_count            UInt16,
    route_count           UInt16,
    chunk_count           UInt16,
    event_count           UInt32,
    error_count           UInt16,
    console_error_count   UInt16,
    network_failure_count UInt16,
    rage_click_count      UInt16,
    dead_click_count      UInt16,
    custom_event_count    UInt16,
    device_type           LowCardinality(String),
    browser               LowCardinality(String),
    os                    LowCardinality(String),
    viewport_width        UInt16,
    viewport_height       UInt16,
    viewport_bucket       LowCardinality(String),
    paths                 Array(String),
    sample_rate           Float32
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(updated_at)
ORDER BY (site_id, toDate(updated_at), session_id)
TTL toDateTime(updated_at) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS replay_chunks
(
    site_id      LowCardinality(String),
    session_id   String,
    visitor_id   String,
    chunk_index  UInt32,
    reason       LowCardinality(String),
    started_at   DateTime64(3),
    ended_at     DateTime64(3),
    path         String,
    event_count  UInt32,
    summary_json String,
    events_json  String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(started_at)
ORDER BY (site_id, session_id, chunk_index)
TTL toDateTime(started_at) + INTERVAL 30 DAY;

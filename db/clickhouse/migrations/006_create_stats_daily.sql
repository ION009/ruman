-- 006: Stats daily — pre-aggregated daily metrics
-- SummingMergeTree: numeric columns auto-sum on merge
-- Populated by mv_stats_daily materialized view from events

CREATE TABLE IF NOT EXISTS default.stats_daily
(
    site_id             LowCardinality(String),
    date                Date,
    path                LowCardinality(String),
    pageviews           UInt64,
    visitors            UInt64,
    sessions            UInt64,
    custom_events       UInt64,
    bounces             UInt64,
    total_duration      UInt64,
    entry_count         UInt64,
    exit_count          UInt64,
    top_referrer        LowCardinality(String),
    top_browser         LowCardinality(String),
    top_os              LowCardinality(String),
    top_country         LowCardinality(String),
    desktop_count       UInt64,
    mobile_count        UInt64,
    tablet_count        UInt64
)
ENGINE = SummingMergeTree((pageviews, visitors, sessions, custom_events, bounces, total_duration, entry_count, exit_count, desktop_count, mobile_count, tablet_count))
ORDER BY (site_id, date, path)
SETTINGS index_granularity = 8192;

-- Materialized view: auto-populates stats_daily from every INSERT into events
CREATE MATERIALIZED VIEW IF NOT EXISTS default.mv_stats_daily
TO default.stats_daily
AS
SELECT
    site_id,
    toDate(ts)                          AS date,
    path,
    countIf(e = 'pageview')             AS pageviews,
    uniqExact(if(length(vid) > 0, vid, sid)) AS visitors,
    uniqExact(sid)                      AS sessions,
    countIf(e NOT IN ('pageview', 'click', 'move', 'scroll')) AS custom_events,
    0                                   AS bounces,
    0                                   AS total_duration,
    0                                   AS entry_count,
    0                                   AS exit_count,
    topK(1)(referrer)[1]                AS top_referrer,
    ''                                  AS top_browser,
    ''                                  AS top_os,
    ''                                  AS top_country,
    countIf(lowerUTF8(device_type) = 'desktop') AS desktop_count,
    countIf(lowerUTF8(device_type) = 'mobile')  AS mobile_count,
    countIf(lowerUTF8(device_type) = 'tablet')  AS tablet_count
FROM default.events
GROUP BY site_id, date, path;

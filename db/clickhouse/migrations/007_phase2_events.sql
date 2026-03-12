DROP TABLE IF EXISTS stats_hourly_mv;
DROP TABLE IF EXISTS stats_daily_mv;
DROP TABLE IF EXISTS heatmap_mv;
DROP TABLE IF EXISTS stats_hourly;
DROP TABLE IF EXISTS stats_daily;
DROP TABLE IF EXISTS heatmap_data;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS insights;
DROP TABLE IF EXISTS events;

CREATE TABLE IF NOT EXISTS events
(
    site_id LowCardinality(String),
    ts      DateTime64(3),
    sid     String,
    e       LowCardinality(String),
    path    String,
    x       Nullable(Float32),
    y       Nullable(Float32),
    sel     Nullable(String),
    depth   Nullable(UInt8),
    meta    String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (site_id, ts, path, e);

CREATE MATERIALIZED VIEW IF NOT EXISTS heatmap_mv
ENGINE = AggregatingMergeTree()
ORDER BY (site_id, path, x_bucket, y_bucket)
AS
SELECT
    site_id,
    path,
    toUInt8(floor(assumeNotNull(x))) AS x_bucket,
    toUInt8(floor(assumeNotNull(y))) AS y_bucket,
    countState() AS count
FROM events
WHERE x IS NOT NULL AND y IS NOT NULL
GROUP BY site_id, path, x_bucket, y_bucket;

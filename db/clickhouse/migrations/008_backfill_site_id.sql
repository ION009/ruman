DROP TABLE IF EXISTS heatmap_mv;

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

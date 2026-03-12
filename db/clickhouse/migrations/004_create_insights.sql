-- 004: Insights table — AI-generated findings
-- ReplacingMergeTree: deduplicated by (site_id, date, path, category),
-- latest created_at wins (re-analysis overwrites stale insights)

CREATE TABLE IF NOT EXISTS default.insights
(
    site_id             LowCardinality(String),
    insight_id          String,
    date                Date,
    path                LowCardinality(String) DEFAULT '',

    -- Classification
    category            LowCardinality(String),   -- rage_click | scroll_dropoff | dead_zone | mobile_issue | high_bounce
    severity            LowCardinality(String),   -- critical | warning | info

    -- Content
    finding             String,                    -- human-readable description
    recommendation      String,                    -- actionable fix
    data                String DEFAULT '',          -- JSON context (metrics, thresholds, etc.)

    created_at          DateTime64(3)
)
ENGINE = ReplacingMergeTree(created_at)
ORDER BY (site_id, date, path, category)
SETTINGS index_granularity = 8192;

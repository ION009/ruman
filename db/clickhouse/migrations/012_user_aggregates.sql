CREATE TABLE IF NOT EXISTS user_profiles
(
    site_id          LowCardinality(String),
    user_key         String,
    user_hash        String,
    first_seen_state AggregateFunction(min, DateTime64(3)),
    last_seen_state  AggregateFunction(max, DateTime64(3)),
    country_state    AggregateFunction(anyLast, String),
    region_state     AggregateFunction(anyLast, String),
    browser_state    AggregateFunction(anyLast, String),
    os_state         AggregateFunction(anyLast, String)
)
ENGINE = AggregatingMergeTree()
ORDER BY (site_id, user_hash, user_key);

CREATE MATERIALIZED VIEW IF NOT EXISTS user_profiles_mv
TO user_profiles
AS
SELECT
    site_id,
    if(length(vid) > 0, vid, sid) AS user_key,
    lower(hex(MD5(concat(site_id, ':', if(length(vid) > 0, vid, sid))))) AS user_hash,
    minState(ts) AS first_seen_state,
    maxState(ts) AS last_seen_state,
    anyLastState(upperUTF8(if(length(JSONExtractString(meta, 'gcc')) > 0, JSONExtractString(meta, 'gcc'), ''))) AS country_state,
    anyLastState(upperUTF8(if(length(JSONExtractString(meta, 'grc')) > 0, JSONExtractString(meta, 'grc'), ''))) AS region_state,
    anyLastState(if(length(JSONExtractString(meta, 'br')) > 0, JSONExtractString(meta, 'br'), 'Unknown')) AS browser_state,
    anyLastState(if(length(JSONExtractString(meta, 'os')) > 0, JSONExtractString(meta, 'os'), 'Unknown')) AS os_state
FROM events
GROUP BY site_id, user_key, user_hash;

CREATE TABLE IF NOT EXISTS user_activity_daily
(
    site_id       LowCardinality(String),
    activity_date Date,
    user_key      String,
    user_hash     String,
    pageviews     UInt64,
    events        UInt64
)
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(activity_date)
ORDER BY (site_id, activity_date, user_hash, user_key);

CREATE MATERIALIZED VIEW IF NOT EXISTS user_activity_daily_mv
TO user_activity_daily
AS
SELECT
    site_id,
    toDate(ts) AS activity_date,
    if(length(vid) > 0, vid, sid) AS user_key,
    lower(hex(MD5(concat(site_id, ':', if(length(vid) > 0, vid, sid))))) AS user_hash,
    countIf(e = 'pageview') AS pageviews,
    count() AS events
FROM events
GROUP BY site_id, activity_date, user_key, user_hash;

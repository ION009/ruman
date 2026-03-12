package storage

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type clickHouseRetentionActivityRow struct {
	ActivityDate string `json:"activity_date"`
	UserID       string `json:"user_id"`
	DeviceType   string `json:"device_type"`
	CountryCode  string `json:"country_code"`
	CountryName  string `json:"country_name"`
}

func (s *ClickHouseStore) RetentionReport(
	ctx context.Context,
	siteID string,
	query RetentionQuery,
	rangeValue TimeRange,
	now time.Time,
) (RetentionReport, error) {
	days, err := s.loadRetentionActivityDays(ctx, strings.TrimSpace(siteID), now.UTC())
	if err != nil {
		return RetentionReport{}, err
	}
	return buildRetentionReport(days, query, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) RetentionTrend(
	ctx context.Context,
	siteID string,
	query RetentionQuery,
	rangeValue TimeRange,
	now time.Time,
) (RetentionTrendView, error) {
	days, err := s.loadRetentionActivityDays(ctx, strings.TrimSpace(siteID), now.UTC())
	if err != nil {
		return RetentionTrendView{}, err
	}
	return buildRetentionTrend(days, query, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) loadRetentionActivityDays(ctx context.Context, siteID string, now time.Time) ([]retentionActivityDay, error) {
	query := fmt.Sprintf(`
SELECT
    toString(activity_date) AS activity_date,
    user_id,
    device_type,
    country_code,
    country_name
FROM retention_user_activity_daily FINAL
WHERE site_id = %s
  AND activity_date <= toDate(%s)
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)), quoteClickHouseString(now.Format("2006-01-02")))

	rows, err := clickHouseSelectRows[clickHouseRetentionActivityRow](ctx, s, query)
	if err != nil {
		if !isClickHouseMissingRetentionTables(err) {
			return nil, err
		}
		if ensureErr := s.ensureRetentionTables(ctx); ensureErr != nil {
			return nil, ensureErr
		}
		rows, err = clickHouseSelectRows[clickHouseRetentionActivityRow](ctx, s, query)
		if err != nil {
			return nil, err
		}
	}

	output := make([]retentionActivityDay, 0, len(rows))
	for _, row := range rows {
		activityDate, parseErr := time.Parse("2006-01-02", strings.TrimSpace(row.ActivityDate))
		if parseErr != nil {
			continue
		}
		output = append(output, retentionActivityDay{
			UserID:      strings.TrimSpace(row.UserID),
			ActivityDay: activityDate.UTC(),
			Device:      strings.TrimSpace(row.DeviceType),
			CountryCode: strings.ToUpper(strings.TrimSpace(row.CountryCode)),
			CountryName: strings.TrimSpace(row.CountryName),
		})
	}
	return output, nil
}

func isClickHouseMissingRetentionTables(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "retention_user_activity_daily") ||
		strings.Contains(message, "retention_user_activity_daily_mv") ||
		strings.Contains(message, "unknown table") ||
		strings.Contains(message, "unknown_table") ||
		strings.Contains(message, "code: 60")
}

func (s *ClickHouseStore) ensureRetentionTables(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS retention_user_activity_daily
(
    site_id      LowCardinality(String),
    activity_date Date,
    user_id      String,
    device_type  LowCardinality(String),
    country_code LowCardinality(String),
    country_name String,
    last_seen_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(last_seen_at)
PARTITION BY toYYYYMM(activity_date)
ORDER BY (site_id, activity_date, user_id)
TTL activity_date + INTERVAL 400 DAY`,
		`CREATE MATERIALIZED VIEW IF NOT EXISTS retention_user_activity_daily_mv
TO retention_user_activity_daily
AS
SELECT
    site_id,
    toDate(ts) AS activity_date,
    if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) AS user_id,
    if(length(JSONExtractString(meta, 'dt')) > 0, JSONExtractString(meta, 'dt'), '') AS device_type,
    upper(
        if(length(JSONExtractString(meta, 'gcc')) > 0, JSONExtractString(meta, 'gcc'),
           if(length(JSONExtractString(meta, 'ct')) > 0, JSONExtractString(meta, 'ct'), '')
        )
    ) AS country_code,
    if(length(JSONExtractString(meta, 'gct')) > 0, JSONExtractString(meta, 'gct'),
       if(length(JSONExtractString(meta, 'ctn')) > 0, JSONExtractString(meta, 'ctn'), '')
    ) AS country_name,
    max(ts) AS last_seen_at
FROM events
WHERE e = 'pageview'
  AND length(if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid)) > 0
GROUP BY site_id, activity_date, user_id, device_type, country_code, country_name`,
		`INSERT INTO retention_user_activity_daily
SELECT
    site_id,
    toDate(ts) AS activity_date,
    if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) AS user_id,
    if(length(JSONExtractString(meta, 'dt')) > 0, JSONExtractString(meta, 'dt'), '') AS device_type,
    upper(
        if(length(JSONExtractString(meta, 'gcc')) > 0, JSONExtractString(meta, 'gcc'),
           if(length(JSONExtractString(meta, 'ct')) > 0, JSONExtractString(meta, 'ct'), '')
        )
    ) AS country_code,
    if(length(JSONExtractString(meta, 'gct')) > 0, JSONExtractString(meta, 'gct'),
       if(length(JSONExtractString(meta, 'ctn')) > 0, JSONExtractString(meta, 'ctn'), '')
    ) AS country_name,
    max(ts) AS last_seen_at
FROM events
WHERE e = 'pageview'
  AND length(if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid)) > 0
GROUP BY site_id, activity_date, user_id, device_type, country_code, country_name`,
	}

	for _, statement := range statements {
		if err := s.executeStatement(ctx, statement); err != nil {
			return fmt.Errorf("ensure retention tables: %w", err)
		}
	}
	return nil
}

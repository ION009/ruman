package storage

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type clickHouseOverviewRow struct {
	Pageviews  int `json:"pageviews"`
	Visitors   int `json:"visitors"`
	Sessions   int `json:"sessions"`
	RageClicks int `json:"rage_clicks"`
}

type clickHouseSessionStatsRow struct {
	BounceSessions int     `json:"bounce_sessions"`
	AvgScrollDepth float64 `json:"avg_scroll_depth"`
}

type clickHouseTimeseriesRow struct {
	BucketMS  int64 `json:"bucket_ms"`
	Pageviews int   `json:"pageviews"`
	Sessions  int   `json:"sessions"`
}

type clickHousePageSummaryRow struct {
	Path           string  `json:"path"`
	Pageviews      int     `json:"pageviews"`
	Sessions       int     `json:"sessions"`
	AvgScrollDepth float64 `json:"avg_scroll_depth"`
	RageClicks     int     `json:"rage_clicks"`
}

type clickHouseReferrerSummaryRow struct {
	Referrer string `json:"referrer"`
	Visits   int    `json:"visits"`
}

type clickHouseDeviceSummaryRow struct {
	Device string `json:"device"`
	Visits int    `json:"visits"`
}

type clickHouseBrowserSummaryRow struct {
	Browser string `json:"browser"`
	Visits  int    `json:"visits"`
}

type clickHouseOperatingSystemSummaryRow struct {
	OS     string `json:"os"`
	Visits int    `json:"visits"`
}

type clickHouseScrollFunnelRow struct {
	Depth25  int `json:"depth_25"`
	Depth50  int `json:"depth_50"`
	Depth75  int `json:"depth_75"`
	Depth100 int `json:"depth_100"`
}

func (s *ClickHouseStore) queryDashboardSummary(
	ctx context.Context,
	siteID string,
	rangeValue TimeRange,
	now time.Time,
) (DashboardSummary, error) {
	since := rangeValue.Since(now.UTC())
	normalizedSiteID := strings.TrimSpace(siteID)

	overviewRows, err := clickHouseSelectRows[clickHouseOverviewRow](ctx, s, fmt.Sprintf(`
SELECT
	countIf(e = 'pageview') AS pageviews,
	uniqCombined64If(if(length(vid) > 0, vid, sid), e = 'pageview') AS visitors,
	uniqExactIf(sid, e = 'pageview') AS sessions,
	countIf(e = 'click' AND is_rage = 1) AS rage_clicks
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	sessionRows, err := clickHouseSelectRows[clickHouseSessionStatsRow](ctx, s, fmt.Sprintf(`
SELECT
	countIf(pageviews <= 1) AS bounce_sessions,
	toFloat64(ifNull(avgOrNull(max_scroll_depth), 0)) AS avg_scroll_depth
FROM (
	SELECT
		sid,
		countIf(e = 'pageview') AS pageviews,
		maxIf(toFloat64(depth), e = 'scroll' AND depth IS NOT NULL) AS max_scroll_depth
	FROM events
	WHERE site_id = %s
	  AND ts >= toDateTime64(%s, 3, 'UTC')
	GROUP BY sid
)
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	timeseriesRows, err := clickHouseSelectRows[clickHouseTimeseriesRow](ctx, s, fmt.Sprintf(`
SELECT
	toInt64(toUnixTimestamp(bucket)) * 1000 AS bucket_ms,
	countIf(e = 'pageview') AS pageviews,
	uniqExactIf(sid, e = 'pageview') AS sessions
FROM (
	SELECT
		%s AS bucket,
		e,
		sid
	FROM events
	WHERE site_id = %s
	  AND ts >= toDateTime64(%s, 3, 'UTC')
)
GROUP BY bucket
ORDER BY bucket ASC
FORMAT JSONEachRow
`, clickHouseBucketExpr(rangeValue), quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	pageRows, err := clickHouseSelectRows[clickHousePageSummaryRow](ctx, s, fmt.Sprintf(`
SELECT
	path,
	countIf(e = 'pageview') AS pageviews,
	uniqExactIf(sid, e = 'pageview') AS sessions,
	toFloat64(ifNull(avgIf(toFloat64(depth), e = 'scroll' AND depth IS NOT NULL), 0)) AS avg_scroll_depth,
	countIf(e = 'click' AND is_rage = 1) AS rage_clicks
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
GROUP BY path
ORDER BY pageviews DESC, rage_clicks DESC, path ASC
LIMIT 20
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	referrerRows, err := clickHouseSelectRows[clickHouseReferrerSummaryRow](ctx, s, fmt.Sprintf(`
SELECT
	referrer,
	count() AS visits
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
  AND e = 'pageview'
  AND referrer != ''
GROUP BY referrer
ORDER BY visits DESC, referrer ASC
LIMIT 6
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	deviceRows, err := clickHouseSelectRows[clickHouseDeviceSummaryRow](ctx, s, fmt.Sprintf(`
SELECT
	multiIf(
		lowerUTF8(device_type) = 'mobile', 'Mobile',
		lowerUTF8(device_type) = 'tablet', 'Tablet',
		lowerUTF8(device_type) = 'desktop', 'Desktop',
		device_type != '', device_type,
		viewport_w > 0 AND viewport_w < 768, 'Mobile',
		viewport_w >= 768 AND viewport_w < 1024, 'Tablet',
		viewport_w >= 1024, 'Desktop',
		'Unknown'
	) AS device,
	countIf(e = 'pageview') AS visits
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
GROUP BY device
ORDER BY visits DESC, device ASC
LIMIT 3
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	browserRows, err := clickHouseSelectRows[clickHouseBrowserSummaryRow](ctx, s, fmt.Sprintf(`
SELECT
	multiIf(
		lowerUTF8(browser) = 'chrome', 'Chrome',
		lowerUTF8(browser) = 'safari', 'Safari',
		lowerUTF8(browser) = 'firefox', 'Firefox',
		lowerUTF8(browser) = 'edge', 'Edge',
		browser = '', 'Unknown',
		browser
	) AS browser,
	countIf(e = 'pageview') AS visits
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
GROUP BY browser
ORDER BY visits DESC, browser ASC
LIMIT 4
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	operatingSystemRows, err := clickHouseSelectRows[clickHouseOperatingSystemSummaryRow](ctx, s, fmt.Sprintf(`
SELECT
	multiIf(
		lowerUTF8(os) = 'macos', 'macOS',
		lowerUTF8(os) = 'ios', 'iOS',
		lowerUTF8(os) = 'windows', 'Windows',
		lowerUTF8(os) = 'android', 'Android',
		lowerUTF8(os) = 'linux', 'Linux',
		os = '', 'Unknown',
		os
	) AS os,
	countIf(e = 'pageview') AS visits
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
GROUP BY os
ORDER BY visits DESC, os ASC
LIMIT 4
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	scrollRows, err := clickHouseSelectRows[clickHouseScrollFunnelRow](ctx, s, fmt.Sprintf(`
SELECT
	countIf(max_scroll_depth >= 25) AS depth_25,
	countIf(max_scroll_depth >= 50) AS depth_50,
	countIf(max_scroll_depth >= 75) AS depth_75,
	countIf(max_scroll_depth >= 100) AS depth_100
FROM (
	SELECT
		sid,
		maxIf(toInt32(depth), e = 'scroll' AND depth IS NOT NULL) AS max_scroll_depth
	FROM events
	WHERE site_id = %s
	  AND ts >= toDateTime64(%s, 3, 'UTC')
	GROUP BY sid
)
FORMAT JSONEachRow
`, quoteClickHouseString(normalizedSiteID), quoteClickHouseString(formatClickHouseTime(since))))
	if err != nil {
		return DashboardSummary{}, err
	}

	overview := clickHouseOverviewRow{}
	if len(overviewRows) > 0 {
		overview = overviewRows[0]
	}
	sessionStats := clickHouseSessionStatsRow{}
	if len(sessionRows) > 0 {
		sessionStats = sessionRows[0]
	}
	scrollStats := clickHouseScrollFunnelRow{}
	if len(scrollRows) > 0 {
		scrollStats = scrollRows[0]
	}

	timeseries := make([]TimeseriesPoint, 0, len(timeseriesRows))
	for _, row := range timeseriesRows {
		timeseries = append(timeseries, TimeseriesPoint{
			Timestamp: time.UnixMilli(row.BucketMS).UTC().Format(time.RFC3339),
			Pageviews: row.Pageviews,
			Sessions:  row.Sessions,
		})
	}

	topPages := make([]PageMetric, 0, len(pageRows))
	pageOptions := make([]PageOption, 0, len(pageRows))
	for _, row := range pageRows {
		path := normalizePath(row.Path)
		topPages = append(topPages, PageMetric{
			Path:           path,
			Pageviews:      row.Pageviews,
			Sessions:       row.Sessions,
			AvgScrollDepth: round1(row.AvgScrollDepth),
			RageClicks:     row.RageClicks,
		})
		pageOptions = append(pageOptions, PageOption{
			Path:      path,
			Pageviews: row.Pageviews,
		})
	}

	referrers := make([]ReferrerMetric, 0, len(referrerRows))
	for _, row := range referrerRows {
		referrers = append(referrers, ReferrerMetric{
			Source:    strings.TrimSpace(row.Referrer),
			Pageviews: row.Visits,
		})
	}

	devices := make([]DeviceMetric, 0, len(deviceRows))
	for _, row := range deviceRows {
		devices = append(devices, DeviceMetric{
			Device:    strings.TrimSpace(row.Device),
			Pageviews: row.Visits,
		})
	}

	browsers := make([]BrowserMetric, 0, len(browserRows))
	for _, row := range browserRows {
		browsers = append(browsers, BrowserMetric{
			Browser:   strings.TrimSpace(row.Browser),
			Pageviews: row.Visits,
		})
	}

	operatingSystems := make([]OperatingSystemMetric, 0, len(operatingSystemRows))
	for _, row := range operatingSystemRows {
		operatingSystems = append(operatingSystems, OperatingSystemMetric{
			OS:        strings.TrimSpace(row.OS),
			Pageviews: row.Visits,
		})
	}

	scrollFunnel := []DepthMetric{
		{Depth: 25, Sessions: scrollStats.Depth25},
		{Depth: 50, Sessions: scrollStats.Depth50},
		{Depth: 75, Sessions: scrollStats.Depth75},
		{Depth: 100, Sessions: scrollStats.Depth100},
	}

	return DashboardSummary{
		Range: rangeValue.String(),
		Overview: OverviewMetrics{
			RealtimeVisitors: 0,
			UniqueVisitors:   overview.Visitors,
			Pageviews:        overview.Pageviews,
			Sessions:         overview.Sessions,
			BounceRate:       percentage(sessionStats.BounceSessions, overview.Sessions),
			AvgScrollDepth:   round1(sessionStats.AvgScrollDepth),
			RageClicks:       overview.RageClicks,
		},
		Timeseries:       timeseries,
		TopPages:         limitSlice(topPages, 6),
		Referrers:        referrers,
		Devices:          devices,
		Browsers:         browsers,
		OperatingSystems: operatingSystems,
		ScrollFunnel:     scrollFunnel,
		Pages:            limitSlice(pageOptions, 12),
	}, nil
}

func clickHouseBucketExpr(rangeValue TimeRange) string {
	if rangeValue == Range24Hours {
		return "toStartOfHour(ts)"
	}
	return "toStartOfDay(ts)"
}

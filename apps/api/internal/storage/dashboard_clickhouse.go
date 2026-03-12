package storage

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type clickHouseDashboardEventRow struct {
	TimestampMS int64    `json:"ts_ms"`
	SessionID   string   `json:"sid"`
	VisitorID   string   `json:"vid"`
	Name        string   `json:"e"`
	Path        string   `json:"path"`
	X           *float64 `json:"x"`
	Y           *float64 `json:"y"`
	Selector    *string  `json:"sel"`
	Depth       *uint8   `json:"depth"`
	Meta        string   `json:"meta"`
}

type clickHouseHeatmapBucketRow struct {
	Name       string  `json:"e"`
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Count      int     `json:"count"`
	RageCount  int     `json:"rage_count"`
	DeadCount  int     `json:"dead_count"`
	ErrorCount int     `json:"error_count"`
}

type clickHouseSiteStatsRow struct {
	TotalEvents  int    `json:"total_events"`
	TrackedPages int    `json:"tracked_pages"`
	FirstSeenMS  *int64 `json:"first_seen_ms"`
	LastSeenMS   *int64 `json:"last_seen_ms"`
}

const heatmapQueryEventLimit = 100000

func (s *ClickHouseStore) DashboardSummary(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (DashboardSummary, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	baselineRange := comparisonTimeRange(comparisonRange, comparisonRange.Until(now.UTC()))
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), baselineRange.Since(now.UTC()))
	if err != nil {
		return DashboardSummary{}, err
	}
	return buildDashboardSummary(events, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) Map(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (MapView, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	events, err := s.loadMapEvents(ctx, strings.TrimSpace(siteID), comparisonRange.Since(now.UTC()))
	if err != nil {
		return MapView{}, err
	}
	return buildMapView(events, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) Journeys(
	ctx context.Context,
	siteID string,
	query JourneyQuery,
	rangeValue TimeRange,
	now time.Time,
) (JourneysView, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return JourneysView{}, err
	}
	return buildJourneysView(events, query, rangeValue), nil
}

func (s *ClickHouseStore) FunnelReport(
	ctx context.Context,
	siteID string,
	query FunnelQuery,
	rangeValue TimeRange,
	now time.Time,
) (FunnelReport, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return FunnelReport{}, err
	}
	return buildFunnelReport(events, query, rangeValue), nil
}

func (s *ClickHouseStore) FunnelEntities(
	ctx context.Context,
	siteID string,
	query FunnelQuery,
	stepIndex int,
	status FunnelEntityStatus,
	page int,
	limit int,
	rangeValue TimeRange,
	now time.Time,
) (FunnelEntityList, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return FunnelEntityList{}, err
	}
	return buildFunnelEntities(events, query, stepIndex, status, page, limit, rangeValue), nil
}

func (s *ClickHouseStore) Heatmap(
	ctx context.Context,
	siteID, path string,
	rangeValue TimeRange,
	mode HeatmapMode,
	clickFilter HeatmapClickFilter,
	viewportSegment HeatmapViewportSegment,
	now time.Time,
) (HeatmapView, error) {
	since := rangeValue.Since(now.UTC())
	pageOptions, err := s.loadHeatmapPageOptions(ctx, strings.TrimSpace(siteID), since)
	if err != nil {
		return HeatmapView{}, err
	}

	selectedPath := normalizePath(path)
	if strings.TrimSpace(path) == "" && len(pageOptions) > 0 {
		selectedPath = pageOptions[0].Path
	}
	if len(pageOptions) > 0 && !containsPageOption(pageOptions, selectedPath) {
		selectedPath = pageOptions[0].Path
	}

	events, err := s.loadHeatmapEvents(ctx, strings.TrimSpace(siteID), selectedPath, since)
	if err != nil {
		return HeatmapView{}, err
	}

	view := buildHeatmapView(events, selectedPath, rangeValue, mode, clickFilter, viewportSegment, now.UTC())
	view.Path = selectedPath
	view.Paths = pageOptions
	return view, nil
}

func (s *ClickHouseStore) Insights(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (InsightsView, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return InsightsView{}, err
	}
	return buildInsightsView(events, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) EventNames(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]EventNameMetric, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return nil, err
	}
	return buildEventNameMetrics(events), nil
}

func (s *ClickHouseStore) EventExplorer(
	ctx context.Context,
	siteID string,
	query EventExplorerQuery,
	rangeValue TimeRange,
	now time.Time,
) (EventExplorerView, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), comparisonRange.Since(now.UTC()))
	if err != nil {
		return EventExplorerView{}, err
	}
	return buildEventExplorerView(events, query, rangeValue, now.UTC()), nil
}

func (s *ClickHouseStore) ExportEvents(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]ExportEvent, error) {
	events, err := s.loadDashboardEvents(ctx, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return nil, err
	}
	return exportDashboardEvents(events), nil
}

func (s *ClickHouseStore) SiteStats(ctx context.Context, siteID string) (SiteStats, error) {
	phase2Query := fmt.Sprintf(`
SELECT
	count() AS total_events,
	uniqExact(path) AS tracked_pages,
	minOrNull(toUnixTimestamp64Milli(ts)) AS first_seen_ms,
	maxOrNull(toUnixTimestamp64Milli(ts)) AS last_seen_ms
FROM events
WHERE site_id = %s
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)))

	rows, err := clickHouseSelectRows[clickHouseSiteStatsRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	count() AS total_events,
	uniqExact(path) AS tracked_pages,
	minOrNull(toInt64(toUnixTimestamp(timestamp)) * 1000) AS first_seen_ms,
	maxOrNull(toInt64(toUnixTimestamp(timestamp)) * 1000) AS last_seen_ms
FROM events
WHERE site_id = %s
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)))
		rows, err = clickHouseSelectRows[clickHouseSiteStatsRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return SiteStats{}, err
	}
	if len(rows) == 0 {
		return SiteStats{}, nil
	}

	stats := SiteStats{
		TotalEvents:  rows[0].TotalEvents,
		TrackedPages: rows[0].TrackedPages,
	}
	if rows[0].FirstSeenMS != nil {
		value := time.UnixMilli(*rows[0].FirstSeenMS).UTC()
		stats.FirstSeen = &value
	}
	if rows[0].LastSeenMS != nil {
		value := time.UnixMilli(*rows[0].LastSeenMS).UTC()
		stats.LastSeen = &value
	}
	return stats, nil
}

func (s *ClickHouseStore) loadDashboardEvents(ctx context.Context, siteID string, since time.Time) ([]dashboardEvent, error) {
	phase2Query := fmt.Sprintf(`
SELECT
	toUnixTimestamp64Milli(ts) AS ts_ms,
	sid,
	if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) AS vid,
	e,
	path,
	x,
	y,
	sel,
	depth,
	meta
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
ORDER BY ts ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))

	rows, err := clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	toInt64(toUnixTimestamp(timestamp)) * 1000 AS ts_ms,
	if(length(session_id) > 0, session_id, visitor_id) AS sid,
	if(length(visitor_id) > 0, visitor_id, if(length(JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid')) > 0, JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid'), if(length(session_id) > 0, session_id, visitor_id))) AS vid,
	if(type = 'pageview', 'pageview', if(length(name) > 0, name, 'event')) AS e,
	path,
	toFloat64OrNull(nullIf(props['x'], '')) AS x,
	toFloat64OrNull(nullIf(props['y'], '')) AS y,
	nullIf(props['sel'], '') AS sel,
	toUInt8OrNull(nullIf(props['depth'], '')) AS depth,
	nullIf(props['meta'], '') AS meta
FROM events
WHERE site_id = %s
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
ORDER BY timestamp ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))
		rows, err = clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, err
	}

	events := make([]dashboardEvent, 0, len(rows))
	for _, row := range rows {
		meta := map[string]any{}
		if strings.TrimSpace(row.Meta) != "" {
			if err := json.Unmarshal([]byte(row.Meta), &meta); err != nil {
				return nil, err
			}
		}

		event := dashboardEvent{
			Timestamp: time.UnixMilli(row.TimestampMS).UTC(),
			SessionID: strings.TrimSpace(row.SessionID),
			VisitorID: strings.TrimSpace(row.VisitorID),
			Name:      strings.TrimSpace(row.Name),
			Path:      normalizePath(row.Path),
			Selector:  strings.TrimSpace(valueOrEmpty(row.Selector)),
			X:         row.X,
			Y:         row.Y,
			Meta:      meta,
		}
		if row.Depth != nil {
			event.Depth = int(*row.Depth)
			event.HasDepth = true
		}

		events = append(events, event)
	}

	return events, nil
}

func (s *ClickHouseStore) loadMapEvents(ctx context.Context, siteID string, since time.Time) ([]dashboardEvent, error) {
	phase2Query := fmt.Sprintf(`
SELECT
	toUnixTimestamp64Milli(ts) AS ts_ms,
	sid,
	if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) AS vid,
	e,
	path,
	x,
	y,
	sel,
	depth,
	meta
FROM events
WHERE site_id = %s
  AND e = 'pageview'
  AND ts >= toDateTime64(%s, 3, 'UTC')
ORDER BY ts ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))

	rows, err := clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	toInt64(toUnixTimestamp(timestamp)) * 1000 AS ts_ms,
	if(length(session_id) > 0, session_id, visitor_id) AS sid,
	if(length(visitor_id) > 0, visitor_id, if(length(JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid')) > 0, JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid'), if(length(session_id) > 0, session_id, visitor_id))) AS vid,
	'pageview' AS e,
	path,
	toFloat64OrNull(nullIf(props['x'], '')) AS x,
	toFloat64OrNull(nullIf(props['y'], '')) AS y,
	nullIf(props['sel'], '') AS sel,
	toUInt8OrNull(nullIf(props['depth'], '')) AS depth,
	nullIf(props['meta'], '') AS meta
FROM events
WHERE site_id = %s
  AND type = 'pageview'
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
ORDER BY timestamp ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))
		rows, err = clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, err
	}

	events := make([]dashboardEvent, 0, len(rows))
	for _, row := range rows {
		meta := map[string]any{}
		if strings.TrimSpace(row.Meta) != "" {
			if err := json.Unmarshal([]byte(row.Meta), &meta); err != nil {
				return nil, err
			}
		}

		events = append(events, dashboardEvent{
			Timestamp: time.UnixMilli(row.TimestampMS).UTC(),
			SessionID: strings.TrimSpace(row.SessionID),
			VisitorID: strings.TrimSpace(row.VisitorID),
			Name:      "pageview",
			Path:      normalizePath(row.Path),
			Selector:  strings.TrimSpace(valueOrEmpty(row.Selector)),
			X:         row.X,
			Y:         row.Y,
			Meta:      meta,
		})
	}

	return events, nil
}

func (s *ClickHouseStore) loadHeatmapPageOptions(ctx context.Context, siteID string, since time.Time) ([]PageOption, error) {
	phase2Query := fmt.Sprintf(`
SELECT
	path,
	countIf(e = 'pageview') AS pageviews
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
GROUP BY path
ORDER BY pageviews DESC, path ASC
LIMIT 12
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))

	rows, err := clickHouseSelectRows[PageOption](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	path,
	countIf(type = 'pageview') AS pageviews
FROM events
WHERE site_id = %s
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
GROUP BY path
ORDER BY pageviews DESC, path ASC
LIMIT 12
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)))
		rows, err = clickHouseSelectRows[PageOption](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, err
	}

	options := make([]PageOption, 0, len(rows))
	for _, row := range rows {
		options = append(options, PageOption{
			Path:      normalizePath(row.Path),
			Pageviews: row.Pageviews,
		})
	}
	return options, nil
}

func (s *ClickHouseStore) loadHeatmapEvents(ctx context.Context, siteID, path string, since time.Time) ([]dashboardEvent, error) {
	normalizedPath := normalizePath(path)
	if normalizedPath == "" {
		return nil, nil
	}

	total, err := s.countHeatmapEvents(ctx, siteID, normalizedPath, since)
	if err != nil {
		return nil, err
	}
	divisor := 1
	if total > heatmapQueryEventLimit {
		divisor = total / heatmapQueryEventLimit
		if total%heatmapQueryEventLimit != 0 {
			divisor += 1
		}
	}

	phase2Query := fmt.Sprintf(`
SELECT
	toUnixTimestamp64Milli(ts) AS ts_ms,
	sid,
	if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) AS vid,
	e,
	path,
	x,
	y,
	sel,
	depth,
	meta
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
  AND path = %s
  AND (1 = %d OR cityHash64(sid) %% %d = 0)
ORDER BY ts ASC
LIMIT %d
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(normalizedPath), divisor, divisor, heatmapQueryEventLimit)

	rows, err := clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	toInt64(toUnixTimestamp(timestamp)) * 1000 AS ts_ms,
	if(length(session_id) > 0, session_id, visitor_id) AS sid,
	if(length(visitor_id) > 0, visitor_id, if(length(JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid')) > 0, JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid'), if(length(session_id) > 0, session_id, visitor_id))) AS vid,
	if(type = 'pageview', 'pageview', if(length(name) > 0, name, 'event')) AS e,
	path,
	toFloat64OrNull(nullIf(props['x'], '')) AS x,
	toFloat64OrNull(nullIf(props['y'], '')) AS y,
	nullIf(props['sel'], '') AS sel,
	toUInt8OrNull(nullIf(props['depth'], '')) AS depth,
	nullIf(props['meta'], '') AS meta
FROM events
WHERE site_id = %s
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
  AND path = %s
  AND (1 = %d OR cityHash64(session_id) %% %d = 0)
ORDER BY timestamp ASC
LIMIT %d
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(normalizedPath), divisor, divisor, heatmapQueryEventLimit)
		rows, err = clickHouseSelectRows[clickHouseDashboardEventRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, err
	}

	events := make([]dashboardEvent, 0, len(rows))
	for _, row := range rows {
		meta := map[string]any{}
		if strings.TrimSpace(row.Meta) != "" {
			if err := json.Unmarshal([]byte(row.Meta), &meta); err != nil {
				return nil, err
			}
		}

		event := dashboardEvent{
			Timestamp: time.UnixMilli(row.TimestampMS).UTC(),
			SessionID: strings.TrimSpace(row.SessionID),
			VisitorID: strings.TrimSpace(row.VisitorID),
			Name:      strings.TrimSpace(row.Name),
			Path:      normalizePath(row.Path),
			Selector:  strings.TrimSpace(valueOrEmpty(row.Selector)),
			X:         row.X,
			Y:         row.Y,
			Meta:      meta,
		}
		if event.VisitorID == "" {
			event.VisitorID = strings.TrimSpace(metaString(meta, "vid"))
		}
		if row.Depth != nil {
			event.Depth = int(*row.Depth)
			event.HasDepth = true
		}
		events = append(events, event)
	}

	return events, nil
}

func (s *ClickHouseStore) countHeatmapEvents(ctx context.Context, siteID, path string, since time.Time) (int, error) {
	phase2Query := fmt.Sprintf(`
SELECT count() AS count
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
  AND path = %s
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(path))

	rows, err := clickHouseSelectRows[clickHouseCountRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT count() AS count
FROM events
WHERE site_id = %s
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
  AND path = %s
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(path))
		rows, err = clickHouseSelectRows[clickHouseCountRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}
	return rows[0].Count, nil
}

func containsPageOption(options []PageOption, path string) bool {
	for _, option := range options {
		if normalizePath(option.Path) == normalizePath(path) {
			return true
		}
	}
	return false
}

func (s *ClickHouseStore) loadHeatmapBuckets(
	ctx context.Context,
	siteID, path string,
	since time.Time,
	viewportSegment HeatmapViewportSegment,
) ([]HeatmapBucket, []HeatmapBucket, error) {
	phase2ViewportFilter := clickHouseViewportFilter(viewportSegment, "meta")
	phase2Query := fmt.Sprintf(`
SELECT
	e,
	round(toFloat64(x) * 4) / 4 AS x,
	round(toFloat64(y) * 4) / 4 AS y,
	count() AS count,
	sum(toUInt8(JSONExtractBool(meta, 'rg'))) AS rage_count,
	sum(toUInt8(JSONExtractBool(meta, 'dg'))) AS dead_count,
	sum(toUInt8(JSONExtractBool(meta, 'eg'))) AS error_count
FROM events
WHERE site_id = %s
  AND ts >= toDateTime64(%s, 3, 'UTC')
	AND path = %s
	AND e IN ('click', 'move')
	AND x IS NOT NULL
	AND y IS NOT NULL
	AND %s
GROUP BY e, x, y
ORDER BY e ASC, x ASC, y ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(normalizePath(path)), phase2ViewportFilter)

	rows, err := clickHouseSelectRows[clickHouseHeatmapBucketRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyViewportFilter := clickHouseViewportFilter(viewportSegment, "ifNull(nullIf(props['meta'], ''), '{}')")
		legacyQuery := fmt.Sprintf(`
SELECT
	if(length(name) > 0, name, 'click') AS e,
	round(toFloat64OrZero(nullIf(props['x'], '')) * 4) / 4 AS x,
	round(toFloat64OrZero(nullIf(props['y'], '')) * 4) / 4 AS y,
	count() AS count,
	sum(toUInt8OrZero(nullIf(props['rg'], ''))) AS rage_count,
	sum(toUInt8OrZero(nullIf(props['dg'], ''))) AS dead_count,
	sum(toUInt8OrZero(nullIf(props['eg'], ''))) AS error_count
FROM events
WHERE site_id = %s
  AND timestamp >= toDateTime64(%s, 3, 'UTC')
  AND path = %s
	AND type = 'custom'
	AND name IN ('click', 'move')
	AND nullIf(props['x'], '') IS NOT NULL
	AND nullIf(props['y'], '') IS NOT NULL
	AND %s
GROUP BY e, x, y
ORDER BY e ASC, x ASC, y ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(normalizePath(path)), legacyViewportFilter)
		rows, err = clickHouseSelectRows[clickHouseHeatmapBucketRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, nil, err
	}

	clickBuckets := make([]HeatmapBucket, 0, len(rows))
	moveBuckets := make([]HeatmapBucket, 0, len(rows))
	for _, row := range rows {
		bucket := HeatmapBucket{
			X:          row.X,
			Y:          row.Y,
			Count:      row.Count,
			Weight:     float64(row.Count),
			Sessions:   row.Count,
			Visitors:   row.Count,
			RageCount:  row.RageCount,
			DeadCount:  row.DeadCount,
			ErrorCount: row.ErrorCount,
		}
		switch strings.TrimSpace(row.Name) {
		case "move":
			moveBuckets = append(moveBuckets, bucket)
		default:
			clickBuckets = append(clickBuckets, bucket)
		}
	}
	return clickBuckets, moveBuckets, nil
}

func clickHouseSelectRows[T any](ctx context.Context, s *ClickHouseStore, query string) ([]T, error) {
	requestURL := fmt.Sprintf(
		"%s/?database=%s&output_format_json_quote_64bit_integers=0&query=%s",
		s.baseURL,
		url.QueryEscape(s.database),
		url.QueryEscape(query),
	)

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, requestURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create clickhouse select request: %w", err)
	}
	if s.username != "" {
		request.SetBasicAuth(s.username, s.password)
	}

	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("query clickhouse: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode >= http.StatusMultipleChoices {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return nil, fmt.Errorf("clickhouse query failed: %s", strings.TrimSpace(string(message)))
	}

	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)

	rows := []T{}
	for scanner.Scan() {
		var row T
		if err := json.Unmarshal(scanner.Bytes(), &row); err != nil {
			return nil, fmt.Errorf("decode clickhouse row: %w", err)
		}
		rows = append(rows, row)
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan clickhouse rows: %w", err)
	}

	return rows, nil
}

func quoteClickHouseString(value string) string {
	escaped := strings.ReplaceAll(value, "\\", "\\\\")
	escaped = strings.ReplaceAll(escaped, "'", "\\'")
	return "'" + escaped + "'"
}

func clickHouseViewportFilter(segment HeatmapViewportSegment, metaExpr string) string {
	widthExpr := fmt.Sprintf("toInt32OrZero(JSONExtractInt(%s, 'vw'))", metaExpr)
	switch ParseHeatmapViewportSegment(string(segment)) {
	case HeatmapViewportSegmentMobile:
		return fmt.Sprintf("%s > 0 AND %s < 768", widthExpr, widthExpr)
	case HeatmapViewportSegmentTablet:
		return fmt.Sprintf("%s >= 768 AND %s < 1024", widthExpr, widthExpr)
	case HeatmapViewportSegmentDesktop:
		return fmt.Sprintf("%s >= 1024", widthExpr)
	default:
		return "1 = 1"
	}
}

func formatClickHouseTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05.000")
}

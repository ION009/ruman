package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

type clickHouseUserProfileRow struct {
	UserKey   string `json:"user_key"`
	UserHash  string `json:"user_hash"`
	FirstSeen string `json:"first_seen"`
	LastSeen  string `json:"last_seen"`
	Country   string `json:"country"`
	State     string `json:"state"`
	Browser   string `json:"browser"`
	OS        string `json:"os"`
}

type clickHouseUserActivityRow struct {
	UserKey   string `json:"user_key"`
	UserHash  string `json:"user_hash"`
	Pageviews int    `json:"pageviews"`
	Events    int    `json:"events"`
}

func (s *ClickHouseStore) UserList(ctx context.Context, siteID string, query UserListQuery, rangeValue TimeRange, now time.Time) (UserList, error) {
	siteID = strings.TrimSpace(siteID)
	profiles, activity, err := s.loadUserAggregates(ctx, siteID, rangeValue, now)
	if err != nil {
		return UserList{}, err
	}

	rows := make([]UserRow, 0, len(activity))
	for userKey, counts := range activity {
		profile := profiles[userKey]
		if profile.UserHash == "" {
			profile.UserHash = UserHash(siteID, userKey)
		}
		if profile.Alias == "" {
			profile.Alias = FictionalUserName(profile.UserHash)
		}
		row := UserRow{
			UserKey:   userKey,
			UserHash:  profile.UserHash,
			Alias:     profile.Alias,
			Country:   firstNonEmptyString(profile.Country, "Unknown"),
			State:     firstNonEmptyString(profile.State, "Unknown"),
			Browser:   firstNonEmptyString(profile.Browser, "Unknown"),
			OS:        firstNonEmptyString(profile.OS, "Unknown"),
			Pageviews: counts.Pageviews,
			Events:    counts.Events,
			FirstSeen: profile.FirstSeen.UTC().Format(time.RFC3339),
			LastSeen:  profile.LastSeen.UTC().Format(time.RFC3339),
		}
		rows = append(rows, row)
	}

	normalized, total, paged := FilterAndPaginateUserRows(rows, query)
	if len(paged) > 0 {
		userKeys := make([]string, 0, len(paged))
		for _, row := range paged {
			userKeys = append(userKeys, row.UserKey)
		}
		rangeEvents, loadErr := s.loadUserEvents(ctx, siteID, userKeys, rangeValue.Since(now.UTC()), now.UTC())
		if loadErr == nil {
			highlights := buildUserRows(siteID, rangeEvents, rangeEvents)
			byHash := map[string]UserRow{}
			for _, row := range highlights {
				byHash[row.UserHash] = row
			}
			for index := range paged {
				if highlight, ok := byHash[paged[index].UserHash]; ok {
					paged[index].TopPages = highlight.TopPages
					paged[index].TopEvents = highlight.TopEvents
				}
			}
		}
	}

	return UserList{
		Range: rangeValue.String(),
		Page:  normalized.Page,
		Limit: normalized.Limit,
		Total: total,
		Sort:  normalized.Sort,
		Order: normalized.Order,
		Filters: UserListFilters{
			Search:  normalized.Search,
			Country: normalized.Country,
			Region:  normalized.Region,
			Browser: normalized.Browser,
			OS:      normalized.OS,
		},
		Privacy: DefaultUserPrivacyNote(),
		Users:   paged,
	}, nil
}

func (s *ClickHouseStore) UserDetail(ctx context.Context, siteID, userHash string, rangeValue TimeRange, now time.Time) (UserDetail, error) {
	siteID = strings.TrimSpace(siteID)
	userHash = strings.TrimSpace(strings.ToLower(userHash))
	if userHash == "" {
		return UserDetail{}, errors.New("user hash is required")
	}

	profiles, _, err := s.loadUserAggregates(ctx, siteID, rangeValue, now)
	if err != nil {
		return UserDetail{}, err
	}

	userKey := ""
	for key, profile := range profiles {
		if strings.EqualFold(profile.UserHash, userHash) {
			userKey = key
			break
		}
	}
	if userKey == "" {
		return UserDetail{}, errors.New("user not found")
	}

	lifetimeEvents, err := s.loadUserEvents(ctx, siteID, []string{userKey}, time.Unix(0, 0).UTC(), now.UTC())
	if err != nil {
		return UserDetail{}, err
	}
	rangeEvents, err := s.loadUserEvents(ctx, siteID, []string{userKey}, rangeValue.Since(now.UTC()), now.UTC())
	if err != nil {
		return UserDetail{}, err
	}
	replaySessions, _ := s.loadUserReplaySessions(ctx, siteID, userKey, rangeValue.Since(now.UTC()), now.UTC())

	detail, ok := buildUserDetail(siteID, userHash, lifetimeEvents, rangeEvents, replaySessions)
	if !ok {
		return UserDetail{}, errors.New("user not found")
	}
	detail.Range = rangeValue.String()
	return detail, nil
}

func (s *ClickHouseStore) loadUserAggregates(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (map[string]userProfileAggregate, map[string]clickHouseUserActivityRow, error) {
	profiles, err := s.loadUserProfiles(ctx, siteID)
	if err != nil && !isMissingUserAggregateTable(err) {
		return nil, nil, err
	}
	activity, activityErr := s.loadUserActivity(ctx, siteID, rangeValue.Since(now.UTC()), now.UTC())
	if activityErr != nil && !isMissingUserAggregateTable(activityErr) {
		return nil, nil, activityErr
	}
	if err == nil && activityErr == nil {
		return profiles, activity, nil
	}

	lifetimeEvents, fallbackErr := s.loadUserEvents(ctx, siteID, nil, time.Unix(0, 0).UTC(), now.UTC())
	if fallbackErr != nil {
		return nil, nil, fallbackErr
	}
	rangeEvents, fallbackErr := s.loadUserEvents(ctx, siteID, nil, rangeValue.Since(now.UTC()), now.UTC())
	if fallbackErr != nil {
		return nil, nil, fallbackErr
	}

	fallbackProfiles := map[string]userProfileAggregate{}
	for _, row := range buildUserRows(siteID, lifetimeEvents, rangeEvents) {
		firstSeen, _ := time.Parse(time.RFC3339, row.FirstSeen)
		lastSeen, _ := time.Parse(time.RFC3339, row.LastSeen)
		fallbackProfiles[row.UserKey] = userProfileAggregate{
			UserKey:   row.UserKey,
			UserHash:  row.UserHash,
			Alias:     row.Alias,
			Country:   row.Country,
			State:     row.State,
			Browser:   row.Browser,
			OS:        row.OS,
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
			Pageviews: row.Pageviews,
			Events:    row.Events,
		}
	}
	fallbackActivity := map[string]clickHouseUserActivityRow{}
	for _, row := range buildUserRows(siteID, lifetimeEvents, rangeEvents) {
		fallbackActivity[row.UserKey] = clickHouseUserActivityRow{
			UserKey:   row.UserKey,
			UserHash:  row.UserHash,
			Pageviews: row.Pageviews,
			Events:    row.Events,
		}
	}
	return fallbackProfiles, fallbackActivity, nil
}

func (s *ClickHouseStore) loadUserProfiles(ctx context.Context, siteID string) (map[string]userProfileAggregate, error) {
	query := fmt.Sprintf(`
SELECT
    user_key,
    user_hash,
    formatDateTime(minMerge(first_seen_state), '%%Y-%%m-%%dT%%H:%%i:%%SZ') AS first_seen,
    formatDateTime(maxMerge(last_seen_state), '%%Y-%%m-%%dT%%H:%%i:%%SZ') AS last_seen,
    anyLastMerge(country_state) AS country,
    anyLastMerge(region_state) AS state,
    anyLastMerge(browser_state) AS browser,
    anyLastMerge(os_state) AS os
FROM user_profiles
WHERE site_id = %s
GROUP BY user_key, user_hash
FORMAT JSONEachRow
`, quoteClickHouseString(siteID))
	rows, err := clickHouseSelectRows[clickHouseUserProfileRow](ctx, s, query)
	if err != nil {
		return nil, err
	}

	profiles := make(map[string]userProfileAggregate, len(rows))
	for _, row := range rows {
		firstSeen, _ := time.Parse(time.RFC3339, row.FirstSeen)
		lastSeen, _ := time.Parse(time.RFC3339, row.LastSeen)
		profiles[row.UserKey] = userProfileAggregate{
			UserKey:   row.UserKey,
			UserHash:  strings.TrimSpace(strings.ToLower(row.UserHash)),
			Alias:     FictionalUserName(strings.TrimSpace(strings.ToLower(row.UserHash))),
			Country:   strings.TrimSpace(strings.ToUpper(row.Country)),
			State:     strings.TrimSpace(strings.ToUpper(row.State)),
			Browser:   strings.TrimSpace(row.Browser),
			OS:        strings.TrimSpace(row.OS),
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
		}
	}
	return profiles, nil
}

func (s *ClickHouseStore) loadUserActivity(ctx context.Context, siteID string, since, until time.Time) (map[string]clickHouseUserActivityRow, error) {
	query := fmt.Sprintf(`
SELECT
    user_key,
    user_hash,
    toInt32(sum(pageviews)) AS pageviews,
    toInt32(sum(events)) AS events
FROM user_activity_daily
WHERE site_id = %s
  AND activity_date >= toDate(%s)
  AND activity_date <= toDate(%s)
GROUP BY user_key, user_hash
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(since.UTC().Format("2006-01-02")), quoteClickHouseString(until.UTC().Format("2006-01-02")))
	rows, err := clickHouseSelectRows[clickHouseUserActivityRow](ctx, s, query)
	if err != nil {
		return nil, err
	}

	activity := make(map[string]clickHouseUserActivityRow, len(rows))
	for _, row := range rows {
		activity[row.UserKey] = row
	}
	return activity, nil
}

func (s *ClickHouseStore) loadUserEvents(ctx context.Context, siteID string, userKeys []string, since, until time.Time) ([]dashboardEvent, error) {
	phase2Filter := "1 = 1"
	legacyFilter := "1 = 1"
	if len(userKeys) > 0 {
		quoted := make([]string, 0, len(userKeys))
		for _, userKey := range userKeys {
			quoted = append(quoted, quoteClickHouseString(userKey))
		}
		phase2Filter = fmt.Sprintf("if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), sid) IN (%s)", strings.Join(quoted, ", "))
		legacyFilter = fmt.Sprintf("if(length(visitor_id) > 0, visitor_id, if(length(JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid')) > 0, JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid'), if(length(session_id) > 0, session_id, visitor_id))) IN (%s)", strings.Join(quoted, ", "))
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
  AND ts <= toDateTime64(%s, 3, 'UTC')
  AND %s
ORDER BY ts ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(formatClickHouseTime(until)), phase2Filter)

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
  AND timestamp <= toDateTime64(%s, 3, 'UTC')
  AND %s
ORDER BY timestamp ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(formatClickHouseTime(until)), legacyFilter)
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

func (s *ClickHouseStore) loadUserReplaySessions(ctx context.Context, siteID, userKey string, since, until time.Time) ([]ReplaySessionSummary, error) {
	query := fmt.Sprintf(`
SELECT
    session_id,
    toUnixTimestamp64Milli(started_at) AS started_at_ms,
    toUnixTimestamp64Milli(updated_at) AS updated_at_ms,
    duration_ms,
    entry_path,
    exit_path,
    page_count,
    route_count,
    chunk_count,
    event_count,
    error_count,
    console_error_count,
    network_failure_count,
    rage_click_count,
    dead_click_count,
    custom_event_count,
    device_type,
    browser,
    os,
    viewport_width,
    viewport_height,
    viewport_bucket,
    paths,
    sample_rate
FROM replay_sessions FINAL
WHERE site_id = %s
  AND visitor_id = %s
  AND updated_at >= toDateTime64(%s, 3, 'UTC')
  AND updated_at <= toDateTime64(%s, 3, 'UTC')
ORDER BY updated_at DESC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(userKey), quoteClickHouseString(formatClickHouseTime(since)), quoteClickHouseString(formatClickHouseTime(until)))
	rows, err := clickHouseSelectRows[clickHouseReplaySessionRow](ctx, s, query)
	if err != nil {
		return nil, err
	}

	output := make([]ReplaySessionSummary, 0, len(rows))
	for _, row := range rows {
		output = append(output, ReplaySessionSummary{
			SessionID:           row.SessionID,
			StartedAt:           time.UnixMilli(row.StartedAtMS).UTC().Format(time.RFC3339),
			UpdatedAt:           time.UnixMilli(row.UpdatedAtMS).UTC().Format(time.RFC3339),
			DurationMS:          row.DurationMS,
			EntryPath:           row.EntryPath,
			ExitPath:            row.ExitPath,
			PageCount:           row.PageCount,
			RouteCount:          row.RouteCount,
			ChunkCount:          row.ChunkCount,
			EventCount:          row.EventCount,
			ErrorCount:          row.ErrorCount,
			ConsoleErrorCount:   row.ConsoleErrorCount,
			NetworkFailureCount: row.NetworkFailureCount,
			RageClickCount:      row.RageClickCount,
			DeadClickCount:      row.DeadClickCount,
			CustomEventCount:    row.CustomEventCount,
			DeviceType:          row.DeviceType,
			Browser:             row.Browser,
			OS:                  row.OS,
			Viewport: ReplayViewport{
				Width:  row.ViewportWidth,
				Height: row.ViewportHeight,
				Bucket: row.ViewportBucket,
			},
			Paths:      row.Paths,
			SampleRate: row.SampleRate,
		})
	}
	return output, nil
}

func isMissingUserAggregateTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "user_profiles") || strings.Contains(message, "user_activity_daily")
}

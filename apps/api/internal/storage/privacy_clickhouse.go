package storage

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type clickHouseCountRow struct {
	Count int `json:"count"`
}

type clickHouseVisitorEventRow struct {
	SiteID      string   `json:"site_id"`
	TimestampMS int64    `json:"ts_ms"`
	SessionID   string   `json:"sid"`
	Name        string   `json:"e"`
	Path        string   `json:"path"`
	X           *float64 `json:"x"`
	Y           *float64 `json:"y"`
	Selector    *string  `json:"sel"`
	Depth       *uint8   `json:"depth"`
	Meta        string   `json:"meta"`
}

type clickHouseVisitorReplaySessionExportRow struct {
	SiteID              string   `json:"site_id"`
	SessionID           string   `json:"session_id"`
	StartedAtMS         int64    `json:"started_at_ms"`
	UpdatedAtMS         int64    `json:"updated_at_ms"`
	DurationMS          int      `json:"duration_ms"`
	EntryPath           string   `json:"entry_path"`
	ExitPath            string   `json:"exit_path"`
	PageCount           int      `json:"page_count"`
	RouteCount          int      `json:"route_count"`
	ChunkCount          int      `json:"chunk_count"`
	EventCount          int      `json:"event_count"`
	ErrorCount          int      `json:"error_count"`
	ConsoleErrorCount   int      `json:"console_error_count"`
	NetworkFailureCount int      `json:"network_failure_count"`
	RageClickCount      int      `json:"rage_click_count"`
	DeadClickCount      int      `json:"dead_click_count"`
	CustomEventCount    int      `json:"custom_event_count"`
	DeviceType          string   `json:"device_type"`
	Browser             string   `json:"browser"`
	OS                  string   `json:"os"`
	ViewportWidth       int      `json:"viewport_width"`
	ViewportHeight      int      `json:"viewport_height"`
	ViewportBucket      string   `json:"viewport_bucket"`
	Paths               []string `json:"paths"`
	SampleRate          float64  `json:"sample_rate"`
}

type clickHouseVisitorReplayChunkExportRow struct {
	SiteID      string `json:"site_id"`
	SessionID   string `json:"session_id"`
	VisitorID   string `json:"visitor_id"`
	ChunkIndex  int    `json:"chunk_index"`
	Reason      string `json:"reason"`
	StartedAtMS int64  `json:"started_at_ms"`
	EndedAtMS   int64  `json:"ended_at_ms"`
	Path        string `json:"path"`
	EventCount  int    `json:"event_count"`
	SummaryJSON string `json:"summary_json"`
	EventsJSON  string `json:"events_json"`
}

func (s *ClickHouseStore) ExportVisitor(ctx context.Context, visitorID string) (VisitorExport, error) {
	normalizedVisitorID := strings.TrimSpace(visitorID)
	events, err := s.exportVisitorEvents(ctx, normalizedVisitorID)
	if err != nil {
		return VisitorExport{}, err
	}

	replaySessions, replayChunks, err := s.exportVisitorReplay(ctx, normalizedVisitorID)
	if err != nil {
		return VisitorExport{}, err
	}

	return VisitorExport{
		VisitorID:      normalizedVisitorID,
		ExportedAt:     time.Now().UTC().Format(time.RFC3339),
		Events:         events,
		ReplaySessions: replaySessions,
		ReplayChunks:   replayChunks,
	}, nil
}

func (s *ClickHouseStore) DeleteVisitor(ctx context.Context, visitorID string) (VisitorDeleteResult, error) {
	normalizedVisitorID := strings.TrimSpace(visitorID)
	eventCount, err := s.countVisitorEvents(ctx, normalizedVisitorID)
	if err != nil {
		return VisitorDeleteResult{}, err
	}

	replaySessionCount, replayChunkCount, err := s.countVisitorReplay(ctx, normalizedVisitorID)
	if err != nil {
		return VisitorDeleteResult{}, err
	}

	result := VisitorDeleteResult{
		VisitorID:             normalizedVisitorID,
		DeletedEvents:         eventCount,
		DeletedReplaySessions: replaySessionCount,
		DeletedReplayChunks:   replayChunkCount,
		Async:                 eventCount > 0 || replaySessionCount > 0 || replayChunkCount > 0,
	}

	if eventCount > 0 {
		statement := fmt.Sprintf(
			"ALTER TABLE events DELETE WHERE JSONExtractString(meta, 'vid') = %s",
			quoteClickHouseString(normalizedVisitorID),
		)
		if err := s.executeStatement(ctx, statement); err != nil {
			if !isClickHouseSchemaMismatch(err) {
				return VisitorDeleteResult{}, err
			}
			legacyStatement := fmt.Sprintf(
				"ALTER TABLE events DELETE WHERE visitor_id = %s",
				quoteClickHouseString(normalizedVisitorID),
			)
			if legacyErr := s.executeStatement(ctx, legacyStatement); legacyErr != nil {
				return VisitorDeleteResult{}, legacyErr
			}
		}
		result.Mutations = append(result.Mutations, "events")
	}

	if replaySessionCount > 0 {
		statement := fmt.Sprintf(
			"ALTER TABLE replay_sessions DELETE WHERE visitor_id = %s",
			quoteClickHouseString(normalizedVisitorID),
		)
		if err := s.executeStatement(ctx, statement); err != nil && !isClickHouseMissingReplayTables(err) {
			return VisitorDeleteResult{}, err
		}
		result.Mutations = append(result.Mutations, "replay_sessions")
	}

	if replayChunkCount > 0 {
		statement := fmt.Sprintf(
			"ALTER TABLE replay_chunks DELETE WHERE visitor_id = %s",
			quoteClickHouseString(normalizedVisitorID),
		)
		if err := s.executeStatement(ctx, statement); err != nil && !isClickHouseMissingReplayTables(err) {
			return VisitorDeleteResult{}, err
		}
		result.Mutations = append(result.Mutations, "replay_chunks")
	}

	return result, nil
}

func (s *ClickHouseStore) exportVisitorEvents(ctx context.Context, visitorID string) ([]VisitorEventExport, error) {
	phase2Query := fmt.Sprintf(`
SELECT
	site_id,
	toUnixTimestamp64Milli(ts) AS ts_ms,
	sid,
	e,
	path,
	toFloat64OrNull(x) AS x,
	toFloat64OrNull(y) AS y,
	sel,
	depth,
	meta
FROM events
WHERE JSONExtractString(meta, 'vid') = %s
ORDER BY ts ASC
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))

	rows, err := clickHouseSelectRows[clickHouseVisitorEventRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT
	site_id,
	toInt64(toUnixTimestamp(timestamp)) * 1000 AS ts_ms,
	if(length(session_id) > 0, session_id, visitor_id) AS sid,
	if(type = 'pageview', 'pageview', if(length(name) > 0, name, 'event')) AS e,
	path,
	toFloat64OrNull(nullIf(props['x'], '')) AS x,
	toFloat64OrNull(nullIf(props['y'], '')) AS y,
	nullIf(props['sel'], '') AS sel,
	toUInt8OrNull(nullIf(props['depth'], '')) AS depth,
	ifNull(nullIf(props['meta'], ''), '{}') AS meta
FROM events
WHERE visitor_id = %s
   OR JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid') = %s
ORDER BY timestamp ASC
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID), quoteClickHouseString(visitorID))
		rows, err = clickHouseSelectRows[clickHouseVisitorEventRow](ctx, s, legacyQuery)
	}
	if err != nil {
		return nil, err
	}

	events := make([]VisitorEventExport, 0, len(rows))
	for _, row := range rows {
		events = append(events, VisitorEventExport{
			SiteID:    strings.TrimSpace(row.SiteID),
			Timestamp: time.UnixMilli(row.TimestampMS).UTC().Format(time.RFC3339Nano),
			SessionID: strings.TrimSpace(row.SessionID),
			Name:      strings.TrimSpace(row.Name),
			Path:      normalizePath(row.Path),
			X:         row.X,
			Y:         row.Y,
			Selector:  row.Selector,
			Depth:     row.Depth,
			Meta:      exportEventMeta(strings.TrimSpace(row.Meta)),
		})
	}
	return events, nil
}

func (s *ClickHouseStore) exportVisitorReplay(
	ctx context.Context,
	visitorID string,
) ([]VisitorReplaySessionExport, []VisitorReplayChunkExport, error) {
	sessionQuery := fmt.Sprintf(`
SELECT
	site_id,
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
WHERE visitor_id = %s
ORDER BY updated_at DESC
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))

	sessionRows, err := clickHouseSelectRows[clickHouseVisitorReplaySessionExportRow](ctx, s, sessionQuery)
	if err != nil {
		if isClickHouseMissingReplayTables(err) {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	chunkQuery := fmt.Sprintf(`
SELECT
	site_id,
	session_id,
	visitor_id,
	chunk_index,
	reason,
	toUnixTimestamp64Milli(started_at) AS started_at_ms,
	toUnixTimestamp64Milli(ended_at) AS ended_at_ms,
	path,
	event_count,
	summary_json,
	events_json
FROM replay_chunks
WHERE visitor_id = %s
ORDER BY session_id ASC, chunk_index ASC, started_at ASC
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))

	chunkRows, err := clickHouseSelectRows[clickHouseVisitorReplayChunkExportRow](ctx, s, chunkQuery)
	if err != nil {
		if isClickHouseMissingReplayTables(err) {
			chunkRows = nil
		} else {
			return nil, nil, err
		}
	}

	sessions := make([]VisitorReplaySessionExport, 0, len(sessionRows))
	for _, row := range sessionRows {
		sessions = append(sessions, VisitorReplaySessionExport{
			SiteID:    strings.TrimSpace(row.SiteID),
			VisitorID: visitorID,
			Session: replaySummaryFromRow(clickHouseReplaySessionRow{
				SessionID:           row.SessionID,
				StartedAtMS:         row.StartedAtMS,
				UpdatedAtMS:         row.UpdatedAtMS,
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
				ViewportWidth:       row.ViewportWidth,
				ViewportHeight:      row.ViewportHeight,
				ViewportBucket:      row.ViewportBucket,
				Paths:               row.Paths,
				SampleRate:          row.SampleRate,
			}),
		})
	}

	chunks := make([]VisitorReplayChunkExport, 0, len(chunkRows))
	for _, row := range chunkRows {
		chunks = append(chunks, VisitorReplayChunkExport{
			SiteID:    strings.TrimSpace(row.SiteID),
			VisitorID: visitorID,
			SessionID: strings.TrimSpace(row.SessionID),
			Chunk: replayChunkFromRow(clickHouseReplayChunkRow{
				ChunkIndex:  row.ChunkIndex,
				Reason:      row.Reason,
				StartedAtMS: row.StartedAtMS,
				EndedAtMS:   row.EndedAtMS,
				Path:        row.Path,
				EventCount:  row.EventCount,
				SummaryJSON: row.SummaryJSON,
				EventsJSON:  row.EventsJSON,
			}),
		})
	}

	return sessions, chunks, nil
}

func (s *ClickHouseStore) countVisitorEvents(ctx context.Context, visitorID string) (int, error) {
	phase2Query := fmt.Sprintf(`
SELECT count() AS count
FROM events
WHERE JSONExtractString(meta, 'vid') = %s
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))

	rows, err := clickHouseSelectRows[clickHouseCountRow](ctx, s, phase2Query)
	if err != nil && isClickHouseSchemaMismatch(err) {
		legacyQuery := fmt.Sprintf(`
SELECT count() AS count
FROM events
WHERE visitor_id = %s
   OR JSONExtractString(ifNull(nullIf(props['meta'], ''), '{}'), 'vid') = %s
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID), quoteClickHouseString(visitorID))
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

func (s *ClickHouseStore) countVisitorReplay(ctx context.Context, visitorID string) (int, int, error) {
	sessionQuery := fmt.Sprintf(`
SELECT count() AS count
FROM replay_sessions FINAL
WHERE visitor_id = %s
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))
	sessionRows, err := clickHouseSelectRows[clickHouseCountRow](ctx, s, sessionQuery)
	if err != nil {
		if isClickHouseMissingReplayTables(err) {
			return 0, 0, nil
		}
		return 0, 0, err
	}

	chunkQuery := fmt.Sprintf(`
SELECT count() AS count
FROM replay_chunks
WHERE visitor_id = %s
FORMAT JSONEachRow
`, quoteClickHouseString(visitorID))
	chunkRows, err := clickHouseSelectRows[clickHouseCountRow](ctx, s, chunkQuery)
	if err != nil {
		if isClickHouseMissingReplayTables(err) {
			return 0, 0, nil
		}
		return 0, 0, err
	}

	sessionCount := 0
	chunkCount := 0
	if len(sessionRows) > 0 {
		sessionCount = sessionRows[0].Count
	}
	if len(chunkRows) > 0 {
		chunkCount = chunkRows[0].Count
	}
	return sessionCount, chunkCount, nil
}

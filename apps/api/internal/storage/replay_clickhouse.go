package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type clickHouseReplaySessionRow struct {
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

type clickHouseReplayChunkRow struct {
	ChunkIndex  int    `json:"chunk_index"`
	Reason      string `json:"reason"`
	StartedAtMS int64  `json:"started_at_ms"`
	EndedAtMS   int64  `json:"ended_at_ms"`
	Path        string `json:"path"`
	EventCount  int    `json:"event_count"`
	SummaryJSON string `json:"summary_json"`
	EventsJSON  string `json:"events_json"`
}

type clickHouseReplaySessionInsertRow struct {
	SiteID              string   `json:"site_id"`
	SessionID           string   `json:"session_id"`
	VisitorID           string   `json:"visitor_id"`
	StartedAt           string   `json:"started_at"`
	UpdatedAt           string   `json:"updated_at"`
	DurationMS          uint32   `json:"duration_ms"`
	EntryPath           string   `json:"entry_path"`
	ExitPath            string   `json:"exit_path"`
	PageCount           uint16   `json:"page_count"`
	RouteCount          uint16   `json:"route_count"`
	ChunkCount          uint16   `json:"chunk_count"`
	EventCount          uint32   `json:"event_count"`
	ErrorCount          uint16   `json:"error_count"`
	ConsoleErrorCount   uint16   `json:"console_error_count"`
	NetworkFailureCount uint16   `json:"network_failure_count"`
	RageClickCount      uint16   `json:"rage_click_count"`
	DeadClickCount      uint16   `json:"dead_click_count"`
	CustomEventCount    uint16   `json:"custom_event_count"`
	DeviceType          string   `json:"device_type"`
	Browser             string   `json:"browser"`
	OS                  string   `json:"os"`
	ViewportWidth       uint16   `json:"viewport_width"`
	ViewportHeight      uint16   `json:"viewport_height"`
	ViewportBucket      string   `json:"viewport_bucket"`
	Paths               []string `json:"paths"`
	SampleRate          float32  `json:"sample_rate"`
}

type clickHouseReplayChunkInsertRow struct {
	SiteID      string `json:"site_id"`
	SessionID   string `json:"session_id"`
	VisitorID   string `json:"visitor_id"`
	ChunkIndex  uint32 `json:"chunk_index"`
	Reason      string `json:"reason"`
	StartedAt   string `json:"started_at"`
	EndedAt     string `json:"ended_at"`
	Path        string `json:"path"`
	EventCount  uint32 `json:"event_count"`
	SummaryJSON string `json:"summary_json"`
	EventsJSON  string `json:"events_json"`
}

func (s *ClickHouseStore) WriteReplay(ctx context.Context, batch ReplayWriteBatch) error {
	if strings.TrimSpace(batch.Session.SessionID) == "" || len(batch.Chunks) == 0 {
		return nil
	}

	if err := s.writeReplaySession(ctx, batch.Session); err != nil {
		return err
	}
	if err := s.writeReplayChunks(ctx, batch.Chunks); err != nil {
		return err
	}
	return nil
}

func (s *ClickHouseStore) writeReplaySession(ctx context.Context, session ReplayWriteSession) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	row := clickHouseReplaySessionInsertRow{
		SiteID:              strings.TrimSpace(session.SiteID),
		SessionID:           strings.TrimSpace(session.SessionID),
		VisitorID:           strings.TrimSpace(session.VisitorID),
		StartedAt:           formatClickHouseTime(session.StartedAt),
		UpdatedAt:           formatClickHouseTime(session.UpdatedAt),
		DurationMS:          clampUInt32(session.DurationMS),
		EntryPath:           normalizePath(session.EntryPath),
		ExitPath:            normalizePath(session.ExitPath),
		PageCount:           clampUInt16(session.PageCount),
		RouteCount:          clampUInt16(session.RouteCount),
		ChunkCount:          clampUInt16(session.ChunkCount),
		EventCount:          clampUInt32(session.EventCount),
		ErrorCount:          clampUInt16(session.ErrorCount),
		ConsoleErrorCount:   clampUInt16(session.ConsoleErrorCount),
		NetworkFailureCount: clampUInt16(session.NetworkFailureCount),
		RageClickCount:      clampUInt16(session.RageClickCount),
		DeadClickCount:      clampUInt16(session.DeadClickCount),
		CustomEventCount:    clampUInt16(session.CustomEventCount),
		DeviceType:          strings.TrimSpace(session.DeviceType),
		Browser:             strings.TrimSpace(session.Browser),
		OS:                  strings.TrimSpace(session.OS),
		ViewportWidth:       clampUInt16(session.Viewport.Width),
		ViewportHeight:      clampUInt16(session.Viewport.Height),
		ViewportBucket:      strings.TrimSpace(session.Viewport.Bucket),
		Paths:               replayPaths(session.Paths),
		SampleRate:          float32(session.SampleRate),
	}
	if err := encoder.Encode(row); err != nil {
		return fmt.Errorf("encode replay session: %w", err)
	}
	payload := append([]byte(nil), body.Bytes()...)
	if err := s.executeInsert(ctx, "INSERT INTO replay_sessions FORMAT JSONEachRow", bytes.NewBuffer(payload)); err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return fmt.Errorf("write replay session: %w", err)
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ensureErr
		}
		if retryErr := s.executeInsert(ctx, "INSERT INTO replay_sessions FORMAT JSONEachRow", bytes.NewBuffer(payload)); retryErr != nil {
			return fmt.Errorf("write replay session: %w", retryErr)
		}
	}
	return nil
}

func (s *ClickHouseStore) writeReplayChunks(ctx context.Context, chunks []ReplayWriteChunk) error {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, chunk := range chunks {
		summaryJSON, err := json.Marshal(chunk.Summary)
		if err != nil {
			return fmt.Errorf("encode replay chunk summary: %w", err)
		}
		row := clickHouseReplayChunkInsertRow{
			SiteID:      strings.TrimSpace(chunk.SiteID),
			SessionID:   strings.TrimSpace(chunk.SessionID),
			VisitorID:   strings.TrimSpace(chunk.VisitorID),
			ChunkIndex:  clampUInt32(chunk.Index),
			Reason:      strings.TrimSpace(chunk.Reason),
			StartedAt:   formatClickHouseTime(chunk.StartedAt),
			EndedAt:     formatClickHouseTime(chunk.EndedAt),
			Path:        normalizePath(chunk.Path),
			EventCount:  clampUInt32(chunk.EventCount),
			SummaryJSON: string(summaryJSON),
			EventsJSON:  strings.TrimSpace(chunk.EventsJSON),
		}
		if row.EventsJSON == "" {
			row.EventsJSON = "[]"
		}
		if err := encoder.Encode(row); err != nil {
			return fmt.Errorf("encode replay chunk: %w", err)
		}
	}
	payload := append([]byte(nil), body.Bytes()...)
	if err := s.executeInsert(ctx, "INSERT INTO replay_chunks FORMAT JSONEachRow", bytes.NewBuffer(payload)); err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return fmt.Errorf("write replay chunks: %w", err)
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ensureErr
		}
		if retryErr := s.executeInsert(ctx, "INSERT INTO replay_chunks FORMAT JSONEachRow", bytes.NewBuffer(payload)); retryErr != nil {
			return fmt.Errorf("write replay chunks: %w", retryErr)
		}
	}
	return nil
}

func (s *ClickHouseStore) ReplaySessions(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (ReplaySessionList, error) {
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
  AND updated_at >= toDateTime64(%s, 3, 'UTC')
ORDER BY updated_at DESC
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)), quoteClickHouseString(formatClickHouseTime(rangeValue.Since(now.UTC()))))

	rows, err := clickHouseSelectRows[clickHouseReplaySessionRow](ctx, s, query)
	if err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return ReplaySessionList{}, err
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ReplaySessionList{}, ensureErr
		}
		rows, err = clickHouseSelectRows[clickHouseReplaySessionRow](ctx, s, query)
		if err != nil {
			return ReplaySessionList{}, err
		}
	}

	sessions := make([]ReplaySessionSummary, 0, len(rows))
	for _, row := range rows {
		sessions = append(sessions, replaySummaryFromRow(row))
	}

	return ReplaySessionList{
		Range:    rangeValue.String(),
		Sessions: sessions,
	}, nil
}

func (s *ClickHouseStore) ReplaySession(ctx context.Context, siteID, sessionID string) (ReplaySessionDetail, error) {
	sessionQuery := fmt.Sprintf(`
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
  AND session_id = %s
ORDER BY updated_at DESC
LIMIT 1
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)), quoteClickHouseString(strings.TrimSpace(sessionID)))

	sessionRows, err := clickHouseSelectRows[clickHouseReplaySessionRow](ctx, s, sessionQuery)
	if err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return ReplaySessionDetail{}, err
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ReplaySessionDetail{}, ensureErr
		}
		sessionRows, err = clickHouseSelectRows[clickHouseReplaySessionRow](ctx, s, sessionQuery)
		if err != nil {
			return ReplaySessionDetail{}, err
		}
	}
	if len(sessionRows) == 0 {
		return ReplaySessionDetail{}, nil
	}

	chunkQuery := fmt.Sprintf(`
SELECT
    chunk_index,
    reason,
    toUnixTimestamp64Milli(started_at) AS started_at_ms,
    toUnixTimestamp64Milli(ended_at) AS ended_at_ms,
    path,
    event_count,
    summary_json,
    events_json
FROM replay_chunks
WHERE site_id = %s
  AND session_id = %s
ORDER BY started_at ASC, chunk_index ASC
FORMAT JSONEachRow
`, quoteClickHouseString(strings.TrimSpace(siteID)), quoteClickHouseString(strings.TrimSpace(sessionID)))

	chunkRows, err := clickHouseSelectRows[clickHouseReplayChunkRow](ctx, s, chunkQuery)
	if err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return ReplaySessionDetail{}, err
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ReplaySessionDetail{}, ensureErr
		}
		chunkRows, err = clickHouseSelectRows[clickHouseReplayChunkRow](ctx, s, chunkQuery)
		if err != nil {
			return ReplaySessionDetail{}, err
		}
	}

	chunks := make([]ReplayChunk, 0, len(chunkRows))
	for _, row := range chunkRows {
		chunks = append(chunks, replayChunkFromRow(row))
	}

	return ReplaySessionDetail{
		Session: replaySummaryFromRow(sessionRows[0]),
		Chunks:  chunks,
	}, nil
}

func replaySummaryFromRow(row clickHouseReplaySessionRow) ReplaySessionSummary {
	return ReplaySessionSummary{
		SessionID:           strings.TrimSpace(row.SessionID),
		StartedAt:           replayTimeFromMS(row.StartedAtMS),
		UpdatedAt:           replayTimeFromMS(row.UpdatedAtMS),
		DurationMS:          row.DurationMS,
		EntryPath:           normalizePath(row.EntryPath),
		ExitPath:            normalizePath(row.ExitPath),
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
		DeviceType:          strings.TrimSpace(row.DeviceType),
		Browser:             strings.TrimSpace(row.Browser),
		OS:                  strings.TrimSpace(row.OS),
		Viewport: ReplayViewport{
			Width:  row.ViewportWidth,
			Height: row.ViewportHeight,
			Bucket: strings.TrimSpace(row.ViewportBucket),
		},
		Paths:      replayPaths(row.Paths),
		SampleRate: row.SampleRate,
	}
}

func replayChunkFromRow(row clickHouseReplayChunkRow) ReplayChunk {
	summary := ReplayChunkSummary{}
	if strings.TrimSpace(row.SummaryJSON) != "" {
		_ = json.Unmarshal([]byte(row.SummaryJSON), &summary)
	}

	events := json.RawMessage("[]")
	if strings.TrimSpace(row.EventsJSON) != "" {
		events = json.RawMessage(row.EventsJSON)
	}

	return ReplayChunk{
		Index:      row.ChunkIndex,
		Reason:     strings.TrimSpace(row.Reason),
		StartedAt:  replayTimeFromMS(row.StartedAtMS),
		EndedAt:    replayTimeFromMS(row.EndedAtMS),
		Path:       normalizePath(row.Path),
		EventCount: row.EventCount,
		Summary:    summary,
		Events:     events,
	}
}

func replayTimeFromMS(value int64) string {
	if value <= 0 {
		return ""
	}
	return time.UnixMilli(value).UTC().Format(time.RFC3339)
}

func replayPaths(paths []string) []string {
	if len(paths) == 0 {
		return nil
	}
	items := make([]string, 0, len(paths))
	for _, path := range paths {
		normalized := normalizePath(path)
		if normalized == "" {
			continue
		}
		items = append(items, normalized)
	}
	return items
}

func isClickHouseMissingReplayTables(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unknown table") ||
		strings.Contains(message, "unknown_table") ||
		strings.Contains(message, "code: 60") ||
		strings.Contains(message, "replay_sessions") ||
		strings.Contains(message, "replay_chunks")
}

func (s *ClickHouseStore) ensureReplayTables(ctx context.Context) error {
	statements := []string{
		`CREATE TABLE IF NOT EXISTS replay_sessions
(
    site_id               LowCardinality(String),
    session_id            String,
    visitor_id            String,
    started_at            DateTime64(3),
    updated_at            DateTime64(3),
    duration_ms           UInt32,
    entry_path            String,
    exit_path             String,
    page_count            UInt16,
    route_count           UInt16,
    chunk_count           UInt16,
    event_count           UInt32,
    error_count           UInt16,
    console_error_count   UInt16,
    network_failure_count UInt16,
    rage_click_count      UInt16,
    dead_click_count      UInt16,
    custom_event_count    UInt16,
    device_type           LowCardinality(String),
    browser               LowCardinality(String),
    os                    LowCardinality(String),
    viewport_width        UInt16,
    viewport_height       UInt16,
    viewport_bucket       LowCardinality(String),
    paths                 Array(String),
    sample_rate           Float32
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(updated_at)
ORDER BY (site_id, toDate(updated_at), session_id)
TTL updated_at + INTERVAL 30 DAY`,
		`CREATE TABLE IF NOT EXISTS replay_chunks
(
    site_id      LowCardinality(String),
    session_id   String,
    visitor_id   String,
    chunk_index  UInt32,
    reason       LowCardinality(String),
    started_at   DateTime64(3),
    ended_at     DateTime64(3),
    path         String,
    event_count  UInt32,
    summary_json String,
    events_json  String
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(started_at)
ORDER BY (site_id, session_id, chunk_index)
TTL started_at + INTERVAL 30 DAY`,
	}

	for _, statement := range statements {
		if err := s.executeStatement(ctx, statement); err != nil {
			return fmt.Errorf("ensure replay tables: %w", err)
		}
	}
	return nil
}

func clampUInt16(value int) uint16 {
	if value <= 0 {
		return 0
	}
	if value > 65535 {
		return 65535
	}
	return uint16(value)
}

func clampUInt32(value int) uint32 {
	if value <= 0 {
		return 0
	}
	if value > int(^uint32(0)>>1) {
		return uint32(^uint32(0) >> 1)
	}
	return uint32(value)
}

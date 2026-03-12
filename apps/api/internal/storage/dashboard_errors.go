package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

type clickHouseErrorChunkRow struct {
	SessionID          string `json:"session_id"`
	SessionUpdatedAtMS int64  `json:"session_updated_at_ms"`
	Path               string `json:"path"`
	EventsJSON         string `json:"events_json"`
}

type replayEventEnvelope struct {
	Type string          `json:"type"`
	TS   int64           `json:"ts"`
	Data json.RawMessage `json:"data"`
}

type replayConsoleEvent struct {
	Level   string `json:"level"`
	Message string `json:"message"`
	Source  string `json:"source"`
}

type replayNetworkEvent struct {
	Method        string `json:"method"`
	URL           string `json:"url"`
	Status        int    `json:"status"`
	Ok            bool   `json:"ok"`
	FailureReason string `json:"failureReason"`
}

type errorGroupAccumulator struct {
	Key             string
	Kind            string
	Title           string
	Signature       string
	CurrentCount    int
	PreviousCount   int
	CurrentSessions map[string]int
	CurrentPaths    map[string]struct{}
	LatestAt        time.Time
	TrendBuckets    map[time.Time]int
	ReplayLinks     map[string]ErrorReplayLink
}

func (s *ClickHouseStore) ErrorBoard(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (ErrorBoardView, error) {
	siteID = strings.TrimSpace(siteID)
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	currentStart := rangeValue.Since(now.UTC())
	previousStart := comparisonRange.Since(now.UTC())

	sessionList, _ := s.ReplaySessions(ctx, siteID, rangeValue, now.UTC())
	currentSessions := map[string]ReplaySessionSummary{}
	for _, session := range sessionList.Sessions {
		currentSessions[strings.TrimSpace(session.SessionID)] = session
	}

	query := fmt.Sprintf(`
SELECT
    c.session_id,
    toUnixTimestamp64Milli(rs.updated_at) AS session_updated_at_ms,
    if(length(c.path) > 0, c.path, rs.entry_path) AS path,
    c.events_json
FROM replay_chunks c
LEFT JOIN replay_sessions FINAL rs
    ON rs.site_id = c.site_id
   AND rs.session_id = c.session_id
WHERE c.site_id = %s
  AND c.started_at >= toDateTime64(%s, 3, 'UTC')
ORDER BY c.started_at ASC
FORMAT JSONEachRow
`, quoteClickHouseString(siteID), quoteClickHouseString(formatClickHouseTime(previousStart)))

	rows, err := clickHouseSelectRows[clickHouseErrorChunkRow](ctx, s, query)
	if err != nil {
		if !isClickHouseMissingReplayTables(err) {
			return ErrorBoardView{}, err
		}
		if ensureErr := s.ensureReplayTables(ctx); ensureErr != nil {
			return ErrorBoardView{}, ensureErr
		}
		rows, err = clickHouseSelectRows[clickHouseErrorChunkRow](ctx, s, query)
		if err != nil {
			return ErrorBoardView{}, err
		}
	}

	accumulators := map[string]*errorGroupAccumulator{}
	for _, row := range rows {
		events := []replayEventEnvelope{}
		if strings.TrimSpace(row.EventsJSON) == "" {
			continue
		}
		if err := json.Unmarshal([]byte(row.EventsJSON), &events); err != nil {
			continue
		}

		for _, event := range events {
			when := time.UnixMilli(event.TS).UTC()
			if when.IsZero() {
				when = time.UnixMilli(row.SessionUpdatedAtMS).UTC()
			}
			isCurrent := !when.Before(currentStart)
			switch strings.TrimSpace(strings.ToLower(event.Type)) {
			case "console":
				consoleEvent := replayConsoleEvent{}
				if err := json.Unmarshal(event.Data, &consoleEvent); err != nil {
					continue
				}
				message := strings.TrimSpace(consoleEvent.Message)
				if message == "" {
					continue
				}
				key := "console|" + normalizeErrorSignature(message)
				item := ensureErrorAccumulator(accumulators, key, "console", trimStringForError(message, 120), trimStringForError(message, 240))
				recordErrorOccurrence(item, row, currentSessions, currentStart, rangeValue, when, isCurrent)
			case "network":
				networkEvent := replayNetworkEvent{}
				if err := json.Unmarshal(event.Data, &networkEvent); err != nil {
					continue
				}
				if networkEvent.Ok {
					continue
				}
				title := buildNetworkErrorTitle(networkEvent)
				signature := normalizeErrorSignature(strings.TrimSpace(networkEvent.Method) + "|" + strings.TrimSpace(networkEvent.URL) + "|" + strings.TrimSpace(networkEvent.FailureReason))
				key := "network|" + signature
				item := ensureErrorAccumulator(accumulators, key, "network", title, signature)
				recordErrorOccurrence(item, row, currentSessions, currentStart, rangeValue, when, isCurrent)
			}
		}
	}

	groups := make([]ErrorGroup, 0, len(accumulators))
	summary := ErrorBoardSummary{}
	for _, item := range accumulators {
		if item.CurrentCount == 0 {
			continue
		}
		severity := classifyErrorSeverity(item)
		links := make([]ErrorReplayLink, 0, len(item.ReplayLinks))
		for _, link := range item.ReplayLinks {
			links = append(links, link)
		}
		sort.Slice(links, func(i, j int) bool {
			if links[i].Count == links[j].Count {
				return links[i].UpdatedAt > links[j].UpdatedAt
			}
			return links[i].Count > links[j].Count
		})
		if len(links) > 3 {
			links = links[:3]
		}

		trend := buildErrorTrend(item.TrendBuckets, rangeValue, currentStart, now.UTC())
		group := ErrorGroup{
			Key:              item.Key,
			Kind:             item.Kind,
			Title:            item.Title,
			Signature:        item.Signature,
			Severity:         string(severity),
			CurrentCount:     item.CurrentCount,
			PreviousCount:    item.PreviousCount,
			Delta:            item.CurrentCount - item.PreviousCount,
			Direction:        errorTrendDirection(item.CurrentCount, item.PreviousCount),
			AffectedSessions: len(item.CurrentSessions),
			AffectedPaths:    len(item.CurrentPaths),
			LatestAt:         item.LatestAt.UTC().Format(time.RFC3339),
			ReplayLinks:      links,
			Trend:            trend,
		}
		groups = append(groups, group)
		summary.Groups += 1
		summary.TotalOccurrences += item.CurrentCount
		if len(links) > 0 {
			summary.ReplayLinkedGroups += 1
		}
		switch severity {
		case ErrorGroupSeverityCritical:
			summary.CriticalGroups += 1
		case ErrorGroupSeverityWarning:
			summary.WarningGroups += 1
		default:
			summary.InfoGroups += 1
		}
	}

	sort.Slice(groups, func(i, j int) bool {
		if errorSeverityRank(groups[i].Severity) == errorSeverityRank(groups[j].Severity) {
			if groups[i].CurrentCount == groups[j].CurrentCount {
				return groups[i].LatestAt > groups[j].LatestAt
			}
			return groups[i].CurrentCount > groups[j].CurrentCount
		}
		return errorSeverityRank(groups[i].Severity) < errorSeverityRank(groups[j].Severity)
	})

	return ErrorBoardView{
		Range:   rangeValue.String(),
		Summary: summary,
		Groups:  groups,
	}, nil
}

func ensureErrorAccumulator(index map[string]*errorGroupAccumulator, key, kind, title, signature string) *errorGroupAccumulator {
	current := index[key]
	if current != nil {
		return current
	}
	current = &errorGroupAccumulator{
		Key:             key,
		Kind:            kind,
		Title:           title,
		Signature:       signature,
		CurrentSessions: map[string]int{},
		CurrentPaths:    map[string]struct{}{},
		TrendBuckets:    map[time.Time]int{},
		ReplayLinks:     map[string]ErrorReplayLink{},
	}
	index[key] = current
	return current
}

func recordErrorOccurrence(
	item *errorGroupAccumulator,
	row clickHouseErrorChunkRow,
	currentSessions map[string]ReplaySessionSummary,
	currentStart time.Time,
	rangeValue TimeRange,
	when time.Time,
	isCurrent bool,
) {
	if isCurrent {
		item.CurrentCount += 1
		item.CurrentSessions[row.SessionID] += 1
		item.CurrentPaths[normalizePath(row.Path)] = struct{}{}
		bucket := errorBucketStart(when, rangeValue)
		item.TrendBuckets[bucket] += 1
		if when.After(item.LatestAt) {
			item.LatestAt = when
		}
		link := item.ReplayLinks[row.SessionID]
		link.SessionID = strings.TrimSpace(row.SessionID)
		link.Count += 1
		if session, ok := currentSessions[row.SessionID]; ok {
			link.Path = normalizePath(session.EntryPath)
			link.UpdatedAt = session.UpdatedAt
		} else {
			link.Path = normalizePath(row.Path)
			link.UpdatedAt = time.UnixMilli(row.SessionUpdatedAtMS).UTC().Format(time.RFC3339)
		}
		item.ReplayLinks[row.SessionID] = link
		return
	}
	if !when.Before(currentStart) {
		return
	}
	item.PreviousCount += 1
}

func buildNetworkErrorTitle(value replayNetworkEvent) string {
	parts := []string{}
	if method := strings.TrimSpace(strings.ToUpper(value.Method)); method != "" {
		parts = append(parts, method)
	}
	if urlValue := trimStringForError(strings.TrimSpace(value.URL), 120); urlValue != "" {
		parts = append(parts, urlValue)
	}
	if value.Status > 0 {
		parts = append(parts, fmt.Sprintf("(%d)", value.Status))
	}
	if reason := trimStringForError(strings.TrimSpace(value.FailureReason), 80); reason != "" {
		parts = append(parts, reason)
	}
	if len(parts) == 0 {
		return "Network failure"
	}
	return strings.Join(parts, " ")
}

func normalizeErrorSignature(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.Join(strings.Fields(normalized), " ")
	if len(normalized) <= 240 {
		return normalized
	}
	return normalized[:240]
}

func trimStringForError(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}

func classifyErrorSeverity(item *errorGroupAccumulator) ErrorGroupSeverity {
	switch item.Kind {
	case "console":
		if item.CurrentCount >= 2 || len(item.CurrentSessions) >= 2 {
			return ErrorGroupSeverityCritical
		}
		return ErrorGroupSeverityWarning
	case "network":
		if item.CurrentCount >= 5 || len(item.CurrentSessions) >= 3 {
			return ErrorGroupSeverityCritical
		}
		return ErrorGroupSeverityWarning
	default:
		return ErrorGroupSeverityInfo
	}
}

func errorTrendDirection(current, previous int) string {
	switch {
	case current > previous:
		return string(ErrorTrendUp)
	case current < previous:
		return string(ErrorTrendDown)
	default:
		return string(ErrorTrendFlat)
	}
}

func errorSeverityRank(value string) int {
	switch value {
	case string(ErrorGroupSeverityCritical):
		return 0
	case string(ErrorGroupSeverityWarning):
		return 1
	default:
		return 2
	}
}

func buildErrorTrend(buckets map[time.Time]int, rangeValue TimeRange, start, now time.Time) []ErrorTrendPoint {
	bucketDuration := rangeValue.BucketDuration()
	points := make([]ErrorTrendPoint, 0)
	for current := errorBucketStart(start, rangeValue); !current.After(now); current = current.Add(bucketDuration) {
		points = append(points, ErrorTrendPoint{
			Timestamp: current.UTC().Format(time.RFC3339),
			Count:     buckets[current],
		})
	}
	return points
}

func errorBucketStart(value time.Time, rangeValue TimeRange) time.Time {
	bucketDuration := rangeValue.BucketDuration()
	value = value.UTC()
	if bucketDuration < 24*time.Hour {
		return value.Truncate(bucketDuration)
	}
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

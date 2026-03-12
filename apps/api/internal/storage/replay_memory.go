package storage

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"
)

func (s *MemoryStore) WriteReplay(ctx context.Context, batch ReplayWriteBatch) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	if strings.TrimSpace(batch.Session.SessionID) == "" || len(batch.Chunks) == 0 {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	key := replaySessionKey(batch.Session.SiteID, batch.Session.SessionID)
	s.replaySessions[key] = batch.Session
	s.replayChunks[key] = append(s.replayChunks[key], batch.Chunks...)
	slices.SortFunc(s.replayChunks[key], func(a, b ReplayWriteChunk) int {
		aStartedAt := a.StartedAt.UTC().Format(time.RFC3339Nano)
		bStartedAt := b.StartedAt.UTC().Format(time.RFC3339Nano)
		if aStartedAt == bStartedAt {
			if a.Index == b.Index {
				return 0
			}
			if a.Index < b.Index {
				return -1
			}
			return 1
		}
		if aStartedAt < bStartedAt {
			return -1
		}
		return 1
	})

	return nil
}

func (s *MemoryStore) ReplaySessions(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) (ReplaySessionList, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	sessions := make([]ReplaySessionSummary, 0, len(s.replaySessions))
	since := rangeValue.Since(now.UTC())

	for _, session := range s.replaySessions {
		if strings.TrimSpace(session.SiteID) != strings.TrimSpace(siteID) {
			continue
		}
		if !session.UpdatedAt.IsZero() && session.UpdatedAt.Before(since) {
			continue
		}
		sessions = append(sessions, replaySummaryFromWrite(session))
	}

	slices.SortFunc(sessions, func(a, b ReplaySessionSummary) int {
		if a.UpdatedAt == b.UpdatedAt {
			return strings.Compare(b.SessionID, a.SessionID)
		}
		if a.UpdatedAt > b.UpdatedAt {
			return -1
		}
		return 1
	})

	return ReplaySessionList{
		Range:    rangeValue.String(),
		Sessions: sessions,
	}, nil
}

func (s *MemoryStore) ReplaySession(_ context.Context, siteID, sessionID string) (ReplaySessionDetail, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	key := replaySessionKey(siteID, sessionID)
	session, ok := s.replaySessions[key]
	if !ok {
		return ReplaySessionDetail{}, nil
	}

	chunks := make([]ReplayChunk, 0, len(s.replayChunks[key]))
	for _, chunk := range s.replayChunks[key] {
		chunks = append(chunks, replayChunkFromWrite(chunk))
	}

	return ReplaySessionDetail{
		Session: replaySummaryFromWrite(session),
		Chunks:  chunks,
	}, nil
}

func replaySummaryFromWrite(session ReplayWriteSession) ReplaySessionSummary {
	return ReplaySessionSummary{
		SessionID:           strings.TrimSpace(session.SessionID),
		StartedAt:           replayTimeString(session.StartedAt),
		UpdatedAt:           replayTimeString(session.UpdatedAt),
		DurationMS:          session.DurationMS,
		EntryPath:           normalizePath(session.EntryPath),
		ExitPath:            normalizePath(session.ExitPath),
		PageCount:           session.PageCount,
		RouteCount:          session.RouteCount,
		ChunkCount:          session.ChunkCount,
		EventCount:          session.EventCount,
		ErrorCount:          session.ErrorCount,
		ConsoleErrorCount:   session.ConsoleErrorCount,
		NetworkFailureCount: session.NetworkFailureCount,
		RageClickCount:      session.RageClickCount,
		DeadClickCount:      session.DeadClickCount,
		CustomEventCount:    session.CustomEventCount,
		DeviceType:          strings.TrimSpace(session.DeviceType),
		Browser:             strings.TrimSpace(session.Browser),
		OS:                  strings.TrimSpace(session.OS),
		Viewport:            session.Viewport,
		Paths:               slices.Clone(session.Paths),
		SampleRate:          session.SampleRate,
	}
}

func replayChunkFromWrite(chunk ReplayWriteChunk) ReplayChunk {
	events := json.RawMessage("[]")
	if strings.TrimSpace(chunk.EventsJSON) != "" {
		events = json.RawMessage(chunk.EventsJSON)
	}
	return ReplayChunk{
		Index:      chunk.Index,
		Reason:     strings.TrimSpace(chunk.Reason),
		StartedAt:  replayTimeString(chunk.StartedAt),
		EndedAt:    replayTimeString(chunk.EndedAt),
		Path:       normalizePath(chunk.Path),
		EventCount: chunk.EventCount,
		Summary:    chunk.Summary,
		Events:     events,
	}
}

func replaySessionKey(siteID, sessionID string) string {
	return strings.TrimSpace(siteID) + "::" + strings.TrimSpace(sessionID)
}

func replayTimeString(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

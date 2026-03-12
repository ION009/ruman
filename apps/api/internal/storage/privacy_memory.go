package storage

import (
	"context"
	"strings"
	"time"

	"anlticsheat/api/internal/ingest"
)

func (s *MemoryStore) ExportVisitor(_ context.Context, visitorID string) (VisitorExport, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	normalizedVisitorID := strings.TrimSpace(visitorID)
	export := VisitorExport{
		VisitorID:  normalizedVisitorID,
		ExportedAt: time.Now().UTC().Format(time.RFC3339),
	}

	for _, event := range s.events {
		if strings.TrimSpace(event.VisitorID) != normalizedVisitorID {
			continue
		}
		export.Events = append(export.Events, exportStoredEvent(event))
	}

	for key, session := range s.replaySessions {
		if strings.TrimSpace(session.VisitorID) != normalizedVisitorID {
			continue
		}
		export.ReplaySessions = append(export.ReplaySessions, VisitorReplaySessionExport{
			SiteID:    strings.TrimSpace(session.SiteID),
			VisitorID: normalizedVisitorID,
			Session:   replaySummaryFromWrite(session),
		})
		for _, chunk := range s.replayChunks[key] {
			export.ReplayChunks = append(export.ReplayChunks, VisitorReplayChunkExport{
				SiteID:    strings.TrimSpace(chunk.SiteID),
				VisitorID: normalizedVisitorID,
				SessionID: strings.TrimSpace(chunk.SessionID),
				Chunk:     replayChunkFromWrite(chunk),
			})
		}
	}

	return export, nil
}

func (s *MemoryStore) DeleteVisitor(_ context.Context, visitorID string) (VisitorDeleteResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	normalizedVisitorID := strings.TrimSpace(visitorID)
	result := VisitorDeleteResult{
		VisitorID: normalizedVisitorID,
	}

	filteredEvents := make([]ingest.StoredEvent, 0, len(s.events))
	for _, event := range s.events {
		if strings.TrimSpace(event.VisitorID) == normalizedVisitorID {
			result.DeletedEvents += 1
			continue
		}
		filteredEvents = append(filteredEvents, event)
	}
	s.events = filteredEvents

	for key, session := range s.replaySessions {
		if strings.TrimSpace(session.VisitorID) == normalizedVisitorID {
			result.DeletedReplaySessions += 1
			if chunks, ok := s.replayChunks[key]; ok {
				result.DeletedReplayChunks += len(chunks)
				delete(s.replayChunks, key)
			}
			delete(s.replaySessions, key)
			continue
		}

		chunks := s.replayChunks[key]
		if len(chunks) == 0 {
			continue
		}

		filteredChunks := chunks[:0]
		for _, chunk := range chunks {
			if strings.TrimSpace(chunk.VisitorID) == normalizedVisitorID {
				result.DeletedReplayChunks += 1
				continue
			}
			filteredChunks = append(filteredChunks, chunk)
		}
		if len(filteredChunks) == 0 {
			delete(s.replayChunks, key)
			continue
		}
		s.replayChunks[key] = append([]ReplayWriteChunk(nil), filteredChunks...)
	}

	return result, nil
}

func exportStoredEvent(event ingest.StoredEvent) VisitorEventExport {
	return VisitorEventExport{
		SiteID:    strings.TrimSpace(event.SiteID),
		Timestamp: event.Timestamp.UTC().Format(time.RFC3339Nano),
		SessionID: strings.TrimSpace(event.SessionID),
		Name:      strings.TrimSpace(event.Name),
		Path:      normalizePath(event.Path),
		X:         exportFloat32Ptr(event.X),
		Y:         exportFloat32Ptr(event.Y),
		Selector:  exportStringPtr(event.Selector),
		Depth:     exportUInt8Ptr(event.Depth),
		Meta:      exportEventMeta(strings.TrimSpace(event.Meta)),
	}
}

func exportFloat32Ptr(value *float32) *float64 {
	if value == nil {
		return nil
	}
	converted := float64(*value)
	return &converted
}

func exportStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func exportUInt8Ptr(value *uint8) *uint8 {
	if value == nil {
		return nil
	}
	copyValue := *value
	return &copyValue
}

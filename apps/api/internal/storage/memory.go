package storage

import (
	"context"
	"slices"
	"sync"

	"anlticsheat/api/internal/ingest"
)

type Stats struct {
	Events int `json:"events"`
}

type StatsProvider interface {
	Stats() Stats
}

type MemoryStore struct {
	mu             sync.RWMutex
	events         []ingest.StoredEvent
	replaySessions map[string]ReplayWriteSession
	replayChunks   map[string][]ReplayWriteChunk
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		replaySessions: map[string]ReplayWriteSession{},
		replayChunks:   map[string][]ReplayWriteChunk{},
	}
}

func (s *MemoryStore) WriteBatch(ctx context.Context, batch ingest.WriteBatch) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.events = append(s.events, batch.Events...)
	return nil
}

func (s *MemoryStore) Stats() Stats {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return Stats{
		Events: len(s.events),
	}
}

func (s *MemoryStore) Events() []ingest.StoredEvent {
	s.mu.RLock()
	defer s.mu.RUnlock()

	return slices.Clone(s.events)
}

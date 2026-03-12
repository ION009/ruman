package ingest

import (
	"context"
	"time"
)

type Writer interface {
	WriteBatch(ctx context.Context, batch WriteBatch) error
}

type BatchEnqueuer interface {
	Enqueue(ctx context.Context, batch WriteBatch) error
	QueueDepth() int
}

type Event struct {
	ID        string         `json:"id"`
	Sequence  uint64         `json:"sq,omitempty"`
	Name      string         `json:"e"`
	Timestamp int64          `json:"t"`
	SessionID string         `json:"sid"`
	Path      string         `json:"p"`
	X         *float64       `json:"x"`
	Y         *float64       `json:"y"`
	Selector  *string        `json:"sel"`
	Depth     *uint8         `json:"depth"`
	Meta      map[string]any `json:"meta"`
}

type StoredEvent struct {
	SiteID       string
	Timestamp    time.Time
	SessionID    string
	VisitorID    string
	Name         string
	Path         string
	X            *float32
	Y            *float32
	Selector     *string
	Depth        *uint8
	Meta         string
	AnonymizedIP string
}

type WriteBatch struct {
	Events []StoredEvent
}

func (b WriteBatch) Count() int {
	return len(b.Events)
}

func (b WriteBatch) Empty() bool {
	return len(b.Events) == 0
}

func (b *WriteBatch) Merge(other WriteBatch) {
	b.Events = append(b.Events, other.Events...)
}

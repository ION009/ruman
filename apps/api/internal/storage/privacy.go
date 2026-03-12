package storage

import (
	"context"
	"encoding/json"
)

type PrivacyProvider interface {
	ExportVisitor(ctx context.Context, visitorID string) (VisitorExport, error)
	DeleteVisitor(ctx context.Context, visitorID string) (VisitorDeleteResult, error)
}

type VisitorEventExport struct {
	SiteID    string         `json:"siteId"`
	Timestamp string         `json:"timestamp"`
	SessionID string         `json:"sessionId"`
	Name      string         `json:"name"`
	Path      string         `json:"path"`
	X         *float64       `json:"x,omitempty"`
	Y         *float64       `json:"y,omitempty"`
	Selector  *string        `json:"selector,omitempty"`
	Depth     *uint8         `json:"depth,omitempty"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type VisitorReplaySessionExport struct {
	SiteID    string               `json:"siteId"`
	VisitorID string               `json:"visitorId"`
	Session   ReplaySessionSummary `json:"session"`
}

type VisitorReplayChunkExport struct {
	SiteID    string      `json:"siteId"`
	VisitorID string      `json:"visitorId"`
	SessionID string      `json:"sessionId"`
	Chunk     ReplayChunk `json:"chunk"`
}

type VisitorExport struct {
	VisitorID      string                       `json:"visitorId"`
	ExportedAt     string                       `json:"exportedAt"`
	Events         []VisitorEventExport         `json:"events"`
	ReplaySessions []VisitorReplaySessionExport `json:"replaySessions"`
	ReplayChunks   []VisitorReplayChunkExport   `json:"replayChunks"`
}

type VisitorDeleteResult struct {
	VisitorID             string   `json:"visitorId"`
	DeletedEvents         int      `json:"deletedEvents"`
	DeletedReplaySessions int      `json:"deletedReplaySessions"`
	DeletedReplayChunks   int      `json:"deletedReplayChunks"`
	Async                 bool     `json:"async"`
	Mutations             []string `json:"mutations,omitempty"`
}

func exportEventMeta(raw string) map[string]any {
	if raw == "" {
		return nil
	}

	meta := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &meta); err != nil {
		return map[string]any{"raw": raw}
	}
	return meta
}

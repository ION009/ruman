package storage

import (
	"context"
	"strings"
	"time"
)

type ExportEvent struct {
	Timestamp string         `json:"timestamp"`
	Name      string         `json:"name"`
	Path      string         `json:"path"`
	SessionID string         `json:"sessionId,omitempty"`
	X         *float64       `json:"x,omitempty"`
	Y         *float64       `json:"y,omitempty"`
	Selector  string         `json:"selector,omitempty"`
	Depth     int            `json:"depth,omitempty"`
	HasDepth  bool           `json:"-"`
	Meta      map[string]any `json:"meta,omitempty"`
}

type ExportProvider interface {
	ExportEvents(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]ExportEvent, error)
}

func (s *MemoryStore) ExportEvents(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]ExportEvent, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return nil, err
	}
	return exportDashboardEvents(events), nil
}

func exportDashboardEvents(events []dashboardEvent) []ExportEvent {
	output := make([]ExportEvent, 0, len(events))
	for _, event := range events {
		meta := sanitizeExportMeta(event.Meta)
		output = append(output, ExportEvent{
			Timestamp: event.Timestamp.UTC().Format(time.RFC3339Nano),
			Name:      strings.TrimSpace(event.Name),
			Path:      normalizePath(event.Path),
			SessionID: strings.TrimSpace(event.sessionKey()),
			X:         event.X,
			Y:         event.Y,
			Selector:  strings.TrimSpace(event.Selector),
			Depth:     event.Depth,
			HasDepth:  event.HasDepth,
			Meta:      meta,
		})
	}
	return output
}

func sanitizeExportMeta(meta map[string]any) map[string]any {
	if len(meta) == 0 {
		return nil
	}

	sanitized := map[string]any{}
	for key, value := range meta {
		switch strings.TrimSpace(strings.ToLower(key)) {
		case "ip", "vid", "visitor_id", "anonymized_ip":
			continue
		default:
			sanitized[key] = value
		}
	}
	if len(sanitized) == 0 {
		return nil
	}
	return sanitized
}

package storage

import (
	"testing"
	"time"
)

func TestBuildJourneysViewAggregatesRoutesAndFilters(t *testing.T) {
	now := time.Date(2026, time.March, 11, 12, 0, 0, 0, time.UTC)
	events := []dashboardEvent{
		{
			Timestamp: now.Add(-10 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "pageview",
			Path:      "/",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-9 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-8 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "pageview",
			Path:      "/checkout",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-7 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "pageview",
			Path:      "/",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
		{
			Timestamp: now.Add(-6 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "pageview",
			Path:      "/features",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
		{
			Timestamp: now.Add(-5 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "pageview",
			Path:      "/blog/12345",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-4 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
	}

	view := buildJourneysView(events, JourneyQuery{
		ReplaySessionIDs: []string{"session-a"},
	}, Range7Days)

	if view.Summary.Sessions != 3 || view.Summary.ReplayBackedSessions != 1 || view.Summary.UniqueTransitions != 4 {
		t.Fatalf("unexpected journey summary: %+v", view.Summary)
	}
	if len(view.CommonPaths) != 3 {
		t.Fatalf("expected three common paths, got %+v", view.CommonPaths)
	}
	if len(view.EntryDistribution) == 0 || view.EntryDistribution[0].Path != "/" || view.EntryDistribution[0].Count != 2 {
		t.Fatalf("unexpected entry distribution: %+v", view.EntryDistribution)
	}
	if len(view.Filters.Devices) != 2 || len(view.Filters.Countries) != 2 {
		t.Fatalf("expected filter options for devices and countries, got %+v", view.Filters)
	}
	foundHybridNode := false
	for _, node := range view.Nodes {
		if node.CanonicalPath == "/pricing" && node.StageIndex == 1 {
			foundHybridNode = node.Provenance == "hybrid"
		}
	}
	if !foundHybridNode {
		t.Fatalf("expected stage-1 pricing node to be marked hybrid, got %+v", view.Nodes)
	}

	filtered := buildJourneysView(events, JourneyQuery{
		DeviceFilter:     "desktop",
		CountryFilter:    "US",
		ReplaySessionIDs: []string{"session-a"},
	}, Range7Days)
	if filtered.Summary.Sessions != 2 {
		t.Fatalf("expected only desktop US routes to remain, got %+v", filtered.Summary)
	}
	if filtered.Filters.Device != "desktop" || filtered.Filters.Country != "US" {
		t.Fatalf("unexpected selected filters: %+v", filtered.Filters)
	}
	if filtered.PathLengthDistribution[0].Length != 2 {
		t.Fatalf("expected shortest filtered path length to be 2, got %+v", filtered.PathLengthDistribution)
	}
}

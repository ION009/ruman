package storage

import (
	"testing"
	"time"
)

func TestBuildEventExplorerViewSupportsPathFilteringAndLiveSignals(t *testing.T) {
	now := time.Date(2026, time.March, 11, 12, 0, 0, 0, time.UTC)
	events := []dashboardEvent{
		{
			Timestamp: now.Add(-10 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "page_view",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-9*time.Minute - 30*time.Second),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "signup complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States", "pr": map[string]any{"plan": "pro"}},
		},
		{
			Timestamp: now.Add(-9*time.Minute - 29*time.Second),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "signup complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States", "pr": map[string]any{"plan": "pro"}},
		},
		{
			Timestamp: now.Add(-9 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "click",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-8 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "routechange",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
		{
			Timestamp: now.Add(-7 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "signup_complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India", "pr": map[string]any{"plan": "starter"}},
		},
		{
			Timestamp: now.Add(-6 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "click",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
		{
			Timestamp: now.Add(-5 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "GB", "gct": "United Kingdom"},
		},
		{
			Timestamp: now.Add(-4 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "signup-complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "GB", "gct": "United Kingdom", "pr": map[string]any{"plan": "team"}},
		},
		{
			Timestamp: now.Add(-3 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "click",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "GB", "gct": "United Kingdom"},
		},
		{
			Timestamp: now.Add(-2 * time.Minute),
			SessionID: "session-d",
			VisitorID: "visitor-d",
			Name:      "pageview",
			Path:      "/docs",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-8 * 24 * time.Hour),
			SessionID: "session-prev-a",
			VisitorID: "visitor-prev-a",
			Name:      "signup_complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "desktop", "gcc": "US", "gct": "United States"},
		},
		{
			Timestamp: now.Add(-8*24*time.Hour + 2*time.Minute),
			SessionID: "session-prev-b",
			VisitorID: "visitor-prev-b",
			Name:      "signup_complete",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
		{
			Timestamp: now.Add(-8*24*time.Hour + 4*time.Minute),
			SessionID: "session-prev-c",
			VisitorID: "visitor-prev-c",
			Name:      "click",
			Path:      "/pricing",
			Meta:      map[string]any{"dt": "mobile", "gcc": "IN", "gct": "India"},
		},
	}

	view := buildEventExplorerView(events, EventExplorerQuery{Path: "/pricing"}, Range7Days, now)

	if view.SelectedPath != "/pricing" {
		t.Fatalf("expected selected path /pricing, got %+v", view.SelectedPath)
	}
	if len(view.Paths) < 2 || view.Paths[0].Path != "/pricing" {
		t.Fatalf("expected path options including /pricing and /docs, got %+v", view.Paths)
	}
	if view.Summary.DeduplicatedEvents != 1 {
		t.Fatalf("expected one deduplicated event, got %+v", view.Summary)
	}
	if view.Summary.DuplicateRate <= 0 {
		t.Fatalf("expected positive duplicate rate, got %+v", view.Summary)
	}
	if view.Summary.FreshnessLabel == "" {
		t.Fatalf("expected freshness label, got %+v", view.Summary)
	}
	if len(view.Families) < 3 {
		t.Fatalf("expected family summaries, got %+v", view.Families)
	}
	if len(view.Live.Movement) != eventLiveBucketCount {
		t.Fatalf("expected %d live movement points, got %+v", eventLiveBucketCount, view.Live.Movement)
	}
	if view.Live.ActiveSessions != 3 || view.Live.ActiveVisitors != 3 {
		t.Fatalf("expected three active pricing sessions/visitors, got %+v", view.Live)
	}
	if len(view.Live.ActivePages) == 0 || view.Live.ActivePages[0].Label != "/pricing" {
		t.Fatalf("expected /pricing live page activity, got %+v", view.Live.ActivePages)
	}
	foundSignup := false
	for _, entry := range view.Catalog {
		if entry.Name == "signup_complete" {
			foundSignup = true
			break
		}
	}
	if !foundSignup {
		t.Fatalf("expected normalized signup_complete catalog entry, got %+v", view.Catalog)
	}
	if len(view.LiveFeed) == 0 {
		t.Fatalf("expected live feed items, got %+v", view.LiveFeed)
	}
	for _, item := range view.LiveFeed {
		if item.Path != "/pricing" {
			t.Fatalf("expected path-filtered live feed, got %+v", view.LiveFeed)
		}
	}
}

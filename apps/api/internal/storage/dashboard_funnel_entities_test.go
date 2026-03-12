package storage

import (
	"testing"
	"time"
)

func TestBuildFunnelEntitiesReachedAndDropped(t *testing.T) {
	now := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC)
	events := []dashboardEvent{
		{
			Timestamp: now.Add(-30 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "pageview",
			Path:      "/",
			Meta: map[string]any{
				"dt": "desktop",
				"br": "Chrome",
				"os": "macOS",
			},
		},
		{
			Timestamp: now.Add(-29 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-28 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "add_to_cart",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-27 * time.Minute),
			SessionID: "session-a",
			VisitorID: "visitor-a",
			Name:      "purchase",
			Path:      "/checkout",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-24 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "pageview",
			Path:      "/",
			Meta: map[string]any{
				"dt": "mobile",
				"br": "Safari",
				"os": "iOS",
			},
		},
		{
			Timestamp: now.Add(-23 * time.Minute),
			SessionID: "session-b",
			VisitorID: "visitor-b",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-20 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "pageview",
			Path:      "/",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-19 * time.Minute),
			SessionID: "session-c",
			VisitorID: "visitor-c",
			Name:      "add_to_cart",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
	}

	query := FunnelQuery{
		CountMode:     "sessions",
		WindowMinutes: 30,
		Steps: []FunnelStepDefinition{
			{Label: "Landing", Kind: "page", MatchType: "exact", Value: "/"},
			{Label: "Pricing", Kind: "page", MatchType: "exact", Value: "/pricing"},
			{Label: "Cart", Kind: "event", MatchType: "exact", Value: "add_to_cart"},
			{Label: "Purchase", Kind: "event", MatchType: "exact", Value: "purchase"},
		},
	}

	reached := buildFunnelEntities(events, query, 1, FunnelEntityStatusReached, 1, 10, Range7Days)
	if reached.Total != 2 {
		t.Fatalf("expected 2 reached entities for pricing step, got %+v", reached)
	}
	if reached.StepLabel != "Pricing" || reached.Inspection.Entrants != 3 || reached.Inspection.Reached != 2 || reached.Inspection.Dropped != 1 {
		t.Fatalf("unexpected reached inspection payload: %+v", reached)
	}
	if reached.Entities[0].EntityID != "session-b" || reached.Entities[1].EntityID != "session-a" {
		t.Fatalf("expected session-b then session-a ordered by recency, got %+v", reached.Entities)
	}

	entered := buildFunnelEntities(events, query, 2, FunnelEntityStatusEntered, 1, 10, Range7Days)
	if entered.Total != 2 {
		t.Fatalf("expected 2 entered entities for cart step, got %+v", entered)
	}
	if entered.Inspection.Entrants != 2 || entered.Inspection.Reached != 1 || entered.Inspection.Dropped != 1 {
		t.Fatalf("unexpected entered inspection payload: %+v", entered.Inspection)
	}

	dropped := buildFunnelEntities(events, query, 2, FunnelEntityStatusDropped, 1, 10, Range7Days)
	if dropped.Total != 1 {
		t.Fatalf("expected 1 dropped entity before cart step, got %+v", dropped)
	}
	if dropped.Entities[0].EntityID != "session-b" {
		t.Fatalf("expected session-b to drop before cart step, got %+v", dropped.Entities[0])
	}
	if dropped.Entities[0].EntryPath != "/" || dropped.Entities[0].ExitPath != "/pricing" {
		t.Fatalf("unexpected entry/exit paths: %+v", dropped.Entities[0])
	}
	if dropped.Entities[0].Pageviews != 2 || dropped.Entities[0].EventCount != 0 {
		t.Fatalf("unexpected activity counts: %+v", dropped.Entities[0])
	}
	if dropped.Entities[0].MatchedStepCount != 2 || dropped.Entities[0].Completed || dropped.Entities[0].DropOffStepIndex != 2 || dropped.Entities[0].DropOffStepLabel != "Cart" {
		t.Fatalf("unexpected drop-off metadata: %+v", dropped.Entities[0])
	}
	if len(dropped.Entities[0].MatchedSteps) != 2 || dropped.Entities[0].MatchedSteps[1].SecondsFromPrevious != 60 {
		t.Fatalf("unexpected matched-step timeline: %+v", dropped.Entities[0].MatchedSteps)
	}
}

func TestBuildFunnelReportIncludesInspectionAndTimings(t *testing.T) {
	now := time.Date(2026, time.March, 9, 12, 0, 0, 0, time.UTC)
	events := []dashboardEvent{
		{Timestamp: now.Add(-30 * time.Minute), SessionID: "session-a", VisitorID: "visitor-a", Name: "pageview", Path: "/"},
		{Timestamp: now.Add(-29 * time.Minute), SessionID: "session-a", VisitorID: "visitor-a", Name: "pageview", Path: "/pricing"},
		{Timestamp: now.Add(-28 * time.Minute), SessionID: "session-a", VisitorID: "visitor-a", Name: "add_to_cart", Path: "/pricing"},
		{Timestamp: now.Add(-27 * time.Minute), SessionID: "session-a", VisitorID: "visitor-a", Name: "purchase", Path: "/checkout"},
		{Timestamp: now.Add(-24 * time.Minute), SessionID: "session-b", VisitorID: "visitor-b", Name: "pageview", Path: "/"},
		{Timestamp: now.Add(-23 * time.Minute), SessionID: "session-b", VisitorID: "visitor-b", Name: "pageview", Path: "/pricing"},
		{Timestamp: now.Add(-20 * time.Minute), SessionID: "session-c", VisitorID: "visitor-c", Name: "pageview", Path: "/"},
	}

	query := FunnelQuery{
		CountMode:     "sessions",
		WindowMinutes: 30,
		Steps: []FunnelStepDefinition{
			{Label: "Landing", Kind: "page", MatchType: "exact", Value: "/"},
			{Label: "Pricing", Kind: "page", MatchType: "exact", Value: "/pricing"},
			{Label: "Cart", Kind: "event", MatchType: "exact", Value: "add_to_cart"},
			{Label: "Purchase", Kind: "event", MatchType: "exact", Value: "purchase"},
		},
	}

	report := buildFunnelReport(events, query, Range7Days)
	if len(report.Inspection) != 4 {
		t.Fatalf("expected inspection rows for each step, got %+v", report.Inspection)
	}
	if report.Inspection[1].Entrants != 3 || report.Inspection[1].Reached != 2 || report.Inspection[1].Dropped != 1 {
		t.Fatalf("unexpected pricing inspection row: %+v", report.Inspection[1])
	}
	if len(report.StepTimings) != 3 {
		t.Fatalf("expected timing rows for non-entry steps, got %+v", report.StepTimings)
	}
	if report.StepTimings[0].StepIndex != 1 || report.StepTimings[0].SampleCount != 2 || report.StepTimings[0].MedianSecondsFromPrevious != 60 {
		t.Fatalf("unexpected pricing timing row: %+v", report.StepTimings[0])
	}
	if report.CompletionTime.SampleCount != 1 || report.CompletionTime.AvgSeconds != 180 || report.CompletionTime.P90Seconds != 180 {
		t.Fatalf("unexpected completion timing: %+v", report.CompletionTime)
	}
	if report.Steps[1].Entrants != 3 || report.Steps[2].Entrants != 2 {
		t.Fatalf("unexpected entrant counts in steps: %+v", report.Steps)
	}
}

func TestBuildEventNameMetricsFiltersSystemEvents(t *testing.T) {
	events := []dashboardEvent{
		{Name: "pageview"},
		{Name: "click"},
		{Name: "perf_lcp"},
		{Name: "signup"},
		{Name: "signup"},
		{Name: "purchase"},
	}

	metrics := buildEventNameMetrics(events)
	if len(metrics) != 2 {
		t.Fatalf("expected only custom events to remain, got %+v", metrics)
	}
	if metrics[0].Name != "signup" || metrics[0].Count != 2 {
		t.Fatalf("expected signup to be top event, got %+v", metrics[0])
	}
	if metrics[1].Name != "purchase" || metrics[1].Count != 1 {
		t.Fatalf("expected purchase to remain, got %+v", metrics[1])
	}
}

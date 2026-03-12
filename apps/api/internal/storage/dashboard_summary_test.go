package storage

import (
	"testing"
	"time"
)

func TestBuildDashboardSummaryComputesDerivedMetricsAndComparisons(t *testing.T) {
	now := time.Date(2026, time.March, 10, 12, 0, 0, 0, time.UTC)
	events := []dashboardEvent{
		{
			Timestamp: now.Add(-15 * 24 * time.Hour),
			SessionID: "session-baseline-a",
			VisitorID: "visitor-returning",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"r": "https://google.com"},
		},
		{
			Timestamp: now.Add(-15*24*time.Hour + 30*time.Minute),
			SessionID: "session-baseline-b",
			VisitorID: "visitor-prevreturn",
			Name:      "pageview",
			Path:      "/docs",
			Meta:      map[string]any{"r": "https://newsletter.example"},
		},
		{
			Timestamp: now.Add(-8 * 24 * time.Hour),
			SessionID: "session-previous-a",
			VisitorID: "visitor-returning",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"r": "https://google.com"},
		},
		{
			Timestamp: now.Add(-8*24*time.Hour + 2*time.Minute),
			SessionID: "session-previous-a",
			VisitorID: "visitor-returning",
			Name:      "add_to_cart",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-9 * 24 * time.Hour),
			SessionID: "session-previous-b",
			VisitorID: "visitor-prevreturn",
			Name:      "pageview",
			Path:      "/docs",
			Meta:      map[string]any{"r": "https://newsletter.example"},
		},
		{
			Timestamp: now.Add(-8*24*time.Hour + 5*time.Hour),
			SessionID: "session-previous-c",
			VisitorID: "visitor-prev-new",
			Name:      "pageview",
			Path:      "/blog",
			Meta:      map[string]any{"r": "https://twitter.com"},
		},
		{
			Timestamp: now.Add(-24*time.Hour - 2*time.Hour),
			SessionID: "session-current-a",
			VisitorID: "visitor-returning",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"r": "https://google.com"},
		},
		{
			Timestamp: now.Add(-24*time.Hour - 119*time.Minute),
			SessionID: "session-current-a",
			VisitorID: "visitor-returning",
			Name:      "scroll",
			Path:      "/pricing",
			Depth:     80,
			HasDepth:  true,
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-24*time.Hour - 118*time.Minute),
			SessionID: "session-current-a",
			VisitorID: "visitor-returning",
			Name:      "click",
			Path:      "/pricing",
			Meta:      map[string]any{"rg": true, "dg": true},
		},
		{
			Timestamp: now.Add(-24*time.Hour - 116*time.Minute),
			SessionID: "session-current-a",
			VisitorID: "visitor-returning",
			Name:      "add_to_cart",
			Path:      "/pricing",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-24*time.Hour - 115*time.Minute),
			SessionID: "session-current-a",
			VisitorID: "visitor-returning",
			Name:      "purchase",
			Path:      "/checkout/success",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-2*24*time.Hour - 3*time.Hour),
			SessionID: "session-current-b",
			VisitorID: "visitor-new",
			Name:      "pageview",
			Path:      "/docs",
			Meta:      map[string]any{"r": "https://twitter.com"},
		},
		{
			Timestamp: now.Add(-3*24*time.Hour + 2*time.Hour),
			SessionID: "session-current-c",
			VisitorID: "visitor-new-2",
			Name:      "pageview",
			Path:      "/pricing",
			Meta:      map[string]any{"r": "https://google.com"},
		},
		{
			Timestamp: now.Add(-3*24*time.Hour + 2*time.Hour + 2*time.Minute),
			SessionID: "session-current-c",
			VisitorID: "visitor-new-2",
			Name:      "pageview",
			Path:      "/checkout",
			Meta:      map[string]any{},
		},
		{
			Timestamp: now.Add(-3*24*time.Hour + 2*time.Hour + 3*time.Minute),
			SessionID: "session-current-c",
			VisitorID: "visitor-new-2",
			Name:      "purchase",
			Path:      "/checkout",
			Meta:      map[string]any{},
		},
	}

	summary := buildDashboardSummary(events, Range7Days, now)

	if summary.Overview.Pageviews != 4 || summary.Overview.Sessions != 3 {
		t.Fatalf("expected current overview pageviews=4 sessions=3, got %+v", summary.Overview)
	}
	if summary.ComparisonRange == "" {
		t.Fatalf("expected comparison range to be present, got %+v", summary)
	}
	if summary.Derived.EngagedSessions.Current != 2 || summary.Derived.EngagedSessions.Previous != 1 {
		t.Fatalf("expected engaged sessions current=2 previous=1, got %+v", summary.Derived.EngagedSessions)
	}
	if summary.Derived.ReturningVisitorRatio.ReturningVisitors != 1 || summary.Derived.ReturningVisitorRatio.NewVisitors != 2 {
		t.Fatalf("expected returning/new visitors 1/2, got %+v", summary.Derived.ReturningVisitorRatio)
	}
	if !almostEqual(summary.Derived.ReturningVisitorRatio.Ratio.Current, 33.3, 0.1) {
		t.Fatalf("expected returning visitor ratio about 33.3, got %+v", summary.Derived.ReturningVisitorRatio)
	}
	if summary.Derived.FrictionScore.Current <= summary.Derived.FrictionScore.Previous {
		t.Fatalf("expected friction to increase versus previous period, got %+v", summary.Derived.FrictionScore)
	}
	if !almostEqual(summary.Derived.SessionDuration.Current, 160.0, 0.5) {
		t.Fatalf("expected session duration about 160s, got %+v", summary.Derived.SessionDuration)
	}
	if summary.Derived.PageFocusScore.Current <= 0 {
		t.Fatalf("expected positive page focus score, got %+v", summary.Derived.PageFocusScore)
	}
	if len(summary.Derived.TopPathMomentum) == 0 || summary.Derived.TopPathMomentum[0].Path != "/pricing" {
		t.Fatalf("expected /pricing to lead path momentum, got %+v", summary.Derived.TopPathMomentum)
	}
	if len(summary.Derived.ConversionAssist) < 2 || summary.Derived.ConversionAssist[0].Path != "/pricing" {
		t.Fatalf("expected /pricing to lead conversion assist, got %+v", summary.Derived.ConversionAssist)
	}
	if len(summary.TopPages) == 0 || summary.TopPages[0].Path != "/pricing" {
		t.Fatalf("expected /pricing top page, got %+v", summary.TopPages)
	}
	if !almostEqual(summary.TopPages[0].ConversionAssistScore, 100, 0.1) {
		t.Fatalf("expected /pricing conversion assist score near 100, got %+v", summary.TopPages[0])
	}
	if len(summary.Referrers) == 0 || summary.Referrers[0].Source != "google.com" {
		t.Fatalf("expected google.com to lead referrers, got %+v", summary.Referrers)
	}
	if summary.Referrers[0].QualityScore <= summary.Referrers[len(summary.Referrers)-1].QualityScore {
		t.Fatalf("expected higher-quality referrer to rank first, got %+v", summary.Referrers)
	}
	if len(summary.Derived.EngagedSessions.Trend) != 7 || len(summary.OverviewComparison.Pageviews.Trend) != 7 {
		t.Fatalf("expected 7-point sparkline arrays, got derived=%d overview=%d", len(summary.Derived.EngagedSessions.Trend), len(summary.OverviewComparison.Pageviews.Trend))
	}
}

func almostEqual(value, expected, tolerance float64) bool {
	if value > expected+tolerance {
		return false
	}
	if value < expected-tolerance {
		return false
	}
	return true
}

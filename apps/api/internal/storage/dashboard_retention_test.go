package storage

import (
	"testing"
	"time"
)

func TestBuildRetentionReportAndTrend(t *testing.T) {
	days := []retentionActivityDay{
		{UserID: "u1", ActivityDay: dateUTC(2026, time.January, 1), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u1", ActivityDay: dateUTC(2026, time.January, 2), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u1", ActivityDay: dateUTC(2026, time.January, 8), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u1", ActivityDay: dateUTC(2026, time.January, 15), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u1", ActivityDay: dateUTC(2026, time.January, 31), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u2", ActivityDay: dateUTC(2026, time.January, 1), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u2", ActivityDay: dateUTC(2026, time.January, 2), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u2", ActivityDay: dateUTC(2026, time.January, 8), Device: "desktop", CountryCode: "US", CountryName: "United States"},
		{UserID: "u3", ActivityDay: dateUTC(2026, time.January, 1), Device: "mobile", CountryCode: "IN", CountryName: "India"},
		{UserID: "u4", ActivityDay: dateUTC(2026, time.January, 8), Device: "mobile", CountryCode: "IN", CountryName: "India"},
		{UserID: "u4", ActivityDay: dateUTC(2026, time.January, 9), Device: "mobile", CountryCode: "IN", CountryName: "India"},
		{UserID: "u5", ActivityDay: dateUTC(2026, time.January, 8), Device: "mobile", CountryCode: "IN", CountryName: "India"},
		{UserID: "u6", ActivityDay: dateUTC(2026, time.January, 8), Device: "mobile", CountryCode: "IN", CountryName: "India"},
		{UserID: "u6", ActivityDay: dateUTC(2026, time.January, 15), Device: "mobile", CountryCode: "IN", CountryName: "India"},
	}

	rangeValue := NewCustomTimeRange(dateUTC(2026, time.January, 1), dateUTC(2026, time.January, 31))
	report := buildRetentionReport(days, RetentionQuery{Cadence: "daily"}, rangeValue, dateUTC(2026, time.January, 31))
	if report.Summary.Users != 6 || report.Summary.Day1Rate != 50 || report.Summary.Day7Rate != 50 || report.Summary.Day14Rate != 16.7 || report.Summary.Day30Rate != 33.3 {
		t.Fatalf("unexpected retention summary: %+v", report.Summary)
	}
	if len(report.Cohorts) != 2 {
		t.Fatalf("expected two cohorts, got %+v", report.Cohorts)
	}
	if report.Cohorts[1].CohortDate != "2026-01-01" || report.Cohorts[1].Points[0].ReturnedUsers != 2 {
		t.Fatalf("unexpected Jan 1 cohort row: %+v", report.Cohorts[1])
	}

	filtered := buildRetentionReport(days, RetentionQuery{Cadence: "daily", DeviceFilter: "mobile", CountryFilter: "IN"}, rangeValue, dateUTC(2026, time.January, 31))
	if filtered.Summary.Users != 4 || filtered.Filters.Device != "mobile" || filtered.Filters.Country != "IN" {
		t.Fatalf("unexpected filtered retention report: %+v", filtered)
	}

	trend := buildRetentionTrend(days, RetentionQuery{Cadence: "weekly"}, rangeValue, dateUTC(2026, time.January, 31))
	if len(trend.Curve) != 4 || trend.Filters.Cadence != "weekly" {
		t.Fatalf("unexpected retention trend payload: %+v", trend)
	}
	if trend.Curve[0].Period != 1 || trend.Curve[0].Rate != 50 {
		t.Fatalf("unexpected day-1 trend point: %+v", trend.Curve[0])
	}
}

func dateUTC(year int, month time.Month, day int) time.Time {
	return time.Date(year, month, day, 0, 0, 0, 0, time.UTC)
}

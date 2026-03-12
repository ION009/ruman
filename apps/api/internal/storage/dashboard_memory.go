package storage

import (
	"context"
	"strings"
	"time"
)

func (s *MemoryStore) DashboardSummary(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) (DashboardSummary, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	baselineRange := comparisonTimeRange(comparisonRange, comparisonRange.Until(now.UTC()))
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), baselineRange.Since(now.UTC()))
	if err != nil {
		return DashboardSummary{}, err
	}
	return buildDashboardSummary(events, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) Map(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) (MapView, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), comparisonRange.Since(now.UTC()))
	if err != nil {
		return MapView{}, err
	}
	return buildMapView(events, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) Journeys(
	_ context.Context,
	siteID string,
	query JourneyQuery,
	rangeValue TimeRange,
	now time.Time,
) (JourneysView, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return JourneysView{}, err
	}
	return buildJourneysView(events, query, rangeValue), nil
}

func (s *MemoryStore) RetentionReport(
	_ context.Context,
	siteID string,
	query RetentionQuery,
	rangeValue TimeRange,
	now time.Time,
) (RetentionReport, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), time.Time{})
	if err != nil {
		return RetentionReport{}, err
	}
	return buildRetentionReport(retentionActivityFromEvents(events), query, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) RetentionTrend(
	_ context.Context,
	siteID string,
	query RetentionQuery,
	rangeValue TimeRange,
	now time.Time,
) (RetentionTrendView, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), time.Time{})
	if err != nil {
		return RetentionTrendView{}, err
	}
	return buildRetentionTrend(retentionActivityFromEvents(events), query, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) FunnelReport(
	_ context.Context,
	siteID string,
	query FunnelQuery,
	rangeValue TimeRange,
	now time.Time,
) (FunnelReport, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return FunnelReport{}, err
	}
	return buildFunnelReport(events, query, rangeValue), nil
}

func (s *MemoryStore) FunnelEntities(
	_ context.Context,
	siteID string,
	query FunnelQuery,
	stepIndex int,
	status FunnelEntityStatus,
	page int,
	limit int,
	rangeValue TimeRange,
	now time.Time,
) (FunnelEntityList, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return FunnelEntityList{}, err
	}
	return buildFunnelEntities(events, query, stepIndex, status, page, limit, rangeValue), nil
}

func (s *MemoryStore) Heatmap(
	_ context.Context,
	siteID, path string,
	rangeValue TimeRange,
	mode HeatmapMode,
	clickFilter HeatmapClickFilter,
	viewportSegment HeatmapViewportSegment,
	now time.Time,
) (HeatmapView, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return HeatmapView{}, err
	}
	return buildHeatmapView(events, path, rangeValue, mode, clickFilter, viewportSegment, now.UTC()), nil
}

func (s *MemoryStore) Insights(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) (InsightsView, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return InsightsView{}, err
	}
	return buildInsightsView(events, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) EventNames(_ context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]EventNameMetric, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return nil, err
	}
	return buildEventNameMetrics(events), nil
}

func (s *MemoryStore) EventExplorer(
	_ context.Context,
	siteID string,
	query EventExplorerQuery,
	rangeValue TimeRange,
	now time.Time,
) (EventExplorerView, error) {
	comparisonRange := comparisonTimeRange(rangeValue, now.UTC())
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), comparisonRange.Since(now.UTC()))
	if err != nil {
		return EventExplorerView{}, err
	}
	return buildEventExplorerView(events, query, rangeValue, now.UTC()), nil
}

func (s *MemoryStore) SiteStats(_ context.Context, siteID string) (SiteStats, error) {
	events, err := decodeStoredEvents(s.Events(), strings.TrimSpace(siteID), time.Time{})
	if err != nil {
		return SiteStats{}, err
	}
	return collectSiteStats(events), nil
}

func (s *MemoryStore) ErrorBoard(_ context.Context, _ string, rangeValue TimeRange, _ time.Time) (ErrorBoardView, error) {
	return ErrorBoardView{
		Range:   rangeValue.String(),
		Summary: ErrorBoardSummary{},
		Groups:  nil,
	}, nil
}

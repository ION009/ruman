package storage

import (
	"context"
	"time"
)

func (s *ClickHouseStore) PreviewSegment(ctx context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentPreview, error) {
	baseRows, rangeEvents, err := s.segmentBaseRows(ctx, siteID, rangeValue, now.UTC())
	if err != nil {
		return SegmentPreview{}, err
	}
	return buildSegmentPreview(siteID, definition, query, rangeValue, baseRows, rangeEvents), nil
}

func (s *ClickHouseStore) SegmentMembers(ctx context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentMembers, error) {
	baseRows, rangeEvents, err := s.segmentBaseRows(ctx, siteID, rangeValue, now.UTC())
	if err != nil {
		return SegmentMembers{}, err
	}
	return buildSegmentMembers(siteID, definition, query, rangeValue, baseRows, rangeEvents), nil
}

func (s *ClickHouseStore) CohortAnalysis(ctx context.Context, siteID string, query CohortAnalysisQuery, rangeValue TimeRange, now time.Time) (CohortAnalysisReport, error) {
	baseRows, rangeEvents, err := s.segmentBaseRows(ctx, siteID, rangeValue, now.UTC())
	if err != nil {
		return CohortAnalysisReport{}, err
	}
	return buildCohortAnalysis(query, rangeValue, rangeEvents, baseRows, now.UTC()), nil
}

func (s *ClickHouseStore) segmentBaseRows(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]UserRow, []dashboardEvent, error) {
	profiles, activity, err := s.loadUserAggregates(ctx, siteID, rangeValue, now.UTC())
	if err != nil {
		return nil, nil, err
	}
	rows := make([]UserRow, 0, len(activity))
	for userKey, counts := range activity {
		profile := profiles[userKey]
		rows = append(rows, UserRow{
			UserKey:   userKey,
			UserHash:  profile.UserHash,
			Alias:     profile.Alias,
			Country:   firstNonEmptyString(profile.Country, "Unknown"),
			State:     firstNonEmptyString(profile.State, "Unknown"),
			Browser:   firstNonEmptyString(profile.Browser, "Unknown"),
			OS:        firstNonEmptyString(profile.OS, "Unknown"),
			Pageviews: counts.Pageviews,
			Events:    counts.Events,
			FirstSeen: profile.FirstSeen.UTC().Format(time.RFC3339),
			LastSeen:  profile.LastSeen.UTC().Format(time.RFC3339),
		})
	}
	rangeEvents, err := s.loadUserEvents(ctx, siteID, nil, rangeValue.Since(now.UTC()), now.UTC())
	if err != nil {
		return nil, nil, err
	}
	return rows, rangeEvents, nil
}

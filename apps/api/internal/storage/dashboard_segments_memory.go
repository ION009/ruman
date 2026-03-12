package storage

import (
	"context"
	"time"
)

func (s *MemoryStore) PreviewSegment(_ context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentPreview, error) {
	events := s.Events()
	lifetimeEvents, err := decodeStoredEvents(events, siteID, time.Time{})
	if err != nil {
		return SegmentPreview{}, err
	}
	rangeEvents, err := decodeStoredEvents(events, siteID, rangeValue.Since(now.UTC()))
	if err != nil {
		return SegmentPreview{}, err
	}
	return buildSegmentPreview(siteID, definition, query, rangeValue, buildUserRows(siteID, lifetimeEvents, rangeEvents), rangeEvents), nil
}

func (s *MemoryStore) SegmentMembers(_ context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentMembers, error) {
	events := s.Events()
	lifetimeEvents, err := decodeStoredEvents(events, siteID, time.Time{})
	if err != nil {
		return SegmentMembers{}, err
	}
	rangeEvents, err := decodeStoredEvents(events, siteID, rangeValue.Since(now.UTC()))
	if err != nil {
		return SegmentMembers{}, err
	}
	return buildSegmentMembers(siteID, definition, query, rangeValue, buildUserRows(siteID, lifetimeEvents, rangeEvents), rangeEvents), nil
}

func (s *MemoryStore) CohortAnalysis(_ context.Context, siteID string, query CohortAnalysisQuery, rangeValue TimeRange, now time.Time) (CohortAnalysisReport, error) {
	events := s.Events()
	rangeEvents, err := decodeStoredEvents(events, siteID, rangeValue.Since(now.UTC()))
	if err != nil {
		return CohortAnalysisReport{}, err
	}
	return buildCohortAnalysis(query, rangeValue, rangeEvents, buildUserRows(siteID, rangeEvents, rangeEvents), now.UTC()), nil
}

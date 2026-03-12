package storage

import (
	"context"
	"errors"
	"slices"
	"strings"
	"time"
)

func (s *MemoryStore) UserList(_ context.Context, siteID string, query UserListQuery, rangeValue TimeRange, now time.Time) (UserList, error) {
	events := s.Events()
	lifetimeEvents, err := decodeStoredEvents(events, strings.TrimSpace(siteID), time.Time{})
	if err != nil {
		return UserList{}, err
	}
	rangeEvents, err := decodeStoredEvents(events, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return UserList{}, err
	}

	rows := buildUserRows(strings.TrimSpace(siteID), lifetimeEvents, rangeEvents)
	normalized, total, paged := FilterAndPaginateUserRows(rows, query)
	return UserList{
		Range: rangeValue.String(),
		Page:  normalized.Page,
		Limit: normalized.Limit,
		Total: total,
		Sort:  normalized.Sort,
		Order: normalized.Order,
		Filters: UserListFilters{
			Search:  normalized.Search,
			Country: normalized.Country,
			Region:  normalized.Region,
			Browser: normalized.Browser,
			OS:      normalized.OS,
		},
		Privacy: DefaultUserPrivacyNote(),
		Users:   paged,
	}, nil
}

func (s *MemoryStore) UserDetail(_ context.Context, siteID, userHash string, rangeValue TimeRange, now time.Time) (UserDetail, error) {
	events := s.Events()
	lifetimeEvents, err := decodeStoredEvents(events, strings.TrimSpace(siteID), time.Time{})
	if err != nil {
		return UserDetail{}, err
	}
	rangeEvents, err := decodeStoredEvents(events, strings.TrimSpace(siteID), rangeValue.Since(now.UTC()))
	if err != nil {
		return UserDetail{}, err
	}

	detail, ok := buildUserDetail(strings.TrimSpace(siteID), strings.TrimSpace(userHash), lifetimeEvents, rangeEvents, s.userReplaySessions(siteID, userHash, rangeValue, now))
	if !ok {
		return UserDetail{}, errors.New("user not found")
	}
	detail.Range = rangeValue.String()
	return detail, nil
}

func (s *MemoryStore) userReplaySessions(siteID, userHash string, rangeValue TimeRange, now time.Time) []ReplaySessionSummary {
	s.mu.RLock()
	defer s.mu.RUnlock()

	since := rangeValue.Since(now.UTC())
	sessions := make([]ReplaySessionSummary, 0, len(s.replaySessions))
	for _, session := range s.replaySessions {
		if strings.TrimSpace(session.SiteID) != strings.TrimSpace(siteID) {
			continue
		}
		if !session.UpdatedAt.IsZero() && session.UpdatedAt.Before(since) {
			continue
		}
		if userHash != "" && UserHash(siteID, session.VisitorID) != strings.TrimSpace(userHash) {
			continue
		}
		sessions = append(sessions, ReplaySessionSummary{
			SessionID:           session.SessionID,
			StartedAt:           session.StartedAt.UTC().Format(time.RFC3339),
			UpdatedAt:           session.UpdatedAt.UTC().Format(time.RFC3339),
			DurationMS:          session.DurationMS,
			EntryPath:           session.EntryPath,
			ExitPath:            session.ExitPath,
			PageCount:           session.PageCount,
			RouteCount:          session.RouteCount,
			ChunkCount:          session.ChunkCount,
			EventCount:          session.EventCount,
			ErrorCount:          session.ErrorCount,
			ConsoleErrorCount:   session.ConsoleErrorCount,
			NetworkFailureCount: session.NetworkFailureCount,
			RageClickCount:      session.RageClickCount,
			DeadClickCount:      session.DeadClickCount,
			CustomEventCount:    session.CustomEventCount,
			DeviceType:          session.DeviceType,
			Browser:             session.Browser,
			OS:                  session.OS,
			Viewport:            session.Viewport,
			Paths:               slices.Clone(session.Paths),
			SampleRate:          session.SampleRate,
		})
	}
	return sessions
}

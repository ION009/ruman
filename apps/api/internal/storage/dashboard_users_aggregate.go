package storage

import (
	"slices"
	"strings"
	"time"
)

type userProfileAggregate struct {
	UserKey   string
	UserHash  string
	Alias     string
	Country   string
	State     string
	Browser   string
	OS        string
	FirstSeen time.Time
	LastSeen  time.Time
	Pageviews int
	Events    int
	TopPages  map[string]int
	TopEvents map[string]int
}

type userSessionAggregate struct {
	SessionID       string
	StartedAt       time.Time
	LastSeenAt      time.Time
	EntryPath       string
	ExitPath        string
	PageCount       int
	EventCount      int
	DurationSeconds int
	HasReplay       bool
}

func buildUserRows(siteID string, lifetimeEvents, rangeEvents []dashboardEvent) []UserRow {
	profiles := map[string]*userProfileAggregate{}
	for _, event := range lifetimeEvents {
		userKey := strings.TrimSpace(event.visitorKey())
		if userKey == "" || userKey == "unknown-visitor" {
			continue
		}
		current := profiles[userKey]
		if current == nil {
			current = &userProfileAggregate{
				UserKey:   userKey,
				UserHash:  UserHash(siteID, userKey),
				Alias:     FictionalUserName(UserHash(siteID, userKey)),
				TopPages:  map[string]int{},
				TopEvents: map[string]int{},
			}
			profiles[userKey] = current
		}
		if current.FirstSeen.IsZero() || event.Timestamp.Before(current.FirstSeen) {
			current.FirstSeen = event.Timestamp
		}
		if current.LastSeen.IsZero() || event.Timestamp.After(current.LastSeen) {
			current.LastSeen = event.Timestamp
		}
		if country := strings.TrimSpace(event.geoLocation().CountryCode); country != "" {
			current.Country = country
		}
		if state := strings.TrimSpace(event.geoLocation().RegionCode); state != "" {
			current.State = state
		}
		if browser := strings.TrimSpace(event.browserFamily()); browser != "" {
			current.Browser = browser
		}
		if os := strings.TrimSpace(event.osFamily()); os != "" {
			current.OS = os
		}
	}

	active := map[string]*userProfileAggregate{}
	for _, event := range rangeEvents {
		userKey := strings.TrimSpace(event.visitorKey())
		if userKey == "" || userKey == "unknown-visitor" {
			continue
		}
		base := profiles[userKey]
		if base == nil {
			continue
		}
		current := active[userKey]
		if current == nil {
			copied := *base
			copied.TopPages = map[string]int{}
			copied.TopEvents = map[string]int{}
			copied.Pageviews = 0
			copied.Events = 0
			current = &copied
			active[userKey] = current
		}
		current.Events += 1
		if event.Name == "pageview" {
			current.Pageviews += 1
			current.TopPages[event.Path] += 1
		} else if strings.TrimSpace(event.Name) != "" {
			current.TopEvents[event.Name] += 1
		}
	}

	rows := make([]UserRow, 0, len(active))
	for _, profile := range active {
		rows = append(rows, UserRow{
			UserKey:   profile.UserKey,
			UserHash:  profile.UserHash,
			Alias:     profile.Alias,
			Country:   firstNonEmptyString(profile.Country, "Unknown"),
			State:     firstNonEmptyString(profile.State, "Unknown"),
			Browser:   firstNonEmptyString(profile.Browser, "Unknown"),
			OS:        firstNonEmptyString(profile.OS, "Unknown"),
			Pageviews: profile.Pageviews,
			Events:    profile.Events,
			TopPages:  toUserCountItems(profile.TopPages, 4),
			TopEvents: toUserCountItems(profile.TopEvents, 4),
			FirstSeen: profile.FirstSeen.UTC().Format(time.RFC3339),
			LastSeen:  profile.LastSeen.UTC().Format(time.RFC3339),
		})
	}
	return rows
}

func buildUserDetail(siteID, userHash string, lifetimeEvents, rangeEvents []dashboardEvent, replaySessions []ReplaySessionSummary) (UserDetail, bool) {
	rows := buildUserRows(siteID, lifetimeEvents, rangeEvents)
	var row UserRow
	found := false
	for _, candidate := range rows {
		if candidate.UserHash == userHash {
			row = candidate
			found = true
			break
		}
	}
	if !found {
		for _, event := range lifetimeEvents {
			userKey := strings.TrimSpace(event.visitorKey())
			if UserHash(siteID, userKey) != userHash {
				continue
			}
			row = UserRow{
				UserKey:   userKey,
				UserHash:  userHash,
				Alias:     FictionalUserName(userHash),
				Country:   firstNonEmptyString(event.geoLocation().CountryCode, "Unknown"),
				State:     firstNonEmptyString(event.geoLocation().RegionCode, "Unknown"),
				Browser:   firstNonEmptyString(event.browserFamily(), "Unknown"),
				OS:        firstNonEmptyString(event.osFamily(), "Unknown"),
				FirstSeen: event.Timestamp.UTC().Format(time.RFC3339),
				LastSeen:  event.Timestamp.UTC().Format(time.RFC3339),
			}
			found = true
			break
		}
	}
	if !found {
		return UserDetail{}, false
	}

	pageCounts := map[string]int{}
	eventCounts := map[string]int{}
	sessionMap := map[string]*userSessionAggregate{}
	for _, event := range rangeEvents {
		userKey := strings.TrimSpace(event.visitorKey())
		if UserHash(siteID, userKey) != userHash {
			continue
		}
		if event.Name == "pageview" {
			pageCounts[event.Path] += 1
		} else if strings.TrimSpace(event.Name) != "" {
			eventCounts[event.Name] += 1
		}
		sessionID := strings.TrimSpace(event.sessionKey())
		if sessionID == "" {
			continue
		}
		session := sessionMap[sessionID]
		if session == nil {
			session = &userSessionAggregate{
				SessionID:  sessionID,
				StartedAt:  event.Timestamp,
				LastSeenAt: event.Timestamp,
				EntryPath:  event.Path,
				ExitPath:   event.Path,
			}
			sessionMap[sessionID] = session
		}
		if event.Timestamp.Before(session.StartedAt) {
			session.StartedAt = event.Timestamp
			session.EntryPath = event.Path
		}
		if event.Timestamp.After(session.LastSeenAt) {
			session.LastSeenAt = event.Timestamp
			session.ExitPath = event.Path
		}
		session.EventCount += 1
		if event.Name == "pageview" {
			session.PageCount += 1
		}
		session.DurationSeconds = int(session.LastSeenAt.Sub(session.StartedAt).Seconds())
	}

	replayBySession := map[string]ReplaySessionSummary{}
	for _, session := range replaySessions {
		replayBySession[session.SessionID] = session
	}

	sessions := make([]UserSessionItem, 0, len(sessionMap))
	for sessionID, session := range sessionMap {
		item := UserSessionItem{
			SessionHash:     UserHash(siteID, sessionID),
			StartedAt:       session.StartedAt.UTC().Format(time.RFC3339),
			LastSeenAt:      session.LastSeenAt.UTC().Format(time.RFC3339),
			DurationSeconds: session.DurationSeconds,
			EntryPath:       session.EntryPath,
			ExitPath:        session.ExitPath,
			PageCount:       session.PageCount,
			EventCount:      session.EventCount,
			HasReplay:       false,
		}
		if replay, ok := replayBySession[sessionID]; ok {
			item.HasReplay = true
			if replay.DurationMS > 0 {
				item.DurationSeconds = replay.DurationMS / 1000
			}
			if replay.EntryPath != "" {
				item.EntryPath = replay.EntryPath
			}
			if replay.ExitPath != "" {
				item.ExitPath = replay.ExitPath
			}
			if replay.PageCount > 0 {
				item.PageCount = replay.PageCount
			}
			if replay.EventCount > 0 {
				item.EventCount = replay.EventCount
			}
			if replay.StartedAt != "" {
				item.StartedAt = replay.StartedAt
			}
			if replay.UpdatedAt != "" {
				item.LastSeenAt = replay.UpdatedAt
			}
		}
		sessions = append(sessions, item)
	}
	slices.SortFunc(sessions, func(a, b UserSessionItem) int {
		return strings.Compare(b.LastSeenAt, a.LastSeenAt)
	})

	return UserDetail{
		User:     row,
		Pages:    toUserCountItems(pageCounts, 20),
		Events:   toUserCountItems(eventCounts, 20),
		Sessions: sessions,
		Privacy:  DefaultUserPrivacyNote(),
	}, true
}

func toUserCountItems(values map[string]int, limit int) []UserCountItem {
	items := make([]UserCountItem, 0, len(values))
	for label, count := range values {
		label = strings.TrimSpace(label)
		if label == "" || count <= 0 {
			continue
		}
		items = append(items, UserCountItem{Label: label, Count: count})
	}
	slices.SortFunc(items, func(a, b UserCountItem) int {
		if a.Count == b.Count {
			return strings.Compare(a.Label, b.Label)
		}
		return b.Count - a.Count
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

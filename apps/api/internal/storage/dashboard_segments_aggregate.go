package storage

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

type segmentUserSnapshot struct {
	Row      UserRow
	Events   []dashboardEvent
	Sessions map[string]struct{}
}

func buildSegmentPreview(siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, baseRows []UserRow, rangeEvents []dashboardEvent) SegmentPreview {
	definition = NormalizeSegmentDefinition(definition)
	matched := matchSegmentRows(definition, baseRows, rangeEvents)
	_, _, paged := FilterAndPaginateUserRows(matchedRows(matched), query)
	return SegmentPreview{
		Range:        rangeValue.String(),
		Segment:      definition,
		AudienceSize: len(matched),
		AvgPageviews: averageFloat(segmentIntValues(matched, func(snapshot *segmentUserSnapshot) int { return snapshot.Row.Pageviews }), len(matched)),
		AvgEvents:    averageFloat(segmentIntValues(matched, func(snapshot *segmentUserSnapshot) int { return snapshot.Row.Events }), len(matched)),
		AvgSessions:  averageFloat(segmentSessionCounts(matched), len(matched)),
		Users:        paged,
		Privacy:      DefaultUserPrivacyNote(),
		JumpContext:  segmentJumpContext(definition, rangeValue),
	}
}

func buildSegmentMembers(siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, baseRows []UserRow, rangeEvents []dashboardEvent) SegmentMembers {
	definition = NormalizeSegmentDefinition(definition)
	matched := matchSegmentRows(definition, baseRows, rangeEvents)
	normalized, total, paged := FilterAndPaginateUserRows(matchedRows(matched), query)
	return SegmentMembers{
		Range:       rangeValue.String(),
		Segment:     definition,
		Page:        normalized.Page,
		Limit:       normalized.Limit,
		Total:       total,
		Users:       paged,
		Privacy:     DefaultUserPrivacyNote(),
		JumpContext: segmentJumpContext(definition, rangeValue),
	}
}

func buildCohortAnalysis(query CohortAnalysisQuery, rangeValue TimeRange, events []dashboardEvent, baseRows []UserRow, now time.Time) CohortAnalysisReport {
	definition := SegmentDefinition{}
	if query.Segment != nil {
		definition = NormalizeSegmentDefinition(*query.Segment)
	}

	filteredEvents := events
	if len(definition.Conditions) > 0 {
		matched := matchSegmentRows(definition, baseRows, events)
		allowed := map[string]struct{}{}
		for userKey := range matched {
			allowed[userKey] = struct{}{}
		}
		filteredEvents = filterSegmentEventsByUsers(events, allowed)
	}

	days := retentionActivityFromEvents(filteredEvents)
	if strings.EqualFold(query.Mode, string(CohortModeBehavior)) && query.Behavior != nil {
		days = retentionActivityFromBehavior(filteredEvents, *query.Behavior)
	}
	report, trend := buildRetentionArtifacts(days, RetentionQuery{Cadence: query.Cadence, Limit: 12}, rangeValue, now.UTC())
	return CohortAnalysisReport{
		Range:   rangeValue.String(),
		Mode:    firstNonEmptyString(query.Mode, string(CohortModeTime)),
		Summary: report.Summary,
		Cohorts: report.Cohorts,
		Curve:   trend.Curve,
		Privacy: DefaultUserPrivacyNote(),
	}
}

func matchSegmentRows(definition SegmentDefinition, baseRows []UserRow, rangeEvents []dashboardEvent) map[string]*segmentUserSnapshot {
	snapshots := map[string]*segmentUserSnapshot{}
	for _, row := range baseRows {
		row.TopPages = slices.Clone(row.TopPages)
		row.TopEvents = slices.Clone(row.TopEvents)
		snapshots[row.UserKey] = &segmentUserSnapshot{
			Row:      row,
			Events:   []dashboardEvent{},
			Sessions: map[string]struct{}{},
		}
	}
	for _, event := range rangeEvents {
		userKey := strings.TrimSpace(event.visitorKey())
		if userKey == "" || userKey == "unknown-visitor" {
			continue
		}
		snapshot := snapshots[userKey]
		if snapshot == nil {
			snapshot = &segmentUserSnapshot{
				Row: UserRow{
					UserKey:   userKey,
					UserHash:  UserHash(event.SiteID, userKey),
					Alias:     FictionalUserName(UserHash(event.SiteID, userKey)),
					Country:   firstNonEmptyString(event.geoLocation().CountryCode, "Unknown"),
					State:     firstNonEmptyString(event.geoLocation().RegionCode, "Unknown"),
					Browser:   firstNonEmptyString(event.browserFamily(), "Unknown"),
					OS:        firstNonEmptyString(event.osFamily(), "Unknown"),
					FirstSeen: event.Timestamp.UTC().Format(time.RFC3339),
					LastSeen:  event.Timestamp.UTC().Format(time.RFC3339),
				},
				Events:   []dashboardEvent{},
				Sessions: map[string]struct{}{},
			}
			snapshots[userKey] = snapshot
		}
		snapshot.Events = append(snapshot.Events, event)
		snapshot.Sessions[event.sessionKey()] = struct{}{}
	}

	matched := map[string]*segmentUserSnapshot{}
	for userKey, snapshot := range snapshots {
		if segmentMatchesSnapshot(definition, snapshot) {
			matched[userKey] = snapshot
		}
	}
	return matched
}

func segmentMatchesSnapshot(definition SegmentDefinition, snapshot *segmentUserSnapshot) bool {
	if snapshot == nil {
		return false
	}
	if len(definition.Conditions) == 0 {
		return true
	}

	results := make([]bool, 0, len(definition.Conditions))
	for _, condition := range definition.Conditions {
		results = append(results, segmentConditionMatch(condition, snapshot))
	}
	if definition.Logic == "or" {
		for _, result := range results {
			if result {
				return true
			}
		}
		return false
	}
	for _, result := range results {
		if !result {
			return false
		}
	}
	return true
}

func segmentConditionMatch(condition SegmentCondition, snapshot *segmentUserSnapshot) bool {
	condition = NormalizeSegmentDefinition(SegmentDefinition{Conditions: []SegmentCondition{condition}}).Conditions[0]
	switch condition.Type {
	case "visited_page":
		for _, event := range snapshot.Events {
			if event.Name == "pageview" && segmentCompareValue(event.Path, condition.Operator, condition.Value) {
				return true
			}
		}
	case "triggered_event":
		for _, event := range snapshot.Events {
			if event.Name != "pageview" && segmentCompareValue(event.Name, condition.Operator, condition.Value) {
				return true
			}
		}
	case "country":
		return segmentCompareValue(snapshot.Row.Country, condition.Operator, condition.Value)
	case "browser":
		return segmentCompareValue(snapshot.Row.Browser, condition.Operator, condition.Value)
	case "device":
		for _, event := range snapshot.Events {
			if segmentCompareValue(event.deviceType(), condition.Operator, condition.Value) {
				return true
			}
		}
	case "conversion":
		for _, event := range snapshot.Events {
			if condition.Value != "" && !segmentCompareValue(event.Name, condition.Operator, condition.Value) {
				continue
			}
			if event.conversionSignal() {
				return true
			}
		}
	case "property":
		if condition.PropertyKey == "" {
			return false
		}
		for _, event := range snapshot.Events {
			if segmentCompareValue(firstNonEmptyStringValue(event.Meta, condition.PropertyKey), condition.Operator, condition.Value) {
				return true
			}
		}
	}
	return false
}

func segmentCompareValue(candidate, operator, expected string) bool {
	candidate = strings.TrimSpace(strings.ToLower(candidate))
	expected = strings.TrimSpace(strings.ToLower(expected))
	switch operator {
	case "contains":
		return candidate != "" && expected != "" && strings.Contains(candidate, expected)
	case "starts_with":
		return candidate != "" && expected != "" && strings.HasPrefix(candidate, expected)
	default:
		return candidate == expected
	}
}

func matchedRows(matched map[string]*segmentUserSnapshot) []UserRow {
	rows := make([]UserRow, 0, len(matched))
	for _, snapshot := range matched {
		row := snapshot.Row
		row.TopPages = toUserCountItems(segmentPageCounts(snapshot.Events), 4)
		row.TopEvents = toUserCountItems(segmentEventCounts(snapshot.Events), 4)
		row.Pageviews = len(filterSegmentPageviews(snapshot.Events))
		row.Events = len(snapshot.Events)
		rows = append(rows, row)
	}
	return rows
}

func segmentPageCounts(events []dashboardEvent) map[string]int {
	counts := map[string]int{}
	for _, event := range events {
		if event.Name == "pageview" {
			counts[event.Path] += 1
		}
	}
	return counts
}

func segmentEventCounts(events []dashboardEvent) map[string]int {
	counts := map[string]int{}
	for _, event := range events {
		if event.Name != "pageview" && strings.TrimSpace(event.Name) != "" {
			counts[event.Name] += 1
		}
	}
	return counts
}

func filterSegmentPageviews(events []dashboardEvent) []dashboardEvent {
	filtered := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if event.Name == "pageview" {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func segmentIntValues(matched map[string]*segmentUserSnapshot, selector func(*segmentUserSnapshot) int) float64 {
	total := 0
	for _, snapshot := range matched {
		total += selector(snapshot)
	}
	return float64(total)
}

func segmentSessionCounts(matched map[string]*segmentUserSnapshot) float64 {
	total := 0
	for _, snapshot := range matched {
		total += len(snapshot.Sessions)
	}
	return float64(total)
}

func segmentJumpContext(definition SegmentDefinition, rangeValue TimeRange) map[string]string {
	return map[string]string{
		"users":     fmt.Sprintf("/users?segmentId=%s&range=%s", definition.ID, rangeValue.String()),
		"retention": fmt.Sprintf("/retention?segmentId=%s&range=%s", definition.ID, rangeValue.String()),
		"summary":   fmt.Sprintf("/dashboard?segmentId=%s&range=%s", definition.ID, rangeValue.String()),
	}
}

func filterSegmentEventsByUsers(events []dashboardEvent, allowed map[string]struct{}) []dashboardEvent {
	filtered := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if _, ok := allowed[event.visitorKey()]; ok {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func retentionActivityFromBehavior(events []dashboardEvent, behavior SegmentCondition) []retentionActivityDay {
	behavior = NormalizeSegmentDefinition(SegmentDefinition{Conditions: []SegmentCondition{behavior}}).Conditions[0]
	firstBehavior := map[string]time.Time{}
	for _, event := range events {
		userID := event.visitorKey()
		if userID == "" || userID == "unknown-visitor" {
			continue
		}
		snapshot := &segmentUserSnapshot{Events: []dashboardEvent{event}}
		if !segmentConditionMatch(behavior, snapshot) {
			continue
		}
		current, ok := firstBehavior[userID]
		if !ok || event.Timestamp.Before(current) {
			firstBehavior[userID] = event.Timestamp
		}
	}

	output := make([]retentionActivityDay, 0, len(events))
	seen := map[string]struct{}{}
	for _, event := range events {
		if event.Name != "pageview" {
			continue
		}
		userID := event.visitorKey()
		cohortStart, ok := firstBehavior[userID]
		if !ok || event.Timestamp.Before(cohortStart) {
			continue
		}
		activityDay := time.Date(event.Timestamp.Year(), event.Timestamp.Month(), event.Timestamp.Day(), 0, 0, 0, 0, time.UTC)
		location := event.geoLocation()
		key := strings.Join([]string{userID, activityDay.Format("2006-01-02")}, "::")
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		output = append(output, retentionActivityDay{
			UserID:      userID,
			ActivityDay: activityDay,
			Device:      normalizeJourneyDeviceValue(event.deviceType()),
			CountryCode: location.CountryCode,
			CountryName: location.countryLabel(),
		})
	}
	return output
}

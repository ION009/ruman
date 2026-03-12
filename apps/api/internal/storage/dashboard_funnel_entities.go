package storage

import (
	"slices"
	"strings"
	"time"
)

const (
	defaultFunnelEntitiesLimit = 12
	maxFunnelEntitiesLimit     = 40
)

func buildFunnelEntities(
	events []dashboardEvent,
	query FunnelQuery,
	stepIndex int,
	status FunnelEntityStatus,
	page int,
	limit int,
	rangeValue TimeRange,
) FunnelEntityList {
	steps := normalizeFunnelSteps(query.Steps)
	if len(steps) == 0 {
		return FunnelEntityList{
			Range:      rangeValue.String(),
			CountMode:  string(FunnelCountModeVisitors),
			StepIndex:  stepIndex,
			Status:     string(status),
			Page:       1,
			Limit:      defaultFunnelEntitiesLimit,
			Inspection: FunnelStepInspection{},
		}
	}

	countMode := ParseFunnelCountMode(query.CountMode)
	if countMode == "" {
		countMode = FunnelCountModeVisitors
	}

	windowMinutes := query.WindowMinutes
	if windowMinutes <= 0 {
		windowMinutes = defaultFunnelWindowMinutes
	}
	window := time.Duration(windowMinutes) * time.Minute

	if page <= 0 {
		page = 1
	}
	switch {
	case limit <= 0:
		limit = defaultFunnelEntitiesLimit
	case limit > maxFunnelEntitiesLimit:
		limit = maxFunnelEntitiesLimit
	}

	ordered := slices.Clone(events)
	slices.SortFunc(ordered, compareDashboardEvents)

	grouped := map[string][]dashboardEvent{}
	for _, event := range ordered {
		key := event.visitorKey()
		if countMode == FunnelCountModeSessions {
			key = event.sessionKey()
		}
		grouped[key] = append(grouped[key], event)
	}

	summaries := make([]FunnelEntitySummary, 0, len(grouped))
	inspection := FunnelStepInspection{
		StepIndex: stepIndex,
		Label:     steps[stepIndex].Label,
	}
	for entityID, entityEvents := range grouped {
		matched := bestFunnelAttemptEvents(entityEvents, steps, window)
		matchCount := len(matched)
		if matchesFunnelEntityStatus(matchCount, stepIndex, FunnelEntityStatusEntered) {
			inspection.Entrants += 1
		}
		if matchesFunnelEntityStatus(matchCount, stepIndex, FunnelEntityStatusReached) {
			inspection.Reached += 1
		}
		if matchesFunnelEntityStatus(matchCount, stepIndex, FunnelEntityStatusDropped) {
			inspection.Dropped += 1
		}
		if !matchesFunnelEntityStatus(matchCount, stepIndex, status) {
			continue
		}
		summaries = append(summaries, summarizeFunnelEntity(entityID, entityEvents, matched, steps))
	}
	inspection.ReachRate = percentage(inspection.Reached, inspection.Entrants)
	inspection.DropRate = percentage(inspection.Dropped, inspection.Entrants)

	slices.SortFunc(summaries, func(left, right FunnelEntitySummary) int {
		switch {
		case left.UpdatedAt != right.UpdatedAt:
			return strings.Compare(right.UpdatedAt, left.UpdatedAt)
		case left.StartedAt != right.StartedAt:
			return strings.Compare(right.StartedAt, left.StartedAt)
		default:
			return strings.Compare(left.EntityID, right.EntityID)
		}
	})

	total := len(summaries)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := minInt(start+limit, total)

	return FunnelEntityList{
		Range:      rangeValue.String(),
		CountMode:  string(countMode),
		StepIndex:  stepIndex,
		StepLabel:  steps[stepIndex].Label,
		Status:     string(status),
		Page:       page,
		Limit:      limit,
		Total:      total,
		HasMore:    end < total,
		Inspection: inspection,
		Entities:   summaries[start:end],
	}
}

func bestFunnelAttemptEvents(events []dashboardEvent, steps []normalizedFunnelStep, window time.Duration) []dashboardEvent {
	best := []dashboardEvent{}
	if len(events) == 0 || len(steps) == 0 {
		return best
	}

	for startIndex, event := range events {
		if !steps[0].matches(event) {
			continue
		}

		current := []dashboardEvent{event}
		startTime := event.Timestamp.UTC()
		nextStep := 1

		for index := startIndex + 1; index < len(events) && nextStep < len(steps); index += 1 {
			nextEvent := events[index]
			if nextEvent.Timestamp.UTC().Sub(startTime) > window {
				break
			}
			if steps[nextStep].matches(nextEvent) {
				current = append(current, nextEvent)
				nextStep += 1
			}
		}

		if len(current) > len(best) || (len(current) == len(best) && earlierAttemptEvents(current, best)) {
			best = current
		}
		if len(best) == len(steps) {
			return best
		}
	}

	return best
}

func earlierAttemptEvents(left, right []dashboardEvent) bool {
	if len(left) == 0 {
		return false
	}
	if len(right) == 0 {
		return true
	}

	for index := 0; index < len(left) && index < len(right); index += 1 {
		leftTime := left[index].Timestamp.UTC()
		rightTime := right[index].Timestamp.UTC()
		switch {
		case leftTime.Before(rightTime):
			return true
		case leftTime.After(rightTime):
			return false
		}
	}

	return false
}

func matchesFunnelEntityStatus(matchCount, stepIndex int, status FunnelEntityStatus) bool {
	switch status {
	case FunnelEntityStatusEntered:
		requiredMatches := stepIndex
		if requiredMatches < 1 {
			requiredMatches = 1
		}
		return matchCount >= requiredMatches
	case FunnelEntityStatusDropped:
		return stepIndex > 0 && matchCount == stepIndex
	default:
		return matchCount > stepIndex
	}
}

func summarizeFunnelEntity(
	entityID string,
	events []dashboardEvent,
	matched []dashboardEvent,
	steps []normalizedFunnelStep,
) FunnelEntitySummary {
	if len(events) == 0 {
		return FunnelEntitySummary{
			EntityID: strings.TrimSpace(entityID),
			Paths:    []string{},
		}
	}

	startedAt := events[0].Timestamp.UTC()
	updatedAt := events[len(events)-1].Timestamp.UTC()
	entryPath := ""
	exitPath := ""
	pageviews := 0
	eventCount := 0
	deviceType := ""
	browser := ""
	os := ""
	pathSeen := map[string]struct{}{}
	paths := make([]string, 0, 6)
	sessionSeen := map[string]struct{}{}

	for _, event := range events {
		path := normalizePath(event.Path)
		if path != "" && len(paths) < 6 {
			if _, ok := pathSeen[path]; !ok {
				pathSeen[path] = struct{}{}
				paths = append(paths, path)
			}
		}

		sessionSeen[event.sessionKey()] = struct{}{}

		if event.Name == "pageview" {
			pageviews += 1
			if entryPath == "" {
				entryPath = path
			}
			exitPath = path
		} else if isFunnelCustomEvent(event.Name) {
			eventCount += 1
			if entryPath == "" {
				entryPath = path
			}
			if path != "" {
				exitPath = path
			}
		}

		if value := strings.TrimSpace(metaString(event.Meta, "dt")); value != "" {
			deviceType = value
		}
		if value := strings.TrimSpace(metaString(event.Meta, "br")); value != "" {
			browser = value
		}
		if value := strings.TrimSpace(metaString(event.Meta, "os")); value != "" {
			os = value
		}
	}

	if entryPath == "" {
		entryPath = normalizePath(events[0].Path)
	}
	if exitPath == "" {
		exitPath = normalizePath(events[len(events)-1].Path)
	}

	matchedSteps := make([]FunnelEntityMatchedStep, 0, len(matched))
	for index, matchedEvent := range matched {
		secondsFromPrevious := 0
		secondsFromStart := 0
		if index > 0 {
			secondsFromPrevious = int(matchedEvent.Timestamp.UTC().Sub(matched[index-1].Timestamp.UTC()).Seconds())
			secondsFromStart = int(matchedEvent.Timestamp.UTC().Sub(matched[0].Timestamp.UTC()).Seconds())
		}
		matchedSteps = append(matchedSteps, FunnelEntityMatchedStep{
			StepIndex:           index,
			Label:               steps[index].Label,
			Kind:                string(steps[index].Kind),
			MatchType:           string(steps[index].MatchType),
			Value:               steps[index].Value,
			Timestamp:           matchedEvent.Timestamp.UTC().Format(time.RFC3339),
			SecondsFromPrevious: secondsFromPrevious,
			SecondsFromStart:    secondsFromStart,
		})
	}

	dropOffStepIndex := -1
	dropOffStepLabel := ""
	completed := len(matched) == len(steps)
	if !completed && len(matched) < len(steps) {
		dropOffStepIndex = len(matched)
		dropOffStepLabel = steps[dropOffStepIndex].Label
	}

	return FunnelEntitySummary{
		EntityID:         strings.TrimSpace(entityID),
		StartedAt:        startedAt.Format(time.RFC3339),
		UpdatedAt:        updatedAt.Format(time.RFC3339),
		EntryPath:        entryPath,
		ExitPath:         exitPath,
		Pageviews:        pageviews,
		EventCount:       eventCount,
		SessionCount:     len(sessionSeen),
		DeviceType:       deviceType,
		Browser:          browser,
		OS:               os,
		Paths:            paths,
		MatchedStepCount: len(matched),
		Completed:        completed,
		DropOffStepIndex: dropOffStepIndex,
		DropOffStepLabel: dropOffStepLabel,
		MatchedSteps:     matchedSteps,
	}
}

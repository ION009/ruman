package storage

import (
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
)

const (
	eventExplorerPrivacyFloor  = 3
	maxEventCatalogEntries     = 18
	maxEventFeedItems          = 36
	maxEventBreakdownItems     = 5
	maxEventPropertyFacets     = 5
	maxEventPropertyValueItems = 4
	eventLiveWindow            = 15 * time.Minute
	eventLiveBucketSize        = time.Minute
	eventLiveBucketCount       = 15
	maxEventPathOptions        = 24
	maxEventFamilySummaries    = 4
)

type eventExplorerAggregate struct {
	Name                string
	Family              string
	Count               int
	PreviousCount       int
	LastSeen            time.Time
	FirstSeen           time.Time
	Sessions            map[string]struct{}
	Visitors            map[string]struct{}
	SessionLastSeen     map[string]time.Time
	SessionEventCounts  map[string]int
	PathCounts          map[string]int
	DeviceCounts        map[string]int
	CountryCounts       map[string]int
	Properties          map[string]*eventPropertyAggregate
	MaskedPropertyCount int
}

type eventPropertyAggregate struct {
	Key       string
	Masked    bool
	Values    map[string]int
	RawValues map[string]struct{}
}

type eventTrendAccumulator struct {
	Custom      int
	Navigation  int
	Behavior    int
	Performance int
}

type eventPathAggregate struct {
	Events         int
	Sessions       map[string]struct{}
	ActiveSessions map[string]struct{}
}

type eventLiveBucket struct {
	Events   int
	Sessions map[string]struct{}
	Visitors map[string]struct{}
}

type eventDuplicateWindow struct {
	Timestamp time.Time
}

func buildEventExplorerView(events []dashboardEvent, query EventExplorerQuery, rangeValue TimeRange, now time.Time) EventExplorerView {
	now = now.UTC()
	currentStart, currentEnd := rangeBounds(rangeValue, now)
	comparisonRange := comparisonTimeRange(rangeValue, now)
	comparisonStart, comparisonEnd := rangeBounds(comparisonRange, now)
	selectedPath := normalizeEventExplorerPath(query.Path)

	normalizedEvents := normalizeEventExplorerEvents(events)
	currentEvents := normalizedEventsInRange(normalizedEvents, currentStart, currentEnd)
	previousEvents := normalizedEventsInRange(normalizedEvents, comparisonStart, comparisonEnd)

	slices.SortFunc(currentEvents, func(left, right dashboardEvent) int {
		return left.Timestamp.Compare(right.Timestamp)
	})
	slices.SortFunc(previousEvents, func(left, right dashboardEvent) int {
		return left.Timestamp.Compare(right.Timestamp)
	})

	pathOptionEvents, _ := dedupeEventExplorerEvents(append([]dashboardEvent(nil), currentEvents...))
	pathOptions := buildEventPathOptions(pathOptionEvents, now)
	currentEvents = filterEventsByPath(currentEvents, selectedPath)
	previousEvents = filterEventsByPath(previousEvents, selectedPath)
	rawCurrentVisibleCount := visibleEventCount(currentEvents)
	duplicateRate := probableDuplicateRate(currentEvents)
	currentEvents, deduplicatedEvents := dedupeEventExplorerEvents(currentEvents)
	previousEvents, _ = dedupeEventExplorerEvents(previousEvents)

	aggregates := map[string]*eventExplorerAggregate{}
	currentTrends := map[time.Time]*eventTrendAccumulator{}
	previousTotals := eventTrendAccumulator{}
	filteredEvents := 0
	withheldRows := 0
	maskedProperties := 0

	for _, event := range currentEvents {
		if !eventExplorerVisible(event) {
			filteredEvents += 1
			continue
		}

		key := explorerEventKey(event.Name)
		item := aggregates[key]
		if item == nil {
			item = &eventExplorerAggregate{
				Name:               strings.TrimSpace(event.Name),
				Family:             eventFamily(event.Name),
				FirstSeen:          event.Timestamp,
				LastSeen:           event.Timestamp,
				Sessions:           map[string]struct{}{},
				Visitors:           map[string]struct{}{},
				SessionLastSeen:    map[string]time.Time{},
				SessionEventCounts: map[string]int{},
				PathCounts:         map[string]int{},
				DeviceCounts:       map[string]int{},
				CountryCounts:      map[string]int{},
				Properties:         map[string]*eventPropertyAggregate{},
			}
			aggregates[key] = item
		}

		item.Count += 1
		if event.Timestamp.Before(item.FirstSeen) {
			item.FirstSeen = event.Timestamp
		}
		if event.Timestamp.After(item.LastSeen) {
			item.LastSeen = event.Timestamp
		}
		sessionKey := event.sessionKey()
		visitorKey := event.visitorKey()
		item.Sessions[sessionKey] = struct{}{}
		if strings.TrimSpace(visitorKey) != "" {
			item.Visitors[visitorKey] = struct{}{}
		}
		item.SessionEventCounts[sessionKey] += 1
		item.SessionLastSeen[sessionKey] = event.Timestamp
		item.PathCounts[normalizePath(event.Path)] += 1
		item.DeviceCounts[event.deviceType()] += 1
		countryLabel := event.geoLocation().countryLabel()
		if strings.TrimSpace(countryLabel) == "" {
			countryLabel = "Unknown"
		}
		item.CountryCounts[countryLabel] += 1

		maskedCount := accumulateEventProperties(item, event)
		item.MaskedPropertyCount += maskedCount
		maskedProperties += maskedCount

		bucket := bucketForEventExplorer(event.Timestamp, rangeValue)
		accumulator := currentTrends[bucket]
		if accumulator == nil {
			accumulator = &eventTrendAccumulator{}
			currentTrends[bucket] = accumulator
		}
		incrementTrendAccumulator(accumulator, event.Name)
	}

	previousCounts := map[string]int{}
	for _, event := range previousEvents {
		if !eventExplorerVisible(event) {
			continue
		}
		key := explorerEventKey(event.Name)
		previousCounts[key] += 1
		incrementTrendAccumulator(&previousTotals, event.Name)
	}

	entries := make([]EventCatalogEntry, 0, len(aggregates))
	hiddenLowVolumeEvents := 0
	for key, item := range aggregates {
		item.PreviousCount = previousCounts[key]
		if item.Count < eventExplorerPrivacyFloor || len(item.Sessions) < eventExplorerPrivacyFloor {
			hiddenLowVolumeEvents += item.Count
			withheldRows += 1
			continue
		}

		properties, propertyRows := buildEventPropertyFacets(item.Properties)
		withheldRows += propertyRows

		topPages, pageRows := buildEventBreakdownItems(item.PathCounts)
		topDevices, deviceRows := buildEventBreakdownItems(item.DeviceCounts)
		topCountries, countryRows := buildEventBreakdownItems(item.CountryCounts)
		withheldRows += pageRows + deviceRows + countryRows

		itemDuplicateRate := probableDuplicateRateForAggregate(item)
		statuses := eventStatuses(item, currentStart, currentEnd)
		entries = append(entries, EventCatalogEntry{
			Name:            item.Name,
			Family:          item.Family,
			Count:           item.Count,
			PreviousCount:   item.PreviousCount,
			UniqueSessions:  len(item.Sessions),
			UniqueVisitors:  len(item.Visitors),
			Trend:           deltaPercent(item.Count, item.PreviousCount),
			LastSeen:        item.LastSeen.UTC().Format(time.RFC3339),
			Statuses:        statuses,
			ConfidenceScore: scoreEventConfidence(item.Count, len(item.Sessions), len(item.Visitors), itemDuplicateRate, item.MaskedPropertyCount),
			PrivacyNote:     eventPrivacyNote(item.MaskedPropertyCount),
			Properties:      properties,
			TopPages:        topPages,
			TopDevices:      topDevices,
			TopCountries:    topCountries,
			SampleSessions:  sampleSessionIDs(item.SessionLastSeen),
		})
	}

	filteredEvents += hiddenLowVolumeEvents

	slices.SortFunc(entries, func(left, right EventCatalogEntry) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		case left.UniqueSessions != right.UniqueSessions:
			return right.UniqueSessions - left.UniqueSessions
		default:
			return strings.Compare(left.Name, right.Name)
		}
	})
	if len(entries) > maxEventCatalogEntries {
		entries = entries[:maxEventCatalogEntries]
	}

	allowedEventKeys := map[string]struct{}{}
	for _, entry := range entries {
		allowedEventKeys[explorerEventKey(entry.Name)] = struct{}{}
	}

	liveFeed := buildEventFeed(currentEvents, allowedEventKeys)

	return EventExplorerView{
		Range:           rangeValue.String(),
		ComparisonRange: comparisonRange.String(),
		SelectedPath:    selectedPath,
		Paths:           pathOptions,
		PrivacyFloor:    eventExplorerPrivacyFloor,
		Summary: EventExplorerSummary{
			AcceptedEvents:     len(currentEvents),
			DeduplicatedEvents: deduplicatedEvents,
			FilteredEvents:     filteredEvents,
			WithheldRows:       withheldRows,
			MaskedProperties:   maskedProperties,
			DuplicateRate:      duplicateRate,
			PrivacyOptOutLabel: "Not collected when DNT or GPC is enabled",
			ConfidenceScore:    scoreExplorerConfidence(maxInt(rawCurrentVisibleCount, len(currentEvents)), len(entries), filteredEvents, duplicateRate),
			FreshnessLabel:     fmt.Sprintf("Updated through %s UTC", now.Format("2006-01-02 15:04")),
		},
		Trends: EventExplorerTrends{
			Timeline:   buildEventTrendTimeline(currentTrends, rangeValue, currentStart, currentEnd),
			Comparison: buildEventTrendComparison(currentTrends, previousTotals),
			Highlights: buildEventTrendHighlights(currentTrends, previousTotals),
		},
		Families: buildEventFamilySummaries(currentTrends, previousTotals, duplicateRate),
		Live:     buildEventLiveActivity(currentEvents, now),
		Catalog:  entries,
		LiveFeed: liveFeed,
	}
}

func normalizeEventExplorerEvents(events []dashboardEvent) []dashboardEvent {
	normalized := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		next := event
		next.Name = normalizedEventName(event.Name)
		next.Path = normalizedEventPath(event)
		normalized = append(normalized, next)
	}
	return normalized
}

func normalizedEventsInRange(events []dashboardEvent, start, end time.Time) []dashboardEvent {
	filtered := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if eventInRange(event, start, end) {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func normalizeEventExplorerPath(path string) string {
	if strings.TrimSpace(path) == "" {
		return ""
	}
	return normalizePath(path)
}

func filterEventsByPath(events []dashboardEvent, selectedPath string) []dashboardEvent {
	if strings.TrimSpace(selectedPath) == "" {
		return events
	}
	filtered := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if normalizePath(event.Path) == selectedPath {
			filtered = append(filtered, event)
		}
	}
	return filtered
}

func visibleEventCount(events []dashboardEvent) int {
	count := 0
	for _, event := range events {
		if eventExplorerVisible(event) {
			count += 1
		}
	}
	return count
}

func dedupeEventExplorerEvents(events []dashboardEvent) ([]dashboardEvent, int) {
	deduped := make([]dashboardEvent, 0, len(events))
	windows := map[string]eventDuplicateWindow{}
	duplicates := 0

	for _, event := range events {
		if !eventExplorerVisible(event) {
			deduped = append(deduped, event)
			continue
		}

		key := duplicateSignature(event)
		if previous, ok := windows[key]; ok && event.Timestamp.Sub(previous.Timestamp) <= duplicateWindowForEvent(event.Name) {
			duplicates += 1
			continue
		}
		windows[key] = eventDuplicateWindow{Timestamp: event.Timestamp}
		deduped = append(deduped, event)
	}

	return deduped, duplicates
}

func comparisonTimeRange(rangeValue TimeRange, now time.Time) TimeRange {
	currentStart, _ := rangeBounds(rangeValue, now.UTC())
	previousEnd := currentStart.Add(-time.Nanosecond)
	previousStart := previousEnd.Add(-rangeValue.Duration()).Add(time.Nanosecond)
	return NewCustomTimeRange(previousStart, previousEnd)
}

func rangeBounds(rangeValue TimeRange, now time.Time) (time.Time, time.Time) {
	return rangeValue.Since(now.UTC()), rangeValue.Until(now.UTC())
}

func eventInRange(event dashboardEvent, start, end time.Time) bool {
	return !event.Timestamp.Before(start) && !event.Timestamp.After(end)
}

func explorerEventKey(name string) string {
	trimmed := strings.TrimSpace(name)
	return eventFamily(trimmed) + ":" + trimmed
}

func eventExplorerVisible(event dashboardEvent) bool {
	name := strings.TrimSpace(event.Name)
	if name == "" {
		return false
	}
	return !strings.EqualFold(name, "heartbeat")
}

func eventFamily(name string) string {
	trimmed := normalizedEventName(name)
	switch {
	case trimmed == "pageview" || trimmed == "route" || trimmed == "route_change" || trimmed == "screen_view" || trimmed == "page_enter" || trimmed == "page_exit":
		return "navigation"
	case trimmed == "click" || trimmed == "rage_click" || trimmed == "dead_click" || trimmed == "hover" || trimmed == "move" || trimmed == "scroll" || trimmed == "submit" || trimmed == "form_submit" || trimmed == "input_change" || trimmed == "focus" || trimmed == "blur":
		return "behavior"
	case strings.HasPrefix(trimmed, "perf_"):
		return "performance"
	case trimmed == "heartbeat":
		return "system"
	default:
		return "custom"
	}
}

func normalizedEventName(name string) string {
	trimmed := strings.TrimSpace(strings.ToLower(name))
	if trimmed == "" {
		return ""
	}

	replaced := strings.NewReplacer(" ", "_", "-", "_", "/", "_", ":", "_").Replace(trimmed)
	for strings.Contains(replaced, "__") {
		replaced = strings.ReplaceAll(replaced, "__", "_")
	}
	replaced = strings.Trim(replaced, "_")

	switch replaced {
	case "page_view", "screenview", "screen_view":
		return "pageview"
	case "routechange", "route_changed", "routechangecomplete", "route_change_complete":
		return "route_change"
	case "formsubmit":
		return "form_submit"
	case "inputchange":
		return "input_change"
	case "deadclick":
		return "dead_click"
	case "rageclick":
		return "rage_click"
	case "largest_contentful_paint":
		return "perf_lcp"
	case "interaction_to_next_paint":
		return "perf_inp"
	case "cumulative_layout_shift":
		return "perf_cls"
	case "time_to_first_byte":
		return "perf_ttfb"
	}
	if strings.HasPrefix(replaced, "perf") && !strings.HasPrefix(replaced, "perf_") {
		replaced = strings.Replace(replaced, "perf", "perf_", 1)
	}
	return replaced
}

func normalizedEventPath(event dashboardEvent) string {
	if value := strings.TrimSpace(event.Path); value != "" {
		return normalizePath(value)
	}
	for _, key := range []string{"path", "pathname", "route", "rp", "url"} {
		if value := strings.TrimSpace(stringValue(event.Meta[key])); value != "" {
			return normalizePath(value)
		}
	}
	return "/"
}

func bucketForEventExplorer(timestamp time.Time, rangeValue TimeRange) time.Time {
	utc := timestamp.UTC()
	if rangeValue.Duration() <= 48*time.Hour {
		return time.Date(utc.Year(), utc.Month(), utc.Day(), utc.Hour(), 0, 0, 0, time.UTC)
	}
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func incrementTrendAccumulator(accumulator *eventTrendAccumulator, name string) {
	switch eventFamily(name) {
	case "navigation":
		accumulator.Navigation += 1
	case "behavior":
		accumulator.Behavior += 1
	case "performance":
		accumulator.Performance += 1
	case "custom":
		accumulator.Custom += 1
	}
}

func buildEventTrendTimeline(
	current map[time.Time]*eventTrendAccumulator,
	rangeValue TimeRange,
	start, end time.Time,
) []EventTrendPoint {
	points := []EventTrendPoint{}
	step := 24 * time.Hour
	cursor := time.Date(end.UTC().Year(), end.UTC().Month(), end.UTC().Day(), 0, 0, 0, 0, time.UTC)
	buckets := maxIntFromDuration(rangeValue.Duration(), 24*time.Hour)
	if rangeValue.Duration() <= 48*time.Hour {
		step = time.Hour
		cursor = time.Date(end.UTC().Year(), end.UTC().Month(), end.UTC().Day(), end.UTC().Hour(), 0, 0, 0, time.UTC)
		buckets = maxIntFromDuration(rangeValue.Duration(), time.Hour)
	}
	cursor = cursor.Add(-time.Duration(buckets-1) * step)
	if cursor.Before(start) {
		cursor = bucketForEventExplorer(start, rangeValue)
	}

	for index := 0; index < buckets; index += 1 {
		item := current[cursor]
		point := EventTrendPoint{Timestamp: cursor.Format(time.RFC3339)}
		if item != nil {
			point.Custom = item.Custom
			point.Navigation = item.Navigation
			point.Behavior = item.Behavior
			point.Performance = item.Performance
		}
		points = append(points, point)
		cursor = cursor.Add(step)
	}

	return points
}

func buildEventTrendComparison(current map[time.Time]*eventTrendAccumulator, previous eventTrendAccumulator) EventTrendComparison {
	currentTotals := eventTrendAccumulator{}
	for _, item := range current {
		currentTotals.Custom += item.Custom
		currentTotals.Navigation += item.Navigation
		currentTotals.Behavior += item.Behavior
		currentTotals.Performance += item.Performance
	}

	return EventTrendComparison{
		CustomCurrent:       currentTotals.Custom,
		CustomPrevious:      previous.Custom,
		NavigationCurrent:   currentTotals.Navigation,
		NavigationPrevious:  previous.Navigation,
		BehaviorCurrent:     currentTotals.Behavior,
		BehaviorPrevious:    previous.Behavior,
		PerformanceCurrent:  currentTotals.Performance,
		PerformancePrevious: previous.Performance,
	}
}

func buildEventTrendHighlights(current map[time.Time]*eventTrendAccumulator, previous eventTrendAccumulator) []EventTrendHighlight {
	comparison := buildEventTrendComparison(current, previous)
	return []EventTrendHighlight{
		{
			Label:  "Custom events",
			Value:  comparison.CustomCurrent,
			Delta:  deltaPercent(comparison.CustomCurrent, comparison.CustomPrevious),
			Up:     comparison.CustomCurrent >= comparison.CustomPrevious,
			Family: "custom",
		},
		{
			Label:  "Navigation",
			Value:  comparison.NavigationCurrent,
			Delta:  deltaPercent(comparison.NavigationCurrent, comparison.NavigationPrevious),
			Up:     comparison.NavigationCurrent >= comparison.NavigationPrevious,
			Family: "navigation",
		},
		{
			Label:  "Behavior",
			Value:  comparison.BehaviorCurrent,
			Delta:  deltaPercent(comparison.BehaviorCurrent, comparison.BehaviorPrevious),
			Up:     comparison.BehaviorCurrent >= comparison.BehaviorPrevious,
			Family: "behavior",
		},
		{
			Label:  "Performance",
			Value:  comparison.PerformanceCurrent,
			Delta:  deltaPercent(comparison.PerformanceCurrent, comparison.PerformancePrevious),
			Up:     comparison.PerformanceCurrent >= comparison.PerformancePrevious,
			Family: "performance",
		},
	}
}

func buildEventPathOptions(events []dashboardEvent, now time.Time) []EventPathOption {
	aggregates := map[string]*eventPathAggregate{}
	recentCutoff := now.Add(-eventLiveWindow)

	for _, event := range events {
		if !eventExplorerVisible(event) {
			continue
		}
		path := normalizePath(event.Path)
		current := aggregates[path]
		if current == nil {
			current = &eventPathAggregate{
				Sessions:       map[string]struct{}{},
				ActiveSessions: map[string]struct{}{},
			}
			aggregates[path] = current
		}
		current.Events += 1
		current.Sessions[event.sessionKey()] = struct{}{}
		if !event.Timestamp.Before(recentCutoff) {
			current.ActiveSessions[event.sessionKey()] = struct{}{}
		}
	}

	options := make([]EventPathOption, 0, len(aggregates))
	for path, current := range aggregates {
		options = append(options, EventPathOption{
			Path:           path,
			Events:         current.Events,
			Sessions:       len(current.Sessions),
			ActiveSessions: len(current.ActiveSessions),
		})
	}
	slices.SortFunc(options, func(left, right EventPathOption) int {
		switch {
		case left.Events != right.Events:
			return right.Events - left.Events
		case left.Sessions != right.Sessions:
			return right.Sessions - left.Sessions
		default:
			return strings.Compare(left.Path, right.Path)
		}
	})
	return limitSlice(options, maxEventPathOptions)
}

func buildEventFamilySummaries(
	current map[time.Time]*eventTrendAccumulator,
	previous eventTrendAccumulator,
	duplicateRate float64,
) []EventFamilySummary {
	comparison := buildEventTrendComparison(current, previous)
	families := []EventFamilySummary{
		{
			Family:          "navigation",
			Label:           "Navigation",
			Count:           comparison.NavigationCurrent,
			PreviousCount:   comparison.NavigationPrevious,
			Trend:           deltaPercent(comparison.NavigationCurrent, comparison.NavigationPrevious),
			ConfidenceScore: scoreEventFamilyConfidence(comparison.NavigationCurrent, comparison.NavigationPrevious, duplicateRate, "navigation"),
			Trust:           eventFamilyTrustLabel("navigation"),
			Legend:          "Pageviews and route transitions",
		},
		{
			Family:          "behavior",
			Label:           "Behavior",
			Count:           comparison.BehaviorCurrent,
			PreviousCount:   comparison.BehaviorPrevious,
			Trend:           deltaPercent(comparison.BehaviorCurrent, comparison.BehaviorPrevious),
			ConfidenceScore: scoreEventFamilyConfidence(comparison.BehaviorCurrent, comparison.BehaviorPrevious, duplicateRate, "behavior"),
			Trust:           eventFamilyTrustLabel("behavior"),
			Legend:          "Clicks, scrolls, hovers, inputs, and submits",
		},
		{
			Family:          "performance",
			Label:           "Performance",
			Count:           comparison.PerformanceCurrent,
			PreviousCount:   comparison.PerformancePrevious,
			Trend:           deltaPercent(comparison.PerformanceCurrent, comparison.PerformancePrevious),
			ConfidenceScore: scoreEventFamilyConfidence(comparison.PerformanceCurrent, comparison.PerformancePrevious, duplicateRate, "performance"),
			Trust:           eventFamilyTrustLabel("performance"),
			Legend:          "Web-vital and performance metrics",
		},
		{
			Family:          "custom",
			Label:           "Custom",
			Count:           comparison.CustomCurrent,
			PreviousCount:   comparison.CustomPrevious,
			Trend:           deltaPercent(comparison.CustomCurrent, comparison.CustomPrevious),
			ConfidenceScore: scoreEventFamilyConfidence(comparison.CustomCurrent, comparison.CustomPrevious, duplicateRate, "custom"),
			Trust:           eventFamilyTrustLabel("custom"),
			Legend:          "App-defined business events",
		},
	}

	filtered := make([]EventFamilySummary, 0, len(families))
	for _, family := range families {
		if family.Count <= 0 && family.PreviousCount <= 0 {
			continue
		}
		filtered = append(filtered, family)
	}
	if len(filtered) == 0 {
		return families[:1]
	}
	return limitSlice(filtered, maxEventFamilySummaries)
}

func buildEventLiveActivity(events []dashboardEvent, now time.Time) EventLiveActivity {
	cutoff := now.Add(-eventLiveWindow)
	pageCounts := map[string]int{}
	countryCounts := map[string]int{}
	sessionLastSeen := map[string]time.Time{}
	buckets := map[time.Time]*eventLiveBucket{}
	activeEvents := 0

	for _, event := range events {
		if !eventExplorerVisible(event) || event.Timestamp.Before(cutoff) {
			continue
		}
		activeEvents += 1
		sessionKey := event.sessionKey()
		visitorKey := event.visitorKey()
		if previous, ok := sessionLastSeen[sessionKey]; !ok || event.Timestamp.After(previous) {
			sessionLastSeen[sessionKey] = event.Timestamp
		}
		pageCounts[normalizePath(event.Path)] += 1
		countryLabel := event.geoLocation().countryLabel()
		if strings.TrimSpace(countryLabel) == "" {
			countryLabel = "Unknown"
		}
		countryCounts[countryLabel] += 1

		bucket := bucketForLiveActivity(event.Timestamp)
		current := buckets[bucket]
		if current == nil {
			current = &eventLiveBucket{
				Sessions: map[string]struct{}{},
				Visitors: map[string]struct{}{},
			}
			buckets[bucket] = current
		}
		current.Events += 1
		current.Sessions[sessionKey] = struct{}{}
		current.Visitors[visitorKey] = struct{}{}
	}

	movement := make([]EventLiveActivityPoint, 0, eventLiveBucketCount)
	endBucket := bucketForLiveActivity(now)
	startBucket := endBucket.Add(-time.Duration(eventLiveBucketCount-1) * eventLiveBucketSize)
	activeSessions := map[string]struct{}{}
	activeVisitors := map[string]struct{}{}
	for bucket := startBucket; !bucket.After(endBucket); bucket = bucket.Add(eventLiveBucketSize) {
		current := buckets[bucket]
		point := EventLiveActivityPoint{Timestamp: bucket.Format(time.RFC3339)}
		if current != nil {
			point.Events = current.Events
			point.Sessions = len(current.Sessions)
			point.Visitors = len(current.Visitors)
			for sessionID := range current.Sessions {
				activeSessions[sessionID] = struct{}{}
			}
			for visitorID := range current.Visitors {
				activeVisitors[visitorID] = struct{}{}
			}
		}
		movement = append(movement, point)
	}

	activePages, _ := buildEventBreakdownItems(pageCounts)
	activeCountries, _ := buildEventBreakdownItems(countryCounts)

	return EventLiveActivity{
		GeneratedAt:     now.Format(time.RFC3339),
		WindowMinutes:   int(eventLiveWindow / time.Minute),
		ActiveEvents:    activeEvents,
		ActiveSessions:  len(activeSessions),
		ActiveVisitors:  len(activeVisitors),
		Movement:        movement,
		ActivePages:     activePages,
		ActiveCountries: activeCountries,
		SampleSessions:  sampleSessionIDs(sessionLastSeen),
		Trust:           "measured",
		Freshness:       "trailing-15m",
	}
}

func bucketForLiveActivity(timestamp time.Time) time.Time {
	utc := timestamp.UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), utc.Hour(), utc.Minute(), 0, 0, time.UTC)
}

func scoreEventFamilyConfidence(current, previous int, duplicateRate float64, family string) float64 {
	volumeScore := math.Min(1, math.Log1p(float64(current))/math.Log1p(400))
	comparisonScore := math.Min(1, math.Log1p(float64(previous+1))/math.Log1p(120))
	score := 0.68*volumeScore + 0.22*comparisonScore - math.Min(0.18, duplicateRate*1.6)
	switch family {
	case "performance", "navigation":
		score += 0.06
	case "custom":
		score -= 0.04
	}
	return roundScore(score)
}

func eventFamilyTrustLabel(family string) string {
	switch family {
	case "navigation":
		return "high"
	case "performance":
		return "high"
	case "behavior":
		return "good"
	default:
		return "implementation-defined"
	}
}

func buildEventFeed(events []dashboardEvent, allowed map[string]struct{}) []EventFeedItem {
	sorted := append([]dashboardEvent(nil), events...)
	slices.SortFunc(sorted, func(left, right dashboardEvent) int {
		return right.Timestamp.Compare(left.Timestamp)
	})

	feed := make([]EventFeedItem, 0, minInt(maxEventFeedItems, len(sorted)))
	for _, event := range sorted {
		if !eventExplorerVisible(event) {
			continue
		}
		if _, ok := allowed[explorerEventKey(event.Name)]; !ok {
			continue
		}

		propertySummary, privacyLabel := feedPropertySummary(event)
		country := event.geoLocation().countryLabel()
		if strings.TrimSpace(country) == "" {
			country = "Unknown"
		}
		feed = append(feed, EventFeedItem{
			Timestamp:       event.Timestamp.UTC().Format(time.RFC3339),
			Name:            strings.TrimSpace(event.Name),
			Family:          eventFamily(event.Name),
			Path:            normalizePath(event.Path),
			SessionID:       event.sessionKey(),
			Device:          event.deviceType(),
			Country:         country,
			PropertySummary: propertySummary,
			PrivacyLabel:    privacyLabel,
		})
		if len(feed) >= maxEventFeedItems {
			break
		}
	}
	return feed
}

func accumulateEventProperties(item *eventExplorerAggregate, event dashboardEvent) int {
	props, ok := mapValue(event.Meta["pr"])
	if !ok || len(props) == 0 {
		return 0
	}

	maskedCount := 0
	for rawKey, rawValue := range props {
		key := strings.TrimSpace(rawKey)
		if key == "" {
			continue
		}

		facet := item.Properties[key]
		if facet == nil {
			facet = &eventPropertyAggregate{
				Key:       key,
				Values:    map[string]int{},
				RawValues: map[string]struct{}{},
			}
			item.Properties[key] = facet
		}

		displayValue, masked := sanitizeEventPropertyValue(key, rawValue)
		facet.Values[displayValue] += 1
		facet.RawValues[canonicalPropertyValue(rawValue)] = struct{}{}
		if masked {
			facet.Masked = true
			maskedCount += 1
		}
	}

	return maskedCount
}

func buildEventPropertyFacets(properties map[string]*eventPropertyAggregate) ([]EventPropertyFacet, int) {
	facets := make([]EventPropertyFacet, 0, len(properties))
	withheldRows := 0

	for _, item := range properties {
		if len(item.Values) == 0 {
			continue
		}

		values, hiddenRows := buildEventBreakdownItems(item.Values)
		withheldRows += hiddenRows
		facets = append(facets, EventPropertyFacet{
			Key:         item.Key,
			Cardinality: len(item.RawValues),
			Masked:      item.Masked,
			Values:      values,
		})
	}

	slices.SortFunc(facets, func(left, right EventPropertyFacet) int {
		leftCount := 0
		rightCount := 0
		if len(left.Values) > 0 {
			leftCount = left.Values[0].Count
		}
		if len(right.Values) > 0 {
			rightCount = right.Values[0].Count
		}

		switch {
		case leftCount != rightCount:
			return rightCount - leftCount
		case left.Cardinality != right.Cardinality:
			return right.Cardinality - left.Cardinality
		default:
			return strings.Compare(left.Key, right.Key)
		}
	})

	if len(facets) > maxEventPropertyFacets {
		facets = facets[:maxEventPropertyFacets]
	}
	for index := range facets {
		if len(facets[index].Values) > maxEventPropertyValueItems {
			facets[index].Values = facets[index].Values[:maxEventPropertyValueItems]
		}
	}

	return facets, withheldRows
}

func buildEventBreakdownItems(counts map[string]int) ([]EventBreakdownItem, int) {
	type breakdown struct {
		Label string
		Count int
	}

	rows := make([]breakdown, 0, len(counts))
	withheldRows := 0
	withheldCount := 0

	for rawLabel, count := range counts {
		label := strings.TrimSpace(rawLabel)
		if label == "" || count <= 0 {
			continue
		}
		if count < eventExplorerPrivacyFloor {
			withheldRows += 1
			withheldCount += count
			continue
		}
		rows = append(rows, breakdown{Label: label, Count: count})
	}

	slices.SortFunc(rows, func(left, right breakdown) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Label, right.Label)
		}
	})

	limit := maxEventBreakdownItems
	if withheldCount > 0 && limit > 0 {
		limit -= 1
	}
	if limit < 1 {
		limit = 1
	}
	if len(rows) > limit {
		rows = rows[:limit]
	}

	items := make([]EventBreakdownItem, 0, len(rows)+1)
	for _, row := range rows {
		items = append(items, EventBreakdownItem{Label: row.Label, Count: row.Count})
	}
	if withheldCount > 0 {
		items = append(items, EventBreakdownItem{
			Label: fmt.Sprintf("Withheld (<%d)", eventExplorerPrivacyFloor),
			Count: withheldCount,
		})
	}

	return items, withheldRows
}

func eventStatuses(item *eventExplorerAggregate, currentStart, currentEnd time.Time) []string {
	statuses := []string{}
	if item.PreviousCount == 0 || item.FirstSeen.After(currentStart.Add(-24*time.Hour)) {
		statuses = append(statuses, "new")
	}
	if probableDuplicateRateForAggregate(item) >= 0.12 || averageEventsPerSession(item) >= 6 {
		statuses = append(statuses, "noisy")
	}
	if eventHasHighCardinality(item) {
		statuses = append(statuses, "high-cardinality")
	}
	if item.PreviousCount >= item.Count*3 && item.LastSeen.Before(currentEnd.Add(-currentEnd.Sub(currentStart)/3)) {
		statuses = append(statuses, "deprecated")
	}
	if len(statuses) == 0 {
		statuses = append(statuses, "healthy")
	}
	return statuses
}

func eventHasHighCardinality(item *eventExplorerAggregate) bool {
	for _, facet := range item.Properties {
		if len(facet.RawValues) >= 12 {
			return true
		}
	}
	return item.MaskedPropertyCount >= 4
}

func averageEventsPerSession(item *eventExplorerAggregate) float64 {
	if len(item.SessionEventCounts) == 0 {
		return 0
	}
	total := 0
	for _, count := range item.SessionEventCounts {
		total += count
	}
	return float64(total) / float64(len(item.SessionEventCounts))
}

func probableDuplicateRate(events []dashboardEvent) float64 {
	visible := 0
	duplicates := 0
	windows := map[string]eventDuplicateWindow{}

	for _, event := range events {
		if !eventExplorerVisible(event) {
			continue
		}
		visible += 1
		key := duplicateSignature(event)
		if previous, ok := windows[key]; ok && event.Timestamp.Sub(previous.Timestamp) <= 2*time.Second {
			duplicates += 1
			continue
		}
		windows[key] = eventDuplicateWindow{Timestamp: event.Timestamp}
	}

	if visible == 0 {
		return 0
	}
	return float64(duplicates) / float64(visible)
}

func probableDuplicateRateForAggregate(item *eventExplorerAggregate) float64 {
	if item.Count == 0 {
		return 0
	}
	average := averageEventsPerSession(item)
	if average <= 2 {
		return 0
	}
	return math.Min(0.32, (average-2)/12)
}

func duplicateSignature(event dashboardEvent) string {
	props, _ := mapValue(event.Meta["pr"])
	builder := strings.Builder{}
	builder.WriteString(event.sessionKey())
	builder.WriteString("|")
	builder.WriteString(normalizedEventName(event.Name))
	builder.WriteString("|")
	builder.WriteString(normalizePath(event.Path))
	builder.WriteString("|")
	if event.X != nil || event.Y != nil {
		builder.WriteString(fmt.Sprintf("%.2f:%.2f|", coordValue(event.X), coordValue(event.Y)))
	}
	if len(props) > 0 {
		keys := make([]string, 0, len(props))
		for key := range props {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		for _, key := range keys {
			builder.WriteString(key)
			builder.WriteString("=")
			builder.WriteString(canonicalPropertyValue(props[key]))
			builder.WriteString(";")
		}
	}
	return builder.String()
}

func duplicateWindowForEvent(name string) time.Duration {
	switch eventFamily(name) {
	case "navigation":
		return 3 * time.Second
	case "behavior":
		return 1500 * time.Millisecond
	case "performance":
		return 5 * time.Second
	default:
		return 2 * time.Second
	}
}

func coordValue(value *float64) float64 {
	if value == nil {
		return 0
	}
	return round2(*value)
}

func sanitizeEventPropertyValue(key string, raw any) (string, bool) {
	if eventPropertyKeySensitive(key) {
		return "Masked", true
	}

	switch value := raw.(type) {
	case string:
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return "Empty", false
		}
		if eventPropertyValueSensitive(trimmed) {
			return "Masked", true
		}
		if len(trimmed) > 28 {
			return trimmed[:25] + "...", false
		}
		return trimmed, false
	case bool:
		if value {
			return "true", false
		}
		return "false", false
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return "Masked", true
		}
		if math.Abs(value) >= 1_000_000 {
			return "Masked", true
		}
		return strconv.FormatFloat(value, 'f', -1, 64), false
	case float32:
		return sanitizeEventPropertyValue(key, float64(value))
	case int:
		return sanitizeEventPropertyValue(key, float64(value))
	case int32:
		return sanitizeEventPropertyValue(key, float64(value))
	case int64:
		return sanitizeEventPropertyValue(key, float64(value))
	case uint:
		return sanitizeEventPropertyValue(key, float64(value))
	case uint32:
		return sanitizeEventPropertyValue(key, float64(value))
	case uint64:
		if value > 1_000_000 {
			return "Masked", true
		}
		return strconv.FormatUint(value, 10), false
	default:
		return "Masked", true
	}
}

func canonicalPropertyValue(raw any) string {
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(strings.ToLower(value))
	case bool:
		if value {
			return "true"
		}
		return "false"
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(value), 'f', -1, 64)
	case int:
		return strconv.Itoa(value)
	case int64:
		return strconv.FormatInt(value, 10)
	case uint64:
		return strconv.FormatUint(value, 10)
	default:
		return fmt.Sprintf("%v", value)
	}
}

func eventPropertyKeySensitive(key string) bool {
	value := strings.ToLower(strings.TrimSpace(key))
	switch {
	case value == "":
		return false
	case value == "id" || value == "user_id" || value == "session_id" || value == "visitor_id":
		return true
	case strings.Contains(value, "email") || strings.Contains(value, "mail"):
		return true
	case strings.Contains(value, "phone") || strings.Contains(value, "name"):
		return true
	case strings.Contains(value, "address") || strings.Contains(value, "message"):
		return true
	case strings.Contains(value, "comment") || strings.Contains(value, "password"):
		return true
	case strings.Contains(value, "secret") || strings.Contains(value, "token"):
		return true
	case strings.Contains(value, "search") || strings.Contains(value, "query"):
		return true
	case strings.HasSuffix(value, "_id") || strings.Contains(value, "uuid"):
		return true
	default:
		return false
	}
}

func eventPropertyValueSensitive(value string) bool {
	trimmed := strings.TrimSpace(strings.ToLower(value))
	switch {
	case trimmed == "":
		return false
	case strings.Contains(trimmed, "@"):
		return true
	case strings.Contains(trimmed, "http://") || strings.Contains(trimmed, "https://"):
		return true
	case strings.HasPrefix(trimmed, "www."):
		return true
	case strings.Contains(trimmed, "bearer "):
		return true
	case len(trimmed) > 32:
		return true
	case strings.Count(trimmed, " ") >= 2:
		return true
	}

	digits := 0
	letters := 0
	for _, character := range trimmed {
		switch {
		case character >= '0' && character <= '9':
			digits += 1
		case (character >= 'a' && character <= 'z') || character == '-':
			letters += 1
		}
	}
	if digits >= 7 {
		return true
	}
	if letters >= 12 && strings.Count(trimmed, "-") >= 2 {
		return true
	}
	return false
}

func feedPropertySummary(event dashboardEvent) (string, string) {
	props, ok := mapValue(event.Meta["pr"])
	if !ok || len(props) == 0 {
		return "No custom properties", "privacy-safe"
	}

	keys := make([]string, 0, len(props))
	for key := range props {
		keys = append(keys, key)
	}
	slices.Sort(keys)

	pairs := []string{}
	masked := false
	for _, key := range keys {
		value, isMasked := sanitizeEventPropertyValue(key, props[key])
		if isMasked {
			masked = true
			continue
		}
		pairs = append(pairs, fmt.Sprintf("%s=%s", strings.TrimSpace(key), value))
		if len(pairs) >= 2 {
			break
		}
	}

	switch {
	case len(pairs) > 0 && masked:
		return strings.Join(pairs, " · "), "masked"
	case len(pairs) > 0:
		return strings.Join(pairs, " · "), "privacy-safe"
	case masked:
		return "Masked properties withheld", "masked"
	default:
		return "No custom properties", "privacy-safe"
	}
}

func sampleSessionIDs(lastSeen map[string]time.Time) []string {
	type sessionEntry struct {
		ID       string
		LastSeen time.Time
	}

	sessions := make([]sessionEntry, 0, len(lastSeen))
	for sessionID, seenAt := range lastSeen {
		if strings.TrimSpace(sessionID) == "" {
			continue
		}
		sessions = append(sessions, sessionEntry{ID: sessionID, LastSeen: seenAt})
	}
	slices.SortFunc(sessions, func(left, right sessionEntry) int {
		return right.LastSeen.Compare(left.LastSeen)
	})

	if len(sessions) > 4 {
		sessions = sessions[:4]
	}

	ids := make([]string, 0, len(sessions))
	for _, session := range sessions {
		ids = append(ids, session.ID)
	}
	return ids
}

func eventPrivacyNote(maskedPropertyCount int) string {
	if maskedPropertyCount > 0 {
		return fmt.Sprintf(
			"DNT/GPC traffic is not collected. %d property values were masked, and low-volume rows stay behind the privacy floor.",
			maskedPropertyCount,
		)
	}
	return "DNT/GPC traffic is not collected, sensitive properties are masked when present, and low-volume rows stay behind the privacy floor."
}

func scoreExplorerConfidence(totalEvents, catalogEntries, filteredEvents int, duplicateRate float64) float64 {
	if totalEvents <= 0 {
		return 0
	}

	volumeScore := math.Min(1, math.Log1p(float64(totalEvents))/math.Log1p(1500))
	coverageScore := math.Min(1, float64(catalogEntries)/12)
	filteredShare := float64(filteredEvents) / float64(totalEvents)
	score := 0.52*volumeScore + 0.28*coverageScore + 0.20*(1-filteredShare) - math.Min(0.26, duplicateRate*2.2)
	return roundScore(score)
}

func scoreEventConfidence(count, uniqueSessions, uniqueVisitors int, duplicateRate float64, maskedPropertyCount int) float64 {
	volumeScore := math.Min(1, math.Log1p(float64(count))/math.Log1p(250))
	sessionScore := math.Min(1, float64(uniqueSessions)/25)
	visitorScore := math.Min(1, float64(uniqueVisitors)/40)
	maskPenalty := math.Min(0.22, float64(maskedPropertyCount)*0.03)
	score := 0.42*volumeScore + 0.34*sessionScore + 0.24*visitorScore - math.Min(0.2, duplicateRate*1.8) - maskPenalty
	return roundScore(score)
}

func roundScore(value float64) float64 {
	value = math.Max(0, math.Min(0.99, value))
	return math.Round(value*1000) / 10
}

func deltaPercent(current, previous int) float64 {
	if previous <= 0 {
		if current <= 0 {
			return 0
		}
		return 100
	}
	return (float64(current-previous) / float64(previous)) * 100
}

func maxIntFromDuration(duration time.Duration, unit time.Duration) int {
	if unit <= 0 {
		return 1
	}
	count := int(math.Ceil(float64(duration) / float64(unit)))
	if count < 1 {
		return 1
	}
	return count
}

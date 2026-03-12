package storage

import (
	"slices"
	"strconv"
	"strings"
	"time"
)

const defaultFunnelWindowMinutes = 30

type normalizedFunnelStep struct {
	Label     string
	Kind      FunnelStepKind
	MatchType FunnelStepMatchType
	Value     string
}

func buildFunnelReport(events []dashboardEvent, query FunnelQuery, rangeValue TimeRange) FunnelReport {
	steps := normalizeFunnelSteps(query.Steps)
	if len(steps) == 0 {
		return FunnelReport{
			Range:          rangeValue.String(),
			CountMode:      string(FunnelCountModeVisitors),
			WindowMinutes:  defaultFunnelWindowMinutes,
			CompletionTime: FunnelTimingSummary{},
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

	stepCounts := make([]int, len(steps))
	prevTotals := make([]int, len(steps))
	startTotals := make([]int, len(steps))
	prevDurations := make([][]int, len(steps))
	startDurations := make([][]int, len(steps))
	stepInspection := make([]FunnelStepInspection, len(steps))
	completionDurations := make([]int, 0, len(grouped))
	completions := 0

	for _, entityEvents := range grouped {
		matched := bestFunnelAttemptEvents(entityEvents, steps, window)
		if len(matched) == 0 {
			continue
		}
		matchCount := len(matched)

		for index, stepEvent := range matched {
			timestamp := stepEvent.Timestamp.UTC()
			stepCounts[index] += 1
			stepInspection[index].StepIndex = index
			stepInspection[index].Label = steps[index].Label
			stepInspection[index].Reached += 1
			if index == 0 {
				stepInspection[index].Entrants += 1
				continue
			}
			stepInspection[index].Entrants += 1
			previousSeconds := int(timestamp.Sub(matched[index-1].Timestamp.UTC()).Seconds())
			startSeconds := int(timestamp.Sub(matched[0].Timestamp.UTC()).Seconds())
			prevTotals[index] += previousSeconds
			startTotals[index] += startSeconds
			prevDurations[index] = append(prevDurations[index], previousSeconds)
			startDurations[index] = append(startDurations[index], startSeconds)
		}

		if matchCount < len(steps) {
			stepInspection[matchCount].StepIndex = matchCount
			stepInspection[matchCount].Label = steps[matchCount].Label
			stepInspection[matchCount].Entrants += 1
			stepInspection[matchCount].Dropped += 1
		}

		if matchCount == len(steps) {
			completions += 1
			completionDurations = append(
				completionDurations,
				int(matched[len(matched)-1].Timestamp.UTC().Sub(matched[0].Timestamp.UTC()).Seconds()),
			)
		}
	}

	entrants := 0
	if len(stepCounts) > 0 {
		entrants = stepCounts[0]
	}

	reportSteps := make([]FunnelStepReport, 0, len(steps))
	stepTimings := make([]FunnelStepTiming, 0, maxInt(len(steps)-1, 0))
	inspections := make([]FunnelStepInspection, 0, len(steps))
	for index, step := range steps {
		count := stepCounts[index]
		entrantCount := entrants
		stepConversionRate := 100.0
		dropOffCount := 0
		dropOffRate := 0.0
		if index > 0 {
			entrantCount = stepCounts[index-1]
			stepConversionRate = percentage(count, entrantCount)
			dropOffCount = entrantCount - count
			dropOffRate = percentage(dropOffCount, entrantCount)
		}

		reportSteps = append(reportSteps, FunnelStepReport{
			Index:                  index,
			Label:                  step.Label,
			Kind:                   string(step.Kind),
			MatchType:              string(step.MatchType),
			Value:                  step.Value,
			Entrants:               entrantCount,
			Count:                  count,
			ConversionRate:         percentage(count, entrants),
			StepConversionRate:     stepConversionRate,
			DropOffCount:           dropOffCount,
			DropOffRate:            dropOffRate,
			AvgSecondsFromPrevious: averageInt(prevTotals[index], count),
			AvgSecondsFromStart:    averageInt(startTotals[index], count),
		})

		inspection := stepInspection[index]
		inspection.StepIndex = index
		inspection.Label = step.Label
		if index == 0 {
			inspection.Entrants = entrants
			inspection.Reached = count
		}
		inspection.ReachRate = percentage(inspection.Reached, inspection.Entrants)
		inspection.DropRate = percentage(inspection.Dropped, inspection.Entrants)
		inspections = append(inspections, inspection)

		if index == 0 {
			continue
		}

		stepTimings = append(stepTimings, FunnelStepTiming{
			StepIndex:                 index,
			Label:                     step.Label,
			SampleCount:               len(prevDurations[index]),
			AvgSecondsFromPrevious:    averageInt(prevTotals[index], len(prevDurations[index])),
			MedianSecondsFromPrevious: percentileInt(prevDurations[index], 50),
			P90SecondsFromPrevious:    percentileInt(prevDurations[index], 90),
			MinSecondsFromPrevious:    minIntSlice(prevDurations[index]),
			MaxSecondsFromPrevious:    maxIntSlice(prevDurations[index]),
			AvgSecondsFromStart:       averageInt(startTotals[index], len(startDurations[index])),
			MedianSecondsFromStart:    percentileInt(startDurations[index], 50),
			P90SecondsFromStart:       percentileInt(startDurations[index], 90),
			MinSecondsFromStart:       minIntSlice(startDurations[index]),
			MaxSecondsFromStart:       maxIntSlice(startDurations[index]),
		})
	}

	return FunnelReport{
		Range:                 rangeValue.String(),
		CountMode:             string(countMode),
		WindowMinutes:         windowMinutes,
		Entrants:              entrants,
		Completions:           completions,
		OverallConversionRate: percentage(completions, entrants),
		Steps:                 reportSteps,
		Inspection:            inspections,
		StepTimings:           stepTimings,
		CompletionTime: FunnelTimingSummary{
			SampleCount:   len(completionDurations),
			AvgSeconds:    averageInt(sumInts(completionDurations), len(completionDurations)),
			MedianSeconds: percentileInt(completionDurations, 50),
			P90Seconds:    percentileInt(completionDurations, 90),
			MinSeconds:    minIntSlice(completionDurations),
			MaxSeconds:    maxIntSlice(completionDurations),
		},
	}
}

func normalizeFunnelSteps(steps []FunnelStepDefinition) []normalizedFunnelStep {
	normalized := make([]normalizedFunnelStep, 0, len(steps))
	for index, step := range steps {
		kind := ParseFunnelStepKind(step.Kind)
		matchType := ParseFunnelStepMatchType(step.MatchType)
		if kind == "" || matchType == "" {
			continue
		}

		value := strings.TrimSpace(step.Value)
		if kind == FunnelStepKindPage {
			value = normalizePath(value)
		}
		if value == "" {
			continue
		}

		label := strings.TrimSpace(step.Label)
		if label == "" {
			label = "Step " + strconv.Itoa(index+1)
		}

		normalized = append(normalized, normalizedFunnelStep{
			Label:     label,
			Kind:      kind,
			MatchType: matchType,
			Value:     value,
		})
	}
	return normalized
}

func bestFunnelAttempt(events []dashboardEvent, steps []normalizedFunnelStep, window time.Duration) []time.Time {
	best := []time.Time{}
	if len(events) == 0 || len(steps) == 0 {
		return best
	}

	for startIndex, event := range events {
		if !steps[0].matches(event) {
			continue
		}

		current := []time.Time{event.Timestamp.UTC()}
		startTime := event.Timestamp.UTC()
		nextStep := 1

		for index := startIndex + 1; index < len(events) && nextStep < len(steps); index += 1 {
			nextEvent := events[index]
			if nextEvent.Timestamp.UTC().Sub(startTime) > window {
				break
			}
			if steps[nextStep].matches(nextEvent) {
				current = append(current, nextEvent.Timestamp.UTC())
				nextStep += 1
			}
		}

		if len(current) > len(best) || (len(current) == len(best) && earlierAttempt(current, best)) {
			best = current
		}
		if len(best) == len(steps) {
			return best
		}
	}

	return best
}

func earlierAttempt(left, right []time.Time) bool {
	if len(left) == 0 {
		return false
	}
	if len(right) == 0 {
		return true
	}
	for index := 0; index < len(left) && index < len(right); index += 1 {
		switch {
		case left[index].Before(right[index]):
			return true
		case left[index].After(right[index]):
			return false
		}
	}
	return false
}

func sumInts(values []int) int {
	total := 0
	for _, value := range values {
		total += value
	}
	return total
}

func minIntSlice(values []int) int {
	if len(values) == 0 {
		return 0
	}
	minimum := values[0]
	for _, value := range values[1:] {
		if value < minimum {
			minimum = value
		}
	}
	return minimum
}

func maxIntSlice(values []int) int {
	if len(values) == 0 {
		return 0
	}
	maximum := values[0]
	for _, value := range values[1:] {
		if value > maximum {
			maximum = value
		}
	}
	return maximum
}

func percentileInt(values []int, percentile int) int {
	if len(values) == 0 {
		return 0
	}
	if percentile <= 0 {
		return minIntSlice(values)
	}
	if percentile >= 100 {
		return maxIntSlice(values)
	}

	sorted := slices.Clone(values)
	slices.Sort(sorted)
	index := ((len(sorted) - 1) * percentile) / 100
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func (s normalizedFunnelStep) matches(event dashboardEvent) bool {
	switch s.Kind {
	case FunnelStepKindPage:
		if strings.TrimSpace(event.Name) != "pageview" {
			return false
		}
		return s.matchesValue(normalizePath(event.Path))
	case FunnelStepKindEvent:
		name := strings.TrimSpace(event.Name)
		if name == "" || name == "pageview" {
			return false
		}
		return s.matchesValue(name)
	default:
		return false
	}
}

func (s normalizedFunnelStep) matchesValue(candidate string) bool {
	switch s.MatchType {
	case FunnelStepMatchPrefix:
		return strings.HasPrefix(candidate, s.Value)
	default:
		return candidate == s.Value
	}
}

func (e dashboardEvent) sequence() int {
	return intValue(e.Meta["sq"])
}

func compareDashboardEvents(left, right dashboardEvent) int {
	switch {
	case left.Timestamp.Before(right.Timestamp):
		return -1
	case left.Timestamp.After(right.Timestamp):
		return 1
	}

	leftSequence := left.sequence()
	rightSequence := right.sequence()
	if leftSequence > 0 && rightSequence > 0 {
		switch {
		case leftSequence < rightSequence:
			return -1
		case leftSequence > rightSequence:
			return 1
		}
	}

	leftRank := dashboardEventOrderHint(left.Name)
	rightRank := dashboardEventOrderHint(right.Name)
	switch {
	case left.sessionKey() < right.sessionKey():
		return -1
	case left.sessionKey() > right.sessionKey():
		return 1
	case leftRank < rightRank:
		return -1
	case leftRank > rightRank:
		return 1
	case left.Name < right.Name:
		return -1
	case left.Name > right.Name:
		return 1
	case left.Path < right.Path:
		return -1
	case left.Path > right.Path:
		return 1
	default:
		return 0
	}
}

func dashboardEventOrderHint(name string) int {
	switch strings.TrimSpace(name) {
	case "pageview":
		return 0
	case "scroll":
		return 1
	default:
		return 2
	}
}

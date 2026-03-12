package storage

import (
	"slices"
	"strings"
)

const maxSuggestedEventNames = 64

func buildEventNameMetrics(events []dashboardEvent) []EventNameMetric {
	counts := map[string]int{}
	for _, event := range events {
		name := strings.TrimSpace(event.Name)
		if !isFunnelCustomEvent(name) {
			continue
		}
		counts[name] += 1
	}

	metrics := make([]EventNameMetric, 0, len(counts))
	for name, count := range counts {
		metrics = append(metrics, EventNameMetric{
			Name:  name,
			Count: count,
		})
	}

	slices.SortFunc(metrics, func(left, right EventNameMetric) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Name, right.Name)
		}
	})

	if len(metrics) > maxSuggestedEventNames {
		return metrics[:maxSuggestedEventNames]
	}
	return metrics
}

func isFunnelCustomEvent(name string) bool {
	value := strings.TrimSpace(name)
	if value == "" {
		return false
	}

	switch value {
	case "pageview", "heartbeat", "click", "hover", "move", "scroll":
		return false
	}

	return !strings.HasPrefix(value, "perf_")
}

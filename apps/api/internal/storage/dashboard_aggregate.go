package storage

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
	"time"

	"anlticsheat/api/internal/ingest"
)

var dashboardDepths = []int{25, 50, 75, 100}

const (
	heatmapMinClickSample   = 500
	heatmapMinMoveSample    = 700
	heatmapMinSessionSample = 40
	heatmapOutlierQuantile  = 0.98
	mapPrivacyFloorVisitors = 3
	mapSignalMaxCountries   = 8
	mapMaxRegions           = 80
	mapMaxCities            = 120
)

type dashboardEvent struct {
	SiteID    string
	Timestamp time.Time
	SessionID string
	VisitorID string
	Name      string
	Path      string
	X         *float64
	Y         *float64
	Selector  string
	Depth     int
	HasDepth  bool
	Meta      map[string]any
}

type sessionAggregate struct {
	VisitorID                string
	Pageviews                int
	FirstPath                string
	FirstPageview            time.Time
	FirstEvent               time.Time
	LastEvent                time.Time
	MaxScrollDepth           int
	MeaningfulEvents         int
	RageClicks               int
	DeadClicks               int
	Referrer                 string
	PageSequence             []sessionPageview
	HasConversion            bool
	ConversionTime           time.Time
	EstimatedDurationSeconds float64
}

type pageAggregate struct {
	Path                  string
	Pageviews             int
	Clicks                int
	RageClicks            int
	DeadClicks            int
	Bounces               int
	Sessions              map[string]struct{}
	ScrollBySession       map[string]int
	PerfValues            map[string][]float64
	AttentionSeconds      float64
	AttentionSamples      int
	ConversionAssistCount int
}

type seriesAggregate struct {
	Pageviews int
	Sessions  map[string]struct{}
}

type sessionPageview struct {
	Path      string
	Timestamp time.Time
}

type analysisState struct {
	Pageviews  int
	RageClicks int
	DeadClicks int
	Realtime   map[string]struct{}
	Visitors   map[string]struct{}
	Sessions   map[string]*sessionAggregate
	Pages      map[string]*pageAggregate
	Referrers  map[string]int
	Devices    map[string]int
	Browsers   map[string]int
	OSFamilies map[string]int
	Series     map[time.Time]*seriesAggregate
	Scroll     map[int]map[string]struct{}
}

type geoLocationSnapshot struct {
	CountryCode string
	CountryName string
	Continent   string
	RegionCode  string
	RegionName  string
	City        string
	Timezone    string
	Precision   string
}

type mapCountryAggregate struct {
	CountryCode string
	CountryName string
	Continent   string
	Pageviews   int
	Visitors    map[string]struct{}
	Sessions    map[string]struct{}
	Precision   string
}

type mapRegionAggregate struct {
	CountryCode string
	CountryName string
	RegionCode  string
	RegionName  string
	Pageviews   int
	Visitors    map[string]struct{}
	Sessions    map[string]struct{}
}

type mapCityAggregate struct {
	CountryCode  string
	CountryName  string
	RegionName   string
	City         string
	Pageviews    int
	Visitors     map[string]struct{}
	Sessions     map[string]struct{}
	GeoPrecision string
}

func decodeStoredEvents(events []ingest.StoredEvent, siteID string, since time.Time) ([]dashboardEvent, error) {
	decoded := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if strings.TrimSpace(event.SiteID) != siteID || event.Timestamp.Before(since) {
			continue
		}

		item, ok, err := decodeStoredEvent(event)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		decoded = append(decoded, item)
	}
	return decoded, nil
}

func decodeStoredEvent(event ingest.StoredEvent) (dashboardEvent, bool, error) {
	meta := map[string]any{}
	if strings.TrimSpace(event.Meta) != "" {
		if err := json.Unmarshal([]byte(event.Meta), &meta); err != nil {
			return dashboardEvent{}, false, err
		}
	}

	decoded := dashboardEvent{
		SiteID:    strings.TrimSpace(event.SiteID),
		Timestamp: event.Timestamp.UTC(),
		SessionID: strings.TrimSpace(event.SessionID),
		VisitorID: strings.TrimSpace(event.VisitorID),
		Name:      strings.TrimSpace(event.Name),
		Path:      normalizePath(event.Path),
		Selector:  strings.TrimSpace(valueOrEmpty(event.Selector)),
		Meta:      meta,
	}
	if decoded.VisitorID == "" {
		decoded.VisitorID = strings.TrimSpace(metaString(meta, "vid"))
	}

	if event.X != nil {
		value := float64(*event.X)
		decoded.X = &value
	}
	if event.Y != nil {
		value := float64(*event.Y)
		decoded.Y = &value
	}
	if event.Depth != nil {
		decoded.Depth = int(*event.Depth)
		decoded.HasDepth = true
	}

	return decoded, true, nil
}

func buildDashboardSummary(events []dashboardEvent, rangeValue TimeRange, now time.Time) DashboardSummary {
	currentStart, currentEnd := rangeBounds(rangeValue, now.UTC())
	previousRange := comparisonTimeRange(rangeValue, now.UTC())
	previousStart, previousEnd := rangeBounds(previousRange, now.UTC())
	baselineRange := comparisonTimeRange(previousRange, previousEnd)
	baselineStart, baselineEnd := rangeBounds(baselineRange, previousEnd)

	currentEvents := make([]dashboardEvent, 0, len(events))
	previousEvents := make([]dashboardEvent, 0, len(events))
	baselineEvents := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		switch {
		case eventInRange(event, currentStart, currentEnd):
			currentEvents = append(currentEvents, event)
		case eventInRange(event, previousStart, previousEnd):
			previousEvents = append(previousEvents, event)
		case eventInRange(event, baselineStart, baselineEnd):
			baselineEvents = append(baselineEvents, event)
		}
	}

	currentState := scanEvents(currentEvents, rangeValue, currentEnd)
	previousState := scanEvents(previousEvents, previousRange, previousEnd)
	baselineState := scanEvents(baselineEvents, baselineRange, baselineEnd)
	currentSummary := summarizeDashboardPeriod(currentEvents, currentState, rangeValue, currentEnd)
	previousSummary := summarizeDashboardPeriod(previousEvents, previousState, previousRange, previousEnd)

	devices := topCountPairs(currentState.Devices, func(key string, value int) DeviceMetric {
		return DeviceMetric{Device: key, Pageviews: value}
	}, 3)
	browsers := topCountPairs(currentState.Browsers, func(key string, value int) BrowserMetric {
		return BrowserMetric{Browser: key, Pageviews: value}
	}, 4)
	operatingSystems := topCountPairs(currentState.OSFamilies, func(key string, value int) OperatingSystemMetric {
		return OperatingSystemMetric{OS: key, Pageviews: value}
	}, 4)

	return DashboardSummary{
		Range:              rangeValue.String(),
		ComparisonRange:    previousRange.String(),
		Overview:           currentSummary.Overview,
		OverviewComparison: buildDashboardOverviewComparison(currentSummary, previousSummary),
		Derived:            buildDashboardDerivedMetrics(currentSummary, previousSummary, previousState.Visitors, baselineState.Visitors),
		Timeseries:         currentSummary.Timeseries,
		TopPages:           limitSlice(buildDashboardTopPages(currentSummary, previousSummary), 6),
		Referrers:          limitSlice(buildDashboardReferrers(currentSummary), 6),
		Devices:            devices,
		Browsers:           browsers,
		OperatingSystems:   operatingSystems,
		ScrollFunnel:       currentSummary.ScrollFunnel,
		Pages:              limitSlice(currentSummary.PageOptions, 12),
	}
}

type dashboardReferrerSummary struct {
	Pageviews       int
	Sessions        int
	EngagedSessions int
	BounceSessions  int
	QualityScore    float64
}

type dashboardTrendBucket struct {
	Visitors        map[string]struct{}
	Sessions        int
	BounceSessions  int
	EngagedSessions int
	RageSessions    int
	DeadSessions    int
	ShortSessions   int
	ScrollTotal     int
	ScrollSamples   int
	DurationTotal   float64
	DurationSamples int
	FocusTotal      float64
	FocusSamples    int
}

type dashboardPeriodSummary struct {
	RangeValue             TimeRange
	PeriodEnd              time.Time
	Overview               OverviewMetrics
	Timeseries             []TimeseriesPoint
	ScrollFunnel           []DepthMetric
	PageOptions            []PageOption
	PageMetrics            map[string]PageMetric
	Referrers              map[string]dashboardReferrerSummary
	EngagedSessions        int
	BounceSessions         int
	PageDensity            float64
	AvgPageTimeSeconds     float64
	SessionDurationSeconds float64
	FrictionScore          float64
	ReferrerQualityScore   float64
	PageFocusScore         float64
	ConversionAssistCounts map[string]int
	ConversionSessionCount int
	Trends                 map[time.Time]*dashboardTrendBucket
	VisitorFirstBucket     map[string]time.Time
	RageClickBuckets       map[time.Time]int
}

func summarizeDashboardPeriod(
	events []dashboardEvent,
	state analysisState,
	rangeValue TimeRange,
	periodEnd time.Time,
) dashboardPeriodSummary {
	summary := dashboardPeriodSummary{
		RangeValue:             rangeValue,
		PeriodEnd:              periodEnd.UTC(),
		PageMetrics:            map[string]PageMetric{},
		Referrers:              map[string]dashboardReferrerSummary{},
		ConversionAssistCounts: map[string]int{},
		Trends:                 map[time.Time]*dashboardTrendBucket{},
		VisitorFirstBucket:     map[string]time.Time{},
		RageClickBuckets:       map[time.Time]int{},
	}

	for _, event := range events {
		if event.Name == "click" && event.rage() {
			summary.RageClickBuckets[dashboardBucket(event.Timestamp, rangeValue)] += 1
		}
	}

	applyDashboardPageAttention(state)

	totalSessions := 0
	bounceSessions := 0
	totalScrollDepth := 0
	totalAttentionSeconds := 0.0
	totalPageExposures := 0
	rageSessions := 0
	deadSessions := 0
	shortSessions := 0

	for _, session := range state.Sessions {
		if session.Pageviews == 0 {
			continue
		}

		totalSessions += 1
		totalScrollDepth += session.MaxScrollDepth
		totalAttentionSeconds += session.EstimatedDurationSeconds
		totalPageExposures += session.Pageviews

		isBounce := session.Pageviews <= 1
		if isBounce {
			bounceSessions += 1
			if page := state.Pages[session.FirstPath]; page != nil {
				page.Bounces += 1
			}
		}

		isEngaged := session.Pageviews > 1 || session.MeaningfulEvents > 0
		if isEngaged {
			summary.EngagedSessions += 1
		}
		if session.RageClicks > 0 {
			rageSessions += 1
		}
		if session.DeadClicks > 0 {
			deadSessions += 1
		}
		if dashboardShortSession(session) {
			shortSessions += 1
		}

		referrer := strings.TrimSpace(session.Referrer)
		if referrer == "" {
			referrer = "Direct"
		}
		referrerSummary := summary.Referrers[referrer]
		referrerSummary.Sessions += 1
		if isEngaged {
			referrerSummary.EngagedSessions += 1
		}
		if isBounce {
			referrerSummary.BounceSessions += 1
		}
		summary.Referrers[referrer] = referrerSummary

		bucket := dashboardSessionStartBucket(session, rangeValue)
		trendBucket := ensureDashboardTrendBucket(summary.Trends, bucket)
		trendBucket.Sessions += 1
		if isBounce {
			trendBucket.BounceSessions += 1
		}
		if isEngaged {
			trendBucket.EngagedSessions += 1
		}
		if session.RageClicks > 0 {
			trendBucket.RageSessions += 1
		}
		if session.DeadClicks > 0 {
			trendBucket.DeadSessions += 1
		}
		if dashboardShortSession(session) {
			trendBucket.ShortSessions += 1
		}
		trendBucket.ScrollTotal += session.MaxScrollDepth
		trendBucket.ScrollSamples += 1
		trendBucket.DurationTotal += session.EstimatedDurationSeconds
		trendBucket.DurationSamples += 1
		avgPageTimeSeconds := 0.0
		if session.Pageviews > 0 {
			avgPageTimeSeconds = session.EstimatedDurationSeconds / float64(session.Pageviews)
		}
		trendBucket.FocusTotal += dashboardFocusScore(avgPageTimeSeconds, float64(session.MaxScrollDepth))
		trendBucket.FocusSamples += 1

		visitorID := strings.TrimSpace(session.VisitorID)
		if visitorID == "" {
			visitorID = "unknown-visitor"
		}
		if existing, ok := summary.VisitorFirstBucket[visitorID]; !ok || bucket.Before(existing) {
			summary.VisitorFirstBucket[visitorID] = bucket
		}

		if session.HasConversion {
			summary.ConversionSessionCount += 1
			seenPaths := map[string]struct{}{}
			for _, pageview := range session.PageSequence {
				if !session.ConversionTime.IsZero() && pageview.Timestamp.After(session.ConversionTime) {
					break
				}
				seenPaths[pageview.Path] = struct{}{}
			}
			if len(seenPaths) == 0 && session.FirstPath != "" {
				seenPaths[session.FirstPath] = struct{}{}
			}
			for path := range seenPaths {
				summary.ConversionAssistCounts[path] += 1
			}
		}
	}

	for visitorID, bucket := range summary.VisitorFirstBucket {
		ensureDashboardTrendBucket(summary.Trends, bucket).Visitors[visitorID] = struct{}{}
	}

	for path, count := range summary.ConversionAssistCounts {
		if page := state.Pages[path]; page != nil {
			page.ConversionAssistCount = count
		}
	}

	pageOptions := make([]PageOption, 0, len(state.Pages))
	totalFocusWeighted := 0.0
	for _, page := range state.Pages {
		if page.Pageviews <= 0 {
			continue
		}
		avgTimeOnPage := averageFloat(page.AttentionSeconds, page.AttentionSamples)
		focusScore := dashboardFocusScore(avgTimeOnPage, averageScrollDepth(page.ScrollBySession))
		totalFocusWeighted += focusScore * float64(page.Pageviews)
		summary.PageMetrics[page.Path] = PageMetric{
			Path:                  page.Path,
			Pageviews:             page.Pageviews,
			Sessions:              len(page.Sessions),
			AvgScrollDepth:        averageScrollDepth(page.ScrollBySession),
			RageClicks:            page.RageClicks,
			DeadClicks:            page.DeadClicks,
			AvgTimeOnPageSeconds:  avgTimeOnPage,
			FocusScore:            focusScore,
			ConversionAssistScore: percentage(page.ConversionAssistCount, maxInt(summary.ConversionSessionCount, 1)),
		}
		pageOptions = append(pageOptions, PageOption{
			Path:      page.Path,
			Pageviews: page.Pageviews,
		})
	}
	slices.SortFunc(pageOptions, func(a, b PageOption) int {
		switch {
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})
	summary.PageOptions = pageOptions

	for source, pageviews := range state.Referrers {
		referrerSummary := summary.Referrers[source]
		referrerSummary.Pageviews = pageviews
		referrerSummary.QualityScore = dashboardReferrerQuality(
			referrerSummary.EngagedSessions,
			referrerSummary.BounceSessions,
			referrerSummary.Sessions,
		)
		summary.Referrers[source] = referrerSummary
	}

	scrollFunnel := make([]DepthMetric, 0, len(dashboardDepths))
	for _, depth := range dashboardDepths {
		scrollFunnel = append(scrollFunnel, DepthMetric{
			Depth:    depth,
			Sessions: len(state.Scroll[depth]),
		})
	}
	summary.ScrollFunnel = scrollFunnel

	summary.Overview = OverviewMetrics{
		RealtimeVisitors: len(state.Realtime),
		UniqueVisitors:   len(state.Visitors),
		Pageviews:        state.Pageviews,
		Sessions:         totalSessions,
		BounceRate:       percentage(bounceSessions, totalSessions),
		AvgScrollDepth:   average(totalScrollDepth, totalSessions),
		RageClicks:       state.RageClicks,
	}
	summary.Timeseries = buildTimeseries(state.Series, rangeValue, periodEnd)
	summary.BounceSessions = bounceSessions
	summary.PageDensity = 0
	if totalSessions > 0 {
		summary.PageDensity = round2(float64(state.Pageviews) / float64(totalSessions))
	}
	summary.AvgPageTimeSeconds = averageFloat(totalAttentionSeconds, totalPageExposures)
	summary.SessionDurationSeconds = round1(summary.PageDensity * summary.AvgPageTimeSeconds)
	summary.FrictionScore = dashboardFrictionScore(rageSessions, deadSessions, shortSessions, totalSessions)
	summary.ReferrerQualityScore = dashboardReferrerQuality(summary.EngagedSessions, bounceSessions, totalSessions)
	if state.Pageviews > 0 {
		summary.PageFocusScore = round1(totalFocusWeighted / float64(state.Pageviews))
	}

	return summary
}

func buildDashboardOverviewComparison(current, previous dashboardPeriodSummary) DashboardOverviewComparison {
	return DashboardOverviewComparison{
		UniqueVisitors: dashboardMetricDelta(
			float64(current.Overview.UniqueVisitors),
			float64(previous.Overview.UniqueVisitors),
			buildDashboardUniqueVisitorTrend(current),
			"measured",
		),
		Pageviews: dashboardMetricDelta(
			float64(current.Overview.Pageviews),
			float64(previous.Overview.Pageviews),
			dashboardTimeseriesTrend(current.Timeseries, func(point TimeseriesPoint) float64 { return float64(point.Pageviews) }),
			"measured",
		),
		Sessions: dashboardMetricDelta(
			float64(current.Overview.Sessions),
			float64(previous.Overview.Sessions),
			dashboardTimeseriesTrend(current.Timeseries, func(point TimeseriesPoint) float64 { return float64(point.Sessions) }),
			"measured",
		),
		BounceRate: dashboardMetricDelta(
			current.Overview.BounceRate,
			previous.Overview.BounceRate,
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return percentage(bucket.BounceSessions, bucket.Sessions)
			}),
			"measured",
		),
		AvgScrollDepth: dashboardMetricDelta(
			current.Overview.AvgScrollDepth,
			previous.Overview.AvgScrollDepth,
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return average(bucket.ScrollTotal, bucket.ScrollSamples)
			}),
			"measured",
		),
		RageClicks: dashboardMetricDelta(
			float64(current.Overview.RageClicks),
			float64(previous.Overview.RageClicks),
			buildDashboardRageClickTrend(current),
			"measured",
		),
	}
}

func buildDashboardDerivedMetrics(
	current, previous dashboardPeriodSummary,
	comparisonVisitors, previousComparisonVisitors map[string]struct{},
) DashboardDerivedMetrics {
	currentReturning, currentNew := dashboardReturningVisitorCounts(current, comparisonVisitors)
	previousReturning, previousNew := dashboardReturningVisitorCounts(previous, previousComparisonVisitors)

	return DashboardDerivedMetrics{
		EngagedSessions: dashboardMetricDelta(
			float64(current.EngagedSessions),
			float64(previous.EngagedSessions),
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return float64(bucket.EngagedSessions)
			}),
			"measured",
		),
		ReturningVisitorRatio: DashboardReturningVisitorMetric{
			Ratio: dashboardMetricDelta(
				percentage(currentReturning, maxInt(currentReturning+currentNew, 1)),
				percentage(previousReturning, maxInt(previousReturning+previousNew, 1)),
				buildDashboardReturningVisitorTrend(current, comparisonVisitors),
				"windowed",
			),
			ReturningVisitors: currentReturning,
			NewVisitors:       currentNew,
		},
		FrictionScore: dashboardMetricDelta(
			current.FrictionScore,
			previous.FrictionScore,
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return dashboardFrictionScore(bucket.RageSessions, bucket.DeadSessions, bucket.ShortSessions, bucket.Sessions)
			}),
			"derived",
		),
		ReferrerQualityScore: dashboardMetricDelta(
			current.ReferrerQualityScore,
			previous.ReferrerQualityScore,
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return dashboardReferrerQuality(bucket.EngagedSessions, bucket.BounceSessions, bucket.Sessions)
			}),
			"derived",
		),
		PageFocusScore: dashboardMetricDelta(
			current.PageFocusScore,
			previous.PageFocusScore,
			buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return averageFloat(bucket.FocusTotal, bucket.FocusSamples)
			}),
			"estimated",
		),
		SessionDuration: DashboardSessionDurationMetric{
			Current:  current.SessionDurationSeconds,
			Previous: previous.SessionDurationSeconds,
			Delta:    deltaPercentFloat(current.SessionDurationSeconds, previous.SessionDurationSeconds),
			Trend: buildDashboardTrend(current, func(bucket *dashboardTrendBucket) float64 {
				return averageFloat(bucket.DurationTotal, bucket.DurationSamples)
			}),
			Trust:              "estimated",
			PageDensity:        current.PageDensity,
			AvgPageTimeSeconds: current.AvgPageTimeSeconds,
		},
		TopPathMomentum:  buildDashboardPathMomentum(current, previous),
		ConversionAssist: buildDashboardConversionAssist(current),
	}
}

func buildDashboardTopPages(current, previous dashboardPeriodSummary) []PageMetric {
	topPages := make([]PageMetric, 0, len(current.PageMetrics))
	for path, metric := range current.PageMetrics {
		previousMetric := previous.PageMetrics[path]
		metric.PreviousPageviews = previousMetric.Pageviews
		metric.GrowthVsPrevious = round1(deltaPercent(metric.Pageviews, previousMetric.Pageviews))
		topPages = append(topPages, metric)
	}

	slices.SortFunc(topPages, func(a, b PageMetric) int {
		switch {
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		case a.FocusScore != b.FocusScore:
			if a.FocusScore > b.FocusScore {
				return -1
			}
			return 1
		case a.RageClicks != b.RageClicks:
			return b.RageClicks - a.RageClicks
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})
	return topPages
}

func buildDashboardReferrers(current dashboardPeriodSummary) []ReferrerMetric {
	referrers := make([]ReferrerMetric, 0, len(current.Referrers))
	for source, summary := range current.Referrers {
		referrers = append(referrers, ReferrerMetric{
			Source:          source,
			Pageviews:       summary.Pageviews,
			Sessions:        summary.Sessions,
			EngagedSessions: summary.EngagedSessions,
			BounceSessions:  summary.BounceSessions,
			BounceRate:      percentage(summary.BounceSessions, summary.Sessions),
			QualityScore:    summary.QualityScore,
		})
	}

	slices.SortFunc(referrers, func(a, b ReferrerMetric) int {
		switch {
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		case a.QualityScore != b.QualityScore:
			if a.QualityScore > b.QualityScore {
				return -1
			}
			return 1
		default:
			return strings.Compare(a.Source, b.Source)
		}
	})
	return referrers
}

func buildDashboardPathMomentum(current, previous dashboardPeriodSummary) []PathMomentumMetric {
	momentum := make([]PathMomentumMetric, 0, len(current.PageMetrics))
	for path, metric := range current.PageMetrics {
		previousMetric := previous.PageMetrics[path]
		delta := metric.Pageviews - previousMetric.Pageviews
		momentum = append(momentum, PathMomentumMetric{
			Path:              path,
			Pageviews:         metric.Pageviews,
			PreviousPageviews: previousMetric.Pageviews,
			DeltaPageviews:    delta,
			GrowthVsPrevious:  round1(deltaPercent(metric.Pageviews, previousMetric.Pageviews)),
			Trust:             "windowed",
		})
	}

	slices.SortFunc(momentum, func(a, b PathMomentumMetric) int {
		switch {
		case a.DeltaPageviews != b.DeltaPageviews:
			return b.DeltaPageviews - a.DeltaPageviews
		case a.GrowthVsPrevious != b.GrowthVsPrevious:
			if a.GrowthVsPrevious > b.GrowthVsPrevious {
				return -1
			}
			return 1
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	filtered := make([]PathMomentumMetric, 0, len(momentum))
	for _, item := range momentum {
		if item.DeltaPageviews <= 0 {
			continue
		}
		filtered = append(filtered, item)
	}
	if len(filtered) == 0 {
		return nil
	}
	return limitSlice(filtered, 5)
}

func buildDashboardConversionAssist(current dashboardPeriodSummary) []ConversionAssistMetric {
	if current.ConversionSessionCount == 0 {
		return nil
	}

	assists := make([]ConversionAssistMetric, 0, len(current.ConversionAssistCounts))
	for path, count := range current.ConversionAssistCounts {
		assists = append(assists, ConversionAssistMetric{
			Path:                path,
			AssistedConversions: count,
			ConversionShare:     percentage(count, current.ConversionSessionCount),
			Trust:               "heuristic",
		})
	}

	slices.SortFunc(assists, func(a, b ConversionAssistMetric) int {
		switch {
		case a.AssistedConversions != b.AssistedConversions:
			return b.AssistedConversions - a.AssistedConversions
		case a.ConversionShare != b.ConversionShare:
			if a.ConversionShare > b.ConversionShare {
				return -1
			}
			return 1
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	return limitSlice(assists, 5)
}

func dashboardMetricDelta(current, previous float64, trend []float64, trust string) DashboardMetricDelta {
	return DashboardMetricDelta{
		Current:  round1(current),
		Previous: round1(previous),
		Delta:    deltaPercentFloat(current, previous),
		Trend:    trend,
		Trust:    trust,
	}
}

func dashboardReturningVisitorCounts(summary dashboardPeriodSummary, comparisonVisitors map[string]struct{}) (int, int) {
	returningVisitors := 0
	newVisitors := 0
	for visitorID := range summary.VisitorFirstBucket {
		if _, ok := comparisonVisitors[visitorID]; ok {
			returningVisitors += 1
			continue
		}
		newVisitors += 1
	}
	return returningVisitors, newVisitors
}

func buildDashboardUniqueVisitorTrend(summary dashboardPeriodSummary) []float64 {
	return buildDashboardTrend(summary, func(bucket *dashboardTrendBucket) float64 {
		return float64(len(bucket.Visitors))
	})
}

func buildDashboardReturningVisitorTrend(
	summary dashboardPeriodSummary,
	comparisonVisitors map[string]struct{},
) []float64 {
	sequence := dashboardBucketSequence(summary.RangeValue, summary.PeriodEnd)
	buckets := map[time.Time]struct {
		returning int
		total     int
	}{}
	for visitorID, bucket := range summary.VisitorFirstBucket {
		current := buckets[bucket]
		current.total += 1
		if _, ok := comparisonVisitors[visitorID]; ok {
			current.returning += 1
		}
		buckets[bucket] = current
	}

	trend := make([]float64, 0, len(sequence))
	for _, bucket := range sequence {
		current := buckets[bucket]
		trend = append(trend, percentage(current.returning, current.total))
	}
	return trend
}

func buildDashboardRageClickTrend(summary dashboardPeriodSummary) []float64 {
	sequence := dashboardBucketSequence(summary.RangeValue, summary.PeriodEnd)
	trend := make([]float64, 0, len(sequence))
	for _, bucket := range sequence {
		trend = append(trend, round1(float64(summary.RageClickBuckets[bucket])))
	}
	return trend
}

func dashboardTimeseriesTrend(
	points []TimeseriesPoint,
	selector func(TimeseriesPoint) float64,
) []float64 {
	trend := make([]float64, 0, len(points))
	for _, point := range points {
		trend = append(trend, round1(selector(point)))
	}
	return trend
}

func buildDashboardTrend(
	summary dashboardPeriodSummary,
	selector func(*dashboardTrendBucket) float64,
) []float64 {
	sequence := dashboardBucketSequence(summary.RangeValue, summary.PeriodEnd)
	trend := make([]float64, 0, len(sequence))
	for _, bucket := range sequence {
		trendBucket := summary.Trends[bucket]
		if trendBucket == nil {
			trend = append(trend, 0)
			continue
		}
		trend = append(trend, round1(selector(trendBucket)))
	}
	return trend
}

func ensureDashboardTrendBucket(
	buckets map[time.Time]*dashboardTrendBucket,
	bucket time.Time,
) *dashboardTrendBucket {
	current := buckets[bucket]
	if current == nil {
		current = &dashboardTrendBucket{
			Visitors: map[string]struct{}{},
		}
		buckets[bucket] = current
	}
	return current
}

func applyDashboardPageAttention(state analysisState) {
	for _, session := range state.Sessions {
		if len(session.PageSequence) == 0 {
			continue
		}

		durationTotal := 0.0
		for index, pageview := range session.PageSequence {
			end := session.LastEvent
			if index+1 < len(session.PageSequence) && session.PageSequence[index+1].Timestamp.Before(end) {
				end = session.PageSequence[index+1].Timestamp
			}
			if end.Before(pageview.Timestamp) {
				continue
			}

			duration := end.Sub(pageview.Timestamp)
			if duration > 10*time.Minute {
				duration = 10 * time.Minute
			}
			seconds := duration.Seconds()
			if page := state.Pages[pageview.Path]; page != nil {
				page.AttentionSeconds += seconds
				page.AttentionSamples += 1
			}
			durationTotal += seconds
		}
		session.EstimatedDurationSeconds = durationTotal
	}
}

func dashboardSessionStartBucket(session *sessionAggregate, rangeValue TimeRange) time.Time {
	start := session.FirstPageview
	if start.IsZero() {
		start = session.FirstEvent
	}
	return dashboardBucket(start, rangeValue)
}

func dashboardBucket(timestamp time.Time, rangeValue TimeRange) time.Time {
	utc := timestamp.UTC()
	if rangeValue.BucketDuration() == time.Hour {
		return time.Date(utc.Year(), utc.Month(), utc.Day(), utc.Hour(), 0, 0, 0, time.UTC)
	}
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func dashboardBucketSequence(rangeValue TimeRange, now time.Time) []time.Time {
	step := rangeValue.BucketDuration()
	end := rangeValue.Until(now.UTC())
	if step == time.Hour {
		end = time.Date(end.Year(), end.Month(), end.Day(), end.Hour(), 0, 0, 0, time.UTC)
	} else {
		end = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC)
	}

	count := maxIntFromDuration(rangeValue.Duration(), step)
	start := end.Add(-time.Duration(count-1) * step)
	sequence := make([]time.Time, 0, count)
	for index := 0; index < count; index += 1 {
		sequence = append(sequence, start.Add(time.Duration(index)*step))
	}
	return sequence
}

func dashboardReferrerQuality(engagedSessions, bounceSessions, totalSessions int) float64 {
	if totalSessions <= 0 {
		return 0
	}
	engagedRate := percentage(engagedSessions, totalSessions)
	bounceRate := percentage(bounceSessions, totalSessions)
	return round1(math.Max(0, math.Min(100, engagedRate*0.7+(100-bounceRate)*0.3)))
}

func dashboardFrictionScore(rageSessions, deadSessions, shortSessions, totalSessions int) float64 {
	rageRate := percentage(rageSessions, totalSessions)
	deadRate := percentage(deadSessions, totalSessions)
	shortRate := percentage(shortSessions, totalSessions)
	return round1(math.Max(0, math.Min(100, rageRate*0.45+deadRate*0.3+shortRate*0.25)))
}

func dashboardFocusScore(avgPageTimeSeconds, avgScrollDepth float64) float64 {
	timeComponent := 0.0
	if avgPageTimeSeconds > 0 {
		timeComponent = math.Min(avgPageTimeSeconds, 120) / 120 * 45
	}
	return round1(math.Max(0, math.Min(100, avgScrollDepth*0.55+timeComponent)))
}

func dashboardShortSession(session *sessionAggregate) bool {
	if session.Pageviews <= 0 {
		return false
	}
	if session.Pageviews == 1 && session.MeaningfulEvents == 0 {
		return true
	}
	return session.EstimatedDurationSeconds > 0 && session.EstimatedDurationSeconds < 10
}

func buildMapView(events []dashboardEvent, rangeValue TimeRange, now time.Time) MapView {
	currentStart, currentEnd := rangeBounds(rangeValue, now.UTC())
	previousRange := comparisonTimeRange(rangeValue, now.UTC())
	previousStart, previousEnd := rangeBounds(previousRange, now.UTC())
	currentEvents := make([]dashboardEvent, 0, len(events))
	previousEvents := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		switch {
		case eventInRange(event, currentStart, currentEnd):
			currentEvents = append(currentEvents, event)
		case eventInRange(event, previousStart, previousEnd):
			previousEvents = append(previousEvents, event)
		}
	}

	countries := map[string]*mapCountryAggregate{}
	regions := map[string]*mapRegionAggregate{}
	cities := map[string]*mapCityAggregate{}

	totalVisitors := map[string]struct{}{}
	totalSessions := map[string]struct{}{}
	locatedVisitors := map[string]struct{}{}
	activeVisitors := map[string]struct{}{}
	activeByCountry := map[string]map[string]struct{}{}
	totalPageviews := 0
	previousCountryVisitors := countryVisitorCounts(previousEvents)
	realtimeCutoff := now.Add(-5 * time.Minute)

	for _, event := range currentEvents {
		if event.Name != "pageview" {
			continue
		}

		visitorKey := event.visitorKey()
		sessionKey := event.sessionKey()
		totalVisitors[visitorKey] = struct{}{}
		totalSessions[sessionKey] = struct{}{}
		totalPageviews += 1

		location := event.geoLocation()
		if location.CountryCode == "" {
			continue
		}

		locatedVisitors[visitorKey] = struct{}{}
		if event.Timestamp.After(realtimeCutoff) {
			countryActive := activeByCountry[location.CountryCode]
			if countryActive == nil {
				countryActive = map[string]struct{}{}
				activeByCountry[location.CountryCode] = countryActive
			}
			countryActive[visitorKey] = struct{}{}
			activeVisitors[visitorKey] = struct{}{}
		}

		country := countries[location.CountryCode]
		if country == nil {
			country = &mapCountryAggregate{
				CountryCode: location.CountryCode,
				CountryName: location.countryLabel(),
				Continent:   strings.TrimSpace(location.Continent),
				Visitors:    map[string]struct{}{},
				Sessions:    map[string]struct{}{},
				Precision:   location.precisionLabel(),
			}
			countries[location.CountryCode] = country
		}
		country.Pageviews += 1
		country.Visitors[visitorKey] = struct{}{}
		country.Sessions[sessionKey] = struct{}{}
		country.Precision = finerPrecision(country.Precision, location.precisionLabel())

		if regionLabel := location.regionLabel(); regionLabel != "" {
			regionKey := location.CountryCode + "|" + location.RegionCode + "|" + regionLabel
			region := regions[regionKey]
			if region == nil {
				region = &mapRegionAggregate{
					CountryCode: location.CountryCode,
					CountryName: location.countryLabel(),
					RegionCode:  location.RegionCode,
					RegionName:  regionLabel,
					Visitors:    map[string]struct{}{},
					Sessions:    map[string]struct{}{},
				}
				regions[regionKey] = region
			}
			region.Pageviews += 1
			region.Visitors[visitorKey] = struct{}{}
			region.Sessions[sessionKey] = struct{}{}
		}

		if cityLabel := strings.TrimSpace(location.City); cityLabel != "" {
			cityKey := location.CountryCode + "|" + location.regionLabel() + "|" + cityLabel
			city := cities[cityKey]
			if city == nil {
				city = &mapCityAggregate{
					CountryCode:  location.CountryCode,
					CountryName:  location.countryLabel(),
					RegionName:   location.regionLabel(),
					City:         cityLabel,
					Visitors:     map[string]struct{}{},
					Sessions:     map[string]struct{}{},
					GeoPrecision: location.precisionLabel(),
				}
				cities[cityKey] = city
			}
			city.Pageviews += 1
			city.Visitors[visitorKey] = struct{}{}
			city.Sessions[sessionKey] = struct{}{}
		}
	}

	locatedVisitorCount := len(locatedVisitors)
	unknownVisitorCount := maxInt(len(totalVisitors)-locatedVisitorCount, 0)
	countryMetrics := make([]MapCountryMetric, 0, len(countries))
	for _, country := range countries {
		countryMetrics = append(countryMetrics, MapCountryMetric{
			CountryCode:      country.CountryCode,
			CountryName:      country.CountryName,
			Continent:        country.Continent,
			Visitors:         len(country.Visitors),
			Sessions:         len(country.Sessions),
			Pageviews:        country.Pageviews,
			Share:            percentage(len(country.Visitors), locatedVisitorCount),
			Precision:        country.Precision,
			ActiveNow:        len(activeByCountry[country.CountryCode]),
			PreviousVisitors: previousCountryVisitors[country.CountryCode],
			GrowthVsPrevious: relativeGrowth(len(country.Visitors), previousCountryVisitors[country.CountryCode]),
		})
	}
	slices.SortFunc(countryMetrics, func(a, b MapCountryMetric) int {
		switch {
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		default:
			return strings.Compare(a.CountryName, b.CountryName)
		}
	})

	visibleRegionVisitors := map[string]struct{}{}
	regionMetrics := make([]MapRegionMetric, 0, len(regions))
	for _, region := range regions {
		for visitorKey := range region.Visitors {
			visibleRegionVisitors[visitorKey] = struct{}{}
		}
		regionMetrics = append(regionMetrics, MapRegionMetric{
			CountryCode: region.CountryCode,
			CountryName: region.CountryName,
			RegionCode:  region.RegionCode,
			RegionName:  region.RegionName,
			Visitors:    len(region.Visitors),
			Sessions:    len(region.Sessions),
			Pageviews:   region.Pageviews,
			Share:       percentage(len(region.Visitors), len(countries[region.CountryCode].Visitors)),
		})
	}
	slices.SortFunc(regionMetrics, func(a, b MapRegionMetric) int {
		switch {
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		case a.CountryName != b.CountryName:
			return strings.Compare(a.CountryName, b.CountryName)
		default:
			return strings.Compare(a.RegionName, b.RegionName)
		}
	})

	visibleCityVisitors := map[string]struct{}{}
	withheldVisitors := map[string]struct{}{}
	cityMetrics := make([]MapCityMetric, 0, len(cities))
	withheldMetrics := make([]MapWithheldMetric, 0, len(cities))
	for _, city := range cities {
		if len(city.Visitors) < mapPrivacyFloorVisitors {
			for visitorKey := range city.Visitors {
				withheldVisitors[visitorKey] = struct{}{}
			}
			withheldMetrics = append(withheldMetrics, MapWithheldMetric{
				CountryCode: city.CountryCode,
				CountryName: city.CountryName,
				RegionName:  city.RegionName,
				City:        city.City,
				Visitors:    len(city.Visitors),
				Sessions:    len(city.Sessions),
				Share:       percentage(len(city.Visitors), locatedVisitorCount),
			})
			continue
		}
		for visitorKey := range city.Visitors {
			visibleCityVisitors[visitorKey] = struct{}{}
		}
		cityMetrics = append(cityMetrics, MapCityMetric{
			CountryCode:  city.CountryCode,
			CountryName:  city.CountryName,
			RegionName:   city.RegionName,
			City:         city.City,
			Visitors:     len(city.Visitors),
			Sessions:     len(city.Sessions),
			Pageviews:    city.Pageviews,
			GeoPrecision: city.GeoPrecision,
			Share:        percentage(len(city.Visitors), len(countries[city.CountryCode].Visitors)),
		})
	}
	slices.SortFunc(cityMetrics, func(a, b MapCityMetric) int {
		switch {
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		case a.CountryName != b.CountryName:
			return strings.Compare(a.CountryName, b.CountryName)
		default:
			return strings.Compare(a.City, b.City)
		}
	})
	slices.SortFunc(withheldMetrics, func(a, b MapWithheldMetric) int {
		switch {
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		case a.Sessions != b.Sessions:
			return b.Sessions - a.Sessions
		case a.CountryName != b.CountryName:
			return strings.Compare(a.CountryName, b.CountryName)
		default:
			return strings.Compare(a.City, b.City)
		}
	})

	topCountryCode := ""
	topCountryName := ""
	topCountryShare := 0.0
	if len(countryMetrics) > 0 {
		topCountryCode = countryMetrics[0].CountryCode
		topCountryName = countryMetrics[0].CountryName
		topCountryShare = countryMetrics[0].Share
	}
	coverageConfidence := round1(
		percentage(len(locatedVisitors), len(totalVisitors))*0.72 +
			percentage(len(visibleRegionVisitors), maxInt(len(locatedVisitors), 1))*0.18 +
			percentage(len(visibleCityVisitors), maxInt(len(locatedVisitors), 1))*0.10,
	)
	withheldShare := percentage(len(withheldVisitors), locatedVisitorCount)
	activeCountrySignals := make([]MapRealtimeCountrySignal, 0, len(countryMetrics))
	growthSignals := make([]MapGrowthCountrySignal, 0, len(countryMetrics))
	for _, country := range countryMetrics {
		if country.ActiveNow > 0 {
			activeCountrySignals = append(activeCountrySignals, MapRealtimeCountrySignal{
				CountryCode: country.CountryCode,
				CountryName: country.CountryName,
				ActiveNow:   country.ActiveNow,
				Visitors:    country.Visitors,
				Share:       country.Share,
			})
		}
		if country.GrowthVsPrevious > 0 || (country.PreviousVisitors == 0 && country.Visitors > 0) {
			growthSignals = append(growthSignals, MapGrowthCountrySignal{
				CountryCode:      country.CountryCode,
				CountryName:      country.CountryName,
				Visitors:         country.Visitors,
				PreviousVisitors: country.PreviousVisitors,
				GrowthVsPrevious: country.GrowthVsPrevious,
				Share:            country.Share,
			})
		}
	}
	slices.SortFunc(activeCountrySignals, func(a, b MapRealtimeCountrySignal) int {
		switch {
		case a.ActiveNow != b.ActiveNow:
			return b.ActiveNow - a.ActiveNow
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		default:
			return strings.Compare(a.CountryName, b.CountryName)
		}
	})
	slices.SortFunc(growthSignals, func(a, b MapGrowthCountrySignal) int {
		switch {
		case a.GrowthVsPrevious != b.GrowthVsPrevious:
			if a.GrowthVsPrevious > b.GrowthVsPrevious {
				return -1
			}
			return 1
		case a.Visitors != b.Visitors:
			return b.Visitors - a.Visitors
		default:
			return strings.Compare(a.CountryName, b.CountryName)
		}
	})
	limitedRegions := limitSlice(regionMetrics, mapMaxRegions)
	limitedCities := limitSlice(cityMetrics, mapMaxCities)
	limitedWithheld := limitSlice(withheldMetrics, mapMaxCities)

	return MapView{
		Range:           rangeValue.String(),
		ComparisonRange: previousRange.String(),
		Summary: MapSummary{
			UniqueVisitors:     len(totalVisitors),
			Sessions:           len(totalSessions),
			Pageviews:          totalPageviews,
			LocatedVisitors:    locatedVisitorCount,
			UnknownVisitors:    unknownVisitorCount,
			Countries:          len(countryMetrics),
			Regions:            len(regionMetrics),
			Cities:             len(cityMetrics),
			PrivacyFloor:       mapPrivacyFloorVisitors,
			TopCountryCode:     topCountryCode,
			TopCountryName:     topCountryName,
			TopCountryShare:    topCountryShare,
			ActiveNow:          len(activeVisitors),
			CoverageConfidence: coverageConfidence,
			WithheldVisitors:   len(withheldVisitors),
			WithheldShare:      withheldShare,
		},
		Signals: MapSignals{
			GeneratedAt: now.UTC().Format(time.RFC3339),
			Realtime: MapRealtimeSignals{
				WindowMinutes:   5,
				ActiveVisitors:  len(activeVisitors),
				ActiveCountries: limitSlice(activeCountrySignals, mapSignalMaxCountries),
				Trust:           "measured",
				Freshness:       "trailing-5m",
			},
			Growth: MapGrowthSignals{
				ComparisonRange: previousRange.String(),
				Leaders:         limitSlice(growthSignals, mapSignalMaxCountries),
				Trust:           "windowed",
			},
			Confidence: MapConfidenceSignals{
				CoverageConfidence: coverageConfidence,
				LocatedVisitors:    locatedVisitorCount,
				UnknownVisitors:    unknownVisitorCount,
				Trust:              "coarse-geo",
			},
			Privacy: MapPrivacySignals{
				PrivacyFloor:     mapPrivacyFloorVisitors,
				WithheldVisitors: len(withheldVisitors),
				WithheldShare:    withheldShare,
				GeoPrecision:     "coarse",
			},
			Payload: MapPayloadSignals{
				CountryRows:  len(countryMetrics),
				RegionRows:   len(limitedRegions),
				CityRows:     len(limitedCities),
				WithheldRows: len(limitedWithheld),
			},
		},
		Countries: countryMetrics,
		Regions:   limitedRegions,
		Cities:    limitedCities,
		Withheld:  limitedWithheld,
	}
}

func buildHeatmapView(
	events []dashboardEvent,
	requestedPath string,
	rangeValue TimeRange,
	mode HeatmapMode,
	clickFilter HeatmapClickFilter,
	viewportSegment HeatmapViewportSegment,
	now time.Time,
) HeatmapView {
	activeMode := ParseHeatmapMode(string(mode))
	activeClickFilter := ParseHeatmapClickFilter(string(clickFilter))
	activeViewportSegment := ParseHeatmapViewportSegment(string(viewportSegment))
	if activeMode == HeatmapModeRage {
		activeClickFilter = HeatmapClickFilterRage
	}

	heatmapEvents := make([]dashboardEvent, 0, len(events))
	for _, event := range events {
		if event.matchesViewportSegment(activeViewportSegment) {
			heatmapEvents = append(heatmapEvents, event)
		}
	}

	state := scanEvents(heatmapEvents, rangeValue, now)
	pageOptions := make([]PageOption, 0, len(state.Pages))
	for _, page := range state.Pages {
		pageOptions = append(pageOptions, PageOption{
			Path:      page.Path,
			Pageviews: page.Pageviews,
		})
	}
	slices.SortFunc(pageOptions, func(a, b PageOption) int {
		switch {
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	path := normalizePath(requestedPath)
	if path == "/" && strings.TrimSpace(requestedPath) == "" && len(pageOptions) > 0 {
		path = pageOptions[0].Path
	}
	if _, ok := state.Pages[path]; !ok && len(pageOptions) > 0 {
		path = pageOptions[0].Path
	}

	type bucketAggregate struct {
		X          float64
		Y          float64
		Count      int
		HoverMS    int
		RageCount  int
		DeadCount  int
		ErrorCount int
		Sessions   map[string]struct{}
		Visitors   map[string]struct{}
	}

	type selectorAggregate struct {
		SelectorStat
		CoordTotalX float64
		CoordTotalY float64
		CoordCount  int
	}

	type heatmapSessionWindow struct {
		Events      int
		HasPageview bool
		First       time.Time
		Last        time.Time
	}

	clickBuckets := map[string]*bucketAggregate{}
	moveBuckets := map[string]*bucketAggregate{}
	selectors := map[string]*selectorAggregate{}
	scrollFunnelSets := map[int]map[string]struct{}{}
	for _, depth := range dashboardDepths {
		scrollFunnelSets[depth] = map[string]struct{}{}
	}

	totalClicks := 0
	totalRageClicks := 0
	totalDeadClicks := 0
	totalErrorClicks := 0
	totalMoveEvents := 0
	totalHoverEvents := 0
	totalHoverMS := 0
	scrollEvents := 0
	totalMouseClicks := 0
	totalTouchClicks := 0
	totalPenClicks := 0
	totalKeyboardClicks := 0
	normalizedExcluded := 0
	blockedZoneEvents := 0
	blockedZoneClicks := 0
	blockedZoneHovers := 0
	viewportWidthTotal := 0
	viewportHeightTotal := 0
	viewportSamples := 0
	documentWidthTotal := 0
	documentHeightTotal := 0
	documentSamples := 0

	cohortScores := map[string]int{}
	for _, event := range heatmapEvents {
		if event.Path != path {
			continue
		}
		score := 1
		if event.Name == "click" || event.Name == "move" {
			score = 2
		}
		cohortScores[event.cohortKey()] += score
	}

	dominantCohort := ""
	dominantScore := 0
	for key, score := range cohortScores {
		if score > dominantScore || (score == dominantScore && (dominantCohort == "" || strings.Compare(key, dominantCohort) < 0)) {
			dominantScore = score
			dominantCohort = key
		}
	}
	if dominantCohort == "" {
		dominantCohort = "unknown|default"
	}

	sessionWindows := map[string]*heatmapSessionWindow{}
	for _, event := range heatmapEvents {
		if event.Path != path || event.cohortKey() != dominantCohort {
			continue
		}
		sessionID := event.sessionKey()
		if sessionID == "" {
			continue
		}
		window := sessionWindows[sessionID]
		if window == nil {
			window = &heatmapSessionWindow{}
			sessionWindows[sessionID] = window
		}
		window.Events += 1
		if event.Name == "pageview" {
			window.HasPageview = true
		}
		if window.First.IsZero() || event.Timestamp.Before(window.First) {
			window.First = event.Timestamp
		}
		if window.Last.IsZero() || event.Timestamp.After(window.Last) {
			window.Last = event.Timestamp
		}
	}

	eligibleSessions := map[string]struct{}{}
	for sessionID, window := range sessionWindows {
		duration := window.Last.Sub(window.First)
		if window.Events >= 2 || window.HasPageview || duration >= 2*time.Second {
			eligibleSessions[sessionID] = struct{}{}
		}
	}

	uniqueSessions := map[string]struct{}{}
	uniqueVisitors := map[string]struct{}{}

	for _, event := range heatmapEvents {
		if event.Path != path {
			continue
		}
		if event.cohortKey() != dominantCohort {
			// Keep active click metrics visible even when cohorts diverge (for example
			// when users cross layout variants), while still normalizing passive signals.
			if event.Name != "click" {
				normalizedExcluded += 1
				continue
			}
		}

		sessionID := event.sessionKey()
		if _, ok := eligibleSessions[sessionID]; !ok && (event.Name == "move" || event.Name == "hover" || event.Name == "scroll") {
			normalizedExcluded += 1
			continue
		}

		if width := event.viewportWidth(); width > 0 {
			height := event.viewportHeight()
			if height > 0 {
				viewportWidthTotal += width
				viewportHeightTotal += height
				viewportSamples += 1
			}
		}
		if width := event.documentWidth(); width > 0 {
			height := event.documentHeight()
			if height > 0 {
				documentWidthTotal += width
				documentHeightTotal += height
				documentSamples += 1
			}
		}

		switch event.Name {
		case "click":
			if event.X == nil || event.Y == nil {
				continue
			}
			totalClicks += 1
			if event.blockedZone() {
				blockedZoneEvents += 1
				blockedZoneClicks += 1
			}
			xValue, yValue := clampCoord(event.X), clampCoord(event.Y)
			key := bucketKey(xValue, yValue)
			current := clickBuckets[key]
			if current == nil {
				current = &bucketAggregate{
					X:        xValue,
					Y:        yValue,
					Sessions: map[string]struct{}{},
					Visitors: map[string]struct{}{},
				}
				clickBuckets[key] = current
			}
			current.Count += 1
			current.Sessions[event.sessionKey()] = struct{}{}
			current.Visitors[event.visitorKey()] = struct{}{}
			uniqueSessions[event.sessionKey()] = struct{}{}
			uniqueVisitors[event.visitorKey()] = struct{}{}
			if event.rage() {
				current.RageCount += 1
				totalRageClicks += 1
			}
			if event.dead() {
				current.DeadCount += 1
				totalDeadClicks += 1
			}
			if event.errorClick() {
				current.ErrorCount += 1
				totalErrorClicks += 1
			}
			switch event.pointerType() {
			case "touch":
				totalTouchClicks += 1
			case "pen":
				totalPenClicks += 1
			case "keyboard":
				totalKeyboardClicks += 1
			default:
				totalMouseClicks += 1
			}

			label := event.Selector
			if event.blockedZone() {
				label = "Blocked zone"
			} else if label == "" {
				label = "Coordinate-only"
			}
			selectorStat := selectors[label]
			if selectorStat == nil {
				selectorStat = &selectorAggregate{
					SelectorStat: SelectorStat{
						Selector:    label,
						BlockedZone: event.blockedZone(),
					},
				}
				selectors[label] = selectorStat
			}
			selectorStat.Clicks += 1
			selectorStat.CoordTotalX += xValue
			selectorStat.CoordTotalY += yValue
			selectorStat.CoordCount += 1
			selectorStat.BlockedZone = selectorStat.BlockedZone || event.blockedZone()
			if event.rage() {
				selectorStat.RageClicks += 1
			}
			if event.dead() {
				selectorStat.DeadClicks += 1
			}
			if event.errorClick() {
				selectorStat.ErrorClicks += 1
			}
		case "move":
			if event.X == nil || event.Y == nil {
				continue
			}
			totalMoveEvents += 1
			xValue, yValue := clampCoord(event.X), clampCoord(event.Y)
			key := bucketKey(xValue, yValue)
			current := moveBuckets[key]
			if current == nil {
				current = &bucketAggregate{
					X:        xValue,
					Y:        yValue,
					Sessions: map[string]struct{}{},
					Visitors: map[string]struct{}{},
				}
				moveBuckets[key] = current
			}
			current.Count += 1
			current.Sessions[event.sessionKey()] = struct{}{}
			current.Visitors[event.visitorKey()] = struct{}{}
			uniqueSessions[event.sessionKey()] = struct{}{}
			uniqueVisitors[event.visitorKey()] = struct{}{}
		case "hover":
			duration := maxInt(0, event.hoverDurationMS())
			if duration <= 0 {
				continue
			}

			totalHoverEvents += 1
			totalHoverMS += duration
			if event.blockedZone() {
				blockedZoneEvents += 1
				blockedZoneHovers += 1
			}
			uniqueSessions[event.sessionKey()] = struct{}{}
			uniqueVisitors[event.visitorKey()] = struct{}{}

			label := event.Selector
			if event.blockedZone() {
				label = "Blocked zone"
			} else if label == "" {
				label = "Coordinate-only"
			}
			selectorStat := selectors[label]
			if selectorStat == nil {
				selectorStat = &selectorAggregate{
					SelectorStat: SelectorStat{
						Selector:    label,
						BlockedZone: event.blockedZone(),
					},
				}
				selectors[label] = selectorStat
			}
			selectorStat.HoverEvents += 1
			selectorStat.HoverMS += duration
			selectorStat.BlockedZone = selectorStat.BlockedZone || event.blockedZone()

			if event.X == nil || event.Y == nil {
				continue
			}
			xValue, yValue := clampCoord(event.X), clampCoord(event.Y)
			selectorStat.CoordTotalX += xValue
			selectorStat.CoordTotalY += yValue
			selectorStat.CoordCount += 1
			key := bucketKey(xValue, yValue)
			current := clickBuckets[key]
			if current == nil {
				current = &bucketAggregate{
					X:        xValue,
					Y:        yValue,
					Sessions: map[string]struct{}{},
					Visitors: map[string]struct{}{},
				}
				clickBuckets[key] = current
			}
			current.HoverMS += duration
			current.Sessions[event.sessionKey()] = struct{}{}
			current.Visitors[event.visitorKey()] = struct{}{}
		case "scroll":
			scrollEvents += 1
			if !event.HasDepth {
				continue
			}
			uniqueSessions[event.sessionKey()] = struct{}{}
			uniqueVisitors[event.visitorKey()] = struct{}{}
			for _, depth := range dashboardDepths {
				if event.Depth >= depth {
					scrollFunnelSets[depth][event.sessionKey()] = struct{}{}
				}
			}
		}
	}

	heatmapBuckets := make([]HeatmapBucket, 0, len(clickBuckets))
	clickSessionWeights := make([]int, 0, len(clickBuckets))
	clickHoverSignals := make([]int, 0, len(clickBuckets))
	for _, bucket := range clickBuckets {
		sessionCount := len(bucket.Sessions)
		visitorCount := len(bucket.Visitors)
		clickSessionWeights = append(clickSessionWeights, sessionCount)
		clickHoverSignals = append(clickHoverSignals, bucket.HoverMS)
		heatmapBuckets = append(heatmapBuckets, HeatmapBucket{
			X:          bucket.X,
			Y:          bucket.Y,
			Count:      bucket.Count,
			Sessions:   sessionCount,
			Visitors:   visitorCount,
			RageCount:  bucket.RageCount,
			DeadCount:  bucket.DeadCount,
			ErrorCount: bucket.ErrorCount,
		})
	}
	clickWeightCap := quantileInt(clickSessionWeights, heatmapOutlierQuantile)
	hoverSignalCap := quantileInt(clickHoverSignals, heatmapOutlierQuantile)
	for index := range heatmapBuckets {
		weightBase := minInt(heatmapBuckets[index].Sessions, clickWeightCap)
		if weightBase <= 0 {
			weightBase = minInt(heatmapBuckets[index].Count, clickWeightCap)
		}
		rageBoost := math.Min(1.5, float64(heatmapBuckets[index].RageCount)*0.25)
		hoverBoost := 0.0
		if index < len(clickHoverSignals) && clickHoverSignals[index] > 0 {
			hoverBoost = math.Min(1.8, (float64(clickHoverSignals[index])/float64(maxInt(hoverSignalCap, 1)))*1.8)
		}
		heatmapBuckets[index].Weight = round2(float64(weightBase) + rageBoost + hoverBoost)
	}
	heatmapBuckets = applyClickFilterToHeatmapBuckets(heatmapBuckets, activeClickFilter)

	moveHeatmapBuckets := make([]HeatmapBucket, 0, len(moveBuckets))
	moveSessionWeights := make([]int, 0, len(moveBuckets))
	for _, bucket := range moveBuckets {
		sessionCount := len(bucket.Sessions)
		visitorCount := len(bucket.Visitors)
		moveSessionWeights = append(moveSessionWeights, sessionCount)
		moveHeatmapBuckets = append(moveHeatmapBuckets, HeatmapBucket{
			X:        bucket.X,
			Y:        bucket.Y,
			Count:    bucket.Count,
			Sessions: sessionCount,
			Visitors: visitorCount,
		})
	}
	moveWeightCap := quantileInt(moveSessionWeights, heatmapOutlierQuantile)
	for index := range moveHeatmapBuckets {
		weightBase := minInt(moveHeatmapBuckets[index].Sessions, moveWeightCap)
		if weightBase <= 0 {
			weightBase = minInt(moveHeatmapBuckets[index].Count, moveWeightCap)
		}
		moveHeatmapBuckets[index].Weight = round2(float64(weightBase))
	}
	slices.SortFunc(moveHeatmapBuckets, func(a, b HeatmapBucket) int {
		switch {
		case a.X < b.X:
			return -1
		case a.X > b.X:
			return 1
		case a.Y < b.Y:
			return -1
		case a.Y > b.Y:
			return 1
		default:
			return 0
		}
	})

	selectorStats := make([]SelectorStat, 0, len(selectors))
	for _, item := range selectors {
		next := item.SelectorStat
		next.Clicks = countForClickFilter(item.Clicks, item.RageClicks, item.DeadClicks, item.ErrorClicks, activeClickFilter)
		if item.CoordCount > 0 {
			next.CenterX = round2(item.CoordTotalX / float64(item.CoordCount))
			next.CenterY = round2(item.CoordTotalY / float64(item.CoordCount))
		}
		includeHoverOnly := activeClickFilter == HeatmapClickFilterAll && next.Clicks <= 0 && next.HoverEvents > 0
		if next.Clicks <= 0 && !includeHoverOnly {
			continue
		}
		selectorStats = append(selectorStats, next)
	}
	slices.SortFunc(selectorStats, func(a, b SelectorStat) int {
		switch {
		case a.Clicks != b.Clicks:
			return b.Clicks - a.Clicks
		case a.HoverMS != b.HoverMS:
			return b.HoverMS - a.HoverMS
		case a.RageClicks != b.RageClicks:
			return b.RageClicks - a.RageClicks
		default:
			return strings.Compare(a.Selector, b.Selector)
		}
	})

	scrollFunnel := make([]DepthMetric, 0, len(dashboardDepths))
	for _, depth := range dashboardDepths {
		scrollFunnel = append(scrollFunnel, DepthMetric{
			Depth:    depth,
			Sessions: len(scrollFunnelSets[depth]),
		})
	}

	sampleSize := totalClicks
	minSample := heatmapMinClickSample
	switch activeMode {
	case HeatmapModeMove:
		sampleSize = totalMoveEvents
		minSample = heatmapMinMoveSample
	case HeatmapModeScroll:
		sampleSize = scrollEvents
		minSample = heatmapMinSessionSample
	}
	viewportBucket, layoutVariant := splitCohortKey(dominantCohort)
	confidenceScore := heatmapConfidenceScore(sampleSize, minSample, len(uniqueSessions), heatmapMinSessionSample)
	insightReady := sampleSize >= minSample && len(uniqueSessions) >= heatmapMinSessionSample
	normalizationMode := "cohort-normalized"
	if dominantCohort == "unknown|default" {
		normalizationMode = "global"
	}
	trustLabel := "measured"
	if normalizedExcluded > 0 || blockedZoneEvents > 0 {
		trustLabel = "measured-with-normalization"
	}
	confidenceExplanation := fmt.Sprintf(
		"%d samples across %d sessions. %d normalized events excluded; %d blocked-zone events withheld from overlays.",
		sampleSize,
		len(uniqueSessions),
		normalizedExcluded,
		blockedZoneEvents,
	)

	view := HeatmapView{
		Range:                 rangeValue.String(),
		Mode:                  string(activeMode),
		ClickFilter:           string(activeClickFilter),
		ViewportSegment:       string(activeViewportSegment),
		AvailableModes:        []string{string(HeatmapModeEngagement), string(HeatmapModeClick), string(HeatmapModeRage), string(HeatmapModeMove), string(HeatmapModeScroll)},
		AvailableClickFilters: []string{string(HeatmapClickFilterAll), string(HeatmapClickFilterRage), string(HeatmapClickFilterDead), string(HeatmapClickFilterError)},
		AvailableViewportSegments: []string{
			string(HeatmapViewportSegmentAll),
			string(HeatmapViewportSegmentMobile),
			string(HeatmapViewportSegmentTablet),
			string(HeatmapViewportSegmentDesktop),
		},
		Path:         path,
		Paths:        limitSlice(pageOptions, 12),
		Buckets:      heatmapBuckets,
		MoveBuckets:  moveHeatmapBuckets,
		ScrollFunnel: scrollFunnel,
		Selectors:    limitSlice(selectorStats, 8),
		Totals: HeatmapTotals{
			Clicks:             totalClicks,
			RageClicks:         totalRageClicks,
			DeadClicks:         totalDeadClicks,
			ErrorClicks:        totalErrorClicks,
			MoveEvents:         totalMoveEvents,
			HoverEvents:        totalHoverEvents,
			HoverMS:            totalHoverMS,
			ScrollEvents:       scrollEvents,
			UniqueSessions:     len(uniqueSessions),
			UniqueVisitors:     len(uniqueVisitors),
			MouseClicks:        totalMouseClicks,
			TouchClicks:        totalTouchClicks,
			PenClicks:          totalPenClicks,
			KeyboardClicks:     totalKeyboardClicks,
			NormalizedExcluded: normalizedExcluded,
			BlockedZoneEvents:  blockedZoneEvents,
			BlockedZoneClicks:  blockedZoneClicks,
			BlockedZoneHovers:  blockedZoneHovers,
		},
		Viewport: ViewportHint{
			Width:  averageInt(viewportWidthTotal, viewportSamples),
			Height: averageInt(viewportHeightTotal, viewportSamples),
		},
		Document: ViewportHint{
			Width:  averageInt(documentWidthTotal, documentSamples),
			Height: averageInt(documentHeightTotal, documentSamples),
		},
		Confidence: HeatmapConfidence{
			InsightReady:   insightReady,
			Score:          confidenceScore,
			SampleSize:     sampleSize,
			SessionSample:  len(uniqueSessions),
			MinSample:      minSample,
			ViewportBucket: viewportBucket,
			LayoutVariant:  layoutVariant,
			Trust:          trustLabel,
			Freshness:      fmt.Sprintf("as-of %s UTC", now.UTC().Format("2006-01-02 15:04")),
			Normalization:  normalizationMode,
			Explanation:    confidenceExplanation,
			BlockedZones:   blockedZoneEvents,
		},
	}

	applyHeatmapMode(&view)
	return view
}
func buildInsightsView(events []dashboardEvent, rangeValue TimeRange, now time.Time) InsightsView {
	state := scanEvents(events, rangeValue, now)

	totalSessions := 0
	bounceSessions := 0
	for _, session := range state.Sessions {
		if session.Pageviews == 0 {
			continue
		}
		totalSessions += 1
		if session.Pageviews <= 1 {
			bounceSessions += 1
			if page := state.Pages[session.FirstPath]; page != nil {
				page.Bounces += 1
			}
		}
	}

	items := make([]InsightItem, 0, 12)
	for _, page := range state.Pages {
		sessionCount := len(page.Sessions)
		if sessionCount == 0 {
			continue
		}

		rageRate := percentage(page.RageClicks, page.Clicks)
		if page.Clicks >= 8 && page.RageClicks >= 3 && rageRate >= 15 {
			severity := "warning"
			score := 210 + page.RageClicks
			if rageRate >= 25 || page.RageClicks >= 8 {
				severity = "critical"
				score = 310 + page.RageClicks
			}
			items = append(items, InsightItem{
				Severity:       severity,
				Category:       "rage_click",
				Path:           page.Path,
				Title:          "Users are fighting the interface",
				Finding:        "Rage clicks cluster on this page, which usually points to a broken control or a delayed response.",
				Recommendation: "Inspect the main CTA, add explicit loading feedback, and verify that the click target works on mobile viewports.",
				Evidence:       fmt.Sprintf("%d rage clicks across %d clicks (%.1f%%).", page.RageClicks, page.Clicks, rageRate),
				Score:          score,
			})
		}

		scroll25, scroll75 := page.depthReach(25), page.depthReach(75)
		drop75 := 100 - percentage(scroll75, maxInt(scroll25, 1))
		if scroll25 >= 6 && percentage(scroll75, scroll25) < 45 {
			severity := "warning"
			score := 205 + scroll25
			if percentage(scroll75, scroll25) < 30 {
				severity = "critical"
				score = 305 + scroll25
			}
			items = append(items, InsightItem{
				Severity:       severity,
				Category:       "scroll_dropoff",
				Path:           page.Path,
				Title:          "Visitors abandon the page before the lower content",
				Finding:        "Sessions reach the first scroll milestone, but most never make it to the lower half of the page.",
				Recommendation: "Move the key proof points or CTA higher, break long sections with stronger visual rhythm, and shorten the intro copy.",
				Evidence:       fmt.Sprintf("%d sessions reached 25%% depth, but only %d reached 75%% (drop-off %.1f%%).", scroll25, scroll75, drop75),
				Score:          score,
			})
		}

		bounceRate := percentage(page.Bounces, sessionCount)
		if sessionCount >= 8 && bounceRate >= 65 {
			severity := "warning"
			score := 215 + page.Bounces
			if bounceRate >= 80 {
				severity = "critical"
				score = 315 + page.Bounces
			}
			items = append(items, InsightItem{
				Severity:       severity,
				Category:       "high_bounce",
				Path:           page.Path,
				Title:          "The landing experience is not convincing",
				Finding:        "A large share of sessions leave after a single pageview on this path.",
				Recommendation: "Tighten the above-the-fold promise, align the message with the traffic source, and make the next action visually obvious.",
				Evidence:       fmt.Sprintf("%d of %d sessions bounced (%.1f%% bounce rate).", page.Bounces, sessionCount, bounceRate),
				Score:          score,
			})
		}

		avgScroll := averageScrollDepth(page.ScrollBySession)
		clickRate := percentage(page.Clicks, maxInt(page.Pageviews, 1))
		if page.Pageviews >= 12 && avgScroll >= 55 && clickRate <= 20 {
			items = append(items, InsightItem{
				Severity:       "info",
				Category:       "dead_zone",
				Path:           page.Path,
				Title:          "The page is being read, not acted on",
				Finding:        "Visitors scroll through the content, but interaction density stays low.",
				Recommendation: "Add a stronger action cue, pull important controls closer to the reading path, and test a more prominent CTA treatment.",
				Evidence:       fmt.Sprintf("%d pageviews, %.1f%% average scroll depth, and only %d clicks.", page.Pageviews, avgScroll, page.Clicks),
				Score:          120 + page.Pageviews,
			})
		}

		if lcp, ok := p75(page.PerfValues["perf_lcp"]); ok && lcp >= 2500 {
			severity := "warning"
			score := 225 + int(lcp/1000)
			if lcp >= 4000 {
				severity = "critical"
				score = 325 + int(lcp/1000)
			}
			items = append(items, InsightItem{
				Severity:       severity,
				Category:       "performance",
				Path:           page.Path,
				Title:          "Largest contentful paint is dragging",
				Finding:        "The page loads slowly enough to affect perceived responsiveness and conversion intent.",
				Recommendation: "Reduce hero payload size, lazy-load non-critical media, and prioritize the primary content block above the fold.",
				Evidence:       fmt.Sprintf("75th percentile LCP is %.0fms.", lcp),
				Score:          score,
			})
		}

		if inp, ok := p75(page.PerfValues["perf_inp"]); ok && inp >= 200 {
			severity := "warning"
			score := 220 + int(inp/25)
			if inp >= 300 {
				severity = "critical"
				score = 320 + int(inp/25)
			}
			items = append(items, InsightItem{
				Severity:       severity,
				Category:       "performance",
				Path:           page.Path,
				Title:          "Interactions feel delayed",
				Finding:        "Input delay is high enough that taps and clicks can feel unreliable.",
				Recommendation: "Trim long-running main-thread work, defer non-essential scripts, and make interactive states render immediately.",
				Evidence:       fmt.Sprintf("75th percentile INP is %.0fms.", inp),
				Score:          score,
			})
		}
	}

	if len(items) == 0 && totalSessions > 0 {
		siteBounce := percentage(bounceSessions, totalSessions)
		items = append(items, InsightItem{
			Severity:       "info",
			Category:       "baseline",
			Path:           "All pages",
			Title:          "No dominant problem cluster detected yet",
			Finding:        "The current sample is balanced enough that no single page clearly stands out as broken.",
			Recommendation: "Keep collecting data, then compare by campaign, page template, or device class to surface narrower issues.",
			Evidence:       fmt.Sprintf("%d sessions analysed with a %.1f%% overall bounce rate.", totalSessions, siteBounce),
			Score:          100,
		})
	}

	slices.SortFunc(items, func(a, b InsightItem) int {
		switch {
		case severityRank(a.Severity) != severityRank(b.Severity):
			return severityRank(a.Severity) - severityRank(b.Severity)
		case a.Score != b.Score:
			return b.Score - a.Score
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})
	items = limitSlice(items, 12)

	summary := InsightSummary{Total: len(items)}
	for _, item := range items {
		switch item.Severity {
		case "critical":
			summary.Critical += 1
		case "warning":
			summary.Warning += 1
		default:
			summary.Info += 1
		}
	}

	pageOptions := make([]PageOption, 0, len(state.Pages))
	for _, page := range state.Pages {
		pageOptions = append(pageOptions, PageOption{
			Path:      page.Path,
			Pageviews: page.Pageviews,
		})
	}
	slices.SortFunc(pageOptions, func(a, b PageOption) int {
		switch {
		case a.Pageviews != b.Pageviews:
			return b.Pageviews - a.Pageviews
		default:
			return strings.Compare(a.Path, b.Path)
		}
	})

	return InsightsView{
		Range:   rangeValue.String(),
		Summary: summary,
		Items:   items,
		Pages:   limitSlice(pageOptions, 12),
	}
}

func countForClickFilter(
	totalCount, rageCount, deadCount, errorCount int,
	filter HeatmapClickFilter,
) int {
	switch filter {
	case HeatmapClickFilterRage:
		return rageCount
	case HeatmapClickFilterDead:
		return deadCount
	case HeatmapClickFilterError:
		return errorCount
	default:
		return totalCount
	}
}

func applyClickFilterToHeatmapBuckets(buckets []HeatmapBucket, filter HeatmapClickFilter) []HeatmapBucket {
	filtered := make([]HeatmapBucket, 0, len(buckets))
	for _, bucket := range buckets {
		next := bucket
		baseCount := maxInt(bucket.Count, 1)
		switch filter {
		case HeatmapClickFilterRage:
			next.Count = bucket.RageCount
			next.RageCount = bucket.RageCount
		case HeatmapClickFilterDead:
			next.Count = bucket.DeadCount
			next.RageCount = 0
		case HeatmapClickFilterError:
			next.Count = bucket.ErrorCount
			next.RageCount = 0
		default:
			next.Count = bucket.Count
		}
		weightScale := float64(next.Count) / float64(baseCount)
		if filter == HeatmapClickFilterAll && bucket.Count <= 0 {
			weightScale = 1
		}
		next.Weight = round2(next.Weight * weightScale)
		if filter == HeatmapClickFilterAll && next.Count <= 0 && next.Weight > 0 {
			filtered = append(filtered, next)
			continue
		}
		if next.Count <= 0 {
			continue
		}
		filtered = append(filtered, next)
	}
	sortHeatmapBuckets(filtered)
	return filtered
}

func sortHeatmapBuckets(buckets []HeatmapBucket) {
	slices.SortFunc(buckets, func(a, b HeatmapBucket) int {
		switch {
		case a.X < b.X:
			return -1
		case a.X > b.X:
			return 1
		case a.Y < b.Y:
			return -1
		case a.Y > b.Y:
			return 1
		default:
			return 0
		}
	})
}

func applyHeatmapMode(view *HeatmapView) {
	if view == nil {
		return
	}

	switch ParseHeatmapMode(view.Mode) {
	case HeatmapModeClick, HeatmapModeRage:
		view.MoveBuckets = []HeatmapBucket{}
	case HeatmapModeMove:
		view.Buckets = []HeatmapBucket{}
		view.Selectors = []SelectorStat{}
	case HeatmapModeScroll:
		view.Buckets = []HeatmapBucket{}
		view.MoveBuckets = []HeatmapBucket{}
		view.Selectors = []SelectorStat{}
	}
}

func collectSiteStats(events []dashboardEvent) SiteStats {
	stats := SiteStats{}
	paths := map[string]struct{}{}

	for _, event := range events {
		stats.TotalEvents += 1
		if event.Path != "" {
			paths[event.Path] = struct{}{}
		}

		if stats.FirstSeen == nil || event.Timestamp.Before(*stats.FirstSeen) {
			value := event.Timestamp
			stats.FirstSeen = &value
		}
		if stats.LastSeen == nil || event.Timestamp.After(*stats.LastSeen) {
			value := event.Timestamp
			stats.LastSeen = &value
		}
	}

	stats.TrackedPages = len(paths)
	return stats
}

func scanEvents(events []dashboardEvent, rangeValue TimeRange, now time.Time) analysisState {
	slices.SortFunc(events, func(a, b dashboardEvent) int {
		if a.Timestamp.Equal(b.Timestamp) {
			return strings.Compare(a.Path, b.Path)
		}
		if a.Timestamp.Before(b.Timestamp) {
			return -1
		}
		return 1
	})

	state := analysisState{
		Realtime:   map[string]struct{}{},
		Visitors:   map[string]struct{}{},
		Sessions:   map[string]*sessionAggregate{},
		Pages:      map[string]*pageAggregate{},
		Referrers:  map[string]int{},
		Devices:    map[string]int{},
		Browsers:   map[string]int{},
		OSFamilies: map[string]int{},
		Series:     map[time.Time]*seriesAggregate{},
		Scroll:     map[int]map[string]struct{}{},
	}
	for _, depth := range dashboardDepths {
		state.Scroll[depth] = map[string]struct{}{}
	}

	realtimeCutoff := now.Add(-5 * time.Minute)
	for _, event := range events {
		page := state.page(event.Path)
		visitorID := event.visitorKey()
		sessionID := event.sessionKey()
		session := state.session(sessionID)

		if session.VisitorID == "" {
			session.VisitorID = visitorID
		}
		if session.FirstEvent.IsZero() || event.Timestamp.Before(session.FirstEvent) {
			session.FirstEvent = event.Timestamp
		}
		if session.LastEvent.IsZero() || event.Timestamp.After(session.LastEvent) {
			session.LastEvent = event.Timestamp
		}
		if dashboardMeaningfulEvent(event.Name) {
			session.MeaningfulEvents += 1
		}
		if event.conversionSignal() {
			session.HasConversion = true
			if session.ConversionTime.IsZero() || event.Timestamp.Before(session.ConversionTime) {
				session.ConversionTime = event.Timestamp
			}
		}

		if event.Timestamp.After(realtimeCutoff) {
			state.Realtime[visitorID] = struct{}{}
		}

		switch event.Name {
		case "pageview":
			state.Pageviews += 1
			page.Pageviews += 1
			state.Visitors[visitorID] = struct{}{}
			page.Sessions[sessionID] = struct{}{}
			session.Pageviews += 1
			if session.FirstPageview.IsZero() || event.Timestamp.Before(session.FirstPageview) {
				session.FirstPageview = event.Timestamp
				session.FirstPath = event.Path
				session.Referrer = event.referrerHost()
			}
			session.PageSequence = append(session.PageSequence, sessionPageview{
				Path:      event.Path,
				Timestamp: event.Timestamp,
			})

			state.Referrers[event.referrerHost()] += 1
			state.Devices[event.deviceType()] += 1
			state.Browsers[event.browserFamily()] += 1
			state.OSFamilies[event.osFamily()] += 1

			bucket := dashboardBucket(event.Timestamp, rangeValue)
			series := state.series(bucket)
			series.Pageviews += 1
			series.Sessions[sessionID] = struct{}{}
		case "click":
			page.Clicks += 1
			if event.rage() {
				state.RageClicks += 1
				page.RageClicks += 1
				session.RageClicks += 1
			}
			if event.dead() {
				state.DeadClicks += 1
				page.DeadClicks += 1
				session.DeadClicks += 1
			}
		case "scroll":
			if !event.HasDepth {
				continue
			}
			if event.Depth > session.MaxScrollDepth {
				session.MaxScrollDepth = event.Depth
			}
			if event.Depth > page.ScrollBySession[sessionID] {
				page.ScrollBySession[sessionID] = event.Depth
			}
			for _, depth := range dashboardDepths {
				if event.Depth >= depth {
					state.Scroll[depth][sessionID] = struct{}{}
				}
			}
		default:
			if strings.HasPrefix(event.Name, "perf_") {
				if value, ok := event.metricValue(); ok {
					page.PerfValues[event.Name] = append(page.PerfValues[event.Name], value)
				}
			}
		}
	}

	return state
}

func (s analysisState) page(path string) *pageAggregate {
	key := normalizePath(path)
	current := s.Pages[key]
	if current == nil {
		current = &pageAggregate{
			Path:            key,
			Sessions:        map[string]struct{}{},
			ScrollBySession: map[string]int{},
			PerfValues:      map[string][]float64{},
		}
		s.Pages[key] = current
	}
	return current
}

func (s analysisState) session(id string) *sessionAggregate {
	key := strings.TrimSpace(id)
	current := s.Sessions[key]
	if current == nil {
		current = &sessionAggregate{}
		s.Sessions[key] = current
	}
	return current
}

func (s analysisState) series(bucket time.Time) *seriesAggregate {
	current := s.Series[bucket]
	if current == nil {
		current = &seriesAggregate{Sessions: map[string]struct{}{}}
		s.Series[bucket] = current
	}
	return current
}

func (p *pageAggregate) depthReach(depth int) int {
	count := 0
	for _, maxDepth := range p.ScrollBySession {
		if maxDepth >= depth {
			count += 1
		}
	}
	return count
}

func (e dashboardEvent) visitorKey() string {
	if value := strings.TrimSpace(e.VisitorID); value != "" {
		return value
	}
	if value := strings.TrimSpace(e.SessionID); value != "" {
		return value
	}
	return "unknown-visitor"
}

func (e dashboardEvent) sessionKey() string {
	if value := strings.TrimSpace(e.SessionID); value != "" {
		return value
	}
	return e.visitorKey()
}

func (e dashboardEvent) rage() bool {
	return boolValue(e.Meta["rg"])
}

func (e dashboardEvent) dead() bool {
	return boolValue(e.Meta["dg"])
}

func (e dashboardEvent) errorClick() bool {
	return boolValue(e.Meta["eg"])
}

func (e dashboardEvent) blockedZone() bool {
	return boolValue(e.Meta["bz"])
}

func dashboardMeaningfulEvent(name string) bool {
	value := strings.TrimSpace(strings.ToLower(name))
	switch {
	case value == "", value == "pageview", value == "heartbeat":
		return false
	case strings.HasPrefix(value, "perf_"):
		return false
	default:
		return true
	}
}

func (e dashboardEvent) conversionSignal() bool {
	name := strings.TrimSpace(strings.ToLower(e.Name))
	switch {
	case name == "pageview":
		return dashboardConversionPath(e.Path)
	case name == "", name == "click", name == "scroll", name == "hover", name == "move", name == "heartbeat":
		return false
	case strings.HasPrefix(name, "perf_"):
		return false
	}

	keywords := []string{
		"purchase",
		"checkout_complete",
		"checkout-complete",
		"order_complete",
		"order-complete",
		"payment_success",
		"payment-success",
		"subscription_started",
		"subscription-started",
		"signup",
		"sign_up",
		"sign-up",
		"register",
		"trial_started",
		"trial-started",
		"lead_submitted",
		"lead-submitted",
		"contact_submitted",
		"contact-submitted",
		"demo_booked",
		"demo-booked",
		"converted",
		"conversion",
	}
	for _, keyword := range keywords {
		if strings.Contains(name, keyword) {
			return true
		}
	}
	return false
}

func dashboardConversionPath(path string) bool {
	value := strings.Trim(strings.ToLower(strings.TrimSpace(path)), "/")
	if value == "" {
		return false
	}
	segments := strings.FieldsFunc(value, func(r rune) bool {
		return r == '/' || r == '-' || r == '_'
	})
	if len(segments) == 0 {
		return false
	}
	last := segments[len(segments)-1]
	switch last {
	case "thank", "thanks", "success", "confirmation", "confirmed", "complete", "completed":
		return true
	default:
		return false
	}
}

func (e dashboardEvent) referrerHost() string {
	value := strings.TrimSpace(stringValue(e.Meta["r"]))
	if value == "" {
		return "Direct"
	}

	parsed, err := url.Parse(value)
	if err == nil && parsed.Host != "" {
		host := strings.TrimPrefix(strings.ToLower(parsed.Host), "www.")
		if host != "" {
			return host
		}
	}

	return value
}

func (e dashboardEvent) deviceType() string {
	switch strings.ToLower(firstNonEmptyStringValue(e.Meta, "dt")) {
	case "mobile":
		return "Mobile"
	case "tablet":
		return "Tablet"
	case "desktop":
		return "Desktop"
	}

	width := intValue(e.Meta["vw"])
	if width == 0 {
		width = intValue(e.Meta["sw"])
	}
	switch {
	case width > 0 && width < 768:
		return "Mobile"
	case width >= 768 && width < 1100:
		return "Tablet"
	default:
		return "Desktop"
	}
}

func (e dashboardEvent) browserFamily() string {
	value := strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "br"))
	if value == "" {
		return "Unknown"
	}
	return value
}

func (e dashboardEvent) osFamily() string {
	value := strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "os"))
	if value == "" {
		return "Unknown"
	}
	return value
}

func (e dashboardEvent) viewportWidth() int {
	return intValue(e.Meta["vw"])
}

func (e dashboardEvent) viewportHeight() int {
	return intValue(e.Meta["vh"])
}

func (e dashboardEvent) documentWidth() int {
	return intValue(e.Meta["dw"])
}

func (e dashboardEvent) documentHeight() int {
	return intValue(e.Meta["dh"])
}

func (e dashboardEvent) hoverDurationMS() int {
	return intValue(e.Meta["hd"])
}

func (e dashboardEvent) geoLocation() geoLocationSnapshot {
	location := geoLocationSnapshot{
		CountryCode: strings.ToUpper(strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "gcc", "ct"))),
		CountryName: strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "gct", "ctn")),
		Continent:   strings.TrimSpace(stringValue(e.Meta["gco"])),
		RegionCode:  strings.ToUpper(strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "grc", "rgc"))),
		RegionName:  strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "grn", "rgn")),
		City:        strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "gci", "city")),
		Timezone:    strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "gtz", "tzn")),
		Precision:   strings.ToLower(strings.TrimSpace(firstNonEmptyStringValue(e.Meta, "gp", "gpr"))),
	}

	if location.CountryCode == "" {
		return geoLocationSnapshot{}
	}
	if location.Precision == "" {
		switch {
		case location.City != "":
			location.Precision = "city"
		case location.RegionCode != "" || location.RegionName != "":
			location.Precision = "region"
		default:
			location.Precision = "country"
		}
	}
	return location
}

func (l geoLocationSnapshot) countryLabel() string {
	if strings.TrimSpace(l.CountryName) != "" {
		return strings.TrimSpace(l.CountryName)
	}
	return strings.TrimSpace(l.CountryCode)
}

func (l geoLocationSnapshot) regionLabel() string {
	if strings.TrimSpace(l.RegionName) != "" {
		return strings.TrimSpace(l.RegionName)
	}
	return strings.TrimSpace(l.RegionCode)
}

func (l geoLocationSnapshot) precisionLabel() string {
	switch strings.TrimSpace(strings.ToLower(l.Precision)) {
	case "city":
		return "city"
	case "region":
		return "region"
	default:
		return "country"
	}
}

func finerPrecision(current, next string) string {
	rank := func(value string) int {
		switch strings.TrimSpace(strings.ToLower(value)) {
		case "city":
			return 3
		case "region":
			return 2
		case "country":
			return 1
		default:
			return 0
		}
	}

	if rank(next) > rank(current) {
		return next
	}
	return current
}

func (e dashboardEvent) viewportBucket() string {
	bucket := strings.TrimSpace(strings.ToLower(stringValue(e.Meta["vb"])))
	switch bucket {
	case "xs", "sm", "md", "lg", "xl":
		return bucket
	}

	width := e.viewportWidth()
	if width == 0 {
		width = intValue(e.Meta["sw"])
	}
	switch {
	case width > 0 && width < 480:
		return "xs"
	case width >= 480 && width < 768:
		return "sm"
	case width >= 768 && width < 1024:
		return "md"
	case width >= 1024 && width < 1440:
		return "lg"
	case width >= 1440:
		return "xl"
	default:
		return "unknown"
	}
}

func (e dashboardEvent) layoutVariant() string {
	value := strings.TrimSpace(stringValue(e.Meta["lk"]))
	if value == "" {
		return "default"
	}
	return value
}

func (e dashboardEvent) cohortKey() string {
	return e.viewportBucket() + "|" + e.layoutVariant()
}

func (e dashboardEvent) matchesViewportSegment(segment HeatmapViewportSegment) bool {
	width := e.viewportWidth()
	if width <= 0 {
		return ParseHeatmapViewportSegment(string(segment)) == HeatmapViewportSegmentAll
	}
	switch ParseHeatmapViewportSegment(string(segment)) {
	case HeatmapViewportSegmentMobile:
		return width < 768
	case HeatmapViewportSegmentTablet:
		return width >= 768 && width < 1024
	case HeatmapViewportSegmentDesktop:
		return width >= 1024
	default:
		return true
	}
}

func (e dashboardEvent) pointerType() string {
	value := strings.TrimSpace(strings.ToLower(stringValue(e.Meta["pt"])))
	switch value {
	case "touch", "pen", "keyboard", "mouse":
		return value
	default:
		return "mouse"
	}
}

func (e dashboardEvent) metricValue() (float64, bool) {
	props, ok := mapValue(e.Meta["pr"])
	if !ok {
		return 0, false
	}
	value, ok := floatValue(props["v"])
	return value, ok
}

func buildTimeseries(series map[time.Time]*seriesAggregate, rangeValue TimeRange, now time.Time) []TimeseriesPoint {
	points := make([]TimeseriesPoint, 0)
	for _, bucket := range dashboardBucketSequence(rangeValue, now.UTC()) {
		current := series[bucket]
		point := TimeseriesPoint{Timestamp: bucket.Format(time.RFC3339)}
		if current != nil {
			point.Pageviews = current.Pageviews
			point.Sessions = len(current.Sessions)
		}
		points = append(points, point)
	}
	return points
}

func normalizePath(path string) string {
	value := strings.TrimSpace(path)
	if value == "" {
		return "/"
	}
	return value
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringValue(raw any) string {
	switch value := raw.(type) {
	case string:
		return value
	default:
		return ""
	}
}

func firstNonEmptyStringValue(values map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(stringValue(values[key])); value != "" {
			return value
		}
	}
	return ""
}

func intValue(raw any) int {
	switch value := raw.(type) {
	case float64:
		return int(math.Round(value))
	case float32:
		return int(math.Round(float64(value)))
	case int:
		return value
	case int64:
		return int(value)
	case json.Number:
		parsed, err := value.Int64()
		if err == nil {
			return int(parsed)
		}
	}
	return 0
}

func floatValue(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case json.Number:
		parsed, err := value.Float64()
		if err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func boolValue(raw any) bool {
	switch value := raw.(type) {
	case bool:
		return value
	case string:
		return strings.EqualFold(value, "true")
	default:
		return false
	}
}

func mapValue(raw any) (map[string]any, bool) {
	value, ok := raw.(map[string]any)
	return value, ok
}

func average(total, count int) float64 {
	if count == 0 {
		return 0
	}
	return round1(float64(total) / float64(count))
}

func averageInt(total, count int) int {
	if count == 0 {
		return 0
	}
	return int(math.Round(float64(total) / float64(count)))
}

func averageFloat(total float64, count int) float64 {
	if count == 0 {
		return 0
	}
	return round1(total / float64(count))
}

func averageScrollDepth(values map[string]int) float64 {
	if len(values) == 0 {
		return 0
	}
	total := 0
	for _, depth := range values {
		total += depth
	}
	return average(total, len(values))
}

func percentage(numerator, denominator int) float64 {
	if denominator == 0 {
		return 0
	}
	return round1(float64(numerator) * 100 / float64(denominator))
}

func deltaPercentFloat(current, previous float64) float64 {
	if previous <= 0 {
		if current <= 0 {
			return 0
		}
		return 100
	}
	return round1(((current - previous) / previous) * 100)
}

func round1(value float64) float64 {
	return math.Round(value*10) / 10
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func validGeoCoordinate(lat, lon float64) bool {
	return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && !(lat == 0 && lon == 0)
}

func quantileInt(values []int, quantile float64) int {
	if len(values) == 0 {
		return 1
	}

	clamped := quantile
	if clamped < 0 {
		clamped = 0
	}
	if clamped > 1 {
		clamped = 1
	}

	clone := slices.Clone(values)
	slices.Sort(clone)
	index := int(math.Ceil(clamped*float64(len(clone)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(clone) {
		index = len(clone) - 1
	}
	value := clone[index]
	if value <= 0 {
		return 1
	}
	return value
}

func splitCohortKey(key string) (string, string) {
	parts := strings.SplitN(strings.TrimSpace(key), "|", 2)
	if len(parts) == 0 {
		return "unknown", "default"
	}
	viewport := strings.TrimSpace(parts[0])
	if viewport == "" {
		viewport = "unknown"
	}
	layout := "default"
	if len(parts) > 1 {
		layout = strings.TrimSpace(parts[1])
		if layout == "" {
			layout = "default"
		}
	}
	return viewport, layout
}

func heatmapConfidenceScore(sampleSize, minSample, sessionSample, minSessionSample int) float64 {
	if minSample <= 0 {
		minSample = 1
	}
	if minSessionSample <= 0 {
		minSessionSample = 1
	}
	sampleScore := math.Min(1, float64(sampleSize)/float64(minSample))
	sessionScore := math.Min(1, float64(sessionSample)/float64(minSessionSample))
	return round1((sampleScore*0.7 + sessionScore*0.3) * 100)
}

func severityRank(value string) int {
	switch value {
	case "critical":
		return 0
	case "warning":
		return 1
	default:
		return 2
	}
}

func p75(values []float64) (float64, bool) {
	if len(values) == 0 {
		return 0, false
	}

	clone := slices.Clone(values)
	slices.Sort(clone)
	index := int(math.Ceil(0.75*float64(len(clone)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(clone) {
		index = len(clone) - 1
	}
	return clone[index], true
}

func clampCoord(value *float64) float64 {
	if value == nil {
		return 0
	}
	rounded := math.Round(*value*10) / 10
	if rounded < 0 {
		return 0
	}
	if rounded > 100 {
		return 100
	}
	return rounded
}

func bucketKey(x, y float64) string {
	return fmt.Sprintf("%.2f:%.2f", x, y)
}

func topCountPairs[T any](items map[string]int, build func(string, int) T, limit int) []T {
	type pair struct {
		key   string
		value int
	}

	pairs := make([]pair, 0, len(items))
	for key, value := range items {
		pairs = append(pairs, pair{key: key, value: value})
	}
	slices.SortFunc(pairs, func(a, b pair) int {
		switch {
		case a.value != b.value:
			return b.value - a.value
		default:
			return strings.Compare(a.key, b.key)
		}
	})

	result := make([]T, 0, minInt(limit, len(pairs)))
	for index := 0; index < len(pairs) && index < limit; index += 1 {
		result = append(result, build(pairs[index].key, pairs[index].value))
	}
	return result
}

func limitSlice[T any](items []T, limit int) []T {
	if len(items) <= limit {
		return items
	}
	return items[:limit]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// countryVisitorCounts returns the number of unique visitors per country code
// from the given set of events. Only pageview events are considered.
func countryVisitorCounts(events []dashboardEvent) map[string]int {
	countryVisitors := map[string]map[string]struct{}{}
	for _, event := range events {
		if event.Name != "pageview" {
			continue
		}
		location := event.geoLocation()
		if location.CountryCode == "" {
			continue
		}
		visitors := countryVisitors[location.CountryCode]
		if visitors == nil {
			visitors = map[string]struct{}{}
			countryVisitors[location.CountryCode] = visitors
		}
		visitors[event.visitorKey()] = struct{}{}
	}
	result := make(map[string]int, len(countryVisitors))
	for code, visitors := range countryVisitors {
		result[code] = len(visitors)
	}
	return result
}

// relativeGrowth returns the percentage growth from previous to current.
func relativeGrowth(current, previous int) float64 {
	switch {
	case previous <= 0 && current <= 0:
		return 0
	case previous <= 0:
		return 100
	default:
		return round1(float64(current-previous) * 100 / float64(previous))
	}
}

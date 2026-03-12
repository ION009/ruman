package storage

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type TimeRange struct {
	label  string
	from   time.Time
	to     time.Time
	custom bool
}

var (
	Range24Hours = TimeRange{label: "24h"}
	Range7Days   = TimeRange{label: "7d"}
	Range30Days  = TimeRange{label: "30d"}
	Range90Days  = TimeRange{label: "90d"}
)

func ParseTimeRange(raw string) TimeRange {
	value := strings.TrimSpace(strings.ToLower(raw))
	switch value {
	case "", "7d":
		return Range7Days
	case "24h":
		return Range24Hours
	case "30d":
		return Range30Days
	case "90d":
		return Range90Days
	}

	if strings.HasPrefix(value, "custom:") {
		parts := strings.Split(value, ":")
		if len(parts) == 3 {
			from, fromErr := time.Parse("2006-01-02", parts[1])
			to, toErr := time.Parse("2006-01-02", parts[2])
			if fromErr == nil && toErr == nil {
				from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, time.UTC)
				to = time.Date(to.Year(), to.Month(), to.Day(), 23, 59, 59, int(time.Second-time.Nanosecond), time.UTC)
				if !to.Before(from) && to.Sub(from) <= 90*24*time.Hour {
					return TimeRange{
						label:  fmt.Sprintf("custom:%s:%s", parts[1], parts[2]),
						from:   from,
						to:     to,
						custom: true,
					}
				}
			}
		}
	}
	return Range7Days
}

func NewCustomTimeRange(from, to time.Time) TimeRange {
	from = from.UTC()
	to = to.UTC()
	if to.Before(from) {
		return Range7Days
	}
	if to.Sub(from) > 90*24*time.Hour {
		to = from.Add(90*24*time.Hour - time.Nanosecond)
	}
	return TimeRange{
		label:  fmt.Sprintf("custom:%s:%s", from.Format("2006-01-02"), to.Format("2006-01-02")),
		from:   from,
		to:     to,
		custom: true,
	}
}

func (r TimeRange) Duration() time.Duration {
	if r.custom {
		return r.to.Sub(r.from) + time.Nanosecond
	}

	switch r.label {
	case Range24Hours.label:
		return 24 * time.Hour
	case Range30Days.label:
		return 30 * 24 * time.Hour
	case Range90Days.label:
		return 90 * 24 * time.Hour
	default:
		return 7 * 24 * time.Hour
	}
}

func (r TimeRange) Since(now time.Time) time.Time {
	if r.custom {
		return r.from.UTC()
	}
	return now.Add(-r.Duration())
}

func (r TimeRange) Until(now time.Time) time.Time {
	if r.custom {
		return r.to.UTC()
	}
	return now.UTC()
}

func (r TimeRange) BucketDuration() time.Duration {
	if r.custom {
		if r.Duration() <= 48*time.Hour {
			return time.Hour
		}
		return 24 * time.Hour
	}
	if r == Range24Hours {
		return time.Hour
	}
	return 24 * time.Hour
}

func (r TimeRange) String() string {
	if strings.TrimSpace(r.label) != "" {
		return r.label
	}
	return Range7Days.label
}

type HeatmapMode string

const (
	HeatmapModeEngagement HeatmapMode = "engagement"
	HeatmapModeClick      HeatmapMode = "click"
	HeatmapModeRage       HeatmapMode = "rage"
	HeatmapModeMove       HeatmapMode = "move"
	HeatmapModeScroll     HeatmapMode = "scroll"
)

func ParseHeatmapMode(raw string) HeatmapMode {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(HeatmapModeClick):
		return HeatmapModeClick
	case string(HeatmapModeRage):
		return HeatmapModeRage
	case string(HeatmapModeMove):
		return HeatmapModeMove
	case string(HeatmapModeScroll):
		return HeatmapModeScroll
	default:
		return HeatmapModeEngagement
	}
}

type HeatmapClickFilter string

const (
	HeatmapClickFilterAll   HeatmapClickFilter = "all"
	HeatmapClickFilterRage  HeatmapClickFilter = "rage"
	HeatmapClickFilterDead  HeatmapClickFilter = "dead"
	HeatmapClickFilterError HeatmapClickFilter = "error"
)

func ParseHeatmapClickFilter(raw string) HeatmapClickFilter {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(HeatmapClickFilterRage):
		return HeatmapClickFilterRage
	case string(HeatmapClickFilterDead):
		return HeatmapClickFilterDead
	case string(HeatmapClickFilterError):
		return HeatmapClickFilterError
	default:
		return HeatmapClickFilterAll
	}
}

type HeatmapViewportSegment string

const (
	HeatmapViewportSegmentAll     HeatmapViewportSegment = "all"
	HeatmapViewportSegmentMobile  HeatmapViewportSegment = "mobile"
	HeatmapViewportSegmentTablet  HeatmapViewportSegment = "tablet"
	HeatmapViewportSegmentDesktop HeatmapViewportSegment = "desktop"
)

func ParseHeatmapViewportSegment(raw string) HeatmapViewportSegment {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(HeatmapViewportSegmentMobile):
		return HeatmapViewportSegmentMobile
	case string(HeatmapViewportSegmentTablet):
		return HeatmapViewportSegmentTablet
	case string(HeatmapViewportSegmentDesktop):
		return HeatmapViewportSegmentDesktop
	default:
		return HeatmapViewportSegmentAll
	}
}

type DashboardProvider interface {
	DashboardSummary(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (DashboardSummary, error)
	Map(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (MapView, error)
	Journeys(ctx context.Context, siteID string, query JourneyQuery, rangeValue TimeRange, now time.Time) (JourneysView, error)
	RetentionReport(ctx context.Context, siteID string, query RetentionQuery, rangeValue TimeRange, now time.Time) (RetentionReport, error)
	RetentionTrend(ctx context.Context, siteID string, query RetentionQuery, rangeValue TimeRange, now time.Time) (RetentionTrendView, error)
	FunnelReport(ctx context.Context, siteID string, query FunnelQuery, rangeValue TimeRange, now time.Time) (FunnelReport, error)
	FunnelEntities(
		ctx context.Context,
		siteID string,
		query FunnelQuery,
		stepIndex int,
		status FunnelEntityStatus,
		page int,
		limit int,
		rangeValue TimeRange,
		now time.Time,
	) (FunnelEntityList, error)
	Heatmap(
		ctx context.Context,
		siteID, path string,
		rangeValue TimeRange,
		mode HeatmapMode,
		clickFilter HeatmapClickFilter,
		viewportSegment HeatmapViewportSegment,
		now time.Time,
	) (HeatmapView, error)
	EventNames(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) ([]EventNameMetric, error)
	EventExplorer(ctx context.Context, siteID string, query EventExplorerQuery, rangeValue TimeRange, now time.Time) (EventExplorerView, error)
	Insights(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (InsightsView, error)
	SiteStats(ctx context.Context, siteID string) (SiteStats, error)
}

type ErrorGroupSeverity string

const (
	ErrorGroupSeverityCritical ErrorGroupSeverity = "critical"
	ErrorGroupSeverityWarning  ErrorGroupSeverity = "warning"
	ErrorGroupSeverityInfo     ErrorGroupSeverity = "info"
)

type ErrorTrendDirection string

const (
	ErrorTrendUp   ErrorTrendDirection = "up"
	ErrorTrendDown ErrorTrendDirection = "down"
	ErrorTrendFlat ErrorTrendDirection = "flat"
)

type ErrorReplayLink struct {
	SessionID string `json:"sessionId"`
	Path      string `json:"path"`
	UpdatedAt string `json:"updatedAt"`
	Count     int    `json:"count"`
}

type ErrorTrendPoint struct {
	Timestamp string `json:"timestamp"`
	Count     int    `json:"count"`
}

type ErrorGroup struct {
	Key              string            `json:"key"`
	Kind             string            `json:"kind"`
	Title            string            `json:"title"`
	Signature        string            `json:"signature"`
	Severity         string            `json:"severity"`
	CurrentCount     int               `json:"currentCount"`
	PreviousCount    int               `json:"previousCount"`
	Delta            int               `json:"delta"`
	Direction        string            `json:"direction"`
	AffectedSessions int               `json:"affectedSessions"`
	AffectedPaths    int               `json:"affectedPaths"`
	LatestAt         string            `json:"latestAt"`
	ReplayLinks      []ErrorReplayLink `json:"replayLinks"`
	Trend            []ErrorTrendPoint `json:"trend"`
}

type ErrorBoardSummary struct {
	Groups             int `json:"groups"`
	CriticalGroups     int `json:"criticalGroups"`
	WarningGroups      int `json:"warningGroups"`
	InfoGroups         int `json:"infoGroups"`
	ReplayLinkedGroups int `json:"replayLinkedGroups"`
	TotalOccurrences   int `json:"totalOccurrences"`
}

type ErrorBoardView struct {
	Range   string            `json:"range"`
	Summary ErrorBoardSummary `json:"summary"`
	Groups  []ErrorGroup      `json:"groups"`
}

type ErrorProvider interface {
	ErrorBoard(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (ErrorBoardView, error)
}

type FunnelCountMode string

const (
	FunnelCountModeSessions FunnelCountMode = "sessions"
	FunnelCountModeVisitors FunnelCountMode = "visitors"
)

func ParseFunnelCountMode(raw string) FunnelCountMode {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", string(FunnelCountModeVisitors):
		return FunnelCountModeVisitors
	case string(FunnelCountModeSessions):
		return FunnelCountModeSessions
	default:
		return ""
	}
}

type FunnelStepKind string

const (
	FunnelStepKindPage  FunnelStepKind = "page"
	FunnelStepKindEvent FunnelStepKind = "event"
)

func ParseFunnelStepKind(raw string) FunnelStepKind {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(FunnelStepKindPage):
		return FunnelStepKindPage
	case string(FunnelStepKindEvent):
		return FunnelStepKindEvent
	default:
		return ""
	}
}

type FunnelStepMatchType string

const (
	FunnelStepMatchExact  FunnelStepMatchType = "exact"
	FunnelStepMatchPrefix FunnelStepMatchType = "prefix"
)

func ParseFunnelStepMatchType(raw string) FunnelStepMatchType {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case "", string(FunnelStepMatchExact):
		return FunnelStepMatchExact
	case string(FunnelStepMatchPrefix):
		return FunnelStepMatchPrefix
	default:
		return ""
	}
}

type FunnelStepDefinition struct {
	Label     string `json:"label"`
	Kind      string `json:"kind"`
	MatchType string `json:"matchType"`
	Value     string `json:"value"`
}

type FunnelQuery struct {
	CountMode     string                 `json:"countMode"`
	WindowMinutes int                    `json:"windowMinutes"`
	Steps         []FunnelStepDefinition `json:"steps"`
}

type FunnelStepReport struct {
	Index                  int     `json:"index"`
	Label                  string  `json:"label"`
	Kind                   string  `json:"kind"`
	MatchType              string  `json:"matchType"`
	Value                  string  `json:"value"`
	Entrants               int     `json:"entrants"`
	Count                  int     `json:"count"`
	ConversionRate         float64 `json:"conversionRate"`
	StepConversionRate     float64 `json:"stepConversionRate"`
	DropOffCount           int     `json:"dropOffCount"`
	DropOffRate            float64 `json:"dropOffRate"`
	AvgSecondsFromPrevious int     `json:"avgSecondsFromPrevious"`
	AvgSecondsFromStart    int     `json:"avgSecondsFromStart"`
}

type FunnelStepInspection struct {
	StepIndex int     `json:"stepIndex"`
	Label     string  `json:"label"`
	Entrants  int     `json:"entrants"`
	Reached   int     `json:"reached"`
	Dropped   int     `json:"dropped"`
	ReachRate float64 `json:"reachRate"`
	DropRate  float64 `json:"dropRate"`
}

type FunnelStepTiming struct {
	StepIndex                 int    `json:"stepIndex"`
	Label                     string `json:"label"`
	SampleCount               int    `json:"sampleCount"`
	AvgSecondsFromPrevious    int    `json:"avgSecondsFromPrevious"`
	MedianSecondsFromPrevious int    `json:"medianSecondsFromPrevious"`
	P90SecondsFromPrevious    int    `json:"p90SecondsFromPrevious"`
	MinSecondsFromPrevious    int    `json:"minSecondsFromPrevious"`
	MaxSecondsFromPrevious    int    `json:"maxSecondsFromPrevious"`
	AvgSecondsFromStart       int    `json:"avgSecondsFromStart"`
	MedianSecondsFromStart    int    `json:"medianSecondsFromStart"`
	P90SecondsFromStart       int    `json:"p90SecondsFromStart"`
	MinSecondsFromStart       int    `json:"minSecondsFromStart"`
	MaxSecondsFromStart       int    `json:"maxSecondsFromStart"`
}

type FunnelTimingSummary struct {
	SampleCount   int `json:"sampleCount"`
	AvgSeconds    int `json:"avgSeconds"`
	MedianSeconds int `json:"medianSeconds"`
	P90Seconds    int `json:"p90Seconds"`
	MinSeconds    int `json:"minSeconds"`
	MaxSeconds    int `json:"maxSeconds"`
}

type FunnelReport struct {
	Range                 string                 `json:"range"`
	CountMode             string                 `json:"countMode"`
	WindowMinutes         int                    `json:"windowMinutes"`
	Entrants              int                    `json:"entrants"`
	Completions           int                    `json:"completions"`
	OverallConversionRate float64                `json:"overallConversionRate"`
	Steps                 []FunnelStepReport     `json:"steps"`
	Inspection            []FunnelStepInspection `json:"inspection"`
	StepTimings           []FunnelStepTiming     `json:"stepTimings"`
	CompletionTime        FunnelTimingSummary    `json:"completionTime"`
}

type FunnelEntityStatus string

const (
	FunnelEntityStatusEntered FunnelEntityStatus = "entered"
	FunnelEntityStatusReached FunnelEntityStatus = "reached"
	FunnelEntityStatusDropped FunnelEntityStatus = "dropped"
)

func ParseFunnelEntityStatus(raw string) FunnelEntityStatus {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(FunnelEntityStatusEntered):
		return FunnelEntityStatusEntered
	case string(FunnelEntityStatusDropped):
		return FunnelEntityStatusDropped
	default:
		return FunnelEntityStatusReached
	}
}

type FunnelEntityMatchedStep struct {
	StepIndex           int    `json:"stepIndex"`
	Label               string `json:"label"`
	Kind                string `json:"kind"`
	MatchType           string `json:"matchType"`
	Value               string `json:"value"`
	Timestamp           string `json:"timestamp"`
	SecondsFromPrevious int    `json:"secondsFromPrevious"`
	SecondsFromStart    int    `json:"secondsFromStart"`
}

type FunnelEntitySummary struct {
	EntityID         string                    `json:"entityId"`
	StartedAt        string                    `json:"startedAt"`
	UpdatedAt        string                    `json:"updatedAt"`
	EntryPath        string                    `json:"entryPath"`
	ExitPath         string                    `json:"exitPath"`
	Pageviews        int                       `json:"pageviews"`
	EventCount       int                       `json:"eventCount"`
	SessionCount     int                       `json:"sessionCount"`
	DeviceType       string                    `json:"deviceType"`
	Browser          string                    `json:"browser"`
	OS               string                    `json:"os"`
	Paths            []string                  `json:"paths"`
	MatchedStepCount int                       `json:"matchedStepCount"`
	Completed        bool                      `json:"completed"`
	DropOffStepIndex int                       `json:"dropOffStepIndex"`
	DropOffStepLabel string                    `json:"dropOffStepLabel"`
	MatchedSteps     []FunnelEntityMatchedStep `json:"matchedSteps"`
}

type FunnelEntityList struct {
	Range      string                `json:"range"`
	CountMode  string                `json:"countMode"`
	StepIndex  int                   `json:"stepIndex"`
	StepLabel  string                `json:"stepLabel"`
	Status     string                `json:"status"`
	Page       int                   `json:"page"`
	Limit      int                   `json:"limit"`
	Total      int                   `json:"total"`
	HasMore    bool                  `json:"hasMore"`
	Inspection FunnelStepInspection  `json:"inspection"`
	Entities   []FunnelEntitySummary `json:"entities"`
}

type JourneyQuery struct {
	DeviceFilter     string   `json:"device,omitempty"`
	CountryFilter    string   `json:"country,omitempty"`
	Limit            int      `json:"limit,omitempty"`
	ReplaySessionIDs []string `json:"-"`
}

type JourneyFilterOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
	Count int    `json:"count"`
}

type JourneyFilterState struct {
	Device    string                `json:"device"`
	Country   string                `json:"country"`
	Devices   []JourneyFilterOption `json:"devices"`
	Countries []JourneyFilterOption `json:"countries"`
}

type JourneySummary struct {
	Sessions             int     `json:"sessions"`
	ReplayBackedSessions int     `json:"replayBackedSessions"`
	ModeledSessions      int     `json:"modeledSessions"`
	UniquePaths          int     `json:"uniquePaths"`
	UniqueTransitions    int     `json:"uniqueTransitions"`
	UniqueCommonPaths    int     `json:"uniqueCommonPaths"`
	AvgPathLength        float64 `json:"avgPathLength"`
	MedianPathLength     int     `json:"medianPathLength"`
	TopPathShare         float64 `json:"topPathShare"`
}

type JourneyNode struct {
	ID                   string  `json:"id"`
	Path                 string  `json:"path"`
	CanonicalPath        string  `json:"canonicalPath"`
	GroupName            string  `json:"groupName"`
	IntentStage          string  `json:"intentStage"`
	StageIndex           int     `json:"stageIndex"`
	Sessions             int     `json:"sessions"`
	Share                float64 `json:"share"`
	EntryCount           int     `json:"entryCount"`
	ExitCount            int     `json:"exitCount"`
	BranchStrength       float64 `json:"branchStrength"`
	ReplayBackedSessions int     `json:"replayBackedSessions"`
	ModeledSessions      int     `json:"modeledSessions"`
	Provenance           string  `json:"provenance"`
}

type JourneyLink struct {
	ID                   string  `json:"id"`
	SourceID             string  `json:"sourceId"`
	TargetID             string  `json:"targetId"`
	SourcePath           string  `json:"sourcePath"`
	TargetPath           string  `json:"targetPath"`
	Sessions             int     `json:"sessions"`
	Share                float64 `json:"share"`
	BranchStrength       float64 `json:"branchStrength"`
	ReplayBackedSessions int     `json:"replayBackedSessions"`
	ModeledSessions      int     `json:"modeledSessions"`
	Provenance           string  `json:"provenance"`
}

type JourneyPath struct {
	ID                   string   `json:"id"`
	Paths                []string `json:"paths"`
	CanonicalPaths       []string `json:"canonicalPaths"`
	Sessions             int      `json:"sessions"`
	Share                float64  `json:"share"`
	ReplayBackedSessions int      `json:"replayBackedSessions"`
	ModeledSessions      int      `json:"modeledSessions"`
	Provenance           string   `json:"provenance"`
}

type JourneyDistributionItem struct {
	Path                 string  `json:"path"`
	CanonicalPath        string  `json:"canonicalPath"`
	GroupName            string  `json:"groupName"`
	Count                int     `json:"count"`
	Share                float64 `json:"share"`
	ReplayBackedSessions int     `json:"replayBackedSessions"`
	ModeledSessions      int     `json:"modeledSessions"`
	Provenance           string  `json:"provenance"`
}

type JourneyPathLengthBucket struct {
	Length int     `json:"length"`
	Count  int     `json:"count"`
	Share  float64 `json:"share"`
}

type JourneysView struct {
	Range                  string                    `json:"range"`
	Filters                JourneyFilterState        `json:"filters"`
	Summary                JourneySummary            `json:"summary"`
	Nodes                  []JourneyNode             `json:"nodes"`
	Links                  []JourneyLink             `json:"links"`
	CommonPaths            []JourneyPath             `json:"commonPaths"`
	EntryDistribution      []JourneyDistributionItem `json:"entryDistribution"`
	ExitDistribution       []JourneyDistributionItem `json:"exitDistribution"`
	PathLengthDistribution []JourneyPathLengthBucket `json:"pathLengthDistribution"`
}

type RetentionCadence string

const (
	RetentionCadenceDaily   RetentionCadence = "daily"
	RetentionCadenceWeekly  RetentionCadence = "weekly"
	RetentionCadenceMonthly RetentionCadence = "monthly"
)

func ParseRetentionCadence(raw string) RetentionCadence {
	switch strings.TrimSpace(strings.ToLower(raw)) {
	case string(RetentionCadenceWeekly):
		return RetentionCadenceWeekly
	case string(RetentionCadenceMonthly):
		return RetentionCadenceMonthly
	default:
		return RetentionCadenceDaily
	}
}

type RetentionQuery struct {
	Cadence       string `json:"cadence,omitempty"`
	DeviceFilter  string `json:"device,omitempty"`
	CountryFilter string `json:"country,omitempty"`
	Limit         int    `json:"limit,omitempty"`
}

type RetentionFilterState struct {
	Cadence   string                `json:"cadence"`
	Device    string                `json:"device"`
	Country   string                `json:"country"`
	Devices   []JourneyFilterOption `json:"devices"`
	Countries []JourneyFilterOption `json:"countries"`
}

type RetentionPoint struct {
	Period        int     `json:"period"`
	Label         string  `json:"label"`
	EligibleUsers int     `json:"eligibleUsers"`
	ReturnedUsers int     `json:"returnedUsers"`
	Rate          float64 `json:"rate"`
	Fresh         bool    `json:"fresh"`
}

type RetentionCohortRow struct {
	CohortDate string           `json:"cohortDate"`
	Label      string           `json:"label"`
	CohortSize int              `json:"cohortSize"`
	Freshness  string           `json:"freshness"`
	Confidence float64          `json:"confidence"`
	Points     []RetentionPoint `json:"points"`
}

type RetentionSummary struct {
	Users          int     `json:"users"`
	Cohorts        int     `json:"cohorts"`
	Day1Rate       float64 `json:"day1Rate"`
	Day7Rate       float64 `json:"day7Rate"`
	Day14Rate      float64 `json:"day14Rate"`
	Day30Rate      float64 `json:"day30Rate"`
	AvgActiveDays  float64 `json:"avgActiveDays"`
	PrivacyFloor   int     `json:"privacyFloor"`
	Confidence     float64 `json:"confidence"`
	ConfidenceText string  `json:"confidenceText"`
}

type RetentionReport struct {
	Range   string               `json:"range"`
	Filters RetentionFilterState `json:"filters"`
	Summary RetentionSummary     `json:"summary"`
	Periods []int                `json:"periods"`
	Cohorts []RetentionCohortRow `json:"cohorts"`
}

type RetentionTrendPoint struct {
	Period        int     `json:"period"`
	Label         string  `json:"label"`
	EligibleUsers int     `json:"eligibleUsers"`
	ReturnedUsers int     `json:"returnedUsers"`
	Rate          float64 `json:"rate"`
	Confidence    float64 `json:"confidence"`
}

type RetentionTrendView struct {
	Range   string                `json:"range"`
	Filters RetentionFilterState  `json:"filters"`
	Summary RetentionSummary      `json:"summary"`
	Curve   []RetentionTrendPoint `json:"curve"`
}

type EventNameMetric struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

type EventExplorerQuery struct {
	Path string `json:"path"`
}

type EventExplorerView struct {
	Range           string               `json:"range"`
	ComparisonRange string               `json:"comparisonRange"`
	SelectedPath    string               `json:"selectedPath"`
	Paths           []EventPathOption    `json:"paths"`
	PrivacyFloor    int                  `json:"privacyFloor"`
	Summary         EventExplorerSummary `json:"summary"`
	Trends          EventExplorerTrends  `json:"trends"`
	Families        []EventFamilySummary `json:"families"`
	Live            EventLiveActivity    `json:"live"`
	Catalog         []EventCatalogEntry  `json:"catalog"`
	LiveFeed        []EventFeedItem      `json:"liveFeed"`
}

type EventExplorerSummary struct {
	AcceptedEvents     int      `json:"acceptedEvents"`
	DeduplicatedEvents int      `json:"deduplicatedEvents"`
	FilteredEvents     int      `json:"filteredEvents"`
	WithheldRows       int      `json:"withheldRows"`
	MaskedProperties   int      `json:"maskedProperties"`
	DuplicateRate      float64  `json:"duplicateRate"`
	PrivacyOptOutRate  *float64 `json:"privacyOptOutRate,omitempty"`
	PrivacyOptOutLabel string   `json:"privacyOptOutLabel"`
	ConfidenceScore    float64  `json:"confidenceScore"`
	FreshnessLabel     string   `json:"freshnessLabel"`
}

type EventExplorerTrends struct {
	Timeline   []EventTrendPoint     `json:"timeline"`
	Comparison EventTrendComparison  `json:"comparison"`
	Highlights []EventTrendHighlight `json:"highlights"`
}

type EventTrendPoint struct {
	Timestamp   string `json:"timestamp"`
	Custom      int    `json:"custom"`
	Navigation  int    `json:"navigation"`
	Behavior    int    `json:"behavior"`
	Performance int    `json:"performance"`
}

type EventTrendComparison struct {
	CustomCurrent       int `json:"customCurrent"`
	CustomPrevious      int `json:"customPrevious"`
	NavigationCurrent   int `json:"navigationCurrent"`
	NavigationPrevious  int `json:"navigationPrevious"`
	BehaviorCurrent     int `json:"behaviorCurrent"`
	BehaviorPrevious    int `json:"behaviorPrevious"`
	PerformanceCurrent  int `json:"performanceCurrent"`
	PerformancePrevious int `json:"performancePrevious"`
}

type EventTrendHighlight struct {
	Label  string  `json:"label"`
	Value  int     `json:"value"`
	Delta  float64 `json:"delta"`
	Up     bool    `json:"up"`
	Family string  `json:"family"`
}

type EventPathOption struct {
	Path           string `json:"path"`
	Events         int    `json:"events"`
	Sessions       int    `json:"sessions"`
	ActiveSessions int    `json:"activeSessions"`
}

type EventFamilySummary struct {
	Family          string  `json:"family"`
	Label           string  `json:"label"`
	Count           int     `json:"count"`
	PreviousCount   int     `json:"previousCount"`
	Trend           float64 `json:"trend"`
	ConfidenceScore float64 `json:"confidenceScore"`
	Trust           string  `json:"trust"`
	Legend          string  `json:"legend"`
}

type EventCatalogEntry struct {
	Name            string               `json:"name"`
	Family          string               `json:"family"`
	Count           int                  `json:"count"`
	PreviousCount   int                  `json:"previousCount"`
	UniqueSessions  int                  `json:"uniqueSessions"`
	UniqueVisitors  int                  `json:"uniqueVisitors"`
	Trend           float64              `json:"trend"`
	LastSeen        string               `json:"lastSeen"`
	Statuses        []string             `json:"statuses"`
	ConfidenceScore float64              `json:"confidenceScore"`
	PrivacyNote     string               `json:"privacyNote"`
	Properties      []EventPropertyFacet `json:"properties"`
	TopPages        []EventBreakdownItem `json:"topPages"`
	TopDevices      []EventBreakdownItem `json:"topDevices"`
	TopCountries    []EventBreakdownItem `json:"topCountries"`
	SampleSessions  []string             `json:"sampleSessions"`
}

type EventPropertyFacet struct {
	Key         string               `json:"key"`
	Cardinality int                  `json:"cardinality"`
	Masked      bool                 `json:"masked"`
	Values      []EventBreakdownItem `json:"values"`
}

type EventBreakdownItem struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type EventFeedItem struct {
	Timestamp       string `json:"timestamp"`
	Name            string `json:"name"`
	Family          string `json:"family"`
	Path            string `json:"path"`
	SessionID       string `json:"sessionId"`
	Device          string `json:"device"`
	Country         string `json:"country"`
	PropertySummary string `json:"propertySummary"`
	PrivacyLabel    string `json:"privacyLabel"`
}

type EventLiveActivity struct {
	GeneratedAt     string                   `json:"generatedAt"`
	WindowMinutes   int                      `json:"windowMinutes"`
	ActiveEvents    int                      `json:"activeEvents"`
	ActiveSessions  int                      `json:"activeSessions"`
	ActiveVisitors  int                      `json:"activeVisitors"`
	Movement        []EventLiveActivityPoint `json:"movement"`
	ActivePages     []EventBreakdownItem     `json:"activePages"`
	ActiveCountries []EventBreakdownItem     `json:"activeCountries"`
	SampleSessions  []string                 `json:"sampleSessions"`
	Trust           string                   `json:"trust"`
	Freshness       string                   `json:"freshness"`
}

type EventLiveActivityPoint struct {
	Timestamp string `json:"timestamp"`
	Events    int    `json:"events"`
	Sessions  int    `json:"sessions"`
	Visitors  int    `json:"visitors"`
}

type DashboardMetricDelta struct {
	Current  float64   `json:"current"`
	Previous float64   `json:"previous"`
	Delta    float64   `json:"delta"`
	Trend    []float64 `json:"trend"`
	Trust    string    `json:"trust"`
}

type DashboardSessionDurationMetric struct {
	Current            float64   `json:"current"`
	Previous           float64   `json:"previous"`
	Delta              float64   `json:"delta"`
	Trend              []float64 `json:"trend"`
	Trust              string    `json:"trust"`
	PageDensity        float64   `json:"pageDensity"`
	AvgPageTimeSeconds float64   `json:"avgPageTimeSeconds"`
}

type DashboardReturningVisitorMetric struct {
	Ratio             DashboardMetricDelta `json:"ratio"`
	ReturningVisitors int                  `json:"returningVisitors"`
	NewVisitors       int                  `json:"newVisitors"`
}

type DashboardOverviewComparison struct {
	UniqueVisitors DashboardMetricDelta `json:"uniqueVisitors"`
	Pageviews      DashboardMetricDelta `json:"pageviews"`
	Sessions       DashboardMetricDelta `json:"sessions"`
	BounceRate     DashboardMetricDelta `json:"bounceRate"`
	AvgScrollDepth DashboardMetricDelta `json:"avgScrollDepth"`
	RageClicks     DashboardMetricDelta `json:"rageClicks"`
}

type PathMomentumMetric struct {
	Path              string  `json:"path"`
	Pageviews         int     `json:"pageviews"`
	PreviousPageviews int     `json:"previousPageviews"`
	DeltaPageviews    int     `json:"deltaPageviews"`
	GrowthVsPrevious  float64 `json:"growthVsPrevious"`
	Trust             string  `json:"trust"`
}

type ConversionAssistMetric struct {
	Path                string  `json:"path"`
	AssistedConversions int     `json:"assistedConversions"`
	ConversionShare     float64 `json:"conversionShare"`
	Trust               string  `json:"trust"`
}

type DashboardDerivedMetrics struct {
	EngagedSessions       DashboardMetricDelta            `json:"engagedSessions"`
	ReturningVisitorRatio DashboardReturningVisitorMetric `json:"returningVisitorRatio"`
	FrictionScore         DashboardMetricDelta            `json:"frictionScore"`
	ReferrerQualityScore  DashboardMetricDelta            `json:"referrerQualityScore"`
	PageFocusScore        DashboardMetricDelta            `json:"pageFocusScore"`
	SessionDuration       DashboardSessionDurationMetric  `json:"sessionDuration"`
	TopPathMomentum       []PathMomentumMetric            `json:"topPathMomentum"`
	ConversionAssist      []ConversionAssistMetric        `json:"conversionAssist"`
}

type DashboardSummary struct {
	Range              string                      `json:"range"`
	ComparisonRange    string                      `json:"comparisonRange"`
	Overview           OverviewMetrics             `json:"overview"`
	OverviewComparison DashboardOverviewComparison `json:"overviewComparison"`
	Derived            DashboardDerivedMetrics     `json:"derived"`
	Timeseries         []TimeseriesPoint           `json:"timeseries"`
	TopPages           []PageMetric                `json:"topPages"`
	Referrers          []ReferrerMetric            `json:"referrers"`
	Devices            []DeviceMetric              `json:"devices"`
	Browsers           []BrowserMetric             `json:"browsers"`
	OperatingSystems   []OperatingSystemMetric     `json:"operatingSystems"`
	ScrollFunnel       []DepthMetric               `json:"scrollFunnel"`
	Pages              []PageOption                `json:"pages"`
}

type MapView struct {
	Range           string              `json:"range"`
	ComparisonRange string              `json:"comparisonRange"`
	Summary         MapSummary          `json:"summary"`
	Signals         MapSignals          `json:"signals"`
	Countries       []MapCountryMetric  `json:"countries"`
	Regions         []MapRegionMetric   `json:"regions"`
	Cities          []MapCityMetric     `json:"cities"`
	Withheld        []MapWithheldMetric `json:"withheld"`
}

type MapSummary struct {
	UniqueVisitors     int     `json:"uniqueVisitors"`
	Sessions           int     `json:"sessions"`
	Pageviews          int     `json:"pageviews"`
	LocatedVisitors    int     `json:"locatedVisitors"`
	UnknownVisitors    int     `json:"unknownVisitors"`
	Countries          int     `json:"countries"`
	Regions            int     `json:"regions"`
	Cities             int     `json:"cities"`
	PrivacyFloor       int     `json:"privacyFloor"`
	TopCountryCode     string  `json:"topCountryCode"`
	TopCountryName     string  `json:"topCountryName"`
	TopCountryShare    float64 `json:"topCountryShare"`
	ActiveNow          int     `json:"activeNow"`
	CoverageConfidence float64 `json:"coverageConfidence"`
	WithheldVisitors   int     `json:"withheldVisitors"`
	WithheldShare      float64 `json:"withheldShare"`
}

type MapSignals struct {
	GeneratedAt string               `json:"generatedAt"`
	Realtime    MapRealtimeSignals   `json:"realtime"`
	Growth      MapGrowthSignals     `json:"growth"`
	Confidence  MapConfidenceSignals `json:"confidence"`
	Privacy     MapPrivacySignals    `json:"privacy"`
	Payload     MapPayloadSignals    `json:"payload"`
}

type MapRealtimeSignals struct {
	WindowMinutes   int                        `json:"windowMinutes"`
	ActiveVisitors  int                        `json:"activeVisitors"`
	ActiveCountries []MapRealtimeCountrySignal `json:"activeCountries"`
	Trust           string                     `json:"trust"`
	Freshness       string                     `json:"freshness"`
}

type MapRealtimeCountrySignal struct {
	CountryCode string  `json:"countryCode"`
	CountryName string  `json:"countryName"`
	ActiveNow   int     `json:"activeNow"`
	Visitors    int     `json:"visitors"`
	Share       float64 `json:"share"`
}

type MapGrowthSignals struct {
	ComparisonRange string                   `json:"comparisonRange"`
	Leaders         []MapGrowthCountrySignal `json:"leaders"`
	Trust           string                   `json:"trust"`
}

type MapGrowthCountrySignal struct {
	CountryCode      string  `json:"countryCode"`
	CountryName      string  `json:"countryName"`
	Visitors         int     `json:"visitors"`
	PreviousVisitors int     `json:"previousVisitors"`
	GrowthVsPrevious float64 `json:"growthVsPrevious"`
	Share            float64 `json:"share"`
}

type MapConfidenceSignals struct {
	CoverageConfidence float64 `json:"coverageConfidence"`
	LocatedVisitors    int     `json:"locatedVisitors"`
	UnknownVisitors    int     `json:"unknownVisitors"`
	Trust              string  `json:"trust"`
}

type MapPrivacySignals struct {
	PrivacyFloor     int     `json:"privacyFloor"`
	WithheldVisitors int     `json:"withheldVisitors"`
	WithheldShare    float64 `json:"withheldShare"`
	GeoPrecision     string  `json:"geoPrecision"`
}

type MapPayloadSignals struct {
	CountryRows  int `json:"countryRows"`
	RegionRows   int `json:"regionRows"`
	CityRows     int `json:"cityRows"`
	WithheldRows int `json:"withheldRows"`
}

type MapCountryMetric struct {
	CountryCode      string  `json:"countryCode"`
	CountryName      string  `json:"countryName"`
	Continent        string  `json:"continent"`
	Visitors         int     `json:"visitors"`
	Sessions         int     `json:"sessions"`
	Pageviews        int     `json:"pageviews"`
	Share            float64 `json:"share"`
	Precision        string  `json:"precision"`
	ActiveNow        int     `json:"activeNow"`
	PreviousVisitors int     `json:"previousVisitors"`
	GrowthVsPrevious float64 `json:"growthVsPrevious"`
}

type MapRegionMetric struct {
	CountryCode string  `json:"countryCode"`
	CountryName string  `json:"countryName"`
	RegionCode  string  `json:"regionCode"`
	RegionName  string  `json:"regionName"`
	Visitors    int     `json:"visitors"`
	Sessions    int     `json:"sessions"`
	Pageviews   int     `json:"pageviews"`
	Share       float64 `json:"share"`
}

type MapCityMetric struct {
	CountryCode  string  `json:"countryCode"`
	CountryName  string  `json:"countryName"`
	RegionName   string  `json:"regionName"`
	City         string  `json:"city"`
	Visitors     int     `json:"visitors"`
	Sessions     int     `json:"sessions"`
	Pageviews    int     `json:"pageviews"`
	GeoPrecision string  `json:"geoPrecision"`
	Share        float64 `json:"share"`
}

type MapWithheldMetric struct {
	CountryCode string  `json:"countryCode"`
	CountryName string  `json:"countryName"`
	RegionName  string  `json:"regionName"`
	City        string  `json:"city"`
	Visitors    int     `json:"visitors"`
	Sessions    int     `json:"sessions"`
	Share       float64 `json:"share"`
}

type OverviewMetrics struct {
	RealtimeVisitors int     `json:"realtimeVisitors"`
	UniqueVisitors   int     `json:"uniqueVisitors"`
	Pageviews        int     `json:"pageviews"`
	Sessions         int     `json:"sessions"`
	BounceRate       float64 `json:"bounceRate"`
	AvgScrollDepth   float64 `json:"avgScrollDepth"`
	RageClicks       int     `json:"rageClicks"`
}

type TimeseriesPoint struct {
	Timestamp string `json:"timestamp"`
	Pageviews int    `json:"pageviews"`
	Sessions  int    `json:"sessions"`
}

type PageMetric struct {
	Path                  string  `json:"path"`
	Pageviews             int     `json:"pageviews"`
	Sessions              int     `json:"sessions"`
	AvgScrollDepth        float64 `json:"avgScrollDepth"`
	RageClicks            int     `json:"rageClicks"`
	DeadClicks            int     `json:"deadClicks"`
	AvgTimeOnPageSeconds  float64 `json:"avgTimeOnPageSeconds"`
	FocusScore            float64 `json:"focusScore"`
	PreviousPageviews     int     `json:"previousPageviews"`
	GrowthVsPrevious      float64 `json:"growthVsPrevious"`
	ConversionAssistScore float64 `json:"conversionAssistScore"`
}

type PageOption struct {
	Path      string `json:"path"`
	Pageviews int    `json:"pageviews"`
}

type ReferrerMetric struct {
	Source          string  `json:"source"`
	Pageviews       int     `json:"pageviews"`
	Sessions        int     `json:"sessions"`
	EngagedSessions int     `json:"engagedSessions"`
	BounceSessions  int     `json:"bounceSessions"`
	BounceRate      float64 `json:"bounceRate"`
	QualityScore    float64 `json:"qualityScore"`
}

type DeviceMetric struct {
	Device    string `json:"device"`
	Pageviews int    `json:"pageviews"`
}

type BrowserMetric struct {
	Browser   string `json:"browser"`
	Pageviews int    `json:"pageviews"`
}

type OperatingSystemMetric struct {
	OS        string `json:"os"`
	Pageviews int    `json:"pageviews"`
}

type DepthMetric struct {
	Depth    int `json:"depth"`
	Sessions int `json:"sessions"`
}

type HeatmapView struct {
	Range                     string            `json:"range"`
	Mode                      string            `json:"mode"`
	ClickFilter               string            `json:"clickFilter"`
	ViewportSegment           string            `json:"viewportSegment"`
	AvailableModes            []string          `json:"availableModes"`
	AvailableClickFilters     []string          `json:"availableClickFilters"`
	AvailableViewportSegments []string          `json:"availableViewportSegments"`
	Path                      string            `json:"path"`
	Paths                     []PageOption      `json:"paths"`
	Buckets                   []HeatmapBucket   `json:"buckets"`
	MoveBuckets               []HeatmapBucket   `json:"moveBuckets"`
	ScrollFunnel              []DepthMetric     `json:"scrollFunnel"`
	Selectors                 []SelectorStat    `json:"selectors"`
	Totals                    HeatmapTotals     `json:"totals"`
	Viewport                  ViewportHint      `json:"viewport"`
	Document                  ViewportHint      `json:"document"`
	Confidence                HeatmapConfidence `json:"confidence"`
}

type HeatmapBucket struct {
	X          float64 `json:"x"`
	Y          float64 `json:"y"`
	Count      int     `json:"count"`
	Weight     float64 `json:"weight"`
	Sessions   int     `json:"sessions"`
	Visitors   int     `json:"visitors"`
	RageCount  int     `json:"rageCount"`
	DeadCount  int     `json:"deadCount"`
	ErrorCount int     `json:"errorCount"`
}

type SelectorStat struct {
	Selector    string  `json:"selector"`
	Clicks      int     `json:"clicks"`
	RageClicks  int     `json:"rageClicks"`
	DeadClicks  int     `json:"deadClicks"`
	ErrorClicks int     `json:"errorClicks"`
	HoverEvents int     `json:"hoverEvents"`
	HoverMS     int     `json:"hoverMs"`
	CenterX     float64 `json:"centerX"`
	CenterY     float64 `json:"centerY"`
	BlockedZone bool    `json:"blockedZone"`
}

type HeatmapTotals struct {
	Clicks             int `json:"clicks"`
	RageClicks         int `json:"rageClicks"`
	DeadClicks         int `json:"deadClicks"`
	ErrorClicks        int `json:"errorClicks"`
	MoveEvents         int `json:"moveEvents"`
	HoverEvents        int `json:"hoverEvents"`
	HoverMS            int `json:"hoverMs"`
	ScrollEvents       int `json:"scrollEvents"`
	UniqueSessions     int `json:"uniqueSessions"`
	UniqueVisitors     int `json:"uniqueVisitors"`
	MouseClicks        int `json:"mouseClicks"`
	TouchClicks        int `json:"touchClicks"`
	PenClicks          int `json:"penClicks"`
	KeyboardClicks     int `json:"keyboardClicks"`
	NormalizedExcluded int `json:"normalizedExcluded"`
	BlockedZoneEvents  int `json:"blockedZoneEvents"`
	BlockedZoneClicks  int `json:"blockedZoneClicks"`
	BlockedZoneHovers  int `json:"blockedZoneHovers"`
}

type ViewportHint struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

type HeatmapConfidence struct {
	InsightReady   bool    `json:"insightReady"`
	Score          float64 `json:"score"`
	SampleSize     int     `json:"sampleSize"`
	SessionSample  int     `json:"sessionSample"`
	MinSample      int     `json:"minSample"`
	ViewportBucket string  `json:"viewportBucket"`
	LayoutVariant  string  `json:"layoutVariant"`
	Trust          string  `json:"trust"`
	Freshness      string  `json:"freshness"`
	Normalization  string  `json:"normalization"`
	Explanation    string  `json:"explanation"`
	BlockedZones   int     `json:"blockedZones"`
}

type InsightsView struct {
	Range   string         `json:"range"`
	Summary InsightSummary `json:"summary"`
	Items   []InsightItem  `json:"items"`
	Pages   []PageOption   `json:"pages"`
}

type InsightSummary struct {
	Total    int `json:"total"`
	Critical int `json:"critical"`
	Warning  int `json:"warning"`
	Info     int `json:"info"`
}

type InsightItem struct {
	Severity       string `json:"severity"`
	Category       string `json:"category"`
	Path           string `json:"path"`
	Title          string `json:"title"`
	Finding        string `json:"finding"`
	Recommendation string `json:"recommendation"`
	Evidence       string `json:"evidence"`
	Score          int    `json:"score"`
}

type SiteStats struct {
	TotalEvents  int        `json:"totalEvents"`
	TrackedPages int        `json:"trackedPages"`
	FirstSeen    *time.Time `json:"firstSeen,omitempty"`
	LastSeen     *time.Time `json:"lastSeen,omitempty"`
}

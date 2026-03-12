package storage

import (
	"context"
	"strings"
	"time"
)

type SegmentDefinition struct {
	ID          string             `json:"id"`
	SiteID      string             `json:"siteId,omitempty"`
	Name        string             `json:"name"`
	Description string             `json:"description,omitempty"`
	Logic       string             `json:"logic"`
	Conditions  []SegmentCondition `json:"conditions"`
	CreatedAt   string             `json:"createdAt,omitempty"`
	UpdatedAt   string             `json:"updatedAt,omitempty"`
}

type SegmentCondition struct {
	ID          string `json:"id,omitempty"`
	Type        string `json:"type"`
	Operator    string `json:"operator"`
	Value       string `json:"value"`
	PropertyKey string `json:"propertyKey,omitempty"`
}

type SegmentPreview struct {
	Range        string            `json:"range"`
	Segment      SegmentDefinition `json:"segment"`
	AudienceSize int               `json:"audienceSize"`
	AvgPageviews float64           `json:"avgPageviews"`
	AvgEvents    float64           `json:"avgEvents"`
	AvgSessions  float64           `json:"avgSessions"`
	Users        []UserRow         `json:"users"`
	Privacy      UserPrivacyNote   `json:"privacy"`
	JumpContext  map[string]string `json:"jumpContext"`
}

type SegmentMembers struct {
	Range       string            `json:"range"`
	Segment     SegmentDefinition `json:"segment"`
	Page        int               `json:"page"`
	Limit       int               `json:"limit"`
	Total       int               `json:"total"`
	Users       []UserRow         `json:"users"`
	Privacy     UserPrivacyNote   `json:"privacy"`
	JumpContext map[string]string `json:"jumpContext"`
}

type CohortMode string

const (
	CohortModeTime     CohortMode = "time"
	CohortModeBehavior CohortMode = "behavior"
)

type CohortAnalysisQuery struct {
	Mode     string             `json:"mode"`
	Cadence  string             `json:"cadence"`
	Segment  *SegmentDefinition `json:"segment,omitempty"`
	Behavior *SegmentCondition  `json:"behavior,omitempty"`
}

type CohortAnalysisReport struct {
	Range   string                `json:"range"`
	Mode    string                `json:"mode"`
	Summary RetentionSummary      `json:"summary"`
	Cohorts []RetentionCohortRow  `json:"cohorts"`
	Curve   []RetentionTrendPoint `json:"curve"`
	Privacy UserPrivacyNote       `json:"privacy"`
}

type SegmentAnalyticsProvider interface {
	PreviewSegment(ctx context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentPreview, error)
	SegmentMembers(ctx context.Context, siteID string, definition SegmentDefinition, query UserListQuery, rangeValue TimeRange, now time.Time) (SegmentMembers, error)
	CohortAnalysis(ctx context.Context, siteID string, query CohortAnalysisQuery, rangeValue TimeRange, now time.Time) (CohortAnalysisReport, error)
}

func NormalizeSegmentDefinition(definition SegmentDefinition) SegmentDefinition {
	definition.Name = strings.TrimSpace(definition.Name)
	definition.Description = strings.TrimSpace(definition.Description)
	switch strings.ToLower(strings.TrimSpace(definition.Logic)) {
	case "or":
		definition.Logic = "or"
	default:
		definition.Logic = "and"
	}
	for index := range definition.Conditions {
		definition.Conditions[index].Type = strings.TrimSpace(strings.ToLower(definition.Conditions[index].Type))
		definition.Conditions[index].Operator = normalizeSegmentOperator(definition.Conditions[index].Operator)
		definition.Conditions[index].Value = strings.TrimSpace(definition.Conditions[index].Value)
		definition.Conditions[index].PropertyKey = strings.TrimSpace(strings.ToLower(definition.Conditions[index].PropertyKey))
	}
	return definition
}

func normalizeSegmentOperator(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "contains":
		return "contains"
	case "starts_with", "prefix":
		return "starts_with"
	default:
		return "equals"
	}
}

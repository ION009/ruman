package storage

import (
	"context"
	"encoding/json"
	"time"
)

type ReplayViewport struct {
	Width  int    `json:"width"`
	Height int    `json:"height"`
	Bucket string `json:"bucket"`
}

type ReplayChunkSummary struct {
	FullSnapshots   int `json:"fullSnapshots"`
	MutationEvents  int `json:"mutationEvents"`
	ConsoleErrors   int `json:"consoleErrors"`
	NetworkFailures int `json:"networkFailures"`
	RageClicks      int `json:"rageClicks"`
	DeadClicks      int `json:"deadClicks"`
	RouteChanges    int `json:"routeChanges"`
	CustomEvents    int `json:"customEvents"`
}

type ReplayChunk struct {
	Index      int                `json:"index"`
	Reason     string             `json:"reason,omitempty"`
	StartedAt  string             `json:"startedAt"`
	EndedAt    string             `json:"endedAt"`
	Path       string             `json:"path"`
	EventCount int                `json:"eventCount"`
	Summary    ReplayChunkSummary `json:"summary"`
	Events     json.RawMessage    `json:"events"`
}

type ReplaySessionSummary struct {
	SessionID           string         `json:"sessionId"`
	StartedAt           string         `json:"startedAt"`
	UpdatedAt           string         `json:"updatedAt"`
	DurationMS          int            `json:"durationMs"`
	EntryPath           string         `json:"entryPath"`
	ExitPath            string         `json:"exitPath"`
	PageCount           int            `json:"pageCount"`
	RouteCount          int            `json:"routeCount"`
	ChunkCount          int            `json:"chunkCount"`
	EventCount          int            `json:"eventCount"`
	ErrorCount          int            `json:"errorCount"`
	ConsoleErrorCount   int            `json:"consoleErrorCount"`
	NetworkFailureCount int            `json:"networkFailureCount"`
	RageClickCount      int            `json:"rageClickCount"`
	DeadClickCount      int            `json:"deadClickCount"`
	CustomEventCount    int            `json:"customEventCount"`
	DeviceType          string         `json:"deviceType"`
	Browser             string         `json:"browser"`
	OS                  string         `json:"os"`
	Viewport            ReplayViewport `json:"viewport"`
	Paths               []string       `json:"paths"`
	SampleRate          float64        `json:"sampleRate"`
}

type ReplaySessionList struct {
	Range    string                 `json:"range"`
	Sessions []ReplaySessionSummary `json:"sessions"`
}

type ReplaySessionDetail struct {
	Session ReplaySessionSummary `json:"session"`
	Chunks  []ReplayChunk        `json:"chunks"`
}

type ReplayWriteSession struct {
	SiteID              string
	SessionID           string
	VisitorID           string
	StartedAt           time.Time
	UpdatedAt           time.Time
	DurationMS          int
	EntryPath           string
	ExitPath            string
	PageCount           int
	RouteCount          int
	ChunkCount          int
	EventCount          int
	ErrorCount          int
	ConsoleErrorCount   int
	NetworkFailureCount int
	RageClickCount      int
	DeadClickCount      int
	CustomEventCount    int
	DeviceType          string
	Browser             string
	OS                  string
	Viewport            ReplayViewport
	Paths               []string
	SampleRate          float64
}

type ReplayWriteChunk struct {
	SiteID     string
	SessionID  string
	VisitorID  string
	Index      int
	Reason     string
	StartedAt  time.Time
	EndedAt    time.Time
	Path       string
	EventCount int
	Summary    ReplayChunkSummary
	EventsJSON string
}

type ReplayWriteBatch struct {
	Session ReplayWriteSession
	Chunks  []ReplayWriteChunk
}

type ReplayProvider interface {
	WriteReplay(ctx context.Context, batch ReplayWriteBatch) error
	ReplaySessions(ctx context.Context, siteID string, rangeValue TimeRange, now time.Time) (ReplaySessionList, error)
	ReplaySession(ctx context.Context, siteID, sessionID string) (ReplaySessionDetail, error)
}

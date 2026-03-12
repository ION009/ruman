package ingest

import (
	"strings"
	"sync"
	"time"
)

const (
	healthDedupeTTL          = 2 * time.Hour
	healthLateEventThreshold = 5 * time.Minute
	healthMaxSeenEventIDs    = 200000
	healthMaxSessionCache    = 100000
	targetLossRatePct        = 1.0
	targetDuplicateRatePct   = 0.2
)

type HealthSnapshot struct {
	ObservedEvents          int64            `json:"observedEvents"`
	AcceptedEvents          int64            `json:"acceptedEvents"`
	DuplicateEvents         int64            `json:"duplicateEvents"`
	EstimatedDroppedEvents  int64            `json:"estimatedDroppedEvents"`
	LateEvents              int64            `json:"lateEvents"`
	TimestampFallbackEvents int64            `json:"timestampFallbackEvents"`
	DuplicateRatePct        float64          `json:"duplicateRatePct"`
	EventLossRatePct        float64          `json:"eventLossRatePct"`
	Targets                 HealthKPITargets `json:"targets"`
}

type HealthKPITargets struct {
	EventLossRatePct     float64 `json:"eventLossRatePct"`
	DuplicateRatePct     float64 `json:"duplicateRatePct"`
	EventLossHealthy     bool    `json:"eventLossHealthy"`
	DuplicateRateHealthy bool    `json:"duplicateRateHealthy"`
}

type HealthDecision struct {
	Duplicate bool
	Late      bool
}

type HealthTracker struct {
	mu sync.Mutex

	seenEventIDs map[string]time.Time
	sessionSeq   map[string]uint64

	observedEvents          int64
	acceptedEvents          int64
	duplicateEvents         int64
	estimatedDroppedEvents  int64
	lateEvents              int64
	timestampFallbackEvents int64

	lastPrune time.Time
}

func NewHealthTracker() *HealthTracker {
	return &HealthTracker{
		seenEventIDs: map[string]time.Time{},
		sessionSeq:   map[string]uint64{},
		lastPrune:    time.Now().UTC(),
	}
}

func (h *HealthTracker) Observe(event Event, receivedAt time.Time) HealthDecision {
	h.mu.Lock()
	defer h.mu.Unlock()

	now := receivedAt.UTC()
	h.observedEvents += 1
	h.pruneLocked(now)

	eventID := strings.TrimSpace(event.ID)
	if eventID != "" {
		expiresAt, exists := h.seenEventIDs[eventID]
		if exists && now.Before(expiresAt) {
			h.duplicateEvents += 1
			return HealthDecision{Duplicate: true}
		}
		h.seenEventIDs[eventID] = now.Add(healthDedupeTTL)
	}

	sessionID := strings.TrimSpace(event.SessionID)
	if sessionID != "" && event.Sequence > 0 {
		if previous := h.sessionSeq[sessionID]; previous > 0 && event.Sequence > previous+1 {
			h.estimatedDroppedEvents += int64(event.Sequence - (previous + 1))
		}
		if event.Sequence > h.sessionSeq[sessionID] {
			h.sessionSeq[sessionID] = event.Sequence
		}
		if len(h.sessionSeq) > healthMaxSessionCache {
			for key := range h.sessionSeq {
				delete(h.sessionSeq, key)
				break
			}
		}
	}

	isLate := time.UnixMilli(event.Timestamp).UTC().Before(now.Add(-healthLateEventThreshold))
	if isLate {
		h.lateEvents += 1
	}
	h.acceptedEvents += 1

	return HealthDecision{Late: isLate}
}

func (h *HealthTracker) RecordTimestampFallback(count int) {
	if count <= 0 {
		return
	}

	h.mu.Lock()
	h.timestampFallbackEvents += int64(count)
	h.mu.Unlock()
}

func (h *HealthTracker) Snapshot() HealthSnapshot {
	h.mu.Lock()
	defer h.mu.Unlock()

	expectedEvents := h.acceptedEvents + h.estimatedDroppedEvents
	duplicateRate := percentOf(h.duplicateEvents, h.observedEvents)
	eventLossRate := percentOf(h.estimatedDroppedEvents, expectedEvents)

	return HealthSnapshot{
		ObservedEvents:          h.observedEvents,
		AcceptedEvents:          h.acceptedEvents,
		DuplicateEvents:         h.duplicateEvents,
		EstimatedDroppedEvents:  h.estimatedDroppedEvents,
		LateEvents:              h.lateEvents,
		TimestampFallbackEvents: h.timestampFallbackEvents,
		DuplicateRatePct:        duplicateRate,
		EventLossRatePct:        eventLossRate,
		Targets: HealthKPITargets{
			EventLossRatePct:     targetLossRatePct,
			DuplicateRatePct:     targetDuplicateRatePct,
			EventLossHealthy:     eventLossRate <= targetLossRatePct,
			DuplicateRateHealthy: duplicateRate <= targetDuplicateRatePct,
		},
	}
}

func (h *HealthTracker) pruneLocked(now time.Time) {
	if len(h.seenEventIDs) == 0 {
		h.lastPrune = now
		return
	}

	shouldPrune := len(h.seenEventIDs) > healthMaxSeenEventIDs || now.Sub(h.lastPrune) >= time.Minute
	if !shouldPrune {
		return
	}

	for eventID, expiresAt := range h.seenEventIDs {
		if now.After(expiresAt) || len(h.seenEventIDs) > healthMaxSeenEventIDs {
			delete(h.seenEventIDs, eventID)
		}
	}
	h.lastPrune = now
}

func percentOf(value, total int64) float64 {
	if total <= 0 {
		return 0
	}
	return float64(value) * 100 / float64(total)
}

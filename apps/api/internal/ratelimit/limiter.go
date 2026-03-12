package ratelimit

import (
	"container/list"
	"strings"
	"sync"
	"time"
)

type Limiter struct {
	mu       sync.Mutex
	windows  map[string]*entry
	order    *list.List
	limit    int
	burst    int
	interval time.Duration
	maxSites int
}

type bucket struct {
	tokens     float64
	lastRefill time.Time
}

type entry struct {
	siteID  string
	bucket  bucket
	element *list.Element
}

func New(limit, burst int, interval time.Duration, maxSites int) *Limiter {
	if limit <= 0 {
		limit = 1000
	}
	if burst < 0 {
		burst = 0
	}
	if interval <= 0 {
		interval = time.Minute
	}
	if maxSites <= 0 {
		maxSites = 10000
	}

	return &Limiter{
		windows:  make(map[string]*entry, maxSites),
		order:    list.New(),
		limit:    limit,
		burst:    burst,
		interval: interval,
		maxSites: maxSites,
	}
}

func (l *Limiter) Allow(siteID string) bool {
	allowed, _ := l.Check(siteID)
	return allowed
}

func (l *Limiter) Check(siteID string) (bool, time.Duration) {
	normalizedSiteID := strings.TrimSpace(siteID)
	if normalizedSiteID == "" {
		return true, 0
	}

	now := time.Now().UTC()
	l.mu.Lock()
	defer l.mu.Unlock()

	item := l.getOrCreate(normalizedSiteID, now)
	l.refill(&item.bucket, now, l.fillRate())
	if item.bucket.tokens >= 1 {
		item.bucket.tokens -= 1
		l.touch(item)
		return true, 0
	}

	l.touch(item)
	deficit := 1 - item.bucket.tokens
	retryAfter := time.Duration(deficit / l.fillRate() * float64(time.Second))
	if retryAfter < time.Second {
		retryAfter = time.Second
	}
	return false, retryAfter
}

func (l *Limiter) getOrCreate(siteID string, now time.Time) *entry {
	if item, ok := l.windows[siteID]; ok {
		return item
	}

	element := l.order.PushFront(siteID)
	item := &entry{
		siteID: siteID,
		bucket: bucket{
			tokens:     float64(l.limit + l.burst),
			lastRefill: now,
		},
		element: element,
	}
	l.windows[siteID] = item
	l.evict()
	return item
}

func (l *Limiter) touch(item *entry) {
	if item == nil || item.element == nil {
		return
	}
	l.order.MoveToFront(item.element)
}

func (l *Limiter) evict() {
	for len(l.windows) > l.maxSites {
		oldest := l.order.Back()
		if oldest == nil {
			return
		}
		siteID, _ := oldest.Value.(string)
		delete(l.windows, siteID)
		l.order.Remove(oldest)
	}
}

func (l *Limiter) fillRate() float64 {
	return float64(l.limit) / l.interval.Seconds()
}

func (l *Limiter) refill(bucket *bucket, now time.Time, rate float64) {
	if bucket == nil {
		return
	}
	if rate <= 0 {
		rate = 1
	}
	if bucket.lastRefill.IsZero() {
		bucket.lastRefill = now
		bucket.tokens = float64(l.limit + l.burst)
		return
	}

	elapsed := now.Sub(bucket.lastRefill)
	if elapsed <= 0 {
		return
	}

	bucket.tokens += elapsed.Seconds() * rate
	maxTokens := float64(l.limit + l.burst)
	if bucket.tokens > maxTokens {
		bucket.tokens = maxTokens
	}
	bucket.lastRefill = now
}

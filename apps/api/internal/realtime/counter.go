package realtime

import (
	"container/list"
	"strings"
	"sync"
	"time"
)

type Counter struct {
	mu      sync.Mutex
	windows map[string]*siteWindow
	ttl     time.Duration
	maxSize int
}

type siteWindow struct {
	visitors map[string]*visitorEntry
	order    *list.List
}

type visitorEntry struct {
	visitorID string
	lastSeen  time.Time
	element   *list.Element
}

func NewCounter(ttl time.Duration, maxSize int) *Counter {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	if maxSize <= 0 {
		maxSize = 50000
	}
	return &Counter{
		windows: map[string]*siteWindow{},
		ttl:     ttl,
		maxSize: maxSize,
	}
}

func (c *Counter) Touch(siteID, visitorID string) {
	normalizedSiteID := strings.TrimSpace(siteID)
	normalizedVisitorID := strings.TrimSpace(visitorID)
	if normalizedSiteID == "" || normalizedVisitorID == "" {
		return
	}

	now := time.Now().UTC()
	c.mu.Lock()
	defer c.mu.Unlock()

	window := c.window(normalizedSiteID)
	c.pruneExpired(window, now)

	if existing, ok := window.visitors[normalizedVisitorID]; ok {
		existing.lastSeen = now
		window.order.MoveToFront(existing.element)
		return
	}

	element := window.order.PushFront(normalizedVisitorID)
	window.visitors[normalizedVisitorID] = &visitorEntry{
		visitorID: normalizedVisitorID,
		lastSeen:  now,
		element:   element,
	}

	for len(window.visitors) > c.maxSize {
		oldest := window.order.Back()
		if oldest == nil {
			break
		}
		id, _ := oldest.Value.(string)
		delete(window.visitors, id)
		window.order.Remove(oldest)
	}
}

func (c *Counter) Count(siteID string) int {
	normalizedSiteID := strings.TrimSpace(siteID)
	if normalizedSiteID == "" {
		return 0
	}

	now := time.Now().UTC()
	c.mu.Lock()
	defer c.mu.Unlock()

	window := c.windows[normalizedSiteID]
	if window == nil {
		return 0
	}
	c.pruneExpired(window, now)
	return len(window.visitors)
}

func (c *Counter) window(siteID string) *siteWindow {
	if existing, ok := c.windows[siteID]; ok {
		return existing
	}
	next := &siteWindow{
		visitors: map[string]*visitorEntry{},
		order:    list.New(),
	}
	c.windows[siteID] = next
	return next
}

func (c *Counter) pruneExpired(window *siteWindow, now time.Time) {
	if window == nil {
		return
	}
	for element := window.order.Back(); element != nil; element = window.order.Back() {
		id, _ := element.Value.(string)
		entry := window.visitors[id]
		if entry == nil {
			window.order.Remove(element)
			continue
		}
		if now.Sub(entry.lastSeen) <= c.ttl {
			return
		}
		delete(window.visitors, id)
		window.order.Remove(element)
	}
}

package cache

import (
	"container/list"
	"sync"
	"time"
)

type Cache struct {
	mu      sync.RWMutex
	entries map[string]*cacheEntry
	order   *list.List
	maxSize int
	ttl     time.Duration
}

type cacheEntry struct {
	key       string
	value     []byte
	expiresAt time.Time
	element   *list.Element
}

func NewCache(maxSize int, ttl time.Duration) *Cache {
	if maxSize <= 0 {
		maxSize = 500
	}
	if ttl <= 0 {
		ttl = 60 * time.Second
	}
	return &Cache{
		entries: make(map[string]*cacheEntry, maxSize),
		order:   list.New(),
		maxSize: maxSize,
		ttl:     ttl,
	}
}

func (c *Cache) Get(key string) ([]byte, bool) {
	now := time.Now().UTC()

	c.mu.RLock()
	entry, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok {
		return nil, false
	}

	if now.After(entry.expiresAt) {
		c.Delete(key)
		return nil, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if entry.element != nil {
		c.order.MoveToFront(entry.element)
	}
	output := append([]byte(nil), entry.value...)
	return output, true
}

func (c *Cache) Set(key string, value []byte) {
	now := time.Now().UTC()

	c.mu.Lock()
	defer c.mu.Unlock()

	if entry, ok := c.entries[key]; ok {
		entry.value = append(entry.value[:0], value...)
		entry.expiresAt = now.Add(c.ttl)
		if entry.element != nil {
			c.order.MoveToFront(entry.element)
		}
		return
	}

	element := c.order.PushFront(key)
	c.entries[key] = &cacheEntry{
		key:       key,
		value:     append([]byte(nil), value...),
		expiresAt: now.Add(c.ttl),
		element:   element,
	}
	for len(c.entries) > c.maxSize {
		oldest := c.order.Back()
		if oldest == nil {
			break
		}
		c.removeOldest(oldest)
	}
}

func (c *Cache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.entries[key]
	if !ok {
		return
	}
	delete(c.entries, key)
	if entry.element != nil {
		c.order.Remove(entry.element)
	}
}

func (c *Cache) Len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.entries)
}

func (c *Cache) removeOldest(oldest *list.Element) {
	key, _ := oldest.Value.(string)
	delete(c.entries, key)
	c.order.Remove(oldest)
}

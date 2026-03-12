package cache

import (
	"container/list"
	"time"
)

type LRU[K comparable, V any] struct {
	maxEntries int
	ttl        time.Duration
	items      map[K]*list.Element
	order      *list.List
}

type entry[K comparable, V any] struct {
	key       K
	value     V
	updatedAt time.Time
}

func NewLRU[K comparable, V any](maxEntries int, ttl time.Duration) *LRU[K, V] {
	if maxEntries <= 0 {
		maxEntries = 1
	}
	return &LRU[K, V]{
		maxEntries: maxEntries,
		ttl:        ttl,
		items:      make(map[K]*list.Element, maxEntries),
		order:      list.New(),
	}
}

func (l *LRU[K, V]) Get(key K, now time.Time) (V, bool) {
	var zero V
	element, ok := l.items[key]
	if !ok {
		return zero, false
	}

	item := element.Value.(*entry[K, V])
	if l.expired(item, now) {
		l.removeElement(element)
		return zero, false
	}

	item.updatedAt = now
	l.order.MoveToFront(element)
	return item.value, true
}

func (l *LRU[K, V]) Set(key K, value V, now time.Time) {
	if element, ok := l.items[key]; ok {
		item := element.Value.(*entry[K, V])
		item.value = value
		item.updatedAt = now
		l.order.MoveToFront(element)
		return
	}

	element := l.order.PushFront(&entry[K, V]{
		key:       key,
		value:     value,
		updatedAt: now,
	})
	l.items[key] = element
	l.evict(now)
}

func (l *LRU[K, V]) Delete(key K) {
	element, ok := l.items[key]
	if !ok {
		return
	}
	l.removeElement(element)
}

func (l *LRU[K, V]) Len() int {
	return len(l.items)
}

func (l *LRU[K, V]) evict(now time.Time) {
	for element := l.order.Back(); element != nil; element = l.order.Back() {
		item := element.Value.(*entry[K, V])
		if len(l.items) <= l.maxEntries && !l.expired(item, now) {
			return
		}
		l.removeElement(element)
	}
}

func (l *LRU[K, V]) removeElement(element *list.Element) {
	item := element.Value.(*entry[K, V])
	delete(l.items, item.key)
	l.order.Remove(element)
}

func (l *LRU[K, V]) expired(item *entry[K, V], now time.Time) bool {
	if l.ttl <= 0 {
		return false
	}
	return now.Sub(item.updatedAt) > l.ttl
}

package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

var httpDurationBuckets = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 5}

type Metrics struct {
	eventsReceived *counterMap
	eventsAccepted *counterMap
	eventsDropped  *counterMap
	httpRequests   *counterMap
	httpDuration   *histogramMap
	batchFlushes   *counterMap
	batchErrors    atomic.Int64

	queueDepthFn        func() int
	identityCacheSizeFn func() int
	cacheEntriesFn      func() int
	realtimeVisitorsFn  func(string) int
	realtimeSiteIDsFn   func() []string
}

func New() *Metrics {
	return &Metrics{
		eventsReceived: newCounterMap(),
		eventsAccepted: newCounterMap(),
		eventsDropped:  newCounterMap(),
		httpRequests:   newCounterMap(),
		httpDuration:   newHistogramMap(httpDurationBuckets),
		batchFlushes:   newCounterMap(),
	}
}

func (m *Metrics) SetQueueDepthFunc(fn func() int) {
	m.queueDepthFn = fn
}

func (m *Metrics) SetIdentityCacheSizeFunc(fn func() int) {
	m.identityCacheSizeFn = fn
}

func (m *Metrics) SetCacheEntriesFunc(fn func() int) {
	m.cacheEntriesFn = fn
}

func (m *Metrics) SetRealtimeVisitorsFunc(visitors func(string) int, siteIDs func() []string) {
	m.realtimeVisitorsFn = visitors
	m.realtimeSiteIDsFn = siteIDs
}

func (m *Metrics) RecordEventsReceived(siteID string, count int) {
	m.eventsReceived.Add(labelKey("site_id", siteID), int64(count))
}

func (m *Metrics) RecordEventsAccepted(siteID string, count int) {
	m.eventsAccepted.Add(labelKey("site_id", siteID), int64(count))
}

func (m *Metrics) RecordEventsDropped(reason string, count int) {
	m.eventsDropped.Add(labelKey("reason", reason), int64(count))
}

func (m *Metrics) RecordHTTPRequest(method, path string, status int, duration time.Duration) {
	requestLabels := joinLabels(
		"method", strings.TrimSpace(method),
		"path", strings.TrimSpace(path),
		"status", strconv.Itoa(status),
	)
	m.httpRequests.Add(requestLabels, 1)

	durationLabels := joinLabels(
		"method", strings.TrimSpace(method),
		"path", strings.TrimSpace(path),
	)
	m.httpDuration.Observe(durationLabels, duration.Seconds())
}

func (m *Metrics) RecordBatchFlush(reason string) {
	m.batchFlushes.Add(labelKey("reason", reason), 1)
}

func (m *Metrics) RecordBatchFlushError() {
	m.batchErrors.Add(1)
}

func (m *Metrics) Render() []byte {
	var builder strings.Builder

	writeCounterMetric(&builder, "anlticsheat_events_received_total", "Total events received by site", m.eventsReceived.Snapshot())
	writeCounterMetric(&builder, "anlticsheat_events_accepted_total", "Total events accepted by site", m.eventsAccepted.Snapshot())
	writeCounterMetric(&builder, "anlticsheat_events_dropped_total", "Total events dropped by reason", m.eventsDropped.Snapshot())
	writeCounterMetric(&builder, "anlticsheat_http_requests_total", "HTTP requests by method, path, status", m.httpRequests.Snapshot())
	writeHistogramMetric(&builder, "anlticsheat_http_request_duration_seconds", "HTTP request duration", m.httpDuration.Snapshot())
	writeCounterMetric(&builder, "anlticsheat_batch_flush_total", "Batch flushes by reason", m.batchFlushes.Snapshot())
	writeSimpleMetric(&builder, "anlticsheat_batch_flush_errors_total", "counter", "Batch flush errors", float64(m.batchErrors.Load()))

	if m.queueDepthFn != nil {
		writeSimpleMetric(&builder, "anlticsheat_queue_depth", "gauge", "Current batch queue depth", float64(m.queueDepthFn()))
	}
	if m.identityCacheSizeFn != nil {
		writeSimpleMetric(&builder, "anlticsheat_identity_cache_size", "gauge", "Current identity cache size", float64(m.identityCacheSizeFn()))
	}
	if m.cacheEntriesFn != nil {
		writeSimpleMetric(&builder, "anlticsheat_cache_entries", "gauge", "Current response cache entries", float64(m.cacheEntriesFn()))
	}
	if m.realtimeVisitorsFn != nil && m.realtimeSiteIDsFn != nil {
		writeGaugeVecMetric(&builder, "anlticsheat_realtime_visitors", "Realtime visitors by site", m.realtimeSiteIDsFn(), m.realtimeVisitorsFn)
	}

	return []byte(builder.String())
}

type counterMap struct {
	mu     sync.Mutex
	values map[string]*atomic.Int64
}

func newCounterMap() *counterMap {
	return &counterMap{values: map[string]*atomic.Int64{}}
}

func (c *counterMap) Add(labels string, delta int64) {
	counter := c.counter(labels)
	counter.Add(delta)
}

func (c *counterMap) Snapshot() map[string]int64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := make(map[string]int64, len(c.values))
	for labels, value := range c.values {
		out[labels] = value.Load()
	}
	return out
}

func (c *counterMap) counter(labels string) *atomic.Int64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, ok := c.values[labels]; ok {
		return existing
	}
	next := &atomic.Int64{}
	c.values[labels] = next
	return next
}

type histogramMap struct {
	mu      sync.Mutex
	buckets []float64
	values  map[string]*histogramValue
}

type histogramValue struct {
	counts    []*atomic.Int64
	count     atomic.Int64
	sumMicros atomic.Int64
}

type histogramSnapshot struct {
	Buckets []float64
	Values  map[string]histogramSeries
}

type histogramSeries struct {
	Counts []int64
	Count  int64
	Sum    float64
}

func newHistogramMap(buckets []float64) *histogramMap {
	return &histogramMap{
		buckets: append([]float64(nil), buckets...),
		values:  map[string]*histogramValue{},
	}
}

func (h *histogramMap) Observe(labels string, value float64) {
	item := h.item(labels)
	for index, bucket := range h.buckets {
		if value <= bucket {
			item.counts[index].Add(1)
		}
	}
	item.count.Add(1)
	item.sumMicros.Add(int64(value * 1_000_000))
}

func (h *histogramMap) Snapshot() histogramSnapshot {
	h.mu.Lock()
	defer h.mu.Unlock()

	values := make(map[string]histogramSeries, len(h.values))
	for labels, item := range h.values {
		counts := make([]int64, len(item.counts))
		for index, bucket := range item.counts {
			counts[index] = bucket.Load()
		}
		values[labels] = histogramSeries{
			Counts: counts,
			Count:  item.count.Load(),
			Sum:    float64(item.sumMicros.Load()) / 1_000_000,
		}
	}
	return histogramSnapshot{
		Buckets: append([]float64(nil), h.buckets...),
		Values:  values,
	}
}

func (h *histogramMap) item(labels string) *histogramValue {
	h.mu.Lock()
	defer h.mu.Unlock()

	if existing, ok := h.values[labels]; ok {
		return existing
	}
	counts := make([]*atomic.Int64, len(h.buckets))
	for index := range counts {
		counts[index] = &atomic.Int64{}
	}
	next := &histogramValue{counts: counts}
	h.values[labels] = next
	return next
}

func writeCounterMetric(builder *strings.Builder, name, help string, series map[string]int64) {
	if len(series) == 0 {
		return
	}
	fmt.Fprintf(builder, "# HELP %s %s\n", name, help)
	fmt.Fprintf(builder, "# TYPE %s counter\n", name)
	for _, labels := range sortedKeys(series) {
		writeMetricLine(builder, name, labels, float64(series[labels]))
	}
}

func writeHistogramMetric(builder *strings.Builder, name, help string, snapshot histogramSnapshot) {
	if len(snapshot.Values) == 0 {
		return
	}
	fmt.Fprintf(builder, "# HELP %s %s\n", name, help)
	fmt.Fprintf(builder, "# TYPE %s histogram\n", name)
	for _, labels := range sortedHistogramKeys(snapshot.Values) {
		series := snapshot.Values[labels]
		for index, bucket := range snapshot.Buckets {
			writeMetricLine(builder, name+"_bucket", appendLabel(labels, "le", formatFloat(bucket)), float64(series.Counts[index]))
		}
		writeMetricLine(builder, name+"_bucket", appendLabel(labels, "le", "+Inf"), float64(series.Count))
		writeMetricLine(builder, name+"_sum", labels, series.Sum)
		writeMetricLine(builder, name+"_count", labels, float64(series.Count))
	}
}

func writeSimpleMetric(builder *strings.Builder, name, metricType, help string, value float64) {
	fmt.Fprintf(builder, "# HELP %s %s\n", name, help)
	fmt.Fprintf(builder, "# TYPE %s %s\n", name, metricType)
	writeMetricLine(builder, name, "", value)
}

func writeGaugeVecMetric(builder *strings.Builder, name, help string, siteIDs []string, valueFn func(string) int) {
	if len(siteIDs) == 0 {
		return
	}
	sort.Strings(siteIDs)
	fmt.Fprintf(builder, "# HELP %s %s\n", name, help)
	fmt.Fprintf(builder, "# TYPE %s gauge\n", name)
	for _, siteID := range siteIDs {
		writeMetricLine(builder, name, labelKey("site_id", siteID), float64(valueFn(siteID)))
	}
}

func writeMetricLine(builder *strings.Builder, name, labels string, value float64) {
	if labels != "" {
		fmt.Fprintf(builder, "%s{%s} %s\n", name, labels, formatFloat(value))
		return
	}
	fmt.Fprintf(builder, "%s %s\n", name, formatFloat(value))
}

func labelKey(key, value string) string {
	return joinLabels(key, value)
}

func joinLabels(parts ...string) string {
	pairs := make([]string, 0, len(parts)/2)
	for index := 0; index+1 < len(parts); index += 2 {
		pairs = append(pairs, fmt.Sprintf(`%s="%s"`, parts[index], escapeLabel(parts[index+1])))
	}
	sort.Strings(pairs)
	return strings.Join(pairs, ",")
}

func appendLabel(existing, key, value string) string {
	parts := []string{}
	if strings.TrimSpace(existing) != "" {
		parts = append(parts, strings.Split(existing, ",")...)
	}
	parts = append(parts, fmt.Sprintf(`%s="%s"`, key, escapeLabel(value)))
	sort.Strings(parts)
	return strings.Join(parts, ",")
}

func escapeLabel(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, "\n", `\n`, `"`, `\"`)
	return replacer.Replace(value)
}

func sortedKeys(values map[string]int64) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedHistogramKeys(values map[string]histogramSeries) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func formatFloat(value float64) string {
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func PathLabel(r *http.Request) string {
	if pattern := strings.TrimSpace(r.Pattern); pattern != "" {
		return pattern
	}
	if path := strings.TrimSpace(r.URL.Path); path != "" {
		return path
	}
	return "/"
}

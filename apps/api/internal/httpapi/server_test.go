package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/controlplane"
	"anlticsheat/api/internal/ingest"
	"anlticsheat/api/internal/storage"
)

func TestTrackerEndpoint(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/t.js?id=demo-site", nil)
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	response := recorder.Result()
	defer response.Body.Close()

	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.StatusCode)
	}
	if response.Header.Get("ETag") == "" {
		t.Fatal("expected tracker response to set an ETag")
	}

	body, _ := io.ReadAll(response.Body)
	if !bytes.Contains(body, []byte("demo-site")) {
		t.Fatal("expected tracker payload to include baked site id")
	}
}

func TestCollectEndpointEnqueuesBatch(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-1","p":"/pricing","meta":{"r":"https://google.com","vw":1200}}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "203.0.113.10:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", recorder.Code)
	}

	var responsePayload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&responsePayload); err != nil {
		t.Fatalf("decode response payload: %v", err)
	}
	visitorPayload, ok := responsePayload["visitor"].(map[string]any)
	if !ok {
		t.Fatalf("expected visitor payload, got %+v", responsePayload)
	}
	visitorID, _ := visitorPayload["id"].(string)
	if visitorID == "" {
		t.Fatalf("expected visitor id in response payload, got %+v", visitorPayload)
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			events := store.Events()
			if len(events) != 1 {
				t.Fatalf("expected one stored event, got %d", len(events))
			}
			if events[0].AnonymizedIP != "203.0.113.0" {
				t.Fatalf("expected truncated ip, got %q", events[0].AnonymizedIP)
			}
			if events[0].VisitorID != visitorID {
				t.Fatalf("expected stored visitor id %q, got %q", visitorID, events[0].VisitorID)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected memory store to receive the event, got %+v", store.Stats())
}

func TestCollectEndpointAddsCoarseGeoFromHeaders(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-geo","p":"/map"}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.Header.Set("X-Vercel-IP-Country", "US")
	request.Header.Set("X-Vercel-IP-Country-Region", "CA")
	request.Header.Set("X-Vercel-IP-City", "San Francisco")
	request.RemoteAddr = "127.0.0.1:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			events := store.Events()
			if len(events) != 1 {
				t.Fatalf("expected one stored event, got %d", len(events))
			}

			meta := map[string]any{}
			if err := json.Unmarshal([]byte(events[0].Meta), &meta); err != nil {
				t.Fatalf("decode stored meta: %v", err)
			}
			if meta["gcc"] != "US" || meta["grc"] != "CA" || meta["gci"] != "San Francisco" {
				t.Fatalf("expected coarse geo metadata, got %+v", meta)
			}
			if _, ok := meta["lat"]; ok {
				t.Fatalf("did not expect coordinate precision in meta: %+v", meta)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected memory store to receive the geo event, got %+v", store.Stats())
}

func TestCollectEndpointAddsDevGeoForLoopbackTraffic(t *testing.T) {
	server, store := newTestServerWithConfig(t, func(cfg *config.Config) {
		cfg.DevGeoCountryCode = "IN"
		cfg.DevGeoCountryName = "India"
		cfg.DevGeoContinent = "Asia"
		cfg.DevGeoRegionCode = "KA"
		cfg.DevGeoRegionName = "Karnataka"
		cfg.DevGeoCity = "Bengaluru"
		cfg.DevGeoTimezone = "Asia/Kolkata"
	})

	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-local-dev","p":"/map"}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "127.0.0.1:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			events := store.Events()
			if len(events) != 1 {
				t.Fatalf("expected one stored event, got %d", len(events))
			}

			meta := map[string]any{}
			if err := json.Unmarshal([]byte(events[0].Meta), &meta); err != nil {
				t.Fatalf("decode stored meta: %v", err)
			}
			if meta["gcc"] != "IN" || meta["grc"] != "KA" || meta["gci"] != "Bengaluru" {
				t.Fatalf("expected dev geo metadata, got %+v", meta)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected memory store to receive the dev-geo event, got %+v", store.Stats())
}

func TestReplayEndpointStoresSessionChunks(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	body := []byte(fmt.Sprintf(`{
		"storageId": "844f59f2-d0f4-4ec7-8a08-d5218d9d7ed8",
		"reason": "interval",
		"session": {
			"sessionId": "session-replay-1",
			"sampleRate": 0.1,
			"startedAt": %q,
			"updatedAt": %q,
			"durationMs": 4200,
			"entryPath": "/pricing",
			"exitPath": "/checkout",
			"pageCount": 2,
			"routeCount": 1,
			"chunkCount": 1,
			"eventCount": 4,
			"errorCount": 1,
			"consoleErrorCount": 1,
			"networkFailureCount": 0,
			"rageClickCount": 1,
			"deadClickCount": 0,
			"customEventCount": 1,
			"deviceType": "desktop",
			"browser": "Chrome",
			"os": "macOS",
			"viewport": {"width": 1280, "height": 720, "bucket": "desktop"},
			"paths": ["/pricing", "/checkout"]
		},
		"chunks": [{
			"index": 1,
			"reason": "interval",
			"startedAt": %q,
			"endedAt": %q,
			"path": "/pricing",
			"eventCount": 4,
			"summary": {
				"fullSnapshots": 1,
				"mutationEvents": 1,
				"consoleErrors": 1,
				"networkFailures": 0,
				"rageClicks": 1,
				"deadClicks": 0,
				"routeChanges": 1,
				"customEvents": 1
			},
			"events": [
				{"type":"full_snapshot","ts":%d,"data":{"path":"/pricing","viewport":{"width":1280,"height":720},"scroll":{"x":0,"y":0},"root":{"id":1,"nodeType":1,"tagName":"html","attributes":{},"childNodes":[]}}},
				{"type":"click","ts":%d,"data":{"x":120,"y":240,"pointerType":"mouse","selector":"button.buy","rage":true}},
				{"type":"console","ts":%d,"data":{"level":"error","message":"checkout exploded"}},
				{"type":"route","ts":%d,"data":{"path":"/checkout","title":"Checkout"}}
			]
		}]
	}`, now.Format(time.RFC3339), now.Add(4*time.Second).Format(time.RFC3339), now.Format(time.RFC3339), now.Add(4*time.Second).Format(time.RFC3339), now.UnixMilli(), now.Add(1500*time.Millisecond).UnixMilli(), now.Add(2200*time.Millisecond).UnixMilli(), now.Add(3200*time.Millisecond).UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/replay?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "203.0.113.10:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		list, err := store.ReplaySessions(context.Background(), "demo-site", storage.Range7Days, time.Now().UTC())
		if err != nil {
			t.Fatalf("ReplaySessions failed: %v", err)
		}
		if len(list.Sessions) == 1 {
			detail, err := store.ReplaySession(context.Background(), "demo-site", "session-replay-1")
			if err != nil {
				t.Fatalf("ReplaySession failed: %v", err)
			}
			if len(detail.Chunks) != 1 {
				t.Fatalf("expected one replay chunk, got %+v", detail)
			}
			if detail.Session.RageClickCount != 1 || detail.Session.ConsoleErrorCount != 1 {
				t.Fatalf("unexpected replay summary: %+v", detail.Session)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected replay session to be stored, got %+v", store)
}

func TestDashboardReplayEndpoints(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteReplay(context.Background(), storage.ReplayWriteBatch{
		Session: storage.ReplayWriteSession{
			SiteID:              "demo-site",
			SessionID:           "session-replay-dashboard",
			VisitorID:           "visitor-1",
			StartedAt:           now,
			UpdatedAt:           now.Add(2 * time.Second),
			DurationMS:          2000,
			EntryPath:           "/pricing",
			ExitPath:            "/checkout",
			PageCount:           2,
			RouteCount:          1,
			ChunkCount:          1,
			EventCount:          3,
			ErrorCount:          1,
			ConsoleErrorCount:   1,
			NetworkFailureCount: 0,
			RageClickCount:      1,
			DeadClickCount:      0,
			CustomEventCount:    0,
			DeviceType:          "desktop",
			Browser:             "Chrome",
			OS:                  "macOS",
			Viewport:            storage.ReplayViewport{Width: 1280, Height: 720, Bucket: "desktop"},
			Paths:               []string{"/pricing", "/checkout"},
			SampleRate:          0.1,
		},
		Chunks: []storage.ReplayWriteChunk{
			{
				SiteID:     "demo-site",
				SessionID:  "session-replay-dashboard",
				VisitorID:  "visitor-1",
				Index:      1,
				Reason:     "interval",
				StartedAt:  now,
				EndedAt:    now.Add(2 * time.Second),
				Path:       "/pricing",
				EventCount: 3,
				Summary: storage.ReplayChunkSummary{
					FullSnapshots: 1,
					ConsoleErrors: 1,
					RageClicks:    1,
					RouteChanges:  1,
				},
				EventsJSON: `[{"type":"route","ts":1,"data":{"path":"/checkout"}}]`,
			},
		},
	}); err != nil {
		t.Fatalf("WriteReplay failed: %v", err)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/replays?site=demo-site&range=7d", nil)
	listRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	listRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(listRecorder, listRequest)

	if listRecorder.Code != http.StatusOK {
		t.Fatalf("expected replay list 200, got %d body=%s", listRecorder.Code, listRecorder.Body.String())
	}

	var listPayload storage.ReplaySessionList
	if err := json.NewDecoder(listRecorder.Body).Decode(&listPayload); err != nil {
		t.Fatalf("decode replay list: %v", err)
	}
	if len(listPayload.Sessions) != 1 {
		t.Fatalf("expected one replay session, got %+v", listPayload)
	}

	detailRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/replay?site=demo-site&session=session-replay-dashboard", nil)
	detailRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	detailRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(detailRecorder, detailRequest)

	if detailRecorder.Code != http.StatusOK {
		t.Fatalf("expected replay detail 200, got %d body=%s", detailRecorder.Code, detailRecorder.Body.String())
	}

	var detailPayload storage.ReplaySessionDetail
	if err := json.NewDecoder(detailRecorder.Body).Decode(&detailPayload); err != nil {
		t.Fatalf("decode replay detail: %v", err)
	}
	if detailPayload.Session.SessionID != "session-replay-dashboard" || len(detailPayload.Chunks) != 1 {
		t.Fatalf("unexpected replay detail payload: %+v", detailPayload)
	}
}

func TestCollectEndpointUsesCookieVisitorIDWhenEnabled(t *testing.T) {
	server, _ := newTestServerWithConfig(t, func(cfg *config.Config) {
		site := cfg.Sites["demo-site"]
		site.VisitorCookieEnabled = true
		cfg.Sites["demo-site"] = site
	})
	now := time.Now().UTC().UnixMilli()

	firstBody := []byte(fmt.Sprintf(`{"events":[{"e":"pageview","t":%d,"sid":"session-10","p":"/","meta":{"vw":1024}}],"storageId":"844f59f2-d0f4-4ec7-8a08-d5218d9d7ed8"}`, now))
	firstRequest := httptest.NewRequest(http.MethodPost, "/collect?id=demo-site", bytes.NewReader(firstBody))
	firstRequest.Header.Set("Content-Type", "application/json")
	firstRequest.Header.Set("Origin", "http://localhost:3000")
	firstRequest.Header.Set("User-Agent", "Mozilla/5.0")

	firstRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(firstRecorder, firstRequest)
	if firstRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected first request 202, got %d", firstRecorder.Code)
	}

	cookies := firstRecorder.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("expected first request to issue visitor cookie")
	}
	firstVisitor := cookies[0].Value
	if firstVisitor == "" {
		t.Fatal("expected first visitor cookie value")
	}

	secondBody := []byte(fmt.Sprintf(`{"events":[{"e":"pageview","t":%d,"sid":"session-11","p":"/pricing","meta":{"vw":1024}}],"storageId":"06c767fb-d253-4126-8988-f0933e4cf03f"}`, now))
	secondRequest := httptest.NewRequest(http.MethodPost, "/collect?id=demo-site", bytes.NewReader(secondBody))
	secondRequest.Header.Set("Content-Type", "application/json")
	secondRequest.Header.Set("Origin", "http://localhost:3000")
	secondRequest.Header.Set("User-Agent", "Mozilla/5.0")
	secondRequest.AddCookie(&http.Cookie{Name: "_vid", Value: firstVisitor})

	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, secondRequest)
	if secondRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected second request 202, got %d", secondRecorder.Code)
	}

	var responsePayload map[string]any
	if err := json.NewDecoder(secondRecorder.Body).Decode(&responsePayload); err != nil {
		t.Fatalf("decode response payload: %v", err)
	}
	visitorPayload, _ := responsePayload["visitor"].(map[string]any)
	id, _ := visitorPayload["id"].(string)
	source, _ := visitorPayload["source"].(string)
	if id != firstVisitor {
		t.Fatalf("expected visitor id %q, got %q", firstVisitor, id)
	}
	if source != "cookie" {
		t.Fatalf("expected source cookie, got %q", source)
	}
}

func TestCollectEndpointAcceptsIDAlias(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-2","p":"/docs","meta":{"r":"https://example.com","vw":1440}}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "203.0.113.25:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", recorder.Code)
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected memory store to receive the aliased event, got %+v", store.Stats())
}

func TestCollectEndpointSetsCredentialedCORSHeaders(t *testing.T) {
	server := newTestServer(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-3","p":"/"}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected allow origin header to echo request origin, got %q", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected allow credentials header to be true, got %q", got)
	}
}

func TestCollectOptionsSetsCredentialedCORSHeaders(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodOptions, "/collect?id=demo-site", nil)
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "content-type")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Origin"); got != "http://localhost:3000" {
		t.Fatalf("expected allow origin header to echo request origin, got %q", got)
	}
	if got := recorder.Header().Get("Access-Control-Allow-Credentials"); got != "true" {
		t.Fatalf("expected allow credentials header to be true, got %q", got)
	}
}

func TestIdentityEndpointResolvesWithoutCookieByDefault(t *testing.T) {
	server := newTestServer(t)
	body := []byte(`{"storageId":"4dbd1b18-0ebe-44f2-8ee8-8d9f3872ae33"}`)
	request := httptest.NewRequest(http.MethodPost, "/identity?id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	if cookies := recorder.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("expected no visitor cookie by default, got %+v", cookies)
	}

	var payload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode identity response: %v", err)
	}
	if got, _ := payload["id"].(string); got != "4dbd1b18-0ebe-44f2-8ee8-8d9f3872ae33" {
		t.Fatalf("expected identity id to match storage id, got %q", got)
	}
	if got, _ := payload["source"].(string); got != "storage" {
		t.Fatalf("expected source storage, got %q", got)
	}
}

func TestIdentityEndpointFallsBackToDailyHash(t *testing.T) {
	server := newTestServer(t)

	firstRequest := httptest.NewRequest(http.MethodPost, "/identity?id=demo-site", bytes.NewBufferString(`{}`))
	firstRequest.Header.Set("Content-Type", "application/json")
	firstRequest.Header.Set("Origin", "http://localhost:3000")
	firstRequest.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh)")
	firstRequest.RemoteAddr = "203.0.113.44:12345"

	firstRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(firstRecorder, firstRequest)
	if firstRecorder.Code != http.StatusOK {
		t.Fatalf("expected first request 200, got %d", firstRecorder.Code)
	}

	var firstPayload map[string]any
	if err := json.NewDecoder(firstRecorder.Body).Decode(&firstPayload); err != nil {
		t.Fatalf("decode first identity response: %v", err)
	}
	firstID, _ := firstPayload["id"].(string)
	firstSource, _ := firstPayload["source"].(string)
	if firstID == "" {
		t.Fatalf("expected first identity id, got %+v", firstPayload)
	}
	if firstSource != "new" {
		t.Fatalf("expected first source new, got %q", firstSource)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/identity?id=demo-site", bytes.NewBufferString(`{}`))
	secondRequest.Header.Set("Content-Type", "application/json")
	secondRequest.Header.Set("Origin", "http://localhost:3000")
	secondRequest.Header.Set("User-Agent", "Mozilla/5.0 (Macintosh)")
	secondRequest.RemoteAddr = "203.0.113.44:12345"

	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, secondRequest)
	if secondRecorder.Code != http.StatusOK {
		t.Fatalf("expected second request 200, got %d", secondRecorder.Code)
	}

	var secondPayload map[string]any
	if err := json.NewDecoder(secondRecorder.Body).Decode(&secondPayload); err != nil {
		t.Fatalf("decode second identity response: %v", err)
	}
	secondID, _ := secondPayload["id"].(string)
	secondSource, _ := secondPayload["source"].(string)
	if secondID != firstID {
		t.Fatalf("expected daily hash id %q, got %q", firstID, secondID)
	}
	if secondSource != "daily_hash" {
		t.Fatalf("expected second source daily_hash, got %q", secondSource)
	}
}

func TestCollectEndpointHonorsDNT(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-1","p":"/pricing","meta":{"r":"https://google.com"}}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.Header.Set("DNT", "1")
	request.RemoteAddr = "203.0.113.10:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
	if stats := store.Stats(); stats.Events != 0 {
		t.Fatalf("expected no events to be stored, got %+v", stats)
	}
}

func TestCollectEndpointHonorsGlobalPrivacyControl(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-1","p":"/pricing"}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.Header.Set("Sec-GPC", "1")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
	if stats := store.Stats(); stats.Events != 0 {
		t.Fatalf("expected no events to be stored, got %+v", stats)
	}
}

func TestCollectEndpointRateLimitsPerSite(t *testing.T) {
	server, _ := newTestServerWithConfig(t, func(cfg *config.Config) {
		cfg.RateLimitPerSite = 1
		cfg.RateLimitBurst = 0
		cfg.RateLimitInterval = time.Minute
	})

	body := func() []byte {
		return []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-rl","p":"/pricing"}]`, time.Now().UTC().UnixMilli()))
	}

	firstRequest := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body()))
	firstRequest.Header.Set("Content-Type", "application/json")
	firstRequest.Header.Set("Origin", "http://localhost:3000")
	firstRequest.Header.Set("User-Agent", "Mozilla/5.0")
	firstRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(firstRecorder, firstRequest)
	if firstRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected first request 202, got %d", firstRecorder.Code)
	}

	secondRequest := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body()))
	secondRequest.Header.Set("Content-Type", "application/json")
	secondRequest.Header.Set("Origin", "http://localhost:3000")
	secondRequest.Header.Set("User-Agent", "Mozilla/5.0")
	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, secondRequest)
	if secondRecorder.Code != http.StatusTooManyRequests {
		t.Fatalf("expected second request 429, got %d body=%s", secondRecorder.Code, secondRecorder.Body.String())
	}
	if secondRecorder.Header().Get("Retry-After") == "" {
		t.Fatal("expected Retry-After header on rate-limited response")
	}
}

func TestSecurityHeadersMiddleware(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)
	request.Header.Set("X-Forwarded-Proto", "https")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if got := recorder.Header().Get("X-Content-Type-Options"); got != "nosniff" {
		t.Fatalf("expected nosniff header, got %q", got)
	}
	if got := recorder.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("expected X-Frame-Options DENY, got %q", got)
	}
	if got := recorder.Header().Get("Referrer-Policy"); got != "strict-origin-when-cross-origin" {
		t.Fatalf("expected Referrer-Policy header, got %q", got)
	}
	if got := recorder.Header().Get("Strict-Transport-Security"); got == "" {
		t.Fatal("expected Strict-Transport-Security header for secure requests")
	}
}

func TestMetricsEndpointRequiresTokenAndRendersMetrics(t *testing.T) {
	server := newTestServer(t)

	unauthorized := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	unauthorizedRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorizedRecorder, unauthorized)
	if unauthorizedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected unauthorized metrics request to return 401, got %d", unauthorizedRecorder.Code)
	}

	authorized := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	authorized.Header.Set("Authorization", "Bearer demo-admin-token")
	authorizedRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(authorizedRecorder, authorized)
	if authorizedRecorder.Code != http.StatusOK {
		t.Fatalf("expected authorized metrics request to return 200, got %d", authorizedRecorder.Code)
	}
	body := authorizedRecorder.Body.String()
	for _, metricName := range []string{
		"anlticsheat_http_requests_total",
		"anlticsheat_queue_depth",
		"anlticsheat_identity_cache_size",
		"anlticsheat_cache_entries",
	} {
		if !strings.Contains(body, metricName) {
			t.Fatalf("expected metrics payload to contain %s, got %s", metricName, body)
		}
	}
}

func TestCollectEndpointRejectsBots(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-1","p":"/pricing","meta":{"r":"https://google.com"}}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "curl/8.7.1")
	request.RemoteAddr = "203.0.113.10:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", recorder.Code)
	}
	if stats := store.Stats(); stats.Events != 0 {
		t.Fatalf("expected no events to be stored, got %+v", stats)
	}
}

func TestCollectEndpointFallsBackOldEventTimestamp(t *testing.T) {
	server, store := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-1","p":"/pricing","meta":{"r":"https://google.com"}}]`, time.Now().Add(-2*time.Hour).UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "203.0.113.10:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", recorder.Code)
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected old event to be ingested with server timestamp fallback, got %+v", store.Stats())
}

func TestCollectEndpointDeduplicatesEventIDs(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC().UnixMilli()
	body := []byte(fmt.Sprintf(`{"events":[{"id":"evt-1","sq":1,"e":"pageview","t":%d,"sid":"session-1","p":"/pricing","meta":{"vw":1200}},{"id":"evt-1","sq":2,"e":"click","t":%d,"sid":"session-1","p":"/pricing","x":42.1,"y":12.8,"meta":{"vw":1200}}]}`, now, now))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "Mozilla/5.0")
	request.RemoteAddr = "203.0.113.12:12345"

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d", recorder.Code)
	}

	var payload map[string]any
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response payload: %v", err)
	}
	if got, _ := payload["duplicates"].(float64); got != 1 {
		t.Fatalf("expected duplicates=1, got %+v", payload)
	}
	if got, _ := payload["accepted"].(float64); got != 1 {
		t.Fatalf("expected accepted=1, got %+v", payload)
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected exactly one stored event after dedupe, got %+v", store.Stats())
}

func TestAdminVisitorExportAndDeleteRequireAdminToken(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	visitorID := "visitor-admin-1"

	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now,
				SessionID: "session-admin-1",
				VisitorID: visitorID,
				Name:      "pageview",
				Path:      "/privacy",
				Meta:      `{"vid":"visitor-admin-1","vw":1280}`,
			},
		},
	}); err != nil {
		t.Fatalf("WriteBatch failed: %v", err)
	}

	if err := store.WriteReplay(context.Background(), storage.ReplayWriteBatch{
		Session: storage.ReplayWriteSession{
			SiteID:     "demo-site",
			SessionID:  "session-admin-1",
			VisitorID:  visitorID,
			StartedAt:  now,
			UpdatedAt:  now.Add(2 * time.Second),
			EntryPath:  "/privacy",
			ExitPath:   "/privacy",
			ChunkCount: 1,
			EventCount: 1,
		},
		Chunks: []storage.ReplayWriteChunk{
			{
				SiteID:     "demo-site",
				SessionID:  "session-admin-1",
				VisitorID:  visitorID,
				Index:      1,
				StartedAt:  now,
				EndedAt:    now.Add(2 * time.Second),
				Path:       "/privacy",
				EventCount: 1,
				EventsJSON: `[{"type":"route","ts":1,"data":{"path":"/privacy"}}]`,
			},
		},
	}); err != nil {
		t.Fatalf("WriteReplay failed: %v", err)
	}

	unauthorized := httptest.NewRequest(http.MethodGet, "/api/v1/admin/visitor/"+visitorID+"/export", nil)
	unauthorized.Header.Set("Authorization", "Bearer demo-dashboard-token")
	unauthorizedRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(unauthorizedRecorder, unauthorized)
	if unauthorizedRecorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for dashboard token, got %d", unauthorizedRecorder.Code)
	}

	exportRequest := httptest.NewRequest(http.MethodGet, "/api/v1/admin/visitor/"+visitorID+"/export", nil)
	exportRequest.Header.Set("Authorization", "Bearer demo-admin-token")
	exportRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(exportRecorder, exportRequest)
	if exportRecorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", exportRecorder.Code, exportRecorder.Body.String())
	}

	var exportPayload storage.VisitorExport
	if err := json.NewDecoder(exportRecorder.Body).Decode(&exportPayload); err != nil {
		t.Fatalf("decode export payload: %v", err)
	}
	if len(exportPayload.Events) != 1 || len(exportPayload.ReplaySessions) != 1 || len(exportPayload.ReplayChunks) != 1 {
		t.Fatalf("unexpected export payload: %+v", exportPayload)
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/v1/admin/visitor/"+visitorID, nil)
	deleteRequest.Header.Set("Authorization", "Bearer demo-admin-token")
	deleteRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(deleteRecorder, deleteRequest)
	if deleteRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", deleteRecorder.Code, deleteRecorder.Body.String())
	}

	var deletePayload storage.VisitorDeleteResult
	if err := json.NewDecoder(deleteRecorder.Body).Decode(&deletePayload); err != nil {
		t.Fatalf("decode delete payload: %v", err)
	}
	if deletePayload.DeletedEvents != 1 || deletePayload.DeletedReplaySessions != 1 || deletePayload.DeletedReplayChunks != 1 {
		t.Fatalf("unexpected delete payload: %+v", deletePayload)
	}

	postDeleteExport := httptest.NewRequest(http.MethodGet, "/api/v1/admin/visitor/"+visitorID+"/export", nil)
	postDeleteExport.Header.Set("Authorization", "Bearer demo-admin-token")
	postDeleteRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(postDeleteRecorder, postDeleteExport)
	if postDeleteRecorder.Code != http.StatusOK {
		t.Fatalf("expected post-delete export 200, got %d", postDeleteRecorder.Code)
	}

	var postDeletePayload storage.VisitorExport
	if err := json.NewDecoder(postDeleteRecorder.Body).Decode(&postDeletePayload); err != nil {
		t.Fatalf("decode post-delete export: %v", err)
	}
	if len(postDeletePayload.Events) != 0 || len(postDeletePayload.ReplaySessions) != 0 || len(postDeletePayload.ReplayChunks) != 0 {
		t.Fatalf("expected export to be empty after delete, got %+v", postDeletePayload)
	}
}

func TestDashboardContextRequiresToken(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/context", nil)
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", recorder.Code)
	}
}

func TestDashboardContextAcceptsAnalyticsServiceToken(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/context", nil)
	request.Header.Set("Authorization", "Bearer service-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
}

func TestDashboardNeoToolsEndpoint(t *testing.T) {
	server := newTestServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/neo/tools", nil)
	request.Header.Set("X-Dashboard-Token", "demo-dashboard-token")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload struct {
		Tools []struct {
			Name   string `json:"name"`
			Access string `json:"access"`
		} `json:"tools"`
		Security map[string]any `json:"security"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode neo tools payload: %v", err)
	}

	foundSafeWrite := false
	for _, tool := range payload.Tools {
		if tool.Name == "update_profile_name" && tool.Access == "safe-write" {
			foundSafeWrite = true
			break
		}
	}
	if !foundSafeWrite {
		t.Fatalf("expected update_profile_name safe-write tool, got %+v", payload.Tools)
	}
	if _, ok := payload.Security["forbidden"]; !ok {
		t.Fatalf("expected forbidden actions in security payload, got %+v", payload.Security)
	}
}

func TestDashboardNeoChatBlocksForbiddenDeletion(t *testing.T) {
	server := newTestServer(t)
	body := bytes.NewBufferString(`{"messages":[{"role":"user","content":"delete this site for me"}],"siteId":"demo-site","range":"7d","pathname":"/dashboard"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/dashboard/neo/chat", body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Dashboard-Token", "demo-dashboard-token")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	bodyText := recorder.Body.String()
	if !strings.Contains(bodyText, "Neo will not perform that deletion directly.") {
		t.Fatalf("expected forbidden deletion guidance, got %s", bodyText)
	}
	if !strings.Contains(bodyText, "delete-site control") {
		t.Fatalf("expected manual delete-site guidance, got %s", bodyText)
	}
}

func TestDashboardNeoChatProviderToolFlow(t *testing.T) {
	var callCount int
	mockProvider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		callCount++
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode mock provider request: %v", err)
		}

		write := func(body string) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(body))
		}

		switch callCount {
		case 1:
			write(`{"choices":[{"message":{"tool_calls":[{"id":"tool-1","type":"function","function":{"name":"get_dashboard_context","arguments":"{}"}}]}}]}`)
		case 2:
			write(`{"choices":[{"message":{"content":"Context loaded."}}]}`)
		default:
			write(`{"choices":[{"message":{"content":"Here is the dashboard context."}}]}`)
		}
	}))
	defer mockProvider.Close()

	server, _ := newTestServerWithConfig(t, func(cfg *config.Config) {
		cfg.NeoGroqBaseURL = mockProvider.URL
		cfg.NeoGroqAPIKey = "test-key"
		cfg.NeoGroqModel = "test-model"
		cfg.NeoGroqTemperature = 0.2
		cfg.NeoGroqMaxTokens = 256
		cfg.NeoGroqReasoningEffort = "default"
	})

	body := bytes.NewBufferString(`{"messages":[{"role":"user","content":"what site am i on?"}],"siteId":"demo-site","range":"7d","pathname":"/dashboard"}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/dashboard/neo/chat", body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Dashboard-Token", "demo-dashboard-token")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	bodyText := recorder.Body.String()
	if !strings.Contains(bodyText, `"toolNames":["get_dashboard_context"]`) {
		t.Fatalf("expected tool metadata in neo stream, got %s", bodyText)
	}
	if !strings.Contains(bodyText, "Here is the dashboard context.") {
		t.Fatalf("expected synthesized neo reply, got %s", bodyText)
	}
}

func TestDashboardUsersListReturnsAliases(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-20 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-18 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "signup_started",
				Path:      "/pricing",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-15 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/checkout",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-12 * time.Minute),
				SessionID: "session-user-b",
				VisitorID: "visitor-b",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"br":"Safari","os":"iOS","gcc":"IN","grc":"KA"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write user events: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/users?site=demo-site&range=7d&sort=pageviews&order=desc", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.UserList
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode users list: %v", err)
	}
	if payload.Total != 2 {
		t.Fatalf("expected 2 users, got %+v", payload)
	}
	if len(payload.Users) == 0 {
		t.Fatalf("expected users in payload, got %+v", payload)
	}
	if payload.Users[0].Alias == "" || payload.Users[0].Alias == "visitor-a" {
		t.Fatalf("expected fictional alias, got %+v", payload.Users[0])
	}
	if payload.Users[0].UserHash == "visitor-a" {
		t.Fatalf("expected hashed user id, got %+v", payload.Users[0])
	}
	if payload.Users[0].Pageviews != 2 {
		t.Fatalf("expected visitor-a to sort first by pageviews, got %+v", payload.Users[0])
	}
	if !payload.Privacy.Verified {
		t.Fatalf("expected privacy note verification, got %+v", payload.Privacy)
	}
}

func TestDashboardUserDetailReturnsPagesEventsAndSessions(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-25 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-24 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "signup_started",
				Path:      "/pricing",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-20 * time.Minute),
				SessionID: "session-user-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/checkout",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write user detail events: %v", err)
	}
	if err := store.WriteReplay(context.Background(), storage.ReplayWriteBatch{
		Session: storage.ReplayWriteSession{
			SiteID:     "demo-site",
			SessionID:  "session-user-a",
			VisitorID:  "visitor-a",
			StartedAt:  now.Add(-25 * time.Minute),
			UpdatedAt:  now.Add(-20 * time.Minute),
			DurationMS: 300000,
			EntryPath:  "/pricing",
			ExitPath:   "/checkout",
			PageCount:  2,
			RouteCount: 1,
			ChunkCount: 1,
			EventCount: 3,
			DeviceType: "desktop",
			Browser:    "Chrome",
			OS:         "macOS",
			Viewport:   storage.ReplayViewport{Width: 1280, Height: 720, Bucket: "desktop"},
			Paths:      []string{"/pricing", "/checkout"},
		},
		Chunks: []storage.ReplayWriteChunk{{
			SiteID:     "demo-site",
			SessionID:  "session-user-a",
			VisitorID:  "visitor-a",
			Index:      1,
			StartedAt:  now.Add(-25 * time.Minute),
			EndedAt:    now.Add(-20 * time.Minute),
			Path:       "/pricing",
			EventCount: 3,
			EventsJSON: `[]`,
		}},
	}); err != nil {
		t.Fatalf("write user replay: %v", err)
	}

	userHash := storage.UserHash("demo-site", "visitor-a")
	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/users/"+userHash+"?site=demo-site&range=7d", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.UserDetail
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode user detail: %v", err)
	}
	if payload.User.UserHash != userHash {
		t.Fatalf("expected user hash %q, got %+v", userHash, payload.User)
	}
	foundPricing := false
	for _, page := range payload.Pages {
		if page.Label == "/pricing" {
			foundPricing = true
			break
		}
	}
	if !foundPricing {
		t.Fatalf("expected /pricing in page detail, got %+v", payload.Pages)
	}
	if len(payload.Events) == 0 || payload.Events[0].Label != "signup_started" {
		t.Fatalf("expected signup_started event, got %+v", payload.Events)
	}
	if len(payload.Sessions) != 1 || !payload.Sessions[0].HasReplay {
		t.Fatalf("expected one replay-backed session, got %+v", payload.Sessions)
	}
}

func TestDashboardSegmentPreviewReturnsAudience(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-30 * time.Minute),
				SessionID: "segment-session-a",
				VisitorID: "segment-user-a",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-28 * time.Minute),
				SessionID: "segment-session-a",
				VisitorID: "segment-user-a",
				Name:      "purchase",
				Path:      "/checkout",
				Meta:      `{"br":"Chrome","os":"macOS","gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-20 * time.Minute),
				SessionID: "segment-session-b",
				VisitorID: "segment-user-b",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"br":"Safari","os":"iOS","gcc":"IN","grc":"KA"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write segment events: %v", err)
	}

	body := bytes.NewBufferString(`{
		"name": "Pricing visitors",
		"logic": "and",
		"conditions": [{"type":"visited_page","operator":"equals","value":"/pricing"}]
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/dashboard/segments/preview?site=demo-site&range=7d", body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.SegmentPreview
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode segment preview: %v", err)
	}
	if payload.AudienceSize != 1 {
		t.Fatalf("expected audience size 1, got %+v", payload)
	}
	if len(payload.Users) != 1 || payload.Users[0].UserHash != storage.UserHash("demo-site", "segment-user-a") {
		t.Fatalf("expected pricing visitor preview, got %+v", payload.Users)
	}
	if payload.JumpContext["users"] == "" {
		t.Fatalf("expected jump context in preview, got %+v", payload.JumpContext)
	}
}

func TestDashboardCohortReportBehaviorMode(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-48 * time.Hour),
				SessionID: "cohort-session-a",
				VisitorID: "cohort-user-a",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-47 * time.Hour),
				SessionID: "cohort-session-a",
				VisitorID: "cohort-user-a",
				Name:      "purchase",
				Path:      "/checkout",
				Meta:      `{"gcc":"US","grc":"CA"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-24 * time.Hour),
				SessionID: "cohort-session-a-2",
				VisitorID: "cohort-user-a",
				Name:      "pageview",
				Path:      "/return",
				Meta:      `{"gcc":"US","grc":"CA"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write cohort events: %v", err)
	}

	body := bytes.NewBufferString(`{
		"mode": "behavior",
		"cadence": "daily",
		"behavior": {"type":"conversion","operator":"equals","value":"purchase"}
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/dashboard/cohorts/report?site=demo-site&range=30d", body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.CohortAnalysisReport
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode cohort report: %v", err)
	}
	if payload.Mode != "behavior" {
		t.Fatalf("expected behavior mode, got %+v", payload)
	}
	if payload.Summary.Users != 1 {
		t.Fatalf("expected one behavioral cohort user, got %+v", payload.Summary)
	}
	if !payload.Privacy.Verified {
		t.Fatalf("expected verified privacy note, got %+v", payload.Privacy)
	}
}

func TestDashboardRealtimeReturnsTouchedVisitors(t *testing.T) {
	server, _ := newTestServerWithStore(t)
	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-realtime","p":"/"}]`, time.Now().UTC().UnixMilli()))
	collectRequest := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	collectRequest.Header.Set("Content-Type", "application/json")
	collectRequest.Header.Set("Origin", "http://localhost:3000")
	collectRequest.Header.Set("User-Agent", "Mozilla/5.0")
	collectRequest.RemoteAddr = "203.0.113.20:12345"

	collectRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(collectRecorder, collectRequest)
	if collectRecorder.Code != http.StatusAccepted {
		t.Fatalf("expected collect 202, got %d", collectRecorder.Code)
	}

	realtimeRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/realtime?site=demo-site", nil)
	realtimeRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	realtimeRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(realtimeRecorder, realtimeRequest)

	if realtimeRecorder.Code != http.StatusOK {
		t.Fatalf("expected realtime 200, got %d", realtimeRecorder.Code)
	}
	if realtimeRecorder.Header().Get("Deprecation") != "true" {
		t.Fatalf("expected realtime endpoint to advertise deprecation, got headers=%v", realtimeRecorder.Header())
	}

	var payload map[string]any
	if err := json.NewDecoder(realtimeRecorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode realtime response: %v", err)
	}
	if got, _ := payload["visitors"].(float64); got != 1 {
		t.Fatalf("expected realtime visitors=1, got %+v", payload)
	}
}

func TestDashboardSummaryReturnsAggregates(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"r":"https://google.com","vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9 * time.Minute),
				SessionID: "session-1",
				Name:      "scroll",
				Path:      "/pricing",
				Depth:     uint8Ptr(75),
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(42),
				Y:         float32PtrTest(31),
				Meta:      `{"rg":true,"vw":390,"vh":844}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/summary?site=demo-site&range=7d", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload storage.DashboardSummary
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode summary response: %v", err)
	}

	if payload.Overview.Pageviews != 1 {
		t.Fatalf("expected pageviews=1, got %+v", payload.Overview)
	}
	if payload.Overview.RageClicks != 1 {
		t.Fatalf("expected rage clicks=1, got %+v", payload.Overview)
	}
	if payload.ComparisonRange == "" {
		t.Fatalf("expected comparison range in summary payload, got %+v", payload)
	}
	if payload.Derived.EngagedSessions.Current != 1 {
		t.Fatalf("expected engaged sessions current=1, got %+v", payload.Derived.EngagedSessions)
	}
	if len(payload.OverviewComparison.Pageviews.Trend) != 7 {
		t.Fatalf("expected 7-point overview trend, got %+v", payload.OverviewComparison.Pageviews)
	}
	if len(payload.TopPages) == 0 || payload.TopPages[0].Path != "/pricing" {
		t.Fatalf("expected /pricing top page, got %+v", payload.TopPages)
	}

	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/summary?site=demo-site&range=7d", nil)
	secondRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, secondRequest)

	if got := secondRecorder.Header().Get("X-Cache"); got != "hit" {
		t.Fatalf("expected cached summary response, got X-Cache=%q", got)
	}
}

func TestDashboardMapReturnsGeoRollups(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-11 * time.Minute),
				SessionID: "session-us-1",
				VisitorID: "visitor-us-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","grc":"CA","grn":"California","gci":"San Francisco","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-us-2",
				VisitorID: "visitor-us-2",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","grc":"CA","grn":"California","gci":"San Francisco","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-4 * time.Minute),
				SessionID: "session-us-3",
				VisitorID: "visitor-us-3",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","grc":"CA","grn":"California","gci":"San Francisco","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-in-1",
				VisitorID: "visitor-in-1",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"gcc":"IN","gct":"India","grc":"KA","grn":"Karnataka","gci":"Bengaluru","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-7 * time.Minute),
				SessionID: "session-in-2",
				VisitorID: "visitor-in-2",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"gcc":"IN","gct":"India","grc":"KA","grn":"Karnataka","gci":"Bengaluru","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-6 * time.Minute),
				SessionID: "session-unknown",
				VisitorID: "visitor-unknown",
				Name:      "pageview",
				Path:      "/contact",
				Meta:      `{}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * 24 * time.Hour),
				SessionID: "session-prev-us",
				VisitorID: "visitor-prev-us",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","grc":"CA","grn":"California","gci":"San Francisco","gp":"city"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8*24*time.Hour - 2*time.Hour),
				SessionID: "session-prev-in",
				VisitorID: "visitor-prev-in",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"gcc":"IN","gct":"India","grc":"KA","grn":"Karnataka","gci":"Bengaluru","gp":"city"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write batch: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/map?site=demo-site&range=7d", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.MapView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode map response: %v", err)
	}

	if payload.Summary.Pageviews != 6 || payload.Summary.LocatedVisitors != 5 {
		t.Fatalf("expected 5 located visitors across 6 pageviews, got %+v", payload.Summary)
	}
	if payload.Summary.UnknownVisitors != 1 {
		t.Fatalf("expected 1 unknown visitor, got %+v", payload.Summary)
	}
	if len(payload.Countries) < 2 || payload.Countries[0].CountryCode != "US" {
		t.Fatalf("expected US to lead country rollup, got %+v", payload.Countries)
	}
	if len(payload.Cities) == 0 || payload.Cities[0].City != "San Francisco" {
		t.Fatalf("expected privacy-safe city aggregate, got %+v", payload.Cities)
	}
	if payload.Summary.PrivacyFloor != 3 {
		t.Fatalf("expected privacy floor 3, got %+v", payload.Summary)
	}
	if payload.ComparisonRange == "" || payload.Signals.GeneratedAt == "" {
		t.Fatalf("expected comparison/freshness metadata, got %+v", payload)
	}
	if payload.Signals.Realtime.WindowMinutes != 5 || payload.Signals.Realtime.ActiveVisitors != 1 {
		t.Fatalf("expected realtime window 5m with 1 active visitor, got %+v", payload.Signals.Realtime)
	}
	if len(payload.Signals.Realtime.ActiveCountries) == 0 || payload.Signals.Realtime.ActiveCountries[0].CountryCode != "US" {
		t.Fatalf("expected US to lead active countries, got %+v", payload.Signals.Realtime.ActiveCountries)
	}
	if len(payload.Signals.Growth.Leaders) == 0 || payload.Signals.Growth.Leaders[0].CountryCode != "US" {
		t.Fatalf("expected US to lead growth, got %+v", payload.Signals.Growth.Leaders)
	}
	if payload.Signals.Confidence.CoverageConfidence != payload.Summary.CoverageConfidence {
		t.Fatalf("expected confidence signal to mirror summary confidence, got summary=%+v signals=%+v", payload.Summary, payload.Signals.Confidence)
	}
	if payload.Signals.Privacy.WithheldVisitors != payload.Summary.WithheldVisitors || payload.Signals.Privacy.WithheldShare != payload.Summary.WithheldShare {
		t.Fatalf("expected privacy signal to mirror summary withheld stats, got summary=%+v signals=%+v", payload.Summary, payload.Signals.Privacy)
	}
	if payload.Signals.Payload.RegionRows != len(payload.Regions) || payload.Signals.Payload.CityRows != len(payload.Cities) || payload.Signals.Payload.WithheldRows != len(payload.Withheld) {
		t.Fatalf("expected payload row counts to match response slices, got %+v", payload.Signals.Payload)
	}
}

func TestDashboardEventExplorerSupportsPathFilterAndLiveSignals(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	if err := store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "page_view",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","dt":"desktop"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9*time.Minute - 30*time.Second),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "signup complete",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","dt":"desktop","pr":{"plan":"pro"}}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9*time.Minute - 29*time.Second),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "signup complete",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","dt":"desktop","pr":{"plan":"pro"}}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-b",
				VisitorID: "visitor-b",
				Name:      "signup_complete",
				Path:      "/pricing",
				Meta:      `{"gcc":"IN","gct":"India","dt":"mobile","pr":{"plan":"starter"}}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-7 * time.Minute),
				SessionID: "session-c",
				VisitorID: "visitor-c",
				Name:      "signup-complete",
				Path:      "/pricing",
				Meta:      `{"gcc":"GB","gct":"United Kingdom","dt":"desktop","pr":{"plan":"team"}}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-2 * time.Minute),
				SessionID: "session-d",
				VisitorID: "visitor-d",
				Name:      "pageview",
				Path:      "/docs",
				Meta:      `{"gcc":"US","gct":"United States","dt":"desktop"}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * 24 * time.Hour),
				SessionID: "session-prev-a",
				VisitorID: "visitor-prev-a",
				Name:      "signup_complete",
				Path:      "/pricing",
				Meta:      `{"gcc":"US","gct":"United States","dt":"desktop"}`,
			},
		},
	}); err != nil {
		t.Fatalf("write batch: %v", err)
	}

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/events/explorer?site=demo-site&range=7d&path=%2Fpricing", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	var payload storage.EventExplorerView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode event explorer response: %v", err)
	}

	if payload.SelectedPath != "/pricing" {
		t.Fatalf("expected selected path /pricing, got %+v", payload)
	}
	if len(payload.Paths) == 0 || payload.Paths[0].Path != "/pricing" {
		t.Fatalf("expected path options headed by /pricing, got %+v", payload.Paths)
	}
	if payload.Summary.DeduplicatedEvents != 1 {
		t.Fatalf("expected one deduplicated event, got %+v", payload.Summary)
	}
	if payload.Live.WindowMinutes != 15 || payload.Live.ActivePages[0].Label != "/pricing" {
		t.Fatalf("expected merged live activity for /pricing, got %+v", payload.Live)
	}
	if len(payload.Families) == 0 {
		t.Fatalf("expected family summaries, got %+v", payload)
	}
	if len(payload.Catalog) == 0 || payload.Catalog[0].Name != "signup_complete" {
		t.Fatalf("expected normalized signup_complete catalog entry, got %+v", payload.Catalog)
	}
	for _, item := range payload.LiveFeed {
		if item.Path != "/pricing" {
			t.Fatalf("expected path-filtered live feed, got %+v", payload.LiveFeed)
		}
	}
}

func TestDashboardSummaryRejectsUnknownSiteID(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "veoilanna-53de67",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/",
				Meta:      `{"r":"https://google.com","vw":390,"vh":844}`,
			},
			{
				SiteID:    "veoilanna-53de67",
				Timestamp: now.Add(-9 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/",
				X:         float32PtrTest(42),
				Y:         float32PtrTest(31),
				Meta:      `{"rg":true,"vw":390,"vh":844}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/summary?site=veoilanna-53de67&range=7d", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestDashboardFunnelReturnsOrderedConversion(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-30 * time.Minute),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-29 * time.Minute),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-28 * time.Minute),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "add_to_cart",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-27 * time.Minute),
				SessionID: "session-a",
				VisitorID: "visitor-a",
				Name:      "purchase",
				Path:      "/checkout",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-24 * time.Minute),
				SessionID: "session-b",
				VisitorID: "visitor-b",
				Name:      "pageview",
				Path:      "/",
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-23 * time.Minute),
				SessionID: "session-b",
				VisitorID: "visitor-b",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-20 * time.Minute),
				SessionID: "session-c",
				VisitorID: "visitor-c",
				Name:      "pageview",
				Path:      "/",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-19 * time.Minute),
				SessionID: "session-c",
				VisitorID: "visitor-c",
				Name:      "add_to_cart",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
		},
	})

	body := bytes.NewBufferString(`{
		"countMode":"visitors",
		"windowMinutes":30,
		"steps":[
			{"label":"Landing","kind":"page","matchType":"exact","value":"/"},
			{"label":"Pricing","kind":"page","matchType":"exact","value":"/pricing"},
			{"label":"Cart","kind":"event","matchType":"exact","value":"add_to_cart"},
			{"label":"Purchase","kind":"event","matchType":"exact","value":"purchase"}
		]
	}`)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/dashboard/funnel?site=demo-site&range=7d", body)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload storage.FunnelReport
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode funnel response: %v", err)
	}

	if payload.Entrants != 3 || payload.Completions != 1 {
		t.Fatalf("expected entrants/completions 3/1, got %+v", payload)
	}
	if len(payload.Steps) != 4 {
		t.Fatalf("expected four funnel steps, got %+v", payload.Steps)
	}
	if payload.Steps[0].Count != 3 || payload.Steps[1].Count != 2 || payload.Steps[2].Count != 1 || payload.Steps[3].Count != 1 {
		t.Fatalf("unexpected step counts: %+v", payload.Steps)
	}
	if payload.OverallConversionRate != 33.3 {
		t.Fatalf("expected overall conversion 33.3, got %+v", payload)
	}
	if payload.Steps[1].DropOffCount != 1 || payload.Steps[2].DropOffCount != 1 {
		t.Fatalf("expected drop-off counts 1/1 on middle steps, got %+v", payload.Steps)
	}
}

func TestDashboardHeatmapIncludesMoveLayer(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(42.26),
				Y:         float32PtrTest(31.74),
				Meta:      `{"rg":true,"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-1",
				Name:      "move",
				Path:      "/pricing",
				X:         float32PtrTest(42.31),
				Y:         float32PtrTest(31.81),
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-7 * time.Minute),
				SessionID: "session-1",
				Name:      "move",
				Path:      "/pricing",
				X:         float32PtrTest(42.34),
				Y:         float32PtrTest(31.79),
				Meta:      `{"vw":390,"vh":844}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()

	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload storage.HeatmapView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode heatmap response: %v", err)
	}

	if payload.Totals.Clicks != 1 || payload.Totals.RageClicks != 1 {
		t.Fatalf("expected click/rage totals=1, got %+v", payload.Totals)
	}
	if payload.Totals.MoveEvents != 2 {
		t.Fatalf("expected move events=2, got %+v", payload.Totals)
	}
	if len(payload.Buckets) != 1 {
		t.Fatalf("expected one click bucket, got %+v", payload.Buckets)
	}
	if payload.Buckets[0].X != 42.3 || payload.Buckets[0].Y != 31.7 {
		t.Fatalf("expected rounded click bucket 42.3/31.7, got %+v", payload.Buckets[0])
	}
	if len(payload.MoveBuckets) != 1 {
		t.Fatalf("expected one move bucket, got %+v", payload.MoveBuckets)
	}
	if payload.MoveBuckets[0].Count != 2 || payload.MoveBuckets[0].X != 42.3 || payload.MoveBuckets[0].Y != 31.8 {
		t.Fatalf("expected move bucket 42.3/31.8 count=2, got %+v", payload.MoveBuckets[0])
	}
}

func TestDashboardHeatmapModeFilters(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(42.26),
				Y:         float32PtrTest(31.74),
				Meta:      `{"rg":true,"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8*time.Minute + 5*time.Second),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(64.1),
				Y:         float32PtrTest(54.2),
				Meta:      `{"dg":true,"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8*time.Minute + 10*time.Second),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(25.8),
				Y:         float32PtrTest(72.9),
				Meta:      `{"eg":true,"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-1",
				Name:      "move",
				Path:      "/pricing",
				X:         float32PtrTest(42.31),
				Y:         float32PtrTest(31.81),
				Meta:      `{"vw":390,"vh":844}`,
			},
		},
	})

	rageRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&mode=rage&clickFilter=all", nil)
	rageRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	rageRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(rageRecorder, rageRequest)

	if rageRecorder.Code != http.StatusOK {
		t.Fatalf("expected rage mode 200, got %d", rageRecorder.Code)
	}
	var ragePayload storage.HeatmapView
	if err := json.NewDecoder(rageRecorder.Body).Decode(&ragePayload); err != nil {
		t.Fatalf("decode rage heatmap response: %v", err)
	}
	if ragePayload.Mode != "rage" || ragePayload.ClickFilter != "rage" {
		t.Fatalf("expected rage mode/filter, got mode=%q filter=%q", ragePayload.Mode, ragePayload.ClickFilter)
	}
	if len(ragePayload.Buckets) != 1 || ragePayload.Buckets[0].Count != 1 || ragePayload.Buckets[0].RageCount != 1 {
		t.Fatalf("expected single rage bucket, got %+v", ragePayload.Buckets)
	}
	if len(ragePayload.MoveBuckets) != 0 {
		t.Fatalf("expected no move buckets in rage mode, got %+v", ragePayload.MoveBuckets)
	}

	moveRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&mode=move", nil)
	moveRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	moveRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(moveRecorder, moveRequest)

	if moveRecorder.Code != http.StatusOK {
		t.Fatalf("expected move mode 200, got %d", moveRecorder.Code)
	}
	var movePayload storage.HeatmapView
	if err := json.NewDecoder(moveRecorder.Body).Decode(&movePayload); err != nil {
		t.Fatalf("decode move heatmap response: %v", err)
	}
	if movePayload.Mode != "move" {
		t.Fatalf("expected move mode, got %q", movePayload.Mode)
	}
	if len(movePayload.Buckets) != 0 {
		t.Fatalf("expected no click buckets in move mode, got %+v", movePayload.Buckets)
	}
	if len(movePayload.MoveBuckets) != 1 || movePayload.MoveBuckets[0].Count != 1 {
		t.Fatalf("expected one move bucket in move mode, got %+v", movePayload.MoveBuckets)
	}

	deadRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&mode=click&clickFilter=dead", nil)
	deadRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	deadRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(deadRecorder, deadRequest)

	if deadRecorder.Code != http.StatusOK {
		t.Fatalf("expected dead filter 200, got %d", deadRecorder.Code)
	}
	var deadPayload storage.HeatmapView
	if err := json.NewDecoder(deadRecorder.Body).Decode(&deadPayload); err != nil {
		t.Fatalf("decode dead-filter heatmap response: %v", err)
	}
	if deadPayload.ClickFilter != "dead" {
		t.Fatalf("expected dead click filter, got %q", deadPayload.ClickFilter)
	}
	if deadPayload.Totals.DeadClicks != 1 || len(deadPayload.Buckets) != 1 || deadPayload.Buckets[0].Count != 1 {
		t.Fatalf("expected one dead-click bucket, got totals=%+v buckets=%+v", deadPayload.Totals, deadPayload.Buckets)
	}

	errorRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&mode=click&clickFilter=error", nil)
	errorRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	errorRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(errorRecorder, errorRequest)

	if errorRecorder.Code != http.StatusOK {
		t.Fatalf("expected error filter 200, got %d", errorRecorder.Code)
	}
	var errorPayload storage.HeatmapView
	if err := json.NewDecoder(errorRecorder.Body).Decode(&errorPayload); err != nil {
		t.Fatalf("decode error-filter heatmap response: %v", err)
	}
	if errorPayload.ClickFilter != "error" {
		t.Fatalf("expected error click filter, got %q", errorPayload.ClickFilter)
	}
	if errorPayload.Totals.ErrorClicks != 1 || len(errorPayload.Buckets) != 1 || errorPayload.Buckets[0].Count != 1 {
		t.Fatalf("expected one error-click bucket, got totals=%+v buckets=%+v", errorPayload.Totals, errorPayload.Buckets)
	}
}

func TestDashboardHeatmapViewportSegmentFilter(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-10 * time.Minute),
				SessionID: "session-mobile",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-9 * time.Minute),
				SessionID: "session-mobile",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(42.2),
				Y:         float32PtrTest(31.8),
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-8 * time.Minute),
				SessionID: "session-desktop",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-7 * time.Minute),
				SessionID: "session-desktop",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(59.1),
				Y:         float32PtrTest(44.6),
				Meta:      `{"vw":1280,"vh":800}`,
			},
		},
	})

	mobileRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&viewport=mobile", nil)
	mobileRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	mobileRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(mobileRecorder, mobileRequest)

	if mobileRecorder.Code != http.StatusOK {
		t.Fatalf("expected mobile viewport request 200, got %d", mobileRecorder.Code)
	}
	var mobilePayload storage.HeatmapView
	if err := json.NewDecoder(mobileRecorder.Body).Decode(&mobilePayload); err != nil {
		t.Fatalf("decode mobile viewport heatmap response: %v", err)
	}
	if mobilePayload.ViewportSegment != "mobile" {
		t.Fatalf("expected viewport segment mobile, got %q", mobilePayload.ViewportSegment)
	}
	if mobilePayload.Totals.Clicks != 1 {
		t.Fatalf("expected one mobile click, got totals=%+v", mobilePayload.Totals)
	}

	desktopRequest := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing&viewport=desktop", nil)
	desktopRequest.Header.Set("Authorization", "Bearer demo-dashboard-token")
	desktopRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(desktopRecorder, desktopRequest)

	if desktopRecorder.Code != http.StatusOK {
		t.Fatalf("expected desktop viewport request 200, got %d", desktopRecorder.Code)
	}
	var desktopPayload storage.HeatmapView
	if err := json.NewDecoder(desktopRecorder.Body).Decode(&desktopPayload); err != nil {
		t.Fatalf("decode desktop viewport heatmap response: %v", err)
	}
	if desktopPayload.ViewportSegment != "desktop" {
		t.Fatalf("expected viewport segment desktop, got %q", desktopPayload.ViewportSegment)
	}
	if desktopPayload.Totals.Clicks != 1 {
		t.Fatalf("expected one desktop click, got totals=%+v", desktopPayload.Totals)
	}
}

func TestDashboardHeatmapIncludesDocumentHint(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-6 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-5 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(40.3),
				Y:         float32PtrTest(28.4),
				Meta:      `{"vw":1280,"vh":800,"dw":1280,"dh":3200}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var payload storage.HeatmapView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode heatmap response: %v", err)
	}
	if payload.Document.Width != 1280 || payload.Document.Height != 3200 {
		t.Fatalf("expected document hint 1280x3200, got %+v", payload.Document)
	}
}

func TestDashboardHeatmapIncludesHoverAttention(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	selector := "[data-track-id='hero-cta']"
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-6 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-5 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(40.3),
				Y:         float32PtrTest(28.4),
				Selector:  &selector,
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-4 * time.Minute),
				SessionID: "session-1",
				Name:      "hover",
				Path:      "/pricing",
				X:         float32PtrTest(40.3),
				Y:         float32PtrTest(28.4),
				Selector:  &selector,
				Meta:      `{"vw":1280,"vh":800,"hd":1200}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/pricing", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var payload storage.HeatmapView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode heatmap response: %v", err)
	}
	if payload.Totals.HoverEvents != 1 || payload.Totals.HoverMS != 1200 {
		t.Fatalf("expected hover totals 1/1200, got %+v", payload.Totals)
	}
	if len(payload.Buckets) != 1 || payload.Buckets[0].Weight <= 1 {
		t.Fatalf("expected click bucket with dwell-weighted intensity, got %+v", payload.Buckets)
	}
	if len(payload.Selectors) == 0 || payload.Selectors[0].HoverEvents != 1 || payload.Selectors[0].HoverMS != 1200 {
		t.Fatalf("expected selector hover stats, got %+v", payload.Selectors)
	}
}

func TestDashboardHeatmapIncludesBlockedZoneAndConfidenceMetadata(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	blockedSelector := "Blocked zone"
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-6 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/checkout",
				Meta:      `{"vw":1280,"vh":800}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-5 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/checkout",
				X:         float32PtrTest(55.04),
				Y:         float32PtrTest(22.08),
				Selector:  &blockedSelector,
				Meta:      `{"vw":1280,"vh":800,"bz":true}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-4 * time.Minute),
				SessionID: "session-1",
				Name:      "hover",
				Path:      "/checkout",
				X:         float32PtrTest(55.01),
				Y:         float32PtrTest(22.11),
				Selector:  &blockedSelector,
				Meta:      `{"vw":1280,"vh":800,"bz":true,"hd":700}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/heatmap?site=demo-site&range=7d&path=/checkout", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}
	var payload storage.HeatmapView
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode heatmap response: %v", err)
	}
	if payload.Totals.BlockedZoneEvents != 2 || payload.Totals.BlockedZoneClicks != 1 || payload.Totals.BlockedZoneHovers != 1 {
		t.Fatalf("expected blocked-zone totals 2/1/1, got %+v", payload.Totals)
	}
	if payload.Confidence.Trust == "" || payload.Confidence.Explanation == "" || payload.Confidence.BlockedZones != 2 {
		t.Fatalf("expected confidence trust/explanation/blocked zone metadata, got %+v", payload.Confidence)
	}
	if len(payload.Selectors) == 0 || !payload.Selectors[0].BlockedZone {
		t.Fatalf("expected blocked-zone selector metadata, got %+v", payload.Selectors)
	}
	if payload.Selectors[0].CenterX != 55 || payload.Selectors[0].CenterY != 22.1 {
		t.Fatalf("expected selector center 55/22.1, got %+v", payload.Selectors[0])
	}
}

func TestDashboardAIInsightEndpointReturnsRuleBasedPayload(t *testing.T) {
	server, store := newTestServerWithStore(t)
	now := time.Now().UTC()
	store.WriteBatch(context.Background(), ingest.WriteBatch{
		Events: []ingest.StoredEvent{
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-15 * time.Minute),
				SessionID: "session-1",
				Name:      "pageview",
				Path:      "/pricing",
				Meta:      `{"r":"https://google.com","vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-14 * time.Minute),
				SessionID: "session-1",
				Name:      "scroll",
				Path:      "/pricing",
				Depth:     uint8Ptr(25),
				Meta:      `{"vw":390,"vh":844}`,
			},
			{
				SiteID:    "demo-site",
				Timestamp: now.Add(-13 * time.Minute),
				SessionID: "session-1",
				Name:      "click",
				Path:      "/pricing",
				X:         float32PtrTest(42.2),
				Y:         float32PtrTest(31.8),
				Meta:      `{"rg":true,"vw":390,"vh":844}`,
			},
		},
	})

	request := httptest.NewRequest(http.MethodGet, "/api/v1/dashboard/ai-insight?site=demo-site&range=7d", nil)
	request.Header.Set("Authorization", "Bearer demo-dashboard-token")
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", recorder.Code)
	}

	var payload aiInsightsResponse
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode ai-insight response: %v", err)
	}

	if payload.Engine.Mode != "rules_only" {
		t.Fatalf("expected rules_only mode when AI is disabled, got %+v", payload.Engine)
	}
	if payload.Summary.Total == 0 || len(payload.Items) == 0 {
		t.Fatalf("expected at least one rule-based insight item, got summary=%+v items=%+v", payload.Summary, payload.Items)
	}
	if !payload.Audit.FallbackActivated {
		t.Fatalf("expected fallback audit flag to be true, got %+v", payload.Audit)
	}
}

func newTestServer(t *testing.T) *Server {
	t.Helper()
	server, _ := newTestServerWithStore(t)
	return server
}

func newTestServerWithStore(t *testing.T) (*Server, *storage.MemoryStore) {
	return newTestServerWithConfig(t, nil)
}

func newTestServerWithConfig(t *testing.T, mutate func(*config.Config)) (*Server, *storage.MemoryStore) {
	t.Helper()

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	store := storage.NewMemoryStore()
	batcher := ingest.NewBatchWriter(store, ingest.BatchWriterConfig{
		FlushInterval:   10 * time.Millisecond,
		MaxItems:        1,
		QueueCapacity:   16,
		ShutdownTimeout: time.Second,
	}, logger, nil)

	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	batcher.Start(ctx)

	cfg := config.Config{
		HTTPPort:              "8080",
		Storage:               "memory",
		FlushInterval:         10 * time.Millisecond,
		QueueCapacity:         16,
		BatchMaxItems:         1,
		ShutdownTimeout:       time.Second,
		TrackerCacheTTL:       time.Hour,
		DashboardToken:        "demo-dashboard-token",
		AnalyticsServiceToken: "service-token",
		AdminToken:            "demo-admin-token",
		RateLimitPerSite:      1000,
		RateLimitBurst:        200,
		RateLimitInterval:     time.Minute,
		RateLimitTrackedSites: 128,
		IdentityCacheSize:     1024,
		IdentityCacheTTL:      time.Hour,
		EventRetentionDays:    365,
		HeatmapRetentionDays:  90,
		InsightRetentionDays:  180,
		Sites: map[string]config.Site{
			"demo-site": {
				ID:                         "demo-site",
				Name:                       "Demo Site",
				Salt:                       "test-salt",
				Origins:                    []string{"http://localhost:3000"},
				BlockBotTrafficEnabled:     true,
				SPATrackingEnabled:         true,
				ErrorTrackingEnabled:       true,
				PerformanceTrackingEnabled: true,
			},
		},
	}

	if mutate != nil {
		mutate(&cfg)
	}

	return New(cfg, controlplane.NewStaticSiteRegistry(cfg.Sites), nil, nil, batcher, store, store, store, store, store, nil, nil, logger), store
}

func uint8Ptr(value uint8) *uint8 {
	return &value
}

func float32PtrTest(value float32) *float32 {
	return &value
}

package httpapi

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"anlticsheat/api/internal/config"
)

func TestPrepareDashboardImportPlanBuildsPreviewAndEvents(t *testing.T) {
	server := &Server{}
	payload := dashboardImportPayload{
		Platform:      "plausible",
		FileName:      "plausible.csv",
		ContentType:   "text/csv",
		ContentBase64: base64.StdEncoding.EncodeToString([]byte("date,page,pageviews,visitors\n2026-03-01,/pricing,3,2\n2026-03-02,/blog,2,1\n2026-03-03,,4,2\n")),
	}

	plan, err := server.prepareDashboardImportPlan(
		config.Site{ID: "demo-site", Origins: []string{"https://example.com"}},
		payload,
		siteImportDefaults{Mapping: map[string]string{}, Timezone: "UTC"},
	)
	if err != nil {
		t.Fatalf("prepare import plan: %v", err)
	}
	if plan.DetectedFormat != "csv" {
		t.Fatalf("expected csv format, got %q", plan.DetectedFormat)
	}
	if plan.TotalRows != 3 || plan.ValidRows != 2 || plan.InvalidRows != 1 {
		t.Fatalf("unexpected row counts: %+v", plan)
	}
	if got := plan.Mapping["path"]; got != "page" {
		t.Fatalf("expected path mapping to page, got %q", got)
	}
	if got := plan.Mapping["timestamp"]; got != "date" {
		t.Fatalf("expected timestamp mapping to date, got %q", got)
	}
	if len(plan.Events) != 5 {
		t.Fatalf("expected 5 imported events, got %d", len(plan.Events))
	}
	if len(plan.Paths) != 2 || plan.Paths[0] != "/blog" || plan.Paths[1] != "/pricing" {
		t.Fatalf("unexpected imported paths: %+v", plan.Paths)
	}
	if len(plan.Errors) != 1 || plan.Errors[0].Code != "missing_path" {
		t.Fatalf("expected one missing_path error, got %+v", plan.Errors)
	}
}

func TestCollectEndpointAllowsBotsWhenDisabled(t *testing.T) {
	server, store := newTestServerWithConfig(t, func(cfg *config.Config) {
		site := cfg.Sites["demo-site"]
		site.BlockBotTrafficEnabled = false
		cfg.Sites["demo-site"] = site
	})

	body := []byte(fmt.Sprintf(`[{"e":"pageview","t":%d,"sid":"session-bot","p":"/pricing"}]`, time.Now().UTC().UnixMilli()))
	request := httptest.NewRequest(http.MethodPost, "/collect?site_id=demo-site", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://localhost:3000")
	request.Header.Set("User-Agent", "curl/8.7.1")

	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusAccepted {
		t.Fatalf("expected 202, got %d body=%s", recorder.Code, recorder.Body.String())
	}

	deadline := time.Now().Add(250 * time.Millisecond)
	for time.Now().Before(deadline) {
		if stats := store.Stats(); stats.Events == 1 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}

	t.Fatalf("expected bot traffic to be stored when blocking is disabled, got %+v", store.Stats())
}

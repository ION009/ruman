package config

import "testing"

func TestSiteAllowsOriginLoopbackAlias(t *testing.T) {
	site := Site{
		ID:      "demo-site",
		Origins: []string{"http://localhost:3001"},
	}

	if !site.AllowsOrigin("http://127.0.0.1:3001") {
		t.Fatalf("expected loopback alias to be allowed")
	}
}

func TestSiteAllowsOriginDifferentLoopbackPort(t *testing.T) {
	site := Site{
		ID:      "demo-site",
		Origins: []string{"http://localhost:3001"},
	}

	if !site.AllowsOrigin("http://127.0.0.1:3000") {
		t.Fatalf("expected different localhost port to be allowed")
	}
}

func TestSiteRejectsDifferentNonLoopbackPort(t *testing.T) {
	site := Site{
		ID:      "demo-site",
		Origins: []string{"https://example.com:3001"},
	}

	if site.AllowsOrigin("https://example.com:3000") {
		t.Fatalf("expected different non-loopback port to be rejected")
	}
}

func TestSiteAllowsOriginWildcard(t *testing.T) {
	site := Site{
		ID:      "demo-site",
		Origins: []string{"*"},
	}

	if !site.AllowsOrigin("https://example.com") {
		t.Fatalf("expected wildcard origin to be allowed")
	}
}

func TestBoolFromEnv(t *testing.T) {
	t.Setenv("TEST_BOOL_FROM_ENV", "true")
	if !boolFromEnv("TEST_BOOL_FROM_ENV", false) {
		t.Fatalf("expected true to parse as enabled")
	}

	t.Setenv("TEST_BOOL_FROM_ENV", "0")
	if boolFromEnv("TEST_BOOL_FROM_ENV", true) {
		t.Fatalf("expected 0 to parse as disabled")
	}

	t.Setenv("TEST_BOOL_FROM_ENV", "unexpected")
	if !boolFromEnv("TEST_BOOL_FROM_ENV", true) {
		t.Fatalf("expected invalid value to fallback")
	}
}

func TestLoadFallsBackAIInsightsKeyToNeoLongCatKey(t *testing.T) {
	t.Setenv("ANLTICSHEAT_AI_INSIGHTS_API_KEY", "")
	t.Setenv("ANLTICSHEAT_NEO_LONGCAT_API_KEY", "longcat-shared-key")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}
	if cfg.AIInsightsAPIKey != "longcat-shared-key" {
		t.Fatalf("expected AI insights key to reuse neo longcat key, got %q", cfg.AIInsightsAPIKey)
	}
}

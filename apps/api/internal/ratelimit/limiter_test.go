package ratelimit

import (
	"testing"
	"time"
)

func TestLimiterBlocksAfterCapacity(t *testing.T) {
	limiter := New(2, 0, time.Minute, 16)

	if allowed, _ := limiter.Check("site-a"); !allowed {
		t.Fatal("expected first request to be allowed")
	}
	if allowed, _ := limiter.Check("site-a"); !allowed {
		t.Fatal("expected second request to be allowed")
	}
	if allowed, retryAfter := limiter.Check("site-a"); allowed {
		t.Fatal("expected third request to be blocked")
	} else if retryAfter <= 0 {
		t.Fatalf("expected retry-after to be positive, got %s", retryAfter)
	}
}

func TestLimiterEvictsOldestSites(t *testing.T) {
	limiter := New(1, 0, time.Minute, 2)

	if allowed, _ := limiter.Check("site-a"); !allowed {
		t.Fatal("expected site-a to be allowed")
	}
	if allowed, _ := limiter.Check("site-b"); !allowed {
		t.Fatal("expected site-b to be allowed")
	}
	if allowed, _ := limiter.Check("site-c"); !allowed {
		t.Fatal("expected site-c to be allowed")
	}

	if len(limiter.windows) != 2 {
		t.Fatalf("expected limiter to cap tracked sites at 2, got %d", len(limiter.windows))
	}
	if _, ok := limiter.windows["site-a"]; ok {
		t.Fatal("expected site-a to be evicted as the oldest site")
	}
}

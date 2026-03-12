package identity

import (
	"testing"
	"time"
)

func newTestResolver() *Resolver {
	return NewResolver(1024, time.Hour)
}

func TestResolverCookieWins(t *testing.T) {
	resolver := newTestResolver()
	result := resolver.Resolve(ResolveInput{
		CookieID:  "2d8a9f6f-5cb1-45ad-a5b8-6f2baf37c53f",
		StorageID: "b8fd3226-b9c3-4515-8e8a-8ee88b6494ab",
		DailyHash: "0123456789abcdef0123456789abcdef",
	})

	if result.ID != "2d8a9f6f-5cb1-45ad-a5b8-6f2baf37c53f" {
		t.Fatalf("expected cookie id, got %q", result.ID)
	}
	if result.Source != SourceCookie {
		t.Fatalf("expected source cookie, got %q", result.Source)
	}
}

func TestResolverStorageRestores(t *testing.T) {
	resolver := newTestResolver()
	first := resolver.Resolve(ResolveInput{
		StorageID: "b8fd3226-b9c3-4515-8e8a-8ee88b6494ab",
		DailyHash: "abcdef0123456789abcdef0123456789",
	})
	second := resolver.Resolve(ResolveInput{
		StorageID: "b8fd3226-b9c3-4515-8e8a-8ee88b6494ab",
	})

	if first.ID == "" || second.ID == "" {
		t.Fatal("expected non-empty visitor ids")
	}
	if first.ID != second.ID {
		t.Fatalf("expected storage mapping to be stable, got %q and %q", first.ID, second.ID)
	}
	if second.Source != SourceStorage {
		t.Fatalf("expected source storage, got %q", second.Source)
	}
}

func TestResolverDailyHashFallback(t *testing.T) {
	resolver := newTestResolver()
	first := resolver.Resolve(ResolveInput{
		DailyHash: "fedcba9876543210fedcba9876543210",
	})
	second := resolver.Resolve(ResolveInput{
		DailyHash: "fedcba9876543210fedcba9876543210",
	})

	if first.ID == "" || second.ID == "" {
		t.Fatal("expected non-empty visitor ids")
	}
	if first.ID != second.ID {
		t.Fatalf("expected daily hash mapping to be stable, got %q and %q", first.ID, second.ID)
	}
	if second.Source != SourceDailyHash {
		t.Fatalf("expected source daily_hash, got %q", second.Source)
	}
}

func TestResolverGeneratesUUID(t *testing.T) {
	resolver := newTestResolver()
	result := resolver.Resolve(ResolveInput{})
	if !isUUID(result.ID) {
		t.Fatalf("expected generated uuid, got %q", result.ID)
	}
	if result.Source != SourceNew {
		t.Fatalf("expected source new, got %q", result.Source)
	}
	if !result.IsNew {
		t.Fatal("expected IsNew=true")
	}
}

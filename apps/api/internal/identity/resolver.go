package identity

import (
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"anlticsheat/api/internal/cache"
)

const (
	SourceCookie    = "cookie"
	SourceStorage   = "storage"
	SourceDailyHash = "daily_hash"
	SourceNew       = "new"
)

type ResolveInput struct {
	CookieID  string
	StorageID string
	DailyHash string
}

type ResolveResult struct {
	ID         string
	Confidence float64
	Source     string
	IsNew      bool
}

type Resolver struct {
	mu          sync.Mutex
	visitors    *cache.LRU[string, struct{}]
	storage     *cache.LRU[string, string]
	dailyHashes *cache.LRU[string, string]
}

func NewResolver(maxEntries int, ttl time.Duration) *Resolver {
	return &Resolver{
		visitors:    cache.NewLRU[string, struct{}](maxEntries, ttl),
		storage:     cache.NewLRU[string, string](maxEntries, ttl),
		dailyHashes: cache.NewLRU[string, string](maxEntries, ttl),
	}
}

func (r *Resolver) Resolve(input ResolveInput) ResolveResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now().UTC()

	cookieID := normalizeVisitorID(input.CookieID)
	storageID := normalizeVisitorID(input.StorageID)
	dailyHash := normalizeDailyHash(input.DailyHash)

	if cookieID != "" {
		r.touch(cookieID, now)
		if storageID != "" {
			r.storage.Set(storageID, cookieID, now)
		}
		if dailyHash != "" {
			r.dailyHashes.Set(dailyHash, cookieID, now)
		}
		return ResolveResult{
			ID:         cookieID,
			Confidence: 1,
			Source:     SourceCookie,
		}
	}

	if storageID != "" {
		resolved := storageID
		if existing, ok := r.storage.Get(storageID, now); ok && existing != "" {
			resolved = existing
		}
		r.touch(resolved, now)
		r.storage.Set(storageID, resolved, now)
		if dailyHash != "" {
			r.dailyHashes.Set(dailyHash, resolved, now)
		}
		return ResolveResult{
			ID:         resolved,
			Confidence: 0.99,
			Source:     SourceStorage,
		}
	}

	if dailyHash != "" {
		if existing, ok := r.dailyHashes.Get(dailyHash, now); ok && existing != "" {
			r.touch(existing, now)
			return ResolveResult{
				ID:         existing,
				Confidence: 0.85,
				Source:     SourceDailyHash,
			}
		}
	}

	next := r.newVisitorID()
	r.touch(next, now)
	if dailyHash != "" {
		r.dailyHashes.Set(dailyHash, next, now)
	}
	return ResolveResult{
		ID:         next,
		Confidence: 1,
		Source:     SourceNew,
		IsNew:      true,
	}
}

func (r *Resolver) touch(id string, now time.Time) {
	if id == "" {
		return
	}
	r.visitors.Set(id, struct{}{}, now)
}

func (r *Resolver) newVisitorID() string {
	for {
		id := randomUUID()
		if _, exists := r.visitors.Get(id, time.Now().UTC()); !exists {
			return id
		}
	}
}

func (r *Resolver) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.visitors.Len() + r.storage.Len() + r.dailyHashes.Len()
}

func normalizeVisitorID(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if !isUUID(value) {
		return ""
	}
	return value
}

func normalizeDailyHash(raw string) string {
	value := strings.ToLower(strings.TrimSpace(raw))
	if len(value) != 32 {
		return ""
	}
	for _, char := range value {
		if (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') {
			continue
		}
		return ""
	}
	return value
}

func isUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index := 0; index < len(value); index += 1 {
		switch index {
		case 8, 13, 18, 23:
			if value[index] != '-' {
				return false
			}
			continue
		}

		ch := value[index]
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') {
			continue
		}
		return false
	}
	return true
}

func randomUUID() string {
	var buf [16]byte
	_, _ = rand.Read(buf[:])
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	hexValue := hex.EncodeToString(buf[:])
	return hexValue[0:8] + "-" + hexValue[8:12] + "-" + hexValue[12:16] + "-" + hexValue[16:20] + "-" + hexValue[20:32]
}

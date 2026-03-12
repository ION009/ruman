package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/storage"
)

type publicStatsAccess struct {
	keyID  string
	siteID string
}

func (s *Server) handlePublicStatsSummary(w http.ResponseWriter, r *http.Request) {
	access, ok := s.authorizePublicStats(w, r)
	if !ok {
		return
	}

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	summary, err := s.dashboard.DashboardSummary(r.Context(), access.siteID, rangeValue, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load summary"})
		return
	}
	summary.Overview.RealtimeVisitors = s.currentRealtimeVisitors(access.siteID)
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) handlePublicStatsPages(w http.ResponseWriter, r *http.Request) {
	access, ok := s.authorizePublicStats(w, r)
	if !ok {
		return
	}

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	summary, err := s.dashboard.DashboardSummary(r.Context(), access.siteID, rangeValue, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load pages"})
		return
	}
	writeJSON(w, http.StatusOK, summary.TopPages)
}

func (s *Server) handlePublicStatsReferrers(w http.ResponseWriter, r *http.Request) {
	access, ok := s.authorizePublicStats(w, r)
	if !ok {
		return
	}

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	summary, err := s.dashboard.DashboardSummary(r.Context(), access.siteID, rangeValue, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load referrers"})
		return
	}
	writeJSON(w, http.StatusOK, summary.Referrers)
}

func (s *Server) handlePublicStatsRealtime(w http.ResponseWriter, r *http.Request) {
	access, ok := s.authorizePublicStats(w, r)
	if !ok {
		return
	}

	writeJSON(w, http.StatusOK, map[string]int{
		"visitors": s.currentRealtimeVisitors(access.siteID),
	})
}

func (s *Server) authorizePublicStats(w http.ResponseWriter, r *http.Request) (publicStatsAccess, bool) {
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "public stats are not configured"})
		return publicStatsAccess{}, false
	}

	token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	if !strings.HasPrefix(token, "ak_") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "API key required"})
		return publicStatsAccess{}, false
	}

	keyHash := sha256.Sum256([]byte(token))
	var access publicStatsAccess
	err := s.neonPool.QueryRow(
		r.Context(),
		`SELECT id, site_id FROM analytics_api_keys WHERE key_hash = $1 LIMIT 1`,
		hex.EncodeToString(keyHash[:]),
	).Scan(&access.keyID, &access.siteID)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Invalid API key"})
		return publicStatsAccess{}, false
	}

	if s.statsLimiter != nil {
		if allowed, retryAfter := s.statsLimiter.Check(access.keyID); !allowed {
			w.Header().Set("Retry-After", strconv.Itoa(maxInt(int(retryAfter.Seconds()), 1)))
			writeAPIError(w, errRateLimited.WithMessage("Stats API rate limit exceeded."))
			return publicStatsAccess{}, false
		}
	}

	_, _ = s.neonPool.Exec(r.Context(), `UPDATE analytics_api_keys SET last_used = now() WHERE id = $1`, access.keyID)
	return access, true
}

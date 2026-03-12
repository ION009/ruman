package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"anlticsheat/api/internal/storage"
)

func (s *Server) handleDashboardErrors(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.errors == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "error analytics are not configured"})
		return
	}

	site, ok, err := s.dashboardSiteFromRequest(r)
	if err != nil {
		writeAPIError(w, errSiteLookupFailed)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown site id"})
		return
	}

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	cacheKey := "errors:" + strings.TrimSpace(site.ID) + ":" + rangeValue.String()
	if cached, ok := s.cacheBytes(cacheKey); ok {
		w.Header().Set("X-Cache", "hit")
		writeJSONBytes(w, http.StatusOK, cached)
		return
	}

	view, err := s.errors.ErrorBoard(r.Context(), site.ID, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard errors failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load errors"})
		return
	}

	if payload, err := json.Marshal(view); err == nil {
		s.cacheBytesSet(cacheKey, payload)
		w.Header().Set("X-Cache", "miss")
		writeJSONBytes(w, http.StatusOK, payload)
		return
	}
	writeJSON(w, http.StatusOK, view)
}

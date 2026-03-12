package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/storage"
)

func userListQueryFromRequest(r *http.Request) storage.UserListQuery {
	query := storage.UserListQuery{
		Sort:    strings.TrimSpace(r.URL.Query().Get("sort")),
		Order:   strings.TrimSpace(r.URL.Query().Get("order")),
		Search:  strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("q"), r.URL.Query().Get("search"))),
		Country: strings.TrimSpace(r.URL.Query().Get("country")),
		Region:  strings.TrimSpace(firstNonEmpty(r.URL.Query().Get("state"), r.URL.Query().Get("region"))),
		Browser: strings.TrimSpace(r.URL.Query().Get("browser")),
		OS:      strings.TrimSpace(strings.TrimSpace(r.URL.Query().Get("os"))),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("page")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			query.Page = parsed
		}
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil {
			query.Limit = parsed
		}
	}
	return storage.NormalizeUserListQuery(query)
}

func (s *Server) handleDashboardUsers(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user aggregates are not configured"})
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
	query := userListQueryFromRequest(r)
	if segmentID := strings.TrimSpace(r.URL.Query().Get("segmentId")); segmentID != "" && s.segmentProvider() != nil && s.neonPool != nil {
		definition, segmentErr := s.getSegment(r.Context(), site.ID, segmentID)
		if segmentErr != nil {
			status := http.StatusInternalServerError
			if strings.Contains(strings.ToLower(segmentErr.Error()), "not found") {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to load segment"})
			return
		}
		view, segmentErr := s.segmentProvider().SegmentMembers(r.Context(), site.ID, definition, query, rangeValue, time.Now().UTC())
		if segmentErr != nil {
			s.logger.Error("dashboard users segment filter failed", "site_id", site.ID, "segment_id", segmentID, "error", segmentErr)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load users"})
			return
		}
		writeJSON(w, http.StatusOK, view)
		return
	}
	view, err := s.users.UserList(r.Context(), site.ID, query, rangeValue, time.Now().UTC())
	if err != nil {
		s.logger.Error("dashboard users failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load users"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardUserDetail(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.users == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "user aggregates are not configured"})
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

	userHash := strings.TrimSpace(r.PathValue("userHash"))
	if userHash == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "user hash is required"})
		return
	}

	rangeValue := storage.ParseTimeRange(r.URL.Query().Get("range"))
	view, err := s.users.UserDetail(r.Context(), site.ID, userHash, rangeValue, time.Now().UTC())
	if err != nil {
		status := http.StatusInternalServerError
		if strings.Contains(strings.ToLower(err.Error()), "not found") {
			status = http.StatusNotFound
		}
		s.logger.Error("dashboard user detail failed", "site_id", site.ID, "user_hash", userHash, "error", err)
		writeJSON(w, status, map[string]string{"error": "failed to load user detail"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/storage"
)

type segmentPayload struct {
	Name        string                     `json:"name"`
	Description string                     `json:"description"`
	Logic       string                     `json:"logic"`
	Conditions  []storage.SegmentCondition `json:"conditions"`
}

type cohortReportPayload struct {
	Mode      string                    `json:"mode"`
	Cadence   string                    `json:"cadence"`
	SegmentID string                    `json:"segmentId"`
	Behavior  *storage.SegmentCondition `json:"behavior,omitempty"`
}

func (s *Server) segmentProvider() storage.SegmentAnalyticsProvider {
	provider, _ := s.dashboard.(storage.SegmentAnalyticsProvider)
	return provider
}

func (s *Server) handleDashboardSegments(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment definitions require control-plane storage"})
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

	switch r.Method {
	case http.MethodGet:
		segments, err := s.listSegments(r.Context(), site.ID)
		if err != nil {
			s.logger.Error("list segments failed", "site_id", site.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load segments"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"segments": segments})
	case http.MethodPost:
		payload := segmentPayload{}
		if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		definition := storage.NormalizeSegmentDefinition(storage.SegmentDefinition{
			SiteID:      site.ID,
			Name:        payload.Name,
			Description: payload.Description,
			Logic:       payload.Logic,
			Conditions:  payload.Conditions,
		})
		if err := validateSegmentDefinition(definition); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		created, err := s.createSegment(r.Context(), definition)
		if err != nil {
			s.logger.Error("create segment failed", "site_id", site.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create segment"})
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardSegmentByID(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment definitions require control-plane storage"})
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

	segmentID := strings.TrimSpace(r.PathValue("segmentId"))
	if segmentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "segment id is required"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		definition, err := s.getSegment(r.Context(), site.ID, segmentID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errSegmentNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to load segment"})
			return
		}
		writeJSON(w, http.StatusOK, definition)
	case http.MethodPut:
		payload := segmentPayload{}
		if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		definition := storage.NormalizeSegmentDefinition(storage.SegmentDefinition{
			ID:          segmentID,
			SiteID:      site.ID,
			Name:        payload.Name,
			Description: payload.Description,
			Logic:       payload.Logic,
			Conditions:  payload.Conditions,
		})
		if err := validateSegmentDefinition(definition); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		updated, err := s.updateSegment(r.Context(), definition)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errSegmentNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to update segment"})
			return
		}
		writeJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := s.deleteSegment(r.Context(), site.ID, segmentID); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errSegmentNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to delete segment"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "segmentId": segmentID})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardSegmentPreview(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	provider := s.segmentProvider()
	if provider == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment analytics are not configured"})
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

	payload := segmentPayload{}
	if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	definition := storage.NormalizeSegmentDefinition(storage.SegmentDefinition{
		SiteID:      site.ID,
		Name:        payload.Name,
		Description: payload.Description,
		Logic:       payload.Logic,
		Conditions:  payload.Conditions,
	})
	if err := validateSegmentDefinition(definition); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	view, err := provider.PreviewSegment(r.Context(), site.ID, definition, userListQueryFromRequest(r), storage.ParseTimeRange(r.URL.Query().Get("range")), time.Now().UTC())
	if err != nil {
		s.logger.Error("segment preview failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to preview segment"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardSegmentMembers(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	provider := s.segmentProvider()
	if provider == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment analytics are not configured"})
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment definitions require control-plane storage"})
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
	segmentID := strings.TrimSpace(r.PathValue("segmentId"))
	if segmentID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "segment id is required"})
		return
	}
	definition, err := s.getSegment(r.Context(), site.ID, segmentID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errSegmentNotFound) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": "failed to load segment"})
		return
	}

	view, err := provider.SegmentMembers(r.Context(), site.ID, definition, userListQueryFromRequest(r), storage.ParseTimeRange(r.URL.Query().Get("range")), time.Now().UTC())
	if err != nil {
		s.logger.Error("segment members failed", "site_id", site.ID, "segment_id", segmentID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load segment members"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

func (s *Server) handleDashboardCohortReport(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	provider := s.segmentProvider()
	if provider == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "cohort analytics are not configured"})
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

	payload := cohortReportPayload{}
	if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	query := storage.CohortAnalysisQuery{
		Mode:     strings.TrimSpace(payload.Mode),
		Cadence:  strings.TrimSpace(payload.Cadence),
		Behavior: payload.Behavior,
	}
	if strings.TrimSpace(payload.SegmentID) != "" {
		if s.neonPool == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "segment definitions require control-plane storage"})
			return
		}
		definition, err := s.getSegment(r.Context(), site.ID, payload.SegmentID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errSegmentNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to load segment"})
			return
		}
		query.Segment = &definition
	}

	view, err := provider.CohortAnalysis(r.Context(), site.ID, query, storage.ParseTimeRange(r.URL.Query().Get("range")), time.Now().UTC())
	if err != nil {
		s.logger.Error("cohort report failed", "site_id", site.ID, "error", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load cohort report"})
		return
	}
	writeJSON(w, http.StatusOK, view)
}

var errSegmentNotFound = errors.New("segment not found")

func validateSegmentDefinition(definition storage.SegmentDefinition) error {
	if strings.TrimSpace(definition.Name) == "" {
		return errors.New("segment name is required")
	}
	if len(definition.Conditions) == 0 {
		return errors.New("at least one segment condition is required")
	}
	for index, condition := range definition.Conditions {
		switch condition.Type {
		case "visited_page", "triggered_event", "country", "browser", "device", "conversion", "property":
		default:
			return errors.New("segment condition " + strconvString(index+1) + " has an unsupported type")
		}
		if condition.Type == "property" && strings.TrimSpace(condition.PropertyKey) == "" {
			return errors.New("property conditions require propertyKey")
		}
		if condition.Type != "conversion" && strings.TrimSpace(condition.Value) == "" {
			return errors.New("segment condition " + strconvString(index+1) + " requires a value")
		}
	}
	return nil
}

func (s *Server) listSegments(ctx context.Context, siteID string) ([]storage.SegmentDefinition, error) {
	rows, err := s.neonPool.Query(ctx, `
		SELECT id, name, description, logic, conditions_json, created_at, updated_at
		FROM analytics_segments
		WHERE site_id = $1
		ORDER BY created_at DESC
	`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	definitions := []storage.SegmentDefinition{}
	for rows.Next() {
		definition, scanErr := scanSegmentRow(rows, siteID)
		if scanErr != nil {
			return nil, scanErr
		}
		definitions = append(definitions, definition)
	}
	return definitions, rows.Err()
}

func (s *Server) getSegment(ctx context.Context, siteID, segmentID string) (storage.SegmentDefinition, error) {
	rows, err := s.neonPool.Query(ctx, `
		SELECT id, name, description, logic, conditions_json, created_at, updated_at
		FROM analytics_segments
		WHERE site_id = $1 AND id = $2
		LIMIT 1
	`, siteID, segmentID)
	if err != nil {
		return storage.SegmentDefinition{}, err
	}
	defer rows.Close()
	if !rows.Next() {
		return storage.SegmentDefinition{}, errSegmentNotFound
	}
	return scanSegmentRow(rows, siteID)
}

func (s *Server) createSegment(ctx context.Context, definition storage.SegmentDefinition) (storage.SegmentDefinition, error) {
	definition.ID = neoID("seg", definition.Name+time.Now().UTC().String())
	conditionsJSON, err := json.Marshal(definition.Conditions)
	if err != nil {
		return storage.SegmentDefinition{}, err
	}
	var createdAt time.Time
	var updatedAt time.Time
	if err := s.neonPool.QueryRow(ctx, `
		INSERT INTO analytics_segments (id, site_id, name, description, logic, conditions_json, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb, now(), now())
		RETURNING created_at, updated_at
	`, definition.ID, definition.SiteID, definition.Name, definition.Description, definition.Logic, string(conditionsJSON)).Scan(&createdAt, &updatedAt); err != nil {
		return storage.SegmentDefinition{}, err
	}
	definition.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	definition.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return definition, nil
}

func (s *Server) updateSegment(ctx context.Context, definition storage.SegmentDefinition) (storage.SegmentDefinition, error) {
	conditionsJSON, err := json.Marshal(definition.Conditions)
	if err != nil {
		return storage.SegmentDefinition{}, err
	}
	var updatedAt time.Time
	command, err := s.neonPool.Exec(ctx, `
		UPDATE analytics_segments
		SET name = $3, description = $4, logic = $5, conditions_json = $6::jsonb, updated_at = now()
		WHERE site_id = $1 AND id = $2
	`, definition.SiteID, definition.ID, definition.Name, definition.Description, definition.Logic, string(conditionsJSON))
	if err != nil {
		return storage.SegmentDefinition{}, err
	}
	if command.RowsAffected() == 0 {
		return storage.SegmentDefinition{}, errSegmentNotFound
	}
	if err := s.neonPool.QueryRow(ctx, `SELECT updated_at FROM analytics_segments WHERE site_id = $1 AND id = $2`, definition.SiteID, definition.ID).Scan(&updatedAt); err != nil {
		return storage.SegmentDefinition{}, err
	}
	definition.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return definition, nil
}

func (s *Server) deleteSegment(ctx context.Context, siteID, segmentID string) error {
	command, err := s.neonPool.Exec(ctx, `DELETE FROM analytics_segments WHERE site_id = $1 AND id = $2`, siteID, segmentID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errSegmentNotFound
	}
	return nil
}

func scanSegmentRow(rows interface {
	Scan(dest ...any) error
}, siteID string) (storage.SegmentDefinition, error) {
	var id string
	var name string
	var description *string
	var logic string
	var conditionsRaw []byte
	var createdAt time.Time
	var updatedAt time.Time
	if err := rows.Scan(&id, &name, &description, &logic, &conditionsRaw, &createdAt, &updatedAt); err != nil {
		return storage.SegmentDefinition{}, err
	}
	conditions := []storage.SegmentCondition{}
	if len(conditionsRaw) > 0 {
		if err := json.Unmarshal(conditionsRaw, &conditions); err != nil {
			return storage.SegmentDefinition{}, err
		}
	}
	return storage.NormalizeSegmentDefinition(storage.SegmentDefinition{
		ID:          id,
		SiteID:      siteID,
		Name:        name,
		Description: firstNonEmptyStringPointer(description),
		Logic:       logic,
		Conditions:  conditions,
		CreatedAt:   createdAt.UTC().Format(time.RFC3339),
		UpdatedAt:   updatedAt.UTC().Format(time.RFC3339),
	}), nil
}

func firstNonEmptyStringPointer(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func strconvString(value int) string {
	return strconv.Itoa(value)
}

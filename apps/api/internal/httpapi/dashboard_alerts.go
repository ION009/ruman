package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	alertspkg "anlticsheat/api/internal/alerts"

	"github.com/jackc/pgx/v5"
)

type alertPayload struct {
	Name      string              `json:"name"`
	Metric    string              `json:"metric"`
	Condition string              `json:"condition"`
	Threshold float64             `json:"threshold"`
	Period    string              `json:"period"`
	Enabled   bool                `json:"enabled"`
	Channels  []alertChannelInput `json:"channels"`
}

type alertChannelInput struct {
	ID      string         `json:"id,omitempty"`
	Type    string         `json:"type"`
	Name    string         `json:"name"`
	Enabled bool           `json:"enabled"`
	Config  map[string]any `json:"config"`
}

func (s *Server) handleDashboardAlerts(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "alert storage requires control-plane storage"})
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
		alerts, err := s.listAlerts(r.Context(), site.ID)
		if err != nil {
			s.logger.Error("list alerts failed", "site_id", site.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load alerts"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"alerts": alerts})
	case http.MethodPost:
		payload := alertPayload{}
		if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		alert, err := normalizeAlertPayload(site.ID, payload)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		created, err := s.createAlert(r.Context(), alert)
		if err != nil {
			s.logger.Error("create alert failed", "site_id", site.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create alert"})
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardAlertByID(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "alert storage requires control-plane storage"})
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
	alertID := strings.TrimSpace(r.PathValue("alertId"))
	if alertID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "alert id is required"})
		return
	}

	switch r.Method {
	case http.MethodGet:
		alert, err := s.getAlert(r.Context(), site.ID, alertID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errAlertNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to load alert"})
			return
		}
		writeJSON(w, http.StatusOK, alert)
	case http.MethodPut:
		payload := alertPayload{}
		if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		alert, err := normalizeAlertPayload(site.ID, payload)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		alert.ID = alertID
		updated, err := s.updateAlert(r.Context(), alert)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errAlertNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to update alert"})
			return
		}
		writeJSON(w, http.StatusOK, updated)
	case http.MethodDelete:
		if err := s.deleteAlert(r.Context(), site.ID, alertID); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errAlertNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to delete alert"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "alertId": alertID})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardAlertHistory(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "alert storage requires control-plane storage"})
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
	alertID := strings.TrimSpace(r.PathValue("alertId"))
	if alertID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "alert id is required"})
		return
	}
	history, err := s.listAlertHistory(r.Context(), site.ID, alertID)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errAlertNotFound) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": "failed to load alert history"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"history": history})
}

var errAlertNotFound = errors.New("alert not found")

func normalizeAlertPayload(siteID string, payload alertPayload) (alertspkg.Alert, error) {
	alert := alertspkg.Alert{
		SiteID:    siteID,
		Name:      strings.TrimSpace(payload.Name),
		Metric:    alertspkg.NormalizeMetric(payload.Metric),
		Condition: alertspkg.NormalizeCondition(payload.Condition),
		Threshold: payload.Threshold,
		Period:    alertspkg.NormalizePeriod(payload.Period),
		Enabled:   payload.Enabled,
		Channels:  make([]alertspkg.Channel, 0, len(payload.Channels)),
	}
	for _, channel := range payload.Channels {
		alert.Channels = append(alert.Channels, alertspkg.Channel{
			ID:      strings.TrimSpace(channel.ID),
			Type:    alertspkg.NormalizeChannelType(channel.Type),
			Name:    strings.TrimSpace(channel.Name),
			Enabled: channel.Enabled,
			Config:  alertspkg.CloneConfig(channel.Config),
		})
	}
	return alert, alertspkg.ValidateAlertInput(alert)
}

func (s *Server) listAlerts(ctx context.Context, siteID string) ([]alertspkg.Alert, error) {
	alerts, err := s.loadAlerts(ctx, siteID)
	if err != nil {
		return nil, err
	}
	return alerts, nil
}

func (s *Server) getAlert(ctx context.Context, siteID, alertID string) (alertspkg.Alert, error) {
	alerts, err := s.loadAlerts(ctx, siteID)
	if err != nil {
		return alertspkg.Alert{}, err
	}
	for _, alert := range alerts {
		if alert.ID == alertID {
			return alert, nil
		}
	}
	return alertspkg.Alert{}, errAlertNotFound
}

func (s *Server) createAlert(ctx context.Context, alert alertspkg.Alert) (alertspkg.Alert, error) {
	tx, err := s.neonPool.Begin(ctx)
	if err != nil {
		return alertspkg.Alert{}, err
	}
	defer tx.Rollback(ctx)

	alert.ID = neoID("alert", alert.Name+time.Now().UTC().String())
	var createdAt time.Time
	var updatedAt time.Time
	legacyWebhook := firstWebhookChannelURL(alert.Channels)
	if err := tx.QueryRow(ctx, `
		INSERT INTO analytics_alerts (id, site_id, name, metric, condition, threshold, period, webhook_url, enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now(), now())
		RETURNING created_at, updated_at
	`, alert.ID, alert.SiteID, alert.Name, string(alert.Metric), string(alert.Condition), alert.Threshold, string(alert.Period), legacyWebhook, alert.Enabled).Scan(&createdAt, &updatedAt); err != nil {
		return alertspkg.Alert{}, err
	}
	for index := range alert.Channels {
		if err := insertAlertChannel(ctx, tx, alert.ID, &alert.Channels[index]); err != nil {
			return alertspkg.Alert{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return alertspkg.Alert{}, err
	}
	alert.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	alert.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
	return s.getAlert(ctx, alert.SiteID, alert.ID)
}

func (s *Server) updateAlert(ctx context.Context, alert alertspkg.Alert) (alertspkg.Alert, error) {
	tx, err := s.neonPool.Begin(ctx)
	if err != nil {
		return alertspkg.Alert{}, err
	}
	defer tx.Rollback(ctx)

	command, err := tx.Exec(ctx, `
		UPDATE analytics_alerts
		SET name = $3, metric = $4, condition = $5, threshold = $6, period = $7, webhook_url = $8, enabled = $9, updated_at = now()
		WHERE site_id = $1 AND id = $2
	`, alert.SiteID, alert.ID, alert.Name, string(alert.Metric), string(alert.Condition), alert.Threshold, string(alert.Period), firstWebhookChannelURL(alert.Channels), alert.Enabled)
	if err != nil {
		return alertspkg.Alert{}, err
	}
	if command.RowsAffected() == 0 {
		return alertspkg.Alert{}, errAlertNotFound
	}
	if _, err := tx.Exec(ctx, `DELETE FROM analytics_alert_channels WHERE alert_id = $1`, alert.ID); err != nil {
		return alertspkg.Alert{}, err
	}
	for index := range alert.Channels {
		if err := insertAlertChannel(ctx, tx, alert.ID, &alert.Channels[index]); err != nil {
			return alertspkg.Alert{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return alertspkg.Alert{}, err
	}
	return s.getAlert(ctx, alert.SiteID, alert.ID)
}

func (s *Server) deleteAlert(ctx context.Context, siteID, alertID string) error {
	command, err := s.neonPool.Exec(ctx, `DELETE FROM analytics_alerts WHERE site_id = $1 AND id = $2`, siteID, alertID)
	if err != nil {
		return err
	}
	if command.RowsAffected() == 0 {
		return errAlertNotFound
	}
	return nil
}

func (s *Server) loadAlerts(ctx context.Context, siteID string) ([]alertspkg.Alert, error) {
	rows, err := s.neonPool.Query(ctx, `
SELECT
	a.id,
	a.name,
	a.metric,
	a.condition,
	a.threshold,
	a.period,
	a.enabled,
	a.created_at,
	a.updated_at,
	a.last_fired_at,
	c.id,
	c.channel_type,
	c.name,
	c.config_json,
	c.enabled,
	c.last_delivery_at,
	c.last_delivery_status,
	c.last_error,
	COALESCE((
		SELECT count(*)::int
		FROM analytics_alert_delivery_attempts d
		WHERE d.channel_id = c.id
		  AND d.status = 'failed'
		  AND d.created_at >= now() - interval '7 days'
	), 0) AS failure_count
FROM analytics_alerts a
LEFT JOIN analytics_alert_channels c ON c.alert_id = a.id
WHERE a.site_id = $1
ORDER BY a.created_at DESC, c.created_at ASC
`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	indexed := map[string]*alertspkg.Alert{}
	orderedIDs := []string{}
	for rows.Next() {
		var alertID string
		var name string
		var metric string
		var condition string
		var threshold float64
		var period string
		var enabled bool
		var createdAt time.Time
		var updatedAt time.Time
		var lastFiredAt *time.Time
		var channelID *string
		var channelType *string
		var channelName *string
		var configJSON []byte
		var channelEnabled *bool
		var lastDeliveryAt *time.Time
		var lastDeliveryStatus *string
		var lastError *string
		var failureCount *int
		if err := rows.Scan(&alertID, &name, &metric, &condition, &threshold, &period, &enabled, &createdAt, &updatedAt, &lastFiredAt, &channelID, &channelType, &channelName, &configJSON, &channelEnabled, &lastDeliveryAt, &lastDeliveryStatus, &lastError, &failureCount); err != nil {
			return nil, err
		}

		current := indexed[alertID]
		if current == nil {
			current = &alertspkg.Alert{
				ID:        alertID,
				SiteID:    siteID,
				Name:      name,
				Metric:    alertspkg.NormalizeMetric(metric),
				Condition: alertspkg.NormalizeCondition(condition),
				Threshold: threshold,
				Period:    alertspkg.NormalizePeriod(period),
				Enabled:   enabled,
				CreatedAt: createdAt.UTC().Format(time.RFC3339),
				UpdatedAt: updatedAt.UTC().Format(time.RFC3339),
				Channels:  []alertspkg.Channel{},
			}
			if lastFiredAt != nil {
				formatted := lastFiredAt.UTC().Format(time.RFC3339)
				current.LastFiredAt = &formatted
			}
			indexed[alertID] = current
			orderedIDs = append(orderedIDs, alertID)
		}
		if channelID != nil && strings.TrimSpace(*channelID) != "" && channelEnabled != nil {
			configValue := map[string]any{}
			if len(configJSON) > 0 {
				_ = json.Unmarshal(configJSON, &configValue)
			}
			channel := alertspkg.Channel{
				ID:      strings.TrimSpace(*channelID),
				Type:    alertspkg.NormalizeChannelType(valueOrDefault(channelType)),
				Name:    strings.TrimSpace(valueOrDefault(channelName)),
				Enabled: *channelEnabled,
				Config:  configValue,
				Health: alertspkg.ChannelHealth{
					Status:       firstNonEmptyString(strings.TrimSpace(valueOrDefault(lastDeliveryStatus)), "pending"),
					LastError:    strings.TrimSpace(valueOrDefault(lastError)),
					FailureCount: valueOrDefaultInt(failureCount),
				},
			}
			if lastDeliveryAt != nil {
				formatted := lastDeliveryAt.UTC().Format(time.RFC3339)
				channel.Health.LastDeliveryAt = &formatted
			}
			current.Channels = append(current.Channels, channel)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	output := make([]alertspkg.Alert, 0, len(indexed))
	for _, alertID := range orderedIDs {
		output = append(output, *indexed[alertID])
	}
	return output, nil
}

func (s *Server) listAlertHistory(ctx context.Context, siteID, alertID string) ([]alertspkg.Firing, error) {
	alert, err := s.getAlert(ctx, siteID, alertID)
	if err != nil {
		return nil, err
	}

	rows, err := s.neonPool.Query(ctx, `
SELECT
	f.id,
	f.fired_at,
	f.metric_value,
	f.threshold_value,
	f.condition,
	f.period,
	d.id,
	d.channel_id,
	d.channel_type,
	d.status,
	d.response_code,
	d.error_message,
	d.created_at,
	d.delivered_at
FROM analytics_alert_firings f
LEFT JOIN analytics_alert_delivery_attempts d ON d.firing_id = f.id
WHERE f.alert_id = $1
ORDER BY f.fired_at DESC, d.created_at ASC
`, alertID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	indexed := map[string]*alertspkg.Firing{}
	orderedIDs := []string{}
	for rows.Next() {
		var firingID string
		var firedAt time.Time
		var metricValue float64
		var thresholdValue float64
		var condition string
		var period string
		var deliveryID *string
		var channelID *string
		var channelType *string
		var status *string
		var responseCode *int
		var errorMessage *string
		var createdAt *time.Time
		var deliveredAt *time.Time
		if err := rows.Scan(&firingID, &firedAt, &metricValue, &thresholdValue, &condition, &period, &deliveryID, &channelID, &channelType, &status, &responseCode, &errorMessage, &createdAt, &deliveredAt); err != nil {
			return nil, err
		}

		current := indexed[firingID]
		if current == nil {
			current = &alertspkg.Firing{
				ID:             firingID,
				AlertID:        alert.ID,
				FiredAt:        firedAt.UTC().Format(time.RFC3339),
				MetricValue:    metricValue,
				ThresholdValue: thresholdValue,
				Condition:      alertspkg.NormalizeCondition(condition),
				Period:         alertspkg.NormalizePeriod(period),
				Deliveries:     []alertspkg.DeliveryAttempt{},
			}
			indexed[firingID] = current
			orderedIDs = append(orderedIDs, firingID)
		}
		if deliveryID != nil && strings.TrimSpace(*deliveryID) != "" {
			attempt := alertspkg.DeliveryAttempt{
				ID:           strings.TrimSpace(*deliveryID),
				ChannelID:    strings.TrimSpace(valueOrDefault(channelID)),
				ChannelType:  alertspkg.NormalizeChannelType(valueOrDefault(channelType)),
				Status:       strings.TrimSpace(valueOrDefault(status)),
				ResponseCode: valueOrDefaultInt(responseCode),
			}
			if errorMessage != nil {
				attempt.Error = strings.TrimSpace(*errorMessage)
			}
			if createdAt != nil {
				attempt.CreatedAt = createdAt.UTC().Format(time.RFC3339)
			}
			if deliveredAt != nil {
				formatted := deliveredAt.UTC().Format(time.RFC3339)
				attempt.DeliveredAt = &formatted
			}
			current.Deliveries = append(current.Deliveries, attempt)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	output := make([]alertspkg.Firing, 0, len(indexed))
	for _, firingID := range orderedIDs {
		output = append(output, *indexed[firingID])
	}
	return output, nil
}

func insertAlertChannel(ctx context.Context, tx pgx.Tx, alertID string, channel *alertspkg.Channel) error {
	if channel.ID == "" {
		channel.ID = neoID("chn", alertID+channel.Name+time.Now().UTC().String())
	}
	configJSON, err := json.Marshal(channel.Config)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO analytics_alert_channels (id, alert_id, channel_type, name, config_json, enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, now(), now())
	`, channel.ID, alertID, string(channel.Type), channel.Name, string(configJSON), channel.Enabled)
	return err
}

func firstWebhookChannelURL(channels []alertspkg.Channel) string {
	for _, channel := range channels {
		if channel.Type == alertspkg.ChannelWebhook {
			if url, ok := channel.Config["url"].(string); ok && strings.TrimSpace(url) != "" {
				return strings.TrimSpace(url)
			}
		}
	}
	return ""
}

func valueOrDefaultInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func valueOrDefault(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			return value
		}
	}
	return ""
}

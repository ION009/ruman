package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type integrationPayload struct {
	ProviderKey string         `json:"providerKey"`
	DisplayName string         `json:"displayName"`
	Config      map[string]any `json:"config"`
}

type integrationValidationError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

type integrationConnection struct {
	ID               string                       `json:"id"`
	Family           string                       `json:"family"`
	ProviderKey      string                       `json:"providerKey"`
	DisplayName      string                       `json:"displayName"`
	Status           string                       `json:"status"`
	Configured       bool                         `json:"configured"`
	ActivelyHealthy  bool                         `json:"activelyHealthy"`
	LastVerifiedAt   *string                      `json:"lastVerifiedAt,omitempty"`
	LastSyncAt       *string                      `json:"lastSyncAt,omitempty"`
	HealthSummary    string                       `json:"healthSummary"`
	ValidationErrors []integrationValidationError `json:"validationErrors,omitempty"`
	Source           string                       `json:"source"`
}

type integrationRecord struct {
	ID              string
	SiteID          string
	Family          string
	ProviderKey     string
	DisplayName     string
	Status          string
	Configured      bool
	CredentialsJSON []byte
	ValidationError *string
	LastVerifiedAt  *time.Time
	LastSyncAt      *time.Time
}

func (s *Server) handleDashboardIntegrations(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "integration storage requires control-plane storage"})
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
		integrations, err := s.listIntegrations(r.Context(), site.ID)
		if err != nil {
			s.logger.Error("list integrations failed", "site_id", site.ID, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to load integrations"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"integrations": integrations})
	case http.MethodPost:
		payload := integrationPayload{}
		if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		connection, validationErrors, err := normalizeIntegrationPayload(payload)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "validation_failed", "details": validationErrors})
			return
		}
		connection.SiteID = site.ID
		created, err := s.upsertIntegration(r.Context(), connection)
		if err != nil {
			s.logger.Error("create integration failed", "site_id", site.ID, "provider_key", connection.ProviderKey, "error", err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save integration"})
			return
		}
		writeJSON(w, http.StatusCreated, created)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleDashboardIntegrationAction(w http.ResponseWriter, r *http.Request) {
	if !s.authorizeDashboard(w, r) {
		return
	}
	if s.neonPool == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "integration storage requires control-plane storage"})
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
	integrationID := strings.TrimSpace(r.PathValue("integrationId"))
	if integrationID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "integration id is required"})
		return
	}
	action := ""
	switch {
	case strings.Contains(r.URL.Path, "/reconnect"):
		action = "reconnect"
	case strings.Contains(r.URL.Path, "/rotate"):
		action = "rotate"
	case strings.Contains(r.URL.Path, "/disconnect"):
		action = "disconnect"
	}
	if action == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported integration action"})
		return
	}

	if action == "disconnect" {
		connection, err := s.disconnectIntegration(r.Context(), site.ID, integrationID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, errIntegrationNotFound) {
				status = http.StatusNotFound
			}
			writeJSON(w, status, map[string]string{"error": "failed to disconnect integration"})
			return
		}
		writeJSON(w, http.StatusOK, connection)
		return
	}

	payload := integrationPayload{}
	if err := decodeJSON(w, r, 64<<10, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	connection, validationErrors, err := normalizeIntegrationPayload(payload)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "validation_failed", "details": validationErrors})
		return
	}
	connection.ID = integrationID
	connection.SiteID = site.ID
	updated, err := s.upsertIntegration(r.Context(), connection)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errIntegrationNotFound) {
			status = http.StatusNotFound
		}
		writeJSON(w, status, map[string]string{"error": "failed to update integration"})
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

var errIntegrationNotFound = errors.New("integration not found")

func normalizeIntegrationPayload(payload integrationPayload) (integrationRecord, []integrationValidationError, error) {
	providerKey := strings.TrimSpace(strings.ToLower(payload.ProviderKey))
	meta, ok := integrationCatalog()[providerKey]
	if !ok {
		validationErrors := []integrationValidationError{{Field: "providerKey", Code: "unsupported_provider", Message: "This provider is not supported."}}
		return integrationRecord{}, validationErrors, errors.New("validation failed")
	}
	displayName := strings.TrimSpace(payload.DisplayName)
	if displayName == "" {
		displayName = meta.DisplayName
	}
	config := cloneIntegrationConfig(payload.Config)
	errorsList := validateIntegrationConfig(providerKey, config)
	if len(errorsList) > 0 {
		return integrationRecord{}, errorsList, errors.New("validation failed")
	}
	family := meta.Family
	status := meta.DefaultStatus
	configured := true
	if status == "" {
		status = "connected"
	}
	if status == "coming-soon" {
		configured = false
	}
	credentialsJSON, _ := json.Marshal(sanitizeIntegrationConfig(providerKey, config))
	return integrationRecord{
		Family:          family,
		ProviderKey:     providerKey,
		DisplayName:     displayName,
		Status:          status,
		Configured:      configured,
		CredentialsJSON: credentialsJSON,
		LastVerifiedAt:  timePtr(time.Now().UTC()),
	}, nil, nil
}

func (s *Server) listIntegrations(ctx context.Context, siteID string) ([]integrationConnection, error) {
	rows, err := s.neonPool.Query(ctx, `
		SELECT id, site_id, family, provider_key, display_name, status, configured, credentials_json, validation_error, last_verified_at, last_sync_at
		FROM analytics_integrations
		WHERE site_id = $1
		ORDER BY created_at DESC
	`, siteID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	stored := map[string]integrationConnection{}
	for rows.Next() {
		record := integrationRecord{}
		if err := rows.Scan(&record.ID, &record.SiteID, &record.Family, &record.ProviderKey, &record.DisplayName, &record.Status, &record.Configured, &record.CredentialsJSON, &record.ValidationError, &record.LastVerifiedAt, &record.LastSyncAt); err != nil {
			return nil, err
		}
		stored[record.ProviderKey] = buildIntegrationConnection(record, "integration")
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	apiKeyCount, apiKeyLastUsed, _ := s.integrationAPIKeyStats(ctx, siteID)
	alertChannelCount, alertChannelHealthy, _ := s.integrationAlertChannelStats(ctx, siteID)

	catalog := integrationCatalog()
	output := make([]integrationConnection, 0, len(catalog)+3)
	for key, meta := range catalog {
		if current, ok := stored[key]; ok {
			output = append(output, current)
			continue
		}
		output = append(output, integrationConnection{
			ID:              "",
			Family:          meta.Family,
			ProviderKey:     key,
			DisplayName:     meta.DisplayName,
			Status:          meta.DefaultStatus,
			Configured:      false,
			ActivelyHealthy: false,
			HealthSummary:   meta.HealthSummary,
			Source:          "catalog",
		})
	}

	output = append(output, integrationConnection{
		ID:              "api_keys",
		Family:          "developer",
		ProviderKey:     "api_keys",
		DisplayName:     "API Keys",
		Status:          ternaryIntegrationStatus(apiKeyCount > 0, "connected", "disconnected"),
		Configured:      apiKeyCount > 0,
		ActivelyHealthy: apiKeyCount > 0,
		LastVerifiedAt:  formatNullableTime(apiKeyLastUsed),
		HealthSummary:   "Developer access keys available for public stats and exports.",
		Source:          "derived",
	})
	output = append(output, integrationConnection{
		ID:              "alert_channels",
		Family:          "collaboration",
		ProviderKey:     "alert_channels",
		DisplayName:     "Alert Destinations",
		Status:          ternaryIntegrationStatus(alertChannelCount > 0 && alertChannelHealthy, "connected", ternaryIntegrationStatus(alertChannelCount > 0, "degraded", "disconnected")),
		Configured:      alertChannelCount > 0,
		ActivelyHealthy: alertChannelCount > 0 && alertChannelHealthy,
		HealthSummary:   "Alert delivery channels configured through the alerts system.",
		Source:          "derived",
	})
	output = append(output, integrationConnection{
		ID:              "export_endpoints",
		Family:          "developer",
		ProviderKey:     "export_endpoints",
		DisplayName:     "Export Endpoints",
		Status:          "connected",
		Configured:      true,
		ActivelyHealthy: true,
		HealthSummary:   "Structured JSON and CSV dashboard exports are available.",
		Source:          "derived",
	})
	return output, nil
}

func (s *Server) upsertIntegration(ctx context.Context, record integrationRecord) (integrationConnection, error) {
	if record.ID == "" {
		record.ID = neoID("int", record.ProviderKey+time.Now().UTC().String())
	}
	command, err := s.neonPool.Exec(ctx, `
		INSERT INTO analytics_integrations (id, site_id, family, provider_key, display_name, status, configured, credentials_json, validation_error, last_verified_at, last_sync_at, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NULL, $9, $10, now(), now())
		ON CONFLICT (site_id, provider_key) DO UPDATE
		SET display_name = EXCLUDED.display_name,
		    status = EXCLUDED.status,
		    configured = EXCLUDED.configured,
		    credentials_json = EXCLUDED.credentials_json,
		    validation_error = NULL,
		    last_verified_at = EXCLUDED.last_verified_at,
		    last_sync_at = EXCLUDED.last_sync_at,
		    updated_at = now()
	`, record.ID, record.SiteID, record.Family, record.ProviderKey, record.DisplayName, record.Status, record.Configured, string(record.CredentialsJSON), record.LastVerifiedAt, record.LastSyncAt)
	if err != nil {
		return integrationConnection{}, err
	}
	if command.RowsAffected() == 0 {
		return integrationConnection{}, errIntegrationNotFound
	}
	rows, err := s.listIntegrations(ctx, record.SiteID)
	if err != nil {
		return integrationConnection{}, err
	}
	for _, row := range rows {
		if row.ProviderKey == record.ProviderKey {
			return row, nil
		}
	}
	return integrationConnection{}, errIntegrationNotFound
}

func (s *Server) disconnectIntegration(ctx context.Context, siteID, integrationID string) (integrationConnection, error) {
	command, err := s.neonPool.Exec(ctx, `
		UPDATE analytics_integrations
		SET status = 'disconnected', configured = FALSE, credentials_json = '{}'::jsonb, validation_error = NULL, last_verified_at = NULL, updated_at = now()
		WHERE site_id = $1 AND id = $2
	`, siteID, integrationID)
	if err != nil {
		return integrationConnection{}, err
	}
	if command.RowsAffected() == 0 {
		return integrationConnection{}, errIntegrationNotFound
	}
	rows, err := s.listIntegrations(ctx, siteID)
	if err != nil {
		return integrationConnection{}, err
	}
	for _, row := range rows {
		if row.ID == integrationID {
			return row, nil
		}
	}
	return integrationConnection{}, errIntegrationNotFound
}

func buildIntegrationConnection(record integrationRecord, source string) integrationConnection {
	connection := integrationConnection{
		ID:              record.ID,
		Family:          record.Family,
		ProviderKey:     record.ProviderKey,
		DisplayName:     record.DisplayName,
		Status:          record.Status,
		Configured:      record.Configured,
		ActivelyHealthy: record.Status == "connected" && record.Configured && record.ValidationError == nil,
		LastVerifiedAt:  formatNullableTime(record.LastVerifiedAt),
		LastSyncAt:      formatNullableTime(record.LastSyncAt),
		HealthSummary:   "Configured and ready.",
		Source:          source,
	}
	if record.ValidationError != nil && strings.TrimSpace(*record.ValidationError) != "" {
		connection.ValidationErrors = []integrationValidationError{{Field: "config", Code: "validation_error", Message: strings.TrimSpace(*record.ValidationError)}}
		connection.ActivelyHealthy = false
		connection.HealthSummary = strings.TrimSpace(*record.ValidationError)
	} else if record.Status == "degraded" {
		connection.HealthSummary = "Configured, but verification needs attention."
	} else if record.Status == "coming-soon" {
		connection.HealthSummary = "Provider scaffolding is present, but verification is not yet active."
	} else if record.Status == "disconnected" {
		connection.HealthSummary = "Not connected yet."
	}
	return connection
}

func integrationCatalog() map[string]struct {
	Family        string
	DisplayName   string
	DefaultStatus string
	HealthSummary string
} {
	return map[string]struct {
		Family        string
		DisplayName   string
		DefaultStatus string
		HealthSummary string
	}{
		"google_analytics": {Family: "analytics", DisplayName: "Google Analytics", DefaultStatus: "disconnected", HealthSummary: "Connect a GA property and verify scopes."},
		"mixpanel":         {Family: "analytics", DisplayName: "Mixpanel", DefaultStatus: "coming-soon", HealthSummary: "Provider cataloged for future support."},
		"amplitude":        {Family: "analytics", DisplayName: "Amplitude", DefaultStatus: "coming-soon", HealthSummary: "Provider cataloged for future support."},
		"posthog":          {Family: "analytics", DisplayName: "PostHog", DefaultStatus: "coming-soon", HealthSummary: "Provider cataloged for future support."},
		"slack":            {Family: "collaboration", DisplayName: "Slack", DefaultStatus: "disconnected", HealthSummary: "Connect a workspace webhook and target channel."},
		"webhook":          {Family: "collaboration", DisplayName: "Webhook", DefaultStatus: "disconnected", HealthSummary: "Connect outbound webhooks for integrations and automation."},
	}
}

func validateIntegrationConfig(providerKey string, config map[string]any) []integrationValidationError {
	errorsList := []integrationValidationError{}
	switch providerKey {
	case "google_analytics":
		if strings.TrimSpace(configString(config, "propertyId")) == "" {
			errorsList = append(errorsList, integrationValidationError{Field: "propertyId", Code: "missing_property", Message: "Google Analytics connections require propertyId."})
		}
		accessToken := strings.TrimSpace(configString(config, "accessToken"))
		if accessToken == "" {
			errorsList = append(errorsList, integrationValidationError{Field: "accessToken", Code: "missing_token", Message: "Google Analytics connections require an access token."})
		} else if len(accessToken) < 12 {
			errorsList = append(errorsList, integrationValidationError{Field: "accessToken", Code: "invalid_token", Message: "The access token looks invalid."})
		} else if strings.Contains(strings.ToLower(accessToken), "expired") {
			errorsList = append(errorsList, integrationValidationError{Field: "accessToken", Code: "expired_credentials", Message: "The access token appears expired."})
		}
		scopes := stringSliceFromAny(config["scopes"])
		if !containsString(scopes, "analytics.readonly") {
			errorsList = append(errorsList, integrationValidationError{Field: "scopes", Code: "missing_scope", Message: "Google Analytics requires analytics.readonly scope."})
		}
	case "slack":
		if strings.TrimSpace(configString(config, "channel")) == "" {
			errorsList = append(errorsList, integrationValidationError{Field: "channel", Code: "missing_channel", Message: "Slack connections require a channel."})
		}
		webhookURL := strings.TrimSpace(configString(config, "webhookUrl"))
		if webhookURL == "" {
			errorsList = append(errorsList, integrationValidationError{Field: "webhookUrl", Code: "missing_webhook", Message: "Slack connections require a webhookUrl."})
		} else if !validHTTPURL(webhookURL) {
			errorsList = append(errorsList, integrationValidationError{Field: "webhookUrl", Code: "invalid_url", Message: "Slack webhookUrl must be a valid http or https URL."})
		}
	case "webhook":
		targetURL := strings.TrimSpace(configString(config, "url"))
		if targetURL == "" {
			errorsList = append(errorsList, integrationValidationError{Field: "url", Code: "missing_url", Message: "Webhook connections require a URL."})
		} else if !validHTTPURL(targetURL) {
			errorsList = append(errorsList, integrationValidationError{Field: "url", Code: "invalid_url", Message: "Webhook URL must be a valid http or https URL."})
		}
	case "mixpanel", "amplitude", "posthog":
	default:
		errorsList = append(errorsList, integrationValidationError{Field: "providerKey", Code: "unsupported_provider", Message: "This provider is not supported."})
	}
	return errorsList
}

func sanitizeIntegrationConfig(providerKey string, config map[string]any) map[string]any {
	config = cloneIntegrationConfig(config)
	switch providerKey {
	case "google_analytics":
		config["accessTokenHash"] = hashSecret(configString(config, "accessToken"))
		delete(config, "accessToken")
		config["refreshTokenHash"] = hashSecret(configString(config, "refreshToken"))
		delete(config, "refreshToken")
	case "slack":
		config["webhookHash"] = hashSecret(configString(config, "webhookUrl"))
		delete(config, "webhookUrl")
		config["botTokenHash"] = hashSecret(configString(config, "botToken"))
		delete(config, "botToken")
	case "webhook":
		config["urlHash"] = hashSecret(configString(config, "url"))
		config["urlHost"] = urlHost(configString(config, "url"))
		delete(config, "url")
	}
	return config
}

func cloneIntegrationConfig(config map[string]any) map[string]any {
	if config == nil {
		return map[string]any{}
	}
	copy := map[string]any{}
	for key, value := range config {
		copy[key] = value
	}
	return copy
}

func hashSecret(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func urlHost(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return ""
	}
	return parsed.Host
}

func validHTTPURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && (parsed.Scheme == "http" || parsed.Scheme == "https") && parsed.Host != ""
}

func stringSliceFromAny(value any) []string {
	output := []string{}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				output = append(output, strings.TrimSpace(text))
			}
		}
	case []string:
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				output = append(output, strings.TrimSpace(item))
			}
		}
	case string:
		if strings.TrimSpace(typed) != "" {
			output = append(output, strings.TrimSpace(typed))
		}
	}
	return output
}

func containsString(values []string, expected string) bool {
	expected = strings.TrimSpace(strings.ToLower(expected))
	for _, value := range values {
		if strings.TrimSpace(strings.ToLower(value)) == expected {
			return true
		}
	}
	return false
}

func timePtr(value time.Time) *time.Time {
	return &value
}

func formatNullableTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := value.UTC().Format(time.RFC3339)
	return &formatted
}

func ternaryIntegrationStatus(condition bool, whenTrue, whenFalse string) string {
	if condition {
		return whenTrue
	}
	return whenFalse
}

func (s *Server) integrationAPIKeyStats(ctx context.Context, siteID string) (int, *time.Time, error) {
	if s.neonPool == nil {
		return 0, nil, nil
	}
	var count int
	var lastUsed *time.Time
	if err := s.neonPool.QueryRow(ctx, `SELECT count(*)::int, max(last_used) FROM analytics_api_keys WHERE site_id = $1`, siteID).Scan(&count, &lastUsed); err != nil {
		return 0, nil, nil
	}
	return count, lastUsed, nil
}

func (s *Server) integrationAlertChannelStats(ctx context.Context, siteID string) (int, bool, error) {
	if s.neonPool == nil {
		return 0, false, nil
	}
	var total int
	var healthy int
	if err := s.neonPool.QueryRow(ctx, `
		SELECT
			count(*)::int,
			count(*) FILTER (WHERE last_delivery_status = 'sent')::int
		FROM analytics_alert_channels c
		JOIN analytics_alerts a ON a.id = c.alert_id
		WHERE a.site_id = $1
		  AND c.enabled = TRUE
	`, siteID).Scan(&total, &healthy); err != nil {
		return 0, false, nil
	}
	return total, healthy == total, nil
}

func configString(config map[string]any, key string) string {
	if config == nil {
		return ""
	}
	value, ok := config[key]
	if !ok {
		return ""
	}
	if typed, ok := value.(string); ok {
		return strings.TrimSpace(typed)
	}
	return ""
}

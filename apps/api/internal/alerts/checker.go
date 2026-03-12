package alerts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/smtp"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/controlplane"
	"anlticsheat/api/internal/storage"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Checker struct {
	pool      *pgxpool.Pool
	dashboard storage.DashboardProvider
	sites     controlplane.SiteRegistry
	client    *http.Client
	logger    *slog.Logger
	cfg       config.Config
}

type alertRow struct {
	ID               string
	SiteID           string
	Name             string
	Metric           Metric
	Condition        Condition
	Threshold        float64
	Period           Period
	LegacyWebhookURL string
	LastFiredAt      *time.Time
	Channels         []Channel
}

type deliveryResult struct {
	Status       string
	ResponseCode int
	Error        string
	DeliveredAt  *time.Time
}

func NewChecker(pool *pgxpool.Pool, dashboard storage.DashboardProvider, sites controlplane.SiteRegistry, cfg config.Config, logger *slog.Logger) *Checker {
	if pool == nil || dashboard == nil {
		return nil
	}
	return &Checker{
		pool:      pool,
		dashboard: dashboard,
		sites:     sites,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
		cfg:    cfg,
	}
}

func (c *Checker) Start(ctx context.Context) {
	if c == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			c.runOnce(ctx)
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (c *Checker) runOnce(ctx context.Context) {
	alerts, err := c.loadAlerts(ctx)
	if err != nil {
		if c.logger != nil {
			c.logger.Error("load alerts failed", slog.Any("error", err))
		}
		return
	}

	for _, alert := range alerts {
		c.processAlert(ctx, alert)
	}
}

func (c *Checker) loadAlerts(ctx context.Context) ([]alertRow, error) {
	rows, err := c.pool.Query(ctx, `
SELECT
	a.id,
	a.site_id,
	a.name,
	a.metric,
	a.condition,
	a.threshold,
	a.period,
	COALESCE(a.webhook_url, '') AS webhook_url,
	a.last_fired_at,
	c.id,
	c.channel_type,
	c.name,
	c.config_json,
	c.enabled,
	c.last_delivery_at,
	c.last_delivery_status,
	c.last_error
FROM analytics_alerts a
LEFT JOIN analytics_alert_channels c ON c.alert_id = a.id
WHERE a.enabled = TRUE
ORDER BY a.created_at DESC, c.created_at ASC
`)
	if err != nil {
		if !missingAlertChannelsTable(err) {
			return nil, err
		}
		return c.loadLegacyAlerts(ctx)
	}
	defer rows.Close()

	indexed := map[string]*alertRow{}
	orderedIDs := []string{}
	for rows.Next() {
		var alertID string
		var siteID string
		var name string
		var metric string
		var condition string
		var threshold float64
		var period string
		var webhookURL string
		var lastFiredAt *time.Time
		var channelID *string
		var channelType *string
		var channelName *string
		var channelConfig []byte
		var channelEnabled *bool
		var lastDeliveryAt *time.Time
		var lastDeliveryStatus *string
		var lastError *string
		if err := rows.Scan(
			&alertID,
			&siteID,
			&name,
			&metric,
			&condition,
			&threshold,
			&period,
			&webhookURL,
			&lastFiredAt,
			&channelID,
			&channelType,
			&channelName,
			&channelConfig,
			&channelEnabled,
			&lastDeliveryAt,
			&lastDeliveryStatus,
			&lastError,
		); err != nil {
			return nil, err
		}

		current := indexed[alertID]
		if current == nil {
			current = &alertRow{
				ID:               alertID,
				SiteID:           siteID,
				Name:             name,
				Metric:           NormalizeMetric(metric),
				Condition:        NormalizeCondition(condition),
				Threshold:        threshold,
				Period:           NormalizePeriod(period),
				LegacyWebhookURL: strings.TrimSpace(webhookURL),
				LastFiredAt:      lastFiredAt,
				Channels:         []Channel{},
			}
			indexed[alertID] = current
			orderedIDs = append(orderedIDs, alertID)
		}

		if channelID != nil && strings.TrimSpace(*channelID) != "" && channelEnabled != nil && *channelEnabled {
			configValue := map[string]any{}
			if len(channelConfig) > 0 {
				_ = json.Unmarshal(channelConfig, &configValue)
			}
			channel := Channel{
				ID:      strings.TrimSpace(*channelID),
				Type:    NormalizeChannelType(valueOrDefault(channelType)),
				Name:    strings.TrimSpace(valueOrDefault(channelName)),
				Enabled: *channelEnabled,
				Config:  configValue,
				Health: ChannelHealth{
					Status:       firstNonEmptyString(strings.TrimSpace(valueOrDefault(lastDeliveryStatus)), "pending"),
					LastError:    strings.TrimSpace(valueOrDefault(lastError)),
					FailureCount: 0,
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

	output := make([]alertRow, 0, len(indexed))
	for _, alertID := range orderedIDs {
		current := indexed[alertID]
		if len(current.Channels) == 0 && strings.TrimSpace(current.LegacyWebhookURL) != "" {
			current.Channels = append(current.Channels, Channel{
				ID:      "legacy-webhook",
				Type:    ChannelWebhook,
				Name:    "Primary webhook",
				Enabled: true,
				Config:  map[string]any{"url": current.LegacyWebhookURL},
				Health:  ChannelHealth{Status: "pending"},
			})
		}
		output = append(output, *current)
	}
	return output, nil
}

func (c *Checker) loadLegacyAlerts(ctx context.Context) ([]alertRow, error) {
	rows, err := c.pool.Query(ctx, `
SELECT id, site_id, name, metric, condition, threshold, period, webhook_url, last_fired_at
FROM analytics_alerts
WHERE enabled = TRUE
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	output := []alertRow{}
	for rows.Next() {
		var row alertRow
		if err := rows.Scan(&row.ID, &row.SiteID, &row.Name, &row.Metric, &row.Condition, &row.Threshold, &row.Period, &row.LegacyWebhookURL, &row.LastFiredAt); err != nil {
			return nil, err
		}
		row.Metric = NormalizeMetric(string(row.Metric))
		row.Condition = NormalizeCondition(string(row.Condition))
		row.Period = NormalizePeriod(string(row.Period))
		row.Channels = []Channel{{
			ID:      "legacy-webhook",
			Type:    ChannelWebhook,
			Name:    "Primary webhook",
			Enabled: true,
			Config:  map[string]any{"url": row.LegacyWebhookURL},
			Health:  ChannelHealth{Status: "pending"},
		}}
		output = append(output, row)
	}
	return output, rows.Err()
}

func (c *Checker) processAlert(ctx context.Context, alert alertRow) {
	now := time.Now().UTC()
	period := 24 * time.Hour
	if alert.Period == PeriodHour {
		period = time.Hour
	}
	if alert.LastFiredAt != nil && alert.LastFiredAt.Add(period).After(now) {
		return
	}

	rangeValue := storage.Range24Hours
	if period == time.Hour {
		rangeValue = storage.NewCustomTimeRange(now.Add(-time.Hour), now)
	}

	summary, err := c.dashboard.DashboardSummary(ctx, alert.SiteID, rangeValue, now)
	if err != nil {
		if c.logger != nil {
			c.logger.Error("compute alert summary failed", slog.String("site_id", alert.SiteID), slog.Any("error", err))
		}
		return
	}

	value := alertMetricValue(summary, string(alert.Metric))
	triggered := alert.Condition == ConditionBelow && value < alert.Threshold ||
		alert.Condition != ConditionBelow && value > alert.Threshold
	if !triggered {
		return
	}

	firingID := c.recordFiring(ctx, alert, value, now)
	siteName := alert.SiteID
	if c.sites != nil {
		if site, ok, err := c.sites.GetSite(ctx, alert.SiteID); err == nil && ok && strings.TrimSpace(site.Name) != "" {
			siteName = site.Name
		}
	}

	for _, channel := range alert.Channels {
		result := c.dispatchChannel(ctx, alert, channel, siteName, value, now)
		c.recordDelivery(ctx, firingID, alert, channel, result, now)
	}

	_, _ = c.pool.Exec(ctx, `UPDATE analytics_alerts SET last_fired_at = now() WHERE id = $1`, alert.ID)
}

func (c *Checker) recordFiring(ctx context.Context, alert alertRow, value float64, firedAt time.Time) string {
	id := fmt.Sprintf("fir_%d", firedAt.UnixNano())
	_, _ = c.pool.Exec(ctx, `
		INSERT INTO analytics_alert_firings (id, alert_id, fired_at, metric_value, threshold_value, condition, period, status)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'fired')
	`, id, alert.ID, firedAt, value, alert.Threshold, string(alert.Condition), string(alert.Period))
	return id
}

func (c *Checker) dispatchChannel(ctx context.Context, alert alertRow, channel Channel, siteName string, value float64, firedAt time.Time) deliveryResult {
	switch channel.Type {
	case ChannelSlack:
		return c.sendSlack(ctx, alert, channel, siteName, value, firedAt)
	case ChannelEmail:
		return c.sendEmail(alert, channel, siteName, value, firedAt)
	default:
		return c.sendWebhook(ctx, alert, channel, siteName, value, firedAt)
	}
}

func (c *Checker) sendWebhook(ctx context.Context, alert alertRow, channel Channel, siteName string, value float64, firedAt time.Time) deliveryResult {
	url := configString(channel.Config, "url")
	if url == "" {
		url = configString(channel.Config, "webhookUrl")
	}
	if strings.TrimSpace(url) == "" {
		return deliveryResult{Status: "failed", Error: "webhook url is not configured"}
	}

	payload, err := json.Marshal(c.alertPayload(alert, siteName, value, firedAt))
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	request.Header.Set("Content-Type", "application/json")
	if headers, ok := channel.Config["headers"].(map[string]any); ok {
		for key, value := range headers {
			if text, ok := value.(string); ok && strings.TrimSpace(key) != "" {
				request.Header.Set(strings.TrimSpace(key), strings.TrimSpace(text))
			}
		}
	}

	response, err := c.client.Do(request)
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusMultipleChoices {
		return deliveryResult{Status: "failed", ResponseCode: response.StatusCode, Error: "non-success webhook response"}
	}
	deliveredAt := time.Now().UTC()
	return deliveryResult{Status: "sent", ResponseCode: response.StatusCode, DeliveredAt: &deliveredAt}
}

func (c *Checker) sendSlack(ctx context.Context, alert alertRow, channel Channel, siteName string, value float64, firedAt time.Time) deliveryResult {
	webhookURL := configString(channel.Config, "webhookUrl")
	if strings.TrimSpace(webhookURL) == "" {
		return deliveryResult{Status: "failed", Error: "slack webhookUrl is not configured"}
	}
	payload, err := json.Marshal(map[string]any{
		"text": fmt.Sprintf("%s fired for %s: %s %s %.2f (threshold %.2f, period %s) at %s",
			alert.Name, siteName, alert.Metric, alert.Condition, value, alert.Threshold, alert.Period, firedAt.Format(time.RFC3339)),
	})
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(payload))
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.client.Do(request)
	if err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	defer response.Body.Close()
	if response.StatusCode >= http.StatusMultipleChoices {
		return deliveryResult{Status: "failed", ResponseCode: response.StatusCode, Error: "non-success slack response"}
	}
	deliveredAt := time.Now().UTC()
	return deliveryResult{Status: "sent", ResponseCode: response.StatusCode, DeliveredAt: &deliveredAt}
}

func (c *Checker) sendEmail(alert alertRow, channel Channel, siteName string, value float64, firedAt time.Time) deliveryResult {
	if strings.TrimSpace(c.cfg.AlertSMTPAddr) == "" || strings.TrimSpace(c.cfg.AlertSMTPFrom) == "" {
		return deliveryResult{Status: "failed", Error: "email delivery is not configured"}
	}

	recipients := stringSliceFromConfig(channel.Config["recipients"])
	if len(recipients) == 0 {
		return deliveryResult{Status: "failed", Error: "email channel has no recipients"}
	}
	subject := fmt.Sprintf("[AnlticsHeat] %s fired for %s", alert.Name, siteName)
	body := fmt.Sprintf(
		"Alert: %s\nSite: %s\nMetric: %s\nValue: %.2f\nThreshold: %.2f\nCondition: %s\nPeriod: %s\nFired At: %s\n",
		alert.Name,
		siteName,
		alert.Metric,
		value,
		alert.Threshold,
		alert.Condition,
		alert.Period,
		firedAt.Format(time.RFC3339),
	)
	message := []byte("To: " + strings.Join(recipients, ", ") + "\r\n" +
		"Subject: " + subject + "\r\n" +
		"\r\n" + body)

	host := c.cfg.AlertSMTPAddr
	if index := strings.Index(host, ":"); index > 0 {
		host = host[:index]
	}
	var auth smtp.Auth
	if strings.TrimSpace(c.cfg.AlertSMTPUsername) != "" {
		auth = smtp.PlainAuth("", c.cfg.AlertSMTPUsername, c.cfg.AlertSMTPPassword, host)
	}
	if err := smtp.SendMail(c.cfg.AlertSMTPAddr, auth, c.cfg.AlertSMTPFrom, recipients, message); err != nil {
		return deliveryResult{Status: "failed", Error: err.Error()}
	}
	deliveredAt := time.Now().UTC()
	return deliveryResult{Status: "sent", DeliveredAt: &deliveredAt}
}

func (c *Checker) recordDelivery(ctx context.Context, firingID string, alert alertRow, channel Channel, result deliveryResult, now time.Time) {
	attemptID := fmt.Sprintf("del_%d", now.UnixNano())
	_, _ = c.pool.Exec(ctx, `
		INSERT INTO analytics_alert_delivery_attempts (id, firing_id, channel_id, channel_type, status, response_code, error_message, created_at, delivered_at)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, 0), NULLIF($7, ''), now(), $8)
	`, attemptID, firingID, channel.ID, string(channel.Type), result.Status, result.ResponseCode, result.Error, result.DeliveredAt)

	_, _ = c.pool.Exec(ctx, `
		UPDATE analytics_alert_channels
		SET last_delivery_at = $2,
		    last_delivery_status = $3,
		    last_error = NULLIF($4, ''),
		    updated_at = now()
		WHERE id = $1
	`, channel.ID, result.DeliveredAt, result.Status, result.Error)

	if result.Status == "failed" && c.logger != nil {
		c.logger.Error("alert delivery failed", slog.String("alert_id", alert.ID), slog.String("channel_id", channel.ID), slog.String("channel_type", string(channel.Type)), slog.String("error", result.Error))
	}
}

func (c *Checker) alertPayload(alert alertRow, siteName string, value float64, firedAt time.Time) map[string]any {
	return map[string]any{
		"alert":     alert.Name,
		"site":      siteName,
		"metric":    alert.Metric,
		"value":     value,
		"threshold": alert.Threshold,
		"condition": alert.Condition,
		"period":    alert.Period,
		"fired_at":  firedAt.Format(time.RFC3339),
	}
}

func missingAlertChannelsTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "analytics_alert_channels")
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

func alertMetricValue(summary storage.DashboardSummary, metric string) float64 {
	switch metric {
	case "visitors":
		return float64(summary.Overview.UniqueVisitors)
	case "bounce_rate":
		return summary.Overview.BounceRate
	case "rage_clicks":
		return float64(summary.Overview.RageClicks)
	default:
		return float64(summary.Overview.Pageviews)
	}
}

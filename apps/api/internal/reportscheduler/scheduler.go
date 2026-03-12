package reportscheduler

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/controlplane"
	"anlticsheat/api/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Scheduler struct {
	pool      *pgxpool.Pool
	dashboard storage.DashboardProvider
	sites     controlplane.SiteRegistry
	logger    *slog.Logger
	cfg       config.Config
}

type reportRow struct {
	ID                    string
	SiteID                string
	Name                  string
	Frequency             string
	DeliveryTime          string
	Timezone              string
	Recipients            []string
	IncludeSections       []string
	CompareEnabled        bool
	Enabled               bool
	Note                  *string
	LastDeliveredAt       *time.Time
	LastDeliveryStatus    *string
	LastDeliveryError     *string
	LastDeliveryAttemptAt *time.Time
	ConsecutiveFailures   int
	CreatedAt             time.Time
}

type reportDeliveryResult struct {
	Status      string
	DeliveredAt *time.Time
	Error       string
	Subject     string
	Summary     map[string]any
}

func New(pool *pgxpool.Pool, dashboard storage.DashboardProvider, sites controlplane.SiteRegistry, cfg config.Config, logger *slog.Logger) *Scheduler {
	if pool == nil || dashboard == nil {
		return nil
	}
	return &Scheduler{
		pool:      pool,
		dashboard: dashboard,
		sites:     sites,
		logger:    logger,
		cfg:       cfg,
	}
}

func (s *Scheduler) Start(ctx context.Context) {
	if s == nil {
		return
	}
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()

		for {
			s.runOnce(ctx)
			select {
			case <-ticker.C:
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (s *Scheduler) runOnce(ctx context.Context) {
	reports, err := s.loadReports(ctx)
	if err != nil {
		if s.logger != nil {
			s.logger.Error("load reports failed", slog.Any("error", err))
		}
		return
	}

	now := time.Now().UTC()
	for _, report := range reports {
		if !report.Enabled || !reportDue(report, now) {
			continue
		}
		s.processReport(ctx, report, now)
	}
}

func (s *Scheduler) loadReports(ctx context.Context) ([]reportRow, error) {
	rows, err := s.pool.Query(ctx, `
SELECT
    id,
    site_id,
    name,
    frequency,
    delivery_time,
    timezone,
    recipients,
    include_sections,
    compare_enabled,
    enabled,
    note,
    last_delivered_at,
    last_delivery_status,
    last_delivery_error,
    last_delivery_attempt_at,
    consecutive_failures,
    created_at
FROM analytics_report_configs
WHERE enabled = TRUE
ORDER BY created_at DESC
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	output := make([]reportRow, 0)
	for rows.Next() {
		row := reportRow{}
		var recipients string
		var includeSections string
		if err := rows.Scan(
			&row.ID,
			&row.SiteID,
			&row.Name,
			&row.Frequency,
			&row.DeliveryTime,
			&row.Timezone,
			&recipients,
			&includeSections,
			&row.CompareEnabled,
			&row.Enabled,
			&row.Note,
			&row.LastDeliveredAt,
			&row.LastDeliveryStatus,
			&row.LastDeliveryError,
			&row.LastDeliveryAttemptAt,
			&row.ConsecutiveFailures,
			&row.CreatedAt,
		); err != nil {
			return nil, err
		}
		row.Recipients = parseRecipients(recipients)
		row.IncludeSections = parseSections(includeSections)
		output = append(output, row)
	}
	return output, rows.Err()
}

func (s *Scheduler) processReport(ctx context.Context, report reportRow, now time.Time) {
	result := s.deliverReport(ctx, report, now)
	if err := s.recordDelivery(ctx, report, result, now); err != nil && s.logger != nil {
		s.logger.Error("record report delivery failed", slog.String("report_id", report.ID), slog.Any("error", err))
	}
}

func (s *Scheduler) deliverReport(ctx context.Context, report reportRow, now time.Time) reportDeliveryResult {
	subject, body, summary, err := s.buildReportMessage(ctx, report, now)
	if err != nil {
		return reportDeliveryResult{
			Status:  "failed",
			Subject: report.Name,
			Summary: map[string]any{"error": err.Error()},
			Error:   err.Error(),
		}
	}

	if err := s.sendEmail(report.Recipients, subject, body); err != nil {
		return reportDeliveryResult{
			Status:  "failed",
			Subject: subject,
			Summary: summary,
			Error:   err.Error(),
		}
	}

	deliveredAt := now.UTC()
	return reportDeliveryResult{
		Status:      "delivered",
		Subject:     subject,
		Summary:     summary,
		DeliveredAt: &deliveredAt,
	}
}

func (s *Scheduler) buildReportMessage(ctx context.Context, report reportRow, now time.Time) (string, []byte, map[string]any, error) {
	rangeValue := frequencyToRange(report.Frequency)
	summary, err := s.dashboard.DashboardSummary(ctx, report.SiteID, rangeValue, now)
	if err != nil {
		return "", nil, nil, fmt.Errorf("load dashboard summary: %w", err)
	}

	siteName := report.SiteID
	if s.sites != nil {
		if site, ok, lookupErr := s.sites.GetSite(ctx, report.SiteID); lookupErr == nil && ok && strings.TrimSpace(site.Name) != "" {
			siteName = site.Name
		}
	}

	sections := make([]string, 0, len(report.IncludeSections))
	for _, section := range report.IncludeSections {
		sections = append(sections, strings.TrimSpace(section))
	}
	if len(sections) == 0 {
		sections = []string{"overview"}
	}

	lines := []string{
		fmt.Sprintf("AnlticsHeat report: %s", report.Name),
		fmt.Sprintf("Site: %s", siteName),
		fmt.Sprintf("Window: %s", rangeValue.String()),
		fmt.Sprintf("Generated: %s", now.UTC().Format(time.RFC3339)),
		"",
		"Overview",
		fmt.Sprintf("- Visitors: %d", summary.Overview.UniqueVisitors),
		fmt.Sprintf("- Pageviews: %d", summary.Overview.Pageviews),
		fmt.Sprintf("- Sessions: %d", summary.Overview.Sessions),
		fmt.Sprintf("- Bounce rate: %.2f%%", summary.Overview.BounceRate),
		fmt.Sprintf("- Avg scroll depth: %.2f%%", summary.Overview.AvgScrollDepth),
	}

	if len(summary.TopPages) > 0 {
		lines = append(lines, "", "Top pages")
		limit := 3
		if len(summary.TopPages) < limit {
			limit = len(summary.TopPages)
		}
		for index := 0; index < limit; index += 1 {
			page := summary.TopPages[index]
			lines = append(lines, fmt.Sprintf("- %s: %d pageviews", page.Path, page.Pageviews))
		}
	}

	if containsSection(sections, "insights") {
		if insights, err := s.dashboard.Insights(ctx, report.SiteID, rangeValue, now); err == nil && len(insights.Items) > 0 {
			lines = append(lines, "", "Insights")
			limit := 3
			if len(insights.Items) < limit {
				limit = len(insights.Items)
			}
			for index := 0; index < limit; index += 1 {
				item := insights.Items[index]
				lines = append(lines, fmt.Sprintf("- %s: %s", item.Path, item.Title))
			}
		}
	}

	if note := strings.TrimSpace(stringOrEmpty(report.Note)); note != "" {
		lines = append(lines, "", "Operator note", note)
	}

	summaryPayload := map[string]any{
		"range":          rangeValue.String(),
		"sections":       sections,
		"uniqueVisitors": summary.Overview.UniqueVisitors,
		"pageviews":      summary.Overview.Pageviews,
		"sessions":       summary.Overview.Sessions,
	}

	var message bytes.Buffer
	message.WriteString(fmt.Sprintf("From: %s\r\n", s.cfg.AlertSMTPFrom))
	message.WriteString(fmt.Sprintf("To: %s\r\n", strings.Join(report.Recipients, ", ")))
	message.WriteString(fmt.Sprintf("Subject: %s\r\n", fmt.Sprintf("[AnlticsHeat] %s", report.Name)))
	message.WriteString("MIME-Version: 1.0\r\n")
	message.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	message.WriteString("\r\n")
	message.WriteString(strings.Join(lines, "\n"))
	message.WriteString("\n")

	return fmt.Sprintf("[AnlticsHeat] %s", report.Name), message.Bytes(), summaryPayload, nil
}

func (s *Scheduler) sendEmail(recipients []string, subject string, body []byte) error {
	if strings.TrimSpace(s.cfg.AlertSMTPAddr) == "" || strings.TrimSpace(s.cfg.AlertSMTPFrom) == "" {
		return fmt.Errorf("smtp delivery is not configured")
	}
	if len(recipients) == 0 {
		return fmt.Errorf("report has no recipients")
	}

	host, _, err := net.SplitHostPort(strings.TrimSpace(s.cfg.AlertSMTPAddr))
	if err != nil {
		return fmt.Errorf("parse smtp host: %w", err)
	}

	var auth smtp.Auth
	if strings.TrimSpace(s.cfg.AlertSMTPUsername) != "" || strings.TrimSpace(s.cfg.AlertSMTPPassword) != "" {
		auth = smtp.PlainAuth("", strings.TrimSpace(s.cfg.AlertSMTPUsername), strings.TrimSpace(s.cfg.AlertSMTPPassword), host)
	}

	if err := smtp.SendMail(strings.TrimSpace(s.cfg.AlertSMTPAddr), auth, strings.TrimSpace(s.cfg.AlertSMTPFrom), recipients, body); err != nil {
		return fmt.Errorf("send report email %q: %w", subject, err)
	}
	return nil
}

func (s *Scheduler) recordDelivery(ctx context.Context, report reportRow, result reportDeliveryResult, now time.Time) error {
	summaryJSON, _ := json.Marshal(result.Summary)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	deliveryID := reportDeliveryID()
	_, err = tx.Exec(ctx, `
		INSERT INTO analytics_report_deliveries
		(
			id, report_id, site_id, status, subject, recipient_count, attempted_at, delivered_at, error_message, summary_json
		)
		VALUES
		(
			$1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10::jsonb
		)
	`, deliveryID, report.ID, report.SiteID, result.Status, result.Subject, len(report.Recipients), now.UTC(), result.DeliveredAt, strings.TrimSpace(result.Error), string(summaryJSON))
	if err != nil {
		return err
	}

	if result.Status == "delivered" {
		_, err = tx.Exec(ctx, `
			UPDATE analytics_report_configs
			SET last_delivered_at = $2,
			    last_delivery_status = 'delivered',
			    last_delivery_error = NULL,
			    last_delivery_attempt_at = $2,
			    consecutive_failures = 0,
			    updated_at = NOW()
			WHERE id = $1
		`, report.ID, result.DeliveredAt)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE analytics_report_configs
			SET last_delivery_status = 'failed',
			    last_delivery_error = NULLIF($2, ''),
			    last_delivery_attempt_at = $3,
			    consecutive_failures = COALESCE(consecutive_failures, 0) + 1,
			    updated_at = NOW()
			WHERE id = $1
		`, report.ID, strings.TrimSpace(result.Error), now.UTC())
	}
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func reportDue(report reportRow, now time.Time) bool {
	location, err := time.LoadLocation(strings.TrimSpace(report.Timezone))
	if err != nil {
		location = time.UTC
	}
	localNow := now.In(location)
	hour, minute := parseDeliveryClock(report.DeliveryTime)
	scheduledToday := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), hour, minute, 0, 0, location)
	if localNow.Before(scheduledToday) {
		return false
	}

	lastAttempt := time.Time{}
	if report.LastDeliveryAttemptAt != nil {
		lastAttempt = report.LastDeliveryAttemptAt.In(location)
	}

	switch strings.TrimSpace(strings.ToLower(report.Frequency)) {
	case "monthly":
		anchorDay := report.CreatedAt.In(location).Day()
		if localNow.Day() != clampDay(anchorDay, localNow.Year(), localNow.Month(), location) {
			return false
		}
		return lastAttempt.IsZero() || !sameLocalDate(lastAttempt, localNow)
	case "weekly":
		if localNow.Weekday() != report.CreatedAt.In(location).Weekday() {
			return false
		}
		return lastAttempt.IsZero() || !sameLocalDate(lastAttempt, localNow)
	default:
		return lastAttempt.IsZero() || !sameLocalDate(lastAttempt, localNow)
	}
}

func parseRecipients(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == '\r' || r == ','
	})
	recipients := make([]string, 0, len(parts))
	seen := map[string]struct{}{}
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		recipients = append(recipients, trimmed)
	}
	return recipients
}

func parseSections(value string) []string {
	parts := strings.Split(value, ",")
	sections := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			sections = append(sections, trimmed)
		}
	}
	return sections
}

func parseDeliveryClock(value string) (int, int) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 8, 0
	}
	hour, errHour := strconv.Atoi(parts[0])
	minute, errMinute := strconv.Atoi(parts[1])
	if errHour != nil || errMinute != nil || hour < 0 || hour > 23 || minute < 0 || minute > 59 {
		return 8, 0
	}
	return hour, minute
}

func sameLocalDate(a, b time.Time) bool {
	return a.Year() == b.Year() && a.Month() == b.Month() && a.Day() == b.Day()
}

func clampDay(day, year int, month time.Month, location *time.Location) int {
	if day <= 28 {
		return day
	}
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, location).Day()
	if day > last {
		return last
	}
	return day
}

func frequencyToRange(value string) storage.TimeRange {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "daily":
		return storage.Range24Hours
	case "monthly":
		return storage.Range30Days
	default:
		return storage.Range7Days
	}
}

func containsSection(sections []string, target string) bool {
	for _, section := range sections {
		if strings.EqualFold(strings.TrimSpace(section), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func reportDeliveryID() string {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return fmt.Sprintf("report-delivery-%d", time.Now().UTC().UnixNano())
	}
	return "report-delivery-" + fmt.Sprintf("%x", buffer)
}

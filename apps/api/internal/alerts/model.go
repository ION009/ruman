package alerts

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

type Metric string
type Condition string
type Period string
type ChannelType string

const (
	MetricPageviews  Metric = "pageviews"
	MetricVisitors   Metric = "visitors"
	MetricBounceRate Metric = "bounce_rate"
	MetricRageClicks Metric = "rage_clicks"

	ConditionAbove Condition = "above"
	ConditionBelow Condition = "below"

	PeriodHour Period = "1h"
	PeriodDay  Period = "24h"

	ChannelEmail   ChannelType = "email"
	ChannelSlack   ChannelType = "slack"
	ChannelWebhook ChannelType = "webhook"
)

type Alert struct {
	ID          string    `json:"id"`
	SiteID      string    `json:"siteId"`
	Name        string    `json:"name"`
	Metric      Metric    `json:"metric"`
	Condition   Condition `json:"condition"`
	Threshold   float64   `json:"threshold"`
	Period      Period    `json:"period"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   string    `json:"createdAt"`
	UpdatedAt   string    `json:"updatedAt"`
	LastFiredAt *string   `json:"lastFiredAt,omitempty"`
	Channels    []Channel `json:"channels"`
}

type Channel struct {
	ID      string         `json:"id"`
	Type    ChannelType    `json:"type"`
	Name    string         `json:"name"`
	Enabled bool           `json:"enabled"`
	Config  map[string]any `json:"config"`
	Health  ChannelHealth  `json:"health"`
}

type ChannelHealth struct {
	Status         string  `json:"status"`
	LastDeliveryAt *string `json:"lastDeliveryAt,omitempty"`
	LastError      string  `json:"lastError,omitempty"`
	FailureCount   int     `json:"failureCount"`
}

type Firing struct {
	ID             string            `json:"id"`
	AlertID        string            `json:"alertId"`
	FiredAt        string            `json:"firedAt"`
	MetricValue    float64           `json:"metricValue"`
	ThresholdValue float64           `json:"thresholdValue"`
	Condition      Condition         `json:"condition"`
	Period         Period            `json:"period"`
	Deliveries     []DeliveryAttempt `json:"deliveries"`
}

type DeliveryAttempt struct {
	ID           string      `json:"id"`
	ChannelID    string      `json:"channelId"`
	ChannelType  ChannelType `json:"channelType"`
	Status       string      `json:"status"`
	ResponseCode int         `json:"responseCode,omitempty"`
	Error        string      `json:"error,omitempty"`
	CreatedAt    string      `json:"createdAt"`
	DeliveredAt  *string     `json:"deliveredAt,omitempty"`
}

func NormalizeMetric(value string) Metric {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(MetricVisitors):
		return MetricVisitors
	case string(MetricBounceRate):
		return MetricBounceRate
	case string(MetricRageClicks):
		return MetricRageClicks
	default:
		return MetricPageviews
	}
}

func NormalizeCondition(value string) Condition {
	if strings.TrimSpace(strings.ToLower(value)) == string(ConditionBelow) {
		return ConditionBelow
	}
	return ConditionAbove
}

func NormalizePeriod(value string) Period {
	if strings.TrimSpace(strings.ToLower(value)) == string(PeriodHour) {
		return PeriodHour
	}
	return PeriodDay
}

func NormalizeChannelType(value string) ChannelType {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case string(ChannelEmail):
		return ChannelEmail
	case string(ChannelSlack):
		return ChannelSlack
	default:
		return ChannelWebhook
	}
}

func ValidateAlertInput(alert Alert) error {
	if strings.TrimSpace(alert.Name) == "" {
		return errors.New("alert name is required")
	}
	if alert.Threshold < 0 {
		return errors.New("alert threshold must be non-negative")
	}
	if len(alert.Channels) == 0 {
		return errors.New("at least one alert channel is required")
	}
	for index := range alert.Channels {
		if err := ValidateChannel(alert.Channels[index]); err != nil {
			return errors.New("channel " + strconv.Itoa(index+1) + ": " + err.Error())
		}
	}
	return nil
}

func ValidateChannel(channel Channel) error {
	switch NormalizeChannelType(string(channel.Type)) {
	case ChannelEmail:
		recipients := stringSliceFromConfig(channel.Config["recipients"])
		if len(recipients) == 0 {
			return errors.New("email channel requires recipients")
		}
	case ChannelSlack:
		if strings.TrimSpace(configString(channel.Config, "webhookUrl")) == "" {
			return errors.New("slack channel requires webhookUrl")
		}
	case ChannelWebhook:
		if strings.TrimSpace(configString(channel.Config, "url")) == "" {
			return errors.New("webhook channel requires url")
		}
	}
	return nil
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

func stringSliceFromConfig(value any) []string {
	items := []string{}
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				items = append(items, strings.TrimSpace(text))
			}
		}
	case []string:
		for _, item := range typed {
			if strings.TrimSpace(item) != "" {
				items = append(items, strings.TrimSpace(item))
			}
		}
	case string:
		if strings.TrimSpace(typed) != "" {
			items = append(items, strings.TrimSpace(typed))
		}
	}
	return items
}

func CloneConfig(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if typed, ok := value.(map[string]any); ok {
		clone := map[string]any{}
		for key, item := range typed {
			clone[key] = item
		}
		return clone
	}
	raw, _ := json.Marshal(value)
	output := map[string]any{}
	_ = json.Unmarshal(raw, &output)
	return output
}

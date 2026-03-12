package httpapi

import (
	"encoding/json"
	"testing"
)

func TestNormalizeIntegrationPayloadRejectsMissingScope(t *testing.T) {
	_, details, err := normalizeIntegrationPayload(integrationPayload{
		ProviderKey: "google_analytics",
		DisplayName: "GA",
		Config: map[string]any{
			"propertyId":  "properties/1234",
			"accessToken": "token-value-123456",
			"scopes":      []string{"profile.read"},
		},
	})
	if err == nil {
		t.Fatal("expected validation error for missing analytics.readonly scope")
	}
	if len(details) == 0 || details[0].Field == "" {
		t.Fatalf("expected structured validation details, got %+v", details)
	}
}

func TestNormalizeIntegrationPayloadHashesSecrets(t *testing.T) {
	record, details, err := normalizeIntegrationPayload(integrationPayload{
		ProviderKey: "slack",
		DisplayName: "Slack",
		Config: map[string]any{
			"channel":    "#growth",
			"webhookUrl": "https://hooks.slack.com/services/test",
			"botToken":   "xoxb-secret-token",
		},
	})
	if err != nil {
		t.Fatalf("expected valid slack payload, got err=%v details=%+v", err, details)
	}

	credentials := map[string]any{}
	if err := json.Unmarshal(record.CredentialsJSON, &credentials); err != nil {
		t.Fatalf("decode credentials json: %v", err)
	}
	if _, ok := credentials["webhookUrl"]; ok {
		t.Fatalf("expected webhookUrl to be removed from stored credentials, got %+v", credentials)
	}
	if _, ok := credentials["webhookHash"]; !ok {
		t.Fatalf("expected webhookHash in stored credentials, got %+v", credentials)
	}
}

func TestNormalizeAlertPayloadRequiresChannels(t *testing.T) {
	_, err := normalizeAlertPayload("demo-site", alertPayload{
		Name:      "Traffic spike",
		Metric:    "pageviews",
		Condition: "above",
		Threshold: 100,
		Period:    "24h",
		Enabled:   true,
		Channels:  nil,
	})
	if err == nil {
		t.Fatal("expected error when alert has no channels")
	}
}

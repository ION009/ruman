package ingest

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	MaxEventsPerRequest = 50
	MaxFieldLength      = 500
	MaxEventAge         = time.Hour
	MaxEventIDLength    = 96
)

var (
	ErrEmptyBatch       = errors.New("request batch cannot be empty")
	ErrMissingUserAgent = errors.New("user-agent is required")
	ErrBlockedUserAgent = errors.New("user-agent is blocked")
)

var blockedUserAgentTokens = []string{
	"bot",
	"crawler",
	"spider",
	"headless",
	"python",
	"curl",
	"scrapy",
	"selenium",
}

func ValidateUserAgent(userAgent string) error {
	userAgent = strings.TrimSpace(strings.ToLower(userAgent))
	if userAgent == "" {
		return ErrMissingUserAgent
	}

	for _, token := range blockedUserAgentTokens {
		if strings.Contains(userAgent, token) {
			return ErrBlockedUserAgent
		}
	}

	return nil
}

func ValidateEvents(events []Event, now time.Time) error {
	if len(events) == 0 {
		return ErrEmptyBatch
	}
	if len(events) > MaxEventsPerRequest {
		return fmt.Errorf("event batch exceeds %d items", MaxEventsPerRequest)
	}

	now = now.UTC()
	for index, event := range events {
		if err := validateEvent(event, now); err != nil {
			return fmt.Errorf("event %d: %w", index, err)
		}
	}

	return nil
}

func validateEvent(event Event, now time.Time) error {
	if strings.TrimSpace(event.ID) != "" {
		if err := validateStringWithLimit(event.ID, "id", MaxEventIDLength); err != nil {
			return err
		}
	}
	if err := validateString(event.Name, "e"); err != nil {
		return err
	}
	if err := validateString(event.SessionID, "sid"); err != nil {
		return err
	}
	if err := validateString(event.Path, "p"); err != nil {
		return err
	}
	if event.Timestamp == 0 {
		return errors.New("t is required")
	}

	ts := time.UnixMilli(event.Timestamp).UTC()
	if ts.Before(now.Add(-MaxEventAge)) {
		return errors.New("t is older than 1 hour")
	}

	if event.Selector != nil {
		if err := validateString(*event.Selector, "sel"); err != nil {
			return err
		}
	}

	return validateMeta(event.Meta)
}

func validateMeta(value any) error {
	switch typed := value.(type) {
	case nil:
		return nil
	case string:
		if len(typed) > MaxFieldLength {
			return fmt.Errorf("field exceeds %d chars", MaxFieldLength)
		}
		return nil
	case bool, float64, int, int64, uint8, uint64:
		return nil
	case []any:
		for _, item := range typed {
			if err := validateMeta(item); err != nil {
				return err
			}
		}
		return nil
	case map[string]any:
		for key, item := range typed {
			if len(key) > MaxFieldLength {
				return fmt.Errorf("field exceeds %d chars", MaxFieldLength)
			}
			if err := validateMeta(item); err != nil {
				return err
			}
		}
		return nil
	default:
		return nil
	}
}

func validateString(value, field string) error {
	return validateStringWithLimit(value, field, MaxFieldLength)
}

func validateStringWithLimit(value, field string, limit int) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("%s is required", field)
	}
	if len(value) > limit {
		return fmt.Errorf("%s exceeds %d chars", field, limit)
	}
	return nil
}

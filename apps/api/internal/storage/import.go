package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
)

type LegacyImportEvent struct {
	EventID        string
	Type           string
	Name           string
	Timestamp      string
	Path           string
	URL            string
	Title          string
	Referrer       string
	ScreenWidth    uint16
	ScreenHeight   uint16
	ViewportWidth  uint16
	ViewportHeight uint16
	Language       string
	TimezoneOffset int16
	UTMSource      string
	UTMMedium      string
	UTMCampaign    string
	UTMTerm        string
	UTMContent     string
	Props          map[string]string
	VisitorID      string
	SessionID      string
	Browser        string
	BrowserVersion string
	OS             string
	OSVersion      string
	DeviceType     string
	Country        string
	Region         string
	City           string
}

func (s *ClickHouseStore) ImportLegacyEvents(ctx context.Context, siteID string, rows []LegacyImportEvent) error {
	if len(rows) == 0 {
		return nil
	}

	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	for _, row := range rows {
		if err := encoder.Encode(clickHouseLegacyRow{
			SiteID:         siteID,
			EventID:        row.EventID,
			Type:           row.Type,
			Name:           row.Name,
			Timestamp:      row.Timestamp,
			Path:           row.Path,
			URL:            row.URL,
			Title:          row.Title,
			Referrer:       row.Referrer,
			ScreenWidth:    row.ScreenWidth,
			ScreenHeight:   row.ScreenHeight,
			ViewportWidth:  row.ViewportWidth,
			ViewportHeight: row.ViewportHeight,
			Language:       row.Language,
			TimezoneOffset: row.TimezoneOffset,
			UTMSource:      row.UTMSource,
			UTMMedium:      row.UTMMedium,
			UTMCampaign:    row.UTMCampaign,
			UTMTerm:        row.UTMTerm,
			UTMContent:     row.UTMContent,
			Props:          row.Props,
			VisitorID:      row.VisitorID,
			SessionID:      row.SessionID,
			Browser:        row.Browser,
			BrowserVersion: row.BrowserVersion,
			OS:             row.OS,
			OSVersion:      row.OSVersion,
			DeviceType:     row.DeviceType,
			Country:        row.Country,
			Region:         row.Region,
			City:           row.City,
		}); err != nil {
			return fmt.Errorf("encode imported legacy events: %w", err)
		}
	}

	if err := s.executeInsert(ctx, "INSERT INTO events FORMAT JSONEachRow", &body); err != nil {
		return fmt.Errorf("import legacy events: %w", err)
	}
	return nil
}

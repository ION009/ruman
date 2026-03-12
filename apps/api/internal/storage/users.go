package storage

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"slices"
	"strings"
	"time"
)

type UsersProvider interface {
	UserList(ctx context.Context, siteID string, query UserListQuery, rangeValue TimeRange, now time.Time) (UserList, error)
	UserDetail(ctx context.Context, siteID, userHash string, rangeValue TimeRange, now time.Time) (UserDetail, error)
}

type UserListQuery struct {
	Page    int    `json:"page"`
	Limit   int    `json:"limit"`
	Sort    string `json:"sort"`
	Order   string `json:"order"`
	Search  string `json:"search"`
	Country string `json:"country"`
	Region  string `json:"region"`
	Browser string `json:"browser"`
	OS      string `json:"os"`
}

type UserList struct {
	Range   string          `json:"range"`
	Page    int             `json:"page"`
	Limit   int             `json:"limit"`
	Total   int             `json:"total"`
	Sort    string          `json:"sort"`
	Order   string          `json:"order"`
	Filters UserListFilters `json:"filters"`
	Privacy UserPrivacyNote `json:"privacy"`
	Users   []UserRow       `json:"users"`
}

type UserListFilters struct {
	Search  string `json:"search"`
	Country string `json:"country"`
	Region  string `json:"region"`
	Browser string `json:"browser"`
	OS      string `json:"os"`
}

type UserPrivacyNote struct {
	AliasMode        string `json:"aliasMode"`
	IdentifierPolicy string `json:"identifierPolicy"`
	DataPolicy       string `json:"dataPolicy"`
	Verified         bool   `json:"verified"`
}

type UserRow struct {
	UserKey   string          `json:"-"`
	UserHash  string          `json:"userHash"`
	Alias     string          `json:"alias"`
	Country   string          `json:"country"`
	State     string          `json:"state"`
	Browser   string          `json:"browser"`
	OS        string          `json:"os"`
	Pageviews int             `json:"pageviews"`
	Events    int             `json:"events"`
	TopPages  []UserCountItem `json:"topPages"`
	TopEvents []UserCountItem `json:"topEvents"`
	FirstSeen string          `json:"firstSeen"`
	LastSeen  string          `json:"lastSeen"`
}

type UserCountItem struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type UserSessionItem struct {
	SessionHash     string `json:"sessionHash"`
	StartedAt       string `json:"startedAt"`
	LastSeenAt      string `json:"lastSeenAt"`
	DurationSeconds int    `json:"durationSeconds"`
	EntryPath       string `json:"entryPath"`
	ExitPath        string `json:"exitPath"`
	PageCount       int    `json:"pageCount"`
	EventCount      int    `json:"eventCount"`
	HasReplay       bool   `json:"hasReplay"`
}

type UserDetail struct {
	Range    string            `json:"range"`
	User     UserRow           `json:"user"`
	Pages    []UserCountItem   `json:"pages"`
	Events   []UserCountItem   `json:"events"`
	Sessions []UserSessionItem `json:"sessions"`
	Privacy  UserPrivacyNote   `json:"privacy"`
}

func NormalizeUserListQuery(query UserListQuery) UserListQuery {
	if query.Page < 1 {
		query.Page = 1
	}
	if query.Limit <= 0 {
		query.Limit = 25
	}
	if query.Limit > 100 {
		query.Limit = 100
	}
	switch strings.ToLower(strings.TrimSpace(query.Sort)) {
	case "first_seen", "country", "browser", "os", "pageviews", "events", "alias":
		query.Sort = strings.ToLower(strings.TrimSpace(query.Sort))
	default:
		query.Sort = "last_seen"
	}
	switch strings.ToLower(strings.TrimSpace(query.Order)) {
	case "asc":
		query.Order = "asc"
	default:
		query.Order = "desc"
	}
	query.Search = strings.TrimSpace(strings.ToLower(query.Search))
	query.Country = strings.TrimSpace(strings.ToUpper(query.Country))
	query.Region = strings.TrimSpace(strings.ToUpper(query.Region))
	query.Browser = strings.TrimSpace(strings.ToLower(query.Browser))
	query.OS = strings.TrimSpace(strings.ToLower(query.OS))
	return query
}

func DefaultUserPrivacyNote() UserPrivacyNote {
	return UserPrivacyNote{
		AliasMode:        "Deterministic fictional aliases generated from a privacy-safe user hash.",
		IdentifierPolicy: "No real names or personal identifiers are stored or returned by this API.",
		DataPolicy:       "Country and state remain coarse, and user detail stays scoped to pseudonymous activity only.",
		Verified:         true,
	}
}

func UserHash(siteID, userKey string) string {
	sum := md5.Sum([]byte(strings.TrimSpace(siteID) + ":" + strings.TrimSpace(userKey)))
	return hex.EncodeToString(sum[:])
}

func FictionalUserName(userHash string) string {
	if len(userHash) < 6 {
		return "Zon"
	}

	prefixes := []string{"Xy", "Zo", "Lee", "Nex", "Tavi", "Sol", "Rin", "Kai", "Mori", "Luma", "Veo", "Nori"}
	middles := []string{"", "y", "ee", "ai", "o", "u", "in", "or", "el", "an", "ix", "oa"}
	suffixes := []string{"", "n", "on", "in", "a", "eo", "i", "or", "en", "yx", "um", "elle"}

	one := int(userHash[0]) % len(prefixes)
	two := int(userHash[2]) % len(middles)
	three := int(userHash[4]) % len(suffixes)
	name := prefixes[one] + middles[two] + suffixes[three]
	name = strings.TrimSpace(name)
	if len(name) < 3 {
		name += "in"
	}
	return name
}

func FilterAndPaginateUserRows(rows []UserRow, query UserListQuery) (UserListQuery, int, []UserRow) {
	query = NormalizeUserListQuery(query)
	filtered := make([]UserRow, 0, len(rows))
	for _, row := range rows {
		if query.Search != "" {
			searchable := strings.ToLower(strings.Join([]string{row.Alias, row.UserHash, row.Country, row.State, row.Browser, row.OS}, " "))
			if !strings.Contains(searchable, query.Search) {
				continue
			}
		}
		if query.Country != "" && strings.ToUpper(row.Country) != query.Country {
			continue
		}
		if query.Region != "" && strings.ToUpper(row.State) != query.Region {
			continue
		}
		if query.Browser != "" && strings.ToLower(row.Browser) != query.Browser {
			continue
		}
		if query.OS != "" && strings.ToLower(row.OS) != query.OS {
			continue
		}
		filtered = append(filtered, row)
	}

	slices.SortFunc(filtered, func(a, b UserRow) int {
		result := 0
		switch query.Sort {
		case "first_seen":
			result = strings.Compare(a.FirstSeen, b.FirstSeen)
		case "country":
			result = strings.Compare(a.Country, b.Country)
		case "browser":
			result = strings.Compare(a.Browser, b.Browser)
		case "os":
			result = strings.Compare(a.OS, b.OS)
		case "pageviews":
			result = a.Pageviews - b.Pageviews
		case "events":
			result = a.Events - b.Events
		case "alias":
			result = strings.Compare(a.Alias, b.Alias)
		default:
			result = strings.Compare(a.LastSeen, b.LastSeen)
		}
		if result == 0 {
			result = strings.Compare(a.UserHash, b.UserHash)
		}
		if query.Order == "asc" {
			return result
		}
		return -result
	})

	total := len(filtered)
	start := (query.Page - 1) * query.Limit
	if start > total {
		return query, total, []UserRow{}
	}
	end := start + query.Limit
	if end > total {
		end = total
	}
	return query, total, slices.Clone(filtered[start:end])
}

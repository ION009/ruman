package storage

import (
	"slices"
	"strconv"
	"strings"
	"time"
)

var retentionPeriods = []int{1, 7, 14, 30}

const (
	retentionPrivacyFloor = 3
	defaultRetentionLimit = 12
	maxRetentionLimit     = 24
)

type retentionActivityDay struct {
	UserID      string
	ActivityDay time.Time
	Device      string
	CountryCode string
	CountryName string
}

type retentionUser struct {
	UserID      string
	FirstSeen   time.Time
	Device      string
	CountryCode string
	CountryName string
	ActiveDays  map[string]struct{}
}

func buildRetentionReport(days []retentionActivityDay, query RetentionQuery, rangeValue TimeRange, now time.Time) RetentionReport {
	report, _ := buildRetentionArtifacts(days, query, rangeValue, now.UTC())
	return report
}

func buildRetentionTrend(days []retentionActivityDay, query RetentionQuery, rangeValue TimeRange, now time.Time) RetentionTrendView {
	_, trend := buildRetentionArtifacts(days, query, rangeValue, now.UTC())
	return trend
}

func buildRetentionArtifacts(days []retentionActivityDay, query RetentionQuery, rangeValue TimeRange, now time.Time) (RetentionReport, RetentionTrendView) {
	rangeStart, rangeEnd := rangeBounds(rangeValue, now.UTC())
	users := buildRetentionUsers(days, rangeEnd)
	deviceOptions, countryOptions := buildRetentionFilterOptions(users, rangeStart, rangeEnd)
	selectedCadence := ParseRetentionCadence(query.Cadence)
	filteredUsers := filterRetentionUsers(users, query, rangeStart, rangeEnd)
	limit := query.Limit
	switch {
	case limit <= 0:
		limit = defaultRetentionLimit
	case limit > maxRetentionLimit:
		limit = maxRetentionLimit
	}

	report := RetentionReport{
		Range: rangeValue.String(),
		Filters: RetentionFilterState{
			Cadence:   string(selectedCadence),
			Device:    normalizeJourneyDeviceFilter(query.DeviceFilter),
			Country:   normalizeJourneyCountryFilter(query.CountryFilter),
			Devices:   deviceOptions,
			Countries: countryOptions,
		},
		Periods: slices.Clone(retentionPeriods),
		Summary: RetentionSummary{
			PrivacyFloor: retentionPrivacyFloor,
		},
	}
	trend := RetentionTrendView{
		Range:   rangeValue.String(),
		Filters: report.Filters,
		Summary: report.Summary,
	}

	if len(filteredUsers) == 0 {
		return report, trend
	}

	cohorts := map[string]*RetentionCohortRow{}
	curveEligible := map[int]int{}
	curveReturned := map[int]int{}
	totalActiveDays := 0

	for _, user := range filteredUsers {
		totalActiveDays += len(user.ActiveDays)
		cohortDate := retentionCohortStart(user.FirstSeen, selectedCadence)
		cohortKey := cohortDate.Format("2006-01-02")
		row := cohorts[cohortKey]
		if row == nil {
			row = &RetentionCohortRow{
				CohortDate: cohortKey,
				Label:      retentionCohortLabel(cohortDate, selectedCadence),
				Points:     make([]RetentionPoint, 0, len(retentionPeriods)),
			}
			cohorts[cohortKey] = row
		}
		row.CohortSize += 1
	}

	for _, row := range cohorts {
		cohortDate, _ := time.Parse("2006-01-02", row.CohortDate)
		row.Points = make([]RetentionPoint, 0, len(retentionPeriods))
		eligibleShareTotal := 0.0
		for _, period := range retentionPeriods {
			eligibleUsers := 0
			returnedUsers := 0
			for _, user := range filteredUsers {
				if !retentionCohortStart(user.FirstSeen, selectedCadence).Equal(cohortDate) {
					continue
				}
				targetDay := user.FirstSeen.AddDate(0, 0, period)
				if targetDay.After(rangeEnd) {
					continue
				}
				eligibleUsers += 1
				if _, ok := user.ActiveDays[targetDay.Format("2006-01-02")]; ok {
					returnedUsers += 1
				}
			}

			fresh := eligibleUsers == row.CohortSize && eligibleUsers > 0
			if eligibleUsers < retentionPrivacyFloor || row.CohortSize < retentionPrivacyFloor {
				eligibleUsers = 0
				returnedUsers = 0
				fresh = false
			}

			row.Points = append(row.Points, RetentionPoint{
				Period:        period,
				Label:         "Day " + strings.TrimSpace(intString(period)),
				EligibleUsers: eligibleUsers,
				ReturnedUsers: returnedUsers,
				Rate:          percentage(returnedUsers, maxInt(eligibleUsers, 1)),
				Fresh:         fresh,
			})
			curveEligible[period] += eligibleUsers
			curveReturned[period] += returnedUsers
			if row.CohortSize > 0 {
				eligibleShareTotal += float64(eligibleUsers) / float64(row.CohortSize)
			}
		}

		switch {
		case len(row.Points) == 0:
			row.Freshness = "empty"
		case eligibleShareTotal >= float64(len(row.Points)):
			row.Freshness = "complete"
		case eligibleShareTotal > 0:
			row.Freshness = "partial"
		default:
			row.Freshness = "too-fresh"
		}
		row.Confidence = retentionConfidence(row.CohortSize, row.Points)
	}

	rows := make([]RetentionCohortRow, 0, len(cohorts))
	for _, row := range cohorts {
		rows = append(rows, *row)
	}
	slices.SortFunc(rows, func(left, right RetentionCohortRow) int {
		return strings.Compare(right.CohortDate, left.CohortDate)
	})
	rows = limitSlice(rows, limit)

	curve := make([]RetentionTrendPoint, 0, len(retentionPeriods))
	for _, period := range retentionPeriods {
		eligibleUsers := curveEligible[period]
		returnedUsers := curveReturned[period]
		rate := percentage(returnedUsers, maxInt(eligibleUsers, 1))
		curve = append(curve, RetentionTrendPoint{
			Period:        period,
			Label:         "Day " + strings.TrimSpace(intString(period)),
			EligibleUsers: eligibleUsers,
			ReturnedUsers: returnedUsers,
			Rate:          rate,
			Confidence:    retentionConfidence(eligibleUsers, nil),
		})
	}

	summary := RetentionSummary{
		Users:          len(filteredUsers),
		Cohorts:        len(cohorts),
		Day1Rate:       retentionRateForPeriod(curve, 1),
		Day7Rate:       retentionRateForPeriod(curve, 7),
		Day14Rate:      retentionRateForPeriod(curve, 14),
		Day30Rate:      retentionRateForPeriod(curve, 30),
		AvgActiveDays:  averageFloat(float64(totalActiveDays), len(filteredUsers)),
		PrivacyFloor:   retentionPrivacyFloor,
		Confidence:     retentionTrendConfidence(curve),
		ConfidenceText: retentionConfidenceLabel(retentionTrendConfidence(curve)),
	}
	report.Summary = summary
	report.Cohorts = rows
	trend.Summary = summary
	trend.Curve = curve
	return report, trend
}

func buildRetentionUsers(days []retentionActivityDay, rangeEnd time.Time) []retentionUser {
	users := map[string]*retentionUser{}
	for _, day := range days {
		if day.ActivityDay.After(rangeEnd) {
			continue
		}
		userID := strings.TrimSpace(day.UserID)
		if userID == "" {
			continue
		}
		item := users[userID]
		if item == nil {
			item = &retentionUser{
				UserID:      userID,
				FirstSeen:   day.ActivityDay,
				Device:      normalizeJourneyDeviceValue(day.Device),
				CountryCode: strings.ToUpper(strings.TrimSpace(day.CountryCode)),
				CountryName: strings.TrimSpace(day.CountryName),
				ActiveDays:  map[string]struct{}{},
			}
			users[userID] = item
		}
		if day.ActivityDay.Before(item.FirstSeen) {
			item.FirstSeen = day.ActivityDay
			item.Device = normalizeJourneyDeviceValue(day.Device)
			item.CountryCode = strings.ToUpper(strings.TrimSpace(day.CountryCode))
			item.CountryName = strings.TrimSpace(day.CountryName)
		}
		item.ActiveDays[day.ActivityDay.Format("2006-01-02")] = struct{}{}
	}

	output := make([]retentionUser, 0, len(users))
	for _, user := range users {
		output = append(output, *user)
	}
	return output
}

func retentionActivityFromEvents(events []dashboardEvent) []retentionActivityDay {
	seen := map[string]struct{}{}
	output := make([]retentionActivityDay, 0, len(events))
	for _, event := range events {
		if strings.TrimSpace(event.Name) != "pageview" {
			continue
		}
		userID := event.visitorKey()
		if userID == "" {
			continue
		}
		activityDay := time.Date(event.Timestamp.Year(), event.Timestamp.Month(), event.Timestamp.Day(), 0, 0, 0, 0, time.UTC)
		location := event.geoLocation()
		key := strings.Join([]string{
			userID,
			activityDay.Format("2006-01-02"),
			normalizeJourneyDeviceValue(event.deviceType()),
			strings.ToUpper(strings.TrimSpace(location.CountryCode)),
		}, "::")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		output = append(output, retentionActivityDay{
			UserID:      userID,
			ActivityDay: activityDay,
			Device:      normalizeJourneyDeviceValue(event.deviceType()),
			CountryCode: strings.ToUpper(strings.TrimSpace(location.CountryCode)),
			CountryName: strings.TrimSpace(location.countryLabel()),
		})
	}
	return output
}

func filterRetentionUsers(users []retentionUser, query RetentionQuery, rangeStart, rangeEnd time.Time) []retentionUser {
	deviceFilter := normalizeJourneyDeviceFilter(query.DeviceFilter)
	countryFilter := normalizeJourneyCountryFilter(query.CountryFilter)
	filtered := make([]retentionUser, 0, len(users))
	for _, user := range users {
		if user.FirstSeen.Before(rangeStart) || user.FirstSeen.After(rangeEnd) {
			continue
		}
		if deviceFilter != "" && user.Device != deviceFilter {
			continue
		}
		if countryFilter != "" && user.CountryCode != countryFilter {
			continue
		}
		filtered = append(filtered, user)
	}
	return filtered
}

func buildRetentionFilterOptions(users []retentionUser, rangeStart, rangeEnd time.Time) ([]JourneyFilterOption, []JourneyFilterOption) {
	deviceCounts := map[string]int{}
	countryCounts := map[string]JourneyFilterOption{}
	for _, user := range users {
		if user.FirstSeen.Before(rangeStart) || user.FirstSeen.After(rangeEnd) {
			continue
		}
		deviceCounts[user.Device] += 1
		if user.CountryCode != "" {
			current := countryCounts[user.CountryCode]
			current.Value = user.CountryCode
			current.Label = user.CountryName
			if current.Label == "" {
				current.Label = user.CountryCode
			}
			current.Count += 1
			countryCounts[user.CountryCode] = current
		}
	}

	devices := make([]JourneyFilterOption, 0, len(deviceCounts))
	for value, count := range deviceCounts {
		devices = append(devices, JourneyFilterOption{
			Value: value,
			Label: journeyDeviceLabel(value),
			Count: count,
		})
	}
	slices.SortFunc(devices, func(left, right JourneyFilterOption) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Value, right.Value)
		}
	})

	countries := make([]JourneyFilterOption, 0, len(countryCounts))
	for _, item := range countryCounts {
		countries = append(countries, item)
	}
	slices.SortFunc(countries, func(left, right JourneyFilterOption) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Value, right.Value)
		}
	})
	return devices, countries
}

func retentionCohortStart(firstSeen time.Time, cadence RetentionCadence) time.Time {
	firstSeen = time.Date(firstSeen.Year(), firstSeen.Month(), firstSeen.Day(), 0, 0, 0, 0, time.UTC)
	switch cadence {
	case RetentionCadenceWeekly:
		offset := (int(firstSeen.Weekday()) + 6) % 7
		return firstSeen.AddDate(0, 0, -offset)
	case RetentionCadenceMonthly:
		return time.Date(firstSeen.Year(), firstSeen.Month(), 1, 0, 0, 0, 0, time.UTC)
	default:
		return firstSeen
	}
}

func retentionCohortLabel(cohortDate time.Time, cadence RetentionCadence) string {
	switch cadence {
	case RetentionCadenceWeekly:
		return "Week of " + cohortDate.Format("Jan 2, 2006")
	case RetentionCadenceMonthly:
		return cohortDate.Format("Jan 2006")
	default:
		return cohortDate.Format("Jan 2")
	}
}

func retentionConfidence(cohortSize int, points []RetentionPoint) float64 {
	score := 0.0
	if cohortSize > 0 {
		score += minFloat(1, float64(cohortSize)/150) * 70
	}
	if len(points) > 0 {
		fresh := 0
		for _, point := range points {
			if point.Fresh {
				fresh += 1
			}
		}
		score += (float64(fresh) / float64(len(points))) * 30
	}
	return round1(score)
}

func retentionConfidenceLabel(value float64) string {
	switch {
	case value >= 80:
		return "high"
	case value >= 50:
		return "medium"
	default:
		return "low"
	}
}

func retentionRateForPeriod(curve []RetentionTrendPoint, period int) float64 {
	for _, point := range curve {
		if point.Period == period {
			return point.Rate
		}
	}
	return 0
}

func totalEligibleUsers(curve []RetentionTrendPoint) int {
	total := 0
	for _, point := range curve {
		total += point.EligibleUsers
	}
	return total
}

func retentionTrendConfidence(curve []RetentionTrendPoint) float64 {
	if len(curve) == 0 {
		return 0
	}
	freshPoints := 0
	for _, point := range curve {
		if point.EligibleUsers >= retentionPrivacyFloor {
			freshPoints += 1
		}
	}
	score := minFloat(1, float64(totalEligibleUsers(curve))/400)*70 + (float64(freshPoints)/float64(len(curve)))*30
	return round1(score)
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func intString(value int) string {
	return strconv.Itoa(value)
}

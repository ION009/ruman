package storage

import (
	"net/url"
	"slices"
	"strconv"
	"strings"
)

const (
	defaultJourneyLimit         = 12
	maxJourneyLimit             = 24
	maxJourneyGraphDepth        = 6
	maxJourneyDistributionItems = 10
)

type journeySessionRoute struct {
	SessionID      string
	Device         string
	CountryCode    string
	CountryLabel   string
	RawPaths       []string
	CanonicalPaths []string
	PathLength     int
	ReplayBacked   bool
}

type journeyNodeAggregate struct {
	ID                   string
	StageIndex           int
	CanonicalPath        string
	RepresentativeCounts map[string]int
	Sessions             int
	EntryCount           int
	ExitCount            int
	ReplayBackedSessions int
}

type journeyLinkAggregate struct {
	ID                   string
	SourceID             string
	TargetID             string
	SourceRepresentative map[string]int
	TargetRepresentative map[string]int
	Sessions             int
	ReplayBackedSessions int
}

type journeyPathAggregate struct {
	ID                   string
	CanonicalPaths       []string
	RepresentativeCounts map[string]int
	Sessions             int
	ReplayBackedSessions int
}

type journeyDistributionAggregate struct {
	CanonicalPath        string
	RepresentativeCounts map[string]int
	Count                int
	ReplayBackedSessions int
}

func buildJourneysView(events []dashboardEvent, query JourneyQuery, rangeValue TimeRange) JourneysView {
	routes := buildJourneySessionRoutes(events, query)
	deviceOptions, countryOptions := journeyFilterOptions(routes)
	filteredRoutes := filterJourneyRoutes(routes, query)
	limit := query.Limit
	switch {
	case limit <= 0:
		limit = defaultJourneyLimit
	case limit > maxJourneyLimit:
		limit = maxJourneyLimit
	}

	view := JourneysView{
		Range: rangeValue.String(),
		Filters: JourneyFilterState{
			Device:    normalizeJourneyDeviceFilter(query.DeviceFilter),
			Country:   normalizeJourneyCountryFilter(query.CountryFilter),
			Devices:   deviceOptions,
			Countries: countryOptions,
		},
	}

	if len(filteredRoutes) == 0 {
		return view
	}

	nodeAgg := map[string]*journeyNodeAggregate{}
	linkAgg := map[string]*journeyLinkAggregate{}
	pathAgg := map[string]*journeyPathAggregate{}
	entryAgg := map[string]*journeyDistributionAggregate{}
	exitAgg := map[string]*journeyDistributionAggregate{}
	pathLengthCounts := map[int]int{}
	totalPathLength := 0
	replayBackedSessions := 0

	for _, route := range filteredRoutes {
		if route.ReplayBacked {
			replayBackedSessions += 1
		}
		totalPathLength += route.PathLength
		pathLengthCounts[route.PathLength] += 1

		if len(route.CanonicalPaths) == 0 {
			continue
		}

		pathKey := strings.Join(route.CanonicalPaths, "\x1f")
		pathItem := pathAgg[pathKey]
		if pathItem == nil {
			pathItem = &journeyPathAggregate{
				ID:                   pathKey,
				CanonicalPaths:       slices.Clone(route.CanonicalPaths),
				RepresentativeCounts: map[string]int{},
			}
			pathAgg[pathKey] = pathItem
		}
		pathItem.Sessions += 1
		if route.ReplayBacked {
			pathItem.ReplayBackedSessions += 1
		}
		pathItem.RepresentativeCounts[strings.Join(route.RawPaths, "\x1f")] += 1

		firstPath := route.CanonicalPaths[0]
		entryItem := entryAgg[firstPath]
		if entryItem == nil {
			entryItem = &journeyDistributionAggregate{
				CanonicalPath:        firstPath,
				RepresentativeCounts: map[string]int{},
			}
			entryAgg[firstPath] = entryItem
		}
		entryItem.Count += 1
		if route.ReplayBacked {
			entryItem.ReplayBackedSessions += 1
		}
		entryItem.RepresentativeCounts[route.RawPaths[0]] += 1

		lastPath := route.CanonicalPaths[len(route.CanonicalPaths)-1]
		exitItem := exitAgg[lastPath]
		if exitItem == nil {
			exitItem = &journeyDistributionAggregate{
				CanonicalPath:        lastPath,
				RepresentativeCounts: map[string]int{},
			}
			exitAgg[lastPath] = exitItem
		}
		exitItem.Count += 1
		if route.ReplayBacked {
			exitItem.ReplayBackedSessions += 1
		}
		exitItem.RepresentativeCounts[route.RawPaths[len(route.RawPaths)-1]] += 1

		for stageIndex, canonicalPath := range route.CanonicalPaths {
			nodeID := journeyNodeID(stageIndex, canonicalPath)
			nodeItem := nodeAgg[nodeID]
			if nodeItem == nil {
				nodeItem = &journeyNodeAggregate{
					ID:                   nodeID,
					StageIndex:           stageIndex,
					CanonicalPath:        canonicalPath,
					RepresentativeCounts: map[string]int{},
				}
				nodeAgg[nodeID] = nodeItem
			}
			nodeItem.Sessions += 1
			nodeItem.RepresentativeCounts[route.RawPaths[stageIndex]] += 1
			if stageIndex == 0 {
				nodeItem.EntryCount += 1
			}
			if stageIndex == len(route.CanonicalPaths)-1 {
				nodeItem.ExitCount += 1
			}
			if route.ReplayBacked {
				nodeItem.ReplayBackedSessions += 1
			}

			if stageIndex >= len(route.CanonicalPaths)-1 {
				continue
			}
			linkID := nodeID + "->" + journeyNodeID(stageIndex+1, route.CanonicalPaths[stageIndex+1])
			linkItem := linkAgg[linkID]
			if linkItem == nil {
				linkItem = &journeyLinkAggregate{
					ID:                   linkID,
					SourceID:             nodeID,
					TargetID:             journeyNodeID(stageIndex+1, route.CanonicalPaths[stageIndex+1]),
					SourceRepresentative: map[string]int{},
					TargetRepresentative: map[string]int{},
				}
				linkAgg[linkID] = linkItem
			}
			linkItem.Sessions += 1
			if route.ReplayBacked {
				linkItem.ReplayBackedSessions += 1
			}
			linkItem.SourceRepresentative[route.RawPaths[stageIndex]] += 1
			linkItem.TargetRepresentative[route.RawPaths[stageIndex+1]] += 1
		}
	}

	totalSessions := len(filteredRoutes)
	outgoingTotals := map[string]int{}
	nodeBranchStrength := map[string]float64{}
	for _, item := range linkAgg {
		outgoingTotals[item.SourceID] += item.Sessions
	}

	linkItems := make([]JourneyLink, 0, len(linkAgg))
	for _, item := range linkAgg {
		branchStrength := percentage(item.Sessions, outgoingTotals[item.SourceID])
		if branchStrength > nodeBranchStrength[item.SourceID] {
			nodeBranchStrength[item.SourceID] = branchStrength
		}
		linkItems = append(linkItems, JourneyLink{
			ID:                   item.ID,
			SourceID:             item.SourceID,
			TargetID:             item.TargetID,
			SourcePath:           mostCommonJourneyValue(item.SourceRepresentative),
			TargetPath:           mostCommonJourneyValue(item.TargetRepresentative),
			Sessions:             item.Sessions,
			Share:                percentage(item.Sessions, totalSessions),
			BranchStrength:       branchStrength,
			ReplayBackedSessions: item.ReplayBackedSessions,
			ModeledSessions:      item.Sessions - item.ReplayBackedSessions,
			Provenance:           journeyProvenance(item.ReplayBackedSessions, item.Sessions),
		})
	}
	slices.SortFunc(linkItems, func(left, right JourneyLink) int {
		switch {
		case left.Sessions != right.Sessions:
			return right.Sessions - left.Sessions
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})
	linkItems = limitSlice(linkItems, limit*2)

	nodeItems := make([]JourneyNode, 0, len(nodeAgg))
	for _, item := range nodeAgg {
		representative := mostCommonJourneyValue(item.RepresentativeCounts)
		branchStrength := nodeBranchStrength[item.ID]
		if branchStrength == 0 {
			branchStrength = percentage(item.ExitCount, item.Sessions)
		}
		nodeItems = append(nodeItems, JourneyNode{
			ID:                   item.ID,
			Path:                 representative,
			CanonicalPath:        item.CanonicalPath,
			GroupName:            journeyGroupName(item.CanonicalPath, representative),
			IntentStage:          journeyIntentStage(item.CanonicalPath, item.StageIndex),
			StageIndex:           item.StageIndex,
			Sessions:             item.Sessions,
			Share:                percentage(item.Sessions, totalSessions),
			EntryCount:           item.EntryCount,
			ExitCount:            item.ExitCount,
			BranchStrength:       branchStrength,
			ReplayBackedSessions: item.ReplayBackedSessions,
			ModeledSessions:      item.Sessions - item.ReplayBackedSessions,
			Provenance:           journeyProvenance(item.ReplayBackedSessions, item.Sessions),
		})
	}
	slices.SortFunc(nodeItems, func(left, right JourneyNode) int {
		switch {
		case left.StageIndex != right.StageIndex:
			return left.StageIndex - right.StageIndex
		case left.Sessions != right.Sessions:
			return right.Sessions - left.Sessions
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})
	nodeItems = limitSlice(nodeItems, limit*2)

	commonPaths := make([]JourneyPath, 0, len(pathAgg))
	topPathShare := 0.0
	for _, item := range pathAgg {
		representative := strings.Split(mostCommonJourneyValue(item.RepresentativeCounts), "\x1f")
		commonPaths = append(commonPaths, JourneyPath{
			ID:                   item.ID,
			Paths:                representative,
			CanonicalPaths:       slices.Clone(item.CanonicalPaths),
			Sessions:             item.Sessions,
			Share:                percentage(item.Sessions, totalSessions),
			ReplayBackedSessions: item.ReplayBackedSessions,
			ModeledSessions:      item.Sessions - item.ReplayBackedSessions,
			Provenance:           journeyProvenance(item.ReplayBackedSessions, item.Sessions),
		})
	}
	slices.SortFunc(commonPaths, func(left, right JourneyPath) int {
		switch {
		case left.Sessions != right.Sessions:
			return right.Sessions - left.Sessions
		default:
			return strings.Compare(left.ID, right.ID)
		}
	})
	if len(commonPaths) > 0 {
		topPathShare = commonPaths[0].Share
	}
	commonPaths = limitSlice(commonPaths, limit)

	entryDistribution := buildJourneyDistribution(entryAgg, totalSessions)
	exitDistribution := buildJourneyDistribution(exitAgg, totalSessions)
	entryDistribution = limitSlice(entryDistribution, maxJourneyDistributionItems)
	exitDistribution = limitSlice(exitDistribution, maxJourneyDistributionItems)

	lengthDistribution := make([]JourneyPathLengthBucket, 0, len(pathLengthCounts))
	for length, count := range pathLengthCounts {
		lengthDistribution = append(lengthDistribution, JourneyPathLengthBucket{
			Length: length,
			Count:  count,
			Share:  percentage(count, totalSessions),
		})
	}
	slices.SortFunc(lengthDistribution, func(left, right JourneyPathLengthBucket) int {
		return left.Length - right.Length
	})

	view.Summary = JourneySummary{
		Sessions:             totalSessions,
		ReplayBackedSessions: replayBackedSessions,
		ModeledSessions:      totalSessions - replayBackedSessions,
		UniquePaths:          len(nodeAgg),
		UniqueTransitions:    len(linkAgg),
		UniqueCommonPaths:    len(pathAgg),
		AvgPathLength:        round1(float64(totalPathLength) / float64(maxInt(totalSessions, 1))),
		MedianPathLength:     journeyMedianPathLength(pathLengthCounts, totalSessions),
		TopPathShare:         topPathShare,
	}
	view.Nodes = nodeItems
	view.Links = linkItems
	view.CommonPaths = commonPaths
	view.EntryDistribution = entryDistribution
	view.ExitDistribution = exitDistribution
	view.PathLengthDistribution = lengthDistribution
	return view
}

func buildJourneySessionRoutes(events []dashboardEvent, query JourneyQuery) []journeySessionRoute {
	replaySet := map[string]struct{}{}
	for _, sessionID := range query.ReplaySessionIDs {
		trimmed := strings.TrimSpace(sessionID)
		if trimmed == "" {
			continue
		}
		replaySet[trimmed] = struct{}{}
	}

	ordered := slices.Clone(events)
	slices.SortFunc(ordered, compareDashboardEvents)

	routes := map[string]*journeySessionRoute{}
	for _, event := range ordered {
		if strings.TrimSpace(event.Name) != "pageview" {
			continue
		}
		sessionID := event.sessionKey()
		if sessionID == "" {
			continue
		}
		path := strings.TrimSpace(event.Path)
		if path == "" {
			continue
		}

		item := routes[sessionID]
		if item == nil {
			location := event.geoLocation()
			_, replayBacked := replaySet[sessionID]
			item = &journeySessionRoute{
				SessionID:    sessionID,
				Device:       normalizeJourneyDeviceValue(event.deviceType()),
				CountryCode:  strings.ToUpper(strings.TrimSpace(location.CountryCode)),
				CountryLabel: strings.TrimSpace(location.countryLabel()),
				ReplayBacked: replayBacked,
			}
			routes[sessionID] = item
		}
		if item.Device == "" {
			item.Device = normalizeJourneyDeviceValue(event.deviceType())
		}
		if item.CountryCode == "" {
			location := event.geoLocation()
			item.CountryCode = strings.ToUpper(strings.TrimSpace(location.CountryCode))
			item.CountryLabel = strings.TrimSpace(location.countryLabel())
		}

		rawPath := normalizeJourneyPath(path)
		if len(item.RawPaths) == 0 || item.RawPaths[len(item.RawPaths)-1] != rawPath {
			item.RawPaths = append(item.RawPaths, rawPath)
		}
	}

	output := make([]journeySessionRoute, 0, len(routes))
	for _, item := range routes {
		if len(item.RawPaths) == 0 {
			continue
		}
		item.PathLength = len(item.RawPaths)
		item.RawPaths = limitSlice(item.RawPaths, maxJourneyGraphDepth)
		item.CanonicalPaths = make([]string, 0, len(item.RawPaths))
		for _, path := range item.RawPaths {
			item.CanonicalPaths = append(item.CanonicalPaths, canonicalJourneyPath(path))
		}
		output = append(output, *item)
	}
	return output
}

func filterJourneyRoutes(routes []journeySessionRoute, query JourneyQuery) []journeySessionRoute {
	deviceFilter := normalizeJourneyDeviceFilter(query.DeviceFilter)
	countryFilter := normalizeJourneyCountryFilter(query.CountryFilter)
	if deviceFilter == "" && countryFilter == "" {
		return routes
	}

	filtered := make([]journeySessionRoute, 0, len(routes))
	for _, route := range routes {
		if deviceFilter != "" && route.Device != deviceFilter {
			continue
		}
		if countryFilter != "" && route.CountryCode != countryFilter {
			continue
		}
		filtered = append(filtered, route)
	}
	return filtered
}

func journeyFilterOptions(routes []journeySessionRoute) ([]JourneyFilterOption, []JourneyFilterOption) {
	deviceCounts := map[string]int{}
	countryCounts := map[string]JourneyFilterOption{}
	for _, route := range routes {
		if route.Device != "" {
			deviceCounts[route.Device] += 1
		}
		if route.CountryCode != "" {
			current := countryCounts[route.CountryCode]
			current.Value = route.CountryCode
			current.Label = route.CountryLabel
			if current.Label == "" {
				current.Label = route.CountryCode
			}
			current.Count += 1
			countryCounts[route.CountryCode] = current
		}
	}

	deviceOptions := make([]JourneyFilterOption, 0, len(deviceCounts))
	for value, count := range deviceCounts {
		deviceOptions = append(deviceOptions, JourneyFilterOption{
			Value: value,
			Label: journeyDeviceLabel(value),
			Count: count,
		})
	}
	slices.SortFunc(deviceOptions, func(left, right JourneyFilterOption) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Value, right.Value)
		}
	})

	countryOptions := make([]JourneyFilterOption, 0, len(countryCounts))
	for _, item := range countryCounts {
		countryOptions = append(countryOptions, item)
	}
	slices.SortFunc(countryOptions, func(left, right JourneyFilterOption) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.Value, right.Value)
		}
	})
	return deviceOptions, countryOptions
}

func buildJourneyDistribution(items map[string]*journeyDistributionAggregate, totalSessions int) []JourneyDistributionItem {
	output := make([]JourneyDistributionItem, 0, len(items))
	for _, item := range items {
		path := mostCommonJourneyValue(item.RepresentativeCounts)
		output = append(output, JourneyDistributionItem{
			Path:                 path,
			CanonicalPath:        item.CanonicalPath,
			GroupName:            journeyGroupName(item.CanonicalPath, path),
			Count:                item.Count,
			Share:                percentage(item.Count, totalSessions),
			ReplayBackedSessions: item.ReplayBackedSessions,
			ModeledSessions:      item.Count - item.ReplayBackedSessions,
			Provenance:           journeyProvenance(item.ReplayBackedSessions, item.Count),
		})
	}
	slices.SortFunc(output, func(left, right JourneyDistributionItem) int {
		switch {
		case left.Count != right.Count:
			return right.Count - left.Count
		default:
			return strings.Compare(left.CanonicalPath, right.CanonicalPath)
		}
	})
	return output
}

func normalizeJourneyPath(path string) string {
	value := normalizePath(path)
	if value == "" {
		return "/"
	}
	return strings.TrimSpace(value)
}

func canonicalJourneyPath(path string) string {
	value := normalizeJourneyPath(path)
	base := value
	if parsed, err := url.Parse(value); err == nil {
		base = parsed.Path
	}
	base = strings.Split(strings.SplitN(base, "?", 2)[0], "#")[0]
	if base == "" {
		base = "/"
	}
	segments := strings.Split(strings.Trim(base, "/"), "/")
	if len(segments) == 0 || (len(segments) == 1 && segments[0] == "") {
		return "/"
	}
	normalized := make([]string, 0, len(segments))
	for _, segment := range segments {
		normalized = append(normalized, normalizeJourneySegment(segment))
	}
	return "/" + strings.Join(normalized, "/")
}

func normalizeJourneySegment(segment string) string {
	value := strings.ToLower(strings.TrimSpace(segment))
	if value == "" {
		return ":id"
	}
	if len(value) > 36 {
		return ":id"
	}
	if isJourneyDynamicSegment(value) {
		return ":id"
	}
	return value
}

func isJourneyDynamicSegment(value string) bool {
	digitCount := 0
	hexCount := 0
	for _, r := range value {
		switch {
		case r >= '0' && r <= '9':
			digitCount += 1
			hexCount += 1
		case r >= 'a' && r <= 'f':
			hexCount += 1
		case r == '-':
		default:
			hexCount = -999
		}
	}
	if digitCount == len(value) {
		return true
	}
	if len(value) >= 8 && hexCount >= len(value)-2 {
		return true
	}
	if len(value) >= 6 && digitCount*2 >= len(value) {
		return true
	}
	return false
}

func journeyNodeID(stageIndex int, canonicalPath string) string {
	return strings.Join([]string{canonicalPath, strconv.Itoa(stageIndex)}, "::")
}

func mostCommonJourneyValue(counts map[string]int) string {
	bestValue := ""
	bestCount := -1
	for value, count := range counts {
		switch {
		case count > bestCount:
			bestValue = value
			bestCount = count
		case count == bestCount && strings.Compare(value, bestValue) < 0:
			bestValue = value
		}
	}
	return bestValue
}

func journeyGroupName(canonicalPath, representativePath string) string {
	path := canonicalPath
	if strings.TrimSpace(path) == "" {
		path = representativePath
	}
	if path == "/" {
		return "Landing"
	}
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if len(segments) == 0 {
		return "Landing"
	}
	last := segments[len(segments)-1]
	if last == ":id" && len(segments) > 1 {
		last = segments[len(segments)-2]
	}
	label := humanizeJourneyLabel(last)
	if label != "" {
		return label
	}
	return humanizeJourneyLabel(path)
}

func humanizeJourneyLabel(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || trimmed == "/" {
		return "Landing"
	}
	cleaned := strings.NewReplacer("-", " ", "_", " ", "/", " ").Replace(trimmed)
	fields := strings.Fields(cleaned)
	for index, field := range fields {
		if field == ":id" {
			fields[index] = "Detail"
			continue
		}
		fields[index] = strings.ToUpper(field[:1]) + field[1:]
	}
	return strings.Join(fields, " ")
}

func journeyIntentStage(canonicalPath string, stageIndex int) string {
	value := strings.ToLower(strings.TrimSpace(canonicalPath))
	switch {
	case value == "/" || strings.Contains(value, "/home") || strings.Contains(value, "/landing"):
		return "landing"
	case strings.Contains(value, "blog") || strings.Contains(value, "docs") || strings.Contains(value, "learn") || strings.Contains(value, "feature") || strings.Contains(value, "product") || strings.Contains(value, "pricing") || strings.Contains(value, "plans"):
		return "explore"
	case strings.Contains(value, "signup") || strings.Contains(value, "register") || strings.Contains(value, "trial") || strings.Contains(value, "demo") || strings.Contains(value, "contact") || strings.Contains(value, "quote") || strings.Contains(value, "cart") || strings.Contains(value, "checkout"):
		return "intent"
	case strings.Contains(value, "success") || strings.Contains(value, "thank") || strings.Contains(value, "confirm") || strings.Contains(value, "complete") || strings.Contains(value, "purchase") || strings.Contains(value, "payment"):
		return "conversion"
	case strings.Contains(value, "dashboard") || strings.Contains(value, "app") || strings.Contains(value, "workspace") || strings.Contains(value, "onboarding") || strings.Contains(value, "welcome"):
		return "activation"
	case strings.Contains(value, "account") || strings.Contains(value, "billing") || strings.Contains(value, "settings") || strings.Contains(value, "support") || strings.Contains(value, "help"):
		return "retention"
	case stageIndex == 0:
		return "landing"
	default:
		return "explore"
	}
}

func journeyProvenance(replayBackedSessions, totalSessions int) string {
	switch {
	case totalSessions == 0:
		return "modeled"
	case replayBackedSessions == 0:
		return "modeled"
	case replayBackedSessions == totalSessions:
		return "replay-backed"
	default:
		return "hybrid"
	}
}

func normalizeJourneyDeviceValue(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "mobile":
		return "mobile"
	case "tablet":
		return "tablet"
	default:
		return "desktop"
	}
}

func normalizeJourneyDeviceFilter(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "all":
		return ""
	case "mobile":
		return "mobile"
	case "tablet":
		return "tablet"
	default:
		return "desktop"
	}
}

func normalizeJourneyCountryFilter(value string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(value))
	if trimmed == "" || trimmed == "ALL" {
		return ""
	}
	return trimmed
}

func journeyDeviceLabel(value string) string {
	switch value {
	case "mobile":
		return "Mobile"
	case "tablet":
		return "Tablet"
	default:
		return "Desktop"
	}
}

func journeyMedianPathLength(pathLengthCounts map[int]int, totalSessions int) int {
	if totalSessions == 0 {
		return 0
	}
	lengths := make([]int, 0, len(pathLengthCounts))
	for length := range pathLengthCounts {
		lengths = append(lengths, length)
	}
	slices.Sort(lengths)
	target := (totalSessions + 1) / 2
	running := 0
	for _, length := range lengths {
		running += pathLengthCounts[length]
		if running >= target {
			return length
		}
	}
	return 0
}

export type CustomRangeKey = `custom:${string}:${string}`;
export type RangeKey = "24h" | "7d" | "30d" | "90d" | CustomRangeKey;
export type HeatmapMode = "engagement" | "click" | "rage" | "move" | "scroll";
export type HeatmapClickFilter = "all" | "rage" | "dead" | "error";
export type HeatmapViewportSegment = "all" | "mobile" | "tablet" | "desktop";
export type FunnelCountMode = "sessions" | "visitors";
export type FunnelStepKind = "page" | "event";
export type FunnelStepMatchType = "exact" | "prefix";
export type FunnelEntityStatus = "entered" | "reached" | "dropped";

export interface DashboardSite {
  id: string;
  name?: string;
  origins: string[];
}

export interface DashboardViewer {
  id: string;
  email: string;
  fullName: string;
}

export interface DashboardContextResponse {
  product: string;
  mode: "token" | "control-plane";
  defaultSiteId: string;
  sites: DashboardSite[];
  ranges: RangeKey[];
  csrfToken?: string;
  viewer?: DashboardViewer;
}

export interface OverviewMetrics {
  realtimeVisitors: number;
  uniqueVisitors: number;
  pageviews: number;
  sessions: number;
  bounceRate: number;
  avgScrollDepth: number;
  rageClicks: number;
}

export interface TimeseriesPoint {
  timestamp: string;
  pageviews: number;
  sessions: number;
}

export interface PageMetric {
  path: string;
  pageviews: number;
  sessions: number;
  avgScrollDepth: number;
  rageClicks: number;
}

export interface PageOption {
  path: string;
  pageviews: number;
}

export interface ReferrerMetric {
  source: string;
  pageviews: number;
}

export interface DeviceMetric {
  device: string;
  pageviews: number;
}

export interface BrowserMetric {
  browser: string;
  pageviews: number;
}

export interface OperatingSystemMetric {
  os: string;
  pageviews: number;
}

export interface DepthMetric {
  depth: number;
  sessions: number;
}

export interface DashboardMetricDelta {
  current: number;
  previous: number;
  delta: number;
  direction: "up" | "down" | "flat";
}

export interface DashboardSessionDurationMetric {
  avgSeconds: DashboardMetricDelta;
  medianSeconds: DashboardMetricDelta;
}

export interface DashboardReturningVisitorMetric {
  ratio: DashboardMetricDelta;
  returningVisitors: number;
  newVisitors: number;
}

export interface PathMomentumMetric {
  path: string;
  pageviews: number;
  previousPageviews: number;
  deltaPageviews: number;
  growthVsPrevious: number;
  trust: string;
}

export interface ConversionAssistMetric {
  path: string;
  assistedConversions: number;
  conversionShare: number;
  trust: string;
}

export interface DashboardOverviewComparison {
  uniqueVisitors: DashboardMetricDelta;
  pageviews: DashboardMetricDelta;
  sessions: DashboardMetricDelta;
  bounceRate: DashboardMetricDelta;
  avgScrollDepth: DashboardMetricDelta;
  rageClicks: DashboardMetricDelta;
}

export interface DashboardDerivedMetrics {
  engagedSessions: DashboardMetricDelta;
  returningVisitorRatio: DashboardReturningVisitorMetric;
  frictionScore: DashboardMetricDelta;
  referrerQualityScore: DashboardMetricDelta;
  pageFocusScore: DashboardMetricDelta;
  sessionDuration: DashboardSessionDurationMetric;
  topPathMomentum: PathMomentumMetric[];
  conversionAssist: ConversionAssistMetric[];
}

export interface DashboardSummary {
  range: RangeKey;
  comparisonRange: RangeKey;
  overview: OverviewMetrics;
  overviewComparison: DashboardOverviewComparison;
  derived: DashboardDerivedMetrics;
  timeseries: TimeseriesPoint[];
  topPages: PageMetric[];
  referrers: ReferrerMetric[];
  devices: DeviceMetric[];
  browsers: BrowserMetric[];
  operatingSystems: OperatingSystemMetric[];
  scrollFunnel: DepthMetric[];
  pages: PageOption[];
}

export interface DashboardMapSummary {
  uniqueVisitors: number;
  sessions: number;
  pageviews: number;
  locatedVisitors: number;
  unknownVisitors: number;
  countries: number;
  regions: number;
  cities: number;
  privacyFloor: number;
  topCountryCode: string;
  topCountryName: string;
  topCountryShare: number;
  activeNow: number;
  coverageConfidence: number;
  withheldVisitors: number;
  withheldShare: number;
}

export interface DashboardMapCountryMetric {
  countryCode: string;
  countryName: string;
  continent: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  share: number;
  precision: string;
  activeNow: number;
  previousVisitors: number;
  growthVsPrevious: number;
}

export interface DashboardMapRegionMetric {
  countryCode: string;
  countryName: string;
  regionCode: string;
  regionName: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  share: number;
}

export interface DashboardMapCityMetric {
  countryCode: string;
  countryName: string;
  regionName: string;
  city: string;
  visitors: number;
  sessions: number;
  pageviews: number;
  geoPrecision: string;
  share: number;
}

export interface DashboardMapWithheldMetric {
  countryCode: string;
  countryName: string;
  regionName: string;
  city: string;
  visitors: number;
  sessions: number;
  share: number;
}

export interface DashboardMapView {
  range: RangeKey;
  summary: DashboardMapSummary;
  countries: DashboardMapCountryMetric[];
  regions: DashboardMapRegionMetric[];
  cities: DashboardMapCityMetric[];
  withheld: DashboardMapWithheldMetric[];
}

export interface JourneyFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface JourneyFilterState {
  device: string;
  country: string;
  devices: JourneyFilterOption[];
  countries: JourneyFilterOption[];
}

export interface JourneySummary {
  sessions: number;
  replayBackedSessions: number;
  modeledSessions: number;
  uniquePaths: number;
  uniqueTransitions: number;
  uniqueCommonPaths: number;
  avgPathLength: number;
  medianPathLength: number;
  topPathShare: number;
}

export interface JourneyNode {
  id: string;
  path: string;
  canonicalPath: string;
  groupName: string;
  intentStage: string;
  stageIndex: number;
  sessions: number;
  share: number;
  entryCount: number;
  exitCount: number;
  branchStrength: number;
  replayBackedSessions: number;
  modeledSessions: number;
  provenance: "modeled" | "replay-backed" | "hybrid";
}

export interface JourneyLink {
  id: string;
  sourceId: string;
  targetId: string;
  sourcePath: string;
  targetPath: string;
  sessions: number;
  share: number;
  branchStrength: number;
  replayBackedSessions: number;
  modeledSessions: number;
  provenance: "modeled" | "replay-backed" | "hybrid";
}

export interface JourneyPath {
  id: string;
  paths: string[];
  canonicalPaths: string[];
  sessions: number;
  share: number;
  replayBackedSessions: number;
  modeledSessions: number;
  provenance: "modeled" | "replay-backed" | "hybrid";
}

export interface JourneyDistributionItem {
  path: string;
  canonicalPath: string;
  groupName: string;
  count: number;
  share: number;
  replayBackedSessions: number;
  modeledSessions: number;
  provenance: "modeled" | "replay-backed" | "hybrid";
}

export interface JourneyPathLengthBucket {
  length: number;
  count: number;
  share: number;
}

export interface JourneysView {
  range: RangeKey;
  filters: JourneyFilterState;
  summary: JourneySummary;
  nodes: JourneyNode[];
  links: JourneyLink[];
  commonPaths: JourneyPath[];
  entryDistribution: JourneyDistributionItem[];
  exitDistribution: JourneyDistributionItem[];
  pathLengthDistribution: JourneyPathLengthBucket[];
}

export type RetentionCadence = "daily" | "weekly" | "monthly";

export interface RetentionPoint {
  period: number;
  label: string;
  eligibleUsers: number;
  returnedUsers: number;
  rate: number;
  fresh: boolean;
}

export interface RetentionCohortRow {
  cohortDate: string;
  label: string;
  cohortSize: number;
  freshness: string;
  confidence: number;
  points: RetentionPoint[];
}

export interface RetentionSummary {
  users: number;
  cohorts: number;
  day1Rate: number;
  day7Rate: number;
  day14Rate: number;
  day30Rate: number;
  avgActiveDays: number;
  privacyFloor: number;
  confidence: number;
  confidenceText: string;
}

export interface RetentionFilterState {
  cadence: RetentionCadence;
  device: string;
  country: string;
  devices: JourneyFilterOption[];
  countries: JourneyFilterOption[];
}

export interface RetentionReport {
  range: RangeKey;
  filters: RetentionFilterState;
  summary: RetentionSummary;
  periods: number[];
  cohorts: RetentionCohortRow[];
}

export interface RetentionTrendPoint {
  period: number;
  label: string;
  eligibleUsers: number;
  returnedUsers: number;
  rate: number;
  confidence: number;
}

export interface RetentionTrendView {
  range: RangeKey;
  filters: RetentionFilterState;
  summary: RetentionSummary;
  curve: RetentionTrendPoint[];
}

export interface FunnelStepDefinition {
  label: string;
  kind: FunnelStepKind;
  matchType: FunnelStepMatchType;
  value: string;
}

export interface FunnelDefinitionInput {
  name: string;
  countMode: FunnelCountMode;
  windowMinutes: number;
  steps: FunnelStepDefinition[];
}

export interface FunnelDefinition extends FunnelDefinitionInput {
  id: string;
  siteId: string;
  createdAt: string;
  updatedAt: string;
}

export interface FunnelStepReport extends FunnelStepDefinition {
  index: number;
  entrants: number;
  count: number;
  conversionRate: number;
  stepConversionRate: number;
  dropOffCount: number;
  dropOffRate: number;
  avgSecondsFromPrevious: number;
  avgSecondsFromStart: number;
}

export interface FunnelStepInspection {
  stepIndex: number;
  label: string;
  entrants: number;
  reached: number;
  dropped: number;
  reachRate: number;
  dropRate: number;
}

export interface FunnelStepTiming {
  stepIndex: number;
  label: string;
  sampleCount: number;
  avgSecondsFromPrevious: number;
  medianSecondsFromPrevious: number;
  p90SecondsFromPrevious: number;
  minSecondsFromPrevious: number;
  maxSecondsFromPrevious: number;
  avgSecondsFromStart: number;
  medianSecondsFromStart: number;
  p90SecondsFromStart: number;
  minSecondsFromStart: number;
  maxSecondsFromStart: number;
}

export interface FunnelTimingSummary {
  sampleCount: number;
  avgSeconds: number;
  medianSeconds: number;
  p90Seconds: number;
  minSeconds: number;
  maxSeconds: number;
}

export interface FunnelReport {
  range: RangeKey;
  countMode: FunnelCountMode;
  windowMinutes: number;
  entrants: number;
  completions: number;
  overallConversionRate: number;
  steps: FunnelStepReport[];
  inspection: FunnelStepInspection[];
  stepTimings: FunnelStepTiming[];
  completionTime: FunnelTimingSummary;
}

export interface FunnelEntityMatchedStep {
  stepIndex: number;
  label: string;
  kind: FunnelStepKind;
  matchType: FunnelStepMatchType;
  value: string;
  timestamp: string;
  secondsFromPrevious: number;
  secondsFromStart: number;
}

export interface FunnelEntitySummary {
  entityId: string;
  startedAt: string;
  updatedAt: string;
  entryPath: string;
  exitPath: string;
  pageviews: number;
  eventCount: number;
  sessionCount: number;
  deviceType: string;
  browser: string;
  os: string;
  paths: string[];
  matchedStepCount: number;
  completed: boolean;
  dropOffStepIndex: number;
  dropOffStepLabel: string;
  matchedSteps: FunnelEntityMatchedStep[];
}

export interface FunnelEntityList {
  range: RangeKey;
  countMode: FunnelCountMode;
  stepIndex: number;
  stepLabel: string;
  status: FunnelEntityStatus;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  inspection: FunnelStepInspection;
  entities: FunnelEntitySummary[];
}

export interface FunnelSuggestion {
  kind: FunnelStepKind;
  matchType: FunnelStepMatchType;
  value: string;
  label: string;
  score: number;
  count: number;
  source: string;
  reason: string;
}

export interface FunnelTemplate {
  id: string;
  name: string;
  countMode: FunnelCountMode;
  windowMinutes: number;
  score: number;
  reason: string;
  steps: FunnelStepDefinition[];
}

export interface FunnelCatalogResponse {
  canPersist: boolean;
  definitions: FunnelDefinition[];
  suggestedPages: string[];
  suggestedEvents: string[];
  pageSuggestions?: FunnelSuggestion[];
  eventSuggestions?: FunnelSuggestion[];
  templates?: FunnelTemplate[];
}

export interface EventNameMetric {
  name: string;
  count: number;
}

export interface EventExplorerView {
  range: RangeKey;
  comparisonRange: RangeKey;
  privacyFloor: number;
  summary: EventExplorerSummary;
  trends: EventExplorerTrends;
  catalog: EventCatalogEntry[];
  liveFeed: EventFeedItem[];
}

export interface EventExplorerSummary {
  acceptedEvents: number;
  filteredEvents: number;
  withheldRows: number;
  maskedProperties: number;
  duplicateRate: number;
  privacyOptOutRate?: number | null;
  privacyOptOutLabel: string;
  confidenceScore: number;
}

export interface EventExplorerTrends {
  timeline: EventTrendPoint[];
  comparison: EventTrendComparison;
  highlights: EventTrendHighlight[];
}

export interface EventTrendPoint {
  timestamp: string;
  custom: number;
  navigation: number;
  behavior: number;
  performance: number;
}

export interface EventTrendComparison {
  customCurrent: number;
  customPrevious: number;
  navigationCurrent: number;
  navigationPrevious: number;
  behaviorCurrent: number;
  behaviorPrevious: number;
  performanceCurrent: number;
  performancePrevious: number;
}

export interface EventTrendHighlight {
  label: string;
  value: number;
  delta: number;
  up: boolean;
  family: string;
}

export interface EventCatalogEntry {
  name: string;
  family: string;
  count: number;
  previousCount: number;
  uniqueSessions: number;
  uniqueVisitors: number;
  trend: number;
  lastSeen: string;
  statuses: string[];
  confidenceScore: number;
  privacyNote: string;
  properties: EventPropertyFacet[];
  topPages: EventBreakdownItem[];
  topDevices: EventBreakdownItem[];
  topCountries: EventBreakdownItem[];
  sampleSessions: string[];
}

export interface EventPropertyFacet {
  key: string;
  cardinality: number;
  masked: boolean;
  values: EventBreakdownItem[];
}

export interface EventBreakdownItem {
  label: string;
  count: number;
}

export interface EventFeedItem {
  timestamp: string;
  name: string;
  family: string;
  path: string;
  sessionId: string;
  device: string;
  country: string;
  propertySummary: string;
  privacyLabel: string;
}

export interface HeatmapBucket {
  x: number;
  y: number;
  count: number;
  weight: number;
  sessions: number;
  visitors: number;
  rageCount: number;
  deadCount: number;
  errorCount: number;
}

export interface SelectorStat {
  selector: string;
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  errorClicks: number;
  hoverEvents: number;
  hoverMs: number;
  centerX: number;
  centerY: number;
  blockedZone: boolean;
}

export interface HeatmapTotals {
  clicks: number;
  rageClicks: number;
  deadClicks: number;
  errorClicks: number;
  moveEvents: number;
  hoverEvents: number;
  hoverMs: number;
  scrollEvents: number;
  uniqueSessions: number;
  uniqueVisitors: number;
  mouseClicks: number;
  touchClicks: number;
  penClicks: number;
  keyboardClicks: number;
  normalizedExcluded: number;
  blockedZoneEvents: number;
  blockedZoneClicks: number;
  blockedZoneHovers: number;
}

export interface HeatmapConfidence {
  insightReady: boolean;
  score: number;
  sampleSize: number;
  sessionSample: number;
  minSample: number;
  viewportBucket: string;
  layoutVariant: string;
  trust: string;
  freshness: string;
  normalization: string;
  explanation: string;
  blockedZones: number;
}

export interface ViewportHint {
  width: number;
  height: number;
}

export interface HeatmapDomSnapshot {
  path: string;
  pageUrl: string;
  pageTitle: string;
  html: string;
  css: string;
  viewport: ViewportHint;
  document: ViewportHint;
  contentHash: string;
  capturedAt: string;
}

export interface HeatmapView {
  range: RangeKey;
  mode: HeatmapMode;
  clickFilter: HeatmapClickFilter;
  viewportSegment: HeatmapViewportSegment;
  availableModes: HeatmapMode[];
  availableClickFilters: HeatmapClickFilter[];
  availableViewportSegments: HeatmapViewportSegment[];
  path: string;
  paths: PageOption[];
  buckets: HeatmapBucket[];
  moveBuckets: HeatmapBucket[];
  scrollFunnel: DepthMetric[];
  selectors: SelectorStat[];
  totals: HeatmapTotals;
  viewport: ViewportHint;
  document: ViewportHint;
  confidence: HeatmapConfidence;
  domSnapshot?: HeatmapDomSnapshot | null;
  screenshot?: string | null;
}

export interface InsightSummary {
  total: number;
  critical: number;
  warning: number;
  info: number;
}

export interface InsightItem {
  severity: "critical" | "warning" | "info";
  category: string;
  path: string;
  title: string;
  problem?: string;
  impact?: string;
  fix?: string;
  finding: string;
  recommendation: string;
  evidence: string;
  score: number;
  source?: "rules" | "ai";
}

export interface InsightsView {
  range: RangeKey;
  generatedAt?: string;
  engine?: {
    mode: "rules_only" | "ai_plus_rules";
    provider: string;
    model: string;
    ruleCount: number;
    aiItemCount: number;
  };
  summary: InsightSummary;
  analysis?: {
    narrative: string;
    confidence: string;
    evidence: string;
  };
  actions?: {
    title: string;
    priority: string;
    expectedImpact: string;
    path: string;
    evidence: string;
  }[];
  pageOpportunities?: {
    path: string;
    title: string;
    opportunity: string;
    recommendation: string;
    evidence: string;
  }[];
  items: InsightItem[];
  pages: PageOption[];
  ruleFlags?: {
    severity: string;
    category: string;
    path: string;
    reason: string;
    evidence: string;
    score: number;
  }[];
  snapshot?: {
    siteId: string;
    range: RangeKey;
    overview: OverviewMetrics;
    overviewComparison: DashboardSummary["overviewComparison"];
    derived: DashboardSummary["derived"];
    topPages: PageMetric[];
    scrollFunnel: DepthMetric[];
    referrers: ReferrerMetric[];
    devices: DeviceMetric[];
    browsers: BrowserMetric[];
    operatingSystems: OperatingSystemMetric[];
    heatmaps: {
      path: string;
      clicks: number;
      rageClicks: number;
      deadClicks: number;
      errorClicks: number;
      moveEvents: number;
      scrollEvents: number;
      topSelectors: {
        selector: string;
        clicks: number;
        rageClicks: number;
        deadClicks: number;
      }[];
      quadrantShare: {
        topLeft: number;
        topRight: number;
        bottomLeft: number;
        bottomRight: number;
      };
      avgScrollDepth: number;
      lowEngagementAt?: string;
    }[];
    eventPatterns: {
      name: string;
      family: string;
      count: number;
      trend: number;
      confidenceScore: number;
      topPages: string[];
      topDevices: string[];
      topCountries: string[];
    }[];
    journeys: {
      sessions: number;
      topPathShare: number;
      commonPaths: string[];
      entryPages: string[];
      exitPages: string[];
    };
    retention: {
      users: number;
      cohorts: number;
      day1Rate: number;
      day7Rate: number;
      day14Rate: number;
      day30Rate: number;
      confidence: number;
      confidenceText: string;
    };
    confidenceNotes: string[];
    freshnessNotes: string[];
  };
  audit?: {
    enabled: boolean;
    provider: string;
    model: string;
    promptVersion: string;
    zeroRetention: boolean;
    inputHash: string;
    fieldsSent: string[];
    fieldsExcluded: string[];
    durationMs: number;
    requestId?: string;
    error?: string;
    fallbackActivated: boolean;
  };
}

export interface SiteStats {
  totalEvents: number;
  trackedPages: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
}

export interface DashboardRetention {
  eventsDays: number;
  heatmapDays: number;
  replayDays: number;
  insightsDays: number;
  siteOverrides?: {
    eventsDays: number | null;
    heatmapDays: number | null;
    replayDays: number | null;
    insightsDays: number | null;
  };
}

export interface ReplayViewport {
  width: number;
  height: number;
  bucket: string;
}

export interface ReplayChunkSummary {
  fullSnapshots: number;
  mutationEvents: number;
  consoleErrors: number;
  networkFailures: number;
  rageClicks: number;
  deadClicks: number;
  routeChanges: number;
  customEvents: number;
}

export interface ReplayEvent {
  type: string;
  ts: number;
  data: Record<string, unknown>;
}

export interface ReplayChunk {
  index: number;
  reason?: string;
  startedAt: string;
  endedAt: string;
  path: string;
  eventCount: number;
  summary: ReplayChunkSummary;
  events: ReplayEvent[];
}

export interface ReplaySessionSummary {
  sessionId: string;
  startedAt: string;
  updatedAt: string;
  durationMs: number;
  entryPath: string;
  exitPath: string;
  pageCount: number;
  routeCount: number;
  chunkCount: number;
  eventCount: number;
  errorCount: number;
  consoleErrorCount: number;
  networkFailureCount: number;
  rageClickCount: number;
  deadClickCount: number;
  customEventCount: number;
  deviceType: string;
  browser: string;
  os: string;
  viewport: ReplayViewport;
  paths: string[];
  sampleRate: number;
}

export interface ReplaySessionList {
  range: RangeKey;
  sessions: ReplaySessionSummary[];
}

export interface ReplaySessionDetail {
  session: ReplaySessionSummary;
  chunks: ReplayChunk[];
}

export interface DashboardSettingsResponse {
  sites: DashboardSite[];
  site: DashboardSite;
  privacy: {
    domSnapshotsEnabled: boolean;
    visitorCookieEnabled: boolean;
  };
  tracking: {
    blockBotTrafficEnabled: boolean;
    domSnapshotsEnabled: boolean;
    visitorCookieEnabled: boolean;
    replayMaskTextEnabled: boolean;
    spaTrackingEnabled: boolean;
    errorTrackingEnabled: boolean;
    performanceTrackingEnabled: boolean;
  };
  trackerSnippet: string;
  trackerScript: {
    siteId: string;
    installOrigin: string;
    collectorOrigin: string;
    scriptSrc: string;
    scriptTag: string;
    isPersisted: boolean;
    updatedAt?: string | null;
  };
  retention: DashboardRetention;
  importDefaults: {
    mapping: Record<string, string>;
    timezone: string;
  };
  stats: SiteStats;
}

export interface DashboardErrorReplayLink {
  sessionId: string;
  path: string;
  updatedAt: string;
  count: number;
}

export interface DashboardErrorTrendPoint {
  timestamp: string;
  count: number;
}

export interface DashboardErrorGroup {
  key: string;
  kind: string;
  title: string;
  signature: string;
  severity: "critical" | "warning" | "info";
  currentCount: number;
  previousCount: number;
  delta: number;
  direction: "up" | "down" | "flat";
  affectedSessions: number;
  affectedPaths: number;
  latestAt: string;
  replayLinks: DashboardErrorReplayLink[];
  trend: DashboardErrorTrendPoint[];
}

export interface DashboardErrorsResponse {
  range: RangeKey;
  summary: {
    groups: number;
    criticalGroups: number;
    warningGroups: number;
    infoGroups: number;
    replayLinkedGroups: number;
    totalOccurrences: number;
  };
  groups: DashboardErrorGroup[];
}

export interface DashboardPerformanceVital {
  metric: string;
  label: string;
  p75?: number | null;
  sampleCount: number;
  source: "real" | "proxy" | "disabled";
  status: "good" | "needs-improvement" | "poor" | "unavailable";
}

export interface DashboardPerformancePageSignal {
  path: string;
  source: "real" | "proxy" | "disabled";
  sampleCount: number;
  lcpP75?: number | null;
  inpP75?: number | null;
  clsP75?: number | null;
  ttfbP75?: number | null;
  replayFailures: number;
  rageClicks: number;
  insightCount: number;
  note: string;
}

export interface DashboardPerformanceResponse {
  range: RangeKey;
  capture: {
    performanceTrackingEnabled: boolean;
    signalMode: "real" | "proxy" | "disabled";
    note: string;
    realSampleCount: number;
    proxySignalCount: number;
  };
  vitals: DashboardPerformanceVital[];
  pages: DashboardPerformancePageSignal[];
  proxySummary: {
    replayFailures: number;
    performanceInsights: number;
    rageClicks: number;
  };
}

export interface DashboardImportMappingSuggestion {
  canonicalField: string;
  sourceField: string;
  confidence: number;
}

export interface DashboardImportPreview {
  platform: string;
  fileName: string;
  detectedFormat: "csv" | "json";
  totalRows: number;
  validRows: number;
  invalidRows: number;
  mapping: Record<string, string>;
  suggestions: DashboardImportMappingSuggestion[];
  sampleRows: Array<Record<string, string | number | boolean | null>>;
  errors: Array<{
    rowNumber: number;
    code: string;
    message: string;
  }>;
}

export interface DashboardImportJob {
  id: string;
  siteId: string;
  platform: string;
  status: "queued" | "processing" | "completed" | "failed";
  phase: "queued" | "parsing" | "mapping" | "validating" | "importing" | "finalizing" | "completed" | "failed";
  sourceFileName: string;
  sourceContentType?: string | null;
  sourceSizeBytes: number;
  progressPercent: number;
  processedRows: number;
  importedRows: number;
  invalidRows: number;
  mapping: Record<string, string>;
  summary: Record<string, unknown>;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  errors?: Array<{
    rowNumber: number;
    code: string;
    message: string;
    rawRecord?: Record<string, unknown> | null;
  }>;
}

export type NeoChatRole = "user" | "assistant";
export type NeoVisualTheme = "teal" | "amber" | "cobalt" | "rose" | "olive";
export type NeoVisualPreset =
  | "overview_trend"
  | "top_pages_ranked"
  | "referrer_ranked"
  | "device_breakdown_ranked"
  | "geo_countries_ranked"
  | "retention_curve"
  | "journey_flow"
  | "insights_digest"
  | "heatmap_hotspots"
  | "scroll_depth_funnel";

export interface NeoVisualKPI {
  label: string;
  value: number;
  delta: number;
  direction: "up" | "down" | "flat";
  detail?: string;
}

export interface NeoVisualTrendPoint {
  timestamp: string;
  label: string;
  primary: number;
  secondary?: number;
}

export interface NeoVisualRankedItem {
  label: string;
  value: number;
  share: number;
  detail?: string;
  note?: string;
}

export interface NeoVisualFlowNode {
  id: string;
  label: string;
  stage: string;
  stageIndex: number;
  sessions: number;
  share: number;
  emphasis: "high" | "medium" | "low";
}

export interface NeoVisualFlowStage {
  stageIndex: number;
  label: string;
  nodes: NeoVisualFlowNode[];
}

export interface NeoVisualFlowLink {
  id: string;
  sourceId: string;
  targetId: string;
  sessions: number;
  share: number;
}

export interface NeoVisualInsightCard {
  severity: InsightItem["severity"];
  title: string;
  path: string;
  recommendation: string;
  evidence: string;
  score: number;
}

export interface NeoVisualHotspot {
  x: number;
  y: number;
  intensity: number;
  count: number;
  label: string;
}

export interface NeoVisualBase {
  id: string;
  preset: NeoVisualPreset;
  theme: NeoVisualTheme;
  title: string;
  description?: string;
  createdAt: string;
}

export interface NeoOverviewTrendVisual extends NeoVisualBase {
  preset: "overview_trend";
  payload: {
    range: RangeKey;
    primaryLabel: string;
    secondaryLabel: string;
    kpis: NeoVisualKPI[];
    trend: NeoVisualTrendPoint[];
  };
}

export interface NeoTopPagesRankedVisual extends NeoVisualBase {
  preset: "top_pages_ranked";
  payload: {
    range: RangeKey;
    metricLabel: string;
    totalLabel: string;
    totalValue: number;
    items: NeoVisualRankedItem[];
  };
}

export interface NeoReferrerRankedVisual extends NeoVisualBase {
  preset: "referrer_ranked";
  payload: {
    range: RangeKey;
    metricLabel: string;
    totalLabel: string;
    totalValue: number;
    items: NeoVisualRankedItem[];
  };
}

export interface NeoDeviceBreakdownRankedVisual extends NeoVisualBase {
  preset: "device_breakdown_ranked";
  payload: {
    range: RangeKey;
    metricLabel: string;
    totalLabel: string;
    totalValue: number;
    items: NeoVisualRankedItem[];
  };
}

export interface NeoGeoCountriesRankedVisual extends NeoVisualBase {
  preset: "geo_countries_ranked";
  payload: {
    range: RangeKey;
    metricLabel: string;
    totalLabel: string;
    totalValue: number;
    items: NeoVisualRankedItem[];
  };
}

export interface NeoRetentionCurveVisual extends NeoVisualBase {
  preset: "retention_curve";
  payload: {
    range: RangeKey;
    cadence: RetentionCadence;
    summary: {
      users: number;
      day1Rate: number;
      day7Rate: number;
      day30Rate: number;
      confidenceText: string;
    };
    curve: Array<{
      period: number;
      label: string;
      rate: number;
      eligibleUsers: number;
      returnedUsers: number;
    }>;
  };
}

export interface NeoJourneyFlowVisual extends NeoVisualBase {
  preset: "journey_flow";
  payload: {
    range: RangeKey;
    summary: {
      sessions: number;
      topPathShare: number;
      avgPathLength: number;
      uniquePaths: number;
    };
    stages: NeoVisualFlowStage[];
    links: NeoVisualFlowLink[];
  };
}

export interface NeoInsightsDigestVisual extends NeoVisualBase {
  preset: "insights_digest";
  payload: {
    range: RangeKey;
    summary: InsightSummary;
    narrative?: string;
    items: NeoVisualInsightCard[];
    actions: Array<{
      title: string;
      path: string;
      expectedImpact: string;
    }>;
  };
}

export interface NeoHeatmapHotspotsVisual extends NeoVisualBase {
  preset: "heatmap_hotspots";
  payload: {
    range: RangeKey;
    path: string;
    viewport: ViewportHint;
    totals: Pick<HeatmapTotals, "clicks" | "rageClicks" | "deadClicks" | "errorClicks" | "uniqueSessions">;
    confidenceLabel: string;
    hotspots: NeoVisualHotspot[];
    selectors: Array<{
      selector: string;
      clicks: number;
      rageClicks: number;
    }>;
  };
}

export interface NeoScrollDepthFunnelVisual extends NeoVisualBase {
  preset: "scroll_depth_funnel";
  payload: {
    range: RangeKey;
    totalSessions: number;
    steps: Array<{
      label: string;
      value: number;
      share: number;
    }>;
  };
}

export type NeoVisualArtifact =
  | NeoOverviewTrendVisual
  | NeoTopPagesRankedVisual
  | NeoReferrerRankedVisual
  | NeoDeviceBreakdownRankedVisual
  | NeoGeoCountriesRankedVisual
  | NeoRetentionCurveVisual
  | NeoJourneyFlowVisual
  | NeoInsightsDigestVisual
  | NeoHeatmapHotspotsVisual
  | NeoScrollDepthFunnelVisual;

export type NeoVisualArtifactDraft = Omit<NeoVisualArtifact, "id" | "createdAt">;

export type NeoClientAction =
  | { type: "theme"; theme: "light" | "dark" | "system" }
  | { type: "logout" };

export interface NeoChatMessage {
  id: string;
  role: NeoChatRole;
  content: string;
  createdAt: string;
  toolNames?: string[];
  clientActions?: NeoClientAction[];
  visuals?: NeoVisualArtifact[];
}

export interface NeoChatRequest {
  messages: Array<Pick<NeoChatMessage, "role" | "content">>;
  siteId: string;
  range: RangeKey;
  pathname?: string;
  replaceMessageId?: string;
}

export interface NeoChatResponse {
  message: NeoChatMessage;
  userMessage?: NeoChatMessage;
}

export interface NeoRollbackRequest {
  siteId: string;
  messageId: string;
}

export interface NeoChatThread {
  threadId: string | null;
  canPersist: boolean;
  messages: NeoChatMessage[];
}

export type GoalType = "pageview" | "event";
export type GoalMatchType = "exact" | "prefix" | "contains";
export type GoalState = "active" | "low-volume" | "stale";

export interface GoalDefinition {
  id: string;
  siteId: string;
  name: string;
  type: GoalType;
  match: GoalMatchType;
  value: string;
  category?: string | null;
  currency?: string | null;
  createdAt: string;
}

export interface GoalDefinitionInput {
  name: string;
  type: GoalType;
  match: GoalMatchType;
  value: string;
  category?: string | null;
  currency?: string | null;
}

export interface GoalSparklinePoint {
  timestamp: string;
  conversions: number;
}

export interface GoalReportItem extends GoalDefinition {
  conversions: number;
  conversionRate: number;
  state: GoalState;
  sparkline: GoalSparklinePoint[];
  lastConvertedAt?: string | null;
}

export interface GoalReportResponse {
  range: RangeKey;
  goals: GoalReportItem[];
}

export interface DashboardExportEvent {
  timestamp: string;
  name: string;
  path: string;
  sessionId?: string;
  selector?: string;
  depth?: number;
  x?: number;
  y?: number;
  meta?: Record<string, unknown>;
}

export interface DashboardApiKey {
  id: string;
  siteId: string;
  name: string;
  permissions: string;
  createdAt: string;
  lastUsed?: string | null;
  token?: string | null;
}

export interface DashboardApiKeyInput {
  name: string;
  permissions?: string;
}

export interface SharedDashboardLink {
  id: string;
  siteId: string;
  slug: string;
  passwordProtected: boolean;
  createdAt: string;
}

export interface SharedDashboardLinkInput {
  password?: string;
}

export type DashboardReportFrequency = "daily" | "weekly" | "monthly";
export type DashboardReportSection =
  | "overview"
  | "realtime"
  | "goals"
  | "replays"
  | "heatmaps"
  | "insights"
  | "errors";
export type DashboardReportStatus = "scheduled" | "paused" | "failed" | "delivered";

export interface DashboardReportDeliveryHealth {
  lastStatus: "delivered" | "failed" | "pending";
  lastDeliveredAt?: string | null;
  lastAttemptedAt?: string | null;
  lastError?: string | null;
  consecutiveFailures: number;
}

export interface DashboardReportDelivery {
  id: string;
  reportId: string;
  siteId: string;
  status: "delivered" | "failed";
  subject: string;
  recipientCount: number;
  attemptedAt: string;
  deliveredAt?: string | null;
  errorMessage?: string | null;
  summary: Record<string, unknown>;
}

export interface DashboardReportConfig {
  id: string;
  siteId: string;
  name: string;
  frequency: DashboardReportFrequency;
  deliveryTime: string;
  timezone: string;
  recipients: string[];
  includeSections: DashboardReportSection[];
  compareEnabled: boolean;
  enabled: boolean;
  status: DashboardReportStatus;
  note?: string | null;
  lastDeliveredAt?: string | null;
  deliveryHealth: DashboardReportDeliveryHealth;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardReportConfigInput {
  name: string;
  frequency: DashboardReportFrequency;
  deliveryTime: string;
  timezone: string;
  recipients: string[];
  includeSections: DashboardReportSection[];
  compareEnabled?: boolean;
  enabled?: boolean;
  note?: string | null;
}

export type AlertMetric = "pageviews" | "visitors" | "bounce_rate" | "rage_clicks";
export type AlertCondition = "above" | "below";
export type AlertPeriod = "1h" | "24h";

export interface DashboardAlert {
  id: string;
  siteId: string;
  name: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  period: AlertPeriod;
  webhookUrl: string;
  enabled: boolean;
  createdAt: string;
  lastFiredAt?: string | null;
}

export interface DashboardAlertInput {
  name: string;
  metric: AlertMetric;
  condition: AlertCondition;
  threshold: number;
  period: AlertPeriod;
  webhookUrl: string;
  enabled?: boolean;
}

export interface SharedDashboardPayload {
  site: DashboardSite;
  summary: DashboardSummary;
  heatmap: HeatmapView | null;
  generatedAt: string;
  scope?: {
    readOnly: boolean;
    privacySafe: boolean;
    exposedSections: string[];
  };
}

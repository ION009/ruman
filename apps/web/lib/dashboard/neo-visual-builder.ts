import "server-only";

import type {
  DashboardSite,
  NeoVisualArtifactDraft,
  NeoVisualPreset,
  NeoVisualRankedItem,
  NeoVisualTheme,
  RangeKey,
  RetentionCadence,
} from "@/lib/dashboard/types";
import {
  getDashboardAIInsightsData,
  getDashboardHeatmapData,
  getDashboardJourneysData,
  getDashboardMapData,
  getDashboardRetentionTrendData,
  getDashboardSummaryData,
} from "@/lib/dashboard/server";
import { neoVisualPresetMeta, neoVisualThemeMeta } from "@/lib/dashboard/neo-visuals";

type NeoVisualArgs = Record<string, string>;

type NeoVisualBuildContext = {
  currentSite: DashboardSite;
  selectedRange: RangeKey;
  sites: DashboardSite[];
  runAnalytics: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
};

const DEFAULT_THEME_BY_PRESET: Record<NeoVisualPreset, NeoVisualTheme> = {
  overview_trend: "teal",
  top_pages_ranked: "cobalt",
  referrer_ranked: "amber",
  device_breakdown_ranked: "olive",
  geo_countries_ranked: "cobalt",
  retention_curve: "teal",
  journey_flow: "rose",
  insights_digest: "amber",
  heatmap_hotspots: "rose",
  scroll_depth_funnel: "olive",
};

function truncate(value: string, limit = 120) {
  return value.trim().slice(0, limit);
}

function labelForSite(site: DashboardSite) {
  if (site.name && site.name.trim() && site.name !== site.id) {
    return site.name;
  }

  const origin = site.origins?.[0] ?? "";
  if (origin) {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return origin;
    }
  }

  return site.id;
}

function resolveSite(context: NeoVisualBuildContext, siteId?: string) {
  if (!siteId?.trim()) {
    return context.currentSite;
  }
  return context.sites.find((site) => site.id === siteId) ?? context.currentSite;
}

function resolveRange(context: NeoVisualBuildContext, range?: string) {
  if (range?.startsWith("custom:")) {
    return range as RangeKey;
  }
  if (range === "24h" || range === "30d") {
    return range;
  }
  return context.selectedRange;
}

function resolveCadence(value?: string): RetentionCadence {
  if (value === "weekly" || value === "monthly") {
    return value;
  }
  return "daily";
}

function resolvePreset(value: string) {
  const preset = value.trim() as NeoVisualPreset;
  if (!preset || !(preset in neoVisualPresetMeta)) {
    throw new Error("Visual preset must be one of the documented Neo presets.");
  }
  return preset;
}

function resolveTheme(preset: NeoVisualPreset, requested?: string) {
  const theme = requested?.trim() as NeoVisualTheme | undefined;
  if (theme && theme in neoVisualThemeMeta) {
    return theme;
  }
  return DEFAULT_THEME_BY_PRESET[preset];
}

function formatTrendLabel(timestamp: string, range: RangeKey) {
  const date = new Date(timestamp);
  if (range === "24h") {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function buildRankedItems(
  entries: Array<{ label: string; value: number; detail?: string; note?: string }>,
  total: number,
): NeoVisualRankedItem[] {
  const safeTotal = total > 0 ? total : Math.max(entries.reduce((sum, entry) => sum + entry.value, 0), 1);
  return entries.map((entry) => ({
    label: entry.label,
    value: entry.value,
    share: safeTotal > 0 ? (entry.value / safeTotal) * 100 : 0,
    detail: entry.detail,
    note: entry.note,
  }));
}

async function resolveHeatmapPath(
  args: NeoVisualArgs,
  siteId: string,
  range: RangeKey,
  runAnalytics: NeoVisualBuildContext["runAnalytics"],
) {
  const explicit = truncate(args.path ?? "", 240);
  if (explicit) {
    return explicit;
  }

  const summary = await runAnalytics((token) => getDashboardSummaryData(siteId, range, token));
  return summary.topPages[0]?.path ?? summary.pages[0]?.path ?? "/";
}

async function buildOverviewTrendVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "overview_trend";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? `${labelForSite(site)} overview`, 90),
    description:
      truncate(args.description ?? "Overview metrics with trend context for the selected site and range.", 140) ||
      undefined,
    payload: {
      range: summary.range,
      primaryLabel: "Pageviews",
      secondaryLabel: "Sessions",
      kpis: [
        {
          label: "Visitors",
          value: summary.overview.uniqueVisitors,
          delta: summary.overviewComparison.uniqueVisitors.delta,
          direction: summary.overviewComparison.uniqueVisitors.direction,
        },
        {
          label: "Sessions",
          value: summary.overview.sessions,
          delta: summary.overviewComparison.sessions.delta,
          direction: summary.overviewComparison.sessions.direction,
        },
        {
          label: "Pageviews",
          value: summary.overview.pageviews,
          delta: summary.overviewComparison.pageviews.delta,
          direction: summary.overviewComparison.pageviews.direction,
        },
        {
          label: "Bounce rate",
          value: summary.overview.bounceRate,
          delta: summary.overviewComparison.bounceRate.delta,
          direction: summary.overviewComparison.bounceRate.direction,
          detail: "Percent of sessions",
        },
        {
          label: "Avg scroll",
          value: summary.overview.avgScrollDepth,
          delta: summary.overviewComparison.avgScrollDepth.delta,
          direction: summary.overviewComparison.avgScrollDepth.direction,
          detail: "Percent depth",
        },
      ],
      trend: summary.timeseries.slice(-14).map((point) => ({
        timestamp: point.timestamp,
        label: formatTrendLabel(point.timestamp, summary.range),
        primary: point.pageviews,
        secondary: point.sessions,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildTopPagesVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "top_pages_ranked";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Top pages", 90),
    description: truncate(args.description ?? "Ranked pages by pageview share.", 140) || undefined,
    payload: {
      range: summary.range,
      metricLabel: "Pageviews",
      totalLabel: "Total pageviews",
      totalValue: summary.overview.pageviews,
      items: buildRankedItems(
        summary.topPages.slice(0, 8).map((page) => ({
          label: page.path,
          value: page.pageviews,
          detail: `${page.sessions} sessions`,
          note: `${page.avgScrollDepth.toFixed(0)}% avg scroll`,
        })),
        summary.overview.pageviews,
      ),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildReferrerVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "referrer_ranked";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Referrer mix", 90),
    description: truncate(args.description ?? "Acquisition sources ranked by pageview contribution.", 140) || undefined,
    payload: {
      range: summary.range,
      metricLabel: "Pageviews",
      totalLabel: "Tracked referrers",
      totalValue: summary.referrers.reduce((sum, entry) => sum + entry.pageviews, 0),
      items: buildRankedItems(
        summary.referrers.slice(0, 8).map((entry) => ({
          label: entry.source || "Direct",
          value: entry.pageviews,
        })),
        summary.referrers.reduce((sum, entry) => sum + entry.pageviews, 0),
      ),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildDeviceVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "device_breakdown_ranked";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Device balance", 90),
    description: truncate(args.description ?? "Device mix ranked for the selected site.", 140) || undefined,
    payload: {
      range: summary.range,
      metricLabel: "Pageviews",
      totalLabel: "Device-attributed pageviews",
      totalValue: summary.devices.reduce((sum, entry) => sum + entry.pageviews, 0),
      items: buildRankedItems(
        summary.devices.slice(0, 6).map((entry) => ({
          label: entry.device,
          value: entry.pageviews,
        })),
        summary.devices.reduce((sum, entry) => sum + entry.pageviews, 0),
      ),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildGeoCountriesVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "geo_countries_ranked";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const map = await context.runAnalytics((token) => getDashboardMapData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Geographic spread", 90),
    description: truncate(args.description ?? "Top countries by visitor share.", 140) || undefined,
    payload: {
      range: map.range,
      metricLabel: "Visitors",
      totalLabel: "Located visitors",
      totalValue: map.summary.locatedVisitors,
      items: map.countries.slice(0, 8).map((country) => ({
        label: country.countryName,
        value: country.visitors,
        share: country.share,
        detail: `${country.sessions} sessions`,
        note: `${country.activeNow} active now`,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildRetentionCurveVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "retention_curve";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const cadence = resolveCadence(args.cadence);
  const theme = resolveTheme(preset, args.theme);
  const retention = await context.runAnalytics((token) =>
    getDashboardRetentionTrendData(site.id, range, { cadence, device: args.device, country: args.country }, token),
  );

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Retention curve", 90),
    description: truncate(args.description ?? "Return rate over successive periods.", 140) || undefined,
    payload: {
      range: retention.range,
      cadence,
      summary: {
        users: retention.summary.users,
        day1Rate: retention.summary.day1Rate,
        day7Rate: retention.summary.day7Rate,
        day30Rate: retention.summary.day30Rate,
        confidenceText: retention.summary.confidenceText,
      },
      curve: retention.curve.slice(0, 10).map((point) => ({
        period: point.period,
        label: point.label,
        rate: point.rate,
        eligibleUsers: point.eligibleUsers,
        returnedUsers: point.returnedUsers,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildJourneyFlowVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "journey_flow";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const journeys = await context.runAnalytics((token) =>
    getDashboardJourneysData(site.id, range, { device: args.device, country: args.country, limit: 20 }, token),
  );

  const grouped = new Map<number, { label: string; nodes: typeof journeys.nodes }>();
  for (const node of journeys.nodes) {
    const bucket =
      grouped.get(node.stageIndex) ??
      ({
        label: node.groupName || node.intentStage || `Stage ${node.stageIndex + 1}`,
        nodes: [] as typeof journeys.nodes,
      } satisfies { label: string; nodes: typeof journeys.nodes });
    bucket.nodes.push(node);
    grouped.set(node.stageIndex, bucket);
  }

  const stages = [...grouped.entries()]
    .sort((left, right) => left[0] - right[0])
    .slice(0, 4)
    .map(([stageIndex, stage]) => {
      const maxSessions = Math.max(...stage.nodes.map((node) => node.sessions), 1);
      return {
        stageIndex,
        label: stage.label,
        nodes: stage.nodes
          .sort((left, right) => right.sessions - left.sessions)
          .slice(0, 3)
          .map((node) => ({
            id: node.id,
            label: node.path,
            stage: stage.label,
            stageIndex,
            sessions: node.sessions,
            share: node.share * 100,
            emphasis:
              node.sessions >= maxSessions * 0.75
                ? ("high" as const)
                : node.sessions >= maxSessions * 0.4
                  ? ("medium" as const)
                  : ("low" as const),
          })),
      };
    });

  const visibleNodeIds = new Set(stages.flatMap((stage) => stage.nodes.map((node) => node.id)));
  const links = journeys.links
    .filter((link) => visibleNodeIds.has(link.sourceId) && visibleNodeIds.has(link.targetId))
    .sort((left, right) => right.sessions - left.sessions)
    .slice(0, 10)
    .map((link) => ({
      id: link.id,
      sourceId: link.sourceId,
      targetId: link.targetId,
      sessions: link.sessions,
      share: link.share * 100,
    }));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Journey flow", 90),
    description: truncate(args.description ?? "Top movement patterns between major site stages.", 140) || undefined,
    payload: {
      range: journeys.range,
      summary: {
        sessions: journeys.summary.sessions,
        topPathShare: journeys.summary.topPathShare * 100,
        avgPathLength: journeys.summary.avgPathLength,
        uniquePaths: journeys.summary.uniquePaths,
      },
      stages,
      links,
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildInsightsDigestVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "insights_digest";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const insights = await context.runAnalytics((token) => getDashboardAIInsightsData(site.id, range, token));

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Insight digest", 90),
    description: truncate(args.description ?? "Top findings with next actions and evidence.", 140) || undefined,
    payload: {
      range: insights.range,
      summary: insights.summary,
      narrative: truncate(insights.analysis?.narrative ?? "", 240) || undefined,
      items: insights.items.slice(0, 4).map((item) => ({
        severity: item.severity,
        title: item.title,
        path: item.path,
        recommendation: item.recommendation || item.fix || item.finding,
        evidence: item.evidence,
        score: item.score,
      })),
      actions: (insights.actions ?? []).slice(0, 3).map((action) => ({
        title: action.title,
        path: action.path,
        expectedImpact: action.expectedImpact,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildHeatmapHotspotsVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "heatmap_hotspots";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const path = await resolveHeatmapPath(args, site.id, range, context.runAnalytics);
  const heatmap = await context.runAnalytics((token) =>
    getDashboardHeatmapData(
      site.id,
      path,
      range,
      "click",
      (args.clickFilter as "all" | "rage" | "dead" | "error") || "all",
      (args.viewport as "all" | "mobile" | "tablet" | "desktop") || "all",
      token,
    ),
  );

  const hotspots = [...heatmap.buckets]
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
  const maxCount = Math.max(...hotspots.map((bucket) => bucket.count), 1);

  return {
    preset,
    theme,
    title: truncate(args.title ?? `Hotspots for ${heatmap.path}`, 90),
    description: truncate(args.description ?? "Interaction concentration with click quality context.", 140) || undefined,
    payload: {
      range: heatmap.range,
      path: heatmap.path,
      viewport: heatmap.viewport,
      totals: {
        clicks: heatmap.totals.clicks,
        rageClicks: heatmap.totals.rageClicks,
        deadClicks: heatmap.totals.deadClicks,
        errorClicks: heatmap.totals.errorClicks,
        uniqueSessions: heatmap.totals.uniqueSessions,
      },
      confidenceLabel: heatmap.confidence.explanation,
      hotspots: hotspots.map((bucket) => ({
        x: bucket.x,
        y: bucket.y,
        intensity: bucket.count / maxCount,
        count: bucket.count,
        label: `${bucket.count} clicks`,
      })),
      selectors: heatmap.selectors.slice(0, 5).map((selector) => ({
        selector: selector.selector,
        clicks: selector.clicks,
        rageClicks: selector.rageClicks,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

async function buildScrollDepthVisual(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset: NeoVisualPreset = "scroll_depth_funnel";
  const site = resolveSite(context, args.siteId);
  const range = resolveRange(context, args.range);
  const theme = resolveTheme(preset, args.theme);
  const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));
  const totalSessions = Math.max(summary.scrollFunnel[0]?.sessions ?? summary.overview.sessions, 1);

  return {
    preset,
    theme,
    title: truncate(args.title ?? "Scroll depth funnel", 90),
    description: truncate(args.description ?? "How far sessions continue through the page.", 140) || undefined,
    payload: {
      range: summary.range,
      totalSessions,
      steps: summary.scrollFunnel.map((entry) => ({
        label: `${entry.depth}% depth`,
        value: entry.sessions,
        share: (entry.sessions / totalSessions) * 100,
      })),
    },
  } satisfies NeoVisualArtifactDraft;
}

const visualBuilders: Record<
  NeoVisualPreset,
  (args: NeoVisualArgs, context: NeoVisualBuildContext) => Promise<NeoVisualArtifactDraft>
> = {
  overview_trend: buildOverviewTrendVisual,
  top_pages_ranked: buildTopPagesVisual,
  referrer_ranked: buildReferrerVisual,
  device_breakdown_ranked: buildDeviceVisual,
  geo_countries_ranked: buildGeoCountriesVisual,
  retention_curve: buildRetentionCurveVisual,
  journey_flow: buildJourneyFlowVisual,
  insights_digest: buildInsightsDigestVisual,
  heatmap_hotspots: buildHeatmapHotspotsVisual,
  scroll_depth_funnel: buildScrollDepthVisual,
};

export function listNeoVisualPresets() {
  return {
    presets: Object.entries(neoVisualPresetMeta).map(([id, meta]) => ({
      id,
      ...meta,
    })),
    themes: Object.entries(neoVisualThemeMeta).map(([id, meta]) => ({
      id,
      label: meta.label,
    })),
  };
}

export async function createNeoVisualArtifact(args: NeoVisualArgs, context: NeoVisualBuildContext) {
  const preset = resolvePreset(args.preset ?? args.presetId ?? args.kind ?? "");
  const visualArtifact = await visualBuilders[preset](args, context);
  return {
    ok: true,
    summary: `Prepared the ${neoVisualPresetMeta[preset].label.toLowerCase()} visual in the ${neoVisualThemeMeta[visualArtifact.theme].label.toLowerCase()} theme.`,
    visualArtifact,
  };
}

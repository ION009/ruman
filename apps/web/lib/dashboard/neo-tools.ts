import "server-only";

import { listSitePages } from "@/lib/control-plane/site-pages";
import { updateViewerProfile } from "@/lib/control-plane/auth";
import type {
  DashboardSettingsResponse,
  DashboardSite,
  DashboardSummary,
  DashboardViewer,
  HeatmapClickFilter,
  HeatmapMode,
  HeatmapViewportSegment,
  InsightsView,
  RangeKey,
} from "@/lib/dashboard/types";
import {
  getDashboardAIInsightsData,
  getDashboardHeatmapData,
  getDashboardMapData,
  getDashboardSettingsData,
  getDashboardSummaryData,
} from "@/lib/dashboard/server";
import { createNeoVisualArtifact, listNeoVisualPresets } from "@/lib/dashboard/neo-visual-builder";

export type NeoToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type NeoToolResult =
  | {
      ok: boolean;
      clientAction?: {
        type: "theme";
        theme: "light" | "dark" | "system";
      };
      [key: string]: unknown;
    }
  | {
      ok: boolean;
      clientAction?: {
        type: "logout";
      };
      [key: string]: unknown;
    };

export type NeoAccessContext = {
  mode: "control-plane" | "token";
  viewer?: DashboardViewer;
  sites: DashboardSite[];
  currentSite: DashboardSite;
  selectedRange: RangeKey;
  pathname: string;
  requestOrigin: string;
  surfaces: string[];
  runAnalytics: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
};

type NeoToolArgs = Record<string, string>;
type NeoToolEntry = {
  definition: NeoToolDefinition;
  execute: (args: NeoToolArgs, context: NeoAccessContext) => Promise<unknown>;
};

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

function truncate(value: string, limit = 4000) {
  return value.trim().slice(0, limit);
}

function normalizeRange(value: string | undefined): RangeKey {
  if (value?.startsWith("custom:")) {
    return value as RangeKey;
  }
  if (value === "24h" || value === "30d") {
    return value;
  }
  return "7d";
}

function maybeParseJSON<T>(raw: string) {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function resolveSite(context: NeoAccessContext, siteId?: string) {
  if (!siteId?.trim()) {
    return context.currentSite;
  }

  return context.sites.find((site) => site.id === siteId) ?? context.currentSite;
}

function resolveRequestedRange(context: NeoAccessContext, range?: string) {
  return normalizeRange(range ?? context.selectedRange);
}

function sanitizeSummary(summary: DashboardSummary) {
  return {
    range: summary.range,
    overview: summary.overview,
    timeseries: summary.timeseries.slice(-14),
    topPages: summary.topPages.slice(0, 8),
    referrers: summary.referrers.slice(0, 6),
    devices: summary.devices.slice(0, 4),
    browsers: summary.browsers.slice(0, 4),
    operatingSystems: summary.operatingSystems.slice(0, 4),
    scrollFunnel: summary.scrollFunnel,
    pages: summary.pages.slice(0, 20),
  };
}

function sanitizeInsights(insights: InsightsView) {
  return {
    range: insights.range,
    generatedAt: insights.generatedAt,
    summary: insights.summary,
    engine: insights.engine,
    items: insights.items.slice(0, 8).map((item) => ({
      severity: item.severity,
      category: item.category,
      path: item.path,
      title: item.title,
      finding: item.finding,
      recommendation: item.recommendation,
      evidence: item.evidence,
      score: item.score,
      source: item.source,
    })),
  };
}

function sanitizeSettings(settings: DashboardSettingsResponse) {
  return {
    site: settings.site,
    privacy: settings.privacy,
    retention: settings.retention,
    stats: settings.stats,
    trackerScript: {
      siteId: settings.trackerScript.siteId,
      installOrigin: settings.trackerScript.installOrigin,
      collectorOrigin: settings.trackerScript.collectorOrigin,
      scriptSrc: settings.trackerScript.scriptSrc,
      isPersisted: settings.trackerScript.isPersisted,
      updatedAt: settings.trackerScript.updatedAt ?? null,
    },
  };
}

export const neoToolDirectory: Record<string, NeoToolEntry> = {
  get_dashboard_context: {
    definition: {
      type: "function",
      function: {
        name: "get_dashboard_context",
        description: "Get the current site, accessible sites, viewer, selected range, and current page context.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async (_args, context) => ({
      mode: context.mode,
      pathname: context.pathname,
      selectedRange: context.selectedRange,
      currentSite: {
        ...context.currentSite,
        label: labelForSite(context.currentSite),
      },
      accessibleSites: context.sites.map((item) => ({
        ...item,
        label: labelForSite(item),
      })),
      viewer: context.viewer ?? null,
      surfaces: context.surfaces,
    }),
  },
  get_profile: {
    definition: {
      type: "function",
      function: {
        name: "get_profile",
        description: "Get the current viewer profile when control-plane auth is enabled.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async (_args, context) => ({
      supported: context.mode === "control-plane",
      viewer: context.viewer ?? null,
    }),
  },
  update_profile_name: {
    definition: {
      type: "function",
      function: {
        name: "update_profile_name",
        description: "Update the viewer full name. Only use when the user explicitly asks to change their profile name.",
        parameters: {
          type: "object",
          properties: {
            fullName: {
              type: "string",
              description: "The new full name to store for the current viewer profile.",
            },
          },
          required: ["fullName"],
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      if (context.mode !== "control-plane" || !context.viewer) {
        throw new Error("Profile updates require control-plane auth.");
      }

      const fullName = truncate(args.fullName ?? "", 120);
      if (!fullName) {
        throw new Error("A non-empty full name is required.");
      }

      await updateViewerProfile(context.viewer.id, fullName);
      context.viewer = {
        ...context.viewer,
        fullName,
      };
      return {
        ok: true,
        viewer: context.viewer,
      };
    },
  },
  switch_theme: {
    definition: {
      type: "function",
      function: {
        name: "switch_theme",
        description: "Switch the user's dashboard theme. Only use when the user explicitly asks to change the theme.",
        parameters: {
          type: "object",
          properties: {
            theme: {
              type: "string",
              enum: ["light", "dark", "system"],
              description: "The theme to apply for the current user.",
            },
          },
          required: ["theme"],
          additionalProperties: false,
        },
      },
    },
    execute: async (args) => {
      const raw = (args.theme ?? "").trim().toLowerCase();
      const theme = raw === "light" || raw === "dark" || raw === "system" ? raw : "";
      if (!theme) {
        throw new Error("Theme must be light, dark, or system.");
      }

      return {
        ok: true,
        summary: `Theme will be switched to ${theme}.`,
        clientAction: {
          type: "theme",
          theme,
        },
      } satisfies NeoToolResult;
    },
  },
  logout_user: {
    definition: {
      type: "function",
      function: {
        name: "logout_user",
        description: "Log the current user out. Only use when the user explicitly asks to sign out or log out.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async () =>
      ({
        ok: true,
        summary: "The current user will be logged out.",
        clientAction: {
          type: "logout",
        },
      }) satisfies NeoToolResult,
  },
  get_summary: {
    definition: {
      type: "function",
      function: {
        name: "get_summary",
        description: "Get overview metrics, top pages, referrers, devices, browsers, and trend points for a site and range.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            range: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const range = resolveRequestedRange(context, args.range);
      const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        data: sanitizeSummary(summary),
      };
    },
  },
  get_ai_insights: {
    definition: {
      type: "function",
      function: {
        name: "get_ai_insights",
        description: "Get ranked AI plus rule-based findings, fixes, and evidence for the current site and range.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            range: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const range = resolveRequestedRange(context, args.range);
      const insights = await context.runAnalytics((token) => getDashboardAIInsightsData(site.id, range, token));
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        data: sanitizeInsights(insights),
      };
    },
  },
  get_site_pages: {
    definition: {
      type: "function",
      function: {
        name: "get_site_pages",
        description: "List known site pages. Uses discovered control-plane pages when available, otherwise falls back to top analytics pages.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const range = resolveRequestedRange(context, args.range);

      if (context.mode === "control-plane") {
        const pages = await listSitePages(site.id);
        return {
          site: {
            ...site,
            label: labelForSite(site),
          },
          source: "control-plane",
          pageCount: pages.length,
          pages: pages.slice(0, 80),
        };
      }

      const summary = await context.runAnalytics((token) => getDashboardSummaryData(site.id, range, token));
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        source: "analytics-top-pages",
        pageCount: summary.pages.length,
        pages: summary.pages.slice(0, 40),
      };
    },
  },
  get_heatmap_metrics: {
    definition: {
      type: "function",
      function: {
        name: "get_heatmap_metrics",
        description: "Get structured heatmap metrics for a path. Returns numeric aggregates, top selectors, hotspots, and confidence only.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            range: { type: "string" },
            path: { type: "string" },
            mode: { type: "string", enum: ["engagement", "click", "rage", "move", "scroll"] },
            clickFilter: { type: "string", enum: ["all", "rage", "dead", "error"] },
            viewport: { type: "string", enum: ["all", "mobile", "tablet", "desktop"] },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const range = resolveRequestedRange(context, args.range);
      const mode = (args.mode as HeatmapMode) || "engagement";
      const clickFilter = (args.clickFilter as HeatmapClickFilter) || "all";
      const viewport = (args.viewport as HeatmapViewportSegment) || "all";
      const path = truncate(args.path ?? "", 240);
      const heatmap = await context.runAnalytics((token) =>
        getDashboardHeatmapData(site.id, path || null, range, mode, clickFilter, viewport, token),
      );

      const hotspots = [...heatmap.buckets]
        .sort((left, right) => right.count - left.count)
        .slice(0, 12)
        .map((bucket) => ({
          x: bucket.x,
          y: bucket.y,
          count: bucket.count,
          weight: bucket.weight,
          sessions: bucket.sessions,
          visitors: bucket.visitors,
          rageCount: bucket.rageCount,
          deadCount: bucket.deadCount,
          errorCount: bucket.errorCount,
        }));

      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        path: heatmap.path,
        range: heatmap.range,
        mode: heatmap.mode,
        clickFilter: heatmap.clickFilter,
        viewport: heatmap.viewportSegment,
        totals: heatmap.totals,
        confidence: heatmap.confidence,
        viewportHint: heatmap.viewport,
        documentHint: heatmap.document,
        scrollFunnel: heatmap.scrollFunnel,
        topSelectors: heatmap.selectors.slice(0, 8),
        hotspots,
      };
    },
  },
  get_map_summary: {
    definition: {
      type: "function",
      function: {
        name: "get_map_summary",
        description: "Get geographic summary metrics plus top countries, regions, and cities for a site and range.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
            range: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const range = resolveRequestedRange(context, args.range);
      const map = await context.runAnalytics((token) => getDashboardMapData(site.id, range, token));
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        range: map.range,
        summary: map.summary,
        countries: map.countries.slice(0, 8),
        regions: map.regions.slice(0, 8),
        cities: map.cities.slice(0, 8),
      };
    },
  },
  get_settings_summary: {
    definition: {
      type: "function",
      function: {
        name: "get_settings_summary",
        description: "Get site settings, privacy, retention, origins, and tracker status without returning the full install snippet.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const settings = await context.runAnalytics((token) =>
        getDashboardSettingsData(site.id, context.requestOrigin, token),
      );
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        data: sanitizeSettings(settings),
      };
    },
  },
  get_tracker_installation: {
    definition: {
      type: "function",
      function: {
        name: "get_tracker_installation",
        description:
          "Get the exact tracker install snippet, full script tag, and script source for a site. Use this when the user asks for the tracking script, install tag, snippet, or full site script.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const settings = await context.runAnalytics((token) =>
        getDashboardSettingsData(site.id, context.requestOrigin, token),
      );
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        trackerScriptTag: settings.trackerSnippet,
        trackerScript: settings.trackerScript,
        trackerSnippet: settings.trackerSnippet,
      };
    },
  },
  get_tracker_script: {
    definition: {
      type: "function",
      function: {
        name: "get_tracker_script",
        description:
          "Get the exact full tracker install script tag for a site. Use this when the user asks for the full tracking script, site script, install script, or script tag.",
        parameters: {
          type: "object",
          properties: {
            siteId: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => {
      const site = resolveSite(context, args.siteId);
      const settings = await context.runAnalytics((token) =>
        getDashboardSettingsData(site.id, context.requestOrigin, token),
      );
      return {
        site: {
          ...site,
          label: labelForSite(site),
        },
        trackerScriptTag: settings.trackerSnippet,
        trackerScript: settings.trackerScript,
        trackerSnippet: settings.trackerSnippet,
      };
    },
  },
  list_visual_presets: {
    definition: {
      type: "function",
      function: {
        name: "list_visual_presets",
        description:
          "List Neo's prebuilt visual presets and color themes. Use before creating visuals when you need to inspect the available chart, graph, and diagram options.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    },
    execute: async () => listNeoVisualPresets(),
  },
  create_visual_artifact: {
    definition: {
      type: "function",
      function: {
        name: "create_visual_artifact",
        description:
          "Create one saved visual artifact from a fixed preset library using trusted analytics data. Never invent your own chart type. Choose a preset and optional theme, title, and filters.",
        parameters: {
          type: "object",
          properties: {
            preset: {
              type: "string",
              enum: [
                "overview_trend",
                "top_pages_ranked",
                "referrer_ranked",
                "device_breakdown_ranked",
                "geo_countries_ranked",
                "retention_curve",
                "journey_flow",
                "insights_digest",
                "heatmap_hotspots",
                "scroll_depth_funnel",
              ],
              description: "The visual preset to render.",
            },
            theme: {
              type: "string",
              enum: ["teal", "amber", "cobalt", "rose", "olive"],
              description: "Optional color theme. If omitted, Neo will use the preset default.",
            },
            siteId: {
              type: "string",
              description: "Optional site id. Defaults to the currently selected site.",
            },
            range: {
              type: "string",
              description: "Optional range. Defaults to the currently selected dashboard range.",
            },
            title: {
              type: "string",
              description: "Optional user-facing title shown in the visual modal.",
            },
            description: {
              type: "string",
              description: "Optional short explanation shown under the visual title.",
            },
            path: {
              type: "string",
              description: "Optional path for heatmap visuals.",
            },
            cadence: {
              type: "string",
              enum: ["daily", "weekly", "monthly"],
              description: "Optional cadence for retention visuals.",
            },
            device: {
              type: "string",
              description: "Optional device filter for retention or journey visuals.",
            },
            country: {
              type: "string",
              description: "Optional country filter for retention or journey visuals.",
            },
            clickFilter: {
              type: "string",
              enum: ["all", "rage", "dead", "error"],
              description: "Optional click quality filter for heatmap visuals.",
            },
            viewport: {
              type: "string",
              enum: ["all", "mobile", "tablet", "desktop"],
              description: "Optional viewport segment for heatmap visuals.",
            },
          },
          required: ["preset"],
          additionalProperties: false,
        },
      },
    },
    execute: async (args, context) => createNeoVisualArtifact(args, context),
  },
};

export const neoTools = Object.values(neoToolDirectory).map((entry) => entry.definition);

export async function executeNeoToolCall(
  toolName: string,
  rawArguments: string,
  context: NeoAccessContext,
) {
  const tool = neoToolDirectory[toolName];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const args = maybeParseJSON<NeoToolArgs>(rawArguments) ?? {};
  return tool.execute(args, context);
}

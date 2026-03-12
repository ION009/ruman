import type { NeoVisualPreset, NeoVisualTheme } from "@/lib/dashboard/types";

export const neoVisualThemeMeta: Record<
  NeoVisualTheme,
  {
    label: string;
    accent: string;
    accentSoft: string;
    accentStrong: string;
    border: string;
    surface: string;
    ink: string;
  }
> = {
  teal: {
    label: "Teal",
    accent: "#0D9488",
    accentSoft: "#CCFBF1",
    accentStrong: "#0F766E",
    border: "#99F6E4",
    surface: "#F0FDFA",
    ink: "#134E4A",
  },
  amber: {
    label: "Amber",
    accent: "#C2410C",
    accentSoft: "#FED7AA",
    accentStrong: "#9A3412",
    border: "#FDBA74",
    surface: "#FFF7ED",
    ink: "#7C2D12",
  },
  cobalt: {
    label: "Cobalt",
    accent: "#1D4ED8",
    accentSoft: "#DBEAFE",
    accentStrong: "#1E40AF",
    border: "#93C5FD",
    surface: "#EFF6FF",
    ink: "#1E3A8A",
  },
  rose: {
    label: "Rose",
    accent: "#BE185D",
    accentSoft: "#FCE7F3",
    accentStrong: "#9D174D",
    border: "#F9A8D4",
    surface: "#FFF1F2",
    ink: "#881337",
  },
  olive: {
    label: "Olive",
    accent: "#4D7C0F",
    accentSoft: "#ECFCCB",
    accentStrong: "#3F6212",
    border: "#BEF264",
    surface: "#F7FEE7",
    ink: "#365314",
  },
};

export const neoVisualPresetMeta: Record<
  NeoVisualPreset,
  {
    label: string;
    summary: string;
    promptHint: string;
  }
> = {
  overview_trend: {
    label: "Overview trend",
    summary: "KPI strip plus a two-series trend chart for summarizing traffic and engagement.",
    promptHint: "Use for summaries, explainers, comparisons, and executive snapshots.",
  },
  top_pages_ranked: {
    label: "Top pages ranked",
    summary: "Ranked list of the strongest landing or content pages with proportional bars.",
    promptHint: "Use when the user asks which pages matter most or where attention is concentrated.",
  },
  referrer_ranked: {
    label: "Referrer ranked",
    summary: "Ranked source breakdown for acquisition questions and channel mix explanations.",
    promptHint: "Use for traffic-source and acquisition questions.",
  },
  device_breakdown_ranked: {
    label: "Device breakdown",
    summary: "Ranked device distribution view for explaining mobile, desktop, and tablet balance.",
    promptHint: "Use when the user asks about device mix or audience composition.",
  },
  geo_countries_ranked: {
    label: "Geo countries",
    summary: "Country ranking with market share bars and location context.",
    promptHint: "Use for geographic breakdowns and market spread questions.",
  },
  retention_curve: {
    label: "Retention curve",
    summary: "Retention line chart with day-one, day-seven, and day-thirty context.",
    promptHint: "Use for loyalty, return behavior, and cohort-retention explanations.",
  },
  journey_flow: {
    label: "Journey flow",
    summary: "Stage-based flow diagram built from top journey nodes and transitions.",
    promptHint: "Use for pathing, journey, and movement-through-site explanations.",
  },
  insights_digest: {
    label: "Insights digest",
    summary: "Structured board of top findings, severity, and recommended next actions.",
    promptHint: "Use when summarizing AI insights, audits, or prioritization.",
  },
  heatmap_hotspots: {
    label: "Heatmap hotspots",
    summary: "Page-stage hotspot map with top selectors and click-quality context.",
    promptHint: "Use for click concentration, friction, or dead-click questions.",
  },
  scroll_depth_funnel: {
    label: "Scroll depth funnel",
    summary: "Step-style depth view showing how far sessions continue down a page.",
    promptHint: "Use for engagement depth, content reach, and drop-off-through-page explanations.",
  },
};

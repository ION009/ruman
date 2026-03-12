"use client";

import { ArrowRight, Route, Sparkles, TrendingUp } from "lucide-react";
import { useMemo } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardReplaySessions, useDashboardSummary } from "@/hooks/use-dashboard";
import { cn, formatCompact, formatPercent } from "@/lib/utils";

const STAGE_LABELS = ["Landing", "Explore", "Intent", "Outcome"];
const STAGE_COLORS = [
  { fill: "#fff3e7", stroke: "#b14a19", accent: "#b14a19" },
  { fill: "#fff6d9", stroke: "#d28124", accent: "#d28124" },
  { fill: "#eef7e9", stroke: "#587347", accent: "#587347" },
  { fill: "#e8f1f5", stroke: "#2f6271", accent: "#2f6271" },
];
const SVG_WIDTH = 1120;
const SVG_HEIGHT = 560;
const MAX_STAGES = 4;
const MAX_NODES_PER_STAGE = 4;
const MAX_LINKS = 16;
const COLUMN_WIDTH = 178;

type DiagramNode = {
  id: string;
  path: string;
  stage: number;
  count: number;
  share: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  accent: string;
};

type DiagramLink = {
  id: string;
  sourceId: string;
  targetId: string;
  count: number;
  share: number;
  strokeWidth: number;
  gradientId: string;
};

type DiagramRoute = {
  paths: string[];
  count: number;
};

type DiagramData = {
  source: "replay" | "modeled";
  totalJourneys: number;
  uniqueRoutes: number;
  averageDepth: number;
  topRoute: DiagramRoute | null;
  stages: number[];
  nodes: DiagramNode[];
  links: DiagramLink[];
};

function shortPath(path: string) {
  if (!path || path === "/") {
    return "/";
  }
  if (path.length <= 22) {
    return path;
  }
  return `${path.slice(0, 19)}...`;
}

function normalizeSessionRoute(paths: string[], entryPath: string, exitPath: string) {
  const raw = paths.filter(Boolean);
  if (raw.length === 0) {
    if (entryPath && exitPath && entryPath !== exitPath) {
      return [entryPath, exitPath].slice(0, MAX_STAGES);
    }
    return [entryPath || exitPath].filter(Boolean).slice(0, MAX_STAGES);
  }

  const deduped: string[] = [];
  for (const path of raw) {
    if (deduped[deduped.length - 1] !== path) {
      deduped.push(path);
    }
  }

  if (deduped.length === 1 && exitPath && exitPath !== deduped[0]) {
    deduped.push(exitPath);
  }

  return deduped.slice(0, MAX_STAGES);
}

function buildModeledRoutes(
  topPages: Array<{ path: string; sessions: number }>,
  totalSessions: number,
): DiagramRoute[] {
  const pages = topPages.slice(0, 6);
  if (pages.length < 2) {
    return [];
  }

  return pages.slice(0, 4).map((page, index) => {
    const next = pages[Math.min(index + 1, pages.length - 1)];
    const after = pages[Math.min(index + 3, pages.length - 1)];
    const route = [page.path];
    if (next.path !== route[route.length - 1]) {
      route.push(next.path);
    }
    if (after.path !== route[route.length - 1]) {
      route.push(after.path);
    }

    const volume = Math.max(
      1,
      Math.round(
        Math.min(page.sessions, next.sessions, after.sessions || next.sessions) *
          (0.68 - index * 0.11),
      ),
    );

    return {
      paths: route.slice(0, MAX_STAGES),
      count: Math.min(volume, Math.max(1, totalSessions)),
    };
  });
}

function buildDiagramData(
  routes: DiagramRoute[],
  totalJourneys: number,
  source: DiagramData["source"],
): DiagramData | null {
  if (routes.length === 0 || totalJourneys <= 0) {
    return null;
  }

  const nodeCounts = new Map<string, number>();
  const linkCounts = new Map<string, number>();
  const routeCounts = new Map<string, number>();
  let depthTotal = 0;
  let maxStageIndex = 0;

  for (const route of routes) {
    const key = route.paths.join("\u001f");
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + route.count);
    depthTotal += route.paths.length * route.count;

    route.paths.forEach((path, stage) => {
      const nodeKey = `${stage}:${path}`;
      nodeCounts.set(nodeKey, (nodeCounts.get(nodeKey) ?? 0) + route.count);
      maxStageIndex = Math.max(maxStageIndex, stage);

      if (stage < route.paths.length - 1) {
        const linkKey = `${stage}:${path}->${route.paths[stage + 1]}`;
        linkCounts.set(linkKey, (linkCounts.get(linkKey) ?? 0) + route.count);
      }
    });
  }

  const stageIndices = Array.from({ length: maxStageIndex + 1 }, (_, index) => index);
  const selectedNodeIds = new Set<string>();
  for (const stage of stageIndices) {
    const topStageNodes = Array.from(nodeCounts.entries())
      .filter(([key]) => Number(key.split(":")[0]) === stage)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_NODES_PER_STAGE);

    for (const [key] of topStageNodes) {
      selectedNodeIds.add(key);
    }
  }

  const keptLinks = Array.from(linkCounts.entries())
    .map(([key, count]) => {
      const [sourcePart, targetPath] = key.split("->");
      const [stageString, sourcePath] = sourcePart.split(":");
      const stage = Number(stageString);
      return {
        id: key,
        sourceId: `${stage}:${sourcePath}`,
        targetId: `${stage + 1}:${targetPath}`,
        count,
      };
    })
    .filter((link) => selectedNodeIds.has(link.sourceId) && selectedNodeIds.has(link.targetId))
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
    .slice(0, MAX_LINKS);

  const columnGap =
    stageIndices.length > 1 ? (SVG_WIDTH - 240 - COLUMN_WIDTH) / (stageIndices.length - 1) : 0;
  const stageMaxNodeCount = Math.max(
    ...Array.from(nodeCounts.values()),
    1,
  );

  const nodes: DiagramNode[] = [];
  for (const stage of stageIndices) {
    const stagePalette = STAGE_COLORS[stage] ?? STAGE_COLORS[STAGE_COLORS.length - 1];
    const stageNodes = Array.from(nodeCounts.entries())
      .filter(([id]) => selectedNodeIds.has(id) && Number(id.split(":")[0]) === stage)
      .map(([id, count]) => ({ id, count, path: id.split(":").slice(1).join(":") }))
      .sort((left, right) => right.count - left.count || left.path.localeCompare(right.path));

    const heights = stageNodes.map((node) => 56 + (node.count / stageMaxNodeCount) * 38);
    const totalHeight =
      heights.reduce((sum, value) => sum + value, 0) + Math.max(0, stageNodes.length - 1) * 16;
    let currentY = (SVG_HEIGHT - totalHeight) / 2;
    const x = 120 + stage * columnGap;

    stageNodes.forEach((node, index) => {
      nodes.push({
        id: node.id,
        path: node.path,
        stage,
        count: node.count,
        share: node.count / totalJourneys,
        x,
        y: currentY,
        width: COLUMN_WIDTH,
        height: heights[index],
        fill: stagePalette.fill,
        stroke: stagePalette.stroke,
        accent: stagePalette.accent,
      });
      currentY += heights[index] + 16;
    });
  }

  const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
  const linkMaxCount = Math.max(...keptLinks.map((link) => link.count), 1);
  const links: DiagramLink[] = keptLinks
    .filter((link) => nodeLookup.has(link.sourceId) && nodeLookup.has(link.targetId))
    .map((link) => ({
      ...link,
      share: link.count / totalJourneys,
      strokeWidth: 6 + (link.count / linkMaxCount) * 18,
      gradientId: `journey-link-${link.id.replace(/[^a-z0-9_-]/gi, "-")}`,
    }));

  const topRouteEntry = Array.from(routeCounts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];

  return {
    source,
    totalJourneys,
    uniqueRoutes: routeCounts.size,
    averageDepth: depthTotal / totalJourneys,
    topRoute: topRouteEntry
      ? {
          paths: topRouteEntry[0].split("\u001f"),
          count: topRouteEntry[1],
        }
      : null,
    stages: stageIndices,
    nodes,
    links,
  };
}

function buildLinkPath(source: DiagramNode, target: DiagramNode) {
  const startX = source.x + source.width;
  const startY = source.y + source.height / 2;
  const endX = target.x;
  const endY = target.y + target.height / 2;
  const controlOffset = (endX - startX) * 0.42;

  return `M ${startX} ${startY} C ${startX + controlOffset} ${startY}, ${endX - controlOffset} ${endY}, ${endX} ${endY}`;
}

export function JourneysView() {
  const summaryQuery = useDashboardSummary();
  const replaySessionsQuery = useDashboardReplaySessions();

  const diagram = useMemo(() => {
    const replaySessions = replaySessionsQuery.data?.sessions ?? [];
    const replayRoutes = replaySessions
      .map((session) =>
        normalizeSessionRoute(session.paths, session.entryPath, session.exitPath),
      )
      .filter((route) => route.length >= 2)
      .map((paths) => ({ paths, count: 1 }));

    if (replayRoutes.length > 0) {
      return buildDiagramData(replayRoutes, replayRoutes.length, "replay");
    }

    if (!summaryQuery.data?.topPages?.length) {
      return null;
    }

    const modeledRoutes = buildModeledRoutes(
      summaryQuery.data.topPages.map((page) => ({
        path: page.path,
        sessions: page.sessions,
      })),
      Math.max(summaryQuery.data.overview.sessions, 1),
    );
    const modeledTotal = modeledRoutes.reduce((sum, route) => sum + route.count, 0);
    return buildDiagramData(modeledRoutes, modeledTotal, "modeled");
  }, [replaySessionsQuery.data, summaryQuery.data]);

  /* ------------------------------------------------------------------ */
  /*  Loading state                                                      */
  /* ------------------------------------------------------------------ */

  if ((summaryQuery.isLoading && !summaryQuery.data) || (replaySessionsQuery.isLoading && !replaySessionsQuery.data)) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 rounded-lg" />
        <Skeleton className="h-[560px] rounded-2xl" />
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Empty state — teach next step                                      */
  /* ------------------------------------------------------------------ */

  if (!diagram) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <div className="flex flex-col items-center py-12 text-center">
          <Route className="size-7 text-text-muted" />
          <h3 className="mt-3 text-[14px] font-semibold text-text-primary">
            Not enough path data yet
          </h3>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-text-secondary">
            Journeys become diagram-ready once replay path samples or top-page
            activity are available. Install the tracking snippet on your site and
            wait for at least two unique page visits in a single session.
          </p>
          <span className="mt-4 rounded-md bg-surface-secondary px-2 py-1 text-[11px] font-medium text-text-secondary">
            Tip: Check Session Replay to confirm the script is collecting paths
          </span>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Main view                                                          */
  /* ------------------------------------------------------------------ */

  const nodeLookup = new Map(diagram.nodes.map((node) => [node.id, node]));
  const dominantShare = diagram.topRoute ? (diagram.topRoute.count / diagram.totalJourneys) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="ov-section-title flex items-center gap-2">
            <Sparkles className="size-3.5 text-accent-teal" />
            Journey Canvas
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
            How visitors move from landing pages into deeper intent pages, then
            into outcomes. Link widths reflect path volume.
          </p>
        </div>

        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            diagram.source === "replay"
              ? "bg-status-info-bg text-accent-teal"
              : "bg-status-warning-bg text-accent-amber",
          )}
        >
          {diagram.source === "replay" ? "Using replay paths" : "Modeled from page traffic"}
        </span>
      </div>

      {/* ── KPI strip ───────────────────────────────────────────────── */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Journeys</p>
          <p className="ov-kpi-number">{formatCompact(diagram.totalJourneys)}</p>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Unique routes</p>
          <p className="ov-kpi-number">{formatCompact(diagram.uniqueRoutes)}</p>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Avg. stages</p>
          <p className="ov-kpi-number">{diagram.averageDepth.toFixed(1)}</p>
        </div>
        {diagram.topRoute ? (
          <div className="ov-kpi-cell">
            <p className="ov-kpi-label">Dominant share</p>
            <p className="ov-kpi-number flex items-center gap-2">
              <TrendingUp className="size-4 text-accent-teal" />
              {formatPercent(dominantShare, 1)}
            </p>
          </div>
        ) : (
          <div className="ov-kpi-cell">
            <p className="ov-kpi-label">Dominant share</p>
            <p className="ov-kpi-number text-text-muted">&mdash;</p>
          </div>
        )}
      </div>

      {/* ── Flow diagram (hero surface) ─────────────────────────────── */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <div className="ov-section-header mb-3">
          <div>
            <h3 className="ov-section-title">Flow Map</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Curved links scale with route volume. Stages ordered by first
              observed position in each sampled journey.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto pb-2">
          <div className="min-w-[1040px]">
            <div className="grid grid-cols-4 gap-4 px-6 pb-3">
              {diagram.stages.map((stage) => (
                <div key={stage} className="text-center">
                  <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-text-muted">
                    {STAGE_LABELS[stage] ?? `Stage ${stage + 1}`}
                  </p>
                </div>
              ))}
            </div>

            <svg
              viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
              className="h-[560px] w-full"
              role="img"
              aria-label="User journey flow diagram"
            >
              <defs>
                {diagram.links.map((link) => {
                  const source = nodeLookup.get(link.sourceId);
                  const target = nodeLookup.get(link.targetId);
                  if (!source || !target) {
                    return null;
                  }
                  return (
                    <linearGradient
                      id={link.gradientId}
                      key={link.gradientId}
                      x1={`${((source.x + source.width) / SVG_WIDTH) * 100}%`}
                      x2={`${(target.x / SVG_WIDTH) * 100}%`}
                      y1="0%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor={source.accent} stopOpacity="0.52" />
                      <stop offset="100%" stopColor={target.accent} stopOpacity="0.82" />
                    </linearGradient>
                  );
                })}
              </defs>

              {diagram.links.map((link) => {
                const source = nodeLookup.get(link.sourceId);
                const target = nodeLookup.get(link.targetId);
                if (!source || !target) {
                  return null;
                }

                return (
                  <path
                    key={link.id}
                    d={buildLinkPath(source, target)}
                    fill="none"
                    stroke={`url(#${link.gradientId})`}
                    strokeLinecap="round"
                    strokeWidth={link.strokeWidth}
                    opacity={0.22 + link.share * 1.45}
                  />
                );
              })}

              {diagram.nodes.map((node) => (
                <g key={node.id}>
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    rx="24"
                    fill={node.fill}
                    stroke={node.stroke}
                    strokeWidth="1.4"
                  />
                  <rect
                    x={node.x + 12}
                    y={node.y + 12}
                    width="4"
                    height={node.height - 24}
                    rx="999"
                    fill={node.accent}
                    opacity="0.88"
                  />
                  <text
                    x={node.x + 26}
                    y={node.y + 28}
                    fontSize="11"
                    fill="#78716C"
                    letterSpacing="0.04em"
                  >
                    {formatPercent(node.share * 100, 0)}
                  </text>
                  <text
                    x={node.x + 26}
                    y={node.y + 54}
                    fontSize="16"
                    fontWeight="700"
                    fill="#1C1917"
                  >
                    {shortPath(node.path)}
                  </text>
                  <text
                    x={node.x + 26}
                    y={node.y + 78}
                    fontSize="12"
                    fill="#78716C"
                  >
                    {formatCompact(node.count)} journeys
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      </div>

      {/* ── Dominant route (ov-list style) ──────────────────────────── */}
      {diagram.topRoute ? (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <div className="ov-section-header mb-3">
            <h3 className="ov-section-title">Dominant Route</h3>
            <span className="rounded-md bg-status-info-bg px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">
              {formatCompact(diagram.topRoute.count)} journeys
            </span>
          </div>
          <div className="ov-list">
            <div className="ov-list-header">
              <span>Step</span>
              <span>Page</span>
            </div>
            {diagram.topRoute.paths.map((path, index) => {
              const share =
                diagram.topRoute!.paths.length > 1
                  ? ((diagram.topRoute!.paths.length - index) / diagram.topRoute!.paths.length) * 100
                  : 100;
              return (
                <div key={`${path}-${index}`} className="ov-list-row">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    {index > 0 && (
                      <ArrowRight className="size-3 shrink-0 text-text-muted" />
                    )}
                    <span className="ov-list-label">{path}</span>
                  </div>
                  <span className="ov-list-value">
                    {STAGE_LABELS[index] ?? `Stage ${index + 1}`}
                  </span>
                  <div className="ov-list-bar-bg">
                    <div
                      className="ov-list-bar-fill"
                      style={{
                        width: `${Math.max(4, share)}%`,
                        backgroundColor: STAGE_COLORS[index]?.accent ?? "#0D9488",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

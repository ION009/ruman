"use client";

import { Download, Loader2, MapPinned, Mouse, MousePointerClick, RefreshCw, Waves, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { HeatmapStage } from "@/components/charts/heatmap-stage";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardHeatmap } from "@/hooks/use-dashboard";
import { requestHeatmapDOMRefresh } from "@/lib/dashboard/client";
import { cn, formatCompact, formatNumber, formatPercent } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const RELIABLE_HEATMAP_CLICK_MIN = 500;

function formatHoverTime(ms: number) {
  if (!ms || ms <= 0) return "0s";
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)}m`;
  return `${Math.round(ms / 1000)}s`;
}

/* ------------------------------------------------------------------ */
/*  Section wrapper                                                    */
/* ------------------------------------------------------------------ */

function Section({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("section-frame rounded-2xl border border-border/50 p-4 sm:p-5", className)}>
      {title && (
        <div className="ov-section-header mb-3">
          <div>
            <h3 className="ov-section-title">{title}</h3>
            {subtitle && <p className="mt-0.5 text-[12px] text-text-secondary">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main HeatmapsView                                                  */
/* ------------------------------------------------------------------ */

export function HeatmapsView() {
  const [selectedPath, setSelectedPath] = useState("");
  const [clickOpacity, setClickOpacity] = useState(0.78);
  const [moveOpacity, setMoveOpacity] = useState(0.42);
  const [intensity, setIntensity] = useState(0.9);
  const [showHotspotLabels, setShowHotspotLabels] = useState(false);
  const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
  const selectedRange = useDashboardStore((s) => s.selectedRange);
  const heatmapMode = useDashboardStore((s) => s.heatmapMode);
  const setHeatmapMode = useDashboardStore((s) => s.setHeatmapMode);
  const heatmapClickFilter = useDashboardStore((s) => s.heatmapClickFilter);
  const setHeatmapClickFilter = useDashboardStore((s) => s.setHeatmapClickFilter);
  const heatmapViewportSegment = useDashboardStore((s) => s.heatmapViewportSegment);
  const setHeatmapViewportSegment = useDashboardStore((s) => s.setHeatmapViewportSegment);
  const heatmapQuery = useDashboardHeatmap(selectedPath);
  const queryClient = useQueryClient();
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [regenerateStatus, setRegenerateStatus] = useState<{
    tone: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!selectedPath && heatmapQuery.data?.path) {
      setSelectedPath(heatmapQuery.data.path);
    }
  }, [heatmapQuery.data?.path, selectedPath]);

  /* ---- Error/Loading states ---- */

  if (heatmapQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-status-error">Heatmap unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{heatmapQuery.error.message}</p>
      </div>
    );
  }

  if (heatmapQuery.isLoading && !heatmapQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[480px] rounded-2xl" />
        <Skeleton className="h-[100px] rounded-2xl" />
      </div>
    );
  }

  if (!heatmapQuery.data) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-text-primary">Heatmap unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">The heatmap payload did not include any data.</p>
      </div>
    );
  }

  const hData = heatmapQuery.data;

  const hasHeatmapData =
    hData.totals.clicks > 0 ||
    hData.totals.moveEvents > 0 ||
    hData.totals.rageClicks > 0 ||
    hData.buckets.length > 0 ||
    hData.moveBuckets.length > 0;

  const hasPageContext = hData.paths.length > 0;

  if (!hasHeatmapData && !hasPageContext) {
    return (
      <div className="section-frame flex flex-col items-center justify-center rounded-2xl border border-border/50 py-16 text-center">
        <Waves className="size-10 text-text-muted" />
        <h3 className="mt-4 text-[15px] font-semibold text-text-primary">No interaction data yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
          Heatmaps require click, movement, and scroll events from the tracker. Once visitors interact with
          your site, interaction zones will appear here.
        </p>
      </div>
    );
  }

  /* ---- Derived values ---- */

  const activeMode = hData.mode || heatmapMode;
  const activeClickFilter = hData.clickFilter || heatmapClickFilter;
  const normalizedClickFilter = activeMode === "rage" ? "rage" : activeClickFilter;
  const clickMode = activeMode === "engagement" || activeMode === "click" || activeMode === "rage";
  const availableModes = hData.availableModes?.length
    ? hData.availableModes
    : ["engagement", "click", "rage", "move", "scroll"];
  const availableClickFilters = hData.availableClickFilters?.length
    ? hData.availableClickFilters
    : ["all", "rage", "dead", "error"];
  const activeViewportSegment = hData.viewportSegment || heatmapViewportSegment;
  const availableViewportSegments = hData.availableViewportSegments?.length
    ? hData.availableViewportSegments
    : ["all", "mobile", "tablet", "desktop"];

  const selectedClickLabel =
    normalizedClickFilter === "rage"
      ? "rage clicks"
      : normalizedClickFilter === "dead"
        ? "dead clicks"
        : normalizedClickFilter === "error"
          ? "error clicks"
          : "clicks";

  const confidence = hData.confidence;
  const hasLowClickSample = !confidence.insightReady && confidence.sampleSize > 0;

  const sortedBuckets = [...(activeMode === "move" ? hData.moveBuckets : hData.buckets)].sort((a, b) => {
    const aValue = a.count > 0 ? a.count : a.weight;
    const bValue = b.count > 0 ? b.count : b.weight;
    return bValue - aValue;
  });
  const peakBucket = sortedBuckets[0];
  const peakValue = peakBucket ? peakBucket.count : 0;

  const rageShare = hData.totals.clicks
    ? (hData.totals.rageClicks / hData.totals.clicks) * 100
    : 0;
  const deadShare = hData.totals.clicks
    ? (hData.totals.deadClicks / hData.totals.clicks) * 100
    : 0;
  const errorShare = hData.totals.clicks
    ? (hData.totals.errorClicks / hData.totals.clicks) * 100
    : 0;

  /* ---- Scroll depth data for bar visualization ---- */
  const scrollTop = hData.scrollFunnel[0]?.sessions ?? 1;
  const activePath = selectedPath || hData.path || "/";

  async function handleRegenerate() {
    if (!selectedSiteId || isRegenerating) {
      return;
    }

    setRegenerateStatus(null);
    setIsRegenerating(true);
    try {
      const result = await requestHeatmapDOMRefresh(selectedSiteId, {
        path: activePath,
        scope: "site",
      });
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "heatmap"] });
      for (const delay of [2500, 5000, 9000, 14000]) {
        window.setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: ["dashboard", "heatmap"] });
        }, delay);
      }
      setRegenerateStatus({
        tone: "success",
        message: result.note ?? "Site refresh requested. Fresh DOM snapshots will be uploaded as the crawl completes.",
      });
    } catch (error) {
      setRegenerateStatus({
        tone: "error",
        message: error instanceof Error ? error.message : "Failed to request a heatmap DOM refresh.",
      });
    } finally {
      setIsRegenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* ---- Page selector bar ---- */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedPath || hData.path} onValueChange={setSelectedPath}>
          <SelectTrigger className="h-9 w-full max-w-[320px] rounded-xl text-[13px]">
            <SelectValue placeholder="Select path" />
          </SelectTrigger>
          <SelectContent>
            {hData.paths.map((page) => (
              <SelectItem key={page.path} value={page.path}>
                {page.path}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-[12px] tabular-nums text-text-secondary">
          {hData.viewport.width}×{hData.viewport.height} · {activeViewportSegment}
        </span>

        <Button asChild variant="outline" size="sm" className="ml-auto gap-1.5 rounded-xl">
          <a
            href={`/api/dashboard/export/heatmap?site=${encodeURIComponent(selectedSiteId)}&path=${encodeURIComponent(activePath)}&range=${encodeURIComponent(selectedRange)}&format=csv`}
          >
            <Download className="size-3.5" />
            Export
          </a>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 rounded-xl"
          disabled={isRegenerating}
          onClick={handleRegenerate}
        >
          {isRegenerating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {isRegenerating ? "Requesting…" : "Regenerate"}
        </Button>
      </div>

      {regenerateStatus && (
        <div
          className={cn(
            "rounded-xl border px-3 py-2 text-[12px]",
            regenerateStatus.tone === "success"
              ? "border-accent-teal/30 bg-accent-teal/10 text-text-primary"
              : "border-status-error/20 bg-status-error/10 text-status-error"
          )}
        >
          {regenerateStatus.message}
        </div>
      )}

      {/* ---- Confidence notice ---- */}
      {hasLowClickSample && (
        <div className="flex items-center gap-2 rounded-lg bg-status-warning-bg px-3 py-2 text-[12px] text-amber-800 dark:text-amber-400">
          <Zap className="size-3.5 shrink-0" />
          Heatmap confidence is {Math.round(confidence.score)}% with {formatNumber(confidence.sampleSize)} samples
          across {formatNumber(confidence.sessionSample)} sessions. Collect at least{" "}
          {formatNumber(confidence.minSample || RELIABLE_HEATMAP_CLICK_MIN)} for insight-ready density.
        </div>
      )}

      {/* ---- Heatmap Canvas (HERO — at the top) ---- */}
      <Section title="" className="!p-0 overflow-hidden">
        <div className="p-4 sm:p-5">
          {!hasHeatmapData && (
            <div className="mb-4 rounded-lg border border-dashed border-border/60 bg-surface-tertiary px-3 py-2 text-[12px] text-text-secondary">
              Density regions will appear after tracked clicks, moves, and scrolls.
            </div>
          )}
          <HeatmapStage
            buckets={hData.buckets}
            moveBuckets={hData.moveBuckets}
            domSnapshot={hData.domSnapshot ?? undefined}
            screenshot={hData.screenshot ?? undefined}
            viewport={hData.viewport}
            documentHint={hData.document}
            mode={activeMode}
            clickFilter={normalizedClickFilter}
            scrollFunnel={hData.scrollFunnel}
            clickOpacity={clickOpacity}
            moveOpacity={moveOpacity}
            intensity={intensity}
            showHotspotLabels={showHotspotLabels}
          />
        </div>

        {/* Heat legend bar */}
        <div className="flex items-center gap-2 border-t border-border/40 bg-surface-tertiary px-4 py-2 text-[11px] text-text-secondary">
          <span>Cool</span>
          <div
            className="h-1.5 w-32 rounded-full"
            style={{
              background: "linear-gradient(90deg, #2f6dff 0%, #34d6ff 22%, #6bf274 50%, #ffe45a 74%, #ff2a2a 100%)",
            }}
          />
          <span>Hot</span>
          <span className="ml-auto tabular-nums text-text-primary">
            Peak at {peakBucket?.x ?? 0}% × {peakBucket?.y ?? 0}%
          </span>
        </div>
      </Section>

      {/* ---- Controls (below canvas) ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Map mode</span>
          <Select
            value={heatmapMode}
            onValueChange={(value) => {
              const next = value as typeof heatmapMode;
              setHeatmapMode(next);
              if (next === "rage") setHeatmapClickFilter("rage");
              if (next === "engagement" || next === "move" || next === "scroll") setHeatmapClickFilter("all");
            }}
          >
            <SelectTrigger className="h-8 rounded-xl text-[12px]">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              {availableModes.map((mode) => (
                <SelectItem key={mode} value={mode}>{mode}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Click filter</span>
          <Select value={normalizedClickFilter} onValueChange={(v) => setHeatmapClickFilter(v as typeof heatmapClickFilter)}>
            <SelectTrigger className="h-8 rounded-xl text-[12px]" disabled={!clickMode || activeMode === "rage"}>
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              {availableClickFilters.map((filter) => (
                <SelectItem key={filter} value={filter}>{filter}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Viewport</span>
          <Select value={activeViewportSegment} onValueChange={(v) => setHeatmapViewportSegment(v as typeof heatmapViewportSegment)}>
            <SelectTrigger className="h-8 rounded-xl text-[12px]">
              <SelectValue placeholder="Viewport" />
            </SelectTrigger>
            <SelectContent>
              {availableViewportSegments.map((seg) => (
                <SelectItem key={seg} value={seg}>{seg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setShowHotspotLabels((c) => !c)}
            className={cn(
              "h-8 w-full rounded-xl border px-3 text-[12px] font-medium transition-colors",
              showHotspotLabels
                ? "border-accent-teal/40 bg-accent-teal/10 text-text-primary"
                : "border-border/60 bg-surface-primary text-text-secondary hover:bg-surface-tertiary"
            )}
          >
            {showHotspotLabels ? "Hide labels" : "Show labels"}
          </button>
        </div>
      </div>

      {/* Sliders row */}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Click opacity ({Math.round(clickOpacity * 100)}%)</span>
          <input
            type="range" min={20} max={100} step={1}
            value={Math.round(clickOpacity * 100)}
            onChange={(e) => setClickOpacity(Number(e.target.value) / 100)}
            className="h-2 w-full cursor-pointer accent-[#0D9488]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Move opacity ({Math.round(moveOpacity * 100)}%)</span>
          <input
            type="range" min={10} max={70} step={1}
            value={Math.round(moveOpacity * 100)}
            onChange={(e) => setMoveOpacity(Number(e.target.value) / 100)}
            className="h-2 w-full cursor-pointer accent-[#F59E0B]"
          />
        </label>
        <label className="space-y-1.5">
          <span className="text-[11px] font-medium text-text-secondary">Intensity ({intensity.toFixed(1)}×)</span>
          <input
            type="range" min={0.7} max={2} step={0.1}
            value={intensity}
            onChange={(e) => setIntensity(Number(e.target.value))}
            className="h-2 w-full cursor-pointer accent-[#EC4899]"
          />
        </label>
      </div>

      {/* ---- KPI Strip ---- */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell">
          <div className="flex items-center gap-1.5">
            <MousePointerClick className="size-3.5 text-accent-teal" />
            <p className="ov-kpi-label">Total clicks</p>
          </div>
          <p className="ov-kpi-number">{formatNumber(hData.totals.clicks)}</p>
        </div>
        <div className="ov-kpi-cell">
          <div className="flex items-center gap-1.5">
            <Zap className="size-3.5 text-status-error" />
            <p className="ov-kpi-label">Rage clicks</p>
          </div>
          <p className="ov-kpi-number">{formatNumber(hData.totals.rageClicks)}</p>
          <p className="text-[10px] tabular-nums text-text-muted">{formatPercent(rageShare)} of total</p>
        </div>
        <div className="ov-kpi-cell">
          <div className="flex items-center gap-1.5">
            <MousePointerClick className="size-3.5 text-accent-amber" />
            <p className="ov-kpi-label">Dead clicks</p>
          </div>
          <p className="ov-kpi-number">{formatNumber(hData.totals.deadClicks)}</p>
          <p className="text-[10px] tabular-nums text-text-muted">{formatPercent(deadShare)} of total</p>
        </div>
        <div className="ov-kpi-cell">
          <div className="flex items-center gap-1.5">
            <Mouse className="size-3.5 text-indigo-500" />
            <p className="ov-kpi-label">Mouse moves</p>
          </div>
          <p className="ov-kpi-number">{formatNumber(hData.totals.moveEvents)}</p>
        </div>
      </div>

      {/* ---- Hot Zones + Selectors + Scroll Depth + Path Roster ---- */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Hot Zones */}
        <Section title={activeMode === "move" ? "High Attention Zones" : "Hot Zones"}>
          {sortedBuckets.length > 0 ? (
            <div className="ov-list">
              <div className="ov-list-header">
                <span>Zone</span>
                <span>{activeMode === "move" ? "Moves" : "Clicks"}</span>
              </div>
              {sortedBuckets.slice(0, 6).map((bucket, i) => {
                const bVal = bucket.count > 0 ? bucket.count : Math.round(bucket.weight);
                const share = peakValue > 0 ? (bVal / peakValue) * 100 : 0;
                return (
                  <div key={`${bucket.x}-${bucket.y}-${i}`} className="ov-list-row">
                    <span className="ov-list-label">
                      Zone {String(i + 1).padStart(2, "0")}
                      <span className="ml-1.5 text-[11px] tabular-nums text-text-muted">
                        {bucket.x}% × {bucket.y}%
                      </span>
                    </span>
                    <span className="ov-list-value">{formatCompact(bVal)}</span>
                    <div className="ov-list-bar-bg">
                      <div className="ov-list-bar-fill" style={{ width: `${Math.max(4, share)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-text-muted">
              No zones for this mode yet.
            </p>
          )}
        </Section>

        {/* Selectors */}
        <Section title="Element Selectors" subtitle={clickMode ? undefined : "Available in click-based modes"}>
          {clickMode && hData.selectors.length > 0 ? (
            <div className="ov-list">
              <div className="ov-list-header">
                <span>Selector</span>
                <span>Clicks</span>
              </div>
              {hData.selectors.slice(0, 8).map((sel) => {
                const selMax = hData.selectors[0]?.clicks ?? 1;
                const share = (sel.clicks / selMax) * 100;
                return (
                  <div key={sel.selector} className="ov-list-row">
                    <span className="ov-list-label font-mono text-[11px]">
                      {sel.selector === "null" ? "Coordinate-only" : sel.selector}
                    </span>
                    <span className="ov-list-value">{formatCompact(sel.clicks)}</span>
                    <div className="ov-list-bar-bg">
                      <div className="ov-list-bar-fill" style={{ width: `${Math.max(4, share)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-text-muted">
              {clickMode ? "No selectors tracked yet." : "Switch to a click mode to see selectors."}
            </p>
          )}
        </Section>

        {/* Scroll Depth */}
        <Section title="Scroll Depth">
          {hData.scrollFunnel.length > 0 ? (
            <div className="ov-list">
              <div className="ov-list-header">
                <span>Depth</span>
                <span>Sessions</span>
              </div>
              {hData.scrollFunnel.map((depth) => {
                const share = scrollTop > 0 ? (depth.sessions / scrollTop) * 100 : 0;
                return (
                  <div key={depth.depth} className="ov-list-row">
                    <span className="ov-list-label">{depth.depth}% scroll</span>
                    <span className="ov-list-value">{formatCompact(depth.sessions)}</span>
                    <div className="ov-list-bar-bg">
                      <div
                        className="h-full rounded-full bg-accent-amber/40"
                        style={{ width: `${Math.max(4, share)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-text-muted">No scroll data yet.</p>
          )}
        </Section>

        {/* Path Roster */}
        <Section title="Tracked Pages">
          {hData.paths.length > 0 ? (
            <div className="space-y-1">
              {hData.paths.map((page) => {
                const active = page.path === hData.path;
                return (
                  <button
                    key={page.path}
                    type="button"
                    onClick={() => setSelectedPath(page.path)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors",
                      active
                        ? "bg-accent-teal/10"
                        : "hover:bg-surface-tertiary"
                    )}
                  >
                    <div className="min-w-0">
                      <p className={cn(
                        "truncate text-[13px] font-medium",
                        active ? "text-accent-teal" : "text-text-primary"
                      )}>
                        {page.path}
                      </p>
                      <p className="text-[11px] tabular-nums text-text-muted">{formatNumber(page.pageviews)} pageviews</p>
                    </div>
                    {active && <MapPinned className="size-4 shrink-0 text-accent-teal" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="py-4 text-center text-[13px] text-text-muted">No tracked paths yet.</p>
          )}
        </Section>
      </div>
    </div>
  );
}

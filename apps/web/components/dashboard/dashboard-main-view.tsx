"use client";

import { useQuery } from "@tanstack/react-query";
import { differenceInCalendarDays, endOfDay, startOfDay, subDays } from "date-fns";
import {
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Download,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { TimelineUPlot } from "@/components/charts/uplot-series";
import { TrackerInstallCard } from "@/components/dashboard/tracker-install-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardSettings, useDashboardSummary } from "@/hooks/use-dashboard";
import { dashboardKeys, fetchDashboardSummary } from "@/lib/dashboard/client";
import type { RangeKey, TimeseriesPoint } from "@/lib/dashboard/types";
import { cn, formatCompact, formatPercent } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ─── Types ──────────────────────────────────────────── */

type TrendWindow = "weekly" | "monthly" | "quarterly";
type TrendCell = {
  key: string;
  date: Date;
  pageviews: number;
  sessions: number;
  level: number;
  isToday: boolean;
};

/* ─── Helpers ────────────────────────────────────────── */

const shortDateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function rangePart(date: Date) {
  return date.toISOString().slice(0, 10);
}

function customRangeKey(from: Date, to: Date) {
  return `custom:${rangePart(from)}:${rangePart(to)}` as RangeKey;
}

function comparisonRangeFor(range: RangeKey) {
  if (range === "24h") {
    const d = subDays(new Date(), 1);
    return customRangeKey(startOfDay(d), endOfDay(d));
  }
  if (range === "30d") {
    return customRangeKey(startOfDay(subDays(new Date(), 59)), endOfDay(subDays(new Date(), 30)));
  }
  if (range === "90d") {
    return customRangeKey(startOfDay(subDays(new Date(), 179)), endOfDay(subDays(new Date(), 90)));
  }
  if (range.startsWith("custom:")) {
    const [, fromRaw, toRaw] = range.split(":", 3);
    const from = startOfDay(new Date(fromRaw));
    const to = endOfDay(new Date(toRaw));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return "7d";
    const span = Math.max(1, differenceInCalendarDays(to, from) + 1);
    const compareTo = endOfDay(subDays(from, 1));
    const compareFrom = startOfDay(subDays(compareTo, span - 1));
    return customRangeKey(compareFrom, compareTo);
  }
  return customRangeKey(startOfDay(subDays(new Date(), 13)), endOfDay(subDays(new Date(), 7)));
}

function deltaMeta(current: number, previous: number, options?: { inverse?: boolean }) {
  if (previous <= 0) return { delta: "—", up: true };
  const rawDelta = ((current - previous) / previous) * 100;
  const positive = options?.inverse ? rawDelta <= 0 : rawDelta >= 0;
  return {
    delta: `${rawDelta >= 0 ? "+" : ""}${rawDelta.toFixed(0)}%`,
    up: positive,
  };
}

function formatSessionDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${secs.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${mins.toString().padStart(2, "0")}m`;
}

function startOfUTCDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function shiftUTCDay(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return startOfUTCDay(next);
}

function weekdayIndexMondayFirst(date: Date) {
  return (date.getUTCDay() + 6) % 7;
}

/* ─── Sparkline SVG (hand-rolled polyline per SKILL.md) ── */

function Sparkline({ values, color, width = 80, height = 24 }: { values: number[]; color: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - 2 - ((v - min) / range) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── Contribution Grid Builder (always 90 days) ─────── */

function buildContribGrid(data: TimeseriesPoint[]) {
  const totalsByDay = new Map<string, { pageviews: number; sessions: number }>();

  for (const point of data) {
    const key = point.timestamp.slice(0, 10);
    const current = totalsByDay.get(key) ?? { pageviews: 0, sessions: 0 };
    current.pageviews += point.pageviews;
    current.sessions += point.sessions;
    totalsByDay.set(key, current);
  }

  const today = startOfUTCDay(new Date());
  const todayKey = rangePart(today);

  // Always build 90 days ending on today
  const start = shiftUTCDay(today, -89);

  let peak = 0;
  const cells = Array.from({ length: 90 }, (_, index) => {
    const date = shiftUTCDay(start, index);
    const key = rangePart(date);
    const totals = totalsByDay.get(key) ?? { pageviews: 0, sessions: 0 };
    peak = Math.max(peak, totals.pageviews);
    return { key, date, pageviews: totals.pageviews, sessions: totals.sessions, level: 0, isToday: key === todayKey } satisfies TrendCell;
  }).map((cell) => ({
    ...cell,
    level: peak <= 0 || cell.pageviews <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((cell.pageviews / peak) * 4))),
  }));

  return { cells, totalPageviews: cells.reduce((s, c) => s + c.pageviews, 0) };
}

/* ─── Animated count hook ────────────────────────────── */

function useAnimatedCount(target: number, duration = 850) {
  const [val, setVal] = useState(target);
  const prevRef = useRef(target);

  useEffect(() => {
    const from = prevRef.current;
    if (from === target) { setVal(target); return; }
    const t0 = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) frame = requestAnimationFrame(tick);
      else prevRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); prevRef.current = target; };
  }, [duration, target]);

  return val;
}

/* ─── Section wrapper ────────────────────────────────── */

function Section({
  title,
  extra,
  tabs,
  activeTab,
  onTabChange,
  children,
  noPad,
}: {
  title?: string;
  extra?: React.ReactNode;
  tabs?: string[];
  activeTab?: string;
  onTabChange?: (t: string) => void;
  children: React.ReactNode;
  noPad?: boolean;
}) {
  return (
    <div className="ov-section">
      {(title || tabs || extra) && (
        <div className="ov-section-header">
          <div className="flex items-center gap-3">
            {title && <h3 className="ov-section-title">{title}</h3>}
            {tabs && (
              <div className="flex gap-0.5">
                {tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => onTabChange?.(t)}
                    className={cn("ov-tab", activeTab === t && "ov-tab--active")}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          {extra}
        </div>
      )}
      <div className={noPad ? "" : "px-5 pb-5 pt-4"}>{children}</div>
    </div>
  );
}

/* ─── Ranked item (pill badge design – zero lines/bars) ── */

function RankedItem({ rank, label, value, pct, accent }: { rank: number; label: string; value: string; pct: number; accent: string }) {
  return (
    <div className="ov-rank-item">
      <span className="ov-rank-pos" style={{ color: rank === 1 ? accent : undefined }}>{rank}</span>
      <span className="ov-rank-label">{label}</span>
      <span className="ov-rank-badge" style={{ background: `color-mix(in srgb, ${accent} ${Math.max(8, Math.round(pct * 0.6))}%, transparent)`, color: accent }}>
        {value}
      </span>
    </div>
  );
}

/* ─── Inline empty state ─────────────────────────────── */

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex h-[120px] items-center justify-center text-center">
      <div>
        <p className="text-[13px] font-medium text-muted-foreground/80">{title}</p>
        <p className="mt-1 text-[11px] text-muted-foreground/60">{sub}</p>
      </div>
    </div>
  );
}

/* ─── Loading skeleton ───────────────────────────────── */

function OverviewSkeleton() {
  return (
    <div className="ov-root">
      <Skeleton className="h-[380px] rounded-xl" />
      <Skeleton className="h-[120px] rounded-xl" />
      <div className="ov-grid-2">
        <Skeleton className="h-[280px] rounded-xl" />
        <Skeleton className="h-[280px] rounded-xl" />
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Main Dashboard Component
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function DashboardOverview() {
  const summaryQuery = useDashboardSummary();
  const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
  const selectedRange = useDashboardStore((s) => s.selectedRange);
  const [compareMode, setCompareMode] = useState(false);
  const [trendWindow, setTrendWindow] = useState<TrendWindow>("weekly");

  // Tabs
  const [referrerTab, setReferrerTab] = useState("Referrers");
  const [pagesTab, setPagesTab] = useState("Pages");
  const [techTab, setTechTab] = useState("Browsers");
  const [geoTab, setGeoTab] = useState("Countries");

  const summaryData = summaryQuery.data;
  const hasData = Boolean(
    summaryData &&
    (summaryData.overview.pageviews > 0 ||
      summaryData.overview.sessions > 0 ||
      summaryData.overview.realtimeVisitors > 0 ||
      summaryData.topPages.length > 0 ||
      summaryData.timeseries.length > 0),
  );

  const settingsQuery = useDashboardSettings(Boolean(summaryData) && !hasData);
  const comparisonRange = comparisonRangeFor(selectedRange);
  const comparisonQuery = useQuery({
    queryKey: dashboardKeys.summary(selectedSiteId, comparisonRange),
    queryFn: () => fetchDashboardSummary(selectedSiteId, comparisonRange),
    enabled: compareMode && Boolean(selectedSiteId),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const contribRange: RangeKey = "90d";
  const contribSummaryQuery = useQuery({
    queryKey: dashboardKeys.summary(selectedSiteId, contribRange),
    queryFn: () => fetchDashboardSummary(selectedSiteId, contribRange),
    enabled: Boolean(selectedSiteId) && contribRange !== selectedRange,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  /* ─── Error / Loading / Empty ──────────────────── */

  if (summaryQuery.error) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Summary unavailable</CardTitle>
        <CardDescription>{summaryQuery.error.message}</CardDescription>
      </Card>
    );
  }

  if (summaryQuery.isLoading && !summaryQuery.data) return <OverviewSkeleton />;

  if (!summaryData) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Summary unavailable</CardTitle>
        <CardDescription>The overview payload did not include any data.</CardDescription>
      </Card>
    );
  }

  const {
    overview,
    topPages,
    referrers,
    devices,
    browsers = [],
    operatingSystems = [],
    scrollFunnel = [],
    timeseries,
  } = summaryData;
  const comparisonOverview = comparisonQuery.data?.overview;

  /* ─── First install state ──────────────────────── */

  if (!hasData) {
    const site = settingsQuery.data?.site;
    const installOrigin = settingsQuery.data?.trackerScript.installOrigin ?? site?.origins[0] ?? "";
    const installTarget = installOrigin
      ? (() => {
          try { return new URL(installOrigin).host.replace(/^www\./i, ""); } catch { return installOrigin; }
        })()
      : site?.name || "your site";

    return (
      <div className="ov-root">
        <div className="ov-section" style={{ background: "linear-gradient(135deg, rgba(239,122,41,0.06), transparent 60%)" }}>
          <div className="p-5">
            <Badge variant="warning" className="text-[10px]">First install</Badge>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">Waiting for first events</h2>
            <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">
              {installTarget} is registered but still quiet. Paste the tracker below, open the site once, and
              this surface disappears automatically as soon as the first traffic arrives.
            </p>
          </div>
        </div>
        {settingsQuery.isLoading && !settingsQuery.data ? <Skeleton className="h-[320px] rounded-xl" /> : null}
        {settingsQuery.data ? (
          <TrackerInstallCard
            trackerSnippet={settingsQuery.data.trackerSnippet}
            trackerScript={settingsQuery.data.trackerScript}
            title="Install tracker on this site"
            description="Shown only while the dashboard is empty."
            badgeLabel="Live snippet"
            compact
            steps={[]}
          />
        ) : null}
        {settingsQuery.error ? (
          <div className="ov-section p-5">
            <p className="text-sm font-medium">Tracker snippet unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">{settingsQuery.error.message}</p>
          </div>
        ) : null}
      </div>
    );
  }

  /* ─── Derived data ─────────────────────────────── */

  const dm = (cur: number, prev: number | undefined, inv?: boolean) =>
    compareMode && prev != null ? deltaMeta(cur, prev, { inverse: inv }) : null;

  const pagesPerSession = overview.sessions > 0 ? overview.pageviews / overview.sessions : 0;
  const sessionDuration = overview.sessions > 0 ? (overview.pageviews / overview.sessions) * 45 : 0;

  // Build sparkline data from timeseries
  const pvSparkline = timeseries.map((p) => p.pageviews);
  const sessSparkline = timeseries.map((p) => p.sessions);

  const kpis = [
    {
      label: "Unique Visitors",
      value: formatCompact(overview.uniqueVisitors),
      sparkline: pvSparkline,
      sparkColor: "#0D9488",
      ...(dm(overview.uniqueVisitors, comparisonOverview?.uniqueVisitors) ?? { delta: "", up: true }),
    },
    {
      label: "Sessions",
      value: formatCompact(overview.sessions),
      sparkline: sessSparkline,
      sparkColor: "#0D9488",
      ...(dm(overview.sessions, comparisonOverview?.sessions) ?? { delta: "", up: true }),
    },
    {
      label: "Pageviews",
      value: formatCompact(overview.pageviews),
      sparkline: pvSparkline,
      sparkColor: "#0D9488",
      ...(dm(overview.pageviews, comparisonOverview?.pageviews) ?? { delta: "", up: true }),
    },
    {
      label: "Pages / Session",
      value: pagesPerSession.toFixed(1),
      sparkline: [],
      sparkColor: "#0D9488",
      ...(dm(
        pagesPerSession,
        comparisonOverview && comparisonOverview.sessions > 0 ? comparisonOverview.pageviews / comparisonOverview.sessions : undefined,
      ) ?? { delta: "", up: true }),
    },
    {
      label: "Bounce Rate",
      value: formatPercent(overview.bounceRate),
      sparkline: [],
      sparkColor: "#DC2626",
      ...(dm(overview.bounceRate, comparisonOverview?.bounceRate, true) ?? { delta: "", up: true }),
    },
    {
      label: "Avg. Duration",
      value: formatSessionDuration(sessionDuration),
      sparkline: [],
      sparkColor: "#0D9488",
      delta: "",
      up: true,
    },
  ];

  // Tech breakdown
  const browserItems = browsers.map((b) => ({ label: b.browser || "Unknown", value: b.pageviews }));
  const deviceItems = devices.map((d) => ({ label: d.device || "Unknown", value: d.pageviews }));
  const osItems = operatingSystems.map((o) => ({ label: o.os || "Unknown", value: o.pageviews }));
  const techMap: Record<string, { label: string; value: number }[]> = {
    Browsers: browserItems,
    Devices: deviceItems,
    "OS": osItems,
  };
  const activeTechItems = techMap[techTab] ?? browserItems;
  const techPeak = Math.max(...activeTechItems.map((i) => i.value), 1);

  // Pages
  const pageItems = topPages.slice(0, 8);
  const pagePeak = Math.max(...pageItems.map((p) => p.pageviews), 1);

  // Referrers
  const refPeak = Math.max(...referrers.map((r) => r.pageviews), 1);

  // Contribution grid (always 30 days)
  const contribSource = contribRange === selectedRange ? summaryData : contribSummaryQuery.data;
  const contribGrid = buildContribGrid(contribSource?.timeseries ?? []);
  const hasContribVolume = contribGrid.cells.some((c) => c.pageviews > 0);

  // Scroll depth
  const scrollPeak = Math.max(...scrollFunnel.map((s) => s.sessions), 1);
  const hasScrollData = scrollFunnel.some((d) => d.sessions > 0);

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     Render
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <div className="ov-root">
      {/* ─── Row 1: Hero chart (promoted to top) ─────── */}
      <Section
        title="Traffic"
        extra={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCompareMode((v) => !v)}
              className={cn("ov-action-btn", compareMode && "ov-action-btn--active")}
            >
              <ArrowLeftRight className="size-3.5" />
              Compare
            </button>
            <a
              href={`/api/dashboard/export/summary?site=${encodeURIComponent(selectedSiteId)}&range=${encodeURIComponent(selectedRange)}&format=csv`}
              className="ov-action-btn"
            >
              <Download className="size-3.5" />
              CSV
            </a>
          </div>
        }
      >
        {timeseries.length > 0 ? (
          <>
            <div className="mb-3 flex items-center gap-5">
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: "#0D9488" }} />
                <span className="text-[11px] font-medium" style={{ color: "#78716C" }}>Pageviews</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: "#F59E0B" }} />
                <span className="text-[11px] font-medium" style={{ color: "#78716C" }}>Sessions</span>
              </div>
            </div>
            <TimelineUPlot data={timeseries} height={380} />
          </>
        ) : (
          <Empty title="No timeline data yet" sub="Pageviews and sessions will appear here once visits arrive." />
        )}
      </Section>

      {/* ─── Row 2: KPI Strip (single row, unified border) ── */}
      <div className="ov-kpi-strip-v2">
        <div className="ov-kpi-strip-v2-inner">
          {kpis.map((kpi, i) => {
            const accentColors = ["#0D9488", "#0891B2", "#6366F1", "#8B5CF6", "#DC2626", "#F59E0B"];
            const accentColor = accentColors[i] ?? "#0D9488";
            return (
              <div
                key={kpi.label}
                className={cn("ov-kpi-cell-v2", i < kpis.length - 1 && "ov-kpi-cell-v2--bordered")}
              >
                <div className="ov-kpi-cell-v2-dot" style={{ backgroundColor: accentColor }} />
                <span className="ov-kpi-label">{kpi.label}</span>
                <div className="flex items-center gap-2">
                  <span className="ov-kpi-number">{kpi.value}</span>
                  {kpi.delta && (
                    <span className={cn(
                      "ov-kpi-badge",
                      kpi.up ? "ov-kpi-badge--positive" : "ov-kpi-badge--negative",
                    )}>
                      {kpi.up ? <ArrowUpRight className="inline size-3" /> : <ArrowDownRight className="inline size-3" />}
                      {kpi.delta}
                    </span>
                  )}
                </div>
                {kpi.sparkline.length >= 2 && (
                  <Sparkline values={kpi.sparkline} color={accentColor} width={80} height={20} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Rows 3-5: Premium section card grid (2×3) ── */}
      <div className="ov-card-grid">
        {/* ─── Card 1: Referrers ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(13,148,136,0.1)", color: "#0D9488" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </div>
              <div className="flex gap-0.5">
                {["Referrers", "Channels", "UTM"].map((t) => (
                  <button key={t} type="button" onClick={() => setReferrerTab(t)} className={cn("ov-tab", referrerTab === t && "ov-tab--active")}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="ov-card-premium-body">
            {referrerTab === "Referrers" && referrers.length > 0 ? (
              <div className="ov-rank-list">
                {referrers.slice(0, 5).map((r, i) => (
                  <RankedItem key={r.source} rank={i + 1} label={r.source || "Direct / None"} value={formatCompact(r.pageviews)} pct={(r.pageviews / refPeak) * 100} accent="#0D9488" />
                ))}
              </div>
            ) : (
              <Empty title="No referrer data" sub="Traffic sources appear once visits include referrers." />
            )}
          </div>
        </div>

        {/* ─── Card 2: Pages ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(99,102,241,0.1)", color: "#6366F1" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
              </div>
              <div className="flex gap-0.5">
                {["Pages", "Entry Pages", "Exit Pages"].map((t) => (
                  <button key={t} type="button" onClick={() => setPagesTab(t)} className={cn("ov-tab", pagesTab === t && "ov-tab--active")}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="ov-card-premium-body">
            {pageItems.length > 0 ? (
              <div className="ov-rank-list">
                {pageItems.slice(0, 5).map((p, i) => (
                  <RankedItem key={p.path} rank={i + 1} label={p.path} value={formatCompact(p.sessions)} pct={(p.pageviews / pagePeak) * 100} accent="#6366F1" />
                ))}
              </div>
            ) : (
              <Empty title="No page data yet" sub="Populates after the tracker records pageviews." />
            )}
          </div>
        </div>

        {/* ─── Card 3: Tech Breakdown ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(139,92,246,0.1)", color: "#8B5CF6" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
              </div>
              <div className="flex gap-0.5">
                {["Browsers", "Devices", "OS"].map((t) => (
                  <button key={t} type="button" onClick={() => setTechTab(t)} className={cn("ov-tab", techTab === t && "ov-tab--active")}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="ov-card-premium-body">
            {activeTechItems.length > 0 ? (
              <div className="ov-rank-list">
                {activeTechItems.slice(0, 5).map((item, i) => (
                  <RankedItem key={item.label} rank={i + 1} label={item.label} value={formatCompact(item.value)} pct={(item.value / techPeak) * 100} accent="#8B5CF6" />
                ))}
              </div>
            ) : (
              <Empty title={`No ${techTab.toLowerCase()} data`} sub="Tech breakdown appears after visits arrive." />
            )}
          </div>
        </div>

        {/* ─── Card 4: Geo ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(245,158,11,0.1)", color: "#F59E0B" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
              </div>
              <div className="flex gap-0.5">
                {["Countries", "Regions", "Cities"].map((t) => (
                  <button key={t} type="button" onClick={() => setGeoTab(t)} className={cn("ov-tab", geoTab === t && "ov-tab--active")}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="ov-card-premium-body">
            <Empty title="No geo data yet" sub="Country data appears once geo-resolved visits arrive." />
          </div>
        </div>

        {/* ─── Card 5: Activity (GitHub-style contribution grid) ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(239,122,41,0.1)", color: "#EF7A29" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              </div>
              <h3 className="ov-card-premium-title">Activity</h3>
            </div>
            <div className="flex rounded-md border border-border/60 p-0.5">
              {(["weekly", "monthly", "quarterly"] as TrendWindow[]).map((w) => (
                <button key={w} type="button" onClick={() => setTrendWindow(w)} className={cn("rounded px-2 py-0.5 text-[10px] font-medium transition-colors", trendWindow === w ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                  {w === "weekly" ? "7d" : w === "monthly" ? "30d" : "90d"}
                </button>
              ))}
            </div>
          </div>
          <div className="ov-card-premium-body">
            {contribRange !== selectedRange && contribSummaryQuery.isLoading ? (
              <Skeleton className="h-[100px] rounded-lg" />
            ) : hasContribVolume ? (
              (() => {
                const cells = contribGrid.cells;
                const highlightCount = trendWindow === "weekly" ? 7 : trendWindow === "monthly" ? 30 : 90;

                // GitHub-style: 7 rows (Mon–Sun) × N week-columns
                const paddedCells: (TrendCell | null)[] = [];
                // Fill first column with nulls for alignment
                const firstDayWd = weekdayIndexMondayFirst(cells[0].date);
                for (let i = 0; i < firstDayWd; i++) paddedCells.push(null);
                for (const c of cells) paddedCells.push(c);
                // Pad end so last col is complete
                const remaining = (7 - (paddedCells.length % 7)) % 7;
                for (let i = 0; i < remaining; i++) paddedCells.push(null);

                const weekCount = Math.ceil(paddedCells.length / 7);
                const fills = [
                  "var(--contrib-empty)",
                  "rgba(239, 122, 41, 0.22)",
                  "rgba(239, 122, 41, 0.42)",
                  "rgba(239, 122, 41, 0.65)",
                  "rgba(239, 122, 41, 0.9)",
                ];

                return (
                  <div className="ov-git-wrap">
                    <div className="ov-git-grid" style={{ gridTemplateColumns: `repeat(${weekCount}, 1fr)` }}>
                      {/* Render column-major: for each week → 7 day rows */}
                      {Array.from({ length: weekCount }, (_, wk) => (
                        <div key={wk} className="ov-git-col">
                          {Array.from({ length: 7 }, (__, day) => {
                            const idx = wk * 7 + day;
                            const cell = paddedCells[idx];
                            if (!cell) return <div key={day} className="ov-git-cell ov-git-cell--blank" />;
                            const origIdx = cells.indexOf(cell);
                            const isHighlighted = origIdx >= 0 && origIdx >= (90 - highlightCount);
                            return (
                              <div
                                key={cell.key}
                                className={cn("ov-git-cell", cell.isToday && "ov-git-cell--today", !isHighlighted && "ov-git-cell--dim")}
                                style={{ backgroundColor: fills[cell.level] }}
                                title={`${shortDateFmt.format(cell.date)} · ${formatCompact(cell.pageviews)} pvs`}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    <div className="ov-git-legend">
                      <span className="ov-git-legend-txt">Less</span>
                      {fills.map((c, i) => <div key={i} className="ov-git-legend-swatch" style={{ backgroundColor: c }} />)}
                      <span className="ov-git-legend-txt">More</span>
                    </div>
                  </div>
                );
              })()
            ) : (
              <Empty title="No activity data" sub="Squares appear once pageviews land." />
            )}
          </div>
        </div>

        {/* ─── Card 6: Scroll Depth (stepped blocks) ─── */}
        <div className="ov-card-premium">
          <div className="ov-card-premium-header">
            <div className="flex items-center gap-2">
              <div className="ov-card-premium-icon" style={{ background: "rgba(8,145,178,0.1)", color: "#0891B2" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>
              </div>
              <h3 className="ov-card-premium-title">Scroll Depth</h3>
            </div>
          </div>
          <div className="ov-card-premium-body">
            {hasScrollData ? (
              <div className="ov-depth-stack">
                {scrollFunnel.slice(0, 5).map((d, i) => {
                  const pct = scrollPeak > 0 ? (d.sessions / scrollPeak) * 100 : 0;
                  return (
                    <div key={d.depth} className="ov-depth-row">
                      <div className="ov-depth-block" style={{ width: `${Math.max(18, pct)}%`, opacity: 1 - i * 0.12, background: `linear-gradient(135deg, rgba(8,145,178,${0.9 - i * 0.15}), rgba(8,145,178,${0.5 - i * 0.08}))` }}>
                        <span className="ov-depth-pct">{d.depth}%</span>
                      </div>
                      <span className="ov-depth-val">{formatCompact(d.sessions)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty title="No scroll data yet" sub="Scroll depth appears as sessions are recorded." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

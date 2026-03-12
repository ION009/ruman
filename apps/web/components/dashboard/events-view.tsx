"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Eye,
  Globe,
  Laptop,
  Lock,
  Minus,
  Radio,
  ScanSearch,
  Search,
  Shield,
  Zap,
} from "lucide-react";
import { useCallback, useDeferredValue, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDashboardEventExplorer,
  useDashboardGoalReport,
  useDashboardReplaySessions,
  useDashboardSummary,
} from "@/hooks/use-dashboard";
import type {
  EventBreakdownItem,
  EventCatalogEntry,
  EventFeedItem,
  EventTrendPoint,
} from "@/lib/dashboard/types";
import { cn, formatCompact, formatNumber, formatPercent, timeAgo } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FAMILY_META: Record<string, { label: string; color: string }> = {
  custom: { label: "Custom", color: "#0D9488" },
  navigation: { label: "Navigation", color: "#F59E0B" },
  behavior: { label: "Behavior", color: "#6366F1" },
  performance: { label: "Performance", color: "#EC4899" },
};

const FAMILY_KEYS = ["custom", "navigation", "behavior", "performance"] as const;

type FamilyKey = (typeof FAMILY_KEYS)[number];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function deltaIcon(delta: number) {
  if (delta > 0) return <ArrowUpRight className="size-3" />;
  if (delta < 0) return <ArrowDownRight className="size-3" />;
  return <Minus className="size-3" />;
}

function deltaPill(delta: number) {
  const abs = Math.abs(delta);
  const label = `${abs.toFixed(1)}%`;
  if (delta > 0)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-status-success-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-status-success">
        {deltaIcon(delta)} {label}
      </span>
    );
  if (delta < 0)
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-status-error-bg px-2 py-0.5 text-[11px] font-medium tabular-nums text-status-error">
        {deltaIcon(delta)} {label}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium tabular-nums text-text-secondary">
      {deltaIcon(delta)} 0%
    </span>
  );
}

function miniSparkline(data: number[], color: string) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const points = data
    .map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
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

function formatAxisTime(ts: string) {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatAxisDate(ts: string) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------------ */
/*  Custom Tooltip                                                     */
/* ------------------------------------------------------------------ */

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md bg-foreground px-3 py-2 shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
      <p className="mb-1.5 text-[11px] text-text-muted">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center gap-2 text-[12px]">
          <span
            className="inline-block size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-muted">{entry.name}</span>
          <span className="ml-auto font-medium tabular-nums text-surface-hover">
            {formatCompact(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section wrapper (replaces Card pattern)                            */
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
      <div className="ov-section-header mb-3">
        <div>
          <h3 className="ov-section-title">{title}</h3>
          {subtitle && (
            <p className="mt-0.5 text-[12px] text-text-secondary">{subtitle}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hero Event Trend Graph                                             */
/* ------------------------------------------------------------------ */

function HeroEventChart({
  timeline,
  activeFamily,
}: {
  timeline: EventTrendPoint[];
  activeFamily: FamilyKey | "all";
}) {
  const families =
    activeFamily === "all" ? FAMILY_KEYS : [activeFamily];

  return (
    <Section
      title="Event Volume"
      subtitle="Total events across all families over time"
    >
      <div className="h-[380px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid
              horizontal
              vertical={false}
              stroke="#F0EDE8"
              strokeDasharray=""
            />
            <XAxis
              dataKey="timestamp"
              tickFormatter={timeline.length > 48 ? formatAxisDate : formatAxisTime}
              tick={{ fontSize: 11, fill: "#A8A29E", fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              tickCount={6}
              minTickGap={50}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#A8A29E", fontWeight: 500 }}
              axisLine={false}
              tickLine={false}
              tickCount={5}
              tickFormatter={(v: number) => formatCompact(v)}
              width={48}
            />
            <RechartsTooltip content={<ChartTooltip />} />
            {families.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={FAMILY_META[key].label}
                stroke={FAMILY_META[key].color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 4, fill: "#fff", stroke: FAMILY_META[key].color, strokeWidth: 2 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend pills */}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3 px-4">
        {families.map((key) => (
          <div key={key} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: FAMILY_META[key].color }}
            />
            {FAMILY_META[key].label}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Strip                                                          */
/* ------------------------------------------------------------------ */

function KPIStrip({
  highlights,
  sparkData,
}: {
  highlights: { label: string; value: number; delta: number; family: string }[];
  sparkData: Record<string, number[]>;
}) {
  return (
    <div className="ov-kpi-strip">
      {highlights.map((h) => {
        const color = FAMILY_META[h.family]?.color ?? "#0D9488";
        return (
          <div key={h.label} className="ov-kpi-cell">
            <p className="ov-kpi-label">{h.label}</p>
            <div className="mt-1.5 flex items-end justify-between gap-2">
              <div>
                <p className="ov-kpi-number">{formatCompact(h.value)}</p>
                <div className="mt-1">{deltaPill(h.delta)}</div>
              </div>
              {miniSparkline(sparkData[h.family] ?? [], color)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Support Cards (2 compact cards below graph)                  */
/* ------------------------------------------------------------------ */

function EventSupportCards({
  comparison,
  catalog,
}: {
  comparison: {
    customCurrent: number;
    customPrevious: number;
    navigationCurrent: number;
    navigationPrevious: number;
    behaviorCurrent: number;
    behaviorPrevious: number;
    performanceCurrent: number;
    performancePrevious: number;
  };
  catalog: EventCatalogEntry[];
}) {
  const familyBreakdown = FAMILY_KEYS.map((key) => {
    const current = comparison[`${key}Current` as keyof typeof comparison] as number;
    const previous = comparison[`${key}Previous` as keyof typeof comparison] as number;
    const delta = previous > 0 ? ((current - previous) / previous) * 100 : 0;
    return { key, label: FAMILY_META[key].label, current, delta, color: FAMILY_META[key].color };
  });

  const topTotal = familyBreakdown.reduce((s, f) => s + f.current, 0);

  const topEvents = [...catalog]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  const topEvMax = topEvents[0]?.count ?? 1;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Card 1: Family Breakdown */}
      <Section title="Event Families" subtitle="Volume distribution by event family">
        <div className="space-y-3">
          {familyBreakdown.map((f) => {
            const share = topTotal > 0 ? (f.current / topTotal) * 100 : 0;
            return (
              <div key={f.key}>
                <div className="flex items-center justify-between text-[13px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{ backgroundColor: f.color }}
                    />
                    <span className="font-medium text-text-primary">{f.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-text-primary">
                      {formatCompact(f.current)}
                    </span>
                    {deltaPill(f.delta)}
                  </div>
                </div>
                <div className="ov-list-bar-bg mt-1.5">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, share)}%`,
                      backgroundColor: f.color,
                      opacity: 0.6,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Card 2: Top Events */}
      <Section title="Top Events" subtitle="Highest volume events in the selected range">
        {topEvents.length ? (
          <div className="ov-list">
            <div className="ov-list-header">
              <span>Event</span>
              <span>Count</span>
            </div>
            {topEvents.map((ev) => {
              const share = (ev.count / topEvMax) * 100;
              const color = FAMILY_META[ev.family]?.color ?? "#0D9488";
              return (
                <div key={ev.name} className="ov-list-row">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className="inline-block size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="ov-list-label">{ev.name}</span>
                  </div>
                  <span className="ov-list-value">{formatCompact(ev.count)}</span>
                  <div className="ov-list-bar-bg">
                    <div
                      className="ov-list-bar-fill"
                      style={{ width: `${Math.max(4, share)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-text-muted">No events recorded yet.</p>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Live Activity Cards (2 compact cards)                              */
/* ------------------------------------------------------------------ */

function LivePulse() {
  return (
    <span className="relative flex size-2.5">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-status-success opacity-60" />
      <span className="relative inline-flex size-2.5 rounded-full bg-status-success" />
    </span>
  );
}

function LiveActivityCards({
  realtimeVisitors,
  activePages,
  liveSessions,
  liveGoalConversions,
  issueHeavySessions,
  liveFeed,
}: {
  realtimeVisitors: number;
  activePages: { path: string; pageviews: number; sessions: number }[];
  liveSessions: number;
  liveGoalConversions: number;
  issueHeavySessions: number;
  liveFeed: EventFeedItem[];
}) {
  const feedSparkData = useMemo(() => {
    if (!liveFeed.length) return [];
    const buckets: number[] = Array(12).fill(0);
    const now = Date.now();
    liveFeed.forEach((item) => {
      const age = now - new Date(item.timestamp).getTime();
      const bucket = Math.min(11, Math.floor(age / 5000));
      buckets[11 - bucket]++;
    });
    return buckets;
  }, [liveFeed]);

  const topPageTraffic = activePages[0]?.pageviews ?? 0;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Card 1: Live Pulse */}
      <Section
        title="Live Activity"
        action={<LivePulse />}
      >
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="ov-kpi-label">Visitors now</p>
            <p className="mt-1 ov-kpi-number">{formatNumber(realtimeVisitors)}</p>
          </div>
          <div>
            <p className="ov-kpi-label">Live sessions</p>
            <p className="mt-1 ov-kpi-number">{formatCompact(liveSessions)}</p>
          </div>
          <div>
            <p className="ov-kpi-label">Issues</p>
            <p className={cn(
              "mt-1 text-[22px] font-semibold tabular-nums tracking-[-0.02em]",
              issueHeavySessions > 0 ? "text-status-error" : "text-text-primary"
            )}>
              {formatCompact(issueHeavySessions)}
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1">
            {miniSparkline(feedSparkData, "#0D9488")}
          </div>
          <p className="text-[11px] text-text-muted">
            {formatCompact(liveGoalConversions)} conversions
          </p>
        </div>
      </Section>

      {/* Card 2: Active Pages (live) */}
      <Section
        title="Active Pages"
        action={
          <span className="text-[11px] tabular-nums text-text-secondary">
            {formatCompact(activePages.reduce((s, p) => s + p.pageviews, 0))} views
          </span>
        }
      >
        {activePages.length ? (
          <div className="ov-list">
            {activePages.slice(0, 5).map((page) => {
              const share = topPageTraffic > 0 ? (page.pageviews / topPageTraffic) * 100 : 0;
              return (
                <div key={page.path} className="ov-list-row">
                  <span className="ov-list-label">{page.path}</span>
                  <span className="ov-list-value">{formatCompact(page.pageviews)}</span>
                  <div className="ov-list-bar-bg">
                    <div
                      className="ov-list-bar-fill"
                      style={{ width: `${Math.max(4, share)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-[13px] text-text-muted">
            No active pages right now.
          </p>
        )}
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page-wise Event Filtering                                          */
/* ------------------------------------------------------------------ */

function PageEventFilter({
  catalog,
  selectedPage,
  onSelectPage,
}: {
  catalog: EventCatalogEntry[];
  selectedPage: string | null;
  onSelectPage: (page: string | null) => void;
}) {
  const pages = useMemo(() => {
    const pageMap = new Map<string, number>();
    catalog.forEach((entry) => {
      entry.topPages.forEach((p) => {
        pageMap.set(p.label, (pageMap.get(p.label) ?? 0) + p.count);
      });
    });
    return [...pageMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
  }, [catalog]);

  if (!pages.length) return null;

  const topCount = pages[0]?.[1] ?? 1;

  return (
    <Section
      title="Events by Page"
      subtitle="Click a page to filter events below"
      action={
        selectedPage ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 rounded-lg px-2 text-[11px]"
            onClick={() => onSelectPage(null)}
          >
            Clear filter
          </Button>
        ) : undefined
      }
    >
      <ScrollArea className="max-h-[280px]">
        <div className="space-y-1">
          {pages.map(([path, count]) => {
            const share = (count / topCount) * 100;
            const active = selectedPage === path;
            return (
              <button
                key={path}
                onClick={() => onSelectPage(active ? null : path)}
                className={cn(
                  "w-full rounded-lg px-3 py-2 text-left transition-colors",
                  active
                    ? "bg-accent-teal/10"
                    : "hover:bg-surface-tertiary"
                )}
              >
                <div className="flex items-center justify-between text-[13px]">
                  <span className={cn(
                    "min-w-0 truncate",
                    active ? "font-semibold text-accent-teal" : "font-medium text-text-primary"
                  )}>
                    {path}
                  </span>
                  <span className="shrink-0 tabular-nums text-text-secondary">
                    {formatCompact(count)}
                  </span>
                </div>
                <div className="ov-list-bar-bg mt-1">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      active ? "bg-accent-teal/60" : "bg-status-info-tint"
                    )}
                    style={{ width: `${Math.max(4, share)}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Catalog Table                                                */
/* ------------------------------------------------------------------ */

function EventCatalog({
  catalog,
  selectedPage,
  searchQuery,
  familyFilter,
  onSelectEvent,
}: {
  catalog: EventCatalogEntry[];
  selectedPage: string | null;
  searchQuery: string;
  familyFilter: FamilyKey | "all";
  onSelectEvent: (entry: EventCatalogEntry) => void;
}) {
  const filtered = useMemo(() => {
    let list = catalog;
    if (familyFilter !== "all") {
      list = list.filter((e) => e.family === familyFilter);
    }
    if (selectedPage) {
      list = list.filter((e) =>
        e.topPages.some((p) => p.label === selectedPage)
      );
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }
    return list.sort((a, b) => b.count - a.count);
  }, [catalog, familyFilter, selectedPage, searchQuery]);

  if (!filtered.length) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ScanSearch className="size-8 text-text-muted" />
        <p className="mt-3 text-[14px] font-medium text-text-secondary">
          No events match the current filters
        </p>
        <p className="mt-1 text-[12px] text-text-muted">
          Try adjusting the search, family filter, or page selection.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {filtered.map((entry) => {
        const color = FAMILY_META[entry.family]?.color ?? "#0D9488";
        const trend = entry.previousCount > 0
          ? ((entry.count - entry.previousCount) / entry.previousCount) * 100
          : 0;
        return (
          <button
            key={entry.name}
            onClick={() => onSelectEvent(entry)}
            className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-surface-tertiary"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className="inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="truncate text-[13px] font-medium text-text-primary">
                  {entry.name}
                </span>
                <span className="shrink-0 rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {FAMILY_META[entry.family]?.label ?? entry.family}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="tabular-nums text-[13px] font-semibold text-text-primary">
                  {formatCompact(entry.count)}
                </span>
                {deltaPill(trend)}
                <ChevronRight className="size-3.5 text-text-muted" />
              </div>
            </div>
            <div className="mt-1 flex items-center gap-3 text-[11px] text-text-muted">
              <span>{formatCompact(entry.uniqueSessions)} sessions</span>
              <span>{formatCompact(entry.uniqueVisitors)} visitors</span>
              <span>Last: {timeAgo(entry.lastSeen)}</span>
              {entry.confidenceScore < 0.95 && (
                <span className="text-accent-amber">
                  {formatPercent(entry.confidenceScore * 100, 1)} confidence
                </span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Detail Drawer                                                */
/* ------------------------------------------------------------------ */

function BreakdownSection({
  title,
  items,
  icon: Icon,
}: {
  title: string;
  items: EventBreakdownItem[];
  icon: React.ComponentType<{ className?: string }>;
}) {
  if (!items.length) return null;
  const max = items[0]?.count ?? 1;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="size-3.5 text-text-secondary" />
        <p className="text-[12px] font-semibold text-text-secondary uppercase tracking-wider">
          {title}
        </p>
      </div>
      <div className="ov-list">
        {items.slice(0, 8).map((item) => {
          const share = (item.count / max) * 100;
          return (
            <div key={item.label} className="ov-list-row">
              <span className="ov-list-label">{item.label}</span>
              <span className="ov-list-value">{formatCompact(item.count)}</span>
              <div className="ov-list-bar-bg">
                <div
                  className="ov-list-bar-fill"
                  style={{ width: `${Math.max(4, share)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventDrawer({
  entry,
  onClose,
}: {
  entry: EventCatalogEntry | null;
  onClose: () => void;
}) {
  if (!entry) return null;
  const color = FAMILY_META[entry.family]?.color ?? "#0D9488";
  const trend = entry.previousCount > 0
    ? ((entry.count - entry.previousCount) / entry.previousCount) * 100
    : 0;

  return (
    <Sheet open={!!entry} onOpenChange={() => onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <span
              className="inline-block size-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <SheetTitle className="text-lg">{entry.name}</SheetTitle>
          </div>
          <SheetDescription>
            {FAMILY_META[entry.family]?.label ?? entry.family} event &middot; Last seen {timeAgo(entry.lastSeen)}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Key metrics */}
          <div className="ov-kpi-strip">
            <div className="ov-kpi-cell">
              <p className="ov-kpi-label">Volume</p>
              <p className="mt-1 ov-kpi-number text-xl">{formatCompact(entry.count)}</p>
              <div className="mt-1">{deltaPill(trend)}</div>
            </div>
            <div className="ov-kpi-cell">
              <p className="ov-kpi-label">Confidence</p>
              <p className="mt-1 ov-kpi-number text-xl">{formatPercent(entry.confidenceScore * 100, 1)}</p>
              <p className="mt-1 text-[11px] text-text-muted">{entry.privacyNote}</p>
            </div>
            <div className="ov-kpi-cell">
              <p className="ov-kpi-label">Sessions</p>
              <p className="mt-1 ov-kpi-number text-xl">{formatCompact(entry.uniqueSessions)}</p>
            </div>
            <div className="ov-kpi-cell">
              <p className="ov-kpi-label">Visitors</p>
              <p className="mt-1 ov-kpi-number text-xl">{formatCompact(entry.uniqueVisitors)}</p>
            </div>
          </div>

          {/* Breakdowns */}
          <BreakdownSection title="Top Pages" items={entry.topPages} icon={Globe} />
          <BreakdownSection title="Top Devices" items={entry.topDevices} icon={Laptop} />
          <BreakdownSection title="Top Countries" items={entry.topCountries} icon={Globe} />

          {/* Properties */}
          {entry.properties.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
                Properties
              </p>
              <div className="space-y-3">
                {entry.properties.map((prop) => (
                  <div key={prop.key}>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="font-medium text-text-primary">{prop.key}</span>
                      {prop.masked && (
                        <span className="flex items-center gap-1 text-[10px] text-text-muted">
                          <Lock className="size-3" /> Masked
                        </span>
                      )}
                    </div>
                    {!prop.masked && prop.values.slice(0, 4).map((val) => (
                      <div key={val.label} className="mt-1 flex items-center justify-between text-[12px] text-text-secondary">
                        <span className="truncate">{val.label}</span>
                        <span className="tabular-nums">{formatCompact(val.count)}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sample sessions */}
          {entry.sampleSessions.length > 0 && (
            <div>
              <p className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
                Sample Sessions
              </p>
              <div className="flex flex-wrap gap-2">
                {entry.sampleSessions.slice(0, 3).map((sid) => (
                  <span key={sid} className="rounded-md bg-surface-secondary px-2 py-1 text-[11px] tabular-nums text-text-secondary">
                    {sid.slice(0, 8)}...
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Trust & Privacy Summary                                            */
/* ------------------------------------------------------------------ */

function TrustSummary({
  summary,
}: {
  summary: {
    acceptedEvents: number;
    filteredEvents: number;
    withheldRows: number;
    maskedProperties: number;
    duplicateRate: number;
    privacyOptOutRate?: number | null;
    privacyOptOutLabel: string;
    confidenceScore: number;
  };
}) {
  const metrics = [
    {
      label: "Accepted",
      value: formatCompact(summary.acceptedEvents),
      icon: Eye,
      detail: "Events passing all filters",
    },
    {
      label: "Filtered",
      value: formatCompact(summary.filteredEvents),
      icon: ScanSearch,
      detail: "Removed by dedup & rules",
    },
    {
      label: "Duplicate Rate",
      value: formatPercent(summary.duplicateRate * 100, 2),
      icon: Zap,
      detail: "Deduplication effectiveness",
    },
    {
      label: "Confidence",
      value: formatPercent(summary.confidenceScore * 100, 1),
      icon: Shield,
      detail: "Overall data trust score",
    },
  ];

  return (
    <Section
      title="Trust & Privacy"
      subtitle="Event accuracy, deduplication, and privacy compliance"
      action={<Shield className="size-4 text-accent-teal" />}
    >
      <div className="ov-kpi-strip">
        {metrics.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.label} className="ov-kpi-cell">
              <div className="flex items-center gap-1.5">
                <Icon className="size-3.5 text-text-muted" />
                <p className="ov-kpi-label">{m.label}</p>
              </div>
              <p className="mt-1.5 text-lg font-semibold tabular-nums text-text-primary">
                {m.value}
              </p>
              <p className="mt-0.5 text-[10px] text-text-muted">{m.detail}</p>
            </div>
          );
        })}
      </div>
      {summary.privacyOptOutRate != null && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-surface-tertiary px-3 py-2 text-[12px]">
          <Lock className="size-3.5 text-text-secondary" />
          <span className="text-text-secondary">
            {summary.privacyOptOutLabel}: {formatPercent(summary.privacyOptOutRate * 100, 2)} opt-out rate
            &middot; {formatCompact(summary.withheldRows)} withheld &middot; {formatCompact(summary.maskedProperties)} masked properties
          </span>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/*  Live Feed                                                          */
/* ------------------------------------------------------------------ */

function LiveFeed({ feed }: { feed: EventFeedItem[] }) {
  if (!feed.length) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <Radio className="size-6 text-text-muted" />
        <p className="mt-2 text-[13px] text-text-secondary">
          No live events flowing yet
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-[400px]">
      <div className="space-y-1">
        {feed.slice(0, 30).map((item, i) => {
          const color = FAMILY_META[item.family]?.color ?? "#0D9488";
          return (
            <div
              key={`${item.timestamp}-${item.name}-${i}`}
              className="flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-surface-tertiary"
            >
              <span
                className="mt-1.5 inline-block size-2 shrink-0 rounded-full"
                style={{ backgroundColor: color }}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium text-text-primary">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-text-muted">
                    {timeAgo(item.timestamp)}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-text-muted">
                  {item.path} &middot; {item.device} &middot; {item.country}
                  {item.propertySummary ? ` · ${item.propertySummary}` : ""}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

/* ------------------------------------------------------------------ */
/*  Main EventsView                                                    */
/* ------------------------------------------------------------------ */

export function EventsView() {
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [familyFilter, setFamilyFilter] = useState<FamilyKey | "all">("all");
  const [selectedPage, setSelectedPage] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<EventCatalogEntry | null>(null);
  const [activeTab, setActiveTab] = useState<"catalog" | "feed">("catalog");

  // Data hooks
  const explorerQuery = useDashboardEventExplorer();
  const summaryQuery = useDashboardSummary();
  const replaySessionsQuery = useDashboardReplaySessions();
  const goalReportQuery = useDashboardGoalReport();

  // Loading state
  if (
    explorerQuery.isLoading &&
    !explorerQuery.data
  ) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-[100px] rounded-xl" />
        <Skeleton className="h-[380px] rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-[240px] rounded-xl" />
          <Skeleton className="h-[240px] rounded-xl" />
        </div>
      </div>
    );
  }

  // Error state
  if (explorerQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-status-error">Events unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{explorerQuery.error.message}</p>
      </div>
    );
  }

  if (!explorerQuery.data) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-text-primary">No event data</h3>
        <p className="mt-1 text-[13px] text-text-secondary">The event explorer payload did not include any data.</p>
      </div>
    );
  }

  const { summary, trends, catalog, liveFeed } = explorerQuery.data;

  // Sparkline data per family from timeline
  const sparkData: Record<string, number[]> = {};
  FAMILY_KEYS.forEach((key) => {
    sparkData[key] = trends.timeline.map((pt) => pt[key]);
  });

  // Live activity data from summary query
  const realtimeVisitors = summaryQuery.data?.overview.realtimeVisitors ?? 0;
  const activePages = summaryQuery.data?.topPages.slice(0, 6) ?? [];
  const liveSessions = replaySessionsQuery.data?.sessions?.length ?? 0;
  const goalRows = goalReportQuery.data?.goals ?? [];
  const liveGoalConversions = goalRows.reduce((s, g) => s + g.conversions, 0);
  const issueHeavySessions = (replaySessionsQuery.data?.sessions ?? []).filter(
    (s: any) => s.errorCount > 0 || s.rageClickCount > 0
  ).length;

  return (
    <div className="space-y-5">
      {/* ---- KPI Strip ---- */}
      <KPIStrip
        highlights={trends.highlights.length >= 4 ? trends.highlights : [
          { label: "Custom Events", value: trends.comparison.customCurrent, delta: trends.comparison.customPrevious > 0 ? ((trends.comparison.customCurrent - trends.comparison.customPrevious) / trends.comparison.customPrevious) * 100 : 0, family: "custom" },
          { label: "Navigation", value: trends.comparison.navigationCurrent, delta: trends.comparison.navigationPrevious > 0 ? ((trends.comparison.navigationCurrent - trends.comparison.navigationPrevious) / trends.comparison.navigationPrevious) * 100 : 0, family: "navigation" },
          { label: "Behavior", value: trends.comparison.behaviorCurrent, delta: trends.comparison.behaviorPrevious > 0 ? ((trends.comparison.behaviorCurrent - trends.comparison.behaviorPrevious) / trends.comparison.behaviorPrevious) * 100 : 0, family: "behavior" },
          { label: "Performance", value: trends.comparison.performanceCurrent, delta: trends.comparison.performancePrevious > 0 ? ((trends.comparison.performanceCurrent - trends.comparison.performancePrevious) / trends.comparison.performancePrevious) * 100 : 0, family: "performance" },
        ]}
        sparkData={sparkData}
      />

      {/* ---- Hero Event Chart ---- */}
      <HeroEventChart
        timeline={trends.timeline}
        activeFamily={familyFilter}
      />

      {/* ---- 2 Support Cards (Family Breakdown + Top Events) ---- */}
      <EventSupportCards
        comparison={trends.comparison}
        catalog={catalog}
      />

      {/* ---- Live Activity Section ---- */}
      <LiveActivityCards
        realtimeVisitors={realtimeVisitors}
        activePages={activePages}
        liveSessions={liveSessions}
        liveGoalConversions={liveGoalConversions}
        issueHeavySessions={issueHeavySessions}
        liveFeed={liveFeed}
      />

      {/* ---- Trust & Privacy ---- */}
      <TrustSummary summary={summary} />

      {/* ---- Page Filter + Event Catalog + Live Feed ---- */}
      <div className="grid gap-5 xl:grid-cols-[320px,minmax(0,1fr)]">
        {/* Left: Page Filter */}
        <PageEventFilter
          catalog={catalog}
          selectedPage={selectedPage}
          onSelectPage={setSelectedPage}
        />

        {/* Right: Catalog + Feed */}
        <Section
          title=""
          className="!p-0"
        >
          <div className="px-4 pt-4 sm:px-5 sm:pt-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {/* Tab pills */}
              <div className="flex items-center gap-1 rounded-lg bg-surface-secondary p-0.5">
                <button
                  onClick={() => setActiveTab("catalog")}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                    activeTab === "catalog"
                      ? "bg-surface-primary text-text-primary shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  Event Catalog
                </button>
                <button
                  onClick={() => setActiveTab("feed")}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                    activeTab === "feed"
                      ? "bg-surface-primary text-text-primary shadow-sm"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  <LivePulse />
                  Live Feed
                </button>
              </div>

              <div className="flex items-center gap-2">
                {/* Family filter pills */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setFamilyFilter("all")}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                      familyFilter === "all"
                        ? "bg-foreground text-white"
                        : "bg-surface-secondary text-text-secondary hover:bg-surface-hover"
                    )}
                  >
                    All
                  </button>
                  {FAMILY_KEYS.map((key) => (
                    <button
                      key={key}
                      onClick={() => setFamilyFilter(familyFilter === key ? "all" : key)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                        familyFilter === key
                          ? "text-white"
                          : "bg-surface-secondary text-text-secondary hover:bg-surface-hover"
                      )}
                      style={
                        familyFilter === key
                          ? { backgroundColor: FAMILY_META[key].color }
                          : undefined
                      }
                    >
                      {FAMILY_META[key].label}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
                  <Input
                    placeholder="Search events..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-8 w-[180px] rounded-lg border-border-default pl-8 text-[12px]"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
            {activeTab === "catalog" ? (
              <EventCatalog
                catalog={catalog}
                selectedPage={selectedPage}
                searchQuery={deferredSearch}
                familyFilter={familyFilter}
                onSelectEvent={setSelectedEvent}
              />
            ) : (
              <LiveFeed feed={liveFeed} />
            )}
          </div>
        </Section>
      </div>

      {/* ---- Event Drawer ---- */}
      <EventDrawer entry={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}

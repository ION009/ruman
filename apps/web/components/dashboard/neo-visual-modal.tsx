"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, X } from "lucide-react";

import type {
  NeoChatMessage,
  NeoVisualArtifact,
  NeoVisualFlowLink,
  NeoVisualFlowNode,
  NeoVisualFlowStage,
} from "@/lib/dashboard/types";
import { neoVisualThemeMeta } from "@/lib/dashboard/neo-visuals";
import { cn, formatCompact, formatNumber, formatPercent } from "@/lib/utils";

/* ─── animation keyframes injected once ─── */

const STYLE_ID = "neo-visual-animations";
if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes neoFadeSlideUp {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes neoPulse {
      0%, 100% { opacity: 1; }
      50%      { opacity: 0.5; }
    }
    @keyframes neoFlowDash {
      to { stroke-dashoffset: 0; }
    }
    @keyframes neoFunnelGrow {
      from { transform: scaleX(0); transform-origin: left; }
      to   { transform: scaleX(1); transform-origin: left; }
    }
    @keyframes neoBlobPulse {
      0%, 100% { transform: translate(-50%, -50%) scale(1); }
      50%      { transform: translate(-50%, -50%) scale(1.08); }
    }
  `;
  document.head.appendChild(style);
}

/* ─── helpers ─── */

function chartValue(label: string, value: number) {
  const normalized = label.toLowerCase();
  if (normalized.includes("rate") || normalized.includes("scroll") || normalized.includes("share")) {
    return formatPercent(value, value % 1 === 0 ? 0 : 1);
  }
  return formatCompact(value);
}

function deltaColor(direction: "up" | "down" | "flat") {
  if (direction === "up") return { text: "#16A34A", bg: "#F0FDF4" };
  if (direction === "down") return { text: "#DC2626", bg: "#FEF2F2" };
  return { text: "#78716C", bg: "#F5F4F2" };
}

function deltaArrow(direction: "up" | "down" | "flat") {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "—";
}

/* ─── SVG sparkline ─── */

function Sparkline({
  data,
  color,
  width = 64,
  height = 20,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── shared primitives ─── */

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color?: string; name?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-md border-l-2 bg-[#1C1917] px-3 py-2 text-[#FAFAF9]" style={{ borderLeftColor: payload[0]?.color ?? "#78716C", boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
      <p className="mb-1.5 text-[11px] text-[#D6D3D1]">{label}</p>
      <div className="space-y-1.5">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.color}`} className="flex items-center gap-2 text-[12px]">
            <span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[#D6D3D1]">{entry.name}</span>
            <span className="ml-auto font-medium tabular-nums text-[#FAFAF9]">{formatCompact(entry.value ?? 0)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Surface({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <section
      className={cn("rounded-[20px] border border-[#E8E6E1] bg-white px-4 py-4", className)}
      style={{
        animation: `neoFadeSlideUp 400ms ease-out ${delay}ms both`,
      }}
    >
      {children}
    </section>
  );
}

function Strip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("overflow-hidden rounded-[18px] border border-[#E8E6E1] bg-white", className)}
      style={{ animation: "neoFadeSlideUp 400ms ease-out both" }}
    >
      {children}
    </div>
  );
}

function KpiCell({
  label,
  value,
  accent,
  delta,
  direction,
  sparkData,
  sparkColor,
}: {
  label: string;
  value: string;
  accent?: string;
  delta?: number;
  direction?: "up" | "down" | "flat";
  sparkData?: number[];
  sparkColor?: string;
}) {
  const dc = direction ? deltaColor(direction) : null;

  return (
    <div className="px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">{label}</p>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <p
          className="text-[22px] font-semibold leading-none tracking-tight tabular-nums text-[#1C1917]"
          style={accent ? { color: accent } : undefined}
        >
          {value}
        </p>
        {sparkData && sparkColor && <Sparkline data={sparkData} color={sparkColor} />}
      </div>
      {dc && delta != null && (
        <span
          className="mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
          style={{ backgroundColor: dc.bg, color: dc.text }}
        >
          {deltaArrow(direction!)} {Math.abs(delta).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

/* ─── gradient defs for area charts ─── */

function AreaGradient({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.08} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

/* ═══════════════════════════════════════════════════════════════
   1. OVERVIEW TREND
   ═══════════════════════════════════════════════════════════════ */

function OverviewTrendVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "overview_trend" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const gradientId = `overview-grad-${visual.theme}`;

  return (
    <div className="space-y-3">
      <Strip className="grid gap-px bg-[#E8E6E1] sm:grid-cols-2 xl:grid-cols-5">
        {visual.payload.kpis.map((kpi, idx) => {
          const sparkData =
            idx === 0
              ? visual.payload.trend.map((p) => p.primary)
              : idx === 1
                ? visual.payload.trend.map((p) => p.secondary ?? 0)
                : undefined;
          return (
            <div key={kpi.label} className="bg-white">
              <KpiCell
                label={kpi.label}
                value={chartValue(kpi.label, kpi.value)}
                accent={idx === 0 ? theme.accent : undefined}
                delta={kpi.delta}
                direction={kpi.direction}
                sparkData={sparkData}
                sparkColor={idx === 0 ? theme.accent : "#78716C"}
              />
            </div>
          );
        })}
      </Strip>

      <Surface delay={80}>
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#78716C]">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full" style={{ backgroundColor: theme.accent }} />
              {visual.payload.primaryLabel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block size-2 rounded-full border border-[#A8A29E] bg-transparent" />
              {visual.payload.secondaryLabel}
            </span>
          </div>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visual.payload.trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <AreaGradient id={gradientId} color={theme.accent} />
              <CartesianGrid horizontal vertical={false} stroke="#F0EDE8" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="#78716C" fontSize={11} />
              <YAxis tickLine={false} axisLine={false} stroke="#78716C" fontSize={11} tickFormatter={formatCompact} />
              <RechartsTooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="primary"
                name={visual.payload.primaryLabel}
                stroke={theme.accent}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                activeDot={{ r: 5, fill: "#FFFFFF", stroke: theme.accent, strokeWidth: 2 }}
                animationDuration={800}
              />
              <Line
                type="monotone"
                dataKey="secondary"
                name={visual.payload.secondaryLabel}
                stroke="#A8A29E"
                strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false}
                activeDot={{ r: 4, fill: "#FFFFFF", stroke: "#78716C", strokeWidth: 2 }}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Surface>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   2. RANKED VISUAL (pages, referrers, devices, geo)
   ═══════════════════════════════════════════════════════════════ */

function RankedVisual({
  visual,
}: {
  visual:
    | Extract<NeoVisualArtifact, { preset: "top_pages_ranked" }>
    | Extract<NeoVisualArtifact, { preset: "referrer_ranked" }>
    | Extract<NeoVisualArtifact, { preset: "device_breakdown_ranked" }>
    | Extract<NeoVisualArtifact, { preset: "geo_countries_ranked" }>;
}) {
  const theme = neoVisualThemeMeta[visual.theme];
  const items = visual.payload.items;
  const chartData = items.map((item, idx) => ({
    name: item.label.length > 28 ? `${item.label.slice(0, 26)}…` : item.label,
    value: item.value,
    share: item.share,
    rank: idx + 1,
    fullName: item.label,
    detail: item.detail,
    note: item.note,
  }));

  // Share segments for top-3
  const topItems = items.slice(0, 3);
  const topTotal = topItems.reduce((sum, item) => sum + item.share, 0);
  const otherShare = Math.max(0, 100 - topTotal);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
      <Surface>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
              barCategoryGap="20%"
            >
              <CartesianGrid horizontal={false} vertical stroke="#F0EDE8" />
              <XAxis type="number" tickLine={false} axisLine={false} stroke="#78716C" fontSize={11} tickFormatter={formatCompact} />
              <YAxis
                type="category"
                dataKey="name"
                tickLine={false}
                axisLine={false}
                stroke="#78716C"
                fontSize={11}
                width={140}
                tick={(props: Record<string, unknown>) => {
                  const x = Number(props.x ?? 0);
                  const y = Number(props.y ?? 0);
                  const tick = props.payload as { value: string; index: number } | undefined;
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text x={-8} y={0} dy={4} textAnchor="end" fill="#A8A29E" fontSize={16} fontWeight={700} opacity={0.25}>
                        {(tick?.index ?? 0) + 1}
                      </text>
                      <text x={-28} y={0} dy={4} textAnchor="end" fill="#1C1917" fontSize={12}>
                        {tick?.value ?? ""}
                      </text>
                    </g>
                  );
                }}
              />
              <RechartsTooltip
                content={({ active, payload: tipPayload }) => {
                  if (!active || !tipPayload?.length) return null;
                  const d = tipPayload[0]?.payload as (typeof chartData)[0];
                  return (
                    <div className="rounded-md bg-[#1C1917] px-3 py-2 text-[#FAFAF9]" style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
                      <p className="mb-1 text-[12px] font-medium">{d.fullName}</p>
                      <p className="text-[11px] tabular-nums text-[#D6D3D1]">
                        {formatCompact(d.value)} · {formatPercent(d.share, 1)}
                      </p>
                      {d.detail && <p className="mt-0.5 text-[10px] text-[#A8A29E]">{d.detail}</p>}
                    </div>
                  );
                }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} animationDuration={600}>
                {chartData.map((_, idx) => (
                  <Cell
                    key={`cell-${idx}`}
                    fill={idx === 0 ? theme.accent : theme.accentSoft}
                    stroke={idx === 0 ? theme.accent : theme.border}
                    strokeWidth={idx === 0 ? 0 : 1}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Surface>

      <div className="space-y-3" style={{ animation: "neoFadeSlideUp 400ms ease-out 120ms both" }}>
        <Strip className="grid gap-px bg-[#E8E6E1]">
          <div className="bg-white">
            <KpiCell label={visual.payload.totalLabel} value={formatCompact(visual.payload.totalValue)} accent={theme.accent} />
          </div>
          <div className="bg-white">
            <KpiCell label="Top item" value={items[0]?.label ?? "No data"} />
          </div>
          <div className="bg-white">
            <KpiCell label="Top share" value={formatPercent(items[0]?.share ?? 0, 1)} />
          </div>
        </Strip>

        {/* Share distribution bar */}
        <Surface delay={200}>
          <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Distribution</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-[#F5F4F2]">
            {topItems.map((item, i) => (
              <div
                key={item.label}
                className="h-full transition-all"
                style={{
                  width: `${Math.max(item.share, 2)}%`,
                  backgroundColor: i === 0 ? theme.accent : i === 1 ? theme.accentSoft : theme.border,
                  opacity: 1 - i * 0.2,
                }}
              />
            ))}
            {otherShare > 0 && (
              <div className="h-full bg-[#E8E6E1]" style={{ width: `${otherShare}%` }} />
            )}
          </div>
          <div className="mt-2 space-y-1">
            {topItems.map((item, i) => (
              <div key={item.label} className="flex items-center gap-1.5 text-[11px] text-[#78716C]">
                <span className="size-1.5 rounded-full" style={{ backgroundColor: i === 0 ? theme.accent : i === 1 ? theme.accentSoft : theme.border }} />
                <span className="truncate">{item.label}</span>
                <span className="ml-auto tabular-nums">{formatPercent(item.share, 1)}</span>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   3. RETENTION CURVE
   ═══════════════════════════════════════════════════════════════ */

function RetentionCurveVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "retention_curve" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const gradientId = `retention-grad-${visual.theme}`;

  const retentionRating = (rate: number) => {
    if (rate >= 40) return { text: "#16A34A", bg: "#F0FDF4" };
    if (rate >= 20) return { text: "#C2410C", bg: "#FFF7ED" };
    return { text: "#DC2626", bg: "#FEF2F2" };
  };

  const d1 = retentionRating(visual.payload.summary.day1Rate);
  const d7 = retentionRating(visual.payload.summary.day7Rate);
  const d30 = retentionRating(visual.payload.summary.day30Rate);

  // find curve indices for day 1, 7, 30 reference lines
  const refDays = [1, 7, 30];
  const refLines = refDays
    .map((day) => visual.payload.curve.find((p) => p.period === day))
    .filter(Boolean);

  return (
    <div className="space-y-3">
      <Strip className="grid gap-px bg-[#E8E6E1] sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white">
          <KpiCell label="Users" value={formatCompact(visual.payload.summary.users)} accent={theme.accent} />
        </div>
        <div className="bg-white">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Day 1</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: d1.text }}>
              {formatPercent(visual.payload.summary.day1Rate, 1)}
            </p>
            <span className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: d1.bg, color: d1.text }}>
              {visual.payload.summary.day1Rate >= 40 ? "Strong" : visual.payload.summary.day1Rate >= 20 ? "Fair" : "Low"}
            </span>
          </div>
        </div>
        <div className="bg-white">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Day 7</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: d7.text }}>
              {formatPercent(visual.payload.summary.day7Rate, 1)}
            </p>
            <span className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: d7.bg, color: d7.text }}>
              {visual.payload.summary.day7Rate >= 40 ? "Strong" : visual.payload.summary.day7Rate >= 20 ? "Fair" : "Low"}
            </span>
          </div>
        </div>
        <div className="bg-white">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Day 30</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: d30.text }}>
              {formatPercent(visual.payload.summary.day30Rate, 1)}
            </p>
            <span className="mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: d30.bg, color: d30.text }}>
              {visual.payload.summary.day30Rate >= 40 ? "Strong" : visual.payload.summary.day30Rate >= 20 ? "Fair" : "Low"}
            </span>
          </div>
        </div>
      </Strip>

      <Surface delay={80}>
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#78716C]">
          <span className="flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-full" style={{ backgroundColor: theme.accent }} />
            Retention — {visual.payload.cadence}
          </span>
          <span>{visual.payload.summary.confidenceText}</span>
        </div>
        <div className="h-[280px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visual.payload.curve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <AreaGradient id={gradientId} color={theme.accent} />
              <CartesianGrid horizontal vertical={false} stroke="#F0EDE8" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} stroke="#78716C" fontSize={11} />
              <YAxis tickLine={false} axisLine={false} stroke="#78716C" fontSize={11} tickFormatter={(v) => `${v}%`} />
              <RechartsTooltip
                content={({ active, payload: tipPayload, label: tipLabel }) => {
                  if (!active || !tipPayload?.length) return null;
                  const d = tipPayload[0]?.payload as { rate: number; eligibleUsers: number; returnedUsers: number };
                  return (
                    <div className="rounded-md bg-[#1C1917] px-3 py-2 text-[#FAFAF9]" style={{ boxShadow: "0 4px 12px rgba(0,0,0,0.12)" }}>
                      <p className="mb-1 text-[11px] text-[#D6D3D1]">{tipLabel}</p>
                      <p className="text-[13px] font-medium tabular-nums">{formatPercent(d.rate, 1)} retained</p>
                      <p className="mt-0.5 text-[10px] text-[#A8A29E]">
                        {formatCompact(d.returnedUsers)} of {formatCompact(d.eligibleUsers)} users
                      </p>
                    </div>
                  );
                }}
              />
              {refLines.map((ref) => (
                <ReferenceLine
                  key={ref!.period}
                  x={ref!.label}
                  stroke={theme.border}
                  strokeDasharray="4 4"
                  label={{ value: `D${ref!.period}`, position: "top", fill: "#A8A29E", fontSize: 10 }}
                />
              ))}
              <Area
                type="monotone"
                dataKey="rate"
                name="Retention"
                stroke={theme.accent}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={(props: Record<string, unknown>) => {
                  const cx = Number(props.cx ?? 0);
                  const cy = Number(props.cy ?? 0);
                  const dotPayload = props.payload as { eligibleUsers: number; period: number } | undefined;
                  if (!dotPayload || !refDays.includes(dotPayload.period)) return <circle key={dotPayload?.period ?? 0} r={0} />;
                  return (
                    <g key={dotPayload.period}>
                      <circle cx={cx} cy={cy} r={4} fill="#FFFFFF" stroke={theme.accent} strokeWidth={2} />
                      <text x={cx} y={cy - 10} textAnchor="middle" fill="#78716C" fontSize={9}>
                        {formatCompact(dotPayload.eligibleUsers)}
                      </text>
                    </g>
                  );
                }}
                activeDot={{ r: 5, fill: "#FFFFFF", stroke: theme.accent, strokeWidth: 2 }}
                animationDuration={800}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Surface>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   4. JOURNEY FLOW — SVG bezier flow lines
   ═══════════════════════════════════════════════════════════════ */

function FlowNodeCard({
  node,
  accent,
  border,
}: {
  node: NeoVisualFlowNode;
  accent: string;
  border: string;
}) {
  const borderColor = node.emphasis === "high" ? accent : node.emphasis === "medium" ? border : "#E8E6E1";
  return (
    <div
      className="rounded-[16px] border-l-[3px] border bg-[#FFFCF8] px-3 py-3 transition-all hover:bg-[#FAFAF9]"
      style={{ borderColor: "#E8E6E1", borderLeftColor: borderColor }}
    >
      <p className="truncate text-[12px] font-medium text-[#1C1917]">{node.label}</p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-[#78716C]">
        <span className="tabular-nums">{formatCompact(node.sessions)} sessions</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
          style={{
            backgroundColor: node.emphasis === "high" ? `${accent}12` : "#F5F4F2",
            color: node.emphasis === "high" ? accent : "#78716C",
          }}
        >
          {formatPercent(node.share, 0)}
        </span>
      </div>
    </div>
  );
}

function FlowLines({
  stages,
  links,
  accent,
  containerRef,
}: {
  stages: NeoVisualFlowStage[];
  links: NeoVisualFlowLink[];
  accent: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [paths, setPaths] = useState<Array<{ d: string; opacity: number; width: number }>>([]);

  useEffect(() => {
    if (!containerRef.current || !links.length) return;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();

    const maxSessions = Math.max(...links.map((l) => l.sessions), 1);
    const computed: Array<{ d: string; opacity: number; width: number }> = [];

    for (const link of links) {
      const sourceEl = container.querySelector(`[data-node-id="${link.sourceId}"]`);
      const targetEl = container.querySelector(`[data-node-id="${link.targetId}"]`);
      if (!sourceEl || !targetEl) continue;

      const sourceRect = sourceEl.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();

      const x1 = sourceRect.right - rect.left;
      const y1 = sourceRect.top + sourceRect.height / 2 - rect.top;
      const x2 = targetRect.left - rect.left;
      const y2 = targetRect.top + targetRect.height / 2 - rect.top;

      const cpx = (x1 + x2) / 2;
      const d = `M${x1},${y1} C${cpx},${y1} ${cpx},${y2} ${x2},${y2}`;
      const ratio = link.sessions / maxSessions;

      computed.push({
        d,
        opacity: Math.max(0.1, ratio * 0.4),
        width: Math.max(1, ratio * 4),
      });
    }

    setPaths(computed);
  }, [stages, links, containerRef]);

  if (!paths.length) return null;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full">
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          fill="none"
          stroke={accent}
          strokeWidth={p.width}
          opacity={p.opacity}
          strokeLinecap="round"
          style={{
            strokeDasharray: 1000,
            strokeDashoffset: 1000,
            animation: `neoFlowDash 1.2s ease-out ${i * 0.1}s forwards`,
          }}
        />
      ))}
    </svg>
  );
}

function JourneyFlowVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "journey_flow" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-3">
      <Strip className="grid gap-px bg-[#E8E6E1] sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white">
          <KpiCell label="Sessions" value={formatCompact(visual.payload.summary.sessions)} accent={theme.accent} />
        </div>
        <div className="bg-white">
          <KpiCell label="Top path share" value={formatPercent(visual.payload.summary.topPathShare, 1)} />
        </div>
        <div className="bg-white">
          <KpiCell label="Avg path length" value={visual.payload.summary.avgPathLength.toFixed(1)} />
        </div>
        <div className="bg-white">
          <KpiCell label="Unique paths" value={formatCompact(visual.payload.summary.uniquePaths)} />
        </div>
      </Strip>

      <Surface delay={80} className="overflow-x-auto">
        <div
          ref={containerRef}
          className="relative grid min-w-[720px] gap-6"
          style={{ gridTemplateColumns: `repeat(${Math.max(visual.payload.stages.length, 1)}, minmax(0, 1fr))` }}
        >
          <FlowLines
            stages={visual.payload.stages}
            links={visual.payload.links}
            accent={theme.accent}
            containerRef={containerRef}
          />

          {visual.payload.stages.map((stage, stageIdx) => (
            <div key={stage.stageIndex} className="relative min-w-0">
              <div
                className="mb-3 border-b-2 pb-2 text-[11px] uppercase tracking-[0.18em] text-[#78716C]"
                style={{ borderBottomColor: stageIdx === 0 ? theme.accent : "#E8E6E1" }}
              >
                <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: stageIdx === 0 ? theme.accent : "#A8A29E" }}>
                  {stageIdx + 1}
                </span>
                {stage.label}
              </div>
              <div className="space-y-2.5">
                {stage.nodes.map((node) => (
                  <div key={node.id} data-node-id={node.id}>
                    <FlowNodeCard node={node} accent={theme.accent} border={theme.border} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Surface>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   5. INSIGHTS DIGEST
   ═══════════════════════════════════════════════════════════════ */

function InsightsDigestVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "insights_digest" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const severityConfig = {
    critical: { dot: "#DC2626", bg: "#FEF2F2", text: "#DC2626", pulse: true },
    warning: { dot: "#C2410C", bg: "#FFF7ED", text: "#C2410C", pulse: false },
    info: { dot: "#0D9488", bg: "#F0FDFA", text: "#0F766E", pulse: false },
  } as const;

  return (
    <div className="space-y-3">
      <Strip className="grid gap-px bg-[#E8E6E1] sm:grid-cols-2 xl:grid-cols-4">
        <div className="bg-white">
          <KpiCell label="Findings" value={formatNumber(visual.payload.summary.total)} accent={theme.accent} />
        </div>
        <div className="bg-white">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Critical</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: visual.payload.summary.critical > 0 ? "#DC2626" : "#1C1917" }}>
              {formatNumber(visual.payload.summary.critical)}
            </p>
          </div>
        </div>
        <div className="bg-white">
          <div className="px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Warning</p>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: visual.payload.summary.warning > 0 ? "#C2410C" : "#1C1917" }}>
              {formatNumber(visual.payload.summary.warning)}
            </p>
          </div>
        </div>
        <div className="bg-white">
          <KpiCell label="Info" value={formatNumber(visual.payload.summary.info)} />
        </div>
      </Strip>

      <Surface delay={80}>
        <div className="space-y-0">
          {visual.payload.items.map((item, idx) => {
            const sev = severityConfig[item.severity] ?? severityConfig.info;
            const scoreWidth = Math.max(8, Math.min(item.score, 100));
            return (
              <div
                key={`${item.title}-${item.path}`}
                className="border-b border-[#F0EDE8] py-4 transition-transform first:pt-0 last:border-none last:pb-0 hover:-translate-y-px"
                style={{ animation: `neoFadeSlideUp 400ms ease-out ${idx * 60}ms both` }}
              >
                <div className="flex items-start gap-3">
                  {/* severity dot */}
                  <div className="mt-1 flex shrink-0 items-center">
                    <span
                      className="inline-block size-2.5 rounded-full"
                      style={{
                        backgroundColor: sev.dot,
                        animation: sev.pulse ? "neoPulse 2s ease-in-out infinite" : undefined,
                      }}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[#1C1917]">{item.title}</p>
                        <p className="mt-0.5 truncate text-[11px] text-[#78716C]">{item.path}</p>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                        style={{ backgroundColor: sev.bg, color: sev.text }}
                      >
                        {item.severity}
                      </span>
                    </div>

                    {/* score bar */}
                    <div className="mt-2.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-[#F5F4F2]">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${scoreWidth}%`,
                            backgroundColor: sev.dot,
                            opacity: 0.7,
                          }}
                        />
                      </div>
                      <span className="text-[11px] font-medium tabular-nums text-[#78716C]">{item.score}</span>
                    </div>

                    {/* recommendation */}
                    {item.recommendation && (
                      <div
                        className="mt-2 rounded-lg border-l-2 bg-[#FAFAF9] px-2.5 py-1.5 text-[11px] text-[#78716C]"
                        style={{ borderLeftColor: sev.dot }}
                      >
                        {item.recommendation}
                      </div>
                    )}

                    {/* evidence */}
                    {item.evidence && (
                      <p className="mt-1.5 font-mono text-[10px] text-[#A8A29E]">{item.evidence}</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Surface>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   6. HEATMAP HOTSPOTS — gradient blobs
   ═══════════════════════════════════════════════════════════════ */

function HeatmapHotspotsVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "heatmap_hotspots" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const width = Math.max(visual.payload.viewport.width, 1);
  const height = Math.max(visual.payload.viewport.height, 1);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_220px]">
      <Surface>
        <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#78716C]">
          <span className="truncate">{visual.payload.path}</span>
          <span className="tabular-nums">
            {width} × {height}
          </span>
        </div>
        <div className="relative aspect-[16/10] overflow-hidden rounded-[18px] border border-[#E8E6E1] bg-[#FCFBF8]">
          {/* page wireframe hint */}
          <div className="absolute inset-0">
            {/* nav bar */}
            <div className="mx-[8%] mt-[4%] h-[3%] rounded-sm bg-[#F0EDE8]/60" />
            {/* hero block */}
            <div className="mx-[8%] mt-[3%] h-[18%] rounded-sm border border-dashed border-[#E8E6E1]/50" />
            {/* content lines */}
            <div className="mx-[8%] mt-[4%] space-y-[2%]">
              <div className="h-[1.5%] w-[65%] rounded-full bg-[#F0EDE8]/40" />
              <div className="h-[1.5%] w-[80%] rounded-full bg-[#F0EDE8]/40" />
              <div className="h-[1.5%] w-[50%] rounded-full bg-[#F0EDE8]/40" />
            </div>
          </div>

          {/* hotspot blobs */}
          {visual.payload.hotspots.map((hotspot, index) => {
            const size = 24 + hotspot.intensity * 48;
            const isHovered = hoveredIdx === index;
            return (
              <div
                key={`${hotspot.x}-${hotspot.y}-${index}`}
                className="absolute cursor-pointer"
                style={{
                  left: `${(hotspot.x / width) * 100}%`,
                  top: `${(hotspot.y / height) * 100}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  transform: "translate(-50%, -50%)",
                  background: `radial-gradient(circle, ${theme.accent}${Math.round(Math.max(0.2, hotspot.intensity * 0.65) * 255).toString(16).padStart(2, "0")} 0%, transparent 70%)`,
                  filter: `blur(${4 + hotspot.intensity * 6}px)`,
                  animation: hotspot.intensity > 0.7 ? "neoBlobPulse 3s ease-in-out infinite" : undefined,
                }}
                onMouseEnter={() => setHoveredIdx(index)}
                onMouseLeave={() => setHoveredIdx(null)}
              />
            );
          })}

          {/* hotspot tooltip */}
          {hoveredIdx !== null && visual.payload.hotspots[hoveredIdx] && (
            <div
              className="pointer-events-none absolute z-10 rounded-md bg-[#1C1917] px-2.5 py-1.5 text-[#FAFAF9]"
              style={{
                left: `${(visual.payload.hotspots[hoveredIdx]!.x / width) * 100}%`,
                top: `${(visual.payload.hotspots[hoveredIdx]!.y / height) * 100}%`,
                transform: "translate(-50%, -130%)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
              }}
            >
              <p className="text-[12px] font-medium tabular-nums">{visual.payload.hotspots[hoveredIdx]!.label}</p>
            </div>
          )}

          {/* intensity legend */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <span className="text-[9px] text-[#A8A29E]">Low</span>
            <div
              className="h-1.5 w-16 rounded-full"
              style={{
                background: `linear-gradient(90deg, ${theme.accentSoft}, ${theme.accent})`,
              }}
            />
            <span className="text-[9px] text-[#A8A29E]">High</span>
          </div>
        </div>
      </Surface>

      <div className="space-y-3" style={{ animation: "neoFadeSlideUp 400ms ease-out 120ms both" }}>
        <Strip className="grid gap-px bg-[#E8E6E1]">
          <div className="bg-white">
            <KpiCell label="Clicks" value={formatCompact(visual.payload.totals.clicks)} accent={theme.accent} />
          </div>
          <div className="bg-white">
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Rage</p>
              <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: visual.payload.totals.rageClicks > 0 ? "#DC2626" : "#1C1917" }}>
                {formatCompact(visual.payload.totals.rageClicks)}
              </p>
            </div>
          </div>
          <div className="bg-white">
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Dead</p>
              <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums" style={{ color: visual.payload.totals.deadClicks > 0 ? "#C2410C" : "#1C1917" }}>
                {formatCompact(visual.payload.totals.deadClicks)}
              </p>
            </div>
          </div>
          <div className="bg-white">
            <KpiCell label="Sessions" value={formatCompact(visual.payload.totals.uniqueSessions)} />
          </div>
        </Strip>

        {/* Top selectors */}
        {visual.payload.selectors.length > 0 && (
          <Surface delay={200}>
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[#78716C]">Top selectors</p>
            <div className="space-y-2">
              {visual.payload.selectors.map((sel) => (
                <div key={sel.selector} className="flex items-center justify-between gap-2">
                  <code className="min-w-0 truncate font-mono text-[11px] text-[#1C1917]">{sel.selector}</code>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-[#78716C]">
                    <span>{formatCompact(sel.clicks)}</span>
                    {sel.rageClicks > 0 && (
                      <span className="rounded-full bg-[#FEF2F2] px-1 text-[10px] text-[#DC2626]">
                        {sel.rageClicks} rage
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Surface>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   7. SCROLL DEPTH — funnel visualization
   ═══════════════════════════════════════════════════════════════ */

function ScrollDepthVisual({ visual }: { visual: Extract<NeoVisualArtifact, { preset: "scroll_depth_funnel" }> }) {
  const theme = neoVisualThemeMeta[visual.theme];
  const steps = visual.payload.steps;

  return (
    <Surface>
      <div className="mb-4 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[#78716C]">
        <span>{formatCompact(visual.payload.totalSessions)} total sessions</span>
      </div>
      <div className="space-y-1">
        {steps.map((step, idx) => {
          const prevShare = idx > 0 ? steps[idx - 1]!.share : 100;
          const dropoff = prevShare - step.share;
          const funnelWidth = Math.max(18, step.share);
          const accentOpacity = 1 - idx * (0.6 / Math.max(steps.length - 1, 1));

          return (
            <div key={step.label}>
              {/* Drop-off indicator between steps */}
              {idx > 0 && dropoff > 0.5 && (
                <div className="flex items-center justify-center py-0.5">
                  <span className="text-[10px] tabular-nums text-[#DC2626]/70">
                    −{formatPercent(dropoff, 1)} drop
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3">
                {/* Step label */}
                <div className="w-20 shrink-0 text-right text-[11px] text-[#78716C]">{step.label}</div>

                {/* Funnel bar */}
                <div className="flex-1">
                  <div className="relative">
                    <div
                      className="flex h-10 items-center overflow-hidden rounded-lg px-3"
                      style={{
                        width: `${funnelWidth}%`,
                        backgroundColor: theme.accent,
                        opacity: accentOpacity,
                        animation: `neoFunnelGrow 600ms ease-out ${idx * 80}ms both`,
                      }}
                    >
                      <span className="text-[12px] font-semibold tabular-nums text-white">
                        {formatCompact(step.value)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Share badge */}
                <div className="w-14 shrink-0 text-right">
                  <span
                    className="inline-block rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums"
                    style={{
                      backgroundColor: step.share > 50 ? "#F0FDF4" : step.share > 20 ? "#FFF7ED" : "#FEF2F2",
                      color: step.share > 50 ? "#16A34A" : step.share > 20 ? "#C2410C" : "#DC2626",
                    }}
                  >
                    {formatPercent(step.share, 1)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Engagement summary */}
      {steps.length >= 2 && (
        <div className="mt-4 flex items-center justify-between rounded-[14px] border border-[#E8E6E1] bg-[#FAFAF9] px-3 py-2 text-[11px] text-[#78716C]">
          <span>Overall reach</span>
          <span className="font-medium tabular-nums text-[#1C1917]">
            {formatPercent(steps[steps.length - 1]!.share, 1)} reach the bottom
          </span>
        </div>
      )}
    </Surface>
  );
}

/* ═══════════════════════════════════════════════════════════════
   VISUAL SURFACE — dispatch to renderer
   ═══════════════════════════════════════════════════════════════ */

function VisualSurface({ visual }: { visual: NeoVisualArtifact }) {
  switch (visual.preset) {
    case "overview_trend":
      return <OverviewTrendVisual visual={visual} />;
    case "top_pages_ranked":
    case "referrer_ranked":
    case "device_breakdown_ranked":
    case "geo_countries_ranked":
      return <RankedVisual visual={visual} />;
    case "retention_curve":
      return <RetentionCurveVisual visual={visual} />;
    case "journey_flow":
      return <JourneyFlowVisual visual={visual} />;
    case "insights_digest":
      return <InsightsDigestVisual visual={visual} />;
    case "heatmap_hotspots":
      return <HeatmapHotspotsVisual visual={visual} />;
    case "scroll_depth_funnel":
      return <ScrollDepthVisual visual={visual} />;
    default:
      return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   FLOATING PANEL + MODAL (shell unchanged)
   ═══════════════════════════════════════════════════════════════ */

function FloatingVisualPanel({
  activeVisual,
  visuals,
  onClose,
  onSelect,
}: {
  activeVisual: NeoVisualArtifact;
  visuals: NeoVisualArtifact[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const activeTheme = neoVisualThemeMeta[activeVisual.theme];

  return (
    <div className="pointer-events-auto flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-[#E8E6E1] bg-[#F7F6F3]/96 backdrop-blur-xl">
      <div className="border-b border-[#E8E6E1] px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#78716C]">
            <BarChart3 className="size-3.5" style={{ color: activeTheme.accent }} />
            <span className="truncate">Visuals</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-full border border-[#E8E6E1] bg-white text-[#78716C] transition-colors hover:text-[#1C1917]"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          {visuals.map((visual) => {
            const vTheme = neoVisualThemeMeta[visual.theme];
            const active = activeVisual.id === visual.id;
            return (
              <button
                key={visual.id}
                type="button"
                onClick={() => onSelect(visual.id)}
                className="shrink-0 rounded-full border px-3 py-2 text-[12px] font-medium transition-colors"
                style={{
                  borderColor: active ? vTheme.border : "#E8E6E1",
                  backgroundColor: active ? vTheme.surface : "#FFFFFF",
                  color: active ? "#1C1917" : "#78716C",
                }}
              >
                {visual.title}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <VisualSurface visual={activeVisual} />
      </div>
    </div>
  );
}

export function NeoVisualModal({
  message,
  open,
  onClose,
}: {
  message: NeoChatMessage | null;
  open: boolean;
  onClose: () => void;
}) {
  const visuals = message?.visuals ?? [];
  const [activeVisualId, setActiveVisualId] = useState<string | null>(visuals[0]?.id ?? null);

  useEffect(() => {
    if (open) {
      setActiveVisualId(visuals[0]?.id ?? null);
    }
  }, [open, visuals]);

  useEffect(() => {
    if (!open) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  const activeVisual = useMemo(
    () => visuals.find((visual) => visual.id === activeVisualId) ?? visuals[0] ?? null,
    [activeVisualId, visuals],
  );

  if (!open || !message || !visuals.length || !activeVisual) {
    return null;
  }

  return (
    <>
      <div className="pointer-events-none fixed inset-y-3 right-[27rem] z-[65] hidden w-[min(52vw,760px)] lg:block">
        <FloatingVisualPanel
          activeVisual={activeVisual}
          visuals={visuals}
          onClose={onClose}
          onSelect={setActiveVisualId}
        />
      </div>

      <div className="pointer-events-none fixed inset-x-3 bottom-3 top-[18%] z-[65] lg:hidden">
        <FloatingVisualPanel
          activeVisual={activeVisual}
          visuals={visuals}
          onClose={onClose}
          onSelect={setActiveVisualId}
        />
      </div>
    </>
  );
}

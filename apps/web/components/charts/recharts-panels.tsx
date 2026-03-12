"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { DeviceMetric, PageMetric, ReferrerMetric } from "@/lib/dashboard/types";

const CHART_COLORS = ["#ef7a29", "#0fa7b5", "#ffbf4d", "#8e4ec6", "#e34c55", "#f58b77"];

export function TopPagesBarChart({ data, height = 320 }: { data: PageMetric[]; height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid stroke="rgba(61, 49, 40, 0.08)" vertical={false} />
          <XAxis dataKey="path" stroke="rgba(61, 49, 40, 0.56)" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis stroke="rgba(61, 49, 40, 0.56)" tickLine={false} axisLine={false} fontSize={11} />
          <Tooltip
            cursor={{ fill: "rgba(239, 122, 41, 0.06)" }}
            contentStyle={{
              borderRadius: 20,
              border: "1px solid rgba(66, 47, 35, 0.12)",
              background: "rgba(255,249,242,0.96)",
            }}
          />
          <Bar dataKey="pageviews" radius={[18, 18, 10, 10]}>
            {data.map((entry, index) => (
              <Cell key={entry.path} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DevicePieChart({ data, height = 260 }: { data: DeviceMetric[]; height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip
            contentStyle={{
              borderRadius: 20,
              border: "1px solid rgba(66, 47, 35, 0.12)",
              background: "rgba(255,249,242,0.96)",
            }}
          />
          <Pie data={data} innerRadius={64} outerRadius={98} paddingAngle={4} dataKey="pageviews" nameKey="device">
            {data.map((entry, index) => (
              <Cell key={entry.device} fill={CHART_COLORS[index % CHART_COLORS.length]} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReferrerAreaChart({ data, height = 320 }: { data: ReferrerMetric[]; height?: number }) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="referrer-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#0fa7b5" stopOpacity={0.55} />
              <stop offset="95%" stopColor="#0fa7b5" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(61, 49, 40, 0.08)" vertical={false} />
          <XAxis dataKey="source" stroke="rgba(61, 49, 40, 0.56)" tickLine={false} axisLine={false} fontSize={11} />
          <YAxis stroke="rgba(61, 49, 40, 0.56)" tickLine={false} axisLine={false} fontSize={11} />
          <Tooltip
            contentStyle={{
              borderRadius: 20,
              border: "1px solid rgba(66, 47, 35, 0.12)",
              background: "rgba(255,249,242,0.96)",
            }}
          />
          <Area type="monotone" dataKey="pageviews" stroke="#0fa7b5" fill="url(#referrer-area)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import uPlot from "uplot";

import type { DepthMetric, TimeseriesPoint } from "@/lib/dashboard/types";

function buildMutedColor() {
  return "#A8A29E";
}

function buildGridColor() {
  return "#F0EDE8";
}

export function TimelineUPlot({ data, height = 320 }: { data: TimeseriesPoint[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) {
      return;
    }

    const chartData = [
      Float64Array.from(data.map((point) => Math.floor(new Date(point.timestamp).getTime() / 1000))),
      Float64Array.from(data.map((point) => point.pageviews)),
      Float64Array.from(data.map((point) => point.sessions)),
    ];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height,
        padding: [12, 16, 6, 6],
        legend: {
          show: false,
        },
        scales: {
          x: { time: true },
          y: { auto: true },
        },
        series: [
          {},
          {
            label: "Pageviews",
            stroke: "#0D9488",
            width: 1.5,
          },
          {
            label: "Sessions",
            stroke: "#F59E0B",
            width: 1.5,
          },
        ],
        axes: [
          {
            stroke: buildMutedColor(),
            grid: { show: false },
            ticks: { show: false },
            font: "11px system-ui",
          },
          {
            stroke: buildMutedColor(),
            grid: { stroke: buildGridColor(), width: 1 },
            ticks: { show: false },
            font: "11px system-ui",
          },
        ],
      },
      chartData,
      container,
    );

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? container.clientWidth);
      if (nextWidth > 0) {
        plot.setSize({ width: nextWidth, height });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [data, height]);

  return <div ref={containerRef} className="w-full" />;
}

export function ScrollDepthUPlot({ data, height = 240 }: { data: DepthMetric[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || data.length === 0) {
      return;
    }

    const chartData = [
      Float64Array.from(data.map((point) => point.depth)),
      Float64Array.from(data.map((point) => point.sessions)),
    ];

    const plot = new uPlot(
      {
        width: container.clientWidth,
        height,
        padding: [12, 16, 6, 6],
        legend: { show: false },
        scales: {
          x: {
            time: false,
          },
          y: {
            auto: true,
          },
        },
        series: [
          {},
          {
            label: "Sessions",
            stroke: "#0D9488",
            width: 1.5,
          },
        ],
        axes: [
          {
            stroke: buildMutedColor(),
            grid: { show: false },
            ticks: { show: false },
            font: "11px system-ui",
            values: (_self, values) => values.map((value) => `${value}%`),
          },
          {
            stroke: buildMutedColor(),
            grid: { stroke: buildGridColor(), width: 1 },
            ticks: { show: false },
            font: "11px system-ui",
          },
        ],
      },
      chartData,
      container,
    );

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.floor(entries[0]?.contentRect.width ?? container.clientWidth);
      if (nextWidth > 0) {
        plot.setSize({ width: nextWidth, height });
      }
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      plot.destroy();
    };
  }, [data, height]);

  return <div ref={containerRef} className="w-full" />;
}

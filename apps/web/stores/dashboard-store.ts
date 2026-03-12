"use client";

import { endOfDay, startOfDay, subDays } from "date-fns";
import type { DateRange } from "react-day-picker";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { HeatmapClickFilter, HeatmapMode, HeatmapViewportSegment, RangeKey } from "@/lib/dashboard/types";

type DashboardStore = {
  selectedSiteId: string;
  selectedRange: RangeKey;
  heatmapMode: HeatmapMode;
  heatmapClickFilter: HeatmapClickFilter;
  heatmapViewportSegment: HeatmapViewportSegment;
  dateRange: DateRange | undefined;
  isNavOpen: boolean;
  isNeoOpen: boolean;
  setSelectedSiteId: (siteId: string) => void;
  setSelectedRange: (range: RangeKey) => void;
  setHeatmapMode: (mode: HeatmapMode) => void;
  setHeatmapClickFilter: (filter: HeatmapClickFilter) => void;
  setHeatmapViewportSegment: (segment: HeatmapViewportSegment) => void;
  setDateRange: (range: DateRange | undefined) => void;
  toggleNav: () => void;
  closeNav: () => void;
  toggleNeo: () => void;
  closeNeo: () => void;
};

const defaultDateRange: DateRange = {
  from: startOfDay(subDays(new Date(), 6)),
  to: endOfDay(new Date()),
};

function dateRangeForPreset(range: RangeKey): DateRange {
  if (range.startsWith("custom:")) {
    const [, fromRaw, toRaw] = range.split(":", 3);
    const from = fromRaw ? startOfDay(new Date(fromRaw)) : undefined;
    const to = toRaw ? endOfDay(new Date(toRaw)) : undefined;
    if (from && to && !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
      return { from, to };
    }
  }

  if (range === "24h") {
    return {
      from: startOfDay(new Date()),
      to: endOfDay(new Date()),
    };
  }

  if (range === "30d") {
    return {
      from: startOfDay(subDays(new Date(), 29)),
      to: endOfDay(new Date()),
    };
  }

  return {
    from: startOfDay(subDays(new Date(), 6)),
    to: endOfDay(new Date()),
  };
}

function formatDatePart(value: Date) {
  return value.toISOString().slice(0, 10);
}

function customRangeKey(dateRange: DateRange) {
  return `custom:${formatDatePart(dateRange.from!)}:${formatDatePart(dateRange.to!)}` as RangeKey;
}

export const useDashboardStore = create<DashboardStore>()(
  persist(
    (set) => ({
      selectedSiteId: "",
      selectedRange: "7d",
      heatmapMode: "engagement",
      heatmapClickFilter: "all",
      heatmapViewportSegment: "all",
      dateRange: defaultDateRange,
      isNavOpen: false,
      isNeoOpen: false,
      setSelectedSiteId: (siteId) => set({ selectedSiteId: siteId }),
      setSelectedRange: (range) =>
        set({
          selectedRange: range,
          dateRange: dateRangeForPreset(range),
        }),
      setHeatmapMode: (mode) => set({ heatmapMode: mode }),
      setHeatmapClickFilter: (filter) => set({ heatmapClickFilter: filter }),
      setHeatmapViewportSegment: (segment) => set({ heatmapViewportSegment: segment }),
      setDateRange: (dateRange) =>
        set(() => {
          if (!dateRange?.from || !dateRange?.to) {
            return { dateRange };
          }

          return {
            dateRange,
            selectedRange: customRangeKey(dateRange),
          };
        }),
      toggleNav: () => set((state) => ({ isNavOpen: !state.isNavOpen })),
      closeNav: () => set({ isNavOpen: false }),
      toggleNeo: () => set((state) => ({ isNeoOpen: !state.isNeoOpen })),
      closeNeo: () => set({ isNeoOpen: false }),
    }),
    {
      name: "anlticsheat-dashboard-store",
      partialize: (state) => ({
        selectedSiteId: state.selectedSiteId,
        selectedRange: state.selectedRange,
        heatmapViewportSegment: state.heatmapViewportSegment,
        isNavOpen: state.isNavOpen,
      }),
      merge: (persistedState, currentState) => {
        const nextState = persistedState as Partial<DashboardStore> | undefined;
        const selectedRange = nextState?.selectedRange ?? currentState.selectedRange;
        const heatmapMode = currentState.heatmapMode;
        const heatmapClickFilter = currentState.heatmapClickFilter;
        const heatmapViewportSegment = nextState?.heatmapViewportSegment ?? currentState.heatmapViewportSegment;
        return {
          ...currentState,
          ...nextState,
          selectedRange,
          heatmapMode,
          heatmapClickFilter,
          heatmapViewportSegment,
          dateRange: dateRangeForPreset(selectedRange),
        };
      },
    },
  ),
);

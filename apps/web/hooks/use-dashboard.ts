"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import {
  dashboardKeys,
  fetchDashboardAlerts,
  fetchDashboardAPIKeys,
  fetchDashboardAIInsights,
  fetchDashboardContext,
  fetchDashboardErrors,
  fetchDashboardEventExplorer,
  fetchDashboardFunnels,
  fetchDashboardGoalReport,
  fetchDashboardGoals,
  fetchDashboardHeatmap,
  fetchDashboardMap,
  fetchDashboardNeoThread,
  fetchDashboardPerformance,
  fetchDashboardReports,
  fetchDashboardReplaySession,
  fetchDashboardReplaySessions,
  fetchDashboardSettings,
  fetchDashboardSharedLinks,
  fetchDashboardSummary,
} from "@/lib/dashboard/client";
import { useDashboardStore } from "@/stores/dashboard-store";

const SUMMARY_REFRESH_MS = 30_000;
const DETAIL_REFRESH_MS = 45_000;
const SETTINGS_REFRESH_MS = 120_000;

export function useDashboardContext() {
  const query = useQuery({
    queryKey: dashboardKeys.context,
    queryFn: fetchDashboardContext,
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });

  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const setSelectedSiteId = useDashboardStore((state) => state.setSelectedSiteId);

  useEffect(() => {
    if (!query.data) {
      return;
    }

    const hasSelectedSite = query.data.sites.some((site) => site.id === selectedSiteId);
    if (!hasSelectedSite) {
      setSelectedSiteId(query.data.defaultSiteId || query.data.sites[0]?.id || "");
    }
  }, [query.data, selectedSiteId, setSelectedSiteId]);

  return query;
}

export function useDashboardSummary() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.summary(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardSummary(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: SUMMARY_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardEventExplorer() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.eventExplorer(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardEventExplorer(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardMap() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.map(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardMap(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardHeatmap(path: string) {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);
  const heatmapMode = useDashboardStore((state) => state.heatmapMode);
  const heatmapClickFilter = useDashboardStore((state) => state.heatmapClickFilter);
  const heatmapViewportSegment = useDashboardStore((state) => state.heatmapViewportSegment);

  return useQuery({
    queryKey: dashboardKeys.heatmap(selectedSiteId, selectedRange, path, heatmapMode, heatmapClickFilter, heatmapViewportSegment),
    queryFn: () => fetchDashboardHeatmap(selectedSiteId, selectedRange, path, heatmapMode, heatmapClickFilter, heatmapViewportSegment),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardAIInsights() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.aiInsight(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardAIInsights(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardNeoThread(enabled = true) {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.neoThread(selectedSiteId),
    queryFn: () => fetchDashboardNeoThread(selectedSiteId),
    enabled: Boolean(selectedSiteId) && enabled,
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardReplaySessions() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.replaySessions(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardReplaySessions(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardErrors() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.errors(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardErrors(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardPerformance() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.performance(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardPerformance(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardReplaySession(sessionId: string) {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.replaySession(selectedSiteId, sessionId),
    queryFn: () => fetchDashboardReplaySession(selectedSiteId, sessionId),
    enabled: Boolean(selectedSiteId && sessionId),
    refetchInterval: false,
    refetchOnWindowFocus: false,
  });
}

export function useDashboardSettings(enabled = true) {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.settings(selectedSiteId),
    queryFn: () => fetchDashboardSettings(selectedSiteId),
    enabled: Boolean(selectedSiteId) && enabled,
    refetchInterval: SETTINGS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardFunnels() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.funnels(selectedSiteId),
    queryFn: () => fetchDashboardFunnels(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardGoals() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.goals(selectedSiteId),
    queryFn: () => fetchDashboardGoals(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardGoalReport() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);

  return useQuery({
    queryKey: dashboardKeys.goalReport(selectedSiteId, selectedRange),
    queryFn: () => fetchDashboardGoalReport(selectedSiteId, selectedRange),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardSharedLinks() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.sharedLinks(selectedSiteId),
    queryFn: () => fetchDashboardSharedLinks(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardAPIKeys() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.apiKeys(selectedSiteId),
    queryFn: () => fetchDashboardAPIKeys(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardReports() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.reports(selectedSiteId),
    queryFn: () => fetchDashboardReports(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

export function useDashboardAlerts() {
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);

  return useQuery({
    queryKey: dashboardKeys.alerts(selectedSiteId),
    queryFn: () => fetchDashboardAlerts(selectedSiteId),
    enabled: Boolean(selectedSiteId),
    refetchInterval: DETAIL_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}

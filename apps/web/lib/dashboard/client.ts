"use client";

import { getClientCSRFToken, withClientCSRFHeaders, setClientCSRFToken } from "@/lib/csrf/client";
import type {
  DashboardAlert,
  DashboardAlertInput,
  DashboardApiKey,
  DashboardApiKeyInput,
  DashboardReportConfig,
  DashboardReportConfigInput,
  DashboardReportDelivery,
  HeatmapClickFilter,
  HeatmapMode,
  HeatmapViewportSegment,
  DashboardMapView,
  DashboardContextResponse,
  DashboardErrorsResponse,
  DashboardPerformanceResponse,
  EventExplorerView,
  FunnelCatalogResponse,
  FunnelDefinition,
  FunnelDefinitionInput,
  FunnelReport,
  GoalDefinition,
  GoalDefinitionInput,
  GoalReportResponse,
  JourneysView,
  RetentionReport,
  RetentionTrendView,
  DashboardSettingsResponse,
  DashboardSummary,
  FunnelEntityList,
  FunnelEntityStatus,
  HeatmapView,
  InsightsView,
  NeoChatThread,
  NeoChatMessage,
  NeoChatRequest,
  NeoChatResponse,
  NeoRollbackRequest,
  ReplaySessionDetail,
  ReplaySessionList,
  RangeKey,
  SharedDashboardLink,
  SharedDashboardLinkInput,
} from "@/lib/dashboard/types";

async function request<T>(path: string, init?: RequestInit) {
  const method = (init?.method ?? "GET").toUpperCase();
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...init,
    headers: {
      ...(method === "GET" || method === "HEAD" || method === "OPTIONS"
        ? init?.headers ?? {}
        : withClientCSRFHeaders(init?.headers)),
    },
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error((payload as { error?: string }).error ?? "Request failed");
  }

  return payload as T;
}

export const dashboardKeys = {
  context: ["dashboard", "context"] as const,
  summary: (siteId: string, range: RangeKey) => ["dashboard", "summary", siteId, range] as const,
  eventExplorer: (siteId: string, range: RangeKey) => ["dashboard", "event-explorer", siteId, range] as const,
  map: (siteId: string, range: RangeKey) => ["dashboard", "map", siteId, range] as const,
  journeys: (siteId: string, range: RangeKey, device: string, country: string) =>
    ["dashboard", "journeys", siteId, range, device, country] as const,
  retention: (siteId: string, range: RangeKey, cadence: string, device: string, country: string) =>
    ["dashboard", "retention", siteId, range, cadence, device, country] as const,
  retentionTrend: (siteId: string, range: RangeKey, cadence: string, device: string, country: string) =>
    ["dashboard", "retention-trend", siteId, range, cadence, device, country] as const,
  heatmap: (
    siteId: string,
    range: RangeKey,
    path: string,
    mode: HeatmapMode,
    clickFilter: HeatmapClickFilter,
    viewport: HeatmapViewportSegment,
  ) => ["dashboard", "heatmap", siteId, range, path, mode, clickFilter, viewport] as const,
  replaySessions: (siteId: string, range: RangeKey) => ["dashboard", "replay-sessions", siteId, range] as const,
  replaySession: (siteId: string, sessionId: string) => ["dashboard", "replay-session", siteId, sessionId] as const,
  aiInsight: (siteId: string, range: RangeKey) => ["dashboard", "ai-insight", siteId, range] as const,
  errors: (siteId: string, range: RangeKey) => ["dashboard", "errors", siteId, range] as const,
  performance: (siteId: string, range: RangeKey) => ["dashboard", "performance", siteId, range] as const,
  settings: (siteId: string) => ["dashboard", "settings", siteId] as const,
  funnels: (siteId: string) => ["dashboard", "funnels", siteId] as const,
  funnelReport: (siteId: string, range: RangeKey, definitionKey: string) =>
    ["dashboard", "funnel-report", siteId, range, definitionKey] as const,
  funnelEntities: (
    siteId: string,
    range: RangeKey,
    definitionKey: string,
    stepIndex: number,
    status: FunnelEntityStatus,
    page: number,
  ) => ["dashboard", "funnel-entities", siteId, range, definitionKey, stepIndex, status, page] as const,
  goals: (siteId: string) => ["dashboard", "goals", siteId] as const,
  goalReport: (siteId: string, range: RangeKey) => ["dashboard", "goal-report", siteId, range] as const,
  sharedLinks: (siteId: string) => ["dashboard", "shared-links", siteId] as const,
  apiKeys: (siteId: string) => ["dashboard", "api-keys", siteId] as const,
  reports: (siteId: string) => ["dashboard", "reports", siteId] as const,
  reportDeliveries: (siteId: string, reportId: string) => ["dashboard", "report-deliveries", siteId, reportId] as const,
  alerts: (siteId: string) => ["dashboard", "alerts", siteId] as const,
  neoThread: (siteId: string) => ["dashboard", "neo-thread", siteId] as const,
};

export function fetchDashboardContext() {
  return request<DashboardContextResponse>("/api/dashboard/context").then((payload) => {
    setClientCSRFToken(payload.csrfToken);
    return payload;
  });
}

export function fetchDashboardSummary(siteId: string, range: RangeKey) {
  return request<DashboardSummary>(
    `/api/dashboard/summary?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardEventExplorer(siteId: string, range: RangeKey) {
  return request<EventExplorerView>(
    `/api/dashboard/events-explorer?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardMap(siteId: string, range: RangeKey) {
  return request<DashboardMapView>(
    `/api/dashboard/map?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardJourneys(
  siteId: string,
  range: RangeKey,
  filters: {
    device?: string;
    country?: string;
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams({
    site: siteId,
    range,
  });
  if (filters.device) {
    params.set("device", filters.device);
  }
  if (filters.country) {
    params.set("country", filters.country);
  }
  if (typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0) {
    params.set("limit", String(Math.round(filters.limit)));
  }
  return request<JourneysView>(`/api/dashboard/journeys?${params.toString()}`);
}

export function fetchDashboardRetention(
  siteId: string,
  range: RangeKey,
  filters: {
    cadence?: string;
    device?: string;
    country?: string;
    limit?: number;
  } = {},
) {
  const params = new URLSearchParams({
    site: siteId,
    range,
  });
  if (filters.cadence) {
    params.set("cadence", filters.cadence);
  }
  if (filters.device) {
    params.set("device", filters.device);
  }
  if (filters.country) {
    params.set("country", filters.country);
  }
  if (typeof filters.limit === "number" && Number.isFinite(filters.limit) && filters.limit > 0) {
    params.set("limit", String(Math.round(filters.limit)));
  }
  return request<RetentionReport>(`/api/dashboard/retention?${params.toString()}`);
}

export function fetchDashboardRetentionTrend(
  siteId: string,
  range: RangeKey,
  filters: {
    cadence?: string;
    device?: string;
    country?: string;
  } = {},
) {
  const params = new URLSearchParams({
    site: siteId,
    range,
  });
  if (filters.cadence) {
    params.set("cadence", filters.cadence);
  }
  if (filters.device) {
    params.set("device", filters.device);
  }
  if (filters.country) {
    params.set("country", filters.country);
  }
  return request<RetentionTrendView>(`/api/dashboard/retention/trend?${params.toString()}`);
}

export function fetchDashboardHeatmap(
  siteId: string,
  range: RangeKey,
  path: string,
  mode: HeatmapMode,
  clickFilter: HeatmapClickFilter,
  viewport: HeatmapViewportSegment,
) {
  const params = new URLSearchParams({
    site: siteId,
    range,
    mode,
    clickFilter,
    viewport,
  });

  if (path) {
    params.set("path", path);
  }

  return request<HeatmapView>(`/api/dashboard/heatmap?${params.toString()}`);
}

export function fetchDashboardReplaySessions(siteId: string, range: RangeKey) {
  return request<ReplaySessionList>(
    `/api/dashboard/replays?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardReplaySession(siteId: string, sessionId: string) {
  return request<ReplaySessionDetail>(
    `/api/dashboard/replay?site=${encodeURIComponent(siteId)}&session=${encodeURIComponent(sessionId)}`,
  );
}

export function fetchDashboardAIInsights(siteId: string, range: RangeKey) {
  return request<InsightsView>(
    `/api/dashboard/ai-insight?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardNeoThread(siteId: string) {
  return request<NeoChatThread>(`/api/dashboard/neo-thread?site=${encodeURIComponent(siteId)}`);
}

export function rollbackDashboardNeoThread(payload: NeoRollbackRequest) {
  return request<NeoChatThread>("/api/dashboard/neo-thread", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function fetchDashboardErrors(siteId: string, range: RangeKey) {
  return request<DashboardErrorsResponse>(
    `/api/dashboard/errors?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardPerformance(siteId: string, range: RangeKey) {
  return request<DashboardPerformanceResponse>(
    `/api/dashboard/performance?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function fetchDashboardSettings(siteId: string) {
  return request<DashboardSettingsResponse>(`/api/dashboard/settings?site=${encodeURIComponent(siteId)}`);
}

type NeoChatStreamEvent =
  | { type: "status"; value: "loading" | "streaming" }
  | { type: "meta"; toolNames: string[] }
  | { type: "delta"; text: string }
  | ({ type: "done" } & NeoChatResponse)
  | { type: "error"; error: string };

export async function streamNeoChatMessage(
  payload: NeoChatRequest,
  callbacks: {
    onStatus?: (value: "loading" | "streaming") => void;
    onMeta?: (toolNames: string[]) => void;
    onDelta?: (text: string) => void;
  } = {},
) {
  if (!getClientCSRFToken()) {
    await fetchDashboardContext();
  }

  const response = await fetch("/api/dashboard/neo-chat", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: withClientCSRFHeaders({
      "Content-Type": "application/json",
      Accept: "application/x-ndjson",
    }),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { error?: string }).error ?? "Neo request failed.");
  }

  if (!response.body) {
    throw new Error("Neo response stream was unavailable.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResponse: NeoChatResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      buffer += decoder.decode();
    } else {
      buffer += decoder.decode(value, { stream: true });
    }

    let boundary = buffer.indexOf("\n");
    while (boundary >= 0) {
      const rawLine = buffer.slice(0, boundary).trim();
      buffer = buffer.slice(boundary + 1);
      if (rawLine) {
        const event = JSON.parse(rawLine) as NeoChatStreamEvent;
        switch (event.type) {
          case "status":
            callbacks.onStatus?.(event.value);
            break;
          case "meta":
            callbacks.onMeta?.(event.toolNames);
            break;
          case "delta":
            callbacks.onDelta?.(event.text);
            break;
          case "done":
            finalResponse = {
              message: event.message,
              userMessage: event.userMessage,
            };
            break;
          case "error":
            throw new Error(event.error);
        }
      }
      boundary = buffer.indexOf("\n");
    }

    if (done) {
      break;
    }
  }

  if (!finalResponse) {
    throw new Error("Neo stream ended before the final message arrived.");
  }

  return finalResponse;
}

export function fetchDashboardFunnels(siteId: string) {
  return request<FunnelCatalogResponse>(`/api/dashboard/funnels?site=${encodeURIComponent(siteId)}`);
}

export function fetchDashboardGoals(siteId: string) {
  return request<GoalDefinition[]>(`/api/dashboard/goals?site=${encodeURIComponent(siteId)}`);
}

export function fetchDashboardGoalReport(siteId: string, range: RangeKey) {
  return request<GoalReportResponse>(
    `/api/dashboard/goals/report?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
  );
}

export function createDashboardGoal(siteId: string, input: GoalDefinitionInput) {
  return request<GoalDefinition>(`/api/dashboard/goals?site=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDashboardGoal(siteId: string, goalId: string, input: GoalDefinitionInput) {
  return request<GoalDefinition>(
    `/api/dashboard/goals/${encodeURIComponent(goalId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function deleteDashboardGoal(siteId: string, goalId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/goals/${encodeURIComponent(goalId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchDashboardSharedLinks(siteId: string) {
  return request<SharedDashboardLink[]>(
    `/api/dashboard/shared-links?site=${encodeURIComponent(siteId)}`,
  );
}

export function createDashboardSharedLink(siteId: string, input: SharedDashboardLinkInput) {
  return request<SharedDashboardLink>(
    `/api/dashboard/shared-links?site=${encodeURIComponent(siteId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function deleteDashboardSharedLink(siteId: string, linkId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/shared-links/${encodeURIComponent(linkId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchDashboardAPIKeys(siteId: string) {
  return request<DashboardApiKey[]>(`/api/dashboard/api-keys?site=${encodeURIComponent(siteId)}`);
}

export function createDashboardAPIKey(siteId: string, input: DashboardApiKeyInput) {
  return request<DashboardApiKey>(`/api/dashboard/api-keys?site=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteDashboardAPIKey(siteId: string, keyId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/api-keys/${encodeURIComponent(keyId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchDashboardReports(siteId: string) {
  return request<DashboardReportConfig[]>(`/api/dashboard/reports?site=${encodeURIComponent(siteId)}`);
}

export function createDashboardReport(siteId: string, input: DashboardReportConfigInput) {
  return request<DashboardReportConfig>(
    `/api/dashboard/reports?site=${encodeURIComponent(siteId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function updateDashboardReport(siteId: string, reportId: string, input: DashboardReportConfigInput) {
  return request<DashboardReportConfig>(
    `/api/dashboard/reports/${encodeURIComponent(reportId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function deleteDashboardReport(siteId: string, reportId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/reports/${encodeURIComponent(reportId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchDashboardReportDeliveries(siteId: string, reportId: string) {
  return request<DashboardReportDelivery[]>(
    `/api/dashboard/reports/${encodeURIComponent(reportId)}/history?site=${encodeURIComponent(siteId)}`,
  );
}

export function createDashboardFunnel(siteId: string, input: FunnelDefinitionInput) {
  return request<FunnelDefinition>(`/api/dashboard/funnels?site=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDashboardFunnel(siteId: string, funnelId: string, input: FunnelDefinitionInput) {
  return request<FunnelDefinition>(
    `/api/dashboard/funnels/${encodeURIComponent(funnelId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function deleteDashboardFunnel(siteId: string, funnelId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/funnels/${encodeURIComponent(funnelId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

export function fetchDashboardFunnelReport(siteId: string, range: RangeKey, input: FunnelDefinitionInput) {
  return request<FunnelReport>(
    `/api/dashboard/funnels/report?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(range)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function fetchDashboardFunnelEntities(
  siteId: string,
  range: RangeKey,
  stepIndex: number,
  status: FunnelEntityStatus,
  page: number,
  input: FunnelDefinitionInput,
) {
  const params = new URLSearchParams({
    site: siteId,
    range,
    step: String(stepIndex),
    status,
    page: String(page),
  });

  return request<FunnelEntityList>(`/api/dashboard/funnels/entities?${params.toString()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

/* ------------------------------------------------------------------ */
/*  Heatmap screenshot regeneration                                    */
/* ------------------------------------------------------------------ */

export function requestHeatmapDOMRefresh(
  siteId: string,
  options: {
    path?: string;
    scope?: "path" | "site";
  } = {},
) {
  return request<{
    ok: boolean;
    path: string;
    scope: "path" | "site";
    requestId?: string;
    requestedAt?: string;
    origin?: string;
    discovered?: number;
    captured?: number;
    failed?: number;
    note?: string;
    sampleErrors?: string[];
  }>(
    `/api/sites/${encodeURIComponent(siteId)}/heatmaps/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: options.path ?? "/",
        scope: options.scope ?? "site",
      }),
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Alerts                                                             */
/* ------------------------------------------------------------------ */

export function fetchDashboardAlerts(siteId: string) {
  return request<DashboardAlert[]>(`/api/dashboard/alerts?site=${encodeURIComponent(siteId)}`);
}

export function createDashboardAlert(siteId: string, input: DashboardAlertInput) {
  return request<DashboardAlert>(`/api/dashboard/alerts?site=${encodeURIComponent(siteId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateDashboardAlert(siteId: string, alertId: string, input: DashboardAlertInput) {
  return request<DashboardAlert>(
    `/api/dashboard/alerts/${encodeURIComponent(alertId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
}

export function deleteDashboardAlert(siteId: string, alertId: string) {
  return request<{ ok: boolean }>(
    `/api/dashboard/alerts/${encodeURIComponent(alertId)}?site=${encodeURIComponent(siteId)}`,
    {
      method: "DELETE",
    },
  );
}

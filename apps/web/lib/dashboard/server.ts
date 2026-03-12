import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import type {
  HeatmapClickFilter,
  HeatmapMode,
  HeatmapViewportSegment,
  DashboardContextResponse,
  DashboardErrorsResponse,
  DashboardPerformanceResponse,
  DashboardImportJob,
  DashboardImportPreview,
  DashboardExportEvent,
  EventExplorerView,
  EventNameMetric,
  FunnelDefinitionInput,
  FunnelEntityList,
  FunnelEntityStatus,
  FunnelReport,
  GoalReportResponse,
  JourneysView,
  DashboardMapView,
  RetentionReport,
  RetentionTrendView,
  DashboardSettingsResponse,
  DashboardSummary,
  HeatmapView,
  InsightsView,
  ReplaySessionDetail,
  ReplaySessionList,
  RangeKey,
} from "@/lib/dashboard/types";
import { DASHBOARD_TOKEN_COOKIE, DEFAULT_DASHBOARD_TOKEN } from "@/lib/session";

const API_BASE_URL = process.env.ANLTICSHEAT_API_BASE_URL?.replace(/\/$/, "");

function configuredAnalyticsServiceTokens() {
  const explicit = Array.from(
    new Set(
      [process.env.ANLTICSHEAT_ANALYTICS_SERVICE_TOKEN, process.env.ANLTICSHEAT_DASHBOARD_TOKEN]
        .map((token) => (token ?? "").trim())
        .filter(Boolean),
    ),
  );

  if (explicit.length > 0) {
    return explicit;
  }

  const fallback = DEFAULT_DASHBOARD_TOKEN.trim();
  return fallback ? [fallback] : [];
}

function apiBaseURL() {
  if (!API_BASE_URL) {
    throw new Error("ANLTICSHEAT_API_BASE_URL is required for live analytics.");
  }
  return API_BASE_URL;
}

function normalizeRange(value: string | null): RangeKey {
  if (value && value.startsWith("custom:")) {
    return value as RangeKey;
  }
  if (value === "24h" || value === "30d") {
    return value;
  }
  return "7d";
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function proxy<T>(path: string, token: string): Promise<T> {
  return proxyWithInit<T>(path, token, {});
}

async function proxyWithInit<T>(path: string, token: string, init: RequestInit): Promise<T> {
  const headers = {
    ...authHeaders(token),
    ...(init.headers ?? {}),
  };
  const response = await fetch(`${apiBaseURL()}${path}`, {
    cache: "no-store",
    ...init,
    headers,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorPayload = payload as { error?: string; message?: string };
    throw new Error(errorPayload.error ?? errorPayload.message ?? "Request failed");
  }
  return payload as T;
}

export async function readDashboardToken() {
  const cookieStore = await cookies();
  return cookieStore.get(DASHBOARD_TOKEN_COOKIE)?.value ?? "";
}

export function analyticsProxyEnabled() {
  return Boolean(API_BASE_URL);
}

export function analyticsServiceToken() {
  return configuredAnalyticsServiceTokens()[0] ?? "";
}

export function analyticsServiceTokens() {
  return configuredAnalyticsServiceTokens();
}

export async function withAnalyticsTokenFallback<T>(request: (token: string) => Promise<T>) {
  const tokens = configuredAnalyticsServiceTokens();
  if (!tokens.length) {
    throw new Error("ANLTICSHEAT_ANALYTICS_SERVICE_TOKEN is required.");
  }

  let lastError: unknown = null;
  for (const token of tokens) {
    try {
      return await request(token);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error("Request failed");
}

export async function verifyDashboardToken(token: string) {
  if (!token) {
    return false;
  }

  if (!analyticsProxyEnabled()) {
    return false;
  }

  try {
    await proxy<DashboardContextResponse>("/api/v1/dashboard/context", token);
    return true;
  } catch {
    return false;
  }
}

export function unauthorized(message = "Dashboard session required") {
  return NextResponse.json({ error: message }, { status: 401 });
}

export async function getDashboardContext(token: string) {
  return proxy<DashboardContextResponse>("/api/v1/dashboard/context", token);
}

export async function getDashboardSummaryData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<DashboardSummary>(
    `/api/v1/dashboard/summary?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardMapData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<DashboardMapView>(
    `/api/v1/dashboard/map?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardJourneysData(
  siteId: string,
  range: string,
  filters: {
    device?: string;
    country?: string;
    limit?: number;
  },
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  const params = new URLSearchParams({
    site: siteId,
    range: normalizedRange,
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
  return proxy<JourneysView>(`/api/v1/dashboard/journeys?${params.toString()}`, token);
}

export async function getDashboardRetentionData(
  siteId: string,
  range: string,
  filters: {
    cadence?: string;
    device?: string;
    country?: string;
    limit?: number;
  },
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  const params = new URLSearchParams({
    site: siteId,
    range: normalizedRange,
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
  return proxy<RetentionReport>(`/api/v1/dashboard/retention?${params.toString()}`, token);
}

export async function getDashboardRetentionTrendData(
  siteId: string,
  range: string,
  filters: {
    cadence?: string;
    device?: string;
    country?: string;
  },
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  const params = new URLSearchParams({
    site: siteId,
    range: normalizedRange,
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
  return proxy<RetentionTrendView>(`/api/v1/dashboard/retention/trend?${params.toString()}`, token);
}

export async function getDashboardHeatmapData(
  siteId: string,
  path: string | null,
  range: string,
  mode: HeatmapMode,
  clickFilter: HeatmapClickFilter,
  viewportSegment: HeatmapViewportSegment,
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  const params = new URLSearchParams({
    site: siteId,
    range: normalizedRange,
    mode,
    clickFilter,
    viewport: viewportSegment,
  });
  if (path) {
    params.set("path", path);
  }
  return proxy<HeatmapView>(`/api/v1/dashboard/heatmap?${params.toString()}`, token);
}

export async function getDashboardReplaySessionsData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<ReplaySessionList>(
    `/api/v1/dashboard/replays?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardReplaySessionData(siteId: string, sessionId: string, token: string) {
  return proxy<ReplaySessionDetail>(
    `/api/v1/dashboard/replay?site=${encodeURIComponent(siteId)}&session=${encodeURIComponent(sessionId)}`,
    token,
  );
}

export async function getDashboardInsightsData(siteId: string, range: string, token: string) {
  return getDashboardAIInsightsData(siteId, range, token);
}

export async function getDashboardAIInsightsData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<InsightsView>(
    `/api/v1/dashboard/ai-insight?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardErrorsData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<DashboardErrorsResponse>(
    `/api/v1/dashboard/errors?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardPerformanceData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<DashboardPerformanceResponse>(
    `/api/v1/dashboard/performance?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardSettingsData(siteId: string, origin: string, token: string) {
  void origin;
  return proxy<DashboardSettingsResponse>(
    `/api/v1/dashboard/settings?site=${encodeURIComponent(siteId)}`,
    token,
  );
}

export async function previewDashboardImport(
  siteId: string,
  payload: {
    platform: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
    mapping?: Record<string, string>;
    importTimezone?: string;
  },
  token: string,
) {
  return proxyWithInit<DashboardImportPreview>(
    `/api/v1/dashboard/imports/preview?site=${encodeURIComponent(siteId)}`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function createDashboardImport(
  siteId: string,
  payload: {
    platform: string;
    fileName: string;
    contentType: string;
    contentBase64: string;
    mapping?: Record<string, string>;
    importTimezone?: string;
    userId?: string;
  },
  token: string,
) {
  return proxyWithInit<DashboardImportJob>(
    `/api/v1/dashboard/imports?site=${encodeURIComponent(siteId)}`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(payload.userId ? { "X-User-ID": payload.userId } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function listDashboardImportJobs(siteId: string, token: string) {
  const response = await proxy<{ jobs: DashboardImportJob[] }>(
    `/api/v1/dashboard/imports?site=${encodeURIComponent(siteId)}`,
    token,
  );
  return response.jobs ?? [];
}

export async function getDashboardImportJob(siteId: string, importId: string, token: string) {
  return proxy<DashboardImportJob>(
    `/api/v1/dashboard/imports/${encodeURIComponent(importId)}?site=${encodeURIComponent(siteId)}`,
    token,
  );
}

export async function getDashboardFunnelReportData(
  siteId: string,
  range: string,
  definition: FunnelDefinitionInput,
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  return proxyWithInit<FunnelReport>(
    `/api/v1/dashboard/funnel?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(definition),
    },
  );
}

export async function getDashboardFunnelEntitiesData(
  siteId: string,
  range: string,
  stepIndex: number,
  status: FunnelEntityStatus,
  page: number,
  definition: FunnelDefinitionInput,
  token: string,
) {
  const normalizedRange = normalizeRange(range);
  const params = new URLSearchParams({
    site: siteId,
    range: normalizedRange,
    step: String(stepIndex),
    status,
    page: String(page),
  });

  return proxyWithInit<FunnelEntityList>(`/api/v1/dashboard/funnel/entities?${params.toString()}`, token, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(definition),
  });
}

export async function getDashboardEventNamesData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<EventNameMetric[]>(
    `/api/v1/dashboard/events?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardEventExplorerData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<EventExplorerView>(
    `/api/v1/dashboard/events/explorer?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardGoalsReportData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<GoalReportResponse>(
    `/api/v1/dashboard/goals/report?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}`,
    token,
  );
}

export async function getDashboardExportEventsData(siteId: string, range: string, token: string) {
  const normalizedRange = normalizeRange(range);
  return proxy<DashboardExportEvent[]>(
    `/api/v1/dashboard/export/events?site=${encodeURIComponent(siteId)}&range=${encodeURIComponent(normalizedRange)}&format=json`,
    token,
  );
}

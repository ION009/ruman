import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import type {
  FunnelDefinitionInput,
  FunnelEntityStatus,
  RangeKey,
} from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardFunnelEntitiesData,
  readDashboardToken,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizeRange(value: string): RangeKey {
  if (value.startsWith("custom:")) {
    return value as RangeKey;
  }
  if (value === "24h" || value === "30d") {
    return value;
  }
  return "7d";
}

function normalizeInput(payload: Partial<FunnelDefinitionInput>): FunnelDefinitionInput {
  return {
    name: payload.name ?? "",
    countMode: payload.countMode === "sessions" ? "sessions" : "visitors",
    windowMinutes: Number(payload.windowMinutes ?? 30),
    steps: Array.isArray(payload.steps) ? payload.steps : [],
  };
}

function normalizeStatus(value: string | null): FunnelEntityStatus {
  if (value === "entered") return "entered";
  return value === "dropped" ? "dropped" : "reached";
}

export async function POST(request: Request) {
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const range = normalizeRange(searchParams.get("range") ?? "7d");
  const stepIndex = Number(searchParams.get("step") ?? "0");
  const status = normalizeStatus(searchParams.get("status"));
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const payload = normalizeInput(
    (await request.json().catch(() => ({}))) as Partial<FunnelDefinitionInput>,
  );

  if (!analyticsProxyEnabled()) {
    return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
  }

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      const entities = await withAnalyticsTokenFallback((token) =>
        getDashboardFunnelEntitiesData(site.id, range, stepIndex, status, page, payload, token),
      );
      return Response.json(entities);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to inspect funnel entities." },
        { status: 400 },
      );
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  try {
    const entities = await getDashboardFunnelEntitiesData(
      requestedSiteId,
      range,
      stepIndex,
      status,
      page,
      payload,
      token,
    );
    return Response.json(entities);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to inspect funnel entities." },
      { status: 502 },
    );
  }
}

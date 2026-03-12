import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import type { FunnelDefinitionInput, RangeKey } from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardFunnelReportData,
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

export async function POST(request: Request) {
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const range = normalizeRange(searchParams.get("range") ?? "7d");
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
      const report = await withAnalyticsTokenFallback((token) =>
        getDashboardFunnelReportData(site.id, range, payload, token),
      );
      return Response.json(report);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to analyze funnel." },
        { status: 400 },
      );
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  try {
    const report = await getDashboardFunnelReportData(requestedSiteId, range, payload, token);
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to analyze funnel." },
      { status: 502 },
    );
  }
}

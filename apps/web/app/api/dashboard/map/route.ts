import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import type { RangeKey } from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardMapData,
  readDashboardToken,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizeRange(value: string): RangeKey {
  if (value === "24h" || value === "30d") return value;
  return "7d";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const range = normalizeRange(searchParams.get("range") ?? "7d");

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);

      if (!analyticsProxyEnabled()) {
        return Response.json(
          { error: "Analytics proxy is not configured." },
          { status: 503 },
        );
      }

      try {
        return Response.json(
          await withAnalyticsTokenFallback((token) =>
            getDashboardMapData(site.id, range, token),
          ),
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? `Analytics proxy failed: ${error.message}` : "Analytics proxy failed." },
          { status: 502 },
        );
      }
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        return Response.json({ error: error instanceof Error ? error.message : "Authentication required." }, { status: 401 });
      }
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  if (!analyticsProxyEnabled()) {
    return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
  }

  try {
    return Response.json(await getDashboardMapData(requestedSiteId, range, token));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 502 });
  }
}

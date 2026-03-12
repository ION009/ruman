import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import {
  analyticsProxyEnabled,
  getDashboardReplaySessionData,
  readDashboardToken,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const sessionId = searchParams.get("session") ?? "";

  if (!sessionId) {
    return Response.json({ error: "session is required." }, { status: 400 });
  }

  if (isControlPlaneEnabled()) {
    try {
      const viewer = await requireCurrentSession();
      const site = await requireUserSite(viewer.user.id, requestedSiteId);

      if (!analyticsProxyEnabled()) {
        return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
      }

      try {
        return Response.json(
          await withAnalyticsTokenFallback((token) => getDashboardReplaySessionData(site.id, sessionId, token)),
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
    return Response.json(await getDashboardReplaySessionData(requestedSiteId, sessionId, token));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 502 });
  }
}

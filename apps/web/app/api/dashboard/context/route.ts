import { cookies } from "next/headers";

import { listSitesForUser, requireCurrentSession } from "@/lib/control-plane/auth";
import { issueCSRFToken } from "@/lib/csrf/server";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { getDashboardContext, readDashboardToken, analyticsProxyEnabled } from "@/lib/dashboard/server";
import { AUTH_SESSION_COOKIE, DASHBOARD_TOKEN_COOKIE, isControlPlaneEnabled } from "@/lib/session";

export async function GET() {
  const cookieStore = await cookies();
  const csrfToken = issueCSRFToken({
    authSession: cookieStore.get(AUTH_SESSION_COOKIE)?.value,
    dashboardToken: cookieStore.get(DASHBOARD_TOKEN_COOKIE)?.value,
  });

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const sites = await listSitesForUser(session.user.id);

      return Response.json({
        product: "AnlticsHeat",
        mode: "control-plane",
        defaultSiteId: sites[0]?.id ?? "",
        sites: sites.map((site) => ({
          id: site.id,
          name: site.name,
          origins: site.origins,
        })),
        ranges: ["24h", "7d", "30d"],
        csrfToken,
        viewer: session.user,
      });
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
    return Response.json({
      ...(await getDashboardContext(token)),
      mode: "token",
      csrfToken,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 502 });
  }
}

import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import {
  analyticsProxyEnabled,
  getDashboardImportJob,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Imports require the control plane database." }, { status: 404 });
  }

  try {
    const session = await requireCurrentSession();
    const url = new URL(request.url);
    const siteId = url.searchParams.get("site") ?? "";
    const { importId } = await params;
    await requireUserSite(session.user.id, siteId);

    if (!analyticsProxyEnabled()) {
      return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
    }

    const job = await withAnalyticsTokenFallback((token) => getDashboardImportJob(siteId, importId, token));
    return Response.json(job);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load import job." },
      { status: 400 },
    );
  }
}

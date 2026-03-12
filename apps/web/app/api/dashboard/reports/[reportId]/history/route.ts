import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { listReportDeliveries } from "@/lib/control-plane/reports";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Reports require the control plane database." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    const { reportId } = await params;
    return Response.json(await listReportDeliveries(site.id, reportId));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load report history." },
      { status: 400 },
    );
  }
}

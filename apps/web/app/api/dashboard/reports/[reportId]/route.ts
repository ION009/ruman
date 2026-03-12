import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { deleteReport, updateReport } from "@/lib/control-plane/reports";
import { validateRequestCSRF } from "@/lib/csrf/server";
import type { DashboardReportConfigInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ reportId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Reports require the control plane database." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireSiteMutationAccess(session.user.id, requestedSiteId);
    const { reportId } = await params;
    const payload = (await request.json().catch(() => ({}))) as Partial<DashboardReportConfigInput>;
    const report = await updateReport(site.id, reportId, {
      name: payload.name ?? "",
      frequency: payload.frequency ?? "weekly",
      deliveryTime: payload.deliveryTime ?? "08:00",
      timezone: payload.timezone ?? "UTC",
      recipients: payload.recipients ?? [],
      includeSections: payload.includeSections ?? ["overview", "goals", "insights"],
      compareEnabled: payload.compareEnabled ?? true,
      enabled: payload.enabled ?? true,
      note: payload.note ?? null,
    });
    return Response.json(report);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update report." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Reports require the control plane database." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireSiteMutationAccess(session.user.id, requestedSiteId);
    const { reportId } = await params;
    await deleteReport(site.id, reportId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete report." },
      { status: 400 },
    );
  }
}

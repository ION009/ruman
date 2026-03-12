import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { deleteAlert, updateAlert } from "@/lib/control-plane/alerts";
import type { DashboardAlertInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ alertId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Alerts require the control plane database." }, { status: 404 });
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
    const { alertId } = await params;
    const payload = (await request.json().catch(() => ({}))) as Partial<DashboardAlertInput>;
    const alert = await updateAlert(site.id, alertId, {
      name: payload.name ?? "",
      metric: payload.metric ?? "pageviews",
      condition: payload.condition ?? "above",
      threshold: Number(payload.threshold ?? 0),
      period: payload.period ?? "24h",
      webhookUrl: payload.webhookUrl ?? "",
      enabled: payload.enabled ?? true,
    });
    return Response.json(alert);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update alert." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Alerts require the control plane database." }, { status: 404 });
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
    const { alertId } = await params;
    await deleteAlert(site.id, alertId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete alert." }, { status: 400 });
  }
}

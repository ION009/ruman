import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { createAlert, listAlerts } from "@/lib/control-plane/alerts";
import type { DashboardAlertInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Alerts require the control plane database." }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    return Response.json(await listAlerts(site.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to load alerts." }, { status: 400 });
  }
}

export async function POST(request: Request) {
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
    const payload = (await request.json().catch(() => ({}))) as Partial<DashboardAlertInput>;
    const alert = await createAlert(site.id, {
      name: payload.name ?? "",
      metric: payload.metric ?? "pageviews",
      condition: payload.condition ?? "above",
      threshold: Number(payload.threshold ?? 0),
      period: payload.period ?? "24h",
      webhookUrl: payload.webhookUrl ?? "",
      enabled: payload.enabled ?? true,
    });
    return Response.json(alert, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create alert." }, { status: 400 });
  }
}

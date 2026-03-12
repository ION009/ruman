import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { createReport, listReports } from "@/lib/control-plane/reports";
import { validateRequestCSRF } from "@/lib/csrf/server";
import type { DashboardReportConfigInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Reports require the control plane database." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    return Response.json(await listReports(site.id));
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to load reports." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
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
    const payload = (await request.json().catch(() => ({}))) as Partial<DashboardReportConfigInput>;
    const report = await createReport(site.id, {
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
    return Response.json(report, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create report." },
      { status: 400 },
    );
  }
}

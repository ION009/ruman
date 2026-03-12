import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import {
  deleteFunnelDefinition,
  updateFunnelDefinition,
} from "@/lib/control-plane/funnels";
import type { FunnelDefinitionInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ funnelId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Saved funnels require the control plane database." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    const { funnelId } = await params;
    const payload = (await request.json().catch(() => ({}))) as Partial<FunnelDefinitionInput>;
    const definition = await updateFunnelDefinition(site.id, funnelId, {
      name: payload.name ?? "",
      countMode: payload.countMode === "sessions" ? "sessions" : "visitors",
      windowMinutes: Number(payload.windowMinutes ?? 30),
      steps: Array.isArray(payload.steps) ? payload.steps : [],
    });

    return Response.json(definition);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update funnel." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Saved funnels require the control plane database." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    const { funnelId } = await params;
    await deleteFunnelDefinition(site.id, funnelId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete funnel." },
      { status: 400 },
    );
  }
}

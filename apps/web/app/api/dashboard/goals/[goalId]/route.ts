import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { deleteGoal, updateGoal } from "@/lib/control-plane/goals";
import type { GoalDefinitionInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ goalId: string }>;
};

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Goals require the control plane database." }, { status: 404 });
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
    const { goalId } = await params;
    const payload = (await request.json().catch(() => ({}))) as Partial<GoalDefinitionInput>;
    const goal = await updateGoal(site.id, goalId, {
      name: payload.name ?? "",
      type: payload.type === "event" ? "event" : "pageview",
      match: payload.match === "prefix" || payload.match === "contains" ? payload.match : "exact",
      value: payload.value ?? "",
      category: payload.category ?? null,
      currency: payload.currency ?? null,
    });
    return Response.json(goal);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update goal." }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Goals require the control plane database." }, { status: 404 });
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
    const { goalId } = await params;
    await deleteGoal(site.id, goalId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete goal." }, { status: 400 });
  }
}

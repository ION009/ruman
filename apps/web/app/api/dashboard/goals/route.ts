import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { createGoal, listGoals } from "@/lib/control-plane/goals";
import type { GoalDefinitionInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Goals require the control plane database." }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    return Response.json(await listGoals(site.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to load goals." }, { status: 400 });
  }
}

export async function POST(request: Request) {
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
    const payload = (await request.json().catch(() => ({}))) as Partial<GoalDefinitionInput>;
    const goal = await createGoal(site.id, {
      name: payload.name ?? "",
      type: payload.type === "event" ? "event" : "pageview",
      match: payload.match === "prefix" || payload.match === "contains" ? payload.match : "exact",
      value: payload.value ?? "",
      category: payload.category ?? null,
      currency: payload.currency ?? null,
    });
    return Response.json(goal, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create goal." }, { status: 400 });
  }
}

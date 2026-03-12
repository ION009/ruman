import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { createAPIKey, listAPIKeys } from "@/lib/control-plane/api-keys";
import type { DashboardApiKeyInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "API keys require the control plane database." }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    return Response.json(await listAPIKeys(site.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to load API keys." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "API keys require the control plane database." }, { status: 404 });
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
    const payload = (await request.json().catch(() => ({}))) as Partial<DashboardApiKeyInput>;
    const apiKey = await createAPIKey(site.id, {
      name: payload.name ?? "",
      permissions: payload.permissions ?? "read",
    });
    return Response.json(apiKey, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create API key." }, { status: 400 });
  }
}

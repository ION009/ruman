import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { createSharedLink, listSharedLinks } from "@/lib/control-plane/shared-links";
import type { SharedDashboardLinkInput } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Shared links require the control plane database." }, { status: 404 });
  }
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    return Response.json(await listSharedLinks(site.id));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to load shared links." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Shared links require the control plane database." }, { status: 404 });
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
    const payload = (await request.json().catch(() => ({}))) as Partial<SharedDashboardLinkInput>;
    const sharedLink = await createSharedLink(site.id, { password: payload.password ?? "" });
    return Response.json(sharedLink, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create shared link." }, { status: 400 });
  }
}

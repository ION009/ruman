import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { deleteSharedLink } from "@/lib/control-plane/shared-links";
import { isControlPlaneEnabled } from "@/lib/session";

type RouteContext = {
  params: Promise<{ linkId: string }>;
};

export async function DELETE(request: Request, { params }: RouteContext) {
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
    const { linkId } = await params;
    await deleteSharedLink(site.id, linkId);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete shared link." }, { status: 400 });
  }
}

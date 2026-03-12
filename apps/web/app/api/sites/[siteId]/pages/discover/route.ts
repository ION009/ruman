import { NextRequest, NextResponse } from "next/server";

import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { discoverAndStoreSitePages } from "@/lib/control-plane/site-page-discovery";
import { isControlPlaneEnabled } from "@/lib/session";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.error }, { status: 403 });
  }

  try {
    const session = await requireCurrentSession();
    const { siteId } = await params;
    const payload = (await request.json().catch(() => ({}))) as { origin?: string };

    const site = await requireSiteMutationAccess(session.user.id, siteId);
    const origin = payload.origin?.trim() || site.origins[0] || "";
    if (!origin) {
      return NextResponse.json(
        { error: "No valid site origin available for page discovery." },
        { status: 400 },
      );
    }

    const result = await discoverAndStoreSitePages(site.id, origin);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to re-scan sitemap." },
      { status: 400 },
    );
  }
}

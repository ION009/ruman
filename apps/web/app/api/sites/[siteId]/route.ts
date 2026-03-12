import { NextRequest, NextResponse } from "next/server";

import { archiveSiteForUser, requireCurrentSession, requireUserSite, updateSiteForUser } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ siteId: string }> },
) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  try {
    const session = await requireCurrentSession();
    const { siteId } = await params;
    const site = await requireUserSite(session.user.id, siteId);
    return NextResponse.json({ site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load site." },
      { status: 400 },
    );
  }
}

export async function PATCH(
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
    const payload = (await request.json().catch(() => ({}))) as { name?: string };
    const site = await updateSiteForUser(session.user.id, siteId, { name: payload.name ?? "" }, {
      requestOrigin: new URL(request.url).origin,
    });
    return NextResponse.json({ ok: true, site });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update site." },
      { status: 400 },
    );
  }
}

export async function DELETE(
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
    await archiveSiteForUser(session.user.id, siteId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to archive site." },
      { status: 400 },
    );
  }
}

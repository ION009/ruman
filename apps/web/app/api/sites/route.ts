import { NextRequest, NextResponse } from "next/server";

import { createSiteForUser, listSitesForUser, requireCurrentSession } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET() {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  try {
    const session = await requireCurrentSession();
    const sites = await listSitesForUser(session.user.id);
    return NextResponse.json({ sites });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load sites." },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.error }, { status: 403 });
  }

  try {
    const session = await requireCurrentSession();
    const payload = (await request.json().catch(() => ({}))) as { name?: string; origin?: string; domain?: string };
    const siteId = await createSiteForUser(session.user.id, {
      name: payload.name ?? "",
      origin: payload.origin ?? payload.domain ?? "",
      domain: payload.domain ?? "",
    }, {
      requestOrigin: new URL(request.url).origin,
    });

    return NextResponse.json({ ok: true, siteId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to register site." },
      { status: 400 },
    );
  }
}

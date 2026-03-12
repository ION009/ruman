import { NextRequest, NextResponse } from "next/server";

import { requireCurrentSession, updateViewerProfile } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function PATCH(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.error }, { status: 403 });
  }

  try {
    const session = await requireCurrentSession();
    const payload = (await request.json().catch(() => ({}))) as { fullName?: string };
    await updateViewerProfile(session.user.id, payload.fullName ?? "");
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update profile." },
      { status: 400 },
    );
  }
}

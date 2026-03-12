import { NextRequest, NextResponse } from "next/server";

import { requireCurrentSession, updateSitePrivacySettingsForUser } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

type PrivacyPayload = {
  domSnapshotsEnabled?: boolean;
  visitorCookieEnabled?: boolean;
};

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
    const payload = (await request.json().catch(() => ({}))) as PrivacyPayload;
    const privacy = await updateSitePrivacySettingsForUser(
      session.user.id,
      siteId,
      {
        domSnapshotsEnabled: payload.domSnapshotsEnabled,
        visitorCookieEnabled: payload.visitorCookieEnabled,
      },
      { requestOrigin: new URL(request.url).origin },
    );

    return NextResponse.json({ ok: true, privacy });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update privacy settings." },
      { status: 400 },
    );
  }
}

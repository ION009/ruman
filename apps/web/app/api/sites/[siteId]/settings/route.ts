import { NextRequest, NextResponse } from "next/server";

import { getSiteSettingsForUser, requireCurrentSession, updateSiteSettingsForUser } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

type SiteSettingsPayload = {
  tracking?: {
    blockBotTrafficEnabled?: boolean;
    domSnapshotsEnabled?: boolean;
    visitorCookieEnabled?: boolean;
    replayMaskTextEnabled?: boolean;
    spaTrackingEnabled?: boolean;
    errorTrackingEnabled?: boolean;
    performanceTrackingEnabled?: boolean;
  };
  retention?: {
    eventsDays?: number | null;
    heatmapDays?: number | null;
    replayDays?: number | null;
    insightsDays?: number | null;
  };
  importDefaults?: {
    mapping?: Record<string, string>;
    timezone?: string;
  };
};

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
    const settings = await getSiteSettingsForUser(session.user.id, siteId);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load site settings." },
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
    const payload = (await request.json().catch(() => ({}))) as SiteSettingsPayload;
    const settings = await updateSiteSettingsForUser(session.user.id, siteId, payload, {
      requestOrigin: new URL(request.url).origin,
    });

    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update site settings." },
      { status: 400 },
    );
  }
}

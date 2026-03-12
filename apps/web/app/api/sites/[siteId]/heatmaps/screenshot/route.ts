import { NextRequest, NextResponse } from "next/server";

import { requireCurrentSession, requireSiteMutationAccess, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import {
  deleteHeatmapScreenshot,
  readHeatmapScreenshot,
  upsertHeatmapScreenshot,
} from "@/lib/control-plane/heatmap-screenshots";
import { queueHeatmapDomRefresh } from "@/lib/control-plane/heatmap-dom-refresh";
import { getSitePrivacySettings } from "@/lib/control-plane/site-settings";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  try {
    const session = await requireCurrentSession();
    const { siteId } = await params;
    const { searchParams } = new URL(request.url);
    const path = searchParams.get("path") ?? "/";

    const site = await requireSiteMutationAccess(session.user.id, siteId);
    const screenshot = await readHeatmapScreenshot(site.id, path);
    return NextResponse.json({ screenshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load screenshot." },
      { status: 400 },
    );
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
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
    const payload = (await request.json().catch(() => ({}))) as {
      path?: string;
      screenshot?: string;
      captureUrl?: string;
    };
    const path = payload.path ?? "/";
    const screenshotInput = payload.screenshot ?? "";
    const captureUrl = payload.captureUrl ?? "";

    const site = await requireSiteMutationAccess(session.user.id, siteId);

    if (captureUrl.trim()) {
      const privacy = await getSitePrivacySettings(site.id);
      if (!privacy.domSnapshotsEnabled) {
        return NextResponse.json(
          { error: "Enable DOM snapshots for this site before requesting a refresh." },
          { status: 400 },
        );
      }

      const queued = await queueHeatmapDomRefresh(site.id, path);
      return NextResponse.json({
        path: queued.path,
        requestId: queued.requestId,
        requestedAt: queued.requestedAt,
        note: "Refresh requested. A live tracker on this page will upload a fresh DOM snapshot automatically.",
      });
    }

    const screenshot = await upsertHeatmapScreenshot(site.id, path, screenshotInput);
    return NextResponse.json({ screenshot });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save screenshot." },
      { status: 400 },
    );
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
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
    const payload = (await request.json().catch(() => ({}))) as { path?: string };

    const site = await requireSiteMutationAccess(session.user.id, siteId);
    const privacy = await getSitePrivacySettings(site.id);
    if (!privacy.domSnapshotsEnabled) {
      return NextResponse.json(
        { error: "Enable DOM snapshots for this site before requesting a refresh." },
        { status: 400 },
      );
    }

    const queued = await queueHeatmapDomRefresh(site.id, payload.path ?? "/");
    return NextResponse.json({
      ok: true,
      path: queued.path,
      requestId: queued.requestId,
      requestedAt: queued.requestedAt,
      note: "Refresh requested. A live tracker on this page will upload a fresh DOM snapshot automatically.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to request heatmap refresh." },
      { status: 400 },
    );
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
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
    const payload = (await request.json().catch(() => ({}))) as { path?: string };
    const path = payload.path ?? "/";

    const site = await requireUserSite(session.user.id, siteId);
    await deleteHeatmapScreenshot(site.id, path);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete screenshot." },
      { status: 400 },
    );
  }
}

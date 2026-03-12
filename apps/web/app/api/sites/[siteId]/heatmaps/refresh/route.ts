import { NextRequest, NextResponse } from "next/server";

import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { getControlPlaneSql } from "@/lib/control-plane/db";
import { captureSiteDomSnapshots } from "@/lib/control-plane/heatmap-dom-capture";
import { queueHeatmapDomRefresh } from "@/lib/control-plane/heatmap-dom-refresh";
import { getSitePrivacySettings } from "@/lib/control-plane/site-settings";
import { sanitizeOrigin } from "@/lib/control-plane/tracker-script";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizePathKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  let normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || "/";
}

async function latestSnapshotOrigin(siteId: string) {
  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT page_url
    FROM analytics_heatmap_dom_snapshots
    WHERE site_id = ${siteId}
      AND page_url <> ''
    ORDER BY updated_at DESC
    LIMIT 1
  `) as Array<{ page_url: string }>;

  const rawUrl = String(rows[0]?.page_url ?? "").trim();
  if (!rawUrl) {
    return "";
  }

  try {
    return new URL(rawUrl).origin;
  } catch {
    return "";
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
    const payload = (await request.json().catch(() => ({}))) as {
      path?: string;
      scope?: "path" | "site";
      origin?: string;
    };
    const path = normalizePathKey(payload.path ?? "/");
    const scope = payload.scope === "path" ? "path" : "site";

    const site = await requireSiteMutationAccess(session.user.id, siteId);
    const privacy = await getSitePrivacySettings(site.id);
    if (!privacy.domSnapshotsEnabled) {
      return NextResponse.json(
        { error: "Enable DOM snapshots for this site before requesting a heatmap refresh." },
        { status: 400 },
      );
    }

    const origin =
      sanitizeOrigin(payload.origin ?? "") ||
      sanitizeOrigin(await latestSnapshotOrigin(site.id)) ||
      sanitizeOrigin(site.origins[0] ?? "");

    if (origin) {
      const captured = await captureSiteDomSnapshots(site.id, origin);
      if (captured.captured <= 0) {
        const queued = await queueHeatmapDomRefresh(site.id, path, scope);
        const sampleErrors = (captured.sampleErrors ?? []).filter((value) => value.trim().length > 0);
        const fallbackReason = sampleErrors[0] ? ` Reason: ${sampleErrors[0]}.` : "";

        return NextResponse.json({
          ok: true,
          path: queued.path,
          scope: queued.scope,
          requestId: queued.requestId,
          requestedAt: queued.requestedAt,
          origin: captured.origin,
          discovered: captured.discovered,
          captured: captured.captured,
          failed: captured.failed,
          note:
            queued.scope === "site"
              ? `Server capture could not fetch any pages, so a live tracker site refresh was queued instead.${fallbackReason}`
              : `Server capture could not fetch this page, so a live tracker refresh was queued instead.${fallbackReason}`,
          sampleErrors,
        });
      }

      return NextResponse.json({
        ok: true,
        path: scope === "site" ? "/" : path,
        scope,
        origin: captured.origin,
        discovered: captured.discovered,
        captured: captured.captured,
        failed: captured.failed,
        note: captured.note,
        sampleErrors: captured.sampleErrors,
      });
    }

    const queued = await queueHeatmapDomRefresh(site.id, path, scope);
    return NextResponse.json({
      ok: true,
      path: queued.path,
      scope: queued.scope,
      requestId: queued.requestId,
      requestedAt: queued.requestedAt,
      note:
        queued.scope === "site"
          ? "Site refresh requested. A live tracker will crawl same-origin pages and upload fresh DOM snapshots."
          : "Page refresh requested. A live tracker on this page will upload a fresh DOM snapshot automatically.",
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to request heatmap refresh." },
      { status: 400 },
    );
  }
}

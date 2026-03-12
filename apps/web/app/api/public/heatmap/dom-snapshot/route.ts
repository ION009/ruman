import { createHash } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { getControlPlaneSql } from "@/lib/control-plane/db";
import { fulfillHeatmapDomRefresh, readPendingHeatmapDomRefresh } from "@/lib/control-plane/heatmap-dom-refresh";
import { upsertHeatmapDomSnapshot } from "@/lib/control-plane/heatmap-dom-snapshots";
import { getSitePrivacySettings } from "@/lib/control-plane/site-settings";
import { upsertSitePage } from "@/lib/control-plane/site-pages";
import { sanitizeOrigin } from "@/lib/control-plane/tracker-script";
import { isControlPlaneEnabled } from "@/lib/session";

const MAX_HTML_CHARS = 2_500_000;
const MAX_CSS_CHARS = 600_000;

type RawPayload = {
  siteId?: string;
  path?: string;
  requestId?: string;
  url?: string;
  snapshot?: {
    html?: string;
    css?: string;
    title?: string;
    viewportWidth?: number;
    viewportHeight?: number;
    documentWidth?: number;
    documentHeight?: number;
    viewport?: {
      width?: number;
      height?: number;
    };
    document?: {
      width?: number;
      height?: number;
    };
    capturedAt?: string;
    contentHash?: string;
  };
};

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

function clampDimension(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(20000, Math.round(value || 0)));
}

function normalizeText(value: string | undefined, limit: number) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
}

function sanitizeSnapshotPageURL(value: string | undefined) {
  const normalized = normalizeText(value, 2048);
  if (!normalized) {
    return "";
  }

  try {
    const parsed = new URL(normalized);
    parsed.search = "";
    parsed.hash = "";
    return normalizeText(parsed.toString(), 2048);
  } catch {
    return "";
  }
}

function sanitizeSnapshotHTML(html: string) {
  const withoutScripts = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  return withoutScripts.replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, "");
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, DNT, Sec-GPC",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  } as const;
}

function isPrivacyOptOut(request: NextRequest) {
  const dnt = (request.headers.get("dnt") ?? "").trim().toLowerCase();
  const gpc = (request.headers.get("sec-gpc") ?? "").trim();
  return dnt === "1" || dnt === "yes" || gpc === "1";
}

function requestedSiteID(request: NextRequest, payload?: RawPayload) {
  const fromQuery = request.nextUrl.searchParams.get("site") ?? request.nextUrl.searchParams.get("siteId") ?? "";
  const fromPayload = payload?.siteId ?? "";
  return (fromQuery || fromPayload).trim();
}

function isLoopbackHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
}

function originsMatch(allowed: string, actual: string) {
  const normalizedAllowed = sanitizeOrigin(allowed);
  const normalizedActual = sanitizeOrigin(actual);
  if (!normalizedAllowed || !normalizedActual) {
    return false;
  }

  try {
    const allowedURL = new URL(normalizedAllowed);
    const actualURL = new URL(normalizedActual);
    if (isLoopbackHost(allowedURL.hostname) && isLoopbackHost(actualURL.hostname)) {
      return allowedURL.protocol === actualURL.protocol;
    }
    return allowedURL.origin === actualURL.origin;
  } catch {
    return false;
  }
}

async function siteAllowsOrigin(siteId: string, origin: string) {
  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT origin
    FROM analytics_site_origins
    WHERE site_id = ${siteId}
  `) as { origin: string }[];

  const normalizedOrigin = sanitizeOrigin(origin);
  if (!normalizedOrigin || !rows.length) {
    return false;
  }

  return rows.some((row) => originsMatch(row.origin, normalizedOrigin));
}

function acceptedNoop(origin: string, path = "/", note = "Control plane database is unavailable.") {
  return NextResponse.json(
    { ok: true, path, captured: false, note },
    { status: 202, headers: origin ? corsHeaders(origin) : undefined },
  );
}

export async function OPTIONS(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  const siteId = requestedSiteID(request);
  const origin = sanitizeOrigin(request.headers.get("origin") ?? "");
  if (!siteId || !origin) {
    return NextResponse.json({ error: "site and origin are required." }, { status: 400 });
  }

  let allowed = false;
  try {
    allowed = await siteAllowsOrigin(siteId, origin);
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(origin),
      });
    }
    throw error;
  }
  if (!allowed) {
    return NextResponse.json({ error: "origin is not allowed for this site." }, { status: 403 });
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function GET(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  const siteId = requestedSiteID(request);
  const origin = sanitizeOrigin(request.headers.get("origin") ?? "");
  const path = normalizePathKey(request.nextUrl.searchParams.get("path") ?? "/");
  if (!siteId) {
    return NextResponse.json({ error: "site is required." }, { status: 400 });
  }
  if (!origin) {
    return NextResponse.json({ error: "origin is required." }, { status: 400 });
  }

  let allowed = false;
  try {
    allowed = await siteAllowsOrigin(siteId, origin);
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, path);
    }
    throw error;
  }
  if (!allowed) {
    return NextResponse.json({ error: "origin is not allowed for this site." }, { status: 403 });
  }

  try {
    const pending = await readPendingHeatmapDomRefresh(siteId, path);
    return NextResponse.json(
      {
        ok: true,
        path,
        pending: Boolean(pending),
        scope: pending?.scope ?? "path",
        requestId: pending?.requestId ?? "",
        requestedAt: pending?.requestedAt ?? "",
      },
      { headers: corsHeaders(origin) },
    );
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, path);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Control plane is not enabled." }, { status: 404 });
  }

  const payload = ((await request.json().catch(() => ({}))) ?? {}) as RawPayload;
  const siteId = requestedSiteID(request, payload);
  const origin = sanitizeOrigin(request.headers.get("origin") ?? "");
  if (!siteId) {
    return NextResponse.json({ error: "site is required." }, { status: 400 });
  }
  if (!origin) {
    return NextResponse.json({ error: "origin is required." }, { status: 400 });
  }

  let allowed = false;
  try {
    allowed = await siteAllowsOrigin(siteId, origin);
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, normalizePathKey(payload.path ?? "/"));
    }
    throw error;
  }
  if (!allowed) {
    return NextResponse.json({ error: "origin is not allowed for this site." }, { status: 403 });
  }

  if (isPrivacyOptOut(request)) {
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }

  const path = normalizePathKey(payload.path ?? "/");
  let privacySettings;
  try {
    privacySettings = await getSitePrivacySettings(siteId);
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, path, "DOM snapshot settings are temporarily unavailable.");
    }
    throw error;
  }
  if (!privacySettings.domSnapshotsEnabled) {
    return NextResponse.json(
      { error: "DOM snapshots are not enabled for this site." },
      { status: 403, headers: corsHeaders(origin) },
    );
  }

  try {
    await upsertSitePage(siteId, path, "tracker");
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, path);
    }
    throw error;
  }

  const snapshot = payload.snapshot;
  const html = normalizeText(snapshot?.html, MAX_HTML_CHARS);
  if (!html) {
    return NextResponse.json(
      { ok: true, path, captured: false, note: "Snapshot html was empty." },
      { status: 202, headers: corsHeaders(origin) },
    );
  }

  const sanitizedHTML = sanitizeSnapshotHTML(html);
  const css = normalizeText(snapshot?.css, MAX_CSS_CHARS);
  const viewportWidth = clampDimension(snapshot?.viewportWidth ?? snapshot?.viewport?.width);
  const viewportHeight = clampDimension(snapshot?.viewportHeight ?? snapshot?.viewport?.height);
  const documentWidth = clampDimension(snapshot?.documentWidth ?? snapshot?.document?.width);
  const documentHeight = clampDimension(snapshot?.documentHeight ?? snapshot?.document?.height);
  const contentHash =
    normalizeText(snapshot?.contentHash, 128) ||
    createHash("sha256").update(sanitizedHTML).update(css).digest("hex");

  let stored;
  try {
    stored = await upsertHeatmapDomSnapshot(siteId, {
      path,
      pageUrl: sanitizeSnapshotPageURL(payload.url),
      pageTitle: normalizeText(snapshot?.title, 512),
      html: sanitizedHTML,
      css,
      viewportWidth,
      viewportHeight,
      documentWidth,
      documentHeight,
      capturedAt: snapshot?.capturedAt,
      contentHash,
    });
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return acceptedNoop(origin, path);
    }
    throw error;
  }

  const requestId = String(payload.requestId ?? "").trim();
  if (requestId) {
    try {
      await fulfillHeatmapDomRefresh(siteId, path, requestId);
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        throw error;
      }
    }
  }

  return NextResponse.json(
    { ok: true, path: stored.path, captured: true, contentHash: stored.contentHash },
    { headers: corsHeaders(origin) },
  );
}

import { NextRequest } from "next/server";

import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import {
  analyticsProxyEnabled,
  analyticsServiceTokens,
  readDashboardToken,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function apiBaseURL() {
  const base = process.env.ANLTICSHEAT_API_BASE_URL?.replace(/\/$/, "");
  if (!base) {
    throw new Error("ANLTICSHEAT_API_BASE_URL is required for exports.");
  }
  return base;
}

async function proxyExport(path: string, token: string) {
  const response = await fetch(`${apiBaseURL()}${path}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
    return Response.json(
      { error: payload.error ?? payload.message ?? "Export failed." },
      { status: response.status },
    );
  }

  const body = await response.arrayBuffer();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": response.headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Disposition": response.headers.get("Content-Disposition") ?? `attachment; filename="${path.split("/").pop() ?? "export"}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  if (!analyticsProxyEnabled()) {
    return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
  }

  const { kind } = await params;
  const search = request.nextUrl.search;
  const requestedSiteId = request.nextUrl.searchParams.get("site") ?? "";
  const upstreamPath = `/api/v1/dashboard/export/${encodeURIComponent(kind)}${search}`;

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      await requireUserSite(session.user.id, requestedSiteId);

      let lastError: Response | null = null;
      for (const token of analyticsServiceTokens()) {
        const proxied = await proxyExport(upstreamPath, token);
        if (proxied.ok) {
          return proxied;
        }
        lastError = proxied;
      }
      return lastError ?? Response.json({ error: "Export failed." }, { status: 502 });
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        return Response.json({ error: error instanceof Error ? error.message : "Authentication required." }, { status: 401 });
      }
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  return proxyExport(upstreamPath, token);
}

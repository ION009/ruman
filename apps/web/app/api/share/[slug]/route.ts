import { NextRequest, NextResponse } from "next/server";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import { findSharedLinkBySlug, verifySharedLinkPassword } from "@/lib/control-plane/shared-links";
import type { SharedDashboardPayload } from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardHeatmapData,
  getDashboardSummaryData,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

type RawSiteRow = {
  id: string;
  name: string;
  origins: string[] | null;
};

async function loadSharedDashboardPayload(site: RawSiteRow): Promise<SharedDashboardPayload> {
  const summary = await withAnalyticsTokenFallback((token) => getDashboardSummaryData(site.id, "7d", token));
  const focusPath = summary.topPages[0]?.path || summary.pages[0]?.path || "/";
  const heatmap = await withAnalyticsTokenFallback((token) =>
    getDashboardHeatmapData(site.id, focusPath, "7d", "engagement", "all", "all", token),
  ).catch(() => null);

  return {
    site: {
      id: site.id,
      name: site.name,
      origins: [],
    },
    summary,
    heatmap: sanitizeSharedHeatmap(heatmap),
    generatedAt: new Date().toISOString(),
    scope: {
      readOnly: true,
      privacySafe: true,
      exposedSections: ["overview", "topPages", "referrers", "devices", "heatmap-summary"],
    },
  };
}

function sanitizeSharedHeatmap(heatmap: SharedDashboardPayload["heatmap"]): SharedDashboardPayload["heatmap"] {
  if (!heatmap) {
    return null;
  }
  return {
    ...heatmap,
    buckets: [],
    moveBuckets: [],
    scrollFunnel: [],
    selectors: [],
    paths: [],
    availableModes: [],
    availableClickFilters: [],
    availableViewportSegments: [],
    screenshot: null,
    domSnapshot: null,
  };
}

async function handleSharedDashboardRequest(
  password: string | null | undefined,
  { slug }: { slug: string },
) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Shared dashboards require the control plane." }, { status: 404 });
  }
  if (!analyticsProxyEnabled()) {
    return NextResponse.json({ error: "Analytics proxy is not configured." }, { status: 503 });
  }

  const link = await findSharedLinkBySlug(slug).catch(() => null);
  if (!link) {
    return NextResponse.json({ error: "Shared dashboard not found." }, { status: 404 });
  }

  if (!verifySharedLinkPassword(link, password)) {
    const normalizedPassword = (password ?? "").trim();
    return NextResponse.json(
      {
        error: normalizedPassword ? "Incorrect password." : "Password required.",
        passwordRequired: true,
      },
      { status: 403 },
    );
  }

  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT s.id, s.name, COALESCE(array_remove(array_agg(o.origin ORDER BY o.origin), NULL), ARRAY[]::text[]) AS origins
    FROM analytics_sites s
    LEFT JOIN analytics_site_origins o ON o.site_id = s.id
    WHERE s.id = ${link.site_id}
    GROUP BY s.id, s.name
    LIMIT 1
  `) as RawSiteRow[];
  const site = rows[0];
  if (!site) {
    return NextResponse.json({ error: "Shared dashboard site not found." }, { status: 404 });
  }

  try {
    return NextResponse.json(await loadSharedDashboardPayload(site));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Shared dashboard is unavailable." },
      { status: 502 },
    );
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  return handleSharedDashboardRequest("", await params);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const payload = (await request.json().catch(() => ({}))) as { password?: string };
  return handleSharedDashboardRequest(payload.password, await params);
}

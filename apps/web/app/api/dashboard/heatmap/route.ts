import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { listHeatmapDomSnapshotPaths, readHeatmapDomSnapshot } from "@/lib/control-plane/heatmap-dom-snapshots";
import { listHeatmapScreenshots, readHeatmapScreenshot } from "@/lib/control-plane/heatmap-screenshots";
import { listSitePages } from "@/lib/control-plane/site-pages";
import type {
  HeatmapClickFilter,
  HeatmapMode,
  HeatmapView,
  HeatmapViewportSegment,
  RangeKey,
} from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  withAnalyticsTokenFallback,
  getDashboardHeatmapData,
  readDashboardToken,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizeRange(value: string): RangeKey {
  if (value === "24h" || value === "30d") return value;
  return "7d";
}

function normalizeMode(value: string): HeatmapMode {
  switch (value) {
    case "click":
    case "rage":
    case "move":
    case "scroll":
      return value;
    default:
      return "engagement";
  }
}

function normalizeClickFilter(value: string): HeatmapClickFilter {
  if (value === "rage" || value === "dead" || value === "error") {
    return value;
  }
  return "all";
}

function normalizeViewportSegment(value: string): HeatmapViewportSegment {
  if (value === "mobile" || value === "tablet" || value === "desktop") {
    return value;
  }
  return "all";
}

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

function normalizeBuckets(view: HeatmapView) {
  view.buckets = Array.isArray(view.buckets)
    ? view.buckets.map((bucket) => ({
        ...bucket,
        weight: typeof bucket.weight === "number" ? bucket.weight : bucket.count ?? 0,
        sessions: typeof bucket.sessions === "number" ? bucket.sessions : bucket.count ?? 0,
        visitors: typeof bucket.visitors === "number" ? bucket.visitors : bucket.count ?? 0,
      }))
    : [];
  view.moveBuckets = Array.isArray(view.moveBuckets)
    ? view.moveBuckets.map((bucket) => ({
        ...bucket,
        weight: typeof bucket.weight === "number" ? bucket.weight : bucket.count ?? 0,
        sessions: typeof bucket.sessions === "number" ? bucket.sessions : bucket.count ?? 0,
        visitors: typeof bucket.visitors === "number" ? bucket.visitors : bucket.count ?? 0,
      }))
    : [];
}

function ensureHeatmapDefaults(
  heatmap: HeatmapView,
  mode: HeatmapMode,
  clickFilter: HeatmapClickFilter,
  viewportSegment: HeatmapViewportSegment,
) {
  heatmap.mode = heatmap.mode ?? mode;
  heatmap.clickFilter = heatmap.clickFilter ?? clickFilter;
  heatmap.viewportSegment = heatmap.viewportSegment ?? viewportSegment;
  heatmap.availableModes = heatmap.availableModes ?? ["engagement", "click", "rage", "move", "scroll"];
  heatmap.availableClickFilters = heatmap.availableClickFilters ?? ["all", "rage", "dead", "error"];
  heatmap.availableViewportSegments = heatmap.availableViewportSegments ?? ["all", "mobile", "tablet", "desktop"];
  if (!heatmap.viewport?.width || !heatmap.viewport?.height) {
    heatmap.viewport = { width: 1440, height: 920 };
  }
  if (!heatmap.document?.width || !heatmap.document?.height) {
    heatmap.document = {
      width: heatmap.viewport.width,
      height: heatmap.viewport.height,
    };
  }
  normalizeBuckets(heatmap);
  heatmap.selectors = Array.isArray(heatmap.selectors)
    ? heatmap.selectors.map((selector) => ({
        ...selector,
        hoverEvents: typeof selector.hoverEvents === "number" ? selector.hoverEvents : 0,
        hoverMs: typeof selector.hoverMs === "number" ? selector.hoverMs : 0,
        centerX: typeof selector.centerX === "number" ? selector.centerX : 0,
        centerY: typeof selector.centerY === "number" ? selector.centerY : 0,
        blockedZone: !!selector.blockedZone,
      }))
    : [];
  heatmap.totals = {
    clicks: typeof heatmap.totals?.clicks === "number" ? heatmap.totals.clicks : 0,
    rageClicks: typeof heatmap.totals?.rageClicks === "number" ? heatmap.totals.rageClicks : 0,
    deadClicks: typeof heatmap.totals?.deadClicks === "number" ? heatmap.totals.deadClicks : 0,
    errorClicks: typeof heatmap.totals?.errorClicks === "number" ? heatmap.totals.errorClicks : 0,
    moveEvents: typeof heatmap.totals?.moveEvents === "number" ? heatmap.totals.moveEvents : 0,
    hoverEvents: typeof heatmap.totals?.hoverEvents === "number" ? heatmap.totals.hoverEvents : 0,
    hoverMs: typeof heatmap.totals?.hoverMs === "number" ? heatmap.totals.hoverMs : 0,
    scrollEvents: typeof heatmap.totals?.scrollEvents === "number" ? heatmap.totals.scrollEvents : 0,
    uniqueSessions: typeof heatmap.totals?.uniqueSessions === "number" ? heatmap.totals.uniqueSessions : 0,
    uniqueVisitors: typeof heatmap.totals?.uniqueVisitors === "number" ? heatmap.totals.uniqueVisitors : 0,
    mouseClicks: typeof heatmap.totals?.mouseClicks === "number" ? heatmap.totals.mouseClicks : 0,
    touchClicks: typeof heatmap.totals?.touchClicks === "number" ? heatmap.totals.touchClicks : 0,
    penClicks: typeof heatmap.totals?.penClicks === "number" ? heatmap.totals.penClicks : 0,
    keyboardClicks: typeof heatmap.totals?.keyboardClicks === "number" ? heatmap.totals.keyboardClicks : 0,
    normalizedExcluded: typeof heatmap.totals?.normalizedExcluded === "number" ? heatmap.totals.normalizedExcluded : 0,
    blockedZoneEvents: typeof heatmap.totals?.blockedZoneEvents === "number" ? heatmap.totals.blockedZoneEvents : 0,
    blockedZoneClicks: typeof heatmap.totals?.blockedZoneClicks === "number" ? heatmap.totals.blockedZoneClicks : 0,
    blockedZoneHovers: typeof heatmap.totals?.blockedZoneHovers === "number" ? heatmap.totals.blockedZoneHovers : 0,
  };
  heatmap.confidence = {
    insightReady: !!heatmap.confidence?.insightReady,
    score: typeof heatmap.confidence?.score === "number" ? heatmap.confidence.score : 0,
    sampleSize: typeof heatmap.confidence?.sampleSize === "number" ? heatmap.confidence.sampleSize : 0,
    sessionSample: typeof heatmap.confidence?.sessionSample === "number" ? heatmap.confidence.sessionSample : 0,
    minSample: typeof heatmap.confidence?.minSample === "number" ? heatmap.confidence.minSample : 0,
    viewportBucket: heatmap.confidence?.viewportBucket ?? "unknown",
    layoutVariant: heatmap.confidence?.layoutVariant ?? "default",
    trust: heatmap.confidence?.trust ?? "measured",
    freshness: heatmap.confidence?.freshness ?? "",
    normalization: heatmap.confidence?.normalization ?? "global",
    explanation: heatmap.confidence?.explanation ?? "",
    blockedZones: typeof heatmap.confidence?.blockedZones === "number" ? heatmap.confidence.blockedZones : 0,
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const path = searchParams.get("path");
  const range = normalizeRange(searchParams.get("range") ?? "7d");
  const mode = normalizeMode(searchParams.get("mode") ?? "engagement");
  const clickFilter = normalizeClickFilter(searchParams.get("clickFilter") ?? "all");
  const viewport = normalizeViewportSegment(searchParams.get("viewport") ?? "all");

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);

      if (!analyticsProxyEnabled()) {
        return Response.json(
          { error: "Analytics proxy is not configured." },
          { status: 503 },
        );
      }

      let heatmap: HeatmapView;
      try {
        heatmap = await withAnalyticsTokenFallback((token) =>
          getDashboardHeatmapData(site.id, path, range, mode, clickFilter, viewport, token),
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? `Analytics proxy failed: ${error.message}` : "Analytics proxy failed." },
          { status: 502 },
        );
      }

      ensureHeatmapDefaults(heatmap, mode, clickFilter, viewport);

      const [capturedScreenshots, discoveredPages, domSnapshotPaths] = await Promise.all([
        listHeatmapScreenshots(site.id),
        listSitePages(site.id),
        listHeatmapDomSnapshotPaths(site.id),
      ]);
      const screenshotsByPath = new Map(
        capturedScreenshots.map((entry) => [normalizePathKey(entry.path), entry.screenshot]),
      );
      const pathMap = new Map<string, number>();
      for (const page of heatmap.paths) {
        pathMap.set(normalizePathKey(page.path), page.pageviews);
      }
      for (const screenshotEntry of capturedScreenshots) {
        const normalizedPath = normalizePathKey(screenshotEntry.path);
        if (!pathMap.has(normalizedPath)) {
          pathMap.set(normalizedPath, 0);
        }
      }
      for (const page of discoveredPages) {
        const normalizedPath = normalizePathKey(page.path);
        if (!pathMap.has(normalizedPath)) {
          pathMap.set(normalizedPath, 0);
        }
      }
      for (const snapshotPath of domSnapshotPaths) {
        const normalizedPath = normalizePathKey(snapshotPath);
        if (!pathMap.has(normalizedPath)) {
          pathMap.set(normalizedPath, 0);
        }
      }
      heatmap.paths = [...pathMap.entries()].map(([pathEntry, pageviews]) => ({
        path: pathEntry,
        pageviews,
      }))
        .sort((a, b) => {
          if (a.pageviews !== b.pageviews) {
            return b.pageviews - a.pageviews;
          }
          if (a.path === "/") return -1;
          if (b.path === "/") return 1;
          if (a.path.length !== b.path.length) {
            return a.path.length - b.path.length;
          }
          return a.path.localeCompare(b.path);
        });

      const normalizedRequestedPath = path ? normalizePathKey(path) : "";
      if (normalizedRequestedPath && heatmap.paths.some((page) => page.path === normalizedRequestedPath)) {
        heatmap.path = normalizedRequestedPath;
      }

      if (heatmap.paths.length > 0 && !heatmap.paths.some((page) => page.path === heatmap.path)) {
        heatmap.path = heatmap.paths[0]?.path ?? heatmap.path;
      }

      const normalizedPath = normalizePathKey(heatmap.path);
      const [screenshot, domSnapshot] = await Promise.all([
        screenshotsByPath.get(normalizedPath) ?? readHeatmapScreenshot(site.id, normalizedPath),
        readHeatmapDomSnapshot(site.id, normalizedPath),
      ]);

      return Response.json({
        ...heatmap,
        path: normalizedPath,
        screenshot,
        domSnapshot: domSnapshot
          ? {
              path: domSnapshot.path,
              pageUrl: domSnapshot.pageUrl,
              pageTitle: domSnapshot.pageTitle,
              html: domSnapshot.html,
              css: domSnapshot.css,
              viewport: domSnapshot.viewport,
              document: domSnapshot.document,
              contentHash: domSnapshot.contentHash,
              capturedAt: domSnapshot.capturedAt,
            }
          : null,
      });
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

  if (!analyticsProxyEnabled()) {
    return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
  }

  try {
    const heatmap = await getDashboardHeatmapData(requestedSiteId, path, range, mode, clickFilter, viewport, token);
    ensureHeatmapDefaults(heatmap, mode, clickFilter, viewport);
    return Response.json(heatmap);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 502 });
  }
}

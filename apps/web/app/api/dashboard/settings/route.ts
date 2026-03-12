import {
  getSitePrivacySettingsForUser,
  getSiteSettingsForUser,
  getSiteTrackerScriptForUser,
  listSitesForUser,
  requireCurrentSession,
  requireUserSite,
} from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { listSitePages } from "@/lib/control-plane/site-pages";
import {
  buildTrackerScriptSrc,
  buildTrackerSnippet,
  resolveSnapshotIngestOrigin,
  resolveTrackerCollectorOrigin,
  sanitizeOrigin,
} from "@/lib/control-plane/tracker-script";
import type { DashboardSettingsResponse } from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  withAnalyticsTokenFallback,
  getDashboardSettingsData,
  readDashboardToken,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function buildLocalSettings(
  site: { id: string; name: string; origins: string[] },
  allSites: { id: string; name: string; origins: string[] }[],
  trackerScript: DashboardSettingsResponse["trackerScript"],
  privacy: DashboardSettingsResponse["privacy"],
  tracking: DashboardSettingsResponse["tracking"],
  options?: {
    retention?: DashboardSettingsResponse["retention"];
    importDefaults?: DashboardSettingsResponse["importDefaults"];
    stats?: DashboardSettingsResponse["stats"];
  },
): DashboardSettingsResponse {
  return {
    sites: allSites.map((s) => ({ id: s.id, name: s.name, origins: s.origins })),
    site: { id: site.id, name: site.name, origins: site.origins },
    privacy,
    tracking,
    trackerSnippet: trackerScript.scriptTag,
    trackerScript,
    retention: options?.retention ?? { eventsDays: 365, heatmapDays: 90, replayDays: 30, insightsDays: 180 },
    importDefaults: options?.importDefaults ?? { mapping: {}, timezone: "UTC" },
    stats: options?.stats ?? { totalEvents: 0, trackedPages: 0, firstSeen: null, lastSeen: null },
  };
}

function withFallbackTrackerScript(payload: DashboardSettingsResponse, requestOrigin: string): DashboardSettingsResponse {
  const siteId = payload.site?.id ?? payload.sites[0]?.id ?? "";
  const privacy = payload.privacy ?? {
    domSnapshotsEnabled: false,
    visitorCookieEnabled: false,
  };
  const tracking = payload.tracking ?? {
    blockBotTrafficEnabled: true,
    domSnapshotsEnabled: privacy.domSnapshotsEnabled,
    visitorCookieEnabled: privacy.visitorCookieEnabled,
    replayMaskTextEnabled: false,
    spaTrackingEnabled: true,
    errorTrackingEnabled: true,
    performanceTrackingEnabled: true,
  };
  if (payload.trackerScript) {
    return {
      ...payload,
      privacy,
      tracking,
      importDefaults: payload.importDefaults ?? { mapping: {}, timezone: "UTC" },
    };
  }

  const installOrigin = sanitizeOrigin(payload.site?.origins?.[0] ?? "") || requestOrigin;
  const collectorOrigin = resolveTrackerCollectorOrigin({ requestOrigin }) || requestOrigin;
  const trackerOptions = {
    domSnapshotsEnabled: tracking.domSnapshotsEnabled,
    snapshotOrigin: resolveSnapshotIngestOrigin({ requestOrigin }) || requestOrigin,
    spaTrackingEnabled: tracking.spaTrackingEnabled,
    errorTrackingEnabled: tracking.errorTrackingEnabled,
    performanceTrackingEnabled: tracking.performanceTrackingEnabled,
    replayMaskTextEnabled: tracking.replayMaskTextEnabled,
  };
  const scriptSrc = buildTrackerScriptSrc(collectorOrigin, siteId, trackerOptions);
  return {
    ...payload,
    privacy,
    tracking,
    importDefaults: payload.importDefaults ?? { mapping: {}, timezone: "UTC" },
    trackerSnippet:
      payload.trackerSnippet ||
      buildTrackerSnippet(collectorOrigin, siteId, trackerOptions),
    trackerScript: {
      siteId,
      installOrigin,
      collectorOrigin,
      scriptSrc,
      scriptTag:
        payload.trackerSnippet ||
        buildTrackerSnippet(collectorOrigin, siteId, trackerOptions),
      isPersisted: false,
      updatedAt: null,
    },
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedSiteId = url.searchParams.get("site") ?? "";

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      const sites = await listSitesForUser(session.user.id);
      const settings = await getSiteSettingsForUser(session.user.id, site.id);
      const privacy = await getSitePrivacySettingsForUser(session.user.id, site.id);
      const trackerScript = await getSiteTrackerScriptForUser(session.user.id, site.id, url.origin);

      if (!analyticsProxyEnabled()) {
        return Response.json(
          { error: "Analytics proxy is not configured." },
          { status: 503 },
        );
      }

      try {
        const proxy = await withAnalyticsTokenFallback((token) =>
          getDashboardSettingsData(site.id, url.origin, token),
        );
        const discoveredPages = await listSitePages(site.id);
        const trackedPages = Math.max(proxy.stats.trackedPages, discoveredPages.length);
        return Response.json(
          buildLocalSettings(
            { id: site.id, name: site.name, origins: site.origins },
            sites.map((s) => ({ id: s.id, name: s.name, origins: s.origins })),
            trackerScript,
            privacy,
            settings.tracking,
            {
              retention: {
                ...proxy.retention,
                siteOverrides: settings.retention,
              },
              importDefaults: settings.importDefaults,
              stats: {
                ...proxy.stats,
                trackedPages,
              },
            },
          ),
        );
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? `Analytics proxy failed: ${error.message}` : "Analytics proxy failed." },
          { status: 502 },
        );
      }
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
    const payload = await getDashboardSettingsData(requestedSiteId, url.origin, token);
    return Response.json(withFallbackTrackerScript(payload, url.origin));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, { status: 502 });
  }
}

import "server-only";

import { randomUUID } from "node:crypto";

import type { DashboardSettingsResponse, DashboardSite, RangeKey } from "@/lib/dashboard/types";
import { getDashboardSettingsData } from "@/lib/dashboard/server";

type NeoTrackerDiagnosticsContext = {
  currentSite: DashboardSite;
  requestOrigin: string;
  runAnalytics: <T>(operation: (token: string) => Promise<T>) => Promise<T>;
  selectedRange: RangeKey;
  sites: DashboardSite[];
};

type NeoTrackerArgs = Record<string, string>;

type TrackerCheck = {
  key: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

type ParsedTrackerScript = {
  rawTag: string;
  src: string;
  siteId: string;
  replayEnabled: boolean;
  replaySampleRate: number;
  dataSnapshots: boolean;
  spaTrackingEnabled: boolean;
  errorTrackingEnabled: boolean;
  performanceTrackingEnabled: boolean;
  replayMaskTextEnabled: boolean;
};

const REQUEST_TIMEOUT_MS = 8_000;
const PROBE_USER_AGENT = "Mozilla/5.0 (compatible; Neo Tracker Probe/1.0)";

function labelForSite(site: DashboardSite) {
  if (site.name && site.name.trim() && site.name !== site.id) {
    return site.name;
  }

  const origin = site.origins?.[0] ?? "";
  if (origin) {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return origin;
    }
  }

  return site.id;
}

function resolveSite(context: NeoTrackerDiagnosticsContext, siteId?: string) {
  if (!siteId?.trim()) {
    return context.currentSite;
  }
  return context.sites.find((site) => site.id === siteId) ?? context.currentSite;
}

function boolFromString(value: string | null | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}

function withTimeout(signal?: AbortSignal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timeout),
  };
}

async function fetchText(url: string, init: RequestInit = {}) {
  const timeout = withTimeout(init.signal ?? undefined);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      ...init,
      signal: timeout.signal,
      headers: {
        "User-Agent": PROBE_USER_AGENT,
        ...(init.headers ?? {}),
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text().catch(() => ""),
    };
  } finally {
    timeout.clear();
  }
}

async function fetchJSON(url: string, init: RequestInit = {}) {
  const timeout = withTimeout(init.signal ?? undefined);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      ...init,
      signal: timeout.signal,
      headers: {
        "User-Agent": PROBE_USER_AGENT,
        ...(init.headers ?? {}),
      },
    });
    return {
      ok: response.ok,
      status: response.status,
      json: await response.json().catch(() => null),
    };
  } finally {
    timeout.clear();
  }
}

function parseAttributes(rawTag: string) {
  const attrs: Record<string, string> = {};
  const attrPattern = /([:@a-zA-Z0-9_-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match: RegExpExecArray | null = null;
  while ((match = attrPattern.exec(rawTag))) {
    const key = (match[1] ?? "").trim().toLowerCase();
    const value = firstNonEmpty(match[2], match[3], match[4]);
    if (key) {
      attrs[key] = value;
    }
  }
  return attrs;
}

function parseTrackerScripts(html: string, pageUrl: string): ParsedTrackerScript[] {
  const scripts: ParsedTrackerScript[] = [];
  const tagPattern = /<script\b[^>]*>/gi;
  let tagMatch: RegExpExecArray | null = null;

  while ((tagMatch = tagPattern.exec(html))) {
    const rawTag = tagMatch[0];
    const attrs = parseAttributes(rawTag);
    const srcAttr = attrs.src ? new URL(attrs.src, pageUrl).toString() : "";
    const parsedSrc = srcAttr ? new URL(srcAttr) : null;
    const querySiteId = parsedSrc ? firstNonEmpty(parsedSrc.searchParams.get("id"), parsedSrc.searchParams.get("site_id")) : "";
    const siteId = firstNonEmpty(attrs["data-site"], querySiteId);
    const looksLikeTracker = Boolean(siteId) || srcAttr.includes("/t.js");
    if (!looksLikeTracker) {
      continue;
    }

    scripts.push({
      rawTag,
      src: srcAttr,
      siteId,
      replayEnabled: boolFromString(
        attrs["data-replay"],
        parsedSrc ? boolFromString(parsedSrc.searchParams.get("replay"), false) : false,
      ),
      replaySampleRate: Number.parseFloat(firstNonEmpty(attrs["data-replay-sample-rate"], parsedSrc?.searchParams.get("replay_sample"))) || 0,
      dataSnapshots: boolFromString(attrs["data-snapshots"], false),
      spaTrackingEnabled: boolFromString(attrs["data-spa"], parsedSrc ? boolFromString(parsedSrc.searchParams.get("spa"), true) : true),
      errorTrackingEnabled: boolFromString(attrs["data-errors"], parsedSrc ? boolFromString(parsedSrc.searchParams.get("err"), true) : true),
      performanceTrackingEnabled: boolFromString(
        attrs["data-performance"],
        parsedSrc ? boolFromString(parsedSrc.searchParams.get("perf"), true) : true,
      ),
      replayMaskTextEnabled: boolFromString(
        attrs["data-replay-mask-text"],
        parsedSrc ? boolFromString(parsedSrc.searchParams.get("replay_mask_text"), false) : false,
      ),
    });
  }

  return scripts;
}

function trackerSourceMatches(actual: string, expected: string, expectedSiteId: string) {
  if (!actual || !expected) {
    return false;
  }

  try {
    const actualURL = new URL(actual);
    const expectedURL = new URL(expected);
    const actualSiteId = firstNonEmpty(actualURL.searchParams.get("id"), actualURL.searchParams.get("site_id"));
    const expectedSiteIdFromURL = firstNonEmpty(expectedURL.searchParams.get("id"), expectedURL.searchParams.get("site_id"));

    return (
      actualURL.origin === expectedURL.origin &&
      actualURL.pathname === expectedURL.pathname &&
      actualSiteId === expectedSiteId &&
      expectedSiteIdFromURL === expectedSiteId
    );
  } catch {
    return actual === expected;
  }
}

function compareDiscoveredScript(
  discovered: ParsedTrackerScript | null,
  expected: {
    scriptSrc: string;
    siteId: string;
    replayEnabled: boolean;
    domSnapshotsEnabled: boolean;
    spaTrackingEnabled: boolean;
    errorTrackingEnabled: boolean;
    performanceTrackingEnabled: boolean;
    replayMaskTextEnabled: boolean;
  },
) {
  const checks: TrackerCheck[] = [];

  if (!discovered) {
    checks.push({
      key: "page-install",
      status: "warn",
      detail: "Could not confirm the tracker script on the public page HTML that was fetched.",
    });
    return checks;
  }

  checks.push({
    key: "page-install",
    status: discovered.siteId === expected.siteId ? "pass" : "fail",
    detail:
      discovered.siteId === expected.siteId
        ? "Public page HTML contains a tracker script pinned to the expected site id."
        : "Public page HTML contains a tracker-like script, but the discovered site id does not match the expected site id.",
  });

  checks.push({
    key: "script-src",
    status: trackerSourceMatches(discovered.src, expected.scriptSrc, expected.siteId) ? "pass" : "fail",
    detail:
      trackerSourceMatches(discovered.src, expected.scriptSrc, expected.siteId)
        ? "Discovered script source matches the generated tracker source."
        : "Discovered script source does not match the generated tracker source.",
  });

  const flagChecks: Array<[string, boolean, boolean]> = [
    ["replay", discovered.replayEnabled, expected.replayEnabled],
    ["dom-snapshots", discovered.dataSnapshots, expected.domSnapshotsEnabled],
    ["spa", discovered.spaTrackingEnabled, expected.spaTrackingEnabled],
    ["errors", discovered.errorTrackingEnabled, expected.errorTrackingEnabled],
    ["performance", discovered.performanceTrackingEnabled, expected.performanceTrackingEnabled],
    ["replay-mask-text", discovered.replayMaskTextEnabled, expected.replayMaskTextEnabled],
  ];

  for (const [key, actual, wanted] of flagChecks) {
    checks.push({
      key: `flag-${key}`,
      status: actual === wanted ? "pass" : "fail",
      detail:
        actual === wanted
          ? `${key} matches the expected tracker configuration.`
          : `${key} does not match the expected tracker configuration.`,
    });
  }

  checks.push({
    key: "replay-sample-rate",
    status: discovered.replayEnabled && discovered.replaySampleRate > 0 ? "pass" : "fail",
    detail:
      discovered.replayEnabled && discovered.replaySampleRate > 0
        ? "Replay sample rate is configured above zero."
        : "Replay sample rate is missing or zero, so replay recording will not sample sessions.",
  });

  return checks;
}

function freshnessChecks(settings: DashboardSettingsResponse) {
  const checks: TrackerCheck[] = [];
  if (!settings.stats.lastSeen) {
    checks.push({
      key: "recent-events",
      status: "warn",
      detail: "No analytics events have been recorded for this site yet.",
    });
    return checks;
  }

  const lastSeen = new Date(settings.stats.lastSeen).getTime();
  const ageMs = Date.now() - lastSeen;
  const stale = !Number.isFinite(lastSeen) || ageMs > 48 * 60 * 60 * 1000;
  checks.push({
    key: "recent-events",
    status: stale ? "warn" : "pass",
    detail: stale
      ? `Analytics data exists but the last event looks stale (${settings.stats.lastSeen}).`
      : `Analytics data looks fresh. Last event seen at ${settings.stats.lastSeen}.`,
  });
  return checks;
}

function summarizeOverallStatus(checks: TrackerCheck[]) {
  if (checks.some((check) => check.status === "fail")) {
    return "misconfigured";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warning";
  }
  return "healthy";
}

export async function verifyNeoTrackerConnection(args: NeoTrackerArgs, context: NeoTrackerDiagnosticsContext) {
  const site = resolveSite(context, args.siteId);
  const settings = await context.runAnalytics((token) =>
    getDashboardSettingsData(site.id, context.requestOrigin, token),
  );

  const installOrigin = firstNonEmpty(settings.trackerScript.installOrigin, site.origins?.[0], context.requestOrigin);
  const collectorOrigin = settings.trackerScript.collectorOrigin;
  const expectedScriptSrc = settings.trackerScript.scriptSrc;
  const expectedSiteId = settings.trackerScript.siteId;

  const htmlProbe = installOrigin ? await fetchText(installOrigin) : { ok: false, status: 0, text: "" };
  const discoveredScripts = htmlProbe.ok ? parseTrackerScripts(htmlProbe.text, installOrigin) : [];
  const discoveredScript =
    discoveredScripts.find((candidate) => candidate.siteId === expectedSiteId) ??
    discoveredScripts.find((candidate) => candidate.src === expectedScriptSrc) ??
    discoveredScripts[0] ??
    null;

  const scriptProbe = expectedScriptSrc
    ? await fetchText(expectedScriptSrc)
    : { ok: false, status: 0, text: "" };

  const preflightProbe =
    collectorOrigin && installOrigin
      ? await fetchText(`${collectorOrigin.replace(/\/$/, "")}/collect?id=${encodeURIComponent(expectedSiteId)}`, {
          method: "OPTIONS",
          headers: {
            Origin: installOrigin,
            Referer: `${installOrigin}/`,
            "Access-Control-Request-Method": "POST",
          },
        })
      : { ok: false, status: 0, text: "" };

  const identityProbe =
    collectorOrigin && installOrigin
      ? await fetchJSON(`${collectorOrigin.replace(/\/$/, "")}/identity?id=${encodeURIComponent(expectedSiteId)}`, {
          method: "POST",
          headers: {
            Origin: installOrigin,
            Referer: `${installOrigin}/`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ storageId: randomUUID() }),
        })
      : { ok: false, status: 0, json: null };

  const checks: TrackerCheck[] = [
    {
      key: "generated-script",
      status: expectedScriptSrc.includes(`/t.js?id=${expectedSiteId}`) ? "pass" : "fail",
      detail: expectedScriptSrc.includes(`/t.js?id=${expectedSiteId}`)
        ? "Generated tracker source is pinned to the expected site id."
        : "Generated tracker source is not pinned to the expected site id.",
    },
    {
      key: "public-page-fetch",
      status: htmlProbe.ok ? "pass" : "warn",
      detail: htmlProbe.ok
        ? `Fetched public page HTML from ${installOrigin}.`
        : `Could not fetch the public page HTML from ${installOrigin || "the configured origin"}.`,
    },
    ...compareDiscoveredScript(discoveredScript, {
      scriptSrc: expectedScriptSrc,
      siteId: expectedSiteId,
      replayEnabled: true,
      domSnapshotsEnabled: settings.tracking.domSnapshotsEnabled,
      spaTrackingEnabled: settings.tracking.spaTrackingEnabled,
      errorTrackingEnabled: settings.tracking.errorTrackingEnabled,
      performanceTrackingEnabled: settings.tracking.performanceTrackingEnabled,
      replayMaskTextEnabled: settings.tracking.replayMaskTextEnabled,
    }),
    {
      key: "script-endpoint",
      status: scriptProbe.ok ? "pass" : "fail",
      detail: scriptProbe.ok
        ? `Tracker asset responded successfully from ${expectedScriptSrc}.`
        : "Tracker asset fetch failed.",
    },
    {
      key: "collect-preflight",
      status: preflightProbe.status === 204 ? "pass" : "fail",
      detail:
        preflightProbe.status === 204
          ? "Collector preflight accepted the configured install origin."
          : "Collector preflight rejected the configured install origin or did not respond correctly.",
    },
    {
      key: "identity-probe",
      status: identityProbe.ok && typeof identityProbe.json?.id === "string" ? "pass" : "fail",
      detail:
        identityProbe.ok && typeof identityProbe.json?.id === "string"
          ? "Identity probe returned a visitor id, so the tracker connection path is reachable."
          : "Identity probe failed, so the tracker connection path could not be verified.",
    },
    ...freshnessChecks(settings),
  ];

  const status = summarizeOverallStatus(checks);
  const issues = checks.filter((check) => check.status !== "pass").map((check) => check.detail);

  return {
    ok: true,
    summary: `Tracker verification for ${labelForSite(site)} is ${status}.`,
    status,
    checks,
    issues,
    scope: {
      siteId: site.id,
      range: context.selectedRange,
    },
    install: {
      installOrigin,
      collectorOrigin,
      expectedScriptSrc,
      expectedSiteId,
      isPersisted: settings.trackerScript.isPersisted,
      updatedAt: settings.trackerScript.updatedAt ?? null,
    },
    discovered: discoveredScript
      ? {
          src: discoveredScript.src,
          siteId: discoveredScript.siteId,
          replayEnabled: discoveredScript.replayEnabled,
          replaySampleRate: discoveredScript.replaySampleRate,
          dataSnapshots: discoveredScript.dataSnapshots,
          spaTrackingEnabled: discoveredScript.spaTrackingEnabled,
          errorTrackingEnabled: discoveredScript.errorTrackingEnabled,
          performanceTrackingEnabled: discoveredScript.performanceTrackingEnabled,
          replayMaskTextEnabled: discoveredScript.replayMaskTextEnabled,
        }
      : null,
    probes: {
      publicPage: {
        ok: htmlProbe.ok,
        status: htmlProbe.status,
        scannedScriptCount: discoveredScripts.length,
      },
      trackerAsset: {
        ok: scriptProbe.ok,
        status: scriptProbe.status,
      },
      collectPreflight: {
        ok: preflightProbe.status === 204,
        status: preflightProbe.status,
      },
      identity: {
        ok: identityProbe.ok,
        status: identityProbe.status,
        id: typeof identityProbe.json?.id === "string" ? identityProbe.json.id : null,
        confidence: identityProbe.json && typeof identityProbe.json === "object" ? identityProbe.json.confidence ?? null : null,
        source: identityProbe.json && typeof identityProbe.json === "object" ? identityProbe.json.source ?? null : null,
      },
    },
    freshness: {
      totalEvents: settings.stats.totalEvents,
      trackedPages: settings.stats.trackedPages,
      firstSeen: settings.stats.firstSeen ?? null,
      lastSeen: settings.stats.lastSeen ?? null,
    },
  };
}

import { startDomSnapshots } from "./dom-snapshot.js";
import { startHeatmap } from "./heatmap.js";
import { startPerf } from "./perf.js";
import { startReplay } from "./replay.js";
import { createTracker } from "./tracker.js";

function doNotTrackEnabled() {
  const value = String(navigator.doNotTrack || window.doNotTrack || navigator.msDoNotTrack || "").trim().toLowerCase();
  return value === "1" || value === "yes";
}

function privacyOptOutEnabled() {
  return doNotTrackEnabled() || navigator.globalPrivacyControl === true;
}

function snapshotsEnabled(currentScript) {
  return currentScript && currentScript.getAttribute("data-snapshots") === "true";
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseSampleRate(value, fallback = 1) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function featureFlags(currentScript, scriptURL) {
  const readValue = (attributeName, queryName, fallback) => {
    const attribute = currentScript ? currentScript.getAttribute(attributeName) : "";
    const query = scriptURL ? scriptURL.searchParams.get(queryName) : "";
    return parseBoolean(attribute || query || "", fallback);
  };
  const readSampleRate = (attributeName, queryName, fallback) => {
    const attribute = currentScript ? currentScript.getAttribute(attributeName) : "";
    const query = scriptURL ? scriptURL.searchParams.get(queryName) : "";
    return parseSampleRate(attribute || query || "", fallback);
  };

  return {
    replayEnabled: readValue("data-replay", "replay", true),
    replaySampleRate: readSampleRate("data-replay-sample-rate", "replay_sample", 1),
    spaTrackingEnabled: readValue("data-spa", "spa", true),
    errorTrackingEnabled: readValue("data-errors", "err", true),
    performanceTrackingEnabled: readValue("data-performance", "perf", true),
    replayMaskTextEnabled: readValue("data-replay-mask-text", "replay_mask_text", false),
  };
}

try {
  if (!privacyOptOutEnabled()) {
    const currentScript = document.currentScript;
    const scriptURL = currentScript && currentScript.src ? new URL(currentScript.src, window.location.origin) : null;
    const siteId =
      (currentScript && currentScript.getAttribute("data-site")) ||
      (scriptURL && (scriptURL.searchParams.get("id") || scriptURL.searchParams.get("site_id"))) ||
      window.__ANLTICSHEAT_DEFAULT_SITE__ ||
      "";

    if (!siteId) {
      throw new Error("missing site id");
    }

    const apiOrigin = (((currentScript && currentScript.src) || "").split("/t.js")[0] || window.location.origin).replace(/\/$/, "");
    const snapshotOrigin = scriptURL ? (scriptURL.searchParams.get("snapshot_origin") || "").trim() : "";
    const snapshotEndpoint = snapshotOrigin
      ? `${snapshotOrigin.replace(/\/$/, "")}/api/public/heatmap/dom-snapshot?site=${encodeURIComponent(siteId)}`
      : "";
    const flags = featureFlags(currentScript, scriptURL);
    const api = window.anlticsheat || {};
    if (api.__loaded) {
      throw new Error("tracker already initialized");
    }

    const tracker = createTracker({ apiOrigin, siteId, snapshotEndpoint });
    const replay = startReplay(tracker, {
      enabled: flags.replayEnabled,
      sampleRate: flags.replaySampleRate,
      errorTrackingEnabled: flags.errorTrackingEnabled,
      maskAllText: flags.replayMaskTextEnabled,
    });
    api.__loaded = true;
    api.track = (name, props) => {
      try {
        tracker.track(name, props);
      } catch {}
    };
    api.flush = () => {
      try {
        return Promise.all([
          tracker.flush("manual"),
          replay && typeof replay.flush === "function" ? replay.flush("manual") : Promise.resolve(false),
        ]);
      } catch {
        return Promise.resolve();
      }
    };
    api.replay = {
      enabled: !!(replay && replay.enabled),
    };
    window.anlticsheat = api;

    startHeatmap(tracker);
    if (flags.performanceTrackingEnabled) {
      startPerf(tracker);
    }
    if (snapshotsEnabled(currentScript)) {
      startDomSnapshots(tracker);
    }
    tracker.start({
      spaTrackingEnabled: flags.spaTrackingEnabled,
    });
  }
} catch {}

import { getSession } from "./session.js";
import { createVisitorIdentity } from "./visitor.js";

const BACKUP_KEY = "_aq";
const SEQUENCE_KEY = "_asq";
const FLUSH_INTERVAL_MS = 5000;
const FLUSH_THRESHOLD = 20;
const REQUEST_BATCH_LIMIT = 50;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_META_BYTES = 360;
const MAX_META_STRING = 120;
const MAX_SELECTOR_STRING = 320;

function currentPath() {
  return window.location.pathname || "/";
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function roundCoordinate(value) {
  return Math.round(value * 10000) / 10000;
}

function trimString(value, limit = MAX_META_STRING) {
  return value.length <= limit ? value : value.slice(0, limit);
}

function firstNonEmpty(...values) {
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
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

function viewportBucket(width) {
  if (width <= 0) {
    return "unknown";
  }
  if (width < 480) {
    return "xs";
  }
  if (width < 768) {
    return "sm";
  }
  if (width < 1024) {
    return "md";
  }
  if (width < 1440) {
    return "lg";
  }
  return "xl";
}

function layoutVariantKey() {
  const html = document.documentElement;
  const body = document.body;
  const variant = trimString(
    firstNonEmpty(
      html ? html.getAttribute("data-track-variant") || "" : "",
      html ? html.getAttribute("data-layout-variant") || "" : "",
      body ? body.getAttribute("data-track-variant") || "" : "",
      body ? body.getAttribute("data-layout-variant") || "" : "",
      body ? body.getAttribute("data-ab-variant") || "" : "",
    ) || "default",
    24,
  );
  const locale = trimString((html && html.lang) || navigator.language || "und", 12);
  const auth = trimString(
    firstNonEmpty(
      body ? body.getAttribute("data-auth-state") || "" : "",
      body ? body.getAttribute("data-auth") || "" : "",
    ) || "unknown",
    12,
  );
  return `${variant}|${locale}|${auth}`;
}

function sanitizeValue(value, seen = new Set(), depth = 0) {
  if (value == null) {
    return null;
  }

  switch (typeof value) {
    case "string":
      return trimString(value);
    case "number":
      return Number.isFinite(value) ? value : null;
    case "boolean":
      return value;
    case "bigint":
      return trimString(String(value));
    case "object":
      break;
    default:
      return null;
  }

  if (typeof Element !== "undefined" && value instanceof Element) {
    return null;
  }
  if (typeof depth === "number" && depth >= 3) {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = [];
    for (let index = 0; index < value.length && items.length < 12; index += 1) {
      const item = sanitizeValue(value[index], seen, depth + 1);
      if (item !== null) {
        items.push(item);
      }
    }
    seen.delete(value);
    return items;
  }

  const output = {};
  const entries = Object.entries(value);
  for (let index = 0; index < entries.length && index < 12; index += 1) {
    const [key, entryValue] = entries[index];
    const item = sanitizeValue(entryValue, seen, depth + 1);
    if (item !== null) {
      output[trimString(String(key), 24)] = item;
    }
  }

  seen.delete(value);
  return output;
}

function fitsMeta(meta) {
  try {
    return JSON.stringify(meta).length <= MAX_META_BYTES;
  } catch {
    return false;
  }
}

function compactMeta(meta) {
  const output = sanitizeValue(meta) || {};
  if (fitsMeta(output)) {
    return output;
  }

  delete output.pr;
  if (fitsMeta(output)) {
    return output;
  }

  for (const key of ["uo", "ut", "uc", "um", "us", "ti", "r"]) {
    if (!(key in output)) {
      continue;
    }
    delete output[key];
    if (fitsMeta(output)) {
      return output;
    }
  }

  return {};
}

function readBackup() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BACKUP_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBackup(items) {
  try {
    if (items.length) {
      localStorage.setItem(BACKUP_KEY, JSON.stringify(items));
      return;
    }
    localStorage.removeItem(BACKUP_KEY);
  } catch {}
}

function readSequence() {
  try {
    const raw = sessionStorage.getItem(SEQUENCE_KEY);
    if (!raw) {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 0;
    }
    return parsed;
  } catch {
    return 0;
  }
}

function writeSequence(value) {
  try {
    sessionStorage.setItem(SEQUENCE_KEY, String(value));
  } catch {}
}

function createEventID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pageMeta(previousPath = "") {
  const url = new URL(window.location.href);
  const viewportWidth = window.innerWidth || 0;
  return {
    r: previousPath || document.referrer || "",
    ti: document.title || "",
    l: navigator.language || "",
    tz: new Date().getTimezoneOffset(),
    sw: window.screen.width || 0,
    sh: window.screen.height || 0,
    vw: viewportWidth,
    vh: window.innerHeight || 0,
    vb: viewportBucket(viewportWidth),
    lk: layoutVariantKey(),
    us: url.searchParams.get("utm_source") || "",
    um: url.searchParams.get("utm_medium") || "",
    uc: url.searchParams.get("utm_campaign") || "",
    ut: url.searchParams.get("utm_term") || "",
    uo: url.searchParams.get("utm_content") || "",
  };
}

async function deliver(url, payload, snapshot, options = {}) {
  const { useBeacon = false, onPayload = null } = options;

  try {
    const body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (ok) {
        return true;
      }
      writeBackup(snapshot);
    }

    const response = await fetch(url, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      body,
    });

    if (!response.ok) {
      return false;
    }

    if (typeof onPayload === "function") {
      try {
        const parsed = await response.json();
        await onPayload(parsed);
      } catch {}
    }

    return true;
  } catch {
    writeBackup(snapshot);
    return false;
  }
}

async function deliverDirect(url, payload, options = {}) {
  const { useBeacon = false, onPayload = null } = options;

  try {
    const body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
      if (ok) {
        return true;
      }
    }

    const response = await fetch(url, {
      method: "POST",
      keepalive: true,
      mode: "cors",
      credentials: "omit",
      headers: {
        "content-type": "application/json",
      },
      body,
    });

    if (!response.ok) {
      return false;
    }

    if (typeof onPayload === "function") {
      try {
        const parsed = await response.json();
        await onPayload(parsed);
      } catch {}
    }

    return true;
  } catch {
    return false;
  }
}

async function fetchJSON(url, options = {}) {
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      mode: "cors",
      credentials: "omit",
      headers: options.headers || undefined,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

export function createTracker({ apiOrigin, siteId, snapshotEndpoint = "" }) {
  const queue = readBackup();
  const endpoint = `${apiOrigin}/collect?id=${encodeURIComponent(siteId)}`;
  const replayEndpoint = `${apiOrigin}/replay?id=${encodeURIComponent(siteId)}`;
  const normalizedSnapshotEndpoint = (snapshotEndpoint || "").trim();
  const identity = createVisitorIdentity({ apiOrigin, siteId });
  const customEventSubscribers = [];
  let inFlight = false;
  let lastPath = "";
  let timer = 0;
  let heartbeatTimer = 0;
  let sequence = readSequence();

  function nextEventIdentity() {
    sequence += 1;
    writeSequence(sequence);
    return {
      id: createEventID(),
      sq: sequence,
    };
  }

  async function flush(reason = "interval") {
    if (inFlight || !queue.length) {
      return;
    }

    inFlight = true;
    const batch = queue.splice(0, REQUEST_BATCH_LIMIT);
    const requestPayload = {
      events: batch,
      ...identity.payload(),
      reason,
    };
    const ok = await deliver(endpoint, requestPayload, batch.concat(queue), {
      useBeacon: reason === "hidden",
      onPayload: identity.captureServerPayload,
    });
    if (!ok) {
      queue.unshift(...batch);
    }

    writeBackup(ok ? [] : queue);
    inFlight = false;

    if (queue.length >= FLUSH_THRESHOLD) {
      void flush(ok ? "drain" : reason);
    }
  }

  function enqueue(event) {
    queue.push(event);
    if (queue.length >= FLUSH_THRESHOLD) {
      void flush("size");
    }
  }

  function trackPage(previousPath = "") {
    const path = currentPath();
    if (path === lastPath) {
      return;
    }

    lastPath = path;
    enqueue({
      ...nextEventIdentity(),
      e: "pageview",
      t: Date.now(),
      sid: getSession(),
      p: path,
      meta: compactMeta(pageMeta(previousPath)),
    });
  }

  function track(name, props = {}) {
    if (!name) {
      return;
    }

    const sanitizedProps = props && Object.keys(props).length ? compactMeta(props) : {};

    enqueue({
      ...nextEventIdentity(),
      e: name,
      t: Date.now(),
      sid: getSession(),
      p: currentPath(),
      meta: compactMeta({
        ...pageMeta(),
        pr: Object.keys(sanitizedProps).length ? sanitizedProps : undefined,
      }),
    });

    for (let index = 0; index < customEventSubscribers.length; index += 1) {
      try {
        customEventSubscribers[index]({
          name,
          props: sanitizedProps,
          path: currentPath(),
          ts: Date.now(),
        });
      } catch {}
    }
  }

  function start(options = {}) {
    const spaTrackingEnabled = options.spaTrackingEnabled !== false;
    void identity.bootstrap();

    if (!timer) {
      timer = window.setInterval(() => {
        void flush("interval");
      }, FLUSH_INTERVAL_MS);
    }
    if (!heartbeatTimer) {
      heartbeatTimer = window.setInterval(() => {
        if (document.visibilityState !== "visible") {
          return;
        }
        enqueue({
          ...nextEventIdentity(),
          e: "heartbeat",
          t: Date.now(),
          sid: getSession(),
          p: currentPath(),
        });
      }, HEARTBEAT_INTERVAL_MS);
    }

    const flushHidden = () => {
      void identity.sync("hidden");
      void flush("hidden");
    };

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flushHidden();
      }
    });
    window.addEventListener("pagehide", flushHidden, { passive: true });
    window.addEventListener("beforeunload", flushHidden, { passive: true });

    if (spaTrackingEnabled) {
      const patchHistory = (method) => {
        const original = history[method];
        history[method] = function patchedHistory(...args) {
          const previousPath = currentPath();
          const result = original.apply(this, args);
          queueMicrotask(() => trackPage(previousPath));
          return result;
        };
      };

      patchHistory("pushState");
      patchHistory("replaceState");
      window.addEventListener("popstate", () => trackPage(lastPath));
      window.addEventListener("hashchange", () => trackPage(lastPath));
    }

    if (queue.length) {
      void flush("recovery");
    }
    trackPage();
  }

  return {
    currentPath,
    flush,
    siteID() {
      return siteId;
    },
    getSession,
    start,
    subscribeCustomEvents(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      customEventSubscribers.push(listener);
      return () => {
        const index = customEventSubscribers.indexOf(listener);
        if (index >= 0) {
          customEventSubscribers.splice(index, 1);
        }
      };
    },
    track,
    trackHeatmap(name, meta = {}) {
      const viewportWidth = window.innerWidth || 0;
      const viewportHeight = window.innerHeight || 0;
      const selector =
        typeof meta.selector === "string"
          ? trimString(meta.selector, MAX_SELECTOR_STRING).trim()
          : "";
      enqueue({
        ...nextEventIdentity(),
        e: name,
        t: Date.now(),
        sid: getSession(),
        p: currentPath(),
        x: typeof meta.x === "number" ? roundCoordinate(meta.x) : null,
        y: typeof meta.y === "number" ? roundCoordinate(meta.y) : null,
        sel: selector || null,
        depth: typeof meta.depth === "number" ? Math.round(meta.depth) : null,
        meta: {
          vw: viewportWidth,
          vh: viewportHeight,
          vb: viewportBucket(viewportWidth),
          lk: layoutVariantKey(),
          dw:
            typeof meta.documentWidth === "number"
              ? Math.max(0, Math.round(meta.documentWidth))
              : document.documentElement.scrollWidth || 0,
          dh:
            typeof meta.documentHeight === "number"
              ? Math.max(0, Math.round(meta.documentHeight))
              : document.documentElement.scrollHeight || 0,
          sx: typeof meta.scrollX === "number" ? Math.round(meta.scrollX) : window.scrollX || 0,
          sy: typeof meta.scrollY === "number" ? Math.round(meta.scrollY) : window.scrollY || 0,
          rx: typeof meta.rawX === "number" ? Math.round(meta.rawX) : undefined,
          ry: typeof meta.rawY === "number" ? Math.round(meta.rawY) : undefined,
          pt: typeof meta.pointerType === "string" ? trimString(meta.pointerType, 12) : undefined,
          hd: typeof meta.hoverMs === "number" ? Math.max(0, Math.round(meta.hoverMs)) : undefined,
          rg: !!meta.rage,
          dg: !!meta.dead,
          eg: !!meta.error,
          bz: !!meta.blockedZone,
        },
      });
    },
    trackMetric(name, value, props = {}) {
      if (!name || !Number.isFinite(value)) {
        return;
      }

      track(name, {
        v: round(value),
        ...props,
      });
    },
    async captureDOMSnapshot(snapshot, reason = "dom_snapshot", requestId = "") {
      if (!normalizedSnapshotEndpoint || !snapshot || typeof snapshot !== "object") {
        return false;
      }

      const html = typeof snapshot.html === "string" ? snapshot.html : "";
      if (!html.trim()) {
        return false;
      }

      const snapshotPath =
        typeof snapshot.path === "string" && snapshot.path.trim()
          ? snapshot.path.trim()
          : currentPath();
      const snapshotURL =
        typeof snapshot.pageUrl === "string" && snapshot.pageUrl.trim()
          ? snapshot.pageUrl.trim()
          : window.location.href;

      const payload = {
        siteId,
        path: snapshotPath,
        url: snapshotURL,
        reason,
        requestId: typeof requestId === "string" ? requestId.trim() : "",
        snapshot: {
          html,
          css: typeof snapshot.css === "string" ? snapshot.css : "",
          title: typeof snapshot.title === "string" ? snapshot.title : document.title || "",
          viewportWidth:
            typeof snapshot.viewportWidth === "number"
              ? Math.round(snapshot.viewportWidth)
              : window.innerWidth || 0,
          viewportHeight:
            typeof snapshot.viewportHeight === "number"
              ? Math.round(snapshot.viewportHeight)
              : window.innerHeight || 0,
          documentWidth:
            typeof snapshot.documentWidth === "number"
              ? Math.round(snapshot.documentWidth)
              : document.documentElement.scrollWidth || window.innerWidth || 0,
          documentHeight:
            typeof snapshot.documentHeight === "number"
              ? Math.round(snapshot.documentHeight)
              : document.documentElement.scrollHeight || window.innerHeight || 0,
          capturedAt:
            typeof snapshot.capturedAt === "string" && snapshot.capturedAt
              ? snapshot.capturedAt
              : new Date().toISOString(),
          contentHash: typeof snapshot.contentHash === "string" ? snapshot.contentHash : "",
        },
      };

      return deliverDirect(normalizedSnapshotEndpoint, payload, {
        useBeacon: reason === "hidden",
        onPayload: identity.captureServerPayload,
      });
    },
    async checkDOMSnapshotRefresh(path = currentPath()) {
      if (!normalizedSnapshotEndpoint) {
        return null;
      }

      try {
        const endpoint = new URL(normalizedSnapshotEndpoint);
        endpoint.searchParams.set("path", path || currentPath());
        const payload = await fetchJSON(endpoint.toString());
        if (!payload || payload.pending !== true || typeof payload.requestId !== "string" || !payload.requestId.trim()) {
          return null;
        }

        return {
          path: typeof payload.path === "string" && payload.path ? payload.path : path,
          scope: payload.scope === "site" ? "site" : "path",
          requestId: payload.requestId.trim(),
          requestedAt: typeof payload.requestedAt === "string" ? payload.requestedAt : "",
        };
      } catch {
        return null;
      }
    },
    async sendReplay(payload, reason = "replay") {
      if (!payload || typeof payload !== "object") {
        return false;
      }

      const sessionPayload = payload.session && typeof payload.session === "object" ? payload.session : null;
      const chunks = Array.isArray(payload.chunks) ? payload.chunks : [];
      if (!sessionPayload || !chunks.length) {
        return false;
      }

      return deliverDirect(replayEndpoint, {
        ...identity.payload(),
        siteId,
        reason,
        session: sessionPayload,
        chunks,
      }, {
        useBeacon: reason === "hidden",
        onPayload: identity.captureServerPayload,
      });
    },
  };
}

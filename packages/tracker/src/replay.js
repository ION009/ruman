const DEFAULT_FLUSH_INTERVAL_MS = 4000;
const MAX_CHUNK_EVENTS = 160;
const MAX_CHUNK_BYTES = 750000;
const MAX_PENDING_REPLAY_CHUNKS = 8;
const MAX_PENDING_REPLAY_BYTES = 2500000;
const MAX_MUTATION_CHANGES = 120;
const MAX_TEXT_CHARS = 4000;
const MAX_CSS_CHARS = 600000;
const MAX_URL_CHARS = 480;
const MAX_PATHS = 16;
const MAX_SERIALIZED_NODES = 5000;
const CLICK_WINDOW_MS = 700;
const RAGE_CLICK_THRESHOLD = 3;
const POINTER_SAMPLE_INTERVAL_MS = 48;
const POINTER_MIN_DELTA_PX = 4;
const SCROLL_SAMPLE_INTERVAL_MS = 75;
const SCROLL_MIN_DELTA_PX = 8;
const ROUTE_SNAPSHOT_DELAY_MS = 120;
const REPLAY_STATE_KEY = "_ars";
const REPLAY_SESSION_KEY = "_arsid";
const REPLAY_STATE_TTL_MS = 35 * 60 * 1000;
const INTERACTIVE_SELECTOR =
  "a[href],button,input,select,textarea,summary,label,[role='button'],[role='link'],[contenteditable=''],[contenteditable='true'],[onclick],[data-track-id]";
const ERROR_SELECTOR = "[disabled],[aria-disabled='true'],[aria-invalid='true'],[data-error],[data-invalid='true']";
const EXPLICIT_BLOCK_SELECTOR = [
  "[data-replay-block]",
  "[data-private]",
  "[data-norecord]",
].join(",");
const BLOCKED_CONTROL_SELECTOR = [
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(",");
const EXPLICIT_IGNORE_SELECTOR = "[data-replay-ignore]";
const MEDIA_BLOCK_SELECTOR = "script,noscript,iframe,object,embed,canvas,video,audio,source,track";
const SENSITIVE_FIELD_HINTS = [
  "payment",
  "billing",
  "checkout",
  "credit",
  "debit",
  "card",
  "cc-",
  "cvv",
  "cvc",
  "expiry",
  "exp-month",
  "exp-year",
  "iban",
  "swift",
  "routing",
  "bank-account",
  "password",
  "passcode",
  "otp",
  "one-time-code",
  "verification-code",
  "email",
  "phone",
  "mobile",
  "address",
  "street",
  "postal",
  "zip",
  "first-name",
  "last-name",
  "full-name",
  "birth",
  "dob",
  "ssn",
  "tax-id",
  "vat",
];
const SENSITIVE_DISPLAY_HINTS = [
  "email",
  "phone",
  "mobile",
  "address",
  "street",
  "postal",
  "zip",
  "first-name",
  "last-name",
  "full-name",
  "customer-name",
  "billing-name",
  "shipping-name",
  "birth",
  "dob",
  "ssn",
  "tax-id",
  "vat",
];
const SENSITIVE_TEXT_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\d[ -]*?){13,19}\b/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b(?:\+?\d[\d(). -]{7,}\d)\b/g,
];
const SAFE_INPUT_VALUE_TYPES = new Set(["button", "submit", "reset"]);
const SAFE_ATTRIBUTES = new Set([
  "class",
  "id",
  "style",
  "href",
  "src",
  "rel",
  "media",
  "role",
  "type",
  "width",
  "height",
  "disabled",
  "target",
  "colspan",
  "rowspan",
  "placeholder",
  "alt",
  "checked",
  "selected",
  "value",
  "data-replay-block",
  "data-replay-ignore",
  "data-replay-unmask",
]);

let replayMaskAllText = false;

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForLayoutStability() {
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    try {
      await Promise.race([document.fonts.ready, wait(400)]);
    } catch {}
  }

  if (typeof requestAnimationFrame === "function") {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return;
  }

  await wait(34);
}

function trim(value, limit) {
  if (typeof value !== "string") {
    return "";
  }
  return value.length <= limit ? value : value.slice(0, limit);
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function normalizePointerType(value) {
  switch ((value || "").toLowerCase()) {
    case "touch":
      return "touch";
    case "pen":
      return "pen";
    case "keyboard":
      return "keyboard";
    default:
      return "mouse";
  }
}

function currentURL() {
  try {
    return window.location.href;
  } catch {
    return "";
  }
}

function currentRouteKey() {
  return currentURL();
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
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

function parseSampleRate(value, fallback = 0) {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, parsed));
}

function viewportBucket(width) {
  if (!Number.isFinite(width) || width <= 0) {
    return "unknown";
  }
  if (width < 768) {
    return "mobile";
  }
  if (width < 1024) {
    return "tablet";
  }
  return "desktop";
}

function deviceType() {
  return viewportBucket(window.innerWidth || 0);
}

function browserName() {
  const ua = navigator.userAgent || "";
  if (/edg\//i.test(ua)) {
    return "Edge";
  }
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) {
    return "Chrome";
  }
  if (/firefox\//i.test(ua)) {
    return "Firefox";
  }
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) {
    return "Safari";
  }
  return "Unknown";
}

function osName() {
  const ua = navigator.userAgent || "";
  if (/windows nt/i.test(ua)) {
    return "Windows";
  }
  if (/android/i.test(ua)) {
    return "Android";
  }
  if (/iphone|ipad|ipod/i.test(ua)) {
    return "iOS";
  }
  if (/mac os x/i.test(ua)) {
    return "macOS";
  }
  if (/linux/i.test(ua)) {
    return "Linux";
  }
  return "Unknown";
}

function respectPrivacyControls(options) {
  const navigatorDNT = String(navigator.doNotTrack || window.doNotTrack || "").trim();
  const globalPrivacyControl = Boolean(navigator.globalPrivacyControl);
  if (options.respectDNT !== false && navigatorDNT === "1") {
    return false;
  }
  if (options.respectGPC !== false && globalPrivacyControl) {
    return false;
  }

  const explicitConsent = window.__anlticsheatReplayConsent;
  if (explicitConsent === false) {
    return false;
  }
  if (typeof window.__anlticsheatShouldRecordReplay === "function") {
    try {
      if (!window.__anlticsheatShouldRecordReplay()) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

function shouldSampleSession(siteId, sessionId, sampleRate) {
  if (sampleRate <= 0) {
    return false;
  }
  if (sampleRate >= 1) {
    return true;
  }
  const bucket = hashString(`${siteId}:${sessionId}`) % 10000;
  return bucket < Math.round(sampleRate * 10000);
}

function documentScroll() {
  return {
    x: Math.max(0, Math.round(window.scrollX || 0)),
    y: Math.max(0, Math.round(window.scrollY || 0)),
  };
}

function sanitizeURL(raw, keepOrigin = true) {
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }
  try {
    const url = new URL(raw, window.location.href);
    if (!/^https?:$/.test(url.protocol)) {
      return "";
    }
    const prefix = keepOrigin ? `${url.origin}` : "";
    return trim(`${prefix}${url.pathname}`, MAX_URL_CHARS);
  } catch {
    return trim(raw, MAX_URL_CHARS);
  }
}

function sanitizeURLPattern(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return "";
  }
  try {
    const url = new URL(raw, window.location.href);
    const segments = url.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => {
        if (/^\d+$/.test(segment)) {
          return ":id";
        }
        if (/^[0-9a-f]{8,}$/i.test(segment) || /^[0-9a-f-]{24,}$/i.test(segment)) {
          return ":id";
        }
        if (segment.length > 40) {
          return ":id";
        }
        return segment;
      });
    const queryKeys = Array.from(url.searchParams.keys())
      .filter(Boolean)
      .slice(0, 12)
      .sort();
    const query = queryKeys.length ? `?${queryKeys.join("&")}` : "";
    return trim(`${url.origin}${segments.length ? `/${segments.join("/")}` : ""}${query}`, MAX_URL_CHARS);
  } catch {
    return trim(raw, MAX_URL_CHARS);
  }
}

function sanitizeReplayPath(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return "/";
  }
  try {
    const url = new URL(raw, window.location.href);
    const queryKeys = Array.from(new Set(Array.from(url.searchParams.keys()).filter(Boolean)))
      .slice(0, 12)
      .sort();
    const query = queryKeys.length ? `?${queryKeys.join("&")}` : "";
    const hash = url.hash ? trim(url.hash, 80) : "";
    return trim(`${url.pathname || "/"}${query}${hash}`, MAX_URL_CHARS) || "/";
  } catch {
    return trim(raw, MAX_URL_CHARS) || "/";
  }
}

function currentReplayPath() {
  return sanitizeReplayPath(currentURL());
}

function readReplayState(siteId, sessionId) {
  try {
    const raw = sessionStorage.getItem(REPLAY_STATE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (trim(parsed.siteId || "", 160) !== trim(siteId || "", 160)) {
      return null;
    }
    if (trim(parsed.sessionId || "", 160) !== trim(sessionId || "", 160)) {
      return null;
    }
    const updatedAt = Date.parse(parsed.updatedAt || parsed.startedAt || "");
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > REPLAY_STATE_TTL_MS) {
      sessionStorage.removeItem(REPLAY_STATE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeReplayState(state) {
  try {
    sessionStorage.setItem(REPLAY_STATE_KEY, JSON.stringify(state));
  } catch {}
}

function readReplaySession(siteId) {
  try {
    const raw = sessionStorage.getItem(REPLAY_SESSION_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (trim(parsed.siteId || "", 160) !== trim(siteId || "", 160)) {
      return null;
    }
    if (trim(parsed.sessionId || "", 160) === "") {
      return null;
    }
    if (!Number.isFinite(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
      sessionStorage.removeItem(REPLAY_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeReplaySession(siteId, sessionId, expiresAt) {
  try {
    sessionStorage.setItem(REPLAY_SESSION_KEY, JSON.stringify({
      siteId,
      sessionId,
      expiresAt,
    }));
  } catch {}
}

function replaySessionID(siteId) {
  const existing = readReplaySession(siteId);
  const expiresAt = Date.now() + REPLAY_STATE_TTL_MS;
  const sessionId =
    existing && trim(existing.sessionId || "", 160)
      ? trim(existing.sessionId || "", 160)
      : crypto.randomUUID();
  writeReplaySession(siteId, sessionId, expiresAt);
  return sessionId;
}

function shouldIgnoreNetworkURL(raw) {
  try {
    const url = new URL(raw, window.location.href);
    const path = url.pathname.replace(/\/+$/, "");
    return (
      path.endsWith("/collect") ||
      path.endsWith("/identity") ||
      path.endsWith("/replay") ||
      path.endsWith("/t.js") ||
      path.endsWith("/api/public/heatmap/dom-snapshot")
    );
  } catch {
    return false;
  }
}

function percent(value, total) {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

function trackedTarget(target) {
  if (!(target instanceof Element)) {
    return null;
  }
  return target.closest(INTERACTIVE_SELECTOR) || target;
}

function escapeCSS(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function isUniqueSelector(selector) {
  if (!selector) {
    return false;
  }
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function combineClasses(classes, size, start, path, output) {
  if (path.length === size) {
    output.push(path.join("."));
    return;
  }

  for (let index = start; index < classes.length; index += 1) {
    path.push(escapeCSS(classes[index]));
    combineClasses(classes, size, index + 1, path, output);
    path.pop();
  }
}

function shortestUniqueClassSelector(element) {
  const tag = element.tagName.toLowerCase();
  const classes = Array.from(element.classList || []).filter(Boolean).slice(0, 6);
  if (!classes.length) {
    return null;
  }

  const maxSize = Math.min(3, classes.length);
  for (let size = 1; size <= maxSize; size += 1) {
    const candidates = [];
    combineClasses(classes, size, 0, [], candidates);
    for (let index = 0; index < candidates.length; index += 1) {
      const selector = `${tag}.${candidates[index]}`;
      if (isUniqueSelector(selector)) {
        return selector;
      }
    }
  }
  return null;
}

function nthPathSelector(element) {
  const segments = [];
  let current = element;

  while (current && current.nodeType === 1 && current !== document.documentElement) {
    const parent = current.parentElement;
    if (!parent) {
      break;
    }

    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      index += 1;
      sibling = sibling.previousElementSibling;
    }

    segments.unshift(`${current.tagName.toLowerCase()}:nth-child(${index})`);
    const selector = `html > ${segments.join(" > ")}`;
    if (isUniqueSelector(selector)) {
      return selector;
    }
    current = parent;
  }

  return segments.length ? `html > ${segments.join(" > ")}` : null;
}

function xpathSelector(element) {
  const segments = [];
  let current = element;

  while (current && current.nodeType === 1) {
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index += 1;
      }
      sibling = sibling.previousElementSibling;
    }
    segments.unshift(`${current.tagName.toLowerCase()}[${index}]`);
    current = current.parentElement;
  }

  return segments.length ? `xpath:/${segments.join("/")}` : null;
}

function stableSelector(target) {
  const element = trackedTarget(target);
  if (!element) {
    return "";
  }

  const tracked = element.closest("[data-track-id]");
  if (tracked && tracked.getAttribute("data-track-id")) {
    return trim(tracked.getAttribute("data-track-id"), 240);
  }

  const identified = element.closest("[id]");
  if (identified && identified.id) {
    return trim(`#${escapeCSS(identified.id)}`, 240);
  }

  return trim(shortestUniqueClassSelector(element) || nthPathSelector(element) || xpathSelector(element) || "", 240);
}

function isLikelyDeadClick(target) {
  return target instanceof Element ? !target.closest(INTERACTIVE_SELECTOR) : false;
}

function isLikelyErrorClick(target) {
  return target instanceof Element ? Boolean(target.closest(ERROR_SELECTOR)) : false;
}

function matchesSensitiveHint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  for (let index = 0; index < SENSITIVE_FIELD_HINTS.length; index += 1) {
    if (normalized.includes(SENSITIVE_FIELD_HINTS[index])) {
      return true;
    }
  }
  return false;
}

function elementHintValues(element) {
  if (!(element instanceof Element)) {
    return [];
  }
  return [
    element.id,
    element.className,
    element.getAttribute("name"),
    element.getAttribute("aria-label"),
    element.getAttribute("data-testid"),
    element.getAttribute("autocomplete"),
    element.getAttribute("inputmode"),
    element.getAttribute("placeholder"),
    element.getAttribute("role"),
    element.getAttribute("type"),
  ];
}

function normalizeInputType(value) {
  return String(value || "text").trim().toLowerCase() || "text";
}

function matchesSensitiveDisplayHint(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  for (let index = 0; index < SENSITIVE_DISPLAY_HINTS.length; index += 1) {
    if (normalized.includes(SENSITIVE_DISPLAY_HINTS[index])) {
      return true;
    }
  }
  return false;
}

function isSensitiveDisplayRegion(element) {
  if (!(element instanceof Element)) {
    return false;
  }
  let current = element;
  let depth = 0;
  while (current && current instanceof Element && depth < 3) {
    const candidates = elementHintValues(current);
    for (let index = 0; index < candidates.length; index += 1) {
      if (matchesSensitiveDisplayHint(candidates[index])) {
        return true;
      }
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

function hasSensitiveFieldHints(element) {
  const candidates = elementHintValues(element);
  for (let index = 0; index < candidates.length; index += 1) {
    if (matchesSensitiveHint(candidates[index])) {
      return true;
    }
  }
  return false;
}

function maskText(value) {
  const trimmed = trim(value, MAX_TEXT_CHARS);
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/[^\s]/g, "•");
}

function maskTextMatch(value) {
  return String(value || "").replace(/[A-Za-z0-9]/g, "•");
}

function maskSensitiveText(value) {
  let output = trim(value, MAX_TEXT_CHARS);
  if (!output) {
    return "";
  }
  for (let index = 0; index < SENSITIVE_TEXT_PATTERNS.length; index += 1) {
    output = output.replace(SENSITIVE_TEXT_PATTERNS[index], (match) => maskTextMatch(match));
  }
  return output;
}

function sanitizeStyle(value) {
  const sanitized = trim(value, 4000);
  if (!sanitized) {
    return "";
  }
  return sanitized
    .replace(/url\(([^)]+)\)/gi, "url(\"\")")
    .replace(/expression\(([^)]+)\)/gi, "");
}

function serializeElementAttribute(element, name, value) {
  const normalizedName = String(name || "").toLowerCase();
  if (!SAFE_ATTRIBUTES.has(normalizedName) && !normalizedName.startsWith("aria-")) {
    return null;
  }

  if (normalizedName.startsWith("aria-")) {
    if (normalizedName === "aria-hidden" || normalizedName === "aria-disabled") {
      return String(value || "");
    }
    return null;
  }

  if (normalizedName === "style") {
    return sanitizeStyle(value);
  }
  if (normalizedName === "href" || normalizedName === "src") {
    return sanitizeURL(value, true);
  }
  if (normalizedName === "value") {
    if (element.tagName.toLowerCase() !== "input") {
      return null;
    }
    const inputType = normalizeInputType(element.getAttribute("type"));
    if (!SAFE_INPUT_VALUE_TYPES.has(inputType)) {
      return null;
    }
    return trim(String(value || ""), 120);
  }
  if (normalizedName === "checked" || normalizedName === "selected") {
    return "1";
  }
  if (normalizedName === "id" || normalizedName === "class") {
    return trim(String(value || ""), 320);
  }
  if (normalizedName === "data-replay-unmask" || normalizedName === "data-replay-block" || normalizedName === "data-replay-ignore") {
    return "1";
  }

  if (element.tagName.toLowerCase() === "link" && normalizedName === "rel") {
    return trim(String(value || ""), 40);
  }

  return trim(String(value || ""), 240);
}

function serializeTextContent(parent, value) {
  const rawText = trim(value, MAX_TEXT_CHARS);
  if (!rawText) {
    return "";
  }
  if (!parent || parent.tagName.toLowerCase() === "style") {
    return rawText;
  }
  if (Boolean(parent.closest("[data-replay-unmask]"))) {
    return rawText;
  }
  if (replayMaskAllText) {
    return maskText(rawText);
  }
  if (isSensitiveDisplayRegion(parent)) {
    return maskText(rawText);
  }
  return maskSensitiveText(rawText);
}

function approximateEventBytes(event) {
  try {
    return JSON.stringify(event).length;
  } catch {
    return 256;
  }
}

function normalizeMessagePart(value, seen = new Set(), depth = 0) {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return trim(value, 240);
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return trim(String(value), 80);
  }
  if (typeof value === "function") {
    return "";
  }
  if (typeof Element !== "undefined" && value instanceof Element) {
    return trim(stableSelector(value), 180);
  }
  if (depth >= 2 || seen.has(value)) {
    return "";
  }

  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeMessagePart(item, seen, depth + 1)).filter(Boolean);
    seen.delete(value);
    return trim(items.join(", "), 320);
  }

  const pairs = Object.entries(value)
    .slice(0, 8)
    .map(([key, item]) => {
      const normalized = normalizeMessagePart(item, seen, depth + 1);
      return normalized ? `${trim(String(key), 24)}:${normalized}` : "";
    })
    .filter(Boolean);
  seen.delete(value);
  return trim(pairs.join(", "), 320);
}

function detectReplayOptions() {
  const script = document.currentScript;
  const scriptURL = script && script.src ? new URL(script.src, window.location.href) : null;
  const dataReplay = script && script.getAttribute("data-replay");
  const queryReplay = scriptURL ? scriptURL.searchParams.get("replay") : "";
  const dataSampleRate = script && script.getAttribute("data-replay-sample-rate");
  const querySampleRate = scriptURL ? scriptURL.searchParams.get("replay_sample") : "";
  const enabled = parseBoolean(dataReplay || queryReplay || "", false);
  const sampleRate = parseSampleRate(dataSampleRate || querySampleRate || "", 1);
  return {
    enabled,
    sampleRate,
    respectDNT: true,
    respectGPC: true,
    errorTrackingEnabled: true,
    maskAllText: false,
  };
}

export function startReplay(tracker, options = {}) {
  if (!tracker || typeof tracker.sendReplay !== "function" || typeof tracker.currentPath !== "function") {
    return {
      enabled: false,
      flush: () => Promise.resolve(false),
    };
  }

  const replayOptions = {
    ...detectReplayOptions(),
    ...options,
  };

  replayMaskAllText = Boolean(replayOptions.maskAllText);

  if (!replayOptions.enabled) {
    replayMaskAllText = false;
    return {
      enabled: false,
      flush: () => Promise.resolve(false),
    };
  }

  if (!respectPrivacyControls(replayOptions)) {
    replayMaskAllText = false;
    return {
      enabled: false,
      flush: () => Promise.resolve(false),
    };
  }

  const siteId = typeof tracker.siteID === "function" ? tracker.siteID() : "";
  const sessionId = replaySessionID(siteId);
  if (!shouldSampleSession(siteId, sessionId, replayOptions.sampleRate)) {
    replayMaskAllText = false;
    return {
      enabled: false,
      flush: () => Promise.resolve(false),
    };
  }

  const nodeIDs = new WeakMap();
  let nextNodeID = 1;
  const persistedState = readReplayState(siteId, sessionId);
  let lastPath = currentReplayPath();
  let lastRouteKey = currentRouteKey();
  const resumedAt = persistedState ? Date.parse(persistedState.startedAt || "") : Number.NaN;
  const sessionStartedAt = Number.isFinite(resumedAt) ? resumedAt : Date.now();
  const knownPaths = new Set(Array.isArray(persistedState && persistedState.paths) ? persistedState.paths : []);
  if (lastPath) {
    knownPaths.add(lastPath);
  }
  const initialPreviousPath = persistedState && typeof persistedState.exitPath === "string" ? sanitizeReplayPath(persistedState.exitPath) : "";
  const shouldEmitDocumentRoute = Boolean(initialPreviousPath && initialPreviousPath !== lastPath);
  const recentClicks = [];
  let currentChunkEvents = [];
  let currentChunkBytes = 0;
  let chunkStartedAt = 0;
  let currentChunkPath = lastPath;
  let chunkIndex = Math.max(0, Number.parseInt(String((persistedState && persistedState.chunkCount) || 0), 10) || 0);
  let pendingChunks = [];
  let pendingReplayBytes = 0;
  let pendingMutationRecords = [];
  let mutationTimer = 0;
  let flushTimer = 0;
  let routeSnapshotTimer = 0;
  let lastPointerSampleAt = 0;
  let lastPointerX = -1;
  let lastPointerY = -1;
  let lastScrollSampleAt = 0;
  let lastScrollX = -1;
  let lastScrollY = -1;
  let disconnectMutationObserver = null;
  let removeListeners = [];
  let unpatchFetch = null;
  let unpatchXHR = null;
  let customEventUnsubscribe = null;
  let captureWindowOpen = false;
  let stopped = false;

  const sessionState = {
    sessionId,
    sampleRate: replayOptions.sampleRate,
    startedAt: (persistedState && persistedState.startedAt) || new Date(sessionStartedAt).toISOString(),
    updatedAt: (persistedState && persistedState.updatedAt) || new Date(sessionStartedAt).toISOString(),
    entryPath: (persistedState && persistedState.entryPath) || lastPath,
    exitPath: lastPath,
    durationMs: Math.max(0, Number.parseInt(String((persistedState && persistedState.durationMs) || 0), 10) || 0),
    pageCount: knownPaths.size,
    routeCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.routeCount) || 0), 10) || 0),
    chunkCount: chunkIndex,
    eventCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.eventCount) || 0), 10) || 0),
    errorCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.errorCount) || 0), 10) || 0),
    consoleErrorCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.consoleErrorCount) || 0), 10) || 0),
    networkFailureCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.networkFailureCount) || 0), 10) || 0),
    rageClickCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.rageClickCount) || 0), 10) || 0),
    deadClickCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.deadClickCount) || 0), 10) || 0),
    customEventCount: Math.max(0, Number.parseInt(String((persistedState && persistedState.customEventCount) || 0), 10) || 0),
    deviceType: deviceType(),
    browser: browserName(),
    os: osName(),
    viewport: {
      width: Math.round(window.innerWidth || 0),
      height: Math.round(window.innerHeight || 0),
      bucket: viewportBucket(window.innerWidth || 0),
    },
    paths: Array.from(knownPaths),
  };

  function ensureNodeID(node) {
    if (!node || (node.nodeType !== 1 && node.nodeType !== 3)) {
      return 0;
    }
    let id = nodeIDs.get(node);
    if (!id) {
      id = nextNodeID;
      nextNodeID += 1;
      nodeIDs.set(node, id);
    }
    return id;
  }

  function isUnmaskedElement(element) {
    return element instanceof Element ? Boolean(element.closest("[data-replay-unmask]")) : false;
  }

  function isSensitiveFieldElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    const tagName = element.tagName.toLowerCase();
    if (element.matches(BLOCKED_CONTROL_SELECTOR)) {
      return true;
    }
    if (tagName === "input") {
      const inputType = normalizeInputType(element.getAttribute("type"));
      if (SAFE_INPUT_VALUE_TYPES.has(inputType) || inputType === "checkbox" || inputType === "radio" || inputType === "range" || inputType === "color" || inputType === "file" || inputType === "image") {
        return false;
      }
      if (inputType === "password" || inputType === "hidden") {
        return true;
      }
      const autocomplete = normalizeInputType(element.getAttribute("autocomplete"));
      if (
        autocomplete === "cc-number" ||
        autocomplete === "cc-csc" ||
        autocomplete === "cc-exp" ||
        autocomplete === "cc-exp-month" ||
        autocomplete === "cc-exp-year" ||
        autocomplete === "current-password" ||
        autocomplete === "new-password" ||
        autocomplete === "one-time-code"
      ) {
        return true;
      }
      return hasSensitiveFieldHints(element);
    }
    const role = normalizeInputType(element.getAttribute("role"));
    if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "spinbutton") {
      return hasSensitiveFieldHints(element);
    }
    return false;
  }

  function shouldBlockElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (element.closest(EXPLICIT_BLOCK_SELECTOR)) {
      return true;
    }
    if (element.closest(EXPLICIT_IGNORE_SELECTOR)) {
      return true;
    }
    if (isUnmaskedElement(element)) {
      return false;
    }
    return isSensitiveFieldElement(element);
  }

  function shouldIgnoreElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }
    if (element.matches(MEDIA_BLOCK_SELECTOR) || Boolean(element.closest(EXPLICIT_IGNORE_SELECTOR))) {
      return true;
    }
    if (element.tagName.toLowerCase() === "link") {
      const rel = normalizeInputType(element.getAttribute("rel"));
      if (rel === "stylesheet" || rel === "preload") {
        return true;
      }
    }
    return false;
  }

  function serializeNode(node, state = { count: 0 }) {
    if (!node || state.count >= MAX_SERIALIZED_NODES) {
      return null;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (!parent) {
        return null;
      }
      const rawText = trim(node.textContent || "", MAX_TEXT_CHARS);
      if (!rawText) {
        return null;
      }
      state.count += 1;
      return {
        id: ensureNodeID(node),
        nodeType: 3,
        textContent: serializeTextContent(parent, rawText),
      };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const element = node;
    if (shouldIgnoreElement(element)) {
      return null;
    }

    state.count += 1;
    const blocked = shouldBlockElement(element);
    const attributes = {};
    const names = element.getAttributeNames();
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const value = serializeElementAttribute(element, name, element.getAttribute(name) || "");
      if (value) {
        attributes[name] = value;
      }
    }

    const childNodes = [];
    if (blocked) {
      childNodes.push({
        id: ensureNodeID({ nodeType: 3 }),
        nodeType: 3,
        textContent: "[Blocked]",
      });
    } else {
      const children = element.childNodes;
      for (let index = 0; index < children.length; index += 1) {
        const child = serializeNode(children[index], state);
        if (child) {
          childNodes.push(child);
        }
        if (state.count >= MAX_SERIALIZED_NODES) {
          break;
        }
      }
    }

    return {
      id: ensureNodeID(element),
      nodeType: 1,
      tagName: element.tagName.toLowerCase(),
      blocked,
      attributes,
      childNodes,
    };
  }

  function queueEvent(type, data) {
    if (stopped) {
      return;
    }
    // Preserve user input and diagnostics during route changes; only DOM
    // mutations are unsafe until a fresh route snapshot lands.
    if (!captureWindowOpen && type === "mutation") {
      return;
    }
    const ts = Date.now();
    const eventPath = type === "route" && data && data.path ? sanitizeReplayPath(data.path) : lastPath;
    const event = {
      type,
      ts,
      data,
    };
    if (!chunkStartedAt) {
      chunkStartedAt = ts;
      currentChunkPath = eventPath || lastPath;
    }
    currentChunkEvents.push(event);
    currentChunkBytes += approximateEventBytes(event);
    sessionState.eventCount += 1;
    sessionState.updatedAt = new Date(ts).toISOString();
    sessionState.durationMs = Math.max(0, ts - sessionStartedAt);
    sessionState.exitPath = lastPath;

    if (type === "route") {
      sessionState.routeCount += 1;
      knownPaths.add(eventPath || lastPath);
      sessionState.pageCount = knownPaths.size;
      sessionState.paths = Array.from(knownPaths).slice(0, MAX_PATHS);
    }
    if (type === "console") {
      sessionState.consoleErrorCount += 1;
      sessionState.errorCount += 1;
    }
    if (type === "network" && !data.ok) {
      sessionState.networkFailureCount += 1;
      sessionState.errorCount += 1;
    }
    if (type === "click" && data.rage) {
      sessionState.rageClickCount += 1;
    }
    if (type === "click" && data.dead) {
      sessionState.deadClickCount += 1;
    }
    if (type === "custom") {
      sessionState.customEventCount += 1;
    }

    if (currentChunkEvents.length >= MAX_CHUNK_EVENTS || currentChunkBytes >= MAX_CHUNK_BYTES) {
      void flush("size");
      return;
    }
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimer) {
      return;
    }
    flushTimer = window.setTimeout(() => {
      flushTimer = 0;
      void flush("interval");
    }, DEFAULT_FLUSH_INTERVAL_MS);
  }

  function buildChunk(reason) {
    if (!currentChunkEvents.length) {
      return null;
    }

    const lastEvent = currentChunkEvents[currentChunkEvents.length - 1];
    chunkIndex += 1;
    sessionState.chunkCount = chunkIndex;

    const summary = {
      fullSnapshots: currentChunkEvents.filter((event) => event.type === "full_snapshot").length,
      mutationEvents: currentChunkEvents.filter((event) => event.type === "mutation").length,
      consoleErrors: currentChunkEvents.filter((event) => event.type === "console").length,
      networkFailures: currentChunkEvents.filter((event) => event.type === "network" && !event.data.ok).length,
      rageClicks: currentChunkEvents.filter((event) => event.type === "click" && event.data.rage).length,
      deadClicks: currentChunkEvents.filter((event) => event.type === "click" && event.data.dead).length,
      routeChanges: currentChunkEvents.filter((event) => event.type === "route").length,
      customEvents: currentChunkEvents.filter((event) => event.type === "custom").length,
    };

    const chunk = {
      index: chunkIndex,
      reason,
      startedAt: new Date(chunkStartedAt).toISOString(),
      endedAt: new Date(lastEvent.ts).toISOString(),
      path: currentChunkPath || lastPath,
      eventCount: currentChunkEvents.length,
      summary,
      events: currentChunkEvents,
    };

    currentChunkEvents = [];
    currentChunkBytes = 0;
    chunkStartedAt = 0;
    currentChunkPath = lastPath;
    return chunk;
  }

  function persistSessionState() {
    writeReplayState({
      siteId,
      sessionId,
      startedAt: sessionState.startedAt,
      updatedAt: sessionState.updatedAt,
      durationMs: sessionState.durationMs,
      entryPath: sessionState.entryPath,
      exitPath: sessionState.exitPath,
      pageCount: sessionState.pageCount,
      routeCount: sessionState.routeCount,
      chunkCount: sessionState.chunkCount,
      eventCount: sessionState.eventCount,
      errorCount: sessionState.errorCount,
      consoleErrorCount: sessionState.consoleErrorCount,
      networkFailureCount: sessionState.networkFailureCount,
      rageClickCount: sessionState.rageClickCount,
      deadClickCount: sessionState.deadClickCount,
      customEventCount: sessionState.customEventCount,
      paths: Array.from(knownPaths).slice(0, MAX_PATHS),
    });
  }

  function collectStylesheetText() {
    const styleSheets = Array.from(document.styleSheets || []);
    const chunks = [];
    let size = 0;

    for (let index = 0; index < styleSheets.length; index += 1) {
      const sheet = styleSheets[index];
      let rules = null;
      try {
        rules = sheet.cssRules || sheet.rules || null;
      } catch {
        rules = null;
      }

      if (!rules || !rules.length) {
        continue;
      }

      for (let ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
        const rule = rules[ruleIndex];
        if (!rule || typeof rule.cssText !== "string") {
          continue;
        }

        const cssText = rule.cssText;
        size += cssText.length + 1;
        if (size > MAX_CSS_CHARS) {
          chunks.push(trim(cssText, Math.max(0, MAX_CSS_CHARS - (size - cssText.length - 1))));
          return chunks.join("\n");
        }
        chunks.push(cssText);
      }
    }

    return trim(chunks.join("\n"), MAX_CSS_CHARS);
  }

  function enqueuePendingChunk(chunk) {
    pendingChunks.push(chunk);
    pendingReplayBytes += approximateEventBytes(chunk);
    while (pendingChunks.length > MAX_PENDING_REPLAY_CHUNKS || pendingReplayBytes > MAX_PENDING_REPLAY_BYTES) {
      const removed = pendingChunks.shift();
      if (!removed) {
        break;
      }
      pendingReplayBytes = Math.max(0, pendingReplayBytes - approximateEventBytes(removed));
    }
  }

  async function flush(reason = "manual") {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = 0;
    }

    flushMutationQueue();
    const chunk = buildChunk(reason);
    if (chunk) {
      enqueuePendingChunk(chunk);
    }
    if (!pendingChunks.length) {
      return false;
    }

    sessionState.viewport = {
      width: Math.round(window.innerWidth || 0),
      height: Math.round(window.innerHeight || 0),
      bucket: viewportBucket(window.innerWidth || 0),
    };
    sessionState.deviceType = deviceType();
    sessionState.durationMs = Math.max(0, Date.now() - sessionStartedAt);
    sessionState.updatedAt = new Date().toISOString();
    sessionState.paths = Array.from(knownPaths).slice(0, MAX_PATHS);
    sessionState.pageCount = knownPaths.size;
    sessionState.exitPath = lastPath;

    const ok = await tracker.sendReplay(
      {
        session: {
          ...sessionState,
          paths: sessionState.paths,
        },
        chunks: pendingChunks.slice(),
      },
      reason,
    );
    if (ok) {
      pendingChunks = [];
      pendingReplayBytes = 0;
      persistSessionState();
    }
    return ok;
  }

  function buildFullSnapshot(reason) {
    const root = document.documentElement;
    if (!root) {
      return null;
    }

    const serialized = serializeNode(root);
    if (!serialized) {
      return null;
    }

    return {
      reason,
      url: sanitizeURLPattern(currentURL()),
      path: currentReplayPath(),
      title: trim(document.title || "", 240),
      cssText: collectStylesheetText(),
      viewport: {
        width: Math.round(window.innerWidth || 0),
        height: Math.round(window.innerHeight || 0),
      },
      scroll: documentScroll(),
      root: serialized,
    };
  }

  async function captureFullSnapshot(reason) {
    await waitForLayoutStability();
    const snapshot = buildFullSnapshot(reason);
    if (!snapshot) {
      return;
    }
    queueEvent("full_snapshot", snapshot);
  }

  function flushMutationQueue() {
    if (!pendingMutationRecords.length) {
      return;
    }

    const adds = [];
    const removes = [];
    const texts = [];
    const attrs = [];

    for (let index = 0; index < pendingMutationRecords.length; index += 1) {
      const record = pendingMutationRecords[index];
      if (!record) {
        continue;
      }

      if (record.type === "childList") {
        const parentId = ensureNodeID(record.target);
        const nextId = record.nextSibling ? ensureNodeID(record.nextSibling) : 0;
        for (let removeIndex = 0; removeIndex < record.removedNodes.length; removeIndex += 1) {
          const removedNode = record.removedNodes[removeIndex];
          const removedId = ensureNodeID(removedNode);
          if (removedId) {
            removes.push({ id: removedId, parentId });
          }
        }
        for (let addIndex = 0; addIndex < record.addedNodes.length; addIndex += 1) {
          const addedNode = serializeNode(record.addedNodes[addIndex]);
          if (addedNode) {
            adds.push({ parentId, nextId, node: addedNode });
          }
        }
      }

      if (record.type === "characterData") {
        const parent = record.target && record.target.parentElement;
        const textContent = serializeTextContent(parent, record.target.textContent || "");
        texts.push({
          id: ensureNodeID(record.target),
          textContent,
        });
      }

      if (record.type === "attributes" && record.target instanceof Element) {
        const value = record.target.hasAttribute(record.attributeName)
          ? serializeElementAttribute(record.target, record.attributeName, record.target.getAttribute(record.attributeName) || "")
          : null;
        attrs.push({
          id: ensureNodeID(record.target),
          name: record.attributeName,
          value,
        });
      }
    }

    pendingMutationRecords = [];

    if (!adds.length && !removes.length && !texts.length && !attrs.length) {
      return;
    }

    queueEvent("mutation", {
      adds,
      removes,
      texts,
      attrs,
    });
  }

  function scheduleMutationFlush() {
    if (mutationTimer) {
      return;
    }
    mutationTimer = window.setTimeout(() => {
      mutationTimer = 0;
      flushMutationQueue();
    }, 80);
  }

  function observeMutations() {
    const observer = new MutationObserver((records) => {
      if (!records.length) {
        return;
      }
      if (!captureWindowOpen) {
        return;
      }
      pendingMutationRecords.push(...records);
      if (pendingMutationRecords.length >= MAX_MUTATION_CHANGES) {
        if (mutationTimer) {
          clearTimeout(mutationTimer);
          mutationTimer = 0;
        }
        flushMutationQueue();
        void captureFullSnapshot("mutation_overflow");
        return;
      }
      scheduleMutationFlush();
    });

    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    disconnectMutationObserver = () => observer.disconnect();
  }

  function recordPointerMove(event) {
    if (!event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }
    if (event.clientX < 0 || event.clientY < 0) {
      return;
    }
    const now = Date.now();
    if (
      lastPointerSampleAt > 0 &&
      now - lastPointerSampleAt < POINTER_SAMPLE_INTERVAL_MS &&
      Math.abs(event.clientX - lastPointerX) < POINTER_MIN_DELTA_PX &&
      Math.abs(event.clientY - lastPointerY) < POINTER_MIN_DELTA_PX
    ) {
      return;
    }
    lastPointerSampleAt = now;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    queueEvent("pointer_move", {
      x: round(event.clientX),
      y: round(event.clientY),
      pointerType: normalizePointerType(event.pointerType),
    });
  }

  function recordClick(event, pointerType) {
    if (!event.isTrusted || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return;
    }

    const ts = Date.now();
    const selector = stableSelector(event.target);
    recentClicks.push({
      ts,
      selector: selector || `${Math.round(event.clientX)}:${Math.round(event.clientY)}`,
      pointerType,
    });
    while (recentClicks.length && ts - recentClicks[0].ts > CLICK_WINDOW_MS) {
      recentClicks.shift();
    }

    const rageClicks = recentClicks.filter((entry) => entry.selector === (selector || `${Math.round(event.clientX)}:${Math.round(event.clientY)}`)).length;
    queueEvent("click", {
      x: round(event.clientX),
      y: round(event.clientY),
      pointerType,
      selector,
      rage: rageClicks >= RAGE_CLICK_THRESHOLD,
      dead: isLikelyDeadClick(event.target),
      error: isLikelyErrorClick(event.target),
    });
  }

  function recordScroll(target) {
    const nextX = target === document || target === document.documentElement || target === document.body || target === window
      ? Math.round(window.scrollX || 0)
      : target instanceof Element
        ? Math.round(target.scrollLeft || 0)
        : 0;
    const nextY = target === document || target === document.documentElement || target === document.body || target === window
      ? Math.round(window.scrollY || 0)
      : target instanceof Element
        ? Math.round(target.scrollTop || 0)
        : 0;
    const now = Date.now();
    if (
      lastScrollSampleAt > 0 &&
      now - lastScrollSampleAt < SCROLL_SAMPLE_INTERVAL_MS &&
      Math.abs(nextX - lastScrollX) < SCROLL_MIN_DELTA_PX &&
      Math.abs(nextY - lastScrollY) < SCROLL_MIN_DELTA_PX
    ) {
      return;
    }
    lastScrollSampleAt = now;
    lastScrollX = nextX;
    lastScrollY = nextY;

    if (target === document || target === document.documentElement || target === document.body || target === window) {
      queueEvent("scroll", {
        targetId: 0,
        x: nextX,
        y: nextY,
      });
      return;
    }

    if (!(target instanceof Element)) {
      return;
    }

    queueEvent("scroll", {
      targetId: ensureNodeID(target),
      x: nextX,
      y: nextY,
    });
  }

  function recordViewport(reason = "resize") {
    queueEvent("viewport", {
      reason,
      width: Math.round(window.innerWidth || 0),
      height: Math.round(window.innerHeight || 0),
    });
  }

  function scheduleRouteSnapshot() {
    if (routeSnapshotTimer) {
      clearTimeout(routeSnapshotTimer);
    }
    routeSnapshotTimer = window.setTimeout(() => {
      routeSnapshotTimer = 0;
      pendingMutationRecords = [];
      if (mutationTimer) {
        clearTimeout(mutationTimer);
        mutationTimer = 0;
      }
      void (async () => {
        try {
          await captureFullSnapshot("route");
        } finally {
          captureWindowOpen = true;
        }
      })();
    }, ROUTE_SNAPSHOT_DELAY_MS);
  }

  function recordRoute(reason = "route") {
    const nextRouteKey = currentRouteKey();
    const nextPath = currentReplayPath();
    if (nextRouteKey === lastRouteKey) {
      return;
    }
    const previousPath = lastPath;
    void flush("route");
    lastRouteKey = nextRouteKey;
    lastPath = nextPath;
    knownPaths.add(nextPath);
    queueEvent("route", {
      reason,
      path: nextPath,
      previousPath,
      url: sanitizeURLPattern(currentURL()),
      title: trim(document.title || "", 240),
    });
    captureWindowOpen = false;
    pendingMutationRecords = [];
    if (mutationTimer) {
      clearTimeout(mutationTimer);
      mutationTimer = 0;
    }
    scheduleRouteSnapshot();
  }

  function patchConsole() {
    const originalError = console.error;
    console.error = function patchedConsoleError(...args) {
      try {
        const message = trim(args.map((arg) => normalizeMessagePart(arg)).filter(Boolean).join(" "), 480);
        if (message) {
          queueEvent("console", {
            level: "error",
            message,
          });
        }
      } catch {}
      return originalError.apply(this, args);
    };

    const originalWarn = console.warn;
    console.warn = function patchedConsoleWarn(...args) {
      try {
        const message = trim(args.map((arg) => normalizeMessagePart(arg)).filter(Boolean).join(" "), 480);
        if (message && /error|fail|exception/i.test(message)) {
          queueEvent("console", {
            level: "warn",
            message,
          });
        }
      } catch {}
      return originalWarn.apply(this, args);
    };

    removeListeners.push(() => {
      console.error = originalError;
      console.warn = originalWarn;
    });
  }

  function patchHistory(method) {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => recordRoute(method));
      return result;
    };
    removeListeners.push(() => {
      history[method] = original;
    });
  }

  function recordPerformanceMetrics() {
    if (!("PerformanceObserver" in window)) {
      return;
    }

    let cls = 0;
    let inp = 0;
    let lcp = 0;
    let ttfb = 0;
    const observers = [];

    const observe = (type, callback, extra) => {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          for (let index = 0; index < entries.length; index += 1) {
            callback(entries[index]);
          }
        });
        observer.observe({
          type,
          buffered: true,
          ...extra,
        });
        observers.push(observer);
      } catch {}
    };

    observe("largest-contentful-paint", (entry) => {
      lcp = entry.startTime || entry.renderTime || lcp;
    });
    observe("event", (entry) => {
      const duration = entry.duration || 0;
      if (duration > inp) {
        inp = duration;
      }
    }, { durationThreshold: 40 });
    observe("layout-shift", (entry) => {
      if (!entry.hadRecentInput) {
        cls += entry.value || 0;
      }
    });
    observe("navigation", (entry) => {
      ttfb = entry.responseStart || ttfb;
    });

    const flushMetrics = () => {
      queueEvent("metric", { name: "lcp", value: round(lcp) });
      queueEvent("metric", { name: "inp", value: round(inp) });
      queueEvent("metric", { name: "cls", value: round(cls) });
      queueEvent("metric", { name: "ttfb", value: round(ttfb) });
      for (let index = 0; index < observers.length; index += 1) {
        observers[index].disconnect();
      }
    };

    window.addEventListener("pagehide", flushMetrics, { once: true });
    removeListeners.push(() => {
      window.removeEventListener("pagehide", flushMetrics);
    });
  }

  function patchNetwork() {
    const originalFetch = window.fetch;
    window.fetch = async function patchedFetch(input, init = {}) {
      const method = trim((init && init.method) || "GET", 12).toUpperCase();
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (shouldIgnoreNetworkURL(url)) {
        return originalFetch.call(this, input, init);
      }
      const startedAt = performance.now();
      try {
        const response = await originalFetch.call(this, input, init);
        queueEvent("network", {
          kind: "fetch",
          method,
          url: sanitizeURLPattern(url),
          status: response.status || 0,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ok: response.ok,
          failureReason: response.ok ? "" : trim(response.statusText || "request_failed", 120),
        });
        return response;
      } catch (error) {
        queueEvent("network", {
          kind: "fetch",
          method,
          url: sanitizeURLPattern(url),
          status: 0,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ok: false,
          failureReason: trim((error && error.message) || "request_failed", 120),
        });
        throw error;
      }
    };
    unpatchFetch = () => {
      window.fetch = originalFetch;
    };

    const XHR = window.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;
    XHR.prototype.open = function patchedOpen(method, url, ...rest) {
      this.__anlticsheatReplayMeta = {
        method: trim(method || "GET", 12).toUpperCase(),
        url: String(url || ""),
      };
      return originalOpen.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function patchedSend(body) {
      const meta = this.__anlticsheatReplayMeta || { method: "GET", url: "" };
      if (shouldIgnoreNetworkURL(meta.url)) {
        return originalSend.call(this, body);
      }
      const startedAt = performance.now();
      const onDone = () => {
        queueEvent("network", {
          kind: "xhr",
          method: meta.method,
          url: sanitizeURLPattern(meta.url),
          status: this.status || 0,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ok: this.status >= 200 && this.status < 400,
          failureReason: this.status >= 200 && this.status < 400 ? "" : trim(this.statusText || "request_failed", 120),
        });
        this.removeEventListener("loadend", onDone);
        this.removeEventListener("error", onDone);
        this.removeEventListener("abort", onDone);
      };

      this.addEventListener("loadend", onDone);
      this.addEventListener("error", onDone);
      this.addEventListener("abort", onDone);
      return originalSend.call(this, body);
    };
    unpatchXHR = () => {
      XHR.prototype.open = originalOpen;
      XHR.prototype.send = originalSend;
    };
  }

  function subscribeCustomEvents() {
    if (typeof tracker.subscribeCustomEvents !== "function") {
      return;
    }
    customEventUnsubscribe = tracker.subscribeCustomEvents((event) => {
      if (!event || !event.name) {
        return;
      }
      if (String(event.name).startsWith("perf_")) {
        return;
      }
      queueEvent("custom", {
        name: trim(event.name, 80),
        props: event.props || null,
      });
    });
  }

  function installCaptureHooks() {
    observeMutations();
    if (replayOptions.errorTrackingEnabled !== false) {
      patchConsole();
      patchNetwork();
    }
    patchHistory("pushState");
    patchHistory("replaceState");
    subscribeCustomEvents();
    recordPerformanceMetrics();

    removeListeners.push(
      addWindowListener(window, "popstate", () => recordRoute("popstate")),
      addWindowListener(window, "hashchange", () => recordRoute("hashchange")),
      addWindowListener(window, "resize", () => {
        recordViewport("resize");
        scheduleRouteSnapshot();
      }),
      addWindowListener(window, "orientationchange", () => {
        recordViewport("orientationchange");
        scheduleRouteSnapshot();
      }),
      addWindowListener(window, "pointermove", recordPointerMove, { passive: true }),
      addWindowListener(document, "pointerup", (event) => {
        if (event.isPrimary === false) {
          return;
        }
        const pointerType = normalizePointerType(event.pointerType);
        if (pointerType === "touch" && event.button !== 0) {
          return;
        }
        recordClick(event, pointerType);
      }, { passive: true }),
      addWindowListener(document, "click", (event) => {
        if (event.detail === 0) {
          recordClick(event, "keyboard");
        }
      }, { passive: true }),
      addWindowListener(document, "scroll", (event) => recordScroll(event.target || document), { passive: true, capture: true }),
      ...(replayOptions.errorTrackingEnabled === false
        ? []
        : [
            addWindowListener(window, "error", (event) => {
              queueEvent("console", {
                level: "error",
                message: trim(event.message || "script_error", 480),
                source: sanitizeURL(event.filename || "", false),
              });
            }),
            addWindowListener(window, "unhandledrejection", (event) => {
              queueEvent("console", {
                level: "error",
                message: trim(normalizeMessagePart(event.reason) || "unhandled_rejection", 480),
              });
            }),
          ]),
      addWindowListener(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden") {
          void flush("hidden");
        }
      }),
      addWindowListener(window, "pagehide", () => {
        void flush("hidden");
        stop();
      }, { passive: true }),
    );
  }

  void (async () => {
    if (shouldEmitDocumentRoute) {
      queueEvent("route", {
        reason: "document",
        path: lastPath,
        previousPath: initialPreviousPath,
        url: sanitizeURLPattern(currentURL()),
        title: trim(document.title || "", 240),
      });
    }
    await captureFullSnapshot("init");
    captureWindowOpen = true;
    installCaptureHooks();
  })();

  function stop() {
    if (stopped) {
      return;
    }
    stopped = true;
    if (flushTimer) {
      clearTimeout(flushTimer);
    }
    if (mutationTimer) {
      clearTimeout(mutationTimer);
    }
    if (routeSnapshotTimer) {
      clearTimeout(routeSnapshotTimer);
    }
    replayMaskAllText = false;
    if (disconnectMutationObserver) {
      disconnectMutationObserver();
    }
    if (customEventUnsubscribe) {
      customEventUnsubscribe();
    }
    if (unpatchFetch) {
      unpatchFetch();
    }
    if (unpatchXHR) {
      unpatchXHR();
    }
    for (let index = 0; index < removeListeners.length; index += 1) {
      try {
        removeListeners[index]();
      } catch {}
    }
    removeListeners = [];
  }

  return {
    enabled: true,
    flush,
    stop,
  };
}

function addWindowListener(target, event, listener, options) {
  if (!target || typeof target.addEventListener !== "function") {
    return () => {};
  }
  target.addEventListener(event, listener, options);
  return () => {
    target.removeEventListener(event, listener, options);
  };
}

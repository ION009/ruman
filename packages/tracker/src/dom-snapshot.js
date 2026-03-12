const CAPTURE_DELAY_MS = 700;
const RECAPTURE_MIN_INTERVAL_MS = 30 * 1000;
const RECAPTURE_INTERVAL_MS = 5 * 60 * 1000;
const REFRESH_POLL_INTERVAL_MS = 15 * 1000;
const MAX_HTML_CHARS = 3_000_000;
const MAX_CSS_CHARS = 600_000;
const MAX_CRAWL_PAGES = 24;
const CRAWL_REQUEST_TIMEOUT_MS = 5000;
const SCROLL_DEPTH_STEP = 18;
const SCROLL_NEAR_BOTTOM = 96;
const MASK_CHAR = "•";
const EXPLICIT_MASK_TEXT = MASK_CHAR.repeat(8);
const MASKED_IMAGE_SRC = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function trimToLimit(value, limit) {
  if (typeof value !== "string") {
    return "";
  }
  if (value.length <= limit) {
    return value;
  }
  return value.slice(0, limit);
}

function maskInlineText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\S/g, MASK_CHAR);
}

function normalizePath(pathname) {
  const trimmed = String(pathname || "").trim();
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

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function stripUnsafeNodes(root) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return;
  }

  const removable = root.querySelectorAll(
    "script,noscript,iframe,object,embed,[data-anlticsheat-ignore],[data-heatmap-ignore]",
  );
  for (let index = 0; index < removable.length; index += 1) {
    removable[index].remove();
  }

  const elements = root.querySelectorAll("*");
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const names = element.getAttributeNames();
    for (let attrIndex = 0; attrIndex < names.length; attrIndex += 1) {
      const name = names[attrIndex].toLowerCase();
      if (name.startsWith("on")) {
        element.removeAttribute(names[attrIndex]);
      }
    }
  }
}

function maskedValue(length, maxLength = length) {
  const safeLength = Math.max(0, Math.min(length || 0, maxLength));
  return safeLength > 0 ? MASK_CHAR.repeat(safeLength) : "";
}

function maskFormFields(root) {
  const fields = root.querySelectorAll("input,textarea,select");
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const tagName = field.tagName.toLowerCase();

    if (tagName === "select") {
      const options = field.querySelectorAll("option");
      for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
        const option = options[optionIndex];
        if (option.textContent && option.textContent.trim()) {
          option.textContent = option.textContent.replace(/\S/g, MASK_CHAR);
        }
        if (option.getAttribute("value")) {
          option.setAttribute("value", maskedValue(option.getAttribute("value").length, 20));
        }
      }
      field.removeAttribute("placeholder");
      continue;
    }

    if (field.value) {
      const masked = maskedValue(field.value.length, 20);
      field.value = masked;
      if (tagName === "textarea") {
        field.textContent = masked;
      } else {
        field.setAttribute("value", masked);
      }
    }
    field.removeAttribute("placeholder");
  }
}

function maskExplicitSensitiveNodes(root) {
  const masked = root.querySelectorAll("[data-mask],[data-sensitive],[data-pii],.anlticsheat-mask");
  for (let index = 0; index < masked.length; index += 1) {
    masked[index].textContent = EXPLICIT_MASK_TEXT;
  }
}

function maskTextNodes(root) {
  const treeWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  while (treeWalker.nextNode()) {
    const textNode = treeWalker.currentNode;
    const parent = textNode.parentElement;
    if (!parent) {
      continue;
    }

    if (parent.tagName === "STYLE") {
      continue;
    }

    if (textNode.textContent && textNode.textContent.trim()) {
      textNode.textContent = textNode.textContent.replace(/\S/g, MASK_CHAR);
    }
  }
}

function neutralizeImages(root) {
  const images = root.querySelectorAll("img");
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const width = image.naturalWidth || image.width || 100;
    const height = image.naturalHeight || image.height || 100;
    image.setAttribute("width", String(width));
    image.setAttribute("height", String(height));
    image.setAttribute("src", MASKED_IMAGE_SRC);
    image.removeAttribute("srcset");
    image.removeAttribute("alt");
  }
}

function maskContent(root) {
  if (!root || typeof root.querySelectorAll !== "function") {
    return;
  }

  maskFormFields(root);
  maskExplicitSensitiveNodes(root);
  maskTextNodes(root);
  neutralizeImages(root);
}

function collectCSS() {
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

      const ruleText = rule.cssText;
      size += ruleText.length + 1;
      if (size > MAX_CSS_CHARS) {
        chunks.push(trimToLimit(ruleText, Math.max(0, MAX_CSS_CHARS - (size - ruleText.length - 1))));
        return chunks.join("\n");
      }
      chunks.push(ruleText);
    }
  }

  return trimToLimit(chunks.join("\n"), MAX_CSS_CHARS);
}

function documentDimensions() {
  const scrollingElement = document.scrollingElement;
  const root = document.documentElement;
  const body = document.body;
  const rootRect = root ? root.getBoundingClientRect() : null;
  const bodyRect = body ? body.getBoundingClientRect() : null;
  const width = Math.max(
    (scrollingElement && scrollingElement.scrollWidth) || 0,
    (scrollingElement && scrollingElement.clientWidth) || 0,
    (root && root.scrollWidth) || 0,
    (root && root.clientWidth) || 0,
    (body && body.scrollWidth) || 0,
    Math.round((rootRect && rootRect.width) || 0),
    Math.round((bodyRect && bodyRect.width) || 0),
    window.innerWidth || 0,
  );
  const height = Math.max(
    (scrollingElement && scrollingElement.scrollHeight) || 0,
    (scrollingElement && scrollingElement.clientHeight) || 0,
    (root && root.scrollHeight) || 0,
    (root && root.clientHeight) || 0,
    (body && body.scrollHeight) || 0,
    Math.round((rootRect && rootRect.height) || 0),
    Math.round((bodyRect && bodyRect.height) || 0),
    window.innerHeight || 0,
  );

  return {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function currentScrollDepth() {
  const root = document.documentElement;
  const scrolled = (window.scrollY || 0) + (window.innerHeight || 0);
  const totalHeight = Math.max(
    (root && root.scrollHeight) || 0,
    documentDimensions().height || 0,
    window.innerHeight || 1,
  );
  if (!totalHeight) {
    return 0;
  }
  return Math.max(0, Math.min(100, (scrolled / totalHeight) * 100));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForLayoutStability() {
  if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === "function") {
    try {
      await Promise.race([
        document.fonts.ready,
        wait(1100),
      ]);
    } catch {
      // ignore font wait errors
    }
  }

  if (typeof requestAnimationFrame === "function") {
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
  } else {
    await wait(34);
  }

  let previousHeight = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { height } = documentDimensions();
    if (attempt > 0 && Math.abs(height - previousHeight) <= 2) {
      break;
    }
    previousHeight = height;
    await wait(120);
  }
}

async function buildSnapshot() {
  await waitForLayoutStability();

  const htmlElement = document.documentElement;
  if (!htmlElement) {
    return null;
  }

  const clone = htmlElement.cloneNode(true);
  stripUnsafeNodes(clone);
  maskContent(clone);

  const html = trimToLimit(`<!doctype html>\n${clone.outerHTML}`, MAX_HTML_CHARS);
  if (!html.trim()) {
    return null;
  }

  const css = collectCSS();
  const dimensions = documentDimensions();
  const viewportWidth = Math.max(0, Math.round(window.innerWidth || 0));
  const viewportHeight = Math.max(0, Math.round(window.innerHeight || 0));
  const contentHash = simpleHash(`${html}|${css}`);

  return {
    path: normalizePath(window.location.pathname),
    pageUrl: window.location.href,
    html,
    css,
    title: maskInlineText(document.title || ""),
    viewportWidth,
    viewportHeight,
    documentWidth: dimensions.width,
    documentHeight: dimensions.height,
    capturedAt: new Date().toISOString(),
    contentHash,
  };
}

async function fetchText(url, timeoutMs = CRAWL_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function extractTitleFromDocument(doc) {
  const title = doc.querySelector("title");
  return maskInlineText(title ? (title.textContent || "") : "");
}

function buildSnapshotFromHTML(html, cssText, pageUrl) {
  if (typeof html !== "string" || !html.trim()) {
    return null;
  }

  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, "text/html");
  const htmlElement = parsed.documentElement;
  if (!htmlElement) {
    return null;
  }

  const clone = htmlElement.cloneNode(true);
  stripUnsafeNodes(clone);
  maskContent(clone);

  const snapshotHTML = trimToLimit(`<!doctype html>\n${clone.outerHTML}`, MAX_HTML_CHARS);
  if (!snapshotHTML.trim()) {
    return null;
  }

  const snapshotCSS = trimToLimit(cssText || "", MAX_CSS_CHARS);
  const contentHash = simpleHash(`${snapshotHTML}|${snapshotCSS}`);
  const dimensions = documentDimensions();

  return {
    path: normalizePath(new URL(pageUrl, window.location.origin).pathname),
    html: snapshotHTML,
    css: snapshotCSS,
    title: extractTitleFromDocument(parsed),
    viewportWidth: Math.max(0, Math.round(window.innerWidth || 0)),
    viewportHeight: Math.max(0, Math.round(window.innerHeight || 0)),
    documentWidth: dimensions.width,
    documentHeight: dimensions.height,
    capturedAt: new Date().toISOString(),
    contentHash,
    pageUrl,
  };
}

function decodeXmlEntities(value) {
  return String(value || "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function sameOriginPath(candidate, origin) {
  try {
    const resolved = new URL(candidate, origin);
    if (resolved.origin !== origin) {
      return null;
    }
    if (!/^https?:$/.test(resolved.protocol)) {
      return null;
    }
    if (/\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|txt|webm|webp|xml|zip)$/i.test(resolved.pathname)) {
      return null;
    }
    return normalizePath(resolved.pathname);
  } catch {
    return null;
  }
}

async function discoverSitePaths() {
  const origin = window.location.origin;
  const pages = new Set([normalizePath(window.location.pathname)]);
  const queue = [normalizePath(window.location.pathname)];
  const visited = new Set();

  const robots = await fetchText(`${origin}/robots.txt`);
  const sitemapURLs = new Set([`${origin}/sitemap.xml`]);
  for (const line of robots.split(/\r?\n/)) {
    const match = line.match(/^\s*Sitemap:\s*(\S+)\s*$/i);
    if (match) {
      sitemapURLs.add(match[1]);
    }
  }

  for (const sitemapURL of sitemapURLs) {
    const xml = await fetchText(sitemapURL);
    if (!xml) {
      continue;
    }
    const matches = xml.matchAll(/<loc>(.*?)<\/loc>/gi);
    for (const match of matches) {
      const path = sameOriginPath(decodeXmlEntities(match[1] || ""), origin);
      if (path) {
        pages.add(path);
      }
      if (pages.size >= MAX_CRAWL_PAGES) {
        break;
      }
    }
  }

  while (queue.length > 0 && pages.size < MAX_CRAWL_PAGES) {
    const nextPath = queue.shift();
    if (!nextPath || visited.has(nextPath)) {
      continue;
    }
    visited.add(nextPath);

    const html = nextPath === normalizePath(window.location.pathname)
      ? document.documentElement.outerHTML
      : await fetchText(new URL(nextPath, origin).toString());
    if (!html) {
      continue;
    }

    const links = html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi);
    for (const link of links) {
      const path = sameOriginPath(link[1] || "", origin);
      if (!path || pages.has(path)) {
        continue;
      }
      pages.add(path);
      queue.push(path);
      if (pages.size >= MAX_CRAWL_PAGES) {
        break;
      }
    }
  }

  return Array.from(pages);
}

export function startDomSnapshots(tracker) {
  if (
    !tracker ||
    typeof tracker.captureDOMSnapshot !== "function" ||
    typeof tracker.checkDOMSnapshotRefresh !== "function"
  ) {
    return;
  }

  let timer = 0;
  let refreshTimer = 0;
  let refreshPollTimer = 0;
  let siteSweepTimer = 0;
  let scrollRaf = 0;
  let lastPath = tracker.currentPath();
  const lastHashByPath = {};
  const lastSentAtByPath = {};
  const maxDepthByPath = {};
  const lastRefreshRequestByPath = {};
  let crawlInFlight = false;

  async function capture(reason, requestId = "") {
    const path = tracker.currentPath();
    const snapshot = await buildSnapshot();
    if (!snapshot) {
      return;
    }

    const now = Date.now();
    const lastHash = lastHashByPath[path] || "";
    const lastSentAt = lastSentAtByPath[path] || 0;
    const bypassMinInterval = reason === "route" || reason === "force" || reason === "scroll-depth";
    if (!bypassMinInterval && now - lastSentAt < RECAPTURE_MIN_INTERVAL_MS) {
      return;
    }
    if (
      reason !== "route" &&
      reason !== "force" &&
      lastHash === snapshot.contentHash &&
      now - lastSentAt < RECAPTURE_INTERVAL_MS
    ) {
      return;
    }

    const ok = await tracker.captureDOMSnapshot(snapshot, reason, requestId);
    if (!ok) {
      return;
    }

    lastHashByPath[path] = snapshot.contentHash;
    lastSentAtByPath[path] = Date.now();
    if (requestId) {
      lastRefreshRequestByPath[path] = requestId;
    }
  }

  async function captureWholeSite(requestId = "") {
    if (crawlInFlight) {
      return;
    }

    crawlInFlight = true;
    try {
      const paths = await discoverSitePaths();
      const currentPath = normalizePath(window.location.pathname);
      const cssText = collectCSS();

      for (const path of paths) {
        let snapshot = null;
        if (path === currentPath) {
          snapshot = await buildSnapshot();
        } else {
          const pageUrl = new URL(path, window.location.origin).toString();
          const html = await fetchText(pageUrl);
          snapshot = buildSnapshotFromHTML(html, cssText, pageUrl);
        }

        if (!snapshot) {
          continue;
        }

        const lastHash = lastHashByPath[path] || "";
        if (
          lastHash === snapshot.contentHash &&
          (!requestId || lastRefreshRequestByPath[path] === requestId)
        ) {
          continue;
        }

        const ok = await tracker.captureDOMSnapshot(snapshot, "force", requestId);
        if (!ok) {
          continue;
        }

        lastHashByPath[path] = snapshot.contentHash;
        lastSentAtByPath[path] = Date.now();
        if (requestId) {
          lastRefreshRequestByPath[path] = requestId;
        }
      }
    } finally {
      crawlInFlight = false;
    }
  }

  function scheduleSiteSweep(delay = 1200, requestId = "") {
    if (siteSweepTimer) {
      clearTimeout(siteSweepTimer);
    }
    siteSweepTimer = window.setTimeout(() => {
      siteSweepTimer = 0;
      void captureWholeSite(requestId);
    }, delay);
  }

  async function maybeCaptureRefreshRequest() {
    const path = tracker.currentPath();
    const pending = await tracker.checkDOMSnapshotRefresh(path);
    if (!pending || !pending.requestId) {
      return;
    }

    if (pending.scope === "site") {
      await captureWholeSite(pending.requestId);
      return;
    }

    if (pending.path !== path || lastRefreshRequestByPath[path] === pending.requestId) {
      return;
    }
    await capture("force", pending.requestId);
  }

  function schedule(reason, delay = CAPTURE_DELAY_MS) {
    if (timer) {
      clearTimeout(timer);
    }
    timer = window.setTimeout(() => {
      timer = 0;
      void capture(reason);
    }, delay);
  }

  function onPathMaybeChanged(reason = "route") {
    const nextPath = tracker.currentPath();
    if (nextPath === lastPath) {
      return;
    }
    lastPath = nextPath;
    maxDepthByPath[nextPath] = currentScrollDepth();
    schedule(reason, 850);
    void maybeCaptureRefreshRequest();
  }

  const patchHistory = (method) => {
    const original = history[method];
    history[method] = function patchedHistory(...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => onPathMaybeChanged("route"));
      return result;
    };
  };

  patchHistory("pushState");
  patchHistory("replaceState");
  window.addEventListener("popstate", () => onPathMaybeChanged("route"));
  window.addEventListener("hashchange", () => onPathMaybeChanged("route"));
  window.addEventListener("scroll", () => {
    if (scrollRaf) {
      return;
    }
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      const path = tracker.currentPath();
      const nextDepth = currentScrollDepth();
      const previousDepth = maxDepthByPath[path] || 0;
      if (nextDepth <= previousDepth) {
        return;
      }

      const depthDelta = nextDepth - previousDepth;
      const crossedDepthStep = depthDelta >= SCROLL_DEPTH_STEP;
      const crossedNearBottom = nextDepth >= SCROLL_NEAR_BOTTOM && previousDepth < SCROLL_NEAR_BOTTOM;
      if (!crossedDepthStep && !crossedNearBottom) {
        return;
      }

      maxDepthByPath[path] = nextDepth;
      schedule("scroll-depth", 280);
    });
  }, { passive: true });
  window.addEventListener("load", () => schedule("load", 500));
  window.addEventListener("load", () => scheduleSiteSweep(1400));
  document.addEventListener("readystatechange", () => {
    if (document.readyState === "complete") {
      schedule("ready", 450);
      scheduleSiteSweep(1200);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      void capture("hidden");
      return;
    }
    schedule("visible", 650);
    void maybeCaptureRefreshRequest();
  });

  refreshTimer = window.setInterval(() => {
    schedule("interval", 0);
    scheduleSiteSweep(0);
  }, RECAPTURE_INTERVAL_MS);
  refreshPollTimer = window.setInterval(() => {
    void maybeCaptureRefreshRequest();
  }, REFRESH_POLL_INTERVAL_MS);

  maxDepthByPath[lastPath] = currentScrollDepth();
  schedule("init", 420);
  scheduleSiteSweep(1600);
  void maybeCaptureRefreshRequest();
  window.addEventListener("pagehide", () => {
    if (timer) {
      clearTimeout(timer);
    }
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    if (refreshPollTimer) {
      clearInterval(refreshPollTimer);
    }
    if (siteSweepTimer) {
      clearTimeout(siteSweepTimer);
    }
    if (scrollRaf) {
      cancelAnimationFrame(scrollRaf);
    }
    void capture("hidden");
  });
}

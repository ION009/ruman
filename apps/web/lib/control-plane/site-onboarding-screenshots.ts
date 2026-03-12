import { createHash, createHmac } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { upsertHeatmapDomSnapshot } from "@/lib/control-plane/heatmap-dom-snapshots";
import { upsertHeatmapScreenshot } from "@/lib/control-plane/heatmap-screenshots";
import { sanitizeOrigin } from "@/lib/control-plane/tracker-script";

const SCREENSHOTONE_ACCESS_KEY =
  (process.env.ANLTICSHEAT_SCREENSHOTONE_ACCESS_KEY ??
  process.env.SCREENSHOTONE_ACCESS_KEY ??
  "").trim();
const SCREENSHOTONE_SECRET_KEY =
  (process.env.ANLTICSHEAT_SCREENSHOTONE_SECRET_KEY ??
  process.env.SCREENSHOTONE_SECRET_KEY ??
  "").trim();
const SCREENSHOTONE_BASE_URL = process.env.ANLTICSHEAT_SCREENSHOTONE_API_BASE_URL ?? "https://api.screenshotone.com";
const MAX_CAPTURE_PAGES = Math.min(
  12,
  Math.max(1, Number.parseInt(process.env.ANLTICSHEAT_SCREENSHOT_CAPTURE_MAX_PAGES ?? "6", 10) || 6),
);
const MAX_CAPTURE_RUNTIME_MS = Math.max(
  8_000,
  Number.parseInt(process.env.ANLTICSHEAT_SCREENSHOT_CAPTURE_TIMEOUT_MS ?? "25000", 10) || 25_000,
);
const REQUEST_TIMEOUT_MS = Math.max(
  3_000,
  Number.parseInt(process.env.ANLTICSHEAT_SCREENSHOT_CAPTURE_REQUEST_TIMEOUT_MS ?? "10000", 10) || 10_000,
);
const SCREENSHOT_VIEWPORT_WIDTH = 1440;
const SCREENSHOT_VIEWPORT_HEIGHT = 920;
const NON_HTML_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|txt|webm|webp|xml|zip)$/i;

type CandidatePage = {
  path: string;
  url: string;
};

type ScreenshotCaptureResult = {
  discovered: number;
  captured: number;
  failed: number;
  note?: string;
  sampleErrors?: string[];
};

type SingleCaptureResult = {
  path: string;
  screenshot: string;
  note?: string;
};

function hasScreenshotOneCredentials() {
  return Boolean(SCREENSHOTONE_ACCESS_KEY);
}

function isPrivateOrLocalOrigin(origin: string) {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) {
      return false;
    }

    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local")
    ) {
      return true;
    }

    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      const parts = host.split(".").map((part) => Number.parseInt(part, 10));
      const [a, b] = parts;
      if (a === 10) return true;
      if (a === 127) return true;
      if (a === 192 && b === 168) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
    }
  } catch {
    return false;
  }

  return false;
}

function normalizePath(value: string) {
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

function normalizeWebURL(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/.test(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function extractPageTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }

  return decodeXmlEntities(match[1] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyHtmlPath(pathname: string) {
  return !NON_HTML_EXTENSION.test(pathname);
}

function asSameOriginPath(candidate: string, origin: string) {
  try {
    const base = new URL(origin);
    const resolved = new URL(candidate, base);
    if (!/^https?:$/.test(resolved.protocol)) {
      return null;
    }
    if (resolved.origin !== base.origin) {
      return null;
    }
    const normalized = normalizePath(resolved.pathname);
    if (!isLikelyHtmlPath(normalized)) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

async function fetchText(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "anlticsheat-screenshot-bot/0.1",
      },
    });
    if (!response.ok) {
      return "";
    }
    return await response.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timeoutId);
  }
}

async function discoverSitemaps(origin: string) {
  const sitemapUrls = new Set<string>([new URL("/sitemap.xml", origin).toString()]);
  const robots = await fetchText(new URL("/robots.txt", origin).toString(), REQUEST_TIMEOUT_MS);

  if (!robots) {
    return [...sitemapUrls];
  }

  const lines = robots.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*Sitemap:\s*(\S+)\s*$/i);
    if (!match) {
      continue;
    }
    try {
      sitemapUrls.add(new URL(match[1], origin).toString());
    } catch {
      // ignore malformed sitemap entries
    }
  }

  return [...sitemapUrls];
}

async function collectPagesFromSitemaps(origin: string, pages: Set<string>) {
  const sitemaps = await discoverSitemaps(origin);

  for (const sitemapUrl of sitemaps) {
    const xml = await fetchText(sitemapUrl, REQUEST_TIMEOUT_MS);
    if (!xml) {
      continue;
    }

    const matches = xml.matchAll(/<loc>(.*?)<\/loc>/gi);
    for (const match of matches) {
      const location = decodeXmlEntities(match[1] ?? "").trim();
      if (!location) {
        continue;
      }

      const pagePath = asSameOriginPath(location, origin);
      if (pagePath) {
        pages.add(pagePath);
      }
      if (pages.size >= MAX_CAPTURE_PAGES) {
        return;
      }
    }
  }
}

async function collectPagesFromHomepage(origin: string, pages: Set<string>) {
  const html = await fetchText(origin, REQUEST_TIMEOUT_MS);
  if (!html) {
    return;
  }

  const links = html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi);
  for (const link of links) {
    const href = link[1] ?? "";
    const pagePath = asSameOriginPath(href, origin);
    if (pagePath) {
      pages.add(pagePath);
    }
    if (pages.size >= MAX_CAPTURE_PAGES) {
      return;
    }
  }
}

async function collectPagesByCrawling(origin: string, pages: Set<string>) {
  const queue = [...pages];
  const visited = new Set(queue);

  while (queue.length > 0 && pages.size < MAX_CAPTURE_PAGES) {
    const currentPath = queue.shift() ?? "/";
    const html = await fetchText(new URL(currentPath, origin).toString(), REQUEST_TIMEOUT_MS);
    if (!html) {
      continue;
    }

    const links = html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi);
    for (const link of links) {
      const href = link[1] ?? "";
      const discoveredPath = asSameOriginPath(href, origin);
      if (!discoveredPath) {
        continue;
      }

      if (!pages.has(discoveredPath)) {
        pages.add(discoveredPath);
      }

      if (!visited.has(discoveredPath)) {
        visited.add(discoveredPath);
        queue.push(discoveredPath);
      }

      if (pages.size >= MAX_CAPTURE_PAGES) {
        return;
      }
    }
  }
}

async function discoverSitePages(origin: string): Promise<CandidatePage[]> {
  const pages = new Set<string>(["/"]);
  await collectPagesFromSitemaps(origin, pages);
  await collectPagesFromHomepage(origin, pages);
  await collectPagesByCrawling(origin, pages);

  const sortedPaths = [...pages].sort((a, b) => {
    if (a === "/") return -1;
    if (b === "/") return 1;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });

  return sortedPaths.slice(0, MAX_CAPTURE_PAGES).map((pagePath) => ({
    path: pagePath,
    url: new URL(pagePath, origin).toString(),
  }));
}

function buildScreenshotOneQuery(pageUrl: string) {
  const params = new URLSearchParams();
  params.set("access_key", SCREENSHOTONE_ACCESS_KEY);
  params.set("url", pageUrl);
  params.set("viewport_width", String(SCREENSHOT_VIEWPORT_WIDTH));
  params.set("viewport_height", String(SCREENSHOT_VIEWPORT_HEIGHT));
  params.set("device_scale_factor", "1");
  params.set("format", "png");
  params.set("ignore_host_errors", "true");
  return params.toString();
}

function buildScreenshotOneSignedURL(pageUrl: string) {
  const unsignedQuery = buildScreenshotOneQuery(pageUrl);
  const signature = createHmac("sha256", SCREENSHOTONE_SECRET_KEY)
    .update(unsignedQuery)
    .digest("hex");

  return `${SCREENSHOTONE_BASE_URL.replace(/\/$/, "")}/take?${unsignedQuery}&signature=${signature}`;
}

function buildScreenshotOneUnsignedURL(pageUrl: string) {
  const query = buildScreenshotOneQuery(pageUrl);
  return `${SCREENSHOTONE_BASE_URL.replace(/\/$/, "")}/take?${query}`;
}

function parseScreenshotOneError(rawBody: string) {
  try {
    const parsed = JSON.parse(rawBody) as {
      error_code?: unknown;
      error_message?: unknown;
      returned_status_code?: unknown;
    };
    return {
      code: String(parsed.error_code ?? ""),
      message: String(parsed.error_message ?? ""),
      returnedStatusCode:
        typeof parsed.returned_status_code === "number"
          ? parsed.returned_status_code
          : Number.parseInt(String(parsed.returned_status_code ?? ""), 10) || 0,
    };
  } catch {
    return {
      code: "",
      message: rawBody.slice(0, 220),
      returnedStatusCode: 0,
    };
  }
}

async function requestScreenshot(requestURL: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(requestURL, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      const error = parseScreenshotOneError(errorBody);
      return {
        ok: false as const,
        status: response.status,
        code: error.code,
        message: error.message,
        returnedStatusCode: error.returnedStatusCode,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("image/")) {
      const body = await response.text().catch(() => "");
      return {
        ok: false as const,
        status: response.status,
        code: "non_image_response",
        message: body.slice(0, 220),
        returnedStatusCode: 0,
      };
    }

    return {
      ok: true as const,
      image: Buffer.from(await response.arrayBuffer()),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function takeScreenshot(pageUrl: string) {
  const unsignedAttempt = await requestScreenshot(buildScreenshotOneUnsignedURL(pageUrl));
  if (unsignedAttempt.ok) {
    return unsignedAttempt.image;
  }

  if (
    unsignedAttempt.code === "signature_is_required" &&
    SCREENSHOTONE_SECRET_KEY
  ) {
    const signedAttempt = await requestScreenshot(buildScreenshotOneSignedURL(pageUrl));
    if (signedAttempt.ok) {
      return signedAttempt.image;
    }
    throw new Error(
      `ScreenshotOne request failed (${signedAttempt.status}${
        signedAttempt.returnedStatusCode ? `; host=${signedAttempt.returnedStatusCode}` : ""
      }): ${signedAttempt.code || signedAttempt.message}`,
    );
  }

  throw new Error(
    `ScreenshotOne request failed (${unsignedAttempt.status}${
      unsignedAttempt.returnedStatusCode ? `; host=${unsignedAttempt.returnedStatusCode}` : ""
    }): ${unsignedAttempt.code || unsignedAttempt.message}`,
  );
}

async function resolvePublicRoot() {
  const candidates = [
    path.join(process.cwd(), "public"),
    path.join(process.cwd(), "apps", "web", "public"),
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  await mkdir(candidates[0], { recursive: true });
  return candidates[0];
}

async function writeLocalScreenshot(siteId: string, pagePath: string, image: Buffer) {
  const publicRoot = await resolvePublicRoot();
  const digest = createHash("sha1").update(pagePath).digest("hex").slice(0, 16);
  const directory = path.join(publicRoot, "heatmap-captures", siteId);
  const filename = `${digest}.png`;
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), image);
  return `/heatmap-captures/${siteId}/${filename}`;
}

async function captureDomSnapshotForPath(siteId: string, pagePath: string, pageUrl: string) {
  const html = await fetchText(pageUrl, REQUEST_TIMEOUT_MS);
  if (!html.trim()) {
    throw new Error("Could not fetch page HTML for the heatmap background.");
  }

  await upsertHeatmapDomSnapshot(siteId, {
    path: pagePath,
    pageUrl,
    pageTitle: extractPageTitle(html),
    html,
    viewportWidth: SCREENSHOT_VIEWPORT_WIDTH,
    viewportHeight: SCREENSHOT_VIEWPORT_HEIGHT,
    documentWidth: SCREENSHOT_VIEWPORT_WIDTH,
    documentHeight: SCREENSHOT_VIEWPORT_HEIGHT,
  });
}

async function captureSiteViewForPath(siteId: string, pagePath: string, pageUrl: string): Promise<SingleCaptureResult> {
  const localOrPrivate = isPrivateOrLocalOrigin(pageUrl);

  if (!localOrPrivate && hasScreenshotOneCredentials()) {
    try {
      const image = await takeScreenshot(pageUrl);
      const screenshotPath = await writeLocalScreenshot(siteId, pagePath, image);
      const stored = await upsertHeatmapScreenshot(siteId, pagePath, screenshotPath);
      return {
        path: pagePath,
        screenshot: stored,
        note: "Updated the captured screenshot for this page.",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      console.warn(
        "[screenshot-onboarding] screenshot capture failed, falling back to html snapshot",
        JSON.stringify({ siteId, pagePath, error: message }),
      );
    }
  }

  await captureDomSnapshotForPath(siteId, pagePath, pageUrl);
  return {
    path: pagePath,
    screenshot: "",
    note: localOrPrivate
      ? "Stored a live DOM snapshot for this local/private page."
      : "Stored a live DOM snapshot for this page.",
  };
}

export async function captureInitialSiteScreenshots(siteId: string, rawOrigin: string) {
  const origin = sanitizeOrigin(rawOrigin);
  if (!origin) {
    return <ScreenshotCaptureResult>{
      discovered: 0,
      captured: 0,
      failed: 0,
    };
  }

  const startedAt = Date.now();
  const pages = await discoverSitePages(origin);
  let captured = 0;
  let failed = 0;
  const sampleErrors: string[] = [];

  for (const page of pages) {
    if (Date.now() - startedAt > MAX_CAPTURE_RUNTIME_MS) {
      break;
    }

    try {
      await captureSiteViewForPath(siteId, page.path, page.url);
      captured += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown";
      if (sampleErrors.length < 3) {
        sampleErrors.push(message);
      }
      console.warn(
        "[screenshot-onboarding] capture failed",
        JSON.stringify({ siteId, pagePath: page.path, error: message }),
      );
    }
  }

  return <ScreenshotCaptureResult>{
    discovered: pages.length,
    captured,
    failed,
    note: sampleErrors[0],
    sampleErrors,
  };
}

export async function captureScreenshotForPath(siteId: string, rawPath: string, rawPageUrl: string) {
  const pageUrl = normalizeWebURL(rawPageUrl);
  const pathKey = normalizePath(rawPath);
  if (!pageUrl) {
    throw new Error("Enter a valid page URL.");
  }
  return captureSiteViewForPath(siteId, pathKey, pageUrl);
}

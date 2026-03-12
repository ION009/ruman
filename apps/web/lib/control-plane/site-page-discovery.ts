import { sanitizeOrigin } from "@/lib/control-plane/tracker-script";
import { upsertSitePages } from "@/lib/control-plane/site-pages";

const NON_HTML_EXTENSION = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|txt|webm|webp|xml|zip)$/i;
const MAX_DISCOVERY_PAGES = Math.min(
  400,
  Math.max(8, Number.parseInt(process.env.ANLTICSHEAT_DISCOVERY_MAX_PAGES ?? "140", 10) || 140),
);
const REQUEST_TIMEOUT_MS = Math.max(
  2_500,
  Number.parseInt(process.env.ANLTICSHEAT_DISCOVERY_REQUEST_TIMEOUT_MS ?? "9000", 10) || 9_000,
);

type DiscoveredSitePage = {
  path: string;
  url: string;
};

export type SitePageDiscoveryResult = {
  origin: string;
  discovered: number;
  stored: number;
  pages: string[];
  note?: string;
};

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

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
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
        "user-agent": "anlticsheat-page-discovery-bot/1.0",
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

async function discoverSitemapURLs(origin: string) {
  const sitemapURLs = new Set<string>([new URL("/sitemap.xml", origin).toString()]);
  const robots = await fetchText(new URL("/robots.txt", origin).toString(), REQUEST_TIMEOUT_MS);
  if (!robots) {
    return [...sitemapURLs];
  }

  const lines = robots.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^\s*Sitemap:\s*(\S+)\s*$/i);
    if (!match) {
      continue;
    }
    try {
      sitemapURLs.add(new URL(match[1], origin).toString());
    } catch {
      // ignore malformed URLs
    }
  }

  return [...sitemapURLs];
}

async function collectPagesFromSitemaps(origin: string, pages: Set<string>) {
  const queue = await discoverSitemapURLs(origin);
  const visited = new Set<string>();

  while (queue.length > 0 && pages.size < MAX_DISCOVERY_PAGES) {
    const sitemapURL = queue.shift();
    if (!sitemapURL || visited.has(sitemapURL)) {
      continue;
    }
    visited.add(sitemapURL);

    const xml = await fetchText(sitemapURL, REQUEST_TIMEOUT_MS);
    if (!xml) {
      continue;
    }

    const matches = xml.matchAll(/<loc>(.*?)<\/loc>/gi);
    for (const match of matches) {
      const location = decodeXmlEntities(match[1] ?? "").trim();
      if (!location) {
        continue;
      }

      let parsed: URL;
      try {
        parsed = new URL(location, origin);
      } catch {
        continue;
      }

      if (parsed.origin !== new URL(origin).origin) {
        continue;
      }

      const pathname = normalizePath(parsed.pathname);
      if (pathname.endsWith(".xml")) {
        const nested = parsed.toString();
        if (!visited.has(nested)) {
          queue.push(nested);
        }
        continue;
      }

      if (!isLikelyHtmlPath(pathname)) {
        continue;
      }

      pages.add(pathname);
      if (pages.size >= MAX_DISCOVERY_PAGES) {
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
    if (pages.size >= MAX_DISCOVERY_PAGES) {
      return;
    }
  }
}

async function collectPagesByCrawling(origin: string, pages: Set<string>) {
  const queue = [...pages];
  const visited = new Set(queue);

  while (queue.length > 0 && pages.size < MAX_DISCOVERY_PAGES) {
    const path = queue.shift() ?? "/";
    const html = await fetchText(new URL(path, origin).toString(), REQUEST_TIMEOUT_MS);
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

      if (pages.size >= MAX_DISCOVERY_PAGES) {
        return;
      }
    }
  }
}

export async function discoverSitePages(rawOrigin: string): Promise<DiscoveredSitePage[]> {
  const origin = sanitizeOrigin(rawOrigin);
  if (!origin) {
    return [];
  }

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

  return sortedPaths.map((path) => ({
    path,
    url: new URL(path, origin).toString(),
  }));
}

export async function discoverAndStoreSitePages(siteId: string, rawOrigin: string): Promise<SitePageDiscoveryResult> {
  const origin = sanitizeOrigin(rawOrigin);
  if (!origin) {
    return {
      origin: "",
      discovered: 0,
      stored: 0,
      pages: [],
      note: "No valid site origin available.",
    };
  }

  const discoveredPages = await discoverSitePages(origin);
  const paths = discoveredPages.map((page) => page.path);

  if (!paths.length) {
    await upsertSitePages(siteId, ["/"], "sitemap");
    return {
      origin,
      discovered: 1,
      stored: 1,
      pages: ["/"],
      note: "Could not resolve sitemap links; defaulted to root page.",
    };
  }

  await upsertSitePages(siteId, paths, "sitemap");
  return {
    origin,
    discovered: paths.length,
    stored: paths.length,
    pages: paths,
  };
}

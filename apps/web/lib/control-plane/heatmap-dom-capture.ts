import { upsertHeatmapDomSnapshot } from "@/lib/control-plane/heatmap-dom-snapshots";
import { discoverSitePages } from "@/lib/control-plane/site-page-discovery";
import { upsertSitePages } from "@/lib/control-plane/site-pages";
import { sanitizeOrigin } from "@/lib/control-plane/tracker-script";

const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_VIEWPORT_WIDTH = 1440;
const DEFAULT_VIEWPORT_HEIGHT = 920;

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) {
    return "";
  }

  return String(match[1] || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
}

async function fetchHTML(url: string) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "anlticsheat-dom-capture/1.0",
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

export async function captureSiteDomSnapshots(siteId: string, rawOrigin: string) {
  const origin = sanitizeOrigin(rawOrigin);
  if (!origin) {
    throw new Error("No valid site origin available for DOM capture.");
  }

  const pages = await discoverSitePages(origin);
  if (!pages.length) {
    throw new Error("No same-origin pages were discovered for DOM capture.");
  }

  let captured = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const page of pages) {
    const html = await fetchHTML(page.url);
    if (!html.trim()) {
      failed += 1;
      if (errors.length < 3) {
        errors.push(`empty_html:${page.path}`);
      }
      continue;
    }

    await upsertHeatmapDomSnapshot(siteId, {
      path: page.path,
      pageUrl: page.url,
      pageTitle: extractTitle(html),
      html,
      css: "",
      viewportWidth: DEFAULT_VIEWPORT_WIDTH,
      viewportHeight: DEFAULT_VIEWPORT_HEIGHT,
      documentWidth: DEFAULT_VIEWPORT_WIDTH,
      documentHeight: DEFAULT_VIEWPORT_HEIGHT,
      capturedAt: new Date().toISOString(),
    });
    captured += 1;
  }

  await upsertSitePages(siteId, pages.map((page) => page.path), "sitemap");

  return {
    origin,
    discovered: pages.length,
    captured,
    failed,
    note:
      captured > 0
        ? `Captured ${captured} page snapshot${captured === 1 ? "" : "s"} from ${origin}.`
        : "No page snapshots were captured.",
    sampleErrors: errors,
  };
}

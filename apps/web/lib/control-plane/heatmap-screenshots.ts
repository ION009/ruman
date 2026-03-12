import { getControlPlaneSql } from "@/lib/control-plane/db";

type RawHeatmapScreenshotRow = {
  path: string;
  screenshot: string;
};

function normalizePathKey(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "/";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function normalizeScreenshot(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Screenshot is required.");
  }

  if (trimmed.startsWith("/")) {
    if (!trimmed.includes("..") && !/\s/.test(trimmed)) {
      return trimmed;
    }
  }

  if (trimmed.startsWith("data:image/")) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return trimmed;
    }
  } catch {
    // ignore
  }

  throw new Error("Screenshot must be an http(s) URL, a local /path, or an image data URL.");
}

function missingHeatmapScreenshotsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_heatmap_screenshots");
}

async function ensureHeatmapScreenshotsTable() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_heatmap_screenshots
    (
      site_id    text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
      path       text        NOT NULL,
      screenshot text        NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, path)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_heatmap_screenshots_updated_idx
      ON analytics_heatmap_screenshots (updated_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingHeatmapScreenshotsTable(error)) {
      throw error;
    }

    await ensureHeatmapScreenshotsTable();

    try {
      return await run();
    } catch (retryError) {
      if (missingHeatmapScreenshotsTable(retryError)) {
        throw new Error(fallbackMessage);
      }
      throw retryError;
    }
  }
}

export async function readHeatmapScreenshot(siteId: string, path: string) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);

  try {
    return await retryAfterEnsuringTable(
      async () => {
    const rows = (await sql`
      SELECT path, screenshot
      FROM analytics_heatmap_screenshots
      WHERE site_id = ${siteId}
        AND path = ${normalizedPath}
      LIMIT 1
    `) as RawHeatmapScreenshotRow[];

        return rows[0]?.screenshot ?? null;
      },
      "Heatmap screenshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapScreenshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap screenshot storage is not configured.")
    ) {
      return null;
    }
    throw error;
  }
}

export async function listHeatmapScreenshots(siteId: string) {
  const sql = getControlPlaneSql();

  try {
    return await retryAfterEnsuringTable(
      async () => {
    const rows = (await sql`
      SELECT path, screenshot
      FROM analytics_heatmap_screenshots
      WHERE site_id = ${siteId}
      ORDER BY updated_at DESC
    `) as RawHeatmapScreenshotRow[];

        return rows.map((row) => ({
          path: normalizePathKey(row.path),
          screenshot: row.screenshot,
        }));
      },
      "Heatmap screenshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapScreenshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap screenshot storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function upsertHeatmapScreenshot(siteId: string, path: string, screenshot: string) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);
  const normalizedScreenshot = normalizeScreenshot(screenshot);

  if (normalizedScreenshot.length > 2_000_000) {
    throw new Error("Screenshot payload is too large.");
  }

  try {
    return await retryAfterEnsuringTable(
      async () => {
    const rows = (await sql`
      INSERT INTO analytics_heatmap_screenshots (site_id, path, screenshot, updated_at)
      VALUES (${siteId}, ${normalizedPath}, ${normalizedScreenshot}, NOW())
      ON CONFLICT (site_id, path) DO UPDATE
      SET screenshot = EXCLUDED.screenshot,
          updated_at = NOW()
      RETURNING path, screenshot
    `) as RawHeatmapScreenshotRow[];

        return rows[0]?.screenshot ?? normalizedScreenshot;
      },
      "Heatmap screenshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapScreenshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap screenshot storage is not configured.")
    ) {
      throw new Error("Heatmap screenshot storage is not configured.");
    }
    throw error;
  }
}

export async function deleteHeatmapScreenshot(siteId: string, path: string) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);

  try {
    await retryAfterEnsuringTable(
      async () => {
    await sql`
      DELETE FROM analytics_heatmap_screenshots
      WHERE site_id = ${siteId}
        AND path = ${normalizedPath}
    `;
      },
      "Heatmap screenshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapScreenshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap screenshot storage is not configured.")
    ) {
      throw new Error("Heatmap screenshot storage is not configured.");
    }
    throw error;
  }
}

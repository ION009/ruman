import { createHash } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";

type RawHeatmapDomSnapshotRow = {
  path: string;
  page_url: string;
  page_title: string;
  snapshot_html: string;
  snapshot_css: string;
  viewport_width: number;
  viewport_height: number;
  document_width: number;
  document_height: number;
  content_hash: string;
  captured_at: string | Date;
};

export type HeatmapDomSnapshotRecord = {
  path: string;
  pageUrl: string;
  pageTitle: string;
  html: string;
  css: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  contentHash: string;
  capturedAt: string;
};

export type UpsertHeatmapDomSnapshotInput = {
  path: string;
  pageUrl?: string;
  pageTitle?: string;
  html: string;
  css?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  documentWidth?: number;
  documentHeight?: number;
  capturedAt?: string | Date;
  contentHash?: string;
};

const MAX_HTML_CHARS = 2_500_000;
const MAX_CSS_CHARS = 600_000;

function normalizePathKey(value: string) {
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

function clampDimension(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(20000, Math.round(value || 0)));
}

function normalizeText(value: string | undefined, limit: number) {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= limit ? trimmed : trimmed.slice(0, limit);
}

function missingHeatmapDomSnapshotsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_heatmap_dom_snapshots");
}

async function ensureHeatmapDomSnapshotsTable() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_heatmap_dom_snapshots
    (
      site_id          text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
      path             text        NOT NULL,
      page_url         text        NOT NULL DEFAULT '',
      page_title       text        NOT NULL DEFAULT '',
      snapshot_html    text        NOT NULL,
      snapshot_css     text        NOT NULL DEFAULT '',
      viewport_width   integer     NOT NULL DEFAULT 0,
      viewport_height  integer     NOT NULL DEFAULT 0,
      document_width   integer     NOT NULL DEFAULT 0,
      document_height  integer     NOT NULL DEFAULT 0,
      content_hash     text        NOT NULL,
      captured_at      timestamptz NOT NULL DEFAULT now(),
      created_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, path)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_heatmap_dom_snapshots_updated_idx
      ON analytics_heatmap_dom_snapshots (site_id, updated_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingHeatmapDomSnapshotsTable(error)) {
      throw error;
    }

    await ensureHeatmapDomSnapshotsTable();

    try {
      return await run();
    } catch (retryError) {
      if (missingHeatmapDomSnapshotsTable(retryError)) {
        throw new Error(fallbackMessage);
      }
      throw retryError;
    }
  }
}

export async function listHeatmapDomSnapshotPaths(siteId: string) {
  const sql = getControlPlaneSql();

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT path
          FROM analytics_heatmap_dom_snapshots
          WHERE site_id = ${siteId}
          ORDER BY updated_at DESC
        `) as Pick<RawHeatmapDomSnapshotRow, "path">[];

        return rows.map((row) => normalizePathKey(row.path));
      },
      "Heatmap DOM snapshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapDomSnapshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap DOM snapshot storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function readHeatmapDomSnapshot(siteId: string, path: string): Promise<HeatmapDomSnapshotRecord | null> {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT
            path,
            page_url,
            page_title,
            snapshot_html,
            snapshot_css,
            viewport_width,
            viewport_height,
            document_width,
            document_height,
            content_hash,
            captured_at
          FROM analytics_heatmap_dom_snapshots
          WHERE site_id = ${siteId}
            AND path = ${normalizedPath}
          LIMIT 1
        `) as RawHeatmapDomSnapshotRow[];

        const row = rows[0];
        if (!row) {
          return null;
        }

        return {
          path: normalizePathKey(row.path),
          pageUrl: row.page_url || "",
          pageTitle: row.page_title || "",
          html: row.snapshot_html || "",
          css: row.snapshot_css || "",
          viewport: {
            width: clampDimension(row.viewport_width),
            height: clampDimension(row.viewport_height),
          },
          document: {
            width: clampDimension(row.document_width),
            height: clampDimension(row.document_height),
          },
          contentHash: row.content_hash || "",
          capturedAt: new Date(row.captured_at).toISOString(),
        };
      },
      "Heatmap DOM snapshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapDomSnapshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap DOM snapshot storage is not configured.")
    ) {
      return null;
    }
    throw error;
  }
}

export async function upsertHeatmapDomSnapshot(siteId: string, input: UpsertHeatmapDomSnapshotInput) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(input.path);
  const snapshotHTML = normalizeText(input.html, MAX_HTML_CHARS);
  const snapshotCSS = normalizeText(input.css, MAX_CSS_CHARS);

  if (!snapshotHTML) {
    throw new Error("DOM snapshot html is required.");
  }

  const normalizedCapturedAt = new Date(input.capturedAt ?? Date.now());
  const capturedAt = Number.isNaN(normalizedCapturedAt.getTime())
    ? new Date().toISOString()
    : normalizedCapturedAt.toISOString();
  const hash =
    normalizeText(input.contentHash, 128) ||
    createHash("sha256").update(snapshotHTML).update(snapshotCSS).digest("hex");

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          INSERT INTO analytics_heatmap_dom_snapshots
          (
            site_id,
            path,
            page_url,
            page_title,
            snapshot_html,
            snapshot_css,
            viewport_width,
            viewport_height,
            document_width,
            document_height,
            content_hash,
            captured_at,
            updated_at
          )
          VALUES
          (
            ${siteId},
            ${normalizedPath},
            ${normalizeText(input.pageUrl, 2048)},
            ${normalizeText(input.pageTitle, 512)},
            ${snapshotHTML},
            ${snapshotCSS},
            ${clampDimension(input.viewportWidth)},
            ${clampDimension(input.viewportHeight)},
            ${clampDimension(input.documentWidth)},
            ${clampDimension(input.documentHeight)},
            ${hash},
            ${capturedAt},
            NOW()
          )
          ON CONFLICT (site_id, path) DO UPDATE
          SET
            page_url = EXCLUDED.page_url,
            page_title = EXCLUDED.page_title,
            snapshot_html = EXCLUDED.snapshot_html,
            snapshot_css = EXCLUDED.snapshot_css,
            viewport_width = EXCLUDED.viewport_width,
            viewport_height = EXCLUDED.viewport_height,
            document_width = EXCLUDED.document_width,
            document_height = EXCLUDED.document_height,
            content_hash = EXCLUDED.content_hash,
            captured_at = EXCLUDED.captured_at,
            updated_at = NOW()
          RETURNING
            path,
            page_url,
            page_title,
            snapshot_html,
            snapshot_css,
            viewport_width,
            viewport_height,
            document_width,
            document_height,
            content_hash,
            captured_at
        `) as RawHeatmapDomSnapshotRow[];

        const row = rows[0];
        return {
          path: normalizePathKey(row.path),
          pageUrl: row.page_url || "",
          pageTitle: row.page_title || "",
          html: row.snapshot_html || "",
          css: row.snapshot_css || "",
          viewport: {
            width: clampDimension(row.viewport_width),
            height: clampDimension(row.viewport_height),
          },
          document: {
            width: clampDimension(row.document_width),
            height: clampDimension(row.document_height),
          },
          contentHash: row.content_hash || "",
          capturedAt: new Date(row.captured_at).toISOString(),
        } as HeatmapDomSnapshotRecord;
      },
      "Heatmap DOM snapshot storage is not configured.",
    );
  } catch (error) {
    if (
      missingHeatmapDomSnapshotsTable(error) ||
      (error instanceof Error && error.message === "Heatmap DOM snapshot storage is not configured.")
    ) {
      throw new Error("Heatmap DOM snapshot storage is not configured.");
    }
    throw error;
  }
}

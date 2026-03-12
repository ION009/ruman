import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";

type RawHeatmapDomRefreshRow = {
  path: string;
  scope: string;
  request_id: string;
  requested_at: string | Date;
  fulfilled_at: string | Date | null;
};

export type HeatmapDomRefreshScope = "path" | "site";

const SITE_REFRESH_PATH = "__site__";

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

function needsHeatmapDomRefreshMigration(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes("analytics_heatmap_dom_refresh_requests") ||
    message.includes(`column "scope"`) ||
    message.includes(`column "request_id"`)
  );
}

async function ensureHeatmapDomRefreshTable() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_heatmap_dom_refresh_requests
    (
      site_id      text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
      path         text        NOT NULL,
      scope        text        NOT NULL DEFAULT 'path',
      request_id   text        NOT NULL,
      requested_at timestamptz NOT NULL DEFAULT now(),
      fulfilled_at timestamptz NULL,
      created_at   timestamptz NOT NULL DEFAULT now(),
      updated_at   timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, path),
      CONSTRAINT analytics_heatmap_dom_refresh_scope_check CHECK (scope IN ('path', 'site'))
    )
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'path'
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS request_id text NOT NULL DEFAULT ''
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS requested_at timestamptz NOT NULL DEFAULT now()
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz NULL
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now()
  `;

  await sql`
    ALTER TABLE analytics_heatmap_dom_refresh_requests
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_heatmap_dom_refresh_requests_pending_idx
      ON analytics_heatmap_dom_refresh_requests (site_id, fulfilled_at, updated_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!needsHeatmapDomRefreshMigration(error)) {
      throw error;
    }

    await ensureHeatmapDomRefreshTable();

    try {
      return await run();
    } catch (retryError) {
      if (needsHeatmapDomRefreshMigration(retryError)) {
        throw new Error(fallbackMessage);
      }
      throw retryError;
    }
  }
}

function normalizedRefreshPath(path: string, scope: HeatmapDomRefreshScope) {
  return scope === "site" ? SITE_REFRESH_PATH : normalizePathKey(path);
}

export async function queueHeatmapDomRefresh(
  siteId: string,
  path: string,
  scope: HeatmapDomRefreshScope = "path",
) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizedRefreshPath(path, scope);
  const requestId = randomUUID();

  return retryAfterEnsuringTable(
    async () => {
      const rows = (await sql`
        INSERT INTO analytics_heatmap_dom_refresh_requests
          (site_id, path, scope, request_id, requested_at, fulfilled_at, updated_at)
        VALUES
          (${siteId}, ${normalizedPath}, ${scope}, ${requestId}, NOW(), NULL, NOW())
        ON CONFLICT (site_id, path) DO UPDATE
        SET
          scope = EXCLUDED.scope,
          request_id = EXCLUDED.request_id,
          requested_at = NOW(),
          fulfilled_at = NULL,
          updated_at = NOW()
        RETURNING path, scope, request_id, requested_at, fulfilled_at
      `) as RawHeatmapDomRefreshRow[];

      const row = rows[0];
      return {
        path: row?.scope === "site" ? "/" : normalizePathKey(row?.path ?? normalizedPath),
        scope: (row?.scope === "site" ? "site" : "path") as HeatmapDomRefreshScope,
        requestId: row?.request_id ?? requestId,
        requestedAt: new Date(row?.requested_at ?? Date.now()).toISOString(),
        fulfilledAt: row?.fulfilled_at ? new Date(row.fulfilled_at).toISOString() : null,
      };
    },
    "Heatmap DOM refresh storage is not configured.",
  );
}

export async function readPendingHeatmapDomRefresh(siteId: string, path: string) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT path, scope, request_id, requested_at, fulfilled_at
          FROM analytics_heatmap_dom_refresh_requests
          WHERE site_id = ${siteId}
            AND (
              path = ${normalizedPath}
              OR path = ${SITE_REFRESH_PATH}
            )
            AND fulfilled_at IS NULL
          ORDER BY CASE WHEN scope = 'site' THEN 0 ELSE 1 END, requested_at DESC
          LIMIT 1
        `) as RawHeatmapDomRefreshRow[];

        const row = rows[0];
        if (!row) {
          return null;
        }

        return {
          path: row.scope === "site" ? "/" : normalizePathKey(row.path),
          scope: (row.scope === "site" ? "site" : "path") as HeatmapDomRefreshScope,
          requestId: row.request_id,
          requestedAt: new Date(row.requested_at).toISOString(),
        };
      },
      "Heatmap DOM refresh storage is not configured.",
    );
  } catch (error) {
    if (
      needsHeatmapDomRefreshMigration(error) ||
      (error instanceof Error && error.message === "Heatmap DOM refresh storage is not configured.")
    ) {
      return null;
    }
    throw error;
  }
}

export async function fulfillHeatmapDomRefresh(siteId: string, path: string, requestId: string) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);
  const normalizedRequestId = String(requestId || "").trim();
  if (!normalizedRequestId) {
    return false;
  }

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          UPDATE analytics_heatmap_dom_refresh_requests
          SET
            fulfilled_at = NOW(),
            updated_at = NOW()
          WHERE site_id = ${siteId}
            AND request_id = ${normalizedRequestId}
            AND fulfilled_at IS NULL
            AND (
              path = ${normalizedPath}
              OR path = ${SITE_REFRESH_PATH}
            )
          RETURNING path
        `) as Pick<RawHeatmapDomRefreshRow, "path">[];

        return rows.length > 0;
      },
      "Heatmap DOM refresh storage is not configured.",
    );
  } catch (error) {
    if (
      needsHeatmapDomRefreshMigration(error) ||
      (error instanceof Error && error.message === "Heatmap DOM refresh storage is not configured.")
    ) {
      return false;
    }
    throw error;
  }
}

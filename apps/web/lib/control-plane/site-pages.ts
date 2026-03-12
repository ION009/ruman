import { getControlPlaneSql } from "@/lib/control-plane/db";

export type SitePageSource = "sitemap" | "tracker" | "manual";

type RawSitePageRow = {
  path: string;
  source: string;
  last_seen_at: string | Date | null;
};

export type SitePageRecord = {
  path: string;
  source: SitePageSource;
  lastSeenAt: string | null;
};

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

function normalizeSource(value: string): SitePageSource {
  switch (value.trim()) {
    case "tracker":
      return "tracker";
    case "manual":
      return "manual";
    default:
      return "sitemap";
  }
}

function missingSitePagesTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_site_pages");
}

async function ensureSitePagesTable() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_site_pages
    (
      site_id       text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
      path          text        NOT NULL,
      source        text        NOT NULL DEFAULT 'sitemap',
      first_seen_at timestamptz NOT NULL DEFAULT now(),
      last_seen_at  timestamptz NOT NULL DEFAULT now(),
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (site_id, path),
      CONSTRAINT analytics_site_pages_source_check CHECK (source IN ('sitemap', 'tracker', 'manual'))
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_site_pages_last_seen_idx
      ON analytics_site_pages (site_id, last_seen_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingSitePagesTable(error)) {
      throw error;
    }

    await ensureSitePagesTable();

    try {
      return await run();
    } catch (retryError) {
      if (missingSitePagesTable(retryError)) {
        throw new Error(fallbackMessage);
      }
      throw retryError;
    }
  }
}

export async function listSitePages(siteId: string): Promise<SitePageRecord[]> {
  const sql = getControlPlaneSql();

  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT path, source, last_seen_at
          FROM analytics_site_pages
          WHERE site_id = ${siteId}
          ORDER BY
            CASE WHEN path = '/' THEN 0 ELSE 1 END,
            char_length(path) ASC,
            path ASC
        `) as RawSitePageRow[];

        return rows.map((row) => ({
          path: normalizePathKey(row.path),
          source: normalizeSource(row.source),
          lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
        }));
      },
      "Site page discovery storage is not configured.",
    );
  } catch (error) {
    if (
      missingSitePagesTable(error) ||
      (error instanceof Error && error.message === "Site page discovery storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function upsertSitePage(
  siteId: string,
  path: string,
  source: SitePageSource = "tracker",
  lastSeenAt: Date = new Date(),
) {
  const sql = getControlPlaneSql();
  const normalizedPath = normalizePathKey(path);
  const normalizedSource = normalizeSource(source);
  const seenAt = lastSeenAt.toISOString();

  try {
    await retryAfterEnsuringTable(
      async () => {
        await sql`
          INSERT INTO analytics_site_pages (site_id, path, source, first_seen_at, last_seen_at, updated_at)
          VALUES (${siteId}, ${normalizedPath}, ${normalizedSource}, ${seenAt}, ${seenAt}, NOW())
          ON CONFLICT (site_id, path) DO UPDATE
          SET
            source = CASE
              WHEN analytics_site_pages.source = 'manual' THEN analytics_site_pages.source
              ELSE EXCLUDED.source
            END,
            last_seen_at = GREATEST(analytics_site_pages.last_seen_at, EXCLUDED.last_seen_at),
            updated_at = NOW()
        `;
      },
      "Site page discovery storage is not configured.",
    );
  } catch (error) {
    if (
      missingSitePagesTable(error) ||
      (error instanceof Error && error.message === "Site page discovery storage is not configured.")
    ) {
      throw new Error("Site page discovery storage is not configured.");
    }
    throw error;
  }
}

export async function upsertSitePages(
  siteId: string,
  paths: string[],
  source: SitePageSource = "sitemap",
  lastSeenAt: Date = new Date(),
) {
  const sql = getControlPlaneSql();
  const normalizedSource = normalizeSource(source);
  const seenAt = lastSeenAt.toISOString();
  const uniquePaths = [...new Set(paths.map((path) => normalizePathKey(path)).filter(Boolean))];
  if (!uniquePaths.length) {
    return;
  }

  try {
    await retryAfterEnsuringTable(
      async () => {
        const statements = uniquePaths.map((path) =>
          sql`
            INSERT INTO analytics_site_pages (site_id, path, source, first_seen_at, last_seen_at, updated_at)
            VALUES (${siteId}, ${path}, ${normalizedSource}, ${seenAt}, ${seenAt}, NOW())
            ON CONFLICT (site_id, path) DO UPDATE
            SET
              source = CASE
                WHEN analytics_site_pages.source = 'manual' THEN analytics_site_pages.source
                ELSE EXCLUDED.source
              END,
              last_seen_at = GREATEST(analytics_site_pages.last_seen_at, EXCLUDED.last_seen_at),
              updated_at = NOW()
          `,
        );
        await sql.transaction(statements);
      },
      "Site page discovery storage is not configured.",
    );
  } catch (error) {
    if (
      missingSitePagesTable(error) ||
      (error instanceof Error && error.message === "Site page discovery storage is not configured.")
    ) {
      throw new Error("Site page discovery storage is not configured.");
    }
    throw error;
  }
}

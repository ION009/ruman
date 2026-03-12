import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type { SharedDashboardLink, SharedDashboardLinkInput } from "@/lib/dashboard/types";

type RawSharedLinkRow = {
  id: string;
  site_id: string;
  slug: string;
  password: string | null;
  created_at: string | Date;
};

function missingSharedLinksTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_shared_links");
}

async function ensureSharedLinksTable() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_shared_links
    (
      id         text PRIMARY KEY,
      site_id    text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      slug       text        NOT NULL UNIQUE,
      password   text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_shared_links_site_idx
      ON analytics_shared_links (site_id, created_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingSharedLinksTable(error)) {
      throw error;
    }
  }

  await ensureSharedLinksTable();

  try {
    return await run();
  } catch (error) {
    if (missingSharedLinksTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function encodePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function buildSharedLink(row: RawSharedLinkRow): SharedDashboardLink {
  return {
    id: row.id,
    siteId: row.site_id,
    slug: row.slug,
    passwordProtected: Boolean(row.password),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function sharedSlug() {
  return randomBytes(6).toString("base64url").toLowerCase();
}

export async function listSharedLinks(siteId: string): Promise<SharedDashboardLink[]> {
  const sql = getControlPlaneSql();
  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT id, site_id, slug, password, created_at
          FROM analytics_shared_links
          WHERE site_id = ${siteId}
          ORDER BY created_at DESC, id DESC
        `) as RawSharedLinkRow[];
        return rows.map(buildSharedLink);
      },
      "Shared link storage is not configured.",
    );
  } catch (error) {
    if (
      missingSharedLinksTable(error) ||
      (error instanceof Error && error.message === "Shared link storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createSharedLink(siteId: string, input: SharedDashboardLinkInput) {
  const sql = getControlPlaneSql();
  const password = input.password?.trim() ? encodePassword(input.password.trim()) : null;
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_shared_links (id, site_id, slug, password)
        VALUES (${randomUUID()}, ${siteId}, ${sharedSlug()}, ${password})
        RETURNING id, site_id, slug, password, created_at
      `) as RawSharedLinkRow[],
    "Shared link storage is not configured.",
  );
  return buildSharedLink(rows[0]);
}

export async function deleteSharedLink(siteId: string, linkId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        DELETE FROM analytics_shared_links
        WHERE id = ${linkId}
          AND site_id = ${siteId}
      `;
    },
    "Shared link storage is not configured.",
  );
}

export async function findSharedLinkBySlug(slug: string) {
  const sql = getControlPlaneSql();
  return retryAfterEnsuringTable(
    async () => {
      const rows = (await sql`
        SELECT id, site_id, slug, password, created_at
        FROM analytics_shared_links
        WHERE slug = ${slug}
        LIMIT 1
      `) as RawSharedLinkRow[];
      return rows[0] ?? null;
    },
    "Shared link storage is not configured.",
  );
}

export function verifySharedLinkPassword(link: { password?: string | null }, password?: string | null) {
  const encoded = link.password?.trim() ?? "";
  if (!encoded) {
    return true;
  }
  if (!password?.trim()) {
    return false;
  }
  return verifyPassword(password.trim(), encoded);
}

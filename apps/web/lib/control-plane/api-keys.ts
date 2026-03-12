import { createHash, randomBytes, randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type { DashboardApiKey, DashboardApiKeyInput } from "@/lib/dashboard/types";

type RawAPIKeyRow = {
  id: string;
  site_id: string;
  name: string;
  permissions: string;
  created_at: string | Date;
  last_used: string | Date | null;
};

function missingAPIKeysTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_api_keys");
}

async function ensureAPIKeysTable() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_api_keys
    (
      id          text PRIMARY KEY,
      site_id     text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      key_hash    text        NOT NULL,
      name        text        NOT NULL,
      permissions text        NOT NULL DEFAULT 'read',
      created_at  timestamptz NOT NULL DEFAULT now(),
      last_used   timestamptz
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_api_keys_site_idx
      ON analytics_api_keys (site_id, created_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingAPIKeysTable(error)) {
      throw error;
    }
  }

  await ensureAPIKeysTable();

  try {
    return await run();
  } catch (error) {
    if (missingAPIKeysTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function normalizeAPIKeyInput(input: DashboardApiKeyInput): DashboardApiKeyInput {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Enter an API key name.");
  }
  return {
    name,
    permissions: input.permissions?.trim() || "read",
  };
}

function buildAPIKey(row: RawAPIKeyRow, token?: string | null): DashboardApiKey {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    permissions: row.permissions,
    createdAt: new Date(row.created_at).toISOString(),
    lastUsed: row.last_used ? new Date(row.last_used).toISOString() : null,
    token: token ?? null,
  };
}

function hashAPIKey(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function listAPIKeys(siteId: string): Promise<DashboardApiKey[]> {
  const sql = getControlPlaneSql();
  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT id, site_id, name, permissions, created_at, last_used
          FROM analytics_api_keys
          WHERE site_id = ${siteId}
          ORDER BY created_at DESC, id DESC
        `) as RawAPIKeyRow[];
        return rows.map((row) => buildAPIKey(row));
      },
      "API key storage is not configured.",
    );
  } catch (error) {
    if (
      missingAPIKeysTable(error) ||
      (error instanceof Error && error.message === "API key storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createAPIKey(siteId: string, input: DashboardApiKeyInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeAPIKeyInput(input);
  const token = `ak_${randomBytes(18).toString("hex")}`;
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_api_keys (id, site_id, key_hash, name, permissions)
        VALUES (${randomUUID()}, ${siteId}, ${hashAPIKey(token)}, ${normalized.name}, ${normalized.permissions})
        RETURNING id, site_id, name, permissions, created_at, last_used
      `) as RawAPIKeyRow[],
    "API key storage is not configured.",
  );
  return buildAPIKey(rows[0], token);
}

export async function deleteAPIKey(siteId: string, keyId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        DELETE FROM analytics_api_keys
        WHERE id = ${keyId}
          AND site_id = ${siteId}
      `;
    },
    "API key storage is not configured.",
  );
}

import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type { GoalDefinition, GoalDefinitionInput, GoalMatchType, GoalType } from "@/lib/dashboard/types";

type RawGoalRow = {
  id: string;
  site_id: string;
  name: string;
  type: string;
  match: string;
  value: string;
  category: string | null;
  currency: string | null;
  created_at: string | Date;
};

function missingGoalsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_goals");
}

async function ensureGoalsTable() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_goals
    (
      id         text PRIMARY KEY,
      site_id    text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      name       text        NOT NULL,
      type       text        NOT NULL CHECK (type IN ('pageview', 'event')),
      match      text        NOT NULL CHECK (match IN ('exact', 'prefix', 'contains')),
      value      text        NOT NULL,
      category   text,
      currency   text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    ALTER TABLE analytics_goals
    ADD COLUMN IF NOT EXISTS category text
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_goals_site_idx
      ON analytics_goals (site_id, created_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingGoalsTable(error)) {
      throw error;
    }
  }

  await ensureGoalsTable();

  try {
    return await run();
  } catch (error) {
    if (missingGoalsTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function normalizeGoalType(value: string): GoalType {
  return value === "event" ? "event" : "pageview";
}

function normalizeGoalMatch(value: string): GoalMatchType {
  if (value === "prefix" || value === "contains") {
    return value;
  }
  return "exact";
}

function normalizeGoalInput(input: GoalDefinitionInput): GoalDefinitionInput {
  const name = input.name.trim();
  const value = input.value.trim();
  if (!name) {
    throw new Error("Enter a goal name.");
  }
  if (!value) {
    throw new Error("Enter a goal value.");
  }
  return {
    name,
    type: normalizeGoalType(input.type),
    match: normalizeGoalMatch(input.match),
    value,
    category: input.category?.trim() || null,
    currency: input.currency?.trim() || null,
  };
}

function buildGoal(row: RawGoalRow): GoalDefinition {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    type: normalizeGoalType(row.type),
    match: normalizeGoalMatch(row.match),
    value: row.value,
    category: row.category,
    currency: row.currency,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function listGoals(siteId: string): Promise<GoalDefinition[]> {
  const sql = getControlPlaneSql();
  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT id, site_id, name, type, match, value, category, currency, created_at
          FROM analytics_goals
          WHERE site_id = ${siteId}
          ORDER BY created_at DESC, id DESC
        `) as RawGoalRow[];
        return rows.map(buildGoal);
      },
      "Goal storage is not configured.",
    );
  } catch (error) {
    if (
      missingGoalsTable(error) ||
      (error instanceof Error && error.message === "Goal storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createGoal(siteId: string, input: GoalDefinitionInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeGoalInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_goals (id, site_id, name, type, match, value, category, currency)
        VALUES (${randomUUID()}, ${siteId}, ${normalized.name}, ${normalized.type}, ${normalized.match}, ${normalized.value}, ${normalized.category}, ${normalized.currency})
        RETURNING id, site_id, name, type, match, value, category, currency, created_at
      `) as RawGoalRow[],
    "Goal storage is not configured.",
  );
  return buildGoal(rows[0]);
}

export async function updateGoal(siteId: string, goalId: string, input: GoalDefinitionInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeGoalInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        UPDATE analytics_goals
        SET name = ${normalized.name},
            type = ${normalized.type},
            match = ${normalized.match},
            value = ${normalized.value},
            category = ${normalized.category},
            currency = ${normalized.currency}
        WHERE id = ${goalId}
          AND site_id = ${siteId}
        RETURNING id, site_id, name, type, match, value, category, currency, created_at
      `) as RawGoalRow[],
    "Goal storage is not configured.",
  );
  if (!rows[0]) {
    throw new Error("Goal not found.");
  }
  return buildGoal(rows[0]);
}

export async function deleteGoal(siteId: string, goalId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        DELETE FROM analytics_goals
        WHERE id = ${goalId}
          AND site_id = ${siteId}
      `;
    },
    "Goal storage is not configured.",
  );
}

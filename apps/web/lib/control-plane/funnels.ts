import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type {
  FunnelCountMode,
  FunnelDefinition,
  FunnelDefinitionInput,
  FunnelStepDefinition,
  FunnelStepKind,
  FunnelStepMatchType,
} from "@/lib/dashboard/types";

type RawFunnelRow = {
  id: string;
  site_id: string;
  name: string;
  count_mode: string;
  window_minutes: number;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawFunnelStepRow = {
  funnel_id: string;
  step_index: number;
  label: string;
  kind: string;
  match_type: string;
  value: string;
};

function missingFunnelsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_funnel_");
}

async function ensureFunnelsTables() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_funnel_definitions
    (
      id             text PRIMARY KEY,
      site_id        text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
      name           text        NOT NULL,
      count_mode     text        NOT NULL DEFAULT 'visitors',
      window_minutes integer     NOT NULL DEFAULT 30,
      created_at     timestamptz NOT NULL DEFAULT now(),
      updated_at     timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_funnel_definitions_count_mode_check CHECK (count_mode IN ('sessions', 'visitors')),
      CONSTRAINT analytics_funnel_definitions_window_check CHECK (window_minutes BETWEEN 1 AND 1440)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS analytics_funnel_definitions_site_idx
      ON analytics_funnel_definitions (site_id, updated_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_funnel_steps
    (
      funnel_id     text        NOT NULL REFERENCES analytics_funnel_definitions (id) ON DELETE CASCADE,
      step_index    integer     NOT NULL,
      label         text        NOT NULL,
      kind          text        NOT NULL,
      match_type    text        NOT NULL,
      value         text        NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      updated_at    timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (funnel_id, step_index),
      CONSTRAINT analytics_funnel_steps_kind_check CHECK (kind IN ('page', 'event')),
      CONSTRAINT analytics_funnel_steps_match_type_check CHECK (match_type IN ('exact', 'prefix'))
    )
  `;
}

async function retryAfterEnsuringTables<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingFunnelsTable(error)) {
      throw error;
    }
  }

  await ensureFunnelsTables();

  try {
    return await run();
  } catch (error) {
    if (missingFunnelsTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function normalizeCountMode(value: string): FunnelCountMode {
  return value === "sessions" ? "sessions" : "visitors";
}

function normalizeStepKind(value: string): FunnelStepKind {
  return value === "event" ? "event" : "page";
}

function normalizeStepMatchType(value: string): FunnelStepMatchType {
  return value === "prefix" ? "prefix" : "exact";
}

function normalizePathValue(value: string) {
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

function normalizeSteps(steps: FunnelStepDefinition[]) {
  const normalized = steps.map((step, index) => {
    const kind = normalizeStepKind(step.kind);
    const label = step.label.trim() || `Step ${index + 1}`;
    const rawValue = step.value.trim();
    const value = kind === "page" ? (rawValue ? normalizePathValue(rawValue) : "") : rawValue;
    const matchType = normalizeStepMatchType(step.matchType);
    return {
      label,
      kind,
      value,
      matchType,
    } satisfies FunnelStepDefinition;
  });

  if (normalized.length < 2) {
    throw new Error("Funnels require at least two steps.");
  }
  if (normalized.length > 8) {
    throw new Error("Funnels support up to eight steps.");
  }
  if (normalized.some((step) => !step.value)) {
    throw new Error("Each funnel step needs a value.");
  }

  return normalized;
}

function normalizeDefinitionInput(input: FunnelDefinitionInput): FunnelDefinitionInput {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Enter a funnel name.");
  }

  const windowMinutes = Number.isFinite(input.windowMinutes)
    ? Math.round(input.windowMinutes)
    : 30;
  if (windowMinutes < 1 || windowMinutes > 1440) {
    throw new Error("Window minutes must be between 1 and 1440.");
  }

  return {
    name,
    countMode: normalizeCountMode(input.countMode),
    windowMinutes,
    steps: normalizeSteps(input.steps),
  };
}

function buildDefinition(row: RawFunnelRow, steps: FunnelStepDefinition[]): FunnelDefinition {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    countMode: normalizeCountMode(row.count_mode),
    windowMinutes: row.window_minutes,
    steps,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function readDefinitions(siteId: string) {
  const sql = getControlPlaneSql();
  const definitions = (await sql`
    SELECT id, site_id, name, count_mode, window_minutes, created_at, updated_at
    FROM analytics_funnel_definitions
    WHERE site_id = ${siteId}
    ORDER BY updated_at DESC, created_at DESC, id DESC
  `) as RawFunnelRow[];

  const steps = (await sql`
    SELECT s.funnel_id, s.step_index, s.label, s.kind, s.match_type, s.value
    FROM analytics_funnel_steps s
    JOIN analytics_funnel_definitions d ON d.id = s.funnel_id
    WHERE d.site_id = ${siteId}
    ORDER BY s.funnel_id ASC, s.step_index ASC
  `) as RawFunnelStepRow[];

  const stepsByFunnel = new Map<string, FunnelStepDefinition[]>();
  for (const row of steps) {
    const current = stepsByFunnel.get(row.funnel_id) ?? [];
    current.push({
      label: row.label,
      kind: normalizeStepKind(row.kind),
      matchType: normalizeStepMatchType(row.match_type),
      value: row.value,
    });
    stepsByFunnel.set(row.funnel_id, current);
  }

  return definitions.map((definition) =>
    buildDefinition(definition, stepsByFunnel.get(definition.id) ?? []),
  );
}

function stepStatements(
  sql: ReturnType<typeof getControlPlaneSql>,
  funnelId: string,
  steps: FunnelStepDefinition[],
) {
  return steps.map((step, index) =>
    sql`
      INSERT INTO analytics_funnel_steps (funnel_id, step_index, label, kind, match_type, value, updated_at)
      VALUES (${funnelId}, ${index}, ${step.label}, ${step.kind}, ${step.matchType}, ${step.value}, NOW())
    `,
  );
}

export async function listFunnelDefinitions(siteId: string): Promise<FunnelDefinition[]> {
  try {
    return await retryAfterEnsuringTables(
      () => readDefinitions(siteId),
      "Funnel storage is not configured.",
    );
  } catch (error) {
    if (
      missingFunnelsTable(error) ||
      (error instanceof Error && error.message === "Funnel storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createFunnelDefinition(siteId: string, input: FunnelDefinitionInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeDefinitionInput(input);
  const funnelId = randomUUID();

  await retryAfterEnsuringTables(
    async () => {
      await sql.transaction([
        sql`
          INSERT INTO analytics_funnel_definitions (id, site_id, name, count_mode, window_minutes, updated_at)
          VALUES (${funnelId}, ${siteId}, ${normalized.name}, ${normalized.countMode}, ${normalized.windowMinutes}, NOW())
        `,
        ...stepStatements(sql, funnelId, normalized.steps),
      ]);
    },
    "Funnel storage is not configured.",
  );

  const definitions = await listFunnelDefinitions(siteId);
  const created = definitions.find((definition) => definition.id === funnelId);
  if (!created) {
    throw new Error("Failed to create funnel.");
  }
  return created;
}

export async function updateFunnelDefinition(siteId: string, funnelId: string, input: FunnelDefinitionInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeDefinitionInput(input);

  await retryAfterEnsuringTables(
    async () => {
      const updated = (await sql`
        UPDATE analytics_funnel_definitions
        SET name = ${normalized.name},
            count_mode = ${normalized.countMode},
            window_minutes = ${normalized.windowMinutes},
            updated_at = NOW()
        WHERE site_id = ${siteId}
          AND id = ${funnelId}
        RETURNING id
      `) as Array<{ id: string }>;

      if (!updated.length) {
        throw new Error("Funnel not found.");
      }

      await sql.transaction([
        sql`DELETE FROM analytics_funnel_steps WHERE funnel_id = ${funnelId}`,
        ...stepStatements(sql, funnelId, normalized.steps),
      ]);
    },
    "Funnel storage is not configured.",
  );

  const definitions = await listFunnelDefinitions(siteId);
  const updated = definitions.find((definition) => definition.id === funnelId);
  if (!updated) {
    throw new Error("Failed to update funnel.");
  }
  return updated;
}

export async function deleteFunnelDefinition(siteId: string, funnelId: string) {
  const sql = getControlPlaneSql();

  await retryAfterEnsuringTables(
    async () => {
      const rows = (await sql`
        DELETE FROM analytics_funnel_definitions
        WHERE site_id = ${siteId}
          AND id = ${funnelId}
        RETURNING id
      `) as Array<{ id: string }>;

      if (!rows.length) {
        throw new Error("Funnel not found.");
      }
    },
    "Funnel storage is not configured.",
  );
}

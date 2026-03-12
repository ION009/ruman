import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type { AlertCondition, AlertMetric, AlertPeriod, DashboardAlert, DashboardAlertInput } from "@/lib/dashboard/types";

type RawAlertRow = {
  id: string;
  site_id: string;
  name: string;
  metric: string;
  condition: string;
  threshold: number | string;
  period: string;
  webhook_url: string;
  enabled: boolean;
  created_at: string | Date;
  last_fired_at: string | Date | null;
};

function missingAlertsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_alerts");
}

async function ensureAlertsTable() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_alerts
    (
      id            text PRIMARY KEY,
      site_id       text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      name          text        NOT NULL,
      metric        text        NOT NULL,
      condition     text        NOT NULL,
      threshold     numeric     NOT NULL,
      period        text        NOT NULL,
      webhook_url   text        NOT NULL,
      enabled       boolean     NOT NULL DEFAULT TRUE,
      created_at    timestamptz NOT NULL DEFAULT now(),
      last_fired_at timestamptz,
      CONSTRAINT analytics_alerts_metric_check CHECK (metric IN ('pageviews', 'visitors', 'bounce_rate', 'rage_clicks')),
      CONSTRAINT analytics_alerts_condition_check CHECK (condition IN ('above', 'below')),
      CONSTRAINT analytics_alerts_period_check CHECK (period IN ('1h', '24h'))
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_alerts_site_idx
      ON analytics_alerts (site_id, created_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingAlertsTable(error)) {
      throw error;
    }
  }

  await ensureAlertsTable();

  try {
    return await run();
  } catch (error) {
    if (missingAlertsTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function normalizeAlertMetric(value: string): AlertMetric {
  switch (value) {
    case "visitors":
    case "bounce_rate":
    case "rage_clicks":
      return value;
    default:
      return "pageviews";
  }
}

function normalizeAlertCondition(value: string): AlertCondition {
  return value === "below" ? "below" : "above";
}

function normalizeAlertPeriod(value: string): AlertPeriod {
  return value === "1h" ? "1h" : "24h";
}

function normalizeAlertInput(input: DashboardAlertInput): DashboardAlertInput {
  const name = input.name.trim();
  const webhookUrl = input.webhookUrl.trim();
  if (!name) {
    throw new Error("Enter an alert name.");
  }
  if (!webhookUrl) {
    throw new Error("Enter a webhook URL.");
  }
  return {
    name,
    metric: normalizeAlertMetric(input.metric),
    condition: normalizeAlertCondition(input.condition),
    threshold: Number(input.threshold),
    period: normalizeAlertPeriod(input.period),
    webhookUrl,
    enabled: input.enabled ?? true,
  };
}

function buildAlert(row: RawAlertRow): DashboardAlert {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    metric: normalizeAlertMetric(row.metric),
    condition: normalizeAlertCondition(row.condition),
    threshold: Number(row.threshold),
    period: normalizeAlertPeriod(row.period),
    webhookUrl: row.webhook_url,
    enabled: Boolean(row.enabled),
    createdAt: new Date(row.created_at).toISOString(),
    lastFiredAt: row.last_fired_at ? new Date(row.last_fired_at).toISOString() : null,
  };
}

export async function listAlerts(siteId: string): Promise<DashboardAlert[]> {
  const sql = getControlPlaneSql();
  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT id, site_id, name, metric, condition, threshold, period, webhook_url, enabled, created_at, last_fired_at
          FROM analytics_alerts
          WHERE site_id = ${siteId}
          ORDER BY created_at DESC, id DESC
        `) as RawAlertRow[];
        return rows.map(buildAlert);
      },
      "Alert storage is not configured.",
    );
  } catch (error) {
    if (
      missingAlertsTable(error) ||
      (error instanceof Error && error.message === "Alert storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createAlert(siteId: string, input: DashboardAlertInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeAlertInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_alerts (id, site_id, name, metric, condition, threshold, period, webhook_url, enabled)
        VALUES (${randomUUID()}, ${siteId}, ${normalized.name}, ${normalized.metric}, ${normalized.condition}, ${normalized.threshold}, ${normalized.period}, ${normalized.webhookUrl}, ${normalized.enabled})
        RETURNING id, site_id, name, metric, condition, threshold, period, webhook_url, enabled, created_at, last_fired_at
      `) as RawAlertRow[],
    "Alert storage is not configured.",
  );
  return buildAlert(rows[0]);
}

export async function updateAlert(siteId: string, alertId: string, input: DashboardAlertInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeAlertInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        UPDATE analytics_alerts
        SET name = ${normalized.name},
            metric = ${normalized.metric},
            condition = ${normalized.condition},
            threshold = ${normalized.threshold},
            period = ${normalized.period},
            webhook_url = ${normalized.webhookUrl},
            enabled = ${normalized.enabled}
        WHERE id = ${alertId}
          AND site_id = ${siteId}
        RETURNING id, site_id, name, metric, condition, threshold, period, webhook_url, enabled, created_at, last_fired_at
      `) as RawAlertRow[],
    "Alert storage is not configured.",
  );
  if (!rows[0]) {
    throw new Error("Alert not found.");
  }
  return buildAlert(rows[0]);
}

export async function deleteAlert(siteId: string, alertId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        DELETE FROM analytics_alerts
        WHERE id = ${alertId}
          AND site_id = ${siteId}
      `;
    },
    "Alert storage is not configured.",
  );
}

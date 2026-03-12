import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type {
  DashboardReportConfig,
  DashboardReportConfigInput,
  DashboardReportDelivery,
  DashboardReportFrequency,
  DashboardReportSection,
  DashboardReportStatus,
} from "@/lib/dashboard/types";

type RawReportRow = {
  id: string;
  site_id: string;
  name: string;
  frequency: string;
  delivery_time: string;
  timezone: string;
  recipients: string;
  include_sections: string;
  compare_enabled: boolean;
  enabled: boolean;
  note: string | null;
  last_delivered_at: string | Date | null;
  last_delivery_status: string | null;
  last_delivery_error: string | null;
  last_delivery_attempt_at: string | Date | null;
  consecutive_failures: number | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type RawReportDeliveryRow = {
  id: string;
  report_id: string;
  site_id: string;
  status: string;
  subject: string;
  recipient_count: number;
  attempted_at: string | Date;
  delivered_at: string | Date | null;
  error_message: string | null;
  summary_json: unknown;
};

function missingReportsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_report_configs");
}

async function ensureReportsTable() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_report_configs
    (
      id                text PRIMARY KEY,
      site_id           text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      name              text        NOT NULL,
      frequency         text        NOT NULL,
      delivery_time     text        NOT NULL DEFAULT '08:00',
      timezone          text        NOT NULL DEFAULT 'UTC',
      recipients        text        NOT NULL,
      include_sections  text        NOT NULL,
      compare_enabled   boolean     NOT NULL DEFAULT TRUE,
      enabled           boolean     NOT NULL DEFAULT TRUE,
      note              text,
      last_delivered_at timestamptz,
      created_at        timestamptz NOT NULL DEFAULT now(),
      updated_at        timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_report_configs_frequency_check CHECK (frequency IN ('daily', 'weekly', 'monthly'))
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_report_configs_site_idx
      ON analytics_report_configs (site_id, created_at DESC)
  `;
  await sql`ALTER TABLE analytics_report_configs ADD COLUMN IF NOT EXISTS last_delivery_status text`;
  await sql`ALTER TABLE analytics_report_configs ADD COLUMN IF NOT EXISTS last_delivery_error text`;
  await sql`ALTER TABLE analytics_report_configs ADD COLUMN IF NOT EXISTS last_delivery_attempt_at timestamptz`;
  await sql`ALTER TABLE analytics_report_configs ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0`;
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_report_deliveries
    (
      id               text PRIMARY KEY,
      report_id        text        NOT NULL REFERENCES analytics_report_configs(id) ON DELETE CASCADE,
      site_id          text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      status           text        NOT NULL,
      subject          text        NOT NULL,
      recipient_count  integer     NOT NULL DEFAULT 0,
      attempted_at     timestamptz NOT NULL DEFAULT now(),
      delivered_at     timestamptz,
      error_message    text,
      summary_json     jsonb       NOT NULL DEFAULT '{}'::jsonb,
      created_at       timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_report_deliveries_status_check CHECK (status IN ('delivered', 'failed'))
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_report_deliveries_report_attempted_idx
      ON analytics_report_deliveries (report_id, attempted_at DESC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingReportsTable(error)) {
      throw error;
    }
  }

  await ensureReportsTable();

  try {
    return await run();
  } catch (error) {
    if (missingReportsTable(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function normalizeFrequency(value: string): DashboardReportFrequency {
  switch (value) {
    case "weekly":
    case "monthly":
      return value;
    default:
      return "daily";
  }
}

function normalizeSections(value: string[]): DashboardReportSection[] {
  const allowed: DashboardReportSection[] = [
    "overview",
    "realtime",
    "goals",
    "replays",
    "heatmaps",
    "insights",
    "errors",
  ];
  const normalized = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))]
    .filter((entry): entry is DashboardReportSection => allowed.includes(entry as DashboardReportSection));
  return normalized.length ? normalized : (["overview", "goals", "insights"] as DashboardReportSection[]);
}

function normalizeRecipients(value: string[]) {
  const recipients = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  if (!recipients.length) {
    throw new Error("Add at least one report recipient.");
  }
  return recipients;
}

function normalizeDeliveryTime(value: string) {
  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : "08:00";
}

function normalizeInput(input: DashboardReportConfigInput): DashboardReportConfigInput {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Enter a report name.");
  }

  return {
    name,
    frequency: normalizeFrequency(input.frequency),
    deliveryTime: normalizeDeliveryTime(input.deliveryTime),
    timezone: input.timezone.trim() || "UTC",
    recipients: normalizeRecipients(input.recipients),
    includeSections: normalizeSections(input.includeSections),
    compareEnabled: input.compareEnabled ?? true,
    enabled: input.enabled ?? true,
    note: input.note?.trim() || null,
  };
}

function serializeRecipients(recipients: string[]) {
  return recipients.join("\n");
}

function parseRecipients(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function serializeSections(sections: DashboardReportSection[]) {
  return sections.join(",");
}

function parseSections(value: string) {
  return normalizeSections(
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function buildStatus(
  enabled: boolean,
  lastDeliveryStatus: string | null,
  lastDeliveredAt: string | Date | null,
  consecutiveFailures: number | null,
): DashboardReportStatus {
  if (!enabled) {
    return "paused";
  }
  if ((consecutiveFailures ?? 0) > 0 && String(lastDeliveryStatus ?? "").toLowerCase() === "failed") {
    return "failed";
  }
  if (lastDeliveredAt && String(lastDeliveryStatus ?? "").toLowerCase() === "delivered") {
    return "delivered";
  }
  return "scheduled";
}

function parseSummaryJSON(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      return parseSummaryJSON(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildReport(row: RawReportRow): DashboardReportConfig {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    frequency: normalizeFrequency(row.frequency),
    deliveryTime: normalizeDeliveryTime(row.delivery_time),
    timezone: row.timezone || "UTC",
    recipients: parseRecipients(row.recipients),
    includeSections: parseSections(row.include_sections),
    compareEnabled: Boolean(row.compare_enabled),
    enabled: Boolean(row.enabled),
    status: buildStatus(Boolean(row.enabled), row.last_delivery_status, row.last_delivered_at, row.consecutive_failures),
    note: row.note,
    lastDeliveredAt: row.last_delivered_at ? new Date(row.last_delivered_at).toISOString() : null,
    deliveryHealth: {
      lastStatus:
        row.last_delivery_status === "delivered" || row.last_delivery_status === "failed"
          ? row.last_delivery_status
          : "pending",
      lastDeliveredAt: row.last_delivered_at ? new Date(row.last_delivered_at).toISOString() : null,
      lastAttemptedAt: row.last_delivery_attempt_at ? new Date(row.last_delivery_attempt_at).toISOString() : null,
      lastError: row.last_delivery_error,
      consecutiveFailures: row.consecutive_failures ?? 0,
    },
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function buildReportDelivery(row: RawReportDeliveryRow): DashboardReportDelivery {
  return {
    id: row.id,
    reportId: row.report_id,
    siteId: row.site_id,
    status: row.status === "failed" ? "failed" : "delivered",
    subject: row.subject,
    recipientCount: row.recipient_count,
    attemptedAt: new Date(row.attempted_at).toISOString(),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    errorMessage: row.error_message,
    summary: parseSummaryJSON(row.summary_json),
  };
}

export async function listReports(siteId: string): Promise<DashboardReportConfig[]> {
  const sql = getControlPlaneSql();
  try {
    return await retryAfterEnsuringTable(
      async () => {
        const rows = (await sql`
          SELECT id, site_id, name, frequency, delivery_time, timezone, recipients, include_sections,
                 compare_enabled, enabled, note, last_delivered_at, last_delivery_status, last_delivery_error,
                 last_delivery_attempt_at, consecutive_failures, created_at, updated_at
          FROM analytics_report_configs
          WHERE site_id = ${siteId}
          ORDER BY created_at DESC, id DESC
        `) as RawReportRow[];
        return rows.map(buildReport);
      },
      "Report storage is not configured.",
    );
  } catch (error) {
    if (
      missingReportsTable(error) ||
      (error instanceof Error && error.message === "Report storage is not configured.")
    ) {
      return [];
    }
    throw error;
  }
}

export async function createReport(siteId: string, input: DashboardReportConfigInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_report_configs
        (
          id, site_id, name, frequency, delivery_time, timezone, recipients, include_sections,
          compare_enabled, enabled, note
        )
        VALUES
        (
          ${randomUUID()}, ${siteId}, ${normalized.name}, ${normalized.frequency}, ${normalized.deliveryTime},
          ${normalized.timezone}, ${serializeRecipients(normalized.recipients)},
          ${serializeSections(normalized.includeSections)}, ${normalized.compareEnabled},
          ${normalized.enabled}, ${normalized.note}
        )
        RETURNING id, site_id, name, frequency, delivery_time, timezone, recipients, include_sections,
                  compare_enabled, enabled, note, last_delivered_at, last_delivery_status, last_delivery_error,
                  last_delivery_attempt_at, consecutive_failures, created_at, updated_at
      `) as RawReportRow[],
    "Report storage is not configured.",
  );
  return buildReport(rows[0]);
}

export async function updateReport(siteId: string, reportId: string, input: DashboardReportConfigInput) {
  const sql = getControlPlaneSql();
  const normalized = normalizeInput(input);
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        UPDATE analytics_report_configs
        SET name = ${normalized.name},
            frequency = ${normalized.frequency},
            delivery_time = ${normalized.deliveryTime},
            timezone = ${normalized.timezone},
            recipients = ${serializeRecipients(normalized.recipients)},
            include_sections = ${serializeSections(normalized.includeSections)},
            compare_enabled = ${normalized.compareEnabled},
            enabled = ${normalized.enabled},
            note = ${normalized.note},
            updated_at = NOW()
        WHERE id = ${reportId}
          AND site_id = ${siteId}
        RETURNING id, site_id, name, frequency, delivery_time, timezone, recipients, include_sections,
                  compare_enabled, enabled, note, last_delivered_at, last_delivery_status, last_delivery_error,
                  last_delivery_attempt_at, consecutive_failures, created_at, updated_at
      `) as RawReportRow[],
    "Report storage is not configured.",
  );
  if (!rows[0]) {
    throw new Error("Report not found.");
  }
  return buildReport(rows[0]);
}

export async function deleteReport(siteId: string, reportId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        DELETE FROM analytics_report_configs
        WHERE id = ${reportId}
          AND site_id = ${siteId}
      `;
    },
    "Report storage is not configured.",
  );
}

export async function listReportDeliveries(siteId: string, reportId: string): Promise<DashboardReportDelivery[]> {
  const sql = getControlPlaneSql();
  return retryAfterEnsuringTable(
    async () => {
      const rows = (await sql`
        SELECT id, report_id, site_id, status, subject, recipient_count, attempted_at, delivered_at, error_message, summary_json
        FROM analytics_report_deliveries
        WHERE site_id = ${siteId}
          AND report_id = ${reportId}
        ORDER BY attempted_at DESC, id DESC
        LIMIT 30
      `) as RawReportDeliveryRow[];
      return rows.map(buildReportDelivery);
    },
    "Report storage is not configured.",
  );
}

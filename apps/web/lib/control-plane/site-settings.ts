import type {
  ControlPlaneSiteImportDefaults,
  ControlPlaneSitePrivacySettings,
  ControlPlaneSiteRetentionSettings,
  ControlPlaneSiteSettings,
  ControlPlaneSiteTrackingSettings,
} from "@/lib/control-plane/types";
import { getControlPlaneSql } from "@/lib/control-plane/db";

type RawSiteSettingsRow = {
  block_bot_traffic_enabled: boolean | null;
  dom_snapshots_enabled: boolean | null;
  visitor_cookie_enabled: boolean | null;
  replay_mask_text_enabled: boolean | null;
  spa_tracking_enabled: boolean | null;
  error_tracking_enabled: boolean | null;
  performance_tracking_enabled: boolean | null;
  retention_events_days: number | null;
  retention_heatmap_days: number | null;
  retention_replay_days: number | null;
  retention_insights_days: number | null;
  import_default_mapping: unknown;
  import_default_timezone: string | null;
};

export type SiteSettingsUpdate = {
  tracking?: Partial<ControlPlaneSiteTrackingSettings>;
  retention?: Partial<ControlPlaneSiteRetentionSettings>;
  importDefaults?: Partial<ControlPlaneSiteImportDefaults>;
};

const DEFAULT_TRACKING_SETTINGS: ControlPlaneSiteTrackingSettings = {
  blockBotTrafficEnabled: true,
  domSnapshotsEnabled: false,
  visitorCookieEnabled: false,
  replayMaskTextEnabled: false,
  spaTrackingEnabled: true,
  errorTrackingEnabled: true,
  performanceTrackingEnabled: true,
};

const DEFAULT_RETENTION_SETTINGS: ControlPlaneSiteRetentionSettings = {
  eventsDays: null,
  heatmapDays: null,
  replayDays: null,
  insightsDays: null,
};

const DEFAULT_IMPORT_DEFAULTS: ControlPlaneSiteImportDefaults = {
  mapping: {},
  timezone: "UTC",
};

function missingSiteSettingsColumns(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    message.includes("analytics_site_settings") ||
    message.includes("block_bot_traffic_enabled") ||
    message.includes("dom_snapshots_enabled") ||
    message.includes("visitor_cookie_enabled") ||
    message.includes("replay_mask_text_enabled") ||
    message.includes("spa_tracking_enabled") ||
    message.includes("error_tracking_enabled") ||
    message.includes("performance_tracking_enabled") ||
    message.includes("retention_events_days") ||
    message.includes("retention_heatmap_days") ||
    message.includes("retention_replay_days") ||
    message.includes("retention_insights_days") ||
    message.includes("import_default_mapping") ||
    message.includes("import_default_timezone")
  );
}

async function ensureSiteSettingsColumns() {
  const sql = getControlPlaneSql();

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_site_settings
    (
      site_id                         text PRIMARY KEY REFERENCES analytics_sites (id) ON DELETE CASCADE,
      default_range                   text NOT NULL DEFAULT '7d',
      retention_note                  text,
      timezone                        text NOT NULL DEFAULT 'UTC',
      block_bot_traffic_enabled       boolean NOT NULL DEFAULT TRUE,
      dom_snapshots_enabled           boolean NOT NULL DEFAULT FALSE,
      visitor_cookie_enabled          boolean NOT NULL DEFAULT FALSE,
      replay_mask_text_enabled        boolean NOT NULL DEFAULT FALSE,
      spa_tracking_enabled            boolean NOT NULL DEFAULT TRUE,
      error_tracking_enabled          boolean NOT NULL DEFAULT TRUE,
      performance_tracking_enabled    boolean NOT NULL DEFAULT TRUE,
      retention_events_days           integer,
      retention_heatmap_days          integer,
      retention_replay_days           integer,
      retention_insights_days         integer,
      import_default_mapping          jsonb NOT NULL DEFAULT '{}'::jsonb,
      import_default_timezone         text NOT NULL DEFAULT 'UTC',
      created_at                      timestamptz NOT NULL DEFAULT now(),
      updated_at                      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_site_settings_range_check CHECK (default_range IN ('24h', '7d', '30d')),
      CONSTRAINT analytics_site_settings_retention_events_days_check CHECK (retention_events_days IS NULL OR retention_events_days BETWEEN 1 AND 3650),
      CONSTRAINT analytics_site_settings_retention_heatmap_days_check CHECK (retention_heatmap_days IS NULL OR retention_heatmap_days BETWEEN 1 AND 3650),
      CONSTRAINT analytics_site_settings_retention_replay_days_check CHECK (retention_replay_days IS NULL OR retention_replay_days BETWEEN 1 AND 3650),
      CONSTRAINT analytics_site_settings_retention_insights_days_check CHECK (retention_insights_days IS NULL OR retention_insights_days BETWEEN 1 AND 3650)
    )
  `;

  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS block_bot_traffic_enabled boolean NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS dom_snapshots_enabled boolean NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS visitor_cookie_enabled boolean NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS replay_mask_text_enabled boolean NOT NULL DEFAULT FALSE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS spa_tracking_enabled boolean NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS error_tracking_enabled boolean NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS performance_tracking_enabled boolean NOT NULL DEFAULT TRUE`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS retention_events_days integer`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS retention_heatmap_days integer`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS retention_replay_days integer`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS retention_insights_days integer`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS import_default_mapping jsonb NOT NULL DEFAULT '{}'::jsonb`;
  await sql`ALTER TABLE analytics_site_settings ADD COLUMN IF NOT EXISTS import_default_timezone text NOT NULL DEFAULT 'UTC'`;
}

async function retryAfterEnsuringColumns<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (!missingSiteSettingsColumns(error)) {
      throw error;
    }

    await ensureSiteSettingsColumns();
    return run();
  }
}

function normalizeRetentionValue(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.round(value);
  if (normalized < 1 || normalized > 3650) {
    throw new Error("Retention must be between 1 and 3650 days.");
  }
  return normalized;
}

function normalizeImportMapping(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      return normalizeImportMapping(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = typeof raw === "string" ? raw.trim() : "";
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    output[normalizedKey] = normalizedValue;
  }
  return output;
}

function normalizeImportDefaults(row?: RawSiteSettingsRow | null): ControlPlaneSiteImportDefaults {
  return {
    mapping: normalizeImportMapping(row?.import_default_mapping),
    timezone: row?.import_default_timezone?.trim() || DEFAULT_IMPORT_DEFAULTS.timezone,
  };
}

function normalizeTrackingSettings(row?: RawSiteSettingsRow | null): ControlPlaneSiteTrackingSettings {
  return {
    blockBotTrafficEnabled:
      typeof row?.block_bot_traffic_enabled === "boolean"
        ? row.block_bot_traffic_enabled
        : DEFAULT_TRACKING_SETTINGS.blockBotTrafficEnabled,
    domSnapshotsEnabled: Boolean(row?.dom_snapshots_enabled),
    visitorCookieEnabled: Boolean(row?.visitor_cookie_enabled),
    replayMaskTextEnabled: Boolean(row?.replay_mask_text_enabled),
    spaTrackingEnabled:
      typeof row?.spa_tracking_enabled === "boolean"
        ? row.spa_tracking_enabled
        : DEFAULT_TRACKING_SETTINGS.spaTrackingEnabled,
    errorTrackingEnabled:
      typeof row?.error_tracking_enabled === "boolean"
        ? row.error_tracking_enabled
        : DEFAULT_TRACKING_SETTINGS.errorTrackingEnabled,
    performanceTrackingEnabled:
      typeof row?.performance_tracking_enabled === "boolean"
        ? row.performance_tracking_enabled
        : DEFAULT_TRACKING_SETTINGS.performanceTrackingEnabled,
  };
}

function normalizeRetentionSettings(row?: RawSiteSettingsRow | null): ControlPlaneSiteRetentionSettings {
  return {
    eventsDays: normalizeRetentionValue(row?.retention_events_days),
    heatmapDays: normalizeRetentionValue(row?.retention_heatmap_days),
    replayDays: normalizeRetentionValue(row?.retention_replay_days),
    insightsDays: normalizeRetentionValue(row?.retention_insights_days),
  };
}

function normalizeSiteSettings(row?: RawSiteSettingsRow | null): ControlPlaneSiteSettings {
  return {
    tracking: normalizeTrackingSettings(row),
    retention: normalizeRetentionSettings(row),
    importDefaults: normalizeImportDefaults(row),
  };
}

async function upsertEmptySiteSettingsRow(siteId: string) {
  const sql = getControlPlaneSql();
  await sql`
    INSERT INTO analytics_site_settings (site_id)
    VALUES (${siteId})
    ON CONFLICT (site_id) DO NOTHING
  `;
}

export async function getSiteSettings(siteId: string): Promise<ControlPlaneSiteSettings> {
  const sql = getControlPlaneSql();

  return retryAfterEnsuringColumns(async () => {
    await upsertEmptySiteSettingsRow(siteId);

    const rows = (await sql`
      SELECT
        block_bot_traffic_enabled,
        dom_snapshots_enabled,
        visitor_cookie_enabled,
        replay_mask_text_enabled,
        spa_tracking_enabled,
        error_tracking_enabled,
        performance_tracking_enabled,
        retention_events_days,
        retention_heatmap_days,
        retention_replay_days,
        retention_insights_days,
        import_default_mapping,
        import_default_timezone
      FROM analytics_site_settings
      WHERE site_id = ${siteId}
      LIMIT 1
    `) as RawSiteSettingsRow[];

    return normalizeSiteSettings(rows[0]);
  }).catch((error) => {
    const raw = error as { code?: unknown; message?: unknown } | null;
    const code = String(raw?.code ?? "");
    const message = String(raw?.message ?? "").toLowerCase();
    if (code === "23503" || message.includes("analytics_sites")) {
      return {
        tracking: { ...DEFAULT_TRACKING_SETTINGS },
        retention: { ...DEFAULT_RETENTION_SETTINGS },
        importDefaults: { ...DEFAULT_IMPORT_DEFAULTS },
      };
    }
    throw error;
  });
}

export async function getSitePrivacySettings(siteId: string): Promise<ControlPlaneSitePrivacySettings> {
  const settings = await getSiteSettings(siteId);
  return {
    domSnapshotsEnabled: settings.tracking.domSnapshotsEnabled,
    visitorCookieEnabled: settings.tracking.visitorCookieEnabled,
  };
}

export async function updateSiteSettings(siteId: string, input: SiteSettingsUpdate): Promise<ControlPlaneSiteSettings> {
  const sql = getControlPlaneSql();
  const current = await getSiteSettings(siteId);

  const nextTracking: ControlPlaneSiteTrackingSettings = {
    blockBotTrafficEnabled:
      typeof input.tracking?.blockBotTrafficEnabled === "boolean"
        ? input.tracking.blockBotTrafficEnabled
        : current.tracking.blockBotTrafficEnabled,
    domSnapshotsEnabled:
      typeof input.tracking?.domSnapshotsEnabled === "boolean"
        ? input.tracking.domSnapshotsEnabled
        : current.tracking.domSnapshotsEnabled,
    visitorCookieEnabled:
      typeof input.tracking?.visitorCookieEnabled === "boolean"
        ? input.tracking.visitorCookieEnabled
        : current.tracking.visitorCookieEnabled,
    replayMaskTextEnabled:
      typeof input.tracking?.replayMaskTextEnabled === "boolean"
        ? input.tracking.replayMaskTextEnabled
        : current.tracking.replayMaskTextEnabled,
    spaTrackingEnabled:
      typeof input.tracking?.spaTrackingEnabled === "boolean"
        ? input.tracking.spaTrackingEnabled
        : current.tracking.spaTrackingEnabled,
    errorTrackingEnabled:
      typeof input.tracking?.errorTrackingEnabled === "boolean"
        ? input.tracking.errorTrackingEnabled
        : current.tracking.errorTrackingEnabled,
    performanceTrackingEnabled:
      typeof input.tracking?.performanceTrackingEnabled === "boolean"
        ? input.tracking.performanceTrackingEnabled
        : current.tracking.performanceTrackingEnabled,
  };

  const nextRetention: ControlPlaneSiteRetentionSettings = {
    eventsDays:
      Object.prototype.hasOwnProperty.call(input.retention ?? {}, "eventsDays")
        ? normalizeRetentionValue(input.retention?.eventsDays ?? null)
        : current.retention.eventsDays,
    heatmapDays:
      Object.prototype.hasOwnProperty.call(input.retention ?? {}, "heatmapDays")
        ? normalizeRetentionValue(input.retention?.heatmapDays ?? null)
        : current.retention.heatmapDays,
    replayDays:
      Object.prototype.hasOwnProperty.call(input.retention ?? {}, "replayDays")
        ? normalizeRetentionValue(input.retention?.replayDays ?? null)
        : current.retention.replayDays,
    insightsDays:
      Object.prototype.hasOwnProperty.call(input.retention ?? {}, "insightsDays")
        ? normalizeRetentionValue(input.retention?.insightsDays ?? null)
        : current.retention.insightsDays,
  };

  const nextImportDefaults: ControlPlaneSiteImportDefaults = {
    mapping:
      Object.prototype.hasOwnProperty.call(input.importDefaults ?? {}, "mapping")
        ? normalizeImportMapping(input.importDefaults?.mapping)
        : current.importDefaults.mapping,
    timezone:
      typeof input.importDefaults?.timezone === "string" && input.importDefaults.timezone.trim()
        ? input.importDefaults.timezone.trim()
        : current.importDefaults.timezone,
  };

  return retryAfterEnsuringColumns(async () => {
    const rows = (await sql`
      INSERT INTO analytics_site_settings
      (
        site_id,
        block_bot_traffic_enabled,
        dom_snapshots_enabled,
        visitor_cookie_enabled,
        replay_mask_text_enabled,
        spa_tracking_enabled,
        error_tracking_enabled,
        performance_tracking_enabled,
        retention_events_days,
        retention_heatmap_days,
        retention_replay_days,
        retention_insights_days,
        import_default_mapping,
        import_default_timezone,
        updated_at
      )
      VALUES
      (
        ${siteId},
        ${nextTracking.blockBotTrafficEnabled},
        ${nextTracking.domSnapshotsEnabled},
        ${nextTracking.visitorCookieEnabled},
        ${nextTracking.replayMaskTextEnabled},
        ${nextTracking.spaTrackingEnabled},
        ${nextTracking.errorTrackingEnabled},
        ${nextTracking.performanceTrackingEnabled},
        ${nextRetention.eventsDays},
        ${nextRetention.heatmapDays},
        ${nextRetention.replayDays},
        ${nextRetention.insightsDays},
        ${JSON.stringify(nextImportDefaults.mapping)},
        ${nextImportDefaults.timezone},
        NOW()
      )
      ON CONFLICT (site_id) DO UPDATE
      SET
        block_bot_traffic_enabled = EXCLUDED.block_bot_traffic_enabled,
        dom_snapshots_enabled = EXCLUDED.dom_snapshots_enabled,
        visitor_cookie_enabled = EXCLUDED.visitor_cookie_enabled,
        replay_mask_text_enabled = EXCLUDED.replay_mask_text_enabled,
        spa_tracking_enabled = EXCLUDED.spa_tracking_enabled,
        error_tracking_enabled = EXCLUDED.error_tracking_enabled,
        performance_tracking_enabled = EXCLUDED.performance_tracking_enabled,
        retention_events_days = EXCLUDED.retention_events_days,
        retention_heatmap_days = EXCLUDED.retention_heatmap_days,
        retention_replay_days = EXCLUDED.retention_replay_days,
        retention_insights_days = EXCLUDED.retention_insights_days,
        import_default_mapping = EXCLUDED.import_default_mapping,
        import_default_timezone = EXCLUDED.import_default_timezone,
        updated_at = NOW()
      RETURNING
        block_bot_traffic_enabled,
        dom_snapshots_enabled,
        visitor_cookie_enabled,
        replay_mask_text_enabled,
        spa_tracking_enabled,
        error_tracking_enabled,
        performance_tracking_enabled,
        retention_events_days,
        retention_heatmap_days,
        retention_replay_days,
        retention_insights_days,
        import_default_mapping,
        import_default_timezone
    `) as RawSiteSettingsRow[];

    return normalizeSiteSettings(rows[0]);
  });
}

export async function updateSitePrivacySettings(
  siteId: string,
  input: Partial<ControlPlaneSitePrivacySettings>,
): Promise<ControlPlaneSitePrivacySettings> {
  const settings = await updateSiteSettings(siteId, {
    tracking: {
      domSnapshotsEnabled: input.domSnapshotsEnabled,
      visitorCookieEnabled: input.visitorCookieEnabled,
    },
  });
  return {
    domSnapshotsEnabled: settings.tracking.domSnapshotsEnabled,
    visitorCookieEnabled: settings.tracking.visitorCookieEnabled,
  };
}

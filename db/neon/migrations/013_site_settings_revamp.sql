BEGIN;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS block_bot_traffic_enabled boolean NOT NULL DEFAULT TRUE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS spa_tracking_enabled boolean NOT NULL DEFAULT TRUE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS error_tracking_enabled boolean NOT NULL DEFAULT TRUE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS performance_tracking_enabled boolean NOT NULL DEFAULT TRUE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS replay_mask_text_enabled boolean NOT NULL DEFAULT FALSE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS retention_events_days integer;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS retention_heatmap_days integer;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS retention_replay_days integer;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS retention_insights_days integer;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS import_default_mapping jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS import_default_timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE analytics_site_settings
    DROP CONSTRAINT IF EXISTS analytics_site_settings_retention_events_days_check;

ALTER TABLE analytics_site_settings
    ADD CONSTRAINT analytics_site_settings_retention_events_days_check
        CHECK (retention_events_days IS NULL OR retention_events_days BETWEEN 1 AND 3650);

ALTER TABLE analytics_site_settings
    DROP CONSTRAINT IF EXISTS analytics_site_settings_retention_heatmap_days_check;

ALTER TABLE analytics_site_settings
    ADD CONSTRAINT analytics_site_settings_retention_heatmap_days_check
        CHECK (retention_heatmap_days IS NULL OR retention_heatmap_days BETWEEN 1 AND 3650);

ALTER TABLE analytics_site_settings
    DROP CONSTRAINT IF EXISTS analytics_site_settings_retention_replay_days_check;

ALTER TABLE analytics_site_settings
    ADD CONSTRAINT analytics_site_settings_retention_replay_days_check
        CHECK (retention_replay_days IS NULL OR retention_replay_days BETWEEN 1 AND 3650);

ALTER TABLE analytics_site_settings
    DROP CONSTRAINT IF EXISTS analytics_site_settings_retention_insights_days_check;

ALTER TABLE analytics_site_settings
    ADD CONSTRAINT analytics_site_settings_retention_insights_days_check
        CHECK (retention_insights_days IS NULL OR retention_insights_days BETWEEN 1 AND 3650);

CREATE TABLE IF NOT EXISTS analytics_import_jobs
(
    id                  text PRIMARY KEY,
    site_id             text NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    created_by_user_id  text REFERENCES app_users (id) ON DELETE SET NULL,
    platform            text NOT NULL,
    status              text NOT NULL DEFAULT 'queued',
    phase               text NOT NULL DEFAULT 'queued',
    source_file_name    text NOT NULL,
    source_content_type text,
    source_size_bytes   bigint NOT NULL DEFAULT 0,
    mapping_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
    summary_json        jsonb NOT NULL DEFAULT '{}'::jsonb,
    progress_percent    integer NOT NULL DEFAULT 0,
    processed_rows      integer NOT NULL DEFAULT 0,
    imported_rows       integer NOT NULL DEFAULT 0,
    invalid_rows        integer NOT NULL DEFAULT 0,
    error_message       text,
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_import_jobs_platform_check CHECK (
        platform IN (
            'google-analytics',
            'plausible',
            'umami',
            'simple-analytics',
            'matomo',
            'fathom',
            'custom'
        )
    ),
    CONSTRAINT analytics_import_jobs_status_check CHECK (
        status IN ('queued', 'processing', 'completed', 'failed')
    ),
    CONSTRAINT analytics_import_jobs_phase_check CHECK (
        phase IN ('queued', 'parsing', 'mapping', 'validating', 'importing', 'finalizing', 'completed', 'failed')
    ),
    CONSTRAINT analytics_import_jobs_progress_percent_check CHECK (
        progress_percent BETWEEN 0 AND 100
    )
);

CREATE INDEX IF NOT EXISTS analytics_import_jobs_site_created_idx
    ON analytics_import_jobs (site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analytics_import_jobs_status_idx
    ON analytics_import_jobs (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_import_job_errors
(
    job_id       text NOT NULL REFERENCES analytics_import_jobs (id) ON DELETE CASCADE,
    row_number   integer NOT NULL,
    code         text NOT NULL,
    message      text NOT NULL,
    raw_record   jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, row_number, code)
);

COMMIT;

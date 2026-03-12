BEGIN;

CREATE TABLE IF NOT EXISTS analytics_report_configs
(
    id                text PRIMARY KEY,
    site_id           text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    name              text        NOT NULL,
    frequency         text        NOT NULL DEFAULT 'daily',
    delivery_time     text        NOT NULL DEFAULT '08:00',
    timezone          text        NOT NULL DEFAULT 'UTC',
    recipients        text        NOT NULL DEFAULT '',
    include_sections  text        NOT NULL DEFAULT 'overview',
    compare_enabled   boolean     NOT NULL DEFAULT FALSE,
    enabled           boolean     NOT NULL DEFAULT TRUE,
    note              text,
    last_delivered_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_report_configs_frequency_check CHECK (
        frequency IN ('daily', 'weekly', 'monthly')
    )
);

CREATE INDEX IF NOT EXISTS analytics_report_configs_site_idx
    ON analytics_report_configs (site_id);

CREATE INDEX IF NOT EXISTS analytics_report_configs_enabled_idx
    ON analytics_report_configs (enabled) WHERE enabled = TRUE;

COMMIT;

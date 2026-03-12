BEGIN;

ALTER TABLE analytics_report_configs
    ADD COLUMN IF NOT EXISTS last_delivery_status text;

ALTER TABLE analytics_report_configs
    ADD COLUMN IF NOT EXISTS last_delivery_error text;

ALTER TABLE analytics_report_configs
    ADD COLUMN IF NOT EXISTS last_delivery_attempt_at timestamptz;

ALTER TABLE analytics_report_configs
    ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS analytics_report_deliveries
(
    id               text PRIMARY KEY,
    report_id        text        NOT NULL REFERENCES analytics_report_configs (id) ON DELETE CASCADE,
    site_id          text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    status           text        NOT NULL,
    subject          text        NOT NULL,
    recipient_count  integer     NOT NULL DEFAULT 0,
    attempted_at     timestamptz NOT NULL DEFAULT now(),
    delivered_at     timestamptz,
    error_message    text,
    summary_json     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_report_deliveries_status_check CHECK (status IN ('delivered', 'failed'))
);

CREATE INDEX IF NOT EXISTS analytics_report_deliveries_report_attempted_idx
    ON analytics_report_deliveries (report_id, attempted_at DESC);

CREATE INDEX IF NOT EXISTS analytics_report_deliveries_site_attempted_idx
    ON analytics_report_deliveries (site_id, attempted_at DESC);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_alerts
(
    id            text PRIMARY KEY,
    site_id       text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
    name          text        NOT NULL,
    metric        text        NOT NULL,
    condition     text        NOT NULL,
    threshold     numeric     NOT NULL,
    period        text        NOT NULL,
    webhook_url   text        NOT NULL DEFAULT '',
    enabled       boolean     NOT NULL DEFAULT TRUE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    last_fired_at timestamptz,
    CONSTRAINT analytics_alerts_metric_check CHECK (metric IN ('pageviews', 'visitors', 'bounce_rate', 'rage_clicks')),
    CONSTRAINT analytics_alerts_condition_check CHECK (condition IN ('above', 'below')),
    CONSTRAINT analytics_alerts_period_check CHECK (period IN ('1h', '24h'))
);

ALTER TABLE analytics_alerts
    ADD COLUMN IF NOT EXISTS webhook_url text NOT NULL DEFAULT '';

ALTER TABLE analytics_alerts
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS analytics_alerts_site_idx
    ON analytics_alerts (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_alert_channels
(
    id                   text PRIMARY KEY,
    alert_id             text        NOT NULL REFERENCES analytics_alerts(id) ON DELETE CASCADE,
    channel_type         text        NOT NULL,
    name                 text        NOT NULL,
    config_json          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    enabled              boolean     NOT NULL DEFAULT TRUE,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    last_delivery_at     timestamptz,
    last_delivery_status text        NOT NULL DEFAULT 'pending',
    last_error           text,
    CONSTRAINT analytics_alert_channels_type_check CHECK (channel_type IN ('email', 'slack', 'webhook')),
    CONSTRAINT analytics_alert_channels_status_check CHECK (last_delivery_status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS analytics_alert_channels_alert_idx
    ON analytics_alert_channels (alert_id, created_at DESC);

CREATE TABLE IF NOT EXISTS analytics_alert_firings
(
    id              text PRIMARY KEY,
    alert_id        text        NOT NULL REFERENCES analytics_alerts(id) ON DELETE CASCADE,
    fired_at        timestamptz NOT NULL DEFAULT now(),
    metric_value    numeric     NOT NULL,
    threshold_value numeric     NOT NULL,
    condition       text        NOT NULL,
    period          text        NOT NULL,
    status          text        NOT NULL DEFAULT 'fired',
    CONSTRAINT analytics_alert_firings_status_check CHECK (status IN ('fired'))
);

CREATE INDEX IF NOT EXISTS analytics_alert_firings_alert_idx
    ON analytics_alert_firings (alert_id, fired_at DESC);

CREATE TABLE IF NOT EXISTS analytics_alert_delivery_attempts
(
    id            text PRIMARY KEY,
    firing_id      text        NOT NULL REFERENCES analytics_alert_firings(id) ON DELETE CASCADE,
    channel_id     text        NOT NULL REFERENCES analytics_alert_channels(id) ON DELETE CASCADE,
    channel_type   text        NOT NULL,
    status         text        NOT NULL,
    response_code  integer,
    error_message  text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    delivered_at   timestamptz,
    CONSTRAINT analytics_alert_delivery_attempts_status_check CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE INDEX IF NOT EXISTS analytics_alert_delivery_attempts_firing_idx
    ON analytics_alert_delivery_attempts (firing_id, created_at DESC);

COMMIT;

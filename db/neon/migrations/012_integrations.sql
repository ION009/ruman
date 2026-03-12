BEGIN;

CREATE TABLE IF NOT EXISTS analytics_integrations
(
    id               text PRIMARY KEY,
    site_id          text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
    family           text        NOT NULL,
    provider_key     text        NOT NULL,
    display_name     text        NOT NULL,
    status           text        NOT NULL DEFAULT 'disconnected',
    configured       boolean     NOT NULL DEFAULT FALSE,
    credentials_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
    validation_error text,
    last_verified_at timestamptz,
    last_sync_at     timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_integrations_family_check CHECK (family IN ('analytics', 'collaboration', 'developer')),
    CONSTRAINT analytics_integrations_status_check CHECK (status IN ('disconnected', 'connected', 'degraded', 'coming-soon')),
    CONSTRAINT analytics_integrations_unique_provider UNIQUE (site_id, provider_key)
);

CREATE INDEX IF NOT EXISTS analytics_integrations_site_idx
    ON analytics_integrations (site_id, created_at DESC);

COMMIT;

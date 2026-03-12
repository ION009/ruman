BEGIN;

CREATE TABLE IF NOT EXISTS analytics_neo_action_logs
(
    id               text PRIMARY KEY,
    site_id          text REFERENCES analytics_sites (id) ON DELETE CASCADE,
    actor_user_id    text REFERENCES app_users (id) ON DELETE SET NULL,
    action_key       text NOT NULL,
    action_type      text NOT NULL,
    action_level     text NOT NULL,
    target_type      text NOT NULL,
    target_id        text,
    status           text NOT NULL DEFAULT 'completed',
    summary          text NOT NULL,
    request_payload  jsonb NOT NULL DEFAULT '{}'::jsonb,
    result_payload   jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_neo_action_logs_level_check CHECK (action_level IN ('read-only', 'safe-write', 'restricted', 'forbidden')),
    CONSTRAINT analytics_neo_action_logs_status_check CHECK (status IN ('completed', 'queued', 'pending_confirmation', 'blocked', 'failed'))
);

CREATE INDEX IF NOT EXISTS analytics_neo_action_logs_site_idx
    ON analytics_neo_action_logs (site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS analytics_neo_action_logs_actor_idx
    ON analytics_neo_action_logs (actor_user_id, created_at DESC);

COMMIT;

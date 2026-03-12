BEGIN;

CREATE TABLE IF NOT EXISTS app_users
(
    id            text PRIMARY KEY,
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    full_name     text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_users_email_lowercase CHECK (email = lower(email))
);

CREATE TABLE IF NOT EXISTS app_sessions
(
    id          text PRIMARY KEY,
    user_id     text NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
    secret_hash text NOT NULL,
    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx
    ON app_sessions (user_id);

CREATE INDEX IF NOT EXISTS app_sessions_expires_at_idx
    ON app_sessions (expires_at);

CREATE TABLE IF NOT EXISTS analytics_sites
(
    id            text PRIMARY KEY,
    name          text NOT NULL,
    slug          text NOT NULL UNIQUE,
    owner_user_id text NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
    is_active     boolean NOT NULL DEFAULT TRUE,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_sites_owner_idx
    ON analytics_sites (owner_user_id);

CREATE INDEX IF NOT EXISTS analytics_sites_active_idx
    ON analytics_sites (is_active, created_at);

CREATE TABLE IF NOT EXISTS analytics_site_memberships
(
    site_id    text NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    user_id    text NOT NULL REFERENCES app_users (id) ON DELETE CASCADE,
    role       text NOT NULL DEFAULT 'viewer',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, user_id),
    CONSTRAINT analytics_site_memberships_role_check CHECK (role IN ('owner', 'admin', 'analyst', 'viewer'))
);

CREATE INDEX IF NOT EXISTS analytics_site_memberships_user_idx
    ON analytics_site_memberships (user_id, created_at);

CREATE TABLE IF NOT EXISTS analytics_site_origins
(
    site_id    text NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    origin     text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, origin)
);

CREATE TABLE IF NOT EXISTS analytics_site_settings
(
    site_id         text PRIMARY KEY REFERENCES analytics_sites (id) ON DELETE CASCADE,
    default_range   text NOT NULL DEFAULT '7d',
    retention_note  text,
    timezone        text NOT NULL DEFAULT 'UTC',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_site_settings_range_check CHECK (default_range IN ('24h', '7d', '30d'))
);

COMMIT;

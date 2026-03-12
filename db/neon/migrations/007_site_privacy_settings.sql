BEGIN;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS dom_snapshots_enabled boolean NOT NULL DEFAULT FALSE;

ALTER TABLE analytics_site_settings
    ADD COLUMN IF NOT EXISTS visitor_cookie_enabled boolean NOT NULL DEFAULT FALSE;

COMMIT;

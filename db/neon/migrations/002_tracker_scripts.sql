BEGIN;

CREATE TABLE IF NOT EXISTS analytics_site_scripts
(
    site_id          text PRIMARY KEY REFERENCES analytics_sites (id) ON DELETE CASCADE,
    install_origin   text NOT NULL,
    collector_origin text NOT NULL,
    script_src       text NOT NULL,
    script_tag       text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS analytics_site_scripts_updated_idx
    ON analytics_site_scripts (updated_at DESC);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_site_pages
(
    site_id       text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    path          text        NOT NULL,
    source        text        NOT NULL DEFAULT 'sitemap',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, path),
    CONSTRAINT analytics_site_pages_source_check CHECK (source IN ('sitemap', 'tracker', 'manual'))
);

CREATE INDEX IF NOT EXISTS analytics_site_pages_last_seen_idx
    ON analytics_site_pages (site_id, last_seen_at DESC);

COMMIT;

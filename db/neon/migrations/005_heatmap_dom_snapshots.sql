BEGIN;

CREATE TABLE IF NOT EXISTS analytics_heatmap_dom_snapshots
(
    site_id          text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    path             text        NOT NULL,
    page_url         text        NOT NULL DEFAULT '',
    page_title       text        NOT NULL DEFAULT '',
    snapshot_html    text        NOT NULL,
    snapshot_css     text        NOT NULL DEFAULT '',
    viewport_width   integer     NOT NULL DEFAULT 0,
    viewport_height  integer     NOT NULL DEFAULT 0,
    document_width   integer     NOT NULL DEFAULT 0,
    document_height  integer     NOT NULL DEFAULT 0,
    content_hash     text        NOT NULL,
    captured_at      timestamptz NOT NULL DEFAULT now(),
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, path)
);

CREATE INDEX IF NOT EXISTS analytics_heatmap_dom_snapshots_updated_idx
    ON analytics_heatmap_dom_snapshots (site_id, updated_at DESC);

COMMIT;

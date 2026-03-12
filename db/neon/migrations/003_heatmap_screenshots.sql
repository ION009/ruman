BEGIN;

-- Stores a per-path reference screenshot (either a remote URL or a data URL)
-- used as the background layer for heatmap overlays.
CREATE TABLE IF NOT EXISTS analytics_heatmap_screenshots
(
    site_id    text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    path       text        NOT NULL,
    screenshot text        NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (site_id, path)
);

CREATE INDEX IF NOT EXISTS analytics_heatmap_screenshots_updated_idx
    ON analytics_heatmap_screenshots (updated_at DESC);

COMMIT;


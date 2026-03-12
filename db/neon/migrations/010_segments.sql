BEGIN;

CREATE TABLE IF NOT EXISTS analytics_segments
(
    id              text PRIMARY KEY,
    site_id         text NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    name            text NOT NULL,
    description     text,
    logic           text NOT NULL DEFAULT 'and',
    conditions_json jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_segments_logic_check CHECK (logic IN ('and', 'or'))
);

CREATE INDEX IF NOT EXISTS analytics_segments_site_idx
    ON analytics_segments (site_id, created_at DESC);

COMMIT;

BEGIN;

CREATE TABLE IF NOT EXISTS analytics_funnel_definitions
(
    id             text PRIMARY KEY,
    site_id        text        NOT NULL REFERENCES analytics_sites (id) ON DELETE CASCADE,
    name           text        NOT NULL,
    count_mode     text        NOT NULL DEFAULT 'visitors',
    window_minutes integer     NOT NULL DEFAULT 30,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT analytics_funnel_definitions_count_mode_check CHECK (count_mode IN ('sessions', 'visitors')),
    CONSTRAINT analytics_funnel_definitions_window_check CHECK (window_minutes BETWEEN 1 AND 1440)
);

CREATE INDEX IF NOT EXISTS analytics_funnel_definitions_site_idx
    ON analytics_funnel_definitions (site_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS analytics_funnel_steps
(
    funnel_id     text        NOT NULL REFERENCES analytics_funnel_definitions (id) ON DELETE CASCADE,
    step_index    integer     NOT NULL,
    label         text        NOT NULL,
    kind          text        NOT NULL,
    match_type    text        NOT NULL,
    value         text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (funnel_id, step_index),
    CONSTRAINT analytics_funnel_steps_kind_check CHECK (kind IN ('page', 'event')),
    CONSTRAINT analytics_funnel_steps_match_type_check CHECK (match_type IN ('exact', 'prefix'))
);

COMMIT;

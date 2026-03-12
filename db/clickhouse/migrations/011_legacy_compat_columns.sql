ALTER TABLE events
    ADD COLUMN IF NOT EXISTS ts DateTime64(3)
        MATERIALIZED timestamp;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS sid String
        MATERIALIZED if(length(session_id) > 0, session_id, visitor_id);

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS vid String
        MATERIALIZED if(length(visitor_id) > 0, visitor_id, sid);

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS e LowCardinality(String)
        MATERIALIZED if(type = 'pageview', 'pageview', if(length(name) > 0, name, 'event'));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS x Nullable(Float32)
        MATERIALIZED toFloat32OrNull(nullIf(props['x'], ''));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS y Nullable(Float32)
        MATERIALIZED toFloat32OrNull(nullIf(props['y'], ''));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS sel Nullable(String)
        MATERIALIZED nullIf(props['sel'], '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS depth Nullable(UInt8)
        MATERIALIZED toUInt8OrNull(nullIf(props['depth'], ''));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS meta String
        MATERIALIZED ifNull(nullIf(props['meta'], ''), '{}');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS viewport_w UInt16
        MATERIALIZED viewport_width;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS viewport_h UInt16
        MATERIALIZED viewport_height;

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_rage UInt8
        MATERIALIZED toUInt8OrZero(nullIf(props['rg'], ''));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_dead UInt8
        MATERIALIZED toUInt8OrZero(nullIf(props['dg'], ''));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_error UInt8
        MATERIALIZED toUInt8OrZero(nullIf(props['eg'], ''));

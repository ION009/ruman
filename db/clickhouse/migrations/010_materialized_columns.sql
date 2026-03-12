ALTER TABLE events
    ADD COLUMN IF NOT EXISTS vid String
        MATERIALIZED if(length(JSONExtractString(meta, 'vid')) > 0, JSONExtractString(meta, 'vid'), '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS referrer String
        MATERIALIZED if(length(JSONExtractString(meta, 'r')) > 0, JSONExtractString(meta, 'r'), '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS viewport_w UInt16
        MATERIALIZED toUInt16(greatest(JSONExtractInt(meta, 'vw'), toInt64(0)));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS viewport_h UInt16
        MATERIALIZED toUInt16(greatest(JSONExtractInt(meta, 'vh'), toInt64(0)));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS device_type LowCardinality(String)
        MATERIALIZED if(length(JSONExtractString(meta, 'dt')) > 0, JSONExtractString(meta, 'dt'), '');

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_rage UInt8
        MATERIALIZED toUInt8(JSONExtractBool(meta, 'rg'));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_dead UInt8
        MATERIALIZED toUInt8(JSONExtractBool(meta, 'dg'));

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS is_error UInt8
        MATERIALIZED toUInt8(JSONExtractBool(meta, 'eg'));

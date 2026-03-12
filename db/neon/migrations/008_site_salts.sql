BEGIN;

ALTER TABLE analytics_sites
    ADD COLUMN IF NOT EXISTS salt text;

UPDATE analytics_sites
SET salt = md5(id || ':' || clock_timestamp()::text || ':' || random()::text)
WHERE salt IS NULL OR salt = '';

ALTER TABLE analytics_sites
    ALTER COLUMN salt SET NOT NULL;

COMMIT;

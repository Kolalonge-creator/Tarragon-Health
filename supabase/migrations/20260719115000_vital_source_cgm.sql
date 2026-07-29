-- Add 'cgm' to vital_source so continuous-glucose-monitor readings are
-- distinguishable from spot device readings while still living in the single
-- vitals_readings table (no parallel table). Own migration: Postgres forbids
-- using a freshly-added enum value in the same transaction that adds it, and
-- the CGM ingestion migration/route reference it.
alter type public.vital_source add value if not exists 'cgm';

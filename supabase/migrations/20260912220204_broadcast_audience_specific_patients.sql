-- Broadcasts: allow targeting a hand-picked list of specific patients (founder
-- ask, admin_search_patients picker). Postgres forbids using a new enum value
-- in the same transaction that adds it, so this is its own migration; the
-- private.broadcast_targets() leg and admin_search_patients() RPC that
-- consume this value land in the next migration.
alter type public.broadcast_audience add value 'specific_patients';

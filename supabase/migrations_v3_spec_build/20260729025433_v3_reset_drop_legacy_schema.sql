-- Tarragon Health v3 rebuild: full reset of the legacy chronic-care platform schema.
-- Founder-approved 2026-07-29: pre-launch, zero real users/revenue confirmed live before this ran.
-- Old apps/web + apps/mobile are frozen (not deleted) as reference; this DB is rebuilt for the v3
-- cardiometabolic Control/Concierge platform per docs/tarragon-build-spec-v3.md.
drop schema if exists public cascade;
drop schema if exists private cascade;

create schema public;
grant usage on schema public to postgres, anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;

create schema private;
grant usage on schema private to postgres, service_role;
-- private schema is never exposed to anon/authenticated directly; only via SECURITY DEFINER functions.


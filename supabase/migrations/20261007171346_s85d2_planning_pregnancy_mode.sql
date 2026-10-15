-- S85 D2 (OQ-12, founder decision 2026-09-30): the fertile window is hidden by default and shown only when the
-- person turns on an opt-in "Planning a pregnancy" mode.
--
-- This stores that one switch. It is a column on the existing reproductive_health_profiles table, not a new table:
-- that table already carries the category-scoped access model (a caregiver needs an explicit 'reproductive_health'
-- category grant, writes also need 'manage', the adolescent guardian gate sits on top, break-glass never applies).
-- A column inherits row policy, so no policy is copied from a sibling and none is rewritten here. The proof script
-- packages/db/tests/s85d2_planning_pregnancy_mode.sql shows a caregiver without the category is refused.
--
-- Rows: default false, so every existing row and every person with no row yet is "off". No data conversion is needed.
-- Grants: authenticated already holds select, insert, update on this table (20260724001210); a column added later is
-- covered by the table-level grant. This migration changes no grant and no policy. (A fresh replay shows anon holds a
-- table-level grant here that predates this change; RLS still gives anon zero rows, which the proof checks.)
--
-- NOT applied to production by this change. The apps read the column defensively and treat a missing column as off.

alter table public.reproductive_health_profiles
  add column if not exists planning_pregnancy_mode boolean not null default false;

comment on column public.reproductive_health_profiles.planning_pregnancy_mode is
  'S85 D2 / OQ-12: opt-in "Planning a pregnancy" mode. Off by default. While off, no app screen shows the fertile window, estimated ovulation or temperature-based ovulation confirmation. While on, every such screen carries "Not contraception. This cannot prevent pregnancy." Category: reproductive_health (break-glass excluded).';

-- The migration is the test: the column exists, is boolean, not null, defaults to false, and no row was switched on.
do $$
declare
  v_type text;
  v_nullable text;
  v_default text;
  v_on bigint;
begin
  select data_type, is_nullable, column_default into v_type, v_nullable, v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'reproductive_health_profiles' and column_name = 'planning_pregnancy_mode';

  if v_type is distinct from 'boolean' or v_nullable is distinct from 'NO' or v_default is distinct from 'false' then
    raise exception 'FAIL: planning_pregnancy_mode must be boolean not null default false, got % / % / %', v_type, v_nullable, v_default;
  end if;

  select count(*) into v_on from public.reproductive_health_profiles where planning_pregnancy_mode;
  if v_on <> 0 then
    raise exception 'FAIL: % rows have planning pregnancy mode on straight after the migration', v_on;
  end if;
end $$;

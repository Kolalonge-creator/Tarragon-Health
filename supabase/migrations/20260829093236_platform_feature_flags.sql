-- Tarragon Health — platform_feature_flags
--
-- Reconstructed from the live schema on 2026-08-29: this migration was applied directly to
-- the koiplnmbgnqnbywhpjlf project (schema_migrations version 20260829093236) by another
-- session earlier the same day, but the originating commit was never found on main-dev or any
-- fetched branch — a case of the "live schema object with no local migration record" drift
-- pattern this codebase has hit before (see CLAUDE.md's standing engineering lessons). This
-- file is committed now so the table stops being invisible to `supabase db reset` and to
-- anyone reading migration history; its DDL was read back verbatim from the live catalogue
-- (pg_constraint/pg_trigger/pg_policies/information_schema.columns), not guessed.
--
-- A follow-up migration in this same PR (…_feature_flags_cohort_targeting_and_eval.sql) adds
-- the cohort-targeting columns and evaluation function this table was clearly scaffolded for
-- (its own permissions.description already said "target pilot, role or geographic cohorts")
-- but that hadn't been built yet — schema existed, nothing read it.

create type public.feature_flag_status as enum ('off', 'rollout', 'on', 'archived');

create table public.feature_flags (
  key              text primary key,
  label            text not null,
  description      text,
  category         text not null default 'general',
  status           public.feature_flag_status not null default 'off',
  rollout_percent  smallint not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint feature_flags_key_check check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  constraint feature_flags_rollout_percent_check check (rollout_percent >= 0 and rollout_percent <= 100)
);

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function private.set_updated_at();

-- Hard safety rail: no flag key touching a clinical-safety path can ever be created or
-- renamed onto, regardless of who holds feature_flags.manage — these must never be
-- switchable from an admin screen.
create or replace function private.reject_clinical_safety_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key ~ '(abnormal_result|screening_upgrade|emergency|red_flag|escalation_sla|category_upgrade)' then
    raise exception
      'Refusing feature flag "%": clinical-safety paths (abnormal screening results, emergency handling, red-flag detection, escalation SLAs) must never be switchable from an admin screen.',
      new.key;
  end if;
  return new;
end;
$$;

create trigger feature_flags_reject_clinical_safety
  before insert or update of key on public.feature_flags
  for each row execute function private.reject_clinical_safety_flag();

alter table public.feature_flags enable row level security;

create policy feature_flags_select on public.feature_flags
  for select to authenticated using (true);

create policy feature_flags_write on public.feature_flags
  for all to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'))
  with check (private.is_admin() or private.has_permission('feature_flags.manage'));

grant select, insert, update, delete on public.feature_flags to authenticated;

insert into public.permissions (key, label, category, description) values
  ('feature_flags.manage', 'Manage feature flags', 'Technical',
   'Turn platform features on or off and target pilot, role or geographic cohorts')
on conflict (key) do nothing;

insert into public.feature_flags (key, label, category, status, rollout_percent) values
  ('wearable_cloud_sync', 'Wearable cloud sync', 'patient', 'on', 0),
  ('mobile_health_bridge', 'Apple Health / Health Connect sync', 'mobile', 'off', 0),
  ('ops_console', 'Operations control centre', 'operations', 'on', 0),
  ('async_consult_booking', 'Async consult booking', 'patient', 'on', 0),
  ('region_waitlist_capture', 'Waitlist capture outside live regions', 'growth', 'on', 0)
on conflict (key) do nothing;

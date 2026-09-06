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
--
-- CORRECTION (2026-08-29, later same session): the first version of this reconstruction
-- captured feature_flags but missed its sibling feature_flag_rules table and the
-- is_feature_enabled()/my_feature_flags() functions — all three were part of the same
-- original, untraced migration, and their absence here broke `supabase db reset` (the
-- follow-up dedup migration in this PR references feature_flag_rules directly). All three
-- now included, read back the same way — verbatim from the live catalogue, not guessed.

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

create type public.feature_flag_rule_kind as enum ('profile', 'state', 'account_role', 'organisation');

create table public.feature_flag_rules (
  id         uuid primary key default gen_random_uuid(),
  flag_key   text not null references public.feature_flags (key) on delete cascade,
  kind       public.feature_flag_rule_kind not null,
  value      text not null,
  effect     text not null default 'allow',
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint feature_flag_rules_effect_check check (effect in ('allow', 'deny')),
  constraint feature_flag_rules_value_check check (length(btrim(value)) > 0),
  constraint feature_flag_rules_flag_key_kind_value_effect_key unique (flag_key, kind, value, effect)
);

alter table public.feature_flag_rules enable row level security;

create policy feature_flag_rules_select on public.feature_flag_rules
  for select to authenticated using (true);

create policy feature_flag_rules_write on public.feature_flag_rules
  for all to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'))
  with check (private.is_admin() or private.has_permission('feature_flags.manage'));

grant select, insert, update, delete on public.feature_flag_rules to authenticated;

-- Evaluation predicate: rollout status + cohort rules (deny always wins) + a deterministic
-- percentage bucket, hashing (flag || subject) so two flags at 10% don't cover the same 10%
-- of patients and a given patient's answer never flaps between requests.
create or replace function private.is_feature_enabled(p_flag text, p_profile_id uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag    public.feature_flags%rowtype;
  v_subject uuid := coalesce(p_profile_id, (select auth.uid()));
  v_state   text;
  v_role    public.user_role;
  v_org     uuid;
  v_bucket  smallint;
begin
  select * into v_flag from public.feature_flags where key = p_flag;

  if not found then
    return false;
  end if;

  if v_flag.status = 'on' then
    return true;
  end if;
  if v_flag.status in ('off', 'archived') then
    return false;
  end if;

  if v_subject is null then
    return false;
  end if;

  select p.state, p.role, p.organisation_id
    into v_state, v_role, v_org
  from public.profiles p
  where p.id = v_subject;

  if not found then
    return false;
  end if;

  if exists (
    select 1 from public.feature_flag_rules r
    where r.flag_key = p_flag
      and r.effect = 'deny'
      and (
        (r.kind = 'profile'      and r.value = v_subject::text)
        or (r.kind = 'state'        and v_state is not null and lower(r.value) = lower(v_state))
        or (r.kind = 'account_role' and r.value = v_role::text)
        or (r.kind = 'organisation' and v_org is not null and r.value = v_org::text)
      )
  ) then
    return false;
  end if;

  if exists (
    select 1 from public.feature_flag_rules r
    where r.flag_key = p_flag
      and r.effect = 'allow'
      and (
        (r.kind = 'profile'      and r.value = v_subject::text)
        or (r.kind = 'state'        and v_state is not null and lower(r.value) = lower(v_state))
        or (r.kind = 'account_role' and r.value = v_role::text)
        or (r.kind = 'organisation' and v_org is not null and r.value = v_org::text)
      )
  ) then
    return true;
  end if;

  if v_flag.rollout_percent = 0 then
    return false;
  end if;
  if v_flag.rollout_percent = 100 then
    return true;
  end if;

  v_bucket := (abs(pg_catalog.hashtext(p_flag || ':' || v_subject::text)) % 100)::smallint;
  return v_bucket < v_flag.rollout_percent;
end;
$$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role by default on a new SECURITY DEFINER
-- function, not via a direct grant — `revoke ... from anon` alone would not close it. See
-- feedback_supabase_anon_execute_gotcha memory; confirmed both functions are anon-false /
-- authenticated-true live, matching this.
revoke all on function private.is_feature_enabled(text, uuid) from public;
grant execute on function private.is_feature_enabled(text, uuid) to authenticated;

create or replace function public.my_feature_flags()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(f.key, private.is_feature_enabled(f.key, (select auth.uid()))),
    '{}'::jsonb
  )
  from public.feature_flags f
  where f.status <> 'archived'
    and (select auth.uid()) is not null;
$$;

revoke all on function public.my_feature_flags() from public;
grant execute on function public.my_feature_flags() to authenticated;

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

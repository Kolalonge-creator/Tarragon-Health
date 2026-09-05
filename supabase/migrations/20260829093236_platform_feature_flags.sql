-- Tarragon Health — Platform feature flags (Module 30.21)
--
-- IMPORTANT — this is NOT the same thing as private.patient_has_feature_access().
-- That helper answers "has this patient PAID for this capability?" by reading
-- subscription_plans.features / add_ons.features. It is an entitlement gate and
-- it stays exactly as it is.
--
-- A feature flag answers a different question: "has Tarragon TURNED THIS ON for
-- this person yet?" — pilot cohorts, a state-by-state rollout as we open new
-- regions, a beta a handful of patients are testing, an emergency kill switch
-- for a partner integration that has started misbehaving. Today the only way to
-- do any of that is a deploy, which is exactly what the spec says the admin
-- surface must remove.
--
-- The two compose rather than compete. A capability that is both paid AND
-- staged reads as:
--     private.is_feature_enabled('wearable_cloud_sync', patient_id)
--       and private.patient_has_feature_access(patient_id, 'wearable_cloud_sync')
-- Neither one is allowed to grant what the other withholds.
--
-- Safety boundary, deliberately narrow: a feature flag may never gate a
-- clinical-safety path. The abnormal-screening-result upgrade, the emergency
-- safety net, and the red-flag detection thresholds are not flaggable — see the
-- guard in section 6, which is enforced in the database, not by convention.

-- ---------------------------------------------------------------------------
-- 1. The flag itself
-- ---------------------------------------------------------------------------
create type public.feature_flag_status as enum ('off', 'rollout', 'on', 'archived');

create table public.feature_flags (
  -- Stable code the application checks. Snake_case, never renamed once shipped
  -- (a rename is a new flag plus a cleanup, exactly as with a migration).
  key             text primary key check (key ~ '^[a-z][a-z0-9_]{2,63}$'),
  label           text not null,
  description     text,
  category        text not null default 'general',

  -- off      → nobody, regardless of any rule below (the kill switch)
  -- rollout  → only whoever matches a rule in feature_flag_rules
  -- on       → everybody
  -- archived → the flag has been fully rolled out or abandoned; treated as
  --            off so a forgotten call site fails closed rather than open.
  status          public.feature_flag_status not null default 'off',

  -- Percentage rollout, applied only in 'rollout' status and only when the
  -- subject matches no explicit rule. Deterministic per (flag, profile) —
  -- see private.is_feature_enabled — so a patient never flickers in and out
  -- between page loads.
  rollout_percent smallint not null default 0 check (rollout_percent between 0 and 100),

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger feature_flags_set_updated_at
  before update on public.feature_flags
  for each row execute function private.set_updated_at();

comment on table public.feature_flags is
  'Rollout control (Module 30.21) — pilot groups, geographic staging, beta cohorts, kill switches. Distinct from private.patient_has_feature_access(), which is PLAN ENTITLEMENT. A gated capability must satisfy both.';

-- ---------------------------------------------------------------------------
-- 2. Targeting rules
--
--    One row = one way in. A subject is in the flag if ANY rule matches (OR),
--    unless a 'deny' rule matches, which always wins. Four rule kinds cover
--    every rollout this platform has actually needed:
--      profile       a named person (the founder's own account, a pilot patient)
--      state         Nigerian state, read from profiles.state — the geographic
--                    rollout the spec asks for in 30.22
--      account_role  every clinician, every care_coordinator, …
--      organisation  one employer or HMO tenant at a time
-- ---------------------------------------------------------------------------
create type public.feature_flag_rule_kind as enum
  ('profile', 'state', 'account_role', 'organisation');

create table public.feature_flag_rules (
  id              uuid primary key default gen_random_uuid(),
  flag_key        text not null references public.feature_flags (key) on delete cascade,
  kind            public.feature_flag_rule_kind not null,
  -- Interpreted per kind: a uuid for profile/organisation, a state name for
  -- state, a public.user_role value for account_role. Kept as text so one
  -- table serves all four without four nullable typed columns.
  value           text not null check (length(btrim(value)) > 0),
  -- A deny rule carves an exception out of a broader allow (e.g. roll out to
  -- Lagos, but not to the demo organisation inside it).
  effect          text not null default 'allow' check (effect in ('allow', 'deny')),
  note            text,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (flag_key, kind, value, effect)
);

create index feature_flag_rules_flag_idx on public.feature_flag_rules (flag_key);

-- ---------------------------------------------------------------------------
-- 3. The evaluator
--
--    SECURITY DEFINER because it reads profiles.state/role/organisation_id for
--    a subject the caller may not be able to see under RLS (an admin checking
--    who a flag covers, a server action evaluating for the signed-in patient).
--    It returns only a boolean, so no row leaks through it.
-- ---------------------------------------------------------------------------
create or replace function private.is_feature_enabled(
  p_flag text,
  p_profile_id uuid default null
)
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

  -- An unknown flag is OFF. A typo in a call site must never turn something
  -- on, and a flag deleted after cleanup must not resurrect the feature.
  if not found then
    return false;
  end if;

  if v_flag.status = 'on' then
    return true;
  end if;
  if v_flag.status in ('off', 'archived') then
    return false;
  end if;

  -- 'rollout' from here. With no subject there is nothing to target.
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

  -- Deny always wins, whichever rule kind carries it.
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

  -- Deterministic bucket. Hashing (flag || profile) rather than the profile
  -- alone means two flags at 10% do not cover the same 10% of patients, and
  -- the same patient gets the same answer on every request forever.
  v_bucket := (abs(pg_catalog.hashtext(p_flag || ':' || v_subject::text)) % 100)::smallint;
  return v_bucket < v_flag.rollout_percent;
end;
$$;

-- Public wrapper so a server component / route handler can evaluate a flag
-- for the signed-in user through PostgREST. Never accepts a subject: a caller
-- may only ever ask about themselves through this entry point.
create or replace function public.feature_enabled(p_flag text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_feature_enabled(p_flag, (select auth.uid()));
$$;

-- Every flag that applies to the signed-in caller, in one round trip, so a
-- layout can hydrate the whole client-side flag set without N queries.
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

-- ---------------------------------------------------------------------------
-- 4. Permission catalogue
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description) values
  ('feature_flags.manage', 'Manage feature flags', 'Technical', 'Turn platform features on or off and target pilot, role or geographic cohorts')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. RLS
--    Reads are open to any authenticated caller: the flag catalogue is a list
--    of feature names and rollout states, not patient data, and the UI needs
--    it. Writes are gated on feature_flags.manage.
-- ---------------------------------------------------------------------------
alter table public.feature_flags      enable row level security;
alter table public.feature_flag_rules enable row level security;

create policy feature_flags_select on public.feature_flags
  for select to authenticated using (true);
create policy feature_flags_write on public.feature_flags
  for all to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'))
  with check (private.is_admin() or private.has_permission('feature_flags.manage'));

create policy feature_flag_rules_select on public.feature_flag_rules
  for select to authenticated using (true);
create policy feature_flag_rules_write on public.feature_flag_rules
  for all to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'))
  with check (private.is_admin() or private.has_permission('feature_flags.manage'));

grant select, insert, update, delete on public.feature_flags      to authenticated;
grant select, insert, update, delete on public.feature_flag_rules to authenticated;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, so it is revoked FROM
-- PUBLIC, not FROM anon. Revoking "from anon" here would be a no-op that looks
-- like a fix — this exact mistake has been made and re-made on this project.
revoke execute on function public.feature_enabled(text) from public;
revoke execute on function public.my_feature_flags() from public;
grant execute on function public.feature_enabled(text) to authenticated;
grant execute on function public.my_feature_flags() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Clinical-safety guard
--
--    A flag key reserved for a clinical-safety path cannot be created at all.
--    "Never deprioritise or silently swallow an abnormal screening result" is
--    a platform rule; a kill switch that could disable that pipeline from an
--    admin screen would quietly turn the rule into a preference.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 7. Seed the flags the platform can genuinely use today.
--
--    Each one is seeded at whatever value PRESERVES TODAY'S BEHAVIOUR, not at
--    'off' — introducing a flag must never itself change what a patient sees.
--    The wearable Connect card and async consults are live and un-gated right
--    now, so their flags start 'on'; the mobile health bridge has never run on
--    real hardware, so it starts 'off', which is also its current state.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, label, description, category, status, rollout_percent) values
  ('wearable_cloud_sync', 'Wearable cloud sync', 'Show the Connect-a-wearable card. Turn on per state or pilot cohort once real provider credentials exist for at least one of Oura/WHOOP/Garmin/Fitbit/Dexcom.', 'patient', 'on', 0),
  ('mobile_health_bridge', 'Apple Health / Health Connect sync', 'The mobile app''s HealthKit and Health Connect background sync. Off until it has been exercised on real hardware via an EAS build.', 'mobile', 'off', 0),
  ('ops_console', 'Operations control centre', 'The /admin/ops board, exception queue and incident register.', 'operations', 'on', 0),
  ('async_consult_booking', 'Async consult booking', 'Patient-initiated asynchronous consults.', 'patient', 'on', 0),
  ('region_waitlist_capture', 'Waitlist capture outside live regions', 'Collect a waitlist signup from a state Tarragon has not opened yet, instead of a flat refusal.', 'growth', 'on', 0)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 8. Assertions
-- ---------------------------------------------------------------------------
do $$
declare
  v_ok boolean;
begin
  -- An unknown flag must be off, not on.
  if private.is_feature_enabled('definitely_not_a_real_flag', null) then
    raise exception 'Unknown flags must evaluate to false';
  end if;

  -- 'off' beats any rule.
  insert into public.feature_flags (key, label, status, rollout_percent)
  values ('assertion_temp_flag', 'Assertion temp', 'off', 100);
  if private.is_feature_enabled('assertion_temp_flag', null) then
    raise exception 'A flag in status off must never evaluate true';
  end if;

  update public.feature_flags set status = 'on' where key = 'assertion_temp_flag';
  if not private.is_feature_enabled('assertion_temp_flag', null) then
    raise exception 'A flag in status on must evaluate true';
  end if;

  update public.feature_flags set status = 'archived' where key = 'assertion_temp_flag';
  if private.is_feature_enabled('assertion_temp_flag', null) then
    raise exception 'An archived flag must fail closed';
  end if;

  delete from public.feature_flags where key = 'assertion_temp_flag';

  -- The clinical-safety guard must actually bite. Deliberately sabotage the
  -- happy path once so we know the check discriminates rather than passing
  -- vacuously.
  v_ok := false;
  begin
    insert into public.feature_flags (key, label) values ('disable_abnormal_result_pipeline', 'Should be refused');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'The clinical-safety flag guard did not reject a reserved key';
  end if;
end;
$$;
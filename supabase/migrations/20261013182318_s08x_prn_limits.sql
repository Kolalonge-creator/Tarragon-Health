-- S08x (medicines completion), part 2 of 2: as-needed (PRN) limits, warn never block (decision C7, approved text, NOT signed).
--
-- What this does:
--   1. prn_limit_rules: a governed, versioned, CMO-signed configuration (the sign-off hub lists it). It holds the
--      bounds a clinician may set and the "repeated" rule. It ships as an UNSIGNED, INACTIVE v1 draft: until the
--      Chief Medical Officer signs it, no limit can be set and nothing is evaluated. Mirrors packages/shared
--      proposed-config `medicines.prn_limits`; a test fails on drift.
--   2. medication_prn_limits: per medicine, an optional shortest gap and an optional daily most. NO DEFAULTS and
--      no row unless a clinician with prescribing authority, tied to the patient, sets one through
--      public.set_medication_prn_limits (INV-02: a limit is a clinical instruction). The patient can read, never write.
--   3. private.prn_exceedances(): the one server rule. Order independent, so a dose logged offline and synced late is
--      judged exactly like one logged in order. packages/medicines `checkPrnDose` is its twin; both run the same cases.
--   4. medication_prn_flags: a record that a logged dose was over a limit. The dose itself is ALWAYS logged: nothing in
--      this file can refuse or alter a medication_logs row. The flag is written by an AFTER INSERT trigger that never
--      raises into the log insert.
--   5. When one medicine collects `flaggedDoses` flagged doses inside `windowDays`, one care-team signal
--      (clinical_rule_events, medication_prn_limit_repeated) is emitted per medicine per week. No new alarm channel.
--   6. public.medication_prn_overview(): limits and flag counts for the patient, an acting guardian, a caregiver with the
--      medicines grant, and tied staff (with a reason, audited).
--   7. A go-live guard `prn_limits`, born OFF. While it is off (and the patient is not a test account) no flag is written.
--
-- Row counts at writing (live, 2026-10-13): medications 4 (none as-needed), no freeform dose logs. No data
-- conversion exists: every object here is new and empty.

-- 1. The governed rule -------------------------------------------------------------------------------------------
create table if not exists public.prn_limit_rules (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id) on delete restrict,
  approved_at timestamptz,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint prn_limit_rules_version_unique unique (version),
  constraint prn_limit_rules_signature_paired check ((approved_by is null) = (approved_at is null)),
  constraint prn_limit_rules_active_requires_signature check (not is_active or approved_by is not null),
  constraint prn_limit_rules_config_shape check (
    jsonb_typeof(config) = 'object'
    and jsonb_typeof(config -> 'minGapMinutesBounds') = 'array' and jsonb_array_length(config -> 'minGapMinutesBounds') = 2
    and jsonb_typeof(config -> 'dailyMaxBounds') = 'array' and jsonb_array_length(config -> 'dailyMaxBounds') = 2
    and jsonb_typeof(config -> 'repeatSignal') = 'object'
  )
);
create unique index if not exists prn_limit_rules_one_active on public.prn_limit_rules (is_active) where is_active;
comment on table public.prn_limit_rules is
  'S08x. Governed, versioned, Chief-Medical-Officer-signed as-needed limits rule (C7): the bounds a clinician may set and the repeated-flag signal rule. An unsigned draft does nothing.';

alter table public.prn_limit_rules enable row level security;
create policy prn_limit_rules_select on public.prn_limit_rules for select to authenticated using (true);
create policy prn_limit_rules_insert on public.prn_limit_rules for insert to authenticated
  with check (
    (private.is_admin() or exists (
      select 1 from public.clinical_staff cs
       where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer'))
    and approved_by is null and approved_at is null and is_active = false);
revoke all on public.prn_limit_rules from public, anon, authenticated;
grant select, insert on public.prn_limit_rules to authenticated;

-- PROPOSED v1, mirrored by packages/shared proposed-config medicines.prn_limits.
-- prn-limits-begin
insert into public.prn_limit_rules (version, config, notes, is_active) values (1, $json$
{
  "minGapMinutesBounds": [15, 1440],
  "dailyMaxBounds": [1, 24],
  "repeatSignal": { "flaggedDoses": 3, "windowDays": 7 }
}
$json$::jsonb, 'PROPOSED, S08x (2026-10-13). Decision C7, approved text, NOT signed. The Chief Medical Officer and a pharmacist confirm the bounds before signing; a clinician sets every limit per medicine and there are no defaults.', false)
on conflict (version) do nothing;
-- prn-limits-end

create or replace function public.sign_prn_limit_rules(p_rules_id uuid)
returns public.prn_limit_rules
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid;
  v_row   public.prn_limit_rules;
begin
  select cs.id into v_staff
    from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier = 'chief_medical_officer';
  if v_staff is null then
    raise exception 'only the active Chief Medical Officer may sign the as-needed limits rule' using errcode = '42501';
  end if;
  update public.prn_limit_rules set is_active = false where is_active and id <> p_rules_id;
  update public.prn_limit_rules
     set approved_by = v_staff, approved_at = now(), is_active = true
   where id = p_rules_id
   returning * into v_row;
  if v_row.id is null then
    raise exception 'as-needed limits rule version not found';
  end if;
  perform private.log_audit('prn_limit_rules.signed', 'prn_limit_rules', v_row.id, jsonb_build_object('version', v_row.version));
  return v_row;
end $$;
revoke all on function public.sign_prn_limit_rules(uuid) from public, anon;
grant execute on function public.sign_prn_limit_rules(uuid) to authenticated;

create trigger refuse_superseded_activation before update of is_active on public.prn_limit_rules
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- 2. Per-medicine limits (clinician-set, no defaults) -------------------------------------------------------------------
create table if not exists public.medication_prn_limits (
  medication_id   uuid primary key references public.medications (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  min_gap_minutes integer check (min_gap_minutes between 1 and 1440),
  daily_max       integer check (daily_max between 1 and 24),
  rule_version    integer not null,
  set_by          uuid references public.clinical_staff (id) on delete restrict,
  set_at          timestamptz not null default now(),
  constraint medication_prn_limits_something_set check (min_gap_minutes is not null or daily_max is not null)
);
create index if not exists medication_prn_limits_patient_idx on public.medication_prn_limits (patient_id);
create index if not exists medication_prn_limits_org_idx on public.medication_prn_limits (organisation_id);
alter table public.medication_prn_limits enable row level security;
create policy medication_prn_limits_select on public.medication_prn_limits for select to authenticated using (
  patient_id = (select auth.uid())
  or private.can_act_for(patient_id)
  or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
  or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
);
revoke all on public.medication_prn_limits from public, anon, authenticated;
grant select on public.medication_prn_limits to authenticated;

-- 3. The flag record -------------------------------------------------------------------------------------------------------
create table if not exists public.medication_prn_flags (
  log_id          uuid primary key references public.medication_logs (id) on delete cascade,
  medication_id   uuid not null references public.medications (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  dose_at         timestamptz not null,
  min_gap         boolean not null default false,
  daily_max       boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint medication_prn_flags_a_reason check (min_gap or daily_max)
);
create index if not exists medication_prn_flags_med_idx on public.medication_prn_flags (medication_id, dose_at desc);
create index if not exists medication_prn_flags_patient_idx on public.medication_prn_flags (patient_id);
create index if not exists medication_prn_flags_org_idx on public.medication_prn_flags (organisation_id);
alter table public.medication_prn_flags enable row level security;
create policy medication_prn_flags_select on public.medication_prn_flags for select to authenticated using (
  patient_id = (select auth.uid())
  or private.can_act_for(patient_id)
  or private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
  or private.can_read_clinical(patient_id, 'view_medication'::public.caregiver_permission)
);
revoke all on public.medication_prn_flags from public, anon, authenticated;
grant select on public.medication_prn_flags to authenticated;

-- 4. The one server rule ------------------------------------------------------------------------------------------------------
-- A dose is "over" when, counting only OTHER taken as-needed doses of the medicine at an earlier-or-equal time,
-- one lies inside the gap, or there are already `daily_max` of them on its Lagos day. Order independent: it reads
-- the whole set, so the order rows arrived in cannot change the answer.
create or replace function private.prn_exceedances(p_medication uuid, p_from timestamptz, p_to timestamptz)
returns table (log_id uuid, dose_at timestamptz, min_gap boolean, daily_max boolean)
language sql stable security definer set search_path = '' as $$
  with lim as (select * from public.medication_prn_limits where medication_id = p_medication),
  d as (
    select l.id, l.logged_at as t
      from public.medication_logs l
     where l.medication_id = p_medication and l.scheduled_time is null and l.status in ('taken', 'delayed')
       and l.source is distinct from 'system'
  )
  select x.id, x.t, x.gap_hit, x.max_hit
    from (
      select d.id, d.t,
        coalesce(lim.min_gap_minutes is not null and exists (
          select 1 from d p where p.id <> d.id and p.t <= d.t and d.t - p.t < make_interval(mins => lim.min_gap_minutes)), false) as gap_hit,
        coalesce(lim.daily_max is not null and 1 + (
          select count(*) from d p where p.id <> d.id and p.t <= d.t
             and (p.t at time zone 'Africa/Lagos')::date = (d.t at time zone 'Africa/Lagos')::date) > lim.daily_max, false) as max_hit
        from d cross join lim
       where d.t between p_from and p_to
    ) x
   where x.gap_hit or x.max_hit;
$$;

-- 5. The trigger: record a flag, maybe one signal. It can never stop the dose being logged. ----------------------------------
create or replace function private.evaluate_prn_limits()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_rule  public.prn_limit_rules;
  v_n     integer;
  v_count integer;
  v_days  integer;
  v_need  integer;
begin
  if new.scheduled_time is not null or new.status not in ('taken', 'delayed') or new.source is not distinct from 'system' then
    return null;
  end if;
  begin
    if not private.go_live_open_patient('prn_limits', new.patient_id) then return null; end if;
    select * into v_rule from public.prn_limit_rules where is_active and approved_by is not null;
    if not found then return null; end if;
    if not exists (select 1 from public.medication_prn_limits where medication_id = new.medication_id) then return null; end if;

    -- A late-synced dose can make LATER doses over the line, never earlier ones: re-judge from this dose to 24 hours on.
    insert into public.medication_prn_flags (log_id, medication_id, patient_id, organisation_id, dose_at, min_gap, daily_max)
    select e.log_id, new.medication_id, new.patient_id, new.organisation_id, e.dose_at, e.min_gap, e.daily_max
      from private.prn_exceedances(new.medication_id, new.logged_at, new.logged_at + interval '24 hours') e
    on conflict (log_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 0 then return null; end if;

    v_days := coalesce((v_rule.config -> 'repeatSignal' ->> 'windowDays')::integer, 7);
    v_need := coalesce((v_rule.config -> 'repeatSignal' ->> 'flaggedDoses')::integer, 3);
    select count(*) into v_count from public.medication_prn_flags
     where medication_id = new.medication_id and dose_at >= new.logged_at - make_interval(days => v_days);
    if v_count >= v_need then
      -- Its own block: if the signal cannot be written, the flag recorded above must still stand.
      begin
        perform private.emit_clinical_rule_event(
          new.organisation_id, new.patient_id, 'medication_prn_limit_repeated',
          jsonb_build_object('medication_id', new.medication_id, 'flagged_doses', v_count, 'window_days', v_days,
                             'rule_version', v_rule.version),
          'db_trigger', 'medication_logs', new.id, new.logged_at,
          'prn_limit_repeated:' || new.medication_id::text || ':' || date_trunc('week', (new.logged_at at time zone 'Africa/Lagos'))::date::text);
      exception when others then
        raise warning 'as-needed repeated signal not written for medicine %: %', new.medication_id, sqlerrm;
      end;
    end if;
  exception when others then
    -- A dose log must never fail because a flag could not be written. The failure is kept (a database warning AND an audit
    -- row), because a missing flag reads as reassurance; private.reevaluate_prn_flags(medicine) repairs it.
    raise warning 'as-needed limit check not written for log %: %', new.id, sqlerrm;
    begin
      perform private.log_audit('medication_prn_limits.flag_write_failed', 'medication_log', new.id,
        jsonb_build_object('medication_id', new.medication_id, 'error', sqlerrm));
    exception when others then
      raise warning 'as-needed limit failure not recorded for log %: %', new.id, sqlerrm;
    end;
  end;
  return null;
end $$;

-- Repair: judge every counted dose of one medicine again and add any flag that is missing. Never removes a flag.
create or replace function private.reevaluate_prn_flags(p_medication uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.medication_prn_flags (log_id, medication_id, patient_id, organisation_id, dose_at, min_gap, daily_max)
  select e.log_id, l.medication_id, l.patient_id, l.organisation_id, e.dose_at, e.min_gap, e.daily_max
    from private.prn_exceedances(p_medication, '-infinity'::timestamptz, 'infinity'::timestamptz) e
    join public.medication_logs l on l.id = e.log_id
  on conflict (log_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Amending a prescription supersedes the row and inserts a new one (public.amend_medication). The limits belong to the
-- medicine, not to one version of it, so they follow it. Without this the live medicine would read "no limits".
create or replace function private.carry_prn_limits_on_amend()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.previous_version_id is null or coalesce(new.schedule_spec ->> 'kind', '') <> 'as_needed' then
    return null;
  end if;
  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, daily_max, rule_version, set_by, set_at)
  select new.id, l.organisation_id, l.patient_id, l.min_gap_minutes, l.daily_max, l.rule_version, l.set_by, l.set_at
    from public.medication_prn_limits l where l.medication_id = new.previous_version_id
  on conflict (medication_id) do nothing;
  if found then
    perform private.log_audit('medication_prn_limits.carried_on_amend', 'medication', new.id, jsonb_build_object('from', new.previous_version_id));
  end if;
  return null;
end $$;
drop trigger if exists medications_carry_prn_limits on public.medications;
create trigger medications_carry_prn_limits after insert on public.medications
  for each row when (new.previous_version_id is not null) execute function private.carry_prn_limits_on_amend();
drop trigger if exists medication_logs_evaluate_prn_limits on public.medication_logs;
create trigger medication_logs_evaluate_prn_limits after insert on public.medication_logs
  for each row execute function private.evaluate_prn_limits();

-- 6. Setting limits: a clinician with prescribing authority, tied to the patient (INV-02) ---------------------------------------
create or replace function public.set_medication_prn_limits(
  p_medication uuid, p_min_gap_minutes integer, p_daily_max integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m      public.medications%rowtype;
  v_rule public.prn_limit_rules;
  v_staff uuid;
  v_gap_lo integer; v_gap_hi integer; v_max_lo integer; v_max_hi integer;
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into m from public.medications where id = p_medication;
  if not found then raise exception 'medication not found' using errcode = '22023'; end if;
  if not private.is_org_staff(m.organisation_id) or not private.has_prescribing_authority(m.organisation_id)
     or not private.clinician_has_patient_access(m.patient_id) then
    raise exception 'Not authorised to set limits for this patient' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  select * into v_rule from public.prn_limit_rules where is_active and approved_by is not null;
  if not found then
    raise exception 'the as-needed limits rule has not been signed by the Chief Medical Officer yet' using errcode = '55000';
  end if;
  if not m.is_active or m.superseded_at is not null or m.stopped_at is not null
     or coalesce(m.schedule_spec ->> 'kind', '') <> 'as_needed' then
    raise exception 'limits can only be set on an active as-needed medicine' using errcode = '22023';
  end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.organisation_id = m.organisation_id and cs.active limit 1;

  if p_min_gap_minutes is null and p_daily_max is null then
    delete from public.medication_prn_limits where medication_id = p_medication;
    perform private.log_audit('medication_prn_limits.cleared', 'medication', p_medication, jsonb_build_object('reason', btrim(p_reason)));
    return;
  end if;
  v_gap_lo := (v_rule.config -> 'minGapMinutesBounds' ->> 0)::integer; v_gap_hi := (v_rule.config -> 'minGapMinutesBounds' ->> 1)::integer;
  v_max_lo := (v_rule.config -> 'dailyMaxBounds' ->> 0)::integer;      v_max_hi := (v_rule.config -> 'dailyMaxBounds' ->> 1)::integer;
  if p_min_gap_minutes is not null and p_min_gap_minutes not between v_gap_lo and v_gap_hi then
    raise exception 'the shortest gap must be between % and % minutes', v_gap_lo, v_gap_hi using errcode = '22023';
  end if;
  if p_daily_max is not null and p_daily_max not between v_max_lo and v_max_hi then
    raise exception 'the daily most must be between % and % doses', v_max_lo, v_max_hi using errcode = '22023';
  end if;

  insert into public.medication_prn_limits (medication_id, organisation_id, patient_id, min_gap_minutes, daily_max, rule_version, set_by, set_at)
  values (p_medication, m.organisation_id, m.patient_id, p_min_gap_minutes, p_daily_max, v_rule.version, v_staff, now())
  on conflict (medication_id) do update
    set min_gap_minutes = excluded.min_gap_minutes, daily_max = excluded.daily_max,
        rule_version = excluded.rule_version, set_by = excluded.set_by, set_at = excluded.set_at;
  perform private.log_audit('medication_prn_limits.set', 'medication', p_medication,
    jsonb_build_object('min_gap_minutes', p_min_gap_minutes, 'daily_max', p_daily_max, 'reason', btrim(p_reason)));
end $$;
revoke all on function public.set_medication_prn_limits(uuid, integer, integer, text) from public, anon;
grant execute on function public.set_medication_prn_limits(uuid, integer, integer, text) to authenticated;

-- 7. Reading: limits and how many doses were flagged in the last 7 days ---------------------------------------------------------
create or replace function private.prn_overview(p_patient uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'limits', coalesce((select jsonb_agg(jsonb_build_object('medication_id', l.medication_id, 'min_gap_minutes', l.min_gap_minutes,
                                                          'daily_max', l.daily_max, 'set_at', l.set_at) order by l.set_at)
                          from public.medication_prn_limits l where l.patient_id = p_patient), '[]'::jsonb),
    'flagged_last_7_days', coalesce((select jsonb_agg(jsonb_build_object('medication_id', f.medication_id, 'doses', f.n) order by f.medication_id)
                                       from (select medication_id, count(*) n from public.medication_prn_flags
                                              where patient_id = p_patient and dose_at >= now() - interval '7 days'
                                              group by medication_id) f), '[]'::jsonb));
$$;

create or replace function public.medication_prn_overview(p_patient uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_patient = (select auth.uid())
     or private.can_act_for(p_patient)
     or private.can_read_clinical(p_patient, 'medications'::public.care_access_category)
     or private.can_read_clinical(p_patient, 'view_medication'::public.caregiver_permission) then
    return jsonb_build_object('status', 'ok') || private.prn_overview(p_patient);
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'medications'::public.care_access_category) then
    perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(p_patient, array['dose_events'], p_reason, 'success');
  return jsonb_build_object('status', 'ok') || private.prn_overview(p_patient);
end $$;
revoke all on function public.medication_prn_overview(uuid, text) from public, anon;
grant execute on function public.medication_prn_overview(uuid, text) to authenticated;

-- 8. The go-live guard, born OFF -----------------------------------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('prn_limits', 'As-needed medicine limits', 'The as-needed limit check on a logged dose: the flag a care team sees and the repeated-dose signal',
   'The Chief Medical Officer has signed the as-needed limits rule (C7); a pharmacist has reviewed the bounds',
   'cmo',
   array['private.evaluate_prn_limits (the trigger that records a flag and the repeated signal)'],
   'A dose is always logged, guard on or off: nothing here ever blocks or edits a log. Setting a limit is not behind the guard but needs the signed rule. is_test accounts pass it so the flow can be rehearsed. The phone shows its notice only when the guard is open for the signed-in person.')
on conflict (key) do nothing;

create or replace function private.prn_limits_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_ver integer;
begin
  select version into v_ver from public.prn_limit_rules where is_active and approved_by is not null;
  return jsonb_build_array(
    private.go_live_cond('prn_rule_signed', 'The Chief Medical Officer has signed the as-needed limits rule', v_ver is not null, 'data',
      case when v_ver is null then 'no signed version' else 'version ' || v_ver end),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.prn_limits_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%prn_limits_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the prn_limits branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key = ''prn_limits'' then\n    return private.prn_limits_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;

-- 8b. The patient-data registry (S39d): every table with a patient_id is listed with its retention class and whether it is exported.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export)
select t, 'patient_id', private.retention_class_for(t), 'review', true
  from unnest(array['medication_prn_limits', 'medication_prn_flags']) t
on conflict (table_name) do nothing;

-- 9. Privileges, and the migration proves what it claims ----------------------------------------------------------------------------
revoke all on function private.prn_exceedances(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function private.evaluate_prn_limits() from public, anon, authenticated;
revoke all on function private.prn_overview(uuid) from public, anon, authenticated;
revoke all on function private.reevaluate_prn_flags(uuid) from public, anon, authenticated;
revoke all on function private.carry_prn_limits_on_amend() from public, anon, authenticated;

do $$
declare f text; t text;
begin
  foreach f in array array['public.sign_prn_limit_rules(uuid)', 'public.set_medication_prn_limits(uuid,integer,integer,text)',
                           'public.medication_prn_overview(uuid,text)', 'private.prn_exceedances(uuid,timestamptz,timestamptz)',
                           'private.evaluate_prn_limits()', 'private.prn_overview(uuid)', 'private.reevaluate_prn_flags(uuid)', 'private.carry_prn_limits_on_amend()', 'private.prn_limits_go_live_conditions(text)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S08x: anon can execute %', f; end if;
  end loop;
  foreach t in array array['public.prn_limit_rules', 'public.medication_prn_limits', 'public.medication_prn_flags']
  loop
    if has_table_privilege('anon', t, 'SELECT') then raise exception 'S08x: anon can read %', t; end if;
    if not has_table_privilege('authenticated', t, 'SELECT') then raise exception 'S08x: authenticated cannot read %', t; end if;
    if has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE') then
      raise exception 'S08x: authenticated can change %', t;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.medication_prn_limits', 'INSERT')
     or has_table_privilege('authenticated', 'public.medication_prn_flags', 'INSERT') then
    raise exception 'S08x: authenticated can write a limit or a flag directly';
  end if;
  if (select count(*) from public.prn_limit_rules where is_active) <> 0 then raise exception 'S08x: a rule version is already live'; end if;
  if (select count(*) from public.go_live_guards where key = 'prn_limits' and not is_on) <> 1 then raise exception 'S08x: the prn_limits guard is missing or on'; end if;
  if (private.go_live_conditions('prn_limits', null)) is null then raise exception 'S08x: go_live_conditions has no prn_limits branch'; end if;
end $$;

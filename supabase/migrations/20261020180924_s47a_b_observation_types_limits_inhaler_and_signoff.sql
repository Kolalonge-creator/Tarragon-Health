-- S47a (2 of 2): water, sleep and mood observations, an inhaler-use log, plausibility CHECKs, observation events, and a signed home for the limits.
-- BUILD-SPEC-v5 Module 4: 4.2 (quick-log types), 4.3 (plausibility), 4.7 (full edit history), 6.6 (water).
--
-- Part 1 (20261020180915) only added the enum values. This part USES them.
--
-- WHAT IS NEW, AND WHAT IS DELIBERATELY NOT TOUCHED
--   * vital_type water_ml / sleep_hours / mood store their number in vitals_readings.value_numeric (S05 design). They inherit the S05b supersede-not-edit
--     chain, so "edit history" for a non-BP type is public.correct_clinical_value (already granted to the patient for her own manual entries); a replacement
--     row carries supersedes_id, which is what the "changed" marker on the chart reads. No new correction machinery.
--   * The glucose, SpO2, pulse, temperature, BP, ketone and weight red-flag triggers are NOT edited. Each was read from its live definition (below) and each
--     switches on its own vital_type; none has an ELSE that acts. The proof (packages/db/tests/s47a_observation_types.sql) inserts the new types and shows
--     no emergency, alert or triage row appears, then inserts a dangerous glucose and shows the glucose engine still fires.
--   * Two existing trigger functions are replaced with the SAME body plus one early exit each, from their live definitions (pg_get_functiondef, 2026-10-20):
--       private.wellness_points_on_vitals_logged  - the new lifestyle types never earn points (a water tap is gameable; OQ-S47A-3 asks the founder).
--       private.timeline_from_vitals_reading      - the new lifestyle types do not write a health-timeline event (a water log is not a clinical event).
--   * Everything is behind the platform module `extended_observations`, born OFF. A direct insert of a new type while it is off is refused by a trigger, so
--     the switch cannot be bypassed from a client.
--   * No rule set / alert exists for the new types. Inhaler overuse is a clinical signal; its rule (frequency lines, who is told) is the CMO's and is NOT
--     built (OQ-S47A-2). Nothing here pages anyone, and no notification names a reading (INV-07).
--
-- AUDIT OF THE 25 TRIGGERS ON vitals_readings (live, 2026-10-20), for a row whose vital_type is one of the three new values:
--   switch on vital_type, new types fall through to a no-op: bp_red_flag, spo2_red_flag, pulse_red_flag, temperature_red_flag, heart_failure_weight_gain,
--     glucose_emergency_backstop, emit_glucose_ketone_regrade, emit_glucose_observation, emit_observation_recorded (BP), cgm_sustained, queue_reassessment (weight only).
--   keyed on vital_type = a monitoring schedule item of the same type: reset_monitoring_gap, set_monitoring_baseline (no schedule item can name a new type; no-op).
--   dedupe_cross_source_vitals: returns at once unless the type is BP, glucose, weight, pulse or SpO2.
--   hold_impossible_vitals / vitals_impossible_reasons: `else null` for other types (the device plausibility hold does not cover them; the CHECK below does).
--   flag_vitals_requiring_validation: the new types give v_new_value null, so no duplicate / sudden-change flag; the BP-only context flag does not apply.
--   emit_vital_recorded_event (rules engine): emits a `vital_recorded` event carrying only the type and source for the new types (no number column is set);
--     a rule that reads it finds no clinical rule keyed to these types. Failure is swallowed by design there.
--   changed here: wellness_points, timeline (above). All remaining triggers are not type-dependent (guards, audit, dedupe-id, consent).
--
-- COUNTS / LIVE FACTS (2026-10-20, read-only): 0 rows of the new types (they did not exist); 0 inhaler rows (new table); event_types had no `water.logged`;
-- latest live migration 20261020173600.

-- 1. The go-live switch (born off) -------------------------------------------------------------------------------------------------------
insert into public.platform_modules (key, label, description) values
  ('extended_observations', 'Water, sleep, mood and inhaler logs',
   'Lets a person log water, sleep, mood and inhaler use from the phone and the web. Off: the options are not offered and the database refuses the rows. Turning it on needs the plausibility limits signed (observation_limit_signoffs) and the founder decision on points (OQ-S47A-3).')
on conflict (key) do nothing;

-- 2. Plausibility: the database mirrors the hard limits in packages/shared proposed-config observations.plausibility v1 ---------------------
alter table public.vitals_readings
  add constraint vitals_readings_s47a_lifestyle_plausible check (
    vital_type::text not in ('water_ml', 'sleep_hours', 'mood')
    or (
      value_numeric is not null
      and case vital_type::text
            when 'water_ml'    then value_numeric between 10 and 3000 and value_numeric = trunc(value_numeric)
            when 'sleep_hours' then value_numeric between 0.5 and 24
            else                    value_numeric between 1 and 5 and value_numeric = trunc(value_numeric)
          end
    )
  ) not valid;
alter table public.vitals_readings validate constraint vitals_readings_s47a_lifestyle_plausible;

create function private.s47a_lifestyle_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.vital_type::text not in ('water_ml', 'sleep_hours', 'mood') then return new; end if;
  if not private.module_enabled('extended_observations') then
    raise exception 'This log is not switched on yet' using errcode = '55000';
  end if;
  -- the unit is the type's own, never typed: the S05 observations view reads it from value_unit
  new.value_unit := case new.vital_type::text when 'water_ml' then 'ml' when 'sleep_hours' then 'h' else 'score' end;
  return new;
end $$;
revoke all on function private.s47a_lifestyle_guard() from public, anon, authenticated;
create trigger vitals_readings_b0_s47a_lifestyle_guard before insert on public.vitals_readings
  for each row execute function private.s47a_lifestyle_guard();

-- 3. The two trigger functions that need an early exit (same body as live, one added line each) ---------------------------------------------
create or replace function private.wellness_points_on_vitals_logged()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  -- Only readings a person (or their own paired device) logs earn: a CGM or wearable stream would otherwise write hundreds of
  -- events a day per person, and passive collection is not "consistent logging". Body-size readings never earn.
  -- S47a: water, sleep and mood logs never earn either (OQ-S47A-3).
  if new.vital_type::text not in ('weight', 'waist_circumference', 'water_ml', 'sleep_hours', 'mood') and new.source::text in ('manual', 'device') then
    perform private.rewards_emit('vitals.logged', new.patient_id, jsonb_build_object('vitals_id', new.id), new.id::text, 'vitals_readings', new.id);
  end if;
  return new;
end;
$function$;

create or replace function private.timeline_from_vitals_reading()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_title text;
  v_source_label text;
begin
  -- S47a: a water, sleep or mood log is not a clinical event; it stays out of the health timeline.
  if new.vital_type::text in ('water_ml', 'sleep_hours', 'mood') then return new; end if;

  v_title := case new.vital_type::text
    when 'blood_pressure' then 'Blood pressure recorded'
    when 'glucose'        then 'Glucose recorded'
    when 'weight'         then 'Weight recorded'
    when 'pulse'          then 'Pulse recorded'
    when 'temperature'    then 'Temperature recorded'
    when 'spo2'           then 'SpO2 recorded'
    when 'waist_circumference' then 'Waist circumference recorded'
    when 'ketones'        then 'Ketones recorded'
    when 'respiratory_rate' then 'Respiratory rate recorded'
    when 'peak_flow'      then 'Peak flow recorded'
    else initcap(replace(new.vital_type::text, '_', ' ')) || ' recorded'
  end;

  v_source_label := case new.source::text
    when 'manual'   then 'Manual'
    when 'device'   then 'Device'
    when 'wearable' then 'Wearable'
    when 'cgm'      then 'CGM'
    when 'fhir_import' then 'FHIR import'
    else new.source::text
  end;

  perform private.record_timeline_event(
    new.organisation_id,
    new.patient_id,
    'vitals_recorded'::public.timeline_event_type,
    'vitals_readings',
    new.id,
    v_title,
    v_source_label,
    coalesce(new.taken_at, new.created_at),
    null,
    jsonb_build_object(
      'vital_type', new.vital_type::text,
      'source', new.source::text
    )
  );

  return new;
end;
$function$;

-- 4. Events: observation.recorded for the new types, and water.logged ---------------------------------------------------------------------
-- observation.recorded already has a subscriber that grades blood pressure and glucose. The payload carries `kind`; the edge handler returns at once for
-- these kinds (supabase/functions/_shared/triage/observation-handler.ts), and even an older deployed handler finds "not a blood pressure reading" and does nothing.
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('water.logged', 'A person logged an amount of water', 'S47a', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('water.logged', 1, array['observation_id'])
on conflict (event_type, version) do nothing;

create function private.emit_lifestyle_observation_recorded() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_kind text;
begin
  if new.vital_type::text not in ('water_ml', 'sleep_hours', 'mood') or new.correction_status is not null then return null; end if;
  v_kind := case new.vital_type::text when 'water_ml' then 'water' when 'sleep_hours' then 'sleep' else 'mood' end;
  begin
    perform private.emit_domain_event('observation.recorded', new.organisation_id, jsonb_build_object('observation_id', new.id, 'kind', v_kind),
                                      'life:' || new.id::text, new.patient_id, 'observation', new.id);
    if v_kind = 'water' then
      perform private.emit_domain_event('water.logged', new.organisation_id, jsonb_build_object('observation_id', new.id),
                                        'water:' || new.id::text, new.patient_id, 'observation', new.id);
    end if;
  exception when others then
    -- A log is never refused because the event bus is unhappy; the warning is the trace.
    raise warning 'S47a: could not emit the observation event for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.emit_lifestyle_observation_recorded() from public, anon, authenticated;
create trigger vitals_readings_emit_lifestyle_observation after insert on public.vitals_readings
  for each row execute function private.emit_lifestyle_observation_recorded();

-- 5. Inhaler use: puffs and a reason, append-only, corrected by a new row ---------------------------------------------------------------------
create table public.inhaler_use_logs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  puffs            smallint not null check (puffs between 1 and 20),
  reason           text not null check (reason in ('breathless_or_wheeze', 'before_exercise', 'routine_dose', 'night_symptoms', 'other')),
  taken_at         timestamptz not null default now(),
  time_basis       text not null default 'server' check (time_basis in ('server', 'client_bounded')),
  source           public.record_source not null default 'patient',
  recorded_by      uuid not null references public.profiles (id) on delete restrict,
  client_log_id    uuid,
  supersedes_id    uuid references public.inhaler_use_logs (id),
  entered_in_error boolean not null default false,
  correction_reason text,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  check (supersedes_id is null or supersedes_id <> id),
  check ((supersedes_id is null and correction_reason is null and not entered_in_error)
         or (supersedes_id is not null and length(btrim(correction_reason)) >= 5))
);
create unique index inhaler_use_logs_client_dedupe_idx on public.inhaler_use_logs (patient_id, client_log_id) where client_log_id is not null;
create unique index inhaler_use_logs_one_correction_idx on public.inhaler_use_logs (supersedes_id) where supersedes_id is not null;
create index inhaler_use_logs_patient_idx on public.inhaler_use_logs (patient_id, taken_at desc);
comment on table public.inhaler_use_logs is
  'S47a (BUILD-SPEC-v5 4.2): one inhaler use, puffs and a reason. Append-only; a correction is a NEW row with supersedes_id (S05b convention). Written only by log_inhaler_use / correct_inhaler_use. No alert rule exists (OQ-S47A-2).';

create function private.inhaler_use_append_only() returns trigger
language plpgsql as $$ begin raise exception '% is append-only: correct it with public.correct_inhaler_use', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.inhaler_use_append_only() from public, anon, authenticated;
create trigger inhaler_use_logs_no_change before update or delete on public.inhaler_use_logs for each row execute function private.inhaler_use_append_only();
create trigger inhaler_use_logs_no_truncate before truncate on public.inhaler_use_logs for each statement execute function private.inhaler_use_append_only();

alter table public.inhaler_use_logs enable row level security;
revoke all on public.inhaler_use_logs from public, anon, authenticated;
grant select on public.inhaler_use_logs to authenticated;
create policy inhaler_use_logs_read on public.inhaler_use_logs for select to authenticated
  using (patient_id = (select auth.uid())
         -- the same category-scoped read the vitals table uses (an explicit cast: see the can_read_clinical overload lesson in CLAUDE.md)
         or private.can_read_clinical(patient_id, 'vitals_readings'::public.care_access_category)
         or private.staff_may_read(patient_id, organisation_id, 'vitals_readings'::public.care_access_category));

-- the chart and the care team read the CURRENT use only: a row some later row supersedes, and an entry marked in error, are history
create view public.inhaler_use_current with (security_invoker = true) as
select l.id, l.organisation_id, l.patient_id, l.puffs, l.reason, l.taken_at, l.source, l.recorded_by, l.supersedes_id,
       (l.supersedes_id is not null) as was_changed
  from public.inhaler_use_logs l
 where not l.entered_in_error
   and not exists (select 1 from public.inhaler_use_logs n where n.supersedes_id = l.id);
revoke all on public.inhaler_use_current from public, anon, authenticated;
grant select on public.inhaler_use_current to authenticated;

insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('inhaler_use_logs', 'tied', 'patient_id', 'vitals_readings', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('inhaler_use_logs', 'patient_id', 'clinical_record', 'review', true, 'S47a. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

create function public.log_inhaler_use(
  p_puffs integer, p_reason text, p_client_recorded_at timestamptz default null, p_client_log_id uuid default null, p_beneficiary uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_subject uuid;
  v_org uuid;
  v_test boolean;
  v_now timestamptz := clock_timestamp();
  v_when record;
  v_id uuid;
begin
  if v_me is null then raise exception 'sign in to log this' using errcode = '42501'; end if;
  if not private.module_enabled('extended_observations') then raise exception 'This log is not switched on yet' using errcode = '55000'; end if;
  v_subject := coalesce(p_beneficiary, v_me);
  if v_subject <> v_me and not private.can_act_for(v_subject) then raise exception 'you cannot log this for that person' using errcode = '42501'; end if;
  if p_puffs is null or p_puffs < 1 or p_puffs > 20 then raise exception 'Puffs must be a whole number from 1 to 20. Check the number and try again.' using errcode = '22023'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_subject;
  if v_org is null then raise exception 'no organisation on file' using errcode = '22023'; end if;
  select * into v_when from private.resolve_offline_event_time(p_client_recorded_at, v_now);
  insert into public.inhaler_use_logs (organisation_id, patient_id, puffs, reason, taken_at, time_basis, source, recorded_by, client_log_id, is_test)
  values (v_org, v_subject, p_puffs::smallint, p_reason, v_when.effective_at, v_when.basis, 'patient', v_me, p_client_log_id, v_test)
  on conflict (patient_id, client_log_id) where client_log_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    -- a blind retry of the same queued entry: already saved, so the replay is a success
    select id into v_id from public.inhaler_use_logs where patient_id = v_subject and client_log_id = p_client_log_id;
  end if;
  return v_id;
end $$;
revoke all on function public.log_inhaler_use(integer, text, timestamptz, uuid, uuid) from public, anon;
grant execute on function public.log_inhaler_use(integer, text, timestamptz, uuid, uuid) to authenticated;

-- a patient (or someone who manages her account) corrects her own entry; the original stays as history and the chart marks the change
create function public.correct_inhaler_use(p_id uuid, p_puffs integer, p_reason text, p_why text, p_entered_in_error boolean default false)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_old public.inhaler_use_logs%rowtype;
  v_new uuid;
begin
  if v_me is null then raise exception 'sign in to correct a record' using errcode = '42501'; end if;
  if not private.module_enabled('extended_observations') then raise exception 'This log is not switched on yet' using errcode = '55000'; end if;
  if p_why is null or length(btrim(p_why)) < 5 then raise exception 'say what was wrong and why (at least 5 characters)' using errcode = '22023'; end if;
  select * into v_old from public.inhaler_use_logs where id = p_id for update;
  -- one answer for "missing" and "not yours"
  if not found or (v_old.patient_id <> v_me and not private.can_act_for(v_old.patient_id)) then raise exception 'you cannot correct this record' using errcode = '42501'; end if;
  if exists (select 1 from public.inhaler_use_logs n where n.supersedes_id = p_id) or v_old.entered_in_error then
    raise exception 'this entry was already changed' using errcode = '22023';
  end if;
  if not p_entered_in_error and (p_puffs is null or p_puffs < 1 or p_puffs > 20) then
    raise exception 'Puffs must be a whole number from 1 to 20. Check the number and try again.' using errcode = '22023';
  end if;
  insert into public.inhaler_use_logs (organisation_id, patient_id, puffs, reason, taken_at, time_basis, source, recorded_by, supersedes_id, entered_in_error, correction_reason, is_test)
  values (v_old.organisation_id, v_old.patient_id,
          case when p_entered_in_error then v_old.puffs else p_puffs::smallint end,
          case when p_entered_in_error then v_old.reason else p_reason end,
          v_old.taken_at, v_old.time_basis, 'patient', v_me, p_id, p_entered_in_error, btrim(p_why), v_old.is_test)
  returning id into v_new;
  return v_new;
end $$;
revoke all on function public.correct_inhaler_use(uuid, integer, text, text, boolean) from public, anon;
grant execute on function public.correct_inhaler_use(uuid, integer, text, text, boolean) to authenticated;

-- 6. The signed home of the limits (CMO) -------------------------------------------------------------------------------------------------
create table public.observation_limit_signoffs (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null,
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null))
);
create unique index observation_limit_signoffs_one_active on public.observation_limit_signoffs (is_active) where is_active;
alter table public.observation_limit_signoffs enable row level security;
revoke all on public.observation_limit_signoffs from public, anon, authenticated;
grant select on public.observation_limit_signoffs to authenticated;
create policy observation_limit_signoffs_read on public.observation_limit_signoffs for select to authenticated using (true);
create trigger refuse_superseded_activation before update of is_active on public.observation_limit_signoffs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- observation-limits-begin
insert into public.observation_limit_signoffs (version, is_active, config, notes)
values (1, false, $json${
 "glucose_mmol_l": {"min": 1, "max": 40, "unit": "mmol/L", "integer": false},
 "glucose_mg_dl": {"min": 18, "max": 720, "unit": "mg/dL", "integer": false},
 "weight_kg": {"min": 20, "max": 300, "unit": "kg", "integer": false},
 "waist_cm": {"min": 40, "max": 200, "unit": "cm", "integer": false},
 "temperature_c": {"min": 30, "max": 45, "unit": "C", "integer": false},
 "spo2_pct": {"min": 50, "max": 100, "unit": "%", "integer": true},
 "pulse_bpm": {"min": 20, "max": 300, "unit": "bpm", "integer": true},
 "systolic_mmhg": {"min": 60, "max": 260, "unit": "mmHg", "integer": true},
 "diastolic_mmhg": {"min": 30, "max": 160, "unit": "mmHg", "integer": true},
 "water_ml": {"min": 10, "max": 3000, "unit": "ml", "integer": true, "softMax": 1500},
 "sleep_hours": {"min": 0.5, "max": 24, "unit": "h", "integer": false, "softMin": 2, "softMax": 14},
 "mood": {"min": 1, "max": 5, "unit": "score", "integer": true},
 "inhaler_puffs": {"min": 1, "max": 20, "unit": "puffs", "integer": true, "softMax": 8}
}$json$::jsonb,
        'PROPOSED, unsigned and inactive. The first eight rows restate the limits already enforced everywhere (typo gates wider than any clinical band). The water, sleep, mood and inhaler rows are new and need the CMO (OQ-S47A-1): sign_observation_limits(). Signing does not switch extended_observations on.');
-- observation-limits-end

create function public.sign_observation_limits(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.observation_limit_signoffs where id = p_id) then raise exception 'Observation limits version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the observation limits'; end if;
  update public.observation_limit_signoffs set is_active = false where is_active and id <> p_id;
  update public.observation_limit_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('observation_limits.signed', 'observation_limit_signoffs', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_observation_limits(uuid) from public, anon;
grant execute on function public.sign_observation_limits(uuid) to authenticated;

-- 7. Self-check ---------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if (select is_enabled from public.platform_modules where key = 'extended_observations') is distinct from false then
    raise exception 'S47a self-check: extended_observations must be born off';
  end if;
  if has_function_privilege('anon', 'public.log_inhaler_use(integer, text, timestamptz, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.correct_inhaler_use(uuid, integer, text, text, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sign_observation_limits(uuid)', 'EXECUTE') then
    raise exception 'S47a self-check: anon can execute an S47a function';
  end if;
  if has_table_privilege('anon', 'public.inhaler_use_logs', 'SELECT') or has_table_privilege('authenticated', 'public.inhaler_use_logs', 'INSERT')
     or has_table_privilege('authenticated', 'public.inhaler_use_logs', 'UPDATE') or has_table_privilege('authenticated', 'public.inhaler_use_logs', 'DELETE') then
    raise exception 'S47a self-check: inhaler_use_logs grants are wrong';
  end if;
  if exists (select 1 from public.observation_limit_signoffs where is_active or approved_by is not null) then
    raise exception 'S47a self-check: the limits must ship unsigned and inactive';
  end if;
  if not exists (select 1 from public.event_types where event_type = 'water.logged') then raise exception 'S47a self-check: water.logged is not registered'; end if;
  if not exists (select 1 from public.data_registry where table_name = 'inhaler_use_logs') or not exists (select 1 from public.staff_read_scope where table_name = 'inhaler_use_logs') then
    raise exception 'S47a self-check: inhaler_use_logs is not in both registries';
  end if;
end $$;

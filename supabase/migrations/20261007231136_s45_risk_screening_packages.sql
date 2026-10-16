-- S45: Module 3 part 1 (functions 3.1 to 3.10): cardiovascular risk assessments, the screening calendar, screening packages.
--
-- Founder waiver of the S40 gate recorded 2026-10-07 for this session. Timestamp note: the local clock read earlier than the newest
-- migration file (20261007120347), so the stamps for this session were chosen by hand to sort after it, and live list_migrations was
-- checked for collisions first (latest live version equalled the newest file).
--
-- Live counts before this migration: risk_assessments, risk_instrument_versions, screening_rule_sets, screening_packages do not exist;
-- 0 screening_schedules rows use 'not_applicable' (the value is new); 0 lab_orders are home-collected with a sensitive test.
--
-- What this does (nothing is signed, nothing is switched on):
--   1. risk_instrument_versions + risk_assessments (INV-16: instrument_version_id NOT NULL on every row). The WHO 2019 chart instrument is
--      seeded UNSIGNED with NO coefficients (the appendix tables could not be obtained and an agent must not invent them). It can only be
--      signed once coefficients are present, and a scored row can only be written when the go-live guard is on (or for a test patient).
--   2. Reassessment reasons (yearly, or after a major change) and a nightly sweep that emits risk.reassessment_due.
--   3. screening_rule_sets (versioned, CMO-signable, seeded as a verbatim copy of the live catalogue, unsigned), the not_applicable state with
--      stored reasons, set_screening_state / reopen_screening, the nightly screening-scheduler.
--   4. screening_packages over panel_bundles, list_screening_packages (price and rate card before checkout), HPV DNA dormant behind a guard.
--   5. A home-collection guard: no HIV, hepatitis or STI kit is collected at home until a human-disclosure path is attested.
--   6. Four go-live guards (all off) and three event types (ids only, INV-07).

-- ---------------------------------------------------------------------------
-- 1. Risk instrument versions
-- ---------------------------------------------------------------------------
create table public.risk_instrument_versions (
  id           uuid primary key default gen_random_uuid(),
  code         text not null check (btrim(code) <> ''),
  version      integer not null check (version >= 1),
  config       jsonb not null check (jsonb_typeof(config) = 'object'),
  notes        text,
  approved_by  uuid references public.clinical_staff (id) on delete restrict,
  approved_at  timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (code, version),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index risk_instrument_versions_one_active on public.risk_instrument_versions (code) where is_active;

-- who-cvd-config-begin
insert into public.risk_instrument_versions (code, version, notes, config)
values ('who_cvd_2019_wssa', 1,
  'PROPOSED, UNSIGNED. WHO 2019 cardiovascular risk charts, Western sub-Saharan Africa (Lancet Glob Health 2019;7:e1332-45). No coefficients are loaded: the appendix tables were not obtained. Bands, age range and cut-offs are from the CMO sign-off pack and still need the CMO.',
  $json${
 "instrument": "who_cvd_2019_wssa",
 "regionLabel": "Western sub-Saharan Africa",
 "regionCheckedForNigeria": false,
 "coefficientsVerified": false,
 "ageRange": { "min": 40, "max": 74 },
 "bands": [
  { "code": "lt5", "lowPct": 0, "highPct": 5, "tier": "low" },
  { "code": "5to10", "lowPct": 5, "highPct": 10, "tier": "low_moderate" },
  { "code": "10to20", "lowPct": 10, "highPct": 20, "tier": "moderate" },
  { "code": "20to30", "lowPct": 20, "highPct": 30, "tier": "high" },
  { "code": "ge30", "lowPct": 30, "highPct": null, "tier": "very_high" }
 ],
 "nonLabFurtherAssessmentAtOrAbovePct": 10,
 "treatmentAlreadyIndicated": { "systolicAtOrAbove": 160, "diastolicAtOrAbove": 100, "establishedCvd": true },
 "knownDiabetes": "route_to_diabetes_pathway",
 "models": {
  "lab": { "male": null, "female": null },
  "non_lab": { "male": null, "female": null }
 },
 "modelShape": "Each sex entry: { baselineSurvival: number, terms: [ { coef: number, factors: [ { var: age|sbp|smoker|diabetes|total_chol_mmol|bmi, center: number } ] } ] }. Risk = 1 - baselineSurvival ^ exp(sum of coef * product of (var - center)).",
 "reassess": {
  "afterDays": 365,
  "majorChanges": [ "new_chronic_condition", "smoking_status_change", "bp_at_or_above_160_100" ]
 }
}$json$::jsonb);
-- who-cvd-config-end

create function private.risk_instrument_signed(p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.risk_instrument_versions where code = p_code and is_active and approved_by is not null) $$;
revoke all on function private.risk_instrument_signed(text) from public, anon, authenticated;

-- Signing is the CMO's act and is refused while the instrument has no coefficients (nothing to sign).
create function public.sign_risk_instrument(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_cfg jsonb; v_code text; v_m text; v_s text;
begin
  select config, code into v_cfg, v_code from public.risk_instrument_versions where id = p_id;
  if v_cfg is null then raise exception 'Risk instrument version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign a risk instrument'; end if;
  if coalesce((v_cfg ->> 'coefficientsVerified')::boolean, false) is not true then
    raise exception 'coefficients_not_verified: this version has no verified coefficients, so there is nothing to sign';
  end if;
  foreach v_m in array array['lab', 'non_lab'] loop
    foreach v_s in array array['male', 'female'] loop
      if jsonb_typeof(v_cfg -> 'models' -> v_m -> v_s) is distinct from 'object'
         or jsonb_typeof(v_cfg -> 'models' -> v_m -> v_s -> 'baselineSurvival') is distinct from 'number'
         or jsonb_typeof(v_cfg -> 'models' -> v_m -> v_s -> 'terms') is distinct from 'array' then
        raise exception 'coefficients_missing: model % for % is not complete', v_m, v_s;
      end if;
    end loop;
  end loop;
  update public.risk_instrument_versions set is_active = false where code = v_code and is_active and id <> p_id;
  update public.risk_instrument_versions set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('risk_instrument.signed', 'risk_instrument_versions', p_id, jsonb_build_object('code', v_code));
  return p_id;
end $$;
revoke all on function public.sign_risk_instrument(uuid) from public, anon;
grant execute on function public.sign_risk_instrument(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Risk assessments (append only, one row per run, always names its instrument version)
-- ---------------------------------------------------------------------------
create table public.risk_assessments (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id),
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  instrument_code       text not null,
  instrument_version_id uuid not null references public.risk_instrument_versions (id),
  status                text not null check (status in ('scored', 'not_scored_instrument_off', 'not_scored_age_out_of_range',
                          'not_scored_known_diabetes', 'not_scored_treatment_indicated', 'not_scored_insufficient_data')),
  model                 text check (model in ('lab', 'non_lab')),
  inputs                jsonb not null default '{}'::jsonb,
  band_code             text,
  band_low_pct          numeric,
  band_high_pct         numeric,
  tier                  text,
  further_assessment    boolean not null default false,
  trigger               text not null default 'manual' check (trigger in ('initial', 'yearly', 'major_change', 'manual')),
  reassessment_reasons  text[] not null default '{}',
  source                text not null default 'app' check (source in ('app', 'clinician', 'system')),
  recorded_by           uuid references public.profiles (id) on delete set null,
  assessed_at           timestamptz not null default now(),
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  -- a scored row carries a band and a tier; a not-scored row carries neither (a refusal is never dressed up as a result)
  check ((status = 'scored') = (band_code is not null and tier is not null and model is not null)),
  check (status = 'scored' or (band_low_pct is null and band_high_pct is null and further_assessment = false))
);
create index risk_assessments_patient_idx on public.risk_assessments (patient_id, assessed_at desc);

create function private.risk_assessments_append_only() returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'risk_assessments is append only (a new assessment is a new row)' using errcode = '55000';
end $$;
create trigger risk_assessments_no_change before update or delete on public.risk_assessments
  for each row execute function private.risk_assessments_append_only();

alter table public.risk_assessments enable row level security;
alter table public.risk_instrument_versions enable row level security;
-- A patient reads their own rows. Staff read through the audited function below (INV-10, INV-12), never the table.
create policy risk_assessments_patient_read on public.risk_assessments for select to authenticated using (patient_id = (select auth.uid()));
create policy risk_instrument_versions_read on public.risk_instrument_versions for select to authenticated using (true);
revoke all on public.risk_assessments, public.risk_instrument_versions from public, anon, authenticated;
grant select on public.risk_assessments, public.risk_instrument_versions to authenticated;

-- The one writer. Service role only: the server loads the record through the audited path, runs the pure engine, and names the band.
-- The database resolves band limits and tier from the version's own config and re-derives the further-assessment flag.
create function public.record_risk_assessment(
  p_patient uuid, p_version_id uuid, p_status text, p_model text, p_inputs jsonb, p_band_code text,
  p_trigger text, p_reasons text[], p_recorded_by uuid default null
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_ver public.risk_instrument_versions%rowtype;
  v_prof public.profiles%rowtype;
  v_band jsonb; v_low numeric; v_high numeric; v_tier text; v_further boolean := false; v_id uuid;
begin
  select * into v_ver from public.risk_instrument_versions where id = p_version_id;
  if not found then raise exception 'risk_instrument_version_required' using errcode = '22023'; end if;
  select * into v_prof from public.profiles where id = p_patient;
  if not found or v_prof.organisation_id is null then raise exception 'patient_not_found' using errcode = '22023'; end if;
  if p_status = 'scored' then
    -- INV-14, server side: nothing is scored for a real person until the guard is on and the version is signed. A test patient passes.
    if not private.go_live_open_patient('risk_instrument_who2019_enabled', p_patient) then
      raise exception 'not_live: the cardiovascular risk instrument is not switched on' using errcode = 'P0001';
    end if;
    if not (v_ver.is_active and v_ver.approved_by is not null) and coalesce(v_prof.is_test, false) is not true then
      raise exception 'not_live: this instrument version is not signed' using errcode = 'P0001';
    end if;
    select b into v_band from jsonb_array_elements(v_ver.config -> 'bands') b where b ->> 'code' = p_band_code;
    if v_band is null then raise exception 'unknown_band' using errcode = '22023'; end if;
    v_low := (v_band ->> 'lowPct')::numeric; v_high := (v_band ->> 'highPct')::numeric; v_tier := v_band ->> 'tier';
    v_further := p_model = 'non_lab' and v_low >= coalesce((v_ver.config ->> 'nonLabFurtherAssessmentAtOrAbovePct')::numeric, 10);
  end if;
  insert into public.risk_assessments (organisation_id, patient_id, instrument_code, instrument_version_id, status, model, inputs,
      band_code, band_low_pct, band_high_pct, tier, further_assessment, trigger, reassessment_reasons, source, recorded_by, is_test)
  values (v_prof.organisation_id, p_patient, v_ver.code, v_ver.id, p_status, case when p_status = 'scored' then p_model end, coalesce(p_inputs, '{}'::jsonb),
      case when p_status = 'scored' then p_band_code end, v_low, v_high, v_tier, v_further, p_trigger, coalesce(p_reasons, '{}'),
      'app', p_recorded_by, coalesce(v_prof.is_test, false))
  returning id into v_id;
  perform private.emit_domain_event('risk.assessed', v_prof.organisation_id, jsonb_build_object('risk_assessment_id', v_id),
      'risk.assessed:' || v_id, p_patient, 'risk_assessment', v_id);
  return v_id;
end $$;
revoke all on function public.record_risk_assessment(uuid, uuid, text, text, jsonb, text, text, text[], uuid) from public, anon, authenticated;
grant execute on function public.record_risk_assessment(uuid, uuid, text, text, jsonb, text, text, text[], uuid) to service_role;

-- Staff read, audited and tied to the patient (INV-10, INV-12).
create function public.clinician_read_risk_assessments(p_patient uuid) returns setof public.risk_assessments
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.clinician_has_patient_access(p_patient) then
    raise exception 'not_authorised: no active task, lead assignment or page for this patient' using errcode = '42501';
  end if;
  perform private.log_audit('risk_assessments.read', 'profiles', p_patient, '{}'::jsonb);
  return query select * from public.risk_assessments where patient_id = p_patient order by assessed_at desc;
end $$;
revoke all on function public.clinician_read_risk_assessments(uuid) from public, anon;
grant execute on function public.clinician_read_risk_assessments(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reassessment: yearly, or after a major change (3.3)
-- ---------------------------------------------------------------------------
create function private.risk_reassessment_reasons(p_patient uuid) returns text[]
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_last public.risk_assessments%rowtype;
  v_cfg jsonb;
  v_days integer;
  v_changes jsonb;
  v_out text[] := '{}';
  v_smoke text;
begin
  select * into v_last from public.risk_assessments where patient_id = p_patient order by assessed_at desc limit 1;
  if not found then return '{}'; end if;
  select config into v_cfg from public.risk_instrument_versions where id = v_last.instrument_version_id;
  v_days := coalesce((v_cfg -> 'reassess' ->> 'afterDays')::integer, 365);
  v_changes := coalesce(v_cfg -> 'reassess' -> 'majorChanges', '[]'::jsonb);
  if v_last.assessed_at < now() - make_interval(days => v_days) then v_out := array_append(v_out, 'yearly'); end if;
  if v_changes ? 'new_chronic_condition' and exists (
       select 1 from public.care_plans cp where cp.patient_id = p_patient and cp.created_at > v_last.assessed_at
          and cp.condition in ('hypertension', 'diabetes', 'cardiovascular', 'ckd', 'heart_failure')) then
    v_out := array_append(v_out, 'new_chronic_condition');
  end if;
  if v_changes ? 'smoking_status_change' then
    select r.response into v_smoke from public.risk_assessment_responses r
     where r.profile_id = p_patient and r.question_key = 'smoking_status' and r.created_at > v_last.assessed_at
     order by r.created_at desc limit 1;
    if v_smoke is not null and (v_smoke = 'current') is distinct from coalesce((v_last.inputs ->> 'smoker')::boolean, false) then
      v_out := array_append(v_out, 'smoking_status_change');
    end if;
  end if;
  if v_changes ? 'bp_at_or_above_160_100' and exists (
       select 1 from public.vitals_readings v where v.patient_id = p_patient and v.vital_type = 'blood_pressure' and v.taken_at > v_last.assessed_at
          and (v.systolic >= 160 or v.diastolic >= 100)) then
    v_out := array_append(v_out, 'bp_at_or_above_160_100');
  end if;
  return v_out;
end $$;
revoke all on function private.risk_reassessment_reasons(uuid) from public, anon, authenticated;

create function public.my_risk_reassessment_due() returns text[]
language sql stable security definer set search_path = ''
as $$ select private.risk_reassessment_reasons((select auth.uid())) $$;
revoke all on function public.my_risk_reassessment_due() from public, anon;
grant execute on function public.my_risk_reassessment_due() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Screening calendar: versioned rules, not_applicable, scheduler
-- ---------------------------------------------------------------------------
create table public.screening_rule_sets (
  id           uuid primary key default gen_random_uuid(),
  code         text not null default 'screening_rules',
  version      integer not null check (version >= 1),
  config       jsonb not null check (jsonb_typeof(config -> 'rules') = 'array'),
  notes        text,
  approved_by  uuid references public.clinical_staff (id) on delete restrict,
  approved_at  timestamptz,
  is_active    boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (code, version),
  check ((approved_by is null) = (approved_at is null)),
  check (not is_active or approved_by is not null)
);
create unique index screening_rule_sets_one_active on public.screening_rule_sets (code) where is_active;

-- v1 is a verbatim copy of the live catalogue (zero clinical change). Optional and pregnancy-gated items are never auto-scheduled.
insert into public.screening_rule_sets (version, notes, config)
select 1,
  'PROPOSED, UNSIGNED. Verbatim copy of screen_types at the time of S45. Cervical keeps the live rule (female, 25 to 65, every 36 months); the CMO still has to confirm it against the national HPV DNA targets (OQ-S45-4). Prostate stays optional. Nothing is scheduled by the nightly job until the CMO signs.',
  jsonb_build_object('rules', coalesce(jsonb_agg(jsonb_build_object(
    'code', st.code, 'sex', st.sex_applicability::text, 'ageFrom', st.age_from, 'ageTo', st.age_to,
    'frequencyMonths', st.frequency_months, 'oncePerLifetime', st.once_per_lifetime, 'isOptional', st.is_optional,
    'autoSchedule', (not st.is_optional and st.code <> 'antenatal_booking')) order by st.code), '[]'::jsonb))
from public.screen_types st where st.is_active;

create function private.screening_rules_signed() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.screening_rule_sets where is_active and approved_by is not null) $$;
revoke all on function private.screening_rules_signed() from public, anon, authenticated;

create function public.sign_screening_rule_set(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid; v_code text;
begin
  select code into v_code from public.screening_rule_sets where id = p_id;
  if v_code is null then raise exception 'Screening rule set not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the screening rules'; end if;
  update public.screening_rule_sets set is_active = false where code = v_code and is_active and id <> p_id;
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('screening_rules.signed', 'screening_rule_sets', p_id, '{}'::jsonb);
  return p_id;
end $$;
revoke all on function public.sign_screening_rule_set(uuid) from public, anon;
grant execute on function public.sign_screening_rule_set(uuid) to authenticated;

alter table public.screening_rule_sets enable row level security;
create policy screening_rule_sets_read on public.screening_rule_sets for select to authenticated using (true);
revoke all on public.screening_rule_sets from public, anon, authenticated;
grant select on public.screening_rule_sets to authenticated;

-- not_applicable with stored reasons, beside the existing declined (INV: a status change carries proof)
alter table public.screening_schedules
  add column rule_set_id uuid references public.screening_rule_sets (id),
  add column not_applicable_at timestamptz,
  add column not_applicable_reason text,
  add column closed_reason_code text check (closed_reason_code in
    ('already_done_elsewhere', 'not_relevant_to_me', 'medical_reason', 'cost', 'prefer_not_to_say', 'other'));
alter table public.screening_schedules add constraint screening_schedules_not_applicable_requires_reason
  check ((status = 'not_applicable') = (not_applicable_at is not null and not_applicable_reason is not null and length(trim(not_applicable_reason)) > 0));

-- a declined OR not-applicable item is never re-created by a later run (extends the S-decline trigger)
create or replace function private.block_screening_schedule_after_decline() returns trigger
language plpgsql security definer set search_path = ''
as $function$
begin
  if new.status = 'pending' and exists (
    select 1 from public.screening_schedules
     where patient_id = new.patient_id and screen_type_id = new.screen_type_id and status in ('declined', 'not_applicable')
  ) then
    return null;
  end if;
  return new;
exception when others then
  return new;
end $function$;

create function public.set_screening_state(p_schedule uuid, p_state text, p_reason_code text, p_note text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_row public.screening_schedules%rowtype;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into v_row from public.screening_schedules where id = p_schedule;
  if not found then raise exception 'schedule_not_found' using errcode = '22023'; end if;
  if v_row.patient_id <> v_uid and not private.clinician_has_patient_access(v_row.patient_id) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  if p_state not in ('declined', 'not_applicable') then raise exception 'state_must_be_declined_or_not_applicable' using errcode = '22023'; end if;
  if p_reason_code is null or btrim(coalesce(p_note, '')) = '' then raise exception 'reason_required' using errcode = '22023'; end if;
  if v_row.status in ('completed', 'cancelled') then raise exception 'already_closed' using errcode = '22023'; end if;
  update public.screening_schedules set
      status = p_state::public.screening_status,
      closed_reason_code = p_reason_code,
      declined_at = case when p_state = 'declined' then now() end,
      declined_reason = case when p_state = 'declined' then p_note end,
      not_applicable_at = case when p_state = 'not_applicable' then now() end,
      not_applicable_reason = case when p_state = 'not_applicable' then p_note end
   where id = p_schedule;
  perform private.log_audit('screening.' || p_state, 'screening_schedules', p_schedule, jsonb_build_object('reason_code', p_reason_code));
  return p_schedule;
end $$;
revoke all on function public.set_screening_state(uuid, text, text, text) from public, anon;
grant execute on function public.set_screening_state(uuid, text, text, text) to authenticated;

create function public.reopen_screening(p_schedule uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_row public.screening_schedules%rowtype;
begin
  select * into v_row from public.screening_schedules where id = p_schedule;
  if not found or v_row.patient_id <> v_uid then raise exception 'not_authorised' using errcode = '42501'; end if;
  if v_row.status not in ('declined', 'not_applicable') then raise exception 'not_closed' using errcode = '22023'; end if;
  update public.screening_schedules set status = 'pending', closed_reason_code = null, declined_at = null, declined_reason = null,
      not_applicable_at = null, not_applicable_reason = null where id = p_schedule;
  perform private.log_audit('screening.reopened', 'screening_schedules', p_schedule, '{}'::jsonb);
  return p_schedule;
end $$;
revoke all on function public.reopen_screening(uuid) from public, anon;
grant execute on function public.reopen_screening(uuid) to authenticated;

-- What a patient is due for under one rule set (pure read; the scheduler and the proofs call it).
create function private.screening_due(p_patient uuid, p_rule_set uuid)
returns table (screen_type_id uuid, screen_type_code text, due_date date, reason text)
language plpgsql stable security definer set search_path = ''
as $$
declare v_sex text; v_dob date; v_age integer; v_cfg jsonb;
begin
  select pr.sex::text, pr.date_of_birth into v_sex, v_dob from public.profiles pr where pr.id = p_patient;
  select config into v_cfg from public.screening_rule_sets where id = p_rule_set;
  if v_dob is null or v_sex is null or v_cfg is null then return; end if;
  v_age := extract(year from age(current_date, v_dob))::integer;
  return query
  select st.id, st.code,
         case when lc.last_done is null then current_date else (lc.last_done + make_interval(months => r."frequencyMonths"))::date end,
         case when lc.last_done is null then 'first_due' else 'recurrence' end
    from jsonb_to_recordset(v_cfg -> 'rules') as r(code text, sex text, "ageFrom" integer, "ageTo" integer, "frequencyMonths" integer,
                                                   "oncePerLifetime" boolean, "isOptional" boolean, "autoSchedule" boolean)
    join public.screen_types st on st.code = r.code and st.is_active
    left join lateral (
      select max(d) as last_done from (
        select ss.due_date as d from public.screening_schedules ss
         where ss.patient_id = p_patient and ss.screen_type_id = st.id and ss.status = 'completed'
        union all
        select sc.performed_date from public.screening_completions sc where sc.patient_id = p_patient and sc.screen_type_id = st.id) x) lc on true
   where coalesce(r."autoSchedule", false) and not coalesce(r."isOptional", false)
     and (r.sex = 'all' or r.sex = v_sex)
     and (r."ageFrom" is null or v_age >= r."ageFrom")
     and (r."ageTo" is null or v_age <= r."ageTo")
     and not (lc.last_done is not null and (coalesce(r."oncePerLifetime", false) or r."frequencyMonths" is null))
     and not exists (select 1 from public.screening_schedules ss
                      where ss.patient_id = p_patient and ss.screen_type_id = st.id
                        and ss.status in ('pending', 'booked', 'overdue', 'declined', 'not_applicable'));
end $$;
revoke all on function private.screening_due(uuid, uuid) from public, anon, authenticated;

-- The nightly scheduler (function 3.4). Fails closed: with the guard off, or no signed rule set, it does nothing.
-- p_patient (proofs and the test pair rule only) lets a test patient run it against the latest rule set even while unsigned.
create function private.run_screening_scheduler(p_patient uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_set uuid; v_created integer := 0; v_events integer := 0; r record; v_reasons text[];
begin
  if p_patient is null then
    if not private.go_live_guard_on('screening_scheduler_enabled') then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets where is_active and approved_by is not null limit 1;
  else
    if not private.go_live_open_patient('screening_scheduler_enabled', p_patient) then return jsonb_build_object('ran', false, 'reason', 'guard_off'); end if;
    select id into v_set from public.screening_rule_sets
     where (is_active and approved_by is not null)
        or (exists (select 1 from public.profiles where id = p_patient and is_test))
     order by (is_active and approved_by is not null) desc, version desc limit 1;
  end if;
  if v_set is null then return jsonb_build_object('ran', false, 'reason', 'rules_not_signed'); end if;

  for r in
    with due as (
      select p.id as patient_id, p.organisation_id, d.*
        from public.profiles p
        cross join lateral private.screening_due(p.id, v_set) d
       where p.role = 'patient' and p.is_active and p.organisation_id is not null
         and (p_patient is null or p.id = p_patient)
    ), ins as (
      insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
      select organisation_id, patient_id, screen_type_id, 'pending', due_date, v_set from due
      returning id, organisation_id, patient_id, due_date
    )
    select * from ins
  loop
    v_created := v_created + 1;
    if r.due_date <= current_date + 30 then
      perform private.emit_domain_event('screening.due', r.organisation_id, jsonb_build_object('screening_schedule_id', r.id),
        'screening.due:' || r.id, r.patient_id, 'screening_schedule', r.id);
      v_events := v_events + 1;
    end if;
  end loop;

  -- reassessment prompts ride the same nightly run (only while the risk guard is on)
  if p_patient is null and private.go_live_guard_on('risk_instrument_who2019_enabled') then
    for r in select distinct ra.patient_id, ra.organisation_id from public.risk_assessments ra loop
      v_reasons := private.risk_reassessment_reasons(r.patient_id);
      if cardinality(v_reasons) > 0 then
        perform private.emit_domain_event('risk.reassessment_due', r.organisation_id, jsonb_build_object('patient_ref', r.patient_id),
          'risk.reassessment_due:' || r.patient_id || ':' || to_char(current_date, 'YYYY'), r.patient_id, 'profile', r.patient_id);
      end if;
    end loop;
  end if;
  return jsonb_build_object('ran', true, 'rule_set_id', v_set, 'created', v_created, 'events', v_events);
end $$;
revoke all on function private.run_screening_scheduler(uuid) from public, anon, authenticated;

select cron.schedule('screening-scheduler', '15 2 * * *', $$select private.run_screening_scheduler()$$);

-- ---------------------------------------------------------------------------
-- 5. Packages over panel_bundles (3.6 to 3.8, 3.10). Names are provisional (OQ-S45-3); the bundled video consult is dropped (S25 membership).
-- ---------------------------------------------------------------------------
create table public.screening_packages (
  id                         uuid primary key default gen_random_uuid(),
  code                       text not null unique check (code in ('essential', 'preventive', 'full_screen', 'annual_health_check', 'hpv_dna')),
  panel_bundle_id            uuid references public.panel_bundles (id),
  extra_test_codes           text[] not null default '{}',
  eligibility                jsonb not null default '{}'::jsonb,
  requires_positive_pathway  boolean not null default false,
  guard_key                  text,
  name_status                text not null default 'provisional' check (name_status in ('provisional', 'confirmed')),
  is_active                  boolean not null default false,
  created_at                 timestamptz not null default now()
);
alter table public.screening_packages enable row level security;
create policy screening_packages_read on public.screening_packages for select to authenticated using (true);
revoke all on public.screening_packages from public, anon, authenticated;
grant select on public.screening_packages to authenticated;

insert into public.screening_packages (code, panel_bundle_id, eligibility, is_active)
select v.code, (select id from public.panel_bundles where code = v.bundle), v.elig::jsonb,
       coalesce((select is_active from public.panel_bundles where code = v.bundle), false)
  from (values
    ('essential', 'screen_essential', '{"ageFrom":18}'),
    ('preventive', 'screen_core', '{"ageFrom":18}'),
    ('full_screen', 'screen_comprehensive', '{"ageFrom":18}'),
    ('annual_health_check', 'annual_health_check', '{"ageFrom":18}')) as v(code, bundle, elig);
-- HPV DNA: standalone, dormant. Needs a positive-result pathway (colposcopy, treatment, confirmatory testing) before it is sold.
insert into public.screening_packages (code, panel_bundle_id, extra_test_codes, eligibility, requires_positive_pathway, guard_key, is_active)
values ('hpv_dna', null, array['hpv_dna'], '{"sex":"female","ageFrom":25,"ageTo":65}', true, 'hpv_dna_enabled', false);

-- What the checkout shows before payment: eligibility, price, the partner rate card per test. The checkout itself is S25's.
create function public.list_screening_packages() returns table (
  code text, name text, name_status text, price_kobo bigint, test_codes text[], includes_sensitive boolean,
  eligible boolean, ineligible_reason text, rate_card jsonb)
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_sex text; v_dob date; v_age integer;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select pr.sex::text, pr.date_of_birth into v_sex, v_dob from public.profiles pr where pr.id = v_uid;
  v_age := case when v_dob is null then null else extract(year from age(current_date, v_dob))::integer end;
  return query
  select p.code, coalesce(b.name, 'HPV DNA'), p.name_status, coalesce(b.price_kobo, 0)::bigint,
         coalesce(b.test_codes, '{}') || p.extra_test_codes,
         exists (select 1 from public.screen_types st where st.code = any (coalesce(b.test_codes, '{}') || p.extra_test_codes) and st.sensitive),
         ok.eligible, ok.reason,
         coalesce((select jsonb_agg(jsonb_build_object('code', st.code, 'name', st.name, 'price_kobo', st.price_kobo) order by st.code)
                     from public.screen_types st where st.code = any (coalesce(b.test_codes, '{}') || p.extra_test_codes)), '[]'::jsonb)
    from public.screening_packages p
    left join public.panel_bundles b on b.id = p.panel_bundle_id
    cross join lateral (
      select case
          when p.guard_key is not null and not private.go_live_open_patient(p.guard_key, v_uid) then false
          when p.eligibility ->> 'sex' is not null and p.eligibility ->> 'sex' is distinct from v_sex then false
          when v_age is null then false
          when (p.eligibility ->> 'ageFrom') is not null and v_age < (p.eligibility ->> 'ageFrom')::integer then false
          when (p.eligibility ->> 'ageTo') is not null and v_age > (p.eligibility ->> 'ageTo')::integer then false
          else true end as eligible,
        case
          when p.guard_key is not null and not private.go_live_open_patient(p.guard_key, v_uid) then 'not_available_yet'
          when p.eligibility ->> 'sex' is not null and p.eligibility ->> 'sex' is distinct from v_sex then 'not_for_you'
          when v_age is null then 'date_of_birth_needed'
          when (p.eligibility ->> 'ageFrom') is not null and v_age < (p.eligibility ->> 'ageFrom')::integer then 'age'
          when (p.eligibility ->> 'ageTo') is not null and v_age > (p.eligibility ->> 'ageTo')::integer then 'age'
          else null end as reason) ok
   where (p.is_active and (b.id is null or b.is_active)) or p.guard_key is not null;
end $$;
revoke all on function public.list_screening_packages() from public, anon;
grant execute on function public.list_screening_packages() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Home collection: no sensitive kit without a human-disclosure path (3.9)
-- ---------------------------------------------------------------------------
create function private.lab_orders_home_sensitive_kit_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_codes text[];
begin
  if new.home_visit_provider_id is null and new.home_visit_scheduled_at is null and new.courier_reference is null then return new; end if;
  select array(select unnest(coalesce(b.test_codes, '{}')) except select jsonb_array_elements_text(coalesce(new.excluded_test_codes, '[]'::jsonb)))
    into v_codes from public.panel_bundles b where b.id = new.panel_bundle_id;
  if v_codes && array['hiv', 'hep_b', 'hep_c', 'syphilis', 'chlamydia_gonorrhoea'] then
    if not private.go_live_open_patient('home_kit_sensitive_enabled', new.patient_id) then
      raise exception 'home_kit_sensitive_not_live: HIV, hepatitis and STI tests are not collected at home until a clinician disclosure path is confirmed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
create trigger lab_orders_zz_home_sensitive_kit_guard before insert or update of home_visit_provider_id, home_visit_scheduled_at, courier_reference, panel_bundle_id, excluded_test_codes on public.lab_orders
  for each row execute function private.lab_orders_home_sensitive_kit_guard();

-- ---------------------------------------------------------------------------
-- 7. Events (ids only, INV-07) and the four guards (all off, INV-14)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('risk.assessed', 'A cardiovascular risk assessment row was written (scored or refused)', 'S45', false),
  ('risk.reassessment_due', 'A patient is due a risk reassessment (yearly or after a major change)', 'S45', false),
  ('screening.due', 'A screening item became due on the patient calendar', 'S45', false);
insert into public.event_type_versions (event_type, version, required_keys) values
  ('risk.assessed', 1, array['risk_assessment_id']),
  ('risk.reassessment_due', 1, array['patient_ref']),
  ('screening.due', 1, array['screening_schedule_id']);

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('risk_instrument_who2019_enabled', 'Cardiovascular risk estimate (WHO 2019 charts)', 'A scored cardiovascular risk band',
   'CMO has signed an instrument version with verified coefficients; region mapping for Nigeria confirmed', 'cmo',
   array['record_risk_assessment (a scored row)'], 'The legacy AFRO estimate on the clinician panel is not behind this guard.'),
  ('screening_scheduler_enabled', 'Nightly screening scheduler', 'Automatic calendar items from the signed screening rules',
   'CMO has signed the screening rule set', 'cmo', array['run_screening_scheduler'], 'App-driven scheduling on a risk assessment is unchanged.'),
  ('hpv_dna_enabled', 'HPV DNA test', 'Sale of the standalone HPV DNA test',
   'A positive-result pathway (colposcopy, treatment, confirmatory testing) is attested by the CMO', 'cmo',
   array['list_screening_packages (shown as not available)'], 'No checkout exists yet (S25 owns it); this guard only hides the package.'),
  ('home_kit_sensitive_enabled', 'Home HIV, hepatitis and STI collection', 'Home collection of a bundle containing hiv, hep_b, hep_c, syphilis or chlamydia_gonorrhoea',
   'A clinician human-disclosure path for reactive results is attested by the CMO', 'cmo',
   array['lab_orders_zz_home_sensitive_kit_guard'], 'Collection at a partner site is not behind this guard.');

-- ---------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if private.risk_instrument_signed('who_cvd_2019_wssa') then raise exception 'S45 self-check: the instrument must start unsigned'; end if;
  if private.screening_rules_signed() then raise exception 'S45 self-check: the screening rules must start unsigned'; end if;
  select count(*) into v_n from public.go_live_guards where key in ('risk_instrument_who2019_enabled', 'screening_scheduler_enabled', 'hpv_dna_enabled', 'home_kit_sensitive_enabled') and is_on;
  if v_n > 0 then raise exception 'S45 self-check: a new guard is on'; end if;
  if has_table_privilege('anon', 'public.risk_assessments', 'SELECT') or has_table_privilege('authenticated', 'public.risk_assessments', 'INSERT') then
    raise exception 'S45 self-check: risk_assessments grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.record_risk_assessment(uuid,uuid,text,text,jsonb,text,text,text[],uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_risk_assessment(uuid,uuid,text,text,jsonb,text,text,text[],uuid)', 'EXECUTE') then
    raise exception 'S45 self-check: record_risk_assessment must be service role only';
  end if;
  if (select count(*) from public.screening_rule_sets where version = 1) <> 1 then raise exception 'S45 self-check: rule set seed missing'; end if;
end $$;

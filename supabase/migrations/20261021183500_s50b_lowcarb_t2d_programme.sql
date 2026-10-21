-- S50b part 2: the clinician-supervised low-carbohydrate programme for type 2 diabetes (v5 spec 6.10, founder decision S50-2).
-- Design: docs/design/S50b-lowcarb.md.
--
-- BUILT END TO END, LIVE FOR NOBODY. The go-live guard low_carb_t2d_programme is born OFF and its conditions are a signed protocol config, an approved
-- diabetes step table, a recorded doctor and dietitian rota and a recorded decision on the cost of ketone testing. Nothing here signs or attests anything.
--
-- LIVE COUNTS BEFORE (2026-10-21): the programme does not exist anywhere; every table below is new, so no data-conversion step exists.
--
-- What this adds:
--   1. lowcarb_protocol_config: versioned, PROPOSED, UNSIGNED, INACTIVE (same shape as nutrition_target_config). Eligibility and exclusions, check-in
--      cadence, the glucose and ketone lines that pause the programme, when a doctor must review medicines, and the stop rules. Every number is the CMO's.
--   2. private.lowcarb_eligibility_for(): the enforcing twin of packages/clinical lowcarb-programme.ts. A clinician door (lowcarb_eligibility) that
--      shows a pregnancy-driven reason only to staff the category-scoped path entitles to reproductive health data, and a patient door
--      (my_lowcarb_gate) that answers only ok or unavailable, so "not live yet", "not enrolled" and "withheld" are one answer.
--   3. lowcarb_enrolments and lowcarb_programme_events. No API write path at all: every transition is a definer function. A patient cannot self-enrol:
--      a prescribing clinician tied to the patient offers it, the patient accepts or declines.
--   4. Safety: a red or amber triage event, a low glucose reading or a high ketone reading PAUSES an active enrolment and opens a medicine review task;
--      repeated pauses or lapsed check-ins STOP it. This sits beside the existing emergency and red path and does not replace or reroute it.
--   5. A review task type (lowcarb_medicine_review) and a DRAFT diabetes step table (protocols code t2d_lowcarb_deprescribing, v1). The platform only
--      PROPOSES: a proposal is a draft care_plan_changes row that a tied prescriber signs (INV-02). A draft table can drive a proposal for a test patient only.
--   6. Go-live guard low_carb_t2d_programme (born OFF) with its conditions branch, and the two attestation conditions a person may record.
--
-- Deliberately NOT here: any model call (INV-01), any message naming a reading or a condition (INV-07), any dose written by the platform, any cron job
-- (see OQ), any approval, signature, rota attestation or ketone cost decision.

-- ---------------------------------------------------------------------------
-- 1. Governed configuration
-- ---------------------------------------------------------------------------
create function private.lowcarb_config_valid(p_config jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare
  v_key text;
  v_val jsonb;
begin
  -- Every test is written so a missing key makes it FALSE, never NULL (a NULL would fall through an IF and let a broken config through).
  if p_config is null or jsonb_typeof(p_config) <> 'object' then return false; end if;
  if coalesce(jsonb_typeof(p_config -> 'eligibility'), '') <> 'object' or coalesce(jsonb_typeof(p_config -> 'check_ins'), '') <> 'object'
     or coalesce(jsonb_typeof(p_config -> 'safety'), '') <> 'object' or coalesce(jsonb_typeof(p_config -> 'medicine_review'), '') <> 'object' then
    return false;
  end if;
  if coalesce((p_config #>> '{eligibility,min_age_years}')::numeric, 0) < 18
     or coalesce((p_config #>> '{eligibility,postnatal_months}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{eligibility,severe_hypo_below_mmol}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{eligibility,hypo_lookback_days}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{eligibility,triage_lookback_hours}')::numeric, 0) <= 0
     or coalesce(jsonb_typeof(p_config #> '{eligibility,require_confirmed_type_2}'), '') <> 'boolean' then
    return false;
  end if;
  if coalesce(jsonb_typeof(p_config #> '{eligibility,condition_exclusions}'), '') <> 'object' then return false; end if;
  for v_key, v_val in select key, value from jsonb_each(p_config #> '{eligibility,condition_exclusions}') loop
    if coalesce(jsonb_typeof(v_val -> 'name_patterns'), '') <> 'array' or coalesce(jsonb_typeof(v_val -> 'icd10_prefixes'), '') <> 'array' then return false; end if;
  end loop;
  if coalesce(jsonb_typeof(p_config #> '{eligibility,medicine_groups}'), '') <> 'object' then return false; end if;
  for v_key, v_val in select key, value from jsonb_each(p_config #> '{eligibility,medicine_groups}') loop
    if coalesce(jsonb_typeof(v_val -> 'name_patterns'), '') <> 'array' or not coalesce((v_val ->> 'handling') = any (array['supervision', 'exclude']), false) then return false; end if;
  end loop;
  foreach v_key in array array['glucose', 'ketones', 'weight'] loop
    if coalesce((p_config #>> array['check_ins', v_key, 'per_week'])::numeric, 0) <= 0
       or coalesce((p_config #>> array['check_ins', v_key, 'max_gap_days'])::numeric, 0) <= 0 then
      return false;
    end if;
  end loop;
  if coalesce((p_config #>> '{safety,pause_glucose_below_mmol}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{safety,pause_ketones_at_or_above_mmol}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{safety,stop_after_pauses_in_30_days}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{safety,stop_if_checkins_missed_days}')::numeric, 0) <= 0 then
    return false;
  end if;
  if coalesce((p_config #>> '{medicine_review,window_days}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{medicine_review,min_readings}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{medicine_review,avg_glucose_below_mmol}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{medicine_review,any_glucose_below_mmol}')::numeric, 0) <= 0
     or coalesce((p_config #>> '{medicine_review,standing_review_days}')::numeric, 0) <= 0 then
    return false;
  end if;
  return true;
exception when others then
  return false;
end;
$$;
revoke all on function private.lowcarb_config_valid(jsonb) from public, anon, authenticated;

create table public.lowcarb_protocol_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique check (version >= 1),
  is_active   boolean not null default false,
  config      jsonb not null check (private.lowcarb_config_valid(config)),
  notes       text,
  approved_by uuid references public.clinical_staff (id),
  approved_at timestamptz,
  created_at  timestamptz not null default now(),
  check ((approved_by is null) = (approved_at is null)),
  -- an unsigned row is never the live one
  check (not is_active or approved_by is not null)
);
create unique index lowcarb_protocol_config_one_active on public.lowcarb_protocol_config (is_active) where is_active;
alter table public.lowcarb_protocol_config enable row level security;
revoke all on public.lowcarb_protocol_config from public, anon, authenticated;
grant select on public.lowcarb_protocol_config to authenticated;
-- Staff who sign it (and admin, read only) can read it. A patient receives only what my_lowcarb_gate() returns.
create policy lowcarb_protocol_config_read on public.lowcarb_protocol_config for select to authenticated
  using (exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active)
         or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));
create trigger refuse_superseded_activation before update of is_active on public.lowcarb_protocol_config
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- lowcarb-protocol-config-begin
insert into public.lowcarb_protocol_config (version, is_active, config, notes)
values (1, false, $json${
 "eligibility": {
  "min_age_years": 18,
  "postnatal_months": 12,
  "require_confirmed_type_2": true,
  "severe_hypo_below_mmol": 3.0,
  "hypo_lookback_days": 90,
  "triage_lookback_hours": 72,
  "condition_exclusions": {
   "type_1_diabetes": {"name_patterns": ["type 1", "type i diabetes", "lada"], "icd10_prefixes": ["E10"]},
   "kidney_disease": {"name_patterns": ["kidney", "renal", "ckd", "nephr"], "icd10_prefixes": ["N17", "N18", "N19"]},
   "pancreatitis": {"name_patterns": ["pancreatit"], "icd10_prefixes": ["K85", "K86"]},
   "liver_disease": {"name_patterns": ["cirrho", "liver failure"], "icd10_prefixes": ["K70", "K72", "K74"]},
   "ketoacidosis_history": {"name_patterns": ["ketoacidosis", "dka"], "icd10_prefixes": []}
  },
  "medicine_groups": {
   "insulin": {"name_patterns": ["insulin", "lantus", "humulin", "novorapid", "mixtard"], "handling": "supervision"},
   "sulfonylurea": {"name_patterns": ["glibenclamide", "gliclazide", "glimepiride", "glipizide", "daonil", "diamicron", "amaryl"], "handling": "supervision"},
   "sglt2_inhibitor": {"name_patterns": ["gliflozin", "jardiance", "forxiga", "invokana"], "handling": "exclude"}
  }
 },
 "check_ins": {
  "glucose": {"per_week": 14, "max_gap_days": 2},
  "ketones": {"per_week": 3, "max_gap_days": 4},
  "weight": {"per_week": 1, "max_gap_days": 9}
 },
 "safety": {
  "pause_glucose_below_mmol": 3.9,
  "pause_ketones_at_or_above_mmol": 3.0,
  "stop_after_pauses_in_30_days": 3,
  "stop_if_checkins_missed_days": 14
 },
 "medicine_review": {
  "window_days": 7,
  "min_readings": 5,
  "avg_glucose_below_mmol": 7.0,
  "any_glucose_below_mmol": 4.4,
  "standing_review_days": 14
 }
}$json$::jsonb,
        'PROPOSED, unsigned and INACTIVE. EVERY number, exclusion and medicine group is a placeholder for the Chief Medical Officer (S50-2). Without a signed active row the programme cannot be offered, accepted or shown: the gate answers unavailable. sign_lowcarb_protocol_config().');
-- lowcarb-protocol-config-end

create function public.sign_lowcarb_protocol_config(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.lowcarb_protocol_config where id = p_id) then raise exception 'Low-carbohydrate protocol config version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the low-carbohydrate protocol config'; end if;
  -- the old live row is retired and the new one signed and made live in the same statement pair, so the signed-and-active check holds throughout
  update public.lowcarb_protocol_config set is_active = false where is_active and id <> p_id;
  update public.lowcarb_protocol_config set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('lowcarb_protocol_config.signed', 'lowcarb_protocol_config', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_lowcarb_protocol_config(uuid) from public, anon;
grant execute on function public.sign_lowcarb_protocol_config(uuid) to authenticated;

create function private.lowcarb_cfg() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.lowcarb_protocol_config where is_active and approved_by is not null; $$;
revoke all on function private.lowcarb_cfg() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Eligibility (the enforcing twin of lowCarbEligibility in packages/clinical)
-- ---------------------------------------------------------------------------
-- Pregnancy and the postnatal year, as a yes/no only. Read here, inside a definer function, from the places pregnancy is held (the same four
-- places private.nutrition_targets_withheld reads). The answer reaches a clinician only through lowcarb_eligibility(), which turns it into
-- "health_condition" unless the category-scoped path entitles that clinician to reproductive_health.
create function private.lowcarb_pregnancy_state(p_patient uuid, p_months integer, p_now timestamptz default now()) returns text
language sql stable security definer set search_path = ''
as $$
  select case when
    coalesce((select p.is_pregnant from public.profiles p where p.id = p_patient), false)
    or exists (select 1 from public.patient_pregnancy pp where pp.patient_id = p_patient and pp.is_pregnant)
    or exists (select 1 from public.reproductive_health_profiles rp where rp.patient_id = p_patient and rp.life_stage in ('pregnant', 'postpartum'))
    or exists (select 1 from public.postnatal_profiles np where np.patient_id = p_patient
                and np.delivery_date > ((p_now at time zone 'Africa/Lagos')::date - make_interval(months => p_months))::date)
  then 'yes' else 'no' end
$$;
revoke all on function private.lowcarb_pregnancy_state(uuid, integer, timestamptz) from public, anon, authenticated;

create function private.lowcarb_eligibility_for(
  p_patient uuid, p_supervision_accepted boolean default false, p_no_admission boolean default false, p_now timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_cfg      jsonb := private.lowcarb_cfg();
  v_el       jsonb;
  v_hard     text[] := '{}';
  v_sup      text[] := '{}';
  v_today    date := (p_now at time zone 'Africa/Lagos')::date;
  v_dob      date;
  v_conf     text;
  v_rep      text;
  v_key      text;
  v_val      jsonb;
  v_decision text;
  v_reasons  text[];
begin
  if v_cfg is null then
    return jsonb_build_object('decision', 'unavailable', 'reasons', jsonb_build_array('rules_unavailable'), 'supervision_for', '[]'::jsonb);
  end if;
  v_el := v_cfg -> 'eligibility';

  select p.date_of_birth into v_dob from public.profiles p where p.id = p_patient;
  if v_dob is null then v_hard := array_append(v_hard, 'age_unknown');
  elsif extract(year from age(v_today, v_dob))::integer < (v_el ->> 'min_age_years')::integer then v_hard := array_append(v_hard, 'under_age');
  end if;

  select d.confirmed_type::text, d.patient_reported_type::text into v_conf, v_rep from public.patient_diabetes_profile d where d.patient_id = p_patient;
  if v_conf is not null then
    if v_conf <> 'type_2' then v_hard := array_append(v_hard, 'not_type_2'); end if;
  elsif (v_el ->> 'require_confirmed_type_2')::boolean then
    v_hard := array_append(v_hard, 'type_unconfirmed');
  elsif v_rep is not null and v_rep <> 'type_2' then
    v_hard := array_append(v_hard, 'not_type_2');
  end if;

  if private.lowcarb_pregnancy_state(p_patient, (v_el ->> 'postnatal_months')::integer, p_now) = 'yes' then
    v_hard := array_append(v_hard, 'pregnancy_or_postnatal');
  end if;

  if exists (select 1 from public.obesity_ed_screens e where e.patient_id = p_patient and e.positive) then
    v_hard := array_append(v_hard, 'eating_disorder_screen');
  end if;

  for v_key, v_val in select key, value from jsonb_each(v_el -> 'condition_exclusions') loop
    if exists (select 1 from private.patient_conditions_current pc
                where pc.patient_id = p_patient and pc.status::text not in ('resolved', 'historical')
                  and private.activity_condition_matches(pc.condition_name, pc.icd10_code, v_val)) then
      v_hard := array_append(v_hard, 'condition_' || v_key);
    end if;
  end loop;

  for v_key, v_val in select key, value from jsonb_each(v_el -> 'medicine_groups') loop
    if exists (select 1 from public.medications m
                where m.patient_id = p_patient and m.is_active and m.superseded_at is null
                  and exists (select 1 from jsonb_array_elements_text(v_val -> 'name_patterns') pat
                               where pat <> '' and position(lower(pat) in lower(m.drug_name)) > 0)) then
      if v_val ->> 'handling' = 'exclude' then v_hard := array_append(v_hard, 'medicine_' || v_key);
      else v_sup := array_append(v_sup, v_key);
      end if;
    end if;
  end loop;

  if exists (select 1 from private.vitals_readings_current v
              where v.patient_id = p_patient and v.vital_type = 'glucose' and v.glucose_mmol_l < (v_el ->> 'severe_hypo_below_mmol')::numeric
                and v.taken_at <= p_now and v.taken_at >= p_now - (v_el ->> 'hypo_lookback_days')::numeric * interval '1 day') then
    v_hard := array_append(v_hard, 'recent_severe_low_sugar');
  end if;
  if not coalesce(p_no_admission, false) then v_hard := array_append(v_hard, 'admission_not_ruled_out'); end if;

  if cardinality(v_hard) > 0 then
    v_decision := 'not_eligible'; v_reasons := v_hard;
  elsif exists (select 1 from public.triage_events te
                 where te.patient_id = p_patient and te.grade in ('amber', 'red')
                   and te.created_at <= p_now and te.created_at >= p_now - (v_el ->> 'triage_lookback_hours')::numeric * interval '1 hour') then
    v_decision := 'not_now'; v_reasons := array['recent_triage_event'];
  elsif cardinality(v_sup) > 0 and not coalesce(p_supervision_accepted, false) then
    v_decision := 'needs_supervision'; v_reasons := (select array_agg('supervision_' || s) from unnest(v_sup) s);
  else
    v_decision := 'eligible'; v_reasons := array['none'];
  end if;
  return jsonb_build_object('decision', v_decision,
    'reasons', (select coalesce(to_jsonb(array_agg(distinct r order by r)), '[]'::jsonb) from unnest(v_reasons) r),
    'supervision_for', to_jsonb(v_sup));
end;
$$;
revoke all on function private.lowcarb_eligibility_for(uuid, boolean, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Enrolments and events. No API write path: every transition is a definer function below.
-- ---------------------------------------------------------------------------
create table public.lowcarb_enrolments (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  status                      text not null default 'offered' check (status in ('offered', 'active', 'paused', 'stopped', 'declined', 'expired')),
  source                      public.record_source not null default 'clinician',
  recorded_by                 uuid references public.profiles (id) on delete restrict,
  offered_at                  timestamptz not null default now(),
  no_recent_admission         boolean not null check (no_recent_admission),
  supervision_accepted        boolean not null default false,
  supervision_note            text,
  config_version              integer not null,
  accepted_at                 timestamptz,
  paused_at                   timestamptz,
  pause_code                  text check (pause_code is null or pause_code in ('low_glucose', 'high_ketones', 'triage_event', 'no_longer_eligible', 'clinician')),
  stopped_at                  timestamptz,
  stop_code                   text check (stop_code is null or stop_code in ('patient_choice', 'clinician', 'repeated_pauses', 'check_ins_lapsed', 'no_longer_eligible', 'withdrawn')),
  last_medicine_review_at     timestamptz,
  is_test                     boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (supervision_note is null or length(btrim(supervision_note)) >= 10),
  check (status <> 'active' or accepted_at is not null),
  check (status <> 'paused' or pause_code is not null),
  check (status <> 'stopped' or (stop_code is not null and stopped_at is not null))
);
-- one open enrolment per person
create unique index lowcarb_enrolments_one_open on public.lowcarb_enrolments (patient_id) where status in ('offered', 'active', 'paused');
create index lowcarb_enrolments_patient_idx on public.lowcarb_enrolments (patient_id, created_at desc);

create table public.lowcarb_programme_events (
  id              bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enrolment_id    uuid not null references public.lowcarb_enrolments (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  kind            text not null check (kind in ('offered', 'accepted', 'declined', 'paused', 'resumed', 'stopped', 'review_raised', 'review_completed', 'expired')),
  code            text,
  actor_id        uuid references public.profiles (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default clock_timestamp()
);
create index lowcarb_programme_events_enrolment_idx on public.lowcarb_programme_events (enrolment_id, id desc);
create index lowcarb_programme_events_patient_idx on public.lowcarb_programme_events (patient_id, created_at desc);

alter table public.lowcarb_enrolments enable row level security;
alter table public.lowcarb_programme_events enable row level security;
revoke all on public.lowcarb_enrolments, public.lowcarb_programme_events from public, anon, authenticated;
grant select on public.lowcarb_enrolments, public.lowcarb_programme_events to authenticated;
-- Staff only, and only staff the category-scoped path entitles to the patient. The PATIENT has no policy at all: they learn their status through
-- my_lowcarb_gate(), which never says why a programme was paused. (Fresh policies: the older sibling shapes predate the category model.)
create policy lowcarb_enrolments_staff_select on public.lowcarb_enrolments for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy lowcarb_programme_events_staff_select on public.lowcarb_programme_events for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));

-- Transitions only go forward, and who/what/when never changes.
create function private.lowcarb_enrolments_guard() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'a programme enrolment is never deleted' using errcode = '42501'; end if;
  if new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.recorded_by is distinct from old.recorded_by or new.config_version is distinct from old.config_version
     or new.offered_at is distinct from old.offered_at or new.no_recent_admission is distinct from old.no_recent_admission
     or new.supervision_accepted is distinct from old.supervision_accepted or new.supervision_note is distinct from old.supervision_note then
    raise exception 'an enrolment''s patient, offer and supervision record never change' using errcode = '42501';
  end if;
  if old.status in ('stopped', 'declined', 'expired') and new.status is distinct from old.status then
    raise exception 'a % enrolment cannot be reopened; offer the programme again', old.status using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'offered' and new.status in ('active', 'declined', 'stopped', 'expired'))
    or (old.status = 'active' and new.status in ('paused', 'stopped'))
    or (old.status = 'paused' and new.status in ('active', 'stopped'))) then
    raise exception 'enrolment cannot move from % to %', old.status, new.status using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger lowcarb_enrolments_guard before update or delete on public.lowcarb_enrolments
  for each row execute function private.lowcarb_enrolments_guard();
revoke all on function private.lowcarb_enrolments_guard() from public, anon, authenticated;

create function private.lowcarb_events_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception 'programme events are append-only' using errcode = '42501'; end $$;
create trigger lowcarb_programme_events_append_only before update or delete on public.lowcarb_programme_events
  for each row execute function private.lowcarb_events_append_only();
revoke all on function private.lowcarb_events_append_only() from public, anon, authenticated;

create function private.lowcarb_event(p_enrol uuid, p_kind text, p_code text, p_actor uuid) returns void
language sql security definer set search_path = ''
as $$
  insert into public.lowcarb_programme_events (organisation_id, enrolment_id, patient_id, kind, code, actor_id, is_test)
  select e.organisation_id, e.id, e.patient_id, p_kind, p_code, p_actor, e.is_test from public.lowcarb_enrolments e where e.id = p_enrol;
$$;
revoke all on function private.lowcarb_event(uuid, text, text, uuid) from public, anon, authenticated;

-- A neutral notice (INV-07): it names no condition, reading or medicine.
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('lowcarb_programme_update', 'operational', 'routine', 'patient', array['in_app','push']::public.notification_channel[], 'immediate', 'Your care team has an update in the app.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('lowcarb_programme_update', 'en', 'in_app', 'Your care team has an update for you', 'Open the app to read it.'),
  ('lowcarb_programme_update', 'en', 'push', 'Your care team has an update for you', 'Open the app to read it.')
on conflict (template_key, locale, channel) do nothing;

-- ---------------------------------------------------------------------------
-- 4. The review task type (PROPOSED). needs_confirmation stays FALSE on purpose: a row waiting for confirmation blocks approve_triage_rule_set
-- for every rule set, and no triage rule creates this task. Only this programme's functions do, and only for an enrolled patient.
-- ---------------------------------------------------------------------------
insert into public.task_types (code, version, is_active, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes,
                               claim_timeout_minutes, pushable, creatable, source_task_keys, effective_from, note, needs_confirmation)
select 'lowcarb_medicine_review', 1, true, 4, 1440, 'senior_medical_officer', array['adult_general', 'prescribing'], 240, 30, true, true, '{}',
       (now() at time zone 'Africa/Lagos')::date,
       'S50b: a doctor reviews the medicines of someone on the low-carbohydrate programme (sugars falling, a pause, a stop, or the standing review). PROPOSED class, due time and tier. Holds no reading or condition (INV-07).',
       false
 where not exists (select 1 from public.task_types where code = 'lowcarb_medicine_review');

-- ---------------------------------------------------------------------------
-- 5. Incidents (never silent) and the safety actions
-- ---------------------------------------------------------------------------
create function private.lowcarb_open_incident(p_patient uuid, p_state text, p_msg text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  raise warning 'low-carbohydrate programme safety action failed for a patient: % %', p_state, p_msg;
  begin
    if not exists (select 1 from public.ops_incidents where external_reference = 'lowcarb_programme_safety' and status not in ('resolved', 'closed')) then
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values ((select organisation_id from public.profiles where id = p_patient), 'technical', 'sev2', 'A low-carbohydrate programme safety action failed',
              format('The programme safety action raised %s (%s). The reading or triage event was saved; only the programme pause or review task was skipped. List the people with an active enrolment and check each by hand. Check task type lowcarb_medicine_review and the signed configuration.', p_state, p_msg),
              'lowcarb_programme_safety', now(), now());
    end if;
  exception when others then
    raise warning 'could not open an incident for the low-carbohydrate programme: %', sqlerrm;
  end;
end $$;
revoke all on function private.lowcarb_open_incident(uuid, text, text) from public, anon, authenticated;

create function private.lowcarb_raise_review(p_enrol uuid, p_trigger text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrol;
  if not found then return; end if;
  perform private.create_clinical_task(e.patient_id, 'lowcarb_medicine_review', null, 'lowcarb_review:' || p_enrol);
  perform private.lowcarb_event(p_enrol, 'review_raised', p_trigger, null);
end $$;
revoke all on function private.lowcarb_raise_review(uuid, text) from public, anon, authenticated;

create function private.lowcarb_stop(p_enrol uuid, p_code text, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype; v_was_running boolean;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrol for update;
  if not found or e.status in ('stopped', 'declined', 'expired') then return; end if;
  v_was_running := e.status in ('active', 'paused');
  update public.lowcarb_enrolments set status = 'stopped', stopped_at = now(), stop_code = p_code where id = p_enrol;
  perform private.lowcarb_event(p_enrol, 'stopped', p_code, p_actor);
  perform private.written_care_notify(e.patient_id, e.organisation_id, 'lowcarb_programme_update', '{}'::jsonb);
  -- Stopping the diet can change what the medicines need, so a doctor looks at them. Never silent: a failure opens an incident.
  if v_was_running then
    begin
      perform private.lowcarb_raise_review(p_enrol, 'stopped_' || p_code);
    exception when others then
      perform private.lowcarb_open_incident(e.patient_id, sqlstate, sqlerrm);
    end;
  end if;
end $$;
revoke all on function private.lowcarb_stop(uuid, text, uuid) from public, anon, authenticated;

create function private.lowcarb_pause(p_enrol uuid, p_code text, p_actor uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype; v_cfg jsonb := private.lowcarb_cfg(); v_pauses integer; v_limit integer;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrol for update;
  if not found or e.status <> 'active' then return; end if;
  update public.lowcarb_enrolments set status = 'paused', paused_at = now(), pause_code = p_code where id = p_enrol;
  perform private.lowcarb_event(p_enrol, 'paused', p_code, p_actor);
  perform private.written_care_notify(e.patient_id, e.organisation_id, 'lowcarb_programme_update', '{}'::jsonb);
  -- The pause is already saved. A failure to open the review task must not undo it, and must not pass quietly: it opens an incident.
  begin
    perform private.lowcarb_raise_review(p_enrol, 'paused_' || p_code);
  exception when others then
    perform private.lowcarb_open_incident(e.patient_id, sqlstate, sqlerrm);
  end;
  -- the stop rule: too many pauses in 30 days ends the programme safely
  v_limit := coalesce((v_cfg #>> '{safety,stop_after_pauses_in_30_days}')::integer, 3);
  select count(*) into v_pauses from public.lowcarb_programme_events
   where enrolment_id = p_enrol and kind = 'paused' and created_at > now() - interval '30 days';
  if v_pauses >= v_limit then perform private.lowcarb_stop(p_enrol, 'repeated_pauses', null); end if;
end $$;
revoke all on function private.lowcarb_pause(uuid, text, uuid) from public, anon, authenticated;

-- A red or amber triage event pauses an active enrolment. It sits beside the existing emergency and red path and never replaces it. Shadow rows count
-- (an unapproved rule set still means a worrying result), because pausing only ever makes the programme more careful.
create function private.lowcarb_on_triage() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  begin
    for r in select id from public.lowcarb_enrolments where patient_id = new.patient_id and status = 'active' loop
      perform private.lowcarb_pause(r.id, 'triage_event', null);
    end loop;
  exception when others then
    perform private.lowcarb_open_incident(new.patient_id, sqlstate, sqlerrm);
  end;
  return null;
end $$;
revoke all on function private.lowcarb_on_triage() from public, anon, authenticated;

create function private.lowcarb_on_reading() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_cfg jsonb;
  v_value numeric;
  v_avg numeric;
  v_n integer;
begin
  begin
    -- cheap exit: most readings belong to nobody on the programme
    select e.id into r from public.lowcarb_enrolments e where e.patient_id = new.patient_id and e.status = 'active' limit 1;
    if not found then return null; end if;
    -- a reading entered in error never moves the programme
    if not exists (select 1 from private.vitals_readings_current v where v.id = new.id) then return null; end if;
    v_cfg := private.lowcarb_cfg();
    if v_cfg is null then raise exception 'no signed low-carbohydrate protocol config for an active enrolment'; end if;
    if new.vital_type = 'glucose' and new.glucose_mmol_l is not null then
      v_value := new.glucose_mmol_l;
      if v_value < (v_cfg #>> '{safety,pause_glucose_below_mmol}')::numeric then
        perform private.lowcarb_pause(r.id, 'low_glucose', null);
      elsif v_value < (v_cfg #>> '{medicine_review,any_glucose_below_mmol}')::numeric then
        perform private.lowcarb_raise_review(r.id, 'low_normal_glucose');
      end if;
      -- sugars falling: the average of the window is below the line, with enough readings
      select count(*), avg(v.glucose_mmol_l) into v_n, v_avg from private.vitals_readings_current v
       where v.patient_id = new.patient_id and v.vital_type = 'glucose' and v.glucose_mmol_l is not null
         and v.taken_at <= now() and v.taken_at >= now() - (v_cfg #>> '{medicine_review,window_days}')::numeric * interval '1 day';
      if v_n >= (v_cfg #>> '{medicine_review,min_readings}')::integer and v_avg < (v_cfg #>> '{medicine_review,avg_glucose_below_mmol}')::numeric then
        perform private.lowcarb_raise_review(r.id, 'average_glucose_low');
      end if;
    elsif new.vital_type = 'ketones' and new.ketones_mmol_l is not null then
      if new.ketones_mmol_l >= (v_cfg #>> '{safety,pause_ketones_at_or_above_mmol}')::numeric then
        perform private.lowcarb_pause(r.id, 'high_ketones', null);
      end if;
    end if;
  exception when others then
    perform private.lowcarb_open_incident(new.patient_id, sqlstate, sqlerrm);
  end;
  return null;
end $$;
revoke all on function private.lowcarb_on_reading() from public, anon, authenticated;

-- The sweep (not scheduled by this migration, see the open question): pregnancy that appears after enrolment pauses it; lapsed check-ins stop it.
create function private.lowcarb_sweep() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; v_cfg jsonb := private.lowcarb_cfg(); v_n integer := 0; v_last timestamptz;
begin
  if v_cfg is null then return 0; end if;
  for r in select e.* from public.lowcarb_enrolments e where e.status in ('active', 'paused') loop
    begin
      if r.status = 'active' and private.lowcarb_pregnancy_state(r.patient_id, (v_cfg #>> '{eligibility,postnatal_months}')::integer) = 'yes' then
        perform private.lowcarb_pause(r.id, 'no_longer_eligible', null); v_n := v_n + 1; continue;
      end if;
      select max(v.taken_at) into v_last from private.vitals_readings_current v
       where v.patient_id = r.patient_id and v.vital_type in ('glucose', 'ketones', 'weight') and v.taken_at >= coalesce(r.accepted_at, r.offered_at);
      if coalesce(v_last, coalesce(r.accepted_at, r.offered_at)) < now() - (v_cfg #>> '{safety,stop_if_checkins_missed_days}')::numeric * interval '1 day' then
        perform private.lowcarb_stop(r.id, 'check_ins_lapsed', null); v_n := v_n + 1;
      end if;
    exception when others then
      perform private.lowcarb_open_incident(r.patient_id, sqlstate, sqlerrm);
    end;
  end loop;
  return v_n;
end $$;
revoke all on function private.lowcarb_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The doors
-- ---------------------------------------------------------------------------
-- A prescribing clinician tied to the patient may offer, pause, resume and stop (INV-12). Reuses the S24 check.
create function private.lowcarb_can_act(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = p_patient and p.role = 'patient' and private.s24_can_act(p.organisation_id, p.id))
$$;
revoke all on function private.lowcarb_can_act(uuid) from public, anon, authenticated;

-- The clinician's view of eligibility. A pregnancy-driven reason is shown as "health_condition" unless the category-scoped path entitles this
-- clinician to reproductive_health. The read is audited (INV-10).
create function public.lowcarb_eligibility(p_patient uuid, p_no_recent_admission boolean default false, p_supervision_accepted boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb; v_org uuid; v_repro boolean;
begin
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null or not private.lowcarb_can_act(p_patient) then
    raise exception 'Not authorised to check this patient' using errcode = '42501';
  end if;
  perform private.audit_patient_read(p_patient, 'lowcarb_eligibility', null, 'A clinician checked programme eligibility', 'lowcarb.eligibility_viewed');
  v_repro := coalesce(private.staff_may_read(p_patient, v_org, 'reproductive_health'::public.care_access_category), false);
  v := private.lowcarb_eligibility_for(p_patient, p_supervision_accepted, p_no_recent_admission);
  return jsonb_build_object('decision', v -> 'decision', 'supervision_for', v -> 'supervision_for',
    'reasons', (select coalesce(jsonb_agg(distinct case when r in ('pregnancy_or_postnatal', 'pregnancy_unknown') and not v_repro then 'health_condition' else r end), '[]'::jsonb)
                  from jsonb_array_elements_text(v -> 'reasons') r));
end $$;
revoke all on function public.lowcarb_eligibility(uuid, boolean, boolean) from public, anon;
grant execute on function public.lowcarb_eligibility(uuid, boolean, boolean) to authenticated;

create function public.offer_lowcarb_programme(
  p_patient uuid, p_no_recent_admission boolean, p_supervision_accepted boolean default false, p_supervision_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pr public.profiles%rowtype;
  v_cfg public.lowcarb_protocol_config%rowtype;
  v jsonb;
  v_id uuid;
  v_repro boolean;
begin
  select * into v_pr from public.profiles where id = p_patient and role = 'patient';
  if v_pr.id is null or not private.lowcarb_can_act(p_patient) then
    raise exception 'Not authorised to offer this programme' using errcode = '42501';
  end if;
  if not private.go_live_open_patient('low_carb_t2d_programme', p_patient) then
    raise exception 'This programme is not open yet' using errcode = '55000';
  end if;
  select * into v_cfg from public.lowcarb_protocol_config where is_active and approved_by is not null;
  if v_cfg.id is null then raise exception 'The programme protocol has not been signed yet' using errcode = '55000'; end if;
  if not coalesce(p_no_recent_admission, false) then
    raise exception 'Confirm there has been no recent severe low sugar or hospital admission' using errcode = '22023';
  end if;
  if coalesce(p_supervision_accepted, false) and length(btrim(coalesce(p_supervision_note, ''))) < 10 then
    raise exception 'Say how you will supervise the medicines before accepting supervision' using errcode = '22023';
  end if;
  v := private.lowcarb_eligibility_for(p_patient, p_supervision_accepted, p_no_recent_admission);
  if v ->> 'decision' <> 'eligible' then
    v_repro := coalesce(private.staff_may_read(p_patient, v_pr.organisation_id, 'reproductive_health'::public.care_access_category), false);
    raise exception 'This person cannot be offered the programme now (%)', v ->> 'decision' using errcode = '22023',
      detail = (select coalesce(string_agg(distinct case when r in ('pregnancy_or_postnatal', 'pregnancy_unknown') and not v_repro then 'health_condition' else r end, ','), '')
                  from jsonb_array_elements_text(v -> 'reasons') r);
  end if;
  insert into public.lowcarb_enrolments (organisation_id, patient_id, recorded_by, no_recent_admission, supervision_accepted, supervision_note, config_version, is_test)
  values (v_pr.organisation_id, p_patient, v_uid, true, coalesce(p_supervision_accepted, false), nullif(btrim(coalesce(p_supervision_note, '')), ''), v_cfg.version, coalesce(v_pr.is_test, false))
  returning id into v_id;
  perform private.lowcarb_event(v_id, 'offered', null, v_uid);
  perform private.written_care_notify(p_patient, v_pr.organisation_id, 'lowcarb_programme_update', '{}'::jsonb);
  perform private.log_audit('lowcarb.offered', 'lowcarb_enrolment', v_id, jsonb_build_object('patient_id', p_patient));
  return v_id;
end $$;
revoke all on function public.offer_lowcarb_programme(uuid, boolean, boolean, text) from public, anon;
grant execute on function public.offer_lowcarb_programme(uuid, boolean, boolean, text) to authenticated;

-- The patient answers an offer. Nobody else can: a patient cannot self-enrol and a clinician cannot accept for them.
create function public.respond_lowcarb_offer(p_enrolment uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); e public.lowcarb_enrolments%rowtype; v jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into e from public.lowcarb_enrolments where id = p_enrolment and patient_id = v_uid for update;
  if not found or e.status <> 'offered' then raise exception 'There is no open offer to answer' using errcode = '22023'; end if;
  if p_accept is null then raise exception 'Say yes or no' using errcode = '22023'; end if;
  if not p_accept then
    update public.lowcarb_enrolments set status = 'declined' where id = e.id;
    perform private.lowcarb_event(e.id, 'declined', null, v_uid);
    return 'declined';
  end if;
  -- Accepting re-checks everything that could have changed since the offer. The guard is re-read too: a programme switched off cannot be started.
  v := private.lowcarb_eligibility_for(v_uid, e.supervision_accepted, e.no_recent_admission);
  if not private.go_live_open_patient('low_carb_t2d_programme', v_uid) or v ->> 'decision' <> 'eligible' then
    update public.lowcarb_enrolments set status = 'expired', stopped_at = now() where id = e.id;
    perform private.lowcarb_event(e.id, 'expired', 'no_longer_available', null);
    return 'unavailable';
  end if;
  update public.lowcarb_enrolments set status = 'active', accepted_at = now() where id = e.id;
  perform private.lowcarb_event(e.id, 'accepted', null, v_uid);
  return 'active';
end $$;
revoke all on function public.respond_lowcarb_offer(uuid, boolean) from public, anon;
grant execute on function public.respond_lowcarb_offer(uuid, boolean) to authenticated;

create function public.pause_lowcarb_programme(p_enrolment uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrolment;
  if e.id is null or not private.lowcarb_can_act(e.patient_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if e.status <> 'active' then raise exception 'Only an active programme can be paused' using errcode = '22023'; end if;
  perform private.lowcarb_pause(p_enrolment, 'clinician', (select auth.uid()));
end $$;
revoke all on function public.pause_lowcarb_programme(uuid) from public, anon;
grant execute on function public.pause_lowcarb_programme(uuid) to authenticated;

-- Resuming is a clinician's decision and re-runs the screen: someone with a new red or amber result, or who has become ineligible, is not resumed.
create function public.resume_lowcarb_programme(p_enrolment uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype; v jsonb;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrolment for update;
  if e.id is null or not private.lowcarb_can_act(e.patient_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if e.status <> 'paused' then raise exception 'Only a paused programme can be resumed' using errcode = '22023'; end if;
  if not private.go_live_open_patient('low_carb_t2d_programme', e.patient_id) then raise exception 'This programme is not open' using errcode = '55000'; end if;
  v := private.lowcarb_eligibility_for(e.patient_id, e.supervision_accepted, e.no_recent_admission);
  if v ->> 'decision' <> 'eligible' then raise exception 'This person cannot restart the programme now (%)', v ->> 'decision' using errcode = '22023'; end if;
  update public.lowcarb_enrolments set status = 'active', paused_at = null, pause_code = null where id = e.id;
  perform private.lowcarb_event(e.id, 'resumed', null, (select auth.uid()));
end $$;
revoke all on function public.resume_lowcarb_programme(uuid) from public, anon;
grant execute on function public.resume_lowcarb_programme(uuid) to authenticated;

-- The patient can always stop; a prescribing clinician tied to them can too (also withdrawing an unanswered offer).
create function public.stop_lowcarb_programme(p_enrolment uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); e public.lowcarb_enrolments%rowtype;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrolment;
  if e.id is null or not (e.patient_id = v_uid or private.lowcarb_can_act(e.patient_id)) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if e.status not in ('offered', 'active', 'paused') then raise exception 'This programme has already ended' using errcode = '22023'; end if;
  perform private.lowcarb_stop(p_enrolment, case when e.patient_id = v_uid then 'patient_choice' when e.status = 'offered' then 'withdrawn' else 'clinician' end, v_uid);
end $$;
revoke all on function public.stop_lowcarb_programme(uuid) from public, anon;
grant execute on function public.stop_lowcarb_programme(uuid) to authenticated;

-- A doctor records that a medicine review was done. This resets the standing-review clock. It does not change any medicine: that is a signed change.
create function public.complete_lowcarb_medicine_review(p_enrolment uuid, p_note text) returns void
language plpgsql security definer set search_path = ''
as $$
declare e public.lowcarb_enrolments%rowtype;
begin
  select * into e from public.lowcarb_enrolments where id = p_enrolment for update;
  if e.id is null or not private.lowcarb_can_act(e.patient_id) then raise exception 'Not authorised' using errcode = '42501'; end if;
  if e.status not in ('active', 'paused') then raise exception 'There is no running programme to review' using errcode = '22023'; end if;
  if length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'Say what you decided about the medicines' using errcode = '22023'; end if;
  update public.lowcarb_enrolments set last_medicine_review_at = now() where id = e.id;
  perform private.lowcarb_event(e.id, 'review_completed', null, (select auth.uid()));
  perform private.log_audit('lowcarb.medicine_review_completed', 'lowcarb_enrolment', e.id, jsonb_build_object('patient_id', e.patient_id));
end $$;
revoke all on function public.complete_lowcarb_medicine_review(uuid, text) from public, anon;
grant execute on function public.complete_lowcarb_medicine_review(uuid, text) to authenticated;

-- The clinician console read (audited, INV-10). Only the signed-in clinician tied to the patient.
create function public.lowcarb_programme_for_patient(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; e public.lowcarb_enrolments%rowtype; v_cfg jsonb := private.lowcarb_cfg();
begin
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null or (select auth.uid()) is null
     or not private.is_org_staff(v_org) or not private.clinician_has_patient_access(p_patient)
     or not private.staff_may_read(p_patient, v_org, 'medical_history'::public.care_access_category) then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  perform private.audit_patient_read(p_patient, 'lowcarb_programme', null, 'A clinician read the programme record', 'lowcarb.programme_viewed');
  select * into e from public.lowcarb_enrolments where patient_id = p_patient order by created_at desc limit 1;
  return jsonb_build_object(
    'can_act', private.lowcarb_can_act(p_patient),
    'guard_open', private.go_live_open_patient('low_carb_t2d_programme', p_patient),
    'config_signed', v_cfg is not null,
    'config', v_cfg,
    'enrolment', case when e.id is null then null else jsonb_build_object(
      'id', e.id, 'status', e.status, 'offered_at', e.offered_at, 'accepted_at', e.accepted_at, 'paused_at', e.paused_at, 'pause_code', e.pause_code,
      'stopped_at', e.stopped_at, 'stop_code', e.stop_code, 'supervision_accepted', e.supervision_accepted,
      'last_medicine_review_at', e.last_medicine_review_at, 'config_version', e.config_version) end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('kind', x.kind, 'code', x.code, 'at', x.created_at) order by x.id desc)
                          from (select * from public.lowcarb_programme_events where patient_id = p_patient order by id desc limit 30) x), '[]'::jsonb));
end $$;
revoke all on function public.lowcarb_programme_for_patient(uuid) from public, anon;
grant execute on function public.lowcarb_programme_for_patient(uuid) to authenticated;

-- The patient door. ONE answer, "unavailable", for: no signed rules, the guard closed, no enrolment, and anything else. It never says why a
-- programme is paused. The only numbers returned are the ones the patient needs to act: how often to check, and the low-sugar line.
create function public.my_lowcarb_gate() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); e public.lowcarb_enrolments%rowtype; v_cfg jsonb;
begin
  if v_uid is null then return jsonb_build_object('state', 'unavailable'); end if;
  if not private.go_live_open_patient('low_carb_t2d_programme', v_uid) then return jsonb_build_object('state', 'unavailable'); end if;
  v_cfg := private.lowcarb_cfg();
  if v_cfg is null then return jsonb_build_object('state', 'unavailable'); end if;
  select * into e from public.lowcarb_enrolments where patient_id = v_uid and status in ('offered', 'active', 'paused') order by created_at desc limit 1;
  if not found then return jsonb_build_object('state', 'unavailable'); end if;
  return jsonb_build_object('state', 'ok', 'enrolment_id', e.id, 'status', e.status, 'check_ins', v_cfg -> 'check_ins',
    'low_glucose_below_mmol', v_cfg #> '{safety,pause_glucose_below_mmol}');
end $$;
revoke all on function public.my_lowcarb_gate() from public, anon;
grant execute on function public.my_lowcarb_gate() to authenticated;
comment on function public.my_lowcarb_gate() is
  'S50b: the only way a patient learns about the low-carbohydrate programme. state unavailable (not enrolled, not live, not signed off, the guard closed: all one answer) or ok with the status and the numbers needed to act.';

-- ---------------------------------------------------------------------------
-- 7. Triggers on the existing tables (last, so the lock on them is short)
-- ---------------------------------------------------------------------------
create trigger lowcarb_programme_triage after insert on public.triage_events
  for each row when (new.grade in ('amber', 'red') and new.patient_id is not null)
  execute function private.lowcarb_on_triage();
create trigger lowcarb_programme_reading after insert on public.vitals_readings
  for each row when (new.vital_type in ('glucose', 'ketones'))
  execute function private.lowcarb_on_reading();

-- ---------------------------------------------------------------------------
-- 8. The draft diabetes step table. DRAFT, UNSIGNED, PLACEHOLDER: the CMO writes the real one. It can drive a proposal for a test patient only
-- (propose_care_plan_change refuses a draft table for a real patient). Metformin has no step: it is deliberately left running.
-- ---------------------------------------------------------------------------
-- lowcarb-step-table-begin
insert into public.protocols (code, version, status, definition, note)
values ('t2d_lowcarb_deprescribing', 1, 'draft', $json${
 "code": "t2d_lowcarb_deprescribing",
 "version": 1,
 "status": "draft",
 "placeholder": true,
 "params": {},
 "steps": [
  {"id": "su_stop_on_low", "label": "Sulfonylurea: a low reading", "match": {"name_patterns": ["glibenclamide", "gliclazide", "glimepiride", "glipizide", "daonil", "diamicron", "amaryl"]},
   "when": {"any_glucose_below_mmol": 3.9}, "action": "stop",
   "rationale": "A low sugar reading while on a sulfonylurea: the step table proposes stopping it for the doctor to decide. PLACEHOLDER for the CMO."},
  {"id": "su_review_on_fall", "label": "Sulfonylurea: sugars falling", "match": {"name_patterns": ["glibenclamide", "gliclazide", "glimepiride", "glipizide", "daonil", "diamicron", "amaryl"]},
   "when": {"avg_glucose_below_mmol": 7.0}, "action": "review_dose",
   "rationale": "Average sugars are falling on the programme: the dose of this sulfonylurea needs a doctor's review. The doctor sets any new dose. PLACEHOLDER for the CMO."},
  {"id": "insulin_review_on_fall", "label": "Insulin: sugars falling", "match": {"name_patterns": ["insulin", "lantus", "humulin", "novorapid", "mixtard"]},
   "when": {"avg_glucose_below_mmol": 7.0}, "action": "review_dose",
   "rationale": "Average sugars are falling on the programme: insulin needs a doctor's review. Insulin is never stopped by a step table; the doctor sets any new dose. PLACEHOLDER for the CMO."},
  {"id": "insulin_review_on_low", "label": "Insulin: a low reading", "match": {"name_patterns": ["insulin", "lantus", "humulin", "novorapid", "mixtard"]},
   "when": {"any_glucose_below_mmol": 3.9}, "action": "review_dose",
   "rationale": "A low sugar reading while on insulin: a doctor reviews the dose today. PLACEHOLDER for the CMO."}
 ]
}$json$::jsonb,
        'S50b DRAFT, UNSIGNED. PLACEHOLDER steps (drug groups, lines and wording) for the Chief Medical Officer to rewrite and approve in the titration protocols page. A draft table drives a proposal for a test patient only.')
on conflict (code, version) do nothing;
-- lowcarb-step-table-end

-- ---------------------------------------------------------------------------
-- 9. Go-live guard (born OFF) and its conditions
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('low_carb_t2d_programme', 'Low-carbohydrate programme for type 2 diabetes',
   'Offering the programme, a patient accepting it, and the patient screen',
   'The Chief Medical Officer has signed the protocol config and the diabetes step table; a doctor and dietitian rota is recorded; the cost of ketone testing is decided; Chief Medical Officer confirmation',
   'cmo', array['public.offer_lowcarb_programme', 'public.respond_lowcarb_offer', 'public.resume_lowcarb_programme', 'public.my_lowcarb_gate'],
   'A test person passes (the S37 pair rule) so the flow can be rehearsed. The pause and stop safety actions are NOT behind this guard: they only make the programme more careful. Never marketed (S50-2).')
on conflict (key) do nothing;

create function private.lowcarb_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cfg integer; v_steps integer;
begin
  select version into v_cfg from public.lowcarb_protocol_config where is_active and approved_by is not null;
  select version into v_steps from public.protocols where code = 't2d_lowcarb_deprescribing' and status = 'approved';
  return jsonb_build_array(
    private.go_live_cond('protocol_config_signed', 'The Chief Medical Officer has signed the programme protocol config', v_cfg is not null, 'data',
      case when v_cfg is null then 'no signed version' else 'version ' || v_cfg end),
    private.go_live_cond('step_table_signed', 'The diabetes medicine step table is approved', v_steps is not null, 'data',
      case when v_steps is null then 'no approved version' else 'version ' || v_steps end),
    private.go_live_cond('doctor_dietitian_rota_recorded', 'A doctor and dietitian rota for the programme is recorded', private.go_live_attested(p_key, 'doctor_dietitian_rota_recorded'), 'attestation', null),
    private.go_live_cond('ketone_testing_cost_decided', 'The cost of ketone testing is decided', private.go_live_attested(p_key, 'ketone_testing_cost_decided'), 'attestation', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.lowcarb_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%lowcarb_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the low-carbohydrate branch by hand' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor,
    E'\n  elsif p_key = ''low_carb_t2d_programme'' then\n    return private.lowcarb_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
end $$;

-- The two conditions a person may record. Patched in place from the CURRENT definition so every pair other migrations added is kept.
do $patch$
declare
  v_def text := pg_get_functiondef('public.attest_go_live_condition(text,text,boolean,text)'::regprocedure);
  v_anchor constant text := $a$('cuff_visit_prompt', 'visit_prompt_wording_signed')$a$;
begin
  if position('doctor_dietitian_rota_recorded' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'attest_go_live_condition: anchor not found, refusing to rewrite' using errcode = '55000';
  end if;
  execute replace(v_def, v_anchor, v_anchor || $b$, ('low_carb_t2d_programme', 'doctor_dietitian_rota_recorded'), ('low_carb_t2d_programme', 'ketone_testing_cost_decided')$b$);
end $patch$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Registrations
-- ---------------------------------------------------------------------------
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('lowcarb_enrolments', 'tied', 'patient_id', 'medical_history', null),
  ('lowcarb_programme_events', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('lowcarb_enrolments', 'patient_id', 'clinical_record', 'review', false, 'S50b 2026-10-21. Clinician-only programme record; the patient sees only their status through my_lowcarb_gate(). PROPOSED class, to be confirmed by the CMO and DPO; the DPO decides whether a subject-access request must include it.'),
  ('lowcarb_programme_events', 'patient_id', 'clinical_record', 'review', false, 'S50b 2026-10-21. Append-only programme history (pauses and their codes). PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Self-checks: the migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text; t text;
begin
  foreach f in array array[
    'public.sign_lowcarb_protocol_config(uuid)', 'public.lowcarb_eligibility(uuid,boolean,boolean)', 'public.offer_lowcarb_programme(uuid,boolean,boolean,text)',
    'public.respond_lowcarb_offer(uuid,boolean)', 'public.pause_lowcarb_programme(uuid)', 'public.resume_lowcarb_programme(uuid)',
    'public.stop_lowcarb_programme(uuid)', 'public.complete_lowcarb_medicine_review(uuid,text)', 'public.lowcarb_programme_for_patient(uuid)',
    'public.my_lowcarb_gate()', 'private.lowcarb_eligibility_for(uuid,boolean,boolean,timestamptz)', 'private.lowcarb_sweep()', 'private.lowcarb_pause(uuid,text,uuid)',
    'private.lowcarb_go_live_conditions(text)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S50b: anon can execute %', f; end if;
  end loop;
  foreach f in array array['private.lowcarb_eligibility_for(uuid,boolean,boolean,timestamptz)', 'private.lowcarb_pause(uuid,text,uuid)', 'private.lowcarb_sweep()', 'private.lowcarb_cfg()']
  loop
    if has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'S50b: a client can execute %', f; end if;
  end loop;
  foreach t in array array['public.lowcarb_protocol_config', 'public.lowcarb_enrolments', 'public.lowcarb_programme_events']
  loop
    if has_table_privilege('anon', t, 'SELECT') then raise exception 'S50b: anon can read %', t; end if;
    if has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE') then
      raise exception 'S50b: a client can write %', t;
    end if;
  end loop;
  if exists (select 1 from public.lowcarb_protocol_config where is_active or approved_by is not null) then raise exception 'S50b: the config must be born inactive and unsigned'; end if;
  if (select is_on from public.go_live_guards where key = 'low_carb_t2d_programme') is distinct from false then raise exception 'S50b: the guard must be born off'; end if;
  if exists (select 1 from public.protocols where code = 't2d_lowcarb_deprescribing' and status <> 'draft') then raise exception 'S50b: the step table must be a draft'; end if;
  if private.go_live_conditions('low_carb_t2d_programme', null) is null then raise exception 'S50b: go_live_conditions has no low-carbohydrate branch'; end if;
  if not exists (select 1 from public.task_types where code = 'lowcarb_medicine_review' and is_active and not needs_confirmation) then raise exception 'S50b: the review task type is missing'; end if;
end $$;

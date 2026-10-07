-- S61/S62: condition pathways, the engine seam (spec 13.1 to 13.18, INV-01, 02, 05, 10, 13, 14, 16).
--
-- WHAT THIS ADDS, mapped ONTO the live objects, never beside them (OQ-124: enrolment is chronic_programme_enrolments, not a new table):
--   1. vitals_readings.glucose_events: confusion, seizure, unresponsive, needed_help ticked with a glucose reading (decision Q5).
--   2. pathway_definitions: the registry (one row per pathway) and one go_live_guards row per pathway, ALL SEEDED OFF.
--   3. A trigger on chronic_programme_enrolments that checks the pathway's guard when a patient is enrolled or re-enrolled. This covers every
--      enrolment RPC at once because they all insert or update that table. A test patient passes (the S37 test rule); a real patient is refused.
--   4. pathway_baselines (a snapshot at enrolment, 13.9) and pathway_milestones (13.15), written only by definer functions.
--   5. pathway_lifecycle_events and the pause, resume, transfer, discharge and re-enrol functions (13.17). Pause stops scheduled check-ins only:
--      red and amber handling of a reading is never paused.
--   6. The missing clinician review task for engine titration proposals (OQ-172): an AFTER INSERT trigger on care_plan_changes.
--   7. Task types hypo_follow_up, amber_glucose_review, amber_pathway_review (PROPOSED, needs_confirmation).
--   8. DRAFT rule sets (diabetes, asthma and COPD, heart failure, CKD) in triage_rule_sets and the DRAFT hypertension step table in protocols.
--      Every one is status draft with no approver: AN AGENT NEVER SIGNS (a draft grades as SHADOW, so nobody is paged by it).
--   9. outcome_snapshots.pathway_code may now name the other pathways (the check allowed 'bp' only).
--  10. Review and scheduled-test sweeps (13.16, 13.18), callable by the service role only and NOT scheduled here.
--
-- LIVE COUNTS CHECKED 2026-10-07 (read-only) BEFORE WRITING: chronic_programme_enrolments 0 rows ever, protocols 0 rows, care_plan_changes from the
-- engine: none. chronic_condition_programmes hypertension, diabetes and obesity are is_active = true. So the new enrolment guard (off) means a
-- real patient can no longer enrol in those three programmes until the CMO switches the pathway guard on. No existing patient is affected.
--
-- THE CONDITIONS FUNCTION IS WRAPPED, NOT REWRITTEN: private.go_live_conditions is renamed to go_live_conditions_base and a thin dispatcher takes
-- its name; public.attest_go_live_condition likewise. The base bodies are kept exactly as they are live, so this cannot drift from them. A later
-- migration that re-creates either function in full would drop the pathway branch: the proof script asserts the wrapper is in place.
--
-- NO model call anywhere here (INV-01). No new overload of can_read_clinical (three already exist): policies call the existing ones with explicit casts.

-- ---------------------------------------------------------------------------
-- 1. Glucose danger events
-- ---------------------------------------------------------------------------
alter table public.vitals_readings add column if not exists glucose_events text[] not null default '{}';
alter table public.vitals_readings add constraint vitals_readings_glucose_events_check
  check (glucose_events <@ array['confusion', 'seizure', 'unresponsive', 'needed_help']::text[]);
comment on column public.vitals_readings.glucose_events is
  'S61 (decision Q5): danger events ticked with a glucose reading. Any of them at a reading below the low line is RED and pages on call, whatever the number.';

-- ---------------------------------------------------------------------------
-- 2. Registry, guards, versioned config
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in)
select d ->> 'guardKey',
       'Pathway: ' || (d ->> 'label'),
       'Enrolment of a real patient into this pathway',
       'Signed protocol; signed rule set; clinical safety case recorded by the Chief Medical Officer; trained clinicians with the competency attested',
       'cmo',
       case when d ->> 'kind' in ('programme') then array['private.enforce_pathway_guard_on_enrolment (insert or re-enrol on chronic_programme_enrolments)'] else '{}'::text[] end,
       case d ->> 'kind'
         when 'programme' then 'Reading triage of patients already enrolled is not behind the guard (a dangerous reading is always graded).'
         when 'composite' then 'The composition has no enrolment of its own: a patient is enrolled in each condition. Nothing is blocked by this guard today.'
         when 'prevention' then 'Prevention enrolment runs on preventive_programmes and is not behind this guard yet. Nothing is blocked by it today.'
         else 'Scaffold only: no thresholds, no programme, no enrolment path exist. The guard can never be met.'
       end
  from jsonb_array_elements($json$[{"composedOf":[],"reportingOnly":false,"code":"bp","label":"Blood pressure care","kind":"programme","programmeCodes":["hypertension"],"ruleSetCode":"bp_care_triage","stepTableCode":"htn_rtsl_ng","guardKey":"pathway_bp"},{"composedOf":[],"reportingOnly":false,"code":"diabetes_care","label":"Diabetes care","kind":"programme","programmeCodes":["diabetes"],"ruleSetCode":"diabetes_care_triage","stepTableCode":null,"guardKey":"pathway_diabetes_care"},{"composedOf":["bp","diabetes_care"],"reportingOnly":false,"code":"cardiometabolic_care","label":"Cardiometabolic care","kind":"composite","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_cardiometabolic_care"},{"composedOf":[],"reportingOnly":true,"code":"prediabetes_prevention","label":"Prediabetes prevention","kind":"prevention","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_prediabetes_prevention"},{"composedOf":[],"reportingOnly":true,"code":"weight_care","label":"Weight management","kind":"programme","programmeCodes":["obesity"],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_weight_care"},{"composedOf":[],"reportingOnly":false,"code":"asthma_copd_care","label":"Asthma and COPD care","kind":"programme","programmeCodes":["asthma","copd"],"ruleSetCode":"asthma_copd_care_triage","stepTableCode":null,"guardKey":"pathway_asthma_copd_care"},{"composedOf":[],"reportingOnly":false,"code":"heart_failure_care","label":"Heart failure self-monitoring","kind":"programme","programmeCodes":["heart_failure"],"ruleSetCode":"heart_failure_triage","stepTableCode":null,"guardKey":"pathway_heart_failure_care"},{"composedOf":[],"reportingOnly":false,"code":"ckd_care","label":"Chronic kidney disease monitoring","kind":"programme","programmeCodes":["ckd"],"ruleSetCode":"ckd_monitoring_triage","stepTableCode":null,"guardKey":"pathway_ckd_care"},{"composedOf":[],"reportingOnly":false,"code":"sickle_cell_care","label":"Sickle cell self-management","kind":"scaffold","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_sickle_cell_care"},{"composedOf":[],"reportingOnly":false,"code":"post_stroke_care","label":"Post-stroke secondary prevention","kind":"scaffold","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_post_stroke_care"}]$json$::jsonb) d
on conflict (key) do nothing;

create table public.pathway_definitions (
  code            text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  label           text not null,
  kind            text not null check (kind in ('programme', 'composite', 'prevention', 'scaffold')),
  programme_codes text[] not null default '{}',
  guard_key       text not null unique references public.go_live_guards (key) on delete restrict,
  rule_set_code   text,
  step_table_code text,
  composed_of     text[] not null default '{}',
  reporting_only  boolean not null default false,
  created_at      timestamptz not null default now(),
  check (guard_key = 'pathway_' || code)
);
comment on table public.pathway_definitions is
  'S62: the pathway registry. Maps a pathway onto chronic_condition_programmes (enrolment is chronic_programme_enrolments), a triage_rule_sets code and a protocols step table. Reference data, no patient data. Mirrors packages/clinical/src/pathways/registry.ts (a test keeps them identical).';
insert into public.pathway_definitions (code, label, kind, programme_codes, guard_key, rule_set_code, step_table_code, composed_of, reporting_only)
select d ->> 'code', d ->> 'label', d ->> 'kind',
       array(select jsonb_array_elements_text(d -> 'programmeCodes')), d ->> 'guardKey', d ->> 'ruleSetCode', d ->> 'stepTableCode',
       array(select jsonb_array_elements_text(d -> 'composedOf')), (d ->> 'reportingOnly')::boolean
  from jsonb_array_elements($json$[{"composedOf":[],"reportingOnly":false,"code":"bp","label":"Blood pressure care","kind":"programme","programmeCodes":["hypertension"],"ruleSetCode":"bp_care_triage","stepTableCode":"htn_rtsl_ng","guardKey":"pathway_bp"},{"composedOf":[],"reportingOnly":false,"code":"diabetes_care","label":"Diabetes care","kind":"programme","programmeCodes":["diabetes"],"ruleSetCode":"diabetes_care_triage","stepTableCode":null,"guardKey":"pathway_diabetes_care"},{"composedOf":["bp","diabetes_care"],"reportingOnly":false,"code":"cardiometabolic_care","label":"Cardiometabolic care","kind":"composite","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_cardiometabolic_care"},{"composedOf":[],"reportingOnly":true,"code":"prediabetes_prevention","label":"Prediabetes prevention","kind":"prevention","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_prediabetes_prevention"},{"composedOf":[],"reportingOnly":true,"code":"weight_care","label":"Weight management","kind":"programme","programmeCodes":["obesity"],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_weight_care"},{"composedOf":[],"reportingOnly":false,"code":"asthma_copd_care","label":"Asthma and COPD care","kind":"programme","programmeCodes":["asthma","copd"],"ruleSetCode":"asthma_copd_care_triage","stepTableCode":null,"guardKey":"pathway_asthma_copd_care"},{"composedOf":[],"reportingOnly":false,"code":"heart_failure_care","label":"Heart failure self-monitoring","kind":"programme","programmeCodes":["heart_failure"],"ruleSetCode":"heart_failure_triage","stepTableCode":null,"guardKey":"pathway_heart_failure_care"},{"composedOf":[],"reportingOnly":false,"code":"ckd_care","label":"Chronic kidney disease monitoring","kind":"programme","programmeCodes":["ckd"],"ruleSetCode":"ckd_monitoring_triage","stepTableCode":null,"guardKey":"pathway_ckd_care"},{"composedOf":[],"reportingOnly":false,"code":"sickle_cell_care","label":"Sickle cell self-management","kind":"scaffold","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_sickle_cell_care"},{"composedOf":[],"reportingOnly":false,"code":"post_stroke_care","label":"Post-stroke secondary prevention","kind":"scaffold","programmeCodes":[],"ruleSetCode":null,"stepTableCode":null,"guardKey":"pathway_post_stroke_care"}]$json$::jsonb) d;
alter table public.pathway_definitions enable row level security;
revoke all on public.pathway_definitions from public, anon, authenticated;
grant select on public.pathway_definitions to authenticated;
create policy pathway_definitions_read on public.pathway_definitions for select to authenticated using (true);

create table public.pathway_config (
  version    integer primary key check (version >= 1),
  value      jsonb not null check (jsonb_typeof(value) = 'object'),
  status     text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  source     text not null,
  created_at timestamptz not null default now()
);
comment on table public.pathway_config is 'S62: versioned cadence values (weekly automated review, monthly or quarterly clinician review, milestone and scheduled-test intervals). Mirrors the PROPOSED entry pathways.cadence.';
-- pathway-cadence-begin
insert into public.pathway_config (version, value, status, source)
values (1, $json${"automatedReviewDays":7,"clinicianReviewUncontrolledDays":30,"clinicianReviewControlledDays":90,"milestoneDueDays":{"baseline":0,"first_review":30,"three_month_review":90,"six_month_review":180},"scheduledTestIntervalDays":{"eye":365,"foot":365,"kidney":365}}$json$::jsonb, 'proposed', 'packages/shared proposed-config pathways.cadence v1');
-- pathway-cadence-end
alter table public.pathway_config enable row level security;
revoke all on public.pathway_config from public, anon, authenticated;
grant select on public.pathway_config to authenticated;
create policy pathway_config_read on public.pathway_config for select to authenticated using (true);

create function private.pathway_cadence() returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.pathway_config order by version desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- 3. Guard conditions (wrapper), attestation (wrapper)
-- ---------------------------------------------------------------------------
create function private.pathway_protocol_signed(p_code text) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare d public.pathway_definitions%rowtype;
begin
  select * into d from public.pathway_definitions where code = p_code;
  if not found then return false; end if;
  if d.kind = 'scaffold' then return false; end if;
  if d.kind = 'composite' then
    return array_length(d.composed_of, 1) > 0 and not exists (select 1 from unnest(d.composed_of) c where not private.pathway_protocol_signed(c));
  end if;
  if d.step_table_code is not null and not exists (select 1 from public.protocols where code = d.step_table_code and status = 'approved') then return false; end if;
  if array_length(d.programme_codes, 1) is null then return false; end if;
  return not exists (
    select 1 from unnest(d.programme_codes) pc
     where not exists (
       select 1 from public.chronic_condition_programmes p
         join public.protocol_versions pv on pv.protocol_id = p.protocol_slug
         join public.clinical_staff cs on cs.id = pv.approved_by
        where p.code = pc and pv.approved_at is not null and cs.doctor_tier = 'chief_medical_officer' and cs.active));
end $$;

create function private.pathway_rule_set_signed(p_code text) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare d public.pathway_definitions%rowtype;
begin
  select * into d from public.pathway_definitions where code = p_code;
  if not found or d.kind = 'scaffold' then return false; end if;
  if d.kind = 'composite' then
    return array_length(d.composed_of, 1) > 0 and not exists (select 1 from unnest(d.composed_of) c where not private.pathway_rule_set_signed(c));
  end if;
  if d.rule_set_code is null then return d.reporting_only; end if;
  return exists (select 1 from public.triage_rule_sets where code = d.rule_set_code and status = 'approved');
end $$;

create function private.pathway_go_live_conditions(p_key text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d public.pathway_definitions%rowtype;
begin
  select * into d from public.pathway_definitions where guard_key = p_key;
  if not found then
    return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
  end if;
  return jsonb_build_array(
    private.go_live_cond('protocol_signed', 'A signed protocol' || case when d.step_table_code is not null then ' and an approved step table' else '' end,
      private.pathway_protocol_signed(d.code), 'data', case when d.kind = 'scaffold' then 'no programme or enrolment path exists for this pathway' else null end),
    private.go_live_cond('rule_set_signed', case when d.reporting_only then 'No rule set needed (reporting only)' else 'A signed rule set' end,
      private.pathway_rule_set_signed(d.code), 'data', null),
    private.go_live_cond('clinical_safety_case_current', 'Clinical safety case current, recorded by the Chief Medical Officer',
      private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
    private.go_live_cond('clinicians_competency_attested', 'Clinicians trained, with the competency attested',
      private.go_live_attested(p_key, 'clinicians_competency_attested'), 'attestation', null));
end $$;

alter function private.go_live_conditions(text, uuid) rename to go_live_conditions_base;
create function private.go_live_conditions(p_key text, p_org uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if p_key like 'pathway\_%' then return private.pathway_go_live_conditions(p_key); end if;
  return private.go_live_conditions_base(p_key, p_org);
end $$;

alter function public.attest_go_live_condition(text, text, boolean, text) rename to attest_go_live_condition_base;
revoke all on function public.attest_go_live_condition_base(text, text, boolean, text) from public, anon, authenticated;
create function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if p_key like 'pathway\_%' then
    if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
    if not private.credential_is_cmo() then raise exception 'only the Chief Medical Officer can record a pathway safety case or competency' using errcode = '42501'; end if;
    if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
    if p_code not in ('clinical_safety_case_current', 'clinicians_competency_attested') then
      raise exception 'that condition is read from the data (or does not exist), it cannot be attested' using errcode = '22023';
    end if;
    if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023'; end if;
    if p_code = 'clinical_safety_case_current' and p_met and length(btrim(p_note)) < 25 then
      raise exception 'name the safety case document, its version and who signed it' using errcode = '22023';
    end if;
    insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by) values (p_key, p_code, p_met, btrim(p_note), v_uid);
    perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
    return jsonb_build_object('ok', true);
  end if;
  return public.attest_go_live_condition_base(p_key, p_code, p_met, p_note);
end $$;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Enrolment guard (INV-14)
-- ---------------------------------------------------------------------------
create function private.enforce_pathway_guard_on_enrolment() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  d public.pathway_definitions%rowtype;
  v_code text;
begin
  if new.status <> 'enrolled' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'enrolled' then return new; end if;
  select code into v_code from public.chronic_condition_programmes where id = new.programme_id;
  select * into d from public.pathway_definitions where v_code = any (programme_codes) limit 1;
  -- a programme with no pathway definition is not gated here (the proof script lists any such programme so it is noticed)
  if not found then return new; end if;
  if not private.go_live_open_patient(d.guard_key, new.patient_id) then
    raise exception 'The % pathway is not open yet (go-live guard %).', d.label, d.guard_key using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger chronic_programme_enrolments_pathway_guard before insert or update of status on public.chronic_programme_enrolments
  for each row execute function private.enforce_pathway_guard_on_enrolment();

-- ---------------------------------------------------------------------------
-- 5. Baselines and milestones
-- ---------------------------------------------------------------------------
create table public.pathway_baselines (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enrolment_id    uuid not null references public.chronic_programme_enrolments (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  cycle           integer not null default 1 check (cycle >= 1),
  pathway_code    text not null references public.pathway_definitions (code),
  captured_at     timestamptz not null default now(),
  snapshot        jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  source          text not null default 'system' check (source in ('system')),
  recorded_by     uuid references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  unique (enrolment_id, cycle)
);
comment on table public.pathway_baselines is 'S62 (13.9): readings, medicines and goals at enrolment, so outcomes are measured against where the person started. Written by the enrolment trigger only (recorded_by null: written by the system).';

create table public.pathway_milestones (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enrolment_id    uuid not null references public.chronic_programme_enrolments (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  cycle           integer not null default 1 check (cycle >= 1),
  code            text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  due_at          timestamptz not null,
  met_at          timestamptz,
  met_via         text check (met_via in ('system', 'clinician')),
  source          text not null default 'system' check (source in ('system', 'clinician')),
  recorded_by     uuid references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (enrolment_id, cycle, code),
  check ((met_at is null) = (met_via is null))
);
comment on table public.pathway_milestones is 'S62 (13.15): enrolment, code, due, met. Milestones reward consistency and are shown at the pathway home; nothing here nudges a late dangerous reading. recorded_by is null until a clinician marks one (never NOT NULL: a system milestone has no author).';
create index pathway_milestones_due_idx on public.pathway_milestones (enrolment_id, due_at) where met_at is null;

alter table public.pathway_baselines enable row level security;
alter table public.pathway_milestones enable row level security;
revoke all on public.pathway_baselines, public.pathway_milestones from public, anon, authenticated;
grant select on public.pathway_baselines, public.pathway_milestones to authenticated;
-- The patient and a caregiver with a medical-history grant read the rows. Staff read ONLY through read_pathway_milestones_audited (INV-10), so
-- there is deliberately no staff row policy. Nobody writes these tables directly: the definer functions below are the only door.
create policy pathway_baselines_read on public.pathway_baselines for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));
create policy pathway_milestones_read on public.pathway_milestones for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('pathway.milestone_met', 'A pathway milestone was met', 'S62', false),
  ('pathway.lifecycle', 'A pathway enrolment was paused, resumed, transferred, discharged or re-enrolled', 'S62', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys) values
  ('pathway.milestone_met', 1, array['enrolment_id', 'code']),
  ('pathway.lifecycle', 1, array['enrolment_id', 'action'])
on conflict (event_type, version) do nothing;

create function private.pathway_def_for_programme(p_programme uuid) returns public.pathway_definitions language sql stable security definer set search_path = '' as $$
  select d.* from public.pathway_definitions d join public.chronic_condition_programmes p on p.id = p_programme where p.code = any (d.programme_codes) limit 1
$$;

create function private.pathway_milestone_met(p_enrolment uuid, p_cycle integer, p_code text, p_via text, p_actor uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.pathway_milestones%rowtype;
begin
  update public.pathway_milestones set met_at = now(), met_via = p_via, recorded_by = p_actor, source = case when p_via = 'clinician' then 'clinician' else 'system' end
   where enrolment_id = p_enrolment and cycle = p_cycle and code = p_code and met_at is null
  returning * into m;
  if m.id is null then return false; end if;
  perform private.emit_domain_event('pathway.milestone_met', m.organisation_id, jsonb_build_object('enrolment_id', p_enrolment, 'code', p_code),
    'pathway.milestone_met:' || m.id, m.patient_id, 'pathway_milestone', m.id);
  return true;
end $$;

create function private.capture_pathway_baseline(p_enrolment uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e public.chronic_programme_enrolments%rowtype;
  d public.pathway_definitions;
  v_cycle integer;
  v_test boolean;
  v_id uuid;
  v_days jsonb := coalesce(private.pathway_cadence() -> 'milestoneDueDays', '{}'::jsonb);
  k text;
begin
  select * into e from public.chronic_programme_enrolments where id = p_enrolment;
  if not found then return null; end if;
  d := private.pathway_def_for_programme(e.programme_id);
  if d.code is null then return null; end if;
  select coalesce(max(cycle), 0) + 1 into v_cycle from public.pathway_baselines where enrolment_id = p_enrolment;
  select coalesce(is_test, false) into v_test from public.profiles where id = e.patient_id;
  insert into public.pathway_baselines (organisation_id, enrolment_id, patient_id, cycle, pathway_code, snapshot, is_test)
  values (e.organisation_id, e.id, e.patient_id, v_cycle, d.code, jsonb_build_object(
    'pathway', d.code,
    'blood_pressure', (select jsonb_build_object('systolic', systolic, 'diastolic', diastolic, 'taken_at', taken_at) from public.vitals_readings
                        where patient_id = e.patient_id and vital_type = 'blood_pressure' order by taken_at desc limit 1),
    'glucose', (select jsonb_build_object('mmol_l', glucose_mmol_l, 'taken_at', taken_at) from public.vitals_readings
                 where patient_id = e.patient_id and vital_type = 'glucose' order by taken_at desc limit 1),
    'weight', (select jsonb_build_object('kg', weight_kg, 'waist_cm', waist_cm, 'taken_at', taken_at) from public.vitals_readings
                where patient_id = e.patient_id and vital_type = 'weight' order by taken_at desc limit 1),
    'medicines', (select coalesce(jsonb_agg(jsonb_build_object('drug_name', drug_name, 'dose', dose, 'frequency', frequency)), '[]'::jsonb)
                    from public.medications where patient_id = e.patient_id and is_active),
    'goals', (select default_goals from public.chronic_condition_programmes where id = e.programme_id)), v_test)
  returning id into v_id;
  for k in select jsonb_object_keys(v_days) loop
    insert into public.pathway_milestones (organisation_id, enrolment_id, patient_id, cycle, code, due_at, is_test)
    values (e.organisation_id, e.id, e.patient_id, v_cycle, k, now() + make_interval(days => (v_days ->> k)::integer), v_test)
    on conflict (enrolment_id, cycle, code) do nothing;
  end loop;
  perform private.pathway_milestone_met(e.id, v_cycle, 'baseline', 'system', null);
  return v_id;
end $$;

create function private.on_pathway_enrolment_started() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.capture_pathway_baseline(new.id);
  return null;
end $$;
create trigger chronic_programme_enrolments_pathway_baseline_ins after insert on public.chronic_programme_enrolments
  for each row when (new.status = 'enrolled') execute function private.on_pathway_enrolment_started();
create trigger chronic_programme_enrolments_pathway_baseline_upd after update of status on public.chronic_programme_enrolments
  for each row when (new.status = 'enrolled' and old.status is distinct from 'enrolled') execute function private.on_pathway_enrolment_started();

create function public.clinician_mark_pathway_milestone(p_enrolment uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.chronic_programme_enrolments%rowtype;
  v_cycle integer;
begin
  select * into e from public.chronic_programme_enrolments where id = p_enrolment;
  if not found or (select auth.uid()) is null or not private.staff_may_write(e.patient_id, e.organisation_id, 'medical_history'::public.care_access_category) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select max(cycle) into v_cycle from public.pathway_milestones where enrolment_id = p_enrolment;
  return jsonb_build_object('met', coalesce(private.pathway_milestone_met(p_enrolment, v_cycle, p_code, 'clinician', (select auth.uid())), false));
end $$;

create function public.read_pathway_milestones_audited(p_patient uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_own boolean;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  v_own := p_patient = v_uid or private.can_read_clinical(p_patient, 'medical_history'::public.care_access_category);
  if not v_own then
    if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then raise exception 'not authorised' using errcode = '42501'; end if;
    if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'a reason of at least 10 characters is required' using errcode = '22023'; end if;
    if not private.can_staff_read_clinical(p_patient, 'medical_history'::public.care_access_category) then
      perform private.audit_chart_read(p_patient, array['pathway_milestones'], p_reason, 'denied');
      return jsonb_build_object('status', 'denied', 'rows', '[]'::jsonb);
    end if;
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.due_at), '[]'::jsonb) into v_rows from public.pathway_milestones m where m.patient_id = p_patient;
  if not v_own then perform private.audit_chart_read(p_patient, array['pathway_milestones'], p_reason, 'success'); end if;
  return jsonb_build_object('status', 'ok', 'rows', v_rows);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Lifecycle: pause, resume, transfer, discharge, re-enrol (13.17)
-- ---------------------------------------------------------------------------
create table public.pathway_lifecycle_events (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  enrolment_id    uuid not null references public.chronic_programme_enrolments (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  action          text not null check (action in ('pause', 'resume', 'transfer', 'discharge', 're_enrol')),
  reason          text not null check (char_length(btrim(reason)) >= 10),
  from_clinician  uuid references public.profiles (id) on delete restrict,
  to_clinician    uuid references public.profiles (id) on delete restrict,
  actor_id        uuid not null references public.profiles (id) on delete restrict,
  source          text not null default 'clinician' check (source in ('clinician', 'patient')),
  recorded_by     uuid not null references public.profiles (id) on delete restrict,
  is_test         boolean not null default false,
  created_at      timestamptz not null default clock_timestamp()
);
comment on table public.pathway_lifecycle_events is 'S62 (13.17): append-only record of a pause, resume, transfer, discharge or re-enrolment with the reason. A pause stops scheduled check-ins ONLY: a dangerous reading is still graded and paged while paused.';
create index pathway_lifecycle_events_idx on public.pathway_lifecycle_events (enrolment_id, created_at desc);
alter table public.pathway_lifecycle_events enable row level security;
revoke all on public.pathway_lifecycle_events from public, anon, authenticated;
grant select on public.pathway_lifecycle_events to authenticated;
create policy pathway_lifecycle_events_read on public.pathway_lifecycle_events for select to authenticated
  using (patient_id = (select auth.uid()) or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));
create function private.pathway_events_append_only() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'pathway_lifecycle_events is append-only' using errcode = '42501'; end $$;
create trigger pathway_lifecycle_events_append_only before update or delete on public.pathway_lifecycle_events for each row execute function private.pathway_events_append_only();
create trigger pathway_lifecycle_events_no_truncate before truncate on public.pathway_lifecycle_events for each statement execute function private.pathway_events_append_only();

create function private.pathway_enrolment_paused(p_enrolment uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select action = 'pause' from public.pathway_lifecycle_events
                    where enrolment_id = p_enrolment and action in ('pause', 'resume') order by created_at desc, id desc limit 1), false)
$$;

-- one door for all five: who may act, the reason, the event row, the outbox event
create function private.pathway_lifecycle(p_enrolment uuid, p_action text, p_reason text, p_patient_may boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  e public.chronic_programme_enrolments%rowtype;
  v_uid uuid := (select auth.uid());
  v_staff boolean;
  v_self boolean;
  v_test boolean;
  v_from uuid;
  v_to uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then raise exception 'say why, in at least 10 characters' using errcode = '22023'; end if;
  select * into e from public.chronic_programme_enrolments where id = p_enrolment for update;
  if not found then raise exception 'unknown enrolment' using errcode = '22023'; end if;
  v_self := e.patient_id = v_uid;
  v_staff := private.staff_may_write(e.patient_id, e.organisation_id, 'medical_history'::public.care_access_category);
  if not (v_staff or (v_self and p_patient_may)) then raise exception 'not authorised' using errcode = '42501'; end if;
  select coalesce(is_test, false) into v_test from public.profiles where id = e.patient_id;

  if p_action = 'pause' then
    if e.status <> 'enrolled' then raise exception 'only an enrolled pathway can be paused' using errcode = '22023'; end if;
    if private.pathway_enrolment_paused(e.id) then raise exception 'already paused' using errcode = '22023'; end if;
  elsif p_action = 'resume' then
    if not private.pathway_enrolment_paused(e.id) then raise exception 'not paused' using errcode = '22023'; end if;
  elsif p_action = 'discharge' then
    if e.status <> 'enrolled' then raise exception 'only an enrolled pathway can be discharged' using errcode = '22023'; end if;
    update public.chronic_programme_enrolments set status = 'completed', withdrawn_at = null where id = e.id;
  elsif p_action = 're_enrol' then
    if e.status = 'enrolled' then raise exception 'already enrolled' using errcode = '22023'; end if;
    -- the update goes through the same guard trigger as a first enrolment
    update public.chronic_programme_enrolments set status = 'enrolled', withdrawn_at = null where id = e.id;
  elsif p_action = 'transfer' then
    if not (private.is_admin() or private.credential_is_cmo() or exists (select 1 from public.lead_assignments where patient_id = e.patient_id and clinician_id = v_uid and state = 'active')) then
      raise exception 'only the lead clinician, the Chief Medical Officer or an admin can transfer a pathway' using errcode = '42501';
    end if;
    select clinician_id into v_from from public.lead_assignments where patient_id = e.patient_id and state = 'active';
    if v_from is null then raise exception 'the patient has no active lead clinician to transfer from' using errcode = '22023'; end if;
    v_to := private.replace_lead_internal(e.patient_id, v_from, 'clinician_request'::public.lead_end_reason, v_uid, p_reason);
  end if;

  insert into public.pathway_lifecycle_events (organisation_id, enrolment_id, patient_id, action, reason, from_clinician, to_clinician, actor_id, source, recorded_by, is_test)
  values (e.organisation_id, e.id, e.patient_id, p_action, btrim(p_reason), v_from, v_to, v_uid, case when v_staff then 'clinician' else 'patient' end, v_uid, v_test);
  perform private.emit_domain_event('pathway.lifecycle', e.organisation_id, jsonb_build_object('enrolment_id', e.id, 'action', p_action),
    'pathway.lifecycle:' || e.id || ':' || p_action || ':' || clock_timestamp(), e.patient_id, 'pathway_enrolment', e.id);
  return jsonb_build_object('ok', true, 'action', p_action, 'to_clinician', v_to);
end $$;

create function public.pause_pathway_enrolment(p_enrolment uuid, p_reason text) returns jsonb language sql security definer set search_path = '' as $$
  select private.pathway_lifecycle(p_enrolment, 'pause', p_reason, true) $$;
create function public.resume_pathway_enrolment(p_enrolment uuid, p_reason text) returns jsonb language sql security definer set search_path = '' as $$
  select private.pathway_lifecycle(p_enrolment, 'resume', p_reason, true) $$;
create function public.transfer_pathway_enrolment(p_enrolment uuid, p_reason text) returns jsonb language sql security definer set search_path = '' as $$
  select private.pathway_lifecycle(p_enrolment, 'transfer', p_reason, false) $$;
create function public.discharge_pathway_enrolment(p_enrolment uuid, p_reason text) returns jsonb language sql security definer set search_path = '' as $$
  select private.pathway_lifecycle(p_enrolment, 'discharge', p_reason, false) $$;
create function public.re_enrol_pathway_enrolment(p_enrolment uuid, p_reason text) returns jsonb language sql security definer set search_path = '' as $$
  select private.pathway_lifecycle(p_enrolment, 're_enrol', p_reason, false) $$;

-- ---------------------------------------------------------------------------
-- 7. The clinician review task for engine titration proposals (OQ-172)
-- ---------------------------------------------------------------------------
-- Before this, an engine proposal sat in care_plan_changes with no task, so no clinician was ever asked to sign it. Deliberately NO exception
-- handler: if the task cannot be created the proposal fails with it, rather than existing unseen (a silent loss is the bug being fixed).
create function private.engine_proposal_review_task() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.create_clinical_task(new.patient_id, 'titration_signoff', null, 'titration_signoff:' || new.id, null, null, null);
  return null;
end $$;
create trigger care_plan_changes_engine_review_task after insert on public.care_plan_changes
  for each row when (new.proposed_by = 'engine' and new.state = 'proposed') execute function private.engine_proposal_review_task();

-- ---------------------------------------------------------------------------
-- 8. Task types (PROPOSED, needs_confirmation) and the draft rule sets
-- ---------------------------------------------------------------------------
insert into public.task_types (code, version, is_active, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes,
                               claim_timeout_minutes, pushable, creatable, source_task_keys, effective_from, note, needs_confirmation)
values
  ('hypo_follow_up', 1, true, 4, 1440, 'medical_officer', array['diabetes'], 240, 30, true, true, array['hypo_follow_up'], current_date,
   'S61: follow-up after a low glucose reading without a danger symptom. PROPOSED class, tier and due time (decision pack Q5).', true),
  ('amber_glucose_review', 1, true, 4, 1440, 'medical_officer', array['diabetes'], 240, 30, true, true, array['amber_glucose_review'], current_date,
   'S61: amber glucose review (very high glucose, raised ketones, repeated lows or highs). PROPOSED.', true),
  ('amber_pathway_review', 1, true, 5, 4320, 'medical_officer', array['adult_general'], 1440, 30, true, true, array['amber_pathway_review'], current_date,
   'S61/S62: amber review for asthma, heart failure and CKD rules, and the scheduled clinician review. PROPOSED.', true)
on conflict (code, version) do nothing;

-- diabetes-rule-set-begin
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('diabetes_care_triage', 1, 'draft', $json${"code":"diabetes_care_triage","version":1,"status":"draft","params":{"severeHypo":3,"hypoAlert":3.9,"highForDka":11,"veryHigh":20,"persistentHighMinCount":3,"recurrentHypoMinCount":2,"level2MedReviewCount":2},"rules":[{"id":"DM-R1","description":"Glucose below the severe low line","grade":"red","explanationKey":"PW-DM-RED","when":{"field":"glucose.mmol","op":"lt","value":{"ref":"params.severeHypo"}},"actions":[{"kind":"show_emergency_guidance","code":"PW-DM-RED"},{"kind":"page_on_call"}]},{"id":"DM-R2","description":"Glucose below the low line with confusion, a seizure, unresponsiveness or help needed","grade":"red","explanationKey":"PW-DM-RED","when":{"all":[{"field":"glucose.mmol","op":"lt","value":{"ref":"params.hypoAlert"}},{"any":[{"field":"symptom.neuro","op":"eq","value":true},{"field":"symptom.assisted","op":"eq","value":true}]}]},"actions":[{"kind":"show_emergency_guidance","code":"PW-DM-RED"},{"kind":"page_on_call"}]},{"id":"DM-R3","description":"High glucose with raised ketones (suspected DKA)","grade":"red","explanationKey":"PW-DM-DKA","when":{"all":[{"field":"glucose.mmol","op":"gte","value":{"ref":"params.highForDka"}},{"field":"ketone.high","op":"eq","value":true}]},"actions":[{"kind":"show_emergency_guidance","code":"PW-DM-DKA"},{"kind":"page_on_call"}]},{"id":"DM-A1","description":"Low glucose, no danger symptom, on insulin or a sulfonylurea (or not known)","grade":"amber","explanationKey":"PW-DM-LOW","when":{"all":[{"all":[{"field":"glucose.mmol","op":"gte","value":{"ref":"params.severeHypo"}},{"field":"glucose.mmol","op":"lt","value":{"ref":"params.hypoAlert"}}]},{"field":"treatment.insulinOrSulfonylurea","op":"neq","value":false}]},"actions":[{"kind":"show_message","code":"PW-DM-LOW"},{"kind":"create_task","task":"hypo_follow_up","dueMinutes":240,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"DM-A2","description":"Low glucose, no danger symptom, known not to be on insulin or a sulfonylurea","grade":"amber","explanationKey":"PW-DM-LOW","when":{"all":[{"all":[{"field":"glucose.mmol","op":"gte","value":{"ref":"params.severeHypo"}},{"field":"glucose.mmol","op":"lt","value":{"ref":"params.hypoAlert"}}]},{"field":"treatment.insulinOrSulfonylurea","op":"eq","value":false}]},"actions":[{"kind":"show_message","code":"PW-DM-LOW"},{"kind":"create_task","task":"hypo_follow_up","dueMinutes":1440,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"DM-A3","description":"Very high glucose","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"glucose.mmol","op":"gte","value":{"ref":"params.veryHigh"}},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":240,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"DM-A4","description":"Raised ketones without a high glucose","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"ketone.high","op":"eq","value":true},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":240,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"DM-A5","description":"Repeated serious lows: review the glucose-lowering medicines","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"events.level2or3Count","op":"gte","value":{"ref":"params.level2MedReviewCount"}},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":240,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"week"},{"id":"DM-A6","description":"Persistent high glucose","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"window.highCount","op":"gte","value":{"ref":"params.persistentHighMinCount"}},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":4320,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"week"},{"id":"DM-A7","description":"Recurrent low glucose","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"window.lowCount","op":"gte","value":{"ref":"params.recurrentHypoMinCount"}},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":1440,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"week"},{"id":"DM-A8","description":"Moderate ketones","grade":"amber","explanationKey":"PW-DM-REVIEW","when":{"field":"ketone.moderate","op":"eq","value":true},"actions":[{"kind":"show_message","code":"PW-DM-REVIEW"},{"kind":"create_task","task":"amber_glucose_review","dueMinutes":4320,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"DM-G1","description":"A glucose reading with no flag","grade":"green","explanationKey":"PW-DM-LOGGED","when":{"field":"glucose.mmol","op":"gte","value":0},"actions":[]}]}$json$::jsonb, 'S61 DRAFT built from PROPOSED config diabetes.glucose_thresholds v1. Unsigned: grades as shadow. Triage and insights only, no medicine or insulin dose.')
on conflict (code, version) do nothing;
-- diabetes-rule-set-end
-- asthma-rule-set-begin
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('asthma_copd_care_triage', 1, 'draft', $json${"code":"asthma_copd_care_triage","version":1,"status":"draft","rules":[{"id":"AS-R1","description":"Cannot finish a sentence, no relief from the reliever, low peak flow, or low oxygen where measured","grade":"red","explanationKey":"PW-AS-RED","when":{"any":[{"field":"symptom.cannotFinishSentence","op":"eq","value":true},{"field":"reliever.noRelief","op":"eq","value":true},{"field":"peakflow.pctOfBest","op":"lt","value":{"ref":"params.peakFlowRedBelowPctOfBest"}},{"field":"spo2.pct","op":"lt","value":{"ref":"params.spo2RedBelowPct"}}]},"actions":[{"kind":"show_emergency_guidance","code":"PW-AS-RED"},{"kind":"page_on_call"}]},{"id":"AS-A1","description":"Reliever used more than the weekly line, or many canisters in a year","grade":"amber","explanationKey":"PW-GEN-REVIEW","when":{"any":[{"field":"reliever.usesLast7d","op":"gt","value":{"ref":"params.relieverUsesPerWeekFlag"}},{"field":"reliever.canistersLast12m","op":"gte","value":{"ref":"params.relieversPerYearFlag"}}]},"actions":[{"kind":"show_message","code":"PW-GEN-REVIEW"},{"kind":"create_task","task":"amber_pathway_review","dueMinutes":1440,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"week"},{"id":"AS-G1","description":"A reliever log with no flag","grade":"green","explanationKey":"PW-GEN-LOGGED","when":{"field":"reliever.usesLast7d","op":"gte","value":0},"actions":[]}],"params":{"relieverUsesPerWeekFlag":2,"relieversPerYearFlag":3,"peakFlowRedBelowPctOfBest":50,"spo2RedBelowPct":92}}$json$::jsonb, 'S61 DRAFT, decision pack Q11. Unsigned.')
on conflict (code, version) do nothing;
-- asthma-rule-set-end
-- hf-rule-set-begin
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('heart_failure_triage', 1, 'draft', $json${"code":"heart_failure_triage","version":1,"status":"draft","params":{"weightGainKg":2},"rules":[{"id":"HF-A1","description":"Weight up by more than the line within the window","grade":"amber","explanationKey":"PW-GEN-REVIEW","when":{"field":"weight.gainKgInWindow","op":"gt","value":{"ref":"params.weightGainKg"}},"actions":[{"kind":"show_message","code":"PW-GEN-REVIEW"},{"kind":"create_task","task":"amber_pathway_review","dueMinutes":1440,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"reading"},{"id":"HF-G1","description":"A weight with no flag","grade":"green","explanationKey":"PW-GEN-LOGGED","when":{"field":"weight.gainKgInWindow","op":"gte","value":-1000},"actions":[]}]}$json$::jsonb, 'S61 DRAFT, decision pack Q12. Unsigned.')
on conflict (code, version) do nothing;
-- hf-rule-set-end
-- ckd-rule-set-begin
insert into public.triage_rule_sets (code, version, status, rules, note)
values ('ckd_monitoring_triage', 1, 'draft', $json${"code":"ckd_monitoring_triage","version":1,"status":"draft","params":{"referEgfrBelow":30,"referAcrMgPerG":300,"sustainedFallPct":20,"sustainedFallMlPerMin":5},"rules":[{"id":"CKD-A1","description":"Refer: low eGFR, high ACR, a sustained fall, or refractory hypertension","grade":"amber","explanationKey":"PW-GEN-REVIEW","when":{"any":[{"field":"egfr.value","op":"lt","value":{"ref":"params.referEgfrBelow"}},{"field":"acr.mgPerG","op":"gte","value":{"ref":"params.referAcrMgPerG"}},{"field":"egfr.fallPct","op":"gt","value":{"ref":"params.sustainedFallPct"}},{"field":"egfr.fallAbs","op":"gte","value":{"ref":"params.sustainedFallMlPerMin"}},{"field":"hypertension.refractory","op":"eq","value":true}]},"actions":[{"kind":"show_message","code":"PW-GEN-REVIEW"},{"kind":"route_referral","reason":"ckd_referral_criteria"},{"kind":"create_task","task":"amber_pathway_review","dueMinutes":4320,"notifyKey":"notify.triage.task_created"}],"taskAnchor":"week"},{"id":"CKD-G1","description":"Kidney results with no flag","grade":"green","explanationKey":"PW-GEN-LOGGED","when":{"field":"egfr.value","op":"gte","value":0},"actions":[]}]}$json$::jsonb, 'S61 DRAFT, decision pack Q12. Unsigned.')
on conflict (code, version) do nothing;
-- ckd-rule-set-end
-- htn-step-table-begin
insert into public.protocols (code, version, status, definition, note)
values ('htn_rtsl_ng', 1, 'draft', $json${"code":"htn_rtsl_ng","version":1,"status":"draft","params":{"minReadings":4,"windowDays":7,"minAdherencePercent":80,"reviewWindowDays":28,"staleAfterDays":3,"requireValidated":true,"validation":{"systolicMin":60,"systolicMax":260,"diastolicMin":30,"diastolicMax":160}},"steps":[{"id":"step_1_amlodipine_5","label":"Start amlodipine 5 mg","requires":[],"propose":{"action":"start","item":{"drugName":"Amlodipine","dose":"5 mg","frequency":"once daily","route":"oral","durationDays":30,"quantity":"30 tablets","repeatsAllowed":0,"indication":"Hypertension"}},"rationale":"Step 1 of the draft ladder. A clinician may substitute telmisartan or amiloride-hydrochlorothiazide where stocked."},{"id":"step_2_add_losartan_50","label":"Add losartan 50 mg","requires":[{"drugName":"Amlodipine","dose":"5 mg"}],"propose":{"action":"start","item":{"drugName":"Losartan","dose":"50 mg","frequency":"once daily","route":"oral","durationDays":30,"quantity":"30 tablets","repeatsAllowed":0,"indication":"Hypertension"}},"rationale":"Step 2 of the draft ladder. Not for anyone who could be pregnant."},{"id":"step_3a_raise_amlodipine_10","label":"Raise amlodipine to 10 mg","requires":[{"drugName":"Amlodipine","dose":"5 mg"},{"drugName":"Losartan","dose":"50 mg"}],"propose":{"action":"change","changes":"Amlodipine","item":{"drugName":"Amlodipine","dose":"10 mg","frequency":"once daily","route":"oral","durationDays":30,"quantity":"30 tablets","repeatsAllowed":0,"indication":"Hypertension"}},"rationale":"First half of step 3 of the draft ladder (amlodipine 10 mg with losartan 100 mg)."},{"id":"step_3b_raise_losartan_100","label":"Raise losartan to 100 mg","requires":[{"drugName":"Amlodipine","dose":"10 mg"},{"drugName":"Losartan","dose":"50 mg"}],"propose":{"action":"change","changes":"Losartan","item":{"drugName":"Losartan","dose":"100 mg","frequency":"once daily","route":"oral","durationDays":30,"quantity":"30 tablets","repeatsAllowed":0,"indication":"Hypertension"}},"rationale":"Second half of step 3 of the draft ladder."},{"id":"step_4_add_hctz_25","label":"Add hydrochlorothiazide 25 mg","requires":[{"drugName":"Amlodipine","dose":"10 mg"},{"drugName":"Losartan","dose":"100 mg"}],"propose":{"action":"start","item":{"drugName":"Hydrochlorothiazide","dose":"25 mg","frequency":"once daily","route":"oral","durationDays":30,"quantity":"30 tablets","repeatsAllowed":0,"indication":"Hypertension"}},"rationale":"Step 4 of the draft ladder."},{"id":"step_5_refer","label":"Refer: not controlled on three medicines","requires":[{"drugName":"Amlodipine","dose":"10 mg"},{"drugName":"Losartan","dose":"100 mg"},{"drugName":"Hydrochlorothiazide","dose":"25 mg"}],"propose":null,"rationale":"End of the draft ladder: refer."}]}$json$::jsonb, 'S61 DRAFT step table from decision pack Q1 option A (RTSL Nigeria protocol). NOT approved: the CMO checks it against the primary PDFs and signs.')
on conflict (code, version) do nothing;
-- htn-step-table-end

-- ---------------------------------------------------------------------------
-- 9. Outcome snapshots may name the other pathways
-- ---------------------------------------------------------------------------
-- SEAM, not finished: the snapshot columns are blood-pressure shaped, so a non-bp snapshot writer needs generic metric columns first (follow-up).
alter table public.outcome_snapshots drop constraint outcome_snapshots_pathway_code_check;
alter table public.outcome_snapshots add constraint outcome_snapshots_pathway_code_check
  check (pathway_code in ('bp', 'diabetes_care', 'cardiometabolic_care', 'prediabetes_prevention', 'weight_care', 'asthma_copd_care', 'heart_failure_care', 'ckd_care', 'sickle_cell_care', 'post_stroke_care'));

-- ---------------------------------------------------------------------------
-- 10. Review and scheduled-test sweeps (service role only, NOT scheduled here)
-- ---------------------------------------------------------------------------
-- 13.18: a clinician review is due monthly while control is not shown, quarterly once the latest bp snapshot says controlled. The weekly
-- automated review is the engine grading each reading as it arrives plus the schedule occurrences that already exist; this sweep adds the
-- clinician review. A paused enrolment is skipped. A review task is created once per enrolment at a time (dedup key).
create function public.sweep_pathway_reviews() returns integer language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_cad jsonb := private.pathway_cadence();
  v_days integer;
  v_last timestamptz;
  v_cycle integer;
  v_n integer := 0;
  v_ctrl boolean;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and (select auth.uid()) is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  for e in
    select en.*, d.code as pcode, d.guard_key from public.chronic_programme_enrolments en
      join lateral (select * from private.pathway_def_for_programme(en.programme_id)) d on d.code is not null
     where en.status = 'enrolled'
  loop
    continue when private.pathway_enrolment_paused(e.id) or not private.go_live_open_patient(e.guard_key, e.patient_id);
    select controlled into v_ctrl from public.outcome_snapshots where patient_id = e.patient_id and pathway_code = e.pcode order by computed_at desc limit 1;
    v_days := case when coalesce(v_ctrl, false) then (v_cad ->> 'clinicianReviewControlledDays')::integer else (v_cad ->> 'clinicianReviewUncontrolledDays')::integer end;
    select max(cycle) into v_cycle from public.pathway_milestones where enrolment_id = e.id;
    continue when v_cycle is null;
    continue when exists (select 1 from public.pathway_milestones where enrolment_id = e.id and cycle = v_cycle and code like 'clinician\_review\_%' and met_at is null);
    select coalesce(max(met_at), e.enrolled_at) into v_last from public.pathway_milestones where enrolment_id = e.id and cycle = v_cycle and code like 'clinician\_review\_%';
    continue when now() < v_last + make_interval(days => v_days);
    insert into public.pathway_milestones (organisation_id, enrolment_id, patient_id, cycle, code, due_at, is_test)
    values (e.organisation_id, e.id, e.patient_id, v_cycle, 'clinician_review_' || to_char(now() at time zone 'Africa/Lagos', 'YYYYMMDD'), now(),
            coalesce((select is_test from public.profiles where id = e.patient_id), false))
    on conflict (enrolment_id, cycle, code) do nothing;
    perform private.create_clinical_task(e.patient_id, 'amber_pathway_review', null, 'pathway_review:' || e.id, null, null, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- 13.16: due dates for the complication checks (eye, foot, kidney), generated as milestones from the last done check (or enrolment) plus the
-- configured interval. Reuses diabetes_complication_checks; the existing recheck cadence is untouched.
create function public.sweep_pathway_scheduled_tests() returns integer language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_int jsonb := coalesce(private.pathway_cadence() -> 'scheduledTestIntervalDays', '{}'::jsonb);
  t text;
  v_last date;
  v_due date;
  v_cycle integer;
  v_n integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' and (select auth.uid()) is not null then
    raise exception 'service role only' using errcode = '42501';
  end if;
  for e in
    select en.* from public.chronic_programme_enrolments en
      join public.pathway_definitions d on d.code = 'diabetes_care'
      join public.chronic_condition_programmes p on p.id = en.programme_id and p.code = any (d.programme_codes)
     where en.status = 'enrolled'
  loop
    continue when private.pathway_enrolment_paused(e.id);
    select max(cycle) into v_cycle from public.pathway_milestones where enrolment_id = e.id;
    continue when v_cycle is null;
    for t in select jsonb_object_keys(v_int) loop
      select max(done_at) into v_last from public.diabetes_complication_checks where patient_id = e.patient_id and check_type::text = t;
      v_due := coalesce(v_last + (v_int ->> t)::integer, e.enrolled_at::date);
      insert into public.pathway_milestones (organisation_id, enrolment_id, patient_id, cycle, code, due_at, is_test)
      values (e.organisation_id, e.id, e.patient_id, v_cycle, 'test_' || t || '_' || to_char(v_due, 'YYYYMMDD'), v_due::timestamptz,
              coalesce((select is_test from public.profiles where id = e.patient_id), false))
      on conflict (enrolment_id, cycle, code) do nothing;
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants, and the migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.clinician_mark_pathway_milestone(uuid,text)', 'public.read_pathway_milestones_audited(uuid,text)', 'public.pause_pathway_enrolment(uuid,text)',
    'public.resume_pathway_enrolment(uuid,text)', 'public.transfer_pathway_enrolment(uuid,text)', 'public.discharge_pathway_enrolment(uuid,text)',
    'public.re_enrol_pathway_enrolment(uuid,text)']
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  revoke all on function public.sweep_pathway_reviews(), public.sweep_pathway_scheduled_tests() from public, anon, authenticated;
  grant execute on function public.sweep_pathway_reviews(), public.sweep_pathway_scheduled_tests() to service_role;
  revoke all on function private.pathway_lifecycle(uuid, text, text, boolean), private.capture_pathway_baseline(uuid), private.pathway_milestone_met(uuid, integer, text, text, uuid),
    private.pathway_cadence(), private.pathway_go_live_conditions(text), private.pathway_protocol_signed(text), private.pathway_rule_set_signed(text),
    private.pathway_enrolment_paused(uuid), private.pathway_def_for_programme(uuid) from public, anon;

  if (select count(*) from public.pathway_definitions) <> 10 then raise exception 'S62: expected 10 pathway definitions'; end if;
  if exists (select 1 from public.go_live_guards g join public.pathway_definitions d on d.guard_key = g.key where g.is_on) then raise exception 'S62: a pathway guard was born on'; end if;
  if exists (select 1 from public.triage_rule_sets where code in ('diabetes_care_triage', 'asthma_copd_care_triage', 'heart_failure_triage', 'ckd_monitoring_triage') and status <> 'draft') then raise exception 'S62: a rule set is not a draft'; end if;
  if exists (select 1 from public.protocols where code = 'htn_rtsl_ng' and status <> 'draft') then raise exception 'S62: the step table is not a draft'; end if;
  if has_table_privilege('authenticated', 'public.pathway_milestones', 'INSERT') or has_table_privilege('authenticated', 'public.pathway_milestones', 'UPDATE')
     or has_table_privilege('authenticated', 'public.pathway_baselines', 'INSERT') or has_table_privilege('authenticated', 'public.pathway_lifecycle_events', 'INSERT') then
    raise exception 'S62: authenticated can write a pathway table';
  end if;
  if has_table_privilege('anon', 'public.pathway_milestones', 'SELECT') or has_table_privilege('anon', 'public.pathway_baselines', 'SELECT') then raise exception 'S62: anon can read a pathway table'; end if;
  if has_function_privilege('anon', 'public.pause_pathway_enrolment(uuid,text)', 'EXECUTE') or has_function_privilege('anon', 'public.attest_go_live_condition(text,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.sweep_pathway_reviews()', 'EXECUTE') or has_function_privilege('authenticated', 'public.sweep_pathway_reviews()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.attest_go_live_condition_base(text,text,boolean,text)', 'EXECUTE') then
    raise exception 'S62: a pathway function has the wrong execute privilege';
  end if;
end $$;

-- S59 part 1 of 4: symptom sessions (spec 12.1, 12.2, 12.4), the health-record context the checker may use to TIGHTEN urgency, and an
-- audited staff read of a session.
--
-- WHAT THIS ADDS
--   * symptom_triage_assessments gains engine and engine_version (which adapter answered: `internal` today, `licensed` reserved,
--     nothing licensed exists), inputs_used (the NAMES of the record inputs that were present, never their values), raised_by (ids of
--     the prevalence, context and dependant layers that raised the category), urgency_level and urgency_map_version (the DERIVED
--     six-level wording, null unless a signed urgency map was in force). The four-category `category` column stays the source of truth.
--     Every existing row reads engine = internal, engine_version = in_house.1 (the interpreter that wrote them). Rows affected by the
--     defaults: whatever exists (a column default is not a data conversion); no row is rewritten for the nullable columns.
--   * public.symptom_sessions: the spec's name for a session, as a security_invoker VIEW over the assessments with the spec's columns
--     (patient_id, engine, engine_version, answers, urgency, red_flag_rule_id, completed_at). It exposes only rows the patient, the
--     person who ran the check for them, or a current care-circle grantee (category medical_history) may read. It has NO staff path:
--     staff read through read_symptom_session_audited. (The base table's own select policy still admits org staff, OQ-S60-07; this
--     view deliberately does not inherit that.) There is no possible_causes column: no differential is built (founder decision).
--   * public.symptom_check_context(): what the health record says that the checker may use to tighten urgency (age, sex, pregnancy,
--     conditions, medicines, recent readings). Own record: everything. For a person acted for: each section only when the category
--     grant allows it, and PREGNANCY IS NEVER RETURNED for someone else (reproductive_health is a protected category, S60 note).
--   * public.read_symptom_session_audited(): the staff read, with the per-patient tie (private.can_staff_read_clinical), the reviewing
--     tier (care coordinators refused), a written reason, and an audit row for every read and every refusal (INV-10, INV-12).
--
-- INV-14: nothing here opens the checker. symptom_checker_enabled stays OFF. The context function reads only the caller's own or an
-- acted-for record and creates nothing, so it needs no guard of its own; the screens that call it are unreachable while the guard is
-- closed.
-- GRANT NOTE: the view gets an explicit grant to authenticated only; anon and public are revoked. New functions revoke from public
-- (anon inherits execute through PUBLIC).

-- ---------------------------------------------------------------------------
-- 1. Columns on the assessment
-- ---------------------------------------------------------------------------
alter table public.symptom_triage_assessments
  add column if not exists engine text not null default 'internal',
  add column if not exists engine_version text not null default 'in_house.1',
  add column if not exists inputs_used jsonb not null default '[]'::jsonb,
  add column if not exists raised_by text[] not null default '{}',
  add column if not exists urgency_level text,
  add column if not exists urgency_map_version integer;

alter table public.symptom_triage_assessments
  add constraint symptom_triage_assessments_engine_check check (engine in ('internal', 'licensed')),
  add constraint symptom_triage_assessments_inputs_used_is_array check (jsonb_typeof(inputs_used) = 'array'),
  add constraint symptom_triage_assessments_urgency_level_check check (
    urgency_level is null or urgency_level in ('self_care', 'see_pharmacist', 'doctor_within_days', 'doctor_within_24_hours', 'doctor_today', 'emergency_now')),
  add constraint symptom_triage_assessments_urgency_has_version check ((urgency_level is null) = (urgency_map_version is null));

comment on column public.symptom_triage_assessments.engine is
  'S59: which SymptomEngine adapter answered. internal = the in-house deterministic interpreter. licensed is reserved; no licensed engine exists.';
comment on column public.symptom_triage_assessments.urgency_level is
  'S59 (spec 12.4): the six-level wording DERIVED from category by the signed urgency map, or null when no signed map was in force. `category` stays the source of truth and is what every escalation reads; nothing reads this column to decide anything.';
comment on column public.symptom_triage_assessments.inputs_used is
  'S59 (spec 12.2): the NAMES of the health-record inputs that were present (age, sex, pregnancy, conditions, medicines, readings), never their values.';

-- ---------------------------------------------------------------------------
-- 2. symptom_sessions: the spec's table, as a view with no staff path
-- ---------------------------------------------------------------------------
create or replace view public.symptom_sessions with (security_invoker = true) as
select
  a.id,
  a.organisation_id,
  a.patient_id,
  a.logged_by_profile_id,
  a.engine,
  a.engine_version,
  a.presenting_complaint_key,
  a.questions_asked as answers,
  a.category::text as urgency,
  a.urgency_level,
  a.urgency_map_version,
  (a.red_flag_screen -> 'fired' -> 0 ->> 'key') as red_flag_rule_id,
  a.clinician_review_required,
  a.inputs_used,
  a.raised_by,
  a.protocol_version,
  a.created_at as completed_at
from public.symptom_triage_assessments a
where a.patient_id = (select auth.uid())
   or a.logged_by_profile_id = (select auth.uid())
   or private.can_read_clinical(a.patient_id, 'medical_history'::public.care_access_category);

revoke all on public.symptom_sessions from public, anon, authenticated;
grant select on public.symptom_sessions to authenticated;
comment on view public.symptom_sessions is
  'S59: the spec''s symptom_sessions over symptom_triage_assessments. Patient, the person who ran the check, or a care-circle grantee with medical_history only. Staff read through read_symptom_session_audited (INV-10, INV-12). No possible_causes column exists: no differential is built.';

-- ---------------------------------------------------------------------------
-- 3. The health-record context (inputs that can only tighten)
-- ---------------------------------------------------------------------------
create or replace function public.symptom_check_context(p_subject uuid default null, p_window_days integer default 14)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_subject uuid := coalesce(p_subject, (select auth.uid()));
  v_own boolean;
  v_days integer := greatest(1, least(coalesce(p_window_days, 14), 90));
  v_pr public.profiles%rowtype;
  v_conditions jsonb := '[]'::jsonb;
  v_medicines jsonb := '[]'::jsonb;
  v_readings jsonb := '{}'::jsonb;
  v_pregnant boolean := null;
  v_sections text[] := '{}';
  r record;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_own := (v_subject = v_uid);
  select * into v_pr from public.profiles where id = v_subject;
  if not found then raise exception 'not found' using errcode = '42501'; end if;
  -- someone else's record: only a grantee with a current grant to read at least the history category (a dependent-account manager
  -- passes through the dependent rule in can_read_clinical). Same answer for "unknown" and "not yours".
  if not v_own and not private.can_read_clinical(v_subject, 'medical_history'::public.care_access_category) then
    raise exception 'not found' using errcode = '42501';
  end if;

  if v_own or private.can_read_clinical(v_subject, 'medical_history'::public.care_access_category) then
    v_sections := v_sections || 'conditions'::text;
    select coalesce(jsonb_agg(distinct lower(btrim(c.condition_name))), '[]'::jsonb) into v_conditions
      from public.patient_conditions c where c.patient_id = v_subject and c.status <> 'resolved';
  end if;
  if v_own or private.can_read_clinical(v_subject, 'medications'::public.care_access_category) then
    v_sections := v_sections || 'medicines'::text;
    select coalesce(jsonb_agg(distinct lower(btrim(m.drug_name))), '[]'::jsonb) into v_medicines
      from public.medications m where m.patient_id = v_subject and m.is_active and m.superseded_at is null;
  end if;
  if v_own or private.can_read_clinical(v_subject, 'vitals_readings'::public.care_access_category) then
    v_sections := v_sections || 'readings'::text;
    -- the most recent value of each reading inside the window
    for r in
      select distinct on (vr.vital_type) vr.vital_type, vr.systolic, vr.diastolic, vr.glucose_mmol_l, vr.temperature_c, vr.spo2_pct, vr.pulse_bpm
        from public.vitals_readings vr
       where vr.patient_id = v_subject and vr.taken_at >= now() - make_interval(days => v_days)
       order by vr.vital_type, vr.taken_at desc
    loop
      if r.vital_type::text = 'blood_pressure' then
        if r.systolic is not null then v_readings := v_readings || jsonb_build_object('systolic', r.systolic); end if;
        if r.diastolic is not null then v_readings := v_readings || jsonb_build_object('diastolic', r.diastolic); end if;
      elsif r.vital_type::text = 'glucose' and r.glucose_mmol_l is not null then
        v_readings := v_readings || jsonb_build_object('glucose_mmol_l', r.glucose_mmol_l);
      elsif r.vital_type::text = 'temperature' and r.temperature_c is not null then
        v_readings := v_readings || jsonb_build_object('temperature_c', r.temperature_c);
      elsif r.vital_type::text = 'spo2' and r.spo2_pct is not null then
        v_readings := v_readings || jsonb_build_object('spo2_pct', r.spo2_pct);
      elsif r.vital_type::text = 'pulse' and r.pulse_bpm is not null then
        v_readings := v_readings || jsonb_build_object('pulse_bpm', r.pulse_bpm);
      end if;
    end loop;
  end if;
  -- pregnancy: the person's own record only. For someone acted for it is never returned, whatever grants exist (reproductive_health).
  if v_own then
    v_sections := v_sections || 'pregnancy'::text;
    select pp.is_pregnant into v_pregnant from public.patient_pregnancy pp where pp.patient_id = v_subject;
  end if;

  return jsonb_build_object(
    'age_years', case when v_pr.date_of_birth is null then null else extract(year from age(current_date, v_pr.date_of_birth))::integer end,
    'sex', v_pr.sex::text,
    'state', v_pr.state,
    'pregnant', v_pregnant,
    'conditions', v_conditions,
    'medicines', v_medicines,
    'readings', v_readings,
    'window_days', v_days,
    'sections', to_jsonb(v_sections));
end $$;
revoke all on function public.symptom_check_context(uuid, integer) from public;
grant execute on function public.symptom_check_context(uuid, integer) to authenticated;
comment on function public.symptom_check_context(uuid, integer) is
  'S59 (spec 12.2): the record inputs the checker may use to TIGHTEN urgency. Own record: all; acted-for: category-scoped, and never pregnancy.';

-- ---------------------------------------------------------------------------
-- 4. Audited staff read of one session
-- ---------------------------------------------------------------------------
create or replace function public.read_symptom_session_audited(p_assessment uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.symptom_triage_assessments%rowtype;
  pr public.profiles%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if not private.can_staff_read_clinical(a.patient_id, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(a.patient_id, array['symptom_session'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  select * into pr from public.profiles where id = a.patient_id;
  perform private.audit_chart_read(a.patient_id, array['symptom_session'], p_reason, 'success');
  return jsonb_build_object(
    'status', 'ok',
    'session', jsonb_build_object(
      'id', a.id, 'engine', a.engine, 'engine_version', a.engine_version, 'complaint', a.presenting_complaint_key,
      'category', a.category, 'urgency_level', a.urgency_level, 'clinician_review_required', a.clinician_review_required,
      'rationale', a.rationale, 'protocol_version', a.protocol_version, 'inputs_used', a.inputs_used, 'raised_by', a.raised_by,
      'capture', a.initial_capture, 'questions_asked', a.questions_asked, 'red_flag_screen', a.red_flag_screen,
      'answered_by_carer', a.logged_by_profile_id is not null, 'completed_at', a.created_at),
    'patient', jsonb_build_object('id', pr.id, 'patient_number', pr.patient_number, 'sex', pr.sex,
      'age_years', case when pr.date_of_birth is null then null else extract(year from age(current_date, pr.date_of_birth))::integer end));
end $$;
revoke all on function public.read_symptom_session_audited(uuid, text) from public;
grant execute on function public.read_symptom_session_audited(uuid, text) to authenticated;

-- The dashboard lists where the guard is enforced (the context and the audited read are reads and create nothing, so they sit
-- behind the screens that are behind the guard; the entry is recorded for honesty, not because they refuse).
-- (nothing to add to enforced_in here: part 2 adds the write functions)

-- ---------------------------------------------------------------------------
-- 5. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if has_table_privilege('anon', 'public.symptom_sessions', 'SELECT') or has_table_privilege('public', 'public.symptom_sessions', 'SELECT') then
    raise exception 'S59 assertion: anon or public can select symptom_sessions';
  end if;
  if not has_table_privilege('authenticated', 'public.symptom_sessions', 'SELECT') then
    raise exception 'S59 assertion: authenticated cannot select symptom_sessions';
  end if;
  if not exists (select 1 from pg_class c where c.oid = 'public.symptom_sessions'::regclass and 'security_invoker=true' = any (c.reloptions)) then
    raise exception 'S59 assertion: symptom_sessions is not security_invoker';
  end if;
  if pg_get_viewdef('public.symptom_sessions'::regclass) ilike '%is_org_staff%' then
    raise exception 'S59 assertion: symptom_sessions has a staff path';
  end if;
  if has_function_privilege('anon', 'public.symptom_check_context(uuid,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_symptom_session_audited(uuid,text)', 'EXECUTE') then
    raise exception 'S59 assertion: anon can execute a symptom session function';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'symptom_sessions' and column_name = 'possible_causes') then
    raise exception 'S59 assertion: a possible_causes column exists (no differential is built)';
  end if;
end $$;

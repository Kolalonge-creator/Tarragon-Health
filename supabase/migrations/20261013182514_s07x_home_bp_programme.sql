-- S07x: the seven-day home blood pressure programme and the clinician-only white-coat / masked pattern flag.
--
-- Text approved by the Chief Medical Officer on 2026-10-07 and NOT signed: C1 (protocol), C2 (bands), C3 (pattern rule). docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md Part B
-- holds the exact wording and the Nigerian guideline basis (NG-2023 sections 3.1.1, 3.2, 5.4.5, 6.2, 6.3). C4 (cuff guidance) is app content. C5 is the triage rule set v4 DRAFT in the next migration.
--
-- NOTHING IS SWITCHED ON. The configuration row ships UNSIGNED and INACTIVE (sign_home_bp_programme() by the Chief Medical Officer activates it), and two go-live guards are born OFF
-- (INV-14): home_bp_programme (the patient flow and its care-team task) and bp_pattern_flag (the C3 rule). Neither can act on an unsigned configuration (INV-16).
--
-- DESIGN DECISION, CLINIC READINGS (the brief asked to decide and prove): a care-team clinic reading is a row in its OWN append-only table (clinic_bp_readings), NOT a new
-- 'clinic' value of vital_source on vitals_readings. Reason, read from the live database on 2026-10-13: vitals_readings carries 19 insert triggers (the BP, pulse, SpO2, temperature,
-- glucose and weight red-flag engines, the S12 observation.recorded event, the rule event, the monitoring-gap reset and baseline, wellness points, the timeline) and 19 functions and
-- the observations view read it as the patient's own home log. A clinic value would either fire those engines for a reading that is not a home reading (a 150/95 in clinic would page
-- as if the patient had measured it at home) or need every one of them edited. A separate table cannot reach any of them: the existing triggers, the observations view, the S11/S12
-- engine's 14-day history and every home average are provably untouched. The cost is that the 'observation path' (the observations view) does not list clinic readings; recorded as OQ-S07X-1.
--
-- COUNTS / LIVE FACTS (2026-10-13, read-only): triage_rule_sets bp_care_triage v3 approved; 13 task_types; go_live_guards has no home_bp row; no table named like the ones created here.
-- vitals_readings flags a reading with no position or arm as requires_validation (private.flag_vitals_requiring_validation), which most phone readings are, and flags an identical
-- pair within 2 minutes as duplicate_entry, which the protocol's two readings a minute apart often are. So validation_status is NOT used to decide what counts: every manual or device
-- blood pressure reading counts, as the phone counts it.

-- 1. The governed configuration (the shared single-active-row shape, signed by sign_*) ------------------------------------------------
create table public.home_bp_programme_signoffs (
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
create unique index home_bp_programme_signoffs_one_active on public.home_bp_programme_signoffs (is_active) where is_active;

-- home-bp-config-begin
insert into public.home_bp_programme_signoffs (version, is_active, config, notes)
values (1, false, $json${
 "protocol": {
  "readingsPerSession": 2,
  "minGapMinutes": 1,
  "targetDays": 7,
  "minDays": 3,
  "minReadings": 12,
  "restMinutes": 5,
  "avoidBeforeMinutes": 30,
  "morningHours": [4, 12],
  "eveningHours": [17, 24]
 },
 "bands": {
  "aboveSystolic": 135,
  "aboveDiastolic": 85,
  "borderlineSystolic": 130,
  "borderlineDiastolic": 80
 },
 "pattern": {
  "clinicSystolic": 140,
  "clinicDiastolic": 90,
  "windowDays": 30
 },
 "tasks": {
  "reviewDueMinutes": 2880,
  "patternDueMinutes": 2880
 }
}$json$::jsonb,
        'C1 (protocol), C2 (bands) and C3 (pattern rule) as approved in chat on 2026-10-07. PROPOSED, unsigned and inactive: sign_home_bp_programme() by the Chief Medical Officer. Until then the home check cannot create a task and the pattern rule cannot raise one.');
-- home-bp-config-end

create function private.home_bp_config() returns jsonb
language sql stable security definer set search_path = ''
as $$ select config from public.home_bp_programme_signoffs where is_active and approved_by is not null $$;
revoke all on function private.home_bp_config() from public, anon, authenticated;

create function private.home_bp_config_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.home_bp_programme_signoffs where is_active and approved_by is not null $$;
revoke all on function private.home_bp_config_version() from public, anon, authenticated;

create function public.sign_home_bp_programme(p_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_staff uuid;
begin
  if not exists (select 1 from public.home_bp_programme_signoffs where id = p_id) then raise exception 'Home BP programme version not found'; end if;
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier = 'chief_medical_officer' limit 1;
  if v_staff is null then raise exception 'not authorised: only the active Chief Medical Officer can sign the home BP programme'; end if;
  update public.home_bp_programme_signoffs set is_active = false where is_active and id <> p_id;
  update public.home_bp_programme_signoffs set approved_by = v_staff, approved_at = now(), is_active = true where id = p_id;
  perform private.log_audit('home_bp_programme.signed', 'home_bp_programme_signoffs', p_id, '{}'::jsonb);
  return p_id;
end;
$$;
revoke all on function public.sign_home_bp_programme(uuid) from public, anon;
grant execute on function public.sign_home_bp_programme(uuid) to authenticated;

alter table public.home_bp_programme_signoffs enable row level security;
create policy home_bp_programme_signoffs_read on public.home_bp_programme_signoffs for select to authenticated using (true);
revoke all on public.home_bp_programme_signoffs from public, anon, authenticated;
grant select on public.home_bp_programme_signoffs to authenticated;

-- never activate a version older than one already signed (same guard as the other eleven governed tables)
create trigger refuse_superseded_activation before update of is_active on public.home_bp_programme_signoffs
  for each row when (new.is_active and not old.is_active)
  execute function private.refuse_activating_superseded_version();

-- 2. Append-only guard shared by the three new tables ----------------------------------------------------------------------------------
create function private.home_bp_append_only() returns trigger
language plpgsql set search_path = ''
as $$ begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
revoke all on function private.home_bp_append_only() from public, anon, authenticated;

-- 3. A completed home check (written only by complete_home_bp_check) ---------------------------------------------------------------------
create table public.home_bp_checks (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  window_start    date not null,
  window_end      date not null,
  readings        smallint not null check (readings >= 1),
  days            smallint not null check (days >= 1),
  mean_systolic   smallint not null,
  mean_diastolic  smallint not null,
  band            text not null check (band in ('above_home_level', 'borderline', 'within_home_target')),
  config_version  integer not null,
  task_id         uuid references public.clinical_tasks (id) on delete set null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (patient_id, window_start),
  check (window_end >= window_start)
);
create index home_bp_checks_patient_idx on public.home_bp_checks (patient_id, window_end desc);
comment on table public.home_bp_checks is 'S07x: one completed seven-day home check (a complete protocol average, C1/C2). Written only by complete_home_bp_check(); append-only. The patient reads her own; staff read through a tie (S39b).';

-- 4. A reading entered by the care team at a visit (own table, see the design decision above) --------------------------------------------
create table public.clinic_bp_readings (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  systolic        smallint not null check (systolic between 60 and 260),
  diastolic       smallint not null check (diastolic between 30 and 160),
  measured_at     timestamptz not null,
  recorded_by     uuid not null references public.profiles (id) on delete restrict,
  note            text check (note is null or length(note) <= 200),
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  check (systolic > diastolic)
);
create index clinic_bp_readings_patient_idx on public.clinic_bp_readings (patient_id, measured_at desc);
comment on table public.clinic_bp_readings is 'S07x: a clinic blood pressure reading entered by the care team. Append-only. Deliberately NOT in vitals_readings: no home red-flag engine, observation event or home average ever sees it. Staff read only; the pattern rule (C3) is the only consumer.';

-- 5. The clinician-only pattern flag ------------------------------------------------------------------------------------------------------
create table public.bp_pattern_flags (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  kind             text not null check (kind in ('masked', 'masked_uncontrolled', 'white_coat')),
  treated          boolean not null,
  clinic_reading_id uuid not null references public.clinic_bp_readings (id) on delete cascade,
  home_check_id    uuid not null references public.home_bp_checks (id) on delete cascade,
  config_version   integer not null,
  task_id          uuid references public.clinical_tasks (id) on delete set null,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (clinic_reading_id, home_check_id)
);
create index bp_pattern_flags_patient_idx on public.bp_pattern_flags (patient_id, created_at desc);
comment on table public.bp_pattern_flags is 'S07x (C3): a possible white-coat or masked pattern, for the care team only. No patient policy exists on purpose; it is never in a notification (INV-07) and never changes a medicine (INV-02). Append-only.';

do $$
declare t text;
begin
  foreach t in array array['home_bp_checks', 'clinic_bp_readings', 'bp_pattern_flags'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.home_bp_append_only()', t || '_no_change', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.home_bp_append_only()', t || '_no_truncate', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

create policy home_bp_checks_read on public.home_bp_checks for select to authenticated
  using (patient_id = (select auth.uid()) or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy clinic_bp_readings_read on public.clinic_bp_readings for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));
create policy bp_pattern_flags_read on public.bp_pattern_flags for select to authenticated
  using (private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category));

-- the two registries every patient-keyed table must be in (S39b tied reads, S39d retention and export)
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason) values
  ('home_bp_checks', 'tied', 'patient_id', 'medical_history', null),
  ('clinic_bp_readings', 'tied', 'patient_id', 'medical_history', null),
  ('bp_pattern_flags', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('home_bp_checks', 'patient_id', 'clinical_record', 'review', true, 'S07x. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('clinic_bp_readings', 'patient_id', 'clinical_record', 'review', true, 'S07x. PROPOSED class, to be confirmed by the CMO and DPO.'),
  ('bp_pattern_flags', 'patient_id', 'clinical_record', 'review', false, 'S07x. Clinician-only working flag, never patient-facing (C3). Not exported to the patient: the DPO decides whether a subject-access request must include it (OQ-S07X-3).')
on conflict (table_name) do nothing;

-- 6. Task types (routine, class 8) --------------------------------------------------------------------------------------------------------
-- task-types-s07x-begin
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('home_bp_check_review', 1, 8, 2880, 'senior_medical_officer', '{hypertension}', 1440, 30, true, true, '{}',
   'S07x: a patient finished the seven-day home check. A routine review of the complete average, never an alarm. Holds no reading or band (INV-07).'),
  ('bp_pattern_review', 1, 8, 2880, 'senior_medical_officer', '{hypertension}', 1440, 30, true, true, '{}',
   'S07x (C3): a possible white-coat or masked pattern for review. Clinician-only. Never explained to the patient by this task, never changes a medicine (INV-02).');
-- task-types-s07x-end

-- 7. The rules, in SQL (the server must not trust a number sent by a phone). Parity with packages/clinical/src/home-bp.ts is tested. -------
create function private.home_bp_assess_readings(p_readings jsonb, p_start date, p_cfg jsonb) returns jsonb
language sql stable set search_path = ''
as $$
  with c as (select p_cfg -> 'protocol' as p, p_cfg -> 'bands' as b),
  r as (select (e ->> 's')::int as s, (e ->> 'd')::int as d, (e ->> 'at')::timestamptz as ts from jsonb_array_elements(p_readings) e),
  w as (select r.*, (r.ts at time zone 'Africa/Lagos')::date as ld from r),
  inwin as (select w.* from w, c where w.ld >= p_start and w.ld <= p_start + ((c.p ->> 'targetDays')::int - 1)),
  chain as (select i.*, lag(i.ts) over (order by i.ts, i.s, i.d) as prev from inwin i),
  kept as (select ch.* from chain ch, c where ch.prev is null or ch.ts - ch.prev >= make_interval(mins => (c.p ->> 'minGapMinutes')::int)),
  agg as (select count(*)::int as n, count(distinct ld)::int as dd, round(avg(s))::int as ms, round(avg(d))::int as md from kept)
  select jsonb_build_object(
    'readings', agg.n,
    'days', agg.dd,
    'complete', (agg.n >= (c.p ->> 'minReadings')::int and agg.dd >= (c.p ->> 'minDays')::int),
    'systolic', case when agg.n >= (c.p ->> 'minReadings')::int and agg.dd >= (c.p ->> 'minDays')::int then agg.ms end,
    'diastolic', case when agg.n >= (c.p ->> 'minReadings')::int and agg.dd >= (c.p ->> 'minDays')::int then agg.md end,
    'band', case
      when not (agg.n >= (c.p ->> 'minReadings')::int and agg.dd >= (c.p ->> 'minDays')::int) then null
      when agg.ms >= (c.b ->> 'aboveSystolic')::int or agg.md >= (c.b ->> 'aboveDiastolic')::int then 'above_home_level'
      when agg.ms >= (c.b ->> 'borderlineSystolic')::int or agg.md >= (c.b ->> 'borderlineDiastolic')::int then 'borderline'
      else 'within_home_target' end)
  from agg, c
$$;
revoke all on function private.home_bp_assess_readings(jsonb, date, jsonb) from public, anon, authenticated;

create function private.home_bp_assess(p_patient uuid, p_start date, p_cfg jsonb) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.home_bp_assess_readings(
    coalesce(jsonb_agg(jsonb_build_object('s', v.systolic, 'd', v.diastolic, 'at', v.taken_at)), '[]'::jsonb), p_start, p_cfg)
    from public.vitals_readings v
   where v.patient_id = p_patient and v.vital_type = 'blood_pressure' and v.systolic is not null and v.diastolic is not null
     and v.source::text in ('manual', 'device')
     and v.taken_at >= (p_start::timestamp at time zone 'Africa/Lagos')
     and v.taken_at <  ((p_start + (p_cfg -> 'protocol' ->> 'targetDays')::int)::timestamp at time zone 'Africa/Lagos')
$$;
revoke all on function private.home_bp_assess(uuid, date, jsonb) from public, anon, authenticated;

create function private.bp_pattern_kind(p_clinic_sys int, p_clinic_dia int, p_clinic_at timestamptz, p_home_sys int, p_home_dia int, p_home_end timestamptz,
                                        p_treated boolean, p_pregnant boolean, p_age int, p_cfg jsonb) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_pregnant then null
    when p_age is not null and p_age < 18 then null
    when abs(extract(epoch from (p_clinic_at - p_home_end))) > ((p_cfg -> 'pattern' ->> 'windowDays')::int * 86400) then null
    when not (p_clinic_sys >= (p_cfg -> 'pattern' ->> 'clinicSystolic')::int or p_clinic_dia >= (p_cfg -> 'pattern' ->> 'clinicDiastolic')::int)
         and (p_home_sys >= (p_cfg -> 'bands' ->> 'aboveSystolic')::int or p_home_dia >= (p_cfg -> 'bands' ->> 'aboveDiastolic')::int)
      then case when p_treated then 'masked_uncontrolled' else 'masked' end
    when (p_clinic_sys >= (p_cfg -> 'pattern' ->> 'clinicSystolic')::int or p_clinic_dia >= (p_cfg -> 'pattern' ->> 'clinicDiastolic')::int)
         and not (p_home_sys >= (p_cfg -> 'bands' ->> 'aboveSystolic')::int or p_home_dia >= (p_cfg -> 'bands' ->> 'aboveDiastolic')::int)
         and not p_treated then 'white_coat'
    else null end
$$;
revoke all on function private.bp_pattern_kind(int, int, timestamptz, int, int, timestamptz, boolean, boolean, int, jsonb) from public, anon, authenticated;

-- "Taking blood pressure medicines": an active medicine the HEARTS classifier recognises (private.bp_drug_class, the same one the clinician ladder uses), or one
-- linked to an active hypertension care plan, or whose indication says so. There is no medicine class catalogue yet (S53), so a BP medicine the classifier does not
-- know and with neither link reads as untreated (OQ-S07X-2).
create function private.patient_takes_bp_medicines(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.medications m
      left join public.care_plans cp on cp.id = m.care_plan_id
     where m.patient_id = p_patient and m.is_active and m.stopped_at is null and m.superseded_at is null
       and (private.bp_drug_class(m.drug_name) is not null or (cp.condition = 'hypertension' and cp.status = 'active') or coalesce(m.indication, '') ~* '(hypertens|blood pressure)'))
$$;
revoke all on function private.patient_takes_bp_medicines(uuid) from public, anon, authenticated;

-- 8. Go-live guards (born OFF) ------------------------------------------------------------------------------------------------------------
create function private.home_bp_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  return jsonb_build_array(
    private.go_live_cond('config_signed', 'The home check configuration (protocol, bands, pattern rule) is signed by the Chief Medical Officer',
      exists (select 1 from public.home_bp_programme_signoffs where is_active and approved_by is not null), 'data',
      (select 'version ' || version from public.home_bp_programme_signoffs where is_active and approved_by is not null)),
    private.go_live_cond('task_types_active', 'The care-team review task types exist',
      (select count(*) from public.task_types where code in ('home_bp_check_review', 'bp_pattern_review') and is_active and creatable) = 2, 'data', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;
revoke all on function private.home_bp_go_live_conditions(text) from public, anon, authenticated, service_role;

do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%home_bp_go_live_conditions%' then return; end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the home BP branch by hand' using errcode = '55000';
  end if;
  v_new := replace(v_def, v_anchor,
    E'\n  elsif p_key in (''home_bp_programme'', ''bp_pattern_flag'') then\n    return private.home_bp_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
  execute v_new;
end $$;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('home_bp_programme', 'Seven-day home blood pressure check',
   'Completing a home check, which records the result and opens a routine care-team review task',
   'The home check configuration (protocol, bands, pattern rule) is signed by the Chief Medical Officer; the review task types exist',
   'cmo', array['complete_home_bp_check'],
   'Logging a reading is never behind this guard. Test accounts pass it, but the configuration must still be signed. The phone shows the card only when the guard is open for the signed-in person.'),
  ('bp_pattern_flag', 'Clinician-only white-coat / masked pattern flag',
   'Raising a "pattern for review" task from a clinic reading and a complete home average',
   'The home check configuration (protocol, bands, pattern rule) is signed by the Chief Medical Officer; the review task types exist',
   'cmo', array['evaluate_bp_pattern'],
   'Entering a clinic reading is never behind this guard (it only stores the reading). Nothing here is ever shown to the patient.')
on conflict (key) do nothing;

-- 9. The patient completes a check ----------------------------------------------------------------------------------------------------------
create function public.complete_home_bp_check(p_window_start date) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_pr public.profiles%rowtype;
  v_cfg jsonb;
  v_a jsonb;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_existing public.home_bp_checks%rowtype;
  v_id uuid := gen_random_uuid();
  v_task uuid;
  v_end date;
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_pr from public.profiles where id = v_me and role = 'patient';
  if not found then raise exception 'patients only' using errcode = '42501'; end if;
  if p_window_start is null or p_window_start > v_today or p_window_start < v_today - 60 then
    raise exception 'that start date is not usable' using errcode = '22023';
  end if;
  if not private.go_live_open_patient('home_bp_programme', v_me) then raise exception 'the home check is not open yet' using errcode = '55000'; end if;
  v_cfg := private.home_bp_config();
  if v_cfg is null then raise exception 'the home check configuration is not signed' using errcode = '55000'; end if;

  perform pg_advisory_xact_lock(hashtextextended('home_bp_check:' || v_me || ':' || p_window_start, 0));
  select * into v_existing from public.home_bp_checks where patient_id = v_me and window_start = p_window_start;
  if found then
    return jsonb_build_object('complete', true, 'alreadyRecorded', true, 'id', v_existing.id, 'readings', v_existing.readings, 'days', v_existing.days,
      'systolic', v_existing.mean_systolic, 'diastolic', v_existing.mean_diastolic, 'band', v_existing.band);
  end if;

  v_a := private.home_bp_assess(v_me, p_window_start, v_cfg);
  if not (v_a ->> 'complete')::boolean then
    return jsonb_build_object('complete', false, 'readings', v_a -> 'readings', 'days', v_a -> 'days');
  end if;
  v_end := p_window_start + ((v_cfg -> 'protocol' ->> 'targetDays')::int - 1);

  v_task := private.create_clinical_task(v_me, 'home_bp_check_review', (v_cfg -> 'tasks' ->> 'reviewDueMinutes')::int, 'home_bp_check:' || v_id, null, null, null);
  insert into public.home_bp_checks (id, organisation_id, patient_id, window_start, window_end, readings, days, mean_systolic, mean_diastolic, band, config_version, task_id, is_test)
  values (v_id, v_pr.organisation_id, v_me, p_window_start, v_end, (v_a ->> 'readings')::int, (v_a ->> 'days')::int,
          (v_a ->> 'systolic')::int, (v_a ->> 'diastolic')::int, v_a ->> 'band', private.home_bp_config_version(), v_task, coalesce(v_pr.is_test, false));
  perform private.log_audit('home_bp_check.completed', 'home_bp_checks', v_id, '{}'::jsonb);
  perform private.evaluate_bp_pattern(v_me);
  return jsonb_build_object('complete', true, 'alreadyRecorded', false, 'id', v_id, 'readings', v_a -> 'readings', 'days', v_a -> 'days',
    'systolic', v_a -> 'systolic', 'diastolic', v_a -> 'diastolic', 'band', v_a -> 'band');
end $$;
revoke all on function public.complete_home_bp_check(date) from public, anon;
grant execute on function public.complete_home_bp_check(date) to authenticated;

-- 10. The care team enters a clinic reading --------------------------------------------------------------------------------------------------
create function public.record_clinic_bp_reading(p_patient uuid, p_systolic integer, p_diastolic integer, p_measured_at timestamptz, p_note text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_id uuid := gen_random_uuid();
begin
  if v_me is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not exists (select 1 from public.profiles me join public.clinical_staff cs on cs.profile_id = me.id and cs.active
                  where me.id = v_me and me.role = 'clinician' and me.is_active) then
    raise exception 'only an active clinician can record a clinic reading' using errcode = '42501';
  end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then raise exception 'unknown patient' using errcode = '22023'; end if;
  if not private.staff_may_write(p_patient, v_org, 'medical_history'::public.care_access_category) then
    raise exception 'not tied to this patient' using errcode = '42501';
  end if;
  if p_systolic is null or p_diastolic is null or p_systolic < 60 or p_systolic > 260 or p_diastolic < 30 or p_diastolic > 160 or p_diastolic >= p_systolic then
    raise exception 'that reading is not plausible' using errcode = '22023';
  end if;
  if p_measured_at is null or p_measured_at > now() + interval '5 minutes' or p_measured_at < now() - interval '365 days' then
    raise exception 'that measurement time is not usable' using errcode = '22023';
  end if;
  insert into public.clinic_bp_readings (id, organisation_id, patient_id, systolic, diastolic, measured_at, recorded_by, note, is_test)
  values (v_id, v_org, p_patient, p_systolic, p_diastolic, p_measured_at, v_me, nullif(btrim(p_note), ''), coalesce(v_test, false));
  perform private.log_audit('clinic_bp_reading.recorded', 'clinic_bp_readings', v_id, '{}'::jsonb);
  perform private.evaluate_bp_pattern(p_patient);
  return v_id;
end $$;
revoke all on function public.record_clinic_bp_reading(uuid, integer, integer, timestamptz, text) from public, anon;
grant execute on function public.record_clinic_bp_reading(uuid, integer, integer, timestamptz, text) to authenticated;

-- 11. The C3 rule: the nearest clinic reading and the latest complete home check, within the window. One routine task per pair. -------------
create function private.evaluate_bp_pattern(p_patient uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_cfg jsonb;
  v_pr public.profiles%rowtype;
  v_chk public.home_bp_checks%rowtype;
  v_clinic public.clinic_bp_readings%rowtype;
  v_end timestamptz;
  v_treated boolean;
  v_kind text;
  v_flag uuid := gen_random_uuid();
  v_task uuid;
begin
  -- fail closed: the guard is off or the configuration is unsigned, so nothing is raised (INV-14, INV-16)
  if not private.go_live_open_patient('bp_pattern_flag', p_patient) then return null; end if;
  v_cfg := private.home_bp_config();
  if v_cfg is null then return null; end if;
  select * into v_pr from public.profiles where id = p_patient and role = 'patient';
  if not found then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended('bp_pattern:' || p_patient, 0));
  select * into v_chk from public.home_bp_checks where patient_id = p_patient order by window_end desc, created_at desc limit 1;
  if not found then return null; end if;
  v_end := ((v_chk.window_end + 1)::timestamp at time zone 'Africa/Lagos') - interval '1 second';
  select * into v_clinic from public.clinic_bp_readings c where c.patient_id = p_patient
   order by abs(extract(epoch from (c.measured_at - v_end))) asc, c.measured_at desc limit 1;
  if not found then return null; end if;

  v_treated := private.patient_takes_bp_medicines(p_patient);
  v_kind := private.bp_pattern_kind(v_clinic.systolic, v_clinic.diastolic, v_clinic.measured_at, v_chk.mean_systolic, v_chk.mean_diastolic, v_end,
    v_treated, coalesce((select pp.is_pregnant from public.patient_pregnancy pp where pp.patient_id = p_patient limit 1), false),
    case when v_pr.date_of_birth is null then null else extract(year from age(now(), v_pr.date_of_birth))::int end, v_cfg);
  if v_kind is null then return null; end if;
  if exists (select 1 from public.bp_pattern_flags f where f.clinic_reading_id = v_clinic.id and f.home_check_id = v_chk.id) then return null; end if;

  v_task := private.create_clinical_task(p_patient, 'bp_pattern_review', (v_cfg -> 'tasks' ->> 'patternDueMinutes')::int, 'bp_pattern:' || v_flag, null, null, null);
  insert into public.bp_pattern_flags (id, organisation_id, patient_id, kind, treated, clinic_reading_id, home_check_id, config_version, task_id, is_test)
  values (v_flag, v_pr.organisation_id, p_patient, v_kind, v_treated, v_clinic.id, v_chk.id, private.home_bp_config_version(), v_task, coalesce(v_pr.is_test, false));
  perform private.log_audit('bp_pattern.flagged', 'bp_pattern_flags', v_flag, jsonb_build_object('kind', v_kind));
  return v_flag;
end $$;
revoke all on function private.evaluate_bp_pattern(uuid) from public, anon, authenticated;

-- 12. Self-check ------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if (select is_active or approved_by is not null from public.home_bp_programme_signoffs where version = 1) then
    raise exception 'S07x self-check: the seed configuration must ship unsigned and inactive';
  end if;
  if (select count(*) from public.go_live_guards where key in ('home_bp_programme', 'bp_pattern_flag') and not is_on) <> 2 then
    raise exception 'S07x self-check: both guards must exist and be off';
  end if;
  select count(*) into v_n from public.task_types where code in ('home_bp_check_review', 'bp_pattern_review') and priority_class = 8 and creatable;
  if v_n <> 2 then raise exception 'S07x self-check: the two task types are missing'; end if;
  if has_function_privilege('anon', 'public.complete_home_bp_check(date)', 'EXECUTE') then raise exception 'S07x self-check: anon can execute complete_home_bp_check'; end if;
  if has_function_privilege('anon', 'public.record_clinic_bp_reading(uuid,integer,integer,timestamptz,text)', 'EXECUTE') then raise exception 'S07x self-check: anon can record a clinic reading'; end if;
  if has_function_privilege('authenticated', 'private.evaluate_bp_pattern(uuid)', 'EXECUTE') then raise exception 'S07x self-check: a signed-in user can call the pattern rule directly'; end if;
  if has_table_privilege('authenticated', 'public.clinic_bp_readings', 'INSERT') or has_table_privilege('authenticated', 'public.home_bp_checks', 'INSERT') or has_table_privilege('authenticated', 'public.bp_pattern_flags', 'INSERT') then
    raise exception 'S07x self-check: a signed-in user can insert directly';
  end if;
end $$;

-- T2 Phase 3, part 3 of 3: one "baseline assessment" step for a new Member, which produces their personal preventive plan and puts it in
-- front of a doctor. Brief section 6.1 A and 6.2; discovery report section 4 ("Missing: a single baseline at enrolment step").
--
-- REUSE, NOT A PARALLEL RECORD. Every input already lives in its own table and stays there:
--   risk questionnaire     prevention_risk_scores (written by submitRiskAssessment; smoking, alcohol, family and lifestyle answers are in it)
--   blood pressure         vitals_readings.systolic (last 90 days)
--   weight                 vitals_readings.weight_kg (last 90 days)
--   height (for BMI)       profiles.height_cm
--   waist                  vitals_readings.waist_cm (last 365 days)
--   medical history        conditions / patient_conditions (optional: many people have none)
--   medicines              medications (optional)
--   family history         family_history (optional)
--   previous tests         screening_completions / lab_results (optional)
-- The plan IS the patient's screening_schedules, produced by the existing nightly scheduler (private.run_screening_scheduler, which uses
-- only the CMO-signed screening_rule_sets and the screening_scheduler_enabled guard) run once for this patient at submission. The doctor
-- review is a clinical_tasks row of a new type, preventive_plan_review, in the existing queue; recording the decision closes it. Adjustments use the existing tools
-- (set_screening_state for "not applicable", defer_screening for a later date).
--
-- The one new table, preventive_baselines, records only the step itself: when it was submitted, which items were present (codes and
-- true/false, never the values), what the scheduler did, the plan at that moment (schedule ids, codes, dates), the review task, and the
-- doctor's decision. No clinical value is copied into it.
--
-- SENSITIVE TESTS. Nothing here recommends PSA, HIV, hepatitis or cervical screening by itself. The scheduler schedules only what the signed
-- rule set marks autoSchedule and not optional (PSA is optional; HIV/HCV are risk-based, S47); a printed request for a sensitive test is
-- still issued only with the patient's own opt-in (S98b). The plan marks every sensitive item "your choice first" so the doctor and the
-- patient discuss eligibility and consent before anything is ordered.
--
-- MEMBERS ONLY: a doctor reviews the plan, and Free uses no doctor time. A Free patient keeps the scheduler and the reminders.
-- No guard: it creates a review task for a paying Member and changes nothing a patient cannot already reach (G-01 rule 1).
--
-- Counts before this migration (local replay): preventive_baselines does not exist; task_types has no preventive_plan_review.

-- ---------------------------------------------------------------------------
-- 1. Task type (operational: no confirmation owed, like every queue type created after G-01)
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes,
   pushable, creatable, source_task_keys, note)
values
  ('preventive_plan_review', 1, 8, 4320, 'senior_medical_officer', '{}', 1440, 60, true, true, '{}',
   'T2 Phase 3: a new Member finished the baseline assessment. A doctor reviews the screening plan the signed rules produced, marks anything not applicable or moves it, discusses sensitive tests with the patient, and records the plan as authorised or adjusted (review_preventive_plan). Ids only.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. The step record
-- ---------------------------------------------------------------------------
create table public.preventive_baselines (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  membership_id    uuid references public.patient_memberships (id) on delete set null,
  state            text not null default 'submitted' check (state in ('submitted', 'authorised', 'adjusted')),
  submitted_at     timestamptz not null default now(),
  items            jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  scheduler_result jsonb,
  plan_snapshot    jsonb not null default '[]'::jsonb check (jsonb_typeof(plan_snapshot) = 'array'),
  review_task_id   uuid references public.clinical_tasks (id) on delete set null,
  reviewed_by      uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at      timestamptz,
  review_note      text check (review_note is null or char_length(review_note) <= 1000),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((state in ('authorised', 'adjusted')) = (reviewed_by is not null and reviewed_at is not null)),
  check (state <> 'adjusted' or char_length(btrim(coalesce(review_note, ''))) >= 10)
);
create unique index preventive_baselines_one_per_membership
  on public.preventive_baselines (patient_id, coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index preventive_baselines_patient_idx on public.preventive_baselines (patient_id, submitted_at desc);
create trigger preventive_baselines_set_updated_at before update on public.preventive_baselines
  for each row execute function private.set_updated_at();
comment on table public.preventive_baselines is
  'T2 Phase 3: the baseline assessment step of a Member (one per membership). Records which inputs were present (codes only), the plan the signed scheduler produced (schedule ids and dates), the review task and the doctor''s decision. Written only by submit_my_preventive_baseline and review_preventive_plan.';

alter table public.preventive_baselines enable row level security;
revoke all on public.preventive_baselines from public, anon, authenticated;
grant select on public.preventive_baselines to authenticated;
create policy preventive_baselines_patient_read on public.preventive_baselines for select to authenticated
  using (patient_id = (select auth.uid()));
create policy preventive_baselines_staff_read on public.preventive_baselines for select to authenticated
  using (private.clinician_has_patient_access(patient_id));

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes) values
  ('preventive_baselines', 'patient_id', 'clinical_record', 'review', true,
   'T2 Phase 3: the baseline assessment step and the doctor''s plan decision. Codes and ids only. PROPOSED class, to be confirmed by the CMO and DPO.')
on conflict (table_name) do nothing;

insert into private.analytics_clean_view_sources (view_name, source_rel, definition) values
  ('preventive_baselines', 'public.preventive_baselines', $def$
  select t.* from public.preventive_baselines t where not t.is_test$def$)
  on conflict (view_name) do update set source_rel = excluded.source_rel, definition = excluded.definition;

-- ---------------------------------------------------------------------------
-- 3. Read helpers
-- ---------------------------------------------------------------------------
-- What is on record for the baseline. Codes and true/false only.
create function private.preventive_baseline_items(p_patient uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_array(
    jsonb_build_object('code', 'risk_questionnaire', 'required', true, 'done',
      exists (select 1 from public.prevention_risk_scores r where r.profile_id = p_patient and r.computed_at > now() - interval '365 days')),
    jsonb_build_object('code', 'blood_pressure', 'required', true, 'done',
      exists (select 1 from private.vitals_readings_current v where v.patient_id = p_patient and v.systolic is not null and v.taken_at > now() - interval '90 days')),
    jsonb_build_object('code', 'weight', 'required', true, 'done',
      exists (select 1 from private.vitals_readings_current v where v.patient_id = p_patient and v.weight_kg is not null and v.taken_at > now() - interval '90 days')),
    jsonb_build_object('code', 'height', 'required', true, 'done',
      exists (select 1 from public.profiles p where p.id = p_patient and p.height_cm is not null)),
    jsonb_build_object('code', 'waist', 'required', true, 'done',
      exists (select 1 from private.vitals_readings_current v where v.patient_id = p_patient and v.waist_cm is not null and v.taken_at > now() - interval '365 days')),
    jsonb_build_object('code', 'medical_history', 'required', false, 'done',
      exists (select 1 from private.patient_conditions_current c where c.patient_id = p_patient)
      or exists (select 1 from public.conditions c where c.patient_id = p_patient)),
    jsonb_build_object('code', 'medicines', 'required', false, 'done',
      exists (select 1 from public.medications m where m.patient_id = p_patient)),
    jsonb_build_object('code', 'family_history', 'required', false, 'done',
      exists (select 1 from public.family_history f where f.patient_id = p_patient and f.removed_at is null)),
    jsonb_build_object('code', 'previous_tests', 'required', false, 'done',
      exists (select 1 from public.screening_completions s where s.patient_id = p_patient)
      or exists (select 1 from public.lab_results l where l.patient_id = p_patient))
  )
$$;

-- The plan: the patient's open schedules (and the ones closed with a reason, so a doctor sees what was taken out).
create function private.preventive_plan(p_patient uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id', s.id, 'code', st.code, 'name', st.name, 'due_date', s.due_date, 'status', s.status,
           'sensitive', coalesce(st.sensitive, false),
           -- a sensitive test is never "due" on its own: eligibility and the patient's own choice come first (S98b opt-in)
           'needs_choice', coalesce(st.sensitive, false)
                           and not coalesce((select o.opted_in from public.screening_sensitive_request_optin o where o.patient_id = p_patient), false),
           'deferred', s.deferred_at is not null, 'defer_count', s.defer_count, 'original_due_date', s.original_due_date,
           'reason_code', s.closed_reason_code)
         order by (s.status in ('declined', 'not_applicable')), s.due_date, st.name), '[]'::jsonb)
    from public.screening_schedules s
    join public.screen_types st on st.id = s.screen_type_id
   where s.patient_id = p_patient and s.status in ('pending', 'booked', 'overdue', 'declined', 'not_applicable')
$$;

create function private.current_membership_id(p_patient uuid) returns uuid
language sql stable security definer set search_path = ''
as $$ select m.id from public.patient_memberships m where m.patient_id = p_patient and m.state = 'active' order by m.starts_at desc limit 1 $$;

revoke all on function private.preventive_baseline_items(uuid), private.preventive_plan(uuid), private.current_membership_id(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Patient: read and submit
-- ---------------------------------------------------------------------------
create function public.my_preventive_baseline() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_member boolean;
  b public.preventive_baselines%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_member := private.patient_is_member(v_uid);
  select * into b from public.preventive_baselines x
   where x.patient_id = v_uid
     and coalesce(x.membership_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(private.current_membership_id(v_uid), '00000000-0000-0000-0000-000000000000'::uuid)
   order by x.submitted_at desc limit 1;
  return jsonb_build_object(
    'eligible', v_member,
    'baseline', case when b.id is null then null else jsonb_build_object(
        'id', b.id, 'state', b.state, 'submitted_at', b.submitted_at, 'reviewed_at', b.reviewed_at,
        'review_note', case when b.state in ('authorised', 'adjusted') then b.review_note end) end,
    'items', private.preventive_baseline_items(v_uid),
    'plan', private.preventive_plan(v_uid));
end $$;
revoke all on function public.my_preventive_baseline() from public, anon;
grant execute on function public.my_preventive_baseline() to authenticated;

create function public.submit_my_preventive_baseline() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  v_items jsonb;
  v_missing text[];
  v_membership uuid;
  v_existing uuid;
  v_sched jsonb;
  v_id uuid;
  v_task uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient';
  if not found or pr.organisation_id is null then raise exception 'patient_not_found' using errcode = '22023'; end if;
  if not private.patient_is_member(v_uid) then
    raise exception 'members_only: the doctor-reviewed baseline plan is part of Membership' using errcode = 'P0001';
  end if;
  v_membership := private.current_membership_id(v_uid);

  select id into v_existing from public.preventive_baselines
   where patient_id = v_uid
     and coalesce(membership_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_membership, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;
  if v_existing is not null then
    return jsonb_build_object('baseline_id', v_existing, 'already_submitted', true);
  end if;

  v_items := private.preventive_baseline_items(v_uid);
  select coalesce(array_agg(i ->> 'code' order by o), '{}') into v_missing
    from jsonb_array_elements(v_items) with ordinality as t(i, o)
   where (i ->> 'required')::boolean and not (i ->> 'done')::boolean;
  if cardinality(v_missing) > 0 then
    raise exception 'baseline_incomplete: %', array_to_string(v_missing, ',') using errcode = 'P0001';
  end if;

  -- the existing scheduler, for this patient only: signed rules only, its own guard; it never writes outside screening_schedules
  v_sched := private.run_screening_scheduler(v_uid);

  insert into public.preventive_baselines (organisation_id, patient_id, membership_id, items, scheduler_result, plan_snapshot, is_test)
  values (pr.organisation_id, v_uid, v_membership, v_items, v_sched,
          (select coalesce(jsonb_agg(jsonb_build_object('schedule_id', p ->> 'schedule_id', 'code', p ->> 'code',
                                                        'due_date', p ->> 'due_date', 'status', p ->> 'status')), '[]'::jsonb)
             from jsonb_array_elements(private.preventive_plan(v_uid)) p),
          coalesce(pr.is_test, false))
  returning id into v_id;

  v_task := private.create_clinical_task(v_uid, 'preventive_plan_review', null, 'preventive_baseline:' || v_id::text);
  update public.preventive_baselines set review_task_id = v_task where id = v_id;

  perform private.log_audit('preventive_baseline.submitted', 'preventive_baselines', v_id,
    jsonb_build_object('scheduler_ran', coalesce((v_sched ->> 'ran')::boolean, false), 'task_id', v_task));
  return jsonb_build_object('baseline_id', v_id, 'already_submitted', false, 'task_id', v_task, 'scheduler', v_sched);
end $$;
revoke all on function public.submit_my_preventive_baseline() from public, anon;
grant execute on function public.submit_my_preventive_baseline() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Doctor: read and decide
-- ---------------------------------------------------------------------------
create function public.clinician_preventive_baseline(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare b public.preventive_baselines%rowtype;
begin
  if (select auth.uid()) is null or not private.clinician_has_patient_access(p_patient) then
    raise exception 'not_authorised' using errcode = '42501';
  end if;
  select * into b from public.preventive_baselines where patient_id = p_patient order by submitted_at desc limit 1;
  perform private.log_audit('preventive_baseline.read', 'profiles', p_patient, jsonb_build_object('baseline_id', b.id));
  return jsonb_build_object(
    'baseline', case when b.id is null then null else jsonb_build_object(
        'id', b.id, 'state', b.state, 'submitted_at', b.submitted_at, 'reviewed_at', b.reviewed_at, 'review_note', b.review_note,
        'review_task_id', b.review_task_id, 'scheduler_result', b.scheduler_result,
        'reviewed_by_name', (select p.full_name from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id where cs.id = b.reviewed_by)) end,
    'items', private.preventive_baseline_items(p_patient),
    'plan', private.preventive_plan(p_patient));
end $$;
revoke all on function public.clinician_preventive_baseline(uuid) from public, anon;
grant execute on function public.clinician_preventive_baseline(uuid) to authenticated;

-- Closes the review task once the plan is decided, in the same transaction. Same rules as the other "done directly" closers
-- (private.close_report_signoff_task, private.lab_close_tasks): a claim held by the deciding doctor is ended and the task completed
-- (reliability event, audit, domain event, exactly as queue_complete records it); a task nobody has claimed yet is cancelled with
-- the reason; a claim held by ANOTHER doctor is left for them to finish (never taken from them).
create function private.close_preventive_plan_task(p_task uuid, p_actor uuid, p_decision text) returns void
language plpgsql security definer set search_path = ''
as $$
declare t public.clinical_tasks%rowtype; c public.task_claims%rowtype;
begin
  if p_task is null then return; end if;
  select * into t from public.clinical_tasks where id = p_task and type = 'preventive_plan_review' for update;
  if not found or t.state in ('completed', 'cancelled') then return; end if;
  if t.state = 'claimed' then
    if t.claimed_by is distinct from p_actor then return; end if;
    select * into c from public.task_claims where task_id = p_task and clinician_id = p_actor and ended_at is null for update;
    if found then update public.task_claims set ended_at = now(), end_reason = 'completed' where id = c.id; end if;
    perform private.apply_task_transition(t.id, 'completed', 'clinician', p_actor, 'preventive plan ' || p_decision, null, null,
      jsonb_build_object('code', 'completed_action_taken', 'preventive_plan', p_decision));
    perform private.reliability_event(p_actor, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
    values (t.organisation_id, p_actor, 'queue.complete', 'clinical_task', t.id, jsonb_build_object('type', t.type), t.patient_id);
    perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
      jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || t.id, t.patient_id, 'clinical_task', t.id);
  else
    perform private.apply_task_transition(t.id, 'cancelled', 'lead', p_actor, 'The preventive plan was ' || p_decision || ' directly by a tied doctor');
  end if;
end $$;
revoke all on function private.close_preventive_plan_task(uuid, uuid, text) from public, anon, authenticated;

create function public.review_preventive_plan(p_baseline uuid, p_decision text, p_note text default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  b public.preventive_baselines%rowtype;
  v_staff uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  -- a doctor, never a coordinator (a plan is a clinical judgement)
  select cs.id into v_staff from public.clinical_staff cs
   where cs.profile_id = v_uid and cs.active and cs.status = 'active'
     and cs.doctor_tier in ('senior_medical_officer', 'chief_medical_officer') limit 1;
  if v_staff is null then raise exception 'not_authorised: a doctor reviews the plan' using errcode = '42501'; end if;
  select * into b from public.preventive_baselines where id = p_baseline for update;
  if not found then raise exception 'baseline_not_found' using errcode = '22023'; end if;
  if not private.clinician_has_patient_access(b.patient_id) then raise exception 'not_authorised' using errcode = '42501'; end if;
  if b.state <> 'submitted' then raise exception 'already_reviewed' using errcode = '22023'; end if;
  if p_decision not in ('authorised', 'adjusted') then raise exception 'decision_must_be_authorised_or_adjusted' using errcode = '22023'; end if;
  if p_decision = 'adjusted' and char_length(coalesce(v_note, '')) < 10 then
    raise exception 'note_required: say what you changed and why (at least 10 characters)' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'note_too_long' using errcode = '22023'; end if;
  update public.preventive_baselines set state = p_decision, reviewed_by = v_staff, reviewed_at = now(), review_note = v_note where id = p_baseline;
  perform private.close_preventive_plan_task(b.review_task_id, v_uid, p_decision);
  perform private.log_audit('preventive_baseline.' || p_decision, 'preventive_baselines', p_baseline, jsonb_build_object('patient', b.patient_id));
  return p_baseline;
end $$;
revoke all on function public.review_preventive_plan(uuid, text, text) from public, anon;
grant execute on function public.review_preventive_plan(uuid, text, text) to authenticated;

do $$
begin
  if not exists (select 1 from public.task_types where code = 'preventive_plan_review' and is_active and creatable and min_doctor_tier = 'senior_medical_officer') then
    raise exception 'preventive_plan_review task type missing';
  end if;
  if has_function_privilege('anon', 'public.submit_my_preventive_baseline()', 'EXECUTE')
     or has_function_privilege('anon', 'public.review_preventive_plan(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_preventive_baseline(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.preventive_baseline_items(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.preventive_plan(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.close_preventive_plan_task(uuid,uuid,text)', 'EXECUTE') then
    raise exception 'a baseline function is callable by the wrong role';
  end if;
  if has_table_privilege('authenticated', 'public.preventive_baselines', 'INSERT')
     or has_table_privilege('authenticated', 'public.preventive_baselines', 'UPDATE')
     or has_table_privilege('anon', 'public.preventive_baselines', 'SELECT') then
    raise exception 'preventive_baselines must be written only through the functions';
  end if;
end $$;

select private.rebuild_analytics_clean_views();

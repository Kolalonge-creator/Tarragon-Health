-- S60 part 1 of 3: doctor review of a symptom check (spec 12.10), and the two module events (spec Events block).
--
-- WHAT THIS ADDS
--   * public.symptom_reviews: one optional review per symptom triage assessment. A patient (or the person acting for them) asks for
--     it; a clinician holding the matching `symptom_review` task completes it with a final diagnosis code, whether they agree with the
--     checker's urgency, and their own category. This is the clinician side of the monthly accuracy audit (part 2).
--   * a STATED review time that is read from the ACTIVE escalation_slas config (pathway symptom_triage, tier clinician_review) and
--     nowhere else. While the active config does not carry that pathway (the F1 draft is unsigned) no time is stated and none is
--     invented: the screen says a clinician will look, with no number. This migration signs nothing.
--   * INV-12 / INV-10: there is NO staff policy on the table. A clinician reads a review through public.read_symptom_review_audited(),
--     which applies the per-patient tie (private.can_staff_read_clinical, i.e. an active task, assignment or on-call page, plus audited
--     break-glass) and writes an audit row for every read, allowed or denied. The work-queue list returns a patient number and times
--     only, no symptom, no category. private.is_org_staff() is not used anywhere here.
--   * events on the S10 outbox: symptom_check.completed (an assessment was recorded) and symptom_review.completed (a review finished).
--     Payloads are ids only (INV-07). A failure to write an event is audited and opens an incident; it never rolls back the assessment.
--
-- INV-14: the checker stays behind go-live guard symptom_checker_enabled (OFF). request_symptom_review refuses with 42501 while the
-- guard is closed for that patient (test accounts excepted, the S37 rule), so no review can be started on a closed checker.
--
-- ROWS AFFECTED: none changed. New table, two new event types. symptom_triage_assessments gains one AFTER INSERT trigger (no backfill:
-- an event is written only for new assessments).
-- GRANT NOTE: new tables get an `authenticated` default grant, so this revokes it and grants only the columns a patient may read.

-- ---------------------------------------------------------------------------
-- 1. Event types (data, per S10)
-- ---------------------------------------------------------------------------
insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('symptom_check.completed', 'A symptom check was completed and recorded; the next step can be offered', 'S60', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('symptom_check.completed', 1, array['assessment_id'])
on conflict (event_type, version) do nothing;

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('symptom_review.completed', 'A clinician finished reviewing a symptom check; feeds the accuracy audit', 'S60', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('symptom_review.completed', 1, array['review_id', 'assessment_id'])
on conflict (event_type, version) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------
create table public.symptom_reviews (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  assessment_id         uuid not null unique references public.symptom_triage_assessments (id) on delete cascade,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  status                text not null default 'requested' check (status in ('requested', 'completed')),
  -- provenance (convention for clinical tables): where the row came from and who recorded it
  source                text not null default 'patient_request' check (source in ('patient_request')),
  recorded_by           uuid not null references public.profiles (id) on delete restrict,
  requested_at          timestamptz not null default now(),
  -- the time stated to the patient, copied from the ACTIVE escalation_slas config at request time (INV-16); all three null when
  -- the active config carries no symptom_triage clinician_review entry
  sla_version           integer,
  stated_minutes        integer check (stated_minutes is null or stated_minutes > 0),
  due_at                timestamptz,
  task_id               uuid references public.clinical_tasks (id) on delete set null,
  protocol_version      integer not null references public.triage_protocols (version) on delete restrict,
  -- the clinician's side
  clinician_id          uuid references public.profiles (id) on delete restrict,
  final_diagnosis_code  text check (final_diagnosis_code is null or final_diagnosis_code ~ '^[A-TV-Z][0-9][0-9AB](\.[0-9A-Z]{1,4})?$'),
  final_diagnosis_label text check (final_diagnosis_label is null or char_length(btrim(final_diagnosis_label)) between 2 and 200),
  clinician_category    public.triage_category,
  agrees                boolean,
  patient_message       text check (patient_message is null or char_length(btrim(patient_message)) between 10 and 600),
  internal_note         text check (internal_note is null or char_length(internal_note) <= 2000),
  reviewed_at           timestamptz,
  is_test               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint symptom_reviews_due_needs_sla check ((sla_version is null) = (stated_minutes is null) and (stated_minutes is null) = (due_at is null)),
  constraint symptom_reviews_completed_is_complete check (
    status <> 'completed'
    or (clinician_id is not null and reviewed_at is not null and agrees is not null and clinician_category is not null
        and final_diagnosis_code is not null and patient_message is not null))
);
create index symptom_reviews_patient_idx on public.symptom_reviews (patient_id, requested_at desc);
create index symptom_reviews_open_idx on public.symptom_reviews (organisation_id, due_at) where status = 'requested';
create index symptom_reviews_audit_idx on public.symptom_reviews (organisation_id, reviewed_at) where status = 'completed';

alter table public.symptom_reviews enable row level security;
revoke all on public.symptom_reviews from public, anon, authenticated;

-- A patient, or someone who currently holds a clinical-read grant for them (a caregiver, a parent: the same category-scoped rule the
-- assessment table uses, so access ends the moment the grant does), reads status, time and the clinician's plain message. Not the
-- diagnosis code, the clinician's category, the agreement flag or the internal note: those go through the audited function to staff
-- only. Whoever merely recorded the request has no standing read of their own. The cast is explicit because can_read_clinical has
-- two overloads (an untyped literal is ambiguous).
create policy symptom_reviews_select_own on public.symptom_reviews
  for select to authenticated
  using (patient_id = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));
grant select (id, assessment_id, patient_id, status, requested_at, due_at, stated_minutes, reviewed_at, patient_message)
  on public.symptom_reviews to authenticated;

create trigger symptom_reviews_set_updated_at
  before update on public.symptom_reviews
  for each row execute function private.set_updated_at();

-- A completed review is a clinical record: never edited, never deleted (a correction is a new, audited process, not an UPDATE).
create or replace function private.symptom_reviews_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a symptom review cannot be deleted' using errcode = '42501';
  end if;
  if old.status = 'completed' then
    raise exception 'a completed symptom review cannot be changed' using errcode = '42501';
  end if;
  if new.assessment_id is distinct from old.assessment_id or new.patient_id is distinct from old.patient_id
     or new.organisation_id is distinct from old.organisation_id or new.protocol_version is distinct from old.protocol_version then
    raise exception 'a symptom review cannot be moved to another assessment or patient' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.symptom_reviews_guard() from public, anon, authenticated;
create trigger symptom_reviews_00_guard
  before update or delete on public.symptom_reviews
  for each row execute function private.symptom_reviews_guard();

-- ---------------------------------------------------------------------------
-- 3. The stated review time (read from the signed config, never invented)
-- ---------------------------------------------------------------------------
create or replace function private.symptom_review_sla()
returns table (sla_version integer, minutes integer)
language sql stable security definer set search_path = ''
as $$
  select s.version, (e ->> 'sla_minutes')::integer
    from public.escalation_slas s, jsonb_array_elements(s.config) e
   where s.is_active and s.approved_at is not null
     and e ->> 'pathway' = 'symptom_triage' and e ->> 'tier' = 'clinician_review'
     and (e ->> 'sla_minutes') ~ '^[0-9]+$' and (e ->> 'sla_minutes')::integer > 0
   order by s.version desc
   limit 1
$$;
revoke all on function private.symptom_review_sla() from public, anon, authenticated;

create or replace function public.symptom_review_stated_time() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('stated', true, 'minutes', r.minutes, 'sla_version', r.sla_version) from private.symptom_review_sla() r),
    jsonb_build_object('stated', false))
$$;
revoke all on function public.symptom_review_stated_time() from public;
grant execute on function public.symptom_review_stated_time() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Ask for a review
-- ---------------------------------------------------------------------------
create or replace function public.request_symptom_review(p_assessment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.symptom_triage_assessments%rowtype;
  r public.symptom_reviews%rowtype;
  v_sla_version integer;
  v_minutes integer;
  v_task uuid;
  v_test boolean;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  -- the same answer for "no such assessment" and "not yours": never confirm another person's assessment exists
  if not found or (a.patient_id <> v_uid and a.logged_by_profile_id is distinct from v_uid) then
    raise exception 'not found' using errcode = '42501';
  end if;
  -- INV-14: a closed checker starts nothing, whatever the app sent
  if not private.go_live_open_patient('symptom_checker_enabled', a.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;

  select * into r from public.symptom_reviews where assessment_id = a.id;
  if not found then
    select s.sla_version, s.minutes into v_sla_version, v_minutes from private.symptom_review_sla() s;
    select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
    insert into public.symptom_reviews
      (organisation_id, assessment_id, patient_id, recorded_by, sla_version, stated_minutes, due_at, protocol_version, is_test)
    values
      (a.organisation_id, a.id, a.patient_id, v_uid, v_sla_version, v_minutes,
       case when v_minutes is null then null else now() + make_interval(mins => v_minutes) end, a.protocol_version, coalesce(v_test, false))
    on conflict (assessment_id) do nothing;
    select * into r from public.symptom_reviews where assessment_id = a.id;
  end if;

  -- The work item. A repeat request retries it if the first attempt failed; a failure is loud, never a silent success.
  if r.task_id is null and r.status = 'requested' then
    begin
      v_task := private.create_clinical_task(r.patient_id, 'symptom_review', r.stated_minutes, 'symptom_review:' || r.id, null, null, null);
      update public.symptom_reviews set task_id = v_task where id = r.id;
      r.task_id := v_task;
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, v_uid, 'symptom_review.task_error', 'symptom_review', r.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_review_task_failed:' || r.id, 'A symptom review request has no task',
        'A patient asked for a symptom review and the clinical task could not be created; see audit_log action symptom_review.task_error. Asking again retries it.');
    end;
  end if;

  return jsonb_build_object('review_id', r.id, 'status', r.status, 'stated_minutes', r.stated_minutes, 'due_at', r.due_at, 'has_task', r.task_id is not null);
end $$;
revoke all on function public.request_symptom_review(uuid) from public;
grant execute on function public.request_symptom_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Clinician side: list (queue metadata only), audited read, complete
-- ---------------------------------------------------------------------------
create or replace function private.is_reviewing_clinician() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.clinical_staff cs
                  where cs.profile_id = (select auth.uid()) and cs.active and cs.status = 'active' and cs.doctor_tier is not null
                    and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank('medical_officer'))
$$;
revoke all on function private.is_reviewing_clinician() from public, anon, authenticated;

create or replace function public.list_my_symptom_reviews() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- queue metadata only: a patient number and times. No symptom, category or name until the audited read.
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'requested_at', r.requested_at, 'due_at', r.due_at,
                                        'patient_ref', p.patient_number) order by coalesce(r.due_at, r.requested_at))
      from public.symptom_reviews r
      join public.profiles p on p.id = r.patient_id
     where r.status = 'requested' and private.clinician_has_patient_access(r.patient_id)), '[]'::jsonb);
end $$;
revoke all on function public.list_my_symptom_reviews() from public;
grant execute on function public.list_my_symptom_reviews() to authenticated;

create or replace function public.read_symptom_review_audited(p_review uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.symptom_reviews%rowtype;
  a public.symptom_triage_assessments%rowtype;
  pr public.profiles%rowtype;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null or not private.is_reviewing_clinician() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into r from public.symptom_reviews where id = p_review;
  if not found then return jsonb_build_object('status', 'not_found'); end if;

  if not private.can_staff_read_clinical(r.patient_id, 'medical_history'::public.care_access_category) then
    perform private.audit_chart_read(r.patient_id, array['symptom_review'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;

  select * into a from public.symptom_triage_assessments where id = r.assessment_id;
  select * into pr from public.profiles where id = r.patient_id;
  perform private.audit_chart_read(r.patient_id, array['symptom_review'], p_reason, 'success');
  return jsonb_build_object(
    'status', 'ok',
    'review', jsonb_build_object(
      'id', r.id, 'review_status', r.status, 'requested_at', r.requested_at, 'due_at', r.due_at, 'stated_minutes', r.stated_minutes,
      'final_diagnosis_code', r.final_diagnosis_code, 'final_diagnosis_label', r.final_diagnosis_label,
      'clinician_category', r.clinician_category, 'agrees', r.agrees, 'patient_message', r.patient_message, 'reviewed_at', r.reviewed_at),
    'assessment', jsonb_build_object(
      'id', a.id, 'complaint', a.presenting_complaint_key, 'category', a.category, 'override_category', a.override_category,
      'clinician_review_required', a.clinician_review_required, 'rationale', a.rationale, 'protocol_version', a.protocol_version,
      'capture', a.initial_capture, 'questions_asked', a.questions_asked, 'red_flag_screen', a.red_flag_screen, 'recorded_at', a.created_at),
    'patient', jsonb_build_object(
      'id', pr.id, 'name', pr.full_name, 'patient_number', pr.patient_number, 'sex', pr.sex,
      'age_years', case when pr.date_of_birth is null then null else extract(year from age(pr.date_of_birth))::integer end));
end $$;
revoke all on function public.read_symptom_review_audited(uuid, text) from public;
grant execute on function public.read_symptom_review_audited(uuid, text) to authenticated;

create or replace function private.triage_rank(p public.triage_category) returns integer
language sql immutable set search_path = ''
as $$ select case p when 'emergency' then 3 when 'urgent' then 2 when 'routine' then 1 else 0 end $$;
revoke all on function private.triage_rank(public.triage_category) from public, anon, authenticated;

create or replace function public.complete_symptom_review(
  p_review uuid, p_final_code text, p_final_label text, p_clinician_category public.triage_category,
  p_agrees boolean, p_patient_message text, p_internal_note text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.symptom_reviews%rowtype;
  a public.symptom_triage_assessments%rowtype;
  v_event uuid;
begin
  if v_uid is null or not private.is_reviewing_clinician() then
    raise exception 'only a clinician at medical officer level or above can complete a review' using errcode = '42501';
  end if;
  select * into r from public.symptom_reviews where id = p_review for update;
  if not found then raise exception 'unknown review' using errcode = '22023'; end if;
  if r.status = 'completed' then raise exception 'this review is already complete' using errcode = '22023'; end if;
  -- INV-12: only a clinician tied to this patient. A denied attempt is audited.
  if not private.clinician_has_patient_access(r.patient_id) then
    perform private.audit_chart_read(r.patient_id, array['symptom_review'], 'attempted to complete a symptom review without a tie', 'denied');
    raise exception 'you do not hold a task for this patient' using errcode = '42501';
  end if;
  if p_agrees is null or p_clinician_category is null or p_final_code is null or p_patient_message is null then
    raise exception 'agreement, your category, a final diagnosis code and a message for the patient are all needed' using errcode = '22023';
  end if;
  select * into a from public.symptom_triage_assessments where id = r.assessment_id;
  -- "agrees" must mean something: it cannot be true while the clinician's own category differs from the checker's
  if p_agrees and p_clinician_category is distinct from a.category then
    raise exception 'you cannot agree with the checker and give a different category' using errcode = '22023';
  end if;

  update public.symptom_reviews
     set status = 'completed', clinician_id = v_uid, final_diagnosis_code = upper(btrim(p_final_code)),
         final_diagnosis_label = nullif(btrim(p_final_label), ''), clinician_category = p_clinician_category, agrees = p_agrees,
         patient_message = btrim(p_patient_message), internal_note = nullif(btrim(p_internal_note), ''), reviewed_at = now()
   where id = r.id;

  perform private.audit_chart_read(r.patient_id, array['symptom_review'], 'completed a symptom review', 'success');
  v_event := private.emit_domain_event('symptom_review.completed', r.organisation_id,
    jsonb_build_object('review_id', r.id, 'assessment_id', r.assessment_id), 'symptom_review.completed:' || r.id,
    r.patient_id, 'symptom_review', r.id, 'normal');

  -- finish the work item when this clinician holds its claim (a tie from another route simply has no claim to finish)
  -- The review is the clinical record and is already saved; a failure to close the work item must not undo it, but it is never silent.
  if r.task_id is not null and exists (select 1 from public.task_claims c where c.task_id = r.task_id and c.clinician_id = v_uid and c.ended_at is null) then
    begin
      perform public.queue_complete(r.task_id, jsonb_build_object('symptom_review', r.id));
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (r.organisation_id, v_uid, 'symptom_review.task_complete_error', 'symptom_review', r.id, jsonb_build_object('task_id', r.task_id, 'error', sqlerrm));
      perform private.page_incident(r.organisation_id, 'symptom_review_task_not_closed:' || r.id, 'A completed symptom review left its task open',
        'The review was saved but its clinical task could not be completed; see audit_log action symptom_review.task_complete_error.');
    end;
  end if;
  perform private.log_audit('symptom_review.completed', 'symptom_review', r.id, jsonb_build_object('agrees', p_agrees));
  return jsonb_build_object('ok', true, 'review_id', r.id, 'event_id', v_event);
end $$;
revoke all on function public.complete_symptom_review(uuid, text, text, public.triage_category, boolean, text, text) from public;
grant execute on function public.complete_symptom_review(uuid, text, text, public.triage_category, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. symptom_check.completed: one event per recorded assessment (loud on failure, never blocks the assessment)
-- ---------------------------------------------------------------------------
create or replace function private.emit_symptom_check_completed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  begin
    perform private.emit_domain_event('symptom_check.completed', new.organisation_id, jsonb_build_object('assessment_id', new.id),
      'symptom_check.completed:' || new.id, new.patient_id, 'symptom_triage_assessment', new.id, 'normal');
  exception when others then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'symptom_check.event_error', 'symptom_triage_assessment', new.id, jsonb_build_object('error', sqlerrm));
    perform private.page_incident(new.organisation_id, 'symptom_check_event_failed:' || new.id, 'A symptom check event could not be written',
      'The assessment itself was recorded and any escalation was raised; only the symptom_check.completed event failed. See audit_log action symptom_check.event_error.');
  end;
  return null;
end $$;
revoke all on function private.emit_symptom_check_completed() from public, anon, authenticated;
drop trigger if exists symptom_triage_assessments_zz_event on public.symptom_triage_assessments;
create trigger symptom_triage_assessments_zz_event
  after insert on public.symptom_triage_assessments
  for each row execute function private.emit_symptom_check_completed();

-- ---------------------------------------------------------------------------
-- 7. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptom_reviews'
              and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'S60 assertion: a staff-wide policy exists on symptom_reviews';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'symptom_reviews') <> 1 then
    raise exception 'S60 assertion: symptom_reviews should have exactly one policy';
  end if;
  if has_table_privilege('authenticated', 'public.symptom_reviews', 'INSERT') or has_table_privilege('authenticated', 'public.symptom_reviews', 'UPDATE')
     or has_table_privilege('authenticated', 'public.symptom_reviews', 'DELETE') or has_table_privilege('authenticated', 'public.symptom_reviews', 'SELECT') then
    raise exception 'S60 assertion: authenticated holds a table-level grant on symptom_reviews';
  end if;
  if has_column_privilege('authenticated', 'public.symptom_reviews', 'final_diagnosis_code', 'SELECT')
     or has_column_privilege('authenticated', 'public.symptom_reviews', 'internal_note', 'SELECT') then
    raise exception 'S60 assertion: a patient can select the diagnosis code or the internal note';
  end if;
  if has_function_privilege('anon', 'public.request_symptom_review(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_symptom_review_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_symptom_review(uuid,text,text,public.triage_category,boolean,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_symptom_reviews()', 'EXECUTE')
     or has_function_privilege('anon', 'public.symptom_review_stated_time()', 'EXECUTE') then
    raise exception 'S60 assertion: anon can execute a symptom review function';
  end if;
  if not exists (select 1 from public.event_types where event_type = 'symptom_check.completed')
     or not exists (select 1 from public.event_types where event_type = 'symptom_review.completed') then
    raise exception 'S60 assertion: event types missing';
  end if;
end $$;

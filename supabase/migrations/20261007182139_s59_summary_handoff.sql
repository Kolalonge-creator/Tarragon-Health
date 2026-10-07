-- S59 part 2 of 4: the next-step hand-off (spec 12.5): a structured summary of a symptom check, sent only when the patient chooses,
-- that appears in the clinician's patient summary once a consultation is booked.
--
-- WHAT THIS ADDS
--   * public.symptom_session_summaries: one summary per assessment. It is WRITTEN ONLY when the patient (or the person who ran the check
--     for them) chooses to send it, through send_symptom_summary(), and the payload is BUILT HERE from the stored assessment, never
--     taken from the client, so it cannot be forged or embellished. It carries what was reported (complaint, onset, severity, symptoms
--     ticked, the questions and answers, the red flags that fired, the checker's four-category result), and never a pregnancy flag
--     (reproductive_health is a protected category, S35). It is immutable: only the link to an appointment can be set.
--   * link_symptom_summary_to_appointment(): ties a sent summary to a booked consultation of the same patient. One summary, one open
--     appointment at a time.
--   * private.symptom_summaries_for_clinician(): what the clinician's patient summary shows: only summaries whose linked appointment is
--     still open (booked, confirmed, scheduled, checked in or in progress and not yet ended). A summary that was sent but never tied to a
--     consultation is NOT shown to staff by this function.
--   * public.clinician_patient_summary is extended with a `symptom_summaries` section, behind the same tie (INV-12) and the same
--     medical_history category gate as allergies and conditions, inside the same single audited read (INV-10). The function is changed
--     by patching its CURRENT live definition with a marker check (the S60 pattern), so another session's edits to the function body
--     are preserved and a drifted definition fails loudly instead of being overwritten.
--   * events: symptom_summary.sent (ids only, INV-07).
--
-- INV-14: send and link refuse (42501) while symptom_checker_enabled is closed for that patient (test accounts excepted, the S37 rule).
-- Consultations are adults only (OQ-129, S21): a summary about a child cannot be tied to a booking, because the child cannot be booked.
--
-- ROWS AFFECTED: none changed. New table (empty), one new event type, one function patched in place.
-- GRANT NOTE: a new table gets an `authenticated` default grant, so it is revoked and only SELECT is granted back.

insert into public.event_types (event_type, description, owner_section, is_urgent)
values ('symptom_summary.sent', 'A patient chose to send a symptom check summary to their care team', 'S59', false)
on conflict (event_type) do nothing;
insert into public.event_type_versions (event_type, version, required_keys)
values ('symptom_summary.sent', 1, array['summary_id'])
on conflict (event_type, version) do nothing;

create table public.symptom_session_summaries (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  assessment_id    uuid not null unique references public.symptom_triage_assessments (id) on delete cascade,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  -- provenance (clinical-table convention): where it came from and who chose to send it
  source           text not null default 'patient_sent' check (source = 'patient_sent'),
  recorded_by      uuid not null references public.profiles (id) on delete restrict,
  sent_at          timestamptz not null default now(),
  payload          jsonb not null check (jsonb_typeof(payload) = 'object'),
  appointment_id   uuid references public.appointments (id) on delete set null,
  linked_at        timestamptz,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  constraint symptom_session_summaries_link_pair check ((appointment_id is null) or (linked_at is not null))
);
create index symptom_session_summaries_patient_idx on public.symptom_session_summaries (patient_id, sent_at desc);
create index symptom_session_summaries_appointment_idx on public.symptom_session_summaries (appointment_id) where appointment_id is not null;

alter table public.symptom_session_summaries enable row level security;
revoke all on public.symptom_session_summaries from public, anon, authenticated;

-- The patient, the person who chose to send it, or a current care-circle grantee (medical_history): the same rule the sessions view uses.
-- NO staff policy: staff see a summary only through the audited patient summary, and only once it is tied to an open consultation.
create policy symptom_session_summaries_select_own on public.symptom_session_summaries
  for select to authenticated
  using (patient_id = (select auth.uid())
         or recorded_by = (select auth.uid())
         or private.can_read_clinical(patient_id, 'medical_history'::public.care_access_category));
grant select on public.symptom_session_summaries to authenticated;

-- Immutable except for the appointment link; never deleted.
create or replace function private.symptom_session_summaries_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a sent symptom summary cannot be deleted' using errcode = '42501';
  end if;
  if new.payload is distinct from old.payload or new.assessment_id is distinct from old.assessment_id
     or new.patient_id is distinct from old.patient_id or new.organisation_id is distinct from old.organisation_id
     or new.recorded_by is distinct from old.recorded_by or new.sent_at is distinct from old.sent_at then
    raise exception 'a sent symptom summary cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.symptom_session_summaries_guard() from public, anon, authenticated;
create trigger symptom_session_summaries_00_guard
  before update or delete on public.symptom_session_summaries
  for each row execute function private.symptom_session_summaries_guard();

-- ---------------------------------------------------------------------------
-- Is this appointment one a summary may be tied to? (same patient, still open)
-- ---------------------------------------------------------------------------
create or replace function private.appointment_is_open(p_appointment uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.appointments ap
     where ap.id = p_appointment and ap.patient_id = p_patient
       and (ap.status::text = 'in_progress'
            or (ap.status::text in ('scheduled', 'booked', 'confirmed', 'checked_in') and ap.ends_at >= now())))
$$;
revoke all on function private.appointment_is_open(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The payload, built from the stored assessment
-- ---------------------------------------------------------------------------
create or replace function private.build_symptom_summary_payload(a public.symptom_triage_assessments) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_label text;
begin
  select elem ->> 'label' into v_label
    from jsonb_array_elements((select config from public.triage_protocols where version = a.protocol_version) -> 'pathways') elem
   where elem ->> 'key' = a.presenting_complaint_key limit 1;
  return jsonb_build_object(
    'complaint', a.presenting_complaint_key,
    'complaint_label', coalesce(v_label, a.presenting_complaint_key),
    'category', a.category,
    'urgency_level', a.urgency_level,
    'clinician_review_required', a.clinician_review_required,
    'onset', a.initial_capture ->> 'onset',
    'severity', a.initial_capture -> 'severity',
    'duration_hours', a.initial_capture -> 'durationHours',
    'associated_symptoms', coalesce(a.initial_capture -> 'associatedSymptoms', '[]'::jsonb),
    'triggers', coalesce(a.initial_capture -> 'triggers', '[]'::jsonb),
    -- pregnancy is a reproductive_health fact: it is never copied into a summary that staff read through the patient summary
    'history', coalesce((select jsonb_agg(h) from jsonb_array_elements_text(coalesce(a.initial_capture -> 'relevantHistory', '[]'::jsonb)) h
                          where h <> all (array['pregnant'])), '[]'::jsonb),
    'questions', coalesce((select jsonb_agg(jsonb_build_object('prompt', q ->> 'prompt', 'answer', q -> 'answer'))
                            from jsonb_array_elements(coalesce(a.questions_asked, '[]'::jsonb)) q), '[]'::jsonb),
    'red_flags_fired', coalesce((select jsonb_agg(f ->> 'label') from jsonb_array_elements(coalesce(a.red_flag_screen -> 'fired', '[]'::jsonb)) f), '[]'::jsonb),
    'answered_by_carer', a.logged_by_profile_id is not null,
    'engine', a.engine,
    'engine_version', a.engine_version,
    'checked_at', a.created_at);
end $$;
revoke all on function private.build_symptom_summary_payload(public.symptom_triage_assessments) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Send (the patient's choice), and link to a booked consultation
-- ---------------------------------------------------------------------------
create or replace function public.send_symptom_summary(p_assessment uuid, p_consent_shown boolean, p_appointment uuid default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  a public.symptom_triage_assessments%rowtype;
  s public.symptom_session_summaries%rowtype;
  v_test boolean;
  v_event uuid;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  -- the patient has to have been shown what is being sent (the screen shows the payload before this is called)
  if p_consent_shown is not true then
    raise exception 'the summary has to be shown to the person before it can be sent' using errcode = '22023';
  end if;
  select * into a from public.symptom_triage_assessments where id = p_assessment;
  -- the same answer for "no such check" and "not yours"
  if not found or (a.patient_id <> v_uid and a.logged_by_profile_id is distinct from v_uid) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if not private.go_live_open_patient('symptom_checker_enabled', a.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;

  select * into s from public.symptom_session_summaries where assessment_id = a.id;
  if not found then
    select coalesce(is_test, false) into v_test from public.profiles where id = a.patient_id;
    insert into public.symptom_session_summaries (organisation_id, assessment_id, patient_id, recorded_by, payload, is_test)
    values (a.organisation_id, a.id, a.patient_id, v_uid, private.build_symptom_summary_payload(a), coalesce(v_test, false))
    on conflict (assessment_id) do nothing;
    select * into s from public.symptom_session_summaries where assessment_id = a.id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
      values (a.organisation_id, v_uid, 'symptom_summary.sent', 'symptom_session_summary', s.id, jsonb_build_object('assessment_id', a.id));
    -- an event failure never blocks the patient's choice, and is never silent
    begin
      v_event := private.emit_domain_event('symptom_summary.sent', a.organisation_id, jsonb_build_object('summary_id', s.id),
        'symptom_summary.sent:' || s.id, a.patient_id, 'symptom_session_summary', s.id, 'normal');
    exception when others then
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
        values (a.organisation_id, v_uid, 'symptom_summary.event_error', 'symptom_session_summary', s.id, jsonb_build_object('error', sqlerrm));
      perform private.page_incident(a.organisation_id, 'symptom_summary_event_failed:' || s.id, 'A symptom summary event could not be written',
        'The summary was sent and saved; only the symptom_summary.sent event failed. See audit_log action symptom_summary.event_error.');
    end;
  end if;

  if p_appointment is not null then
    return public.link_symptom_summary_to_appointment(s.id, p_appointment);
  end if;
  return jsonb_build_object('summary_id', s.id, 'linked', s.appointment_id is not null, 'appointment_id', s.appointment_id);
end $$;
revoke all on function public.send_symptom_summary(uuid, boolean, uuid) from public;

create or replace function public.link_symptom_summary_to_appointment(p_summary uuid, p_appointment uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  s public.symptom_session_summaries%rowtype;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  select * into s from public.symptom_session_summaries where id = p_summary for update;
  if not found or (s.patient_id <> v_uid and s.recorded_by <> v_uid) then
    raise exception 'not found' using errcode = '42501';
  end if;
  if not private.go_live_open_patient('symptom_checker_enabled', s.patient_id) then
    raise exception 'The symptom checker is not open yet' using errcode = '42501';
  end if;
  -- the booking must be the patient's own and still open: a summary is never tied to someone else's consultation
  if not private.appointment_is_open(p_appointment, s.patient_id) then
    raise exception 'that appointment is not an open booking for this patient' using errcode = '22023';
  end if;
  -- one open appointment at a time
  if s.appointment_id is not null and s.appointment_id <> p_appointment and private.appointment_is_open(s.appointment_id, s.patient_id) then
    raise exception 'this summary is already tied to another open appointment' using errcode = '22023';
  end if;
  update public.symptom_session_summaries set appointment_id = p_appointment, linked_at = now() where id = s.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (s.organisation_id, v_uid, 'symptom_summary.linked', 'symptom_session_summary', s.id, jsonb_build_object('appointment_id', p_appointment));
  return jsonb_build_object('summary_id', s.id, 'linked', true, 'appointment_id', p_appointment);
end $$;
revoke all on function public.link_symptom_summary_to_appointment(uuid, uuid) from public;
grant execute on function public.send_symptom_summary(uuid, boolean, uuid) to authenticated;
grant execute on function public.link_symptom_summary_to_appointment(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- What the clinician's patient summary shows
-- ---------------------------------------------------------------------------
create or replace function private.symptom_summaries_for_clinician(p_patient uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'sent_at', s.sent_at, 'appointment_id', s.appointment_id, 'payload', s.payload) order by s.sent_at desc), '[]'::jsonb)
    from (select * from public.symptom_session_summaries x
           where x.patient_id = p_patient and x.appointment_id is not null and private.appointment_is_open(x.appointment_id, x.patient_id)
           order by x.sent_at desc limit 3) s
$$;
revoke all on function private.symptom_summaries_for_clinician(uuid) from public, anon, authenticated;

do $$
declare
  v_def text := pg_get_functiondef('public.clinician_patient_summary(uuid, text)'::regprocedure);
  v_new text;
  v_marker text := E'  -- no section readable means no tie, no break-glass and no support view';
begin
  if position('symptom_summaries' in v_def) > 0 then
    return; -- already patched (a replay)
  end if;
  if position(v_marker in v_def) = 0 then
    raise exception 'S59: clinician_patient_summary marker not found (the definition drifted); do not overwrite it blindly';
  end if;
  v_new := replace(v_def, v_marker,
    E'  -- symptom check summaries a patient chose to send, for a consultation that is booked (S59, spec 12.5). Same tie and category\n' ||
    E'  -- gate as allergies and conditions, inside the same single audited read.\n' ||
    E'  if v_lead or private.can_staff_read_clinical(p_patient, ''medical_history''::public.care_access_category) then\n' ||
    E'    v_sections := v_sections || ''symptom_summaries''::text;\n' ||
    E'    v_out := v_out || jsonb_build_object(''symptom_summaries'', private.symptom_summaries_for_clinician(p_patient));\n' ||
    E'  else\n' ||
    E'    v_denied := v_denied || ''symptom_summaries''::text;\n' ||
    E'  end if;\n\n' || v_marker);
  if v_new = v_def then raise exception 'S59: the patch changed nothing'; end if;
  execute v_new;
end $$;

-- The dashboard lists where the guard is enforced.
update public.go_live_guards
   set enforced_in = enforced_in || array['send_symptom_summary and link_symptom_summary_to_appointment (public functions, refuse with 42501 while closed)']
 where key = 'symptom_checker_enabled'
   and not (enforced_in @> array['send_symptom_summary and link_symptom_summary_to_appointment (public functions, refuse with 42501 while closed)']);

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'symptom_session_summaries'
              and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'S59 assertion: a staff-wide policy exists on symptom_session_summaries';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'symptom_session_summaries') <> 1 then
    raise exception 'S59 assertion: symptom_session_summaries should have exactly one policy';
  end if;
  if has_table_privilege('authenticated', 'public.symptom_session_summaries', 'INSERT') or has_table_privilege('authenticated', 'public.symptom_session_summaries', 'UPDATE')
     or has_table_privilege('authenticated', 'public.symptom_session_summaries', 'DELETE') then
    raise exception 'S59 assertion: authenticated can write symptom_session_summaries directly';
  end if;
  if has_function_privilege('anon', 'public.send_symptom_summary(uuid,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.link_symptom_summary_to_appointment(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_patient_summary(uuid,text)', 'EXECUTE') then
    raise exception 'S59 assertion: anon can execute a hand-off function';
  end if;
  if position('symptom_summaries' in pg_get_functiondef('public.clinician_patient_summary(uuid, text)'::regprocedure)) = 0 then
    raise exception 'S59 assertion: the patient summary was not extended';
  end if;
end $$;

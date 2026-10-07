-- S22 part 4: the follow-ups S22 left (docs/BUILD-PROGRESS.md "Follow-ups"), found by the two code reviews.
--
--   1. A missed window returns a paid credit, not only an allowance. A patient who bought an `async_consult_credit` before the
--      membership model got a late answer and no credit back; a Member got the question back. Now both do.
--   2. grant_membership takes a nullable end date (the argument had no default, so the generated type forced a cast).
--   3. A note can be withdrawn as "entered in error" (spec 4.3, FHIR entered-in-error). The note is never deleted or edited:
--      it stays retrievable for staff with the flag, the patient sees that it was withdrawn and why but none of its text,
--      and it cannot be amended (a new note is written instead). Author or CMO only, with a reason.

-- ---------------------------------------------------------------------------
-- 1. Return a paid credit when the window is missed
-- ---------------------------------------------------------------------------
create function private.return_async_consult_credit(p_consult uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  -- a returned credit is only worth something if it can still be spent: one that would expire inside a month gets a month
  update public.service_purchases
     set redeemed_at = null, redeemed_entity_type = null, redeemed_entity_id = null,
         expires_at = case when expires_at is not null then greatest(expires_at, now() + interval '30 days') else expires_at end
   where redeemed_entity_type = 'async_consult' and redeemed_entity_id = p_consult and redeemed_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;
revoke all on function private.return_async_consult_credit(uuid) from public, anon, authenticated;

-- The window sweep, with the one change: a question paid for with a credit gets the credit back when its window is missed.
-- (Same function as S22 part 1; everything else is unchanged.)
create or replace function private.sweep_written_question_windows() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_pct integer := (private.written_care_setting('reminderPercent') #>> '{}')::int;
  v_reminded integer := 0;
  v_missed integer := 0;
  v_errors integer := 0;
  v_claimer uuid;
  v_claim uuid;
begin
  for r in
    select c.*, t.state as task_state
      from public.async_consults c join public.clinical_tasks t on t.id = c.task_id
     where t.state not in ('completed', 'cancelled')
       and c.status in ('submitted', 'in_review', 'answered')
  loop
    begin
      if r.reminded_at is null and now() >= r.window_started_at + make_interval(secs => (r.window_minutes * 60 * v_pct / 100.0)::int) then
        select k.clinician_id into v_claimer from public.task_claims k where k.task_id = r.task_id and k.ended_at is null;
        if v_claimer is not null then
          perform private.written_care_notify(v_claimer, r.organisation_id, 'written_question_staff_notice', '{}'::jsonb);
        end if;
        update public.async_consults set reminded_at = now() where id = r.id;
        v_reminded := v_reminded + 1;
      end if;
      if now() >= r.window_started_at + make_interval(mins => r.window_minutes) and r.window_missed_at is null then
        select k.id into v_claim from public.task_claims k where k.task_id = r.task_id and k.ended_at is null;
        if v_claim is not null then
          update public.task_claims set ended_at = now(), end_reason = 'expired' where id = v_claim and ended_at is null;
          if found then perform private.apply_task_transition(r.task_id, 'open', 'system', null, 'written question window missed'); end if;
        end if;
        if r.answered_at is null and r.paid_with_credit then
          perform private.return_async_consult_credit(r.id);
        end if;
        update public.async_consults
           set window_missed_at = now(),
               allowance_returned_at = case when answered_at is null then coalesce(allowance_returned_at, now()) else allowance_returned_at end
         where id = r.id;
        perform private.notify_clinical_leads(r.organisation_id, r.is_test, 'A written message missed its window',
          'A written message passed its response window. It has been released to the queue.', jsonb_build_object('consult_id', r.id));
        perform private.written_care_notify(r.patient_id, r.organisation_id, 'written_question_window_missed', jsonb_build_object('consult_id', r.id));
        perform private.emit_domain_event('async_question.window_missed', r.organisation_id, jsonb_build_object('consult_id', r.id),
          'async_question.window_missed:' || r.id || ':' || extract(epoch from r.window_started_at)::bigint, r.patient_id, 'async_consult', r.id);
        v_missed := v_missed + 1;
      end if;
    exception when others then
      v_errors := v_errors + 1;
      raise warning 'sweep_written_question_windows: % failed: %', r.id, sqlerrm;
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'written_question_window.error', 'async_consult', r.id, jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('reminded', v_reminded, 'missed', v_missed, 'errors', v_errors);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. grant_membership with a nullable end date (a new argument order: the optional one last)
-- ---------------------------------------------------------------------------
drop function public.grant_membership(uuid, timestamptz, text);
create function public.grant_membership(p_patient uuid, p_reason text, p_ends_at timestamptz default null) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  v_id uuid;
begin
  if v_uid is null or not private.can_manage_memberships() then raise exception 'membership_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;
  if pr.organisation_id is distinct from (select organisation_id from public.profiles where id = v_uid) then
    raise exception 'membership_not_authorised' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'membership_reason_needed' using errcode = '22023'; end if;
  if p_ends_at is not null and p_ends_at <= now() then raise exception 'membership_end_in_past' using errcode = '22023'; end if;
  -- a dated membership that has run out is closed here, so renewing it is not blocked by its own expired row
  update public.patient_memberships
     set state = 'ended', ended_at = now(), end_reason = 'Lapsed on its end date, closed automatically'
   where patient_id = p_patient and state = 'active' and ends_at is not null and ends_at <= now();
  if exists (select 1 from public.patient_memberships where patient_id = p_patient and state = 'active') then
    raise exception 'membership_already_active' using errcode = 'P0001';
  end if;
  insert into public.patient_memberships (organisation_id, patient_id, source, ends_at, granted_by, grant_reason, is_test)
  values (pr.organisation_id, p_patient, 'granted', p_ends_at, v_uid, btrim(p_reason), coalesce(pr.is_test, false)) returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id)
  values (pr.organisation_id, v_uid, 'membership.grant', 'patient_membership', v_id,
          jsonb_build_object('ends_at', p_ends_at), btrim(p_reason), 'success', p_patient);
  return v_id;
end;
$$;
revoke all on function public.grant_membership(uuid, text, timestamptz) from public, anon;
grant execute on function public.grant_membership(uuid, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Notes withdrawn as entered in error
-- ---------------------------------------------------------------------------
create table public.note_error_flags (
  note_id         uuid primary key references public.clinical_encounter_notes (id) on delete restrict,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  flagged_by      uuid references public.profiles (id) on delete set null,
  flagged_at      timestamptz not null default now(),
  reason          text not null check (char_length(btrim(reason)) >= 10),
  is_test         boolean not null default false
);
-- Row-level security with no policy, and the table grant the S05 notes view needs to keep returning zero rows to a signed-in user.
alter table public.note_error_flags enable row level security;
revoke all on public.note_error_flags from public, anon;
grant select on public.note_error_flags to authenticated;

create function private.note_error_flags_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'a withdrawn note stays withdrawn: write a new note instead' using errcode = '42501'; end; $$;
create trigger note_error_flags_no_change before update or delete on public.note_error_flags
  for each row execute function private.note_error_flags_append_only();

insert into public.event_types (event_type, description, owner_section, is_urgent) values
  ('note.withdrawn', 'A signed clinical note was withdrawn as entered in error', 'S22', false);
insert into public.event_type_versions (event_type, version, required_keys) values ('note.withdrawn', 1, array['note_id']);

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values ('note_withdrawn', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate', 'A note was withdrawn; the app says why.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values ('note_withdrawn', 'en', 'in_app', 'A note was withdrawn', 'Your care team withdrew a note. Open the app to see why.')
on conflict (template_key, locale, channel) do nothing;

create function public.mark_note_entered_in_error(p_note uuid, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  v_cmo boolean;
begin
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note;
  if n.status <> 'finalized' then raise exception 'only a signed note can be withdrawn; delete a draft by editing it' using errcode = 'P0001'; end if;
  v_cmo := exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier = 'chief_medical_officer');
  if not v_cmo and n.authored_by_staff is distinct from private.my_clinical_staff_id() then
    raise exception 'note_withdraw_author_or_cmo' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'note_withdraw_reason_needed' using errcode = '22023'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_note) then raise exception 'note_already_withdrawn' using errcode = 'P0001'; end if;
  insert into public.note_error_flags (note_id, organisation_id, patient_id, flagged_by, reason, is_test)
  values (n.id, n.organisation_id, n.patient_id, v_uid, btrim(p_reason), n.is_test);
  perform private.audit_chart_read(n.patient_id, array['notes'], 'withdraw note as entered in error', 'success');
  -- only a patient who could see the note is told it was withdrawn
  if private.note_patient_visible(n.id, n.patient_id) then
    perform private.written_care_notify(n.patient_id, n.organisation_id, 'note_withdrawn', jsonb_build_object('note_id', n.id));
  end if;
  perform private.emit_domain_event('note.withdrawn', n.organisation_id, jsonb_build_object('note_id', n.id),
    'note.withdrawn:' || n.id, n.patient_id, 'clinical_note', n.id);
end;
$$;
revoke all on function public.mark_note_entered_in_error(uuid, text) from public, anon;
grant execute on function public.mark_note_entered_in_error(uuid, text) to authenticated;

-- A withdrawn note cannot be amended: the author writes a new note (a corrected one stays a separate, signed record).
create or replace function public.create_note_amendment(p_original uuid, p_kind text, p_reason text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  o public.clinical_encounter_notes%rowtype;
  v_id uuid;
begin
  perform private.may_work_on_note(p_original);
  if p_kind not in ('addendum', 'late_entry', 'correction') then raise exception 'unknown amendment kind' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'note_amendment_reason_needed' using errcode = '22023'; end if;
  select * into o from public.clinical_encounter_notes where id = p_original;
  if o.status <> 'finalized' then raise exception 'only a signed note can be amended; edit the draft instead' using errcode = 'P0001'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_original) then
    raise exception 'note_withdrawn_cannot_amend' using errcode = 'P0001';
  end if;
  insert into public.clinical_encounter_notes
    (organisation_id, patient_id, encounter_type, reason_for_encounter, async_consult_id, video_consultation_id, escalation_id,
     clinical_encounter_id, amends_note_id, amendment_kind, amendment_reason, is_protected)
  values (o.organisation_id, o.patient_id, o.encounter_type, o.reason_for_encounter, o.async_consult_id, o.video_consultation_id,
          o.escalation_id, o.clinical_encounter_id, o.id, p_kind, btrim(p_reason), o.is_protected)
  returning id into v_id;
  perform private.audit_chart_read(o.patient_id, array['notes'], 'amend note', 'success');
  return v_id;
end;
$$;

-- A withdrawn note takes its amendments with it: a signed amendment of a note that was entered in error (for example on the wrong
-- patient) would otherwise keep showing the patient the same content. The withdrawn note itself stays visible, as the marker.
create or replace function private.note_patient_visible(p_note uuid, p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  with recursive chain as (
    select n.id, n.amends_note_id, n.is_protected from public.clinical_encounter_notes n
     where n.id = p_note and n.patient_id = p_patient and n.status = 'finalized'
    union all
    select o.id, o.amends_note_id, o.is_protected from public.clinical_encounter_notes o join chain c on c.amends_note_id = o.id
     where o.status = 'finalized' and not c.is_protected
  )
  select exists (select 1 from chain c join public.note_releases r on r.note_id = c.id and r.state = 'released')
     and not exists (select 1 from chain c2 join public.note_error_flags f on f.note_id = c2.id where c2.id <> p_note);
$$;

-- The patient sees that a note was withdrawn and why, and none of its clinical text.
create or replace function public.my_released_notes() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select coalesce(jsonb_agg(
    case when f.note_id is not null then
      jsonb_build_object('id', n.id, 'amends_note_id', n.amends_note_id, 'entered_in_error', true,
        'withdrawn_at', f.flagged_at, 'withdrawn_reason', f.reason, 'signed_at', n.finalized_at, 'encounter_type', n.encounter_type,
        'corrections', '[]'::jsonb)
    else
      jsonb_build_object(
        'id', n.id, 'amends_note_id', n.amends_note_id, 'amendment_kind', n.amendment_kind, 'amendment_reason', n.amendment_reason,
        'encounter_type', n.encounter_type, 'reason', n.reason_for_encounter, 'history', n.history,
        'examination', n.examination_findings, 'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan,
        'follow_up', n.follow_up_instructions, 'signed_at', n.finalized_at, 'entered_in_error', false,
        'signed_by', (select cs.full_name from public.clinical_staff cs where cs.id = n.finalized_by_staff),
        'corrections', coalesce((select jsonb_agg(jsonb_build_object('id', cr.id, 'state', cr.state, 'request_text', cr.request_text,
                                   'response', cr.response, 'created_at', cr.created_at) order by cr.created_at)
                                   from public.note_correction_requests cr where cr.note_id = n.id), '[]'::jsonb))
    end order by n.finalized_at desc), '[]'::jsonb)
    into v_out
    from public.clinical_encounter_notes n
    left join public.note_error_flags f on f.note_id = n.id
   where n.patient_id = v_uid and n.status = 'finalized' and private.note_patient_visible(n.id, v_uid);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, subject_patient_id)
  select organisation_id, v_uid, 'note.patient_read', 'clinical_note', jsonb_build_object('count', jsonb_array_length(v_out)), v_uid
    from public.profiles where id = v_uid;
  return v_out;
end;
$$;

-- A withdrawn correction request cannot be opened on a withdrawn note.
create or replace function public.request_note_correction(p_note uuid, p_text text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  v_id uuid;
  v_days integer := (private.written_care_setting('correctionResponseDays') #>> '{}')::int;
  v_author uuid;
begin
  select * into n from public.clinical_encounter_notes where id = p_note and patient_id = v_uid and status = 'finalized';
  if not found or not private.note_patient_visible(p_note, v_uid) then raise exception 'not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_note) then raise exception 'not found' using errcode = 'P0002'; end if;
  insert into public.note_correction_requests (organisation_id, note_id, patient_id, request_text, due_at, is_test)
  values (n.organisation_id, n.id, v_uid, btrim(p_text), now() + make_interval(days => v_days), n.is_test) returning id into v_id;
  select cs.profile_id into v_author from public.clinical_staff cs where cs.id = n.authored_by_staff;
  if v_author is not null then perform private.written_care_notify(v_author, n.organisation_id, 'note_correction_requested', jsonb_build_object('note_id', n.id)); end if;
  perform private.notify_clinical_leads(n.organisation_id, n.is_test, 'A note correction was requested',
    'A patient asked for a correction to a signed note.', jsonb_build_object('note_id', n.id), v_author);
  return v_id;
end;
$$;

-- The S05 notes view learns the state (security_invoker, so a signed-in user still sees zero rows).
create or replace view public.notes with (security_invoker = true) as
select
  n.id,
  n.organisation_id,
  n.patient_id,
  n.clinical_encounter_id as encounter_id,
  n.authored_by_staff as author_clinician_id,
  case
    when n.status <> 'finalized' then 'draft'
    when exists (select 1 from public.note_error_flags f where f.note_id = n.id) then 'entered_in_error'
    when exists (select 1 from public.clinical_encounter_notes a where a.amends_note_id = n.id and a.status = 'finalized') then 'amended'
    else 'signed'
  end as state,
  jsonb_strip_nulls(jsonb_build_object(
    'reason', n.reason_for_encounter, 'history', n.history, 'examination', n.examination_findings,
    'assessment', n.assessment, 'diagnosis', n.diagnosis, 'plan', n.plan, 'follow_up', n.follow_up_instructions
  )) as body,
  n.ai_drafted,
  n.finalized_at as signed_at,
  n.amends_note_id,
  n.created_at
from public.clinical_encounter_notes n;

-- The index says when a note was withdrawn (still no clinical text).
create or replace function public.my_note_index() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'encounter_type', n.encounter_type, 'signed_at', n.finalized_at,
             'release_state', coalesce(r.state, 'not_requested'), 'withhold_reason', case when r.state = 'declined' then r.withhold_reason end,
             'entered_in_error', f.note_id is not null)
             order by n.finalized_at desc)
      from public.clinical_encounter_notes n
      left join public.note_releases r on r.note_id = n.id
      left join public.note_error_flags f on f.note_id = n.id
     where n.patient_id = v_uid and n.status = 'finalized' and n.amends_note_id is null), '[]'::jsonb);
end;
$$;

-- Staff reading a chart see which notes were withdrawn, and why (the same function S05d made the one audited read path).
create or replace function public.read_patient_encounter_notes_audited(p_patient uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  c_page constant integer := 500;                      -- technical page size, not a clinical value
  v_staff uuid := private.my_clinical_staff_id();
  v_all boolean;
  v_notes jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  v_all := private.can_staff_read_clinical(p_patient, 'appointments_care_plan');
  if not v_all and (v_staff is null or not exists (
       select 1 from public.clinical_encounter_notes n where n.patient_id = p_patient and n.authored_by_staff = v_staff)) then
    perform private.audit_chart_read(p_patient, array['notes'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'notes', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.encounter_date desc), '[]'::jsonb) into v_notes from (
    select n.*, (f.note_id is not null) as entered_in_error, f.reason as withdrawn_reason, f.flagged_at as withdrawn_at
      from public.clinical_encounter_notes n
      left join public.note_error_flags f on f.note_id = n.id
     where n.patient_id = p_patient and (v_all or n.authored_by_staff = v_staff)
     order by n.encounter_date desc limit c_page) x;

  perform private.audit_chart_read(p_patient, array['notes'], p_reason, 'success');
  return jsonb_build_object('status', case when v_all then 'ok' else 'own_only' end, 'notes', v_notes);
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-checks
-- ---------------------------------------------------------------------------
do $$
declare v_fn text;
begin
  foreach v_fn in array array['public.mark_note_entered_in_error(uuid,text)', 'public.grant_membership(uuid,text,timestamptz)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then raise exception 'S22c assertion: anon can execute %', v_fn; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.return_async_consult_credit(uuid)', 'EXECUTE') then
    raise exception 'S22c assertion: authenticated can execute private.return_async_consult_credit';
  end if;
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'grant_membership' and p.pronargs = 3
             and p.proargtypes::text like '%1184 25') then
    raise exception 'S22c assertion: the old grant_membership(uuid, timestamptz, text) still exists';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'note_error_flags') then
    raise exception 'S22c assertion: note_error_flags must have no policy';
  end if;
end $$;

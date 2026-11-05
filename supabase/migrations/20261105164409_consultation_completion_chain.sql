-- Tarragon Health: the consultation completion chain (2026-11-05).
--
-- What went wrong. The first live Zoom consultation (video_consultations 80d9ca01..., 2026-11-03, completed 21:26 UTC) ended
-- and left no clinical note, no task and no patient_timeline entry. Diagnosis, read from the live database:
--   * private.auto_draft_note_from_video_consultation (fires when status becomes 'completed') asks
--     private.video_consultation_clinician() who ran the call. That resolver only looked at consult_availability_slots and
--     video_visit_requests. The 11-03 call was booked through the S21 flow, which records the doctor on appointments.clinician_id
--     and encounters.clinician_id; neither table was consulted, the resolver returned null, and the trigger returned null
--     without a trace (no note, no warning row, no incident).
--   * video_consultations has no column for the clinician, so nothing on the row itself said who ran the call.
--   * Nothing else on completion created a task for a doctor to write and sign the note, or wrote the timeline.
--   (Follow-up was not lost: post-consultation check-ins hang off encounters completion, private.encounters_schedule_checkins,
--   which is untouched here.)
--
-- What this migration does.
--   1. video_consultations.clinician_id (profiles.id, the same key appointments.clinician_id and encounters.clinician_id use).
--      Filled by: an AFTER trigger on appointments and on encounters (the booking already knows the doctor; a reassignment before
--      the call follows it), and a BEFORE UPDATE fill on video_consultations from the resolver (covers the slot and visit-request
--      paths). The resolver now reads the column first, then slots, visit requests, appointments and encounters.
--      Existing rows are backfilled where derivable.
--   2. private.consultation_completion_chain(id): one routine run on completion that drafts the note (as before), creates an
--      owned clinical task for the doctor to write and sign it, and writes one patient_timeline entry. Each step runs in its own
--      sub-block; any step that cannot be done (no clinician recorded, the clinician has no doctor record at a note-writing tier,
--      an error) opens an ops incident naming what is missing. Nothing returns null silently any more.
--   3. A new task type, consultation_note (PROPOSED class, due time and windows; an operational setting, not on the CMO's
--      patient-harm list). It is offered to the doctor who ran the call for its whole due window, then falls to the pool like any
--      offered task. With no usable clinician it goes straight through private.create_clinical_task's normal routing.
--   4. Finalising the consultation's note completes that task for the finalising doctor (claim then complete, the same
--      transitions the queue uses). If that cannot be done, the task stays open in the queue, which is the visible state.
--   5. The 11-03 consultation (and any other completed one without a finalised note) is run through the chain once.
--
-- Timeline event type: 'encounter_documented' with source_table 'video_consultations' and metadata.kind 'consultation_completed'.
-- A dedicated enum value was not added: ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, and the
-- timeline UI now labels this source "Consultation" (components/patient-timeline.tsx).

-- ---------------------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------------------
alter table public.video_consultations
  add column clinician_id uuid references public.profiles (id) on delete restrict;
create index video_consultations_clinician_idx on public.video_consultations (clinician_id) where clinician_id is not null;
comment on column public.video_consultations.clinician_id is
  'The clinician (profiles.id) who runs the call. Filled from the booking (appointments/encounters clinician_id) or the slot/visit request; '
  'read by the completion chain (note draft, note task, timeline). 20261105164409.';

-- The resolver: the column first, then every place a booking records the doctor. Same signature, redefined from the live body.
create or replace function private.video_consultation_clinician(p_consultation_id uuid)
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select v.clinician_id from public.video_consultations v where v.id = p_consultation_id),
    (select s.clinician_profile_id
     from public.consult_availability_slots s
     where s.booked_consultation_id = p_consultation_id
     limit 1),
    (select cs.profile_id
     from public.video_visit_requests r
     join public.clinical_staff cs on cs.id = r.accepted_by
     where r.video_consultation_id = p_consultation_id
     limit 1),
    (select a.clinician_id
     from public.appointments a
     where a.video_consultation_id = p_consultation_id and a.clinician_id is not null
     order by a.created_at desc
     limit 1),
    (select e.clinician_id
     from public.encounters e
     where e.video_consultation_id = p_consultation_id and e.clinician_id is not null
     order by e.created_at desc
     limit 1)
  );
$function$;

-- BEFORE UPDATE on video_consultations: a row still missing its clinician takes it from the resolver (slot / visit request paths,
-- and any row whose booking was written before this migration).
create function private.video_consultation_fill_clinician()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.clinician_id is null then
    new.clinician_id := private.video_consultation_clinician(new.id);
  end if;
  return new;
end;
$function$;
revoke all on function private.video_consultation_fill_clinician() from public, anon, authenticated;

create trigger "0000_fill_clinician"
  before update on public.video_consultations
  for each row execute function private.video_consultation_fill_clinician();

-- AFTER INSERT/UPDATE on appointments and encounters: the booking's doctor is copied onto the consultation. A reassignment
-- before the call follows it (only when the consultation still carried the old doctor); a completed call keeps who ran it.
create function private.video_consultation_clinician_from_booking()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.video_consultation_id is null or new.clinician_id is null then
    return null;
  end if;
  update public.video_consultations v
     set clinician_id = new.clinician_id
   where v.id = new.video_consultation_id
     and v.clinician_id is distinct from new.clinician_id
     and (v.clinician_id is null
          or (tg_op = 'UPDATE' and v.status <> 'completed' and v.clinician_id = old.clinician_id));
  return null;
end;
$function$;
revoke all on function private.video_consultation_clinician_from_booking() from public, anon, authenticated;

create trigger appointments_video_consultation_clinician
  after insert or update of clinician_id, video_consultation_id on public.appointments
  for each row execute function private.video_consultation_clinician_from_booking();
create trigger encounters_video_consultation_clinician
  after insert or update of clinician_id, video_consultation_id on public.encounters
  for each row execute function private.video_consultation_clinician_from_booking();

-- ---------------------------------------------------------------------------
-- 2. The task type (PROPOSED values; versioned configuration)
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes,
   pushable, creatable, source_task_keys, needs_confirmation, note)
values
  ('consultation_note', 1, 8, 1440, 'senior_medical_officer', '{}', 1440, 60, true, true, '{}', false,
   'A video consultation ended. The doctor who ran it writes and signs the note (an auto-drafted note is waiting when the doctor is known). '
   'Offered to that doctor for the whole due window, then to the pool. Completed automatically when the note is finalised. Ids only. '
   'PROPOSED class, due time and windows (20261105164409).')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Owned task creation: the same insert, transition row, event and offer as private.create_clinical_task, but the offer goes to
--    a named clinician for the whole due window. Anything that stops the named clinician taking it falls back to the normal routing.
-- ---------------------------------------------------------------------------
create function private.create_owned_clinical_task(p_patient uuid, p_type text, p_owner uuid, p_dedup_key text)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ty public.task_types%rowtype;
  pr public.profiles%rowtype;
  v_req text[];
  v_due timestamptz;
  v_id uuid;
begin
  if p_dedup_key is null then raise exception 'an owned task needs a dedup key' using errcode = '22023'; end if;
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;

  -- one live task per key
  select id into v_id from public.clinical_tasks where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') limit 1;
  if v_id is not null then return v_id; end if;

  v_req := (select coalesce(array_agg(distinct x order by x), '{}')
              from unnest(ty.required_competencies || private.task_extra_competencies(ty.code, p_dedup_key)) x);

  if p_owner is null
     or not private.clinician_is_eligible(p_owner)
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_owner and cs.active and cs.doctor_tier is not null
                     and cs.organisation_id = pr.organisation_id
                     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier))
     or coalesce(array_length(private.clinician_missing_competencies(p_owner, v_req), 1), 0) > 0
     or private.has_conflict(p_owner, p_patient) then
    return private.create_clinical_task(p_patient, p_type, null, p_dedup_key, null, null, null, '{}');
  end if;

  v_due := now() + make_interval(mins => ty.default_due_minutes);
  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      required_competencies, min_tier, due_at, dedup_key, is_test, lead_clinician_id, lead_window_ends_at, delivery_path, pushed_to)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      v_req, ty.min_doctor_tier, v_due, p_dedup_key, pr.is_test, p_owner, v_due,
      case when ty.pushable and exists (select 1 from public.clinical_staff cs where cs.profile_id = p_owner and cs.employment_type = 'employed')
           then 'push' else 'pull' end,
      case when ty.pushable and exists (select 1 from public.clinical_staff cs where cs.profile_id = p_owner and cs.employment_type = 'employed')
           then p_owner end)
  returning id into v_id;
  perform set_config('tarragon.task_transition', 'off', true);

  insert into public.clinical_task_transitions (organisation_id, task_id, from_state, to_state, actor_kind, reason, is_test)
  values (pr.organisation_id, v_id, null, 'created', 'system', 'created', pr.is_test);
  perform private.emit_domain_event('clinical_task.created', pr.organisation_id,
    jsonb_build_object('task_id', v_id, 'type', ty.code, 'priority_class', ty.priority_class),
    'clinical_task.created:' || v_id, p_patient, 'clinical_task', v_id);
  perform private.apply_task_transition(v_id, 'offered_to_lead', 'system', null, 'offered to the clinician who ran the consultation');
  return v_id;
end;
$function$;
revoke all on function private.create_owned_clinical_task(uuid, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The loud failure: an ops incident per consultation, updated rather than duplicated.
-- ---------------------------------------------------------------------------
create function private.consultation_completion_incident(p_org uuid, p_consultation uuid, p_problems text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ref text := 'consultation_completion:' || p_consultation;
  v_summary text := format('Video consultation %s ended but part of what should follow did not happen: %s. '
                           'A doctor needs to write and sign the note for this call. Ids only.',
                           p_consultation, array_to_string(p_problems, '; '));
begin
  if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
    update public.ops_incidents set summary = v_summary where external_reference = v_ref and status not in ('resolved', 'closed');
  else
    insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
    values (p_org, 'clinical', 'sev2', 'A finished video consultation is missing its note, task or timeline entry', v_summary, v_ref,
            now() + interval '4 hours', now() + interval '24 hours');
  end if;
end;
$function$;
revoke all on function private.consultation_completion_incident(uuid, uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The chain
-- ---------------------------------------------------------------------------
create function private.consultation_completion_chain(p_consultation uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  vc public.video_consultations%rowtype;
  v_clin uuid;
  v_staff uuid;        -- a doctor record at a tier that can write the note
  v_actor_staff uuid;  -- any active clinical_staff row for attribution on the timeline
  v_reason text;
  v_problems text[] := '{}';
begin
  select * into vc from public.video_consultations where id = p_consultation;
  if not found or vc.status <> 'completed' then
    return;
  end if;

  v_clin := coalesce(vc.clinician_id, private.video_consultation_clinician(vc.id));
  if v_clin is null then
    v_problems := v_problems || 'no clinician is recorded for the call'::text;
  else
    select id into v_actor_staff from public.clinical_staff
     where profile_id = v_clin and organisation_id = vc.organisation_id and active limit 1;
    select id into v_staff from public.clinical_staff
     where profile_id = v_clin and organisation_id = vc.organisation_id and active
       and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
     limit 1;
  end if;

  v_reason := case vc.context
    when 'pre_referral_triage' then 'Pre-referral triage video consultation'
    when 'specialist_consult' then 'Specialist video consultation'
    else 'Video consultation'
  end;

  -- 5a. the draft note (unchanged behaviour when the doctor is known; now loud when not)
  begin
    if not exists (select 1 from public.clinical_encounter_notes where video_consultation_id = vc.id) then
      if v_clin is not null and v_staff is null then
        v_problems := v_problems || 'the recorded clinician has no active doctor record that can write the note'::text;
      elsif v_staff is not null then
        perform set_config('app.trusted_clinical_staff_author', v_staff::text, true);
        insert into public.clinical_encounter_notes (
          organisation_id, patient_id, video_consultation_id, encounter_type,
          reason_for_encounter, call_started_at, call_ended_at
        ) values (
          vc.organisation_id, vc.patient_id, vc.id, 'video_consult',
          v_reason, vc.started_at, vc.ended_at
        );
        perform set_config('app.trusted_clinical_staff_author', '', true);
      end if;
    end if;
  exception when others then
    perform set_config('app.trusted_clinical_staff_author', '', true);
    v_problems := v_problems || ('the draft note could not be created (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
  end;

  -- 5b. the owned task to write and sign the note (none when a finalised note already exists)
  begin
    if not exists (select 1 from public.clinical_encounter_notes
                    where video_consultation_id = vc.id and status = 'finalized') then
      perform private.create_owned_clinical_task(vc.patient_id, 'consultation_note', v_clin, 'consult_note:' || vc.id);
    end if;
  exception when others then
    v_problems := v_problems || ('the note task could not be created (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
  end;

  -- 5c. one timeline entry per consultation
  begin
    if not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = vc.id) then
      perform private.record_timeline_event(
        vc.organisation_id, vc.patient_id, 'encounter_documented', 'video_consultations', vc.id,
        'Video consultation completed', v_reason, coalesce(vc.ended_at, now()), v_actor_staff,
        jsonb_build_object('kind', 'consultation_completed', 'context', vc.context, 'video_consultation_id', vc.id));
    end if;
  exception when others then
    v_problems := v_problems || ('the timeline entry could not be written (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
  end;

  if coalesce(array_length(v_problems, 1), 0) > 0 then
    perform private.consultation_completion_incident(vc.organisation_id, vc.id, v_problems);
    raise warning 'consultation_completion_chain: video_consultation %: %', vc.id, array_to_string(v_problems, '; ');
  end if;
end;
$function$;
revoke all on function private.consultation_completion_chain(uuid) from public, anon, authenticated;

-- The existing completion trigger (video_consultations_auto_draft_encounter_note, AFTER UPDATE OF status to 'completed') keeps
-- its name and function; the body now runs the whole chain.
create or replace function private.auto_draft_note_from_video_consultation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  begin
    perform private.consultation_completion_chain(new.id);
  exception when others then
    -- never block the call ending; never lose it either
    perform set_config('app.trusted_clinical_staff_author', '', true);
    perform private.consultation_completion_incident(new.organisation_id, new.id,
      array['the completion chain failed (' || sqlstate || ': ' || left(sqlerrm, 200) || ')']);
    raise warning 'auto_draft_note_from_video_consultation failed for video_consultation %: %', new.id, sqlerrm;
  end;
  return null;
end;
$function$;
revoke all on function private.auto_draft_note_from_video_consultation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Finalising the note completes the task for the finalising doctor
-- ---------------------------------------------------------------------------
create function private.complete_consultation_note_task()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  t public.clinical_tasks%rowtype;
  v_actor uuid;
begin
  if new.video_consultation_id is null or new.amends_note_id is not null then
    return null;
  end if;
  select profile_id into v_actor from public.clinical_staff where id = new.finalized_by_staff;
  if v_actor is null then
    return null;
  end if;
  for t in select * from public.clinical_tasks
            where dedup_key like 'consult_note:' || new.video_consultation_id || '%'
              and type = 'consultation_note' and state not in ('completed', 'cancelled')
  loop
    begin
      if t.state = 'claimed' and t.claimed_by is distinct from v_actor then
        continue;  -- another doctor is working it; it stays in their hands
      end if;
      if t.state <> 'claimed' then
        perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_actor, 'the consultation note was finalised',
                                              v_actor, now() + interval '5 minutes');
      end if;
      update public.task_claims set ended_at = now(), end_reason = 'completed'
       where task_id = t.id and clinician_id = v_actor and ended_at is null;
      perform private.apply_task_transition(t.id, 'completed', 'clinician', v_actor, 'the consultation note was finalised', null, null,
        jsonb_build_object('code', 'completed_action_taken', 'note_id', new.id, 'video_consultation_id', new.video_consultation_id));
      perform private.reliability_event(v_actor, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (t.organisation_id, v_actor, 'queue.complete', 'clinical_task', t.id, jsonb_build_object('type', t.type), t.patient_id);
      perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
        jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || t.id, t.patient_id, 'clinical_task', t.id);
    exception when others then
      -- the task stays open in the queue, which is the visible state; the note itself is never blocked
      raise warning 'complete_consultation_note_task: task % not closed: %', t.id, sqlerrm;
    end;
  end loop;
  return null;
end;
$function$;
revoke all on function private.complete_consultation_note_task() from public, anon, authenticated;

create trigger clinical_encounter_notes_complete_consultation_task
  after update of status on public.clinical_encounter_notes
  for each row
  when (old.status is distinct from 'finalized' and new.status = 'finalized')
  execute function private.complete_consultation_note_task();

-- ---------------------------------------------------------------------------
-- 7. Backfill: the clinician where derivable, then the chain for every completed consultation without a finalised note
--    (on 2026-11-05 that is exactly one: the 11-03 call).
-- ---------------------------------------------------------------------------
update public.video_consultations v
   set clinician_id = private.video_consultation_clinician(v.id)
 where v.clinician_id is null
   and private.video_consultation_clinician(v.id) is not null;

do $backfill$
declare r record;
begin
  for r in select v.id from public.video_consultations v
            where v.status = 'completed'
              and not exists (select 1 from public.clinical_encounter_notes n
                               where n.video_consultation_id = v.id and n.status = 'finalized')
  loop
    perform private.consultation_completion_chain(r.id);
  end loop;
end
$backfill$;

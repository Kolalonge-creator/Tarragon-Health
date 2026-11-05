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
--      Filled by an AFTER trigger on appointments and on encounters (a reassignment before the call follows it) and by a BEFORE
--      UPDATE fill from the resolver (slot and visit-request paths). The resolver reads the column first, then slots, visit
--      requests, appointments and encounters. Only triggers and definer functions may write it: a direct write by a signed-in
--      user (any org staff role) is refused, because the column drives note authorship, consult time and the timeline trust tier.
--   2. private.consultation_completion_chain(id), run on completion. Each step in its own sub-block, so a failed step never undoes
--      one that worked, and the call ending is never blocked:
--        a. a doctor note is owed unless the call was a non-doctor visit (S64 dietitian / pharmacist, or other non-doctor appointment
--           types) or the recorded clinician's care_role is not 'doctor'. A non-doctor visit gets the timeline row only, quietly;
--        b. the draft note (as before) when a doctor note is owed and the doctor is known;
--        c. a consultation_note task, offered through the queue's normal offer rules (eligible, offerable: leave, post-call rest,
--           declared hours; no conflict; the lead_window_cap_fraction cap) to the doctor who ran the call, else routed normally;
--        d. one patient_timeline row (generic wording, no consultation context in the text or metadata);
--        e. anything owed that could not be done opens an ops incident (sev2, clinical). The incident write itself can fail
--           (for example an SLA trigger); it then falls back to a WARNING and never aborts the status update.
--   3. Task type consultation_note (PROPOSED values; an operational setting, not on the CMO's patient-harm list). queue_complete
--      with "completed_action_taken" needs the consultation's note finalised; any other outcome needs a written reason.
--   4. Finalising the note completes the task for the finalising doctor, whoever holds it: an offer to someone else is returned
--      to the pool, another doctor's claim is ended (system moves, reasons recorded), then the finaliser claims and completes
--      exactly as queue_complete does (task_claims row, reliability event, audit, clinical_task.completed and
--      clinician.task_completed). If that is impossible (the finaliser is not eligible for the queue), an incident is opened.
--   5. The timeline row is hidden from caregiver (profile_access) reads for a patient aged 10 to 17, through the existing
--      timeline_source_is_sensitive_order gate in the patient_timeline select policy. The patient, staff and emergency paths are
--      unchanged. A partial unique index stops a second row per consultation.
--   6. The 11-03 consultation (and any other completed one without a finalised note) is run through the chain once.
--
-- Note: a sev2 ops incident is not paged; it appears on the ops incident register for the ops desk.
-- Timeline event type: 'encounter_documented' with source_table 'video_consultations' and metadata.kind 'consultation_completed'.
-- A dedicated enum value was not added: ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it. The web and
-- mobile timelines label this source "Consultation".

-- ---------------------------------------------------------------------------
-- 1. The column, its writers and its guard
-- ---------------------------------------------------------------------------
alter table public.video_consultations
  add column clinician_id uuid references public.profiles (id) on delete restrict;
create index video_consultations_clinician_idx on public.video_consultations (clinician_id) where clinician_id is not null;
comment on column public.video_consultations.clinician_id is
  'The clinician (profiles.id) who runs the call. Written only by triggers and definer functions (from the booking, the slot or the '
  'visit request); a direct write by a signed-in user is refused. Read by the completion chain. 20261105164409.';

-- The resolver: the column first, then every place a booking records the clinician. Same signature, redefined from the live body.
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

-- The guard. SECURITY INVOKER on purpose: current_user is then the role running the statement. A signed-in user's own
-- INSERT/UPDATE runs as authenticated; the same write made inside a definer trigger or function runs as its owner.
create function private.video_consultation_guard_clinician()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.clinician_id is not null)
          or (tg_op = 'UPDATE' and new.clinician_id is distinct from old.clinician_id)) then
    raise exception 'video_consultations.clinician_id is set from the booking and cannot be changed directly' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function private.video_consultation_guard_clinician() from public, anon, authenticated;

-- Fires first among the BEFORE triggers (name order), so it sees what the caller asked for, not what the fill below sets.
create trigger "00000_guard_clinician"
  before insert or update on public.video_consultations
  for each row execute function private.video_consultation_guard_clinician();

-- BEFORE UPDATE: a row still missing its clinician takes it from the resolver.
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

-- AFTER INSERT/UPDATE on appointments and encounters: the booking's clinician is copied onto the consultation. A reassignment
-- before the call follows it (only when the consultation still carried the old clinician); a completed call keeps who ran it.
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
-- 2. The task type (PROPOSED values; versioned configuration) and its completion check
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies, lead_window_minutes, claim_timeout_minutes,
   pushable, creatable, source_task_keys, needs_confirmation, note)
values
  ('consultation_note', 1, 8, 1440, 'senior_medical_officer', '{}', 1440, 60, true, true, '{}', false,
   'A video consultation with a doctor ended. The doctor who ran it writes and signs the note (an auto-drafted note is waiting when the '
   'doctor is known). Offered to that doctor under the normal offer rules, then to the pool. Completed automatically when the note is '
   'finalised; closing it by hand as action taken needs the signed note, any other outcome a written reason. Ids only. '
   'PROPOSED class, due time and windows (20261105164409).')
on conflict do nothing;

-- task_outcome_error, redefined from its live body with one added branch (consultation_note).
create or replace function private.task_outcome_error(t public.clinical_tasks, p_uid uuid, p_outcome jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg jsonb := private.task_layer_setting('completion');
  v_code text := private.task_outcome_code(t.type, p_outcome);
  v_allowed jsonb := coalesce(cfg -> 'codes_by_type' -> t.type, cfg -> 'default_codes');
  v_staff uuid;
  v_cid uuid;
  v_src uuid;
  v_min integer := (cfg #>> '{contact_attempts,min_attempts}')::integer;
  v_valid integer;
  a jsonb;
  v_at timestamptz;
begin
  if v_code is null or not (v_allowed ? v_code) then return 'queue_outcome_code'; end if;
  if p_outcome ? 'note' and (jsonb_typeof(p_outcome -> 'note') <> 'string'
       or char_length(p_outcome ->> 'note') > (cfg ->> 'note_max_chars')::integer) then
    return 'queue_outcome_note';
  end if;

  if t.type = 'critical_result_review' then
    if v_code = 'result_released' then
      -- the result this task is about has been released to the patient
      if not exists (select 1 from public.lab_results lr
                      where lr.id = private.try_uuid(substring(t.dedup_key from '^lab_result:([0-9a-fA-F-]{36})'))
                        and lr.patient_id = t.patient_id and lr.release_state = 'released') then
        return 'queue_outcome_result_not_released';
      end if;
    else
      -- a documented sequence of contact attempts: enough of them, each dated, by a permitted method, reached or not
      if jsonb_typeof(p_outcome -> 'attempts') is distinct from 'array' then return 'queue_outcome_attempts'; end if;
      v_valid := 0;
      for a in select x from jsonb_array_elements(p_outcome -> 'attempts') x loop
        -- an ISO date-time only: Postgres would also read 'now' or 'today' as a time
        v_at := case when jsonb_typeof(a) = 'object' and (a ->> 'at') ~ '^\d{4}-\d{2}-\d{2}T' then private.try_timestamptz(a ->> 'at') end;
        if v_at is not null and v_at >= t.created_at - private.contact_attempt_lookback() and v_at <= now() + interval '5 minutes'
           and (cfg #> '{contact_attempts,methods}') ? coalesce(a ->> 'method', '')
           and jsonb_typeof(a -> 'reached') = 'boolean' then
          v_valid := v_valid + 1;
        end if;
      end loop;
      if v_valid < v_min or v_valid <> jsonb_array_length(p_outcome -> 'attempts') then return 'queue_outcome_attempts'; end if;
      -- three copies of one attempt are one attempt
      if (select count(distinct (x ->> 'at') || '|' || (x ->> 'method')) from jsonb_array_elements(p_outcome -> 'attempts') x) < v_min then
        return 'queue_outcome_attempts';
      end if;
    end if;

  elsif t.type = 'titration_signoff' then
    v_cid := private.try_uuid(p_outcome ->> 'care_plan_change_id');
    v_src := private.try_uuid(substring(t.dedup_key from '^titration:([0-9a-fA-F-]{36})'));
    if v_cid is null then return 'queue_outcome_change'; end if;
    if v_code in ('signed', 'amended') then
      if not exists (select 1 from public.care_plan_changes c
                      where c.id = v_cid and c.patient_id = t.patient_id and c.kind = 'medication'
                        and c.state in ('signed', 'confirmed', 'declined', 'expired')
                        and c.signed_by = p_uid and c.signed_at >= t.claimed_at) then
        return 'queue_outcome_change';
      end if;
      -- "signed" is the proposal the task was made for; "amended" is a different change the clinician signed in its place
      if v_src is not null and ((v_code = 'signed') <> (v_cid = v_src)) then return 'queue_outcome_change'; end if;
    else
      if not exists (select 1 from public.care_plan_changes c
                      where c.id = v_cid and c.patient_id = t.patient_id and c.state = 'rejected'
                        and c.rejected_by = p_uid and c.rejected_at >= t.claimed_at) then
        return 'queue_outcome_change';
      end if;
    end if;

  elsif t.type = 'symptom_review' then
    select id into v_staff from public.clinical_staff where profile_id = p_uid;
    if not exists (select 1 from public.symptom_reviews sr
                    where sr.id = private.try_uuid(p_outcome ->> 'symptom_review') and sr.task_id = t.id
                      and sr.patient_id = t.patient_id and sr.status = 'completed' and sr.clinician_id = p_uid)
       and not exists (select 1 from public.clinical_encounter_notes n
                    where n.id = private.try_uuid(p_outcome ->> 'note_id') and n.patient_id = t.patient_id
                      and n.status = 'finalized' and n.finalized_by_staff = v_staff and n.finalized_at >= t.claimed_at) then
      return 'queue_outcome_note_missing';
    end if;

  elsif t.type = 'async_question' then
    if not exists (select 1 from public.async_consults ac
                    where ac.id = private.try_uuid(p_outcome ->> 'consult_id') and ac.patient_id = t.patient_id
                      and ac.status in ('answered', 'in_review')
                      -- the consult this task is about: its own task, or the follow-up task made for it (dedup async:<consult>:reply)
                      and (ac.task_id = t.id or t.dedup_key like 'async:' || ac.id::text || '%')) then
      return 'queue_outcome_consult';
    end if;

  elsif t.type = 'consultation_note' then
    -- 20261105164409: "action taken" means the consultation's note is signed; any other outcome needs a written reason.
    if v_code = 'completed_action_taken' then
      if not exists (select 1 from public.clinical_encounter_notes n
                      where n.video_consultation_id = private.try_uuid(substring(t.dedup_key from '^consult_note:([0-9a-fA-F-]{36})'))
                        and n.patient_id = t.patient_id and n.status = 'finalized') then
        return 'queue_outcome_note_missing';
      end if;
    elsif char_length(btrim(coalesce(p_outcome ->> 'note', ''))) < 10 then
      return 'queue_outcome_reason_needed';
    end if;

  elsif t.type = 'red_event_unacknowledged' then
    if not exists (select 1 from public.pages pg
                    where pg.id = private.try_uuid(substring(t.dedup_key from '^page:([0-9a-fA-F-]{36})'))
                      and pg.acknowledged_at is not null
                      and (v_code = 'acknowledged' or pg.closed_at is not null)) then
      return 'queue_outcome_page';
    end if;
  end if;
  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. Owned task creation: private.create_clinical_task's offer rules, with the named clinician in place of the patient's lead.
--    Same insert, transition row, event, window cap and offerability checks; anything that stops the named clinician taking the
--    offer falls back to private.create_clinical_task's normal routing.
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
  v_frac numeric := (private.task_layer_setting('lead_window_cap_fraction') #>> '{}')::numeric;
  v_cap_minutes integer;
  v_window_ends timestamptz;
  v_employed boolean;
begin
  if p_dedup_key is null then raise exception 'an owned task needs a dedup key' using errcode = '22023'; end if;
  if v_frac is null then raise exception 'queue_task_layer_config has no active row' using errcode = 'P0001'; end if;
  select * into ty from public.task_types where code = p_type and is_active;
  if not found or not ty.creatable then raise exception 'unknown or non-creatable task type %', p_type using errcode = '22023'; end if;
  select * into pr from public.profiles where id = p_patient and role = 'patient';
  if not found then raise exception 'unknown patient' using errcode = '22023'; end if;

  -- one live task per key
  select id into v_id from public.clinical_tasks where dedup_key = p_dedup_key and state not in ('completed', 'cancelled') limit 1;
  if v_id is not null then return v_id; end if;

  v_req := (select coalesce(array_agg(distinct x order by x), '{}')
              from unnest(ty.required_competencies || private.task_extra_competencies(ty.code, p_dedup_key)) x);
  v_due := now() + make_interval(mins => ty.default_due_minutes);
  -- D1, as create_clinical_task: the type's window or a fraction of the task's life, whichever is shorter
  v_cap_minutes := floor(least(ty.lead_window_minutes::numeric, v_frac * extract(epoch from (v_due - now())) / 60));
  v_window_ends := least(v_due, now() + make_interval(mins => greatest(v_cap_minutes, 0)));

  if p_owner is null
     or ty.priority_class <= 1
     or v_cap_minutes < 1
     or coalesce(array_length(private.clinician_missing_competencies(p_owner, v_req), 1), 0) > 0
     or not private.clinician_offerable(p_owner, now(), v_window_ends)
     or private.has_conflict(p_owner, p_patient)
     or not exists (select 1 from public.clinical_staff cs where cs.profile_id = p_owner and cs.active and cs.doctor_tier is not null
                     and cs.organisation_id = pr.organisation_id
                     and private.doctor_tier_rank(cs.doctor_tier) >= private.doctor_tier_rank(ty.min_doctor_tier)) then
    return private.create_clinical_task(p_patient, p_type, null, p_dedup_key, null, null, null, '{}');
  end if;

  v_employed := ty.pushable and exists (select 1 from public.clinical_staff cs where cs.profile_id = p_owner and cs.employment_type = 'employed');
  perform set_config('tarragon.task_transition', 'on', true);
  insert into public.clinical_tasks (organisation_id, type, task_type_version, priority_class, priority_class_original, patient_id,
      required_competencies, min_tier, due_at, dedup_key, is_test, lead_clinician_id, lead_window_ends_at, delivery_path, pushed_to)
  values (pr.organisation_id, ty.code, ty.version, ty.priority_class, ty.priority_class, p_patient,
      v_req, ty.min_doctor_tier, v_due, p_dedup_key, pr.is_test, p_owner, v_window_ends,
      case when v_employed then 'push' else 'pull' end, case when v_employed then p_owner end)
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
-- 4. The loud failure: an ops incident per consultation, updated rather than duplicated. Never raises: if the incident itself
--    cannot be written, a WARNING is the last resort, so nothing that calls this can be rolled back by it.
-- ---------------------------------------------------------------------------
create function private.consultation_completion_incident(p_org uuid, p_consultation uuid, p_problems text[])
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ref text := 'consultation_completion:' || p_consultation;
  v_summary text := format('Video consultation %s: part of what should follow it did not happen: %s. Ids only.',
                           p_consultation, array_to_string(p_problems, '; '));
begin
  begin
    if exists (select 1 from public.ops_incidents where external_reference = v_ref and status not in ('resolved', 'closed')) then
      update public.ops_incidents set summary = v_summary where external_reference = v_ref and status not in ('resolved', 'closed');
    else
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (p_org, 'clinical', 'sev2', 'A finished video consultation is missing its note, task or timeline entry', v_summary, v_ref,
              now() + interval '4 hours', now() + interval '24 hours');
    end if;
  exception when others then
    raise warning 'consultation_completion_incident: could not record an incident for video_consultation % (%: %). Problems: %',
      p_consultation, sqlstate, sqlerrm, array_to_string(p_problems, '; ');
  end;
end;
$function$;
revoke all on function private.consultation_completion_incident(uuid, uuid, text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Is a doctor note owed for this call? Not for a non-doctor visit (S64 dietitian / pharmacist and the other non-doctor
--    appointment types), nor when the recorded clinician is booked as something other than a doctor.
-- ---------------------------------------------------------------------------
create function private.video_consultation_needs_doctor_note(p_consultation uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select not exists (
           select 1 from public.appointments a
            where a.video_consultation_id = p_consultation
              and a.appointment_type in ('dietitian', 'pharmacist', 'physiotherapist', 'nurse', 'therapy'))
     and not exists (
           select 1 from public.video_consultations v
             join public.clinical_staff cs on cs.profile_id = coalesce(v.clinician_id, private.video_consultation_clinician(v.id))
            where v.id = p_consultation and cs.care_role <> 'doctor');
$function$;
revoke all on function private.video_consultation_needs_doctor_note(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The chain
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
  v_actor_staff uuid;  -- any active clinical_staff row, for attribution on the timeline
  v_owed boolean := true;
  v_problems text[] := '{}';
begin
  select * into vc from public.video_consultations where id = p_consultation;
  if not found or vc.status <> 'completed' then
    return;
  end if;

  begin
    v_clin := coalesce(vc.clinician_id, private.video_consultation_clinician(vc.id));
    v_owed := private.video_consultation_needs_doctor_note(vc.id);
    if v_clin is not null then
      select id into v_actor_staff from public.clinical_staff
       where profile_id = v_clin and organisation_id = vc.organisation_id and active limit 1;
      select id into v_staff from public.clinical_staff
       where profile_id = v_clin and organisation_id = vc.organisation_id and active and care_role = 'doctor'
         and doctor_tier in ('senior_medical_officer', 'chief_medical_officer')
       limit 1;
    end if;
  exception when others then
    v_problems := v_problems || ('the clinician could not be looked up (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
  end;

  if v_owed then
    if v_clin is null then
      v_problems := v_problems || 'no clinician is recorded for the call'::text;
    end if;

    -- 6a. the draft note
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
            'Video consultation', vc.started_at, vc.ended_at
          );
          perform set_config('app.trusted_clinical_staff_author', '', true);
        end if;
      end if;
    exception when others then
      perform set_config('app.trusted_clinical_staff_author', '', true);
      v_problems := v_problems || ('the draft note could not be created (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
    end;

    -- 6b. the task to write and sign the note (none when a finalised note already exists)
    begin
      if not exists (select 1 from public.clinical_encounter_notes
                      where video_consultation_id = vc.id and status = 'finalized') then
        perform private.create_owned_clinical_task(vc.patient_id, 'consultation_note', v_clin, 'consult_note:' || vc.id);
      end if;
    exception when others then
      v_problems := v_problems || ('the note task could not be created (' || sqlstate || ': ' || left(sqlerrm, 200) || ')');
    end;
  end if;

  -- 6c. one timeline row per consultation; generic wording, no consultation context
  begin
    if not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = vc.id) then
      perform private.record_timeline_event(
        vc.organisation_id, vc.patient_id, 'encounter_documented', 'video_consultations', vc.id,
        'Video consultation completed', 'Video consultation', coalesce(vc.ended_at, now()), v_actor_staff,
        jsonb_build_object('kind', 'consultation_completed', 'video_consultation_id', vc.id));
    end if;
  exception
    when unique_violation then null;  -- written by a concurrent run
    when others then
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
-- its name and function; the body now runs the whole chain and can never abort the status update.
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
    perform set_config('app.trusted_clinical_staff_author', '', true);
    perform private.consultation_completion_incident(new.organisation_id, new.id,
      array['the completion chain failed (' || sqlstate || ': ' || left(sqlerrm, 200) || ')']);
    raise warning 'auto_draft_note_from_video_consultation failed for video_consultation %: %', new.id, sqlerrm;
  end;
  return null;
exception when others then
  -- last resort: consultation_completion_incident never raises, but the call ending must not depend on that
  raise warning 'auto_draft_note_from_video_consultation: video_consultation %: %', new.id, sqlerrm;
  return null;
end;
$function$;
revoke all on function private.auto_draft_note_from_video_consultation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Finalising the note completes the task for the finalising doctor, whoever held it
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
  v_claim uuid;
begin
  if new.video_consultation_id is null or new.amends_note_id is not null then
    return null;
  end if;
  select profile_id into v_actor from public.clinical_staff where id = new.finalized_by_staff;
  for t in select * from public.clinical_tasks
            where type = 'consultation_note' and state not in ('completed', 'cancelled')
              and dedup_key like 'consult_note:' || new.video_consultation_id || '%'
            for update
  loop
    begin
      if v_actor is null then
        raise exception 'the finalising clinician has no clinical_staff record';
      end if;
      -- someone else's claim: the work it was for is done, so it ends (system move, reason recorded)
      if t.state = 'claimed' and t.claimed_by is distinct from v_actor then
        update public.task_claims set ended_at = now(), end_reason = 'cancelled' where task_id = t.id and ended_at is null;
        perform private.apply_task_transition(t.id, 'open', 'system', null,
          'the consultation note was finalised by another clinician; this claim ended');
        t.state := 'open';
      end if;
      -- an offer to someone else goes back to the pool so the finaliser can take it
      if t.state = 'offered_to_lead' and v_actor is distinct from t.lead_clinician_id and v_actor is distinct from t.pushed_to then
        perform private.apply_task_transition(t.id, 'open', 'system', null,
          'the consultation note was finalised by another clinician; offer withdrawn');
        t.state := 'open';
      end if;
      -- the finaliser's claim, exactly as queue_next makes one
      if t.state <> 'claimed' then
        insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
        values (t.organisation_id, t.id, v_actor, now() + interval '5 minutes', t.is_test) returning id into v_claim;
        perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_actor, 'the consultation note was finalised',
                                              v_actor, now() + interval '5 minutes');
      else
        select id into v_claim from public.task_claims where task_id = t.id and clinician_id = v_actor and ended_at is null;
        if v_claim is null then
          insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
          values (t.organisation_id, t.id, v_actor, now() + interval '5 minutes', t.is_test) returning id into v_claim;
        end if;
      end if;
      -- and the completion, as queue_complete does it
      update public.task_claims set ended_at = now(), end_reason = 'completed' where id = v_claim;
      perform private.apply_task_transition(t.id, 'completed', 'clinician', v_actor, 'the consultation note was finalised', null, null,
        jsonb_build_object('code', 'completed_action_taken', 'note_id', new.id, 'video_consultation_id', new.video_consultation_id,
                           'signed_by_staff', new.finalized_by_staff, 'system_checked', true));
      perform private.reliability_event(v_actor, t.id, case when now() <= t.due_at then 'completed_on_time' else 'completed_late' end);
      insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
      values (t.organisation_id, v_actor, 'queue.complete', 'clinical_task', t.id,
              jsonb_build_object('type', t.type, 'outcome_code', 'completed_action_taken', 'note_id', new.id), t.patient_id);
      perform private.emit_domain_event('clinical_task.completed', t.organisation_id,
        jsonb_build_object('task_id', t.id, 'type', t.type), 'clinical_task.completed:' || v_claim, t.patient_id, 'clinical_task', t.id);
      perform private.emit_domain_event('clinician.task_completed', t.organisation_id,
        jsonb_build_object('task_id', t.id, 'type', t.type, 'clinician_id', v_actor, 'priority_class', t.priority_class),
        'clinician.task_completed:' || v_claim, t.patient_id, 'clinical_task', t.id);
    exception when others then
      -- the task stays open in the queue and the ops desk is told; the note itself is never blocked
      perform private.consultation_completion_incident(t.organisation_id, new.video_consultation_id,
        array['the note was finalised but its task ' || t.id || ' could not be closed (' || sqlstate || ': ' || left(sqlerrm, 200) || ')']);
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
-- 8. Timeline: one row per consultation, and hidden from caregiver reads for a patient aged 10 to 17. Redefined from the live
--    body of private.timeline_source_is_sensitive_order with one added branch; the select policy already applies it to the
--    caregiver (can_read_clinical) path only.
-- ---------------------------------------------------------------------------
create unique index patient_timeline_one_per_video_consultation
  on public.patient_timeline (source_id) where source_table = 'video_consultations';

create or replace function private.timeline_source_is_sensitive_order(p_table text, p_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select case p_table
    when 'lab_orders' then private.lab_order_is_sensitive(p_id)
    when 'screening_results' then exists (select 1 from public.screening_results sr where sr.id = p_id and private.lab_order_is_sensitive(sr.lab_order_id))
    -- 20261105164409: a 10-17-year-old's consultation is theirs; a caregiver grant does not show it on the timeline
    when 'video_consultations' then exists (select 1 from public.video_consultations v where v.id = p_id
                                             and private.adolescent_age_band(v.patient_id) in ('younger_adolescent', 'older_adolescent'))
    else false
  end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Backfill: the clinician where derivable, then the chain for every completed consultation without a finalised note
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

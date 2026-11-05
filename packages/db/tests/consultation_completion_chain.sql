-- Tarragon Health: the consultation completion chain (20261105164409_consultation_completion_chain.sql).
--
--  1. a booking records the doctor on appointments; the consultation takes it into video_consultations.clinician_id;
--  2. completing the call drafts the note (authored by that doctor), creates ONE consultation_note task offered to that doctor
--     for its whole due window, and writes ONE patient_timeline entry (source video_consultations); no incident;
--  3. running the chain again creates nothing new (one note, one task, one timeline row);
--  4. a call with no clinician anywhere fails LOUDLY: an open ops incident names it, the note task still exists (pool),
--     the timeline entry is still written;
--  5. the doctor finalising the note completes the task (claimed then completed, outcome names the note);
--  6. a reassignment before the call follows the booking; a completed call keeps who ran it;
--  7. the live 11-03 consultation (when present: live run only) has its clinician, a task and a timeline entry after the backfill.
-- Sabotage (rolled-back sub-block): the old resolver (slots and visit requests only) and no booking trigger -> the call booked
-- through appointments again leaves no note and no clinician, so check 2 flips.
--
-- Run: npx supabase db query --linked -f packages/db/tests/consultation_completion_chain.sql (nothing persists: begin/rollback)

begin;

create temporary table ccc_result (msg text) on commit drop;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'Ccc ' || p_label, is_test = true, is_active = true,
         date_of_birth = '1975-03-01', sex = 'female' where id = v;
  return v;
end $f$;

create function pg_temp.book_and_complete(p_org uuid, p_pat uuid, p_doc uuid) returns uuid language plpgsql as
$f$ declare v_vc uuid;
begin
  insert into public.video_consultations (organisation_id, patient_id, context, scheduled_at)
  values (p_org, p_pat, 'general_checkin', now() - interval '1 hour') returning id into v_vc;
  if p_doc is not null then
    insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, appointment_type, consultation_method, clinician_id,
                                     video_consultation_id, booked_via)
    values (p_org, p_pat, now() - interval '1 hour', now() - interval '30 minutes', 'telemedicine', 'telemedicine', p_doc, v_vc, 'self');
  end if;
  update public.video_consultations set status = 'started', started_at = now() - interval '55 minutes' where id = v_vc;
  update public.video_consultations set status = 'completed', ended_at = now() - interval '30 minutes' where id = v_vc;
  return v_vc;
end $f$;

do $proof$
declare
  v_org uuid; v_pat uuid; v_pat2 uuid; v_pat3 uuid; v_doc uuid; v_doc2 uuid; v_admin uuid; v_staff uuid;
  v_vc uuid; v_vc2 uuid; v_vc3 uuid; v_note uuid; v_task uuid; v_n integer; r text;
  v_sab_clin uuid; v_sab_notes integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');
  v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_doc2 := pg_temp.mkuser(v_org, 'doc2', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
  values (v_org, v_doc, 'Ccc Doctor', 'MDCN', 'CCC-DOC-1', true, 'active', now(), now() + interval '1 year', v_admin, 'senior_medical_officer', 'employed', 2, true),
         (v_org, v_doc2, 'Ccc Doctor Two', 'MDCN', 'CCC-DOC-2', true, 'active', now(), now() + interval '1 year', v_admin, 'senior_medical_officer', 'employed', 2, true);
  if not private.clinician_is_eligible(v_doc) then raise exception 'fixture FAIL: the doctor is not eligible to take tasks'; end if;
  select id into v_staff from public.clinical_staff where profile_id = v_doc;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at) values (v_org, v_pat, v_doc, now());

  -- 1 + 2. booked through appointments, completed
  v_vc := pg_temp.book_and_complete(v_org, v_pat, v_doc);
  if (select clinician_id from public.video_consultations where id = v_vc) is distinct from v_doc then
    raise exception 'FAIL 1: the consultation did not take the booked doctor (clinician_id %)', (select clinician_id from public.video_consultations where id = v_vc);
  end if;
  select id into v_note from public.clinical_encounter_notes where video_consultation_id = v_vc and auto_generated and authored_by_staff = v_staff;
  if v_note is null then raise exception 'FAIL 2: no auto-drafted note authored by the doctor who ran the call'; end if;
  select id into v_task from public.clinical_tasks
   where dedup_key = 'consult_note:' || v_vc and type = 'consultation_note' and state = 'offered_to_lead' and lead_clinician_id = v_doc
     and patient_id = v_pat and min_tier = 'senior_medical_officer';
  if v_task is null then
    raise exception 'FAIL 2: no consultation_note task offered to the doctor (%)',
      (select jsonb_agg(jsonb_build_object('state', state, 'lead', lead_clinician_id)) from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc);
  end if;
  if not exists (select 1 from public.clinical_task_transitions where task_id = v_task and to_state = 'offered_to_lead'
                  and reason = 'offered to the clinician who ran the consultation') then
    raise exception 'FAIL 2: the task was routed by the generic path, not to the clinician who ran the call';
  end if;
  if (select lead_window_ends_at from public.clinical_tasks where id = v_task) <> (select due_at from public.clinical_tasks where id = v_task) then
    raise exception 'FAIL 2: the offer does not last the whole due window';
  end if;
  if (select count(*) from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc
        and title = 'Video consultation completed' and metadata ->> 'kind' = 'consultation_completed' and actor_clinical_staff_id = v_staff) <> 1 then
    raise exception 'FAIL 2: no single timeline entry for the completed call';
  end if;
  if exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc) then
    raise exception 'FAIL 2: an incident was opened for a call that went through cleanly';
  end if;

  -- 3. idempotent
  perform private.consultation_completion_chain(v_vc);
  if (select count(*) from public.clinical_encounter_notes where video_consultation_id = v_vc) <> 1
     or (select count(*) from public.clinical_tasks where dedup_key like 'consult_note:' || v_vc || '%') <> 1
     or (select count(*) from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc) <> 1 then
    raise exception 'FAIL 3: running the chain twice duplicated a note, task or timeline entry';
  end if;

  -- 4. no clinician anywhere: loud
  v_vc2 := pg_temp.book_and_complete(v_org, v_pat2, null);
  if not exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc2
                  and status not in ('resolved', 'closed') and category = 'clinical' and summary like '%no clinician is recorded for the call%') then
    raise exception 'FAIL 4: a call with no clinician did not open an incident';
  end if;
  if not exists (select 1 from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc2 and type = 'consultation_note'
                  and state not in ('completed', 'cancelled')) then
    raise exception 'FAIL 4: a call with no clinician has no note task at all';
  end if;
  if not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc2) then
    raise exception 'FAIL 4: a call with no clinician has no timeline entry';
  end if;
  if exists (select 1 from public.clinical_encounter_notes where video_consultation_id = v_vc2) then
    raise exception 'FAIL 4: a note was drafted with no known author';
  end if;

  -- 5. finalising the note completes the task for the finalising doctor
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.update_encounter_note_draft(v_note, jsonb_build_object('assessment', 'Ccc review', 'plan', 'Ccc plan'));
  perform public.finalize_encounter_note(v_note, (enum_range(null::public.consultation_outcome))[1], true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  if (select status from public.clinical_encounter_notes where id = v_note) <> 'finalized' then
    raise exception 'FAIL 5: the fixture note did not finalise';
  end if;
  if (select state::text from public.clinical_tasks where id = v_task) <> 'completed'
     or (select claimed_by from public.clinical_tasks where id = v_task) is distinct from v_doc
     or (select outcome ->> 'note_id' from public.clinical_tasks where id = v_task) <> v_note::text then
    raise exception 'FAIL 5: finalising the note did not complete the task (state %)', (select state from public.clinical_tasks where id = v_task);
  end if;

  -- 6. reassignment before the call follows the booking; a completed call keeps its doctor
  insert into public.video_consultations (organisation_id, patient_id, context, scheduled_at)
  values (v_org, v_pat3, 'general_checkin', now() + interval '1 day') returning id into v_vc3;
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, appointment_type, consultation_method, clinician_id,
                                   video_consultation_id, booked_via)
  values (v_org, v_pat3, now() + interval '1 day', now() + interval '1 day 30 minutes', 'telemedicine', 'telemedicine', v_doc, v_vc3, 'self');
  update public.appointments set clinician_id = v_doc2 where video_consultation_id = v_vc3;
  if (select clinician_id from public.video_consultations where id = v_vc3) is distinct from v_doc2 then
    raise exception 'FAIL 6: a reassignment before the call was not followed';
  end if;
  update public.appointments set clinician_id = v_doc2 where video_consultation_id = v_vc;
  if (select clinician_id from public.video_consultations where id = v_vc) is distinct from v_doc then
    raise exception 'FAIL 6: a completed call changed who ran it';
  end if;

  -- 7. the live 11-03 call (present only on the live project; skipped on a fresh replay)
  if exists (select 1 from public.video_consultations where id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') then
    if (select clinician_id from public.video_consultations where id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') is null
       or not exists (select 1 from public.clinical_tasks where dedup_key = 'consult_note:80d9ca01-4def-4b38-b7b9-2a3dbfb664a8')
       or not exists (select 1 from public.patient_timeline where source_table = 'video_consultations'
                       and source_id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8')
       or not exists (select 1 from public.clinical_encounter_notes where video_consultation_id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') then
      raise exception 'FAIL 7: the 11-03 consultation was not backfilled';
    end if;
    insert into ccc_result values ('check 7: the 11-03 consultation was backfilled (clinician, note, task, timeline)');
  end if;

  -- Sabotage: the pre-fix resolver and no booking trigger; the same kind of booking must now leave no clinician and no note.
  begin
    create or replace function private.video_consultation_clinician(p_consultation_id uuid) returns uuid
    language sql stable security definer set search_path to '' as $sab$
      select coalesce(
        (select s.clinician_profile_id from public.consult_availability_slots s where s.booked_consultation_id = p_consultation_id limit 1),
        (select cs.profile_id from public.video_visit_requests r join public.clinical_staff cs on cs.id = r.accepted_by
          where r.video_consultation_id = p_consultation_id limit 1));
    $sab$;
    drop trigger appointments_video_consultation_clinician on public.appointments;
    v_vc3 := pg_temp.book_and_complete(v_org, v_pat3, v_doc);
    select clinician_id into v_sab_clin from public.video_consultations where id = v_vc3;
    select count(*) into v_sab_notes from public.clinical_encounter_notes where video_consultation_id = v_vc3;
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage block failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_clin is not null or v_sab_notes <> 0 then
    raise exception 'SABOTAGE FAIL: with the old resolver the booked call still got a clinician (%) or a note (%), so check 2 cannot discriminate',
      v_sab_clin, v_sab_notes;
  end if;
  insert into ccc_result values ('sabotage: with the pre-fix resolver the call got no clinician and no note (check 2 would fail)');
  -- and the sabotage really was rolled back
  if not exists (select 1 from pg_trigger where tgname = 'appointments_video_consultation_clinician') then
    raise exception 'sabotage was not rolled back';
  end if;

  insert into ccc_result values ('consultation_completion_chain: all checks passed');
end
$proof$;

select msg from ccc_result;

rollback;

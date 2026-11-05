-- Tarragon Health: the consultation completion chain (20261105164409_consultation_completion_chain.sql).
--
--  A. a booking records the doctor on appointments; the consultation takes it into video_consultations.clinician_id;
--  B. completing the call drafts the note (authored by that doctor), creates ONE consultation_note task offered to that doctor
--     under the normal offer rules (window capped, ends before the due time), and writes ONE generic timeline row; no incident;
--  C. running the chain again creates nothing new;
--  D. a call with no clinician fails LOUDLY: an open ops incident, a pool task, the timeline row, no note;
--  E. the doctor who ran the call finalising the note completes the task (claim row ended, outcome names the note);
--  F. a reassignment before the call follows the booking; a completed call keeps who ran it;
--  G. the live 11-03 call (live run only) has its clinician, a note, a task and a timeline row after the backfill.
--  1. a dietitian visit owes no doctor note: no incident, no task, no note, but the timeline row;
--  2. the call ending is never blocked and a failed incident write never undoes the steps that worked: with ops_incidents
--     refusing every insert, a no-clinician call still completes with its task and timeline row;
--  3. a note finalised by a doctor other than the one the task was offered to, or than the one who claimed it, still completes
--     the task for the finaliser (the offer / the other claim ended by a recorded system move);
--  5. a signed-in staff member cannot set clinician_id directly; an ordinary update still works;
--  6. the timeline row is a sensitive source for a 10-17-year-old (hidden from caregiver reads), not for an adult;
--  8. closing the task by hand as "action taken" needs the finalised note; any other outcome needs a written reason;
--  R1. an appointment cannot hand the consultation a clinician who is not active clinical staff fitting the booking type;
--  R2. a task closed by hand without a signed note adds that to the consultation's incident (R4: appended, not overwritten);
--  6 also reads patient_timeline as a simulated caregiver: hidden for a 14-year-old, visible for an adult control;
--  B also checks the note's reason text and that the timeline row has no actor (trust tier 'system').
-- Sabotage (each in a rolled-back sub-block): the pre-fix resolver -> B flips; the note-owed rule forced true -> 1 flips;
-- an incident writer that raises -> 2 flips; the earlier finaliser-only close -> 3 flips; the guard dropped -> 5 flips;
-- the unchecked booking copy -> R1 flips; the closed-without-note trigger dropped -> R2 flips.
--
-- Run: npx supabase db query --linked -f packages/db/tests/consultation_completion_chain.sql (nothing persists: begin/rollback)

begin;

create temporary table ccc_result (msg text) on commit drop;
create temporary sequence ccc_slot;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default '1975-03-01') returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  update public.profiles set organisation_id = p_org, role = p_role::public.user_role, full_name = 'Ccc ' || p_label, is_test = true, is_active = true,
         date_of_birth = p_dob, sex = 'female',
         is_dependent_account = (p_dob > current_date - interval '18 years'),
         dependent_kind = case when p_dob > current_date - interval '18 years' then 'minor_child'::public.dependent_kind end
   where id = v;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; r := coalesce(r, 'ok'); exception when others then r := sqlstate || ':' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;

create function pg_temp.book(p_org uuid, p_pat uuid, p_doc uuid, p_type text default 'telemedicine') returns uuid language plpgsql as
$f$ declare v_vc uuid; v_at timestamptz := now() - interval '1 hour' - make_interval(hours => nextval('ccc_slot')::int);
begin
  insert into public.video_consultations (organisation_id, patient_id, context, scheduled_at)
  values (p_org, p_pat, 'general_checkin', v_at) returning id into v_vc;
  if p_doc is not null then
    insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, appointment_type, consultation_method, clinician_id,
                                     video_consultation_id, booked_via)
    values (p_org, p_pat, v_at, v_at + interval '30 minutes', p_type::public.appointment_type, 'telemedicine', p_doc, v_vc, 'self');
  end if;
  return v_vc;
end $f$;

create function pg_temp.complete(p_vc uuid) returns void language plpgsql as
$f$ begin
  update public.video_consultations set status = 'started', started_at = now() - interval '55 minutes' where id = p_vc;
  update public.video_consultations set status = 'completed', ended_at = now() - interval '30 minutes' where id = p_vc;
end $f$;

create function pg_temp.book_and_complete(p_org uuid, p_pat uuid, p_doc uuid, p_type text default 'telemedicine') returns uuid language plpgsql as
$f$ declare v_vc uuid;
begin
  v_vc := pg_temp.book(p_org, p_pat, p_doc, p_type);
  perform pg_temp.complete(v_vc);
  return v_vc;
end $f$;

create function pg_temp.finalise(p_doc uuid, p_note uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.update_encounter_note_draft(p_note, jsonb_build_object('assessment', 'Ccc review', 'plan', 'Ccc plan'));
  perform public.finalize_encounter_note(p_note, (enum_range(null::public.consultation_outcome))[1], true);
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $f$;

do $proof$
declare
  v_org uuid; v_pat uuid; v_pat2 uuid; v_pat3 uuid; v_pat4 uuid; v_pat5 uuid; v_pat6 uuid; v_teen uuid; v_guard uuid; v_pa uuid; v_vcx uuid; v_vcy uuid;
  v_doc uuid; v_doc2 uuid; v_diet uuid; v_admin uuid; v_staff uuid; v_staff2 uuid;
  v_vc uuid; v_vc2 uuid; v_vc3 uuid; v_vc4 uuid; v_vc5 uuid; v_vc6 uuid; v_vcd uuid; v_vct uuid;
  v_note uuid; v_task uuid; v_task2 uuid; v_n integer; r text; tk public.clinical_tasks%rowtype;
  v_sab_clin uuid; v_sab_notes integer; v_sab_inc boolean; v_sab_task boolean; v_sab_state text; v_sab_r text; v_sab_status text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, 'pat2', 'patient');
  v_pat3 := pg_temp.mkuser(v_org, 'pat3', 'patient');
  v_pat4 := pg_temp.mkuser(v_org, 'pat4', 'patient');
  v_pat5 := pg_temp.mkuser(v_org, 'pat5', 'patient');
  v_pat6 := pg_temp.mkuser(v_org, 'pat6', 'patient');
  v_teen := pg_temp.mkuser(v_org, 'teen', 'patient');
  v_guard := pg_temp.mkuser(v_org, 'guardian', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_doc2 := pg_temp.mkuser(v_org, 'doc2', 'clinician');
  v_diet := pg_temp.mkuser(v_org, 'diet', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, care_role, is_test)
  values (v_org, v_doc, 'Ccc Doctor', 'MDCN', 'CCC-DOC-1', true, 'active', now(), now() + interval '1 year', v_admin, 'senior_medical_officer', 'employed', 2, 'doctor', true),
         (v_org, v_doc2, 'Ccc Doctor Two', 'MDCN', 'CCC-DOC-2', true, 'active', now(), now() + interval '1 year', v_admin, 'senior_medical_officer', 'employed', 2, 'doctor', true),
         (v_org, v_diet, 'Ccc Dietitian', 'other', 'CCC-DIET-1', true, 'active', now(), now() + interval '1 year', v_admin, 'care_coordinator', 'employed', 1, 'dietitian', true);
  if not private.clinician_is_eligible(v_doc) or not private.clinician_is_eligible(v_doc2) then
    raise exception 'fixture FAIL: the doctors are not eligible to take tasks';
  end if;
  select id into v_staff from public.clinical_staff where profile_id = v_doc;
  select id into v_staff2 from public.clinical_staff where profile_id = v_doc2;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doc, now()), (v_org, v_pat4, v_doc2, now()), (v_org, v_pat5, v_doc2, now());

  -- A + B. booked through appointments, completed
  v_vc := pg_temp.book_and_complete(v_org, v_pat, v_doc);
  if (select clinician_id from public.video_consultations where id = v_vc) is distinct from v_doc then
    raise exception 'FAIL A: the consultation did not take the booked doctor';
  end if;
  select id into v_note from public.clinical_encounter_notes where video_consultation_id = v_vc and auto_generated and authored_by_staff = v_staff;
  if v_note is null then raise exception 'FAIL B: no auto-drafted note authored by the doctor who ran the call'; end if;
  if (select reason_for_encounter from public.clinical_encounter_notes where id = v_note) <> 'Video consultation'
     or not exists (select 1 from pg_proc where proname = 'consultation_completion_chain'
                     and prosrc like '%Pre-referral triage video consultation%' and prosrc like '%Specialist video consultation%') then
    raise exception 'FAIL B: the note reason is not the context-specific text the live trigger wrote';
  end if;
  select * into tk from public.clinical_tasks
   where dedup_key = 'consult_note:' || v_vc and type = 'consultation_note' and state = 'offered_to_lead' and lead_clinician_id = v_doc;
  if tk.id is null then
    raise exception 'FAIL B: no consultation_note task offered to the doctor (%)',
      (select jsonb_agg(jsonb_build_object('state', state, 'lead', lead_clinician_id)) from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc);
  end if;
  v_task := tk.id;
  if not exists (select 1 from public.clinical_task_transitions where task_id = v_task and to_state = 'offered_to_lead'
                  and reason = 'offered to the clinician who ran the consultation') then
    raise exception 'FAIL B: the task was routed by the generic path, not to the clinician who ran the call';
  end if;
  if tk.lead_window_ends_at is null or tk.lead_window_ends_at >= tk.due_at or tk.lead_window_ends_at <= now() then
    raise exception 'FAIL B: the offer window is not capped inside the due time (window %, due %)', tk.lead_window_ends_at, tk.due_at;
  end if;
  if (select count(*) from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc
        and title = 'Video consultation completed' and summary = 'Video consultation' and metadata ->> 'kind' = 'consultation_completed'
        and not (metadata ? 'context') and actor_clinical_staff_id is null and trust_tier = 'system') <> 1 then
    raise exception 'FAIL B: no single generic timeline row for the completed call';
  end if;
  if exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc) then
    raise exception 'FAIL B: an incident was opened for a call that went through cleanly';
  end if;

  -- C. idempotent
  perform private.consultation_completion_chain(v_vc);
  if (select count(*) from public.clinical_encounter_notes where video_consultation_id = v_vc) <> 1
     or (select count(*) from public.clinical_tasks where dedup_key like 'consult_note:' || v_vc || '%') <> 1
     or (select count(*) from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc) <> 1 then
    raise exception 'FAIL C: running the chain twice duplicated a note, task or timeline row';
  end if;

  -- D. no clinician anywhere: loud
  v_vc2 := pg_temp.book_and_complete(v_org, v_pat2, null);
  if not exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc2
                  and status not in ('resolved', 'closed') and category = 'clinical' and summary like '%no clinician is recorded for the call%') then
    raise exception 'FAIL D: a call with no clinician did not open an incident';
  end if;
  select id into v_task2 from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc2 and type = 'consultation_note'
                  and state not in ('completed', 'cancelled');
  if v_task2 is null then raise exception 'FAIL D: a call with no clinician has no note task at all'; end if;
  if not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc2) then
    raise exception 'FAIL D: a call with no clinician has no timeline row';
  end if;
  if exists (select 1 from public.clinical_encounter_notes where video_consultation_id = v_vc2) then
    raise exception 'FAIL D: a note was drafted with no known author';
  end if;

  -- 8. closing by hand: "action taken" needs the finalised note; other outcomes need a reason
  select * into tk from public.clinical_tasks where id = v_task;
  if private.task_outcome_error(tk, v_doc, '{"code":"completed_action_taken"}'::jsonb) is distinct from 'queue_outcome_note_missing' then
    raise exception 'FAIL 8: action taken was accepted with no finalised note';
  end if;
  if private.task_outcome_error(tk, v_doc, '{"code":"completed_no_action_needed"}'::jsonb) is distinct from 'queue_outcome_reason_needed'
     or private.task_outcome_error(tk, v_doc, '{"code":"completed_no_action_needed","note":"short"}'::jsonb) is distinct from 'queue_outcome_reason_needed' then
    raise exception 'FAIL 8: another outcome was accepted without a written reason';
  end if;
  if private.task_outcome_error(tk, v_doc, '{"code":"completed_no_action_needed","note":"Patient seen in clinic instead"}'::jsonb) is not null then
    raise exception 'FAIL 8: a reasoned outcome was refused';
  end if;

  -- E. the doctor who ran the call finalises: the task completes
  perform pg_temp.finalise(v_doc, v_note);
  if (select status from public.clinical_encounter_notes where id = v_note) <> 'finalized' then raise exception 'FAIL E: the fixture note did not finalise'; end if;
  select * into tk from public.clinical_tasks where id = v_task;
  if tk.state <> 'completed' or tk.claimed_by is distinct from v_doc or tk.outcome ->> 'note_id' <> v_note::text
     or exists (select 1 from public.task_claims where task_id = v_task and ended_at is null)
     or not exists (select 1 from public.task_claims where task_id = v_task and clinician_id = v_doc and end_reason = 'completed') then
    raise exception 'FAIL E: finalising the note did not complete the task like queue_complete (state %)', tk.state;
  end if;
  if private.task_outcome_error(tk, v_doc, '{"code":"completed_action_taken"}'::jsonb) is not null then
    raise exception 'FAIL 8: action taken refused although the note is finalised';
  end if;

  -- 3a. offered to doc (who ran the call), finalised by doc2 (the patient's tied doctor): completes for doc2
  v_vc4 := pg_temp.book_and_complete(v_org, v_pat4, v_doc);
  select id into v_task from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc4 and state = 'offered_to_lead' and lead_clinician_id = v_doc;
  if v_task is null then raise exception 'fixture FAIL 3a: no task offered to the doctor who ran the call'; end if;
  select id into v_note from public.clinical_encounter_notes where video_consultation_id = v_vc4;
  perform pg_temp.finalise(v_doc2, v_note);
  select * into tk from public.clinical_tasks where id = v_task;
  if tk.state <> 'completed' or tk.claimed_by is distinct from v_doc2
     or not exists (select 1 from public.clinical_task_transitions where task_id = v_task and actor_kind = 'system' and to_state = 'open'
                     and reason like 'the consultation note was finalised by another clinician%') then
    raise exception 'FAIL 3a: a note finalised by another doctor did not complete the task (state %)', tk.state;
  end if;

  -- 3b. claimed by doc, finalised by doc2: doc's claim ends, the task completes for doc2
  v_vc5 := pg_temp.book_and_complete(v_org, v_pat5, v_doc);
  select id into v_task from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc5;
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
  values (v_org, v_task, v_doc, now() + interval '30 minutes', true);
  perform private.apply_task_transition(v_task, 'claimed', 'clinician', v_doc, 'fixture claim', v_doc, now() + interval '30 minutes');
  select id into v_note from public.clinical_encounter_notes where video_consultation_id = v_vc5;
  perform pg_temp.finalise(v_doc2, v_note);
  select * into tk from public.clinical_tasks where id = v_task;
  if tk.state <> 'completed' or tk.claimed_by is distinct from v_doc2
     or not exists (select 1 from public.task_claims where task_id = v_task and clinician_id = v_doc and end_reason = 'cancelled')
     or exists (select 1 from public.task_claims where task_id = v_task and ended_at is null) then
    raise exception 'FAIL 3b: another doctor''s claim was not ended and the task not completed (state %)', tk.state;
  end if;

  -- F. reassignment before the call follows the booking; a completed call keeps its doctor
  v_vc3 := pg_temp.book(v_org, v_pat3, v_doc);
  update public.appointments set clinician_id = v_doc2 where video_consultation_id = v_vc3;
  if (select clinician_id from public.video_consultations where id = v_vc3) is distinct from v_doc2 then
    raise exception 'FAIL F: a reassignment before the call was not followed';
  end if;
  update public.appointments set clinician_id = v_doc2 where video_consultation_id = v_vc;
  if (select clinician_id from public.video_consultations where id = v_vc) is distinct from v_doc then
    raise exception 'FAIL F: a completed call changed who ran it';
  end if;

  -- 5. a signed-in staff member cannot set clinician_id directly; an ordinary update still works
  r := pg_temp.as_user(v_admin, format('update public.video_consultations set clinician_id = %L where id = %L returning id::text', v_doc, v_vc3));
  if r not like '42501:%' then raise exception 'FAIL 5: a staff member set clinician_id directly: %', r; end if;
  r := pg_temp.as_user(v_admin, format('update public.video_consultations set scheduled_at = now() + interval ''2 days'' where id = %L returning id::text', v_vc3));
  if r <> v_vc3::text then raise exception 'FAIL 5: an ordinary staff update was refused: %', r; end if;
  if (select clinician_id from public.video_consultations where id = v_vc3) is distinct from v_doc2 then
    raise exception 'FAIL 5: the clinician changed';
  end if;

  -- 1. a dietitian visit owes no doctor note
  v_vcd := pg_temp.book_and_complete(v_org, v_pat6, v_diet, 'dietitian');
  if exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vcd)
     or exists (select 1 from public.clinical_tasks where dedup_key like 'consult_note:' || v_vcd || '%')
     or exists (select 1 from public.clinical_encounter_notes where video_consultation_id = v_vcd)
     or not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vcd) then
    raise exception 'FAIL 1: a dietitian visit was treated as owing a doctor note, or lost its timeline row';
  end if;

  -- 6. the timeline row is sensitive (hidden from caregivers) for a 10-17-year-old only
  -- (today a dependant under 18 cannot hold a video consultation at all, guard_minor_dependant_scope; the gate is defence in
  -- depth, so the fixture books an adult and then makes the profile a 14-year-old dependant)
  v_vct := pg_temp.book(v_org, v_teen, null);
  perform private.record_timeline_event(v_org, v_teen, 'encounter_documented', 'video_consultations', v_vct,
    'Video consultation completed', 'Video consultation', now(), null, jsonb_build_object('kind', 'consultation_completed'));
  update public.profiles set date_of_birth = (current_date - interval '14 years')::date, is_dependent_account = true,
         dependent_kind = 'minor_child' where id = v_teen;
  if not private.timeline_source_is_sensitive_order('video_consultations', v_vct)
     or private.timeline_source_is_sensitive_order('video_consultations', v_vc) then
    raise exception 'FAIL 6: the adolescent gate is wrong';
  end if;
  -- the same, read as a caregiver: a manage grant on the 14-year-old sees nothing; a medical_history grant on an adult sees the row
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_teen, v_guard, 'manage', v_teen);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_pat, v_guard, 'view', v_pat)
    returning id into v_pa;
  -- only the record's owner may grant a category
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medical_history');
  perform set_config('request.jwt.claims', '', true);
  r := pg_temp.as_user(v_guard, format('select count(*)::text from public.patient_timeline where source_table = %L and source_id = %L', 'video_consultations', v_vct));
  if r <> '0' then raise exception 'FAIL 6: a caregiver read the 14-year-old''s consultation row (%)', r; end if;
  r := pg_temp.as_user(v_guard, format('select count(*)::text from public.patient_timeline where source_table = %L and source_id = %L', 'video_consultations', v_vc));
  if r <> '1' then raise exception 'FAIL 6: the adult control is not visible to the caregiver (%) so the check cannot discriminate', r; end if;

  -- 2. ops_incidents refuses every insert: a no-clinician call still completes, with its task and timeline row
  create function pg_temp.refuse_incident() returns trigger language plpgsql as $r$ begin raise exception 'ccc: incident refused'; end $r$;
  create trigger ccc_refuse_incident before insert on public.ops_incidents for each row execute function pg_temp.refuse_incident();
  v_vc6 := pg_temp.book_and_complete(v_org, v_pat3, null);
  if (select status::text from public.video_consultations where id = v_vc6) <> 'completed'
     or not exists (select 1 from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc6)
     or not exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc6) then
    raise exception 'FAIL 2: a failed incident write undid the call ending or the steps that worked';
  end if;
  drop trigger ccc_refuse_incident on public.ops_incidents;

  -- R1. an appointment cannot hand the consultation a clinician who does not fit: a non-clinician profile, or a dietitian on a
  --     doctor (telemedicine) booking, is not copied; the call then reports no clinician
  v_vcx := pg_temp.book(v_org, v_pat2, v_admin);
  v_vcy := pg_temp.book(v_org, v_pat2, v_diet, 'telemedicine');
  if (select clinician_id from public.video_consultations where id = v_vcx) is not null
     or (select clinician_id from public.video_consultations where id = v_vcy) is not null then
    raise exception 'FAIL R1: an appointment set an unfit clinician on the consultation';
  end if;
  perform pg_temp.complete(v_vcx);
  if (select clinician_id from public.video_consultations where id = v_vcx) is not null
     or not exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vcx
                     and summary like '%no clinician is recorded for the call%') then
    raise exception 'FAIL R1: the unfit booking clinician was picked up at completion, or no incident was opened';
  end if;

  -- R2 + R4. closing the note task by hand without a signed note adds to the consultation's incident (never overwriting it)
  select * into tk from public.clinical_tasks where id = v_task2;
  if tk.state = 'offered_to_lead' then
    perform private.apply_task_transition(v_task2, 'open', 'system', null, 'fixture: back to the pool');
  end if;
  insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
  values (v_org, v_task2, v_doc2, now() + interval '30 minutes', true);
  perform private.apply_task_transition(v_task2, 'claimed', 'clinician', v_doc2, 'fixture claim', v_doc2, now() + interval '30 minutes');
  r := pg_temp.as_user(v_doc2, format('select public.queue_complete(%L, %L::jsonb)::text', v_task2,
         jsonb_build_object('code', 'completed_no_action_needed', 'note', 'Patient did not join the call')::text));
  if r not in ('ok', '') then raise exception 'fixture FAIL R2: queue_complete refused a reasoned close: %', r; end if;
  if not exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc2
                  and summary like '%no clinician is recorded for the call%'
                  and summary like '%was completed with no signed note%') then
    raise exception 'FAIL R2/R4: closing the task without a signed note did not add to the incident (%)',
      (select summary from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc2);
  end if;

  -- G. the live 11-03 call (present only on the live project; skipped on a fresh replay)
  if exists (select 1 from public.video_consultations where id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') then
    if (select clinician_id from public.video_consultations where id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') is null
       or not exists (select 1 from public.clinical_tasks where dedup_key = 'consult_note:80d9ca01-4def-4b38-b7b9-2a3dbfb664a8')
       or not exists (select 1 from public.patient_timeline where source_table = 'video_consultations'
                       and source_id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8')
       or not exists (select 1 from public.clinical_encounter_notes where video_consultation_id = '80d9ca01-4def-4b38-b7b9-2a3dbfb664a8') then
      raise exception 'FAIL G: the 11-03 consultation was not backfilled';
    end if;
    insert into ccc_result values ('check G: the 11-03 consultation was backfilled (clinician, note, task, timeline)');
  end if;

  -- ===================== sabotage =====================
  -- S-B: the pre-fix resolver and no booking trigger
  begin
    create or replace function private.video_consultation_clinician(p_consultation_id uuid) returns uuid
    language sql stable security definer set search_path to '' as $sab$
      select coalesce(
        (select s.clinician_profile_id from public.consult_availability_slots s where s.booked_consultation_id = p_consultation_id limit 1),
        (select cs.profile_id from public.video_visit_requests r join public.clinical_staff cs on cs.id = r.accepted_by
          where r.video_consultation_id = p_consultation_id limit 1));
    $sab$;
    drop trigger appointments_video_consultation_clinician on public.appointments;
    v_vc := pg_temp.book_and_complete(v_org, v_pat3, v_doc);
    select clinician_id into v_sab_clin from public.video_consultations where id = v_vc;
    select count(*) into v_sab_notes from public.clinical_encounter_notes where video_consultation_id = v_vc;
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-B failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_clin is not null or v_sab_notes <> 0 then raise exception 'SABOTAGE S-B did not flip check B'; end if;
  insert into ccc_result values ('sabotage S-B: the pre-fix resolver leaves the booked call with no clinician and no note (B flips)');

  -- S-1: the note-owed rule forced true -> the dietitian visit opens an incident
  begin
    create or replace function private.video_consultation_needs_doctor_note(p_consultation uuid) returns boolean
    language sql stable security definer set search_path to '' as $sab$ select true $sab$;
    v_vc := pg_temp.book_and_complete(v_org, v_pat6, v_diet, 'dietitian');
    v_sab_inc := exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc);
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-1 failed unexpectedly: %', sqlerrm; end if;
  end;
  if not coalesce(v_sab_inc, false) then raise exception 'SABOTAGE S-1 did not flip check 1'; end if;
  insert into ccc_result values ('sabotage S-1: without the note-owed rule the dietitian visit opens an incident (1 flips)');

  -- S-2: an incident writer that raises (the reviewed defect) -> with ops_incidents refusing, the steps that worked are undone
  begin
    create or replace function private.consultation_completion_incident(p_org uuid, p_consultation uuid, p_problems text[]) returns void
    language plpgsql security definer set search_path to '' as $sab$
    begin
      insert into public.ops_incidents (organisation_id, category, severity, title, summary, external_reference, ack_due_at, resolve_due_at)
      values (p_org, 'clinical', 'sev2', 'x', 'x', 'consultation_completion:' || p_consultation, now(), now());
    end $sab$;
    create trigger ccc_refuse_incident before insert on public.ops_incidents for each row execute function pg_temp.refuse_incident();
    v_vc := pg_temp.book_and_complete(v_org, v_pat3, null);
    v_sab_task := exists (select 1 from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc)
              and exists (select 1 from public.patient_timeline where source_table = 'video_consultations' and source_id = v_vc);
    select status::text into v_sab_status from public.video_consultations where id = v_vc;
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-2 failed unexpectedly: %', sqlerrm; end if;
  end;
  if coalesce(v_sab_task, true) then raise exception 'SABOTAGE S-2 did not flip check 2'; end if;
  insert into ccc_result values ('sabotage S-2: an incident writer that raises undoes the task and timeline row (2 flips); call status was ' || coalesce(v_sab_status, 'n/a'));

  -- S-3: the earlier finaliser-only close (claim directly; a refusal is only a warning)
  begin
    create or replace function private.complete_consultation_note_task() returns trigger
    language plpgsql security definer set search_path to '' as $sab$
    declare t public.clinical_tasks%rowtype; v_actor uuid;
    begin
      select profile_id into v_actor from public.clinical_staff where id = new.finalized_by_staff;
      for t in select * from public.clinical_tasks where type = 'consultation_note' and state not in ('completed', 'cancelled')
                and dedup_key like 'consult_note:' || new.video_consultation_id || '%' loop
        begin
          if t.state <> 'claimed' then
            perform private.apply_task_transition(t.id, 'claimed', 'clinician', v_actor, 'x', v_actor, now() + interval '5 minutes');
          end if;
          perform private.apply_task_transition(t.id, 'completed', 'clinician', v_actor, 'x', null, null, '{"code":"completed_action_taken"}'::jsonb);
        exception when others then raise warning 'not closed: %', sqlerrm;
        end;
      end loop;
      return null;
    end $sab$;
    v_vc := pg_temp.book_and_complete(v_org, v_pat4, v_doc);
    select id into v_note from public.clinical_encounter_notes where video_consultation_id = v_vc;
    perform pg_temp.finalise(v_doc2, v_note);
    select state::text into v_sab_state from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc;
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-3 failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_state = 'completed' then raise exception 'SABOTAGE S-3 did not flip check 3 (state %)', v_sab_state; end if;
  insert into ccc_result values ('sabotage S-3: the finaliser-only close leaves the task ' || coalesce(v_sab_state, 'n/a') || ' (3 flips)');

  -- S-5: the guard dropped -> the staff member's direct write lands
  begin
    drop trigger "00000_guard_clinician" on public.video_consultations;
    v_sab_r := pg_temp.as_user(v_admin, format('update public.video_consultations set clinician_id = %L where id = %L returning id::text', v_doc, v_vc3));
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-5 failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_r like '42501:%' then raise exception 'SABOTAGE S-5 did not flip check 5: %', v_sab_r; end if;
  insert into ccc_result values ('sabotage S-5: without the guard a staff member sets clinician_id directly (5 flips)');

  -- S-R1: the unchecked booking copy (and resolver) -> the non-clinician profile lands on the consultation
  begin
    create or replace function private.video_consultation_booking_clinician_ok(p_clinician uuid, p_org uuid, p_type text) returns boolean
    language sql stable security definer set search_path to '' as $sab$ select p_clinician is not null $sab$;
    v_vc := pg_temp.book(v_org, v_pat2, v_admin);
    select clinician_id into v_sab_clin from public.video_consultations where id = v_vc;
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-R1 failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_clin is distinct from v_admin then raise exception 'SABOTAGE S-R1 did not flip check R1'; end if;
  insert into ccc_result values ('sabotage S-R1: without the booking check a non-clinician profile becomes the call''s clinician (R1 flips)');

  -- S-R2: without the closed-without-note trigger the hand close leaves no trace on the incident
  v_sab_inc := null;
  begin
    drop trigger clinical_tasks_consultation_note_closed_without_note on public.clinical_tasks;
    v_vc := pg_temp.book_and_complete(v_org, v_pat2, null);
    select id into v_task from public.clinical_tasks where dedup_key = 'consult_note:' || v_vc;
    select * into tk from public.clinical_tasks where id = v_task;
    if tk.state = 'offered_to_lead' then
      perform private.apply_task_transition(v_task, 'open', 'system', null, 'fixture: back to the pool');
    end if;
    insert into public.task_claims (organisation_id, task_id, clinician_id, expires_at, is_test)
    values (v_org, v_task, v_doc2, now() + interval '30 minutes', true);
    perform private.apply_task_transition(v_task, 'claimed', 'clinician', v_doc2, 'fixture claim', v_doc2, now() + interval '30 minutes');
    v_sab_r := pg_temp.as_user(v_doc2, format('select public.queue_complete(%L, %L::jsonb)::text', v_task,
                 jsonb_build_object('code', 'completed_no_action_needed', 'note', 'Patient did not join the call')::text));
    v_sab_inc := exists (select 1 from public.ops_incidents where external_reference = 'consultation_completion:' || v_vc
                          and summary like '%was completed with no signed note%');
    raise exception 'sabotage_rollback';
  exception when others then
    if sqlerrm <> 'sabotage_rollback' then raise exception 'sabotage S-R2 failed unexpectedly: %', sqlerrm; end if;
  end;
  if v_sab_r not in ('ok', '') or coalesce(v_sab_inc, true) then raise exception 'SABOTAGE S-R2 did not flip check R2 (%)', v_sab_r; end if;
  insert into ccc_result values ('sabotage S-R2: without the trigger a task closed with no signed note leaves the incident unchanged (R2 flips)');

  -- every sabotage really was rolled back
  if not exists (select 1 from pg_trigger where tgname = 'appointments_video_consultation_clinician')
     or not exists (select 1 from pg_trigger where tgname = '00000_guard_clinician')
     or private.video_consultation_needs_doctor_note(v_vcd)
     or exists (select 1 from pg_trigger where tgname = 'ccc_refuse_incident')
     or not exists (select 1 from pg_trigger where tgname = 'clinical_tasks_consultation_note_closed_without_note')
     or private.video_consultation_booking_clinician_ok(v_admin, v_org, 'telemedicine') then
    raise exception 'a sabotage was not rolled back';
  end if;

  insert into ccc_result values ('consultation_completion_chain: all checks passed');
end
$proof$;

select msg from ccc_result;

rollback;

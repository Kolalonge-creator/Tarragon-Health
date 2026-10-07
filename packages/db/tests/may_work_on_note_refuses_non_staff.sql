-- ===========================================================================
-- Proof: private.may_work_on_note must refuse a signed-in user with NO clinical_staff row.
-- Bug (found 2026-10-06 proving S35c): my_clinical_staff_id() is NULL for a non-staff user, so `v_author = NULL` is NULL,
--   `NULL or false` is NULL, `not NULL` is NULL and the IF was skipped: the guard returned the patient id instead of raising 42501.
-- Fix: coalesce(v_author = private.my_clinical_staff_id(), false).
--   1. The guard itself, called directly (owner, jwt claims set), refuses a patient and an unrelated non-staff user with 42501
--      'not authorised for this note', on a draft and on a finalized note.
--   2. Each of the eight public callers (update_encounter_note_draft, finalize_encounter_note, attach_scribe_draft_to_note,
--      create_note_amendment, mark_note_entered_in_error, set_note_protected, decide_note_release, respond_note_correction)
--      refuses that user with the GUARD's own 42501 message, not a later check, and changes nothing.
--   3. A legitimate author who is no longer tied, a tied clinician who is not the author, and a real caller path for each, are NOT
--      refused; an untied non-author clinician still is.
--   4. SABOTAGE: the old body is put back inside the transaction; the guard must then let the patient through (proves 1 can fail).
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $f$;

-- runs p_sql as p_uid with role authenticated; returns 'ok' or '<sqlstate>|<message>'
create function pg_temp.run_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$
declare v_state text; v_msg text;
begin
  perform pg_temp.act_as(p_uid);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    execute 'reset role';
    return v_state || '|' || v_msg;
  end;
end $f$;

-- runs the guard directly (it is not executable by authenticated, so as the owner with the caller's claims)
create function pg_temp.guard_as(p_uid uuid, p_note uuid) returns text language plpgsql as
$f$
declare v_state text; v_msg text; v_ret uuid;
begin
  perform pg_temp.act_as(p_uid);
  begin
    v_ret := private.may_work_on_note(p_note);
    return 'ok:' || v_ret;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    return v_state || '|' || v_msg;
  end;
end $f$;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_nonstaff uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid();      -- author, tied at first
  v_b uuid := gen_random_uuid();      -- tied later, not the author
  v_c uuid := gen_random_uuid();      -- never tied, not the author
  v_draft uuid; v_draft2 uuid; v_final uuid; v_req uuid; v_consent uuid;
  v_deny constant text := '42501|not authorised for this note';
  v_notes_before int;
  u uuid;
  v_who text;
  v_out text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,      'mwn-pat@example.invalid',      'x', now(), '{}', '{}'),
    (v_nonstaff, 'mwn-nonstaff@example.invalid', 'x', now(), '{}', '{}'),
    (v_a,        'mwn-a@example.invalid',        'x', now(), '{}', '{}'),
    (v_b,        'mwn-b@example.invalid',        'x', now(), '{}', '{}'),
    (v_c,        'mwn-c@example.invalid',        'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, is_test) values
    (v_pat,      v_org, 'patient',   'MWN Patient',  '+2348066660001', true),
    (v_nonstaff, v_org, 'patient',   'MWN Nonstaff', '+2348066660002', true),
    (v_a,        v_org, 'clinician', 'MWN Doctor A', '+2348066660003', true),
    (v_b,        v_org, 'clinician', 'MWN Doctor B', '+2348066660004', true),
    (v_c,        v_org, 'clinician', 'MWN Doctor C', '+2348066660005', true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name, is_test = true;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_a, 'MWN Doctor A', true, now(), 'senior_medical_officer'),
    (v_org, v_b, 'MWN Doctor B', true, now(), 'senior_medical_officer'),
    (v_org, v_c, 'MWN Doctor C', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_a, now()) on conflict (patient_id) do update set clinician_id = v_a;

  -- precondition for the whole bug: the non-staff users really have no clinical_staff row
  perform pg_temp.act_as(v_nonstaff);
  if private.my_clinical_staff_id() is not null then raise exception 'fixture FAIL: non-staff user has a staff id'; end if;
  perform pg_temp.act_as(v_pat);
  if private.my_clinical_staff_id() is not null then raise exception 'fixture FAIL: patient has a staff id'; end if;

  -- doctor A (tied, author) makes two drafts; one is finalized
  perform pg_temp.act_as(v_a);
  execute 'set local role authenticated';
  select public.create_encounter_note(v_pat, 'phone', 'MWN draft') into v_draft;
  select public.create_encounter_note(v_pat, 'phone', 'MWN draft two') into v_draft2;
  select public.create_encounter_note(v_pat, 'phone', 'MWN final') into v_final;
  perform public.finalize_encounter_note(v_final, (enum_range(null::public.consultation_outcome))[1], true);
  execute 'reset role';

  -- an open correction request on the finalized note (the table is closed to direct writes by clients; owner inserts the fixture)
  insert into public.note_correction_requests (organisation_id, note_id, patient_id, request_text, due_at, is_test)
  values (v_org, v_final, v_pat, 'MWN please fix the date in this note', now() + interval '7 days', true) returning id into v_req;

  -- a consent row for attach_scribe_draft_to_note (refusal must come from the guard before the consent is even read)
  v_consent := gen_random_uuid();

  select count(*) into v_notes_before from public.clinical_encounter_notes where patient_id = v_pat;

  -- ===== 1. the guard directly: a patient and a non-staff user are refused, on a draft and a finalized note =====
  foreach u in array array[v_pat, v_nonstaff] loop
    v_who := case when u = v_pat then 'patient' else 'non-staff user' end;
    v_out := pg_temp.guard_as(u, v_draft);
    if v_out <> v_deny then raise exception 'FAIL 1a: guard on a draft for % returned %, expected %', v_who, v_out, v_deny; end if;
    v_out := pg_temp.guard_as(u, v_final);
    if v_out <> v_deny then raise exception 'FAIL 1b: guard on a finalized note for % returned %, expected %', v_who, v_out, v_deny; end if;
  end loop;

  -- ===== 2. every public caller, as the patient and as the non-staff user =====
  foreach u in array array[v_pat, v_nonstaff] loop
    v_who := case when u = v_pat then 'patient' else 'non-staff user' end;
    v_out := pg_temp.run_as(u, format('select public.update_encounter_note_draft(%L, %L::jsonb)', v_draft, '{"plan":"x"}'));
    if v_out <> v_deny then raise exception 'FAIL 2a: update_encounter_note_draft as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.finalize_encounter_note(%L, %L, true)', v_draft, (enum_range(null::public.consultation_outcome))[1]));
    if v_out <> v_deny then raise exception 'FAIL 2b: finalize_encounter_note as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.attach_scribe_draft_to_note(%L, %L, %L, %L)', v_draft, v_consent, 'x', 'en-NG'));
    if v_out <> v_deny then raise exception 'FAIL 2c: attach_scribe_draft_to_note as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.create_note_amendment(%L, %L, %L)', v_final, 'addendum', 'a long enough reason here'));
    if v_out <> v_deny then raise exception 'FAIL 2d: create_note_amendment as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.mark_note_entered_in_error(%L, %L)', v_final, 'a long enough reason here'));
    if v_out <> v_deny then raise exception 'FAIL 2e: mark_note_entered_in_error as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.set_note_protected(%L, true)', v_draft));
    if v_out <> v_deny then raise exception 'FAIL 2f: set_note_protected as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.decide_note_release(%L, true, null)', v_final));
    if v_out <> v_deny then raise exception 'FAIL 2g: decide_note_release as % returned %', v_who, v_out; end if;
    v_out := pg_temp.run_as(u, format('select public.respond_note_correction(%L, %L, %L)', v_req, 'declined', 'a long enough response'));
    if v_out <> v_deny then raise exception 'FAIL 2h: respond_note_correction as % returned %', v_who, v_out; end if;
  end loop;

  -- nothing changed
  if (select count(*) from public.clinical_encounter_notes where patient_id = v_pat) <> v_notes_before then
    raise exception 'FAIL 2i: a refused caller still created a note';
  end if;
  if exists (select 1 from public.clinical_encounter_notes where id = v_draft and (is_protected or plan is not distinct from 'x')) then
    raise exception 'FAIL 2j: a refused caller still changed the draft';
  end if;
  if exists (select 1 from public.note_error_flags where note_id = v_final)
     or exists (select 1 from public.note_releases where note_id = v_final)
     or (select state from public.note_correction_requests where id = v_req) <> 'open' then
    raise exception 'FAIL 2k: a refused caller still changed the finalized note or its correction request';
  end if;

  -- ===== 3. legitimate paths are not refused =====
  -- 3a author A (still tied here)
  v_out := pg_temp.guard_as(v_a, v_draft);
  if v_out <> 'ok:' || v_pat then raise exception 'FAIL 3a: the author was refused (%)', v_out; end if;
  -- move the tie to B: A is now the author but untied, B is tied but not the author
  update public.care_team_assignment set clinician_id = v_b where patient_id = v_pat;
  v_out := pg_temp.guard_as(v_a, v_draft);
  if v_out <> 'ok:' || v_pat then raise exception 'FAIL 3b: the author, no longer tied, was refused (%)', v_out; end if;
  v_out := pg_temp.guard_as(v_b, v_draft);
  if v_out <> 'ok:' || v_pat then raise exception 'FAIL 3c: a tied non-author clinician was refused (%)', v_out; end if;
  v_out := pg_temp.guard_as(v_c, v_draft);
  if v_out <> v_deny then raise exception 'FAIL 3d: an untied non-author clinician was let through (%)', v_out; end if;
  -- 3d2 a note with no recorded author (auto-drafted notes): an untied clinician is refused, a tied one is not
  update public.clinical_encounter_notes set authored_by_staff = null where id = v_draft2;
  v_out := pg_temp.guard_as(v_c, v_draft2);
  if v_out <> v_deny then raise exception 'FAIL 3d2: an untied clinician was let through on a note with no author (%)', v_out; end if;
  v_out := pg_temp.guard_as(v_b, v_draft2);
  if v_out <> 'ok:' || v_pat then raise exception 'FAIL 3d3: a tied clinician was refused on a note with no author (%)', v_out; end if;
  -- real callers
  v_out := pg_temp.run_as(v_a, format('select public.update_encounter_note_draft(%L, %L::jsonb)', v_draft, '{"plan":"author edit"}'));
  if v_out <> 'ok' then raise exception 'FAIL 3e: the author could not edit their draft (%)', v_out; end if;
  v_out := pg_temp.run_as(v_b, format('select public.set_note_protected(%L, true)', v_draft));
  if v_out <> 'ok' then raise exception 'FAIL 3f: a tied clinician could not mark a draft protected (%)', v_out; end if;
  v_out := pg_temp.run_as(v_a, format('select public.create_note_amendment(%L, %L, %L)', v_final, 'addendum', 'a long enough reason here'));
  if v_out <> 'ok' then raise exception 'FAIL 3g: the author could not amend their signed note (%)', v_out; end if;

  -- ===== 4. SABOTAGE: the old body back in place; the patient must now get through (so check 1 can fail) =====
  execute $s$
    create or replace function private.may_work_on_note(p_note uuid) returns uuid
    language plpgsql stable security definer set search_path to '' as $b$
    declare v_patient uuid; v_author uuid;
    begin
      select patient_id, authored_by_staff into v_patient, v_author from public.clinical_encounter_notes where id = p_note;
      if v_patient is null then raise exception 'note not found' using errcode = 'P0002'; end if;
      if (select auth.uid()) is null
         or not (v_author = private.my_clinical_staff_id() or private.can_staff_read_clinical(v_patient, 'appointments_care_plan')) then
        raise exception 'not authorised for this note' using errcode = '42501';
      end if;
      return v_patient;
    end; $b$ $s$;
  v_out := pg_temp.guard_as(v_pat, v_draft);
  if v_out <> 'ok:' || v_pat then
    raise exception 'FAIL 4: sabotage (old NULL-prone body) was not detected: patient got % instead of getting through', v_out;
  end if;
end $$;

rollback;

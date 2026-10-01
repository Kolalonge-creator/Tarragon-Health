-- ===========================================================================
-- Proof: *_s05d_encounter_notes_audited_reads_and_writes.sql (S05d; INV-10, INV-11, INV-12).
--
-- Proves, with simulated sessions (patient, other patient, tied doctor, untied doctor, authoring-but-untied doctor, admin):
--   1. Writes go through the functions: the tied doctor creates a draft, edits it, finalizes it (identity + outcome still required by the
--      database); an untied doctor cannot create a note and cannot edit or finalize someone else's draft; every direct INSERT, UPDATE and
--      SELECT on the table is refused for staff and for patients.
--   2. Reads: the tied doctor gets status ok with all notes and an audit row with basis `tied`; an untied non-author gets `denied`
--      (and the refusal is audited), never an empty ok; a doctor whose assignment ended but who authored a note gets `own_only` with
--      only her notes (basis `author`); a patient caller raises and writes nothing; short reasons raise; anon cannot execute.
--   3. The "notes to complete" worklist returns the caller's own auto-drafted notes and nobody else's.
--   4. Finalized notes stay immutable and the amendment validator still sees the original after the table closed.
--   5. SABOTAGE: restoring the old org-staff read policy lets the untied doctor read directly; stubbing the create gate to true lets an
--      untied doctor create a note, so checks 1 and 2 can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_author uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_staff_tied uuid;
  v_staff_author uuid;
  v_note uuid;
  v_note2 uuid;
  v_auto uuid;
  v_json jsonb;
  v_n integer;
  v_failed boolean;
  v_sqlstate text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05d-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05d-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05d-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied,'s05d-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_author, 's05d-author@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,  's05d-admin@example.invalid',  'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',   'S05d Patient One', '+2348054440001'),
    (v_pat2,   v_org, 'patient',   'S05d Patient Two', '+2348054440002'),
    (v_tied,   v_org, 'clinician', 'S05d Tied Doctor', '+2348054440003'),
    (v_untied, v_org, 'clinician', 'S05d Untied Doctor','+2348054440004'),
    (v_author, v_org, 'clinician', 'S05d Author Doctor','+2348054440005'),
    (v_admin,  v_org, 'admin',     'S05d Admin',       '+2348054440006')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'S05d Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S05d Untied Doctor', true, now(), 'medical_officer'),
    (v_org, v_author, 'S05d Author Doctor', true, now(), 'medical_officer');
  select id into v_staff_tied from public.clinical_staff where profile_id = v_tied;
  select id into v_staff_author from public.clinical_staff where profile_id = v_author;
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  -- ===== 1. writes =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.create_encounter_note(v_pat, 'phone', 'S05d review', p_history => 'cough 3 days') into v_note;
  perform public.update_encounter_note_draft(v_note, jsonb_build_object('assessment', 'viral', 'history', null));
  execute 'reset role';
  if not exists (select 1 from public.clinical_encounter_notes
                  where id = v_note and status = 'draft' and authored_by_staff = v_staff_tied and assessment = 'viral' and history is null) then
    raise exception 'FAIL 1a: create / partial update did not land as expected';
  end if;

  -- the database still refuses to finalize without identity confirmation and an outcome
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.finalize_encounter_note(v_note, (enum_range(null::public.consultation_outcome))[1], false);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 1b: a note was finalized without identity confirmation'; end if;
  perform public.finalize_encounter_note(v_note, (enum_range(null::public.consultation_outcome))[1], true);
  execute 'reset role';
  if not exists (select 1 from public.clinical_encounter_notes where id = v_note and status = 'finalized' and finalized_by_staff = v_staff_tied) then
    raise exception 'FAIL 1c: the tied doctor could not finalize (the gate does not open)';
  end if;
  -- finalized stays immutable
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.update_encounter_note_draft(v_note, jsonb_build_object('plan', 'changed'));
  exception when others then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 1d: a finalized note was edited'; end if;

  -- an untied doctor cannot create a note about her, nor touch a draft she did not write
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.create_encounter_note(v_pat, 'phone', 'S05d untied attempt');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 1e: an untied doctor created a note (sqlstate=%)', v_sqlstate; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.create_encounter_note(v_pat, 'phone', 'S05d second note') into v_note2;
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.update_encounter_note_draft(v_note2, jsonb_build_object('plan', 'x'));
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 1f: an untied doctor edited another doctor''s draft'; end if;
  v_failed := false;
  begin perform public.finalize_encounter_note(v_note2, (enum_range(null::public.consultation_outcome))[1], true);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 1f: an untied doctor finalized another doctor''s draft'; end if;
  execute 'reset role';

  -- the table is closed to direct use: staff and patients, select / insert / update
  for v_n in 1..4 loop
    perform set_config('request.jwt.claims', json_build_object('sub',
      (array[v_tied, v_untied, v_admin, v_pat])[v_n], 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    if (select count(*) from public.clinical_encounter_notes) <> 0 then
      raise exception 'FAIL 1g: session % read notes directly', v_n;
    end if;
    update public.clinical_encounter_notes set plan = 'direct edit' where id = v_note2;
    get diagnostics v_sqlstate = row_count;
    if v_sqlstate::int <> 0 then raise exception 'FAIL 1g: session % edited a note directly', v_n; end if;
    v_failed := false;
    begin
      insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter)
      values (v_org, v_pat, 'phone', 'S05d direct insert');
    exception when others then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 1g: session % inserted a note directly', v_n; end if;
  end loop;

  -- ===== 2. reads =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_encounter_notes_audited(v_pat, 'S05d proof: tied doctor review') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'notes') <> 2 then
    raise exception 'FAIL 2a: the tied doctor did not get both notes: %', v_json;
  end if;
  if not exists (select 1 from public.audit_log where action = 'staff.chart_read' and actor_id = v_tied and result = 'success'
                    and event -> 'sections' @> '"notes"'::jsonb and event ->> 'basis' = 'tied') then
    raise exception 'FAIL 2a: the tied read was not audited with basis tied';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_encounter_notes_audited(v_pat, 'S05d proof: untied attempt') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'denied' or jsonb_array_length(v_json -> 'notes') <> 0 then
    raise exception 'FAIL 2b: an untied non-author was not denied: %', v_json;
  end if;
  if not exists (select 1 from public.audit_log where action = 'staff.chart_read' and actor_id = v_untied and result = 'denied') then
    raise exception 'FAIL 2b: the refusal was not audited';
  end if;

  -- a doctor whose assignment ended but who wrote a note: own_only, with only hers
  perform set_config('app.trusted_clinical_staff_author', v_staff_author::text, true);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter)
  values (v_org, v_pat, 'phone', 'S05d author note') returning id into v_auto;
  perform set_config('app.trusted_clinical_staff_author', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_author, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_encounter_notes_audited(v_pat, 'S05d proof: author finishing her note') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'own_only' or jsonb_array_length(v_json -> 'notes') <> 1 or (v_json -> 'notes' -> 0 ->> 'id')::uuid <> v_auto then
    raise exception 'FAIL 2c: the untied author did not get exactly her own note: %', v_json;
  end if;
  if not exists (select 1 from public.audit_log where action = 'staff.chart_read' and actor_id = v_author and event ->> 'basis' = 'author') then
    raise exception 'FAIL 2c: the author read was not audited with basis author';
  end if;

  -- a patient caller raises and writes nothing; short reason raises; anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_encounter_notes_audited(v_pat, 'S05d proof: patient attempt');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' then raise exception 'FAIL 2d: a patient caller was not refused'; end if;
  if exists (select 1 from public.audit_log where actor_id = v_pat2 and action = 'staff.chart_read') then
    raise exception 'FAIL 2d: a patient caller left a chart_read audit row';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin perform public.read_patient_encounter_notes_audited(v_pat, 'short');
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '22023' then raise exception 'FAIL 2e: a short reason was accepted'; end if;
  if has_function_privilege('anon', 'public.read_patient_encounter_notes_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_encounter_note(uuid,text,text,text,text,text,text,text,text,uuid,uuid,uuid,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'FAIL 2f: anon can execute a note function';
  end if;

  -- ===== 3. the worklist: the caller's own auto-drafted notes only =====
  perform set_config('app.trusted_clinical_staff_author', v_staff_author::text, true);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter)
  values (v_org, v_pat2, 'phone', 'S05d auto draft');
  perform set_config('app.trusted_clinical_staff_author', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_author, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.my_pending_auto_drafted_notes();
  execute 'reset role';
  if v_n <> 2 then raise exception 'FAIL 3a: the author sees % pending auto-drafts, expected 2', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.my_pending_auto_drafted_notes();
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 3b: another doctor sees % of someone else''s auto-drafts', v_n; end if;

  -- ===== 4. the amendment validator still sees the original after the table closed =====
  insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, amends_note_id)
  values (v_org, v_pat, 'phone', 'S05d amendment', v_note);   -- as the table owner, but the validator is SECURITY DEFINER either way
  v_failed := false;
  begin
    insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, amends_note_id)
    values (v_org, v_pat2, 'phone', 'S05d cross-patient amendment', v_note);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 4a: a cross-patient amendment was accepted'; end if;

  -- ===== 5. SABOTAGE =====
  create policy s05d_sabotage_old_read on public.clinical_encounter_notes for select to authenticated using (private.is_org_staff(organisation_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.clinical_encounter_notes;
  execute 'reset role';
  drop policy s05d_sabotage_old_read on public.clinical_encounter_notes;
  if v_n = 0 then raise exception 'FAIL SABOTAGE 5a: the old policy did not expose the notes, so check 1g proves nothing'; end if;

  create or replace function private.may_work_on_note(p_note uuid) returns uuid language sql stable security definer set search_path = ''
    as 'select patient_id from public.clinical_encounter_notes where id = p_note';
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.update_encounter_note_draft(v_note2, jsonb_build_object('plan', 'sabotaged'));
  execute 'reset role';
  if not exists (select 1 from public.clinical_encounter_notes where id = v_note2 and plan = 'sabotaged') then
    raise exception 'FAIL SABOTAGE 5b: with the gate stubbed the untied edit still failed, so check 1f proves nothing';
  end if;

  raise notice 'S05d proof: all checks and 2 sabotages passed';
end $$;

rollback;

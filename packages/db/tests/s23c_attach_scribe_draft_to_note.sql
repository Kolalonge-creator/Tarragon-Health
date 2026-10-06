-- ===========================================================================
-- Proof: S23c public.attach_scribe_draft_to_note (INV-11, safety case 14).
--   1. The tied doctor attaches a granted consent to their own draft note: scribe_consent_id, patient_summary, language and
--      ai_drafted are set, and the note is still a draft.
--   2. Refused (42501): an untied doctor, a revoked consent, a consent recorded for another note, a consent that was declined.
--   3. After the existing finalize path (identity + outcome), attaching again is refused: a finalized note is permanent.
--   4. anon cannot execute it.
--   5. SABOTAGE: dropping the revoked-consent condition would let check 2b pass silently; the proof asserts the refusal.
-- BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_note uuid;
  v_note2 uuid;
  v_ok uuid;
  v_revoked uuid;
  v_other uuid;
  v_declined uuid;
  v_failed boolean;
  v_state text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's23c-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_tied,   's23c-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's23c-untied@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org, 'patient',   'S23c Patient',        '+2348055550001'),
    (v_tied,   v_org, 'clinician', 'S23c Tied Doctor',    '+2348055550002'),
    (v_untied, v_org, 'clinician', 'S23c Untied Doctor',  '+2348055550003')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_tied,   'S23c Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'S23c Untied Doctor', true, now(), 'medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  -- the tied doctor creates two draft notes and records consents the way the app does
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.create_encounter_note(v_pat, 'phone', 'S23c review') into v_note;
  select public.create_encounter_note(v_pat, 'phone', 'S23c second') into v_note2;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_note, true, 'en-NG') returning id into v_ok;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_note, true, 'pcm') returning id into v_revoked;
  update public.scribe_consents set revoked_at = now() where id = v_revoked;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_note2, true, 'en-NG') returning id into v_other;
  insert into public.scribe_consents (patient_id, encounter_note_id, granted, language) values (v_pat, v_note, false, 'en-NG') returning id into v_declined;
  execute 'reset role';

  -- ===== 2. refusals first, so the note is untouched =====
  -- 2a untied doctor
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.attach_scribe_draft_to_note(v_note, v_ok, 'x', 'en-NG');
  exception when others then get stacked diagnostics v_state = returned_sqlstate; v_failed := true; end;
  execute 'reset role';
  if not v_failed or v_state <> '42501' then raise exception 'FAIL 2a: an untied doctor could attach (failed=%, state=%)', v_failed, v_state; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- 2b revoked, 2c other note, 2d declined
  v_failed := false;
  begin perform public.attach_scribe_draft_to_note(v_note, v_revoked, 'x', 'pcm');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2b: a revoked consent was accepted'; end if;
  v_failed := false;
  begin perform public.attach_scribe_draft_to_note(v_note, v_other, 'x', 'en-NG');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2c: a consent for another note was accepted'; end if;
  v_failed := false;
  begin perform public.attach_scribe_draft_to_note(v_note, v_declined, 'x', 'en-NG');
  exception when insufficient_privilege then v_failed := true; end;
  if not v_failed then raise exception 'FAIL 2d: a declined consent was accepted'; end if;
  execute 'reset role';
  if exists (select 1 from public.clinical_encounter_notes where id = v_note and (scribe_consent_id is not null or ai_drafted)) then
    raise exception 'FAIL 2e: a refused attach still changed the note';
  end if;

  -- ===== 1. the happy path =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.attach_scribe_draft_to_note(v_note, v_ok, '  Rest and drink water.  ', 'en-NG');
  execute 'reset role';
  if not exists (select 1 from public.clinical_encounter_notes
                  where id = v_note and status = 'draft' and scribe_consent_id = v_ok and ai_drafted
                    and patient_summary = 'Rest and drink water.' and patient_summary_language = 'en-NG') then
    raise exception 'FAIL 1: attach did not land as expected';
  end if;

  -- ===== 3. finalize with the existing path, then attaching is refused =====
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.finalize_encounter_note(v_note, 'reassurance', true);
  v_failed := false;
  begin perform public.attach_scribe_draft_to_note(v_note, v_ok, 'changed', 'en-NG');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 3: attach edited a finalized note'; end if;
  if (select patient_summary from public.clinical_encounter_notes where id = v_note) <> 'Rest and drink water.' then
    raise exception 'FAIL 3b: finalized summary changed';
  end if;

  -- ===== 4. anon =====
  if has_function_privilege('anon', 'public.attach_scribe_draft_to_note(uuid, uuid, text, text)', 'EXECUTE') then
    raise exception 'FAIL 4: anon can execute attach_scribe_draft_to_note';
  end if;

  raise notice 'S23c attach_scribe_draft_to_note: all checks PASSED';
end $$;

rollback;

-- S53 proof (migration 20261007003937_s53_medicine_catalogue_interactions_side_effects_supporter_notice.sql).
-- Rolled back; nothing is committed. Each role is tested, a role that must be refused is shown refused, and the sabotage step at
-- the end removes the supporter-notice trigger and requires the positive supporter case to FAIL (so the test discriminates).
--
--  A. Catalogue: patient reads active rows, cannot write; admin can; anon refused; no row carries a NAFDAC number or is verified;
--     a row cannot be marked verified without a number.
--  B. Dataset: v1 is a draft with no signer and hashes to its recorded hash; a patient and a clinician cannot read the draft or sign it;
--     the CMO is refused on a wrong hash and on an unrelated note; the CMO signs on the right hash (inside this rolled-back
--     transaction only); an approved version is frozen; direct approval by update is refused; the guard stays off.
--  C. Side-effect notes: patient writes own (identity and org come from the medicine, not the client); a stranger cannot read or write;
--     a clinician cannot read the table directly; a tied clinician reads through the audited RPC (one audit row), an untied one is denied
--     (and the denial is audited); a note cannot be edited by the patient; anon refused.
--  D. Supporter notice: a grantee holding clinical_access + view_medication + receive_alerts gets ONE neutral in-app notice per day;
--     one without receive_alerts, one with no permission list, an expired one and a stranger get none; the notice names no medicine;
--     a failure to notify never blocks the dose log.
--  E. Sabotage: drop the notice trigger; the positive supporter case must now see zero notices.
begin;

create temp table results (phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.mk(p_org uuid, p_label text, p_role text default 'patient') returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's53-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S53 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_other uuid; v_clin uuid; v_clin2 uuid; v_cmo uuid;
  v_sup uuid; v_sup_noalert uuid; v_sup_null uuid; v_sup_exp uuid; v_stranger uuid;
  v_med uuid; v_note uuid; v_n integer; v_hash text; v_err text; v_rows integer; v_cat uuid;
  v_audit_before integer; v_log uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mk(v_org, 'admin', 'admin');
  v_pat := pg_temp.mk(v_org, 'patient');
  v_other := pg_temp.mk(v_org, 'other');
  v_clin := pg_temp.mk(v_org, 'clin', 'clinician');
  v_clin2 := pg_temp.mk(v_org, 'clin2', 'clinician');
  v_cmo := pg_temp.mk(v_org, 'cmo', 'clinician');
  v_sup := pg_temp.mk(v_org, 'sup'); v_sup_noalert := pg_temp.mk(v_org, 'supna'); v_sup_null := pg_temp.mk(v_org, 'supnull');
  v_sup_exp := pg_temp.mk(v_org, 'supexp'); v_stranger := pg_temp.mk(v_org, 'stranger');

  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_cmo, 'S53 cmo', 'MDCN', 'S53-cmo-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
      'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, v_pat, v_clin);

  -- ===== W. The guard wiring that this migration patched into two shared functions must still be there ==============
  insert into results values ('W', 'go_live_conditions still has the interaction_check_enabled conditions', '2',
    (select jsonb_array_length(private.go_live_conditions('interaction_check_enabled', v_org))::text));
  perform pg_temp.as_user(v_admin);
  begin
    perform public.attest_go_live_condition('interaction_check_enabled', 'pharmacist_review_recorded', true, 'Proof run inside a rolled-back test transaction');
    v_err := 'attested';
  exception when others then v_err := 'refused: ' || sqlerrm; end;
  reset role;
  insert into results values ('W', 'attest_go_live_condition still accepts pharmacist_review_recorded', 'attested', v_err);

  -- ===== A. Catalogue ==========================================================
  perform pg_temp.as_user(v_pat);
  select count(*) into v_n from public.medicine_catalogue where is_active;
  insert into results values ('A', 'a patient reads the active catalogue', 'true', (v_n >= 60)::text);
  begin
    insert into public.medicine_catalogue (generic_name, source) values ('Patientwritten', 'x');
    v_err := 'inserted';
  exception when insufficient_privilege or others then v_err := 'refused'; end;
  insert into results values ('A', 'a patient cannot add a catalogue row', 'refused', v_err);
  reset role;
  perform pg_temp.as_user(v_admin);
  insert into public.medicine_catalogue (generic_name, source) values ('Adminadded', 'test') returning id into v_cat;
  reset role;
  insert into results values ('A', 'an admin can add a catalogue row', 'true', exists (select 1 from public.medicine_catalogue where id = v_cat)::text);
  begin
    update public.medicine_catalogue set is_verified = true where id = v_cat;
    v_err := 'verified without a number';
  exception when check_violation then v_err := 'refused'; end;
  insert into results values ('A', 'a row cannot be verified without a NAFDAC number', 'refused', v_err);
  set local role anon;
  begin
    perform 1 from public.medicine_catalogue limit 1;
    v_err := 'read';
  exception when insufficient_privilege then v_err := 'refused'; end;
  reset role;
  insert into results values ('A', 'anon cannot read the catalogue', 'refused', v_err);
  insert into results values ('A', 'no seeded row carries a NAFDAC number or is verified', '0',
    (select count(*)::text from public.medicine_catalogue where source like 'tarragon_curated%' and (nafdac_number is not null or is_verified)));
  insert into results values ('A', 'every seeded row is flagged for pharmacist review', 'true',
    (select bool_and(needs_pharmacist_review) from public.medicine_catalogue where source like 'tarragon_curated%')::text);

  -- ===== B. Dataset ============================================================
  v_hash := private.interaction_dataset_hash(1);
  insert into results values ('B', 'v1 is an unsigned draft', 'draft|', (select status || '|' || coalesce(signed_by::text, '') from public.interaction_dataset_versions where version = 1));
  insert into results values ('B', 'v1 hashes to its recorded hash', 'true', (v_hash = (select content_hash from public.interaction_dataset_versions where version = 1))::text);
  insert into results values ('B', 'the guard is off', 'false', (select is_on::text from public.go_live_guards where key = 'interaction_check_enabled'));
  perform pg_temp.as_user(v_pat);
  select count(*) into v_n from public.interaction_dataset_versions;
  select v_n + count(*) into v_n from public.interactions;
  reset role;
  insert into results values ('B', 'a patient cannot read the draft dataset', '0', v_n::text);
  perform pg_temp.as_user(v_clin);
  begin perform public.sign_interaction_dataset(1, v_hash, 'a note long enough to pass'); v_err := 'signed'; exception when insufficient_privilege then v_err := 'refused'; end;
  reset role;
  insert into results values ('B', 'an ordinary clinician cannot sign', 'refused', v_err);
  perform pg_temp.as_user(v_pat);
  begin perform public.sign_interaction_dataset(1, v_hash, 'a note long enough to pass'); v_err := 'signed'; exception when insufficient_privilege then v_err := 'refused'; end;
  reset role;
  insert into results values ('B', 'a patient cannot sign', 'refused', v_err);
  perform pg_temp.as_user(v_cmo);
  begin perform public.sign_interaction_dataset(1, repeat('0', 64), 'a note long enough to pass'); v_err := 'signed'; exception when others then v_err := 'refused'; end;
  insert into results values ('B', 'the CMO is refused on a wrong hash', 'refused', v_err);
  begin perform public.sign_interaction_dataset(1, v_hash, 'short'); v_err := 'signed'; exception when others then v_err := 'refused'; end;
  insert into results values ('B', 'the CMO is refused without a reviewed-by note', 'refused', v_err);
  reset role;
  perform pg_temp.as_user(v_admin);
  begin update public.interaction_dataset_versions set status = 'approved' where version = 1; v_err := 'approved'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('B', 'approval by a plain update is refused', 'refused', v_err);
  insert into results values ('B', 'still a draft after all the refused attempts', 'draft', (select status from public.interaction_dataset_versions where version = 1));
  -- tampering with a row changes the hash, so the shown hash no longer signs
  update public.interactions set severity = 'info' where dataset_version = 1 and rule_code = 'ace_inhibitor__arb';
  perform pg_temp.as_user(v_cmo);
  begin perform public.sign_interaction_dataset(1, v_hash, 'a note long enough to pass'); v_err := 'signed'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('B', 'a tampered row no longer matches the hash that was shown', 'refused', v_err);
  update public.interactions set severity = 'contraindicated' where dataset_version = 1 and rule_code = 'ace_inhibitor__arb';
  -- the CMO signs the unchanged dataset (this transaction is rolled back; nothing is signed for real)
  perform pg_temp.as_user(v_cmo);
  perform public.sign_interaction_dataset(1, v_hash, 'Proof run inside a rolled-back test transaction');
  reset role;
  insert into results values ('B', 'the CMO signs on the exact hash (rolled back)', 'approved', (select status from public.interaction_dataset_versions where version = 1));
  begin update public.interactions set severity = 'info' where dataset_version = 1 and rule_code = 'ace_inhibitor__arb'; v_err := 'edited'; exception when insufficient_privilege then v_err := 'refused'; end;
  insert into results values ('B', 'an approved dataset is frozen', 'refused', v_err);
  perform pg_temp.as_user(v_pat);
  select count(*) into v_n from public.interactions;
  reset role;
  insert into results values ('B', 'once approved a patient can read the rules', 'true', (v_n >= 50)::text);

  -- ===== C. Side-effect notes ==================================================
  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, schedule_times, source, is_active)
    values (v_org, v_pat, 'S53 Test Medicine', '1 tablet', 'daily', '["08:00"]', 'patient', true) returning id into v_med;
  perform pg_temp.as_user(v_pat);
  -- the client sends only the medicine and the words; identity, organisation and source are the database's
  insert into public.medication_side_effect_notes (medication_id, note)
    values (v_med, 'Felt dizzy after the tablet') returning id into v_note;
  reset role;
  insert into results values ('C', 'identity, org and source come from the medicine and the session, not the client', 'true',
    (select (patient_id = v_pat and recorded_by = v_pat and source = 'patient' and organisation_id = v_org)::text from public.medication_side_effect_notes where id = v_note));
  perform pg_temp.as_user(v_pat);
  begin update public.medication_side_effect_notes set note = 'changed' where id = v_note; get diagnostics v_rows = row_count; v_err := 'rows ' || v_rows; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'a patient cannot edit a note (no update grant)', 'refused', v_err);
  perform pg_temp.as_user(v_other);
  select count(*) into v_n from public.medication_side_effect_notes;
  begin
    insert into public.medication_side_effect_notes (medication_id, note) values (v_med, 'not mine');
    v_err := 'inserted';
  exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'a stranger reads no notes', '0', v_n::text);
  insert into results values ('C', 'a stranger cannot add a note to someone else''s medicine', 'refused', v_err);
  perform pg_temp.as_user(v_clin);
  select count(*) into v_n from public.medication_side_effect_notes;
  reset role;
  insert into results values ('C', 'a clinician cannot read the table directly', '0', v_n::text);
  select count(*) into v_audit_before from public.audit_log where entity_type = 'chart_read' or action ilike '%chart%';
  perform pg_temp.as_user(v_clin);
  select count(*) into v_n from public.care_team_side_effect_notes(v_pat, 'Preparing for the consultation tomorrow');
  reset role;
  insert into results values ('C', 'a tied clinician reads the note through the audited function', '1', v_n::text);
  insert into results values ('C', 'that read left an audit row', 'true',
    ((select count(*) from public.audit_log where entity_type = 'chart_read' or action ilike '%chart%') > v_audit_before)::text);
  perform pg_temp.as_user(v_clin2);
  select count(*) into v_n from public.care_team_side_effect_notes(v_pat, 'Trying to read without being on the team');
  reset role;
  insert into results values ('C', 'an untied clinician gets nothing', '0', v_n::text);
  perform pg_temp.as_user(v_clin);
  begin perform public.care_team_side_effect_notes(v_pat, 'short'); v_err := 'read'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'a read without a real reason is refused', 'refused', v_err);
  -- a second note arrives AFTER the clinician read the first; marking what was shown must not mark it
  perform pg_temp.as_user(v_pat);
  insert into public.medication_side_effect_notes (medication_id, note) values (v_med, 'A new note written after the read');
  reset role;
  perform pg_temp.as_user(v_clin);
  select public.mark_side_effect_notes_reviewed(v_pat, array[v_note], 'Reviewed at the consultation') into v_n;
  reset role;
  insert into results values ('C', 'the tied clinician can mark the notes they were shown reviewed', '1', v_n::text);
  insert into results values ('C', 'a note written after the read is NOT marked reviewed', '1',
    (select count(*)::text from public.medication_side_effect_notes where patient_id = v_pat and reviewed_at is null));
  perform pg_temp.as_user(v_clin2);
  begin perform public.mark_side_effect_notes_reviewed(v_pat, array[v_note], 'Untied clinician trying to mark'); v_err := 'marked'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'an untied clinician cannot mark notes reviewed', 'refused', v_err);
  perform pg_temp.as_user(v_other);
  begin perform public.mark_side_effect_notes_reviewed(v_pat, array[v_note], 'A stranger trying to mark'); v_err := 'marked'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'a stranger cannot mark notes reviewed', 'refused', v_err);
  insert into results values ('C', 'the note text is unchanged by review', 'Felt dizzy after the tablet', (select note from public.medication_side_effect_notes where id = v_note));
  -- a caregiver with only view_appointments (manage level, dependant) must not read or write medicine notes
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
    values (v_pat, v_stranger, 'manage', v_pat, false, array['view_appointments']::public.caregiver_permission[]);
  perform pg_temp.as_user(v_stranger);
  select count(*) into v_n from public.medication_side_effect_notes;
  begin insert into public.medication_side_effect_notes (medication_id, note) values (v_med, 'wrong permission'); v_err := 'inserted'; exception when others then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'a manage-level caregiver without view_medication reads no notes', '0', v_n::text);
  insert into results values ('C', 'a manage-level caregiver without view_medication cannot add a note', 'refused', v_err);
  update public.profile_access set permissions = array['view_appointments', 'view_medication']::public.caregiver_permission[] where grantee_user_id = v_stranger and profile_id = v_pat;
  perform pg_temp.as_user(v_stranger);
  select count(*) into v_n from public.medication_side_effect_notes;
  reset role;
  insert into results values ('C', 'the same caregiver WITH view_medication reads the notes', '2', v_n::text);
  delete from public.profile_access where grantee_user_id = v_stranger and profile_id = v_pat;

  set local role anon;
  begin perform 1 from public.medication_side_effect_notes limit 1; v_err := 'read'; exception when insufficient_privilege then v_err := 'refused'; end;
  reset role;
  insert into results values ('C', 'anon cannot read notes', 'refused', v_err);

  -- ===== D. Supporter notice ===================================================
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
    values (v_pat, v_sup, 'view', v_pat, true, array['view_medication', 'receive_alerts']::public.caregiver_permission[]);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
    values (v_pat, v_sup_noalert, 'view', v_pat, true, array['view_medication']::public.caregiver_permission[]);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
    values (v_pat, v_sup_null, 'view', v_pat, true, null);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions, expires_at)
    values (v_pat, v_sup_exp, 'view', v_pat, true, array['view_medication', 'receive_alerts']::public.caregiver_permission[], now() + interval '1 second');
  -- a new grant starts with clinical_access false; the patient turns it on as a separate act
  perform pg_temp.as_user(v_pat);
  update public.profile_access set clinical_access = true where profile_id = v_pat;
  reset role;
  update public.profile_access set expires_at = now() - interval '1 minute', created_at = now() - interval '1 day' where grantee_user_id = v_sup_exp and profile_id = v_pat;

  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_pat, v_med, 'missed', '08:00', current_date - 1, 'system', gen_random_uuid());
  insert into results values ('D', 'a supporter with view_medication and receive_alerts gets one notice', '1',
    (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice'));
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_pat, v_med, 'missed', '20:00', current_date - 1, 'system', gen_random_uuid());
  insert into results values ('D', 'a second missed dose the same day adds no second notice', '1',
    (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice'));
  insert into results values ('D', 'a supporter without receive_alerts gets none', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sup_noalert and template = 'supporter_missed_dose_notice'));
  insert into results values ('D', 'a grant with no permission list is not consent to this notice', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sup_null and template = 'supporter_missed_dose_notice'));
  insert into results values ('D', 'an expired grant gets none', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sup_exp and template = 'supporter_missed_dose_notice'));
  insert into results values ('D', 'a stranger gets none', '0',
    (select count(*)::text from public.notifications where recipient_id = v_stranger and template = 'supporter_missed_dose_notice'));
  insert into results values ('D', 'the payload and the wording name no medicine', 'true', (
    select (not (n.payload::text ~* 'S53 Test Medicine|drug|medicine_id|medication') and
            not (l.body ~* 'medic|drug|pill|tablet|dose|prescri|condition|result'))::text
      from public.notifications n join public.notification_template_locales l on l.template_key = n.template and l.locale = 'en' and l.channel = 'in_app'
     where n.recipient_id = v_sup and n.template = 'supporter_missed_dose_notice' limit 1));
  insert into results values ('D', 'the notice is in-app only', 'in_app',
    (select distinct channel::text from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice'));

  -- an old missed row synced late (a phone that was offline) must not page a supporter about last week
  delete from public.supporter_missed_dose_notices;
  delete from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice';
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_pat, v_med, 'missed', '07:00', current_date - 5, 'system', gen_random_uuid());
  insert into results values ('D', 'an old missed dose synced late sends no notice', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice'));

  -- a notice that fails never blocks the dose log: break the notifications template and log a dose
  delete from public.supporter_missed_dose_notices;
  alter table public.notifications add constraint s53_break_notice check (template <> 'supporter_missed_dose_notice') not valid;
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
      values (v_org, v_pat, v_med, 'missed', '08:00', current_date, 'system', gen_random_uuid());
    v_err := 'logged';
  exception when others then v_err := 'blocked'; end;
  alter table public.notifications drop constraint s53_break_notice;
  insert into results values ('D', 'a dose log is never blocked by the notice path (the notice insert is made to fail)', 'logged', v_err);

  -- ===== E. Sabotage: without the trigger the positive case sees nothing ========
  drop trigger medication_logs_notify_supporters on public.medication_logs;
  delete from public.supporter_missed_dose_notices;
  delete from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice';
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date, source, client_id)
    values (v_org, v_pat, v_med, 'missed', '09:00', current_date, 'system', gen_random_uuid());
  insert into results values ('E', 'SABOTAGE: with the trigger removed the supporter gets nothing (the positive case would FAIL)', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sup and template = 'supporter_missed_dose_notice'));
end $$;

do $$
declare v_bad text;
begin
  select string_agg(phase || ' ' || check_name || ' expected=' || expected || ' actual=' || coalesce(actual, 'null'), E'\n') into v_bad
    from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'HOLE OPEN:\n%', v_bad; end if;
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

rollback;

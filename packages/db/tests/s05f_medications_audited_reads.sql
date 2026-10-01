-- ===========================================================================
-- Proof: *_s05f_medications_audited_reads.sql (S05f piece C1; INV-10, INV-12).
--
-- Proves, with simulated sessions: the patient and a caregiver with the 'medications' grant read the medications through the audited
-- read exactly as the table policy allows (no audit row); a tied clinician reads them with one audit row (basis tied); an untied
-- clinician, an admin, a pharmacist and another organisation's clinician are DENIED (never an empty ok); the active / stopped / single
-- filters work; a patient caller reading another patient's medicines raises; a short reason raises; anon cannot execute. The embed read
-- returns the medication object for the patient, the caregiver and the tied clinician and omits it for an untied clinician, with one
-- summary audit row only for the staff basis. The merge counts are admin-only. SABOTAGE: the read without its tie check lets an untied clinician in.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_tied uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_cg uuid := gen_random_uuid();
  v_pa uuid;
  v_med1 uuid;
  v_med2 uuid;
  v_json jsonb;
  v_n integer;
  v_audits integer;
  v_failed boolean;
  v_who uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    's05fc-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_pat2,   's05fc-pat2@example.invalid',   'x', now(), '{}', '{}'),
    (v_tied,   's05fc-tied@example.invalid',   'x', now(), '{}', '{}'),
    (v_untied, 's05fc-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_admin,  's05fc-admin@example.invalid',  'x', now(), '{}', '{}'),
    (v_pharm,  's05fc-pharm@example.invalid',  'x', now(), '{}', '{}'),
    (v_other,  's05fc-other@example.invalid',  'x', now(), '{}', '{}'),
    (v_cg,     's05fc-cg@example.invalid',     'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05fC Patient One',  '+2348057770001'),
    (v_pat2,   v_org,  'patient',    'S05fC Patient Two',  '+2348057770002'),
    (v_tied,   v_org,  'clinician',  'S05fC Tied Doctor',  '+2348057770003'),
    (v_untied, v_org,  'clinician',  'S05fC Untied Doctor','+2348057770004'),
    (v_admin,  v_org,  'admin',      'S05fC Admin',        '+2348057770005'),
    (v_pharm,  v_org,  'pharmacist', 'S05fC Pharmacist',   '+2348057770006'),
    (v_other,  v_org2, 'clinician',  'S05fC Other Org Dr', '+2348057770007'),
    (v_cg,     v_org,  'patient',    'S05fC Caregiver',    '+2348057770008')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org,  v_tied,   'S05fC Tied Doctor',   true, now(), 'senior_medical_officer'),
    (v_org,  v_untied, 'S05fC Untied Doctor', true, now(), 'medical_officer'),
    (v_org2, v_other,  'S05fC Other Org Dr',  true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;

  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'medications');
  perform set_config('request.jwt.claims', null, true);

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency) values (v_org, v_pat, 'S05fC Amlodipine', '5mg', 'daily') returning id into v_med1;
  insert into public.medications (organisation_id, patient_id, drug_name, is_active, stopped_at) values (v_org, v_pat, 'S05fC Old drug', false, now()) returning id into v_med2;

  -- 1. patient: all, active only, stopped only, single; no audit row
  select count(*) into v_audits from public.audit_log where actor_id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_medications_audited(v_pat) into v_json;
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 2 then raise exception 'FAIL 1a: patient all: %', v_json; end if;
  if v_json -> 'rows' -> 0 ? 'search_vector' then raise exception 'FAIL 1a2: search_vector leaked into the rows'; end if;
  if not (v_json -> 'rows' -> 0 ? 'care_plan') or not (v_json -> 'rows' -> 0 ? 'added_by_profile') then
    raise exception 'FAIL 1a3: the rows lost the care_plan / added_by_profile keys the hooks select';
  end if;
  select public.read_patient_medications_audited(v_pat, null, true) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 1 or v_json -> 'rows' -> 0 ->> 'drug_name' <> 'S05fC Amlodipine' then raise exception 'FAIL 1b: patient active: %', v_json; end if;
  select public.read_patient_medications_audited(v_pat, null, false) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 1 or v_json -> 'rows' -> 0 ->> 'drug_name' <> 'S05fC Old drug' then raise exception 'FAIL 1c: patient stopped: %', v_json; end if;
  select public.read_patient_medications_audited(v_pat, null, null, v_med1) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 1 then raise exception 'FAIL 1d: patient single: %', v_json; end if;
  -- the patient asking for ANOTHER patient is refused (not an empty ok)
  v_failed := false;
  begin perform public.read_patient_medications_audited(v_pat2, 'S05fC proof: other patient');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 1e: a patient read another patient''s medicines'; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_pat;
  if v_n <> v_audits then raise exception 'FAIL 1f: the patient''s own read wrote % audit rows', v_n - v_audits; end if;

  -- 2. caregiver with the medications grant: rows, no audit
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_medications_audited(v_pat) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 2 then raise exception 'FAIL 2a: caregiver read: %', v_json; end if;

  -- 3. tied clinician: ok with one audit row, basis tied; the single filter works
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.chart_read';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_medications_audited(v_pat, 'S05fC proof: tied clinician review', true) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 1 then raise exception 'FAIL 3a: tied clinician: %', v_json; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_tied and action = 'staff.chart_read' and event ->> 'basis' = 'tied' and result = 'success';
  if v_n - v_audits <> 1 then raise exception 'FAIL 3b: expected one audited tied read, saw %', v_n - v_audits; end if;

  -- 4. untied clinician, admin, pharmacist, another organisation's clinician: denied, and the denial is audited
  foreach v_who in array array[v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.read_patient_medications_audited(v_pat, 'S05fC proof: untied attempt') into v_json;
    execute 'reset role';
    if v_json ->> 'status' <> 'denied' or jsonb_array_length(v_json -> 'rows') <> 0 then raise exception 'FAIL 4a: % was not denied: %', v_who, v_json; end if;
    if not exists (select 1 from public.audit_log where actor_id = v_who and action = 'staff.chart_read' and result = 'denied') then
      raise exception 'FAIL 4b: the refusal for % was not audited', v_who;
    end if;
  end loop;

  -- 5. short reason raises; anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.read_patient_medications_audited(v_pat, 'short');
  exception when invalid_parameter_value then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 5a: a short reason was accepted'; end if;
  if has_function_privilege('anon', 'public.read_patient_medications_audited(uuid,text,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_medication_embeds_audited(uuid[])', 'EXECUTE') then
    raise exception 'FAIL 5b: anon can execute a medication read';
  end if;

  -- 6. embeds: patient and caregiver and tied clinician get the object, untied clinician gets nothing for it; staff basis audits once
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_medication_embeds_audited(array[v_med1, v_med2]) into v_json;
  execute 'reset role';
  if (select count(*) from jsonb_object_keys(v_json)) <> 2 or v_json -> v_med1::text ->> 'drug_name' <> 'S05fC Amlodipine' or v_json -> v_med1::text ->> 'dose' <> '5mg' then
    raise exception 'FAIL 6a: patient embeds: %', v_json;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_medication_embeds_audited(array[v_med1]) into v_json;
  execute 'reset role';
  if v_json -> v_med1::text ->> 'drug_name' is null then raise exception 'FAIL 6b: caregiver embeds: %', v_json; end if;

  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.medication_embed_read';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_medication_embeds_audited(array[v_med1, v_med2]) into v_json;
  execute 'reset role';
  if (select count(*) from jsonb_object_keys(v_json)) <> 2 then raise exception 'FAIL 6c: tied clinician embeds: %', v_json; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_tied and action = 'staff.medication_embed_read';
  if v_n - v_audits <> 1 then raise exception 'FAIL 6d: expected one summary audit row, saw %', v_n - v_audits; end if;

  foreach v_who in array array[v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.read_medication_embeds_audited(array[v_med1, v_med2]) into v_json;
    execute 'reset role';
    if v_json <> '{}'::jsonb then raise exception 'FAIL 6e: % got embeds without a tie: %', v_who, v_json; end if;
  end loop;

  -- 7. merge counts: an admin gets counts only; a clinician without the permission is refused; the patient too; anon cannot execute
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.patient_record_counts_for_merge(v_pat) into v_json;
  execute 'reset role';
  if (v_json ->> 'medications')::integer <> 2 or (v_json ->> 'vitals_readings')::integer <> 0 then raise exception 'FAIL 7a: merge counts: %', v_json; end if;
  foreach v_who in array array[v_tied, v_pat] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin perform public.patient_record_counts_for_merge(v_pat);
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 7b: % was not refused the merge counts', v_who; end if;
  end loop;
  if has_function_privilege('anon', 'public.patient_record_counts_for_merge(uuid)', 'EXECUTE') then raise exception 'FAIL 7c: anon can execute the merge counts'; end if;

  -- SABOTAGE: the read without its tie check lets an untied clinician in, so 4a can fail
  create or replace function public.read_patient_medications_audited(p_patient uuid, p_reason text default null, p_active boolean default null, p_medication uuid default null)
    returns jsonb language sql security definer set search_path = ''
    as $f$ select jsonb_build_object('status', 'ok', 'rows', coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb)) from public.medications m where m.patient_id = p_patient $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_medications_audited(v_pat, 'S05fC proof: sabotage') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') = 0 then
    raise exception 'SABOTAGE FAIL: removing the tie check did not let the untied clinician read, so check 4a proves nothing';
  end if;

  -- SABOTAGE 2: the embed read without its tie check hands an untied clinician the medicine, so 6e can fail
  create or replace function public.read_medication_embeds_audited(p_ids uuid[]) returns jsonb language sql security definer set search_path = ''
    as $f$ select coalesce(jsonb_object_agg(m.id::text, jsonb_build_object('drug_name', m.drug_name)), '{}'::jsonb) from public.medications m where m.id = any (p_ids) $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_medication_embeds_audited(array[v_med1]) into v_json;
  execute 'reset role';
  if v_json = '{}'::jsonb then
    raise exception 'SABOTAGE 2 FAIL: removing the tie check did not expose the medicine, so check 6e proves nothing';
  end if;
end $$;

rollback;

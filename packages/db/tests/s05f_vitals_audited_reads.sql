-- ===========================================================================
-- Proof: *_s05f_vitals_audited_reads.sql (S05f piece D1; INV-10, INV-12, OQ-02).
--
-- Proves, with simulated sessions: the patient, a caregiver with the 'vitals_readings' grant and the service role read vitals through the
-- audited function with no audit row; a tied clinician reads them (filters, paging and ordering work) with one audit row, basis tied;
-- an untied clinician, admin, pharmacist and another organisation's clinician are DENIED (audited), a patient caller reading another
-- patient raises, a short reason raises, anon cannot execute. The monitoring roster returns the tied patient's readings with
-- visible = true and an untied patient with visible = false and no readings (never empty-but-visible); a patient and the service role see
-- their own / all; staff audit once. The adherence RPC refuses an untied caller. The hypertension quality view keeps counting for org
-- staff and for non-session callers, and shows another organisation's staff nothing. SABOTAGE 1: the audited read without its tie check;
-- SABOTAGE 2: the roster wrapper without its tie check.
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
  v_json jsonb;
  v_n integer;
  v_audits integer;
  v_failed boolean;
  v_who uuid;
  v_row record;
  v_hm_before integer;
  v_hm_at_before integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'S05f D Other Org', 'direct_consumer');
  select coalesce(hypertensive_patients, 0), coalesce(at_target, 0) into v_hm_before, v_hm_at_before
    from (select 1) s left join public.hypertension_quality_metrics h on h.organisation_id = v_org;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 's05fd-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_tied, v_untied, v_admin, v_pharm, v_other, v_cg]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',    'S05fD Patient One', '+2348058880101'),
    (v_pat2,   v_org,  'patient',    'S05fD Patient Two', '+2348058880102'),
    (v_tied,   v_org,  'clinician',  'S05fD Tied Doctor', '+2348058880103'),
    (v_untied, v_org,  'clinician',  'S05fD Untied Doctor','+2348058880104'),
    (v_admin,  v_org,  'admin',      'S05fD Admin',       '+2348058880105'),
    (v_pharm,  v_org,  'pharmacist', 'S05fD Pharmacist',  '+2348058880106'),
    (v_other,  v_org2, 'clinician',  'S05fD Other Org Dr','+2348058880107'),
    (v_cg,     v_org,  'patient',    'S05fD Caregiver',   '+2348058880108')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org,  v_tied,   'S05fD Tied Doctor',   true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD-1', now() + interval '1 year'),
    (v_org,  v_untied, 'S05fD Untied Doctor', true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD-2', now() + interval '1 year'),
    (v_org2, v_other,  'S05fD Other Org Dr',  true, now(), 'senior_medical_officer', 'Probe Indemnity', 'S05FD-3', now() + interval '1 year');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_tied, now()) on conflict (patient_id) do update set clinician_id = v_tied;
  insert into public.profile_access (profile_id, grantee_user_id, granted_by) values (v_pat, v_cg, v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'vitals_readings');
  perform set_config('request.jwt.claims', null, true);

  -- readings for the tied patient (older first) and one for the untied patient; the hypertension quality fixtures
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_pat, 'blood_pressure', 150, 95, now() - interval '3 days', 'device'),
         (v_org, v_pat, 'blood_pressure', 128, 82, now() - interval '1 day', 'device');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_pat, 'weight', 70.5, now() - interval '2 days', 'device');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, taken_at, source)
  values (v_org, v_pat2, 'pulse', 72, now() - interval '1 day', 'device');
  insert into public.care_plans (organisation_id, patient_id, condition, status) values (v_org, v_pat, 'hypertension', 'active');
  insert into public.patient_bp_targets (organisation_id, patient_id, home_systolic, home_diastolic, office_systolic, office_diastolic)
  values (v_org, v_pat, 135, 85, 140, 90);
  -- the BP insert may already have created an active schedule item through vitals_readings_set_monitoring_baseline (live does, a fresh
  -- replay may not), so create one only when it is missing
  insert into public.monitoring_schedule_items (organisation_id, patient_id, vital_type, frequency_per_week)
  select v_org, v_pat, 'blood_pressure', 7
   where not exists (select 1 from public.monitoring_schedule_items where patient_id = v_pat and vital_type = 'blood_pressure' and status = 'active');

  -- 1. patient: all, filtered by type, since, paged, ascending; no audit row; another patient raises
  select count(*) into v_audits from public.audit_log where actor_id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_vitals_audited(v_pat) into v_json;
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 3 then raise exception 'FAIL 1a: patient all: %', v_json; end if;
  if (v_json -> 'rows' -> 0 ->> 'vital_type') <> 'blood_pressure' or (v_json -> 'rows' -> 0 ->> 'systolic')::integer <> 128 then raise exception 'FAIL 1b: newest-first order wrong: %', v_json -> 'rows'; end if;
  if v_json -> 'rows' -> 0 ? 'sort_taken' then raise exception 'FAIL 1c: the helper sort column leaked'; end if;
  select public.read_patient_vitals_audited(v_pat, null, 'blood_pressure', null, 20, 0, true) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 2 or (v_json -> 'rows' -> 0 ->> 'systolic')::integer <> 150 then raise exception 'FAIL 1d: type filter / ascending: %', v_json; end if;
  -- a limit with ascending keeps the NEWEST rows (then orders them oldest first): never the oldest, which would drop the latest from a chart
  select public.read_patient_vitals_audited(v_pat, null, null, null, 2, 0, true) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 2 or (v_json -> 'rows' -> 0 ->> 'vital_type') <> 'weight' or (v_json -> 'rows' -> 1 ->> 'systolic')::integer <> 128 then
    raise exception 'FAIL 1d2: ascending + limit must return the newest two oldest-first: %', v_json -> 'rows';
  end if;
  select public.read_patient_vitals_audited(v_pat, null, 'blood_pressure', now() - interval '2 days') into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 1 then raise exception 'FAIL 1e: since filter: %', v_json; end if;
  select public.read_patient_vitals_audited(v_pat, null, null, null, 1, 1) into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 1 or (v_json -> 'rows' -> 0 ->> 'vital_type') <> 'weight' then raise exception 'FAIL 1f: paging (second newest should be the weight): %', v_json; end if;
  select public.read_patient_vitals_audited(v_pat, null, null, null, 20, 0, false, 'cgm') into v_json;
  if jsonb_array_length(v_json -> 'rows') <> 0 then execute 'reset role'; raise exception 'FAIL 1f2: source filter: %', v_json; end if;
  v_failed := false;
  begin perform public.read_patient_vitals_audited(v_pat2, 'S05fD proof: other patient');
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 1g: a patient read another patient''s vitals'; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_pat;
  if v_n <> v_audits then raise exception 'FAIL 1h: the patient''s own reads wrote audit rows'; end if;

  -- 2. caregiver with the grant, and the service role: rows without audit
  perform set_config('request.jwt.claims', json_build_object('sub', v_cg, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_vitals_audited(v_pat) into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 3 then raise exception 'FAIL 2a: caregiver: %', v_json; end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select public.read_patient_vitals_audited(v_pat, null, 'weight') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 1 then raise exception 'FAIL 2b: service role: %', v_json; end if;

  -- 3. tied clinician: ok with one audit row, basis tied
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.chart_read';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_vitals_audited(v_pat, 'S05fD proof: tied review', 'blood_pressure') into v_json;
  select count(*) into v_n from public.vitals_readings;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') <> 2 then raise exception 'FAIL 3a: tied clinician: %', v_json; end if;
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.chart_read' and event ->> 'basis' = 'tied' and result = 'success';
  if v_audits < 1 then raise exception 'FAIL 3b: the tied read was not audited'; end if;

  -- 4. everyone else is denied (and audited); short reason raises; anon cannot execute
  foreach v_who in array array[v_untied, v_admin, v_pharm, v_other] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    select public.read_patient_vitals_audited(v_pat, 'S05fD proof: untied attempt') into v_json;
    execute 'reset role';
    if v_json ->> 'status' <> 'denied' or jsonb_array_length(v_json -> 'rows') <> 0 then raise exception 'FAIL 4a: % was not denied: %', v_who, v_json; end if;
    if not exists (select 1 from public.audit_log where actor_id = v_who and action = 'staff.chart_read' and result = 'denied') then raise exception 'FAIL 4b: the refusal for % was not audited', v_who; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform public.read_patient_vitals_audited(v_pat, 'short');
  exception when invalid_parameter_value then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 4c: a short reason was accepted'; end if;
  if has_function_privilege('anon', 'public.read_patient_vitals_audited(uuid,text,public.vital_type,timestamptz,integer,integer,boolean,public.vital_source)', 'EXECUTE')
     or has_function_privilege('anon', 'public.patient_monitoring_latest_readings(uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.patient_vitals_adherence(uuid,integer)', 'EXECUTE') then
    raise exception 'FAIL 4d: anon can execute a vitals read';
  end if;

  -- 5. monitoring roster: the tied patient is visible with readings, the untied patient is listed but not visible and carries no readings
  select count(*) into v_audits from public.audit_log where actor_id = v_tied and action = 'staff.monitoring_roster_read';
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_row from public.patient_monitoring_latest_readings(array[v_pat]) where patient_id = v_pat;
  if not v_row.visible or v_row.systolic <> 128 or v_row.weight_kg <> 70.5 then execute 'reset role'; raise exception 'FAIL 5a: tied roster row: %', to_jsonb(v_row); end if;
  select * into v_row from public.patient_monitoring_latest_readings(array[v_pat, v_pat2]) where patient_id = v_pat2;
  if v_row.visible or v_row.pulse_bpm is not null or v_row.systolic is not null then execute 'reset role'; raise exception 'FAIL 5b: untied patient was visible or carried readings: %', to_jsonb(v_row); end if;
  select count(*) into v_n from public.patient_monitoring_latest_readings(array[v_pat, v_pat2]);
  execute 'reset role';
  if v_n <> 2 then raise exception 'FAIL 5c: both requested ids must be returned, got %', v_n; end if;
  select count(*) into v_n from public.audit_log where actor_id = v_tied and action = 'staff.monitoring_roster_read';
  if v_n - v_audits <> 3 then raise exception 'FAIL 5d: expected 3 summary audit rows for the three tied calls, saw %', v_n - v_audits; end if;
  -- the patient asking for herself sees herself; asking for another patient gets visible = false
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_row from public.patient_monitoring_latest_readings(array[v_pat, v_pat2]) where patient_id = v_pat;
  if not v_row.visible or v_row.systolic <> 128 then execute 'reset role'; raise exception 'FAIL 5e: the patient did not see herself: %', to_jsonb(v_row); end if;
  select * into v_row from public.patient_monitoring_latest_readings(array[v_pat, v_pat2]) where patient_id = v_pat2;
  execute 'reset role';
  if v_row.visible or v_row.pulse_bpm is not null then raise exception 'FAIL 5f: the patient saw another patient: %', to_jsonb(v_row); end if;
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select * into v_row from public.patient_monitoring_latest_readings(array[v_pat2]) where patient_id = v_pat2;
  execute 'reset role';
  if not v_row.visible or v_row.pulse_bpm <> 72 then raise exception 'FAIL 5g: the service role did not see everything: %', to_jsonb(v_row); end if;

  -- 6. adherence: tied gets the schedule item the BP baseline trigger created, untied raises
  perform set_config('request.jwt.claims', json_build_object('sub', v_tied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select * into v_row from public.patient_vitals_adherence(v_pat, 28) limit 1;
  execute 'reset role';
  if v_row.schedule_item_id is null then raise exception 'FAIL 6a: tied adherence: %', to_jsonb(v_row); end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin perform * from public.patient_vitals_adherence(v_pat, 28);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 6b: an untied caller read adherence'; end if;

  -- 7. hypertension quality view: org staff count the fixture, another org's staff do not, a non-session caller (cron) does
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select hypertensive_patients, at_target into v_n, v_audits from public.hypertension_quality_metrics where organisation_id = v_org;
  execute 'reset role';
  if v_n is distinct from v_hm_before + 1 or v_audits is distinct from v_hm_at_before + 1 then
    raise exception 'FAIL 7a: org staff count % hypertensive / % at target, expected % / %', v_n, v_audits, v_hm_before + 1, v_hm_at_before + 1;
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.hypertension_quality_metrics where organisation_id = v_org;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 7b: another organisation''s staff saw this organisation''s quality metrics'; end if;
  -- a real non-session caller (cron, service role) carries no JWT claims; clear the ones left over from the probe above (S39b: the quality views
  -- now filter on the caller's staff status, so a leftover identity from another organisation would be read as that identity)
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select hypertensive_patients, at_target into v_n, v_audits from public.hypertension_quality_metrics where organisation_id = v_org;
  if v_n is distinct from v_hm_before + 1 or v_audits is distinct from v_hm_at_before + 1 then
    raise exception 'FAIL 7c: a non-session caller (cron / service role) lost the aggregate: % / %', v_n, v_audits;
  end if;

  -- SABOTAGE 1: the audited read without its tie check lets an untied clinician in
  create or replace function public.read_patient_vitals_audited(p_patient uuid, p_reason text default null, p_vital_type public.vital_type default null,
    p_since timestamptz default null, p_limit integer default 20, p_offset integer default 0, p_ascending boolean default false,
    p_source public.vital_source default null)
    returns jsonb language sql security definer set search_path = ''
    as $f$ select jsonb_build_object('status', 'ok', 'rows', coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb)) from public.vitals_readings v where v.patient_id = p_patient $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.read_patient_vitals_audited(v_pat, 'S05fD proof: sabotage') into v_json;
  execute 'reset role';
  if v_json ->> 'status' <> 'ok' or jsonb_array_length(v_json -> 'rows') = 0 then raise exception 'SABOTAGE 1 FAIL: removing the tie check did not let the untied clinician read, so check 4a proves nothing'; end if;

  -- SABOTAGE 2: a roster wrapper that passes every id to the core shows the untied clinician the other patient's readings
  create or replace function public.s05fd_sabotage_roster(p_ids uuid[]) returns integer language sql security definer set search_path = ''
    as $f$ select count(*)::integer from private.patient_monitoring_core(p_ids) c where c.pulse_bpm is not null $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_untied, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select public.s05fd_sabotage_roster(array[v_pat2]) into v_n;
  execute 'reset role';
  if v_n = 0 then raise exception 'SABOTAGE 2 FAIL: the unfiltered core did not expose the readings, so check 5b proves nothing'; end if;
end $$;

rollback;

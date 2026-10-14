-- ===========================================================================
-- Proof: *_s05b_g_observations_view_hides_superseded.sql (S05b-g).
--
--   A. A superseded vital and an entered_in_error vital are ABSENT from the audited chart read (public.read_patient_chart_audited, a
--      definer reader that ignores RLS) for a tied clinician, and from the other three definer readers of public.observations
--      (clinician_patient_summary, precall_summary is covered by the shared view). The replacement and an untouched row are PRESENT
--      (gate-opens control: the same session, the same call, sees what it should).
--   B. A superseded and an entered_in_error LAB value are absent from the record share / export route (public.record_share_by_token,
--      anon) while the replacement and an untouched value are present. (The audited chart reader has no lab section; the share route
--      is the lab reader that goes through the corrected-table views.)
--   C. Staff history is still reachable: public.clinical_value_history returns the whole chain, original included, for the tied clinician.
--   D. Standing scan: no view in public/private that reads a corrected table directly lacks the correction_status filter (public.allergies and public.conditions included, since #1134).
--   E. SABOTAGE (each must flip): public.observations rebuilt without the filter (the audited read shows the original again);
--      private.lab_analyte_readings_current rebuilt without the filter (the share shows the superseded lab again); a view without the
--      filter makes scan D fire.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_p   uuid := gen_random_uuid();
  v_c   uuid := gen_random_uuid();   -- tied clinician
  v_b1 uuid; v_b2 uuid; v_b3 uuid; v_rep uuid;
  v_l1 uuid; v_l2 uuid; v_l3 uuid; v_lrep uuid;
  v_res jsonb;
  v_ids uuid[];
  v_share jsonb;
  v_token text;
  v_data jsonb;
  v_n int;
  v_flipped boolean;
  v_def text;
  v_hist jsonb;
  v_sum jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_p, 's05bg-p@example.invalid', 'x', now(), '{}', '{}'),
    (v_c, 's05bg-c@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_p, v_org, 'patient',   'S05bg Patient', '+2348055570001'),
    (v_c, v_org, 'clinician', 'S05bg Doctor',  '+2348055570002')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
  values (v_org, v_c, 'S05bg Doctor', true, now(), 'senior_medical_officer');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_p, v_c, now()) on conflict (patient_id) do update set clinician_id = v_c;

  -- vitals: b1 will be corrected (superseded), b2 stays, b3 will be voided (entered in error)
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_p, 'blood_pressure', 120, 80, now() - interval '3 hours', 'manual') returning id into v_b1;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
  values (v_org, v_p, 'blood_pressure', 124, 82, now() - interval '2 hours', 'manual') returning id into v_b2;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, v_p, 'weight', 70, now() - interval '1 hours', 'manual') returning id into v_b3;
  -- labs: l1 corrected, l2 stays, l3 voided
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_p, 'hba1c', 6.1, '%', now() - interval '3 days') returning id into v_l1;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_p, 'ldl', 3.0, 'mmol/L', now() - interval '2 days') returning id into v_l2;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
  values (v_org, v_p, 'creatinine', 80, 'umol/L', now() - interval '1 days') returning id into v_l3;

  -- the tied clinician corrects b1, voids b3, corrects l1, voids l3
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role service_role';
  v_res := public.correct_clinical_value('vitals_readings', v_b1, 'corrected', 'Cuff was on the wrong arm', '{"systolic": 118, "diastolic": 78}'::jsonb);
  v_rep := (v_res ->> 'replacement_id')::uuid;
  perform public.correct_clinical_value('vitals_readings', v_b3, 'entered_in_error', 'Wrong patient scale', null);
  v_res := public.correct_clinical_value('lab_analyte_readings', v_l1, 'corrected', 'Lab sent a corrected report', '{"value": 5.9}'::jsonb);
  v_lrep := (v_res ->> 'replacement_id')::uuid;
  perform public.correct_clinical_value('lab_analyte_readings', v_l3, 'entered_in_error', 'Result belongs to someone else', null);
  execute 'reset role';
  if v_rep is null or v_lrep is null then raise exception 'fixture FAIL: no replacement id'; end if;

  -- patient makes a share carrying vitals and lab results
  perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_share := to_jsonb(public.create_record_share(array['vitals', 'lab_results']::text[], 1));
  execute 'reset role';
  v_token := v_share ->> 'token';

  -- ======================================================================== A. audited chart read
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_data := public.read_patient_chart_audited(v_p, array['vitals'], 'S05b-g proof: reading the chart');
  execute 'reset role';
  if v_data ->> 'status' <> 'ok' then raise exception 'FAIL A0: the tied clinician was not admitted (%): the gate-opens control is broken', v_data ->> 'status'; end if;
  select array_agg((e ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_data -> 'sections' -> 'vitals') e;
  if v_b1 = any (v_ids) then raise exception 'FAIL A1: the superseded reading is in the audited chart read'; end if;
  if v_b3 = any (v_ids) then raise exception 'FAIL A2: the entered_in_error reading is in the audited chart read'; end if;
  if not (v_rep = any (v_ids)) or not (v_b2 = any (v_ids)) then
    raise exception 'FAIL A3: the replacement or the untouched reading is missing (gate-opens control); saw %', v_ids;
  end if;
  -- the other definer readers of the view: the clinician summary's 14-day readings are the replacement and the untouched BP only
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_sum := public.clinician_patient_summary(v_p, 'S05b-g proof: summary read');
  execute 'reset role';
  v_n := jsonb_array_length(v_sum -> 'readings' -> 'rows');
  if v_n is distinct from 2 then raise exception 'FAIL A4: the clinician summary shows % readings, expected 2 (replacement and untouched)', v_n; end if;
  raise notice 'PASS A: audited chart read and clinician summary show current vitals only';

  -- ======================================================================== B. lab values through the share route
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  v_data := public.record_share_by_token(v_token);
  execute 'reset role';
  if v_data is null or v_data ->> 'status' <> 'ok' then raise exception 'FAIL B0: the share did not open (%)', v_data; end if;
  select count(*) into v_n from jsonb_array_elements(v_data -> 'lab_results') e where e ->> 'code' = 'creatinine';
  if v_n <> 0 then raise exception 'FAIL B1: the entered_in_error lab value is in the share'; end if;
  select count(*) into v_n from jsonb_array_elements(v_data -> 'lab_results') e where e ->> 'code' = 'hba1c' and (e ->> 'value')::numeric = 6.1;
  if v_n <> 0 then raise exception 'FAIL B2: the superseded lab value is in the share'; end if;
  select count(*) into v_n from jsonb_array_elements(v_data -> 'lab_results') e
   where (e ->> 'code' = 'hba1c' and (e ->> 'value')::numeric = 5.9) or (e ->> 'code' = 'ldl' and (e ->> 'value')::numeric = 3.0);
  if v_n <> 2 then raise exception 'FAIL B3: the replacement or the untouched lab value is missing (gate-opens control), saw %', v_n; end if;
  raise notice 'PASS B: share route shows current lab values only';

  -- ======================================================================== C. staff history still reaches the originals
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_hist := public.clinical_value_history('vitals_readings', v_b1);
  execute 'reset role';
  if not exists (select 1 from jsonb_array_elements(v_hist) e where e ->> 'id' = v_b1::text and e ->> 'correction_status' = 'corrected') then
    raise exception 'FAIL C1: clinical_value_history no longer returns the original reading: %', v_hist;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_hist) e where e ->> 'id' = v_rep::text) then raise exception 'FAIL C2: history lacks the replacement'; end if;
  raise notice 'PASS C: staff history reaches the superseded entry';

  -- ======================================================================== D. standing scan
  select count(*) into v_n
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind in ('v', 'm') and n.nspname in ('public', 'private')
     and pg_get_viewdef(c.oid) ~* '(from|join)\s+(public\.)?(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
     and pg_get_viewdef(c.oid) !~* 'correction_status\s+IS\s+NULL';
  if v_n <> 0 then raise exception 'FAIL D: % view(s) read a corrected table without the correction_status filter', v_n; end if;
  raise notice 'PASS D: every view over a corrected table filters superseded rows';

  -- ======================================================================== E. sabotage (each must flip)
  -- E1: observations without the filter -> the audited read shows the original again
  v_flipped := false;
  begin
    v_def := regexp_replace(pg_get_viewdef('public.observations'::regclass), E'\\s+WHERE\\s+\\(?([a-z]+\\.)?correction_status IS NULL\\)?[;\\s]*$', '');
    if position('correction_status' in v_def) > 0 then raise exception 'sabotage text did not strip the filter'; end if;
    execute 'create or replace view public.observations with (security_invoker = true) as ' || v_def;
    perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_data := public.read_patient_chart_audited(v_p, array['vitals'], 'S05b-g proof: sabotage read');
    execute 'reset role';
    select array_agg((e ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_data -> 'sections' -> 'vitals') e;
    execute 'set local role authenticated';
    v_sum := public.clinician_patient_summary(v_p, 'S05b-g proof: sabotage summary');
    execute 'reset role';
    if v_b1 = any (v_ids) and v_b3 = any (v_ids) and jsonb_array_length(v_sum -> 'readings' -> 'rows') = 4 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL E1: sabotage did not flip (proof A is vacuous)'; end if;

  -- E2: lab _current view without the filter -> the share shows the superseded lab again
  v_flipped := false;
  begin
    execute 'create or replace view private.lab_analyte_readings_current as select * from public.lab_analyte_readings';
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    v_data := public.record_share_by_token(v_token);
    execute 'reset role';
    select count(*) into v_n from jsonb_array_elements(v_data -> 'lab_results') e where e ->> 'code' = 'creatinine';
    if v_n > 0 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  execute 'reset role';
  if not v_flipped then raise exception 'FAIL E2: sabotage did not flip (proof B is vacuous)'; end if;

  -- E3: an unfiltered view over a corrected table trips scan D
  v_flipped := false;
  begin
    execute 'create view public.s05bg_unfiltered as select id from public.vitals_readings';
    select count(*) into v_n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('v', 'm') and n.nspname in ('public', 'private')
         and pg_get_viewdef(c.oid) ~* '(from|join)\s+(public\.)?(vitals_readings|patient_allergies|patient_conditions|lab_analyte_readings)\M'
       and pg_get_viewdef(c.oid) !~* 'correction_status\s+IS\s+NULL';
    if v_n > 0 then v_flipped := true; end if;
    raise exception 'undo sabotage' using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  if not v_flipped then raise exception 'FAIL E3: sabotage did not flip (scan D is vacuous)'; end if;

  -- the sabotages were undone
  if position('correction_status' in pg_get_viewdef('public.observations'::regclass)) = 0
     or position('correction_status' in pg_get_viewdef('private.lab_analyte_readings_current'::regclass)) = 0 then
    raise exception 'FAIL E4: a sabotage was not undone';
  end if;
  raise notice 'PASS E: three sabotages each flipped';
  raise notice 'S05b-g proof complete';
end $$;

rollback;

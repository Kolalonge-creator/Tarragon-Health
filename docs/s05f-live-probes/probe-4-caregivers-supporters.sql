-- ============================================================================================================================
-- READ BEFORE RUNNING. Written 2026-10-02 for the S05f staff click-through; run against the LINKED PRODUCTION project.
--  * One transaction that ends in ROLLBACK: the fake staff, rows and audit entries it creates are never saved.
--  * It is NOT a CI proof (that is packages/db/tests/). It hard-codes live ids, so it only makes sense on this project:
--      First Patient 4cd8ff96-5575-4d7a-8c1f-ff33fe6f51c0, org 00000000-0000-0000-0000-000000000001,
--      Dr Isaac Longe (tied Senior Medical Officer) de83e934-9858-4fc2-b974-92d0759e5d26,
--      and prescriptions TRG-RX-2026-000442 / 000443 on First Patient. If those no longer exist it fails at setup (changing nothing).
--  * Fake staff use @probe.invalid emails and PROBE-* credentials. Check afterwards: select count(*) from auth.users where email like '%@probe.invalid';
--  * Run with: docs/s05f-live-probes/run-probe.sh <this file>
-- ============================================================================================================================
-- S05f live probe 4 (section 7, caregivers and supporters): fake caregivers/supporter, real policies, all rolled back.
begin;
create temp table probe_results (n serial, item text, expected text, actual text, ok boolean) on commit drop;
grant all on probe_results to authenticated;
grant usage, select on sequence probe_results_n_seq to authenticated;

do $$
declare
  c_patient constant uuid := '4cd8ff96-5575-4d7a-8c1f-ff33fe6f51c0';
  c_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  v_c1 uuid := gen_random_uuid();   -- caregiver WITH the medications category grant (view level)
  v_c2 uuid := gen_random_uuid();   -- caregiver WITHOUT a clinical grant
  v_s  uuid := gen_random_uuid();   -- acting supporter, manage level
  v_para uuid; v_acc uuid; v jsonb; n int; v_by uuid;
begin
  select id into v_para from public.medications where rx_number = 'TRG-RX-2026-000443';

  -- fake people (exist only inside this transaction)
  insert into auth.users (id, email, aud, role, instance_id)
  select x, 's05f-probe4-' || substr(x::text, 1, 6) || '@probe.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'
  from unnest(array[v_c1, v_c2, v_s]) x;
  insert into public.profiles (id, full_name, role, organisation_id)
  values (v_c1, 'Probe Caregiver With Grant', 'patient', c_org), (v_c2, 'Probe Caregiver No Grant', 'patient', c_org), (v_s, 'Probe Acting Supporter', 'patient', c_org)
  on conflict (id) do update set organisation_id = c_org;

  -- grants: made by the patient herself, as the access rules require
  perform set_config('request.jwt.claims', json_build_object('sub', c_patient, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_acc := gen_random_uuid();
  insert into public.profile_access (id, profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (v_acc, c_patient, v_c1, 'view', c_patient, true, array['view_medication']::public.caregiver_permission[]);
  perform public.set_care_access_categories(v_acc, array['medications']::public.care_access_category[]);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access)
  values (c_patient, v_c2, 'view', c_patient, false);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access)
  values (c_patient, v_s, 'manage', c_patient, false);

  execute 'reset role';

  -- one dose log for the caregiver to find
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (c_org, c_patient, v_para, 'taken');

  -- ================= 7.1 caregiver WITH the medications grant =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_c1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.medications where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.1 grant holder reads the medication list', '>= 2 rows', n || ' rows', n >= 2);
  select count(*) into n from public.medication_logs where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.1 grant holder reads the medication log', '>= 1 row', n || ' rows', n >= 1);
  v := public.read_patient_medications_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('7.1 grant holder via the audited read', 'status ok, >= 2 rows', coalesce(v->>'status','null') || ', ' || coalesce(jsonb_array_length(v->'rows'),0) || ' rows', v->>'status' = 'ok' and jsonb_array_length(v->'rows') >= 2);
  select count(*) into n from public.vitals_readings where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.1 grant is category-scoped: no vitals without that category', '0 rows', n || ' rows', n = 0);
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (c_org, c_patient, v_para, 'taken');
    insert into probe_results (item, expected, actual, ok) values ('7.1 view-level caregiver tries to log a dose for the patient', 'refused', 'NOT refused', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('7.1 view-level caregiver tries to log a dose for the patient', 'refused', sqlerrm, true);
  end;
  execute 'reset role';

  -- ================= 7.3 caregiver WITHOUT the grant =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_c2, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into n from public.medications where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.3 no-grant caregiver reads the medication list', '0 rows', n || ' rows', n = 0);
  select count(*) into n from public.medication_logs where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.3 no-grant caregiver reads the medication log', '0 rows', n || ' rows', n = 0);
  select count(*) into n from public.vitals_readings where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('7.3 no-grant caregiver reads vitals', '0 rows', n || ' rows', n = 0);
  begin
    v := public.read_patient_medications_audited(c_patient, 'S05f live probe read');
    insert into probe_results (item, expected, actual, ok) values ('7.3 no-grant caregiver via the audited read', 'refused or 0 rows', coalesce(v->>'status','null') || ', ' || coalesce(jsonb_array_length(v->'rows'),0) || ' rows', coalesce(jsonb_array_length(v->'rows'),0) = 0);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('7.3 no-grant caregiver via the audited read', 'refused or 0 rows', 'refused: ' || sqlerrm, sqlerrm = 'not authorised');
  end;
  execute 'reset role';

  -- ================= 7.2 acting supporter (manage level) =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (c_org, c_patient, v_para, 'taken');
    insert into probe_results (item, expected, actual, ok) values ('7.2 acting supporter logs a dose for the patient', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('7.2 acting supporter logs a dose for the patient', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic) values (c_org, c_patient, 'blood_pressure', 128, 82);
    insert into probe_results (item, expected, actual, ok) values ('7.2 acting supporter logs a vitals reading for the patient', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('7.2 acting supporter logs a vitals reading for the patient', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  execute 'reset role';
  select count(*) into n from public.medication_logs where patient_id = c_patient and logged_by_profile_id = v_s;
  insert into probe_results (item, expected, actual, ok) values ('7.2 the dose is stamped with the supporter, not the patient', '1 row logged_by the supporter', n || ' row(s)', n = 1);
  select count(*) into n from public.vitals_readings where patient_id = c_patient and logged_by_profile_id = v_s;
  insert into probe_results (item, expected, actual, ok) values ('7.2 the vitals reading is stamped with the supporter', '1 row logged_by the supporter', n || ' row(s)', n = 1);
end $$;

select n, item, expected, actual, ok from probe_results order by n;
rollback;

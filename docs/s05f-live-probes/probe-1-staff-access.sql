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
-- S05f live probe: fake staff + the real functions, all inside a transaction that is rolled back.
begin;
create temp table probe_results (n serial, item text, expected text, actual text, ok boolean) on commit drop;
grant all on probe_results to authenticated;
grant usage, select on sequence probe_results_n_seq to authenticated;

do $$
declare
  c_patient constant uuid := '4cd8ff96-5575-4d7a-8c1f-ff33fe6f51c0';
  c_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  c_isaac   constant uuid := 'de83e934-9858-4fc2-b974-92d0759e5d26';
  v_mo uuid := gen_random_uuid();   -- fake Medical Officer, tied
  v_un uuid := gen_random_uuid();   -- fake Senior Medical Officer, untied
  v_vitc uuid; v_para uuid; v_pat_med uuid;
  v_n int; v_msg text; v jsonb;
  v_cta uuid;
begin
  select id into v_vitc from public.medications where rx_number = 'TRG-RX-2026-000442';
  select id into v_para from public.medications where rx_number = 'TRG-RX-2026-000443';

  -- ---- fake staff (exist only inside this transaction) ----
  insert into auth.users (id, email, aud, role, instance_id)
  values (v_mo, 's05f-probe-mo@probe.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
         (v_un, 's05f-probe-smo@probe.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, full_name, role, organisation_id)
  values (v_mo, 'Probe Medical Officer', 'clinician', c_org), (v_un, 'Probe Untied SMO', 'clinician', c_org)
  on conflict (id) do update set full_name = excluded.full_name, role = 'clinician', organisation_id = c_org;
  insert into public.clinical_staff (profile_id, full_name, organisation_id, doctor_tier, employment_type, active, credential_type, credential_number, license_verified_at)
  values (v_mo, 'Probe Medical Officer', c_org, 'medical_officer', 'employed', true, 'MDCN', 'PROBE-MO', now()),
         (v_un, 'Probe Untied SMO', c_org, 'senior_medical_officer', 'employed', true, 'MDCN', 'PROBE-SMO', now());

  -- tie the fake Medical Officer to the patient through the care team (rolled back with everything else)
  select id into v_cta from public.care_team_assignment where patient_id = c_patient limit 1;
  update public.care_team_assignment set care_coordinator_id = v_mo where id = v_cta;

  -- a patient-added medication, for the "MO cannot confirm a refill on a patient-added medicine" check
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
    values (c_org, c_patient, 'Probe patient-added', '10mg', 'daily', 'patient', c_patient) returning id into v_pat_med;
  exception when others then
    v_pat_med := null;
    insert into probe_results (item, expected, actual, ok) values ('setup patient-added med', 'inserted', 'FAILED: ' || sqlerrm, false);
  end;

  -- ================= tied Senior Medical Officer (Isaac): control =================
  perform set_config('request.jwt.claims', json_build_object('sub', c_isaac, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.read_patient_medications_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('T control: tied SMO reads medications', 'status ok, >= 2 rows', (v->>'status') || ', ' || jsonb_array_length(v->'rows') || ' rows', v->>'status' = 'ok' and jsonb_array_length(v->'rows') >= 2);
  v := public.read_patient_vitals_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('T control: tied SMO reads vitals', 'status ok, >= 1 row', (v->>'status') || ', ' || jsonb_array_length(v->'rows') || ' rows', v->>'status' = 'ok' and jsonb_array_length(v->'rows') >= 1);
  v := public.read_medication_embeds_audited(array[v_vitc, v_para]);
  select count(*) into v_n from jsonb_object_keys(v);
  insert into probe_results (item, expected, actual, ok) values ('2.5 path: tied SMO gets drug names for worklist rows', '2 embeds with a drug_name', v_n || ' embeds; vitC name=' || coalesce(v->(v_vitc::text)->>'drug_name','NONE'), v_n = 2 and (v->(v_vitc::text)->>'drug_name') is not null);
  execute 'reset role';

  -- ================= untied Senior Medical Officer =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_un, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.read_patient_medications_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('3.1 untied reads medications', 'status denied, no rows', coalesce(v->>'status','null') || ', rows=' || coalesce((v->'rows')::text,'none'), v->>'status' = 'denied');
  v := public.read_patient_vitals_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('3.1 untied reads vitals', 'status denied, no rows', coalesce(v->>'status','null') || ', rows=' || coalesce((v->'rows')::text,'none'), v->>'status' = 'denied');
  v := public.read_medication_embeds_audited(array[v_vitc, v_para]);
  select count(*) into v_n from jsonb_object_keys(v);
  insert into probe_results (item, expected, actual, ok) values ('2.5/3.x untied gets drug names for worklist rows', '0 embeds (row shows "not available")', v_n || ' embeds', v_n = 0);
  begin
    perform public.prescribe_medication(c_patient, 'Probe drug', '1g', 'daily', null, null, null, null, 7, '7', null, null, null);
    insert into probe_results (item, expected, actual, ok) values ('3.5 untied prescribes', 'refused', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('3.5 untied prescribes', 'refused', sqlerrm, sqlerrm ilike '%not authorised%');
  end;
  begin
    perform public.confirm_medication_refill(v_vitc, null);
    insert into probe_results (item, expected, actual, ok) values ('3.6 untied confirms refill', 'refused', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('3.6 untied confirms refill', 'refused', sqlerrm, true);
  end;
  begin
    perform public.amend_medication(v_vitc, 'probe amend', null, null, null, null, 7, '7');
    insert into probe_results (item, expected, actual, ok) values ('3.6 untied amends', 'refused', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('3.6 untied amends', 'refused', sqlerrm, true);
  end;
  execute 'reset role';

  -- ================= tied Medical Officer (no prescribing authority) =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_mo, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.read_patient_medications_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('MO tied: reads medications', 'status ok, >= 2 rows', coalesce(v->>'status','null') || ', ' || coalesce(jsonb_array_length(v->'rows'),0) || ' rows', v->>'status' = 'ok' and jsonb_array_length(v->'rows') >= 2);
  begin
    perform public.confirm_medication_refill(v_vitc, null);
    insert into probe_results (item, expected, actual, ok) values ('4.1 MO confirms refill on clinician-prescribed', 'works', 'works', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('4.1 MO confirms refill on clinician-prescribed', 'works', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    perform public.prescribe_medication(c_patient, 'Probe drug', '1g', 'daily', null, null, null, null, 7, '7', null, null, null);
    insert into probe_results (item, expected, actual, ok) values ('4.2 MO prescribes', 'refused (no authority)', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('4.2 MO prescribes', 'refused (no authority)', sqlerrm, true);
  end;
  begin
    perform public.amend_medication(v_vitc, 'probe amend', null, null, null, null, 7, '7');
    insert into probe_results (item, expected, actual, ok) values ('4.2 MO amends', 'refused (no authority)', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('4.2 MO amends', 'refused (no authority)', sqlerrm, true);
  end;
  if v_pat_med is not null then
    begin
      perform public.confirm_medication_refill(v_pat_med, null);
      insert into probe_results (item, expected, actual, ok) values ('4.2 MO confirms refill on patient-added', 'refused', 'SUCCEEDED', false);
    exception when others then
      insert into probe_results (item, expected, actual, ok) values ('4.2 MO confirms refill on patient-added', 'refused', sqlerrm, true);
    end;
  end if;
  execute 'reset role';
end $$;

select n, item, expected, actual, ok from probe_results order by n;
rollback;

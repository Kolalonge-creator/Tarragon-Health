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
-- S05f live probe 2 (1.12 dose history, 2.4 referral summary, 2.8 chart sections): fake rows + fake untied staff, all rolled back.
begin;
create temp table probe_results (n serial, item text, expected text, actual text, ok boolean) on commit drop;
grant all on probe_results to authenticated;
grant usage, select on sequence probe_results_n_seq to authenticated;

do $$
declare
  c_patient constant uuid := '4cd8ff96-5575-4d7a-8c1f-ff33fe6f51c0';
  c_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  c_isaac   constant uuid := 'de83e934-9858-4fc2-b974-92d0759e5d26';
  v_un uuid := gen_random_uuid();
  v_vitc uuid; v_ref uuid; v jsonb; v_txt text;
begin
  select id into v_vitc from public.medications where rx_number = 'TRG-RX-2026-000442';

  -- fake untied Senior Medical Officer + fake rows (exist only inside this transaction)
  insert into auth.users (id, email, aud, role, instance_id)
  values (v_un, 's05f-probe2-smo@probe.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  insert into public.profiles (id, full_name, role, organisation_id) values (v_un, 'Probe Untied SMO', 'clinician', c_org)
  on conflict (id) do update set full_name = excluded.full_name, role = 'clinician', organisation_id = c_org;
  insert into public.clinical_staff (profile_id, full_name, organisation_id, doctor_tier, employment_type, active, credential_type, credential_number, license_verified_at)
  values (v_un, 'Probe Untied SMO', c_org, 'senior_medical_officer', 'employed', true, 'MDCN', 'PROBE-SMO2', now());
  insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (c_org, c_patient, v_vitc, 'taken');


  -- ================= tied Senior Medical Officer (Isaac) =================
  perform set_config('request.jwt.claims', json_build_object('sub', c_isaac, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  -- the fake referral is created by the tied clinical-tier caller, as the creation trigger requires
  v_ref := public.create_specialist_referral(c_patient, 'endocrinology', 'clinician_initiated', 'routine', 'S05f live probe referral', null, '{}'::jsonb, false);
  v := public.read_medication_dose_log_audited(c_patient, 'S05f live probe read');
  v_txt := v::text;
  insert into probe_results (item, expected, actual, ok) values ('1.12 tied: dose history shows the drug name', 'status ok and "S05f test vitamin C"', left(v_txt, 170), v_txt like '%"ok"%' and v_txt like '%S05f test vitamin C%');
  v := public.read_patient_chart_audited(c_patient, array['medications','conditions','allergies'], 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('2.8 tied: chart sections medications/conditions/allergies load', 'no section denied', left(v::text, 170), coalesce(jsonb_array_length(v->'denied'), 0) = 0 and (v->'sections') ? 'medications' and jsonb_array_length(v->'sections'->'medications') >= 2);
  begin
    v := public.get_referral_audited(v_ref, 'S05f live probe read');
    insert into probe_results (item, expected, actual, ok) values ('2.4 tied: reads the referral', 'status ok', left(v::text, 170), v->>'status' = 'ok');
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('2.4 tied: reads the referral', 'status ok', 'raised: ' || sqlerrm, false);
  end;
  begin
    perform public.set_referral_clinical_summary(v_ref, '{"note":"probe summary"}'::jsonb);
    insert into probe_results (item, expected, actual, ok) values ('2.4 tied: saves a clinical summary', 'works', 'works', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('2.4 tied: saves a clinical summary', 'works', 'raised: ' || sqlerrm, false);
  end;
  execute 'reset role';

  -- ================= untied Senior Medical Officer =================
  perform set_config('request.jwt.claims', json_build_object('sub', v_un, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v := public.read_medication_dose_log_audited(c_patient, 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('3.3 untied: dose history', 'status denied', left(v::text, 170), v->>'status' = 'denied');
  v := public.read_patient_chart_audited(c_patient, array['medications','conditions','allergies'], 'S05f live probe read');
  insert into probe_results (item, expected, actual, ok) values ('3.1/2.8 untied: chart sections', 'all denied, none returned as empty', left(v::text, 170), v::text like '%denied%' and coalesce(jsonb_array_length(v->'rows'->'medications'), 0) = 0);
  begin
    v := public.get_referral_audited(v_ref, 'S05f live probe read');
    insert into probe_results (item, expected, actual, ok) values ('3.8 untied: reads the referral', 'denied / refused', left(v::text, 170), v->>'status' = 'denied' or v is null);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('3.8 untied: reads the referral', 'denied / refused', 'refused: ' || sqlerrm, true);
  end;
  begin
    perform public.set_referral_clinical_summary(v_ref, '{"note":"should not save"}'::jsonb);
    insert into probe_results (item, expected, actual, ok) values ('3.8 untied: saves a clinical summary', 'refused', 'SUCCEEDED', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('3.8 untied: saves a clinical summary', 'refused', sqlerrm, true);
  end;
  execute 'reset role';
end $$;

select n, item, expected, actual, ok from probe_results order by n;
rollback;

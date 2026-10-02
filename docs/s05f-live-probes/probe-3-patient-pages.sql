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
-- S05f live probe 3 (section 6, patient pages): runs as First Patient under RLS, all rolled back.
begin;
create temp table probe_results (n serial, item text, expected text, actual text, ok boolean) on commit drop;
grant all on probe_results to authenticated;
grant usage, select on sequence probe_results_n_seq to authenticated;

do $$
declare
  c_patient constant uuid := '4cd8ff96-5575-4d7a-8c1f-ff33fe6f51c0';
  c_org     constant uuid := '00000000-0000-0000-0000-000000000001';
  v_vitc uuid; v_para uuid; v_own uuid;
  n int; n0 int; n1 int; v jsonb;
begin
  select id into v_vitc from public.medications where rx_number = 'TRG-RX-2026-000442';
  select id into v_para from public.medications where rx_number = 'TRG-RX-2026-000443';
  select count(*) into n0 from public.emergency_events where patient_id = c_patient;

  perform set_config('request.jwt.claims', json_build_object('sub', c_patient, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- 6.1 own medications
  select count(*) into n from public.medications where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('6.1 patient reads own medications', '4 rows (2 active, 2 stopped)', n || ' rows', n = 4);
  select count(*) into n from public.medications where patient_id = c_patient and stopped_at is null and superseded_at is null;
  insert into probe_results (item, expected, actual, ok) values ('6.1 current vs superseded split', '2 current (old versions are superseded)', n || ' current', n = 2);
  v := public.read_medication_embeds_audited(array[v_vitc, v_para]);
  insert into probe_results (item, expected, actual, ok) values ('6.8 own embeds keep the drug name', 'both names', left(v::text, 120), (v->(v_vitc::text)->>'drug_name') is not null and (v->(v_para::text)->>'drug_name') is not null);

  -- 6.2 add own medication
  begin
    insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, source, added_by)
    values (c_org, c_patient, 'Probe own medicine', '5mg', 'daily', 'patient', c_patient) returning id into v_own;
    insert into probe_results (item, expected, actual, ok) values ('6.2 patient adds a medication (source patient)', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.2 patient adds a medication (source patient)', 'saves', 'FAILED: ' || sqlerrm, false);
  end;

  -- 6.3 prescribed medication: stop works, dose edit refused, reminder times work
  begin
    update public.medications set schedule_times = '["08:00"]'::jsonb where id = v_para;
    get diagnostics n = row_count;
    insert into probe_results (item, expected, actual, ok) values ('6.3 change reminder times on a prescribed medicine', 'works (1 row)', n || ' row(s)', n = 1);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.3 change reminder times on a prescribed medicine', 'works (1 row)', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    update public.medications set dose = '99g' where id = v_para;
    get diagnostics n = row_count;
    insert into probe_results (item, expected, actual, ok) values ('6.3 edit the dose of a prescribed medicine (crafted request)', 'refused', 'NOT refused, ' || n || ' row(s)', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.3 edit the dose of a prescribed medicine (crafted request)', 'refused', sqlerrm, true);
  end;
  begin
    update public.medications set stopped_at = now(), stopped_reason = 'S05f live probe stop' where id = v_vitc;
    get diagnostics n = row_count;
    insert into probe_results (item, expected, actual, ok) values ('6.3 patient stops a prescribed medicine', 'works (1 row)', n || ' row(s)', n = 1);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.3 patient stops a prescribed medicine', 'works (1 row)', 'FAILED: ' || sqlerrm, false);
  end;

  -- 6.4 log a dose, a symptom, a dangerous BP
  begin
    insert into public.medication_logs (organisation_id, patient_id, medication_id, status) values (c_org, c_patient, v_para, 'taken');
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a dose', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a dose', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    insert into public.symptoms (organisation_id, patient_id, symptom_type, severity) values (c_org, c_patient, 'pain', 5);
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a symptom', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a symptom', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic) values (c_org, c_patient, 'blood_pressure', 210, 130);
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a vitals reading (BP 210/130)', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.4 log a vitals reading (BP 210/130)', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  execute 'reset role';
  select count(*) into n1 from public.emergency_events where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('6.4 BP 210/130 raises an emergency event', 'one more emergency event', (n1 - n0) || ' new', n1 > n0);
  execute 'set local role authenticated';

  -- 6.5 vitals history
  select count(*) into n from public.vitals_readings where patient_id = c_patient;
  insert into probe_results (item, expected, actual, ok) values ('6.5 patient reads vitals history', '>= 7 rows', n || ' rows', n >= 7);

  -- 6.6 allergy add works; conditions read-only
  begin
    insert into public.patient_allergies (organisation_id, patient_id, allergen) values (c_org, c_patient, 'Probe allergen');
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient adds an allergy', 'saves', 'saved', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient adds an allergy', 'saves', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    select count(*) into n from public.patient_conditions where patient_id = c_patient;
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient reads conditions', 'no error', n || ' rows', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient reads conditions', 'no error', 'FAILED: ' || sqlerrm, false);
  end;
  begin
    insert into public.patient_conditions (organisation_id, patient_id, condition_name) values (c_org, c_patient, 'Probe condition');
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient writes a condition', 'refused (read-only)', 'NOT refused', false);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.6 patient writes a condition', 'refused (read-only)', sqlerrm, true);
  end;

  -- 6.7 data export log entry
  begin
    perform public.log_patient_data_export();
    insert into probe_results (item, expected, actual, ok) values ('6.7 data export is recorded', 'works', 'works', true);
  exception when others then
    insert into probe_results (item, expected, actual, ok) values ('6.7 data export is recorded', 'works', 'FAILED: ' || sqlerrm, false);
  end;
  execute 'reset role';
end $$;

select n, item, expected, actual, ok from probe_results order by n;
rollback;

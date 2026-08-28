-- ===========================================================================
-- Verification: medication_receipt_confirmations (20260827195857) — the
-- genuinely distinct "Patient received" event. A patient can record their
-- own receipt, it requires a medication_id or a pharmacy_order_dispense_id
-- (not neither), and it lands on patient_timeline as medication_received.
--
-- Run via `supabase db query "$(cat this_file.sql)" --linked`, `psql
-- $DATABASE_URL -f this_file.sql`, or the Supabase SQL editor.
-- Wrapped in BEGIN/ROLLBACK.
-- ===========================================================================

begin;

create temporary table mrc_fixture(k text primary key, v uuid) on commit drop;
create temporary table mrc_result(
  check_name text, role text, observed text, expected text, verdict text
) on commit drop;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_medication uuid;
begin
  select organisation_id into v_org
  from public.profiles
  where role = 'patient' and organisation_id is not null
  group by organisation_id order by count(*) desc limit 1;
  if v_org is null then
    raise exception 'no organisation has patient profiles — cannot run this test';
  end if;
  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source)
  values (v_org, v_patient, 'MRC Test Metformin', '500mg', 'twice daily', true, 'clinician')
  returning id into v_medication;

  insert into mrc_fixture(k, v) values ('org', v_org), ('patient', v_patient), ('medication', v_medication);
end $$;

-- ==========================================================================
-- 1. Neither medication_id nor pharmacy_order_dispense_id is rejected.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mrc_fixture where k = 'org');
  v_patient uuid := (select v from mrc_fixture where k = 'patient');
  v_caught boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.medication_receipt_confirmations (organisation_id, patient_id)
    values (v_org, v_patient);
  exception when others then
    v_caught := true;
  end;
  reset role;

  insert into mrc_result values
    ('rejects a row with no medication and no dispense context', 'patient',
     case when v_caught then 'rejected' else 'accepted' end, 'rejected',
     case when v_caught then 'PASS' else 'FAIL' end);
  if not v_caught then
    raise exception 'BROKEN: a context-less medication_receipt_confirmations row was accepted';
  end if;
end $$;

-- ==========================================================================
-- 2. Patient can record their own receipt (with a medication_id), and it
--    reaches the timeline as medication_received.
-- ==========================================================================
do $$
declare
  v_org uuid := (select v from mrc_fixture where k = 'org');
  v_patient uuid := (select v from mrc_fixture where k = 'patient');
  v_medication uuid := (select v from mrc_fixture where k = 'medication');
  v_id uuid;
  v_timeline_count bigint;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_patient::text, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.medication_receipt_confirmations
    (organisation_id, patient_id, medication_id, confirmation_source)
  values (v_org, v_patient, v_medication, 'patient_self_report')
  returning id into v_id;
  reset role;

  select count(*) into v_timeline_count from public.patient_timeline
    where source_table = 'medication_receipt_confirmations' and source_id = v_id
      and event_type = 'medication_received';

  insert into mrc_result values
    ('receipt confirmation reaches timeline', 'patient', v_timeline_count::text, '1',
     case when v_timeline_count = 1 then 'PASS' else 'FAIL' end);
  if v_timeline_count <> 1 then
    raise exception 'BROKEN: medication receipt confirmation did not create a medication_received timeline row';
  end if;
end $$;

select check_name, role, observed, expected, verdict
from mrc_result
order by verdict desc, check_name, role;

rollback;

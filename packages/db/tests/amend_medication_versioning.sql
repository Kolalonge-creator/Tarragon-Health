-- Tarragon Health
-- Live proof for 20260829010500_amend_medication.sql — spec §62.14 versioning
-- must be authority-gated exactly like an ordinary new prescription
-- (has_prescribing_authority), and the two-write supersede-then-insert must
-- be internally consistent (old row flagged, new row correctly linked).
--
-- Cases:
--   1. Medical Officer attempts to amend  -> BLOCKED (not authorised; Medical
--                                             Officer has no prescribing
--                                             authority, only Senior Medical
--                                             Officer+ does)
--   2. Senior Medical Officer amends -> old row superseded + inactive; new row
--                                        version=2, previous_version_id=old.id,
--                                        a fresh rx_number, amendment_reason stored
--   3. Amending an already-superseded row (the old v1) -> BLOCKED (already amended)
--   4. Empty amendment_reason        -> BLOCKED
--   5. Patient cannot amend a clinician-issued prescription -> BLOCKED
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: change
-- amend_medication's SECURITY INVOKER to SECURITY DEFINER. Case 1 must FAIL,
-- showing a Medical Officer amending a prescription under an elevated identity.
--
-- Case 6 (added 2026-09-18, 20260918085308_wire_audit_reason_and_denied_action_logging.sql):
-- proves public.log_denied_action() durably records case 1's denial the way the app layer
-- actually does it -- as its OWN separate call, right after catching amend_medication's 42501 --
-- rather than something amend_medication itself could log before raising (a same-transaction
-- "log then raise" would just roll the log entry back too; see that migration's header).
--
-- Run: npx supabase db query --linked -f packages/db/tests/amend_medication_versioning.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org       uuid := '00000000-0000-0000-0000-000000000001';
  v_pat       uuid;
  v_clin      uuid;
  v_staff_id  uuid;
  v_med       uuid;
  v_rx1       text;
  v_new_id    uuid;
  v_raised    text;
begin
  select id into v_pat from public.profiles
   where role = 'patient' and organisation_id = v_org limit 1;

  select p.id into v_clin from public.profiles p
   where p.organisation_id = v_org
     and p.role = 'clinician'
     and p.id <> v_pat
     and not exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id)
   limit 1;

  if v_pat is null or v_clin is null then
    raise exception
      'Need one patient and one clinician-role profile with no clinical_staff row in org %', v_org;
  end if;

  insert into public.clinical_staff (
    organisation_id, profile_id, full_name, active, license_verified_at,
    doctor_tier,
    indemnity_insurer, indemnity_policy_number, indemnity_expires_at
  ) values (
    v_org, v_clin, 'Amend Medication Probe', true, now(),
    'medical_officer',
    'Probe Indemnity Ltd', 'PROBE-AMEND-RX', now() + interval '1 year'
  ) returning id into v_staff_id;

  insert into public.medications (
    organisation_id, patient_id, drug_name, dose, frequency, source, is_active
  ) values (
    v_org, v_pat, 'Amend Probe Drug', '5mg', 'daily', 'clinician', true
  ) returning id, rx_number into v_med, v_rx1;

  ---------------------------------------------------------------- case 1
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Dose review', p_dose => '10mg');
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (1, 'Medical Officer attempts to amend -> BLOCKED',
    case when v_raised is not null and (select version from public.medications where id = v_med) = 1
      then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 6
  -- public.log_denied_action(), called standalone the way
  -- apps/web/src/lib/audit/log-denied-action.ts calls it right after the app
  -- layer catches case 1's 42501 -- proves the denial row actually survives
  -- as its own audit_log entry (a same-transaction "log inside
  -- amend_medication, then raise" cannot, per this migration's header).
  -- v_clin is still a Medical Officer here (case 2 below upgrades it), so
  -- this reuses the exact denied attempt case 1 just proved.
  declare
    v_denied_id uuid;
    v_denied_row record;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    select public.log_denied_action(
      'medications.amendment_denied', 'medications', v_med, v_org,
      'Prescription amendment attempted without prescribing authority'
    ) into v_denied_id;
    perform set_config('request.jwt.claims', '', true);

    select * into v_denied_row from public.audit_log where id = v_denied_id;

    insert into test_result values (6, 'log_denied_action() durably records case 1''s denied amendment attempt',
      case when v_denied_row.result = 'denied'
        and v_denied_row.actor_id = v_clin
        and v_denied_row.entity_type = 'medications'
        and v_denied_row.entity_id = v_med
        and v_denied_row.reason = 'Prescription amendment attempted without prescribing authority'
        then 'PASS' else 'FAIL' end,
      'result=' || coalesce(v_denied_row.result, 'null') || ' actor_id=' || coalesce(v_denied_row.actor_id::text, 'null'));
  exception when others then
    perform set_config('request.jwt.claims', '', true);
    insert into test_result values (6, 'log_denied_action() durably records case 1''s denied amendment attempt', 'FAIL', sqlerrm);
  end;

  ---------------------------------------------------------------- case 2
  update public.clinical_staff set doctor_tier = 'senior_medical_officer' where id = v_staff_id;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.amend_medication(v_med, 'Dose increased after review', p_dose => '10mg') into v_new_id;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (2, 'Senior Medical Officer amends -> old superseded, new v2 correctly linked',
    case when v_new_id is not null
      and (select is_active from public.medications where id = v_med) = false
      and (select superseded_at from public.medications where id = v_med) is not null
      and (select version from public.medications where id = v_new_id) = 2
      and (select previous_version_id from public.medications where id = v_new_id) = v_med
      and (select dose from public.medications where id = v_new_id) = '10mg'
      and (select rx_number from public.medications where id = v_new_id) is distinct from v_rx1
      and (select amendment_reason from public.medications where id = v_new_id) = 'Dose increased after review'
      then 'PASS' else 'FAIL' end,
    'new_id=' || coalesce(v_new_id::text, 'null'));

  ---------------------------------------------------------------- case 3
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_med, 'Second attempt on stale version');
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (3, 'Amending an already-superseded row -> BLOCKED',
    case when v_raised like '%already been amended%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 4
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_new_id, '   ');
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (4, 'Empty amendment_reason -> BLOCKED',
    case when v_raised like '%reason for the amendment is required%' then 'PASS' else 'FAIL' end,
    coalesce(v_raised, 'no error raised'));

  ---------------------------------------------------------------- case 5
  v_raised := null;
  begin
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
    perform set_config('role', 'authenticated', true);
    perform public.amend_medication(v_new_id, 'Patient tries to amend their own prescription');
  exception when others then
    v_raised := sqlerrm;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  insert into test_result values (5, 'Patient cannot amend a clinician-issued prescription -> BLOCKED',
    case when v_raised is not null and (select version from public.medications where id = v_new_id) = 2
      then 'PASS' else 'FAIL' end, coalesce(v_raised, 'no error raised'));
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;

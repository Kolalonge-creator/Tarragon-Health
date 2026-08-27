-- Tarragon Health
-- Live proof for 20260826225518_clinical_incident_near_miss_log.sql.
--
-- Five cases in one rolled-back transaction:
--   1. Care Coordinator FILES a near-miss report          -> ALLOWED
--      (this is the point -- anyone can report a near-miss)
--   2. Care Coordinator tries to CLOSE a report            -> BLOCKED
--   3. Tier 3 closes without outcome/corrective_action     -> BLOCKED
--   4. Tier 3 closes properly, with both fields            -> ALLOWED
--   5. Anyone tries to re-open/edit the closed report      -> BLOCKED
--
-- Run: npx supabase db query --linked -f packages/db/tests/clinical_incident_near_miss_log.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid; v_t3 uuid; v_cc uuid;
  v_report_a uuid;
  v_blocked boolean; v_err text; v_state text; v_status text;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select profile_id into v_t3 from public.clinical_staff
    where organisation_id = v_org and doctor_tier = 'tier_3' and profile_id is not null limit 1;
  select profile_id into v_cc from public.clinical_staff
    where organisation_id = v_org and doctor_tier = 'care_coordinator' and profile_id is not null limit 1;
  if v_t3 is null or v_cc is null then
    raise exception 'expected seeded tier_3/care_coordinator clinical_staff fixtures with a profile_id in org 0001';
  end if;
  update public.clinical_staff set active = true, license_verified_at = now() where profile_id in (v_t3, v_cc);

  ---------------------------------------------------------------------------
  -- 1. Care Coordinator files a near-miss report -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.clinical_incident_reports (organisation_id, patient_id, category, severity, description)
    values (v_org, v_pat, 'communication_breakdown', 'near_miss', 'CC noticed a missed handoff note')
    returning id into v_report_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Care Coordinator files a near-miss report', 'ALLOWED',
    case when not v_blocked and v_report_a is not null then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 2. Care Coordinator tries to close it -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_incident_reports set status = 'closed', review_outcome = 'no action', corrective_action = 'none' where id = v_report_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'Care Coordinator closes a report', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 3. Tier 3 closes without outcome/corrective_action -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_incident_reports set status = 'closed' where id = v_report_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'Tier 3 closes without outcome/corrective_action', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. Tier 3 closes properly, with attribution -> ALLOWED, server-stamped
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_incident_reports
      set status = 'closed', review_outcome = 'Handoff process gap confirmed', corrective_action = 'Added checklist step'
      where id = v_report_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.clinical_incident_reports where id = v_report_a;
  insert into test_result values (4, 'Tier 3 closes properly', 'ALLOWED, status=closed',
    case when not v_blocked and v_status = 'closed' then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 5. Re-open/edit the closed report -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.clinical_incident_reports set status = 'open' where id = v_report_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'Re-open a closed report', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));
end $$;

select case_num, label, expected, outcome, left(detail, 150) as detail
from test_result order by case_num;

rollback;

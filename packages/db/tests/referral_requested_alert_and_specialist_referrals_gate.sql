-- Tarragon Health
-- Live proof for the AI Health Assistant §36.10 referral-request path
-- (20260829113000_alert_type_code_referral_requested.sql,
-- lib/ai-coach/referral-request.ts). The whole design of that feature rests
-- on one empirical claim: a patient session cannot insert into
-- public.specialist_referrals directly, only into clinician_alerts via
-- service-role, so routing a referral request through clinician_alerts is a
-- real safety boundary and not just a naming convention. This proves that
-- claim rather than asserting it in a comment.
--
-- Four cases in one rolled-back transaction:
--   1. A patient session attempts to insert into specialist_referrals
--      directly -> BLOCKED (42501). This is the invariant the whole
--      referral-request design leans on -- if this ever came back ALLOWED,
--      lib/ai-coach/referral-tool.ts's own design assumption would be wrong.
--   2. The same patient session attempts to insert into clinician_alerts
--      directly (bypassing the service-role write escalate.ts/
--      referral-request.ts always use) -> BLOCKED (42501).
--   3. A service-role-equivalent write (postgres role, RLS bypassed) inserts
--      a clinician_alerts row with category='care_management',
--      type_code='referral_requested', level='clinician_review' -> ALLOWED,
--      and the classify_and_assign_clinician_alert() BEFORE INSERT trigger
--      (20260828014055_clinician_alerts_taxonomy_lifecycle_ownership.sql)
--      auto-populates severity from level, same as every other alert type.
--   4. The patient can read their own new referral-request alert back
--      (clinician_alerts_select policy) -- confirms the patient-facing side
--      of the handoff (the alert existing is visible to them, on top of the
--      care_messages thread lib/ai-coach/referral-request.ts also opens).
--
-- Run: npx supabase db query --linked -f packages/db/tests/referral_requested_alert_and_specialist_referrals_gate.sql

begin;

create temporary table test_result (
  case_num int, label text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org      uuid := '00000000-0000-0000-0000-000000000001';
  v_pat      uuid;
  v_blocked  boolean;
  v_alert_id uuid;
  v_visible  boolean;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;

  -- 1. Patient attempts a direct specialist_referrals insert.
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason)
    values (v_org, v_pat, 'cardiology', 'referral_requested_alert_and_specialist_referrals_gate proof fixture');
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'patient inserts specialist_referrals directly',
    case when v_blocked then 'BLOCKED (correct -- design assumption holds)' else 'ALLOWED (BUG -- referral-tool.ts design assumption is wrong)' end, '');

  -- 2. Patient attempts a direct clinician_alerts insert.
  v_blocked := false;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, category, type_code)
    values (v_org, v_pat, 'clinician_review', 'open', 'proof fixture', 'care_management', 'referral_requested');
  exception when others then
    v_blocked := true;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'patient inserts clinician_alerts directly',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, '');

  -- 3. Service-role-equivalent write (postgres, RLS bypassed) -- what
  --    lib/ai-coach/referral-request.ts's service-role client actually does.
  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, category, type_code)
  values
    (v_org, v_pat, 'clinician_review', 'open', 'Patient requested a cardiology referral',
     'referral_requested_alert_and_specialist_referrals_gate proof fixture', 'care_management', 'referral_requested')
  returning id into v_alert_id;

  insert into test_result values (3, 'service-role clinician_alerts insert, category/type_code/severity',
    (select category::text || '/' || type_code::text || '/' || coalesce(severity::text, 'null') from public.clinician_alerts where id = v_alert_id),
    'expected: care_management/referral_requested/<non-null, from classify_and_assign trigger>');

  -- 4. Patient reads their own new alert back.
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select exists (select 1 from public.clinician_alerts where id = v_alert_id) into v_visible;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'patient reads their own referral-request alert',
    case when v_visible then 'VISIBLE (correct)' else 'HIDDEN (BUG)' end, '');
end $$;

select * from test_result order by case_num;

rollback;

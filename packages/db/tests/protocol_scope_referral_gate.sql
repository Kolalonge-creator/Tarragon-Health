-- Tarragon Health
-- Live proof for 20260826225042_protocol_scope_referral_gate.sql.
--
-- Four cases in one rolled-back transaction:
--   1. Resolve a case flagged protocol_scope_exceeded         -> BLOCKED
--   2. Refer the same case with NO real specialist_referrals  -> BLOCKED
--   3. Create a real referral, then refer the case            -> ALLOWED
--   4. CONTROL: a normal, in-scope case can still be resolved -> ALLOWED
--
-- Run: npx supabase db query --linked -f packages/db/tests/protocol_scope_referral_gate.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid; v_t3 uuid;
  v_alert_a uuid; v_alert_b uuid; v_alert_c uuid;
  v_esc_a uuid; v_esc_b uuid; v_esc_c uuid;
  v_referral_id uuid;
  v_blocked boolean; v_err text; v_state text; v_status text;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select profile_id into v_t3 from public.clinical_staff
    where organisation_id = v_org and doctor_tier = 'tier_3' and profile_id is not null limit 1;
  if v_t3 is null then
    raise exception 'expected a seeded tier_3 clinical_staff fixture with a profile_id in org 0001';
  end if;
  update public.clinical_staff set active = true, license_verified_at = now() where profile_id = v_t3;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, protocol_scope_exceeded, protocol_scope_exceeded_note, protocol_scope_exceeded_at)
  values (v_org, v_pat, 'clinician_review', 'open', 'proof: out of scope, no referral', true, 'BP 210/130 breach', now())
  returning id into v_alert_a;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, protocol_scope_exceeded, protocol_scope_exceeded_note, protocol_scope_exceeded_at)
  values (v_org, v_pat, 'clinician_review', 'open', 'proof: out of scope, WITH referral', true, 'BP 210/130 breach', now())
  returning id into v_alert_b;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'clinician_review', 'open', 'proof: normal case, in scope')
  returning id into v_alert_c;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_a, 'open', v_t3, 'proof: try to resolve out-of-scope') returning id into v_esc_a;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_b, 'open', v_t3, 'proof: refer out-of-scope with real referral') returning id into v_esc_b;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_c, 'open', v_t3, 'proof: normal resolve still works') returning id into v_esc_c;

  ---------------------------------------------------------------------------
  -- 1. Resolve an out-of-protocol-scope case -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'resolved', resolution_note = 'trying to close anyway' where id = v_esc_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Resolve an out-of-protocol-scope case', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 2. Refer the same case with NO real referral row -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'referring, but no referral row exists' where id = v_esc_a;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'Refer out-of-scope case with NO referral row', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 3. Create a real referral, then refer -> ALLOWED
  ---------------------------------------------------------------------------
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, set_by)
  values (v_org, v_pat, 'cardiology', 'BP 210/130, out of protocol scope', v_t3)
  returning id into v_referral_id;

  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'referred to cardiology' where id = v_esc_b;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.escalations where id = v_esc_b;
  insert into test_result values (3, 'Refer out-of-scope case WITH real referral row', 'ALLOWED',
    case when not v_blocked and v_status = 'referred' then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. CONTROL: a normal, in-scope case can still be resolved
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'resolved', resolution_note = 'normal resolve' where id = v_esc_c;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.escalations where id = v_esc_c;
  insert into test_result values (4, 'CONTROL: resolve a normal in-scope case', 'ALLOWED',
    case when not v_blocked and v_status = 'resolved' then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));
end $$;

select case_num, label, expected, outcome, left(detail, 150) as detail
from test_result order by case_num;

rollback;

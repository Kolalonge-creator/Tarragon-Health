-- Tarragon Health
-- Live proof for 20260828234512_activate_partner_specialist_booking.sql —
-- set_referral_specialist_provider becoming real again once a genuine
-- active partner exists ("Dormant, not deleted. Contracting a specialist
-- is an is_active flip.", 20260803142941).
--
-- Six cases in one rolled-back transaction. Every negative is paired with a
-- positive control:
--   1. Assign an active, specialty-matched provider to a pending referral
--      -> ALLOWED: fulfilment -> partner, fee locked from the PROVIDER row
--      (not any caller-supplied value), status -> pending_payment
--   2. Assign an INACTIVE provider                    -> BLOCKED (23514)
--   3. Assign a provider whose specialist_type does
--      NOT match the referral's specialty              -> BLOCKED (23514)
--   4. Assign to a referral that has already moved
--      past assignment (status booked)                 -> BLOCKED (23514)
--   5. A caller who is not org staff attempts to
--      assign                                           -> BLOCKED (42501)
--   6. Assigning a waitlisted referral (not just a
--      fresh pending one) also works                    -> ALLOWED (control:
--      the RPC's status check admits both assignable states)
--
-- TO CONFIRM THIS TEST DISCRIMINATES, break it on purpose: change
-- `if v_provider.id is null or not v_provider.is_active then` to always
-- pass (e.g. `if false then`). Case 2 must FAIL, showing an inactive
-- provider getting assigned.
--
-- Run: npx supabase db query --linked -f packages/db/tests/specialist_referral_partner_booking.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_pat        uuid;
  v_staff      uuid;
  v_outsider   uuid;
  v_prov_active   uuid;
  v_prov_inactive uuid;
  v_prov_wrong_type uuid;
  v_ref_a      uuid;
  v_ref_b      uuid;
  v_ref_c      uuid;
  v_ref_d      uuid;
  v_ref_e      uuid;
  v_ref_f      uuid;
  v_blocked    boolean;
  v_err        text;
  v_fulfilment text;
  v_status     text;
  v_fee        bigint;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select id into v_staff from public.profiles
    where role::text in ('clinician', 'admin', 'doctor') and organisation_id = v_org
    order by created_at limit 1;
  if v_staff is null then
    raise exception 'need at least one org-staff profile in org 0001';
  end if;

  -- A patient profile makes a fine "not org staff" negative-control caller —
  -- private.is_org_staff excludes role='patient' outright.
  v_outsider := v_pat;

  insert into public.specialist_providers
    (name, specialist_type, state, consultation_fee_kobo, supports_telemedicine, is_active)
  values
    ('Referral Engine Proof Active Cardiologist', 'cardiology', 'Lagos', 5000000, true, true)
  returning id into v_prov_active;

  insert into public.specialist_providers
    (name, specialist_type, state, consultation_fee_kobo, supports_telemedicine, is_active)
  values
    ('Referral Engine Proof Inactive Cardiologist', 'cardiology', 'Lagos', 4000000, true, false)
  returning id into v_prov_inactive;

  insert into public.specialist_providers
    (name, specialist_type, state, consultation_fee_kobo, supports_telemedicine, is_active)
  values
    ('Referral Engine Proof Active Endocrinologist', 'endocrinology', 'Lagos', 6000000, true, true)
  returning id into v_prov_wrong_type;

  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, referral_reason, status)
  values
    (v_org, v_pat, 'cardiology', 'partner booking proof: happy path', 'pending'),
    (v_org, v_pat, 'cardiology', 'partner booking proof: inactive provider', 'pending'),
    (v_org, v_pat, 'cardiology', 'partner booking proof: wrong specialty', 'pending'),
    (v_org, v_pat, 'cardiology', 'partner booking proof: already booked', 'booked'),
    (v_org, v_pat, 'cardiology', 'partner booking proof: outsider', 'pending'),
    (v_org, v_pat, 'cardiology', 'partner booking proof: waitlisted control', 'pending');

  select id into v_ref_a from public.specialist_referrals where referral_reason = 'partner booking proof: happy path';
  select id into v_ref_b from public.specialist_referrals where referral_reason = 'partner booking proof: inactive provider';
  select id into v_ref_c from public.specialist_referrals where referral_reason = 'partner booking proof: wrong specialty';
  select id into v_ref_d from public.specialist_referrals where referral_reason = 'partner booking proof: already booked';
  select id into v_ref_e from public.specialist_referrals where referral_reason = 'partner booking proof: outsider';
  select id into v_ref_f from public.specialist_referrals where referral_reason = 'partner booking proof: waitlisted control';

  -- The waitlist_requires_plan CHECK needs status + interim_management_plan
  -- set together in the same statement.
  update public.specialist_referrals
  set status = 'waitlisted', interim_management_plan = 'proof fixture', waitlisted_at = now()
  where id = v_ref_f;

  ---------------------------------------------------------------------------
  -- 1. Happy path -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_a, v_prov_active);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select fulfilment::text, status::text, referral_fee_kobo into v_fulfilment, v_status, v_fee
  from public.specialist_referrals where id = v_ref_a;
  insert into test_result values (1, 'Assign an active specialty-matched provider', 'ALLOWED',
    case when not v_blocked and v_fulfilment = 'partner' and v_status = 'pending_payment' and v_fee = 5000000
      then 'ALLOWED, fulfilment/status/fee correct (correct)' else 'FAILED (BUG)' end,
    'blocked=' || v_blocked || ' err=' || coalesce(v_err, 'none') ||
      ' fulfilment=' || coalesce(v_fulfilment, 'null') ||
      ' status=' || coalesce(v_status, 'null') ||
      ' fee=' || coalesce(v_fee::text, 'null'));

  ---------------------------------------------------------------------------
  -- 2. Inactive provider -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_b, v_prov_inactive);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'Assign an inactive provider', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 3. Specialty mismatch -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_c, v_prov_wrong_type);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (3, 'Assign a provider of the wrong specialist_type', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 4. Referral already past assignment (status booked) -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_d, v_prov_active);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Assign to a referral already past assignment (booked)', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 5. Non-org-staff caller -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_e, v_prov_active);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (5, 'Non-org-staff (patient) attempts to assign', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, 'no exception'));

  ---------------------------------------------------------------------------
  -- 6. Waitlisted referral can also be assigned -> ALLOWED (control)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    perform public.set_referral_specialist_provider(v_ref_f, v_prov_active);
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  select fulfilment::text into v_fulfilment from public.specialist_referrals where id = v_ref_f;
  insert into test_result values (6, 'Assign a waitlisted referral', 'ALLOWED',
    case when not v_blocked and v_fulfilment = 'partner' then 'ALLOWED (correct)' else 'FAILED (BUG)' end,
    'blocked=' || v_blocked || ' err=' || coalesce(v_err, 'none') || ' fulfilment=' || coalesce(v_fulfilment, 'null'));
end $$;

select
  'CASE ' || case_num || ' [' || outcome || '] ' || label ||
    case when detail = '' then '' else ' -- ' || detail end as line
from test_result
order by case_num;

rollback;

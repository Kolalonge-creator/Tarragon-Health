-- Tarragon Health
-- Live proof for 20260731021500_emergency_escalation_tier_gate.sql --
-- emergency escalations can only be CLAIMED or RESOLVED by Tier 2+ or the
-- org's Clinical Director, after the doctor->clinician account role merge
-- (20260731020000) removed the accidental authority gate that the old
-- role split was providing.
--
-- Eight cases in one rolled-back transaction. Every negative is paired with
-- a positive control, per CLAUDE.md's own rule -- a blocked-everything
-- trigger would otherwise pass a negatives-only test:
--   1. Tier 1 claims an EMERGENCY escalation            -> BLOCKED (42501)
--   2. Tier 1 claims a clinician_review escalation      -> ALLOWED (control: gate is emergency-only)
--   3. Tier 2 claims the same emergency escalation      -> ALLOWED (control: the gate is about tier, not about emergencies being unclaimable)
--   4. Tier 1 resolves an emergency escalation          -> BLOCKED, and blocked by the TIER trigger, not I5's synchronous-contact trigger
--   5. Tier 1 marks an emergency escalation 'referred'  -> ALLOWED (handing it on is not closing it)
--   6. level=clinician_review, override_level=emergency -> Tier 1 claim BLOCKED (an override UP engages the gate)
--   7. level=emergency, override_level=routine          -> Tier 1 claim STILL BLOCKED (the override-down bypass is closed)
--   8. Clinical Director (no doctor_tier at all)        -> ALLOWED (control: is_clinical_director alone satisfies the gate)
--
-- NOTE: as of 2026-07-31 only ONE clinical_staff row exists platform-wide
-- (the founder's own) -- the 2026-07-27 QA roster lost its clinical_staff
-- rows in the 2026-07-29 DB rebuild and was never re-provisioned. This test
-- therefore builds every clinical_staff fixture it needs inside the
-- transaction rather than relying on a named QA account, same as
-- clinician_alert_override.sql.
--
-- Run: npx supabase db query --linked -f packages/db/tests/emergency_escalation_tier_gate.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org        uuid := '00000000-0000-0000-0000-000000000001';
  v_pat        uuid;
  v_t1         uuid;  -- profile that will hold a Tier 1 clinical_staff row
  v_t2         uuid;  -- profile that will hold a Tier 2 clinical_staff row
  v_dir        uuid;  -- profile that will hold a Clinical Director row, no tier
  v_alert_emg  uuid;
  v_alert_rev  uuid;
  v_alert_up   uuid;
  v_alert_down uuid;
  v_esc_emg    uuid;
  v_esc_rev    uuid;
  v_esc_up     uuid;
  v_esc_down   uuid;
  v_esc_ref    uuid;
  v_esc_dir    uuid;
  v_blocked    boolean;
  v_err        text;
  v_state      text;
  v_assigned   uuid;
  v_status     text;
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  -- Three distinct staff profiles. NOT merely "role <> 'patient'": a first
  -- draft of this test used that and case 8 failed with an EMPTY error --
  -- zero rows updated, because private.is_org_staff excludes seven roles
  -- (corporate_admin, hmo_admin, pharmacist, lab_partner, lab_liaison,
  -- finance, analyst) and the third profile it happened to pick was one of
  -- them. That is escalations' own RLS refusing the row before any trigger
  -- runs, which would have read as a gate bug. Restrict to roles
  -- is_org_staff actually admits.
  --
  -- role::text, not role, so this keeps working across 20260731020000's
  -- user_role enum rebuild, which drops the 'doctor' value.
  select id into v_t1  from public.profiles
    where role::text in ('clinician','admin','doctor') and organisation_id = v_org
    order by created_at limit 1;
  select id into v_t2  from public.profiles
    where role::text in ('clinician','admin','doctor') and organisation_id = v_org and id <> v_t1
    order by created_at limit 1;
  select id into v_dir from public.profiles
    where role::text in ('clinician','admin','doctor') and organisation_id = v_org and id not in (v_t1, v_t2)
    order by created_at limit 1;
  if v_t2 is null or v_dir is null then
    raise exception 'need at least 3 org-staff profiles (clinician/admin/doctor) in org 0001 to build this fixture';
  end if;

  -- Clear any pre-existing clinical_staff rows for these three profiles for
  -- the life of this transaction, so the fixture below is the only thing the
  -- gate can see (the founder's real Director row would otherwise make a
  -- "Tier 1" fixture silently pass).
  delete from public.clinical_staff where profile_id in (v_t1, v_t2, v_dir);

  -- private.enforce_clinical_staff_indemnity() only requires indemnity cover
  -- (or an exemption) for is_clinical_director=true or tier_4/tier_5 rows --
  -- Tier 1/Tier 2 are unaffected either way, but the Director fixture below
  -- needs a real exemption (indemnity_exempt + a distinct indemnity_exempt_by
  -- grantor -- clinical_staff_no_self_indemnity_exemption forbids granting
  -- your own exemption) or it fails 20260715175909's activation check. Same
  -- shape as the already-passing Director fixtures in
  -- packages/db/tests/escalation_slas_config.sql and
  -- vaccination_schedule_signoff.sql.
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier, is_clinical_director, indemnity_exempt, indemnity_exempt_by)
  values
    (v_org, v_t1,  'Tier One Gate Fixture',   true, now(), 'tier_1', false, false, null),
    (v_org, v_t2,  'Tier Two Gate Fixture',   true, now(), 'tier_2', false, false, null),
    (v_org, v_dir, 'Director Gate Fixture',   true, now(), null,     true,  true,  v_t1);

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'tier gate proof: emergency')
  returning id into v_alert_emg;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'clinician_review', 'open', 'tier gate proof: routine review')
  returning id into v_alert_rev;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, override_level, override_reason)
  values (v_org, v_pat, 'clinician_review', 'open', 'tier gate proof: overridden UP', 'emergency', 'Worse than auto-triage caught')
  returning id into v_alert_up;

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title, override_level, override_reason)
  values (v_org, v_pat, 'emergency', 'open', 'tier gate proof: overridden DOWN', 'routine', 'Believed a false positive')
  returning id into v_alert_down;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values
    (v_org, v_pat, v_alert_emg,  'open', v_t2, 'emergency, for claim test'),
    (v_org, v_pat, v_alert_rev,  'open', v_t2, 'clinician_review control'),
    (v_org, v_pat, v_alert_up,   'open', v_t2, 'overridden up control'),
    (v_org, v_pat, v_alert_down, 'open', v_t2, 'overridden down control'),
    (v_org, v_pat, v_alert_emg,  'open', v_t2, 'emergency, for referred test'),
    (v_org, v_pat, v_alert_emg,  'open', v_t2, 'emergency, for director test');

  select id into v_esc_emg  from public.escalations where reason = 'emergency, for claim test';
  select id into v_esc_rev  from public.escalations where reason = 'clinician_review control';
  select id into v_esc_up   from public.escalations where reason = 'overridden up control';
  select id into v_esc_down from public.escalations where reason = 'overridden down control';
  select id into v_esc_ref  from public.escalations where reason = 'emergency, for referred test';
  select id into v_esc_dir  from public.escalations where reason = 'emergency, for director test';

  ---------------------------------------------------------------------------
  -- 1. Tier 1 claims an emergency -> BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_t1, status = 'under_review' where id = v_esc_emg;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (1, 'Tier 1 claims EMERGENCY', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)'
         when v_blocked then 'BLOCKED but wrong sqlstate ' || v_state
         else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 2. CONTROL: Tier 1 claims a clinician_review escalation -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_t1, status = 'under_review' where id = v_esc_rev;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select assigned_doctor_id into v_assigned from public.escalations where id = v_esc_rev;
  insert into test_result values (2, 'CONTROL Tier 1 claims clinician_review', 'ALLOWED',
    case when not v_blocked and v_assigned = v_t1 then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 3. CONTROL: Tier 2 claims the emergency -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t2, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_t2, status = 'under_review' where id = v_esc_emg;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select assigned_doctor_id into v_assigned from public.escalations where id = v_esc_emg;
  insert into test_result values (3, 'CONTROL Tier 2 claims EMERGENCY', 'ALLOWED',
    case when not v_blocked and v_assigned = v_t2 then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. Tier 1 resolves an emergency (now claimed by Tier 2) -> BLOCKED,
  --    and specifically by the TIER trigger, not I5's synchronous-contact
  --    trigger. Asserted on the message, since both would block.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations
    set status = 'resolved', resolution_note = 'Tier 1 attempting to close an emergency',
        reviewed_by = v_t1, reviewed_at = now()
    where id = v_esc_emg;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Tier 1 resolves EMERGENCY', 'BLOCKED 42501, tier message wins over I5',
    case when v_blocked and v_state = '42501' and v_err like '%Tier 2 doctor or above%' then 'BLOCKED by tier gate (correct)'
         when v_blocked then 'BLOCKED but by the wrong trigger (' || v_state || ')'
         else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 5. CONTROL: Tier 1 marks an emergency 'referred' -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'Handing to a senior colleague'
    where id = v_esc_ref;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.escalations where id = v_esc_ref;
  insert into test_result values (5, 'CONTROL Tier 1 REFERS an emergency', 'ALLOWED',
    case when not v_blocked and v_status = 'referred' then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 6. Overridden UP (clinician_review -> emergency): Tier 1 claim BLOCKED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_t1, status = 'under_review' where id = v_esc_up;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (6, 'Tier 1 claims alert overridden UP to emergency', 'BLOCKED',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 7. Overridden DOWN (emergency -> routine): Tier 1 claim STILL BLOCKED.
  --    This is the bypass case -- a Tier 1 can legitimately override, so
  --    coalesce(override_level, level) alone would hand them the case.
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_t1, status = 'under_review' where id = v_esc_down;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  insert into test_result values (7, 'Tier 1 claims emergency overridden DOWN to routine', 'BLOCKED (bypass closed)',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG -- override bypass is open)' end, coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 8. CONTROL: Clinical Director with NO doctor_tier claims an emergency
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_dir, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set assigned_doctor_id = v_dir, status = 'under_review' where id = v_esc_dir;
  exception when others then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  select assigned_doctor_id into v_assigned from public.escalations where id = v_esc_dir;
  insert into test_result values (8, 'CONTROL Clinical Director (no tier) claims EMERGENCY', 'ALLOWED',
    case when not v_blocked and v_assigned = v_dir then 'ALLOWED (correct)' else 'BLOCKED (BUG)' end, coalesce(v_err, ''));
end $$;

select case_num, label, expected, outcome, left(detail, 120) as detail
from test_result order by case_num;

rollback;

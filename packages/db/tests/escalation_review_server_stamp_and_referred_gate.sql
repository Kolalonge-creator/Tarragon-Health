-- Tarragon Health
-- Live proof for 20260826224252_escalation_review_server_stamp_and_referred_gate.sql
-- and its correction 20260826224420_fix_escalation_referred_gate_emergency_scope.sql.
--
-- Four cases in one rolled-back transaction, with a regression control from
-- packages/db/tests/emergency_escalation_tier_gate.sql's own case 5 --
-- the first draft of this fix broke that case (see the "fix_" migration's
-- header) by routing 'referred' through the Tier 2+/Director emergency gate,
-- which is exactly backwards for patient safety: a junior doctor must always
-- be able to hand an emergency case up the chain.
--
--   1. REGRESSION CONTROL: Tier 1 refers an EMERGENCY case away -> ALLOWED
--      (referring is not closing; must never require extra seniority)
--   2. Care Coordinator refers a routine (non-emergency) case   -> BLOCKED
--      (the gap this migration closes -- 'referred' had NO tier check before)
--   3. Tier 3 resolves a case, client sends a spoofed reviewed_by
--      -> server overwrites it to the ACTUAL caller, ignoring the client value
--   4. A second doctor tries to change an already-resolved case's outcome
--      -> BLOCKED (no retroactive attribution -- a decided case is history)
--
-- Uses the platform's existing seeded tier_1/tier_3/care_coordinator
-- clinical_staff fixtures (temporarily overridden, not deleted+reinserted --
-- by 2026-08-26 those rows are referenced from patient_timeline and other
-- tables via three weeks of real activity, so a delete+reinsert like the
-- 2026-07-31 emergency_escalation_tier_gate.sql test used now fails on FK).
-- Safe because the whole transaction rolls back.
--
-- Run: npx supabase db query --linked -f packages/db/tests/escalation_review_server_stamp_and_referred_gate.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int, label text, expected text, outcome text, detail text
) on commit drop;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_pat uuid;
  v_t1 uuid; v_t3 uuid; v_cc uuid;
  v_alert_emg uuid; v_alert_rev uuid;
  v_esc_ref uuid; v_esc_rev_cc uuid; v_esc_rev_t3 uuid; v_esc_redecide uuid;
  v_blocked boolean; v_err text; v_state text; v_status text;
  v_reviewed_by uuid; v_reviewed_at timestamptz;
  v_fake_reviewer uuid := gen_random_uuid();
begin
  select id into v_pat from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  if v_pat is null then
    raise exception 'no patient profile in org 0001 to build a fixture against';
  end if;

  select profile_id into v_t1 from public.clinical_staff where organisation_id = v_org and doctor_tier = 'tier_1' and profile_id is not null limit 1;
  select profile_id into v_t3 from public.clinical_staff where organisation_id = v_org and doctor_tier = 'tier_3' and profile_id is not null limit 1;
  select profile_id into v_cc from public.clinical_staff where organisation_id = v_org and doctor_tier = 'care_coordinator' and profile_id is not null limit 1;
  if v_t1 is null or v_t3 is null or v_cc is null then
    raise exception 'expected seeded tier_1/tier_3/care_coordinator clinical_staff fixtures with a profile_id in org 0001 (t1=% t3=% cc=%)', v_t1, v_t3, v_cc;
  end if;

  update public.clinical_staff set active = true, license_verified_at = now()
  where profile_id in (v_t1, v_t3, v_cc);

  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'proof: emergency for referred test')
  returning id into v_alert_emg;
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'clinician_review', 'open', 'proof: routine for CC-referred-block test')
  returning id into v_alert_rev;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_emg, 'open', v_t3, 'proof: tier1 refers emergency')
  returning id into v_esc_ref;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_rev, 'open', v_t3, 'proof: CC tries to refer routine')
  returning id into v_esc_rev_cc;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_rev, 'open', v_t1, 'proof: tier3 resolves, spoofed reviewer')
  returning id into v_esc_rev_t3;
  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_rev, 'open', v_t1, 'proof: redecide after resolved')
  returning id into v_esc_redecide;

  ---------------------------------------------------------------------------
  -- 1. REGRESSION CONTROL: Tier 1 refers an EMERGENCY case away -> ALLOWED
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'handing to senior colleague' where id = v_esc_ref;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  select status into v_status from public.escalations where id = v_esc_ref;
  insert into test_result values (1, 'REGRESSION CONTROL: Tier 1 refers EMERGENCY', 'ALLOWED',
    case when not v_blocked and v_status = 'referred' then 'ALLOWED (correct)' else 'BLOCKED (REGRESSION BUG)' end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 2. Care Coordinator refers a routine case -> BLOCKED (the gap closed here)
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cc, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'CC trying to refer' where id = v_esc_rev_cc;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (2, 'Care Coordinator refers a routine case', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct -- gap closed)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 3. Tier 3 resolves; client sends a spoofed reviewed_by -> server overwrites
  ---------------------------------------------------------------------------
  v_blocked := false; v_err := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations
      set status = 'resolved', resolution_note = 'resolved by t3',
          reviewed_by = v_fake_reviewer, reviewed_at = '2020-01-01'
      where id = v_esc_rev_t3;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  select reviewed_by, reviewed_at into v_reviewed_by, v_reviewed_at from public.escalations where id = v_esc_rev_t3;
  insert into test_result values (3, 'Tier 3 resolves w/ spoofed reviewed_by', 'server overwrites to caller, recent timestamp',
    case when not v_blocked and v_reviewed_by = v_t3 and v_reviewed_by <> v_fake_reviewer
              and v_reviewed_at > now() - interval '1 minute'
      then 'SERVER-STAMPED (correct)'
      else 'SPOOFABLE (BUG): reviewed_by=' || coalesce(v_reviewed_by::text, 'null') end,
    coalesce(v_err, ''));

  ---------------------------------------------------------------------------
  -- 4. A decided case cannot be re-decided -> BLOCKED
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_t3, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  update public.escalations set status = 'resolved', resolution_note = 'first decision', reviewed_by = v_t3, reviewed_at = now()
    where id = v_esc_redecide;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);

  v_blocked := false; v_err := null; v_state := null;
  perform set_config('request.jwt.claims', json_build_object('sub', v_t1, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    update public.escalations set status = 'referred', resolution_note = 'trying to re-decide', reviewed_by = v_t1, reviewed_at = now()
      where id = v_esc_redecide;
  exception when others then
    v_blocked := true; get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
  end;
  perform set_config('role', 'postgres', true); perform set_config('request.jwt.claims', '', true);
  insert into test_result values (4, 'Re-decide an already-resolved case', 'BLOCKED 42501',
    case when v_blocked and v_state = '42501' then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, ''));
end $$;

select case_num, label, expected, outcome, left(detail, 150) as detail
from test_result order by case_num;

rollback;

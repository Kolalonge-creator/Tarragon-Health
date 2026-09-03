-- Tarragon Health
-- Live proof for 20260730092804_i5_emergency_escalation_synchronous_contact.sql
-- (the I5 v3-port fix). Four cases in one rolled-back transaction:
--   1. emergency + zero synchronous contact  -> resolve BLOCKED (23514)
--   2. emergency + a completed, escalation-linked video consult -> resolve SUCCEEDS
--   3. emergency + zero contact, but transitioning to 'referred' (not 'resolved') -> SUCCEEDS (not gated)
--   4. clinician_review (non-emergency) + zero contact -> resolve SUCCEEDS (gate is emergency-only)
--
-- Run: npx supabase db query --linked -f packages/db/tests/i5_emergency_escalation_synchronous_contact.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temporary table test_result (
  case_num int,
  label text,
  outcome text,
  detail text
) on commit drop;

do $$
declare
  v_org               uuid := '00000000-0000-0000-0000-000000000001';
  v_pat               uuid;
  v_clin              uuid;
  v_alert_id          uuid;
  v_esc_id            uuid;
  v_blocked           boolean;
  v_err               text;
begin
  select id into v_pat  from public.profiles where role='patient'   and organisation_id=v_org limit 1;
  select id into v_clin from public.profiles where role='clinician' and organisation_id=v_org limit 1;

  -- ---------------------------------------------------------------------
  -- Case 1: emergency, no contact -> BLOCKED
  -- ---------------------------------------------------------------------
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'I5 proof -- case 1, no contact')
  returning id into v_alert_id;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_id, 'open', v_clin, 'I5 proof fixture -- case 1')
  returning id into v_esc_id;

  v_blocked := false;
  begin
    update public.escalations
    set status = 'resolved', resolution_note = 'text-only close attempt, no call', reviewed_by = v_clin, reviewed_at = now()
    where id = v_esc_id;
  exception when sqlstate '23514' then
    v_blocked := true;
    get stacked diagnostics v_err = message_text;
  end;

  insert into test_result values (
    1, 'emergency + zero contact -> resolve',
    case when v_blocked then 'BLOCKED (correct)' else 'ALLOWED (BUG)' end,
    coalesce(v_err, 'no exception raised')
  );

  -- ---------------------------------------------------------------------
  -- Case 2: emergency + completed, escalation-linked video consult -> SUCCEEDS
  -- ---------------------------------------------------------------------
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'I5 proof -- case 2, with contact')
  returning id into v_alert_id;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_id, 'open', v_clin, 'I5 proof fixture -- case 2')
  returning id into v_esc_id;

  insert into public.video_consultations
    (organisation_id, patient_id, context, escalation_id, initiated_by, status, started_at)
  values
    (v_org, v_pat, 'pre_referral_triage', v_esc_id, v_clin, 'completed', now() - interval '5 minutes');

  update public.escalations
  set status = 'resolved', resolution_note = 'Reviewed live on video call, patient stable', reviewed_by = v_clin, reviewed_at = now()
  where id = v_esc_id;

  insert into test_result values (
    2, 'emergency + completed video consult -> resolve',
    (select status::text from public.escalations where id = v_esc_id),
    'expected: resolved'
  );

  -- ---------------------------------------------------------------------
  -- Case 3: emergency + zero contact, but 'referred' (not 'resolved') -> SUCCEEDS
  -- ---------------------------------------------------------------------
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'emergency', 'open', 'I5 proof -- case 3, referred path')
  returning id into v_alert_id;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_id, 'open', v_clin, 'I5 proof fixture -- case 3')
  returning id into v_esc_id;

  update public.escalations
  set status = 'referred', resolution_note = 'Referring to specialist, no call needed for this transition', reviewed_by = v_clin, reviewed_at = now()
  where id = v_esc_id;

  insert into test_result values (
    3, 'emergency + zero contact -> referred (not resolved)',
    (select status::text from public.escalations where id = v_esc_id),
    'expected: referred (gate only fires on the transition INTO resolved)'
  );

  -- ---------------------------------------------------------------------
  -- Case 4: non-emergency (clinician_review) + zero contact -> resolve SUCCEEDS
  -- ---------------------------------------------------------------------
  insert into public.clinician_alerts (organisation_id, patient_id, level, status, title)
  values (v_org, v_pat, 'clinician_review', 'open', 'I5 proof -- case 4, non-emergency')
  returning id into v_alert_id;

  insert into public.escalations (organisation_id, patient_id, clinician_alert_id, status, raised_by, reason)
  values (v_org, v_pat, v_alert_id, 'open', v_clin, 'I5 proof fixture -- case 4')
  returning id into v_esc_id;

  update public.escalations
  set status = 'resolved', resolution_note = 'Routine review, no call needed', reviewed_by = v_clin, reviewed_at = now()
  where id = v_esc_id;

  insert into test_result values (
    4, 'clinician_review (non-emergency) + zero contact -> resolve',
    (select status::text from public.escalations where id = v_esc_id),
    'expected: resolved (gate is emergency-level only, by design -- see migration header)'
  );
end $$;

select * from test_result order by case_num;

rollback;

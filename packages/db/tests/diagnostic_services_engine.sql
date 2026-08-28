-- Imaging & Diagnostic Services Engine: request creation guardrails,
-- patient booking, report upload, the abnormal-result hook into the
-- existing Abnormal Result Engine, and the review/action lifecycle.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control.
--
-- Verified against the linked project. To re-run:
--   npx supabase db query --linked -f packages/db/tests/diagnostic_services_engine.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_clin_profile uuid; v_staff uuid;
  v_request uuid; v_report uuid; v_alert_count int; v_alert record;
  v_caught boolean;
begin
  ------------------------------------------------------------------
  -- Fixtures. Asserted, so a lookup miss fails loudly instead of
  -- silently making every check below vacuous.
  ------------------------------------------------------------------
  select id, organisation_id into v_pt, v_org
    from public.profiles where role = 'patient' and organisation_id is not null
    order by created_at limit 1;
  select id into v_clin_profile from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;

  if v_pt is null or v_clin_profile is null then
    raise exception 'fixture lookup failed - the test would have been vacuous';
  end if;

  select id into v_staff from public.clinical_staff where profile_id = v_clin_profile and organisation_id = v_org limit 1;
  if v_staff is null then
    insert into public.clinical_staff
      (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number, license_verified_at)
    values (v_org, v_clin_profile, 'Dr Diagnostic Test', true, 'tier_2', 'MDCN', 'TEST-DIAG-1', now())
    returning id into v_staff;
  else
    update public.clinical_staff set active = true, doctor_tier = coalesce(doctor_tier, 'tier_2') where id = v_staff;
  end if;

  ------------------------------------------------------------------
  -- 1. Catalogue seeded (15.1).
  ------------------------------------------------------------------
  insert into r select 'catalogue_seeded',
    case when (select count(*) from public.diagnostic_service_catalogue where is_active) >= 7 then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 2. Never patient-orderable (Master Operating Plan §6): a patient
  -- cannot insert a diagnostic_requests row directly.
  ------------------------------------------------------------------
  v_caught := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_pt::text)::text, true);
    insert into public.diagnostic_requests
      (organisation_id, patient_id, requested_by, modality, service_name, indication)
    values (v_org, v_pt, v_staff, 'ct', 'CT scan', 'patient self-order attempt');
  exception when others then v_caught := true;
  end;
  reset role;
  insert into r select 'patient_cannot_insert_request', case when v_caught then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 3. A real clinician CAN create a request (positive control) — 15.2.
  -- requested_by is server-derived, never the client-supplied uuid.
  ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile::text)::text, true);
  insert into public.diagnostic_requests
    (organisation_id, patient_id, requested_by, modality, service_name, indication, clinical_question, urgency)
  values (v_org, v_pt, '00000000-0000-0000-0000-000000000000', 'echocardiography', 'Echocardiogram', 'Abnormal ECG on routine review', 'Assess LV function', 'urgent')
  returning id into v_request;
  reset role;

  insert into r select 'clinician_creates_request',
    case when v_request is not null and (select requested_by from public.diagnostic_requests where id = v_request) = v_staff
      then 'PASS' else 'FAIL' end;
  insert into r select 'requested_by_server_derived_not_client_uuid',
    case when (select requested_by from public.diagnostic_requests where id = v_request) <> '00000000-0000-0000-0000-000000000000'
      then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 4. Patient books via the guarded RPC (15.3) — no fabricated slot grid.
  ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pt::text)::text, true);
  perform public.set_diagnostic_request_booking_preference(
    v_request, null, 'Self-chosen imaging centre', current_date + 3, 'morning', null, null
  );
  reset role;
  insert into r select 'patient_books_via_rpc',
    case when (select status from public.diagnostic_requests where id = v_request) = 'booked' then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 5. Report upload (15.6/15.7): raises a routine clinician_review alert,
  -- advances status to 'reported', backfills attended_at.
  ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile::text)::text, true);
  insert into public.diagnostic_reports
    (organisation_id, patient_id, diagnostic_request_id, file_path, source, note)
  values (v_org, v_pt, v_request, v_pt::text || '/test-echo-report.pdf', 'clinician', 'Uploaded on patient''s behalf')
  returning id into v_report;
  reset role;

  insert into r select 'report_upload_advances_status',
    case when (select status from public.diagnostic_requests where id = v_request) = 'reported' then 'PASS' else 'FAIL' end;
  insert into r select 'report_upload_backfills_attended_at',
    case when (select attended_at from public.diagnostic_requests where id = v_request) is not null then 'PASS' else 'FAIL' end;
  insert into r select 'report_upload_raised_routine_alert',
    case when (select level from public.clinician_alerts where id = (select clinician_alert_id from public.diagnostic_reports where id = v_report)) = 'clinician_review'
      then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 6. Review with is_abnormal=true (15.9) raises the urgent alert via the
  -- SAME Abnormal Result Engine screening abnormal results already use.
  ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile::text)::text, true);
  update public.diagnostic_reports
  set reviewed_at = now(), is_abnormal = true, abnormal_severity = 'abnormal',
      findings = 'Reduced LV ejection fraction, estimated 35%.',
      impression = 'Moderately reduced LV systolic function.',
      reporting_clinician_name = 'Dr External Radiologist',
      report_date = current_date, facility_name = 'Self-chosen imaging centre'
  where id = v_report;
  reset role;

  select count(*) into v_alert_count from public.clinician_alerts where diagnostic_report_id = v_report;
  insert into r select 'abnormal_review_raises_alert', case when v_alert_count = 2 then 'PASS' else 'FAIL got ' || v_alert_count end;

  select * into v_alert from public.clinician_alerts
    where diagnostic_report_id = v_report and level = 'urgent_escalation' limit 1;
  insert into r select 'urgent_alert_type_code_abnormal_result', case when v_alert.type_code = 'abnormal_result' then 'PASS' else 'FAIL got ' || coalesce(v_alert.type_code::text,'null') end;
  insert into r select 'urgent_alert_severity_3', case when v_alert.severity = 3 then 'PASS' else 'FAIL got ' || coalesce(v_alert.severity::text,'null') end;
  insert into r select 'urgent_alert_sla_due_at_set', case when v_alert.sla_due_at is not null then 'PASS' else 'FAIL' end;

  insert into r select 'request_status_reviewed',
    case when (select status from public.diagnostic_requests where id = v_request) = 'reviewed' then 'PASS' else 'FAIL' end;
  insert into r select 'report_acknowledgement_action_required',
    case when (select acknowledgement_status from public.diagnostic_reports where id = v_report) = 'action_required' then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 7. The routine upload-review alert is superseded/resolved, not left
  -- dangling open once the urgent one is raised.
  ------------------------------------------------------------------
  insert into r select 'routine_alert_resolved_on_supersede',
    case when (select status from public.clinician_alerts where diagnostic_report_id = v_report and level='clinician_review') = 'resolved'
      then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 8. Action-completed transition (15.5's final step).
  ------------------------------------------------------------------
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_clin_profile::text)::text, true);
  update public.diagnostic_reports set action_completed_at = now() where id = v_report;
  reset role;
  insert into r select 'action_completed_advances_request',
    case when (select status from public.diagnostic_requests where id = v_request) = 'actioned' then 'PASS' else 'FAIL' end;

  ------------------------------------------------------------------
  -- 9. Quality analytics RPC (15.11) fails open (never raises) for a
  -- non-analyst caller.
  ------------------------------------------------------------------
  insert into r select 'analytics_fails_open_for_non_analyst',
    case when (select public.analytics_diagnostic_service_quality(90)) = '{}'::jsonb then 'PASS' else 'FAIL' end;

end $$;

select * from r order by step;

rollback;

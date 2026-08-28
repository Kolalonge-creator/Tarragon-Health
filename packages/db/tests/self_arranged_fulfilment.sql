-- Self-arranged lab fulfilment: guards, the awaiting-result safety net, the
-- patient upload door, and AI-extraction confirmation.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control, because a check that only ever proves "nothing
-- happened" passes just as happily against a completely broken system.
--
-- Verified against the linked project. To re-run:
--   npx supabase db query --linked -f packages/db/tests/self_arranged_fulfilment.sql
-- (run it from the MAIN checkout, not a worktree - see
-- reference_supabase_cli_sql_access)

begin;

create temp table r(step text, verdict text) on commit drop;
-- Results are recorded from inside simulated `authenticated` sessions, so that
-- role needs to be able to write to the scratch table.
grant insert, select on r to authenticated;

do $$
declare
  v_org uuid; v_pt uuid; v_pt2 uuid; v_clin uuid; v_staff uuid;
  v_bundle uuid; v_prov uuid; v_order uuid; v_old_order uuid;
  v_doc uuid; v_extraction uuid;
  v_n int; v_val numeric; v_unit text; v_confirmed uuid;
  v_claims text;
begin
  ------------------------------------------------------------------
  -- Fixtures. Asserted, so a lookup miss fails loudly instead of
  -- silently making every check below vacuous.
  ------------------------------------------------------------------
  select id, organisation_id into v_pt, v_org
    from public.profiles where role = 'patient' and organisation_id is not null
    order by created_at limit 1;
  select id into v_pt2
    from public.profiles where role = 'patient' and organisation_id = v_org and id <> v_pt
    limit 1;
  select id into v_clin
    from public.profiles where role = 'clinician' and organisation_id = v_org limit 1;
  select id into v_bundle from public.panel_bundles where code = 'screen_core';
  select id into v_prov from public.lab_providers limit 1;

  if v_pt is null or v_pt2 is null or v_clin is null or v_bundle is null or v_prov is null then
    raise exception 'fixture lookup failed - the test would have been vacuous';
  end if;

  -- A real, active clinical_staff row for the clinician. Created here because
  -- the QA roster has none since the 2026-07-29 database rebuild.
  -- license_verified_at is required by clinical_staff_active_requires_verification;
  -- indemnity is not, because Tier 2 is employed and covered institutionally.
  -- The shared CI-fixture clinician this v_clin lookup now resolves to
  -- already carries its own clinical_staff row (profile_id is unique) --
  -- clear it first, same defensive pattern used elsewhere for this exact
  -- collision (i1_i10_invariants_platform.sql's I5 section,
  -- clinician_alert_override.sql).
  delete from public.clinical_staff where profile_id = v_clin;

  insert into public.clinical_staff
    (organisation_id, profile_id, full_name, active, doctor_tier,
     credential_type, credential_number, license_verified_at)
  values (v_org, v_clin, 'Dr Extraction Test', true, 'tier_2',
          'MDCN', 'TEST-EXTRACT-1', now())
  returning id into v_staff;

  ------------------------------------------------------------------
  -- 1. Fulfilment guards on lab_orders.
  ------------------------------------------------------------------
  update public.profiles set state = 'Enugu' where id = v_pt;

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo)
  values (v_org, v_pt, v_bundle, 'patient_initiated', 'ordered', 0)
  returning id into v_order;
  insert into r values ('1a self-arranged accepted outside Lagos', 'PASS');

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo, provider_id)
    values (v_org, v_pt, v_bundle, 'patient_initiated', 'ordered', 0, v_prov);
    insert into r values ('1b provider on self-arranged blocked', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('1b provider on self-arranged blocked', 'PASS');
  end;

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo)
    values (v_org, v_pt, v_bundle, 'patient_initiated', 'ordered', 6500000);
    insert into r values ('1c charged self-arranged blocked', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('1c charged self-arranged blocked', 'PASS');
  end;

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo, provider_id, fulfilment)
    values (v_org, v_pt, v_bundle, 'patient_initiated', 'pending_payment', 6500000, v_prov, 'partner');
    insert into r values ('1d CONTROL partner order still region-gated', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('1d CONTROL partner order still region-gated', 'PASS');
  end;

  begin
    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo)
    select v_org, v_pt, id, 'patient_initiated', 'ordered', 0
      from public.panel_bundles where code = 'single_psa';
    insert into r values ('1e CONTROL ad hoc test still needs a clinician', 'FAIL - accepted');
  exception when check_violation then
    insert into r values ('1e CONTROL ad hoc test still needs a clinician', 'PASS');
  end;

  ------------------------------------------------------------------
  -- 2. The awaiting_result safety net. A test issued and never
  --    returned must become visible to the chase engine.
  ------------------------------------------------------------------
  select count(*) into v_n from public.patient_care_gaps
   where patient_id = v_pt and gap_type = 'awaiting_result';
  insert into r values ('2a fresh order is NOT chased yet',
    case when v_n = 0 then 'PASS' else 'FAIL - chased too early' end);

  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, origin, status, total_kobo)
  values (v_org, v_pt2, v_bundle, 'patient_initiated', 'ordered', 0)
  returning id into v_old_order;
  update public.lab_orders set ordered_at = now() - interval '22 days' where id = v_old_order;

  select count(*) into v_n from public.patient_care_gaps
   where patient_id = v_pt2 and gap_type = 'awaiting_result';
  insert into r values ('2b 22-day-old order with no result IS chased',
    case when v_n = 1 then 'PASS' else 'FAIL - not surfaced' end);

  perform private.queue_care_outreach();
  select count(*) into v_n from public.care_outreach_tasks
   where patient_id = v_pt2 and trigger_type = 'awaiting_result';
  insert into r values ('2c outreach task raised, correctly typed',
    case when v_n = 1 then 'PASS' else 'FAIL - got ' || v_n end);

  perform private.queue_care_outreach();
  select count(*) into v_n from public.care_outreach_tasks
   where patient_id = v_pt2 and trigger_type = 'awaiting_result';
  insert into r values ('2d re-run does not double-chase',
    case when v_n = 1 then 'PASS' else 'FAIL - got ' || v_n end);

  ------------------------------------------------------------------
  -- 3. The patient upload door, under a real patient session.
  ------------------------------------------------------------------
  v_claims := json_build_object('sub', v_pt, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;

  insert into public.lab_result_documents
    (organisation_id, patient_id, lab_order_id, file_path, original_filename,
     mime_type, file_size_bytes, source)
  values (v_org, v_pt, v_order, v_pt || '/test.pdf', 'result.pdf',
          'application/pdf', 1024, 'patient')
  returning id into v_doc;
  insert into r values ('3a patient uploads their own result', 'PASS');

  begin
    insert into public.lab_result_documents
      (organisation_id, patient_id, file_path, original_filename,
       mime_type, file_size_bytes, source)
    values (v_org, v_pt2, v_pt || '/other.pdf', 'other.pdf', 'application/pdf', 1024, 'patient');
    insert into r values ('3b CONTROL cannot upload against another patient', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('3b CONTROL cannot upload against another patient', 'PASS');
  end;

  reset role;

  select count(*) into v_n from public.clinician_alerts
   where patient_id = v_pt and title like '%result document uploaded%';
  insert into r values ('3c upload raises a clinician review alert',
    case when v_n >= 1 then 'PASS' else 'FAIL' end);

  -- Once a document exists the patient is no longer chased for that order.
  update public.lab_orders set ordered_at = now() - interval '22 days' where id = v_order;
  select count(*) into v_n from public.patient_care_gaps
   where patient_id = v_pt and gap_type = 'awaiting_result';
  insert into r values ('3d uploading stops the chase',
    case when v_n = 0 then 'PASS' else 'FAIL - still chased' end);

  ------------------------------------------------------------------
  -- 4. Extraction confirmation: AI proposes, a clinician decides.
  --
  -- Rewritten 2026-08-28 for 20260807151847_nigerian_lab_ingestion_engine.sql,
  -- which retired public.lab_result_extractions / confirm_lab_result_extraction
  -- (the narrower of two duplicate AI-extraction engines) in favour of the
  -- richer public.lab_report_extractions / confirm_lab_report_extraction,
  -- "taking the retired engine's stronger confirmation path with it" per that
  -- migration's own header. Same properties proved, adapted to the surviving
  -- engine's shape:
  --   * status starts 'extracted', not 'ready' (lab_report_extractions' check
  --     constraint never had a 'ready' value);
  --   * the model's reading lives in `rows`, not `proposed`, and its elements
  --     use extract.ts's field names (code/value/unit/valueText/reportedLabel/
  --     reportedRange/confidence), not the retired engine's plain
  --     code/value/unit;
  --   * confirm_lab_report_extraction takes a third argument, p_report_date
  --     (what lab_analyte_readings.taken_at is set from), and returns an
  --     integer (count of readings filed) rather than the old function's void;
  --   * confirmed_by on THIS table is, and always was (it predates the
  --     retirement migration by four days, unchanged by it), a
  --     public.profiles FK -- confirm_lab_report_extraction stamps
  --     `(select auth.uid())`, the confirming clinician's own profile id, not
  --     a clinical_staff.id the way the retired engine's confirmed_by (a
  --     clinical_staff FK) did. 4f is updated to prove the property that
  --     actually holds for this table: non-forgeable, server-derived
  --     attribution to the real caller -- gated on an active clinical_staff
  --     row existing (the same v_staff created above), just not stored as
  --     that row's own id.
  ------------------------------------------------------------------
  insert into public.lab_report_extractions
    (organisation_id, patient_id, document_id, status, model_id, rows)
  values (v_org, v_pt, v_doc, 'extracted', 'claude-haiku-4-5',
    '[{"code":"total_cholesterol","value":201.08,"unit":"mg/dL"}]'::jsonb)
  returning id into v_extraction;

  -- A patient must not even see an unconfirmed machine reading of their blood.
  perform set_config('request.jwt.claims', v_claims, true);
  set local role authenticated;
  select count(*) into v_n from public.lab_report_extractions where id = v_extraction;
  insert into r values ('4a patient cannot see an unconfirmed extraction',
    case when v_n = 0 then 'PASS' else 'FAIL - visible' end);

  begin
    perform public.confirm_lab_report_extraction(v_extraction,
      '[{"code":"total_cholesterol","value":201.08,"unit":"mg/dL"}]'::jsonb,
      current_date);
    insert into r values ('4b patient cannot confirm an extraction', 'FAIL - accepted');
  exception when insufficient_privilege then
    insert into r values ('4b patient cannot confirm an extraction', 'PASS');
  end;
  reset role;

  -- The clinician confirms, CORRECTING the value - the point of the review.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.lab_report_extractions where id = v_extraction;
  insert into r values ('4c CONTROL clinician can see the extraction',
    case when v_n = 1 then 'PASS' else 'FAIL - hidden' end);

  perform public.confirm_lab_report_extraction(v_extraction,
    '[{"code":"total_cholesterol","value":195,"unit":"mg/dL"}]'::jsonb,
    current_date);

  begin
    perform public.confirm_lab_report_extraction(v_extraction,
      '[{"code":"total_cholesterol","value":195,"unit":"mg/dL"}]'::jsonb,
      current_date);
    insert into r values ('4e double confirmation refused', 'FAIL - accepted');
  exception when unique_violation then
    insert into r values ('4e double confirmation refused', 'PASS');
  end;
  reset role;

  select value, unit into v_val, v_unit
    from public.lab_analyte_readings
   where patient_id = v_pt and code = 'total_cholesterol'
   order by created_at desc limit 1;
  insert into r values ('4d the CORRECTED value is what lands, not the proposal',
    case when v_val = 195 and v_unit = 'mg/dL' then 'PASS'
         else 'FAIL - got ' || coalesce(v_val::text, 'null') end);

  select confirmed_by into v_confirmed from public.lab_report_extractions where id = v_extraction;
  insert into r values ('4f confirmed_by stamped server-side to the confirming clinician, not the client',
    case when v_confirmed = v_clin then 'PASS' else 'FAIL' end);
end $$;

select step, verdict from r order by step;

rollback;

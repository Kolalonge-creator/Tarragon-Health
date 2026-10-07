-- S81 proof: research consent eligibility, protocol approval (CMO + DPO, ethics and agreement refs required), a frozen approved protocol, the dark
-- guard, export contents (consented only, no test accounts, re-keyed, no organisation, minimum participants), the audit, pre-registered
-- evaluations, no commercial recipient, refusals. Own fixtures; BEGIN/ROLLBACK; sabotage at the end.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_pat uuid;
  v_ver uuid; v_bp text; v_ts text;
  v_good uuid[] := '{}'; v_withdrawn uuid; v_noresearch uuid; v_test uuid; v_nodp uuid; v_u uuid;
  v_p uuid; v_p2 uuid; v_ok boolean; v_res jsonb; v_n int; v_status public.research_protocol_status; v_i int;
  v_fields text[] := array['pathway_code','day','bp_status','adherence_pct','enrolment_month','computed_month'];
begin
  select id into v_org from public.organisations limit 1;
  select id into v_pat from public.profiles where role = 'patient' limit 1;
  select id into v_ver from public.consent_versions limit 1;
  if v_org is null or v_pat is null or v_ver is null then raise exception 'fixture missing: organisation, patient or consent version'; end if;
  v_bp := 'uncontrolled';
  v_ts := 'default';

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's81-admin@example.invalid','x',now(),'{}','{}'), (v_cmo, 's81-cmo@example.invalid','x',now(),'{}','{}');
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'S81 DPO Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'S81 CMO', is_test = true where id = v_cmo;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S81 CMO', 'chief_medical_officer', true, 'MDCN', 'S81-CMO', true, v_admin, v_admin, now());

  -- 25 consenting real (non-test) patients, plus four who must never appear
  for v_i in 1..29 loop
    v_u := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_u, 's81-p' || v_i || '@example.invalid','x',now(),'{}','{}');
    update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'S81 P' || v_i, is_test = (v_i = 28) where id = v_u;
    insert into analytics.subjects (patient_id) values (v_u);
    insert into public.outcome_snapshots (organisation_id, patient_id, pathway_code, day, anchor_date, window_start, window_end, bp_avg_7d_sys, bp_avg_7d_dia, bp_readings_7d, bp_status, controlled, target_sys, target_dia, target_source, adherence_pct, adherence_doses_due, config_version, is_test)
    values (v_org, v_u, 'bp', 30, current_date - 30, current_date - 7, current_date, 138, 86, 5, v_bp, false, 130, 80, v_ts, 80, 10, 1, false);
    if v_i <= 25 then v_good := v_good || v_u; end if;
    if v_i = 26 then v_withdrawn := v_u; end if;
    if v_i = 27 then v_noresearch := v_u; end if;
    if v_i = 28 then v_test := v_u; end if;
    if v_i = 29 then v_nodp := v_u; end if;
    -- consents: data_processing for all but v_nodp; research for all but v_noresearch and v_nodp
    if v_i <> 29 then insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_u, 'data_processing', v_ver, '1', 'accepted', now() - interval '2 days'); end if;
    if v_i not in (27, 29) then insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_u, 'research', v_ver, '1', 'accepted', now() - interval '2 days'); end if;
    if v_i = 26 then insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_u, 'research', v_ver, '1', 'withdrawn', now() - interval '1 day'); end if;
  end loop;

  -- eligibility truth table
  if not private.research_eligible(v_good[1]) then raise exception 'FAIL: a consenting patient is not eligible'; end if;
  if private.research_eligible(v_withdrawn) then raise exception 'FAIL: a withdrawn patient is eligible'; end if;
  if private.research_eligible(v_noresearch) then raise exception 'FAIL: a patient who never gave research consent is eligible'; end if;
  if private.research_eligible(v_test) then raise exception 'FAIL: a test account is eligible'; end if;
  if private.research_eligible(v_nodp) then raise exception 'FAIL: a patient without data_processing consent is eligible'; end if;

  -- protocol: only the CMO drafts; commercial recipient and identifier fields refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.create_research_protocol('Proof protocol','Does the pathway control blood pressure by day 30?',v_fields,'Direct identifiers removed, participant re-keyed per protocol, dates coarsened to month','Proof University','academic','ETH-001','Proof ethics committee',current_date,'DSA-001'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an admin drafted a research protocol'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.create_research_protocol('Bad fields','Does the pathway control blood pressure by day 30?',array['subject_key','organisation_id'],'Direct identifiers removed, participant re-keyed per protocol, dates coarsened to month','Proof University','academic','ETH-001','Proof ethics committee',current_date,'DSA-001'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an identifier field was allowed'; end if;
  begin perform public.create_research_protocol('Commercial','Does the pathway control blood pressure by day 30?',v_fields,'Direct identifiers removed, participant re-keyed per protocol, dates coarsened to month','Data Broker Ltd','commercial','ETH-001','Proof ethics committee',current_date,'DSA-001'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a commercial recipient was allowed'; end if;
  v_p := public.create_research_protocol('Proof protocol','Does the pathway control blood pressure by day 30?',v_fields,'Direct identifiers removed, participant re-keyed per protocol, dates coarsened to month','Proof University','academic','ETH-001','Proof ethics committee',current_date,'DSA-001');
  -- a protocol with no ethics reference cannot be approved
  v_p2 := public.create_research_protocol('No ethics','Does the pathway control blood pressure by day 30?',v_fields,'Direct identifiers removed, participant re-keyed per protocol, dates coarsened to month','Proof University','academic',null,null,null,null);
  v_status := public.approve_research_protocol(v_p2);
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.confirm_research_protocol_dpo(v_p2); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a protocol with no ethics approval or agreement was approved'; end if;
  reset role;

  -- the export is dark: CMO approval alone is not enough, and the guard is off
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  if public.approve_research_protocol(v_p) <> 'draft' then raise exception 'FAIL: one approval made the protocol approved'; end if;
  begin perform public.run_research_export(v_p); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: export ran on an unapproved protocol'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  if public.confirm_research_protocol_dpo(v_p) <> 'approved' then raise exception 'FAIL: CMO plus DPO did not approve'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.run_research_export(v_p); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: export ran while the guard was off'; end if;
  reset role;

  -- an approved protocol is frozen
  begin update public.research_protocols set allowed_fields = array['day'] where id = v_p; v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an approved protocol was edited'; end if;

  -- switch the guard on (a log row in this transaction, as the guard trigger requires)
  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note) values ('research_export_enabled', 'switched_on', v_cmo, 'cmo', 'S81 proof');
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_cmo, change_note = 'S81 proof' where key = 'research_export_enabled';

  -- an admin cannot run it, the CMO can
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.run_research_export(v_p); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an admin ran a research export'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.run_research_export(v_p);
  reset role;

  -- contents: exactly the 25 consenting patients, none of the four, no identifiers, re-keyed
  if jsonb_array_length(v_res->'rows') <> 25 then raise exception 'FAIL: expected 25 rows, got %', jsonb_array_length(v_res->'rows'); end if;
  if (v_res::text) like '%organisation_id%' or (v_res::text) like '%subject_key%' or (v_res::text) like '%patient_id%' then raise exception 'FAIL: an identifier field is in the export'; end if;
  if ((v_res->'rows')::text) ~ '[0-9a-f]{8}-[0-9a-f]{4}-' then raise exception 'FAIL: a uuid is in the released rows'; end if;
  if exists (select 1 from jsonb_array_elements(v_res->'rows') r where length(r->>'participant') <> 64) then raise exception 'FAIL: participant is not a hash'; end if;
  if exists (select 1 from jsonb_array_elements(v_res->'rows') r where (r->>'computed_month')::date <> date_trunc('month', (r->>'computed_month')::date)::date) then raise exception 'FAIL: computed_month is not a month'; end if;
  if (select count(*) from jsonb_array_elements(v_res->'rows') r where r ? 'bp_avg_7d_sys') > 0 then raise exception 'FAIL: a field outside the allow-list is in the export'; end if;
  -- the participant key is per protocol: it is not the analytics subject key
  if exists (select 1 from jsonb_array_elements(v_res->'rows') r join analytics.subjects s on encode(extensions.digest(s.subject_key::text, 'sha256'), 'hex') = r->>'participant') then raise exception 'FAIL: participant key is not protocol-specific'; end if;

  -- audit, event, no stored data
  if not exists (select 1 from public.research_exports where id = (v_res->>'export_id')::uuid and row_count = 25 and participant_count = 25 and content_sha256 = v_res->>'sha256') then raise exception 'FAIL: export record missing or wrong'; end if;
  if not exists (select 1 from public.audit_log where action = 'research_export.created' and entity_id = (v_res->>'export_id')::uuid) then raise exception 'FAIL: export not audited'; end if;
  if not exists (select 1 from public.domain_events where event_type = 'research_export.created' and (payload->>'export_id')::uuid = (v_res->>'export_id')::uuid) then raise exception 'FAIL: research_export.created not emitted'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'research_exports' and (column_name ~* 'price|fee|licen|amount|kobo|payload|data')) then raise exception 'FAIL: research_exports has a price or data column'; end if;

  -- withdrawal takes effect on the next export: withdraw one more and the count drops, and below 20 participants nothing is released
  insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_good[1], 'research', v_ver, '1', 'withdrawn', now());
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.run_research_export(v_p);
  reset role;
  if jsonb_array_length(v_res->'rows') <> 24 then raise exception 'FAIL: a patient who withdrew is still exported (got % rows)', jsonb_array_length(v_res->'rows'); end if;
  for v_i in 2..6 loop
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action, created_at) values (v_org, v_good[v_i], 'research', v_ver, '1', 'withdrawn', now());
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.run_research_export(v_p); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: an export of fewer than 20 participants was released'; end if;

  -- patient refused everywhere
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.research_protocols_list(); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a patient listed research protocols'; end if;
  begin perform count(*) from public.research_exports; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a patient read research_exports'; end if;
  reset role;

  -- pre-registered evaluation: no result before the plan is registered and locked
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.register_research_evaluation('Proof evaluation','Does day 30 control improve with the pathway?','Share controlled at day 90','Pre-specified analysis: proportion controlled at day 90, strict denominator, intention to treat.','https://example.com/not-a-registry',current_date); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: an evaluation with a non-registry link was accepted'; end if;
  v_u := public.register_research_evaluation('Proof evaluation','Does day 30 control improve with the pathway?','Share controlled at day 90','Pre-specified analysis: proportion controlled at day 90, strict denominator, intention to treat.','https://osf.io/abcd1/',current_date);
  begin perform public.record_research_evaluation_result(v_u, 'No difference found between arms at day 90.', true); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a result was recorded before the plan was locked'; end if;
  perform public.lock_research_evaluation(v_u);
  perform public.record_research_evaluation_result(v_u, 'No difference found between arms at day 90.', true);
  reset role;
  if not (select is_negative_result from public.research_evaluations where id = v_u) then raise exception 'FAIL: negative result not stored'; end if;
  raise notice 'PASS: eligibility, approval, frozen protocol, dark guard, export contents and audit, minimum participants, evaluation lock, refusals';

  -- SABOTAGE: an eligibility test that ignores withdrawal exports the withdrawn patient
  create or replace function private.research_eligible(p_patient uuid, p_protocol uuid default null) returns boolean language sql stable security definer set search_path = '' as $f$
    select not coalesce((select pr.is_test from public.profiles pr where pr.id = p_patient), true)
  $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  v_res := public.run_research_export(v_p);
  reset role;
  select count(*) into v_n from jsonb_array_elements(v_res->'rows');
  if v_n <= 24 then raise exception 'sabotage did not export the withdrawn or unconsented patients, the test would not discriminate (got %)', v_n; end if;
  raise notice 'PASS: sabotage confirmed (% rows with no consent test)', v_n;
end $$;

rollback;

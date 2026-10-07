-- S80c proof: kobo cost roll-up (unpriced is reported, not zero; test subjects excluded), stratified review sample (flagged always in,
-- no duplicates), reviewer rules, audited queue read, refusals. Own fixtures; BEGIN/ROLLBACK; sabotage at the end.
begin;

do $$
declare
  v_org uuid; v_admin uuid := gen_random_uuid(); v_cmo uuid := gen_random_uuid(); v_pat uuid; v_testpat uuid; v_sys uuid; v_code text;
  v_n int; v_row record; v_s uuid; v_ok boolean; v_audit_before int; v_m date := date_trunc('month', now())::date;
begin
  select id into v_org from public.organisations limit 1;
  select id into v_pat from public.profiles where role = 'patient' and not coalesce(is_test,false) limit 1;
  select id, system_code into v_sys, v_code from public.ai_systems order by system_code limit 1;
  if v_org is null or v_pat is null or v_sys is null then raise exception 'fixture missing'; end if;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 's80c-admin@example.invalid','x',now(),'{}','{}'), (v_cmo, 's80c-cmo@example.invalid','x',now(),'{}','{}'),
         (gen_random_uuid(), 's80c-testpat@example.invalid','x',now(),'{}','{}');
  select id into v_testpat from auth.users where email = 's80c-testpat@example.invalid';
  update public.profiles set organisation_id = v_org, role = 'admin', full_name = 'S80c Admin', is_test = true where id = v_admin;
  update public.profiles set organisation_id = v_org, role = 'clinician', full_name = 'S80c CMO', is_test = true where id = v_cmo;
  update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'S80c Test Patient', is_test = true where id = v_testpat;
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, credential_type, credential_number, indemnity_exempt, indemnity_exempt_by, verified_by, license_verified_at)
  values (v_cmo, v_org, 'S80c CMO', 'chief_medical_officer', true, 'MDCN', 'S80C-CMO', true, v_admin, v_admin, now());

  -- clean slate for this system this month inside the txn
  delete from public.ai_interaction_log where ai_system_id = v_sys and created_at >= v_m;
  -- 20 priced-model real-subject calls (1,000,000 in + 500,000 out tokens in total across them), 10 unpriced, 5 test-subject, 3 flagged
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review)
  select v_org, v_sys, 's80c-priced-model', 'proof', v_pat, 'completed', 'routine', 50000, 25000, 'summary ' || g, false from generate_series(1, 20) g;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review)
  select v_org, v_sys, 's80c-unpriced-model', 'proof', v_pat, 'completed', 'routine', 1000, 1000, 'summary u' || g, false from generate_series(1, 10) g;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review)
  select v_org, v_sys, 's80c-priced-model', 'proof', v_testpat, 'completed', 'routine', 50000, 25000, 'test subject', true from generate_series(1, 5) g;
  insert into public.ai_interaction_log (organisation_id, ai_system_id, model_identifier, input_category, subject_profile_id, status, safety_classification, input_token_count, output_token_count, output_summary, flagged_for_review)
  select v_org, v_sys, 's80c-unpriced-model', 'proof', v_pat, 'completed', 'urgent_escalation', 10, 10, 'flagged ' || g, true from generate_series(1, 3) g;

  -- admin sets a price: 200 kobo per million in, 800 per million out
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  perform public.set_ai_model_price('s80c-priced-model', current_date - 1, 200, 800, 'S80c proof fixture price');
  select * into v_row from public.ai_cost_by_system_month(1) where system_code = v_code and month = v_m;
  reset role;
  -- priced real calls: 20 x (50000 in + 25000 out) = 1,000,000 in, 500,000 out -> 200 + 400 = 600 kobo. Test subject excluded.
  if v_row.cost_kobo is distinct from 600 then raise exception 'FAIL: cost_kobo % expected 600', v_row.cost_kobo; end if;
  if v_row.unpriced_calls <> 13 then raise exception 'FAIL: unpriced_calls % expected 13 (10 + 3 flagged)', v_row.unpriced_calls; end if;
  if v_row.calls <> 33 then raise exception 'FAIL: calls % expected 33 (test subject excluded)', v_row.calls; end if;

  -- sample at 10 percent
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform public.draw_ai_review_sample(v_m, 0); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a zero rate was accepted'; end if;
  v_n := public.draw_ai_review_sample(v_m, 0.10);
  reset role;
  if (select count(*) from public.ai_review_samples where sampled_by_rule = 'flagged' and ai_system_id = v_sys) <> 3 then
    raise exception 'FAIL: all 3 real flagged interactions must be sampled, test-subject flagged must not';
  end if;
  if exists (select 1 from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id where l.subject_profile_id = v_testpat) then
    raise exception 'FAIL: a test-account interaction was sampled';
  end if;
  select count(*) into v_n from public.ai_review_samples where sampled_by_rule = 'stratified' and ai_system_id = v_sys;
  if v_n < 1 or v_n > 6 then raise exception 'FAIL: stratified sample size % outside the expected 1..6', v_n; end if;
  -- re-drawing adds nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role','authenticated')::text, true);
  set local role authenticated;
  if public.draw_ai_review_sample(v_m, 0.10) <> 0 then raise exception 'FAIL: a second draw duplicated samples'; end if;

  -- reviewer reads the queue (audited) and scores
  select count(*) into v_audit_before from public.audit_log where action = 'ai_review_samples.queue_read';
  select sample_id into v_s from public.ai_review_queue(5) limit 1;
  reset role;
  if (select count(*) from public.audit_log where action = 'ai_review_samples.queue_read') <> v_audit_before + 1 then raise exception 'FAIL: queue read not audited'; end if;
  set local role authenticated;
  begin perform public.review_ai_sample(v_s, 'harmful', 'short'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: harmful verdict accepted with no real note'; end if;
  perform public.review_ai_sample(v_s, 'harmful', 'Gave a dose; against guardrail.');
  begin perform public.review_ai_sample(v_s, 'accurate'); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: a reviewed sample was reviewed twice'; end if;
  reset role;
  if not (select needs_incident from public.ai_review_samples where id = v_s) then raise exception 'FAIL: harmful verdict did not mark needs_incident'; end if;

  -- refusals: patient, and an admin who is not a clinician cannot review
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.ai_review_queue(1); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient read the review queue'; end if;
  begin perform * from public.ai_cost_by_system_month(1); v_ok := true; exception when others then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient read AI cost'; end if;
  begin perform count(*) from public.ai_review_samples; v_ok := true; exception when insufficient_privilege then v_ok := false; end;
  if v_ok then raise exception 'FAIL: patient reads samples directly'; end if;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
  set local role authenticated;
  begin perform * from public.ai_review_queue(1); v_ok := true; exception when others then v_ok := false; end;
  reset role;
  if v_ok then raise exception 'FAIL: an admin who is not a clinician read patient-derived AI output'; end if;
  raise notice 'PASS: cost in kobo, unpriced reported, test excluded, sample rules, audited queue, refusals';

  -- SABOTAGE: drop the test-account filter from the sampler and show the check would catch it
  create or replace function public.draw_ai_review_sample(p_month date, p_rate numeric) returns integer language plpgsql security definer set search_path = '' as $f$
  begin
    insert into public.ai_review_samples (interaction_id, ai_system_id, sample_month, sampled_by_rule)
    select l.id, l.ai_system_id, date_trunc('month', p_month)::date, 'flagged' from public.ai_interaction_log l where l.flagged_for_review on conflict do nothing;
    return 1;
  end $f$;
  perform public.draw_ai_review_sample(v_m, 0.10);
  if not exists (select 1 from public.ai_review_samples r join public.ai_interaction_log l on l.id = r.interaction_id where l.subject_profile_id = v_testpat) then
    raise exception 'sabotage did not sample the test account, the test would not discriminate';
  end if;
  raise notice 'PASS: sabotage confirmed';
end $$;

rollback;

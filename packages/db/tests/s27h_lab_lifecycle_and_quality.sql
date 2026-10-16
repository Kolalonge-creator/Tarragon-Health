-- S27h proof: lab lifecycle and partner quality (migration *_s27h_lab_lifecycle_and_quality.sql). Spec 4.4, 9.6; INV-03, INV-04, INV-07, INV-10, INV-12, INV-13, INV-14.
-- One rolled-back transaction. Sections:
--   1. Grants and shape: RLS on the new tables, no direct staff or anon reads, fallback wording starts unsigned.
--   2. Preliminary and final: a preliminary result is held and unreleasable on every route; the final supersedes it; one neutral notice; amended keeps history.
--   3. Critical value call: tracked call to the on-call clinician, acknowledgement time, SLA clock, backup then lead escalation, release authority,
--      no cover, a failure to open the call is audited and raises an incident, ESCALATION NEVER RELEASES.
--   4. Hold-aging and the bounded fallback: one neutral patient notice, lead escalation capped, never releases; the fallback sends nothing until
--      the CMO signs the wording and needs the failed attempts; it never releases.
--   5. Delta check is a flag to the reviewer only.
--   6. Partner onboarding proof before a laboratory goes live (the contact guard is unchanged).
--   7. The patient trend: released, coded, numeric only; never held, never sensitive, never withdrawn; the care team's note.
--   SABOTAGE: the preliminary guard dropped, the fallback gate opened, the delta threshold lifted, the trend release filter removed, the onboarding
--   guard dropped and the critical sweep made to release; each matching check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's27-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S27 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

create function pg_temp.mkorder(p_org uuid, p_pat uuid, p_provider uuid, p_status text) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at)
  values (p_org, p_pat, p_provider, 'partner', 'pending_payment', 'clinically_triggered',
          (select id from public.clinical_staff where profile_id = pg_temp.f('doc')), 'S27 proof order', now() - interval '1 hour') returning id into v;
  if p_status <> 'pending_payment' then
    update public.lab_orders set status = 'payment_confirmed', payment_confirmed_at = now() - interval '1 hour' where id = v;
    if p_status <> 'payment_confirmed' then update public.lab_orders set status = p_status::public.lab_order_status where id = v; end if;
  end if;
  return v;
end $f$;
create function pg_temp.items(p_creatinine numeric, p_extra text default '') returns text language sql as
$$ select '[{"analyte_code":"fasting_glucose","value_numeric":88},{"analyte_code":"hba1c","value_numeric":5.2},{"analyte_code":"creatinine","value_numeric":'
  || p_creatinine || '},{"analyte_code":"potassium","value_numeric":4.1},{"analyte_code":"sodium","value_numeric":140},{"analyte_code":"total_cholesterol","value_numeric":170},{"analyte_code":"ldl_cholesterol","value_numeric":100},{"analyte_code":"hdl_cholesterol","value_numeric":55},{"analyte_code":"triglycerides","value_numeric":110},{"analyte_code":"alt","value_numeric":24}'
  || ',{"analyte_code":"ast","value_numeric":20},{"analyte_code":"haemoglobin","value_numeric":14},{"analyte_code":"wbc","value_numeric":6},{"analyte_code":"platelets","value_numeric":250},{"analyte_code":"tsh","value_numeric":2}'
  -- HIV, HBsAg and anti-HCV are required every year (CMO C1/C6), so a complete panel carries all three; a caller that passes one in
  -- p_extra supplies its own value for it
  || case when p_extra like '%"hiv_screen"%' then '' else ',{"analyte_code":"hiv_screen","value_text":"negative"}' end
  || case when p_extra like '%"hbsag"%' then '' else ',{"analyte_code":"hbsag","value_text":"negative"}' end
  || case when p_extra like '%"hcv_ab"%' then '' else ',{"analyte_code":"hcv_ab","value_text":"negative"}' end
  || p_extra || ']' $$;
create function pg_temp.partner_submit(p_uid uuid, p_order uuid, p_panel text, p_items text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.lab_partner_submit_result(%L, %L, %L::jsonb)::text', p_order, p_panel, p_items)) $$;
create function pg_temp.rid(p_json text) returns uuid language plpgsql as $f$ begin if p_json like 'ERR:%' then raise exception 'submit failed: %', p_json; end if; return (p_json::jsonb ->> 'lab_result_id')::uuid; end $f$;
create function pg_temp.state_of(p_id uuid) returns text language sql as $$ select release_state from public.lab_results where id = p_id $$;
create function pg_temp.task_of(p_id uuid) returns text language sql as
$$ select type from public.clinical_tasks where dedup_key = 'lab_result:' || p_id limit 1 $$;
create function pg_temp.visible_to(p_uid uuid, p_id uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.lab_results where id = %L', p_id)) $$;
create function pg_temp.items_visible_to(p_uid uuid, p_id uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select count(*)::text from public.lab_result_items where lab_result_id = %L', p_id)) $$;
create function pg_temp.my_as(p_uid uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_uid, 'select public.my_lab_results()::text')::jsonb $$;
create function pg_temp.mine(p_uid uuid, p_id uuid) returns jsonb language sql as
$$ select x from jsonb_array_elements(pg_temp.my_as(p_uid)) x where x ->> 'lab_result_id' = p_id::text $$;
create function pg_temp.order_status(p_id uuid) returns text language sql as $$ select status::text from public.lab_orders where id = p_id $$;


-- S27h helpers --------------------------------------------------------------------------------------------------------------------
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S27h ' || p_label, 'MDCN', 'S27H-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, p_tier = 'chief_medical_officer',
      case when p_tier = 'chief_medical_officer' then p_admin end, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true), (p_org, s, 'on_call', p_admin, true);
  insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test) values (v, private.readiness_version(), p_org, private.readiness_items(), true);
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (p_org, v, 'https://push.example.invalid/' || v, 'k', 'a');
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.page_tests (organisation_id, clinician_id, kind, acknowledged_at, delivered_at, is_test) values (p_org, v, 'readiness', now(), now(), true);
  perform set_config('tarragon.paging_write', 'off', true);
  return v;
end $f$;
-- fixture only: move a result's clock back (the state machine forbids it for everyone else)
create function pg_temp.age_result(p_id uuid, p_minutes integer) returns void language plpgsql as
$f$ begin
  alter table public.lab_results disable trigger lab_results_guard;
  update public.lab_results set received_at = now() - make_interval(mins => p_minutes) where id = p_id;
  alter table public.lab_results enable trigger lab_results_guard;
end $f$;
create function pg_temp.notices(p_uid uuid, p_template text) returns integer language sql as
$$ select count(*)::integer from public.notifications where recipient_id = p_uid and template = p_template $$;
create function pg_temp.notices_in_app(p_uid uuid, p_template text) returns integer language sql as
$$ select count(*)::integer from public.notifications where recipient_id = p_uid and template = p_template and channel = 'in_app' $$;
create function pg_temp.msg(p_uid uuid, p_sql text) returns text language sql as $$ select pg_temp.q_as(p_uid, p_sql) $$;
create function pg_temp.sweep_holds() returns jsonb language sql as $$ select private.sweep_lab_holds() $$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lab_a uuid; v_lab_b uuid; v_cmo uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  update public.clinical_staff set active = false where is_test is not true;   -- only fixture clinicians may be called
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  insert into public.lab_providers (name, is_active) values ('S27h Lab A', false) returning id into v_lab_a;
  insert into public.lab_providers (name, is_active) values ('S27h Lab B', false) returning id into v_lab_b;
  perform pg_temp.setf('labA', pg_temp.mkuser(v_org, 'labA', 'lab_partner'));
  update public.profiles set lab_provider_id = v_lab_a where id = pg_temp.f('labA');
  perform pg_temp.setf('labA_provider', v_lab_a);
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  perform pg_temp.setf('cmo', v_cmo);
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('primary', pg_temp.mkdoc(v_org, 'primary', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('backup', pg_temp.mkdoc(v_org, 'backup', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkdoc(v_org, 'coord', 'care_coordinator', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('pat3', pg_temp.mkuser(v_org, 'pat3', 'patient'));
  perform pg_temp.setf('pat4', pg_temp.mkuser(v_org, 'pat4', 'patient'));
  perform pg_temp.setf('pat5', pg_temp.mkuser(v_org, 'pat5', 'patient'));
  perform pg_temp.setf('pat6', pg_temp.mkuser(v_org, 'pat6', 'patient'));
  -- the treating doctor is tied to every fixture patient except pat5 (a stranger to the doctor)
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id)
  select v_org, pg_temp.f(p), pg_temp.f('doc'), pg_temp.f('cmo') from unnest(array['pat', 'pat2', 'pat3', 'pat4', 'pat6']) p;
  -- the CMO signs the lab ranges so normal results auto-release (the S27 proof covers the unsigned case)
  perform pg_temp.q_as(v_cmo, format('select public.sign_lab_panels(%L)::text', (select id from public.lab_panel_signoffs where is_active)));
  -- the rota: primary and backup on call now
  perform pg_temp.act(v_cmo);
  perform public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', pg_temp.f('primary'), pg_temp.f('backup'), null);
  perform pg_temp.back();
end $$;

create function pg_temp.new_order(p_pat text) returns uuid language sql as
$$ select pg_temp.mkorder(pg_temp.f('org'), pg_temp.f(p_pat), pg_temp.f('labA_provider'), 'sample_collected') $$;
create function pg_temp.submit(p_pat text, p_creatinine numeric, p_extra text default '') returns uuid language sql as
$$ select pg_temp.rid(pg_temp.partner_submit(pg_temp.f('labA'), pg_temp.new_order(p_pat), 'membership_annual', pg_temp.items(p_creatinine, p_extra))) $$;
create function pg_temp.submit_prelim(p_pat text, p_creatinine numeric, p_extra text default '') returns uuid language sql as
$$ select pg_temp.rid(pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_preliminary_result(%L, %L, %L::jsonb)::text',
     pg_temp.new_order(p_pat), 'membership_annual', pg_temp.items(p_creatinine, p_extra)))) $$;

-- 1. Grants and shape -------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('RLS is on for the five new tables', '5',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity
        and c.relname in ('lab_critical_calls', 'lab_hold_state', 'lab_fallback_wording_signoffs', 'lab_lifecycle_config', 'lab_trend_notes')));
  perform pg_temp.ck('nobody signed in can read the call table or the hold table', 'true|true',
    (pg_temp.q_as(pg_temp.f('doc'), 'select count(*) from public.lab_critical_calls') like 'ERR:permission denied%')::text || '|' ||
    (pg_temp.q_as(pg_temp.f('doc'), 'select count(*) from public.lab_hold_state') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('anon cannot reach any S27h function', '42501|42501|42501|42501',
    pg_temp.try_anon('select public.my_lab_trends()') || '|' || pg_temp.try_anon('select * from public.my_lab_critical_calls()') || '|' ||
    pg_temp.try_anon('select public.lab_hold_clock()') || '|' || pg_temp.try_anon(format('select public.acknowledge_lab_critical_call(%L)', gen_random_uuid())));
  perform pg_temp.ck('anon cannot read the trend notes', '42501', pg_temp.try_anon('select * from public.lab_trend_notes'));
  perform pg_temp.ck('the fallback wording starts unsigned', 'false', private.lab_fallback_signed()::text);
  perform pg_temp.ck('the lifecycle config seeded active and valid', 'true', (select private.lab_lifecycle_rules_valid(rules)::text from public.lab_lifecycle_config where is_active));
  perform pg_temp.ck('a lifecycle config with a non-numeric per-analyte percent is refused', '23514',
    pg_temp.try_sql($q$insert into public.lab_lifecycle_config (version, rules) values (98, jsonb_set((select rules from public.lab_lifecycle_config where is_active), '{delta,perAnalytePercent}', '{"creatinine":"x"}'::jsonb))$q$));
  perform pg_temp.ck('a lifecycle config with a missing key is refused', '23514',
    pg_temp.try_sql($q$insert into public.lab_lifecycle_config (version, rules) values (99, '{"holdAging":{}}'::jsonb)$q$));
end $$;

-- 2. Result status: preliminary and final -----------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); o uuid; r text; prelim uuid; fin uuid; v_before text; rid_n uuid; rid_c uuid; rid_s uuid;
begin
  o := pg_temp.new_order('pat');
  r := pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_preliminary_result(%L, %L, %L::jsonb)::text', o, 'membership_annual', pg_temp.items(0.9)));
  prelim := pg_temp.rid(r);
  perform pg_temp.setf('prelim', prelim);
  perform pg_temp.ck('a preliminary all-normal result is HELD, never auto-released', 'awaiting_review|preliminary_result|preliminary',
    pg_temp.state_of(prelim) || '|' || (select release_reason from public.lab_results where id = prelim) || '|' || (select report_status from public.lab_results where id = prelim));
  perform pg_temp.ck('...the patient cannot see it', '0', pg_temp.visible_to(v_pat, prelim));
  perform pg_temp.ck('...the patient was told nothing', '0', pg_temp.notices(v_pat, 'lab_result_ready')::text);
  -- a preliminary result keeps its own hold: a critical value still opens the call, a reactive screen still starts the disclosure workflow
  rid_c := pg_temp.submit_prelim('pat2', 5.0);
  perform pg_temp.ck('a PRELIMINARY critical value keeps reason critical, opens the tracked call and is still unreleasable', 'awaiting_review|critical|1|true',
    pg_temp.state_of(rid_c) || '|' || (select release_reason from public.lab_results where id = rid_c) || '|' ||
    (select count(*)::text from public.lab_critical_calls where lab_result_id = rid_c) || '|' ||
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.release_lab_result(%L)::text', rid_c)) like 'ERR:%lab_result_preliminary_not_releasable%')::text);
  rid_s := pg_temp.submit_prelim('pat3', 0.9, ',{"analyte_code":"hiv_screen","value_text":"positive"}');
  perform pg_temp.ck('a PRELIMINARY reactive screen keeps the disclosure state and task (INV-04 workflow starts)', 'clinician_disclosure_required|sensitive_positive|sensitive_result_disclosure',
    pg_temp.state_of(rid_s) || '|' || (select release_reason from public.lab_results where id = rid_s) || '|' || coalesce(pg_temp.task_of(rid_s), 'none'));
  perform pg_temp.ck('...and a disclosure cannot release it while it is preliminary', 'true|clinician_disclosure_required',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.record_lab_disclosure(%L, %L, true)::text', rid_s, 'in_person')) like 'ERR:%lab_result_preliminary_not_releasable%')::text || '|' || pg_temp.state_of(rid_s));
  perform pg_temp.ck('the transaction-local setting does not leak to the next writer', 'true',
    (coalesce(current_setting('tarragon.lab_report_status', true), '') = '')::text);
  rid_n := pg_temp.submit('pat6', 0.9);
  perform pg_temp.ck('a normal result submitted straight after is final and released', 'released|final',
    (select release_state || '|' || report_status from public.lab_results where id = rid_n));
  perform pg_temp.ck('a second result for the same order is refused while the preliminary stands', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9)) like 'ERR:lab_result_already_received')::text);
  -- release is refused on every route
  perform pg_temp.ck('a tied senior clinician cannot release a preliminary result', 'true|awaiting_review',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.release_lab_result(%L)::text', prelim)) like 'ERR:%lab_result_preliminary_not_releasable%')::text || '|' || pg_temp.state_of(prelim));
  perform pg_temp.ck('...nor by a direct write by the owner', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set release_state = 'released', reviewed_by = %L where id = %L$q$, pg_temp.f('doc'), prelim)));
  perform pg_temp.ck('...and the status itself cannot be rewritten to final', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set report_status = 'final' where id = %L$q$, prelim)));
  -- the final arrives as a correction of kind finalised
  r := pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_correction(%L, %L, %L, %L, %L, %L::jsonb)::text',
         o, prelim, 'finalised', 'final report issued', 'membership_annual', pg_temp.items(0.9)));
  fin := pg_temp.rid(r);
  perform pg_temp.setf('final', fin);
  perform pg_temp.ck('the final result goes through the same gate and releases (all normal, ranges signed)', 'released|final|finalised',
    pg_temp.state_of(fin) || '|' || (select report_status from public.lab_results where id = fin) || '|' || (select correction_kind from public.lab_results where id = fin));
  perform pg_temp.ck('the held preliminary is marked replaced, history kept', 'true|2',
    ((select superseded_by from public.lab_results where id = prelim) = fin)::text || '|' || (select count(*)::text from public.lab_results where lab_order_id = o));
  perform pg_temp.ck('the patient is told ONCE with the neutral release notice, not an update notice', '1|0',
    pg_temp.notices(v_pat, 'lab_result_ready')::text || '|' || pg_temp.notices(v_pat, 'lab_result_corrected')::text);
  perform pg_temp.ck('a finalised kind against a result that is not preliminary is refused', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_correction(%L, %L, %L, %L, %L, %L::jsonb)::text',
       o, fin, 'finalised', 'again', 'membership_annual', pg_temp.items(0.9))) like 'ERR:%lab_finalise_needs_a_preliminary_result%')::text);
  -- amended after release: replaced by supersession, one neutral update notice, the old one kept
  v_before := (select release_state from public.lab_results where id = fin);
  r := pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_correction(%L, %L, %L, %L, %L, %L::jsonb)::text',
         o, fin, 'amended', 'creatinine re-run', 'membership_annual', pg_temp.items(1.0)));
  perform pg_temp.ck('an amended result replaces a released one, once, with the neutral update notice and history kept', 'released|true|1|3',
    pg_temp.state_of(pg_temp.rid(r)) || '|' || ((select superseded_by from public.lab_results where id = fin) = pg_temp.rid(r))::text || '|' || pg_temp.notices(v_pat, 'lab_result_corrected')::text
    || '|' || (select count(*)::text from public.lab_results where lab_order_id = o));
  perform pg_temp.ck('the replaced result is never explainable', 'false', coalesce((pg_temp.mine(v_pat, fin) ->> 'explain_allowed'), 'null'));
end $$;

-- 3. The critical value call ---------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); rid uuid; c public.lab_critical_calls%rowtype; v_txt text; v_open text; rid2 uuid; c2 public.lab_critical_calls%rowtype; v_json text;
begin
  rid := pg_temp.submit('pat', 5.0);   -- creatinine 5.0 mg/dL is above the critical limit 4
  perform pg_temp.setf('crit1', rid);
  perform pg_temp.ck('a critical value is held with reason critical', 'awaiting_review|critical', pg_temp.state_of(rid) || '|' || (select release_reason from public.lab_results where id = rid));
  select * into c from public.lab_critical_calls where lab_result_id = rid;
  perform pg_temp.ck('a tracked call is opened to the primary on call, with the backup recorded', 'true|true|false',
    (c.called_clinician_id = pg_temp.f('primary'))::text || '|' || (c.backup_clinician_id = pg_temp.f('backup'))::text || '|' || c.no_cover::text);
  perform pg_temp.ck('the SLA clock is the second paging escalation time (10 minutes)', '10', (round(extract(epoch from c.due_at - c.called_at) / 60))::text);
  perform pg_temp.ck('the primary got push, in-app and email, critical, with the neutral template', '3',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('primary') and template = 'lab_critical_call' and priority = 'critical' and source_id = c.id));
  perform pg_temp.ck('the patient was told nothing about the call and cannot see the result', '0|0',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template like 'lab_critical%') || '|' || pg_temp.visible_to(v_pat, rid));
  perform pg_temp.ck('a second critical item in the same result does not open a second call', '1',
    (select count(*)::text from public.lab_critical_calls where lab_result_id = rid));
  -- who may acknowledge
  perform pg_temp.ck('a stranger clinician cannot acknowledge', 'not_permitted', pg_temp.q_as(pg_temp.f('stranger'), format('select public.acknowledge_lab_critical_call(%L)::jsonb ->> %L', c.id, 'error')));
  perform pg_temp.ck('a patient cannot acknowledge', 'true', (pg_temp.q_as(v_pat, format('select public.acknowledge_lab_critical_call(%L)::text', c.id)) like 'ERR:%')::text);
  perform pg_temp.ck('being called is not enough: the on-call clinician is not tied to the patient before acknowledging', 'not_permitted',
    pg_temp.q_as(pg_temp.f('primary'), format('select public.lab_result_for_review(%L, %L)::jsonb ->> %L', rid, 'proof', 'error')));
  v_txt := pg_temp.q_as(pg_temp.f('primary'), format('select public.acknowledge_lab_critical_call(%L)::text', c.id));
  v_open := pg_temp.q_as(pg_temp.f('primary'), format('select public.lab_result_for_review(%L, %L)::jsonb ->> %L', rid, 'proof', 'error'));
  perform pg_temp.ck('a clinician who merely works in the organisation is not tied by someone else''s call', 'not_permitted',
    pg_temp.q_as(pg_temp.f('stranger'), format('select public.lab_result_for_review(%L, %L)::jsonb ->> %L', rid, 'proof', 'error')));
  perform pg_temp.ck('...acknowledging takes responsibility: the clinician can now open the result (an audited, tied read)', 'null|true',
    coalesce(v_open, 'null') || '|' ||
    (exists (select 1 from public.audit_log where subject_patient_id = v_pat and action = 'staff.chart_read' and result = 'success' and actor_id = pg_temp.f('primary')))::text);
  perform pg_temp.ck('...but the tie is not a release: the result is still held', 'awaiting_review', pg_temp.state_of(rid));
  perform pg_temp.ck('the primary acknowledges: the time is recorded and the call stays open', 'true|true|true',
    ((v_txt)::jsonb ->> 'ok' = 'true')::text || '|' ||
    (select (acknowledged_at is not null and acknowledged_by = pg_temp.f('primary'))::text from public.lab_critical_calls where id = c.id) || '|' ||
    (select (closed_at is null)::text from public.lab_critical_calls where id = c.id));
  perform pg_temp.ck('acknowledging is idempotent', 'true', ((pg_temp.q_as(pg_temp.f('primary'), format('select public.acknowledge_lab_critical_call(%L)::text', c.id)))::jsonb ->> 'already' = 'true')::text);
  perform pg_temp.ck('acknowledging does not release the result', 'awaiting_review', pg_temp.state_of(rid));
  -- release authority (OQ-180 closed): senior or CMO only
  v_txt := pg_temp.q_as(pg_temp.f('coord'), format('select public.release_lab_result(%L)::text', rid));
  perform pg_temp.ck('a care coordinator cannot release a critical value', 'true|awaiting_review',
    (v_txt like 'ERR:%' or v_txt like '%not_permitted%')::text || '|' || pg_temp.state_of(rid));
  v_txt := pg_temp.q_as(pg_temp.f('doc'), format('select public.release_lab_result(%L)::text', rid));
  perform pg_temp.ck('a tied senior clinician releases it, and the call closes with the reason', 'true|released|released',
    ((v_txt)::jsonb ->> 'ok' = 'true')::text || '|' || pg_temp.state_of(rid) || '|' || (select close_reason from public.lab_critical_calls where id = c.id));
  perform pg_temp.ck('when the call closes the acknowledged clinician is no longer tied to the patient', 'not_permitted',
    pg_temp.q_as(pg_temp.f('primary'), format('select public.lab_result_for_review(%L, %L)::jsonb ->> %L', rid, 'proof', 'error')));

  -- an unacknowledged call escalates: backup at 5 minutes, clinical lead and ops at 10, and nothing is released
  rid2 := pg_temp.submit('pat2', 5.5);
  select * into c2 from public.lab_critical_calls where lab_result_id = rid2;
  perform pg_temp.setf('crit2', rid2);
  perform pg_temp.ck('before the first time, nothing escalates', '0|0', (private.sweep_lab_critical_calls() ->> 'backups') || '|' || (private.sweep_lab_critical_calls() ->> 'leads'));
  update public.lab_critical_calls set called_at = now() - interval '6 minutes' where id = c2.id;
  v_json := private.sweep_lab_critical_calls()::text;
  perform pg_temp.ck('after 5 minutes the backup is called', '1|3',
    (v_json::jsonb ->> 'backups') || '|' || (select count(*)::text from public.notifications where recipient_id = pg_temp.f('backup') and template = 'lab_critical_call' and source_id = c2.id));
  perform pg_temp.ck('...and the clinical lead is not yet told', 'true', (select (leadership_alerted_at is null)::text from public.lab_critical_calls where id = c2.id));
  update public.lab_critical_calls set called_at = now() - interval '11 minutes', due_at = now() - interval '1 minute' where id = c2.id;
  v_json := private.sweep_lab_critical_calls()::text;
  perform pg_temp.ck('after 10 minutes the CMO and ops are told and an incident opens', '1|true|true',
    (v_json::jsonb ->> 'leads') || '|' ||
    (exists (select 1 from public.notifications where recipient_id = pg_temp.f('cmo') and template = 'lab_critical_escalation' and source_id = c2.id))::text || '|' ||
    (exists (select 1 from public.ops_incidents where external_reference = 'lab_critical_unacknowledged:' || c2.id and status not in ('resolved', 'closed')))::text);
  perform pg_temp.ck('ESCALATION DOES NOT RELEASE: the result is still held and the patient sees nothing', 'awaiting_review|0',
    pg_temp.state_of(rid2) || '|' || pg_temp.visible_to(pg_temp.f('pat2'), rid2));
  perform pg_temp.ck('the sweep is idempotent', '0|0', (private.sweep_lab_critical_calls() ->> 'backups') || '|' || (private.sweep_lab_critical_calls() ->> 'leads'));
  -- one delivery that did not arrive must not end the chain: the lead is alerted again at the S19 repeat interval, up to its cap
  perform pg_temp.ck('nothing repeats inside the repeat interval', '0', private.sweep_lab_critical_calls() ->> 'lead_repeats');
  update public.lab_critical_calls set last_lead_alert_at = now() - interval '6 minutes' where id = c2.id;
  v_json := private.sweep_lab_critical_calls()::text;
  perform pg_temp.ck('after the repeat interval the lead is alerted again', '1|2',
    (v_json::jsonb ->> 'lead_repeats') || '|' ||
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('cmo') and template = 'lab_critical_escalation' and source_id = c2.id and channel = 'in_app'));
  update public.lab_critical_calls set last_lead_alert_at = now() - interval '6 minutes', lead_repeat_count = 12 where id = c2.id;
  perform pg_temp.ck('...and stops at the cap', '0', private.sweep_lab_critical_calls() ->> 'lead_repeats');
  perform pg_temp.act(pg_temp.f('primary'));
  perform pg_temp.ck('the primary sees the overdue call in their list', 'true', (select (count(*) filter (where overdue and lab_result_id = rid2) = 1)::text from public.my_lab_critical_calls()));
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('stranger'));
  perform pg_temp.ck('a clinician who is not on the call sees none of it', '0', (select count(*)::text from public.my_lab_critical_calls()));
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('cmo'));
  perform pg_temp.ck('the CMO sees every open call', 'true', (select (count(*) filter (where lab_result_id = rid2) = 1)::text from public.my_lab_critical_calls()));
  perform pg_temp.back();
  -- withhold closes the call
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.withhold_lab_result(%L, %L)::text', rid2, 'wrong patient'));
  perform pg_temp.ck('withholding the result closes its call', 'withheld', (select close_reason from public.lab_critical_calls where id = c2.id));
  perform pg_temp.ck('...and the close is audited, saying nobody had acknowledged it', 'true',
    (exists (select 1 from public.audit_log where action = 'lab_critical_call.closed' and entity_id = rid2 and event ->> 'reason' = 'withheld' and event ->> 'was_acknowledged' = 'false'))::text);

  -- nobody on the rota: the lead and ops are told at once, with an incident
  perform pg_temp.act(pg_temp.f('cmo'));
  perform public.cancel_on_call_rota((select id from public.on_call_rota where cancelled_at is null and starts_at <= now() and ends_at > now() limit 1), 'S27h proof: no cover');
  perform pg_temp.back();
  rid2 := pg_temp.submit('pat3', 5.2);
  select * into c2 from public.lab_critical_calls where lab_result_id = rid2;
  perform pg_temp.ck('with nobody on call the call is marked no_cover and the lead is told at once', 'true|true|true',
    c2.no_cover::text || '|' || (c2.leadership_alerted_at is not null)::text || '|' ||
    (exists (select 1 from public.ops_incidents where external_reference = 'lab_critical_no_cover:' || c2.id))::text);
  perform pg_temp.ck('...and the result is still held', 'awaiting_review', pg_temp.state_of(rid2));

  -- a failure to open the call is audited and raises an incident; the result is still stored, held (never silent)
  declare v_def text;
  begin
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'page_recipient';
    create or replace function private.page_recipient(p_org uuid, p_test boolean, p_patient uuid default null) returns uuid language plpgsql security definer set search_path = '' as $f$ begin raise exception 'proof: rota unreadable'; end $f$;
    rid2 := pg_temp.submit('pat4', 5.3);
    perform pg_temp.ck('if the call cannot be opened the result is still held', 'awaiting_review|0', pg_temp.state_of(rid2) || '|' || (select count(*)::text from public.lab_critical_calls where lab_result_id = rid2));
    perform pg_temp.ck('...the failure is audited and an incident opens', 'true|true',
      (exists (select 1 from public.audit_log where action = 'lab_critical_call.error' and entity_id = rid2))::text || '|' ||
      (exists (select 1 from public.ops_incidents where external_reference = 'lab_critical_call_failed:' || rid2))::text);
    execute v_def;
  end;
end $$;

-- 4. Hold-aging, the bounded fallback and the patient notice ------------------------------------------------------------------
do $$
declare v_pat2 uuid := pg_temp.f('pat2'); v_exp integer := private.lab_expected_minutes(); rid uuid; sens uuid; sens2 uuid; i integer; v_res jsonb; n_lead integer; v_out text;
begin
  perform pg_temp.ck('the expected time comes from the SLA table', 'true', (v_exp > 0)::text);
  rid := pg_temp.submit('pat2', 1.8);   -- abnormal, not critical
  perform pg_temp.setf('aging', rid);
  perform pg_temp.ck('an abnormal result is held', 'awaiting_review|abnormal', pg_temp.state_of(rid) || '|' || (select release_reason from public.lab_results where id = rid));
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('inside the expected time nobody is told anything', '0|0', pg_temp.notices(v_pat2, 'lab_result_still_reviewing')::text || '|' || pg_temp.notices_in_app(pg_temp.f('cmo'), 'lab_hold_aging')::text);
  perform pg_temp.age_result(rid, v_exp + 5);
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('past the expected time the patient gets ONE neutral notice', '1', pg_temp.notices(v_pat2, 'lab_result_still_reviewing')::text);
  perform pg_temp.sweep_holds(); perform pg_temp.sweep_holds();
  perform pg_temp.ck('...and never a second', '1', pg_temp.notices(v_pat2, 'lab_result_still_reviewing')::text);
  perform pg_temp.ck('the notice names no value or analyte', '0', (select count(*)::text from public.notifications where recipient_id = v_pat2 and template = 'lab_result_still_reviewing' and payload::text ~* 'creatinine|1\.8|mg'));
  -- escalation to the clinical lead at the PROPOSED threshold, repeated, capped
  perform pg_temp.age_result(rid, 1440 + 5);
  perform pg_temp.sweep_holds();
  n_lead := pg_temp.notices_in_app(pg_temp.f('cmo'), 'lab_hold_aging');
  perform pg_temp.ck('at the threshold the clinical lead is told once', '1', n_lead::text);
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('...not again straight away', '1', pg_temp.notices_in_app(pg_temp.f('cmo'), 'lab_hold_aging')::text);
  perform pg_temp.age_result(rid, 1440 + 720 + 5); perform pg_temp.sweep_holds();
  perform pg_temp.age_result(rid, 1440 + 1440 + 5); perform pg_temp.sweep_holds();
  perform pg_temp.age_result(rid, 1440 + 5000); perform pg_temp.sweep_holds(); perform pg_temp.sweep_holds();
  perform pg_temp.ck('the lead is told at most the configured number of times (3)', '3', pg_temp.notices_in_app(pg_temp.f('cmo'), 'lab_hold_aging')::text);
  perform pg_temp.ck('HOLD-AGING NEVER RELEASES: the result is still held, unreviewed, and invisible to the patient', 'awaiting_review|null|0',
    pg_temp.state_of(rid) || '|' || (select coalesce(reviewed_by::text, 'null') from public.lab_results where id = rid) || '|' || pg_temp.visible_to(v_pat2, rid));
  perform pg_temp.act(pg_temp.f('doc'));
  perform pg_temp.ck('the tied clinician sees the clock on the held result', 'true|true|true',
    (select (past_expected)::text || '|' || lead_escalated::text || '|' || (minutes_waiting > 6000)::text from public.lab_hold_clock() where lab_result_id = rid));
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('stranger'));
  perform pg_temp.ck('a clinician not tied to the patient sees no clock for it', '0', (select count(*)::text from public.lab_hold_clock() where lab_result_id = rid));
  perform pg_temp.back();

  -- a sensitive positive: aging tells the patient the same neutral thing, never escalates through this path, never releases
  sens := pg_temp.submit('pat3', 0.9, ',{"analyte_code":"hiv_screen","value_text":"positive"}');
  perform pg_temp.setf('sens', sens);
  perform pg_temp.ck('a reactive screen needs disclosure', 'clinician_disclosure_required', pg_temp.state_of(sens));
  perform pg_temp.age_result(sens, 100000);
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('a sensitive result never auto-releases however long it waits', 'clinician_disclosure_required', pg_temp.state_of(sens));
  perform pg_temp.ck('...its patient gets the same neutral still-reviewing notice and the lead is not paged through hold-aging', '1|3',
    pg_temp.notices(pg_temp.f('pat3'), 'lab_result_still_reviewing')::text || '|' || pg_temp.notices_in_app(pg_temp.f('cmo'), 'lab_hold_aging')::text);

  -- the bounded fallback: attempts used up, CMO told, wait elapsed, CMO has NOT signed -> nothing is sent
  for i in 1..3 loop
    v_out := pg_temp.q_as(pg_temp.f('doc'), format('select public.record_lab_disclosure_attempt(%L, %L)::text', sens, 'no_answer'));
  end loop;
  perform pg_temp.ck('the third failed attempt escalates to the CMO', 'true', (select (disclosure_escalated_at is not null)::text from public.lab_results where id = sens));
  update public.lab_results set disclosure_escalated_at = now() - interval '2 days' where id = sens;   -- (a plain column; the state machine allows it)
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('UNSIGNED wording: no fallback message is sent', '0', pg_temp.notices(pg_temp.f('pat3'), 'lab_result_contact_us')::text);
  perform pg_temp.sweep_holds(); perform pg_temp.sweep_holds();
  perform pg_temp.ck('...and the wait is not silent: once per result an audit row and one open incident say patients are waiting on the unsigned wording', '1|1',
    (select count(*)::text from public.audit_log where action = 'lab_result.disclosure_fallback_blocked_unsigned' and entity_id = sens) || '|' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'lab_fallback_wording_unsigned' and status not in ('resolved', 'closed')));
  perform pg_temp.ck('a clinician cannot sign the fallback wording', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_lab_fallback_wording(%L)::text', (select id from public.lab_fallback_wording_signoffs where is_active))) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot sign it', '42501', pg_temp.try_anon(format('select public.sign_lab_fallback_wording(%L)', (select id from public.lab_fallback_wording_signoffs where is_active))));
  perform pg_temp.ck('the CMO signs the wording', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_lab_fallback_wording(%L)::text', (select id from public.lab_fallback_wording_signoffs where is_active))) ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('SIGNED wording: exactly one neutral message goes to the patient', '1', pg_temp.notices(pg_temp.f('pat3'), 'lab_result_contact_us')::text);
  perform pg_temp.sweep_holds(); perform pg_temp.sweep_holds();
  perform pg_temp.ck('...never a second', '1', pg_temp.notices(pg_temp.f('pat3'), 'lab_result_contact_us')::text);
  -- the signature binds the exact words: editing the template body after signing turns the fallback off again
  update public.notification_template_locales set body = body || ' Thank you.' where template_key = 'lab_result_contact_us' and locale = 'en' and channel = 'in_app';
  perform pg_temp.ck('editing the signed words makes the wording read as unsigned again', 'false', private.lab_fallback_signed()::text);
  update public.notification_template_locales set body = replace(body, ' Thank you.', '') where template_key = 'lab_result_contact_us' and locale = 'en' and channel = 'in_app';
  perform pg_temp.ck('...and restoring them restores the signature', 'true', private.lab_fallback_signed()::text);
  perform pg_temp.ck('THE FALLBACK NEVER RELEASES: still held for disclosure, the patient cannot see it', 'clinician_disclosure_required|0|0',
    pg_temp.state_of(sens) || '|' || pg_temp.visible_to(pg_temp.f('pat3'), sens) || '|' || pg_temp.items_visible_to(pg_temp.f('pat3'), sens));
  perform pg_temp.ck('the message names no value, analyte or condition', '0',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('pat3') and template = 'lab_result_contact_us' and payload::text ~* 'hiv|positive|reactive|screen'));
  -- fewer attempts than the limit: the 72 hour route escalates, but the fallback needs the attempts
  sens2 := pg_temp.submit('pat6', 0.9, ',{"analyte_code":"hbsag","value_text":"positive"}');
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.record_lab_disclosure_attempt(%L, %L)::text', sens2, 'no_answer'));
  perform pg_temp.age_result(sens2, 100000);
  perform private.lab_disclosure_sweep();
  update public.lab_results set disclosure_escalated_at = now() - interval '2 days' where id = sens2;
  perform pg_temp.sweep_holds();
  perform pg_temp.ck('one attempt and a long wait sends no fallback message (the attempts are the condition)', '0', pg_temp.notices(pg_temp.f('pat6'), 'lab_result_contact_us')::text);
  perform pg_temp.ck('...and the result is still held', 'clinician_disclosure_required', pg_temp.state_of(sens2));
end $$;

-- 5. Delta check: a flag for the reviewer only ------------------------------------------------------------------------------------
do $$
declare v_prior uuid; v_new uuid; v_ctx jsonb; v_pat uuid := pg_temp.f('pat4'); v_flag jsonb;
begin
  v_prior := pg_temp.submit('pat4', 1.0);
  perform pg_temp.setf('prior4', v_prior);
  update public.lab_results set released_at = now() - interval '30 days' where id = v_prior;
  v_new := pg_temp.submit('pat4', 1.8);   -- +80 percent, still not critical
  perform pg_temp.setf('new4', v_new);
  v_ctx := pg_temp.q_as(pg_temp.f('doc'), format('select public.lab_result_review_context(%L, %L)::text', v_new, 'proof'))::jsonb;
  v_flag := (select f from jsonb_array_elements(v_ctx -> 'delta_flags') f where f ->> 'analyte_code' = 'creatinine');
  perform pg_temp.ck('a big change since the last RELEASED value is flagged to the reviewer', '1.0|1.8|80.0',
    coalesce((v_flag ->> 'previous') || '|' || (v_flag ->> 'current') || '|' || (v_flag ->> 'percent_change'), 'none'));
  perform pg_temp.ck('a small change is not flagged (potassium unchanged)', '0', (select count(*)::text from jsonb_array_elements(v_ctx -> 'delta_flags') f where f ->> 'analyte_code' = 'potassium'));
  perform pg_temp.ck('THE FLAG NEVER RELEASES: the result is still held after the reviewer looked', 'awaiting_review|null',
    pg_temp.state_of(v_new) || '|' || (select coalesce(reviewed_by::text, 'null') from public.lab_results where id = v_new));
  perform pg_temp.ck('the read is audited', 'true', (exists (select 1 from public.audit_log where subject_patient_id = v_pat and action = 'staff.chart_read' and result = 'success' and actor_id = pg_temp.f('doc')))::text);
  perform pg_temp.ck('a clinician not tied to the patient is refused', 'not_permitted', pg_temp.q_as(pg_temp.f('stranger'), format('select public.lab_result_review_context(%L, %L)::jsonb ->> %L', v_new, 'proof', 'error')));
  perform pg_temp.ck('the refused read is audited too', 'true', (exists (select 1 from public.audit_log where subject_patient_id = v_pat and action = 'staff.chart_read' and result = 'denied' and actor_id = pg_temp.f('stranger')))::text);
  perform pg_temp.ck('a reason is required', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.lab_result_review_context(%L, %L)::text', v_new, '')) like 'ERR:%')::text);
  perform pg_temp.ck('the patient cannot call it', 'true', (pg_temp.q_as(v_pat, format('select public.lab_result_review_context(%L, %L)::text', v_new, 'x')) like 'ERR:%')::text);
  -- a withdrawn earlier value is not a baseline
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.withdraw_lab_result(%L, %L)::text', v_prior, 'wrong patient'));
  v_ctx := pg_temp.q_as(pg_temp.f('doc'), format('select public.lab_result_review_context(%L, %L)::text', v_new, 'proof again'))::jsonb;
  perform pg_temp.ck('a withdrawn earlier result is not used as the baseline', '0', jsonb_array_length(v_ctx -> 'delta_flags')::text);
end $$;

-- 5a. A specimen rejection with an active CMO on the staff table (the staff notice used to be addressed to a staff id, which is not a profile) ----
do $$
declare v_pat uuid := pg_temp.f('pat6'); o uuid; sp uuid; v_new uuid; v_txt text;
begin
  o := pg_temp.new_order('pat6');
  select id into sp from public.lab_specimens where lab_order_id = o limit 1;
  perform pg_temp.ck('setup: the order has a specimen with its own id', 'true', (sp is not null)::text);
  v_txt := pg_temp.q_as(pg_temp.f('labA'), format('select (public.lab_partner_reject_specimen(%L, %L, %L)).id::text', sp, 'wrong_labelling', 'label unreadable'));
  perform pg_temp.ck('the rejection succeeds with an active CMO present and starts a re-collection', 'true|true',
    (v_txt ~ '^[0-9a-f-]{36}$')::text || '|' || (exists (select 1 from public.lab_specimens where recollection_of = sp))::text);
  perform pg_temp.ck('the CMO (a profile) is told, the staff id is not used as a recipient', '1|0',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('cmo') and template = 'lab_specimen_rejected_recollection_needed_staff') || '|' ||
    (select count(*)::text from public.notifications n join public.clinical_staff cs on cs.id = n.recipient_id));
end $$;

-- 6. Partner onboarding proof ------------------------------------------------------------------------------------------------------
do $$
declare v_id uuid;
begin
  perform pg_temp.ck('a laboratory inserted live with no proof is refused', '23514', pg_temp.try_sql($q$insert into public.lab_providers (name, is_active) values ('S27h Live No Proof', true)$q$));
  insert into public.lab_providers (name, is_active) values ('S27h Onboarding', false) returning id into v_id;
  perform pg_temp.ck('switching it on without proof is refused, naming what is missing', 'true',
    (pg_temp.try_sql(format($q$update public.lab_providers set is_active = true where id = %L$q$, v_id)) = '23514')::text);
  perform pg_temp.ck('the gaps are listed for the partner desk', '{licence_number,licence_verified,licence_current,accreditation}',
    pg_temp.q_as(pg_temp.f('admin'), format('select public.lab_provider_onboarding_gaps(%L)::text', v_id)));
  perform pg_temp.ck('a clinician cannot read the gaps', 'true', (pg_temp.q_as(pg_temp.f('doc'), format('select public.lab_provider_onboarding_gaps(%L)::text', v_id)) like 'ERR:not authorised%')::text);
  update public.lab_providers set license_number = 'MLSCN-1', license_verified_at = now(), license_expires_at = now() - interval '1 day', accreditation = 'ISO 15189' where id = v_id;
  perform pg_temp.ck('an expired licence still blocks switching on', '23514', pg_temp.try_sql(format($q$update public.lab_providers set is_active = true where id = %L$q$, v_id)));
  update public.lab_providers set license_expires_at = now() + interval '1 year', accreditation = ' ' where id = v_id;
  perform pg_temp.ck('a blank accreditation blocks switching on', '23514', pg_temp.try_sql(format($q$update public.lab_providers set is_active = true where id = %L$q$, v_id)));
  update public.lab_providers set accreditation = 'ISO 15189', contact_email = 'labs@placeholder.example' where id = v_id;
  perform pg_temp.ck('the placeholder-contact guard still blocks a live laboratory with full proof', '23514', pg_temp.try_sql(format($q$update public.lab_providers set is_active = true where id = %L$q$, v_id)));
  update public.lab_providers set contact_email = 'labs@realpartner.ng' where id = v_id;
  perform pg_temp.ck('with proof, a verified licence, a future expiry, an accreditation and a real contact it switches on', 'ok',
    pg_temp.try_sql(format($q$update public.lab_providers set is_active = true where id = %L$q$, v_id)));
  perform pg_temp.ck('a laboratory already live is not touched by the guard on unrelated updates', 'ok',
    pg_temp.try_sql(format($q$update public.lab_providers set status_notes = 'x' where id = %L$q$, v_id)));
  perform pg_temp.setf('lab_onboarded', v_id);
end $$;

-- 7. The patient's trend ----------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat5'); v_org uuid := pg_temp.f('org'); old_r uuid; new_r uuid; held uuid; v_t jsonb; v_note text; sens uuid; v_tr jsonb;
begin
  -- pat5 is a stranger to the treating doctor: tie the doctor to this patient for the note
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (v_org, v_pat, pg_temp.f('doc'), pg_temp.f('cmo'));
  old_r := pg_temp.submit('pat5', 0.9);
  update public.lab_results set released_at = now() - interval '60 days' where id = old_r;
  perform pg_temp.ck('one released value is not a trend', '[]', pg_temp.q_as(v_pat, 'select public.my_lab_trends()::text'));
  new_r := pg_temp.submit('pat5', 1.0);
  held := pg_temp.submit('pat5', 1.9);   -- abnormal: held, must never appear
  sens := pg_temp.submit('pat5', 0.9, ',{"analyte_code":"hiv_screen","value_text":"positive"}');   -- held for disclosure: must never appear
  perform pg_temp.ck('setup: the two normal results released, the other two held', 'released|released|awaiting_review|clinician_disclosure_required',
    pg_temp.state_of(old_r) || '|' || pg_temp.state_of(new_r) || '|' || pg_temp.state_of(held) || '|' || pg_temp.state_of(sens));
  v_t := pg_temp.q_as(v_pat, 'select public.my_lab_trends()::text')::jsonb;
  v_tr := (select x from jsonb_array_elements(v_t) x where x ->> 'analyte_code' = 'creatinine');
  perform pg_temp.ck('the trend compares the two RELEASED values: latest 1.0 against previous 0.9, higher', '1.0|0.9|higher',
    coalesce((v_tr -> 'latest' ->> 'value') || '|' || (v_tr -> 'previous' ->> 'value') || '|' || (v_tr ->> 'direction'), 'none'));
  perform pg_temp.ck('a HELD value (1.9) never appears in the trend', '0', (select count(*)::text from jsonb_array_elements(v_t) x where (x -> 'latest' ->> 'value')::numeric = 1.9 or (x -> 'previous' ->> 'value')::numeric = 1.9));
  perform pg_temp.ck('a sensitive screening analyte never appears (HIV, HBsAg, HCV)', '0', (select count(*)::text from jsonb_array_elements(v_t) x where x ->> 'analyte_code' in ('hiv_screen', 'hbsag', 'hcv_ab')));
  perform pg_temp.ck('only coded numeric values appear, and the trend carries no range and no flag', '0',
    (select count(*)::text from jsonb_array_elements(v_t) x where x ? 'ref_low' or x ? 'flag' or x -> 'latest' ? 'flag'));
  perform pg_temp.ck('another patient sees none of it', '[]', pg_temp.q_as(pg_temp.f('pat6'), 'select public.my_lab_trends()::text'));
  -- the care team's note
  perform pg_temp.ck('a tied clinician writes a note on the latest released numeric value', 'true',
    ((pg_temp.q_as(pg_temp.f('doc'), format('select public.write_lab_trend_note(%L, %L, %L)::text', new_r, 'creatinine', 'Slightly up. We will recheck at your next visit.')))::jsonb ->> 'ok' = 'true')::text);
  v_note := (select x ->> 'note' from jsonb_array_elements(pg_temp.q_as(v_pat, 'select public.my_lab_trends()::text')::jsonb) x where x ->> 'analyte_code' = 'creatinine');
  perform pg_temp.ck('the patient sees the note beside the value', 'Slightly up. We will recheck at your next visit.', coalesce(v_note, 'none'));
  perform pg_temp.ck('a note on a screening analyte is refused', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.write_lab_trend_note(%L, %L, %L)::text', new_r, 'hiv_screen', 'Please come and see us.')) like 'ERR:%lab_trend_note_analyte_not_allowed%')::text);
  perform pg_temp.ck('a note on a held result is refused', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.write_lab_trend_note(%L, %L, %L)::text', held, 'creatinine', 'This is high.')) like 'ERR:%lab_trend_note_result_not_current%')::text);
  perform pg_temp.ck('a clinician not tied to the patient cannot write a note', 'not_permitted',
    pg_temp.q_as(pg_temp.f('stranger'), format('select public.write_lab_trend_note(%L, %L, %L)::jsonb ->> %L', new_r, 'creatinine', 'Hello there.', 'error')));
  perform pg_temp.ck('a patient cannot write a note', 'true', (pg_temp.q_as(v_pat, format('select public.write_lab_trend_note(%L, %L, %L)::text', new_r, 'creatinine', 'Hello there.')) like 'ERR:%')::text);
  perform pg_temp.ck('a note is limited to 300 characters', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.write_lab_trend_note(%L, %L, %L)::text', new_r, 'creatinine', repeat('x', 301))) like 'ERR:%lab_trend_note_length%')::text);
  perform pg_temp.ck('notes cannot be edited, and no signed-in role can delete one', '42501|true',
    pg_temp.try_sql(format($q$update public.lab_trend_notes set note = 'changed note' where lab_result_id = %L$q$, new_r)) || '|' ||
    (pg_temp.q_as(pg_temp.f('doc'), format($q$delete from public.lab_trend_notes where lab_result_id = %L$q$, new_r)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('the patient reads only their own notes directly; another patient reads none', '1|0',
    pg_temp.q_as(v_pat, 'select count(*)::text from public.lab_trend_notes') || '|' || pg_temp.q_as(pg_temp.f('pat6'), 'select count(*)::text from public.lab_trend_notes'));
  perform pg_temp.ck('a clinician reads no note directly (the table has no staff policy)', '0', pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.lab_trend_notes'));
  -- withdrawing the latest value removes it, and with it the note, from the patient's trend
  perform pg_temp.q_as(pg_temp.f('doc'), format('select public.withdraw_lab_result(%L, %L)::text', new_r, 'entered against the wrong patient'));
  perform pg_temp.ck('a withdrawn result leaves the trend (one value left is not a trend)', '[]', pg_temp.q_as(v_pat, 'select public.my_lab_trends()::text'));
  perform pg_temp.ck('...and its note is no longer readable by the patient', '0', pg_temp.q_as(v_pat, 'select count(*)::text from public.lab_trend_notes'));
end $$;

-- SABOTAGE ------------------------------------------------------------------------------------------------------------------------
-- (a) the preliminary guard dropped: a preliminary result must then become releasable, which flips the refusal check
drop trigger lab_results_preliminary_guard on public.lab_results;
do $$
declare p uuid := pg_temp.f('prelim'); o uuid; r text; rid uuid; v_res text;
begin
  -- the prelim was replaced by its final; use a fresh preliminary
  o := pg_temp.new_order('pat2');
  r := pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_submit_preliminary_result(%L, %L, %L::jsonb)::text', o, 'membership_annual', pg_temp.items(0.9)));
  rid := pg_temp.rid(r);
  v_res := pg_temp.q_as(pg_temp.f('doc'), format('select public.release_lab_result(%L)::text', rid));
  insert into results values ('sabotaged', 'a preliminary result still cannot be released', 'awaiting_review', pg_temp.state_of(rid));
end $$;
-- (b) the fallback gate opened: an unsigned wording must then send, which flips the "no message while unsigned" check
create or replace function private.lab_fallback_signed() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
do $$
declare s uuid; i integer;
begin
  s := pg_temp.submit('pat4', 0.9, ',{"analyte_code":"hcv_ab","value_text":"positive"}');
  for i in 1..3 loop perform pg_temp.q_as(pg_temp.f('doc'), format('select public.record_lab_disclosure_attempt(%L, %L)::text', s, 'no_answer')); end loop;
  update public.lab_results set disclosure_escalated_at = now() - interval '2 days' where id = s;
  perform pg_temp.sweep_holds();
  insert into results values ('sabotaged', 'an unsigned wording sends no fallback message', '0', pg_temp.notices(pg_temp.f('pat4'), 'lab_result_contact_us')::text);
end $$;
-- (c) the delta threshold lifted so nothing is flagged: the flag check must flip
update public.lab_lifecycle_config set rules = jsonb_set(rules, '{delta,percent}', '1000') where is_active;
update public.lab_lifecycle_config set rules = jsonb_set(rules, '{delta,perAnalytePercent}', '{}'::jsonb) where is_active;
do $$
declare v_base uuid; v_held uuid; v_ctx jsonb;
begin
  -- a clean baseline and a +80 percent change; with the real threshold this is flagged (section 5 proves it), with the threshold lifted it is not
  v_base := pg_temp.submit('pat4', 1.0);
  update public.lab_results set released_at = now() - interval '30 days' where id = v_base;
  v_held := pg_temp.submit('pat4', 1.8);
  v_ctx := pg_temp.q_as(pg_temp.f('doc'), format('select public.lab_result_review_context(%L, %L)::text', v_held, 'sabotage'))::jsonb;
  insert into results values ('sabotaged', 'a big change since the last released value is flagged to the reviewer', '1',
    (select count(*)::text from jsonb_array_elements(v_ctx -> 'delta_flags') f where f ->> 'analyte_code' = 'creatinine'));
end $$;
-- (d) the trend with its release filter removed: the held value must then appear, which flips the "held never appears" check
do $$
declare v_def text; v_t jsonb;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'my_lab_trends';
  execute replace(v_def, 'r.release_state = ''released'' and ', '');
  v_t := pg_temp.q_as(pg_temp.f('pat2'), 'select public.my_lab_trends()::text')::jsonb;
  insert into results values ('sabotaged', 'the trend never includes a held value', '0',
    (select count(*)::text from jsonb_array_elements(v_t) x where (x -> 'latest' ->> 'value')::numeric = 1.8 or (x -> 'previous' ->> 'value')::numeric = 1.8));
end $$;
-- (e) the onboarding guard dropped: a laboratory with no proof must then switch on, which flips the refusal check
drop trigger lab_providers_activation_proof on public.lab_providers;
do $$
begin
  insert into results values ('sabotaged', 'a laboratory with no proof cannot be inserted live', '23514',
    pg_temp.try_sql($q$insert into public.lab_providers (name, is_active) values ('S27h Sabotage Live', true)$q$));
end $$;
-- (f) the critical escalation made to release: the "escalation does not release" check must flip
create or replace function private.sweep_lab_critical_calls() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  alter table public.lab_results disable trigger lab_results_guard;
  update public.lab_results set release_state = 'released', release_reason = 'clinician_review', reviewed_by = null, released_at = now()
   where id in (select lab_result_id from public.lab_critical_calls where closed_at is null);
  alter table public.lab_results enable trigger lab_results_guard;
  return '{}'::jsonb;
end $$;
do $$
declare rid uuid;
begin
  rid := pg_temp.submit('pat3', 5.4);
  perform private.sweep_lab_critical_calls();
  insert into results values ('sabotaged', 'the critical escalation never releases a result', 'awaiting_review', pg_temp.state_of(rid));
end $$;

-- (g) the rejection notice addressed to the staff id again (the original bug): the rejection must then fail, which flips the success check
do $$
declare v_def text; o uuid; sp uuid; v_txt text;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'lab_partner_reject_specimen';
  execute replace(v_def, 'cs.profile_id, ''in_app''', 'cs.id, ''in_app''');
  o := pg_temp.new_order('pat3');
  select id into sp from public.lab_specimens where lab_order_id = o limit 1;
  v_txt := pg_temp.q_as(pg_temp.f('labA'), format('select (public.lab_partner_reject_specimen(%L, %L, %L)).id::text', sp, 'wrong_labelling', 'label unreadable'));
  insert into results values ('sabotaged', 'a specimen can be rejected while a CMO is on the staff table', 'true', (v_txt ~ '^[0-9a-f-]{36}$')::text);
end $$;

-- (h) the tie branch widened so that ANY open critical call ties any clinician: the "not tied by someone else's call" check must then flip
do $$
declare v_def text; rid uuid;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'clinician_has_patient_access' and p.pronargs = 1;
  execute replace(v_def, 'lc.acknowledged_by = (select auth.uid())', 'true');
  rid := pg_temp.submit('pat6', 5.6);
  insert into results values ('sabotaged', 'a clinician who merely works in the organisation is not tied by someone else''s call', 'not_permitted',
    coalesce(pg_temp.q_as(pg_temp.f('stranger'), format('select public.lab_result_for_review(%L, %L)::jsonb ->> %L', rid, 'proof', 'error')), 'null'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S27h proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 8 then raise exception 'VACUOUS TEST: the sabotage flipped % of 8 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

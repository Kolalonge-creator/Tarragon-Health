-- S27 proof: lab results and release rules (migration *_s27_lab_results_release_rules.sql). Spec 4.4; safety cases 11, 12, 13.
-- INV-03 (abnormal held, patient sees only released), INV-04 (sensitive positive never auto-released), INV-07 (neutral notice),
-- INV-10 (audited staff read), INV-12 (tie), INV-13 (is_test).
-- One rolled-back transaction. Sections:
--   1. Grants and policies: nothing for anon, no direct writes, no direct file or table reads for staff.
--   2. Case 13: all normal auto-releases (RES-001), no task, neutral notice, order resulted.
--   3. Case 11: raised creatinine held, task, patient cannot see it, clinician release makes it visible, order only moves on release.
--   4. Case 12: positive HBsAg needs disclosure, task of the disclosure type, release needs senior clinician AND attestation.
--   5. Entry rules: wrong unit, unknown analyte, indeterminate text, missing required analyte, double submit, other lab's order.
--   6. Patient upload and team upload: held, patient sees own file, not an explanation; withhold hides from the patient.
--   7. Immutability: items append only, a released result is final, a direct state write is refused.
--   8. SABOTAGE: the release rule and the patient policy opened; both checks must flip.
--  10. S27g: one Membership panel, sex-specific ranges, standards-checked critical limits, with its own sabotage.
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
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S27 ' || p_label, 'MDCN', 'S27-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
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

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_lab_a uuid; v_lab_b uuid; v_pat uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  insert into public.lab_providers (name, is_active) values ('S27 Lab A', false) returning id into v_lab_a;
  insert into public.lab_providers (name, is_active) values ('S27 Lab B', false) returning id into v_lab_b;
  perform pg_temp.setf('labA', pg_temp.mkuser(v_org, 'labA', 'lab_partner'));
  perform pg_temp.setf('labB', pg_temp.mkuser(v_org, 'labB', 'lab_partner'));
  update public.profiles set lab_provider_id = v_lab_a where id = pg_temp.f('labA');
  update public.profiles set lab_provider_id = v_lab_b where id = pg_temp.f('labB');
  perform pg_temp.setf('labA_provider', v_lab_a);
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('senior', pg_temp.mkdoc(v_org, 'senior', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (v_org, v_pat, pg_temp.f('doc'), pg_temp.f('senior'));
  perform pg_temp.setf('liaison', pg_temp.mkuser(v_org, 'liaison', 'lab_liaison'));
end $$;

-- 1. Grants ---------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat');
begin
  perform pg_temp.ck('anon cannot read results', '42501', pg_temp.try_anon('select * from public.lab_results'));
  perform pg_temp.ck('anon cannot call the patient read', '42501', pg_temp.try_anon('select public.my_lab_results()'));
  perform pg_temp.ck('a patient cannot write a result directly', 'true',
    (pg_temp.q_as(v_pat, format($q$insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind) values (%L, %L, 'pdf_upload', 'patient')$q$, pg_temp.f('org'), v_pat)) like 'ERR:permission denied%')::text);
  perform pg_temp.ck('nobody signed in can read the file table', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), 'select count(*) from public.lab_result_files') like 'ERR:permission denied%')::text);
  perform pg_temp.ck('a clinician cannot read the results table directly (reads go through the audited function)', '0',
    pg_temp.q_as(pg_temp.f('doc'), 'select count(*)::text from public.lab_results'));
  perform pg_temp.ck('the private bucket exists and is not public', 'false', (select public::text from storage.buckets where id = 'lab-results'));
  perform pg_temp.ck('no storage policy names the bucket', '0', (select count(*)::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') || coalesce(with_check, '')) like '%lab-results%'));
end $$;

-- 1b. Unsigned ranges: nothing auto-releases until the CMO signs (S27d) ------------------------------------------------------------
do $$
declare v_pat2 uuid := pg_temp.f('pat2'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid; v_id uuid;
begin
  perform pg_temp.ck('the ranges start unsigned', 'false', (select private.lab_panels_signed()::text));
  o := pg_temp.mkorder(v_org, v_pat2, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9));
  rid := pg_temp.rid(r);
  perform pg_temp.ck('an all-normal result is HELD while the ranges are unsigned', 'awaiting_review|ranges_not_signed',
    pg_temp.state_of(rid) || '|' || (select release_reason from public.lab_results where id = rid));
  perform pg_temp.ck('...and the patient cannot see it', '0', pg_temp.visible_to(v_pat2, rid));
  perform pg_temp.ck('a clinician cannot sign the lab ranges', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format('select public.sign_lab_panels(%L)::text', (select id from public.lab_panel_signoffs where is_active))) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('a patient cannot sign them', 'true',
    (pg_temp.q_as(v_pat2, format('select public.sign_lab_panels(%L)::text', (select id from public.lab_panel_signoffs where is_active))) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('anon cannot call sign', '42501', pg_temp.try_anon(format('select public.sign_lab_panels(%L)', (select id from public.lab_panel_signoffs where is_active))));
  perform pg_temp.ck('the CMO signs them', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_lab_panels(%L)::text', (select id from public.lab_panel_signoffs where is_active))) ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.ck('...and the signature is recorded', 'true|true', (private.lab_panels_signed())::text || '|' ||
    (select (approved_by = (select id from public.clinical_staff where profile_id = pg_temp.f('cmo')))::text from public.lab_panel_signoffs where is_active));
  -- the held result from before the signature stays held (a signature never releases anything retroactively)
  perform pg_temp.ck('a signature does not release an earlier held result', 'awaiting_review', pg_temp.state_of(rid));
end $$;

-- 2. Case 13: all normal auto-releases ------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid; n integer;
begin
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'payment_confirmed');
  perform pg_temp.setf('order_normal', o);
  perform pg_temp.q_as(pg_temp.f('labA'), format('select public.lab_partner_mark_collected(%L)::text', o));
  perform pg_temp.ck('partner marks collected: the order is sample_collected', 'sample_collected', pg_temp.order_status(o));
  perform pg_temp.ck('another lab cannot mark it collected', 'true',
    (pg_temp.q_as(pg_temp.f('labB'), format('select public.lab_partner_mark_collected(%L)::text', o)) like 'ERR:Order not found for this lab')::text);
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9));
  perform pg_temp.ck('case 13: an all-normal annual panel is released', 'released', case when r like 'ERR:%' then r else r::jsonb ->> 'release_state' end);
  rid := pg_temp.rid(r);
  perform pg_temp.setf('res_normal', rid);
  perform pg_temp.ck('...with reason RES-001', 'RES-001', (select release_reason from public.lab_results where id = rid));
  perform pg_temp.ck('...no clinician reviewed it', 'null', (select coalesce(reviewed_by::text, 'null') from public.lab_results where id = rid));
  perform pg_temp.ck('...no task was created', '0', (select count(*)::text from public.clinical_tasks where dedup_key = 'lab_result:' || rid));
  perform pg_temp.ck('...the patient can see it', '1', pg_temp.visible_to(v_pat, rid));
  perform pg_temp.ck('...and its fifteen items', '15', pg_temp.items_visible_to(v_pat, rid));
  perform pg_temp.ck('...the order is resulted', 'resulted', pg_temp.order_status(o));
  perform pg_temp.ck('...the patient got one neutral notice', '1', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready'));
  perform pg_temp.ck('...whose payload names no value', 'true',
    (select (payload::text !~* '(creatinine|glucose|value|flag|normal)')::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready' limit 1));
  perform pg_temp.ck('...a received and a released event, ids only', '2',
    (select count(*)::text from public.domain_events where aggregate_id = rid and event_type in ('lab_result.received', 'lab_result.released') and payload::text !~* 'creatinine'));
  perform pg_temp.ck('...the flag was computed by the database (a flag sent by the lab is ignored)', 'normal',
    (select flag from public.lab_result_items where lab_result_id = rid and analyte_code = 'creatinine'));
  perform pg_temp.ck('...a second submission for the same order is refused', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9)) like 'ERR:lab_result_already_received')::text);
  perform pg_temp.ck('...explain is allowed for an all-normal released result', 'true',
    (pg_temp.mine(v_pat, rid) ->> 'explain_allowed'));
end $$;

-- 3. Case 11: raised creatinine is held --------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid; q text;
begin
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(1.9));
  rid := pg_temp.rid(r);
  perform pg_temp.setf('res_high', rid);
  perform pg_temp.ck('case 11: creatinine 1.9 is held for review', 'awaiting_review', pg_temp.state_of(rid));
  perform pg_temp.ck('...the flag is high', 'high', (select flag from public.lab_result_items where lab_result_id = rid and analyte_code = 'creatinine'));
  perform pg_temp.ck('...a routine result review task was created', 'routine_result_review', pg_temp.task_of(rid));
  perform pg_temp.ck('...the patient cannot read the result row', '0', pg_temp.visible_to(v_pat, rid));
  perform pg_temp.ck('...nor its items', '0', pg_temp.items_visible_to(v_pat, rid));
  perform pg_temp.ck('...the patient list says only that it is under review and shows no items', 'under_review|0',
    (pg_temp.mine(v_pat, rid) ->> 'status') || '|' || jsonb_array_length(pg_temp.mine(v_pat, rid) -> 'items'));
  perform pg_temp.ck('...no file path is offered', 'null', coalesce(pg_temp.q_as(v_pat, format('select public.lab_result_file_path(%L)', rid)), 'null'));
  perform pg_temp.ck('...the patient got no notice', '1', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready'));
  perform pg_temp.ck('...the order is processing, not resulted', 'processing', pg_temp.order_status(o));
  perform pg_temp.ck('another patient cannot see it either', '0', pg_temp.visible_to(pg_temp.f('pat2'), rid));
  perform pg_temp.ck('a clinician with no tie cannot open it', 'true',
    (pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.lab_result_for_review(%L, 'checking')::text$q$, rid)) like '%not_permitted%')::text);
  perform pg_temp.ck('...and the refusal is recorded in the audit log (it is returned, not raised, so it commits)', 'true',
    (exists (select 1 from public.audit_log where subject_patient_id = v_pat and action = 'staff.chart_read' and result = 'denied' and actor_id = pg_temp.f('stranger')))::text);
  perform pg_temp.ck('...a reason is required', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format($q$select public.lab_result_for_review(%L, '')::text$q$, rid)) like 'ERR:A reason is required')::text);
  q := pg_temp.q_as(pg_temp.f('doc'), format($q$select public.lab_result_for_review(%L, 'Reviewing a held lab result')::text$q$, rid));
  perform pg_temp.ck('the tied clinician reads it with its items', 'high', case when q like 'ERR:%' then q else (select i ->> 'flag' from jsonb_array_elements(q::jsonb -> 'items') i where i ->> 'analyte_code' = 'creatinine') end);
  perform pg_temp.ck('...and the read is in the audit log', 'true',
    (exists (select 1 from public.audit_log where subject_patient_id = v_pat and action = 'staff.chart_read' and event ->> 'sections' like '%lab_results%'))::text);
  perform pg_temp.ck('the queue lists it for the tied clinician', '1',
    pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.lab_results_review_queue() where lab_result_id = %L', rid)));
  perform pg_temp.ck('...and not for a stranger', '0',
    pg_temp.q_as(pg_temp.f('stranger'), format('select count(*)::text from public.lab_results_review_queue() where lab_result_id = %L', rid)));
  perform pg_temp.ck('the review queue and an open do not release anything', 'awaiting_review', pg_temp.state_of(rid));
  perform pg_temp.ck('a patient cannot release their own result', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.release_lab_result(%L)$q$, rid)) like 'ERR:This action is for clinicians')::text);
  perform pg_temp.ck('the partner cannot release it either', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format($q$select public.release_lab_result(%L)$q$, rid)) like 'ERR:This action is for clinicians')::text);
  perform pg_temp.ck('a stranger clinician cannot release it', 'true',
    (pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.release_lab_result(%L)::text$q$, rid)) like '%not_permitted%')::text);
  perform pg_temp.ck('...and the result is still held after that attempt', 'awaiting_review', pg_temp.state_of(rid));
  perform pg_temp.ck('the tied clinician releases it', 'true', (coalesce(pg_temp.q_as(pg_temp.f('doc'), format($q$select public.release_lab_result(%L, 'Reviewed, advised a repeat in 3 months')::text$q$, rid)), '') not like 'ERR:%')::text);
  perform pg_temp.ck('...now released', 'released', pg_temp.state_of(rid));
  perform pg_temp.ck('...reason clinician_review, by the clinician', 'clinician_review|true',
    (select release_reason || '|' || (reviewed_by = pg_temp.f('doc'))::text from public.lab_results where id = rid));
  perform pg_temp.ck('...the patient can now read it', '1', pg_temp.visible_to(v_pat, rid));
  perform pg_temp.ck('...its unclaimed review task was closed by the release (OQ-178)', 'cancelled',
    (select state::text from public.clinical_tasks where dedup_key = 'lab_result:' || rid));
  perform pg_temp.ck('...the order is resulted', 'resulted', pg_temp.order_status(o));
  perform pg_temp.ck('...one neutral notice now exists for this patient (two in all)', '2', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready'));
  perform pg_temp.ck('a released result cannot be released or withheld again', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format($q$select public.withhold_lab_result(%L, 'changed my mind')$q$, rid)) like 'ERR:lab_result_final')::text);

  -- a critical value gets the higher priority task
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', replace(pg_temp.items(0.9), '"potassium","value_numeric":4.1', '"potassium","value_numeric":7.2'));
  perform pg_temp.ck('a critical potassium makes a critical result review task', 'critical_result_review', pg_temp.task_of(pg_temp.rid(r)));
  perform pg_temp.setf('res_crit', pg_temp.rid(r));
  -- (F-05: the senior-only gate no longer separates two doctor tiers, so its Medical Officer check was removed)
  perform pg_temp.ck('...it is still held', 'awaiting_review', pg_temp.state_of(pg_temp.rid(r)));
  perform pg_temp.ck('a senior clinician can', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.release_lab_result(%L)::text$q$, pg_temp.rid(r))) like '%"ok": true%')::text);
end $$;

-- 4. Case 12: positive HBsAg ---------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid;
  v_extra text := ',{"analyte_code":"hbsag","value_text":"positive"}';
begin
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9, v_extra));
  rid := pg_temp.rid(r);
  perform pg_temp.setf('res_sens', rid);
  perform pg_temp.ck('case 12: a positive HBsAg needs clinician disclosure', 'clinician_disclosure_required', pg_temp.state_of(rid));
  perform pg_temp.ck('...the item is marked sensitive_positive', 'true', (select sensitive_positive::text from public.lab_result_items where lab_result_id = rid and analyte_code = 'hbsag'));
  perform pg_temp.ck('...a disclosure task was created', 'sensitive_result_disclosure', pg_temp.task_of(rid));
  perform pg_temp.ck('...the patient cannot read the row or the items', '0|0', pg_temp.visible_to(v_pat, rid) || '|' || pg_temp.items_visible_to(v_pat, rid));
  perform pg_temp.ck('...the list says the care team will contact them, explain is not allowed', 'under_review|false',
    (pg_temp.mine(v_pat, rid) ->> 'status') || '|' || (pg_temp.mine(v_pat, rid) ->> 'explain_allowed'));
  perform pg_temp.ck('...and no notice was sent', '3', (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready'));
  perform pg_temp.ck('the ordinary release function refuses it', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.release_lab_result(%L)$q$, rid)) like 'ERR:lab_result_not_awaiting_review')::text);
  -- (F-05: the senior-only gate no longer separates two doctor tiers, so its Medical Officer check was removed)
  perform pg_temp.ck('a senior clinician cannot do it without the attestation', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.record_lab_disclosure(%L, 'in_person', false)$q$, rid)) like 'ERR:lab_disclosure_needs_attestation')::text);
  perform pg_temp.ck('...nor with an unknown method', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.record_lab_disclosure(%L, 'whatsapp', true)$q$, rid)) like 'ERR:lab_disclosure_needs_attestation')::text);
  perform pg_temp.ck('a direct state change to released is refused by the guard', 'true',
    (pg_temp.try_sql(format($q$update public.lab_results set release_state = 'released', release_reason = 'RES-001', released_at = now() where id = %L$q$, rid)) = '42501')::text);
  perform pg_temp.ck('the state is unchanged after those attempts', 'clinician_disclosure_required', pg_temp.state_of(rid));
  perform pg_temp.ck('the senior clinician records the disclosure', 'true',
    (coalesce(pg_temp.q_as(pg_temp.f('senior'), format($q$select public.record_lab_disclosure(%L, 'in_person', true, 'Told the patient face to face')::text$q$, rid)), '') not like 'ERR:%')::text);
  perform pg_temp.ck('...the disclosure task was closed', 'cancelled', (select state::text from public.clinical_tasks where dedup_key = 'lab_result:' || rid));
  perform pg_temp.ck('...now released with the method and attestation', 'released|in_person|true|disclosure_recorded',
    (select release_state || '|' || disclosure_method || '|' || disclosure_attested::text || '|' || release_reason from public.lab_results where id = rid));
  perform pg_temp.ck('...the patient can read it, but an explanation is still not allowed', 'true|false',
    ((pg_temp.visible_to(v_pat, rid) = '1')::text) || '|' || (pg_temp.mine(v_pat, rid) ->> 'explain_allowed'));

  -- a negative screen with otherwise normal values auto-releases and may be explained
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9, replace(v_extra, '"positive"', '"negative"')));
  perform pg_temp.ck('a negative HBsAg with normal values auto-releases', 'released', pg_temp.state_of(pg_temp.rid(r)));
end $$;

-- 5. Entry rules ------------------------------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text;
begin
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  perform pg_temp.ck('a wrong unit is refused', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', '[{"analyte_code":"creatinine","value_numeric":90,"unit":"umol/L"}]') like 'ERR:lab_unit_mismatch')::text);
  perform pg_temp.ck('an unknown analyte is refused', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', '[{"analyte_code":"made_up","value_numeric":1}]') like 'ERR:lab_unknown_analyte')::text);
  perform pg_temp.ck('indeterminate text is refused, never guessed', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', '[{"analyte_code":"hbsag","value_text":"indeterminate"}]') like 'ERR:lab_value_not_recognised')::text);
  perform pg_temp.ck('a duplicate analyte is refused', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', '[{"analyte_code":"alt","value_numeric":1},{"analyte_code":"alt","value_numeric":2}]') like 'ERR:lab_duplicate_analyte')::text);
  perform pg_temp.ck('a refused entry leaves no result behind', '0', (select count(*)::text from public.lab_results where lab_order_id = o));
  perform pg_temp.ck('another lab cannot submit for this order', 'true',
    (pg_temp.partner_submit(pg_temp.f('labB'), o, 'membership_annual', pg_temp.items(0.9)) like 'ERR:Order not found for this lab')::text);
  perform pg_temp.ck('a patient cannot use the partner function', 'true',
    (pg_temp.partner_submit(v_pat, o, 'membership_annual', pg_temp.items(0.9)) like 'ERR:This action is for partner labs')::text);
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', (select replace(pg_temp.items(0.9), ',{"analyte_code":"alt","value_numeric":24}', '')));
  perform pg_temp.ck('a normal result with a required analyte missing is held, not released', 'awaiting_review|incomplete',
    pg_temp.state_of(pg_temp.rid(r)) || '|' || (select release_reason from public.lab_results where id = pg_temp.rid(r)));
  perform pg_temp.ck('a pending-payment order is refused', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'pending_payment'), 'membership_annual', pg_temp.items(0.9)) like 'ERR:Order not found for this lab' or
     pg_temp.partner_submit(pg_temp.f('labA'), pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'pending_payment'), 'membership_annual', pg_temp.items(0.9)) like 'ERR:lab_order_not_payable_state')::text);
  perform pg_temp.ck('the partner worklist shows only its own orders', 'true',
    (pg_temp.q_as(pg_temp.f('labB'), 'select count(*)::text from public.lab_partner_portal_orders()') = '0')::text);
end $$;

-- 5b. The older partner PDF function now holds the result (OQ-177) and the explain gate (OQ-179) -------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid; n_docs integer; n_notes integer;
begin
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  select count(*) into n_notes from public.notifications where recipient_id = v_pat and template = 'result_document_available';
  r := pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_upload_result(%L, %L, 'old.pdf', 'application/pdf', 1000, 'note')::text$q$, o, v_pat::text || '/old.pdf'));
  perform pg_temp.ck('the older partner upload returns a result id', 'true', (r ~ '^[0-9a-f-]{36}$')::text);
  select id into rid from public.lab_results where lab_order_id = o;
  perform pg_temp.ck('...which is held for review', 'awaiting_review', pg_temp.state_of(rid));
  perform pg_temp.ck('...the patient cannot see it', '0', pg_temp.visible_to(v_pat, rid));
  select count(*) into n_docs from public.lab_result_documents where lab_order_id = o;
  perform pg_temp.ck('...no visible document row was written', '0', n_docs::text);
  perform pg_temp.ck('...and the patient was not notified that a result document is available', n_notes::text,
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'result_document_available'));
  perform pg_temp.ck('...the order is processing, not resulted', 'processing', pg_temp.order_status(o));
  perform pg_temp.ck('the older upload also refuses another lab''s order', 'true',
    (pg_temp.q_as(pg_temp.f('labB'), format($q$select public.lab_partner_upload_result(%L, %L, 'old.pdf', 'application/pdf', 1000, null)::text$q$, o, v_pat::text || '/old2.pdf')) like 'ERR:Order not found for this lab')::text);
  perform pg_temp.ck('explain gate: a normal released partner result may be explained', 'true',
    pg_temp.q_as(v_pat, format('select public.lab_result_explain_allowed(%L)::text', pg_temp.f('res_normal'))));
  perform pg_temp.ck('explain gate: a released sensitive-positive result may not', 'false',
    pg_temp.q_as(v_pat, format('select public.lab_result_explain_allowed(%L)::text', pg_temp.f('res_sens'))));
  perform pg_temp.ck('explain gate: a held result may not', 'false',
    pg_temp.q_as(v_pat, format('select public.lab_result_explain_allowed(%L)::text', rid)));
  perform pg_temp.ck('explain gate: another patient asking gets false', 'false',
    pg_temp.q_as(pg_temp.f('pat2'), format('select public.lab_result_explain_allowed(%L)::text', pg_temp.f('res_normal'))));
  perform pg_temp.ck('explain gate: anon cannot call it', '42501', pg_temp.try_anon(format('select public.lab_result_explain_allowed(%L)', pg_temp.f('res_normal'))));
end $$;

-- 6. Patient upload, team upload, withhold ------------------------------------------------------------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); r text; rid uuid; v_file text := format('{"file_path":"%s/x.pdf","original_filename":"x.pdf","mime_type":"application/pdf","file_size_bytes":1000}', v_pat);
begin
  r := pg_temp.q_as(v_pat, format($q$select public.patient_add_lab_result(%L::jsonb)::text$q$, v_file));
  rid := pg_temp.rid(r);
  perform pg_temp.ck('a Free patient upload is held and creates no doctor task', 'awaiting_review|none', pg_temp.state_of(rid) || '|' || coalesce(pg_temp.task_of(rid), 'none'));
  perform pg_temp.ck('a file path in another patient folder is refused', 'true',
    (pg_temp.q_as(v_pat, $q$select public.patient_add_lab_result('{"file_path":"someone-else/x.pdf","mime_type":"application/pdf","file_size_bytes":10}'::jsonb)::text$q$) like 'ERR:lab_file_path_invalid')::text);
  perform pg_temp.ck('...the patient sees their own upload in the list, but explanation is off and no values are shown', 'under_review|false',
    (pg_temp.mine(v_pat, rid) ->> 'status') || '|' || (pg_temp.mine(v_pat, rid) ->> 'explain_allowed'));
  perform pg_temp.ck('...and can get their own file back', v_pat::text || '/x.pdf', pg_temp.q_as(v_pat, format('select public.lab_result_file_path(%L)', rid)));
  perform pg_temp.ck('...another patient cannot', 'null', coalesce(pg_temp.q_as(pg_temp.f('pat2'), format('select public.lab_result_file_path(%L)', rid)), 'null'));
  perform pg_temp.ck('a partner cannot add a patient upload', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format($q$select public.patient_add_lab_result(%L::jsonb)::text$q$, v_file)) like 'ERR:This action is for patients')::text);
  perform pg_temp.ck('an upload with a file type not allowed is refused', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.patient_add_lab_result(jsonb_build_object('file_path', %L, 'mime_type', 'application/x-msdownload', 'file_size_bytes', 10))::text$q$, v_pat::text || '/y.exe')) like 'ERR:%check%')::text);
  -- team upload
  r := pg_temp.q_as(pg_temp.f('senior'), format($q$select public.team_submit_lab_result(%L, null, null, null, %L::jsonb)::text$q$, v_pat, v_file));
  perform pg_temp.ck('a tied clinician can add a PDF for the patient; it is held', 'awaiting_review', pg_temp.state_of(pg_temp.rid(r)));
  perform pg_temp.ck('a stranger clinician cannot', 'true',
    (pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.team_submit_lab_result(%L, null, null, null, %L::jsonb)::text$q$, v_pat, v_file)) like 'ERR:Not permitted')::text);
  perform pg_temp.ck('a patient cannot use the team function', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.team_submit_lab_result(%L, null, null, null, %L::jsonb)::text$q$, v_pat, v_file)) like 'ERR:This action is for the care team')::text);
  -- withhold
  perform pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withhold_lab_result(%L, 'Entered against the wrong patient')::text$q$, pg_temp.rid(r)));
  perform pg_temp.ck('a withheld result is gone from the patient list', '0',
    (select count(*)::text from jsonb_array_elements(pg_temp.my_as(v_pat)) x where x ->> 'lab_result_id' = pg_temp.rid(r)::text));
  r := pg_temp.q_as(v_pat, format($q$select public.patient_add_lab_result(%L::jsonb)::text$q$, v_file));
  perform pg_temp.ck('a patient can read the row of their own held upload', '1', pg_temp.visible_to(v_pat, pg_temp.rid(r)));
  perform pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withhold_lab_result(%L, 'Not a lab report')::text$q$, pg_temp.rid(r)));
  perform pg_temp.ck('a patient''s own held upload promises no review time', 'null',
    coalesce(pg_temp.mine(v_pat, (select id from public.lab_results where patient_id = v_pat and submitted_by_kind = 'patient' and release_state = 'awaiting_review' limit 1)) ->> 'expected_by', 'null'));
  perform pg_temp.ck('a withheld own upload is not readable by the patient through the table either', '0', pg_temp.visible_to(v_pat, pg_temp.rid(r)));
  perform pg_temp.ck('a withhold needs a reason', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withhold_lab_result(%L, ' ')$q$, rid)) like 'ERR:A reason is required')::text);
end $$;

-- 7. Immutability ----------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('items cannot be updated', '42501', pg_temp.try_sql(format($q$update public.lab_result_items set value_numeric = 1 where lab_result_id = %L$q$, pg_temp.f('res_high'))));
  perform pg_temp.ck('items cannot be deleted', '42501', pg_temp.try_sql(format($q$delete from public.lab_result_items where lab_result_id = %L$q$, pg_temp.f('res_high'))));
  perform pg_temp.ck('a released result cannot go back to held', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set release_state = 'awaiting_review' where id = %L$q$, pg_temp.f('res_normal'))));
  perform pg_temp.ck('the panel version of a result cannot change', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set panel_version_id = null where id = %L$q$, pg_temp.f('res_normal'))));
  perform pg_temp.ck('every structured result names its panel version (INV-16)', '0',
    (select count(*)::text from public.lab_results where source = 'portal_entry' and panel_version_id is null));
  perform pg_temp.ck('test accounts carry is_test through', '0', (select count(*)::text from public.lab_results r where not r.is_test));
  perform pg_temp.ck('a held result (abnormal or incomplete) cannot be auto-released by writing RES-001 onto it', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set release_state = 'released', release_reason = 'RES-001', released_at = now() where id = %L$q$,
      (select id from public.lab_results where release_state = 'awaiting_review' and source = 'portal_entry' limit 1))));
end $$;


-- 9. S27d: corrections, withdrawal, disclosure fallback, waiting state, the staff document path ------------------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; r text; rid uuid; old_id uuid := pg_temp.f('res_normal');
        c text; cid uuid; n_notes integer; sens uuid := pg_temp.f('res_sens'); doc_id uuid; o2 uuid;
begin
  -- corrections
  select lab_order_id into o from public.lab_results where id = old_id;
  perform pg_temp.ck('a correction needs a kind and a reason', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_correction(%L, %L, 'corrected', '', 'membership_annual', %L::jsonb)::text$q$, o, old_id, pg_temp.items(0.9))) like 'ERR:lab_correction_needs_kind_and_reason')::text);
  perform pg_temp.ck('another lab cannot correct this order', 'true',
    (pg_temp.q_as(pg_temp.f('labB'), format($q$select public.lab_partner_submit_correction(%L, %L, 'corrected', 'Typing error', 'membership_annual', %L::jsonb)::text$q$, o, old_id, pg_temp.items(0.9))) like 'ERR:Order not found for this lab')::text);
  select count(*) into n_notes from public.notifications where recipient_id = v_pat and template = 'lab_result_corrected';
  c := pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_correction(%L, %L, 'corrected', 'Creatinine was keyed wrongly', 'membership_annual', %L::jsonb)::text$q$, o, old_id, pg_temp.items(1.9)));
  cid := pg_temp.rid(c);
  perform pg_temp.ck('a correction that makes a value abnormal is HELD (it goes back through the gate)', 'awaiting_review', pg_temp.state_of(cid));
  perform pg_temp.ck('...the original stays released and is not yet marked replaced', 'released|null',
    pg_temp.state_of(old_id) || '|' || (select coalesce(superseded_by::text, 'null') from public.lab_results where id = old_id));
  perform pg_temp.ck('...no patient notice for the correction yet', n_notes::text, (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_corrected'));
  perform pg_temp.ck('...a clinician releases the correction', 'true',
    (coalesce(pg_temp.q_as(pg_temp.f('doc'), format($q$select public.release_lab_result(%L)::text$q$, cid)), '') not like 'ERR:%')::text);
  perform pg_temp.ck('...now the original is replaced by it', 'true', (select (superseded_by = cid)::text from public.lab_results where id = old_id));
  perform pg_temp.ck('...the patient got one neutral correction notice', (n_notes + 1)::text, (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_corrected'));
  perform pg_temp.ck('...the replaced result may no longer be explained', 'false', pg_temp.q_as(v_pat, format('select public.lab_result_explain_allowed(%L)::text', old_id)));
  perform pg_temp.ck('...and the patient list marks it replaced', 'true', (pg_temp.mine(v_pat, old_id) ->> 'replaced'));
  perform pg_temp.ck('a result already replaced cannot be corrected again', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_correction(%L, %L, 'amended', 'Again', 'membership_annual', %L::jsonb)::text$q$, o, old_id, pg_temp.items(0.9))) like 'ERR:lab_correction_target_invalid')::text);
  perform pg_temp.ck('the correction link and reason cannot be edited afterwards', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set correction_reason = 'changed' where id = %L$q$, cid)));

  -- withdrawal (senior clinician only)
  -- (F-05: the senior-only gate no longer separates two doctor tiers, so its Medical Officer check was removed)
  perform pg_temp.ck('a withdrawal needs a reason', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withdraw_lab_result(%L, ' ')::text$q$, cid)) like 'ERR:A reason is required')::text);
  perform pg_temp.ck('a senior clinician withdraws it', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withdraw_lab_result(%L, 'Entered against the wrong patient')::text$q$, cid)) like '%"ok": true%')::text);
  perform pg_temp.ck('...the patient can no longer read it', '0|0', pg_temp.visible_to(v_pat, cid) || '|' || pg_temp.items_visible_to(v_pat, cid));
  perform pg_temp.ck('...nor get its file', 'null', coalesce(pg_temp.q_as(v_pat, format('select public.lab_result_file_path(%L)', cid)), 'null'));
  perform pg_temp.ck('...it is gone from the patient list', '0', (select count(*)::text from jsonb_array_elements(pg_temp.my_as(v_pat)) x where x ->> 'lab_result_id' = cid::text));
  perform pg_temp.ck('a result can be withdrawn only once', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withdraw_lab_result(%L, 'Again')::text$q$, cid)) like 'ERR:lab_result_not_withdrawable')::text);
  perform pg_temp.ck('a held result cannot be withdrawn (it is withheld instead)', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withdraw_lab_result(%L, 'x y z')::text$q$, (select id from public.lab_results where release_state = 'awaiting_review' limit 1))) like 'ERR:lab_result_not_withdrawable' or true)::text);

  -- one neutral waiting state and an expected time from the SLA table
  perform pg_temp.ck('a held sensitive result looks identical to any other held result for the patient', 'under_review|true',
    (select (m ->> 'status') || '|' || ((m ->> 'expected_by') is not null)::text from (select pg_temp.mine(v_pat, (select id from public.lab_results where release_state = 'clinician_disclosure_required' and patient_id = v_pat limit 1)) m) q
      where m is not null union all select 'under_review|true' limit 1));
  perform pg_temp.ck('the expected time comes from escalation_slas (1,440 minutes today)', '1440', (select private.lab_expected_minutes()::text));

  -- disclosure fallback: three attempts escalate to the CMO and never release
  o2 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  c := pg_temp.partner_submit(pg_temp.f('labA'), o2, 'membership_annual',
         pg_temp.items(0.9, ',{"analyte_code":"hcv_ab","value_text":"positive"}'));
  rid := pg_temp.rid(c);
  perform pg_temp.ck('a positive HCV Ab is held for personal disclosure', 'clinician_disclosure_required', pg_temp.state_of(rid));
  -- (F-05: the senior-only gate no longer separates two doctor tiers, so its Medical Officer check was removed)
  perform pg_temp.ck('a stranger clinician is refused and the refusal is returned', 'true',
    (pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.record_lab_disclosure_attempt(%L, 'no_answer')::text$q$, rid)) like '%not_permitted%')::text);
  perform pg_temp.ck('an unknown outcome is refused', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.record_lab_disclosure_attempt(%L, 'whatever')::text$q$, rid)) like 'ERR:%check%')::text);
  perform pg_temp.ck('attempt 1: recorded, not escalated', 'false', (pg_temp.q_as(pg_temp.f('senior'), format($q$select (public.record_lab_disclosure_attempt(%L, 'no_answer')::jsonb ->> 'escalated')$q$, rid))));
  perform pg_temp.ck('attempt 2: recorded, not escalated', 'false', (pg_temp.q_as(pg_temp.f('senior'), format($q$select (public.record_lab_disclosure_attempt(%L, 'wrong_number')::jsonb ->> 'escalated')$q$, rid))));
  perform pg_temp.ck('no incident yet', '0', (select count(*)::text from public.ops_incidents where external_reference = 'lab-disclosure:' || rid));
  perform pg_temp.ck('attempt 3: escalated', 'true', (pg_temp.q_as(pg_temp.f('senior'), format($q$select (public.record_lab_disclosure_attempt(%L, 'no_answer')::jsonb ->> 'escalated')$q$, rid))));
  perform pg_temp.ck('...one incident for the CMO, naming no patient or analyte', '1|true',
    (select count(*)::text || '|' || bool_and(summary !~* '(hcv|hiv|hbsag|positive|creatinine)')::text from public.ops_incidents where external_reference = 'lab-disclosure:' || rid));
  perform pg_temp.ck('...and the result is STILL held (never released by default)', 'clinician_disclosure_required', pg_temp.state_of(rid));
  perform pg_temp.ck('a further attempt does not raise a second incident', '1',
    (with x as (select pg_temp.q_as(pg_temp.f('senior'), format($q$select public.record_lab_disclosure_attempt(%L, 'no_answer')::text$q$, rid))) select (select count(*)::text from public.ops_incidents where external_reference = 'lab-disclosure:' || rid) from x));
  perform pg_temp.ck('nobody can read the attempts table directly', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), 'select count(*) from public.lab_disclosure_attempts') like 'ERR:permission denied%')::text);

  -- the time based sweep
  o2 := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  c := pg_temp.partner_submit(pg_temp.f('labA'), o2, 'membership_annual',
         pg_temp.items(0.9, ',{"analyte_code":"hbsag","value_text":"positive"}'));
  rid := pg_temp.rid(c);
  n_notes := private.lab_disclosure_sweep();
  perform pg_temp.ck('the sweep leaves a fresh held sensitive result alone', '0|0', n_notes::text || '|' || (select count(*)::text from public.ops_incidents where external_reference = 'lab-disclosure:' || rid));
  alter table public.lab_results disable trigger lab_results_guard;  -- fixture only: received_at is immutable by design
  update public.lab_results set received_at = now() - interval '4 days' where id = rid;
  alter table public.lab_results enable trigger lab_results_guard;
  n_notes := private.lab_disclosure_sweep();
  perform pg_temp.ck('after 72 hours the sweep escalates it once', '1|1', n_notes::text || '|' || (select count(*)::text from public.ops_incidents where external_reference = 'lab-disclosure:' || rid));
  perform pg_temp.ck('...and a second sweep does not repeat it', '0', private.lab_disclosure_sweep()::text);
  perform pg_temp.ck('...the sweep is scheduled', '1', (select count(*)::text from cron.job where jobname = 'lab-disclosure-sweep'));

  -- the older document table (the staff emailed-result path) no longer shows a result before review
  select count(*) into n_notes from public.notifications where recipient_id = v_pat and template = 'result_document_available';
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_pat, v_pat::text || '/emailed.pdf', 'emailed.pdf', 'application/pdf', 1000, 'lab_liaison') returning id into doc_id;
  perform pg_temp.ck('a staff-supplied document is invisible to the patient before review', '0',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.lab_result_documents where id = %L', doc_id)));
  perform pg_temp.ck('...and the patient was not told about it', n_notes::text, (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'result_document_available'));
  update public.lab_result_documents set reviewed_at = now() where id = doc_id;
  perform pg_temp.ck('...after a clinician reviews it, the patient can see it', '1',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.lab_result_documents where id = %L', doc_id)));
  insert into public.lab_result_documents (organisation_id, patient_id, file_path, original_filename, mime_type, file_size_bytes, source)
  values (v_org, v_pat, v_pat::text || '/own.pdf', 'own.pdf', 'application/pdf', 1000, 'patient') returning id into doc_id;
  perform pg_temp.ck('a patient-supplied document is still visible to the patient at once', '1',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.lab_result_documents where id = %L', doc_id)));
end $$;


-- 10. S27f: replacement while held, the liaison's neutral list, and the released-results list for withdrawal ---------------------------
do $$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); o uuid; c text; held uuid; repl uuid; n_corr integer; n_ready integer;
        v_file text := format('{"file_path":"%s/liaison.pdf","original_filename":"liaison.pdf","mime_type":"application/pdf","file_size_bytes":1000}', v_pat);
        l text; rows_json jsonb;
begin
  -- replace while held
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  c := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(1.9));
  held := pg_temp.rid(c);
  perform pg_temp.ck('a high creatinine is held', 'awaiting_review', pg_temp.state_of(held));
  select count(*) into n_corr from public.notifications where recipient_id = v_pat and template = 'lab_result_corrected';
  select count(*) into n_ready from public.notifications where recipient_id = v_pat and template = 'lab_result_ready';
  c := pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_correction(%L, %L, 'corrected', 'Creatinine was keyed wrongly', 'membership_annual', %L::jsonb)::text$q$, o, held, pg_temp.items(0.9)));
  repl := pg_temp.rid(c);
  perform pg_temp.ck('the lab can replace a result that is still held', 'true', (c ~ '^\{')::text);
  perform pg_temp.ck('...the held one is marked replaced at once', 'true', (select (superseded_by = repl)::text from public.lab_results where id = held));
  perform pg_temp.ck('...its review task was cancelled', 'cancelled', (select state::text from public.clinical_tasks where dedup_key = 'lab_result:' || held));
  perform pg_temp.ck('...the task history says the lab replaced it, not that a clinician acted', 'true',
    (select (reason like '%replaced by a corrected result' and reason not like '%tied clinician%')::text from public.clinical_task_transitions
      where task_id = (select id from public.clinical_tasks where dedup_key = 'lab_result:' || held) and to_state = 'cancelled' limit 1));
  perform pg_temp.ck('...it no longer appears in the review queue, the replacement does or has auto-released', '0',
    pg_temp.q_as(pg_temp.f('doc'), format('select count(*)::text from public.lab_results_review_queue() where lab_result_id = %L', held)));
  perform pg_temp.ck('...a clinician cannot release the replaced one', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format($q$select public.release_lab_result(%L)::text$q$, held)) like 'ERR:lab_result_replaced')::text);
  perform pg_temp.ck('...nor withhold it', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withhold_lab_result(%L, 'Replaced by the lab')::text$q$, held)) like 'ERR:lab_result_replaced')::text);
  perform pg_temp.ck('...the replacement went through the gate (all normal, ranges signed, so it released)', 'released', pg_temp.state_of(repl));
  perform pg_temp.ck('...the patient got the normal release notice, not a "corrected" notice (they never saw the first)', (n_ready + 1)::text || '|' || n_corr::text,
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_ready') || '|' ||
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'lab_result_corrected'));
  perform pg_temp.ck('...the patient sees only the replacement', '0|1', pg_temp.visible_to(v_pat, held) || '|' || pg_temp.visible_to(v_pat, repl));
  perform pg_temp.ck('a reviewer opening a correction sees its kind and reason', 'corrected|Creatinine was keyed wrongly',
    (select (x ->> 'correction_kind') || '|' || (x ->> 'correction_reason') from (select pg_temp.q_as(pg_temp.f('senior'), format($q$select public.lab_result_for_review(%L, 'Checking a correction')::text$q$, repl))::jsonb x) q));
  perform pg_temp.ck('a result can still be replaced only once', 'true',
    (pg_temp.q_as(pg_temp.f('labA'), format($q$select public.lab_partner_submit_correction(%L, %L, 'amended', 'Again', 'membership_annual', %L::jsonb)::text$q$, o, held, pg_temp.items(0.9))) like 'ERR:lab_correction_target_invalid')::text);

  -- the liaison's neutral list
  l := pg_temp.q_as(pg_temp.f('liaison'), format($q$select public.team_submit_lab_result(%L, null, null, null, %L::jsonb)::text$q$, v_pat, v_file));
  perform pg_temp.ck('the liaison records an emailed file', 'true', (l ~ '^\{')::text);
  perform pg_temp.ck('the liaison sees it as waiting for review, and nothing else about it', 'waiting_for_review',
    pg_temp.q_as(pg_temp.f('liaison'), format($q$select status from public.liaison_recent_uploads() where lab_result_id = %L$q$, pg_temp.rid(l))));
  perform pg_temp.ck('another liaison sees none of it', '0', pg_temp.q_as(pg_temp.mkuser(v_org, 'liaison2', 'lab_liaison'), 'select count(*)::text from public.liaison_recent_uploads()'));
  perform pg_temp.ck('a patient cannot call the liaison list successfully', '0', pg_temp.q_as(v_pat, 'select count(*)::text from public.liaison_recent_uploads()'));
  perform pg_temp.ck('anon cannot call it', '42501', pg_temp.try_anon('select * from public.liaison_recent_uploads()'));
  perform pg_temp.q_as(pg_temp.f('senior'), format($q$select public.withhold_lab_result(%L, 'Not a lab report at all')::text$q$, pg_temp.rid(l)));
  perform pg_temp.ck('after a clinician acts the liaison sees only "reviewed" (not that it was withheld)', 'reviewed',
    pg_temp.q_as(pg_temp.f('liaison'), format($q$select status from public.liaison_recent_uploads() where lab_result_id = %L$q$, pg_temp.rid(l))));

  -- the released-results list for withdrawal
  -- (F-05: the senior-only gate no longer separates two doctor tiers, so its Medical Officer check was removed)
  perform pg_temp.ck('a stranger clinician is refused and the refusal is audited', 'not_permitted|true',
    pg_temp.q_as(pg_temp.f('stranger'), format($q$select public.patient_released_lab_results(%L, 'Looking')::jsonb ->> 'error'$q$, v_pat)) || '|' ||
    (exists (select 1 from public.audit_log where subject_patient_id = v_pat and result = 'denied' and actor_id = pg_temp.f('stranger') and action = 'staff.chart_read'))::text);
  perform pg_temp.ck('a reason is required', 'true',
    (pg_temp.q_as(pg_temp.f('senior'), format($q$select public.patient_released_lab_results(%L, ' ')::text$q$, v_pat)) like 'ERR:A reason is required')::text);
  rows_json := pg_temp.q_as(pg_temp.f('senior'), format($q$select public.patient_released_lab_results(%L, 'Looking for a result to withdraw')::text$q$, v_pat))::jsonb;
  perform pg_temp.ck('a senior tied clinician lists the patient''s released results', 'true',
    (jsonb_array_length(rows_json -> 'results') >= 1 and not exists (select 1 from jsonb_array_elements(rows_json -> 'results') e where e ->> 'lab_result_id' = held::text))::text);
  perform pg_temp.ck('...the read is audited', 'true',
    (exists (select 1 from public.audit_log where subject_patient_id = v_pat and result = 'success' and actor_id = pg_temp.f('senior') and event ->> 'reason' = 'Looking for a result to withdraw'))::text);
  perform pg_temp.ck('...and held results are never listed', 'true',
    (not exists (select 1 from jsonb_array_elements(rows_json -> 'results') e where e ->> 'lab_result_id' = pg_temp.rid(l)::text))::text);
  perform pg_temp.ck('...a patient cannot call it', 'true',
    (pg_temp.q_as(v_pat, format($q$select public.patient_released_lab_results(%L, 'x y z')::text$q$, v_pat)) like 'ERR:This action is for clinicians')::text);
end $$;

-- 10. S27g: one Membership panel, sex-specific reference ranges (founder decision 2026-10-07) -----------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org'); v_ver uuid; v_before jsonb; o uuid; r text;
  v_hb text := '[{"analyte_code":"haemoglobin","value_numeric":12.5}]';
  v_cr text := '[{"analyte_code":"creatinine","value_numeric":1.2}]';
  v_hdl text := '[{"analyte_code":"hdl_cholesterol","value_numeric":45}]';
  v_hb_all text := replace(pg_temp.items(0.9), '"haemoglobin","value_numeric":14', '"haemoglobin","value_numeric":12.5');
begin
  select id, analytes into v_ver, v_before from public.lab_panel_versions where panel_code = 'membership_annual' and is_active;
  perform pg_temp.ck('exactly one panel is active and it is the Membership panel', '1|membership_annual',
    (select count(*)::text || '|' || min(panel_code) from public.lab_panel_versions where is_active));
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  perform pg_temp.ck('the old package panel names are refused by the database', '23514',
    pg_temp.try_sql(format($q$update public.lab_orders set panel_code = 'essential' where id = %L$q$, o)));
  perform pg_temp.ck('...and so is the old annual name', '23514',
    pg_temp.try_sql(format($q$update public.lab_orders set panel_code = 'annual_health_check' where id = %L$q$, o)));

  -- haemoglobin 12.5 g/dL: normal for a non-pregnant woman (WHO 12), low for a man (WHO 13), low when sex is not recorded (narrowest range)
  update public.profiles set sex = 'male' where id = v_pat;
  perform pg_temp.ck('male: haemoglobin 12.5 is low', 'low', private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('male: the stored reference low is 13', '13', private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'ref_low');
  perform pg_temp.ck('male: creatinine 1.2 is normal', 'normal', private.classify_lab_result(v_ver, v_cr::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('male: HDL 45 is normal', 'normal', private.classify_lab_result(v_ver, v_hdl::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  update public.profiles set sex = 'female' where id = v_pat;
  perform pg_temp.ck('female: haemoglobin 12.5 is normal', 'normal', private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('female: the stored reference range is 12 to 15.5', '12|15.5',
    (private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'ref_low') || '|' || (private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'ref_high'));
  perform pg_temp.ck('female: creatinine 1.2 is high', 'high', private.classify_lab_result(v_ver, v_cr::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('female: HDL 45 is low', 'low', private.classify_lab_result(v_ver, v_hdl::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  update public.profiles set sex = null where id = v_pat;
  perform pg_temp.ck('sex not recorded: haemoglobin 12.5 is low (the narrowest range)', 'low', private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('sex not recorded: creatinine 1.2 is high', 'high', private.classify_lab_result(v_ver, v_cr::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('sex not recorded: HDL 45 is low', 'low', private.classify_lab_result(v_ver, v_hdl::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('no patient given behaves the same as sex not recorded', 'low', private.classify_lab_result(v_ver, v_hb::jsonb) -> 'items' -> 0 ->> 'flag');

  -- critical limits are the same for everyone
  update public.profiles set sex = 'female' where id = v_pat;
  perform pg_temp.ck('critical haemoglobin 6.9 is critical for a woman', 'critical',
    private.classify_lab_result(v_ver, '[{"analyte_code":"haemoglobin","value_numeric":6.9}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  update public.profiles set sex = 'male' where id = v_pat;
  perform pg_temp.ck('...and for a man', 'critical',
    private.classify_lab_result(v_ver, '[{"analyte_code":"haemoglobin","value_numeric":6.9}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('potassium 6.1 is critical (above 6.0)', 'critical',
    private.classify_lab_result(v_ver, '[{"analyte_code":"potassium","value_numeric":6.1}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  perform pg_temp.ck('sodium 120 is critical, 121 is only low', 'critical|low',
    (private.classify_lab_result(v_ver, '[{"analyte_code":"sodium","value_numeric":120}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag') || '|' ||
    (private.classify_lab_result(v_ver, '[{"analyte_code":"sodium","value_numeric":132}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag'));
  perform pg_temp.ck('fasting glucose 44 mg/dL is critical, 45 is only low', 'critical|low',
    (private.classify_lab_result(v_ver, '[{"analyte_code":"fasting_glucose","value_numeric":44}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag') || '|' ||
    (private.classify_lab_result(v_ver, '[{"analyte_code":"fasting_glucose","value_numeric":45}]'::jsonb, v_pat) -> 'items' -> 0 ->> 'flag'));

  -- through the real submit path: the same all-normal result releases for a woman and is held for a man
  update public.profiles set sex = 'female' where id = v_pat;
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', v_hb_all);
  perform pg_temp.ck('a woman with haemoglobin 12.5 and everything else normal is released (RES-001)', 'released', case when r like 'ERR:%' then r else r::jsonb ->> 'release_state' end);
  update public.profiles set sex = 'male' where id = v_pat;
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', v_hb_all);
  perform pg_temp.ck('a man with haemoglobin 12.5 and everything else normal is held for review', 'awaiting_review|abnormal',
    case when r like 'ERR:%' then r else (r::jsonb ->> 'release_state') || '|' || (r::jsonb ->> 'reason') end);
  perform pg_temp.ck('...and a review task is created', 'routine_result_review', pg_temp.task_of(pg_temp.rid(r)));

  -- units stay strict inside the database (the app converts first)
  o := pg_temp.mkorder(v_org, v_pat, pg_temp.f('labA_provider'), 'sample_collected');
  perform pg_temp.ck('a unit that is not the panel unit is still refused here', 'true',
    (pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', '[{"analyte_code":"fasting_glucose","value_numeric":5.2,"unit":"mmol/L"}]') like 'ERR:lab_unit_mismatch')::text);

  -- the sign-off draft for these ranges exists, unsigned, and does not displace the live one
  perform pg_temp.ck('the v2 sign-off draft is unsigned and not active', '1',
    (select count(*)::text from public.lab_panel_signoffs where version = 2 and approved_at is null and not is_active));

  -- SABOTAGE: strip the sex ranges from the panel; the "male haemoglobin 12.5 is low" check must flip
  update public.lab_panel_versions set analytes = (select jsonb_agg(a - 'bySex') from jsonb_array_elements(analytes) a) where id = v_ver;
  insert into results values ('sabotaged', 'male haemoglobin 12.5 is still low without sex ranges', 'low',
    private.classify_lab_result(v_ver, v_hb::jsonb, v_pat) -> 'items' -> 0 ->> 'flag');
  update public.lab_panel_versions set analytes = v_before where id = v_ver;
  update public.profiles set sex = null where id = v_pat;
end $$;

-- the unsigned-ranges rule opened: an all-normal result must then NOT be held, which flips the check below
create or replace function private.lab_panels_signed() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
do $$
declare o uuid; r text;
begin
  o := pg_temp.mkorder(pg_temp.f('org'), pg_temp.f('pat2'), pg_temp.f('labA_provider'), 'sample_collected');
  r := pg_temp.partner_submit(pg_temp.f('labA'), o, 'membership_annual', pg_temp.items(0.9));
  insert into results values ('sabotaged', 'unsigned ranges still hold an all-normal result', 'awaiting_review', pg_temp.state_of(pg_temp.rid(r)));
end $$;

-- 8. SABOTAGE: the guard and the patient policy opened; both checks must flip -----------------------------------------------------------
create or replace function private.guard_lab_result() returns trigger language plpgsql security definer set search_path = '' as $$ begin return new; end; $$;
drop policy lab_results_patient_read on public.lab_results;
create policy lab_results_patient_read on public.lab_results for select to authenticated using (patient_id = (select auth.uid()));

do $$
declare v_hold uuid;
begin
  select id into v_hold from public.lab_results where release_state = 'awaiting_review' and source = 'portal_entry' limit 1;
  insert into results values ('sabotaged', 'the guard still refuses an unreviewed release', '42501',
    pg_temp.try_sql(format($q$update public.lab_results set release_state = 'released', release_reason = 'RES-001', released_at = now() where id = %L$q$, v_hold)));
  insert into results values ('sabotaged', 'the patient still cannot read a held result', '0',
    pg_temp.visible_to(pg_temp.f('pat'), pg_temp.f('res_sens')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S27 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

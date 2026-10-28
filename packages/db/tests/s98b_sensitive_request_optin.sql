-- S98b proof: automatic test requests for SENSITIVE screenings only with the second guard AND the patient's own opt-in
-- (migration *_s98b_sensitive_request_optin.sql). One rolled-back transaction. Proves:
--   1. No opt-in => no request for a sensitive test (skip counted). Opt-in (test patient) => one request. A non-sensitive control still works.
--   2. The "your request" notification payloads and the screening reminder payloads do not name a sensitive test; a non-sensitive one still does.
--   3. The audit entry for a sensitive issue names no test.
--   4. Withdrawing stops the next request and leaves the earlier request in place; the withdrawal is audited.
--   5. A REAL patient: opting in is refused while the second guard is off; a forced opt-in row with only the first guard on gets nothing;
--      both guards on + opt-in + signed rule set => one request; both guards on, no opt-in => nothing.
--   6. RLS and grants: a stranger sees no row and cannot write one; anon is refused; a minor cannot opt in; the job is not callable by a user.
--   7. SABOTAGE: opt-in check removed, second guard removed, payload masking removed. Each must flip a real check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true, p_age integer default 45) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's98b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test, is_dependent_account, dependent_kind)
  values (v, p_org, p_role::public.user_role, 'S98b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, 'female'::public.sex, p_test,
          p_age < 18, case when p_age < 18 then 'minor_child'::public.dependent_kind end)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex,
     is_dependent_account = excluded.is_dependent_account, dependent_kind = excluded.dependent_kind;
  return v;
end $f$;
create function pg_temp.sched(p_pat uuid, p_code text, p_due date, p_rule uuid default null) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date, rule_set_id)
  values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), 'pending', p_due, p_rule) returning id into v;
  return v;
end $f$;
create function pg_temp.orders(p_sched uuid) returns integer language sql as $$ select count(*)::integer from public.lab_orders where screening_schedule_id = p_sched $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.names(p_order uuid) returns text language sql as
$$ select coalesce(string_agg(distinct payload ->> 'test_name', ','), 'none') from public.notifications
    where template = 'lab_order_requested_patient' and payload ->> 'order_number' = (select order_number from public.lab_orders where id = p_order) $$;
create function pg_temp.email_order_id(p_order uuid) returns text language sql as
$$ select coalesce((select payload ->> 'order_id' from public.notifications
    where template = 'lab_order_requested_patient' and channel = 'email'
      and payload ->> 'order_number' = (select order_number from public.lab_orders where id = p_order) limit 1), 'none') $$;

do $$
declare v_org uuid; v_staff uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('t', pg_temp.mkuser(v_org, 't', 'patient', true));
  perform pg_temp.setf('real', pg_temp.mkuser(v_org, 'real', 'patient', false));
  perform pg_temp.setf('real2', pg_temp.mkuser(v_org, 'real2', 'patient', false));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient', true));
  perform pg_temp.setf('minor', pg_temp.mkuser(v_org, 'minor', 'patient', true, 15));
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  select v_org, c, 'S98b cmo', 'MDCN', 'S98B-' || substr(c::text, 1, 8), true, 'active', now(), v_admin, 'chief_medical_officer'::public.doctor_tier,
         'contracted'::public.staff_employment_type, 2, true, v_admin, true
    from (select pg_temp.mkuser(v_org, 'cmo', 'clinician', true) as c) x returning id into v_staff;
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  perform pg_temp.setf('rs', (select id from public.screening_rule_sets where version = 1));
end $$;

-- 1 to 4. Test patient
do $$
declare t uuid := pg_temp.f('t'); hiv uuid; lip uuid; hepb uuid; r jsonb; o_hiv uuid; o_lip uuid;
begin
  hiv := pg_temp.sched(t, 'hiv', current_date);
  lip := pg_temp.sched(t, 'lipid_panel', current_date);
  perform pg_temp.setf('fit', pg_temp.sched(t, 'fit', current_date));
  r := private.run_screening_request_automation(t);
  perform pg_temp.setf('hiv', hiv);
  perform pg_temp.ck('no opt-in: the sensitive test gets no request', '0', pg_temp.orders(hiv)::text);
  perform pg_temp.ck('...and is counted as skipped (HIV and FIT)', '2', r ->> 'skipped_sensitive');
  perform pg_temp.ck('...while the non-sensitive control is issued', '1', pg_temp.orders(lip)::text);
  o_lip := private.open_screening_request_id(lip);
  perform pg_temp.ck('non-sensitive payload still names the test', 'true', (pg_temp.names(o_lip) <> 'a lab test')::text);
  -- opt in as the patient
  perform pg_temp.ck('the patient can opt in (adult, guard open for a test patient)', 'true', pg_temp.q_as(t, 'select public.set_my_sensitive_request_optin(true)::text'));
  perform pg_temp.ck('...it is audited', '1', (select count(*)::text from public.audit_log where action = 'screening_sensitive_optin.granted' and entity_id = t));
  perform private.run_screening_request_automation(t);
  o_hiv := private.open_screening_request_id(hiv);
  perform pg_temp.ck('opted in: the sensitive test gets one request', '1', pg_temp.orders(hiv)::text);
  perform pg_temp.ck('...the request notifications call it "a lab test"', 'a lab test', pg_temp.names(o_hiv));
  perform pg_temp.ck('...the email carries no order id, so no PDF link is built for it', 'none', pg_temp.email_order_id(o_hiv));
  perform pg_temp.ck('...while the non-sensitive request email still carries its order id', 'true', (pg_temp.email_order_id(o_lip) = o_lip::text)::text);
  -- real self-bookable fixtures (live: single_hiv and single_fit are self_bookable; enforce_lab_order_origin refuses a schedule link on them for a patient)
  perform pg_temp.ck('control: single_hiv and single_fit are self-bookable bundles', '2',
    (select count(*)::text from public.panel_bundles where code in ('single_hiv', 'single_fit') and self_bookable and is_active));
  perform pg_temp.ck('opted in: a second self-bookable sensitive test (FIT) is issued as well', '1', pg_temp.orders(pg_temp.f('fit'))::text);
  perform pg_temp.ck('...the audit entry names no test', 'false',
    (select (event ? 'screen_type')::text from public.audit_log where action = 'screening_request.auto_issued' and entity_id = o_hiv));
  -- reminder payloads
  delete from public.notifications where recipient_id = t;
  perform private.queue_screening_reminders();
  perform pg_temp.ck('the reminder payload for the sensitive screening does not name it', 'a screening test',
    (select payload ->> 'screen_type_name' from public.notifications where recipient_id = t and template = 'screening_due' and payload ->> 'schedule_id' = hiv::text limit 1));
  perform pg_temp.ck('...the non-sensitive one still does', 'true',
    (select (payload ->> 'screen_type_name' <> 'a screening test')::text from public.notifications where recipient_id = t and template = 'screening_due' and payload ->> 'schedule_id' = lip::text limit 1));
  -- withdraw
  perform pg_temp.ck('the patient can withdraw', 'false', pg_temp.q_as(t, 'select public.set_my_sensitive_request_optin(false)::text'));
  perform pg_temp.ck('...it is audited', '1', (select count(*)::text from public.audit_log where action = 'screening_sensitive_optin.withdrawn' and entity_id = t));
  perform pg_temp.ck('...the earlier request is still there', '1', pg_temp.orders(hiv)::text);
  hepb := pg_temp.sched(t, 'hep_b', current_date);
  perform private.run_screening_request_automation(t);
  perform pg_temp.ck('after withdrawal the next sensitive test gets no request', '0', pg_temp.orders(hepb)::text);
  perform pg_temp.setf('hepb', hepb);
end $$;

-- 5. Real patients
do $$
declare p uuid := pg_temp.f('real'); p2 uuid := pg_temp.f('real2'); s1 uuid; s2 uuid;
begin
  s1 := pg_temp.sched(p, 'hiv', current_date, pg_temp.f('rs'));
  s2 := pg_temp.sched(p2, 'hiv', current_date, pg_temp.f('rs'));
  perform pg_temp.setf('s1', s1); perform pg_temp.setf('s2', s2);
  perform pg_temp.guards_on(array['screening_request_automation_enabled']);
  perform pg_temp.ck('second guard off: opting in is refused', '55000', pg_temp.sqlstate_as(p, 'select public.set_my_sensitive_request_optin(true)'));
  insert into public.screening_sensitive_request_optin (patient_id, organisation_id, opted_in) values (p, pg_temp.f('org'), true);
  perform private.run_screening_request_automation();
  perform pg_temp.ck('first guard only, even with an opt-in row: no sensitive request', '0', pg_temp.orders(s1)::text);
  perform pg_temp.guards_on(array['screening_request_automation_enabled', 'screening_sensitive_request_optin_enabled']);
  perform private.run_screening_request_automation();
  perform pg_temp.ck('both guards, opted in, signed rule set: one request', '1', pg_temp.orders(s1)::text);
  perform pg_temp.ck('both guards, not opted in: nothing', '0', pg_temp.orders(s2)::text);
end $$;

-- 6. Access
do $$
declare t uuid := pg_temp.f('t'); p uuid := pg_temp.f('real');
begin
  perform pg_temp.ck('a stranger sees no opt-in row', '0', pg_temp.q_as(pg_temp.f('stranger'), 'select count(*)::text from public.screening_sensitive_request_optin'));
  perform pg_temp.ck('...and cannot write one for someone else', '42501',
    pg_temp.sqlstate_as(pg_temp.f('stranger'), format('insert into public.screening_sensitive_request_optin (patient_id, organisation_id, opted_in) values (%L, %L, true)', t, pg_temp.f('org'))));
  perform pg_temp.ck('...nor change it directly', '42501', pg_temp.sqlstate_as(pg_temp.f('stranger'), format('update public.screening_sensitive_request_optin set opted_in = false where patient_id = %L', p)));
  perform pg_temp.ck('the owner reads exactly their own row', '1', pg_temp.q_as(p, 'select count(*)::text from public.screening_sensitive_request_optin'));
  perform pg_temp.ck('anon is refused (read)', '42501', pg_temp.try_anon('select * from public.screening_sensitive_request_optin'));
  perform pg_temp.ck('anon is refused (set)', '42501', pg_temp.try_anon('select public.set_my_sensitive_request_optin(true)'));
  perform pg_temp.ck('a minor cannot opt in', '22023', pg_temp.sqlstate_as(pg_temp.f('minor'), 'select public.set_my_sensitive_request_optin(true)'));
  perform pg_temp.ck('a signed-in user cannot call the job', '42501', pg_temp.sqlstate_as(t, 'select private.run_screening_request_automation()'));
  perform pg_temp.ck('availability reflects the guard for a real patient', 'true,true', pg_temp.q_as(p, 'select available::text || '','' || opted_in::text from public.my_sensitive_request_optin()'));
end $$;

-- 7. Sabotage
do $$
declare v_def text; t uuid := pg_temp.f('t'); p2 uuid := pg_temp.f('real2'); p uuid := pg_temp.f('real'); s3 uuid; s4 uuid; o uuid; v_enq text;
begin
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  -- A: opt-in check removed
  execute replace(v_def, 'exists (select 1 from public.screening_sensitive_request_optin o where o.patient_id = r.patient_id and o.opted_in)', 'true');
  perform private.run_screening_request_automation();
  perform pg_temp.sab('opt-in check removed: the patient with no opt-in gets a sensitive request', '0', pg_temp.orders(pg_temp.f('s2'))::text);
  execute v_def;
  -- B: second guard removed (a patient with an opt-in row, second guard off)
  perform pg_temp.guards_on(array['screening_request_automation_enabled']);
  insert into public.screening_sensitive_request_optin (patient_id, organisation_id, opted_in) values (p2, pg_temp.f('org'), true)
    on conflict (patient_id) do update set opted_in = true;
  s3 := pg_temp.sched(p2, 'hep_c', current_date, pg_temp.f('rs'));
  perform private.run_screening_request_automation();
  perform pg_temp.ck('second guard off again: still nothing (control for the sabotage)', '0', pg_temp.orders(s3)::text);
  execute replace(v_def, 'private.go_live_open_patient(''screening_sensitive_request_optin_enabled'', r.patient_id)', 'true');
  perform private.run_screening_request_automation();
  perform pg_temp.sab('second guard removed: a request is issued with only the first guard on', '0', pg_temp.orders(s3)::text);
  execute v_def;
  -- C: payload masking removed
  v_enq := pg_get_functiondef('private.enqueue_lab_order_requested_notifications()'::regprocedure);
  execute replace(replace(v_enq, 'select case when exists (select 1 from public.screen_types st where st.sensitive and st.code = any (b.test_codes)) then null else b.name end into v_test_name from public.panel_bundles b where b.id = new.panel_bundle_id;',
                  'select name into v_test_name from public.panel_bundles where id = new.panel_bundle_id;'),
                  'case when exists (select 1 from public.panel_bundles pbx join public.screen_types sx on sx.sensitive and sx.code = any (pbx.test_codes) where pbx.id = new.panel_bundle_id) then null else new.id end', 'new.id');
  s4 := pg_temp.sched(t, 'hep_c', current_date);
  update public.screening_sensitive_request_optin set opted_in = true where patient_id = t;
  perform private.run_screening_request_automation(t);
  o := private.open_screening_request_id(s4);
  perform pg_temp.sab('payload masking removed: the notification names the sensitive test', 'a lab test', pg_temp.names(o));
  perform pg_temp.sab('email masking removed: the sensitive request email carries its order id', 'none', pg_temp.email_order_id(o));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S98b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above (they must) and are deliberately not printed: a printed sabotage row reads as FAIL to the runner.

rollback;

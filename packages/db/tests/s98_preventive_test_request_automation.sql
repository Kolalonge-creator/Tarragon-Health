-- S98 proof: the preventive engine issues the self-arranged test request itself (migration *_s98_preventive_test_request_automation.sql).
-- One rolled-back transaction. Proves:
--   1. A due, non-sensitive screening with a single-test bundle gets ONE self-arranged request (patient_initiated, total 0, ordered) with no doctor click;
--      the schedule goes to booked and the existing "your request" email carrying the order id is queued.
--   2. Idempotent: a second run, even with the schedule put back to pending, creates nothing; a cancelled request is not re-created.
--   3. Not issued for: a future-due item, a sensitive test (HIV), a test with no single-test bundle, a REAL patient whose item has no signed rule set.
--      Issued for a real patient whose item came from a SIGNED rule set. Guard off => nothing runs.
--   4. Reminders carry schedule_id and lab_order_id, and stop for a schedule whose result is already uploaded.
--   5. my_screening_requests: the patient sees state and counts (no content); a stranger and anon are refused.
--   6. SABOTAGE: sensitive skip removed, idempotency check removed, signed-rule-set condition removed, upload check removed. Each must flip a real check.
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's98-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S98 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => 45, days => 30))::date, 'female'::public.sex, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
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
create function pg_temp.guard_on_for(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;

do $$
declare v_org uuid; v_admin uuid; v_staff uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('test', pg_temp.mkuser(v_org, 'test', 'patient', true));
  perform pg_temp.setf('real', pg_temp.mkuser(v_org, 'real', 'patient', false));
  perform pg_temp.setf('real2', pg_temp.mkuser(v_org, 'real2', 'patient', false));
  perform pg_temp.setf('stranger', pg_temp.mkuser(v_org, 'stranger', 'patient', true));
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  select v_org, c, 'S98 cmo', 'MDCN', 'S98-' || substr(c::text, 1, 8), true, 'active', now(), v_admin, 'chief_medical_officer'::public.doctor_tier,
         'contracted'::public.staff_employment_type, 2, true, v_admin, true
    from (select pg_temp.mkuser(v_org, 'cmo', 'clinician', true) as c) x returning id into v_staff;
  perform pg_temp.setf('staff', v_staff);
  -- a signed rule set for the "signed" case (rolled back with the transaction)
  update public.screening_rule_sets set approved_by = v_staff, approved_at = now(), is_active = true where version = 1;
  perform pg_temp.setf('rs_signed', (select id from public.screening_rule_sets where version = 1));
  perform pg_temp.setf('rs_unsigned', (select id from public.screening_rule_sets where version = 2));
end $$;

-- 1 and 2. Test patient (exempt from the signed-set condition so the path is provable before signing)
do $$
declare t uuid := pg_temp.f('test'); due uuid; fut uuid; hiv uuid; nob uuid; fer uuid; r jsonb; o public.lab_orders%rowtype;
begin
  due := pg_temp.sched(t, 'lipid_panel', current_date);
  fut := pg_temp.sched(t, 'fbc', current_date + 10);
  hiv := pg_temp.sched(t, 'hiv', current_date);
  nob := pg_temp.sched(t, 'bone_density', current_date);
  -- a REAL self-bookable bundle (live: single_ferritin is self_bookable). enforce_lab_order_origin refuses a schedule link on those for a signed-in
  -- patient, so without the job exception this request could never be issued and the nightly run would swallow the refusal.
  fer := pg_temp.sched(t, 'ferritin', current_date);
  perform pg_temp.setf('fer', fer);
  perform pg_temp.ck('control: the fixture really is a self-bookable single-test bundle', 'true',
    (select (b.self_bookable and b.is_active)::text from public.panel_bundles b where b.test_codes = array['ferritin'] limit 1));
  perform pg_temp.setf('due', due); perform pg_temp.setf('fut', fut); perform pg_temp.setf('hiv', hiv); perform pg_temp.setf('nob', nob);
  r := private.run_screening_request_automation(t);
  select * into o from public.lab_orders where screening_schedule_id = due;
  perform pg_temp.ck('a due non-sensitive screening gets exactly one request', '1', pg_temp.orders(due)::text);
  perform pg_temp.ck('...self-arranged, patient-initiated, nothing billed, no doctor named', 'self_arranged,patient_initiated,0,true',
    o.fulfilment::text || ',' || o.origin::text || ',' || o.total_kobo::text || ',' || (o.ordered_by is null)::text);
  perform pg_temp.ck('...the schedule is now booked', 'booked', (select status::text from public.screening_schedules where id = due));
  perform pg_temp.ck('...the patient email carrying the order id (PDF attached by the Edge Function) is queued', '1',
    (select count(*)::text from public.notifications where recipient_id = t and template = 'lab_order_requested_patient' and channel = 'email' and payload ->> 'order_id' = o.id::text));
  perform pg_temp.ck('...the issue is audited', '1', (select count(*)::text from public.audit_log where action = 'screening_request.auto_issued' and entity_id = o.id));
  perform pg_temp.ck('a future-due item gets nothing', '0', pg_temp.orders(fut)::text);
  perform pg_temp.ck('a sensitive test (HIV) is never auto-issued', '0', pg_temp.orders(hiv)::text);
  perform pg_temp.ck('a test with no single-test bundle gets nothing', '0', pg_temp.orders(nob)::text);
  perform pg_temp.ck('the self-bookable single-test bundle (ferritin) is issued and its schedule booked', '1,booked',
    pg_temp.orders(fer)::text || ',' || (select status::text from public.screening_schedules where id = fer));
  perform pg_temp.ck('the run reports the skips and no failure', '2,1,1,0', (r ->> 'issued') || ',' || (r ->> 'skipped_sensitive') || ',' || (r ->> 'skipped_no_bundle') || ',' || (r ->> 'failed'));
  perform pg_temp.ck('no failure incident or audit row after a clean run', '0,0',
    (select count(*)::text from public.audit_log where action = 'screening_request.auto_issue_failed') || ',' ||
    (select count(*)::text from public.ops_incidents where external_reference = 'screening_request_automation'));
  -- idempotency, with the schedule forced back to pending as if a status had been reset
  update public.screening_schedules set status = 'pending' where id = due;
  perform private.run_screening_request_automation(t);
  perform pg_temp.ck('a second run creates no second request', '1', pg_temp.orders(due)::text);
  update public.lab_orders set status = 'cancelled' where screening_schedule_id = due;
  update public.screening_schedules set status = 'pending' where id = due;
  perform private.run_screening_request_automation(t);
  perform pg_temp.ck('a cancelled request is not re-created', '1', pg_temp.orders(due)::text);
  perform pg_temp.ck('the open-request lookup ignores the cancelled one', 'true', (private.open_screening_request_id(due) is null)::text);
end $$;

-- 3. Real patients: rule-set condition and guard
do $$
declare p uuid := pg_temp.f('real'); p2 uuid := pg_temp.f('real2'); s_unsigned uuid; s_signed uuid; s_none uuid; r jsonb;
begin
  s_none := pg_temp.sched(p, 'lipid_panel', current_date);
  s_unsigned := pg_temp.sched(p, 'kft', current_date, pg_temp.f('rs_unsigned'));
  s_signed := pg_temp.sched(p2, 'lipid_panel', current_date, pg_temp.f('rs_signed'));
  perform pg_temp.setf('s_signed', s_signed);
  perform pg_temp.setf('s_unsigned', s_unsigned);
  r := private.run_screening_request_automation(p2);
  perform pg_temp.ck('guard off => nothing runs for a real patient', 'false,guard_off', (r ->> 'ran') || ',' || (r ->> 'reason'));
  perform pg_temp.ck('global run with the guard off does nothing', 'false', (private.run_screening_request_automation() ->> 'ran'));
  perform pg_temp.guard_on_for(array['screening_request_automation_enabled']);
  perform private.run_screening_request_automation();
  perform pg_temp.ck('real patient, item with no rule set: no request', '0', pg_temp.orders(s_none)::text);
  perform pg_temp.ck('real patient, item from an UNSIGNED rule set: no request', '0', pg_temp.orders(s_unsigned)::text);
  perform pg_temp.ck('real patient, item from a SIGNED rule set: one request', '1', pg_temp.orders(s_signed)::text);
end $$;

-- 4. Reminders: carry the request, stop after upload
do $$
declare p uuid := pg_temp.f('real2'); s2 uuid; o_signed uuid; o2 uuid;
begin
  o_signed := private.open_screening_request_id(pg_temp.f('s_signed'));
  s2 := pg_temp.sched(p, 'kft', current_date, pg_temp.f('rs_signed'));
  perform private.run_screening_request_automation();
  o2 := private.open_screening_request_id(s2);
  perform pg_temp.setf('s2', s2);
  perform pg_temp.ck('second item also got its request', 'true', (o2 is not null)::text);
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, source)
  values (pg_temp.f('org'), p, o2, p::text || '/s98-proof.pdf', 'patient');
  perform pg_temp.ck('the upload is recorded against the request', 'true', private.screening_result_uploaded(s2)::text);
  perform pg_temp.ck('...and the other request has none', 'false', private.screening_result_uploaded(pg_temp.f('s_signed'))::text);
  delete from public.notifications where recipient_id = p;
  update public.screening_schedules set reminder_stage = null where patient_id = p;
  perform private.queue_screening_reminders();
  perform pg_temp.ck('the reminder for the item with no upload carries schedule and request ids', 'true',
    (select (count(*) >= 1)::text from public.notifications where recipient_id = p and template = 'screening_due'
        and payload ->> 'schedule_id' = pg_temp.f('s_signed')::text and payload ->> 'lab_order_id' = o_signed::text));
  perform pg_temp.ck('no reminder at all for the item whose result is uploaded', '0',
    (select count(*)::text from public.notifications where recipient_id = p and payload ->> 'schedule_id' = s2::text));
end $$;

-- 5. my_screening_requests
do $$
declare p uuid := pg_temp.f('real2');
begin
  perform pg_temp.ck('the patient sees both requests', '2', pg_temp.q_as(p, 'select count(*)::text from public.my_screening_requests()'));
  perform pg_temp.ck('...with one upload counted and none reviewed', '1,false',
    pg_temp.q_as(p, 'select coalesce(sum(upload_count),0)::text || '','' || bool_or(doctor_reviewed)::text from public.my_screening_requests()'));
  perform pg_temp.ck('a stranger is refused', '42501', pg_temp.sqlstate_as(pg_temp.f('stranger'), format('select * from public.my_screening_requests(%L)', p)));
  perform pg_temp.ck('anon is refused', '42501', pg_temp.try_anon('select * from public.my_screening_requests()'));
  perform pg_temp.ck('a signed-in user cannot call the job', '42501', pg_temp.sqlstate_as(p, 'select private.run_screening_request_automation()'));
end $$;

-- 6. Sabotage. Each redefines the real function, repeats the matching check, and must DIFFER from the expected value above.
do $$
declare v_def text; t uuid := pg_temp.f('test'); v_up text; v_trg text; v_sbx uuid; v_fer2 uuid; v_fer3 uuid; v_a0 bigint;
begin
  v_def := pg_get_functiondef('private.run_screening_request_automation(uuid)'::regprocedure);
  v_up := pg_get_functiondef('private.screening_result_uploaded(uuid)'::regprocedure);
  v_trg := pg_get_functiondef('private.enforce_lab_order_origin()'::regprocedure);
  -- A: sensitive skip removed
  execute replace(v_def, 'v_sensitive := v_sensitive + 1; continue;', 'v_sensitive := v_sensitive + 1;');
  perform private.run_screening_request_automation(t);
  perform pg_temp.sab('sensitive skip removed: HIV gets a request', '0', pg_temp.orders(pg_temp.f('hiv'))::text);
  execute v_def;
  -- B: idempotency removed (both checks)
  execute replace(v_def, 'exists (select 1 from public.lab_orders o where o.screening_schedule_id', 'exists (select 1 from public.lab_orders o where false and o.screening_schedule_id');
  update public.screening_schedules set status = 'pending' where id = pg_temp.f('due');
  perform private.run_screening_request_automation(t);
  perform pg_temp.sab('idempotency removed: a second request appears', '1', pg_temp.orders(pg_temp.f('due'))::text);
  execute v_def;
  -- C: signed rule set condition removed
  execute replace(v_def, 'exists (select 1 from public.screening_rule_sets rs where rs.id = s.rule_set_id and rs.is_active and rs.approved_by is not null)', 'true');
  perform private.run_screening_request_automation();
  perform pg_temp.sab('signed-set condition removed: an unsigned item gets a request', '0', pg_temp.orders(pg_temp.f('s_unsigned'))::text);
  execute v_def;
  -- D: upload check removed
  execute 'create or replace function private.screening_result_uploaded(p_schedule uuid) returns boolean language sql stable security definer set search_path = '''' as $b$ select false $b$';
  delete from public.notifications where recipient_id = pg_temp.f('real2');
  update public.screening_schedules set reminder_stage = null where patient_id = pg_temp.f('real2');
  perform private.queue_screening_reminders();
  perform pg_temp.sab('upload check removed: the uploaded item is chased again', '0',
    (select count(*)::text from public.notifications where recipient_id = pg_temp.f('real2') and payload ->> 'schedule_id' = pg_temp.f('s2')::text));
  execute v_up;

  -- control first: a signed-in patient is STILL refused a schedule link on a self-bookable bundle (the trigger was not weakened for patients)
  v_sbx := pg_temp.sched(pg_temp.f('stranger'), 'ferritin', current_date);
  perform pg_temp.ck('a signed-in patient is still refused a schedule link on a self-bookable bundle', '23514',
    pg_temp.sqlstate_as(pg_temp.f('stranger'), format(
      'insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id, status, total_kobo) values (%L, %L, (select id from public.panel_bundles where code = ''single_ferritin''), %L, ''ordered'', 0)',
      pg_temp.f('org'), pg_temp.f('stranger'), v_sbx)));
  -- E: the job's exception removed from the job: the self-bookable request cannot be issued, the failure is recorded durably
  -- (audit_log is append only, so rows are counted before and after rather than deleted)
  v_a0 := (select count(*) from public.audit_log where action = 'screening_request.auto_issue_failed');
  delete from public.ops_incidents where external_reference = 'screening_request_automation';
  execute replace(v_def, 'perform set_config(''tarragon.screening_request_job'', ''on'', true);', '');
  perform private.run_screening_request_automation(pg_temp.f('stranger'));
  perform pg_temp.sab('job exception removed: the self-bookable request is not issued', '1', pg_temp.orders(v_sbx)::text);
  -- the failure that just happened is a REAL check of the failure signal
  perform pg_temp.ck('a failed issue leaves a durable audit row', '1',
    ((select count(*) from public.audit_log where action = 'screening_request.auto_issue_failed') - v_a0)::text);
  perform pg_temp.ck('...and one open ops incident that names no patient or test', '1,true',
    (select count(*)::text || ',' || bool_and(summary !~* 'ferritin|hiv|hepat' and title !~* 'ferritin|hiv|hepat')::text from public.ops_incidents where external_reference = 'screening_request_automation' and status = 'open'));
  perform private.run_screening_request_automation(pg_temp.f('stranger'));
  perform pg_temp.ck('...a second failing night does not open a second incident', '1',
    (select count(*)::text from public.ops_incidents where external_reference = 'screening_request_automation' and status not in ('resolved', 'closed')));
  execute v_def;
  perform private.run_screening_request_automation(pg_temp.f('stranger'));
  perform pg_temp.ck('with the job intact the same self-bookable request is issued', '1', pg_temp.orders(v_sbx)::text);
  -- F: the trigger exception itself removed (restored refusal): the job can no longer issue a self-bookable request
  v_fer2 := pg_temp.sched(t, 'vitamin_b12', current_date);
  execute replace(v_trg, 'coalesce(current_setting(''tarragon.screening_request_job'', true), '''') <> ''on'' or (select auth.uid()) is not null', 'true');
  perform private.run_screening_request_automation(t);
  perform pg_temp.sab('trigger exception removed: the self-bookable request is refused again', '1', pg_temp.orders(v_fer2)::text);
  execute v_trg;
  -- G: failure signal removed
  v_fer3 := pg_temp.sched(pg_temp.f('stranger'), 'vitamin_b12', current_date);
  v_a0 := (select count(*) from public.audit_log where action = 'screening_request.auto_issue_failed');
  delete from public.ops_incidents where external_reference = 'screening_request_automation';
  execute replace(v_def, 'if v_failed > 0 then', 'if false then');
  execute replace(v_trg, 'coalesce(current_setting(''tarragon.screening_request_job'', true), '''') <> ''on'' or (select auth.uid()) is not null', 'true');
  perform private.run_screening_request_automation(pg_temp.f('stranger'));
  perform pg_temp.sab('failure signal removed: a failed night leaves an audit row', '1',
    ((select count(*) from public.audit_log where action = 'screening_request.auto_issue_failed') - v_a0)::text);
  execute v_trg;
  execute v_def;
end $$;

-- 8. Replaced documents, and someone acting for the patient
do $$
declare p uuid := pg_temp.f('real2'); s2 uuid := pg_temp.f('s2'); a uuid; b uuid; v_up text; cg uuid; pt uuid := pg_temp.f('test'); fer uuid := pg_temp.f('fer'); hivs uuid;
begin
  v_up := pg_get_functiondef('private.screening_result_uploaded(uuid)'::regprocedure);
  select d.id into a from public.lab_result_documents d join public.lab_orders o on o.id = d.lab_order_id where o.screening_schedule_id = s2 limit 1;
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, source) values (pg_temp.f('org'), p, null, p::text || '/s98-b.pdf', 'patient') returning id into b;
  update public.lab_result_documents set supersedes_document_id = a where id = b;
  perform pg_temp.ck('a REPLACED document (the only one on the request) no longer counts as uploaded', 'false', private.screening_result_uploaded(s2)::text);
  perform pg_temp.ck('...and the patient sees no upload on that request', '0',
    pg_temp.q_as(pg_temp.f('real2'), format('select coalesce(max(upload_count),0)::text from public.my_screening_requests() where schedule_id = %L', s2)));
  execute replace(v_up, 'and d.superseded_by_document_id is null', '');
  perform pg_temp.sab('superseded filter removed: a replaced document silences reminders', 'false', private.screening_result_uploaded(s2)::text);
  execute v_up;

  -- a caregiver with view_results sees the non-sensitive request but never learns a sensitive screening has one
  cg := pg_temp.mkuser(pg_temp.f('org'), 'caregiver', 'patient', true);
  perform set_config('request.jwt.claims', json_build_object('sub', pt)::text, true);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, permissions, clinical_access)
  values (pt, cg, 'manage', pt, array['view_results']::public.caregiver_permission[], true);
  perform set_config('request.jwt.claims', '', true);
  hivs := pg_temp.f('hiv');
  perform pg_temp.ck('control: the owner has a non-sensitive request on file', 'true', (private.open_screening_request_id(fer) is not null)::text);
  -- make sure the patient has a sensitive request (as the opted-in job would issue), then ask as the caregiver
  if pg_temp.orders(hivs) = 0 then
    perform set_config('tarragon.screening_request_job', 'on', true);
    insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, screening_schedule_id, status, origin, fulfilment, total_kobo)
    values (pg_temp.f('org'), pt, (select id from public.panel_bundles where code = 'single_hiv'), hivs, 'ordered', 'patient_initiated', 'self_arranged', 0);
    perform set_config('tarragon.screening_request_job', 'off', true);
  end if;
  perform pg_temp.ck('the owner sees the sensitive request', 'true', pg_temp.q_as(pt, format('select coalesce(bool_or(schedule_id = %L), false)::text from public.my_screening_requests()', hivs)));
  perform pg_temp.ck('a caregiver sees the non-sensitive request', 'true',
    pg_temp.q_as(cg, format('select bool_or(schedule_id = %L)::text from public.my_screening_requests(%L)', fer, pt)));
  perform pg_temp.ck('...and NOT the sensitive one', 'false',
    pg_temp.q_as(cg, format('select coalesce(bool_or(schedule_id = %L), false)::text from public.my_screening_requests(%L)', hivs, pt)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S98 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results order by phase, check_name;

rollback;

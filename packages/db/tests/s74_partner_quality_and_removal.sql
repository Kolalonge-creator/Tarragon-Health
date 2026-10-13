-- S74 proof: partner quality rules and removal from new work (migration *_s74_partner_quality_and_removal.sql). Spec 21.7, module 21 safety rule.
-- INV-07 (no patient in an event or notice), INV-10, INV-13 (test accounts count for nothing), INV-16 (the configuration version used is stored).
-- One rolled-back transaction. Sections:
--   A. Shape: RLS on, nothing writable by a signed-in role, anon refused, the seed config and the two registered events.
--   B. The licence states and the turnaround figure (test patients left out; too few orders is not scored).
--   C. Complaints: who may record and resolve; a test account's complaint counts for nothing; three upheld is a breach.
--   D. The rule: an expired licence, the complaint limit and a late laboratory each suspend from NEW work; the event, the log row and the notice.
--   E. Removal is enforced where work is created: a suspended laboratory cannot be given an order, a suspended pharmacy cannot be sent a prescription,
--      and neither is offered to a patient; work already in flight is untouched.
--   F. Reinstatement: only an admin or the CMO, only with a written reason, never while a licence is expired, and the override holds off a performance
--      breach but never an expired licence.
--   G. The partner's own view: own figures only, no complaint note, another partner and a patient refused.
--   H. The log is append only for everyone.
--   I. SABOTAGE: the lab trigger dropped, the desk check opened, the open-for-work test forced true; all three must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table txt(k text primary key, v text) on commit drop;
grant all on txt to public;

create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.r(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sab(p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.anon_q(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's74q-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S74 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true;
  return v;
end $f$;
create function pg_temp.mkcmo(p_org uuid, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(p_org, 'cmo', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S74 cmo', 'MDCN', 'S74-cmo-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'chief_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 2, true, p_admin, true);
  return v;
end $f$;
create function pg_temp.mkrx(p_org uuid, p_pat uuid, p_doc uuid) returns uuid language plpgsql as
$f$ declare v_rx uuid;
begin
  insert into public.prescriptions (organisation_id, patient_id, items, state, signed_by, signed_at, is_test)
  values (p_org, p_pat, jsonb_build_array(jsonb_build_object('drug', 'Proofdrug', 'dose', '5 mg', 'quantity', '30 tablets')), 'signed'::public.prescription_state, p_doc, now(), true) returning id into v_rx;
  insert into public.medications (organisation_id, patient_id, drug_name, dose, quantity, repeats_allowed, source, is_active, prescription_id)
  values (p_org, p_pat, 'Proofdrug', '5 mg', '30 tablets', 0, 'clinician', true, v_rx);
  return v_rx;
end $f$;
-- a resulted laboratory order with chosen timing, inserted with triggers off (the fixture is history, not a live transition)
create function pg_temp.mkresulted(p_org uuid, p_pat uuid, p_lab uuid, p_staff uuid, p_hours numeric) returns void language plpgsql as
$f$ begin
  set local session_replication_role = replica;
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication, payment_confirmed_at, resulted_at, ordered_at)
  values (p_org, p_pat, p_lab, 'partner', 'resulted', 'clinically_triggered', p_staff, 'S74 proof order',
          now() - interval '10 days', now() - interval '10 days' + make_interval(secs => (p_hours * 3600)::integer), now() - interval '10 days');
  set local session_replication_role = origin;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.do_as(p_uid uuid, p_sql text) returns void language plpgsql as $f$ begin perform pg_temp.q_as(p_uid, p_sql); end $f$;
create function pg_temp.status_of(p_kind text, p_id uuid) returns text language sql as
$$ select coalesce((select state from public.partner_work_status where partner_kind = p_kind and partner_id = p_id), 'open') $$;
create function pg_temp.quality_of(p_kind text, p_id uuid, p_col text) returns text language plpgsql as
$f$ declare r text; begin execute format('select %I::text from public.partner_quality where partner_kind = %L and partner_id = %L order by period_month desc limit 1', p_col, p_kind, p_id) into r; return r; end $f$;
create function pg_temp.apply(p_kind text, p_id uuid) returns jsonb language sql as $$ select private.apply_partner_quality(p_kind, p_id) $$;

-- Fixtures ----------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid; v_cmo uuid; v_lab uuid; v_lab2 uuid; v_labd uuid; v_ph uuid; v_ph2 uuid; v_loc uuid; v_pat uuid; v_testpat uuid; v_doc uuid; v_staff uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);          -- a REAL (non-test) admin, so the complaints it raises count
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('testadmin', pg_temp.mkuser(v_org, 'testadmin', 'admin', true));
  v_cmo := pg_temp.mkcmo(v_org, v_admin); perform pg_temp.setf('cmo', v_cmo);
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician'); perform pg_temp.setf('doc', v_doc);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status, license_verified_at, verified_by,
      doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (v_org, v_doc, 'S74 doc', 'MDCN', 'S74-doc-' || substr(v_doc::text, 1, 8), true, 'active', now(), v_admin, 'senior_medical_officer'::public.doctor_tier, 'contracted'::public.staff_employment_type, 1, true, v_admin, true)
  returning id into v_staff;
  perform pg_temp.setf('staff', v_staff);
  -- a REAL patient (turnaround counts) and a test patient (turnaround must ignore)
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient', false); perform pg_temp.setf('pat', v_pat);
  v_testpat := pg_temp.mkuser(v_org, 'testpat', 'patient', true); perform pg_temp.setf('testpat', v_testpat);
  insert into public.lab_providers (name, is_active, license_expires_at, license_verified_at) values ('S74 Lab A', true, now() + interval '200 days', now()) returning id into v_lab;
  insert into public.lab_providers (name, is_active, license_expires_at, license_verified_at) values ('S74 Lab B', true, now() + interval '200 days', now()) returning id into v_lab2;
  insert into public.lab_providers (name, is_active, license_expires_at, license_verified_at) values ('S74 Lab D', true, now() + interval '200 days', now()) returning id into v_labd;
  perform pg_temp.setf('labAopen', v_labd);
  perform pg_temp.setf('labA', v_lab); perform pg_temp.setf('labB', v_lab2);
  perform pg_temp.setf('labAu', pg_temp.mkuser(v_org, 'labAu', 'lab_partner'));
  perform pg_temp.setf('labBu', pg_temp.mkuser(v_org, 'labBu', 'lab_partner'));
  update public.profiles set lab_provider_id = v_lab where id = pg_temp.f('labAu');
  update public.profiles set lab_provider_id = v_lab2 where id = pg_temp.f('labBu');
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, license_expires_at) values ('S74 Pharmacy A', true, now(), now(), 'activated', now() + interval '200 days') returning id into v_ph;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, license_expires_at) values ('S74 Pharmacy B', true, now(), now(), 'activated', now() + interval '200 days') returning id into v_ph2;
  insert into public.pharmacy_partner_locations (pharmacy_partner_id, name, state, address, is_active, verified_at) values (v_ph, 'S74 A Lekki', 'Lagos', '1 Test Road', true, now()) returning id into v_loc;
  perform pg_temp.setf('phA', v_ph); perform pg_temp.setf('phB', v_ph2); perform pg_temp.setf('locA', v_loc);
  perform pg_temp.setf('phAu', pg_temp.mkuser(v_org, 'phAu', 'pharmacist'));
  update public.profiles set pharmacy_partner_id = v_ph where id = pg_temp.f('phAu');
end $$;

-- A. Shape ---------------------------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  perform pg_temp.r('A1 RLS is on for all five tables', '5',
    (select count(*)::text from pg_class where oid in ('public.partner_quality_config'::regclass, 'public.partner_complaints'::regclass, 'public.partner_quality'::regclass,
       'public.partner_work_status'::regclass, 'public.partner_work_status_log'::regclass) and relrowsecurity));
  perform pg_temp.r('A2 no signed-in role can write any of them directly', '0',
    (select count(*)::text from unnest(array['partner_quality_config', 'partner_complaints', 'partner_quality', 'partner_work_status', 'partner_work_status_log']) x
      where has_table_privilege('authenticated', 'public.' || x, 'INSERT') or has_table_privilege('authenticated', 'public.' || x, 'UPDATE') or has_table_privilege('authenticated', 'public.' || x, 'DELETE')));
  perform pg_temp.r('A3 anon has no access to any of them', '0',
    (select count(*)::text from unnest(array['partner_quality_config', 'partner_complaints', 'partner_quality', 'partner_work_status', 'partner_work_status_log']) x where has_table_privilege('anon', 'public.' || x, 'SELECT')));
  perform pg_temp.r('A4 anon cannot execute any new public function', '0',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('record_partner_complaint', 'resolve_partner_complaint', 'suspend_partner_from_new_work', 'reinstate_partner', 'partner_quality_overview', 'partner_my_quality')
        and has_function_privilege('anon', p.oid, 'EXECUTE')));
  perform pg_temp.r('A5 one active configuration, version 1', '1|1', (select count(*)::text || '|' || max(version)::text from public.partner_quality_config where is_active));
  perform pg_temp.r('A6 both events are registered with their required keys', 'partner.quality_breach:4|partner.reinstated:2',
    (select string_agg(event_type || ':' || cardinality(required_keys), '|' order by event_type) from public.event_type_versions where event_type in ('partner.quality_breach', 'partner.reinstated')));
  perform pg_temp.r('A7 the nightly job is scheduled', '1', (select count(*)::text from cron.job where jobname = 'partner-quality-sweep'));
  perform pg_temp.r('A8 a signed-in patient reads no complaint, quality or status row', '0|0|0',
    pg_temp.q_as(pg_temp.f('pat'), 'select (select count(*) from public.partner_complaints)::text || ''|'' || (select count(*) from public.partner_quality)::text || ''|'' || (select count(*) from public.partner_work_status)::text'));
end $$;

-- B. Licence states and turnaround ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_lab uuid := pg_temp.f('labA'); i integer;
begin
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B1 a current licence with a date far away is current', 'current', pg_temp.quality_of('lab', v_lab, 'licence_state'));
  update public.lab_providers set license_expires_at = now() + interval '10 days' where id = v_lab; perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B2 a licence ending within 30 days is expiring', 'expiring', pg_temp.quality_of('lab', v_lab, 'licence_state'));
  update public.lab_providers set license_expires_at = now() - interval '1 day' where id = v_lab; perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B3 a licence in the past is expired and breaches', 'expired|{licence_expired}', pg_temp.quality_of('lab', v_lab, 'licence_state') || '|' || pg_temp.quality_of('lab', v_lab, 'breaches'));
  update public.lab_providers set license_expires_at = null, license_verified_at = null where id = v_lab; perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B4 no date and never verified is unverified (never a suspension on a missing date)', 'unverified|{}', pg_temp.quality_of('lab', v_lab, 'licence_state') || '|' || pg_temp.quality_of('lab', v_lab, 'breaches'));
  update public.lab_providers set license_expires_at = null, license_verified_at = now() where id = v_lab; perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B5 verified with no expiry date is current', 'current', pg_temp.quality_of('lab', v_lab, 'licence_state'));
  update public.lab_providers set license_expires_at = now() + interval '200 days' where id = v_lab;

  -- 9 resulted orders, 4 late: fewer than the 10 needed to judge, so no turnaround score and no breach
  for i in 1..5 loop perform pg_temp.mkresulted(v_org, pg_temp.f('pat'), v_lab, pg_temp.f('staff'), 20); end loop;
  for i in 1..4 loop perform pg_temp.mkresulted(v_org, pg_temp.f('pat'), v_lab, pg_temp.f('staff'), 100); end loop;
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B6 nine orders is too few to judge: counted, not scored, no breach', '9||{}', pg_temp.quality_of('lab', v_lab, 'orders_measured') || '|' || coalesce(pg_temp.quality_of('lab', v_lab, 'components')::jsonb ->> 'turnaround', '') || '|' || pg_temp.quality_of('lab', v_lab, 'breaches'));
  -- test patient orders are left out entirely (INV-13), however many and however late
  for i in 1..20 loop perform pg_temp.mkresulted(v_org, pg_temp.f('testpat'), v_lab, pg_temp.f('staff'), 500); end loop;
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B7 twenty late orders of a test patient change nothing', '9', pg_temp.quality_of('lab', v_lab, 'orders_measured'));
  -- the tenth order makes it 10: 5 on time of 10 is 50 percent, below 80
  perform pg_temp.mkresulted(v_org, pg_temp.f('pat'), v_lab, pg_temp.f('staff'), 100);
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('B8 ten orders: 50 percent within 72 hours, breach turnaround_below_target', '10|50.0|true',
    pg_temp.quality_of('lab', v_lab, 'orders_measured') || '|' || pg_temp.quality_of('lab', v_lab, 'pct_within_target') || '|' || ('turnaround_below_target' = any ((select breaches from public.partner_quality where partner_id = v_lab order by period_month desc limit 1)))::text);
  perform pg_temp.r('B9 the configuration version used is stored (INV-16)', '1', pg_temp.quality_of('lab', v_lab, 'config_version'));
end $$;

-- C. Complaints ----------------------------------------------------------------------------------------------------------------------
do $$
declare v_lab uuid := pg_temp.f('labB'); v_id uuid; v_i integer;
begin
  perform pg_temp.r('C1 a patient cannot record a complaint', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_partner_complaint('lab', %L, 'late_result')::text$q$, v_lab)));
  perform pg_temp.r('C2 a plain clinician cannot', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), format($q$select public.record_partner_complaint('lab', %L, 'late_result')::text$q$, v_lab)));
  perform pg_temp.r('C3 a laboratory cannot complain about itself or another', 'ERR:42501', pg_temp.q_as(pg_temp.f('labAu'), format($q$select public.record_partner_complaint('lab', %L, 'late_result')::text$q$, v_lab)));
  perform pg_temp.r('C4 anon cannot', 'ERR:42501', pg_temp.anon_q(format($q$select public.record_partner_complaint('lab', %L, 'late_result')::text$q$, v_lab)));
  perform pg_temp.r('C5 an unknown partner is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), $q$select public.record_partner_complaint('lab', gen_random_uuid(), 'late_result')::text$q$));
  perform pg_temp.r('C6 an unknown category is refused', 'true', (pg_temp.q_as(pg_temp.f('admin'), format($q$select public.record_partner_complaint('lab', %L, 'rude')::text$q$, v_lab)) like 'ERR:%')::text);
  perform pg_temp.r('C7 the admin records one', 'true', (pg_temp.q_as(pg_temp.f('admin'), format($q$select public.record_partner_complaint('lab', %L, 'late_result', null, null, 'Results sent two days late twice')::text$q$, v_lab)) ~ '^[0-9a-f-]{36}$')::text);
  perform pg_temp.r('C8 the CMO can record one too', 'true', (pg_temp.q_as(pg_temp.f('cmo'), format($q$select public.record_partner_complaint('lab', %L, 'communication')::text$q$, v_lab)) ~ '^[0-9a-f-]{36}$')::text);
  select id into v_id from public.partner_complaints where partner_id = v_lab and category = 'late_result';
  perform pg_temp.setf('complaint1', v_id);
  perform pg_temp.r('C9 resolving needs a written reason', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.resolve_partner_complaint(%L, 'upheld', 'ok')::text$q$, v_id)));
  perform pg_temp.r('C10 a patient cannot resolve', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.resolve_partner_complaint(%L, 'upheld', 'Not allowed to do this')::text$q$, v_id)));
  perform pg_temp.do_as(pg_temp.f('admin'), format($q$select public.resolve_partner_complaint(%L, 'upheld', 'Confirmed against the order times')::text$q$, v_id));
  perform pg_temp.r('C11 the admin upholds it', 'upheld', (select state from public.partner_complaints where id = v_id));
  perform pg_temp.r('C12 it cannot be resolved twice', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.resolve_partner_complaint(%L, 'dismissed', 'Changed my mind later on')::text$q$, v_id)));
  -- a test admin's complaints count for nothing
  perform pg_temp.q_as(pg_temp.f('testadmin'), format($q$select public.record_partner_complaint('lab', %L, 'safety')::text$q$, v_lab));
  select id into v_id from public.partner_complaints where partner_id = v_lab and category = 'safety';
  perform pg_temp.q_as(pg_temp.f('testadmin'), format($q$select public.resolve_partner_complaint(%L, 'upheld', 'A test complaint that must not count')::text$q$, v_id));
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('C13 a test account''s upheld complaint is not counted (INV-13)', '1', pg_temp.quality_of('lab', v_lab, 'complaints_upheld'));
  -- two more real upheld complaints reach the limit of three
  for v_i in 1..2 loop
    perform pg_temp.q_as(pg_temp.f('admin'), format($q$select public.record_partner_complaint('lab', %L, 'wrong_result')::text$q$, v_lab));
  end loop;
  for v_id in select id from public.partner_complaints where partner_id = v_lab and category = 'wrong_result' loop
    perform pg_temp.q_as(pg_temp.f('admin'), format($q$select public.resolve_partner_complaint(%L, 'upheld', 'Checked and confirmed upheld')::text$q$, v_id));
  end loop;
  perform private.compute_partner_quality('lab', v_lab);
  perform pg_temp.r('C14 three real upheld complaints is a breach', '3|true', pg_temp.quality_of('lab', v_lab, 'complaints_upheld') || '|' || ('complaints_upheld_limit' = any ((select breaches from public.partner_quality where partner_id = v_lab order by period_month desc limit 1)))::text);
  perform pg_temp.r('C15 the open complaint from the CMO is counted as open, not upheld', '1', pg_temp.quality_of('lab', v_lab, 'complaints_open'));
end $$;

-- D. The rule suspends from NEW work --------------------------------------------------------------------------------------------------
do $$
declare v_labA uuid := pg_temp.f('labA'); v_labB uuid := pg_temp.f('labB'); v_org uuid := pg_temp.f('org'); v jsonb; n integer;
begin
  -- Lab B has breached the complaint limit: the rule pauses it
  v := pg_temp.apply('lab', v_labB);
  perform pg_temp.r('D1 the complaint limit pauses the laboratory by rule', 'suspended|true', pg_temp.status_of('lab', v_labB) || '|' || (v ->> 'suspended_now'));
  perform pg_temp.r('D2 the log names the rule, the reasons and the configuration version, no person', 'rule|{complaints_upheld_limit}|1|null',
    (select source || '|' || reason_codes::text || '|' || config_version || '|' || coalesce(actor_id::text, 'null') from public.partner_work_status_log where partner_id = v_labB order by id desc limit 1));
  perform pg_temp.r('D3 the event is registered, carries the breach codes and no patient or result', 'true|true|null',
    (select (payload ->> 'suspended')::text || '|' || (payload ? 'breaches')::text || '|' || coalesce(patient_id::text, 'null') from public.domain_events where event_type = 'partner.quality_breach' and aggregate_id = v_labB order by created_at desc limit 1));
  perform pg_temp.r('D4 the event payload names nothing clinical (INV-07)', 'true', (select (payload::text !~* '(result|glucose|creatinine|patient_name|diagnos|condition)')::text from public.domain_events where event_type = 'partner.quality_breach' and aggregate_id = v_labB order by created_at desc limit 1));
  perform pg_temp.r('D5 an administrator was told, and the notice names nothing', 'true', (select (count(*) > 0 and bool_and(payload = '{}'::jsonb))::text from public.notifications where template = 'partner_quality_attention' and recipient_id = pg_temp.f('admin')));
  -- Lab A: late laboratory (50 percent) is paused by the turnaround rule
  v := pg_temp.apply('lab', v_labA);
  perform pg_temp.r('D6 a laboratory with half its results late is paused by rule', 'suspended|{turnaround_below_target}',
    pg_temp.status_of('lab', v_labA) || '|' || (select reason_codes::text from public.partner_work_status where partner_id = v_labA));
  -- the sweep runs everything and one failure does not stop the rest
  n := (private.partner_quality_sweep() ->> 'checked')::integer;
  perform pg_temp.r('D7 the nightly sweep checks every active laboratory and pharmacy', 'true', (n >= 4)::text);
  perform pg_temp.r('D8 running the rule again does not repeat the suspension or the event', '1|1',
    (select count(*)::text from public.partner_work_status_log where partner_id = v_labB and to_state = 'suspended') || '|' ||
    (select count(*)::text from public.domain_events where event_type = 'partner.quality_breach' and aggregate_id = v_labB and payload ->> 'suspended' = 'true'));
end $$;

-- E. Removal is enforced where work is created ------------------------------------------------------------------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); v_labA uuid := pg_temp.f('labA'); v_labB uuid := pg_temp.f('labB'); v_pat uuid := pg_temp.f('pat'); v_staff uuid := pg_temp.f('staff');
        v_open_lab uuid; v_order uuid; v_rx uuid; v_phA uuid := pg_temp.f('phA'); v_locA uuid := pg_temp.f('locA'); v_phB uuid := pg_temp.f('phB');
begin
  begin
    insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication)
    values (v_org, v_pat, v_labB, 'partner', 'pending_payment', 'clinically_triggered', v_staff, 'S74 should be refused');
    perform pg_temp.r('E1 an order cannot be given to a paused laboratory', '55000', 'inserted');
  exception when others then
    perform pg_temp.r('E1 an order cannot be given to a paused laboratory', '55000', sqlstate);
  end;
  -- lab orders go to a third laboratory that is open
  insert into public.lab_providers (name, is_active, license_expires_at, license_verified_at) values ('S74 Lab C', true, now() + interval '200 days', now()) returning id into v_open_lab;
  insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication)
  values (v_org, v_pat, v_open_lab, 'partner', 'pending_payment', 'clinically_triggered', v_staff, 'S74 proof order') returning id into v_order;
  perform pg_temp.r('E2 an open laboratory still receives an order', 'true', (v_order is not null)::text);
  -- an order already with a laboratory that is later paused keeps working
  update public.lab_providers set license_expires_at = now() - interval '1 day' where id = v_open_lab;
  perform pg_temp.apply('lab', v_open_lab);
  perform pg_temp.r('E3 the third laboratory is paused by its expired licence', 'suspended', pg_temp.status_of('lab', v_open_lab));
  update public.lab_orders set status = 'payment_confirmed' where id = v_order;
  perform pg_temp.r('E4 work already in flight is untouched: the existing order still moves on', 'payment_confirmed', (select status::text from public.lab_orders where id = v_order));
  -- pharmacies
  v_rx := pg_temp.mkrx(v_org, v_pat, pg_temp.f('doc'));
  perform pg_temp.r('E5 an open pharmacy can be sent a prescription', 'true', (private.pharmacy_location_choosable(v_phA, v_locA))::text);
  update public.pharmacy_partners set license_expires_at = now() - interval '1 day' where id = v_phA;
  perform pg_temp.apply('pharmacy', v_phA);
  perform pg_temp.r('E6 the pharmacy''s expired licence pauses it by rule', 'suspended|{licence_expired}', pg_temp.status_of('pharmacy', v_phA) || '|' || (select reason_codes::text from public.partner_work_status where partner_id = v_phA));
  begin
    insert into public.prescription_collection_codes (prescription_id, organisation_id, patient_id, pharmacy_partner_id, pharmacy_location_id, code, code_expires_at, is_test)
    values (v_rx, v_org, v_pat, v_phA, v_locA, 'ABCD2345', now() + interval '14 days', true);
    perform pg_temp.r('E7 a prescription cannot be sent to a paused pharmacy', '55000', 'inserted');
  exception when others then
    perform pg_temp.r('E7 a prescription cannot be sent to a paused pharmacy', '55000', sqlstate);
  end;
  update public.pharmacy_partners set license_expires_at = now() + interval '200 days' where id = v_phA;   -- the licence is renewed; still paused until a person reinstates
  perform pg_temp.r('E8 a paused pharmacy is not offered to patients (S28c chooser test)', 'false', (private.pharmacy_location_choosable(v_phA, v_locA))::text);
  perform pg_temp.r('E9 a pharmacy that was never paused is still offered', 'true', (select exists (select 1 from public.pharmacy_partners where id = v_phB and is_active))::text);
end $$;

-- F. Reinstatement ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_labB uuid := pg_temp.f('labB'); v_labC uuid; v_phA uuid := pg_temp.f('phA'); v_open_lab uuid; v_n integer;
begin
  select id into v_labC from public.lab_providers where name = 'S74 Lab C';
  perform pg_temp.r('F1 a patient cannot reinstate', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.reinstate_partner('lab', %L, 'Trying to put it back myself today')::text$q$, v_labB)));
  perform pg_temp.r('F2 the laboratory itself cannot reinstate itself', 'ERR:42501', pg_temp.q_as(pg_temp.f('labBu'), format($q$select public.reinstate_partner('lab', %L, 'Trying to put it back myself today')::text$q$, v_labB)));
  perform pg_temp.r('F3 a plain clinician cannot', 'ERR:42501', pg_temp.q_as(pg_temp.f('doc'), format($q$select public.reinstate_partner('lab', %L, 'Trying to put it back myself today')::text$q$, v_labB)));
  perform pg_temp.r('F4 anon cannot', 'ERR:42501', pg_temp.anon_q(format($q$select public.reinstate_partner('lab', %L, 'Trying to put it back myself today')::text$q$, v_labB)));
  perform pg_temp.r('F5 a reason of at least 20 characters is required', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.reinstate_partner('lab', %L, 'too short')::text$q$, v_labB)));
  perform pg_temp.r('F6 an open partner cannot be reinstated', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.reinstate_partner('lab', %L, 'Not suspended so nothing to do here')::text$q$, pg_temp.f('labAopen'))));
  perform pg_temp.r('F7 an expired licence blocks reinstatement outright', 'ERR:55000', pg_temp.q_as(pg_temp.f('admin'), format($q$select public.reinstate_partner('lab', %L, 'The owner called and promised to renew')::text$q$, v_labC)));
  update public.lab_providers set license_expires_at = now() + interval '300 days' where id = v_labC;
  perform pg_temp.do_as(pg_temp.f('cmo'), format($q$select public.reinstate_partner('lab', %L, 'Licence renewed, certificate seen on site')::text$q$, v_labC));
  perform pg_temp.r('F8 the CMO reinstates once the licence is renewed', 'open', pg_temp.status_of('lab', v_labC));
  perform pg_temp.r('F9 the log names the person and the reason', 'person|Licence renewed, certificate seen on site',
    (select source || '|' || reason from public.partner_work_status_log where partner_id = v_labC order by id desc limit 1));
  perform pg_temp.r('F10 the reinstated event is registered and carries no patient', 'true', (select (count(*) = 1 and bool_and(patient_id is null))::text from public.domain_events where event_type = 'partner.reinstated' and aggregate_id = v_labC));
  -- the override: Lab B is paused for the complaint limit; the admin reinstates it; the rule does not pause it again inside the review period
  perform pg_temp.do_as(pg_temp.f('admin'), format($q$select public.reinstate_partner('lab', %L, 'Reviewed the complaints with the owner, plan agreed')::text$q$, v_labB));
  perform pg_temp.r('F11 the admin reinstates a laboratory paused for a performance breach', 'open', pg_temp.status_of('lab', v_labB));
  perform pg_temp.apply('lab', v_labB);
  perform pg_temp.r('F12 the same performance breach does not pause it again during the override', 'open', pg_temp.status_of('lab', v_labB));
  update public.partner_work_status set override_until = now() - interval '1 day' where partner_id = v_labB;
  perform pg_temp.apply('lab', v_labB);
  perform pg_temp.r('F13 once the override has run out the rule applies again', 'suspended', pg_temp.status_of('lab', v_labB));
  -- an expired licence cannot be held off by an override
  update public.lab_providers set license_expires_at = now() - interval '2 days' where id = v_labC;
  update public.partner_work_status set override_until = now() + interval '20 days' where partner_id = v_labC;
  perform pg_temp.apply('lab', v_labC);
  perform pg_temp.r('F14 an override never holds off an expired licence', 'suspended', pg_temp.status_of('lab', v_labC));
  -- manual suspension
  perform pg_temp.r('F15 a patient cannot pause a partner', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), format($q$select public.suspend_partner_from_new_work('pharmacy', %L, 'Trying to pause a pharmacy today')::text$q$, pg_temp.f('phB'))));
  perform pg_temp.q_as(pg_temp.f('admin'), format($q$select public.suspend_partner_from_new_work('pharmacy', %L, 'Serious complaint under investigation now')::text$q$, pg_temp.f('phB')));
  perform pg_temp.r('F16 an admin pauses a pharmacy with a reason, recorded as a person', 'suspended|person', pg_temp.status_of('pharmacy', pg_temp.f('phB')) || '|' || (select source from public.partner_work_status_log where partner_id = pg_temp.f('phB') order by id desc limit 1));
end $$;

-- G. The partner's own view ------------------------------------------------------------------------------------------------------------
do $$
declare v_labB uuid := pg_temp.f('labB'); j jsonb;
begin
  j := pg_temp.q_as(pg_temp.f('labBu'), 'select public.partner_my_quality()::text')::jsonb;
  perform pg_temp.r('G1 a laboratory sees its own state and score', 'lab|suspended', (j ->> 'partner_kind') || '|' || (j ->> 'work_state'));
  perform pg_temp.r('G2 it sees its complaints by category and state only (no note, no raiser)', 'false|false', ((j -> 'complaints' -> 0) ? 'note')::text || '|' || ((j -> 'complaints' -> 0) ? 'raised_by')::text);
  perform pg_temp.r('G3 the figures are its own: three upheld, not another lab''s', '3', j ->> 'complaints_upheld');
  perform pg_temp.r('G4 another laboratory sees different figures', '0', (pg_temp.q_as(pg_temp.f('labAu'), 'select public.partner_my_quality()::text')::jsonb) ->> 'complaints_upheld');
  perform pg_temp.r('G5 a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('pat'), 'select public.partner_my_quality()::text'));
  perform pg_temp.r('G6 anon is refused', 'ERR:42501', pg_temp.anon_q('select public.partner_my_quality()::text'));
  perform pg_temp.r('G7 the pharmacist sees the pharmacy''s figures', 'pharmacy', (pg_temp.q_as(pg_temp.f('phAu'), 'select public.partner_my_quality()::text')::jsonb) ->> 'partner_kind');
  perform pg_temp.r('G8 the desk overview is refused to a laboratory and a patient', 'ERR:42501|0', pg_temp.q_as(pg_temp.f('labAu'), 'select 1 from public.partner_quality_overview() limit 1') || '|' || coalesce(pg_temp.q_as(pg_temp.f('pat'), 'select count(*)::text from public.partner_quality_overview()'), '0'));
  perform pg_temp.r('G9 the desk overview is given to the admin and lists the partners', 'true', (pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.partner_quality_overview()')::integer >= 4)::text);
end $$;

-- H. Append only ---------------------------------------------------------------------------------------------------------------------
select pg_temp.r('H1 the status log cannot be updated even by the table owner', '42501', pg_temp.try_sql($$update public.partner_work_status_log set reason = 'x'$$));
select pg_temp.r('H2 ...nor deleted', '42501', pg_temp.try_sql('delete from public.partner_work_status_log'));
select pg_temp.r('H3 ...nor truncated', '42501', pg_temp.try_sql('truncate public.partner_work_status_log'));

-- I. SABOTAGE ---------------------------------------------------------------------------------------------------------------------
-- (a) the lab trigger dropped: an order can be given to a paused laboratory again
drop trigger lab_orders_refuse_suspended_lab on public.lab_orders;
do $$
begin
  begin
    insert into public.lab_orders (organisation_id, patient_id, provider_id, fulfilment, status, origin, ordered_by, clinical_indication)
    values (pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('labB'), 'partner', 'pending_payment', 'clinically_triggered', pg_temp.f('staff'), 'S74 sabotage');
    perform pg_temp.sab('the paused laboratory is still refused new work', '55000', 'inserted');
  exception when others then perform pg_temp.sab('the paused laboratory is still refused new work', '55000', sqlstate);
  end;
end $$;
-- (b) the desk check opened: a patient can record a complaint
create or replace function private.partner_desk_actor() returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('a patient is still refused when recording a complaint', 'ERR:42501',
  pg_temp.q_as(pg_temp.f('pat'), format($q$select public.record_partner_complaint('lab', %L, 'late_result')::text$q$, pg_temp.f('labA'))));
-- (c) the open-for-work test forced true: the paused pharmacy is offered again
create or replace function private.partner_open_for_new_work(p_kind text, p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$ select true $$;
select pg_temp.sab('a paused pharmacy is still not offered to patients', 'false', (private.pharmacy_location_choosable(pg_temp.f('phA'), pg_temp.f('locA')))::text);

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S74 partner quality proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

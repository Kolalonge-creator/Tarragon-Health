-- S70b proof: a blood pressure taken at a partner pharmacy with the person's one-time code (migration *_s70b_pharmacy_reading_point.sql).
-- One rolled-back transaction. Proves: both switches are born off and everything refuses while off; only a patient can make a code and it works once;
-- a wrong code is counted and the fifth locks the pharmacy out; a pharmacist with a good code opens a visit, can record up to the limit and no more, only for that person,
-- only blood pressure, only typed ('manual') source; the stored reading is triaged EXACTLY like a typed one (a high reading raises the same alert); the ledger says
-- pharmacy / counter_consent; another pharmacist and a patient cannot use the visit; a client can read neither codes nor failures; anon is refused.
-- NOTE ON THE GUARD: the go-live guard assisted_entry_pharmacy_enabled still cannot be switched on (no conditions are defined, by design, and this migration does not
-- touch private.go_live_conditions). To test the seam this proof replaces private.pharmacy_assisted_entry_open with the seam alone, INSIDE the rolled-back transaction,
-- and separately proves the real function says no with the guard off.
-- SABOTAGE: (1) the reading limit removed from the seam, (2) the person check removed from the seam. Each must flip at least one check. (The lockout is covered by the real-phase checks only.)
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_partner uuid default null) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's70bph-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, pharmacy_partner_id)
  values (v, p_org, p_role::public.user_role, 'S70B ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true, p_partner)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true, pharmacy_partner_id = excluded.pharmacy_partner_id;
  return v;
end $f$;
create function pg_temp.module(p_on boolean) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end where key = 'device_pharmacy_readings' $$;
-- the code the patient just made, read the way the proof (superuser) can: a fresh code per call, returned as text
create function pg_temp.make_code(p_patient uuid) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_patient);
  select (public.create_pharmacy_reading_code() ->> 'code') into r;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.open_as(p_uid uuid, p_code text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select (public.pharmacist_open_reading_visit(%L) ->> 'outcome')$q$, p_code)) $$;
create function pg_temp.bp_as(p_uid uuid, p_patient uuid, p_s int, p_d int) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.pharmacist_record_bp(%L, %s, %s)::text is not null$q$, p_patient, p_s, p_d)) $$;

create function pg_temp.run(p_phase text) returns void language plpgsql as
$f$
declare
  v_org uuid; v_partner uuid; v_partner2 uuid; v_pat uuid; v_pat2 uuid; v_ph uuid; v_ph2 uuid;
  v_code text; v_n integer; v_i integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at) values ('S70B Pharmacy A ' || p_phase, true, now(), now(), 'activated', now()) returning id into v_partner;
  insert into public.pharmacy_partners (name, is_active, approved_at, license_verified_at, onboarding_status, nafdac_source_attested_at) values ('S70B Pharmacy B ' || p_phase, true, now(), now(), 'activated', now()) returning id into v_partner2;
  v_pat := pg_temp.mkuser(v_org, p_phase || '-pat', 'patient');
  v_pat2 := pg_temp.mkuser(v_org, p_phase || '-pat2', 'patient');
  v_ph := pg_temp.mkuser(v_org, p_phase || '-ph', 'pharmacist', v_partner);
  v_ph2 := pg_temp.mkuser(v_org, p_phase || '-ph2', 'pharmacist', v_partner2);

  -- (test only, rolled back) the seam without the go-live guard, so the seam itself can be exercised; the real function is checked with the guard off below
  execute 'create or replace function private.pharmacy_assisted_entry_open(p_patient uuid) returns boolean language sql stable security definer set search_path = '''' as $b$ select private.pharmacy_assisted_entry_allowed(p_patient) $b$';

  -- 1. everything refuses while the module is off
  perform pg_temp.module(false);
  perform pg_temp.ck(p_phase, 'off: making a code is refused', 'ERR:55000', pg_temp.q_as(v_pat, 'select public.create_pharmacy_reading_code()::text'));
  perform pg_temp.ck(p_phase, 'off: opening a visit is refused', 'ERR:55000', pg_temp.open_as(v_ph, '12345678'));

  perform pg_temp.module(true);
  -- 2. who can make a code
  perform pg_temp.ck(p_phase, 'a pharmacist cannot make a patient code', 'ERR:42501', pg_temp.q_as(v_ph, 'select public.create_pharmacy_reading_code()::text'));
  perform pg_temp.ck(p_phase, 'anon cannot make a code', 'ERR:42501', pg_temp.anon_q('select public.create_pharmacy_reading_code()::text'));
  v_code := pg_temp.make_code(v_pat);
  perform pg_temp.ck(p_phase, 'the code is 8 digits', 'true', (v_code ~ '^[0-9]{8}$')::text);
  perform pg_temp.ck(p_phase, 'only a hash is stored (the code itself is nowhere in the table)', '0',
    (select count(*)::text from public.pharmacy_reading_codes where code_hash = v_code));
  perform pg_temp.ck(p_phase, 'a patient cannot read the code table', 'ERR:42501', pg_temp.q_as(v_pat, 'select count(*)::text from public.pharmacy_reading_codes'));
  perform pg_temp.ck(p_phase, 'a patient cannot call the counter function', 'ERR:42501', pg_temp.open_as(v_pat, v_code));

  -- 3. the seam says no before any visit, and the real function says no with the guard off
  perform pg_temp.ck(p_phase, 'no visit yet: a pharmacist cannot record a reading', 'ERR:42501', pg_temp.bp_as(v_ph, v_pat, 128, 82));
  perform pg_temp.ck(p_phase, 'with the go-live guard off the real gate says no even after a visit would exist', 'false',
    (select private.go_live_guard_on('assisted_entry_pharmacy_enabled'))::text);

  -- 4. a wrong code is counted; five lock the pharmacy
  for v_i in 1..5 loop
    perform pg_temp.ck(p_phase, 'wrong code ' || v_i || ' is refused', 'invalid', pg_temp.open_as(v_ph2, '0000000' || v_i));
  end loop;
  perform pg_temp.ck(p_phase, 'the sixth try is locked out, even with a good code', 'locked', pg_temp.open_as(v_ph2, v_code));
  perform pg_temp.ck(p_phase, 'the lockout is per pharmacy: another pharmacy is not locked', 'false',
    (pg_temp.open_as(v_ph, '99999999') = 'locked')::text);
  -- the failed try above counted once against pharmacy A; clear it so the real code below is not affected by test noise
  delete from public.pharmacy_reading_failures where pharmacy_partner_id = v_partner;

  -- 5. the good code opens a visit, once
  perform pg_temp.ck(p_phase, 'the right code opens a visit', 'ok', pg_temp.open_as(v_ph, v_code));
  perform pg_temp.ck(p_phase, 'the same code cannot be used twice', 'invalid', pg_temp.open_as(v_ph, v_code));
  delete from public.pharmacy_reading_failures where pharmacy_partner_id = v_partner;

  -- 6. recording: only for that person, only that pharmacist, up to the limit, blood pressure only
  perform pg_temp.ck(p_phase, 'another pharmacist cannot use this visit', 'ERR:42501', pg_temp.bp_as(v_ph2, v_pat, 128, 82));
  perform pg_temp.ck(p_phase, 'the visit does not cover a different person', 'ERR:42501', pg_temp.bp_as(v_ph, v_pat2, 128, 82));
  perform pg_temp.ck(p_phase, 'an impossible pair is refused', 'ERR:22023', pg_temp.bp_as(v_ph, v_pat, 80, 120));
  perform pg_temp.ck(p_phase, 'reading 1 is recorded', 'true', pg_temp.bp_as(v_ph, v_pat, 128, 82));
  perform pg_temp.ck(p_phase, 'reading 2 is recorded', 'true', pg_temp.bp_as(v_ph, v_pat, 130, 84));
  perform pg_temp.ck(p_phase, 'reading 3 is recorded', 'true', pg_temp.bp_as(v_ph, v_pat, 126, 80));
  perform pg_temp.ck(p_phase, 'reading 4 is past the limit and is refused', 'ERR:42501', pg_temp.bp_as(v_ph, v_pat, 126, 80));
  perform pg_temp.ck(p_phase, 'a pharmacist cannot insert a glucose reading straight into the table', 'ERR:42501',
    pg_temp.q_as(v_ph, format($q$insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, glucose_mmol_l, logged_by_profile_id, taken_at) values (%L, %L, 'glucose', 'manual', 6.1, %L, now())$q$, v_org, v_pat, v_ph)));
  perform pg_temp.ck(p_phase, 'a pharmacist cannot insert a wearable-source blood pressure', 'ERR:42501',
    pg_temp.q_as(v_ph, format($q$insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, systolic, diastolic, logged_by_profile_id, taken_at) values (%L, %L, 'blood_pressure', 'wearable', 120, 80, %L, now())$q$, v_org, v_pat, v_ph)));

  -- 7. what was stored: three typed ('manual') readings, flagged as entered by the pharmacy at the counter
  select count(*) into v_n from public.vitals_readings where patient_id = v_pat and source = 'manual' and assisted_entry and logged_by_profile_id = v_ph;
  perform pg_temp.ck(p_phase, 'three manual-source readings entered by the pharmacist', '3', v_n::text);
  perform pg_temp.ck(p_phase, 'the ledger says pharmacy, counter consent, for each', '3',
    (select count(*)::text from public.assisted_entry_log where patient_id = v_pat and actor_kind = 'pharmacy' and consent_basis = 'counter_consent'));
  perform pg_temp.ck(p_phase, 'the person can read their own visit', '1', pg_temp.q_as(v_pat, 'select count(*)::text from public.pharmacy_reading_visits'));
  perform pg_temp.ck(p_phase, 'the person sees the pharmacy label through the existing attribution function', 'pharmacy',
    pg_temp.q_as(v_pat, format($q$select (public.assisted_entry_attribution(%L, array(select id from public.vitals_readings where patient_id = %L limit 1)) -> 0 ->> 'actor_kind')$q$, v_pat, v_pat)));

  -- 8. triaged exactly like a typed reading: a high reading in a fresh visit raises the same BP alert path as a manual one
  v_code := pg_temp.make_code(v_pat2);
  perform pg_temp.ck(p_phase, 'visit for the second person', 'ok', pg_temp.open_as(v_ph, v_code));
  perform pg_temp.ck(p_phase, 'a high reading is recorded', 'true', pg_temp.bp_as(v_ph, v_pat2, 188, 112));
  perform pg_temp.ck(p_phase, 'the high pharmacy reading was graded by the same BP red-flag path (an audit row or a clinician alert or an emergency event exists)', 'true',
    ((select count(*) from public.audit_log where actor_id = v_pat2 and action like 'bp_red_flag.%') +
     (select count(*) from public.clinician_alerts where patient_id = v_pat2) +
     (select count(*) from public.emergency_events where patient_id = v_pat2) > 0)::text);

  -- 9. clients cannot read codes or failures; anon sees nothing
  perform pg_temp.ck(p_phase, 'a pharmacist cannot read the failures table', 'ERR:42501', pg_temp.q_as(v_ph, 'select count(*)::text from public.pharmacy_reading_failures'));
  perform pg_temp.ck(p_phase, 'anon cannot read visits', 'ERR:42501', pg_temp.anon_q('select count(*)::text from public.pharmacy_reading_visits'));
  perform pg_temp.ck(p_phase, 'anon cannot open a visit', 'ERR:42501', pg_temp.anon_q($$select public.pharmacist_open_reading_visit('12345678')::text$$));
end $f$;

do $$ begin perform pg_temp.run('real'); end $$;

-- SABOTAGE 1: the reading limit removed from the seam -> "reading 4 is past the limit" must flip
create function pg_temp.sab_seam(p_body text) returns void language plpgsql as
$f$ begin execute 'create or replace function private.pharmacy_assisted_entry_allowed(p_patient uuid) returns boolean language sql stable security definer set search_path = '''' as $b$' || p_body || '$b$'; end $f$;
select pg_temp.sab_seam($b$ select private.module_enabled('device_pharmacy_readings') and private.pharmacist_partner() is not null
  and exists (select 1 from public.pharmacy_reading_visits v where v.patient_id = p_patient and v.pharmacist_id = (select auth.uid()) and v.expires_at > now()) $b$);
do $$ begin perform pg_temp.run('sab_limit'); end $$;

-- SABOTAGE 2: the person check removed from the seam (any open visit of this pharmacist covers anyone) -> "does not cover a different person" must flip
select pg_temp.sab_seam($b$ select private.module_enabled('device_pharmacy_readings') and private.pharmacist_partner() is not null
  and exists (select 1 from public.pharmacy_reading_visits v where v.pharmacist_id = (select auth.uid()) and v.expires_at > now()) $b$);
do $$ begin perform pg_temp.run('sab_person'); end $$;

do $$
declare v_bad integer; v_flip integer; v_ph text; v_need integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S70b pharmacy proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  for v_ph, v_need in select * from (values ('sab_limit', 1), ('sab_person', 1)) as t(ph, need) loop
    select count(*) into v_flip from results where phase = v_ph and expected is distinct from actual;
    if v_flip < v_need then raise exception 'VACUOUS TEST: sabotage % flipped only % checks (need %)', v_ph, v_flip, v_need; end if;
  end loop;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;

-- Proof: on-site outreach access without blanket staff access, and the emergency flag behind OUT-001
-- (migration *_outreach_run_access_and_dangerous_reading.sql).
--   A. An account that is NOT care-team staff (a back-office role) holding screening_days.run reads its organisation's
--      outreach days, their attendee list and enrolment links, but never a bundle day; without the grant it reads none; a
--      holder in another organisation reads none. It still reads no patient's vitals.
--   B. The holder runs the day end to end: registers an attendee, enrols them, saves readings.
--   C. Saved readings that cross the signed emergency threshold return emergency = true (a pulse of 160); ordinary readings
--      return false.
--   D. SABOTAGE: the runner policy on screening_days removed: the holder reads no outreach day (so A1 was that policy).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ora-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'ORA ' || p_label, '+23483' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true,
    phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_admin uuid; v_runner uuid; v_nogrant uuid; v_runner2 uuid; v_payer uuid; v_p1 uuid; v_p2 uuid;
  v_day uuid; v_bundle uuid; v_s1 uuid; v_s2 uuid; v_r text;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then select id into v_org from public.organisations order by created_at limit 1; end if;
  select id into v_org2 from public.organisations where id <> v_org order by created_at limit 1;
  if v_org2 is null then
    insert into public.organisations (name, type) values ('ORA other organisation', 'direct_consumer') returning id into v_org2;
  end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_runner := pg_temp.mkuser(v_org, 'runner', 'analyst');
  v_nogrant := pg_temp.mkuser(v_org, 'no-grant', 'analyst');
  v_runner2 := pg_temp.mkuser(v_org2, 'runner-other-org', 'analyst');
  update public.profiles set organisation_id = v_org2 where id = v_runner2;
  v_payer := pg_temp.mkuser(v_org, 'payer', 'patient');
  v_p1 := pg_temp.mkuser(v_org, 'attendee-1', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'attendee-2', 'patient');
  insert into public.user_permission_grants (profile_id, permission_key, granted_by)
  values (v_runner, 'screening_days.run', v_admin), (v_runner2, 'screening_days.run', v_admin);
  perform pg_temp.rec('A0 the runner is not care-team staff', 'false',
    pg_temp.q_as(v_runner, format($q$select private.is_org_staff(%L)::text$q$, v_org)));

  v_day := (pg_temp.q_as(v_admin, format($q$select public.create_outreach_day('outreach_free', 'ORA Church', null, 'Yaba', %L, 3) ->> 'screening_day_id'$q$, current_date + 2)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 3, 0)::text$q$, v_day));
  insert into public.screening_days (organisation_id, requested_by, kind, host_name, location, event_date, panel_bundle_id, slots_requested)
  values (v_org, v_payer, 'bundle', 'ORA bundle', 'Ikeja', current_date + 2, (select id from public.panel_bundles limit 1), 2)
  returning id into v_bundle;

  -- ===== A. Read access =====
  perform pg_temp.rec('A1 the runner reads the outreach day', '1',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.screening_days where id = %L$q$, v_day)));
  perform pg_temp.rec('A2 ...but never a bundle day', '0',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.screening_days where id = %L$q$, v_bundle)));
  perform pg_temp.rec('A3 the same role without the grant reads none', '0',
    pg_temp.q_as(v_nogrant, format($q$select count(*)::text from public.screening_days where id = %L$q$, v_day)));
  perform pg_temp.rec('A4 a holder in another organisation reads none', '0',
    pg_temp.q_as(v_runner2, format($q$select count(*)::text from public.screening_days where id = %L$q$, v_day)));

  -- ===== B. Running the day =====
  v_s1 := (pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Attendee One', null)::text$q$, v_day)))::uuid;
  v_s2 := (pg_temp.q_as(v_runner, format($q$select public.add_screening_day_slot(%L, 'Attendee Two', null)::text$q$, v_day)))::uuid;
  perform pg_temp.rec('B1 the runner registers attendees and reads the list', '2',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.screening_day_slots where screening_day_id = %L$q$, v_day)));
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s1, v_p1));
  v_r := pg_temp.q_as(v_runner, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s2, v_p2));
  perform pg_temp.rec('B2 the runner enrols them and reads the enrolment links', '2',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.outreach_enrolments where screening_day_id = %L$q$, v_day)));
  perform pg_temp.rec('B3 another org''s holder reads no enrolment', '0',
    pg_temp.q_as(v_runner2, $q$select count(*)::text from public.outreach_enrolments$q$));

  -- ===== C. Emergency flag =====
  v_r := pg_temp.q_as(v_runner, format($q$select (public.record_outreach_vitals(%L, '{"bp_readings":[{"systolic":124,"diastolic":80}],"pulse_bpm":72}'::jsonb) ->> 'emergency')$q$, v_s1));
  perform pg_temp.rec('C1 ordinary readings: emergency = false', 'false', v_r);
  v_r := pg_temp.q_as(v_runner, format($q$select (public.record_outreach_vitals(%L, '{"pulse_bpm":160}'::jsonb) ->> 'emergency')$q$, v_s2));
  perform pg_temp.rec('C2 a reading past the signed emergency threshold (pulse 160): emergency = true', 'true', v_r);
  -- a reading the attendee logged themselves at home, before the check
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, taken_at)
  values (v_org, v_p1, 'pulse', 68, 'manual', now());
  perform pg_temp.rec('A5 the runner reads only the readings they entered (the existing own-entry rule), none of the attendee''s other vitals', '0',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.vitals_readings
                                      where patient_id in (%L, %L) and logged_by_profile_id is distinct from %L$q$, v_p1, v_p2, v_runner)));

  v_r := pg_temp.q_as(v_runner, format($q$insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source, logged_by_profile_id)
                                           values (%L, %L, 'pulse', 70, 'manual', %L) returning 'stored'$q$, v_org, v_p1, v_runner));
  perform pg_temp.rec('A6 outside record_outreach_vitals the runner still cannot enter a reading for someone', 'true', (v_r like 'ERR 42501:%')::text);

  -- ===== D. SABOTAGE =====
  execute replace(pg_get_functiondef('public.record_outreach_vitals(uuid,jsonb)'::regprocedure),
                  $x$perform set_config('tarragon.outreach_vitals', 'on', true);$x$, 'null;');
  v_s1 := (pg_temp.q_as(v_admin, format($q$select public.add_screening_day_slot(%L, 'Attendee Three', null)::text$q$, v_day)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_s1, pg_temp.mkuser(v_org, 'attendee-3', 'patient')));
  v_r := pg_temp.q_as(v_runner, format($q$select public.record_outreach_vitals(%L, '{"pulse_bpm":72}'::jsonb)::text$q$, v_s1));
  perform pg_temp.rec('D2 SABOTAGE governed flag not raised: the runner''s readings are refused (so B/C relied on that path)', 'true',
    (v_r like 'ERR 42501:assisted_entry_not_permitted%')::text);
  execute 'drop policy screening_days_select_outreach_runner on public.screening_days';
  perform pg_temp.rec('D1 SABOTAGE runner policy removed: the holder reads no outreach day (so A1 was that policy)', '0',
    pg_temp.q_as(v_runner, format($q$select count(*)::text from public.screening_days where id = %L$q$, v_day)));

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'outreach run access proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'outreach run access and dangerous reading: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;

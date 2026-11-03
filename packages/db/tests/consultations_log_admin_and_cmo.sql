-- ===========================================================================
-- Proof: consultations_log (founder/CMO ask of 2026-11-03, the staff consultations log).
--
-- Proves, with simulated sessions in one rolled-back transaction:
--   1. An admin and the CMO of the organisation get the rows; a test consultation is hidden unless include tests is on.
--   2. Doctor minutes run from the doctor joining to Finish; connected minutes are the sum of the Zoom legs with a
--      meeting.ended (two legs, 6 + 2.5 = 8.5), a leg with no meeting.ended yet is counted as open, and a leg on the
--      same meeting id from before the room existed is ignored. Join counts are per side. A call with no Zoom events
--      has null connected minutes.
--   3. A plain clinician, a patient and an admin of ANOTHER organisation get zero rows, not an error; anon cannot execute.
--   4. The status and date filters narrow the rows; an async written consult (no scheduled_at) never appears.
--   4b. The CSV download's audit function records an admin's and the CMO's export and refuses anyone else.
--   5. SABOTAGE, each built from the live body with one clause removed: (a) no admin/CMO gate (a plain clinician then gets
--      rows); (b) no organisation clause (a foreign admin then gets rows); (c) no room-created bound (the stale leg then
--      counts). Each check MUST flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Sabotaged rows print as PASS (caught) when the check flipped.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.as_val(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;

-- Redefine consultations_log from its own current body with one fragment swapped; refuses if the fragment is not there,
-- so a sabotage can never silently become a no-op.
create function pg_temp.sabotage(p_from text, p_to text) returns void language plpgsql as
$f$
declare v_def text := pg_get_functiondef('public.consultations_log(date, date, uuid, text, boolean)'::regprocedure);
begin
  if strpos(v_def, p_from) = 0 then raise exception 'sabotage fragment not found: %', p_from; end if;
  execute replace(v_def, p_from, p_to);
end $f$;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat2 uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_admin2 uuid := gen_random_uuid();
  v_enc uuid;
  v_enc_test uuid;
  v_t0 timestamptz := date_trunc('minute', now()) - interval '2 days';
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'Consultations Log Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'consult-log-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_pat2, v_doc, v_cmo, v_admin, v_admin2]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,    v_org,  'patient',   'Log Patient',       '+2348058881701'),
    (v_pat2,   v_org,  'patient',   'Log Test Patient',  '+2348058881702'),
    (v_doc,    v_org,  'clinician', 'Log Doctor',        '+2348058881703'),
    (v_cmo,    v_org,  'clinician', 'Log CMO',           '+2348058881704'),
    (v_admin,  v_org,  'admin',     'Log Admin',         '+2348058881705'),
    (v_admin2, v_org2, 'admin',     'Log Foreign Admin', '+2348058881706')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  update public.profiles set is_active = true where id in (v_admin, v_admin2);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number,
                                     license_verified_at, license_expires_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_doc, 'Log Doctor', true, 'senior_medical_officer', 'MDCN', 'LOG-DOC-1', now(), now() + interval '1 year', 'Probe', 'L-A', now() + interval '1 year');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, status, doctor_tier, employment_type, credentialing_level,
                                     credential_type, credential_number, license_verified_at, verified_by, license_expires_at,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test) values
    (v_org, v_cmo, 'Log CMO', true, 'active', 'chief_medical_officer', 'employed', 2, 'MDCN', 'LOG-CMO-1', now(), v_admin, now() + interval '1 year',
     'Probe', 'L-C', now() + interval '1 year', true);

  -- encounters are written only by the S21 functions (adult gate and friends); fixtures go in under replica
  set local session_replication_role = replica;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, started_at, ended_at, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'video', 'completed', v_t0, v_t0 + interval '5 minutes', v_t0 + interval '27 minutes', 2, false)
  returning id into v_enc;
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, scheduled_at, policy_version, is_test)
  values (v_org, v_pat2, v_doc, 'video', 'scheduled', v_t0 + interval '1 day', 2, true)
  returning id into v_enc_test;
  -- an async written consult (no scheduled_at) is not a call and must not appear
  insert into public.encounters (organisation_id, patient_id, clinician_id, type, status, policy_version, is_test)
  values (v_org, v_pat, v_doc, 'async', 'completed', 2, false);
  insert into public.encounter_rooms (organisation_id, encounter_id, provider, provider_room_id, state, created_at)
  values (v_org, v_enc, 'zoom', '990000111222', 'ended', v_t0 - interval '1 hour');
  insert into public.encounter_events (organisation_id, encounter_id, kind, actor_id, actor_role, created_at) values
    (v_org, v_enc, 'joined', v_pat, 'patient', v_t0 + interval '1 minute'),
    (v_org, v_enc, 'joined', v_pat, 'patient', v_t0 + interval '15 minutes'),
    (v_org, v_enc, 'joined', v_pat, 'patient', v_t0 + interval '16 minutes'),
    (v_org, v_enc, 'joined', v_doc, 'clinician', v_t0 + interval '5 minutes'),
    (v_org, v_enc, 'joined', v_doc, 'clinician', v_t0 + interval '17 minutes'),
    (v_org, v_enc, 'completed', v_doc, 'clinician', v_t0 + interval '27 minutes');
  set local session_replication_role = origin;

  -- Zoom legs on the room's meeting id: leg A 6 min, leg B 2.5 min, leg C started and not ended, and a stale leg on the
  -- same meeting id from a day before the room existed (40 min) that must not count.
  insert into public.zoom_webhook_events (provider_event_id, event_type, raw_payload, created_at)
  select 'proof:' || ev || ':' || leg, ev,
         jsonb_build_object('event', ev, 'payload', jsonb_build_object('object', jsonb_strip_nulls(jsonb_build_object(
           'id', '990000111222', 'uuid', 'proof-' || leg, 'start_time', st, 'end_time', et)))),
         at
    from (values
      ('meeting.started', 'A', v_t0 + interval '5 minutes', null::timestamptz, v_t0 + interval '5 minutes'),
      ('meeting.ended',   'A', v_t0 + interval '5 minutes', v_t0 + interval '11 minutes', v_t0 + interval '11 minutes'),
      ('meeting.started', 'B', v_t0 + interval '17 minutes', null, v_t0 + interval '17 minutes'),
      ('meeting.ended',   'B', v_t0 + interval '17 minutes', v_t0 + interval '19 minutes 30 seconds', v_t0 + interval '20 minutes'),
      ('meeting.started', 'C', v_t0 + interval '25 minutes', null, v_t0 + interval '25 minutes'),
      ('meeting.ended',   'OLD', v_t0 - interval '1 day', v_t0 - interval '1 day' + interval '40 minutes', v_t0 - interval '1 day' + interval '40 minutes')
    ) as t(ev, leg, st, et, at);

  insert into fx values ('pat', v_pat), ('doc', v_doc), ('cmo', v_cmo), ('admin', v_admin), ('admin2', v_admin2),
    ('enc', v_enc), ('enc_test', v_enc_test);
end $$;

-- the one call that gives every column for the fixture's real (non-test) encounter
create function pg_temp.row_of(p_uid uuid) returns text language sql as
$$ select pg_temp.as_val(p_uid, 'authenticated', format(
     $q$select concat_ws('|', doctor_minutes, connected_minutes, zoom_legs, zoom_open_legs, patient_joins, clinician_joins, patient_name, clinician_name, is_test::text)
          from public.consultations_log(p_clinician_id => %L) where encounter_id = %L$q$, pg_temp.f('doc'), pg_temp.f('enc'))) $$;

create function pg_temp.n(p_uid uuid, p_args text) returns text language sql as
$$ select pg_temp.as_val(p_uid, 'authenticated',
     format('select count(*)::text from public.consultations_log(p_clinician_id => %L%s)', pg_temp.f('doc'), p_args)) $$;

-- ---------------------------------------------------------------------------
-- REAL checks
-- ---------------------------------------------------------------------------
do $$
declare v_admin uuid := pg_temp.f('admin'); v_cmo uuid := pg_temp.f('cmo');
begin
  -- 1. entitled callers, test rows hidden by default
  perform pg_temp.rec('real', '1a an admin sees the real call, the test call hidden by default', '1', pg_temp.n(v_admin, ''));
  perform pg_temp.rec('real', '1b an admin sees both with include tests on', '2', pg_temp.n(v_admin, ', p_include_tests => true'));
  perform pg_temp.rec('real', '1c the CMO sees the real call', '1', pg_temp.n(v_cmo, ''));
  perform pg_temp.rec('real', '1d the hidden one is the test call', 'true',
    pg_temp.as_val(v_admin, 'authenticated', format($q$select is_test::text from public.consultations_log(p_include_tests => true)
      where encounter_id = %L$q$, pg_temp.f('enc_test'))));

  -- 2. the numbers: 22 doctor minutes, 6 + 2.5 connected over two legs, one open leg, stale leg ignored, 3 + 2 joins
  perform pg_temp.rec('real', '2a doctor minutes, connected minutes, legs, open legs, joins and names', '22.0|8.5|2|1|3|2|Log Patient|Log Doctor|false',
    pg_temp.row_of(v_cmo));
  perform pg_temp.rec('real', '2b a call with no Zoom events has null connected minutes and no legs', 'null|0',
    pg_temp.as_val(v_admin, 'authenticated', format($q$select coalesce(connected_minutes::text, 'null') || '|' || zoom_legs
      from public.consultations_log(p_include_tests => true) where encounter_id = %L$q$, pg_temp.f('enc_test'))));

  -- 3. everyone else gets zero rows; anon cannot execute
  perform pg_temp.rec('real', '3a a plain clinician (the doctor on the call) gets zero rows', '0', pg_temp.n(pg_temp.f('doc'), ', p_include_tests => true'));
  perform pg_temp.rec('real', '3b a patient gets zero rows', '0', pg_temp.n(pg_temp.f('pat'), ', p_include_tests => true'));
  perform pg_temp.rec('real', '3c an admin of ANOTHER organisation gets zero rows', '0', pg_temp.n(pg_temp.f('admin2'), ', p_include_tests => true'));
  perform pg_temp.rec('real', '3d anon cannot execute it', 'ERR:42501',
    pg_temp.as_val(null, 'anon', 'select count(*)::text from public.consultations_log()'));

  -- 4. filters
  perform pg_temp.rec('real', '4a the status filter keeps only matching rows', '1', pg_temp.n(v_admin, ', p_include_tests => true, p_status => ''scheduled'''));
  perform pg_temp.rec('real', '4b a date range after both calls finds nothing', '0',
    pg_temp.n(v_admin, ', p_include_tests => true, p_from => current_date + 30'));

  -- 5. the CSV download's audit row: written for an admin and the CMO, refused to anyone else (so the route gives no file)
  perform pg_temp.rec('real', '5a an admin''s export is recorded', '1',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from (select public.log_consultations_log_export(p_rows => 2)) x$q$));
  perform pg_temp.rec('real', '5b the CMO''s export is recorded too', '1',
    pg_temp.as_val(v_cmo, 'authenticated', $q$select count(*)::text from (select public.log_consultations_log_export()) x$q$));
  perform pg_temp.rec('real', '5c a plain clinician''s export is refused', 'ERR:42501',
    pg_temp.as_val(pg_temp.f('doc'), 'authenticated', $q$select count(*)::text from (select public.log_consultations_log_export()) x$q$));
  perform pg_temp.rec('real', '5d anon cannot record an export', 'ERR:42501',
    pg_temp.as_val(null, 'anon', $q$select count(*)::text from (select public.log_consultations_log_export()) x$q$));
end $$;

-- ---------------------------------------------------------------------------
-- SABOTAGE (a): no admin/CMO gate; the plain clinician must now get rows
-- ---------------------------------------------------------------------------
select pg_temp.sabotage('if not (private.is_admin() or private.credential_is_cmo()) then', 'if false then');
do $$ begin
  perform pg_temp.rec('sabotaged', '3a a plain clinician (the doctor on the call) gets zero rows', '0', pg_temp.n(pg_temp.f('doc'), ', p_include_tests => true'));
end $$;

-- SABOTAGE (b): gate back, organisation clause gone; the foreign admin must now get rows
select pg_temp.sabotage('if false then', 'if not (private.is_admin() or private.credential_is_cmo()) then');
select pg_temp.sabotage('where e.organisation_id = private.caller_org()', 'where true');
do $$ begin
  perform pg_temp.rec('sabotaged', '3c an admin of ANOTHER organisation gets zero rows', '0', pg_temp.n(pg_temp.f('admin2'), ', p_include_tests => true'));
end $$;

-- SABOTAGE (c): organisation clause back, room-created bound gone; the stale 40 minute leg must now count
select pg_temp.sabotage('where true', 'where e.organisation_id = private.caller_org()');
select pg_temp.sabotage('and z.created_at >= r.created_at', '');
do $$ begin
  perform pg_temp.rec('sabotaged', '2a doctor minutes, connected minutes, legs, open legs, joins and names', '22.0|8.5|2|1|3|2|Log Patient|Log Doctor|false',
    pg_temp.row_of(pg_temp.f('cmo')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'consultations log proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then (case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end)
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
  from results order by phase desc, check_name;
rollback;

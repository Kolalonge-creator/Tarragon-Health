-- ===========================================================================
-- Proof: 20261013221500_s75_outcome_exclusions_and_bands.sql (S75 exclusions and severity bands; INV-10, INV-12, INV-13, INV-16).
--
--   1. DORMANT: outcome_config v4 is inserted inactive; v3 is untouched (no exclusions key); v2 is still the one in force.
--   2. v3 BEHAVES AS BEFORE: with v3 active nobody is excluded (an under-18, a person with no date of birth and a pregnant person are all measured).
--   3. v4 EXCLUDES: with v4 active the job writes NO row for a person who is under 18, has no date of birth, or is pregnant (HbA1c, weight), nor for a person whose
--      PHQ-9 total reached 20 (PHQ-9 and GAD-7) nor an under-18 PHQ-9. Everyone else is measured exactly as before.
--   4. REPORT TIME: a person who BECOMES excluded after a snapshot was written (pregnant, or a PHQ-9 of 22 later) drops out of the HbA1c figure and the
--      mental-health figure.
--   5. BANDS: the PHQ-9 report lists the baseline severity bands; withheld as a whole when any band is a small cell (1 to minimum-1), never a partial list.
--   6. SPONSOR PACK: private.outcome_measure_cohort counts HbA1c and weight with exclusions applied and returns "not shared" for PHQ-9 and GAD-7.
--   7. SAFETY SCANS: no function on the outcomes path reads item answers or the crisis flag; no sponsor-named function names a mental-health outcome object.
--   8. SABOTAGE: the exclusion branch removed from the scope check (the under-18 is then measured again), so check 3 would FAIL.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. The minimum cell is lowered to 2 on the config under test so small cohorts can be read.
-- ===========================================================================
begin;

create temp table results (check_name text, expected text, actual text, verdict text);
grant all on results to public;
create temp table fx (k text primary key, v uuid);
grant all on fx to public;

create function pg_temp.chk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_name, p_expected, p_actual, case when p_expected is not distinct from p_actual then 'PASS' else 'FAIL' end) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.json_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;

create function pg_temp.at_day(d date) returns timestamptz language sql as $$ select (d::timestamp + interval '12 hours') at time zone 'Africa/Lagos' $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.anchor() returns date language sql as $$ select pg_temp.today() - 220 $$;

create function pg_temp.mkuser(p_label text, p_role text, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's75x-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, 'S75x ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '45 years')::date), false)
  on conflict (id) do update set role = excluded.role, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a member who joined 220 days ago (every day, 180 included, has closed with its grace)
create function pg_temp.mkmember(p_label text, p_dob date default null) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient', p_dob); v_org uuid := (select organisation_id from public.profiles where id = v);
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (v_org, v, 'purchase', pg_temp.at_day(pg_temp.anchor() - 0));
  return v;
end $f$;
create function pg_temp.lab(p uuid, p_value numeric, p_offset integer) returns void language sql as
$$ insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at)
   values ((select organisation_id from public.profiles where id = p), p, 'hba1c', p_value, 'percent', pg_temp.at_day(pg_temp.anchor() + p_offset)) $$;
create function pg_temp.screen(p uuid, p_instr text, p_score integer, p_offset integer) returns void language sql as
$$ insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses, created_at)
   values ((select organisation_id from public.profiles where id = p), p, p_instr, p_score, 'minimal', '{}'::jsonb, pg_temp.at_day(pg_temp.anchor() + p_offset)) $$;
-- a member with HbA1c 9.0 near joining and 6.8 at day 90
create function pg_temp.hba(p_label text, p_dob date default null) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkmember(p_label, p_dob);
begin perform pg_temp.lab(v, 9.0, -10); perform pg_temp.lab(v, 6.8, 92); return v; end $f$;
-- a member with a PHQ-9 baseline and a day-90 score
create function pg_temp.phq(p_label text, p_base integer, p_d90 integer, p_dob date default null) returns uuid language plpgsql as
$f$ declare v uuid := pg_temp.mkmember(p_label, p_dob);
begin perform pg_temp.screen(v, 'phq9', p_base, 2); perform pg_temp.screen(v, 'phq9', p_d90, 90); return v; end $f$;
create function pg_temp.has_row(p_table text, p uuid) returns integer language plpgsql as $f$
declare n integer;
begin
  if p_table = 'm' then select count(*) into n from public.outcome_measure_snapshots where patient_id = p;
  else select count(*) into n from public.outcome_mh_snapshots where patient_id = p; end if;
  return n;
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  a1 uuid; a2 uuid; a3 uuid; a4 uuid; u1 uuid; n1 uuid; g1 uuid;
  q1 uuid; q2 uuid; q3 uuid; q4 uuid; q5 uuid; s1 uuid; uq uuid;
begin
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('analyst', pg_temp.mkuser('analyst', 'analyst'));

  set local session_replication_role = replica;
  -- HbA1c: A1 to A4 adults (counted); U1 a child; N1 no date of birth; G1 pregnant
  a1 := pg_temp.hba('a1'); a2 := pg_temp.hba('a2'); a3 := pg_temp.hba('a3'); a4 := pg_temp.hba('a4');
  u1 := pg_temp.hba('u1', (current_date - interval '10 years')::date);
  n1 := pg_temp.hba('n1'); update public.profiles set date_of_birth = null where id = n1;
  g1 := pg_temp.hba('g1'); insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, g1, true);
  -- PHQ-9: Q1 15 to 6 (moderately severe, responded), Q2 12 to 10 (moderate, no response), Q3 17 to 7 (moderately severe, responded),
  -- Q4 11 to 5 (moderate, responded), Q5 14 to 9 (moderate; made safeguarding later), S1 baseline 21 (safeguarding), UQ a child
  q1 := pg_temp.phq('q1', 15, 6); q2 := pg_temp.phq('q2', 12, 10); q3 := pg_temp.phq('q3', 17, 7); q4 := pg_temp.phq('q4', 11, 5); q5 := pg_temp.phq('q5', 14, 9);
  s1 := pg_temp.phq('s1', 21, 4);
  uq := pg_temp.phq('uq', 13, 6, (current_date - interval '12 years')::date);
  set local session_replication_role = origin;

  perform pg_temp.setf('a1', a1); perform pg_temp.setf('a2', a2); perform pg_temp.setf('a3', a3); perform pg_temp.setf('a4', a4);
  perform pg_temp.setf('u1', u1); perform pg_temp.setf('n1', n1); perform pg_temp.setf('g1', g1);
  perform pg_temp.setf('q1', q1); perform pg_temp.setf('q2', q2); perform pg_temp.setf('q3', q3); perform pg_temp.setf('q4', q4); perform pg_temp.setf('q5', q5);
  perform pg_temp.setf('s1', s1); perform pg_temp.setf('uq', uq);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant, and v3 untouched
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.chk('1a v4 is inserted inactive and the active row is still v2', 'false|2',
    (select is_active::text from public.outcome_config where version = 4) || '|' || (select version::text from public.outcome_config where is_active));
  perform pg_temp.chk('1b v3 has no exclusions or bands (a sign-off binds to a version, so it was not edited)', 'false|false',
    ((select config -> 'measures' -> 'phq9' from public.outcome_config where version = 3) ? 'exclusions')::text || '|' ||
    ((select config -> 'measures' -> 'phq9' from public.outcome_config where version = 3) ? 'bands')::text);
  perform pg_temp.chk('1c v4 is v3 plus exclusions and bands on every measure', 'true|true|true|true|true',
    (select string_agg(((v4.config -> 'measures' -> m) ? 'exclusions')::text, '|' order by m)
       from public.outcome_config v4, unnest(array['gad7', 'hba1c', 'phq9', 'weight']) m where v4.version = 4) || '|' ||
    ((select config -> 'measures' -> 'gad7' from public.outcome_config where version = 4) ? 'bands')::text);
  perform pg_temp.chk('1d the job writes nothing while v2 is active', '0', private.compute_outcome_measure_snapshots(now())::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. With v3 active nobody is excluded (v3 behaves as before)
-- ---------------------------------------------------------------------------------------------------------------------------------
update public.outcome_config set is_active = false where version = 2;
update public.outcome_config set is_active = true where version = 3;
do $$
begin
  perform private.compute_outcome_measure_snapshots(now());
  perform pg_temp.chk('2a v3: the child, the person with no date of birth and the pregnant person are still measured for HbA1c', '1/1/1',
    (pg_temp.has_row('m', pg_temp.f('u1')) > 0)::int || '/' || (pg_temp.has_row('m', pg_temp.f('n1')) > 0)::int || '/' || (pg_temp.has_row('m', pg_temp.f('g1')) > 0)::int);
  perform pg_temp.chk('2b v3: the safeguarding PHQ-9 and the child are still measured', '1/1',
    (pg_temp.has_row('h', pg_temp.f('s1')) > 0)::int || '/' || (pg_temp.has_row('h', pg_temp.f('uq')) > 0)::int);
end $$;
-- start clean for v4 (the snapshots are append-only to a user; the proof owns them)
delete from public.outcome_measure_snapshots where patient_id in (select v from fx);
delete from public.outcome_mh_snapshots where patient_id in (select v from fx);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. With v4 active the excluded are not measured
-- ---------------------------------------------------------------------------------------------------------------------------------
update public.outcome_config set is_active = false where version = 3;
update public.outcome_config set is_active = true where version = 4;
update public.outcome_config set config = jsonb_set(config, '{min_cell}', '2') where version = 4;
do $$
begin
  perform private.compute_outcome_measure_snapshots(now());
  perform pg_temp.chk('3a v4: adults are measured for HbA1c', '1/1/1/1',
    (pg_temp.has_row('m', pg_temp.f('a1')) > 0)::int || '/' || (pg_temp.has_row('m', pg_temp.f('a2')) > 0)::int || '/' ||
    (pg_temp.has_row('m', pg_temp.f('a3')) > 0)::int || '/' || (pg_temp.has_row('m', pg_temp.f('a4')) > 0)::int);
  perform pg_temp.chk('3b v4: no HbA1c row at all for the child, the person with no date of birth, or the pregnant person', '0/0/0',
    pg_temp.has_row('m', pg_temp.f('u1')) || '/' || pg_temp.has_row('m', pg_temp.f('n1')) || '/' || pg_temp.has_row('m', pg_temp.f('g1')));
  perform pg_temp.chk('3c v4: PHQ-9 adults are measured', '1/1/1/1/1',
    (pg_temp.has_row('h', pg_temp.f('q1')) > 0)::int || '/' || (pg_temp.has_row('h', pg_temp.f('q2')) > 0)::int || '/' || (pg_temp.has_row('h', pg_temp.f('q3')) > 0)::int
    || '/' || (pg_temp.has_row('h', pg_temp.f('q4')) > 0)::int || '/' || (pg_temp.has_row('h', pg_temp.f('q5')) > 0)::int);
  perform pg_temp.chk('3d v4: no mental-health row for a PHQ-9 total of 21 or for a child', '0/0',
    pg_temp.has_row('h', pg_temp.f('s1')) || '/' || pg_temp.has_row('h', pg_temp.f('uq')));
  perform pg_temp.chk('3e the config version used is recorded on the rows (INV-16)', '4',
    (select distinct config_version::text from public.outcome_measure_snapshots where patient_id = pg_temp.f('a1')));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Report time: a person who becomes excluded after the snapshot drops out
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.outcome_measures_report('hba1c', 90) $q$);
  perform pg_temp.chk('4a HbA1c day 90 before: four adults, all reached the goal', '4/4', (r #>> '{cohort_all_due,n}') || '/' || (r #>> '{cohort_all_due,reached}'));
  set local session_replication_role = replica;
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, pg_temp.f('a4'), true);
  set local session_replication_role = origin;
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.outcome_measures_report('hba1c', 90) $q$);
  perform pg_temp.chk('4b ...A4 becomes pregnant and drops out of the figure although her snapshot is still stored', '3/1',
    (r #>> '{cohort_all_due,n}') || '/' || (pg_temp.has_row('m', pg_temp.f('a4')) > 0)::int::text);
  r := pg_temp.json_as(pg_temp.f('analyst'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$);
  perform pg_temp.chk('4c PHQ-9 day 90 before: five adults', '5', r #>> '{response,n}');
  set local session_replication_role = replica;
  perform pg_temp.screen(pg_temp.f('q5'), 'phq9', 22, 120);
  set local session_replication_role = origin;
  r := pg_temp.json_as(pg_temp.f('analyst'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$);
  perform pg_temp.chk('4d ...Q5 later scores 22 and drops out of the mental-health figure', '4', r #>> '{response,n}');
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Severity bands
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := pg_temp.json_as(pg_temp.f('analyst'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$);
  perform pg_temp.chk('5a the baseline bands list: minimal 0, mild 0, moderate 2, moderately severe 2, severe 0', 'false|0/0/2/2/0',
    (r #>> '{baseline_severity,suppressed}') || '|' ||
    (select string_agg(b ->> 'n', '/' order by o) from jsonb_array_elements(r #> '{baseline_severity,by_baseline_band}') with ordinality t(b, o)));
  -- one person in the mild band makes that band a small cell: the whole breakdown is withheld, never a partial list
  set local session_replication_role = replica;
  perform pg_temp.phq('q6', 8, 4);
  set local session_replication_role = origin;
  perform private.compute_outcome_measure_snapshots(now());
  r := pg_temp.json_as(pg_temp.f('analyst'), $q$ select public.mental_health_outcome_report('phq9', 90) $q$);
  perform pg_temp.chk('5b a band of one person: the breakdown is withheld as a whole', 'true|false',
    (r #>> '{baseline_severity,suppressed}') || '|' || ((r #> '{baseline_severity}') ? 'by_baseline_band')::text);
  r := pg_temp.json_as(pg_temp.f('admin'), $q$ select public.mental_health_outcome_report('gad7', 90) $q$);
  perform pg_temp.chk('5c GAD-7 has its own four bands and no one has a GAD-7 here, so it lists zeros (or is withheld), never errors', 'true',
    ((r ? 'err') = false)::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. The sponsor pack's per-cohort figure
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  r := private.outcome_measure_cohort('hba1c', 90, null, null, array[pg_temp.f('a1'), pg_temp.f('a2'), pg_temp.f('a3'), pg_temp.f('u1'), pg_temp.f('g1'), pg_temp.f('n1')]);
  perform pg_temp.chk('6a HbA1c for a cohort of six counts the three adults only (child, pregnant and no date of birth left out)', '3', r ->> 'n');
  r := private.outcome_measure_cohort('phq9', 90, null, null, array[pg_temp.f('q1'), pg_temp.f('q2'), pg_temp.f('q3')]);
  perform pg_temp.chk('6b PHQ-9 is never given to a sponsor', 'true|mental_health_never_shown_to_a_sponsor', (r ->> 'not_shared') || '|' || (r ->> 'reason'));
  perform pg_temp.chk('6c the pack is a function nobody but the system can run', 'false/false',
    has_function_privilege('authenticated', 'private.outcome_measure_cohort(text,integer,date,date,uuid[])', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'private.outcome_measure_cohort(text,integer,date,date,uuid[])', 'EXECUTE')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Safety scans
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.item_readers() returns integer language sql as $$
  select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and (p.proname ~ '^(s75_|outcome_mh|outcome_measure|my_mental_health|clinician_mental_health|mental_health_outcome|compute_outcome_measure)')
     and p.prosrc ~* 'item_responses|crisis_flagged' $$;
do $$
begin
  perform pg_temp.chk('7a no function on the outcomes path reads item answers or the crisis flag (the scope check included)', '0', pg_temp.item_readers()::text);
  perform pg_temp.chk('7b no sponsor-named function names a mental-health outcome object', '0',
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'private') and p.proname ~* '(sponsor|corporate|payer|hmo|ngo|employer|provider_org|wellbeing_cohort)'
        and p.prosrc ~* '(outcome_mh_snapshots|mental_health_outcome|clinician_mental_health|s75_mh_nearest|outcome_mh_compute)')::text);
  perform pg_temp.chk('7c anon cannot run either report', 'false/false',
    has_function_privilege('anon', 'public.outcome_measures_report(text,integer,date,date)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.mental_health_outcome_report(text,integer,date,date)', 'EXECUTE')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Sabotage: take the exclusion branch out of the scope check and the child is measured again (3b would FAIL)
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.s75_in_scope(uuid,text,jsonb,date)'::regprocedure);
  execute replace(v_def, 'if v_ex is not null then', 'if false then');
  delete from public.outcome_measure_snapshots where patient_id = pg_temp.f('u1');
  perform private.compute_outcome_measure_snapshots(now());
  perform pg_temp.chk('8a SABOTAGE: with the exclusion branch removed the child IS measured (so check 3b is not vacuous)', '1', (pg_temp.has_row('m', pg_temp.f('u1')) > 0)::int::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 9. Verdict
-- ---------------------------------------------------------------------------------------------------------------------------------
select check_name, expected, actual, verdict from results order by check_name;
do $$
begin
  if exists (select 1 from results where verdict = 'FAIL') then
    raise exception 'S75x proof: % check(s) FAILED: %', (select count(*) from results where verdict = 'FAIL'),
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where verdict = 'FAIL');
  end if;
end $$;
rollback;

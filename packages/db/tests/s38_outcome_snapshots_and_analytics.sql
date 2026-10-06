-- S38 proof: outcome snapshots, the de-identified analytics views and the 90-day BP control report
-- (migration *_s38_outcome_snapshots_and_analytics.sql).
-- Proves in one rolled-back transaction: a snapshot is computed once its window has closed plus the grace, never before; BP is a 7-day
-- average against the person's own target (else the default) and fewer than the minimum readings is insufficient_data, never controlled;
-- the job is idempotent and a snapshot cannot be changed; one event per snapshot, ids only; a person sees only their own snapshots and
-- staff see no rows; the analytics views carry no patient id and NO TEST ACCOUNT (safety case 22, INV-13); the report counts
-- everybody due (drop-outs stay in the denominator), shows the missing share, withholds small cells and under-minimum cohorts, refuses
-- non-admins and writes its access to audit_log. SABOTAGE: the is_test filter removed from the view and the report; both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's38-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S38 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;
-- a joined person: membership starting p_ago days back, p_n0 readings in their first week at (s0, d0), p_n90 readings in the window ending day 90 at (s90, d90)
create function pg_temp.mkpat(p_org uuid, p_label text, p_test boolean, p_ago integer, p_n0 integer, p_s0 integer, p_d0 integer, p_n90 integer, p_s90 integer, p_d90 integer) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_test); a date := current_date - p_ago; k integer;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test)
  values (p_org, v, 'purchase', ((a::timestamp + time '08:00') at time zone 'Africa/Lagos'), p_test);
  for k in 0 .. p_n0 - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (p_org, v, 'blood_pressure', p_s0, p_d0, (((a + k)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
  end loop;
  for k in 0 .. p_n90 - 1 loop
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source)
    values (p_org, v, 'blood_pressure', p_s90, p_d90, (((a + 84 + k)::timestamp + time '09:00') at time zone 'Africa/Lagos'), 'device');
  end loop;
  return v;
end $f$;
create function pg_temp.snap(p_patient uuid, p_day integer, p_col text) returns text language plpgsql as
$f$ declare r text; begin execute format('select %I::text from public.outcome_snapshots where patient_id = %L and day = %s', p_col, p_patient, p_day) into r; return r; end $f$;

-- Fixtures -------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid; v_admin uuid; i integer; v_one uuid;
  a date := current_date - 100;     -- the main cohort: all joined on this date, so the report can be limited to it
  a2 date := current_date - 131;    -- a cohort with one small category (reports are by calendar month, so each cohort needs its own month)
  a3 date := current_date - 162;    -- a cohort under the minimum
  a4 date := current_date - 195;    -- a cohort whose baseline-uncontrolled subset leaves a small remainder
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('plain', pg_temp.mkuser(v_org, 'plain', 'patient', false));
  -- main cohort (non-test): 12 controlled, 12 not controlled, 12 with no readings at day 90; all started above target
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_org, 'A' || i, false, 100, 3, 150, 95, 3, 125, 80); end loop;
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_org, 'B' || i, false, 100, 3, 150, 95, 3, 148, 94); end loop;
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_org, 'C' || i, false, 100, 3, 150, 95, 0, 0, 0); end loop;
  -- a TEST account in the same cohort, controlled: it must never be counted
  perform pg_temp.setf('test1', pg_temp.mkpat(v_org, 'T1', true, 100, 3, 150, 95, 3, 125, 80));
  -- one person with only 2 readings at day 90 (below the minimum of 3) and one with their own stricter target
  perform pg_temp.setf('few', pg_temp.mkpat(v_org, 'few', false, 100, 3, 150, 95, 2, 125, 80));
  v_one := pg_temp.mkpat(v_org, 'own', false, 100, 3, 150, 95, 3, 135, 85);
  perform pg_temp.setf('own', v_one);
  insert into public.patient_bp_targets (organisation_id, patient_id, category, home_systolic, home_diastolic, office_systolic, office_diastolic, rationale, set_by)
  values (v_org, v_one, 'standard', 130, 80, 140, 90, 'S38 proof target', null);
  -- cohort 2: 3 controlled, 12 not, 12 none (the controlled cell is small); cohort 3: only 4 people
  for i in 1 .. 3 loop perform pg_temp.mkpat(v_org, 'D' || i, false, 131, 3, 150, 95, 3, 125, 80); end loop;
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_org, 'E' || i, false, 131, 3, 150, 95, 3, 148, 94); end loop;
  for i in 1 .. 12 loop perform pg_temp.mkpat(v_org, 'F' || i, false, 131, 3, 150, 95, 0, 0, 0); end loop;
  for i in 1 .. 4 loop perform pg_temp.mkpat(v_org, 'G' || i, false, 162, 3, 150, 95, 3, 125, 80); end loop;
  -- cohort 4: 20 started above target and are still above; 4 started under target and worsened (remainder 4: the baseline cohort must be withheld)
  for i in 1 .. 20 loop perform pg_temp.mkpat(v_org, 'H' || i, false, 195, 3, 150, 95, 3, 148, 94); end loop;
  for i in 1 .. 4 loop perform pg_temp.mkpat(v_org, 'J' || i, false, 195, 3, 125, 80, 3, 148, 94); end loop;
  -- timing: 50 days in (day 90 not due), 31 days in (day 30 closed yesterday, inside the grace), 34 days in (day 30 closed 4 days ago)
  perform pg_temp.setf('t50', pg_temp.mkpat(v_org, 'T50', false, 50, 3, 150, 95, 0, 0, 0));
  perform pg_temp.setf('t31', pg_temp.mkpat(v_org, 'T31', false, 31, 3, 150, 95, 0, 0, 0));
  perform pg_temp.setf('t34', pg_temp.mkpat(v_org, 'T34', false, 34, 3, 150, 95, 0, 0, 0));
end $$;

-- 1. Computation -------------------------------------------------------------------------------------------------------
do $$
declare n1 integer; n2 integer; v_before integer;
begin
  perform pg_temp.ck('before the job there are no snapshots for the fixtures', '0',
    (select count(*)::text from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id where p.full_name like 'S38 %'));
  n1 := private.compute_outcome_snapshots();
  select count(*) into v_before from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id where p.full_name like 'S38 %';
  n2 := private.compute_outcome_snapshots();
  perform pg_temp.ck('the job makes snapshots', 'true', (n1 > 0)::text);
  perform pg_temp.ck('running the job again makes none (idempotent)', '0', n2::text);
  perform pg_temp.ck('and the row count is unchanged', 'true',
    ((select count(*) from public.outcome_snapshots s join public.profiles p on p.id = s.patient_id where p.full_name like 'S38 %') = v_before)::text);
end $$;

do $$
declare a1 uuid := (select id from public.profiles where full_name = 'S38 A1'); b1 uuid := (select id from public.profiles where full_name = 'S38 B1');
        c1 uuid := (select id from public.profiles where full_name = 'S38 C1');
begin
  perform pg_temp.ck('a person under target is controlled at day 90', 'controlled/125.0/80.0/3', pg_temp.snap(a1, 90, 'bp_status') || '/' || pg_temp.snap(a1, 90, 'bp_avg_7d_sys') || '/' || pg_temp.snap(a1, 90, 'bp_avg_7d_dia') || '/' || pg_temp.snap(a1, 90, 'bp_readings_7d'));
  perform pg_temp.ck('a person over target is uncontrolled', 'uncontrolled/false', pg_temp.snap(b1, 90, 'bp_status') || '/' || pg_temp.snap(b1, 90, 'controlled'));
  perform pg_temp.ck('the baseline is the first week, uncontrolled', 'uncontrolled', pg_temp.snap(a1, 0, 'bp_status'));
  perform pg_temp.ck('no readings is insufficient_data, with no average and controlled null', 'insufficient_data/null/null', pg_temp.snap(c1, 90, 'bp_status') || '/' || coalesce(pg_temp.snap(c1, 90, 'controlled'), 'null') || '/' || coalesce(pg_temp.snap(c1, 90, 'bp_avg_7d_sys'), 'null'));
  perform pg_temp.ck('two readings is below the minimum of three: insufficient_data, never controlled', 'insufficient_data', pg_temp.snap(pg_temp.f('few'), 90, 'bp_status'));
  perform pg_temp.ck('the default target is used and says so', '140/90/default', pg_temp.snap(a1, 90, 'target_sys') || '/' || pg_temp.snap(a1, 90, 'target_dia') || '/' || pg_temp.snap(a1, 90, 'target_source'));
  perform pg_temp.ck('a person with their own target is held to it: 135/85 is not under 130/80', 'uncontrolled/130/80/patient',
    pg_temp.snap(pg_temp.f('own'), 90, 'bp_status') || '/' || pg_temp.snap(pg_temp.f('own'), 90, 'target_sys') || '/' || pg_temp.snap(pg_temp.f('own'), 90, 'target_dia') || '/' || pg_temp.snap(pg_temp.f('own'), 90, 'target_source'));
  perform pg_temp.ck('a snapshot records the config version it used (INV-16)', '1', pg_temp.snap(a1, 90, 'config_version'));
  perform pg_temp.ck('day 90 is not computed 50 days in', 'null', coalesce(pg_temp.snap(pg_temp.f('t50'), 90, 'id'), 'null'));
  perform pg_temp.ck('day 30 is not computed while the grace for late readings is running', 'null', coalesce(pg_temp.snap(pg_temp.f('t31'), 30, 'id'), 'null'));
  perform pg_temp.ck('day 30 is computed once the grace is over', 'true', (pg_temp.snap(pg_temp.f('t34'), 30, 'id') is not null)::text);
  perform pg_temp.ck('day 0 is computed for a person 31 days in', 'true', (pg_temp.snap(pg_temp.f('t31'), 0, 'id') is not null)::text);
  perform pg_temp.ck('a snapshot cannot be changed', 'outcome_snapshots_append_only',
    pg_temp.try_owner(format($q$update public.outcome_snapshots set bp_status = 'controlled', controlled = true where patient_id = %L and day = 90$q$, b1)));
  perform pg_temp.ck('one event per snapshot', 'true',
    ((select count(*) from public.domain_events where event_type = 'outcome.snapshot_computed' and patient_id = a1) = (select count(*) from public.outcome_snapshots where patient_id = a1))::text);
  perform pg_temp.ck('an event holds ids and the day only (INV-07)', 'true',
    (select (payload ?& array['snapshot_id', 'day']) and not (payload ?| array['bp_avg_7d_sys', 'bp_status', 'controlled', 'systolic']) and (select count(*) from jsonb_object_keys(payload)) = 2 from public.domain_events where event_type = 'outcome.snapshot_computed' and patient_id = a1 limit 1)::text);
end $$;

-- 2. Who can see what ---------------------------------------------------------------------------------------------------
do $$
declare a1 uuid := (select id from public.profiles where full_name = 'S38 A1'); a2 uuid := (select id from public.profiles where full_name = 'S38 A2');
begin
  perform pg_temp.ck('a person reads their own snapshots', 'true', (pg_temp.q_as(a1, 'select count(*)::text from public.outcome_snapshots')::int >= 2)::text);
  perform pg_temp.ck('and nobody else''s', '0', pg_temp.q_as(a2, format('select count(*)::text from public.outcome_snapshots where patient_id = %L', a1)));
  perform pg_temp.ck('an admin account sees no rows (aggregates only, no new staff read of a chart)', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.outcome_snapshots'));
  perform pg_temp.ck('a person cannot write a snapshot', 'true', (pg_temp.q_as(a1, $q$insert into public.outcome_snapshots (organisation_id, patient_id, day, anchor_date, window_start, window_end, bp_status, target_sys, target_dia, target_source, config_version) values (gen_random_uuid(), gen_random_uuid(), 7, current_date, current_date, current_date, 'insufficient_data', 140, 90, 'default', 1)$q$) like '%permission denied%')::text);
  perform pg_temp.ck('anon reads nothing', '42501', pg_temp.try_anon('select count(*) from public.outcome_snapshots'));
  perform pg_temp.ck('a user cannot read the analytics views', 'true', (pg_temp.q_as(a1, 'select count(*)::text from analytics.v_outcome_snapshots') like 'ERR:%')::text);
  perform pg_temp.ck('a user cannot read the pseudonym table', 'true', (pg_temp.q_as(a1, 'select count(*)::text from analytics.subjects') like 'ERR:%')::text);
  perform pg_temp.ck('a user cannot run the snapshot job', 'true', (pg_temp.q_as(a1, 'select private.compute_outcome_snapshots()::text') like 'ERR:%')::text);
end $$;

-- 3. SAFETY CASE 22: test accounts and the de-identified layer -----------------------------------------------------------
do $$
declare t1 uuid := pg_temp.f('test1');
begin
  perform pg_temp.ck('the test account has snapshots in the table (the job computes them, flagged)', 'true',
    ((select count(*) from public.outcome_snapshots where patient_id = t1 and is_test) >= 2)::text);
  perform pg_temp.ck('SAFETY CASE 22: the test account is not in the analytics rows', '0',
    (select count(*)::text from analytics.v_outcome_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id = t1));
  perform pg_temp.ck('SAFETY CASE 22: the test account has no pseudonym row used by any view row', '0',
    (select count(*)::text from public.outcome_snapshots o where o.is_test and exists (select 1 from analytics.subjects s join analytics.v_outcome_snapshots v on v.subject_key = s.subject_key where s.patient_id = o.patient_id)));
  perform pg_temp.ck('the view has no patient id column', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'analytics' and table_name = 'v_outcome_snapshots' and column_name in ('patient_id', 'id', 'anchor_date', 'window_start')));
  perform pg_temp.ck('only a month is shown, not a join date', 'true', (select coalesce(bool_and(enrolment_month = date_trunc('month', enrolment_month)::date), true)::text from analytics.v_outcome_snapshots));
end $$;

-- 4. The report ---------------------------------------------------------------------------------------------------------
do $$
declare
  v_admin uuid := pg_temp.f('admin'); a date := current_date - 100; a2 date := current_date - 131; a3 date := current_date - 162; a4 date := current_date - 195; r jsonb;
begin
  perform pg_temp.ck('a person cannot run the report', 'true', (pg_temp.q_as(pg_temp.f('plain'), 'select public.bp_control_report()::text') like '%outcomes_not_authorised%')::text);
  perform pg_temp.ck('anon cannot run the report', '42501', pg_temp.try_anon('select public.bp_control_report()'));
  perform pg_temp.act(v_admin);
  r := public.bp_control_report(a, a);
  perform pg_temp.back();
  perform pg_temp.ck('everyone due is in the denominator: 36 plus the two extra people, never the test account', '38',
    r #>> '{cohort_all_due,n}');
  perform pg_temp.ck('controlled, uncontrolled and no-reading are counted apart (the 2 readings and the stricter target fall where they belong)', '12/13/13',
    (r #>> '{cohort_all_due,controlled}') || '/' || (r #>> '{cohort_all_due,uncontrolled}') || '/' || (r #>> '{cohort_all_due,insufficient_data}'));
  perform pg_temp.ck('the strict rate counts drop-outs as not controlled', '31.6', r #>> '{cohort_all_due,rate_strict_pct}');
  perform pg_temp.ck('the rate among those measured is shown separately', '48.0', r #>> '{cohort_all_due,rate_among_measured_pct}');
  perform pg_temp.ck('and the missing share sits beside both', '34.2', r #>> '{cohort_all_due,missing_pct}');
  perform pg_temp.ck('adherence is kept apart from BP and withheld when under the minimum', 'true', (r #>> '{adherence_separate,suppressed}'));
  perform pg_temp.ck('the report says what it is not', 'true', (r ->> 'not_a_causal_claim'));
  perform pg_temp.ck('the definition and limitations are printed with it', 'true', ((r ->> 'definition') like '%under their own target%' and (r ->> 'limitations') like '%small numbers are withheld%')::text);
  perform pg_temp.ck('data quality: the default target share and the missing baseline are reported', 'true',
    ((r #>> '{data_quality,default_target_used_pct}')::numeric > 90 and (r #>> '{data_quality,baseline_missing_pct}') = '0.0')::text);
  perform pg_temp.ck('the report names the config version it used', '1', r ->> 'config_version');
  perform pg_temp.ck('the access is written to the audit log', '1', (select count(*)::text from public.audit_log where action = 'outcomes.bp_control_report' and actor_id = v_admin));

  r := private.bp_control_aggregate(a2, a2);
  perform pg_temp.ck('a cohort with one small category (3 controlled) is withheld, counts and rates', 'true/small_cell',
    (r #>> '{cohort_all_due,suppressed}') || '/' || (r #>> '{cohort_all_due,reason}'));
  perform pg_temp.ck('and its rates are not leaked in any field', 'true',
    ((r -> 'cohort_all_due') ? 'rate_strict_pct' is false and (r -> 'cohort_all_due') ? 'controlled' is false)::text);
  r := private.bp_control_aggregate(a3, a3);
  perform pg_temp.ck('a cohort under the minimum shows only that it is under the minimum', 'true/under_minimum',
    (r #>> '{cohort_all_due,suppressed}') || '/' || (r #>> '{cohort_all_due,reason}'));
  r := private.bp_control_aggregate(a2, a2);
  perform pg_temp.ck('a month holding a small category is left out of the by-month list and counted as withheld', 'true',
    ((r ->> 'months_withheld')::int = 1 and jsonb_array_length(r -> 'by_enrolment_month') = 0)::text);
  r := private.bp_control_aggregate(a, a);
  perform pg_temp.ck('a safe month is listed, with its own suppression flag off', 'true/false',
    (jsonb_array_length(r -> 'by_enrolment_month') = 1)::text || '/' || (r #>> '{by_enrolment_month,0,suppressed}'));
end $$;

do $$
declare a date := current_date - 100; a2 date := current_date - 131; a3 date := current_date - 162; a4 date := current_date - 195; r jsonb; r2 jsonb;
begin
  r := private.bp_control_aggregate(a, a); r2 := private.bp_control_aggregate(date_trunc('month', a)::date, (date_trunc('month', a) + interval '1 month' - interval '1 day')::date);
  perform pg_temp.ck('a range inside one month is the whole month: two ranges one day apart cannot be subtracted', 'true', ((r #>> '{cohort_all_due,n}') = (r2 #>> '{cohort_all_due,n}'))::text);
  perform pg_temp.ck('the report names the month-aligned range it used', 'true', ((r #>> '{range,from}')::date = date_trunc('month', a)::date)::text);
  r := private.bp_control_aggregate(a3, a);
  perform pg_temp.ck('when any month is withheld the by-month list is not returned at all (it would equal overall minus the listed months)', 'true',
    ((r ->> 'months_withheld')::int = 2 and jsonb_array_length(r -> 'by_enrolment_month') = 0 and (r #>> '{cohort_all_due,suppressed}') = 'false')::text);
  r := private.bp_control_aggregate(a4, a4);
  perform pg_temp.ck('the baseline cohort is withheld when the people left over are too few to show (24 due, 20 baseline, remainder 4)', 'true/24',
    (r #>> '{cohort_baseline_uncontrolled,suppressed}') || '/' || (r #>> '{cohort_all_due,n}'));
end $$;

-- 5. Change among those measured and the baseline cohort --------------------------------------------------------------------
do $$
declare r jsonb := private.bp_control_aggregate(current_date - 100, current_date - 100);
begin
  perform pg_temp.ck('the baseline-uncontrolled cohort is everyone who started above target', '38', r #>> '{cohort_baseline_uncontrolled,n}');
  perform pg_temp.ck('mean change among people measured at both ends is shown with its n', 'true',
    ((r #>> '{change_among_measured,n}')::int = 25 and (r #>> '{change_among_measured,mean_systolic_change}')::numeric < 0)::text);
end $$;

-- 5b. Failures are not silent, adherence faults are recorded, and a later test flag reaches old snapshots ----------------------------------
do $$
declare v_org uuid := pg_temp.f('org'); p1 uuid; p2 uuid; n integer; a1 uuid := (select id from public.profiles where full_name = 'S38 A1'); before_n integer; after_n integer; a date := current_date - 100;
begin
  perform pg_temp.ck('a person with no medicines has adherence recorded as no_doses (or unavailable when no medicine_config is active)', 'true',
    (pg_temp.snap(a1, 90, 'adherence_status') = case when exists (select 1 from public.medicine_config where is_active) then 'no_doses' else 'unavailable' end)::text);
  p1 := pg_temp.mkpat(v_org, 'FAIL1', false, 40, 3, 150, 95, 0, 0, 0);
  p2 := pg_temp.mkpat(v_org, 'ADH1', false, 41, 3, 150, 95, 0, 0, 0);
  -- an adherence fault is recorded as unavailable, not stored as the same null as having no doses
  update public.medicine_config set is_active = false;
  alter table public.outcome_snapshots add constraint s38_force_failure check (day <> 30) not valid;
  n := private.compute_outcome_snapshots();
  perform pg_temp.ck('a snapshot that fails is counted out of the result, not hidden', 'true', (pg_temp.snap(p1, 30, 'id') is null)::text);
  perform pg_temp.ck('a failing run opens one incident a person will see', '1', (select count(*)::text from public.ops_incidents where external_reference = 'outcome-snapshots-failing' and status not in ('resolved', 'closed')));
  perform pg_temp.ck('a failed adherence read is recorded as unavailable', 'unavailable', pg_temp.snap(p2, 0, 'adherence_status'));
  alter table public.outcome_snapshots drop constraint s38_force_failure;
  update public.medicine_config set is_active = true where version = (select max(version) from public.medicine_config);
  n := private.compute_outcome_snapshots();
  perform pg_temp.ck('the next run picks the failed day up (it was never recorded as done)', 'true', (pg_temp.snap(p1, 30, 'id') is not null)::text);
  -- a person flagged as a test account AFTER their snapshots were taken leaves every report and view
  select (private.bp_control_aggregate(a, a) #>> '{cohort_all_due,n}')::int into before_n;
  update public.profiles set is_test = true where id = a1;
  select (private.bp_control_aggregate(a, a) #>> '{cohort_all_due,n}')::int into after_n;
  perform pg_temp.ck('INV-13: a person flagged test later drops out of the report', 'true', (after_n = before_n - 1)::text);
  perform pg_temp.ck('and out of the analytics rows', '0', (select count(*)::text from analytics.v_outcome_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id = a1));
end $$;

-- 6. SABOTAGE: the is_test filter removed from the view and the report; both checks must flip ---------------------------------
create or replace view analytics.v_outcome_snapshots as
  select sub.subject_key, s.organisation_id, s.pathway_code, s.day, date_trunc('month', s.anchor_date)::date as enrolment_month,
         s.bp_avg_7d_sys, s.bp_avg_7d_dia, s.bp_readings_7d, s.bp_status, s.target_source, s.adherence_pct, s.adherence_doses_due, s.config_version, s.computed_at::date as computed_on
    from public.outcome_snapshots s join analytics.subjects sub on sub.patient_id = s.patient_id;

create or replace view private.v_bp_cohort_90d as
  select s90.patient_id, s90.anchor_date as anchor, s90.bp_status as s90, s0.bp_status as s0,
         case when s90.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s90.bp_avg_7d_sys - s0.bp_avg_7d_sys end as d_sys,
         case when s90.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s90.bp_avg_7d_dia - s0.bp_avg_7d_dia end as d_dia,
         s90.adherence_pct::integer as adh, s90.adherence_status = 'unavailable' as adh_unavailable, s90.target_source = 'default' as defaulted, false as late
    from public.outcome_snapshots s90 left join public.outcome_snapshots s0 on s0.patient_id = s90.patient_id and s0.pathway_code = s90.pathway_code and s0.day = 0
   where s90.pathway_code = 'bp' and s90.day = 90;

do $$
declare t1 uuid := (select id from public.profiles where full_name = 'S38 T1'); n integer; m integer;
begin
  select count(*) into n from analytics.v_outcome_snapshots v join analytics.subjects s on s.subject_key = v.subject_key where s.patient_id = t1;
  insert into results values ('sabotaged', 'SAFETY CASE 22: the test account is not in the analytics rows', '0', n::text);
  select (private.bp_control_aggregate(current_date - 100, current_date - 100) #>> '{cohort_all_due,n}')::int into m;
  insert into results values ('sabotaged', 'SAFETY CASE 22: the report counts no test account (37 real people after A1 was flagged)', '37', m::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S38 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

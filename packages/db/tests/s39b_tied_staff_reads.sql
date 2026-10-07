-- S39b proof: staff read patient records only through a care relationship (INV-12), both tiers (OQ-260).
-- Migration *_s39b_tied_staff_reads.sql. One rolled-back transaction against real data: a real patient with the most records is the subject.
-- Proves, for EVERY table the scope registry marks as tied (125 of them):
--   A. an untied clinician in the patient's own organisation reads nothing about any other person;
--   B. a clinician tied through the care team reads exactly the patient's rows (the same count the table owner sees) and nobody else's;
--   C. a care coordinator, even tied, reads none of the clinical tables, but still reads the logistics tables organisation-wide;
--   D. an admin reads none of them without a support view, and does with one;
--   E. a break-glass grant opens everything except the reproductive tables;
--   F. the switch tied_staff_reads off gives back the old organisation-wide read;
--   G. every patient table that still has the plain staff arm is registered (a new table cannot slip past), a tied table has no plain arm left,
--      and deleting a scribe transcript needs a tie.
-- SABOTAGE: the switch off, and one table's old policy put back; check A must flip both times.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's39b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S39b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- how many rows of public.<table> where <expr> is/ is not the subject can this user see (limited to 1 row for the "none" checks)
create function pg_temp.count_as(p_uid uuid, p_table text, p_expr text, p_op text, p_subject uuid, p_limit integer) returns text language plpgsql as
$f$ declare r bigint;
begin
  if p_uid is not null then
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', p_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
  end if;
  begin
    set local statement_timeout = '30s';
    execute format('select count(*) from (select 1 from public.%I where %s is not null and %s %s %L::uuid %s) x', p_table, p_expr, p_expr, p_op, p_subject, case when p_limit > 0 then 'limit ' || p_limit else '' end) into r;
  exception when insufficient_privilege then r := 0; when others then r := -1;
  end;
  if p_uid is not null then
    reset role;
    perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  end if;
  return r::text;
end $f$;

-- for every tied table: the offenders where this user can see rows about someone OTHER than the subject (and, if p_own, the tables where the
-- subject's rows differ from what the owner sees)
create function pg_temp.others(p_uid uuid, p_subject uuid) returns text language plpgsql as
$f$ declare s record; out_ text := ''; r text;
begin
  for s in select table_name, patient_expr from public.staff_read_scope where mode = 'tied' order by table_name loop
    r := pg_temp.count_as(p_uid, s.table_name, s.patient_expr, 'is distinct from', p_subject, 1);
    if r <> '0' then out_ := out_ || s.table_name || '=' || r || '; '; end if;
  end loop;
  return out_;
end $f$;
create function pg_temp.own_gap(p_uid uuid, p_subject uuid, p_skip_repro boolean) returns text language plpgsql as
$f$ declare s record; out_ text := ''; a text; b text;
begin
  for s in select table_name, patient_expr from public.staff_read_scope where mode = 'tied' and (not p_skip_repro or category <> 'reproductive_health') order by table_name loop
    a := pg_temp.count_as(null, s.table_name, s.patient_expr, '=', p_subject, 0);
    b := pg_temp.count_as(p_uid, s.table_name, s.patient_expr, '=', p_subject, 0);
    if a <> b then out_ := out_ || s.table_name || '(owner ' || a || ' saw ' || b || '); '; end if;
  end loop;
  return out_;
end $f$;
create function pg_temp.sees_any(p_uid uuid, p_subject uuid, p_repro boolean) returns text language plpgsql as
$f$ declare s record; n integer := 0;
begin
  for s in select table_name, patient_expr from public.staff_read_scope where mode = 'tied' and ((category = 'reproductive_health') = p_repro) loop
    if pg_temp.count_as(p_uid, s.table_name, s.patient_expr, '=', p_subject, 1) = '1' then n := n + 1; end if;
  end loop;
  return n::text;
end $f$;

-- Fixtures: the real patient with the most records; staff in that patient's organisation ---------------------------------------------------
do $$
declare v_pat uuid; v_org uuid; v_c1 uuid; v_c2 uuid; v_co uuid; v_ad uuid;
begin
  -- the real patient whose records are spread across the most tied tables (best chance of a meaningful comparison)
  select c.patient_id into v_pat from (select patient_id from public.patient_timeline group by patient_id order by count(*) desc limit 25) c
   order by (select count(*) from public.staff_read_scope s where s.mode = 'tied' and pg_temp.count_as(null, s.table_name, s.patient_expr, '=', c.patient_id, 1) = '1') desc limit 1;
  -- On live data the subject has records in many tables. On an empty replay (CI) there is no such patient, so a fixture patient with a few
  -- easy-to-insert sensitive rows stands in (HIV and hepatitis status, cardiovascular and diabetes profiles, social history, two reproductive tables).
  if v_pat is null or (select count(*) from public.staff_read_scope s where s.mode = 'tied' and pg_temp.count_as(null, s.table_name, s.patient_expr, '=', v_pat, 1) = '1') < 10 then
    select id into v_org from public.organisations order by created_at limit 1;
    v_pat := pg_temp.mkuser(v_org, 'fixture patient', 'patient');
    perform pg_temp.setf('fixture', v_pat);
    declare t text;
    begin
      foreach t in array array['patient_serology_status', 'patient_cardiovascular_profile', 'patient_diabetes_profile', 'social_history', 'reproductive_health_profiles', 'patient_pregnancy'] loop
        begin execute format('insert into public.%I (organisation_id, patient_id) values (%L, %L)', t, v_org, v_pat);
        exception when others then raise notice 'fixture row for % skipped: %', t, sqlerrm; end;
      end loop;
    end;
  end if;
  select organisation_id into v_org from public.profiles where id = v_pat;
  v_c1 := pg_temp.mkuser(v_org, 'untied clinician', 'clinician');
  v_c2 := pg_temp.mkuser(v_org, 'tied clinician', 'clinician');
  v_co := pg_temp.mkuser(v_org, 'coordinator', 'care_coordinator');
  v_ad := pg_temp.mkuser(v_org, 'admin', 'admin');
  -- one care-team row per patient (unique): point it at the tied clinician and the tied coordinator
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_pat, v_c2, v_co, now())
  on conflict (patient_id) do update set clinician_id = excluded.clinician_id, care_coordinator_id = excluded.care_coordinator_id, clinical_director_id = null;
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('org', v_org); perform pg_temp.setf('c1', v_c1); perform pg_temp.setf('c2', v_c2);
  perform pg_temp.setf('co', v_co); perform pg_temp.setf('ad', v_ad);
end $$;

-- A to F --------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'A an untied clinician reads nothing about anyone in any of the tied tables', '', pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')));
select pg_temp.ck('real', 'A2 ...and not the subject either', '0', pg_temp.sees_any(pg_temp.f('c1'), pg_temp.f('pat'), false));
select pg_temp.ck('real', 'B1 a clinician tied through the care team reads exactly the subject''s rows in every tied table', '', pg_temp.own_gap(pg_temp.f('c2'), pg_temp.f('pat'), false));
select pg_temp.ck('real', 'B2 ...and nothing about anyone else', '', pg_temp.others(pg_temp.f('c2'), pg_temp.f('pat')));
select pg_temp.ck('real', 'B3 not vacuous: the tied clinician sees the subject''s rows in several tied tables', 'true',
  (pg_temp.sees_any(pg_temp.f('c2'), pg_temp.f('pat'), false)::integer >= case when exists (select 1 from fx where k = 'fixture') then 3 else 10 end)::text);
select pg_temp.ck('real', 'C1 a tied care coordinator reads none of the clinical tables', '0', (pg_temp.sees_any(pg_temp.f('co'), pg_temp.f('pat'), false)::integer + pg_temp.sees_any(pg_temp.f('co'), pg_temp.f('pat'), true)::integer)::text);
select pg_temp.ck('real', 'C2 ...but still reads the logistics tables (appointments) as before', 'true',
  (pg_temp.count_as(pg_temp.f('co'), 'appointments', 'patient_id', 'is not distinct from', pg_temp.f('pat'), 0) = pg_temp.count_as(null, 'appointments', 'patient_id', 'is not distinct from', pg_temp.f('pat'), 0))::text);
select pg_temp.ck('real', 'D1 an admin without a support view reads none of the tied tables', '', pg_temp.others(pg_temp.f('ad'), pg_temp.f('pat')));
-- the session trigger checks the signed-in user's permission, so the insert is made with the admin's identity (still as the table owner)
select set_config('request.jwt.claim.sub', pg_temp.f('ad')::text, true), set_config('request.jwt.claims', json_build_object('sub', pg_temp.f('ad'), 'role', 'authenticated')::text, true);
insert into public.support_view_sessions (viewer_id, subject_id, subject_role, organisation_id, reason, expires_at)
  values (pg_temp.f('ad'), pg_temp.f('pat'), 'patient', pg_temp.f('org'), 'S39b proof', now() + interval '1 hour');
select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true);
select pg_temp.ck('real', 'D2 an admin with the subject''s support view reads exactly the subject''s rows', '', pg_temp.own_gap(pg_temp.f('ad'), pg_temp.f('pat'), false));
delete from public.support_view_sessions where reason = 'S39b proof';
insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (pg_temp.f('c1'), pg_temp.f('org'), pg_temp.f('pat'), pg_temp.f('org'), 'S39b proof', now() + interval '8 hours');
select pg_temp.ck('real', 'E1 with a break-glass grant the clinician reads the subject''s non-reproductive rows', '', pg_temp.own_gap(pg_temp.f('c1'), pg_temp.f('pat'), true));
select pg_temp.ck('real', 'E2 ...but not one reproductive row (break-glass never opens them)', '0', pg_temp.sees_any(pg_temp.f('c1'), pg_temp.f('pat'), true));
delete from public.emergency_record_access_grants where reason = 'S39b proof';
select pg_temp.ck('real', 'E3 with the grant ended the clinician is shut out again', '', pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')));

-- G ---------------------------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'G1 every patient table that has a staff read policy is in the scope registry', '', (
  select coalesce(string_agg(distinct p.tablename, ', '), '') from pg_policies p
   where p.schemaname = 'public' and p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, '') like '%private.is_org_staff(organisation_id)%'
     and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = p.tablename and c.column_name = 'patient_id')
     and p.tablename not in (select table_name from public.staff_read_scope)));
select pg_temp.ck('real', 'G2 a tied table has no plain organisation-wide staff read left', '', (
  select coalesce(string_agg(p.tablename || '.' || p.policyname, ', '), '') from pg_policies p join public.staff_read_scope s on s.table_name = p.tablename and s.mode = 'tied'
   where p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, '') like '%private.is_org_staff(organisation_id)%'));
select pg_temp.ck('real', 'G3 deleting a scribe transcript needs a tie, not just staff of the organisation', '0', (select count(*)::text from pg_policies where tablename = 'scribe_transcripts' and cmd in ('DELETE', 'ALL') and coalesce(qual, '') like '%is_org_staff(organisation_id)%'));
select pg_temp.ck('real', 'G4 every organisation-wide table is registered with a reason', '0', (select count(*)::text from public.staff_read_scope where mode = 'org' and coalesce(btrim(reason), '') = ''));
select pg_temp.ck('real', 'G5 anon and a patient cannot read the registry or the backup', 'false|false', (has_table_privilege('anon', 'public.staff_read_scope', 'SELECT') or has_table_privilege('authenticated', 'public.staff_read_scope', 'SELECT'))::text || '|' || (has_table_privilege('authenticated', 'public.staff_read_policy_backup', 'SELECT'))::text);

-- F: the switch ---------------------------------------------------------------------------------------------------------------------------------
update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F1 with the switch off an untied clinician reads patient rows again (the old behaviour)', 'true', (pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')) <> '')::text);
update public.platform_modules set is_enabled = true where key = 'tied_staff_reads';
select pg_temp.ck('real', 'F2 and switching it back on closes them', '', pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')));

-- Sabotage --------------------------------------------------------------------------------------------------------------------------------------
do $$ begin
  update public.platform_modules set is_enabled = false where key = 'tied_staff_reads';
  insert into results values ('sabotaged', 'SABOTAGE switch off: the untied clinician is shut out', '', pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')));
  update public.platform_modules set is_enabled = true where key = 'tied_staff_reads';
end $$;
do $$
declare b record;
begin
  -- one table's original policy put back from the backup
  select * into b from public.staff_read_policy_backup where cmd = 'SELECT' and table_name = 'patient_serology_status' limit 1;
  execute format('drop policy %I on public.%I', b.policy_name, b.table_name);
  execute format('create policy %I on public.%I for select to %s using (%s)', b.policy_name, b.table_name, b.roles, b.qual);
  insert into results values ('sabotaged', 'SABOTAGE old policy restored on patient_serology_status: the untied clinician is shut out', '', pg_temp.others(pg_temp.f('c1'), pg_temp.f('pat')));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S39b proof FAILED: %', (select string_agg(check_name || ' => expected [' || expected || '] got [' || left(coalesce(actual, 'null'), 600) || ']', E'\n   ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, case when expected = actual then 'PASS' else 'FAIL' end as result, left(actual, 160) as detail from results order by phase desc, check_name;

rollback;

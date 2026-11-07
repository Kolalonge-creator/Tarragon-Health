-- P14 proof: risk_assessment_drafts (save and resume for the patient health assessment) is owner-only.
--  * a patient saves, reads, replaces and deletes their own draft
--  * another patient cannot read, change or delete it, and cannot save a draft under the patient's id
--  * a supporter with a 'manage' grant (acting for the patient) cannot read the patient's draft or save one under the patient's id
--  * an organisation admin (org staff) reads none; anon is refused
--  * a draft must carry the caller's own organisation; step is 1..5; answers must be an object
-- SABOTAGE: SELECT policy opened to organisation staff, INSERT policy opened to any patient_id; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text; n bigint;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; get diagnostics n = row_count; r := 'ok:' || n; exception when others then r := 'ERR'; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR'; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p14-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P14 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare v_org uuid; v_other_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  select id into v_other_org from public.organisations where id <> v_org order by created_at limit 1;
  if v_other_org is null then
    v_other_org := gen_random_uuid();
    insert into public.organisations (id, name, type) values (v_other_org, 'P14 other org', 'clinic');
  end if;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('other_org', v_other_org);
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2', 'patient'));
  perform pg_temp.setf('supporter', pg_temp.mkuser(v_org, 'supporter', 'patient'));
  perform pg_temp.setf('admin', pg_temp.mkuser(v_org, 'admin', 'admin'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (pg_temp.f('pat'), pg_temp.f('supporter'), 'manage', pg_temp.f('pat'));
end $$;

create function pg_temp.ins_sql(p_for uuid, p_org uuid, p_step int default 2, p_answers text default '{"smoking_status":"never"}') returns text
language sql as $$
  select format('insert into public.risk_assessment_drafts (patient_id, organisation_id, answers, step) values (%L, %L, %L::jsonb, %s)',
                p_for, p_org, p_answers, p_step)
$$;
create function pg_temp.count_for(p_uid uuid, p_owner uuid) returns text language sql as $$
  select pg_temp.q_as(p_uid, format('select count(*)::text from public.risk_assessment_drafts where patient_id = %L', p_owner))
$$;

create function pg_temp.checks(p_phase text) returns void language plpgsql as $f$
declare v_pat uuid := pg_temp.f('pat'); v_org uuid := pg_temp.f('org');
begin
  delete from public.risk_assessment_drafts where patient_id in (pg_temp.f('pat'), pg_temp.f('pat2'), pg_temp.f('supporter'));
  insert into results values (p_phase, 'patient saves own draft', 'ok:1', pg_temp.try_as(v_pat, pg_temp.ins_sql(v_pat, v_org)));
  insert into results values (p_phase, 'patient reads own draft', '1', pg_temp.count_for(v_pat, v_pat));
  insert into results values (p_phase, 'patient replaces own draft', 'ok:1',
    pg_temp.try_as(v_pat, format('update public.risk_assessment_drafts set step = 3 where patient_id = %L', v_pat)));
  insert into results values (p_phase, 'other patient reads none', '0', pg_temp.count_for(pg_temp.f('pat2'), v_pat));
  insert into results values (p_phase, 'other patient changes nothing', 'ok:0',
    pg_temp.try_as(pg_temp.f('pat2'), format('update public.risk_assessment_drafts set step = 4 where patient_id = %L', v_pat)));
  insert into results values (p_phase, 'other patient deletes nothing', 'ok:0',
    pg_temp.try_as(pg_temp.f('pat2'), format('delete from public.risk_assessment_drafts where patient_id = %L', v_pat)));
  insert into results values (p_phase, 'supporter acting for the patient reads none', '0', pg_temp.count_for(pg_temp.f('supporter'), v_pat));
  -- the patient has no draft for the two attempts below, so a refusal cannot be a primary-key clash
  delete from public.risk_assessment_drafts where patient_id = v_pat;
  insert into results values (p_phase, 'other patient cannot save under the patient id', 'ERR',
    pg_temp.try_as(pg_temp.f('pat2'), pg_temp.ins_sql(v_pat, v_org)));
  delete from public.risk_assessment_drafts where patient_id = v_pat;
  insert into results values (p_phase, 'supporter cannot save under the patient id', 'ERR',
    pg_temp.try_as(pg_temp.f('supporter'), pg_temp.ins_sql(v_pat, v_org)));
  insert into results values (p_phase, 'patient saves again after supporter attempt', 'ok:1', pg_temp.try_as(v_pat, pg_temp.ins_sql(v_pat, v_org)));
  insert into results values (p_phase, 'org admin reads none', '0', pg_temp.count_for(pg_temp.f('admin'), v_pat));
  insert into results values (p_phase, 'a foreign organisation is refused', 'ERR',
    pg_temp.try_as(pg_temp.f('pat2'), pg_temp.ins_sql(pg_temp.f('pat2'), pg_temp.f('other_org'))));
  insert into results values (p_phase, 'step 6 is refused', 'ERR',
    pg_temp.try_as(pg_temp.f('pat2'), pg_temp.ins_sql(pg_temp.f('pat2'), v_org, 6)));
  insert into results values (p_phase, 'answers must be an object', 'ERR',
    pg_temp.try_as(pg_temp.f('pat2'), pg_temp.ins_sql(pg_temp.f('pat2'), v_org, 2, '[1,2]')));
  insert into results values (p_phase, 'patient deletes own draft', 'ok:1',
    pg_temp.try_as(v_pat, format('delete from public.risk_assessment_drafts where patient_id = %L', v_pat)));
end $f$;

select pg_temp.checks('real');

do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin
    perform 1 from public.risk_assessment_drafts limit 1;
    insert into results values ('real', 'anon is refused', 'denied', 'allowed');
  exception when insufficient_privilege then
    insert into results values ('real', 'anon is refused', 'denied', 'denied');
  end;
  reset role;
end $$;

-- SABOTAGE: widen the read to org staff and the insert to any patient_id. Rolled back with everything else.
drop policy risk_assessment_drafts_select on public.risk_assessment_drafts;
create policy risk_assessment_drafts_select on public.risk_assessment_drafts for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));
drop policy risk_assessment_drafts_insert on public.risk_assessment_drafts;
create policy risk_assessment_drafts_insert on public.risk_assessment_drafts for insert to authenticated
  with check (organisation_id = private.current_org_id());
select pg_temp.checks('sabotaged');

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'risk_assessment_drafts proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % checks (need at least 2)', v_caught; end if;
end $$;

-- Real checks: PASS when the migration behaves. Sabotage: each check is reported as a control that PASSES when the
-- sabotage FLIPPED it (or when that check is not expected to depend on the sabotaged object); the block above already raised if
-- too few flipped. A healthy run therefore prints no FAIL verdict at all (scripts/run-db-proofs.sh fails on any).
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real'
union all
select 'sabotage control', check_name, expected, actual,
       case when expected is distinct from actual then 'PASS (flipped)' else 'PASS (unaffected)' end
from results where phase = 'sabotaged'
union all
select 'sabotage control', 'sabotage flipped at least one check', '>= 1',
       (select count(*)::text from results where phase = 'sabotaged' and expected is distinct from actual),
       case when (select count(*) from results where phase = 'sabotaged' and expected is distinct from actual) >= 1 then 'PASS' else 'FAIL' end
order by 1, 2;

rollback;

-- P16 proof (CMO decision from chat, 2026-11-07): a patient's "Not sure" answer raises a routine medication_dispense_flags row
-- (flag_type 'patient_query'), at most one per patient per Lagos day.
--  * the patient raises one; a second the same day is refused by medication_dispense_flags_not_sure_one_per_day
--  * a free-text patient concern ('patient_query' without the prefix) the same day is not limited
--  * another patient raises their own the same day
--  * yesterday's (Lagos) row does not block today's
--  * a supporter with a 'manage' grant cannot raise one for the patient (existing insert policy), and can only write on their own record
--  * the row is raised_by the patient, status open (what the worklist reads)
-- SABOTAGE: the unique index dropped; the second same-day row must then go in.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql; r := 'ok'; exception when unique_violation then r := 'duplicate'; when others then r := 'ERR'; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p16-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'P16 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat'));
  perform pg_temp.setf('pat2', pg_temp.mkuser(v_org, 'pat2'));
  perform pg_temp.setf('supporter', pg_temp.mkuser(v_org, 'supporter'));
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (pg_temp.f('pat'), pg_temp.f('supporter'), 'manage', pg_temp.f('pat'));
end $$;

create function pg_temp.flag_sql(p_for uuid, p_note text) returns text language sql as $$
  select format('insert into public.medication_dispense_flags (organisation_id, patient_id, flag_type, note) values (%L, %L, ''patient_query'', %L)',
                pg_temp.f('org'), p_for, p_note)
$$;

create function pg_temp.checks(p_phase text) returns void language plpgsql as $f$
declare v_pat uuid := pg_temp.f('pat'); v_ns text := 'Patient answered "Not sure" when asked to confirm their medication list.';
begin
  delete from public.medication_dispense_flags where patient_id in (pg_temp.f('pat'), pg_temp.f('pat2'), pg_temp.f('supporter'));
  -- a Lagos-yesterday row first: it must not block today's
  insert into public.medication_dispense_flags (organisation_id, patient_id, flag_type, note, created_at)
  values (pg_temp.f('org'), v_pat, 'patient_query', v_ns, now() - interval '1 day');
  insert into results values (p_phase, 'patient raises one today', 'ok', pg_temp.try_as(v_pat, pg_temp.flag_sql(v_pat, v_ns)));
  insert into results values (p_phase, 'a second the same day is refused', 'duplicate', pg_temp.try_as(v_pat, pg_temp.flag_sql(v_pat, v_ns || ' again')));
  insert into results values (p_phase, 'a free-text concern the same day is not limited', 'ok',
    pg_temp.try_as(v_pat, pg_temp.flag_sql(v_pat, 'The pharmacy gave me a different brand')));
  insert into results values (p_phase, 'another patient raises their own', 'ok', pg_temp.try_as(pg_temp.f('pat2'), pg_temp.flag_sql(pg_temp.f('pat2'), v_ns)));
  insert into results values (p_phase, 'supporter cannot raise one for the patient', 'ERR',
    pg_temp.try_as(pg_temp.f('supporter'), pg_temp.flag_sql(v_pat, v_ns || ' (supporter)')));
  insert into results values (p_phase, 'today''s row is the patient''s own and open', '1',
    (select count(*)::text from public.medication_dispense_flags
      where patient_id = v_pat and note like 'Patient answered "Not sure"%' and raised_by = v_pat and status = 'open'
        and (created_at at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date));
end $f$;

select pg_temp.checks('real');

drop index public.medication_dispense_flags_not_sure_one_per_day;
select pg_temp.checks('sabotaged');

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'p16 not-sure proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then raise exception 'VACUOUS TEST: dropping the index flipped no check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results order by phase, check_name;

rollback;

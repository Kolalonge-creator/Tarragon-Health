-- ===========================================================================
-- Proof (standing guard): no function in public or private works out a person's age, or "has turned 18", from the UTC date.
-- Covers migration *_remaining_age_rules_use_lagos_date.sql and, going forward, any LATER migration that recreates one of
-- these functions from older text: the replay in CI then fails here instead of the one-hour error coming back silently.
--
--   1. scan: no body matches age(current_date|now(), ...), current_date - interval '18 years', current_date -
--      make_interval(years ...) or current_date < h.birthday_18 (run on the migrated schema, so it covers every function);
--   2. behaviour with the clock fixed in-transaction (Lagos date = UTC date + 1, so the wall clock never matters):
--      patient_age_years is 30 for someone born D - 30 years and 29 the day before the birthday;
--   3. SABOTAGE: put current_date back in patient_age_years (the behaviour check must fail), and add a function with the
--      bad pattern (the scan must find it).
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

create function pg_temp.bad_functions() returns text language sql as $$
  select string_agg(n.nspname || '.' || p.proname, ', ' order by 1)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and (p.prosrc ~ 'age\(\s*(?:current_date|now\(\))\s*,'
          or p.prosrc ~ 'current_date\s*-\s*interval\s*''18 years'''
          or p.prosrc ~ 'current_date\s*-\s*make_interval\(\s*years'
          or p.prosrc ~ 'current_date\s*<\s*h\.birthday_18');
$$;

do $$
declare bad text := pg_temp.bad_functions();
begin
  if bad is not null then
    raise exception 'FAIL 1: functions that read an age from the UTC date (use private.lagos_today()): %', bad;
  end if;
end $$;

create temp table lagos_fixed_clock2 as select (current_date + 1) as d;
grant select on lagos_fixed_clock2 to public;
create or replace function private.lagos_today() returns date language sql stable set search_path = ''
  as $$ select d from pg_temp.lagos_fixed_clock2 $$;

create function pg_temp.age_checks(p_tag text) returns void language plpgsql as $$
declare
  d date := (select d from pg_temp.lagos_fixed_clock2);
  v_org uuid; u uuid := gen_random_uuid(); a int; b int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (u, p_tag || '-age@example.invalid', 'x', now(), now(), '{}', '{"full_name":"Age Probe"}');
  update public.profiles set organisation_id = v_org, date_of_birth = (d - interval '30 years')::date where id = u;
  a := private.patient_age_years(u);
  update public.profiles set date_of_birth = ((d - interval '30 years')::date + 1) where id = u;
  b := private.patient_age_years(u);
  if a is distinct from 30 then raise exception 'FAIL 2a [%]: 30th birthday today in Lagos gives age %', p_tag, a; end if;
  if b is distinct from 29 then raise exception 'FAIL 2b [%]: 30th birthday tomorrow in Lagos gives age %', p_tag, b; end if;
end $$;

select pg_temp.age_checks('p');

-- 3a. patient_age_years back on the UTC date: the behaviour check must fail
do $$
declare src text := pg_get_functiondef('private.patient_age_years(uuid)'::regprocedure); got text;
begin
  if src !~ 'lagos_today' then raise exception 'sabotage 3a: not using the helper'; end if;
  execute replace(src, 'private.lagos_today()', 'current_date');
  begin
    perform pg_temp.age_checks('s3a');
  exception when others then got := sqlerrm;
  end;
  if got is null or got not like 'FAIL 2a%' then
    raise exception 'SABOTAGE 3a: the behaviour check did not fail on the UTC date (got: %)', got;
  end if;
end $$;

-- 3b. a new function with the bad pattern: the scan must find it
create function public.zz_age_scan_probe(p date) returns int language sql stable as
  $$ select extract(year from age(current_date, p))::int $$;
do $$
begin
  if pg_temp.bad_functions() is null or pg_temp.bad_functions() not like '%zz_age_scan_probe%' then
    raise exception 'SABOTAGE 3b: the scan did not find a function that reads the UTC date';
  end if;
end $$;

rollback;

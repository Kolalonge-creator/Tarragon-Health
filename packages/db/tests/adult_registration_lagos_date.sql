-- Proof: the adult-only registration boundary is the 18th birthday in LAGOS time, not the server (UTC) date
-- (migration *_adult_registration_uses_lagos_date.sql).
--
--   1. The helper is exactly the Lagos date minus 18 years, and neither session role can call it.
--   2. Both registration gates (the profiles trigger and the sign-up handler) use the helper, not current_date.
--   3. A person who turns 18 TODAY in Lagos can sign up; someone one day younger is refused (sign-up handler).
--   4. The same boundary on the profiles trigger: a profile can be set to the cutoff date but not one day later; a minor_child dependant is still allowed.
--      Every case is stated relative to the Lagos cutoff, so the proof gives the same answer at any hour of the day (the old UTC check failed 23:00 to 24:00 UTC).
--   5. SABOTAGE: the helper moved one day earlier (the old behaviour for that hour); the "turns 18 today" checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return case when sqlerrm like 'adult_only_registration%' then 'adult_only' else sqlstate end; end $f$;

-- a sign-up through auth.users carrying a date of birth in its metadata (what the handler reads)
create function pg_temp.signup(p_dob date) returns text language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  return pg_temp.try(format($q$insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (%L, %L, 'x', now(), '{}', jsonb_build_object('date_of_birth', %L::text))$q$, v, 'adultlagos-' || v || '@example.invalid', p_dob));
end $f$;

-- 1. the helper ---------------------------------------------------------------------------------------------------------------
select pg_temp.rec('1 the helper is the Lagos date minus 18 years', 'true',
  (private.adult_cutoff_date() = ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date)::text);
select pg_temp.rec('1 no session role can call the helper', 'false,false',
  has_function_privilege('anon', 'private.adult_cutoff_date()', 'EXECUTE')::text || ',' || has_function_privilege('authenticated', 'private.adult_cutoff_date()', 'EXECUTE')::text);

-- 2. both gates use it ---------------------------------------------------------------------------------------------------------
select pg_temp.rec('2 the profiles trigger uses the helper and not current_date', 'true,false',
  (pg_get_functiondef('private.enforce_adult_registration()'::regprocedure) like '%adult_cutoff_date%')::text || ',' ||
  (pg_get_functiondef('private.enforce_adult_registration()'::regprocedure) like '%current_date%')::text);
select pg_temp.rec('2 the sign-up handler uses the helper and not current_date for the age check', 'true,false',
  (pg_get_functiondef('private.handle_new_user()'::regprocedure) like '%adult_cutoff_date%')::text || ',' ||
  (pg_get_functiondef('private.handle_new_user()'::regprocedure) like '%current_date - interval ''18 years''%')::text);

-- 3. sign-up handler boundary (relative to the Lagos cutoff, so hour-independent) -------------------------------------------------
select pg_temp.rec('3 a person who turns 18 today in Lagos can sign up', 'ok', pg_temp.signup(private.adult_cutoff_date()));
select pg_temp.rec('3 a person one day younger is refused', 'adult_only', pg_temp.signup(private.adult_cutoff_date() + 1));
select pg_temp.rec('3 a person well over 18 can sign up', 'ok', pg_temp.signup(private.adult_cutoff_date() - 400));
select pg_temp.rec('3 a person well under 18 is refused', 'adult_only', pg_temp.signup(private.adult_cutoff_date() + 2000));

-- 4. profiles trigger boundary -------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v uuid := gen_random_uuid(); v_ok text; v_no text; v_dep text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'adultlagos-p-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, v_org, 'patient', 'AdultLagos p', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set is_test = true;
  v_ok := pg_temp.try(format('update public.profiles set date_of_birth = %L where id = %L', private.adult_cutoff_date(), v));
  v_no := pg_temp.try(format('update public.profiles set date_of_birth = %L where id = %L', private.adult_cutoff_date() + 1, v));
  v_dep := pg_temp.try(format($q$update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child', date_of_birth = %L where id = %L$q$, private.adult_cutoff_date() + 1000, v));
  insert into results values ('real', '4 profiles trigger: the cutoff date itself is allowed', 'ok', v_ok),
                             ('real', '4 profiles trigger: one day later is refused', 'adult_only', v_no),
                             ('real', '4 profiles trigger: a minor_child dependant is still allowed', 'ok', v_dep);
end $$;

-- 5. SABOTAGE: the boundary moved one day earlier, as the UTC date is behind Lagos for one hour a day --------------------------------
create or replace function private.adult_cutoff_date() returns date language sql stable set search_path = ''
as $$ select (((now() at time zone 'Africa/Lagos')::date - 1) - interval '18 years')::date $$;
do $$
declare v uuid := gen_random_uuid(); r text;
begin
  r := pg_temp.try(format($q$insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
      values (%L, %L, 'x', now(), '{}', jsonb_build_object('date_of_birth', %L::text))$q$, v, 'adultlagos-s-' || v || '@example.invalid',
      ((now() at time zone 'Africa/Lagos')::date - interval '18 years')::date));
  insert into results values ('sabotaged', '3 a person who turns 18 today in Lagos can sign up', 'ok', r);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'Adult registration (Lagos date) proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 1 then
    raise exception 'VACUOUS TEST: with the boundary moved a day earlier, the "turns 18 today" sign-up was still accepted';
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
rollback;

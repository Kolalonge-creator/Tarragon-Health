-- ===========================================================================
-- Proof: the "is this person 18" rules use the Lagos date, not the UTC date
-- (migration *_adult_gate_uses_lagos_date.sql; bug seen 2026-10-20 between 23:00 and 24:00 UTC).
--
-- The real wall clock is never relied on. private.lagos_today() is replaced INSIDE this rolled-back transaction with a fixed
-- date D = current_date + 1, i.e. a moment when the Lagos date is one day ahead of the UTC date (the 23:00-24:00 UTC hour),
-- whatever time the proof really runs. Then:
--   1. exactly 18 today in Lagos (born D - 18 years) is accepted: by sign-up (handle_new_user), by the profiles gate, and is
--      NOT a minor dependant;
--   2. 18th birthday tomorrow in Lagos (born D - 18 years + 1 day) is refused by sign-up and the profiles gate, and a
--      minor_child with that date IS a minor dependant;
--   3. under-18 dependants are still refused as non-dependants and still count as minors; an adult stays accepted;
--   4. the real helper returns the Lagos date; no function still compares an 18 year age with current_date;
--      anon and authenticated cannot execute the helper;
--   5. SABOTAGE: put current_date back into each of the three gates (the bug), and flatten the helper to a wrong constant;
--      the case-1 and case-2 checks must each fail, proving they could have caught the bug.
-- ===========================================================================

begin;

-- 4 first, before the helper is overridden: the real helper is the Lagos date
do $$
begin
  if private.lagos_today() is distinct from (now() at time zone 'Africa/Lagos')::date then
    raise exception 'FAIL 4a: private.lagos_today() is not the Lagos date';
  end if;
  if has_function_privilege('anon', 'private.lagos_today()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.lagos_today()', 'EXECUTE') then
    raise exception 'FAIL 4b: the helper is executable by anon or authenticated';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosrc ~ 'current_date\s*-\s*interval\s*''18 years'''
  ) then
    raise exception 'FAIL 4c: a function still compares an 18 year age with current_date (the UTC date)';
  end if;
  if exists (
    select 1 from pg_proc p where p.oid in ('private.enforce_adult_registration()'::regprocedure,
                                           'private.handle_new_user()'::regprocedure,
                                           'private.is_minor_dependant(uuid)'::regprocedure)
       and p.prosrc !~ 'private\.lagos_today\(\)'
  ) then
    raise exception 'FAIL 4d: a gate function does not use private.lagos_today()';
  end if;
  if exists (select 1 from pg_proc p where p.oid in ('private.compute_dependent_transition_state(date)'::regprocedure,
                                                    'private.adolescent_age_band(uuid)'::regprocedure)
                and p.prosrc ~ 'age\(\s*current_date') then
    raise exception 'FAIL 4f: the 18 year age bands still use the UTC date';
  end if;
  if has_function_privilege('anon', 'private.enforce_adult_registration()', 'EXECUTE')
     or has_function_privilege('anon', 'private.is_minor_dependant(uuid)', 'EXECUTE') then
    raise exception 'FAIL 4e: anon can execute a gate function';
  end if;
end $$;

-- fix the clock: Lagos is one day ahead of the UTC date
create temp table lagos_fixed_clock as select (current_date + 1) as d;
grant select on lagos_fixed_clock to public;
create or replace function private.lagos_today() returns date language sql stable set search_path = ''
  as $$ select d from pg_temp.lagos_fixed_clock $$;

create function pg_temp.reg(p_dob date, p_email text) returns text language plpgsql as $$
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (gen_random_uuid(), p_email, 'x', now(), now(), '{}', jsonb_build_object('full_name', 'Gate Probe', 'date_of_birth', p_dob::text));
  return 'accepted';
exception when others then
  return sqlerrm;
end $$;

-- profile-level gate: set a date of birth on a fresh no-dob profile
create function pg_temp.set_dob(p_id uuid, p_dob date) returns text language plpgsql as $$
begin
  update public.profiles set date_of_birth = p_dob where id = p_id;
  return 'accepted';
exception when others then
  return sqlerrm;
end $$;

create function pg_temp.mkkid(p_dob date, p_guardian uuid, p_org uuid) returns uuid language plpgsql as $$
declare k uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (k, 'dependent+' || k || '@dependents.tarragonhealth.internal', null, now(), now(),
          jsonb_build_object('role', 'patient', 'organisation_id', p_org), '{"full_name":"Gate Kid"}');
  perform public.provision_dependent_profile_basics(k, p_dob, null, p_guardian, 'minor_child');
  return k;
end $$;

create temp table gate_fx (k text primary key, v text);
grant all on gate_fx to public;

-- the checks, in a function so the sabotage steps can run them again
create function pg_temp.run_checks(p_tag text) returns void language plpgsql as $$
declare
  d date := (select d from pg_temp.lagos_fixed_clock);
  v_org uuid; guardian uuid; adult uuid; kid18 uuid; kid_tomorrow uuid; kid6 uuid;
  m text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  guardian := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (guardian, p_tag || '-guardian@example.invalid', 'x', now(), now(), '{}', '{"full_name":"Gate Guardian"}');
  update public.profiles set date_of_birth = '1985-03-03', organisation_id = v_org where id = guardian;

  -- 1. exactly 18 today in Lagos: accepted everywhere
  m := pg_temp.reg((d - interval '18 years')::date, p_tag || '-eighteen@example.invalid');
  if m <> 'accepted' then raise exception 'FAIL 1a [%]: a person who turns 18 today in Lagos was refused at sign-up: %', p_tag, m; end if;

  adult := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (adult, p_tag || '-nodob@example.invalid', 'x', now(), now(), '{}', '{"full_name":"No Dob Yet"}');
  m := pg_temp.set_dob(adult, (d - interval '18 years')::date);
  if m <> 'accepted' then raise exception 'FAIL 1b [%]: the profiles gate refused a person who turns 18 today in Lagos: %', p_tag, m; end if;

  kid18 := pg_temp.mkkid((d - interval '18 years')::date, guardian, v_org);
  if private.is_minor_dependant(kid18) then
    raise exception 'FAIL 1c [%]: a child who turns 18 today in Lagos is still counted as a minor dependant', p_tag;
  end if;
  if private.compute_dependent_transition_state((d - interval '18 years')::date)::text <> 'independent'
     or private.adolescent_age_band(kid18) <> 'adult' then
    raise exception 'FAIL 1d [%]: the transition state / age band does not treat 18 today in Lagos as an adult', p_tag;
  end if;

  -- 2. 18th birthday tomorrow in Lagos: refused, still a minor
  m := pg_temp.reg(((d - interval '18 years')::date + 1), p_tag || '-tomorrow@example.invalid');
  if m not like 'adult_only_registration%' then raise exception 'FAIL 2a [%]: 18th birthday tomorrow in Lagos was not refused at sign-up: %', p_tag, m; end if;

  adult := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (adult, p_tag || '-nodob2@example.invalid', 'x', now(), now(), '{}', '{"full_name":"No Dob Yet"}');
  m := pg_temp.set_dob(adult, ((d - interval '18 years')::date + 1));
  if m not like 'adult_only_registration%' then raise exception 'FAIL 2b [%]: the profiles gate accepted 18th birthday tomorrow in Lagos: %', p_tag, m; end if;

  kid_tomorrow := pg_temp.mkkid(((d - interval '18 years')::date + 1), guardian, v_org);
  if not private.is_minor_dependant(kid_tomorrow) then
    raise exception 'FAIL 2c [%]: a child whose 18th birthday is tomorrow in Lagos is not counted as a minor dependant', p_tag;
  end if;
  if private.compute_dependent_transition_state(((d - interval '18 years')::date + 1)) = 'independent'
     or private.adolescent_age_band(kid_tomorrow) = 'adult' then
    raise exception 'FAIL 2d [%]: the transition state / age band calls 18th birthday tomorrow in Lagos an adult', p_tag;
  end if;

  -- 3. under-18 stays refused / minor; an adult stays accepted
  m := pg_temp.reg((d - interval '17 years')::date, p_tag || '-seventeen@example.invalid');
  if m not like 'adult_only_registration%' then raise exception 'FAIL 3a [%]: a 17 year old registered: %', p_tag, m; end if;
  adult := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data)
  values (adult, p_tag || '-nodob3@example.invalid', 'x', now(), now(), '{}', '{"full_name":"No Dob Yet"}');
  m := pg_temp.set_dob(adult, (d - interval '10 years')::date);
  if m not like 'adult_only_registration%' then raise exception 'FAIL 3b [%]: a non-dependant profile took an under-18 date of birth: %', p_tag, m; end if;
  kid6 := pg_temp.mkkid((d - interval '6 years')::date, guardian, v_org);
  if not private.is_minor_dependant(kid6) then raise exception 'FAIL 3c [%]: a 6 year old dependant is not a minor', p_tag; end if;
  m := pg_temp.reg('1990-05-05', p_tag || '-grown@example.invalid');
  if m <> 'accepted' then raise exception 'FAIL 3d [%]: an ordinary adult was refused: %', p_tag, m; end if;
end $$;

select pg_temp.run_checks('p');

-- 5. SABOTAGE: each check must be able to fail --------------------------------------------------------------------------
create function pg_temp.expect_fail(p_tag text, p_must_start text) returns void language plpgsql as $$
declare got text := null;
begin
  begin
    perform pg_temp.run_checks(p_tag);
  exception when others then
    got := sqlerrm;
  end;
  if got is null then
    raise exception 'SABOTAGE %: the checks still passed, so they could not have caught the bug', p_tag;
  end if;
  if got not like p_must_start || '%' then
    raise exception 'SABOTAGE %: failed on the wrong check (wanted %, got: %)', p_tag, p_must_start, got;
  end if;
end $$;

-- 5a. the registration trigger back on the UTC date
do $$
declare src text := pg_get_functiondef('private.enforce_adult_registration()'::regprocedure);
begin
  src := replace(src, 'private.lagos_today()', 'current_date');
  if src = pg_get_functiondef('private.enforce_adult_registration()'::regprocedure) then raise exception 'sabotage 5a did not apply'; end if;
  execute src;
  perform pg_temp.expect_fail('s5a', 'FAIL 1a');
end $$;
-- put it back
do $$
declare src text := pg_get_functiondef('private.enforce_adult_registration()'::regprocedure);
begin
  execute replace(src, 'current_date', 'private.lagos_today()');
end $$;

-- 5b. the sign-up path back on the UTC date
do $$
declare src text := pg_get_functiondef('private.handle_new_user()'::regprocedure);
begin
  src := replace(src, 'private.lagos_today()', 'current_date');
  if src = pg_get_functiondef('private.handle_new_user()'::regprocedure) then raise exception 'sabotage 5b did not apply'; end if;
  execute src;
  perform pg_temp.expect_fail('s5b', 'FAIL 1a');
end $$;
do $$
declare src text := pg_get_functiondef('private.handle_new_user()'::regprocedure);
begin
  execute replace(src, 'current_date', 'private.lagos_today()');
end $$;

-- 5c. the minor definition back on the UTC date
do $$
declare src text := pg_get_functiondef('private.is_minor_dependant(uuid)'::regprocedure);
begin
  src := replace(src, 'private.lagos_today()', 'current_date');
  if src = pg_get_functiondef('private.is_minor_dependant(uuid)'::regprocedure) then raise exception 'sabotage 5c did not apply'; end if;
  execute src;
  perform pg_temp.expect_fail('s5c', 'FAIL 1c');
end $$;
do $$
declare src text := pg_get_functiondef('private.is_minor_dependant(uuid)'::regprocedure);
begin
  execute replace(src, 'current_date', 'private.lagos_today()');
end $$;

-- 5e. the transition state and age band back on the UTC date
do $$
declare a text := pg_get_functiondef('private.compute_dependent_transition_state(date)'::regprocedure);
        b text := pg_get_functiondef('private.adolescent_age_band(uuid)'::regprocedure);
begin
  if a !~ 'lagos_today' or b !~ 'lagos_today' then raise exception 'sabotage 5e: functions do not use the helper'; end if;
  execute replace(a, 'private.lagos_today()', 'current_date');
  execute replace(b, 'private.lagos_today()', 'current_date');
  perform pg_temp.expect_fail('s5e', 'FAIL 1d');
end $$;
do $$
declare a text := pg_get_functiondef('private.compute_dependent_transition_state(date)'::regprocedure);
        b text := pg_get_functiondef('private.adolescent_age_band(uuid)'::regprocedure);
begin
  execute replace(a, 'current_date', 'private.lagos_today()');
  execute replace(b, 'current_date', 'private.lagos_today()');
end $$;

-- 5d. the helper a day too far behind (a wrong date): the tomorrow case must be accepted wrongly, so check 2 would fail
create or replace function private.lagos_today() returns date language sql stable set search_path = ''
  as $$ select d + 1 from pg_temp.lagos_fixed_clock $$;
select pg_temp.expect_fail('s5d', 'FAIL 2');
create or replace function private.lagos_today() returns date language sql stable set search_path = ''
  as $$ select d from pg_temp.lagos_fixed_clock $$;

-- restored: the checks pass again
select pg_temp.run_checks('r');

rollback;

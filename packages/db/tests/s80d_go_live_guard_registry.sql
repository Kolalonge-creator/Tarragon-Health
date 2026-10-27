-- S80d proof (OQ-539): the registry no longer says the two guards are unenforced, and the enforcement it names is real and fails closed.
--   1. public_signup_enabled and on_call_cover_ok each list at least one enforcement point; the points they name exist (the intake-gate trigger,
--      the sign-up invite functions).
--   2. Fail closed: an unknown guard key reads as OFF.
--   3. Sign-up, with the invite-only switch ON and the guard OFF: an uninvited person is refused, an admin-created account (app-metadata
--      exemption) passes, a user-metadata self-exemption does not.
--   4. NO LIVE BEHAVIOUR CHANGE: with the invite-only switch OFF (as shipped) everyone passes; with the guard ON everyone passes.
--   SABOTAGE: (a) the sign-up checker made always-yes, (b) the registry row emptied again; each must flip a check.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

do $$
declare v_was_on boolean; v_guard_was boolean;
begin
  select is_on into v_guard_was from public.go_live_guards where key = 'public_signup_enabled';
  update public.go_live_guards set is_on = false where key = 'public_signup_enabled';
  v_was_on := coalesce(public.platform_switch_is_on('signup_invites_required'), false);
  update public.platform_switches set is_on = false where key = 'signup_invites_required';
end $$;

-- 1. the registry
insert into results values ('real', 'public_signup_enabled lists its enforcement', 'true',
  (select (cardinality(enforced_in) >= 1 and not_enforced_in like '%ships OFF%')::text from public.go_live_guards where key = 'public_signup_enabled'));
insert into results values ('real', 'on_call_cover_ok lists its enforcement', 'true',
  (select (cardinality(enforced_in) >= 1)::text from public.go_live_guards where key = 'on_call_cover_ok'));
insert into results values ('real', 'the intake gate it names exists on orders', '1',
  (select count(*)::text from pg_trigger where tgname = 'orders_intake_gate' and tgrelid = 'public.orders'::regclass and not tgisinternal));
insert into results values ('real', 'the sign-up trigger it names exists on auth.users', '1',
  (select count(*)::text from pg_trigger t where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal and t.tgfoid = 'private.enforce_signup_invite()'::regprocedure));

-- 2. fail closed
insert into results values ('real', 'an unknown guard key reads as off', 'false', (select private.go_live_guard_on('no_such_guard_key')::text));

-- 4. the shipped state: switch off, everyone passes
insert into results values ('real', 'switch off: an uninvited person passes (live behaviour unchanged)', 'true',
  (select private.signup_may_create_user('+2348055500001', 'nobody-s80d@example.invalid', '{}'::jsonb, '{}'::jsonb)::text));

-- 3. the switch ON, guard OFF
update public.platform_switches set is_on = true where key = 'signup_invites_required';
insert into results values ('real', 'switch on, guard off: an uninvited person is refused', 'false',
  (select private.signup_may_create_user('+2348055500002', 'nobody-s80d@example.invalid', '{}'::jsonb, '{}'::jsonb)::text));
insert into results values ('real', 'an admin-created account (app metadata exemption) passes', 'true',
  (select private.signup_may_create_user('+2348055500003', 'admin-made-s80d@example.invalid', '{}'::jsonb, '{"signup_exempt":"true"}'::jsonb)::text));
insert into results values ('real', 'a self-declared exemption in user metadata does not', 'false',
  (select private.signup_may_create_user('+2348055500004', 'self-s80d@example.invalid', '{"signup_exempt":"true"}'::jsonb, '{}'::jsonb)::text));

-- 4b. the guard ON opens it to everyone
update public.go_live_guards set is_on = true where key = 'public_signup_enabled';
insert into results values ('real', 'guard on: an uninvited person passes', 'true',
  (select private.signup_may_create_user('+2348055500005', 'nobody-s80d@example.invalid', '{}'::jsonb, '{}'::jsonb)::text));
update public.go_live_guards set is_on = false where key = 'public_signup_enabled';

-- SABOTAGE (a): the checker always says yes
do $$
declare v_orig text; v_def text; r text;
begin
  v_orig := pg_get_functiondef('private.signup_may_create_user(text, text, jsonb, jsonb)'::regprocedure);
  v_def := replace(v_orig, 'begin' || E'\n' || '  if not coalesce(public.platform_switch_is_on', 'begin' || E'\n' || '  if true then return true; end if;' || E'\n' || '  if not coalesce(public.platform_switch_is_on');
  if v_def = v_orig then raise exception 'SABOTAGE (a) not applied'; end if;
  execute v_def;
  r := private.signup_may_create_user('+2348055500006', 'nobody-s80d@example.invalid', '{}'::jsonb, '{}'::jsonb)::text;
  insert into results values ('sabotaged', 'switch on, guard off: an uninvited person is refused', 'false', r);
  execute v_orig;
end $$;

-- SABOTAGE (b): the registry row emptied again
do $$
declare r text;
begin
  update public.go_live_guards set enforced_in = '{}' where key = 'public_signup_enabled';
  select (cardinality(enforced_in) >= 1)::text into r from public.go_live_guards where key = 'public_signup_enabled';
  insert into results values ('sabotaged', 'public_signup_enabled lists its enforcement', 'true', r);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S80d guard registry proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

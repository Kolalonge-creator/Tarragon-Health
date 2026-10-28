-- S80d (OQ-539 / OQ-184): the two guards the registry still called "not enforced" are enforced; make the registry say so, and prove it.
--
-- WHAT WAS FOUND (read from the migrations on main-dev, 2026-10-27)
--   * on_call_cover_ok  is enforced by the BEFORE INSERT trigger orders_intake_gate (20261015162552_s16_s20_capacity_cover.sql), which refuses a new
--     care pack sale or lead enrolment when the gate is on and the guard is off. Its registry row was already updated there.
--     The gate itself ships NOT enforced (capacity_cover_config version 1, gate_enforce = 0), so the guard blocks nothing today.
--   * public_signup_enabled  is enforced by the BEFORE INSERT trigger on auth.users (20261007231528_signup_invite_list.sql) through the platform
--     switch signup_invites_required, which ships OFF. Its registry row still said "Sign-up is not behind this guard yet": wrong since that
--     migration, so the go-live screen told a reader the opposite of the code.
--
-- WHAT THIS CHANGES: the text of one registry row, nothing else. NO LIVE BEHAVIOUR CHANGES. The invite-only switch stays off, so everyone can
-- sign up exactly as before; turning it on remains a deliberate admin act at /admin/settings/signup-invites. Neither guard is switched.
-- Both guards already fail closed: private.go_live_guard_on() returns false for a missing key or a missing row.

update public.go_live_guards
   set enforced_in = array[
         'auth.users insert by the sign-in service, only when the platform switch signup_invites_required is on (private.enforce_signup_invite): an uninvited sign-up is refused with signup_invite_required',
         'private.signup_permitted (the app asks before it calls the sign-in service, to say so kindly)'],
       not_enforced_in = 'The invite-only switch (signup_invites_required) ships OFF, so today anyone can sign up and this guard blocks nothing. Switching the guard ON opens sign-up to everyone regardless of the switch. Migrations, owner scripts, admin-created accounts, sponsor-paid phone numbers and people with an invite are never refused. Care Circle supporters, employer cohorts and diaspora sponsors need an invite before the switch is turned on (OQ-540).'
 where key = 'public_signup_enabled';

do $$
begin
  if not exists (select 1 from public.go_live_guards where key = 'public_signup_enabled' and cardinality(enforced_in) >= 1) then
    raise exception 'public_signup_enabled registry row was not updated';
  end if;
  if not exists (select 1 from public.go_live_guards where key = 'on_call_cover_ok' and cardinality(enforced_in) >= 1) then
    raise exception 'on_call_cover_ok registry row has no enforcement listed';
  end if;
  -- the enforcement the registry now claims really exists
  if not exists (select 1 from pg_trigger where tgname = 'orders_intake_gate' and tgrelid = 'public.orders'::regclass and not tgisinternal) then
    raise exception 'orders_intake_gate trigger is missing';
  end if;
  if to_regprocedure('private.enforce_signup_invite()') is null or to_regprocedure('private.signup_permitted(text, text, jsonb, jsonb)') is null then
    raise exception 'sign-up invite enforcement functions are missing';
  end if;
  -- fail closed: an unknown guard key is OFF, never ON
  if private.go_live_guard_on('no_such_guard_key') then raise exception 'an unknown guard key must read as off'; end if;
end $$;

-- Optional passkeys for patient sign-in (docs/design/passkeys.md). Founder decision 2026-10-16: strictly optional, an extra for
-- tech-savvy people. Phone and email sign-in, passwords, backup codes and every recovery route are NOT touched by this file.
--
-- WHERE THE PASSKEYS LIVE. Supabase Auth (GoTrue) has native passkey support: it stores the public keys in
-- auth.webauthn_credentials, issues challenges (auth.webauthn_challenges, five minute expiry), and checks origin, relying-party id,
-- signature and signature counter. We do not copy any of that into our own tables. This migration only adds what Auth cannot:
--   1. a platform switch, OFF, that the founder flips (public.platform_switches key 'passkeys', readable by the signed-out sign-in page);
--   2. a short, single-use "password was just re-checked" authorisation (public.passkey_add_authorisations), written only by the server;
--   3. a gate on auth.webauthn_credentials: a passkey can be stored only for an active PATIENT, only while the switch is on, and only
--      with a fresh authorisation. It runs for every caller, including a direct call to the Auth API with a stolen access token, which
--      an application-level check would miss (same shape as the change-number gate on auth.users, S03b);
--   4. an audit row and an in-app + email notice (never SMS, INV-08) whenever a passkey is added or removed, and an audit row when one
--      is used, however it happened. The notice is wrapped so a failure to queue it can never block the change.
--   5. public.passkey_gate_ready(): true only when the triggers above are really installed. The app treats passkeys as nonexistent
--      when it is false, so a database whose Auth version has no credential table (for example a local stack on an older image)
--      stays closed instead of running without its guard.
--
-- LIVE FACTS CHECKED 2026-10-16 (project koiplnmbgnqnbywhpjlf): auth.webauthn_credentials and auth.webauthn_challenges exist; the
-- credentials table has no triggers and held no rows. The migration ledger's latest entry was 20261016023011, which git also has.
--
-- NOT IN THIS FILE, and a dashboard step (OQ-PASSKEY-01): turning passkeys on in Supabase Auth (Authentication, Passkeys) with the
-- relying-party id and origins. Until the founder does that AND flips the switch, nothing here is reachable.

-- ---------------------------------------------------------------------------
-- 1. The switch. Off. Anon-readable (the sign-in page asks before anyone is signed in); only an admin can flip it, audited.
-- ---------------------------------------------------------------------------
insert into public.platform_switches (key, label, description, is_on, readable_by_anon)
values ('passkeys',
        'Passkeys (optional sign-in)',
        'Lets patients add a passkey (fingerprint, face or screen lock) as an extra way to sign in on a device they trust. Phone, email and password sign-in always keep working. Off by default. Before turning on: enable Passkeys in Supabase Auth with the relying-party id and origins (docs/design/passkeys.md). Turning it off hides adding and signing in with a passkey; people can still remove passkeys.',
        false,
        true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The authorisation the server records after it checked the account password.
-- ---------------------------------------------------------------------------
create table public.passkey_add_authorisations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  consumed_at     timestamptz
);
create index passkey_add_authorisations_user_idx on public.passkey_add_authorisations (user_id, created_at desc);
alter table public.passkey_add_authorisations enable row level security;
-- Server-only table: RLS on, no policies, and no grant to any application role. Default privileges would otherwise hand
-- `authenticated` access to a new public table, so it is taken away explicitly (the closing check proves it).
revoke all on public.passkey_add_authorisations from public, anon, authenticated;

comment on table public.passkey_add_authorisations is
  'One short-lived, single-use row per "password was just re-checked, this account may add ONE passkey". Written only by the server (service role) through public.authorise_passkey_add; spent by the trigger on auth.webauthn_credentials. Optional passkeys, docs/design/passkeys.md.';

-- minutes is clamped 1..15 here so a bad caller cannot mint a long-lived authorisation; the PROPOSED value (5) lives in
-- packages/shared/src/proposed-config (auth.passkey_rules) and is passed in by the server.
create function public.authorise_passkey_add(p_user uuid, p_minutes integer) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid;
begin
  if p_user is null then return false; end if;
  select organisation_id into v_org from public.profiles where id = p_user and role = 'patient' and is_active;
  if v_org is null then return false; end if;
  -- one authorisation at a time; spent and expired rows are not kept
  delete from public.passkey_add_authorisations where user_id = p_user;
  insert into public.passkey_add_authorisations (user_id, organisation_id, expires_at)
  values (p_user, v_org, now() + make_interval(mins => greatest(1, least(15, coalesce(p_minutes, 3)))));
  return true;
end;
$$;

-- Closes the window early: called when the person cancels the device prompt or a step fails, so an unspent authorisation does not
-- sit there for its full length.
create function public.cancel_passkey_add(p_user uuid) returns void
language sql security definer set search_path = ''
as $$
  delete from public.passkey_add_authorisations where user_id = p_user and consumed_at is null
$$;

-- ---------------------------------------------------------------------------
-- 3. The gate (BEFORE INSERT on auth.webauthn_credentials).
-- ---------------------------------------------------------------------------
create function private.enforce_passkey_add_gate() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  -- Patients only. A staff login never gets a passkey here, which also means a staff account cannot be given one by a stolen token.
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'patient' and is_active) then
    raise exception 'passkey_not_allowed' using errcode = 'P0001';
  end if;
  -- The switch is the founder's. With it off, no passkey can be stored by any route.
  if not exists (select 1 from public.platform_switches where key = 'passkeys' and is_on) then
    raise exception 'passkey_not_allowed' using errcode = 'P0001';
  end if;
  select id into v_id from public.passkey_add_authorisations
   where user_id = new.user_id and consumed_at is null and expires_at > now()
   order by created_at desc limit 1 for update;
  if v_id is null then
    raise exception 'passkey_step_up_required' using errcode = 'P0001',
      hint = 'Re-enter the account password in the app first.';
  end if;
  update public.passkey_add_authorisations set consumed_at = now() where id = v_id;
  return new;
end;
$$;
revoke all on function private.enforce_passkey_add_gate() from public, anon, authenticated;

-- The switch is also a kill switch for SIGNING IN. Auth records a passkey sign-in by setting last_used_at on the credential, in the
-- same step that issues the session; refusing that update while the switch is off makes Auth refuse the sign-in, whichever client
-- called it. (A counter-only update is not affected.)
create function private.enforce_passkey_signin_switch() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.platform_switches where key = 'passkeys' and is_on) then
    raise exception 'passkey_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_passkey_signin_switch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit and notice, whoever did it. After a change; never blocks it.
-- ---------------------------------------------------------------------------
create function private.record_passkey_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_credential uuid;
  v_org uuid;
  v_ch text[];
begin
  v_uid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  v_credential := case when tg_op = 'DELETE' then old.id else new.id end;
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is null then return null; end if;   -- the account itself is going away; nothing to record or tell
  -- The audit row comes FIRST and in its own block: it is the record an investigation needs, so a failure to queue the notice below
  -- can never take it with it.
  begin
    perform private.recovery_audit(v_org, v_uid,
      case tg_op when 'INSERT' then 'account.passkey_added' when 'DELETE' then 'account.passkey_removed' else 'account.passkey_used' end,
      'passkey', v_credential, v_uid, 'success', '{}'::jsonb);
  exception when others then
    raise warning 'passkeys: could not write the audit row (sqlstate %)', sqlstate;
  end;
  begin
    if tg_op = 'INSERT' then
      v_ch := private.recovery_notice(v_uid, 'security.passkey_added',
        'A passkey was added to your Tarragon Health account. If this was not you, remove it under Passkeys in your settings, change your password now and tell your care team. You can always sign in with your phone number or email.');
    elsif tg_op = 'DELETE' then
      v_ch := private.recovery_notice(v_uid, 'security.passkey_removed',
        'A passkey was removed from your Tarragon Health account. If this was not you, change your password now and tell your care team. You can always sign in with your phone number or email.');
    end if;
    -- a use gets no notice: one on every sign-in would be noise
  exception when others then
    raise warning 'passkeys: could not queue the passkey notice (sqlstate %)', sqlstate;
  end;
  return null;
end;
$$;
revoke all on function private.record_passkey_change() from public, anon, authenticated;

-- The triggers go on a table Auth owns. A MISSING table (an older Auth image) is tolerated with a WARNING and the feature stays
-- closed (passkey_gate_ready() is false). A table that EXISTS but refuses a trigger fails the migration loudly: a gate that
-- silently is not there is exactly the kind of failure this file must not have. (postgres can create them on the live project:
-- checked 2026-10-16 with a rolled-back probe.)
do $$
begin
  if to_regclass('auth.webauthn_credentials') is null then
    raise warning 'passkeys: auth.webauthn_credentials is not in this Auth version; the gate is NOT installed and passkeys stay closed.';
    return;
  end if;

  begin
    drop trigger if exists webauthn_credentials_enforce_passkey_add_gate on auth.webauthn_credentials;
    create trigger webauthn_credentials_enforce_passkey_add_gate
      before insert on auth.webauthn_credentials
      for each row execute function private.enforce_passkey_add_gate();
  exception when others then
    raise exception 'passkeys: could not install the add gate (sqlstate %): %', sqlstate, sqlerrm;
  end;

  begin
    drop trigger if exists webauthn_credentials_record_passkey_added on auth.webauthn_credentials;
    create trigger webauthn_credentials_record_passkey_added
      after insert on auth.webauthn_credentials
      for each row execute function private.record_passkey_change();
  exception when others then
    raise exception 'passkeys: could not install the added trigger (sqlstate %): %', sqlstate, sqlerrm;
  end;

  begin
    drop trigger if exists webauthn_credentials_record_passkey_removed on auth.webauthn_credentials;
    create trigger webauthn_credentials_record_passkey_removed
      after delete on auth.webauthn_credentials
      for each row execute function private.record_passkey_change();
  exception when others then
    raise exception 'passkeys: could not install the removed trigger (sqlstate %): %', sqlstate, sqlerrm;
  end;

  begin
    drop trigger if exists webauthn_credentials_enforce_passkey_signin_switch on auth.webauthn_credentials;
    create trigger webauthn_credentials_enforce_passkey_signin_switch
      before update of last_used_at on auth.webauthn_credentials
      for each row
      when (old.last_used_at is distinct from new.last_used_at)
      execute function private.enforce_passkey_signin_switch();
  exception when others then
    raise exception 'passkeys: could not install the sign-in switch trigger (sqlstate %): %', sqlstate, sqlerrm;
  end;

  begin
    drop trigger if exists webauthn_credentials_record_passkey_used on auth.webauthn_credentials;
    create trigger webauthn_credentials_record_passkey_used
      after update of last_used_at on auth.webauthn_credentials
      for each row
      when (old.last_used_at is distinct from new.last_used_at)
      execute function private.record_passkey_change();
  exception when others then
    raise exception 'passkeys: could not install the used trigger (sqlstate %): %', sqlstate, sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Readers for the server.
-- ---------------------------------------------------------------------------
-- Does the account hold a fresh, unspent authorisation? Lets a caller say "re-enter your password" before asking Auth. Does not spend it.
create function public.has_fresh_passkey_add_authorisation(p_user uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.passkey_add_authorisations where user_id = p_user and consumed_at is null and expires_at > now())
$$;

-- True only when all five triggers are really installed and enabled. Reveals nothing about any account. Service role only: the app asks
-- it from the server, so no signed-out role needs EXECUTE on it.
create function public.passkey_gate_ready() returns boolean
language sql stable security definer set search_path = ''
as $$
  select (
    select count(*) from pg_catalog.pg_trigger t
     where t.tgrelid = to_regclass('auth.webauthn_credentials')
       and t.tgenabled <> 'D'
       and not t.tgisinternal
       and t.tgname in ('webauthn_credentials_enforce_passkey_add_gate', 'webauthn_credentials_record_passkey_added',
                        'webauthn_credentials_record_passkey_removed', 'webauthn_credentials_record_passkey_used',
                        'webauthn_credentials_enforce_passkey_signin_switch')
  ) = 5
$$;

-- ---------------------------------------------------------------------------
-- 6. Grants. No PUBLIC. The two writers and the freshness check are service role only; the readiness check may be asked by anyone
-- (no longer needed: the server asks with the service role).
-- ---------------------------------------------------------------------------
revoke all on function public.authorise_passkey_add(uuid, integer) from public;
revoke all on function public.authorise_passkey_add(uuid, integer) from anon;
revoke all on function public.authorise_passkey_add(uuid, integer) from authenticated;
grant execute on function public.authorise_passkey_add(uuid, integer) to service_role;

revoke all on function public.cancel_passkey_add(uuid) from public;
revoke all on function public.cancel_passkey_add(uuid) from anon;
revoke all on function public.cancel_passkey_add(uuid) from authenticated;
grant execute on function public.cancel_passkey_add(uuid) to service_role;

revoke all on function public.has_fresh_passkey_add_authorisation(uuid) from public;
revoke all on function public.has_fresh_passkey_add_authorisation(uuid) from anon;
revoke all on function public.has_fresh_passkey_add_authorisation(uuid) from authenticated;
grant execute on function public.has_fresh_passkey_add_authorisation(uuid) to service_role;

revoke all on function public.passkey_gate_ready() from public;
revoke all on function public.passkey_gate_ready() from anon;
revoke all on function public.passkey_gate_ready() from authenticated;
grant execute on function public.passkey_gate_ready() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  if not exists (select 1 from public.platform_switches where key = 'passkeys' and readable_by_anon) then
    raise exception 'passkeys: the passkeys switch row is missing or not anon-readable';
  end if;
  if exists (select 1 from public.platform_switches where key = 'passkeys' and is_on) and not exists (select 1 from public.platform_switches where key = 'passkeys' and changed_by is not null) then
    raise exception 'passkeys: the switch shipped ON; it must ship OFF and be flipped by an admin';
  end if;
  if has_table_privilege('authenticated', 'public.passkey_add_authorisations', 'SELECT')
     or has_table_privilege('authenticated', 'public.passkey_add_authorisations', 'INSERT')
     or has_table_privilege('authenticated', 'public.passkey_add_authorisations', 'UPDATE')
     or has_table_privilege('authenticated', 'public.passkey_add_authorisations', 'DELETE')
     or has_table_privilege('anon', 'public.passkey_add_authorisations', 'SELECT') then
    raise exception 'passkeys: passkey_add_authorisations is reachable by an application role';
  end if;
  foreach f in array array['public.authorise_passkey_add(uuid,integer)', 'public.has_fresh_passkey_add_authorisation(uuid)', 'public.cancel_passkey_add(uuid)', 'public.passkey_gate_ready()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'passkeys: % is callable by an application role', f;
    end if;
  end loop;
  foreach f in array array['private.enforce_passkey_add_gate()', 'private.record_passkey_change()', 'private.enforce_passkey_signin_switch()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'passkeys: helper % is directly executable', f;
    end if;
  end loop;
  -- Where the table exists and the triggers could be made, the readiness check must say so; where they could not, it must say no.
  if to_regclass('auth.webauthn_credentials') is not null then
    if not public.passkey_gate_ready() then
      raise exception 'passkeys: the credential table exists but the five triggers are not all installed and enabled';
    end if;
  elsif public.passkey_gate_ready() then
    raise exception 'passkeys: there is no credential table but passkey_gate_ready() says yes';
  end if;
  raise notice 'PASS: optional passkeys migration (switch off, gate_ready = %)', public.passkey_gate_ready();
end $$;

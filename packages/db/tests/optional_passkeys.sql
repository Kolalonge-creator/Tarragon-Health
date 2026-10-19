-- ===========================================================================
-- Proof: 20261016190258_optional_passkeys.sql (optional passkeys; docs/design/passkeys.md).
--
-- Proves, against the real migrated schema, with simulated sessions and the service role:
--   A. (always) The platform switch ships OFF and is readable signed-out. The "password was just re-checked" authorisation is written
--      by the service role only, only for an active patient, clamped to 1..15 minutes, one at a time, and the table is unreachable
--      by any application role. The freshness check is service role only. passkey_gate_ready() is service role only.
--   B. (only where Auth's credential table exists on this database) The gate on auth.webauthn_credentials:
--        - with the switch OFF no passkey can be stored, even with an authorisation;
--        - with the switch ON, none without a fresh authorisation (a direct Auth call with a stolen token has none), none for a
--          clinician account, none with another account's authorisation, none with an expired one, and one authorisation spends once;
--        - adding writes an audit row (no key material in it) and an in-app AND an email notice, routine priority, never critical
--          (the escalation engine re-sends critical notices by SMS, INV-08); removing does the same; using one writes an audit row and
--          NO notice; changing only the signature counter writes nothing;
--        - a failure to queue the notice never blocks the change;
--        - passkey_gate_ready() is true only while all five triggers are installed.
--   C. SABOTAGE x3, each proving its check can fail: neuter the gate, grant read on the authorisations table, grant EXECUTE on
--      authorise_passkey_add to authenticated.
-- Where the credential table does not exist (an older local Auth image) part B is skipped with a NOTICE and the migration's own
-- assertions plus part A still run; passkey_gate_ready() must then be false, which is what keeps the feature closed there.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

create function pg_temp.svc_json(p_sql text) returns jsonb language plpgsql as $$
declare j jsonb;
begin
  execute 'set local role service_role';
  execute p_sql into j;
  execute 'reset role';
  return j;
exception when others then
  execute 'reset role';
  raise;
end $$;

-- true when the statement is refused (any error), false when it ran
create function pg_temp.refused(p_role text, p_uid uuid, p_sql text) returns boolean language plpgsql as $$
begin
  if p_uid is not null then perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_role)::text, true); end if;
  execute format('set local role %s', p_role);
  begin
    execute p_sql;
  exception when others then
    execute 'reset role';
    return true;
  end;
  execute 'reset role';
  return false;
end $$;

-- the text of the error a statement raises, or null if it ran (run as the table owner, i.e. how Auth's own connection acts)
create function pg_temp.err_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- GoTrue stores credentials as supabase_auth_admin, so the proof does too (the trigger functions are SECURITY DEFINER and must work for it)
create function pg_temp.add_passkey(p_uid uuid) returns text language plpgsql as $$
declare v text;
begin
  execute 'set local role supabase_auth_admin';
  v := pg_temp.err_of(format(
    'insert into auth.webauthn_credentials (user_id, credential_id, public_key) values (%L, extensions.gen_random_bytes(32), extensions.gen_random_bytes(65))', p_uid));
  execute 'reset role';
  return v;
end $$;

do $$
declare
  v_org uuid;
  p1 uuid := gen_random_uuid();      -- patient with a confirmed email
  p2 uuid := gen_random_uuid();      -- another patient
  clin uuid := gen_random_uuid();    -- clinician
  v_txt text; r jsonb; n integer; v_exp timestamptz; v_cred uuid; has_table boolean := to_regclass('auth.webauthn_credentials') is not null and pg_has_role(current_user, 'supabase_auth_admin', 'member');   -- GoTrue stores credentials as that role; CI's proof user may not be allowed to become it, and then the gate sections are skipped (they need a real run as that role)
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, raw_app_meta_data, raw_user_meta_data) values
    (p1, 'pk-p1@example.invalid', 'x', now(), now() - interval '30 days', '{}', '{}'),
    (p2, 'pk-p2@example.invalid', 'x', now(), now() - interval '30 days', '{}', '{}'),
    (clin, 'pk-clin@example.invalid', 'x', now(), now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name) values
    (p1, v_org, 'patient', 'PK Patient One'),
    (p2, v_org, 'patient', 'PK Patient Two'),
    (clin, v_org, 'clinician', 'PK Clinician')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- ===== A. SWITCH, AUTHORISATION, GRANTS
  if not exists (select 1 from public.platform_switches where key = 'passkeys' and not is_on and readable_by_anon) then
    raise exception 'FAIL A1: the passkeys switch is not present, OFF and anon-readable';
  end if;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  if public.platform_switch_is_on('passkeys') then reset role; raise exception 'FAIL A1: a signed-out caller sees the switch ON'; end if;
  reset role;

  if not pg_temp.refused('authenticated', p1, format('select public.authorise_passkey_add(%L, 5)', p1)) then raise exception 'FAIL A2: a session can authorise its own passkey'; end if;
  if not pg_temp.refused('anon', null, format('select public.authorise_passkey_add(%L, 5)', p1)) then raise exception 'FAIL A2: anon can authorise a passkey'; end if;
  if not pg_temp.refused('authenticated', p1, format('select public.has_fresh_passkey_add_authorisation(%L)', p1)) then raise exception 'FAIL A2: a session can ask about authorisations'; end if;
  if not pg_temp.refused('authenticated', p1, 'select * from public.passkey_add_authorisations') then raise exception 'FAIL A3: a patient can read the authorisations table'; end if;
  if not pg_temp.refused('anon', null, 'select * from public.passkey_add_authorisations') then raise exception 'FAIL A3: anon can read the authorisations table'; end if;

  if (pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', clin)))::text::boolean then raise exception 'FAIL A4: a clinician was authorised'; end if;
  if (pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', gen_random_uuid())))::text::boolean then raise exception 'FAIL A4: an unknown account was authorised'; end if;
  if (pg_temp.svc_json('select to_jsonb(public.authorise_passkey_add(null, 5))'))::text::boolean then raise exception 'FAIL A4: a null account was authorised'; end if;
  if not (pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', p1)))::text::boolean then raise exception 'FAIL A5: a patient was not authorised'; end if;
  if not (pg_temp.svc_json(format('select to_jsonb(public.has_fresh_passkey_add_authorisation(%L))', p1)))::text::boolean then raise exception 'FAIL A5: a fresh authorisation is not reported'; end if;
  -- clamped: a huge or zero value cannot mint a long-lived or already-dead authorisation
  perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 99999))', p1));
  select expires_at into v_exp from public.passkey_add_authorisations where user_id = p1;
  if v_exp > now() + interval '15 minutes 5 seconds' then raise exception 'FAIL A6: minutes were not clamped down (%)', v_exp; end if;
  perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 0))', p1));
  select expires_at into v_exp from public.passkey_add_authorisations where user_id = p1;
  if v_exp < now() + interval '50 seconds' then raise exception 'FAIL A6: minutes were not clamped up (%)', v_exp; end if;
  perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, null))', p1));
  select count(*) into n from public.passkey_add_authorisations where user_id = p1;
  if n <> 1 then raise exception 'FAIL A7: % authorisations held for one account (want 1)', n; end if;
  -- cancelling closes the window early, and only for that account; a session or anon cannot cancel
  if not pg_temp.refused('authenticated', p1, format('select public.cancel_passkey_add(%L)', p1)) then raise exception 'FAIL A8: a session can cancel authorisations'; end if;
  if not pg_temp.refused('anon', null, format('select public.cancel_passkey_add(%L)', p1)) then raise exception 'FAIL A8: anon can cancel authorisations'; end if;
  perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', p2));
  perform pg_temp.svc_json(format('select to_jsonb(public.cancel_passkey_add(%L))', p1));
  if (pg_temp.svc_json(format('select to_jsonb(public.has_fresh_passkey_add_authorisation(%L))', p1)))::text::boolean then raise exception 'FAIL A8: cancel left the authorisation fresh'; end if;
  if not (pg_temp.svc_json(format('select to_jsonb(public.has_fresh_passkey_add_authorisation(%L))', p2)))::text::boolean then raise exception 'FAIL A8: cancel touched another account'; end if;
  delete from public.passkey_add_authorisations;

  if not pg_temp.refused('anon', null, 'select public.passkey_gate_ready()') then raise exception 'FAIL A9: anon can call passkey_gate_ready'; end if;
  if not pg_temp.refused('authenticated', p1, 'select public.passkey_gate_ready()') then raise exception 'FAIL A9: a session can call passkey_gate_ready'; end if;
  raise notice 'PASS A switch, authorisation, grants';

  -- ===== B. THE GATE ON THE CREDENTIAL TABLE
  if not has_table then
    if to_regclass('auth.webauthn_credentials') is null then
      if public.passkey_gate_ready() then raise exception 'FAIL B0: no credential table but passkey_gate_ready() is true'; end if;
      raise notice 'SKIP B: auth.webauthn_credentials does not exist on this database; passkey_gate_ready() is false, so the app keeps passkeys closed';
    else
      if not public.passkey_gate_ready() then raise exception 'FAIL B0: the credential table exists but the five triggers are not all installed'; end if;
      raise notice 'SKIP B: the proof user cannot become supabase_auth_admin here, so the inserts that fire the gate were not run; the triggers are installed (passkey_gate_ready() is true)';
    end if;
  else
    if not public.passkey_gate_ready() then raise exception 'FAIL B0: the credential table exists but the five triggers are not all installed'; end if;

    -- switch OFF: even a fresh authorisation does not let a passkey in
    perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', p1));
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is distinct from 'passkey_not_allowed' then raise exception 'FAIL B1: a passkey was stored with the switch OFF (%)', v_txt; end if;
    update public.platform_switches set is_on = true, changed_at = now() where key = 'passkeys';
    delete from public.passkey_add_authorisations;

    -- no authorisation: a direct call to Auth with a stolen token looks exactly like this
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is distinct from 'passkey_step_up_required' then raise exception 'FAIL B2: a passkey was stored with no password re-check (%)', v_txt; end if;
    -- a clinician cannot hold one, authorisation or not
    insert into public.passkey_add_authorisations (user_id, organisation_id, expires_at) values (clin, v_org, now() + interval '5 minutes');
    v_txt := pg_temp.add_passkey(clin);
    if v_txt is distinct from 'passkey_not_allowed' then raise exception 'FAIL B3: a clinician account stored a passkey (%)', v_txt; end if;
    -- another account's authorisation does not count
    insert into public.passkey_add_authorisations (user_id, organisation_id, expires_at) values (p2, v_org, now() + interval '5 minutes');
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is distinct from 'passkey_step_up_required' then raise exception 'FAIL B4: another account''s authorisation was accepted (%)', v_txt; end if;
    -- an expired one does not count
    insert into public.passkey_add_authorisations (user_id, organisation_id, expires_at) values (p1, v_org, now() - interval '1 minute');
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is distinct from 'passkey_step_up_required' then raise exception 'FAIL B5: an expired authorisation was accepted (%)', v_txt; end if;
    delete from public.passkey_add_authorisations;

    -- the real path: authorised, stored once, authorisation spent
    perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', p1));
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is not null then raise exception 'FAIL B6: an authorised passkey was refused (%)', v_txt; end if;
    if (pg_temp.svc_json(format('select to_jsonb(public.has_fresh_passkey_add_authorisation(%L))', p1)))::text::boolean then raise exception 'FAIL B6: the authorisation is still fresh after use'; end if;
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is distinct from 'passkey_step_up_required' then raise exception 'FAIL B7: one authorisation stored two passkeys (%)', v_txt; end if;
    select id into v_cred from auth.webauthn_credentials where user_id = p1;
    if v_cred is null then raise exception 'FAIL B6: the passkey row is missing'; end if;

    -- added: audit (no key material) + in-app and email notices, routine
    if not exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.passkey_added' and entity_id = v_cred) then raise exception 'FAIL B8: adding was not audited'; end if;
    if exists (select 1 from public.audit_log where subject_patient_id = p1 and action like 'account.passkey_%' and event::text ~* '(public_key|credential_id)') then raise exception 'FAIL B8: key material in an audit event'; end if;
    if not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.passkey_added' and channel = 'in_app')
       or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.passkey_added' and channel = 'email' and payload ->> 'to_email' = 'pk-p1@example.invalid') then
      raise exception 'FAIL B9: adding did not notify in-app AND by email';
    end if;
    if exists (select 1 from public.notifications where recipient_id = p1 and template like 'security.passkey_%' and (priority <> 'routine' or channel not in ('in_app', 'email'))) then
      raise exception 'FAIL B9: a passkey notice is not routine in-app/email';
    end if;

    -- used: audit only; counter-only change: nothing
    update auth.webauthn_credentials set sign_count = sign_count + 1 where id = v_cred;
    if exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.passkey_used') then raise exception 'FAIL B10: a counter-only update was audited as a use'; end if;
    update auth.webauthn_credentials set last_used_at = now() where id = v_cred;
    if not exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.passkey_used' and entity_id = v_cred) then raise exception 'FAIL B10: a use was not audited'; end if;
    if exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.passkey_used') then raise exception 'FAIL B10: a use sent a notice'; end if;

    -- the switch is also a kill switch for SIGNING IN: with it off, Auth's last_used_at update (the moment it records a sign-in) is refused
    update public.platform_switches set is_on = false where key = 'passkeys';
    v_txt := pg_temp.err_of(format('update auth.webauthn_credentials set last_used_at = now() + interval ''1 second'' where id = %L', v_cred));
    if v_txt is distinct from 'passkey_not_allowed' then raise exception 'FAIL B10d: a passkey sign-in was recorded with the switch OFF (%)', v_txt; end if;
    v_txt := pg_temp.err_of(format('update auth.webauthn_credentials set sign_count = sign_count + 1 where id = %L', v_cred));
    if v_txt is not null then raise exception 'FAIL B10e: a counter-only update was refused with the switch off (%)', v_txt; end if;
    update public.platform_switches set is_on = true where key = 'passkeys';

    -- removed: audit + notices
    delete from auth.webauthn_credentials where id = v_cred;
    if not exists (select 1 from public.audit_log where subject_patient_id = p1 and action = 'account.passkey_removed' and entity_id = v_cred) then raise exception 'FAIL B11: removing was not audited'; end if;
    if not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.passkey_removed' and channel = 'in_app')
       or not exists (select 1 from public.notifications where recipient_id = p1 and template = 'security.passkey_removed' and channel = 'email') then
      raise exception 'FAIL B11: removing did not notify in-app AND by email';
    end if;

    -- a failing notice never blocks the change
    create or replace function private.recovery_notice(p_user uuid, p_template text, p_message text, p_email boolean default true) returns text[]
      language plpgsql security definer set search_path = '' as 'begin raise exception ''notice queue is down''; end';
    perform pg_temp.svc_json(format('select to_jsonb(public.authorise_passkey_add(%L, 5))', p1));
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is not null then raise exception 'FAIL B12: a notice failure blocked adding a passkey (%)', v_txt; end if;
    -- and the AUDIT row still exists: it is written first, in its own block
    if (select count(*) from public.audit_log where subject_patient_id = p1 and action = 'account.passkey_added') < 2 then raise exception 'FAIL B12: the audit row was lost when the notice failed'; end if;
    delete from auth.webauthn_credentials where user_id = p1;
    raise notice 'PASS B gate, audit, notices';

    -- ===== C. SABOTAGE (last: B no longer needs the original notice function)
    -- C1: neuter the gate; the unauthorised insert that B2 refused now goes through, so B2 can fail.
    create or replace function private.enforce_passkey_add_gate() returns trigger language plpgsql security definer set search_path = '' as 'begin return new; end';
    v_txt := pg_temp.add_passkey(p1);
    if v_txt is not null then raise exception 'FAIL C1: sabotage did not open the gate (%)', v_txt; end if;
    delete from auth.webauthn_credentials where user_id = p1;
  end if;

  -- C2: grant read on the authorisations table; the check for "unreachable" must see it
  grant select on public.passkey_add_authorisations to authenticated;
  if pg_temp.refused('authenticated', p1, 'select * from public.passkey_add_authorisations') then raise exception 'FAIL C2: sabotage (grant select) did not open the table'; end if;
  revoke select on public.passkey_add_authorisations from authenticated;
  -- C3: grant EXECUTE on authorise_passkey_add to authenticated; the A2 check must see it
  grant execute on function public.authorise_passkey_add(uuid, integer) to authenticated;
  if pg_temp.refused('authenticated', p1, format('select public.authorise_passkey_add(%L, 5)', p1)) then raise exception 'FAIL C3: sabotage (grant execute) did not open the function'; end if;
  revoke execute on function public.authorise_passkey_add(uuid, integer) from authenticated;
  raise notice 'PASS C sabotage x% (each flips its check)', case when has_table then 3 else 2 end;
end $$;

rollback;

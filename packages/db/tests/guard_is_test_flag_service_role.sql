-- ===========================================================================
-- Proof: 20261028061153_fix_guard_is_test_flag_service_role_schema_usage.sql
--
-- The service role (no USAGE on schema private) can set and clear profiles.is_test, as private.guard_is_test_flag()
-- documents. s02_identity_consent_audit_baseline.sql check 1d only ran this as the postgres session, so it never saw the
-- 42501 "permission denied for schema private" the real service_role got (browser E2E journey 2 beforeAll).
--   1. service_role (no JWT) sets is_test = true on a profile, then false.
--   2. a signed-in non-admin still cannot flag themselves (rule unchanged).
--   3. a signed-in admin still can.
--   4. SABOTAGE: restore the one-expression body; check 1 must then fail with 42501, proving it discriminates.
--
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================
begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_state text;
  v_failed boolean;
  v_msg text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,   'gitf-pat@example.invalid',   'x', now(), '{}', '{}'),
    (v_admin, 'gitf-admin@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org, 'patient', 'GITF Patient', '+2348012220001'),
    (v_admin, v_org, 'admin',   'GITF Admin',   '+2348012220002')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- 1. service_role, no JWT claims
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id = v_pat;
  update public.profiles set is_test = false where id = v_pat;
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL 1: service_role could not flag a test account';
  end if;

  -- 2. a signed-in non-admin still cannot change the flag
  update public.profiles set is_test = false where id = v_pat;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    update public.profiles set is_test = true where id = v_pat;
  exception when sqlstate '42501' then
    get stacked diagnostics v_msg = message_text;
    v_failed := v_msg like '%is_test can only be changed%';
  end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 2: a non-admin flagged themselves (or was refused for another reason: %)', v_msg; end if;

  -- 3. a signed-in admin can
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL 3: an admin could not flag a test account';
  end if;
  perform set_config('request.jwt.claims', null, true);

  -- 4. SABOTAGE: the old one-expression guard must make check 1 fail
  execute $f$
    create or replace function private.guard_is_test_flag() returns trigger language plpgsql set search_path to '' as $b$
    begin
      if (select auth.uid()) is null or private.is_admin() then return new; end if;
      return new;
    end $b$ $f$;
  -- Do NOT run the sabotaged function as postgres first: plpgsql caches the parsed plan per session, so a first run
  -- as a role that has USAGE on schema private would hide the refusal from the service_role call below.
  -- The flag is already true from check 3; an UPDATE OF is_test trigger fires even when the value is unchanged.
  execute 'set local role service_role';
  v_failed := false;
  begin
    update public.profiles set is_test = true where id = v_pat;
  exception when sqlstate '42501' then
    get stacked diagnostics v_msg = message_text;
    v_failed := v_msg like '%schema private%';
  end;
  execute 'reset role';
  if not v_failed then
    raise exception 'FAIL SABOTAGE: the old guard did not refuse service_role, so check 1 proves nothing';
  end if;
end
$$;

rollback;

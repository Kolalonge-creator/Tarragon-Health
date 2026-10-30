-- Proof: private.guard_is_test_flag() works for the service_role (migration *_guard_is_test_flag_works_for_service_role.sql).
--
-- The guard said service_role may set profiles.is_test, but it was SECURITY INVOKER and named private.is_admin(), and service_role has no
-- USAGE on schema private, so every service-role write to is_test failed with 42501 "permission denied for schema private" (found by the
-- Browser E2E journey 2 fixture). The S02 proof checked its "service context" as postgres, which has USAGE, so it never saw this.
--
--   1. the precondition that makes this a real test: service_role has no USAGE on schema private
--   2. service_role (no JWT, the way the REST service-role client runs) can flag and unflag a profile
--   3. controls, the gate still closes: a patient cannot flag herself, a non-admin staff account cannot flag, an admin can
--   4. SABOTAGE: with the function put back to SECURITY INVOKER, check 2 fails with the exact original error, so check 2 can fail
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_clin uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_err text;
  v_sqlstate text;
  v_failed boolean;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,   'gitf-pat@example.invalid',   'x', now(), '{}', '{}'),
    (v_clin,  'gitf-clin@example.invalid',  'x', now(), '{}', '{}'),
    (v_admin, 'gitf-admin@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org, 'patient',   'GITF Patient',   '+2348022220001'),
    (v_clin,  v_org, 'clinician', 'GITF Clinician', '+2348022220002'),
    (v_admin, v_org, 'admin',     'GITF Admin',     '+2348022220003')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;

  -- 1. the precondition: if service_role ever gains USAGE on private, check 2 would pass for the wrong reason
  if has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'FAIL 1: service_role has USAGE on schema private, so this proof no longer tests the original defect';
  end if;
  if not (select p.prosecdef from pg_proc p where p.oid = 'private.guard_is_test_flag()'::regprocedure) then
    raise exception 'FAIL 1: guard_is_test_flag is not SECURITY DEFINER';
  end if;

  -- 2. service_role, no JWT claims: flag then unflag
  perform set_config('request.jwt.claims', null, true);
  execute 'set local role service_role';
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL 2a: service_role could not set profiles.is_test';
  end if;
  execute 'set local role service_role';
  update public.profiles set is_test = false where id = v_pat;
  execute 'reset role';
  if exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL 2b: service_role could not clear profiles.is_test';
  end if;

  -- 3. controls: the guard still refuses everyone it should
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_sqlstate := null;
  begin update public.profiles set is_test = true where id = v_pat;
  exception when others then v_failed := true; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' then
    raise exception 'FAIL 3a: a patient could flag herself (failed=%, sqlstate=%)', v_failed, v_sqlstate;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_clin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false; v_err := null;
  begin update public.profiles set is_test = true where id = v_clin;
  exception when others then v_failed := true; v_err := sqlerrm; end;
  execute 'reset role';
  -- the refusal must be the guard's own message, not a privilege error
  if not v_failed or v_err !~ 'can only be changed by an admin or a service context' then
    raise exception 'FAIL 3b: a non-admin clinician was not stopped by the guard (failed=%, err=%)', v_failed, v_err;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.profiles set is_test = true where id = v_pat;
  execute 'reset role';
  if not exists (select 1 from public.profiles where id = v_pat and is_test) then
    raise exception 'FAIL 3c: an admin could not flag a test account';
  end if;
  update public.profiles set is_test = false where id = v_pat;
  perform set_config('request.jwt.claims', null, true);

  -- 4. SABOTAGE: the original SECURITY INVOKER function. Check 2 must now fail, with the original error.
  execute $f$
    create or replace function private.guard_is_test_flag() returns trigger
    language plpgsql set search_path to '' as $b$
    begin
      if (select auth.uid()) is null or private.is_admin() then return new; end if;
      return new;
    end; $b$ $f$;
  execute 'set local role service_role';
  v_failed := false; v_err := null; v_sqlstate := null;
  begin update public.profiles set is_test = true where id = v_pat;
  exception when others then v_failed := true; v_err := sqlerrm; get stacked diagnostics v_sqlstate = returned_sqlstate; end;
  execute 'reset role';
  if not v_failed or v_sqlstate <> '42501' or v_err !~ 'permission denied for schema private' then
    raise exception 'FAIL SABOTAGE 4: with the invoker function service_role did not fail with the original error (failed=%, sqlstate=%, err=%), so check 2 proves nothing', v_failed, v_sqlstate, v_err;
  end if;

  raise notice 'PASS guard_is_test_flag_service_role: service_role can set and clear is_test, the guard still refuses patient and non-admin staff, an admin can; sabotage (invoker) reproduces the original 42501';
end $$;

rollback;

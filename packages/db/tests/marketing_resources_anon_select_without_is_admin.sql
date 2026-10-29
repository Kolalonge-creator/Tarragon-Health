-- Proof for 20261029070008_marketing_resources_anon_select_without_is_admin.sql.
--
-- The old single SELECT policy (`to anon, authenticated using (is_published or private.is_admin())`)
-- made every anon read of public.marketing_resources fail with 42501 "permission denied for function
-- is_admin", because anon (correctly) cannot execute private.is_admin(). Proves, from simulated
-- sessions:
--   1. anon can read the table without an error and sees published rows only;
--   2. a signed-in non-admin sees published rows only;
--   3. an admin sees published and draft rows;
--   4. anon still cannot execute private.is_admin() (the fix must not grant it);
--   5. anon cannot write.
-- SABOTAGE: the old combined policy is put back; step 1 must then fail with 42501, proving this
-- test can fail. The whole file rolls back.
begin;

do $$
declare
  v_org   constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin constant uuid := gen_random_uuid();
  v_user  constant uuid := gen_random_uuid();
  v_pub   int;
  v_draft int;
  v_all   int;
begin
  insert into public.marketing_resources (slug, title, description, category, is_published)
  values ('zz-proof-published', 'proof published', 'd', 'Proof', true),
         ('zz-proof-draft',     'proof draft',     'd', 'Proof', false);

  insert into auth.users (id, email) values
    (v_admin, 'mr-anon-proof-admin@example.invalid'),
    (v_user,  'mr-anon-proof-user@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_admin, v_org, 'admin'::public.user_role, 'MR Proof Admin')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_user, v_org, 'patient'::public.user_role, 'MR Proof Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  -- 1. anon: no error, published only (the unrestricted count is what used to raise 42501)
  set local role anon;
  select count(*) into v_all from public.marketing_resources;
  select count(*) filter (where slug = 'zz-proof-published'),
         count(*) filter (where slug = 'zz-proof-draft')
    into v_pub, v_draft from public.marketing_resources;
  reset role;
  if v_pub <> 1 or v_draft <> 0 or v_all < 1 then
    raise exception 'anon: expected 1 published / 0 draft / >=1 total, got % / % / %', v_pub, v_draft, v_all;
  end if;

  -- 2. signed-in non-admin: published only
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where slug = 'zz-proof-published'),
         count(*) filter (where slug = 'zz-proof-draft')
    into v_pub, v_draft from public.marketing_resources;
  reset role;
  if v_pub <> 1 or v_draft <> 0 then
    raise exception 'non-admin: expected 1 published / 0 draft, got % / %', v_pub, v_draft;
  end if;

  -- 3. admin: published and draft
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) filter (where slug = 'zz-proof-published'),
         count(*) filter (where slug = 'zz-proof-draft')
    into v_pub, v_draft from public.marketing_resources;
  reset role;
  perform set_config('request.jwt.claims', null, true);
  if v_pub <> 1 or v_draft <> 1 then
    raise exception 'admin: expected 1 published / 1 draft, got % / %', v_pub, v_draft;
  end if;

  -- 4. the fix must not hand anon the function
  if has_function_privilege('anon', 'private.is_admin()', 'EXECUTE') then
    raise exception 'anon can execute private.is_admin()';
  end if;

  -- 5. anon cannot write
  begin
    set local role anon;
    insert into public.marketing_resources (slug, title, description, category, is_published)
    values ('zz-proof-anon-write', 'x', 'd', 'Proof', true);
    reset role;
    raise exception 'anon was able to insert into marketing_resources';
  exception when insufficient_privilege then
    reset role;
  end;

  -- SABOTAGE: restore the old combined policy; anon's read must now fail with 42501.
  drop policy marketing_resources_anon_select on public.marketing_resources;
  drop policy marketing_resources_authenticated_select on public.marketing_resources;
  create policy marketing_resources_public_select on public.marketing_resources
    for select to anon, authenticated using (is_published or private.is_admin());
  begin
    set local role anon;
    perform count(*) from public.marketing_resources;
    reset role;
    raise exception 'sabotage did not bite: anon read succeeded under the old combined policy, so this proof does not discriminate';
  exception when insufficient_privilege then
    reset role;
  end;
end $$;

rollback;

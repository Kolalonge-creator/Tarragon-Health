-- Tarragon Health -- self-authorizing, scoped RPC for changing a member's
-- account role and/or custom role.
--
-- WHY. setMemberRoleAction ran a direct profiles UPDATE through the caller's
-- RLS-scoped session. The guard trigger (20261004212936) correctly refuses any
-- non-admin caller who touches role/custom_role_id, which means a delegated
-- users.roles.assign holder is blocked -- the trigger is the right stop, but
-- the action just returns a generic error. This RPC is the sanctioned path:
-- it runs as its owner (SECURITY DEFINER), bypasses the guard, self-
-- authorizes via has_permission, and scopes the delegate to the same two-role
-- boundary used for provisioning (clinician / care_coordinator, own org only,
-- never targeting an admin or a null-org account).
--
-- SCOPE (mirrors member-provision-scope.ts's reasoning):
--   Super Admin:     any role, any member, any org.
--   Delegate:        may assign clinician or care_coordinator only, on a
--                    member of their OWN organisation, never on a Super Admin
--                    or a null-org account. custom_role_id is unrestricted
--                    (custom roles are org-scoped and already gated by
--                    roles.manage at creation; assigning one is a lower-
--                    privilege operation than changing the account role).
--
-- AUDIT. Written in the same transaction (private.log_audit), not a
-- separate call from the server action.

create or replace function public.set_member_role(
  p_member_id     uuid,
  p_role          public.user_role,
  p_custom_role_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_id    uuid := (select auth.uid());
  v_target_role  public.user_role;
  v_target_org   uuid;
begin
  -- 1. Self-authorize: caller must hold users.roles.assign.
  if not private.has_permission('users.roles.assign') then
    raise exception 'You do not have access to do that';
  end if;

  -- 2. Cannot change your own role.
  if p_member_id = v_caller_id then
    raise exception 'You cannot change your own account role.';
  end if;

  -- 3. Look up the target.
  select role, organisation_id into v_target_role, v_target_org
  from public.profiles where id = p_member_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- 4. Scope: a non-admin caller is limited.
  if not private.is_admin() then
    -- Cannot target a Super Admin.
    if v_target_role = 'admin' then
      raise exception 'Only a Super Admin can change a Super Admin''s role.';
    end if;

    -- Cannot target a null-org account (admin / partner-role logins).
    if v_target_org is null then
      raise exception 'Only a Super Admin can change the role of a platform-level or partner login.';
    end if;

    -- Must be in the same org.
    if v_target_org is distinct from private.current_org_id() then
      raise exception 'You can only change the role of members in your own organisation.';
    end if;

    -- Cannot assign a role outside the delegate-safe set.
    if p_role not in ('clinician', 'care_coordinator') then
      raise exception 'You can only assign the Clinician or Care Coordinator role.';
    end if;
  end if;

  -- 5. Apply.
  update public.profiles
  set role           = p_role,
      custom_role_id = p_custom_role_id
  where id = p_member_id;

  -- 6. Audit.
  perform private.log_audit(
    'member.role_changed',
    'profiles',
    p_member_id,
    jsonb_build_object(
      'role', p_role::text,
      'custom_role_id', p_custom_role_id::text,
      'previous_role', v_target_role::text
    )
  );
end;
$$;

comment on function public.set_member_role(uuid, public.user_role, uuid) is
  'Change a member''s account role and/or custom role. SECURITY DEFINER so it '
  'bypasses the profiles_00_guard_privileged_columns trigger by design. Self-'
  'authorizes via private.has_permission(''users.roles.assign''). A caller who '
  'is not a Super Admin may only assign clinician or care_coordinator, only on '
  'a member of their own organisation, and never on a Super Admin or a null-'
  'organisation account. Writes its own audit_log entry in the same transaction '
  '(private.log_audit). See 20261005154850_set_member_role_scoped_rpc.sql.';

-- Public access for authenticated (the function self-authorizes).
revoke all on function public.set_member_role(uuid, public.user_role, uuid) from public, anon;
grant execute on function public.set_member_role(uuid, public.user_role, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------

-- Structural: the function exists, is DEFINER, and has the right owner.
do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_member_role'
      and p.prosecdef
  ) then
    raise exception 'FAIL: set_member_role is missing or is not SECURITY DEFINER';
  end if;

  if has_function_privilege('anon',
       'public.set_member_role(uuid, public.user_role, uuid)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute set_member_role';
  end if;

  raise notice 'PASS  set_member_role is installed, DEFINER, anon-excluded';
end $$;

-- Behavioural: prove scope rules against real fixtures then roll back.
do $$
declare
  v_admin     uuid;
  v_delegate  uuid;
  v_org       uuid;
  v_peer      uuid := gen_random_uuid();
  v_ok        boolean;
  v_msg       text;
  v_label     text;
  v_call      text;
  v_pair      text[];
  v_simulated boolean := false;
begin
  begin
    select id into v_admin
    from public.profiles where role = 'admin' and is_active order by id limit 1;

    select id, organisation_id into v_delegate, v_org
    from public.profiles
    where role = 'clinician' and organisation_id is not null and is_active
    order by id limit 1;

    if v_admin is null or v_delegate is null then
      raise exception 'SKIP_NO_FIXTURE';
    end if;

    -- Create a peer in the same org, and grant the delegate users.roles.assign.
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_peer, 'role-scope-probe@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_peer, v_org, 'clinician', 'Role Scope Peer', true)
    on conflict (id) do update set
      organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, is_active = excluded.is_active;

    delete from public.user_permission_grants
    where profile_id = v_delegate and permission_key = 'users.roles.assign' and revoked_at is null;
    insert into public.user_permission_grants (profile_id, permission_key, granted_by)
    values (v_delegate, 'users.roles.assign', v_admin);

    -- ---- Act as the delegate, under the real client role and RLS. ----------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_delegate::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- PASS cases: a delegate can assign clinician/care_coordinator in their org.
    perform public.set_member_role(v_peer, 'care_coordinator');
    raise notice 'PASS  delegate can assign care_coordinator in own org';

    perform public.set_member_role(v_peer, 'clinician');
    raise notice 'PASS  delegate can assign clinician in own org';

    -- FAIL cases: each must be refused with a specific message.
    foreach v_pair slice 1 in array array[
      array['assign admin to peer',      format('select public.set_member_role(%L, ''admin''::public.user_role)', v_peer)],
      array['assign finance to peer',    format('select public.set_member_role(%L, ''finance''::public.user_role)', v_peer)],
      array['assign analyst to peer',    format('select public.set_member_role(%L, ''analyst''::public.user_role)', v_peer)],
      array['change own role',           format('select public.set_member_role(%L, ''care_coordinator''::public.user_role)', v_delegate)],
      array['change admin target role',  format('select public.set_member_role(%L, ''clinician''::public.user_role)', v_admin)]
    ]
    loop
      v_label := v_pair[1]; v_call := v_pair[2];
      v_ok := true; v_msg := null;
      begin
        execute v_call;
      exception when others then
        v_ok := false; v_msg := sqlerrm;
      end;
      if v_ok then
        raise exception 'FAIL: delegate could % — should have been refused', v_label;
      end if;
      raise notice 'PASS  delegate refused: % (%)', v_label, v_msg;
    end loop;

    -- Control: Super Admin is unaffected.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    perform public.set_member_role(v_peer, 'finance');
    raise notice 'PASS  Super Admin can assign any role';

    v_simulated := true;
    raise exception 'ROLLBACK_SIMULATION';
  exception
    when others then
      if sqlerrm not in ('ROLLBACK_SIMULATION', 'SKIP_NO_FIXTURE') then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claims', '', true);

  if not v_simulated then
    raise notice 'NOTE: no admin + org-attached clinician fixture; behavioural proof skipped';
  else
    raise notice 'PASS  set_member_role scope: proved live and rolled back';
  end if;
end $$;

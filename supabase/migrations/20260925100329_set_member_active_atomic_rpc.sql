-- Tarragon Health — make suspending/reinstating a login a single atomic,
-- self-authorizing operation, closing three real bugs a code review found in
-- setMemberActiveAction's original two-round-trip, RLS-scoped implementation
-- (apps/web/src/app/(dashboard)/admin/settings/members/actions.ts, added
-- alongside 20260925093444_enforce_profiles_is_active_in_core_authz.sql and
-- 20260925094425_users_suspend_permission.sql):
--
--  1. SILENT NO-OP on any target whose organisation_id is null. The action's
--     write ran through the RLS-scoped client, and profiles_update's policy
--     is `id = auth.uid() OR (organisation_id IS NOT NULL AND
--     private.is_org_staff(organisation_id))` -- there is no is_admin()
--     branch at all, and the org-staff branch requires a NON-NULL
--     organisation_id. Super Admin accounts are routinely provisioned with
--     organisation_id = null (provisionMemberAction: `organisation_id:
--     input.organisationId ?? null`), and so are lab_partner/payer_admin/
--     provider_org_staff/ngo_admin (the same four roles is_org_staff's own
--     migration excludes -- confirmed via admin_link_lab_partner's design).
--     An admin suspending any such account matched ZERO rows under RLS,
--     Supabase returned {error: null}, and the action happily reported
--     "Login suspended." + wrote a false audit_log entry -- while the
--     account kept full access. This made the is_active enforcement from
--     20260925093444 a no-op for exactly the accounts (Super Admin peers,
--     partner-role logins) most likely to need suspending.
--  2. TOCTOU race in the "don't suspend the last active Super Admin" guard:
--     the count-check and the update were two separate, unlocked round
--     trips. Two concurrent suspend calls against two different admins could
--     each see the other as "still active" and both proceed, leaving zero
--     active admins with nobody left holding is_admin()/users.suspend to
--     undo it.
--  3. Fail-open: the target's role lookup discarded its own error, so a
--     transient failure silently skipped the last-admin guard entirely
--     rather than refusing.
--
-- A single SECURITY DEFINER function fixes all three at once: it bypasses
-- RLS by design (closing #1 for every role, not just admin), authorizes
-- itself internally via private.has_permission('users.suspend') rather than
-- trusting the caller (this function is reachable directly via
-- supabase.rpc(), not only through the Next.js server action, so it cannot
-- assume the app-layer check already ran), serializes concurrent suspend
-- calls with a transaction-scoped advisory lock keyed to the admin roster
-- (closing #2 without the retry churn of relying on deadlock detection), and
-- raises a real exception instead of silently discarding a lookup error
-- (closing #3 -- a failed lookup now aborts the whole call).
--
-- Hardening added after a second review of this function (same migration, since
-- it has not shipped):
--  4. SCOPE. users.suspend is a delegable permission, and a SECURITY DEFINER
--     function that bypasses RLS must not hand a delegate more reach than the
--     RLS it bypasses. Unscoped, any holder could suspend or reinstate any
--     member of any organisation, including a Super Admin. A caller who is not
--     a Super Admin may now only act on members of their OWN organisation, and
--     never on a Super Admin or on a null-organisation account (those are
--     Super Admin and partner-role logins, Super-Admin-managed by design).
--  5. AUDIT. The audit_log entry is written inside this function, in the same
--     transaction as the change, via private.log_audit. It used to be a
--     separate call from the server action, so a failure there left a
--     suspension with no audit trail.
--  The last-active-Super-Admin guard is kept as defence in depth, but with (4)
--  it can only be reached by a caller who is themselves an active Super Admin,
--  who by definition keeps the roster non-empty. It stays so a future change to
--  the scoping rule cannot silently re-open it.

create or replace function public.set_member_active(p_member_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target_role public.user_role;
  v_target_org uuid;
  v_other_active_admins integer;
begin
  if not private.has_permission('users.suspend') then
    raise exception 'You do not have access to do that';
  end if;

  if p_member_id = (select auth.uid()) and not p_active then
    raise exception 'You can''t suspend your own account.';
  end if;

  if not p_active then
    -- Serialize every concurrent suspend call against the admin roster (a
    -- transaction-scoped advisory lock, released automatically at commit/
    -- rollback) so two simultaneous "suspend a different admin" calls can't
    -- both read a safe count before either write lands.
    perform pg_advisory_xact_lock(hashtext('set_member_active:admin_roster'));
  end if;

  select role, organisation_id into v_target_role, v_target_org
  from public.profiles where id = p_member_id;
  if not found then
    raise exception 'Member not found';
  end if;

  -- Scope: only a Super Admin has platform-wide reach. A delegated
  -- users.suspend holder is limited to their own organisation, and never
  -- touches a Super Admin or a null-organisation (partner / admin-shaped)
  -- account. A null caller organisation never matches: `is distinct from`
  -- treats null as a value, and v_target_org is rejected when null above it.
  if not private.is_admin() then
    if v_target_role = 'admin' then
      raise exception 'Only a Super Admin can suspend or reinstate a Super Admin.';
    end if;
    if v_target_org is null or v_target_org is distinct from private.current_org_id() then
      raise exception 'You can only suspend or reinstate members of your own organisation.';
    end if;
  end if;

  if not p_active and v_target_role = 'admin' then
    select count(*) into v_other_active_admins
    from public.profiles
    where role = 'admin' and is_active and id <> p_member_id;

    if v_other_active_admins = 0 then
      raise exception 'Can''t suspend the last remaining active Super Admin.';
    end if;
  end if;

  update public.profiles set is_active = p_active where id = p_member_id;

  perform private.log_audit(
    case when p_active then 'member.reinstated' else 'member.suspended' end,
    'profiles',
    p_member_id,
    jsonb_build_object('target_role', v_target_role)
  );
end;
$$;

comment on function public.set_member_active(uuid, boolean) is
  'Suspend or reinstate a staff/partner login (profiles.is_active). SECURITY DEFINER '
  'so it bypasses profiles_update RLS by design -- that policy has no is_admin() '
  'branch and requires a non-null organisation_id, which silently no-op''d a suspend '
  'against any admin/lab_partner/payer_admin/provider_org_staff/ngo_admin account '
  '(all null-org by design). Self-authorizes via private.has_permission(''users.suspend'') '
  'since this is reachable directly via supabase.rpc(), not only via the app-layer '
  'server action. Refuses self-suspension and suspending the platform''s last active '
  'Super Admin, the latter serialized against concurrent callers with a transaction-scoped '
  'advisory lock. A caller who is not a Super Admin may only act on members of their own '
  'organisation, never on a Super Admin or a null-organisation account. Writes its own '
  'audit_log entry in the same transaction (private.log_audit). See '
  '20260925100329_set_member_active_atomic_rpc.sql for the bugs this closes in the action '
  'it replaces.';

revoke all on function public.set_member_active(uuid, boolean) from public, anon;
grant execute on function public.set_member_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope. Live, rolled back, against real fixtures where available.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin_a      uuid;
  v_admin_b      uuid;
  v_peer_id      uuid;
  v_null_org_id  uuid := gen_random_uuid();
  v_clinician_id uuid;
  v_clinician_org uuid;
  v_ok           boolean;
  v_simulated    boolean := false;
begin
  select id into v_admin_a from public.profiles where role = 'admin' order by id limit 1;
  select id, organisation_id into v_clinician_id, v_clinician_org
  from public.profiles where role = 'clinician' and organisation_id is not null order by id limit 1;

  begin
    -- Raised inside this block on purpose: the handler below swallows
    -- SKIP_NO_FIXTURE, so an empty database (CI replay) skips the behavioural
    -- proof instead of aborting the whole migration.
    if v_admin_a is null or v_clinician_id is null then
      raise exception 'SKIP_NO_FIXTURE';
    end if;

    -- ---- 1. Self-authorization: a caller with no users.suspend cannot call
    --         this at all, even though it's SECURITY DEFINER. ---------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id::text, 'role', 'authenticated')::text, true);
    v_ok := true;
    begin
      perform public.set_member_active(v_admin_a, false);
    exception when others then v_ok := false;
    end;
    perform set_config('request.jwt.claims', '', true);
    if v_ok then
      raise exception 'FAIL: a caller with no users.suspend permission could call set_member_active';
    end if;
    raise notice 'PASS  set_member_active refuses a caller with no users.suspend permission, even though the function is SECURITY DEFINER';

    -- ---- 2. Self-suspend is refused, as the admin. ------------------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_a::text, 'role', 'authenticated')::text, true);
    v_ok := true;
    begin
      perform public.set_member_active(v_admin_a, false);
    exception when others then v_ok := false;
    end;
    if v_ok then
      raise exception 'FAIL: an admin could suspend their own account via set_member_active';
    end if;
    raise notice 'PASS  set_member_active refuses self-suspension';

    -- ---- 3. THE targeted proof of bug #1: a null-organisation_id account
    --         (the exact shape a Super Admin or lab_partner/payer_admin/
    --         provider_org_staff/ngo_admin account has) is genuinely
    --         suspended -- the old RLS-scoped update silently no-op'd here.
    -- -----------------------------------------------------------------------
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_null_org_id, 'set-member-active-fixture@example.invalid', 'x', now(), '{}', '{}');
    -- handle_new_user() already auto-provisioned a public.profiles row from the
    -- auth.users insert above -- upsert, don't insert, or this collides on the PK.
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_null_org_id, null, 'lab_partner', 'Set-Member-Active Fixture (null org)', true)
    on conflict (id) do update set
      organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, is_active = excluded.is_active;

    perform public.set_member_active(v_null_org_id, false);
    if (select is_active from public.profiles where id = v_null_org_id) then
      raise exception 'FAIL: set_member_active did not suspend a null-organisation_id account -- the exact bug this migration exists to close';
    end if;
    raise notice 'PASS  set_member_active genuinely suspends a null-organisation_id account (lab_partner/payer_admin/provider_org_staff/ngo_admin/admin shape) -- the old RLS-scoped update silently no-op''d here';

    perform public.set_member_active(v_null_org_id, true);
    if not (select is_active from public.profiles where id = v_null_org_id) then
      raise exception 'FAIL: set_member_active did not reinstate the null-organisation_id account';
    end if;
    raise notice 'PASS  set_member_active reinstates it again';

    -- ---- 4. Scope. A delegated users.suspend holder (the clinician fixture,
    --         granted the permission directly -- same pattern as
    --         20260925093444's has_permission proof) is limited to their own
    --         organisation and never touches a Super Admin or a null-
    --         organisation account. Two refusals, then a sabotage control
    --         proving the scope reads live state: the very same caller CAN
    --         suspend a non-admin in their own organisation, and that change
    --         writes its own audit_log row. ----------------------------------
    perform set_config('request.jwt.claims', '', true);
    delete from public.user_permission_grants
    where profile_id = v_clinician_id and permission_key = 'users.suspend' and revoked_at is null;
    insert into public.user_permission_grants (profile_id, permission_key, granted_by)
    values (v_clinician_id, 'users.suspend', v_admin_a);

    v_peer_id := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_peer_id, 'set-member-active-peer@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_peer_id, v_clinician_org, 'clinician', 'Set-Member-Active Fixture Peer (same org)', true)
    on conflict (id) do update set
      organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, is_active = excluded.is_active;

    -- A second active Super Admin, so the refusal below can only come from the
    -- scope rule and not from the last-active-Super-Admin guard.
    v_admin_b := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_admin_b, 'set-member-active-admin-b@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_admin_b, null, 'admin', 'Set-Member-Active Fixture Admin B', true)
    on conflict (id) do update set
      organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, is_active = excluded.is_active;

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id::text, 'role', 'authenticated')::text, true);

    v_ok := true;
    begin
      perform public.set_member_active(v_admin_a, false);
    exception when others then v_ok := false;
    end;
    if v_ok then
      raise exception 'FAIL: a delegated users.suspend holder suspended a Super Admin';
    end if;
    raise notice 'PASS  a delegated users.suspend holder cannot suspend a Super Admin';

    v_ok := true;
    begin
      perform public.set_member_active(v_null_org_id, false);
    exception when others then v_ok := false;
    end;
    if v_ok then
      raise exception 'FAIL: a delegated users.suspend holder suspended a null-organisation account outside their own organisation';
    end if;
    raise notice 'PASS  a delegated users.suspend holder cannot suspend a null-organisation (partner / admin-shaped) account';

    perform public.set_member_active(v_peer_id, false);
    perform set_config('request.jwt.claims', '', true);
    if (select is_active from public.profiles where id = v_peer_id) then
      raise exception 'GAP: a delegated users.suspend holder could not suspend a non-admin in their own organisation -- the scope rule is refusing everything, not just out-of-scope targets';
    end if;
    raise notice 'PASS  sabotage control: the same caller can suspend a non-admin in their own organisation, so the scope rule is reading live state';

    if (select count(*) from public.audit_log
        where action = 'member.suspended' and entity_type = 'profiles'
          and entity_id = v_peer_id and actor_id = v_clinician_id) <> 1 then
      raise exception 'FAIL: set_member_active did not write exactly one audit_log row for the suspension it performed';
    end if;
    raise notice 'PASS  set_member_active writes its own audit_log row in the same transaction';

    -- ---- 5. The last-active-Super-Admin guard is kept as defence in depth.
    --         With the scope rule it is unreachable through the function (a
    --         caller able to target an admin is an active admin, who keeps the
    --         roster non-empty), so assert the guard is still in the body
    --         rather than pretending to exercise it. -------------------------
    if (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_member_active') not like '%last remaining active Super Admin%' then
      raise exception 'FAIL: set_member_active lost its last-active-Super-Admin guard';
    end if;
    raise notice 'PASS  set_member_active still carries the last-active-Super-Admin guard (defence in depth)';

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
    raise notice 'NOTE: no admin + org-attached clinician fixture pair existed, so the behavioural proof was skipped';
  else
    raise notice 'PASS  set_member_active: all checks passed, proved live and rolled back';
  end if;
end $$;

-- Tarragon Health — make profiles.is_active actually block access, in the three
-- functions that are the real security boundary.
--
-- Real gap found 2026-09-25 while building an admin "suspend a departing staff
-- member's login" action for /admin/settings/members: profiles.is_active exists
-- (default true, guarded from self-edit by private.guard_profiles_self_update),
-- is displayed in the members UI as an "Active"/"Inactive" badge, and is even
-- referenced in that self-update guard's own migration comment ("Org staff
-- editing another profile in their own org, or an admin, are exempt -- they go
-- through the intended admin-gated app-layer flows") as though flipping it were
-- meant to do something. It never has. Confirmed live via pg_get_functiondef:
-- private.is_org_staff(uuid) -- the function CLAUDE.md calls "the highest-leverage
-- security function in the codebase", gating ~110 patient-scoped tables --
-- private.is_admin(), and private.has_permission(text) all read profiles.role
-- (and, for has_permission's grant branches, user_permission_grants) with no
-- reference to is_active anywhere. A deactivated clinician, care_coordinator, or
-- even a deactivated super admin keeps every RLS-level privilege their role and
-- grants would otherwise give them -- flipping is_active today only changes what
-- a badge says.
--
-- This closes it at the root, in the three functions everything else is built
-- on, rather than adding an is_active check to ~300 individual policies:
--   1. private.is_org_staff(org)  -- add `and is_active` to the base predicate.
--   2. private.is_admin()         -- same.
--   3. private.has_permission(perm) -- add `and p.is_active` to all three
--      branches (super-admin, direct grant, custom-role bundle); the direct
--      grant branch didn't join profiles at all before this, so a deactivated
--      account's own individually-granted permissions kept working forever.
--
-- Each rewrite is otherwise byte-for-byte the current live definition (pulled
-- via pg_get_functiondef immediately before writing this migration, per the
-- standing "a migration file's committed body is not proof of what a live
-- function does" lesson -- is_org_staff's own git history undercounts its real
-- exclusion list; the live function already carries an `ngo_admin` exclusion
-- with no matching migration file on this branch, preserved verbatim below).
--
-- App-layer note: apps/web/src/lib/auth/current-profile.ts's getCurrentProfile()
-- is deliberately NOT changed here to also treat is_active=false as signed-out.
-- That would improve the UX (a clean "your account was deactivated" redirect
-- instead of a series of empty-result RLS reads) but isn't the security
-- boundary -- CLAUDE.md is explicit that RLS at the Postgres level is that
-- boundary, never application-code filtering. Worth doing as a follow-up.

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and is_active
  );
$$;

comment on function private.is_admin() is
  'True for a super admin (role = admin) whose login has not been deactivated. Deactivating a super admin (profiles.is_active = false) revokes this immediately -- added 2026-09-25, see 20260925093444_enforce_profiles_is_active_in_core_authz.sql for why this was previously a no-op.';

create or replace function private.is_org_staff(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and is_active
      and role <> 'patient'
      -- I9: an institution administrator is not care-team staff.
      and role not in ('corporate_admin', 'hmo_admin')
      -- Nor is a partner employee or a back-office account. Excluded here
      -- rather than in 314 individual policies. lab_partner joins this list.
      and role not in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst')
      -- Nor is an insurer's administrator (module 27) or a partner
      -- organisation's staff (module 28). Both are counterparties who
      -- transact with Tarragon; neither is on a patient's care team.
      and role not in ('payer_admin', 'provider_org_staff')
      -- Nor is an NGO/PHC/government funding partner's administrator
      -- (module: ngo_funded_cohort). They fund a place; they do not join the
      -- beneficiary's care team, and must never read the beneficiary's
      -- clinical record through this function. See
      -- packages/db/tests/ngo_funded_cohort.sql for the sabotage proof.
      and role not in ('ngo_admin')
      and (role = 'admin' or organisation_id = org)
  );
$$;

comment on function private.is_org_staff(uuid) is
  'Tarragon care-team and operations staff for an organisation: clinician, '
  'care_coordinator, nurse, and the admin super-user -- provided the account has '
  'not been deactivated (profiles.is_active). Institution admins (I9), partner '
  'employees (pharmacist, lab_partner, lab_liaison), back-office roles (finance, '
  'analyst), the two counterparty platform roles (payer_admin, '
  'provider_org_staff), and NGO/funding-partner admins (ngo_admin) are all '
  'excluded and are served by named grants or their own SECURITY DEFINER RPCs '
  'instead. is_active gate added 2026-09-25; see that migration''s header for '
  'why this had never been enforced before despite the column existing.';

create or replace function private.has_permission(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- super admin ⇒ holds every capability, provided the account is active
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'admin' and p.is_active
  )
  -- direct per-user grant (active grant, active account)
  or exists (
    select 1 from public.user_permission_grants g
    join public.profiles p on p.id = g.profile_id
    where g.profile_id = (select auth.uid())
      and g.permission_key = perm
      and g.revoked_at is null
      and p.is_active
  )
  -- inherited from the caller's assigned custom role bundle (active account)
  or exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.custom_role_id = p.custom_role_id
    where p.id = (select auth.uid())
      and rp.permission_key = perm
      and p.is_active
  );
$$;

comment on function private.has_permission(text) is
  'Core RBAC predicate: true for a super admin, or an account holding perm via a '
  'direct grant or its assigned custom role bundle -- in every branch, only while '
  'the account is active (profiles.is_active). Deactivating an account now '
  'revokes every delegated capability immediately, not just its base role. '
  'is_active gate added 2026-09-25.';

-- ---------------------------------------------------------------------------
-- Proof, not hope.
--
-- Part 1: text assertions -- catch a careless rewrite dropping the is_active
-- check, or (for is_org_staff) any of its existing role exclusions.
-- Part 2: a genuine behavioural proof against real, live accounts. For each of
-- the three functions: confirm a real account PASSES while active (the
-- control -- without this, a proof made only of negatives proves nothing),
-- then deactivate that same account and confirm it now FAILS. The whole
-- simulation runs inside a subtransaction that is deliberately rolled back
-- (ROLLBACK_SIMULATION), so no live profile or grant is left modified. Claims
-- are cleared before every UPDATE/INSERT so private.guard_profiles_self_update
-- never sees these as the account owner self-editing is_active.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src_admin      text;
  v_src_org_staff  text;
  v_src_has_perm   text;
begin
  select prosrc into v_src_admin
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'is_admin';
  if v_src_admin not like '%is_active%' then
    raise exception 'FAIL: is_admin lost the is_active gate';
  end if;

  select prosrc into v_src_org_staff
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'is_org_staff';
  if v_src_org_staff not like '%is_active%' then
    raise exception 'FAIL: is_org_staff lost the is_active gate';
  end if;
  if v_src_org_staff not like '%ngo_admin%' then
    raise exception 'FAIL: is_org_staff lost the ngo_admin exclusion this migration preserved from the live definition';
  end if;

  select prosrc into v_src_has_perm
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'has_permission';
  if (select count(*) from regexp_matches(v_src_has_perm, 'is_active', 'g')) < 3 then
    raise exception 'FAIL: has_permission does not gate all three branches (super admin, direct grant, custom role) on is_active';
  end if;

  raise notice 'PASS: all three functions'' source carries the is_active gate (is_org_staff also still carries its ngo_admin exclusion)';
end $$;

do $$
declare
  v_admin_id       uuid;
  v_clinician_id   uuid;
  v_clinician_org  uuid;
  v_admin_control  boolean;
  v_admin_after    boolean;
  v_org_control    boolean;
  v_org_after      boolean;
  v_perm_control   boolean;
  v_perm_after     boolean;
  v_simulated      boolean := false;
begin
  select id into v_admin_id from public.profiles where role = 'admin' order by id limit 1;
  select id, organisation_id into v_clinician_id, v_clinician_org
  from public.profiles where role = 'clinician' and organisation_id is not null order by id limit 1;

  if v_admin_id is null or v_clinician_id is null then
    raise exception 'SKIP_NO_FIXTURE';
  end if;

  begin
    -- ---- is_admin(): control, then deactivate, then re-check -------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
    v_admin_control := private.is_admin();

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = false where id = v_admin_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin_id, 'role', 'authenticated')::text, true);
    v_admin_after := private.is_admin();

    -- Reactivate before the next check reuses this same account as a control.
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = v_admin_id;

    -- ---- is_org_staff(org): control, then deactivate, then re-check ------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id, 'role', 'authenticated')::text, true);
    v_org_control := private.is_org_staff(v_clinician_org);

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = false where id = v_clinician_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id, 'role', 'authenticated')::text, true);
    v_org_after := private.is_org_staff(v_clinician_org);

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = v_clinician_id;

    -- ---- has_permission(): a fresh direct grant, then deactivate ----------
    -- Clear any pre-existing active grant for this exact key first (safe --
    -- the whole subtransaction is rolled back below) so the insert can't hit
    -- the partial unique index and abort the simulation on an unrelated
    -- unique-violation instead of proving anything.
    delete from public.user_permission_grants
    where profile_id = v_clinician_id and permission_key = 'users.contact.edit' and revoked_at is null;
    insert into public.user_permission_grants (profile_id, permission_key, granted_by)
    values (v_clinician_id, 'users.contact.edit', v_admin_id);

    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id, 'role', 'authenticated')::text, true);
    v_perm_control := private.has_permission('users.contact.edit');

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = false where id = v_clinician_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_clinician_id, 'role', 'authenticated')::text, true);
    v_perm_after := private.has_permission('users.contact.edit');

    v_simulated := true;
    raise exception 'ROLLBACK_SIMULATION';
  exception
    when others then
      if sqlerrm not in ('ROLLBACK_SIMULATION', 'SKIP_NO_FIXTURE') then
        raise;
      end if;
  end;

  if not v_simulated then
    raise notice 'NOTE: no admin + org-attached clinician fixture pair existed, so the behavioural proof was skipped; the text assertions above still ran';
  else
    if not v_admin_control then
      raise exception 'FAIL: the is_admin control failed -- a real active super admin does not satisfy is_admin(), so the negative below proves nothing';
    end if;
    if v_admin_after then
      raise exception 'FAIL: a deactivated super admin still satisfies is_admin()';
    end if;

    if not v_org_control then
      raise exception 'FAIL: the is_org_staff control failed -- a real active clinician does not satisfy is_org_staff() for their own org, so the negative below proves nothing';
    end if;
    if v_org_after then
      raise exception 'FAIL: a deactivated clinician still satisfies is_org_staff() for their own org';
    end if;

    if not v_perm_control then
      raise exception 'FAIL: the has_permission control failed -- a real active account with a fresh direct grant does not satisfy has_permission(), so the negative below proves nothing';
    end if;
    if v_perm_after then
      raise exception 'FAIL: a deactivated account with an active, non-revoked direct grant still satisfies has_permission()';
    end if;

    raise notice 'PASS: is_admin / is_org_staff / has_permission all flip from true to false the moment profiles.is_active goes false, proved live on real accounts and rolled back';
  end if;
end $$;

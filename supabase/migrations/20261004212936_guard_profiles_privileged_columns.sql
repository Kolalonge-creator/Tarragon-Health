-- Tarragon Health -- stop a signed-in user rewriting authority columns on public.profiles.
--
-- THE HOLE (confirmed against the live database with a rolled-back probe,
-- 2026-10-04). public.profiles_update lets a caller update a row when
-- `id = auth.uid()` OR the caller is org staff of the row's organisation, and
-- the `authenticated` role holds UPDATE on role, is_active, organisation_id,
-- custom_role_id and the partner columns. The one trigger that should stop
-- privileged edits, private.guard_profiles_self_update, only applies to an
-- account owner who is neither a Super Admin nor org staff of their own
-- organisation -- so an active clinician or care coordinator attached to an
-- organisation walks straight past it. With zero delegated permissions, one
-- direct UPDATE could:
--   * set a colleague's role to 'admin'                (probe B1: 1 row updated)
--   * suspend a colleague (is_active = false)           (probe B2: 1 row updated)
--   * set their OWN role to 'admin'                     (probe B3: 1 row updated)
-- and, from the policy as written, move their own organisation_id (tenant escape).
-- Every other protection layered on role / is_active (is_admin, is_org_staff,
-- has_permission, the helpers gated in 20261004210421, set_member_active) sits on
-- top of those columns, so this undermines all of it.
--
-- THE FIX. A BEFORE UPDATE trigger that refuses any change to the authority
-- columns when the statement is executed AS THE CLIENT ROLE ITSELF by someone who
-- is not a Super Admin. It is SECURITY INVOKER on purpose, so `current_user` is
-- the role actually executing the write:
--   * a direct PostgREST update runs as 'authenticated' (or 'anon')   -> guarded
--   * a write made inside a SECURITY DEFINER function (set_member_active,
--     merge_patient_records, admin_link_lab_partner, admin_link_pharmacist,
--     admin_set_partner_admin, ...) runs as the function owner         -> allowed;
--     those functions authorize themselves, and some are deliberately delegable
--   * a write from a trigger on another table (roster / metadata syncs), the
--     service role, migrations and system jobs                         -> allowed
--   * a Super Admin (private.is_admin(): active, role = 'admin')       -> allowed
-- so no existing definer function needs touching, and a function that is not
-- SECURITY DEFINER but still lets a client reach these columns IS caught.
--
-- The trigger is named profiles_00_... so it fires before profiles_assign_* and
-- the other BEFORE triggers (they run in name order) and the refusal is the
-- error the caller sees. `UPDATE OF` limits it to statements whose SET list
-- names a guarded column, so ordinary profile edits never reach it.
--
-- NOT changed here: private.guard_profiles_self_update (its other protected
-- columns -- patient_number, staff_number, identity_verified_at, merged_*, ... --
-- keep exactly their current behaviour), the provisioning path
-- (provisionMemberAction uses the service role and has no caller check; that is
-- an application fix), and setMemberRoleAction, which updates profiles through
-- the caller's own session and will now be refused for a delegated
-- users.roles.assign holder (a Super Admin is unaffected, nobody holds that
-- permission today). It needs a self-authorizing RPC, in a follow-up.

create or replace function private.guard_profiles_privileged_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only a write executed as the client role itself is in scope. Definer
  -- functions run as their owner, and the service role, migrations and system
  -- jobs run as their own roles.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if private.is_admin() then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.custom_role_id is distinct from old.custom_role_id then
    raise exception 'profiles.custom_role_id can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'profiles.organisation_id can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'profiles.is_active can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.lab_provider_id is distinct from old.lab_provider_id then
    raise exception 'profiles.lab_provider_id can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.pharmacy_partner_id is distinct from old.pharmacy_partner_id then
    raise exception 'profiles.pharmacy_partner_id can only be changed by a Super Admin' using errcode = '42501';
  end if;
  if new.is_partner_admin is distinct from old.is_partner_admin then
    raise exception 'profiles.is_partner_admin can only be changed by a Super Admin' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function private.guard_profiles_privileged_columns() is
  'BEFORE UPDATE guard on public.profiles. Refuses a change to role, custom_role_id, '
  'organisation_id, is_active, lab_provider_id, pharmacy_partner_id or is_partner_admin '
  'when the write is executed as the authenticated/anon client role by anyone who is not '
  'a Super Admin. SECURITY INVOKER so current_user is the executing role: writes made '
  'inside SECURITY DEFINER functions (which authorize themselves), triggers on other '
  'tables, the service role and migrations are allowed. See '
  '20261004212936_guard_profiles_privileged_columns.sql.';

revoke all on function private.guard_profiles_privileged_columns() from public, anon, authenticated;

drop trigger if exists profiles_00_guard_privileged_columns on public.profiles;
create trigger profiles_00_guard_privileged_columns
  before update of role, custom_role_id, organisation_id, is_active,
                   lab_provider_id, pharmacy_partner_id, is_partner_admin
  on public.profiles
  for each row
  execute function private.guard_profiles_privileged_columns();

-- ---------------------------------------------------------------------------
-- Proof, not hope. The structural half always runs. The behavioural half runs
-- against real fixtures where available, as the real client role under row
-- level security, and is rolled back.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_00_guard_privileged_columns'
      and not tgisinternal and tgenabled = 'O'
  ) then
    raise exception 'FAIL: profiles_00_guard_privileged_columns is missing or disabled';
  end if;

  if (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' and p.proname = 'guard_profiles_privileged_columns') then
    raise exception 'FAIL: the guard is SECURITY DEFINER, so current_user would always be its owner and it would never fire';
  end if;
  raise notice 'PASS  the privileged-column guard is installed, enabled and SECURITY INVOKER';
end $$;

do $$
declare
  v_admin   uuid;
  v_d       uuid;
  v_org     uuid;
  v_peer    uuid := gen_random_uuid();
  v_n       int;
  v_msg     text;
  v_ok      boolean;
  v_active  boolean;
  v_stmt    text;
  v_label   text;
  v_pair    text[];
  v_simulated boolean := false;
begin
  begin
    select id into v_admin from public.profiles where role = 'admin' and is_active order by id limit 1;
    select id, organisation_id into v_d, v_org
    from public.profiles where role = 'clinician' and organisation_id is not null and is_active order by id limit 1;

    -- Raised inside this block on purpose: the handler below swallows
    -- SKIP_NO_FIXTURE, so an empty database (CI replay) skips the behavioural
    -- proof instead of aborting the whole migration.
    if v_admin is null or v_d is null then
      raise exception 'SKIP_NO_FIXTURE';
    end if;

    -- A peer in the SAME organisation as the delegate, and a temporary direct
    -- users.suspend grant for the delegate (same pattern as 20260925100329).
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_peer, 'guard-probe-peer@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, is_active)
    values (v_peer, v_org, 'clinician', 'Guard Probe Peer', true)
    on conflict (id) do update set
      organisation_id = excluded.organisation_id, role = excluded.role,
      full_name = excluded.full_name, is_active = excluded.is_active;

    delete from public.user_permission_grants
    where profile_id = v_d and permission_key = 'users.suspend' and revoked_at is null;
    insert into public.user_permission_grants (profile_id, permission_key, granted_by)
    values (v_d, 'users.suspend', v_admin);

    -- ---- Act as the delegate, under the real client role and RLS. ------------
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_d::text, 'role', 'authenticated')::text, true);
    set local role authenticated;

    -- 1. Every attack from the probe, and the tenant escape, must now be refused
    --    BY THE GUARD (not by some other error), including on the caller's own row.
    foreach v_pair slice 1 in array array[
      array['set a colleague''s role to admin',        format('update public.profiles set role = ''admin'' where id = %L', v_peer)],
      array['suspend a colleague directly',            format('update public.profiles set is_active = false where id = %L', v_peer)],
      array['set their OWN role to admin',             format('update public.profiles set role = ''admin'' where id = %L', v_d)],
      array['move their OWN organisation',             format('update public.profiles set organisation_id = %L where id = %L', gen_random_uuid(), v_d)],
      array['set a colleague as partner admin',        format('update public.profiles set is_partner_admin = true where id = %L', v_peer)],
      array['link a colleague to a lab provider',      format('update public.profiles set lab_provider_id = %L where id = %L', gen_random_uuid(), v_peer)]
    ]
    loop
      v_label := v_pair[1]; v_stmt := v_pair[2];
      v_ok := true; v_msg := null;
      begin
        execute v_stmt;
      exception when others then
        v_ok := false; v_msg := sqlerrm;
      end;
      if v_ok then
        raise exception 'FAIL: a delegated in-org clinician could %', v_label;
      end if;
      if v_msg not like '%can only be changed by a Super Admin%' then
        raise exception 'FAIL: "%" was refused, but not by the guard: %', v_label, v_msg;
      end if;
    end loop;
    raise notice 'PASS  an in-org clinician cannot rewrite role / is_active / organisation_id / partner columns, on a colleague or on their own row';

    -- 2. Control: the guard is not a blanket. The same caller can still edit an
    --    ordinary column on the same colleague.
    update public.profiles set full_name = 'Guard Probe Peer (edited)' where id = v_peer;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'FAIL: control: an ordinary profile edit by org staff was blocked (% rows) -- the guard is refusing everything', v_n;
    end if;
    raise notice 'PASS  control: an ordinary profile column is still editable by org staff';

    -- 3. Control: the sanctioned path survives. The same delegate, holding
    --    users.suspend, can still suspend an in-org colleague THROUGH the
    --    self-authorizing definer function, because it runs as its owner.
    perform public.set_member_active(v_peer, false);
    perform set_config('request.jwt.claims', '', true);
    reset role;
    select is_active into v_active from public.profiles where id = v_peer;
    if v_active then
      raise exception 'FAIL: control: set_member_active no longer works for a delegate -- the guard is blocking the sanctioned definer path';
    end if;
    raise notice 'PASS  control: the sanctioned definer function (set_member_active) still works for a delegate';

    -- 4. Control: a Super Admin is unaffected, directly.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.profiles set is_active = true where id = v_peer;
    get diagnostics v_n = row_count;
    perform set_config('request.jwt.claims', '', true);
    reset role;
    if v_n <> 1 then
      raise exception 'FAIL: control: a Super Admin could not update is_active directly (% rows)', v_n;
    end if;
    raise notice 'PASS  control: a Super Admin can still write the guarded columns directly';

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
    raise notice 'NOTE: no active admin + org-attached clinician fixture existed, so the behavioural proof was skipped; the structural assertions above still ran';
  else
    raise notice 'PASS  profiles privileged-column guard: proved live as the client role and rolled back';
  end if;
end $$;

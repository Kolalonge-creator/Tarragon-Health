-- Tarragon Health — keep payer_admin and provider_org_staff out of
-- private.is_org_staff(), before either platform exists.
--
-- CLAUDE.md names this function as "the highest-leverage security function
-- in the codebase": it gates roughly 110 patient-scoped tables through some
-- 300 policies, and the file records two occasions where a role was let into
-- it by accident and became a platform-wide PHI exposure (corporate_admin /
-- hmo_admin in 2026-07-16, pharmacist / lab_partner in 2026-07-27). Both
-- times the mistake was the same shape: a new role was added to the enum,
-- given an organisation_id like every other staff account, and the deny-list
-- was not updated — so `role <> 'patient' and organisation_id = org` quietly
-- admitted it.
--
-- payer_admin and provider_org_staff are exactly that shape. An insurer's
-- claims clerk and a partner hospital's receptionist are not Tarragon
-- care-team staff and must read zero rows from every patient-scoped table.
-- Everything they legitimately need comes from their own module's tables and
-- SECURITY DEFINER RPCs, all of which are scoped to their own insurer /
-- provider organisation and all of which are built in the migrations after
-- this one. This migration runs FIRST so that at no point in the migration
-- history does either role exist without the exclusion.
--
-- The rewrite is otherwise byte-for-byte the previous definition: the
-- assertions below re-prove every exclusion landed by 20260729124330,
-- 20260729194127 and 20260729234618, because a careless `create or replace`
-- here is how those get silently lost.

create or replace function private.is_org_staff(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
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
      and (role = 'admin' or organisation_id = org)
  );
$$;

comment on function private.is_org_staff(uuid) is
  'Tarragon care-team and operations staff for an organisation: clinician, '
  'care_coordinator, nurse, and the admin super-user. Institution admins '
  '(I9), partner employees (pharmacist, lab_partner, lab_liaison), '
  'back-office roles (finance, analyst) and the two counterparty platform '
  'roles (payer_admin, provider_org_staff) are all excluded and are served '
  'by named grants or their own SECURITY DEFINER RPCs instead.';

-- ---------------------------------------------------------------------------
-- Assertions.
--
-- Two layers. First the text checks that catch a rewrite dropping an older
-- exclusion. Then a genuine behavioural proof: take a real care-team account,
-- confirm it PASSES the predicate (the control — without this the negatives
-- below could be produced by an account that fails everything), then flip that
-- same account to each new role in turn and confirm it now FAILS. The whole
-- simulation runs inside a subtransaction that is deliberately rolled back, so
-- no profile is left modified and no fixture row survives this migration.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src           text;
  v_role          text;
  v_id            uuid;
  v_org           uuid;
  v_control       boolean;
  v_leak_payer    boolean;
  v_leak_provider boolean;
  v_simulated     boolean := false;
begin
  select prosrc into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'is_org_staff';

  foreach v_role in array array[
    'corporate_admin', 'hmo_admin',                                  -- I9, 20260729124330
    'pharmacist', 'lab_liaison', 'finance', 'analyst',               -- 20260729194127
    'lab_partner',                                                   -- 20260729234618
    'payer_admin', 'provider_org_staff'                              -- this migration
  ]
  loop
    if v_src not like '%' || v_role || '%' then
      raise exception 'is_org_staff lost (or never gained) the % exclusion', v_role;
    end if;
  end loop;

  -- ---- behavioural proof --------------------------------------------------
  begin
    select id, organisation_id into v_id, v_org
    from public.profiles
    where role = 'clinician' and organisation_id is not null
    order by id limit 1;

    if v_id is null then
      raise exception 'SKIP_NO_FIXTURE';
    end if;

    -- Control: a real clinician session passes for its own organisation.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
    v_control := private.is_org_staff(v_org);

    -- Claims are cleared before each UPDATE so private.guard_profiles_self_update()
    -- does not see this as the account owner editing their own role.
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set role = 'payer_admin' where id = v_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
    v_leak_payer := private.is_org_staff(v_org);

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set role = 'provider_org_staff' where id = v_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id, 'role', 'authenticated')::text, true);
    v_leak_provider := private.is_org_staff(v_org);

    v_simulated := true;

    -- Unwind everything the simulation touched. plpgsql variables survive a
    -- subtransaction rollback; the UPDATEs and the GUC do not.
    raise exception 'ROLLBACK_SIMULATION';
  exception
    when others then
      if sqlerrm not in ('ROLLBACK_SIMULATION', 'SKIP_NO_FIXTURE') then
        raise;
      end if;
  end;

  if not v_simulated then
    -- Honest about it rather than reporting a pass that never ran. The same
    -- proof is re-run, with fixtures it creates itself, by
    -- packages/db/tests/payer_provider_org_platform.sql.
    raise notice 'NOTE: no clinician account with an organisation existed, so the behavioural half of this proof was skipped; the text assertions still ran';
  else
    if not v_control then
      raise exception 'FAIL: the control failed — a real clinician does not satisfy is_org_staff, so the negatives below prove nothing';
    end if;
    if v_leak_payer then
      raise exception 'FAIL: a payer_admin account still satisfies is_org_staff';
    end if;
    if v_leak_provider then
      raise exception 'FAIL: a provider_org_staff account still satisfies is_org_staff';
    end if;
    raise notice 'PASS: clinician yes / payer_admin no / provider_org_staff no, proved live on a real account and rolled back';
  end if;
end $$;

-- Tarragon Health -- gate the remaining role / tenant helpers on profiles.is_active.
--
-- 20260925093444 made private.is_admin / is_org_staff / has_permission refuse a
-- suspended login. A sweep of the live database afterwards found the same hole
-- in a small set of shared helpers that still answer "what role / which
-- organisation is the caller" from public.profiles without looking at
-- is_active. A suspended member's access token stays valid until it expires
-- (the auth ban in setMemberActiveAction stops refreshes, not the token already
-- issued), so through these helpers they kept their role and their tenant.
--
-- Sweep results (live, 2026-10-04):
--   * 1,427 public policies. 1,140 already go through the gated helpers.
--     122 go through private.current_role() / private.current_org_id() and 77
--     through the role-check helpers below -- all fixed by gating the helpers.
--     0 use an inline profiles subselect without is_active.
--   * 101 SECURITY DEFINER functions read profiles + role without is_active.
--     Of those, the ones that GRANT access by role are the helpers in this
--     file. Most of the rest are deny-direction (a staff-only function that
--     refuses role = 'patient', which a suspended patient still is), or batch
--     jobs choosing notification recipients.
--
-- Each function below is the live definition (pulled with pg_get_functiondef,
-- per the standing lesson that a migration file is not proof of what is live)
-- with `and is_active` added to its profiles lookup. Signature, volatility,
-- SECURITY DEFINER and search_path are unchanged, and CREATE OR REPLACE keeps
-- the existing grants. profiles.is_active is NOT NULL DEFAULT true, so no
-- active member is affected; at the time of writing 0 of 11 profiles are
-- inactive.
--
-- NOT changed here, deliberately:
--   * 94 policies that are purely "own row" (id / patient_id = auth.uid()).
--     A suspended member can still read their own data; that is not a staff
--     access path and a blanket gate would also lock a patient out of their own
--     record.
--   * Own-data functions that look up the caller's own patient profile
--     (has_ai_coach_access, get_ai_coach_daily_limit, mint_health_passport,
--     request_health_passport_attestation). They act on the caller's own
--     record only. Gating them is a product decision about what a suspended
--     patient may still do.

-- ---------------------------------------------------------------------------
-- Central helpers: role and tenant of the caller. A suspended caller has none.
-- ---------------------------------------------------------------------------
create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organisation_id from public.profiles where id = (select auth.uid()) and is_active;
$$;

create or replace function private."current_role"()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = (select auth.uid()) and is_active;
$$;

-- ---------------------------------------------------------------------------
-- Role-check helpers that read profiles directly.
-- ---------------------------------------------------------------------------
create or replace function private.is_analyst()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('analyst', 'admin') and is_active
  );
$$;

create or replace function private.is_finance()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('finance', 'admin') and is_active
  )
  or private.has_permission('finance.view');
$$;

create or replace function private.finance_can(perm text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('finance','admin') and is_active
  ) or private.has_permission(perm);
$$;

create or replace function private.is_institution_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('corporate_admin', 'hmo_admin')
      and is_active
  );
$$;

create or replace function private.is_insurance_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_permission('insurance.manage')
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin' and is_active);
$$;

create or replace function private.is_lab_liaison()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'lab_liaison' and is_active
  );
$$;

create or replace function private.is_scoped_access_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role in ('pharmacist', 'lab_partner', 'lab_liaison', 'finance', 'analyst')
      and is_active
  );
$$;

create or replace function private.lab_partner_provider()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select lab_provider_id
  from public.profiles
  where id = (select auth.uid()) and role = 'lab_partner' and is_active;
$$;

create or replace function private.pharmacist_partner()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pharmacy_partner_id
  from public.profiles
  where id = (select auth.uid()) and role = 'pharmacist' and is_active;
$$;

-- The admin branch and the chief-medical-officer branch both depend on the
-- caller's login being active: a suspended CMO keeps an active clinical_staff
-- row, so the profile has to be checked on its own.
create or replace function private.can_review_complaint_governance(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (select 1 from public.profiles where id = (select auth.uid()) and is_active)
    and (
      exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin')
      or exists (
        select 1 from public.clinical_staff
        where profile_id = (select auth.uid())
          and organisation_id = org
          and active
          and doctor_tier = 'chief_medical_officer'
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Proof, not hope. Text assertions always run; the behavioural half runs
-- against real fixtures where available and is rolled back.
-- ---------------------------------------------------------------------------
do $$
declare
  v_name text;
  v_src  text;
begin
  foreach v_name in array array[
    'current_org_id', 'current_role', 'is_analyst', 'is_finance', 'finance_can',
    'is_institution_admin', 'is_insurance_admin', 'is_lab_liaison',
    'is_scoped_access_role', 'lab_partner_provider', 'pharmacist_partner',
    'can_review_complaint_governance'
  ]
  loop
    select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = v_name;
    if v_src is null then
      raise exception 'FAIL: private.% does not exist', v_name;
    end if;
    if v_src not like '%is_active%' then
      raise exception 'FAIL: private.% does not gate on is_active', v_name;
    end if;
  end loop;
  raise notice 'PASS  all 12 helpers carry the is_active gate';
end $$;

do $$
declare
  v_id          uuid;
  v_org         uuid;
  v_role        text;
  v_pair        text[];
  v_active      boolean;
  v_inactive    boolean;
  v_simulated   boolean := false;
begin
  begin
    select id, organisation_id into v_id, v_org
    from public.profiles
    where role = 'clinician' and organisation_id is not null
    order by id limit 1;

    -- Raised inside this block on purpose: the handler below swallows
    -- SKIP_NO_FIXTURE, so an empty database (CI replay) skips the behavioural
    -- proof instead of aborting the whole migration.
    if v_id is null then
      raise exception 'SKIP_NO_FIXTURE';
    end if;

    -- ---- current_org_id / current_role: present while active, gone once suspended.
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    if private.current_org_id() is distinct from v_org then
      raise exception 'FAIL: control: an active member does not get their own organisation from current_org_id()';
    end if;
    if private."current_role"() is distinct from 'clinician'::public.user_role then
      raise exception 'FAIL: control: an active member does not get their own role from current_role()';
    end if;

    -- Claims are cleared before each UPDATE so private.guard_profiles_self_update()
    -- does not see this as the account owner editing their own row.
    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = false where id = v_id;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
    if private.current_org_id() is not null then
      raise exception 'FAIL: a suspended member still resolves an organisation through current_org_id()';
    end if;
    if private."current_role"() is not null then
      raise exception 'FAIL: a suspended member still resolves a role through current_role()';
    end if;
    raise notice 'PASS  a suspended member has no organisation and no role (current_org_id / current_role)';

    perform set_config('request.jwt.claims', '', true);
    update public.profiles set is_active = true where id = v_id;

    -- ---- the boolean role helpers: true for the right role while active,
    --      false once suspended. Each pair is (role, call). is_institution_admin
    --      (corporate_admin / hmo_admin) is covered by the text assertion above
    --      only: flipping a fixture into those roles can trip the payer /
    --      provider-org role guard triggers, which is not what this proves.
    foreach v_pair slice 1 in array array[
      array['analyst',         'private.is_analyst()'],
      array['finance',         'private.is_finance()'],
      array['finance',         'private.finance_can(''__none__'')'],
      array['admin',           'private.is_insurance_admin()'],
      array['lab_liaison',     'private.is_lab_liaison()'],
      array['pharmacist',      'private.is_scoped_access_role()'],
      array['admin',           'private.can_review_complaint_governance(''' || v_org::text || '''::uuid)']
    ]
    loop
      v_role := v_pair[1];
      perform set_config('request.jwt.claims', '', true);
      update public.profiles set role = v_role::public.user_role, is_active = true where id = v_id;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
      execute 'select ' || v_pair[2] into v_active;
      if v_active is not true then
        raise exception 'FAIL: control: % is not true for an active % (the proof below would prove nothing)', v_pair[2], v_role;
      end if;

      perform set_config('request.jwt.claims', '', true);
      update public.profiles set is_active = false where id = v_id;
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_id::text, 'role', 'authenticated')::text, true);
      execute 'select ' || v_pair[2] into v_inactive;
      if v_inactive is not false then
        raise exception 'FAIL: % is still true for a SUSPENDED %', v_pair[2], v_role;
      end if;
    end loop;
    raise notice 'PASS  every role helper is true while active and false once suspended';

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
    raise notice 'NOTE: no org-attached clinician fixture existed, so the behavioural proof was skipped; the text assertions above still ran';
  else
    raise notice 'PASS  is_active gating on the role helpers: proved live and rolled back';
  end if;
end $$;

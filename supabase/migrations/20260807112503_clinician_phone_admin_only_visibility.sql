-- Tarragon Health — clinician phone: admin-only visibility
--
-- Founder ask: clinician accounts need a real phone number to be pageable
-- (the vitals red-flag paging added earlier today found 6 production
-- clinicians with none), and that phone must not be readable by a patient
-- session — only by admin (self-read and org-staff already work correctly
-- today and are untouched here).
--
-- The exposure was real but latent: Postgres RLS is row-level, not
-- column-level. The only RLS path that lets a PATIENT session read a
-- CLINICIAN's profiles row at all is this clause in the live profiles_select
-- policy (20260729194127_scoped_access_roles_out_of_org_staff.sql):
--   or exists (
--     select 1 from public.care_plans cp
--     where cp.assigned_clinician_id = profiles.id
--       and cp.patient_id = (select auth.uid())
--   )
-- Its own introducing migration (20260706074302_patient_sees_assigned_
-- clinician_name.sql) says the intent was name-only — but a row-level policy
-- grants the WHOLE row: phone, date_of_birth, sex, hbv/hcv/hiv_status,
-- emergency_contact_*, next_of_kin_*, metadata, staff_number. Confirmed by
-- exhaustive search: the only consumer of this path is
-- apps/web/src/lib/queries/care-plans.ts, which only ever selects
-- full_name — so removing the clause and replacing it with a narrow,
-- name-only SECURITY DEFINER RPC (this codebase's established public_*
-- convention, e.g. public_price_list_rpc) closes the gap with zero loss of
-- legitimate function.

-- ---------------------------------------------------------------------------
-- 1. Rewrite profiles_select — drop the care_plans clause only. Every other
--    clause copied byte-identical from the live policy.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or private.is_admin()
    or (organisation_id is not null and private.is_org_staff(organisation_id))
    or (
      private.is_lab_liaison()
      and role = 'patient'
      and organisation_id is not null
      and organisation_id = private.current_org_id()
    )
    -- REMOVED (this migration): the care_plans -> assigned_clinician_id
    -- clause. It exposed a clinician's entire profiles row (phone, DOB,
    -- HIV/HBV/HCV status, emergency contacts...) to any patient with an
    -- active care plan, for what was only ever meant to be a name lookup
    -- (20260706074302). Replaced by public.my_care_plan_clinicians() below,
    -- a name-only SECURITY DEFINER RPC.
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = profiles.id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Name-only replacement RPC. Scoped entirely by auth.uid() — no
--    patient-id argument, so it can never be pointed at anyone else's care
--    plans. Not granted to anon: it resolves via auth.uid(), which is null
--    for an anonymous caller, so an anon grant would only ever return zero
--    rows.
-- ---------------------------------------------------------------------------
create or replace function public.my_care_plan_clinicians()
returns table (
  care_plan_id uuid,
  clinician_full_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select cp.id, p.full_name
  from public.care_plans cp
  join public.profiles p on p.id = cp.assigned_clinician_id
  where cp.patient_id = (select auth.uid())
    and cp.assigned_clinician_id is not null;
$$;

comment on function public.my_care_plan_clinicians() is
  'Name-only replacement for the removed care_plans-based profiles_select clause. Returns the assigned clinician''s full_name for the calling patient''s own care plans -- nothing else leaves this function.';

revoke all on function public.my_care_plan_clinicians() from public;
grant execute on function public.my_care_plan_clinicians() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. New permission key for the admin-only phone-edit action added in the
--    app layer alongside this migration. Deliberately separate from
--    users.roles.assign -- role assignment is privilege-escalation-adjacent,
--    phone editing only changes who gets paged.
-- ---------------------------------------------------------------------------
insert into public.permissions (key, label, category, description)
values (
  'users.contact.edit',
  'Edit member contact info',
  'Users',
  'Update a member''s phone number. Distinct from users.roles.assign: this cannot change a member''s privilege level, only how they''re reached.'
)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Assertions -- schema-level only (policy text, RPC existence/security/
--    grants, permission seeded). The behavioural proof (a patient session
--    genuinely cannot read the clinician's row; the RPC still resolves the
--    right name; admin can still write phone) needs real fixture rows and a
--    rolled-back transaction, so it lives in
--    packages/db/tests/clinician_phone_admin_visibility.sql instead of
--    here -- a migration must not fabricate patient data, and must not risk
--    failing on an environmental role-switch quirk during apply.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy_qual text;
begin
  select qual into v_policy_qual
  from pg_policies
  where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select';

  if v_policy_qual like '%assigned_clinician_id%' then
    raise exception 'FAIL: profiles_select still contains the assigned_clinician_id clause';
  end if;
  if v_policy_qual not like '%is_admin%' then
    raise exception 'FAIL: profiles_select lost its is_admin clause';
  end if;
  if v_policy_qual not like '%profile_access%' then
    raise exception 'FAIL: profiles_select lost its profile_access clause';
  end if;
  if v_policy_qual not like '%is_lab_liaison%' then
    raise exception 'FAIL: profiles_select lost its lab-liaison clause';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'my_care_plan_clinicians' and p.prosecdef
  ) then
    raise exception 'FAIL: public.my_care_plan_clinicians is missing or not SECURITY DEFINER';
  end if;
  if not has_function_privilege('authenticated', 'public.my_care_plan_clinicians()', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute my_care_plan_clinicians';
  end if;
  if has_function_privilege('anon', 'public.my_care_plan_clinicians()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute my_care_plan_clinicians (should be authenticated-only)';
  end if;

  if not exists (select 1 from public.permissions where key = 'users.contact.edit') then
    raise exception 'FAIL: users.contact.edit permission was not seeded';
  end if;

  raise notice 'PASS: clinician_phone_admin_only_visibility -- RLS clause removed, RPC live, permission seeded';
end $$;

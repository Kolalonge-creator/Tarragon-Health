-- ===========================================================================
-- Two-factor sign-in (2FA) required per group of accounts, switched by an admin.
--
-- WHAT. One row per group: every account role, each clinician tier (clinical_staff.doctor_tier) as a narrower group under
-- `clinician`, and patients as the `patient` role row. `required` says whether every account in the group must have a verified
-- TOTP factor and pass it (Supabase AAL2) before it may use the app. Every row ships OFF. Nothing here switches a group on.
--
-- NO organisation_id on either table, deliberately: like go_live_guards, this is one platform-wide setting per group (the
-- groups are account roles, which are platform-wide), not tenant data. Nothing tenant-scoped is stored here.
--
-- GATE MODEL (docs/design/GATE-MODEL.md). This is an operational setting: versioned, audited, a change note, no CMO
-- signature, never counted on the sign-off hub. It is not a go-live master and not a feature guard, and adds neither.
--
-- WHERE IT IS ENFORCED.
--   1. apps/web proxy.ts: an account in a required group without a verified factor is sent to Profile & settings to set one
--      up; an account with a factor is sent to the existing challenge (it already was, whether required or not).
--   2. Here, in the database, for the helpers that open patient data to staff: private.is_org_staff(uuid) (and so
--      private.staff_may_read / staff_may_write, which call it), private.is_admin(), private.has_permission (delegated
--      capabilities, which admits an admin by its own check), private.task_is_mine (clinical tasks offered to or claimed by the
--      caller) and private.has_emergency_access (break-glass). Each gains `and private.mfa_requirement_met()`. For an account in a required group whose session is
--      not AAL2 both return false, so a stolen AAL1 token sent straight to the API reads no patient data through either. With
--      every group off, mfa_requirement_met() is true for everybody and both helpers behave exactly as before.
--   Not covered at the database layer: a patient's own-row and caregiver policies (auth.uid() = patient_id, can_read_clinical)
--   and back-office roles that read through their own helpers (finance, analyst, partner roles). Those are held by the proxy
--   only. See the PR description.
--
-- LOCK-OUT GUARDS (set_mfa_group_requirement).
--   * Turning a group ON that includes the caller needs the caller's own session to be AAL2 right now, so an admin can never
--     require 2FA of themselves before they have proved it works on their own phone. In particular the admin group can only
--     be switched on by an admin who has already passed 2FA.
--   * Turning a group ON while any account in it has no verified factor needs the admin's confirmation of the exact numbers
--     they saw (how many, how many of them the CMO, how many admins); stale or missing numbers are refused, naming the live ones.
--   * Turning a group OFF is never refused to an admin (beyond the change note).
--   * A member who loses their phone: an admin resets their factors at /admin/settings/two-factor
--     (public.admin_reset_mfa_factors, below), which also signs them out everywhere and tells them.
--   * Recovery if every admin loses their authenticator: run, as the database owner,
--     update public.mfa_group_requirements set required = false, version = version + 1, change_note = '<why>' where ...;
--     (no RLS policy lets an app session write this table, so that is the break-glass path).
-- ===========================================================================

create table public.mfa_group_requirements (
  id uuid primary key default gen_random_uuid(),
  role public.user_role not null,
  -- Null for a whole-role group. Set only under `clinician`: narrows the group to doctors of that tier.
  doctor_tier public.doctor_tier,
  required boolean not null default false,
  version integer not null default 1 check (version >= 1),
  change_note text,
  changed_by uuid references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  constraint mfa_group_requirements_tier_only_for_clinician check (doctor_tier is null or role = 'clinician'),
  constraint mfa_group_requirements_one_row_per_group unique nulls not distinct (role, doctor_tier)
);

comment on table public.mfa_group_requirements is
  'Whether two-factor sign-in (AAL2) is required for a group of accounts. Operational setting (GATE-MODEL.md): versioned, audited in mfa_group_requirement_changes, no signature. Written only through public.set_mfa_group_requirement. Ships all OFF.';

create table public.mfa_group_requirement_changes (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.mfa_group_requirements(id) on delete restrict,
  role public.user_role not null,
  doctor_tier public.doctor_tier,
  required boolean not null,
  version integer not null,
  change_note text not null,
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now(),
  unique (requirement_id, version)
);

comment on table public.mfa_group_requirement_changes is
  'Append-only history of every change to mfa_group_requirements: who, when, what, and why.';

-- One row per group, all OFF.
insert into public.mfa_group_requirements (role, doctor_tier, required, change_note)
select e.enumlabel::public.user_role, null, false, 'Created switched off (2FA group requirement, 2026-11-05).'
  from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' and t.typname = 'user_role';
insert into public.mfa_group_requirements (role, doctor_tier, required, change_note)
select 'clinician', e.enumlabel::public.doctor_tier, false, 'Created switched off (2FA group requirement, 2026-11-05).'
  from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public' and t.typname = 'doctor_tier';

create index mfa_group_requirements_required_idx on public.mfa_group_requirements (role) where required;

alter table public.mfa_group_requirements enable row level security;
alter table public.mfa_group_requirement_changes enable row level security;

-- Admins read both. Nobody writes either from an app session: the RPC below is SECURITY DEFINER.
create policy mfa_group_requirements_admin_read on public.mfa_group_requirements
  for select to authenticated using ((select private.is_admin()));
create policy mfa_group_requirement_changes_admin_read on public.mfa_group_requirement_changes
  for select to authenticated using ((select private.is_admin()));

revoke all on public.mfa_group_requirements from anon, public;
revoke all on public.mfa_group_requirement_changes from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.mfa_group_requirements from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.mfa_group_requirement_changes from authenticated;
grant select on public.mfa_group_requirements to authenticated;
grant select on public.mfa_group_requirement_changes to authenticated;

-- ---------------------------------------------------------------------------
-- Is 2FA required of this account? True when the account's role group is on, or it is a clinician whose tier group is on.
-- A tier group follows clinical_staff.doctor_tier whether or not the staff row is active (stricter, never looser).
-- ---------------------------------------------------------------------------
create or replace function private.mfa_required_for(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select p_uid is not null and exists (
    select 1
      from public.profiles p
      join public.mfa_group_requirements r on r.required and r.role = p.role
     where p.id = p_uid
       and (
         r.doctor_tier is null
         or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = r.doctor_tier)
       )
  );
$$;

-- ---------------------------------------------------------------------------
-- Does the current session satisfy the 2FA requirement? True for an AAL2 session, when no group is on at all, for a session
-- with no user (service role, anon: neither helper below admits those anyway), and for an account in no required group.
-- Written as CASE so the cheap checks run first: this is called from two helpers used in roughly 900 policies.
-- ---------------------------------------------------------------------------
create or replace function private.mfa_requirement_met()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select case
    when coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2' then true
    when not exists (select 1 from public.mfa_group_requirements where required) then true
    when (select auth.uid()) is null then true
    else not private.mfa_required_for((select auth.uid()))
  end;
$$;

revoke all on function private.mfa_required_for(uuid) from public, anon;
revoke all on function private.mfa_requirement_met() from public, anon;
grant execute on function private.mfa_required_for(uuid) to authenticated, service_role;
grant execute on function private.mfa_requirement_met() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The two staff data helpers, redefined from their LIVE bodies (read 2026-11-05 with pg_get_functiondef) with one added
-- clause each. Nothing else changes.
-- ---------------------------------------------------------------------------
create or replace function private.is_org_staff(org uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
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
  )
  -- 2FA group requirement (20261105110919): an account whose group requires 2FA reads nothing through this helper until its
  -- session is AAL2. True for everybody while every group is off.
  and private.mfa_requirement_met();
$function$;

create or replace function private.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and is_active
  )
  -- 2FA group requirement (20261105110919): see private.is_org_staff.
  and private.mfa_requirement_met();
$function$;

-- Delegated capabilities. has_permission grants an admin every capability through its own profiles check, not through
-- is_admin, so it needs the same clause or a required admin at AAL1 would keep every permission-gated read (about 150 policies).
create or replace function private.has_permission(perm text)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (
  -- super admin ⇒ holds every capability, provided the account is active
  exists (
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
  ))
  -- 2FA group requirement (20261105110919): see private.is_org_staff.
  and private.mfa_requirement_met();
$function$;

-- Clinical tasks offered to or claimed by the caller (clinical_tasks, task_claims, transitions): patient-identifying work
-- items read without is_org_staff.
create or replace function private.task_is_mine(p_pushed uuid, p_claimed uuid, p_lead uuid, p_state public.clinical_task_state)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$ select (select auth.uid()) is not null and (
       (p_state = 'offered_to_lead' and (select auth.uid()) in (p_pushed, p_lead))
    or (p_state in ('claimed', 'escalated') and p_claimed = (select auth.uid())))
  -- 2FA group requirement (20261105110919): see private.is_org_staff.
  and private.mfa_requirement_met(); $function$;

-- Break-glass reads. A grant already open must not be usable from an AAL1 session of an account whose group requires 2FA.
create or replace function private.has_emergency_access(p_patient uuid, p_category public.care_access_category default null::public.care_access_category)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select exists (
    select 1 from public.emergency_record_access_grants g
    where g.patient_id = p_patient
      and g.requester_id = (select auth.uid())
      and g.ended_at is null
      and g.expires_at > now()
      and (p_category is null or p_category <> 'reproductive_health')
  )
  -- 2FA group requirement (20261105110919): see private.is_org_staff.
  and private.mfa_requirement_met();
$function$;

-- ---------------------------------------------------------------------------
-- For the signed-in account: is 2FA required, and does it already have a verified factor. Used by the proxy and the
-- Profile & settings page. Reveals nothing about anybody else.
-- ---------------------------------------------------------------------------
create or replace function public.my_mfa_requirement()
returns table (required boolean, has_verified_factor boolean)
language sql
stable
security definer
set search_path to ''
as $$
  select private.mfa_required_for((select auth.uid())),
         exists (select 1 from auth.mfa_factors f
                  where f.user_id = (select auth.uid()) and f.status = 'verified' and f.factor_type = 'totp')
   where (select auth.uid()) is not null;
$$;

-- Is any group on at all? Lets the proxy skip the per-account lookup on every request while everything is off. One boolean,
-- no account detail.
create or replace function public.mfa_any_group_required()
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.mfa_group_requirements where required);
$$;

-- ---------------------------------------------------------------------------
-- Admin page: every group with its switch, version, last change, and how many accounts it holds and how many already have a
-- verified factor. Admin only (an empty result, not an error, for anybody else).
-- ---------------------------------------------------------------------------
create or replace function public.admin_mfa_group_requirements()
returns table (
  id uuid,
  role public.user_role,
  doctor_tier public.doctor_tier,
  required boolean,
  version integer,
  change_note text,
  changed_by_name text,
  changed_at timestamptz,
  member_count bigint,
  enrolled_count bigint,
  unenrolled_cmo_count bigint,
  unenrolled_admin_count bigint
)
language sql
stable
security definer
set search_path to ''
as $$
  with members as (
    select r.id as requirement_id, p.id as profile_id, p.role,
           exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp') as enrolled,
           exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = 'chief_medical_officer') as is_cmo
      from public.mfa_group_requirements r
      join public.profiles p on p.role = r.role and p.is_active
     where r.doctor_tier is null
        or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = r.doctor_tier)
  )
  select r.id, r.role, r.doctor_tier, r.required, r.version, r.change_note, cb.full_name, r.changed_at,
         count(m.profile_id),
         count(m.profile_id) filter (where m.enrolled),
         count(m.profile_id) filter (where not m.enrolled and m.is_cmo),
         count(m.profile_id) filter (where not m.enrolled and m.role = 'admin')
    from public.mfa_group_requirements r
    left join members m on m.requirement_id = r.id
    left join public.profiles cb on cb.id = r.changed_by
   where private.is_admin()
   group by r.id, cb.full_name
   order by (r.role = 'patient'), r.role::text, r.doctor_tier nulls first;
$$;

-- Recent history for the admin page.
create or replace function public.admin_mfa_group_requirement_changes(p_limit integer default 50)
returns table (
  role public.user_role,
  doctor_tier public.doctor_tier,
  required boolean,
  version integer,
  change_note text,
  changed_by_name text,
  changed_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select c.role, c.doctor_tier, c.required, c.version, c.change_note, p.full_name, c.changed_at
    from public.mfa_group_requirement_changes c
    left join public.profiles p on p.id = c.changed_by
   where private.is_admin()
   order by c.changed_at desc, c.version desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- The switch. Admin only, change note of at least 20 characters, lock-out guards described in the header.
-- ---------------------------------------------------------------------------
create or replace function public.set_mfa_group_requirement(
  p_role public.user_role,
  p_doctor_tier public.doctor_tier,
  p_required boolean,
  p_change_note text,
  -- What the admin saw on the page when they confirmed: accounts in the group without a factor, of whom the CMO and admins.
  -- Switching on a group with any such account needs these to match the live counts, so a confirmation given on stale numbers
  -- is refused and the live numbers shown.
  p_seen_unenrolled integer default null,
  p_seen_unenrolled_cmo integer default null,
  p_seen_unenrolled_admin integer default null
)
returns integer
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.mfa_group_requirements%rowtype;
  v_note text := btrim(coalesce(p_change_note, ''));
  v_caller_in_group boolean;
  v_unenrolled bigint;
  v_unenrolled_cmo bigint;
  v_unenrolled_admin bigint;
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'Only an admin can change the two-factor sign-in requirement.' using errcode = '42501';
  end if;
  if p_required is null then
    raise exception 'Say whether the requirement is on or off.' using errcode = '22023';
  end if;
  if length(v_note) < 20 then
    raise exception 'Write a change note of at least 20 characters saying why.' using errcode = '22023';
  end if;

  select * into v_row from public.mfa_group_requirements
   where role = p_role and doctor_tier is not distinct from p_doctor_tier
   for update;
  if not found then
    raise exception 'There is no such group.' using errcode = 'P0002';
  end if;

  if v_row.required = p_required then
    return v_row.version;
  end if;

  if p_required then
    -- Guard 1: never require 2FA of yourself before your own session has passed it.
    select exists (
      select 1 from public.profiles p
       where p.id = v_uid and p.role = p_role
         and (p_doctor_tier is null
              or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = p_doctor_tier))
    ) into v_caller_in_group;
    if v_caller_in_group and coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
      raise exception 'You are in this group. Turn on two-factor sign-in for your own account in Profile & settings, sign in with it, then switch this group on.'
        using errcode = '42501';
    end if;

    -- Guard 2: say out loud who has no factor yet, and need a confirmation.
    select count(*),
           count(*) filter (where exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = 'chief_medical_officer')),
           count(*) filter (where p.role = 'admin')
      into v_unenrolled, v_unenrolled_cmo, v_unenrolled_admin
      from public.profiles p
     where p.role = p_role and p.is_active
       and (p_doctor_tier is null
            or exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.doctor_tier = p_doctor_tier))
       and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp');
    if v_unenrolled > 0
       and (p_seen_unenrolled is distinct from v_unenrolled::integer
            or p_seen_unenrolled_cmo is distinct from v_unenrolled_cmo::integer
            or p_seen_unenrolled_admin is distinct from v_unenrolled_admin::integer) then
      raise exception '% account(s) in this group have not set up two-factor sign-in yet (Chief Medical Officer: %, admin: %). They will be sent to set it up at their next sign-in. Refresh the page, check the numbers, and confirm again.',
        v_unenrolled, v_unenrolled_cmo, v_unenrolled_admin
        using errcode = 'P0001', hint = 'confirm_unenrolled';
    end if;
  end if;

  update public.mfa_group_requirements
     set required = p_required, version = v_row.version + 1, change_note = v_note, changed_by = v_uid, changed_at = now()
   where id = v_row.id;

  insert into public.mfa_group_requirement_changes (requirement_id, role, doctor_tier, required, version, change_note, changed_by)
  values (v_row.id, v_row.role, v_row.doctor_tier, p_required, v_row.version + 1, v_note, v_uid);

  return v_row.version + 1;
end;
$$;

revoke all on function public.my_mfa_requirement() from public, anon;
revoke all on function public.mfa_any_group_required() from public, anon;
revoke all on function public.admin_mfa_group_requirements() from public, anon;
revoke all on function public.admin_mfa_group_requirement_changes(integer) from public, anon;
revoke all on function public.set_mfa_group_requirement(public.user_role, public.doctor_tier, boolean, text, integer, integer, integer) from public, anon;
grant execute on function public.my_mfa_requirement() to authenticated;
grant execute on function public.mfa_any_group_required() to authenticated;
grant execute on function public.admin_mfa_group_requirements() to authenticated;
grant execute on function public.admin_mfa_group_requirement_changes(integer) to authenticated;
grant execute on function public.set_mfa_group_requirement(public.user_role, public.doctor_tier, boolean, text, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Reset a lost authenticator: an admin removes another account's two-factor factors so the person can set up a new phone.
--
-- Without this, an account whose group requires 2FA and whose phone is lost cannot sign in at all, and turning its own factor off
-- is refused (Profile & settings). The reset, in one transaction:
--   * removes every factor the account has (auth.mfa_factors; its challenges and recovery-code sets cascade),
--   * ends every session the account has on every device (auth.sessions), the same as a backup-code recovery does
--     (complete_backup_code_recovery): no session can be refreshed, and an access token already issued stops working when it
--     expires (at most the JWT lifetime, one hour), so a stolen phone that was still signed in is cut off within the hour,
--   * tells the owner in the app and, to a verified address, by email (private.recovery_notice, security.mfa_reset_by_admin),
--   * records who, whom, when and why (mfa_factor_resets, append-only, and audit_log).
-- Guards: admin only; never your own account (use Profile & settings); a reason of at least 20 characters; the account must have
-- a factor to reset; resetting an admin or the Chief Medical Officer needs the resetting admin's own session to be AAL2, so a
-- password alone can never strip 2FA from another high-access account.
-- ---------------------------------------------------------------------------
create table public.mfa_factor_resets (
  id uuid primary key default gen_random_uuid(),
  target_profile_id uuid not null references public.profiles(id) on delete restrict,
  reset_by uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (length(btrim(reason)) >= 20),
  factors_removed integer not null check (factors_removed >= 1),
  sessions_ended integer not null check (sessions_ended >= 0),
  reset_at timestamptz not null default now(),
  constraint mfa_factor_resets_not_self check (target_profile_id <> reset_by)
);

comment on table public.mfa_factor_resets is
  'Append-only record of every two-factor reset an admin made for another account: who, whom, when, why, how many factors and sessions. Written only by public.admin_reset_mfa_factors. Platform-wide (no organisation_id), like mfa_group_requirements.';

alter table public.mfa_factor_resets enable row level security;
create policy mfa_factor_resets_admin_read on public.mfa_factor_resets
  for select to authenticated using ((select private.is_admin()));
revoke all on public.mfa_factor_resets from anon, public;
revoke insert, update, delete, truncate, references, trigger on public.mfa_factor_resets from authenticated;
grant select on public.mfa_factor_resets to authenticated;

create or replace function public.admin_reset_mfa_factors(p_profile uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason, ''));
  v_target public.profiles%rowtype;
  v_high_access boolean;
  v_factors integer;
  v_sessions integer;
begin
  if v_uid is null or not private.is_admin() then
    raise exception 'Only an admin can reset another account''s two-factor sign-in.' using errcode = '42501';
  end if;
  if p_profile is null then
    raise exception 'Choose an account.' using errcode = '22023';
  end if;
  if p_profile = v_uid then
    raise exception 'You cannot reset your own two-factor sign-in here. Use Profile & settings.' using errcode = '42501';
  end if;
  if length(v_reason) < 20 then
    raise exception 'Write a reason of at least 20 characters (for example, how you confirmed it is really them).' using errcode = '22023';
  end if;

  select * into v_target from public.profiles where id = p_profile for update;
  if not found then
    raise exception 'There is no such account.' using errcode = 'P0002';
  end if;

  v_high_access := v_target.role = 'admin'
    or exists (select 1 from public.clinical_staff cs where cs.profile_id = p_profile and cs.doctor_tier = 'chief_medical_officer');
  if v_high_access and coalesce((select auth.jwt()) ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Resetting an admin or the Chief Medical Officer needs your own two-factor sign-in. Turn it on in Profile & settings, sign in with it, then try again.'
      using errcode = '42501';
  end if;

  with gone as (delete from auth.mfa_factors where user_id = p_profile returning 1)
  select count(*) into v_factors from gone;
  if v_factors = 0 then
    raise exception 'This account has no authenticator to reset.' using errcode = 'P0002';
  end if;
  with gone as (delete from auth.sessions where user_id = p_profile returning 1)
  select count(*) into v_sessions from gone;

  insert into public.mfa_factor_resets (target_profile_id, reset_by, reason, factors_removed, sessions_ended)
  values (p_profile, v_uid, v_reason, v_factors, v_sessions);

  perform private.recovery_notice(p_profile, 'security.mfa_reset_by_admin',
    'An admin reset the two-factor sign-in on your Tarragon Health account and signed you out on every device (within the hour on a device already open). Sign in again and set up your authenticator app in Profile & settings. If you did not ask for this, contact the Tarragon team right away.');
  perform private.recovery_audit(v_target.organisation_id, v_uid, 'account.mfa_reset_by_admin', 'mfa_factor_resets', null, null, 'success',
    jsonb_build_object('target_profile_id', p_profile, 'factors_removed', v_factors, 'sessions_ended', v_sessions));

  return jsonb_build_object('factors_removed', v_factors, 'sessions_ended', v_sessions);
end;
$$;

-- Accounts that have an authenticator (verified or a set-up in progress), for the reset list. Admin only; empty otherwise.
create or replace function public.admin_mfa_enrolled_accounts(p_search text default null)
returns table (
  profile_id uuid,
  full_name text,
  role public.user_role,
  doctor_tier public.doctor_tier,
  verified_factors bigint,
  last_reset_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select p.id, p.full_name, p.role,
         (select cs.doctor_tier from public.clinical_staff cs where cs.profile_id = p.id order by cs.active desc limit 1),
         count(f.id) filter (where f.status = 'verified'),
         (select max(r.reset_at) from public.mfa_factor_resets r where r.target_profile_id = p.id)
    from public.profiles p
    join auth.mfa_factors f on f.user_id = p.id
   where private.is_admin()
     and (nullif(btrim(coalesce(p_search, '')), '') is null
          or p.full_name ilike '%' || replace(replace(replace(btrim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%')
   group by p.id
   order by p.full_name nulls last
   limit 200;
$$;

create or replace function public.admin_mfa_factor_resets(p_limit integer default 50)
returns table (
  target_name text,
  reset_by_name text,
  reason text,
  factors_removed integer,
  sessions_ended integer,
  reset_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $$
  select t.full_name, b.full_name, r.reason, r.factors_removed, r.sessions_ended, r.reset_at
    from public.mfa_factor_resets r
    left join public.profiles t on t.id = r.target_profile_id
    left join public.profiles b on b.id = r.reset_by
   where private.is_admin()
   order by r.reset_at desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

revoke all on function public.admin_reset_mfa_factors(uuid, text) from public, anon;
revoke all on function public.admin_mfa_enrolled_accounts(text) from public, anon;
revoke all on function public.admin_mfa_factor_resets(integer) from public, anon;
grant execute on function public.admin_reset_mfa_factors(uuid, text) to authenticated;
grant execute on function public.admin_mfa_enrolled_accounts(text) to authenticated;
grant execute on function public.admin_mfa_factor_resets(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Self-check: every group exists and is off; anon can execute none of the new functions; is_org_staff and is_admin carry the
-- new clause.
-- ---------------------------------------------------------------------------
do $$
declare
  v_roles int; v_tiers int; v_rows int; v_on int;
begin
  select count(*) into v_roles from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'user_role';
  select count(*) into v_tiers from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typname = 'doctor_tier';
  select count(*), count(*) filter (where required) into v_rows, v_on from public.mfa_group_requirements;
  if v_rows <> v_roles + v_tiers then
    raise exception 'mfa_group_requirements: % rows, expected %', v_rows, v_roles + v_tiers;
  end if;
  if v_on <> 0 then
    raise exception 'mfa_group_requirements: % group(s) on; every group must ship off', v_on;
  end if;
  if has_function_privilege('anon', 'public.set_mfa_group_requirement(public.user_role, public.doctor_tier, boolean, text, integer, integer, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_mfa_requirement()', 'EXECUTE')
     or has_function_privilege('anon', 'public.mfa_any_group_required()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_mfa_group_requirements()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_mfa_group_requirement_changes(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.mfa_requirement_met()', 'EXECUTE')
     or has_function_privilege('anon', 'private.mfa_required_for(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_reset_mfa_factors(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_mfa_enrolled_accounts(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_mfa_factor_resets(integer)', 'EXECUTE') then
    raise exception 'anon can execute a 2FA requirement function';
  end if;
  if has_table_privilege('anon', 'public.mfa_group_requirements', 'SELECT')
     or has_table_privilege('authenticated', 'public.mfa_group_requirements', 'UPDATE')
     or has_table_privilege('authenticated', 'public.mfa_group_requirement_changes', 'INSERT')
     or has_table_privilege('anon', 'public.mfa_factor_resets', 'SELECT')
     or has_table_privilege('authenticated', 'public.mfa_factor_resets', 'INSERT') then
    raise exception 'mfa_group_requirements tables carry a grant they must not';
  end if;
  if position('mfa_requirement_met' in pg_get_functiondef('private.is_org_staff(uuid)'::regprocedure)) = 0
     or position('mfa_requirement_met' in pg_get_functiondef('private.is_admin()'::regprocedure)) = 0
     or position('mfa_requirement_met' in pg_get_functiondef('private.has_emergency_access(uuid, public.care_access_category)'::regprocedure)) = 0
     or position('mfa_requirement_met' in pg_get_functiondef('private.has_permission(text)'::regprocedure)) = 0
     or position('mfa_requirement_met' in pg_get_functiondef('private.task_is_mine(uuid, uuid, uuid, public.clinical_task_state)'::regprocedure)) = 0 then
    raise exception 'a staff data helper does not check the 2FA requirement';
  end if;
end $$;

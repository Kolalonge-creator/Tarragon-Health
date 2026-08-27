-- Patient Health Record architecture review — profiles column-level write
-- guard.
--
-- profiles_update (core_auth_multitenancy.sql:227-236) has always said, in
-- its own comment, "Role escalation is prevented by only allowing
-- staff/admin to change organisation_id/role (patients can edit their own
-- demographics)" — but the policy body only ever checked ROW ownership
-- (id = auth.uid()), never WHICH COLUMNS changed. Postgres RLS is row-level,
-- not column-level, so the comment described intent the policy never
-- enforced. That is the exact same class of gap already found and fixed
-- once on this table for SELECT (20260807112503_clinician_phone_admin_only_
-- visibility.sql, a patient reading a clinician's whole row through a
-- name-only-intended clause) — this closes the matching gap on UPDATE.
--
-- Left as-is today, a patient's own JWT — calling PostgREST directly, not
-- through the app's server actions — can update any column on their own
-- profiles row via the existing `grant update on public.profiles to
-- authenticated`, including role, organisation_id, patient_number,
-- identity_verified_at, and the hbv_status/hcv_status/hiv_status serology
-- state. This migration blocks exactly that set of columns from changing on
-- a DIRECT self-edit, without touching legitimate write paths:
--
--   * Staff/admin editing a patient's row (is_admin() or is_org_staff())
--     still works untouched — this only restricts a patient's OWN row.
--   * System-internal cascades still work untouched.
--     private.advance_serology_status() (20260802212314_serology_state_
--     machine.sql) sets hiv/hbv/hcv_status via an UPDATE issued from inside
--     an AFTER INSERT trigger on screening_results, not a direct client
--     statement — pg_trigger_depth() is >1 in that case (nested inside the
--     screening_results trigger), so the guard below only fires at depth<=1,
--     i.e. a statement issued directly against profiles.
--   * Every other patient self-service write already in production remains
--     untouched: state/city/area, avatar_url, language, condition_language_
--     preference, emergency_contact_*/next_of_kin_*, receives_care +
--     onboarding_completed_at (joinAsPatientToo/onboarding actions.ts), and
--     date_of_birth/sex during onboarding — none of those columns are in
--     the denylist below. (date_of_birth/sex/full_name freely editable
--     forever after onboarding, not just during it, is a separate, real
--     product question — see docs/PATIENT_HEALTH_RECORD_ARCHITECTURE.md
--     §1.5 for that open item; not decided or touched here.)
--
-- Denylist, not allowlist: profiles has ~30 columns added by 20+ migrations
-- for many features, most with their own legitimate direct-client write
-- paths already verified against production code (apps/web/src). An
-- allowlist risks silently breaking a path this review didn't enumerate; a
-- denylist of the specific columns with no legitimate direct-client writer
-- anywhere in the app is the lower-risk fix for the confirmed gap.
--
-- CORRECTED after real production testing (not caught by static review):
-- the first version of this denylist included `account_purpose`, based on
-- 20260801093000_supporter_accounts.sql's own text — that column does not
-- actually exist on the live `profiles` table (confirmed via information_
-- schema.columns), so every self-edit, even to an allowed column, raised
-- `record "new" has no field "account_purpose"` the moment this trigger was
-- live. Removed. Separately, a concurrent session working on partner-org
-- self-service features found this same trigger already live (applied
-- ahead of this PR merging, to let it be tested against production) and
-- extended it, correctly, to also guard a real privileged column this
-- review had no way to know about: `is_partner_admin`
-- (20260827203757_guard_profiles_self_update_committed_and_partner_admin,
-- applied directly to the project, not yet reflected as its own file in
-- this repo) — kept here rather than reverted.

create or replace function private.guard_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_self_direct_edit boolean;
begin
  -- pg_trigger_depth() is 1 for a statement issued directly against
  -- profiles (this trigger is the only one firing); >1 means this UPDATE
  -- was itself issued from inside another trigger (a system-internal
  -- cascade, e.g. advance_serology_status) — those are trusted and skip
  -- the guard entirely.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_self_direct_edit :=
    (select auth.uid()) is not null
    and (select auth.uid()) = old.id
    and not private.is_admin()
    and not (old.organisation_id is not null and private.is_org_staff(old.organisation_id));

  if not v_is_self_direct_edit then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role cannot be changed by the account owner';
  end if;
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'profiles.organisation_id cannot be changed by the account owner';
  end if;
  if new.patient_number is distinct from old.patient_number then
    raise exception 'profiles.patient_number cannot be changed by the account owner';
  end if;
  if new.staff_number is distinct from old.staff_number then
    raise exception 'profiles.staff_number cannot be changed by the account owner';
  end if;
  if new.custom_role_id is distinct from old.custom_role_id then
    raise exception 'profiles.custom_role_id cannot be changed by the account owner';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'profiles.is_active cannot be changed by the account owner';
  end if;
  if new.is_dependent_account is distinct from old.is_dependent_account then
    raise exception 'profiles.is_dependent_account cannot be changed by the account owner';
  end if;
  if new.identity_verified_at is distinct from old.identity_verified_at then
    raise exception 'profiles.identity_verified_at cannot be changed by the account owner';
  end if;
  if new.hbv_status is distinct from old.hbv_status then
    raise exception 'profiles.hbv_status cannot be changed by the account owner';
  end if;
  if new.hcv_status is distinct from old.hcv_status then
    raise exception 'profiles.hcv_status cannot be changed by the account owner';
  end if;
  if new.hiv_status is distinct from old.hiv_status then
    raise exception 'profiles.hiv_status cannot be changed by the account owner';
  end if;
  if new.lab_provider_id is distinct from old.lab_provider_id then
    raise exception 'profiles.lab_provider_id cannot be changed by the account owner';
  end if;
  if new.pharmacy_partner_id is distinct from old.pharmacy_partner_id then
    raise exception 'profiles.pharmacy_partner_id cannot be changed by the account owner';
  end if;
  if new.is_partner_admin is distinct from old.is_partner_admin then
    raise exception 'profiles.is_partner_admin cannot be changed by the account owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at cannot be changed by the account owner';
  end if;

  return new;
end;
$$;

comment on function private.guard_profiles_self_update() is
  'BEFORE UPDATE guard on public.profiles: blocks a direct, top-level self-edit (patient/staff editing their own row, not staff/admin editing someone else''s, not a system-internal trigger cascade) from changing role/organisation_id/patient_number/staff_number/custom_role_id/is_active/is_dependent_account/identity_verified_at/hbv_status/hcv_status/hiv_status/lab_provider_id/pharmacy_partner_id/is_partner_admin/created_at. See migration header for why this is a denylist, not an allowlist, why pg_trigger_depth() is used to exempt internal cascades like advance_serology_status, and why account_purpose (in an earlier version of this comment) is gone and is_partner_admin is new.';

drop trigger if exists profiles_guard_self_update on public.profiles;
create trigger profiles_guard_self_update
  before update on public.profiles
  for each row execute function private.guard_profiles_self_update();

-- ---------------------------------------------------------------------------
-- Assertions — schema-level only (trigger exists, fires BEFORE UPDATE, is
-- attached to the right function). The behavioural proof (a patient session
-- genuinely cannot self-escalate role/org, a system cascade like
-- advance_serology_status still works, staff/admin editing another
-- profile is untouched) needs real fixture rows and simulated sessions, so
-- it lives in packages/db/tests/profiles_self_update_column_guard.sql —
-- same split as clinician_phone_admin_only_visibility.sql.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and t.tgname = 'profiles_guard_self_update'
      and not t.tgisinternal
  ) then
    raise exception 'FAIL: profiles_guard_self_update trigger is missing';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'guard_profiles_self_update' and p.prosecdef
  ) then
    raise exception 'FAIL: private.guard_profiles_self_update is missing or not SECURITY DEFINER';
  end if;

  raise notice 'PASS: profiles_self_update_column_guard — trigger installed on public.profiles';
end $$;

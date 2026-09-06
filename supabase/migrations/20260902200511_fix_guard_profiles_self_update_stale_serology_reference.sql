-- Tarragon Health — Fix a live regression introduced while reconciling PR #377 (Patient Identity &
-- MPI) against main-dev.
--
-- 20260830113247_patient_record_merge.sql's own header describes itself as merely "extending" the
-- self-update denylist on private.guard_profiles_self_update() to also block merged_at/
-- merged_into_profile_id. But that migration's CREATE OR REPLACE body was written against an
-- OLDER copy of the function that still checked new.hbv_status/hcv_status/hiv_status is distinct
-- from old.*. Those three columns were removed from public.profiles by a LATER migration in the
-- same 2026-08-30 batch — 20260830102308_extract_serology_status_from_profiles.sql, which moved
-- them to public.patient_serology_status and, in its own words, "must land in this same migration
-- as the DROP COLUMN below -- leaving these in place after the columns are gone means every future
-- profiles UPDATE starts erroring at runtime the first time this trigger fires." That migration
-- correctly stripped the 3 dead-column checks from the live function at the time.
--
-- PR #377's migrations were merged and applied to main-dev/this project AFTER that extraction had
-- already landed, so 20260830113247's CREATE OR REPLACE clobbered the corrected function and
-- silently reintroduced exactly the runtime hazard the extraction migration's own comment warned
-- about: NEW.hbv_status/OLD.hbv_status (and hcv_status/hiv_status) no longer exist on the profiles
-- row type, so `new.hbv_status is distinct from old.hbv_status` raises "record has no field" the
-- next time ANY patient self-edits their own profiles row (the trigger evaluates unconditionally
-- once v_is_self_direct_edit is true — not just when those columns are touched). Confirmed live via
-- pg_get_functiondef immediately after applying 20260830113247, before this fix — a real,
-- production-breaking regression, not a hypothetical one, caught before any patient could hit it.
--
-- This migration restores the function to the extraction migration's corrected body (no
-- hbv_status/hcv_status/hiv_status checks) while keeping PR #377's genuinely new
-- merged_into_profile_id/merged_at checks, so both fixes are preserved.

create or replace function private.guard_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_self_direct_edit boolean;
begin
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
  if new.merged_into_profile_id is distinct from old.merged_into_profile_id then
    raise exception 'profiles.merged_into_profile_id cannot be changed by the account owner';
  end if;
  if new.merged_at is distinct from old.merged_at then
    raise exception 'profiles.merged_at cannot be changed by the account owner';
  end if;

  return new;
end;
$$;

comment on function private.guard_profiles_self_update() is
  'BEFORE UPDATE guard on public.profiles: blocks a direct, top-level self-edit from changing role/organisation_id/patient_number/staff_number/custom_role_id/is_active/is_dependent_account/identity_verified_at/lab_provider_id/pharmacy_partner_id/is_partner_admin/created_at/merged_into_profile_id/merged_at. See 20260827192712_profiles_self_update_column_guard.sql for the original design rationale (denylist not allowlist, pg_trigger_depth() exemption for system cascades). hbv_status/hcv_status/hiv_status were removed by 20260830102308_extract_serology_status_from_profiles.sql (moved to patient_serology_status); merged_into_profile_id/merged_at added by 20260830113247_patient_record_merge.sql. This migration (20260902200511) fixes 20260830113247, which had clobbered the serology-column removal with a stale copy of this function when PR #377 was reconciled against main-dev after the extraction had already landed — see this migration''s header for the full incident.';

-- Proof, not hope: the function must reference neither dropped serology column, and must still
-- carry both of PR #377's genuinely new checks.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' and p.proname = 'guard_profiles_self_update';

  if v_def like '%hbv_status%' or v_def like '%hcv_status%' or v_def like '%hiv_status%' then
    raise exception 'FAIL: guard_profiles_self_update still references a dropped serology column';
  end if;

  if v_def not like '%merged_into_profile_id%' or v_def not like '%merged_at%' then
    raise exception 'FAIL: guard_profiles_self_update lost the merged_into_profile_id/merged_at checks';
  end if;

  raise notice 'PASS: guard_profiles_self_update restored to the post-serology-extraction body with merge-column checks intact';
end $$;

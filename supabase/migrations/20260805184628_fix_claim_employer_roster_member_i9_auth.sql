-- Tarragon Health
-- Fixes claim_employer_roster_member(), missed by 20260729124330_institutions_
-- aggregate_only_i9.sql. That migration re-admitted corporate_admin/hmo_admin
-- to employer_roster_members' own RLS policies (private.is_institution_admin()
-- and organisation_id = private.current_org_id()) since a roster is the
-- employer's own HR data, not a patient health record — but this function's
-- hand-written authorisation check inside the SECURITY DEFINER body was never
-- updated to match, so it still calls private.is_org_staff() alone, which I9
-- deliberately excludes corporate_admin/hmo_admin from. Every real
-- corporate/HMO admin click on "Attach now" has been raising "Not authorised
-- for this organisation" since 2026-07-29 — found during the 2026-08-05
-- backend/staff/B2B audit (see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md-adjacent
-- memory project_backend_staff_b2b_audit_20260805).

create or replace function public.claim_employer_roster_member(target_roster_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_roster public.employer_roster_members;
  v_profile_id uuid;
begin
  select * into v_roster from public.employer_roster_members where id = target_roster_id;
  if v_roster.id is null then
    raise exception 'Roster entry not found';
  end if;
  if not (private.is_org_staff(v_roster.organisation_id)
          or (private.is_institution_admin()
              and v_roster.organisation_id = private.current_org_id())) then
    raise exception 'Not authorised for this organisation';
  end if;
  if v_roster.status <> 'pending' then
    return false;
  end if;

  select id into v_profile_id
  from public.profiles
  where phone = v_roster.phone
    and role = 'patient'
    and organisation_id = '00000000-0000-0000-0000-000000000001'
  limit 1;

  if v_profile_id is null then
    return false;
  end if;

  update public.profiles set organisation_id = v_roster.organisation_id where id = v_profile_id;
  update public.employer_roster_members
    set status = 'claimed', claimed_profile_id = v_profile_id, claimed_at = now()
    where id = target_roster_id;

  return true;
end;
$$;

revoke execute on function public.claim_employer_roster_member(uuid) from public;
revoke execute on function public.claim_employer_roster_member(uuid) from anon;
grant execute on function public.claim_employer_roster_member(uuid) to authenticated;

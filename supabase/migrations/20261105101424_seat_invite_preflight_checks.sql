-- Tarragon Health: let the payer and provider-organisation invite actions check the caller's authority
-- BEFORE they create a login.
--
-- Security audit 2026-11-05, finding H-1. invitePayerAdminAction and inviteProviderOrgStaffAction
-- (apps/web) created a confirmed auth user with a privileged role (payer_admin / provider_org_staff),
-- a password the caller chose and signup_exempt, and only afterwards inserted the seat through the
-- caller's RLS client. When RLS refused the seat, the login stayed. So any signed-in user could mint
-- confirmed privileged-role logins for any email. Live check on 2026-11-05: 0 payer_admin and 0
-- provider_org_staff profiles exist, so it was never used.
--
-- These two functions answer exactly the question the seat tables' own RLS policies ask
-- (payer_administrators_manage, provider_org_members_manage), so the action can refuse first. The RLS
-- insert stays as the real gate, and the action now also deletes the login if the seat insert fails.

create or replace function public.can_manage_payer_seats(p_insurer_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null
     and (private.is_insurance_admin() or private.is_payer_admin_for(p_insurer_id, array['owner']::text[]));
$$;

create or replace function public.can_manage_provider_org_seats(p_organisation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null
     and (private.is_admin()
          or private.is_provider_org_staff_for(p_organisation_id, array['owner', 'hr_admin']::public.provider_org_role[]));
$$;

revoke all on function public.can_manage_payer_seats(uuid) from public;
revoke all on function public.can_manage_provider_org_seats(uuid) from public;
grant execute on function public.can_manage_payer_seats(uuid) to authenticated;
grant execute on function public.can_manage_provider_org_seats(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.can_manage_payer_seats(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.can_manage_provider_org_seats(uuid)', 'EXECUTE') then
    raise exception 'H-1: seat pre-flight functions must not be executable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.can_manage_payer_seats(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.can_manage_provider_org_seats(uuid)', 'EXECUTE') then
    raise exception 'H-1: seat pre-flight functions must be executable by authenticated';
  end if;
end $$;

-- Tarragon Health — admin action to link a lab_partner login to a lab.
--
-- Gap: /admin/settings/members already lets an admin provision a
-- 'lab_partner'-role login (USER_ROLES already includes it), but nothing
-- lets an admin then link that profile to a specific lab_providers row —
-- profiles.lab_provider_id (20260729234509) has never had a write path.
-- profiles_update RLS (id = auth.uid() OR (organisation_id is not null and
-- is_org_staff(organisation_id))) can't cover this either: a lab_partner
-- profile deliberately has organisation_id = null (it is not org-scoped),
-- so an admin editing SOMEONE ELSE's profile fails that clause outright.
-- Previously this was "no admin UI for either FK yet ... set lab_provider_id
-- via direct SQL" (see the 2026-07-27 lab_partner_role_build entry).
--
-- Fix: one SECURITY DEFINER RPC, gated the same way the Labs admin page
-- already is (is_admin() OR has_permission('partners.labs.manage')),
-- narrowly scoped to updating exactly one column on a 'lab_partner'-role
-- profile. Not a general profile-editing backdoor.

create or replace function public.admin_link_lab_partner(
  p_profile_id uuid,
  p_lab_provider_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  if not (private.is_admin() or private.has_permission('partners.labs.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_role <> 'lab_partner' then
    raise exception 'profile is not a lab_partner account' using errcode = '22023';
  end if;

  if p_lab_provider_id is not null and not exists (
    select 1 from public.lab_providers where id = p_lab_provider_id
  ) then
    raise exception 'lab provider not found' using errcode = 'P0002';
  end if;

  update public.profiles set lab_provider_id = p_lab_provider_id where id = p_profile_id;

  perform private.log_audit(
    'lab_partner.linked', 'profiles', p_profile_id,
    jsonb_build_object('lab_provider_id', p_lab_provider_id)
  );
end;
$$;

grant execute on function public.admin_link_lab_partner(uuid, uuid) to authenticated;
revoke execute on function public.admin_link_lab_partner(uuid, uuid) from public;

do $$
begin
  if has_function_privilege('anon', 'public.admin_link_lab_partner(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon can still execute admin_link_lab_partner';
  end if;
end $$;

create or replace function public.admin_set_partner_admin(
  p_profile_id uuid,
  p_is_partner_admin boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
  v_lab_provider_id uuid;
  v_pharmacy_partner_id uuid;
begin
  select role, lab_provider_id, pharmacy_partner_id
    into v_role, v_lab_provider_id, v_pharmacy_partner_id
  from public.profiles
  where id = p_profile_id;

  if v_role is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_role not in ('lab_partner', 'pharmacist') then
    raise exception 'profile is not a lab_partner or pharmacist account' using errcode = '22023';
  end if;

  if v_role = 'lab_partner' then
    if not (private.is_admin() or private.has_permission('partners.labs.manage')) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if p_is_partner_admin and v_lab_provider_id is null then
      raise exception 'Link this login to a lab before making it a partner admin.';
    end if;
  else
    if not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
      raise exception 'not authorised' using errcode = '42501';
    end if;
    if p_is_partner_admin and v_pharmacy_partner_id is null then
      raise exception 'Link this login to a pharmacy before making it a partner admin.';
    end if;
  end if;

  update public.profiles set is_partner_admin = p_is_partner_admin where id = p_profile_id;

  perform private.log_audit(
    'partner.admin_designation_changed', 'profiles', p_profile_id,
    jsonb_build_object('is_partner_admin', p_is_partner_admin, 'role', v_role)
  );
end;
$$;

grant execute on function public.admin_set_partner_admin(uuid, boolean) to authenticated;
revoke execute on function public.admin_set_partner_admin(uuid, boolean) from public;

do $$
begin
  if has_function_privilege('anon', 'public.admin_set_partner_admin(uuid, boolean)', 'EXECUTE') then
    raise exception 'anon can still execute admin_set_partner_admin';
  end if;
  raise notice 'PASS: admin_set_partner_admin present, anon denied';
end $$;

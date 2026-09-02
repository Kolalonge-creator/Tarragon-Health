create or replace function public.admin_link_pharmacist(
  p_profile_id uuid,
  p_pharmacy_partner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  if not (private.is_admin() or private.has_permission('partners.pharmacies.manage')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select role into v_role from public.profiles where id = p_profile_id;
  if v_role is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_role <> 'pharmacist' then
    raise exception 'profile is not a pharmacist account' using errcode = '22023';
  end if;

  if p_pharmacy_partner_id is not null and not exists (
    select 1 from public.pharmacy_partners where id = p_pharmacy_partner_id
  ) then
    raise exception 'pharmacy partner not found' using errcode = 'P0002';
  end if;

  update public.profiles set pharmacy_partner_id = p_pharmacy_partner_id where id = p_profile_id;

  perform private.log_audit(
    'pharmacist.linked', 'profiles', p_profile_id,
    jsonb_build_object('pharmacy_partner_id', p_pharmacy_partner_id)
  );
end;
$$;

grant execute on function public.admin_link_pharmacist(uuid, uuid) to authenticated;
revoke execute on function public.admin_link_pharmacist(uuid, uuid) from public, anon;

do $$
begin
  if has_function_privilege('anon', 'public.admin_link_pharmacist(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon can still execute admin_link_pharmacist';
  end if;
  raise notice 'PASS: admin_link_pharmacist present, anon denied';
end $$;

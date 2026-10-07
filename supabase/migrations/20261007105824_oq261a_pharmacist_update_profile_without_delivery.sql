-- OQ-261a: additive first step of the home-delivery removal (Part C.2). Adds the eight-argument pharmacist_update_profile (no p_delivery)
-- NEXT TO the existing nine-argument one, so the app code that stops sending p_delivery and the code still sending it both work while the
-- new code deploys. The destructive migration (oq261_remove_home_delivery) drops the nine-argument form once the new code is live.
-- Live body read with pg_get_functiondef on 2026-10-07; the only change is the dropped argument and its assignment. Purely additive:
-- no existing object is altered, and callers always pass named arguments, so the two forms never collide.
create or replace function public.pharmacist_update_profile(p_name text, p_regions text[], p_city text, p_state text, p_contact_phone text, p_contact_email text, p_license_number text, p_license_expires_at timestamp with time zone)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_partner_id uuid := private.pharmacist_partner();
begin
  if v_partner_id is null then
    raise exception 'Not a partner pharmacy account' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Pharmacy name is required' using errcode = '22023';
  end if;

  update public.pharmacy_partners
  set name = btrim(p_name),
      regions = coalesce(p_regions, '{}'),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state = nullif(btrim(coalesce(p_state, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
      license_number = nullif(btrim(coalesce(p_license_number, '')), ''),
      license_expires_at = p_license_expires_at
  where id = v_partner_id;
end;
$function$;
revoke all on function public.pharmacist_update_profile(text, text[], text, text, text, text, text, timestamp with time zone) from public, anon;
grant execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, text, timestamp with time zone) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('public', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE') then
    raise exception 'OQ-261a: the new overload is callable by anon or public';
  end if;
  if not has_function_privilege('authenticated', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE') then
    raise exception 'OQ-261a: the new overload lost its authenticated grant';
  end if;
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'pharmacist_update_profile') < 2 then
    raise exception 'OQ-261a: the nine-argument form must still exist until the destructive step';
  end if;
end $$;

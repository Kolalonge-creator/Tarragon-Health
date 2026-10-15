-- OQ-16 follow-up fix. The delivery removal (20261007153917_oq261_remove_home_delivery) dropped pharmacy_partners.delivery, but
-- public.pharmacist_profile() (a LANGUAGE sql function, whose body Postgres only resolves when it is called) still selected
-- p.delivery, so the pharmacist's own profile read failed and the profile screen showed "No pharmacy profile on file yet".
-- The scan that should have caught it used the regex word boundary \b, which in Postgres is a backspace (word boundary is \y);
-- a corrected scan of every function body found this was the only function still naming the dropped column.
-- Return type changes (the delivery column goes), so drop and recreate; grants are the same as before (authenticated, service_role,
-- never anon or public). An assertion calls the function so a body that does not resolve fails this migration instead of the screen.
drop function public.pharmacist_profile();
create function public.pharmacist_profile()
returns table(name text, regions text[], city text, state text, contact_phone text, contact_email text, license_number text, license_expires_at timestamp with time zone)
language sql stable security definer set search_path to '' as $function$
  select p.name, p.regions, p.city, p.state, p.contact_phone, p.contact_email,
         p.license_number, p.license_expires_at
  from public.pharmacy_partners p
  where p.id = private.pharmacist_partner();
$function$;
revoke all on function public.pharmacist_profile() from public, anon;
grant execute on function public.pharmacist_profile() to authenticated, service_role;

do $$
declare n bigint;
begin
  -- executing it resolves every column in the body (no caller, so zero rows is the expected answer)
  select count(*) into n from public.pharmacist_profile();
  if has_function_privilege('anon', 'public.pharmacist_profile()', 'EXECUTE') or has_function_privilege('public', 'public.pharmacist_profile()', 'EXECUTE') then
    raise exception 'OQ-16 fix: pharmacist_profile is callable by anon or public';
  end if;
  if not has_function_privilege('authenticated', 'public.pharmacist_profile()', 'EXECUTE') then
    raise exception 'OQ-16 fix: pharmacist_profile lost its authenticated grant';
  end if;
  -- no SQL-language function body may name a dropped pharmacy_partners column (SQL bodies are not dependency-tracked)
  if exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
               and p.prolang = (select oid from pg_language where lanname = 'sql')
               and p.prosrc ~* '(p\.delivery\y|pharmacy_partners[^;]*delivery_fee_kobo|pharmacy_orders[^;]*(delivered_at|fulfilment_method|delivery_address))') then
    raise exception 'OQ-16 fix: a SQL function still names a dropped delivery column';
  end if;
end $$;

-- Tarragon Health
-- The pharmacist-side counterpart of public.lab_partner_own_provider_id()
-- (20260730215206) — lets the client learn its own pharmacy_partner_id so it
-- can satisfy pharmacy_partner_locations' RLS with_check
-- (pharmacy_partner_id = private.pharmacist_partner()) when inserting a new
-- branch, same shape as the lab side.

create or replace function public.pharmacist_own_partner_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select private.pharmacist_partner();
$$;

grant execute on function public.pharmacist_own_partner_id() to authenticated;
revoke execute on function public.pharmacist_own_partner_id() from public;

do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_own_partner_id()', 'EXECUTE') then
    raise exception 'anon can still execute pharmacist_own_partner_id';
  end if;
  raise notice 'PASS: pharmacist_own_partner_id present, anon denied';
end $$;

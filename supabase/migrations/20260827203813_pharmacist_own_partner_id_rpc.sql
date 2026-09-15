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
revoke execute on function public.pharmacist_own_partner_id() from anon;
revoke execute on function public.pharmacist_own_partner_id() from public, anon;

do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_own_partner_id()', 'EXECUTE') then
    raise exception 'anon can still execute pharmacist_own_partner_id';
  end if;
  raise notice 'PASS: pharmacist_own_partner_id present, anon denied';
end $$;

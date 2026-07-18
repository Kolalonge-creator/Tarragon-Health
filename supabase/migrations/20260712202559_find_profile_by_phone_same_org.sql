-- Tarragon Health
-- Lets a patient locate a family member's existing profile by phone number,
-- scoped to their own organisation, so /patient/family's "add a family
-- member" flow can enroll someone who has already signed up (family_plan_
-- members.member_id is a not-null FK to profiles — there is no way to add
-- someone who hasn't registered yet). Deliberately narrow: only returns a
-- match within the caller's own organisation_id, so this can't be used as a
-- cross-org phone-number enumeration oracle. Lives in `public` (not
-- `private`) for the same reason has_feature_access does — PostgREST only
-- exposes public-schema functions (config.toml [api].schemas).
create or replace function public.find_profile_by_phone(lookup_phone text)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.phone = lookup_phone
    and p.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))
    and p.role = 'patient'
  limit 1;
$$;

revoke execute on function public.find_profile_by_phone(text) from public;
revoke execute on function public.find_profile_by_phone(text) from anon;
grant execute on function public.find_profile_by_phone(text) to authenticated;

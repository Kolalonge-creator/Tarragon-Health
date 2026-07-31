-- Where Tarragon actually operates, readable without an account.
--
-- The state rollout gate (region_service_available, 20260717100000) has always
-- been authenticated-only: service_regions has a single SELECT policy scoped to
-- `authenticated`, and anon holds no EXECUTE on the predicate. That is correct
-- for the in-app RegionGate, but it means the one question a prospective buyer
-- most needs answered before paying -- "does any of this actually work where my
-- mother lives?" -- could only be answered after signing up.
--
-- That question is sharpest for a diaspora buyer. They are choosing a state they
-- do not live in, for a person they cannot ask to test it, and the partner-
-- dependent half of the product (labs, pharmacy, specialists, home visits,
-- delivery) is exactly the half that is dark outside a live state. Finding that
-- out after checkout is the kind of surprise a new brand does not survive.
--
-- What this exposes is only where the company operates: one boolean per service
-- per state, the same fact any coverage map on any marketing site states out
-- loud. No counts, no partner identities, no patient-derived data of any kind.
-- It reads through the existing predicate rather than reimplementing it, so the
-- public answer can never drift from the one the app enforces.
create or replace function public.public_service_coverage()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'state', sr.state,
        'display_name', sr.display_name,
        'is_active', sr.is_active,
        'services', jsonb_build_object(
          'lab',        public.region_service_available(sr.state, 'lab'),
          'pharmacy',   public.region_service_available(sr.state, 'pharmacy'),
          'specialist', public.region_service_available(sr.state, 'specialist'),
          'home_visit', public.region_service_available(sr.state, 'home_visit'),
          'delivery',   public.region_service_available(sr.state, 'delivery')
        )
      )
      order by sr.display_name
    ),
    '[]'::jsonb
  )
  from public.service_regions sr;
$$;

-- Deliberately anon-callable: this one is meant to be public.
--
-- Note the order. A newly created function carries a PUBLIC pseudo-role EXECUTE
-- grant, and anon inherits from PUBLIC rather than holding a grant of its own,
-- which is why `revoke ... from anon` is a no-op on a fresh function and
-- `revoke ... from public` is what actually clears it. Here we clear the blanket
-- first and then grant back by name, so the access is explicit and auditable
-- instead of inherited by accident.
revoke all on function public.public_service_coverage() from public;
grant execute on function public.public_service_coverage() to anon, authenticated;

do $$
begin
  if not has_function_privilege('anon', 'public.public_service_coverage()', 'EXECUTE') then
    raise exception 'anon must be able to read the public coverage map';
  end if;
  if not has_function_privilege('authenticated', 'public.public_service_coverage()', 'EXECUTE') then
    raise exception 'authenticated must be able to read the public coverage map';
  end if;
end $$;

-- Laboratory Network, part 4: provider/location discovery for booking (§56.7).
--
-- WHAT'S ALREADY GENERAL, CONFIRMED BEFORE WRITING THIS
-- ------------------------------------------------------
-- private.resolve_lab_order_provider (20260821191942) already resolves an
-- explicitly-named provider_id or facility_id before ever falling back to
-- "the single active laboratory"; public.region_service_available
-- (20260717101000) already uses `exists (...)`, not "exactly one"; the
-- lab_orders_insert RLS policy (20260729122912) only checks patient_id/
-- origin/ordered_by, never provider_id. So a patient inserting a
-- fulfilment='partner' lab_orders row with an explicit provider_id already
-- works today for however many laboratories are active — nothing here
-- changes any of that. The one real gap: nothing let a patient discover
-- WHICH active providers/branches actually offer a given test before
-- booking, so app/actions.ts always left provider_id null and relied on the
-- single-provider fallback.
--
-- This is a read-only discovery RPC, not a schema change. SECURITY DEFINER
-- for the same reason lab_partner_orders is: it composes lab_providers,
-- lab_provider_locations and lab_tests, all already authenticated-readable,
-- so definer mode adds no new exposure — it only avoids requiring a client
-- to run three separate queries and filter client-side.
create or replace function public.list_lab_test_locations(
  p_test_code text default null,
  p_state     text default null
)
returns table (
  provider_id       uuid,
  provider_name     text,
  integration_status public.lab_integration_status,
  accreditation     text,
  location_id       uuid,
  location_name     text,
  location_state    text,
  location_address  text,
  contact_phone     text,
  opening_hours     jsonb,
  capabilities      text[],
  turnaround_hours  integer,
  price_kobo        bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    lp.id, lp.name, lp.integration_status, lp.accreditation,
    lpl.id, lpl.name, lpl.state, lpl.address, lpl.contact_phone,
    lpl.opening_hours, lpl.capabilities,
    lt.turnaround_hours, lt.price_kobo
  from public.lab_providers lp
  join public.lab_provider_locations lpl on lpl.lab_provider_id = lp.id and lpl.is_active
  left join public.lab_tests lt
    on lt.provider_id = lp.id
   and lt.is_active
   and (p_test_code is null or lt.code = p_test_code)
  where lp.is_active
    and (p_test_code is null or lt.id is not null)
    and (p_state is null or lpl.state = p_state)
  order by lp.name, lpl.state, lpl.name;
$$;

comment on function public.list_lab_test_locations(text, text) is
  '§56.6/§56.7: which active laboratory branches offer a given test (or, with no test code, every active branch), optionally filtered to one state. Backs the booking flow''s location-selection step. Read-only over already-authenticated-readable catalogues.';

revoke all on function public.list_lab_test_locations(text, text) from public, anon;
grant execute on function public.list_lab_test_locations(text, text) to authenticated;

do $$
declare
  v_count int;
begin
  -- The migration is the test: Synlab is the one real active provider, so
  -- this must resolve at least its own branches for a code it actually
  -- prices, and must return nothing for a code no active provider prices.
  select count(*) into v_count from public.list_lab_test_locations('hba1c', null);
  if v_count = 0 then
    raise exception 'list_lab_test_locations found no branch offering hba1c, despite an active priced provider';
  end if;

  select count(*) into v_count from public.list_lab_test_locations('not_a_real_test_code', null);
  if v_count <> 0 then
    raise exception 'list_lab_test_locations returned rows for a test code no active provider offers';
  end if;
end $$;

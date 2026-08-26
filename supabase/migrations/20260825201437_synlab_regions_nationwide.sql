-- Synlab Nigeria's regions column listed only Lagos/Abuja, but its real
-- branch network (see lab_provider_locations seed data, sourced from
-- synlab.com.ng/locations/) spans far more states. Confirmed before this
-- change that lab_providers.regions is informational/display-only in this
-- codebase — private.set_lab_order_computed_price and the partner-lab
-- billing opt-in (bundleIsPartnerBillable) gate purely on contracted price
-- availability, never on regions — so this is a descriptive correction, not
-- a change to real booking eligibility. Founder confirmed proceeding anyway.
update public.lab_providers
set regions = array[
  'Lagos', 'Abuja', 'Ogun', 'Edo', 'Benue', 'Delta', 'Ebonyi', 'Enugu',
  'Oyo', 'Osun', 'Kwara', 'Kaduna', 'Anambra', 'Imo', 'Rivers'
]
where name = 'Synlab Nigeria';

do $$
declare
  v_count integer;
begin
  select array_length(regions, 1) into v_count
  from public.lab_providers where name = 'Synlab Nigeria';
  if v_count <> 15 then
    raise exception 'Synlab Nigeria regions update did not take: expected 15 states, got %', v_count;
  end if;
end $$;

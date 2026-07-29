-- Tarragon Health — region_service_available(state, service): the single gate predicate
--
-- Returns true only when a partner-dependent service can actually be delivered in a state:
--   (1) the state's master switch is on (public.service_regions.is_active), AND
--   (2) an ACTIVE partner of that service type covers the state.
--
-- Both conditions matter: (1) alone lets a live state with no partner still say "coming
-- soon"; (2) alone (an active partner in a state ops hasn't launched) is deliberately NOT
-- enough — the state stays dark until an admin flips service_regions.is_active. This is the
-- whole point of the master switch (load Abuja's partners early, keep Abuja closed).
--
-- The partner check branches by service because the catalogues use two location models:
--   • regions text[]  → lab_providers, home_visit_providers, logistics_partners  (@> match)
--   • state text      → pharmacy_partners, specialist_providers, facilities
--   • labs are booked at a facilities row linked to a lab_provider (facility-selection
--     build), so lab availability = an active lab facility linked to an active lab_provider
--     in the state, OR an active lab_provider whose regions cover it.
--
-- Used by BOTH the patient UI (useRegionServiceAvailable) and the DB enforcement triggers
-- on lab_orders/pharmacy_orders, so the app and the database can never disagree on the gate.
--
-- security definer + stable: it only reads global, authenticated-readable catalogues, so it
-- leaks nothing, and running as definer lets it evaluate cleanly inside a patient-initiated
-- insert trigger regardless of the caller's RLS scope. Valid services: 'lab', 'pharmacy',
-- 'home_visit', 'delivery', 'specialist'. Any other value (or a null state) returns false.

create or replace function public.region_service_available(p_state text, p_service text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_state is not null
    and exists (
      select 1 from public.service_regions sr
      where sr.state = p_state and sr.is_active
    )
    and case p_service
      when 'lab' then (
        exists (
          select 1
          from public.facilities f
          join public.lab_providers lp on lp.id = f.lab_provider_id
          where f.type = 'lab' and f.is_active and lp.is_active and f.state = p_state
        )
        or exists (
          select 1 from public.lab_providers lp
          where lp.is_active and lp.regions @> array[p_state]
        )
      )
      when 'pharmacy' then (
        exists (
          select 1 from public.pharmacy_partners pp
          where pp.is_active and (pp.state = p_state or pp.regions @> array[p_state])
        )
        or exists (
          select 1
          from public.facilities f
          join public.pharmacy_partners pp on pp.id = f.pharmacy_partner_id
          where f.type = 'pharmacy' and f.is_active and pp.is_active and f.state = p_state
        )
      )
      when 'home_visit' then exists (
        select 1 from public.home_visit_providers hv
        where hv.is_active and hv.regions @> array[p_state]
      )
      when 'delivery' then exists (
        select 1 from public.logistics_partners lg
        where lg.is_active and lg.regions @> array[p_state]
      )
      when 'specialist' then exists (
        select 1 from public.specialist_providers sp
        where sp.is_active and sp.state = p_state
      )
      else false
    end;
$$;

grant execute on function public.region_service_available(text, text) to authenticated;

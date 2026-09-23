-- Tarragon Health — region_service_available: normalized-state-fallback proof
--
-- Verifies 20260923212037_region_service_available_normalized_state_fallback.sql and its
-- same-day 20260923213439_fix_region_service_available_review_findings.sql follow-up: a
-- casing/whitespace/"...State"-suffix variant of a patient's on-file state now resolves
-- the gate the same as the canonical spelling, for both location models the function
-- branches on (regions text[] and state text — see the function's own header comment),
-- while the master switch (service_regions.is_active) and a genuinely unrecognized
-- location still correctly resolve to false, and service_regions_normalized_state_key_unique
-- rejects a normalized-key collision outright (the review-findings follow-up's fix for the
-- `resolved` CTE's otherwise-nondeterministic tie-break). Ends with a sabotage step that
-- reverts region_service_available to its pre-fix exact-match-only body and confirms the
-- normalized-variant check would have failed against it — proving this test actually
-- discriminates, not just that it always returns true.
--
-- Builds its own service_regions/partner rows under a dedicated, non-real state name
-- ('Testland') rather than depending on Lagos or any seeded partner data, so this proof
-- never depends on what supabase/seed/seed.sql happens to contain for the real launch
-- state. Wrapped in BEGIN/ROLLBACK — nothing here is ever committed.

begin;

do $$
declare
  v_available boolean;
begin
  -- Fixtures: two dedicated test states, deliberately not among the real 37 Nigerian
  -- states + FCT so this proof can never collide with or depend on live/seeded data.
  --   'Testland'    — master switch ON, one active partner per service.
  --   'Testlandoff' — master switch OFF, but an active partner still exists, to prove
  --                    normalization never bypasses the is_active gate.
  insert into public.service_regions (state, display_name, is_active, activated_at)
  values
    ('Testland', 'Testland', true, now()),
    ('Testlandoff', 'Testlandoff', false, null);

  insert into public.lab_providers (name, is_active, regions)
  values ('RSA Test Lab Partner', true, array['Testland']);

  -- onboarding_status = 'activated' satisfies pharmacy_partners_active_requires_activated_onboarding.
  insert into public.pharmacy_partners (name, is_active, state, onboarding_status)
  values ('RSA Test Pharmacy Partner', true, 'Testland', 'activated');

  insert into public.home_visit_providers (name, is_active, regions)
  values ('RSA Test Home Visit Partner', true, array['Testland']);

  insert into public.logistics_partners (name, is_active, regions)
  values ('RSA Test Logistics Partner', true, array['Testland']);

  -- verification_stage = 'active' satisfies specialist_providers_active_requires_verification_stage.
  insert into public.specialist_providers (specialist_type, name, is_active, state, verification_stage)
  values ('cardiology', 'RSA Test Specialist Partner', true, 'Testland', 'active');

  -- Master-switch-off twin: a real, active partner covering 'Testlandoff', which must
  -- still resolve to false because service_regions.is_active is false for that state.
  insert into public.home_visit_providers (name, is_active, regions)
  values ('RSA Test Home Visit Partner (off state)', true, array['Testlandoff']);

  -- 1) Exact canonical match — every service, every location model — must still work.
  if not public.region_service_available('Testland', 'lab') then
    raise exception 'FAIL: region_service_available(Testland, lab) exact match expected true';
  end if;
  if not public.region_service_available('Testland', 'pharmacy') then
    raise exception 'FAIL: region_service_available(Testland, pharmacy) exact match expected true';
  end if;
  if not public.region_service_available('Testland', 'home_visit') then
    raise exception 'FAIL: region_service_available(Testland, home_visit) exact match expected true';
  end if;
  if not public.region_service_available('Testland', 'delivery') then
    raise exception 'FAIL: region_service_available(Testland, delivery) exact match expected true';
  end if;
  if not public.region_service_available('Testland', 'specialist') then
    raise exception 'FAIL: region_service_available(Testland, specialist) exact match expected true';
  end if;
  raise notice 'PASS 1: exact canonical match works for all five services';

  -- 2) Normalized fallback — a casing/whitespace/"...State"-suffix variant, the exact
  -- shape a patient's stale free-text profiles.state can hold — must resolve identically
  -- to the canonical spelling, for both the regions[] model (lab/home_visit/delivery) and
  -- the state-text model (pharmacy/specialist).
  if public.region_service_available('testland state', 'lab') is distinct from true then
    raise exception 'FAIL: region_service_available(''testland state'', lab) expected true (regions[] model, normalized fallback)';
  end if;
  if public.region_service_available('  TESTLAND  ', 'home_visit') is distinct from true then
    raise exception 'FAIL: region_service_available(''  TESTLAND  '', home_visit) expected true (regions[] model, normalized fallback)';
  end if;
  if public.region_service_available('Testland State', 'delivery') is distinct from true then
    raise exception 'FAIL: region_service_available(''Testland State'', delivery) expected true (regions[] model, normalized fallback)';
  end if;
  if public.region_service_available('TESTLAND state', 'pharmacy') is distinct from true then
    raise exception 'FAIL: region_service_available(''TESTLAND state'', pharmacy) expected true (state-text model, normalized fallback)';
  end if;
  if public.region_service_available('testland State', 'specialist') is distinct from true then
    raise exception 'FAIL: region_service_available(''testland State'', specialist) expected true (state-text model, normalized fallback)';
  end if;
  raise notice 'PASS 2: casing/whitespace/"...State"-suffix variants resolve identically to the canonical spelling, both location models';

  -- 3) CONTROL — the master switch still gates the normalized fallback exactly as it
  -- gates an exact match. A real active partner exists for 'Testlandoff', but its
  -- service_regions row is is_active = false, so both the exact AND the normalized
  -- spelling must resolve false.
  if public.region_service_available('Testlandoff', 'home_visit') then
    raise exception 'FAIL: region_service_available(Testlandoff, home_visit) must be false — master switch is off';
  end if;
  if public.region_service_available('testlandoff state', 'home_visit') then
    raise exception 'FAIL: region_service_available(''testlandoff state'', home_visit) must be false — normalization must not bypass the master switch';
  end if;
  raise notice 'PASS 3: normalization never bypasses the service_regions.is_active master switch';

  -- 4) CONTROL — a genuinely unrecognized location (matches nothing, canonical or
  -- normalized) must still resolve false. Normalization must never manufacture a false
  -- positive.
  if public.region_service_available('Nowhereland', 'lab') then
    raise exception 'FAIL: region_service_available(Nowhereland, lab) must be false — no canonical or normalized match exists';
  end if;
  if public.region_service_available(null, 'lab') then
    raise exception 'FAIL: region_service_available(null, lab) must be false';
  end if;
  raise notice 'PASS 4: an unrecognized location and a null state both correctly resolve false';

  -- 5) CONTROL — service_regions_normalized_state_key_unique (added in the same-day
  -- review-findings follow-up migration) must reject a second row that normalizes to an
  -- existing key, so the `resolved` CTE's `limit 1` can never have an ambiguous tie to
  -- break. A literal 'TESTLAND' row collides with the already-inserted 'Testland'.
  begin
    insert into public.service_regions (state, display_name) values ('TESTLAND', 'Testland (duplicate)');
    raise exception 'FAIL: inserting a service_regions row that normalizes to an existing key (TESTLAND vs Testland) should have been rejected by service_regions_normalized_state_key_unique';
  exception
    when unique_violation then
      raise notice 'PASS 5: service_regions_normalized_state_key_unique correctly rejected a normalized-key collision (TESTLAND vs Testland)';
  end;

  -- 6) SABOTAGE — revert region_service_available to its pre-fix, exact-match-only body
  -- (same logic, minus the normalized fallback) and confirm the PASS 2 assertion above
  -- would now fail against it. This proves PASS 2 actually discriminates rather than
  -- passing vacuously.
  create or replace function public.region_service_available(p_state text, p_service text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $sabotage$
    select
      p_state is not null
      and exists (
        select 1 from public.service_regions sr
        where sr.state = p_state and sr.is_active
      )
      and case p_service
        when 'lab' then exists (
          select 1 from public.lab_providers lp
          where lp.is_active and lp.regions @> array[p_state]
        )
        when 'pharmacy' then exists (
          select 1 from public.pharmacy_partners pp
          where pp.is_active and pp.state = p_state
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
  $sabotage$;

  v_available := public.region_service_available('testland state', 'lab');
  if v_available is not false then
    raise exception 'SABOTAGE CHECK FAILED: reverting to exact-match-only logic should have made ''testland state'' resolve false, got %. This means PASS 2 would not actually catch a regression.', v_available;
  end if;
  raise notice 'PASS 6 (sabotage): reverting the normalized fallback correctly breaks the ''testland state'' case — this test would have caught the original bug';

  raise notice 'ALL REGION_SERVICE_AVAILABLE NORMALIZED-STATE-FALLBACK CHECKS PASSED';
end $$;

rollback;

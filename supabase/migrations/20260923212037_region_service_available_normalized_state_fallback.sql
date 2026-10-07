-- Tarragon Health — region_service_available: case/whitespace-tolerant state fallback
--
-- Bug: public.region_service_available(p_state, p_service) did an EXACT string match
-- (`sr.state = p_state`) against public.service_regions, then used the raw, unmodified
-- p_state for every downstream partner-catalogue comparison too (facilities.state,
-- *_providers.regions @> array[p_state], etc). patient_location_form.tsx's free-text state
-- field (pre-Select) has always allowed a patient's profiles.state to drift from the
-- canonical service_regions.state spelling — old free-text data, a casing variant, a
-- trailing "State" a Nigerian patient naturally types ("Lagos State"), or an FCT/Abuja
-- alias. Any of these silently told a fully-serviced patient every region-gated service
-- (lab, pharmacy, home_visit, delivery, specialist) was "not available yet" / "coming
-- soon" — RegionGate and the lab_orders/pharmacy_orders enforcement triggers both call
-- this same function, so app UI and DB enforcement agreed on the wrong answer together,
-- with no error or signal anywhere that the real cause was a stale/mistyped profile field,
-- not actual lack of coverage.
--
-- One-time data audit (run live against koiplnmbgnqnbywhpjlf, 2026-09-23): of 18
-- profiles.state values on file, exactly 1 does not exactly match a service_regions.state
-- row — and it is 'United Kingdom' (a diaspora patient's home-country field, city
-- "Stoke-on-Trent"), not a Nigerian-state typo. There is nothing to safely auto-correct
-- today: normalizing that value to a Nigerian state would be actively wrong (this patient
-- genuinely is not in a serviced region), so no backfill UPDATE is included here. The fix
-- below is forward-looking — it protects every patient going forward for as long as the
-- location field stays free text (see patient-location-form.tsx's in-progress Select-based
-- fix, branch fix/onboarding-signup-ux-audit, which reduces but does not eliminate new
-- drift: a patient can still save without re-selecting from its "(on file, please
-- reselect)" fallback option) and correctly still resolves a genuinely non-Nigerian value
-- like the UK case above to "not available", never a false positive.
--
-- Fix: resolve p_state to its canonical service_regions.state once, up front — exact
-- match preferred, falling back to private.normalize_ng_state() (lowercase, trim, collapse
-- whitespace, strip a trailing "state" suffix, fold common FCT/Abuja spellings) only when
-- no exact match exists — then use that resolved canonical value for every downstream
-- comparison, not just the master-switch check. A canonical p_state behaves byte-identical
-- to before (see this migration's own assertions below); a non-canonical-but-recognizable
-- variant now resolves the same as its canonical spelling; a value that matches nothing,
-- canonical or normalized, still correctly returns false.

create or replace function private.normalize_ng_state(p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  with base as (
    select regexp_replace(
             regexp_replace(lower(trim(coalesce(p_state, ''))), '\s+', ' ', 'g'),
             '\s*state\s*$', '', 'i'
           ) as v
  )
  select nullif(
    case
      when v in ('fct', 'federal capital territory', 'abuja fct', 'fct abuja') then 'abuja'
      else v
    end,
    ''
  )
  from base;
$$;

comment on function private.normalize_ng_state(text) is
  'Case/whitespace-insensitive Nigerian-state normalizer: lowercases, trims, collapses '
  'whitespace, strips a trailing "state" suffix ("Lagos State" -> "lagos"), and folds '
  'common FCT/Abuja spellings to "abuja" (service_regions seeds the FCT row as '
  'state = ''Abuja'', see 20260717100000_service_regions.sql). Pure text transform, no '
  'data access, no caller-identity check — used only as a fallback match inside '
  'public.region_service_available when the exact string does not match a canonical '
  'service_regions.state. Returns null for blank/null input.';

-- Pure internal helper, not meant to be called directly by any role — narrow revoke per
-- the documented private-schema default (every new private.* function is born
-- authenticated-executable; see reference_private_schema_authenticated_default_is_intentional).
revoke execute on function private.normalize_ng_state(text) from public;

create or replace function public.region_service_available(p_state text, p_service text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with resolved as (
    select sr.state as canonical_state
    from public.service_regions sr
    where sr.state = p_state
       or private.normalize_ng_state(sr.state) = private.normalize_ng_state(p_state)
    order by (sr.state = p_state) desc
    limit 1
  )
  select
    p_state is not null
    and exists (
      select 1
      from public.service_regions sr
      join resolved r on sr.state = r.canonical_state
      where sr.is_active
    )
    and case p_service
      when 'lab' then (
        exists (
          select 1
          from public.facilities f
          join public.lab_providers lp on lp.id = f.lab_provider_id
          join resolved r on f.state = r.canonical_state
          where f.type = 'lab' and f.is_active and lp.is_active
        )
        or exists (
          select 1
          from public.lab_providers lp
          join resolved r on true
          where lp.is_active and lp.regions @> array[r.canonical_state]
        )
      )
      when 'pharmacy' then (
        exists (
          select 1
          from public.pharmacy_partners pp
          join resolved r on true
          where pp.is_active and (pp.state = r.canonical_state or pp.regions @> array[r.canonical_state])
        )
        or exists (
          select 1
          from public.facilities f
          join public.pharmacy_partners pp on pp.id = f.pharmacy_partner_id
          join resolved r on f.state = r.canonical_state
          where f.type = 'pharmacy' and f.is_active and pp.is_active
        )
      )
      when 'home_visit' then exists (
        select 1
        from public.home_visit_providers hv
        join resolved r on true
        where hv.is_active and hv.regions @> array[r.canonical_state]
      )
      when 'delivery' then exists (
        select 1
        from public.logistics_partners lg
        join resolved r on true
        where lg.is_active and lg.regions @> array[r.canonical_state]
      )
      when 'specialist' then exists (
        select 1
        from public.specialist_providers sp
        join resolved r on sp.state = r.canonical_state
        where sp.is_active
      )
      else false
    end;
$$;

grant execute on function public.region_service_available(text, text) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Assertions — read-only, run against whatever the live project already holds (Lagos is
-- the one active state as of this migration), so "fixed" is provable here rather than
-- only in the paired packages/db/tests/ proof script (which builds its own fixtures for
-- the tables live data can't guarantee, e.g. a home_visit/logistics/specialist partner).
-- ---------------------------------------------------------------------------------------
do $$
declare
  v_total int;
  v_non_canonical int;
begin
  if private.normalize_ng_state('Lagos') <> 'lagos' then
    raise exception 'FAIL: normalize_ng_state(Lagos) expected lagos, got %', private.normalize_ng_state('Lagos');
  end if;
  if private.normalize_ng_state('lagos state') <> 'lagos' then
    raise exception 'FAIL: normalize_ng_state(lagos state) expected lagos, got %', private.normalize_ng_state('lagos state');
  end if;
  if private.normalize_ng_state('  LAGOS   STATE ') <> 'lagos' then
    raise exception 'FAIL: normalize_ng_state whitespace/casing variant expected lagos, got %', private.normalize_ng_state('  LAGOS   STATE ');
  end if;
  if private.normalize_ng_state('FCT') <> 'abuja' then
    raise exception 'FAIL: normalize_ng_state(FCT) expected abuja, got %', private.normalize_ng_state('FCT');
  end if;
  if private.normalize_ng_state(null) is not null then
    raise exception 'FAIL: normalize_ng_state(null) expected null';
  end if;
  if private.normalize_ng_state('United Kingdom') = private.normalize_ng_state('Lagos') then
    raise exception 'FAIL: unrelated strings must not collide under normalization';
  end if;

  -- Exact-canonical-match behaviour must be byte-identical to the pre-migration function
  -- for the one live state (Lagos) — this is the regression guard, not the new behaviour.
  if public.region_service_available('Lagos', 'lab') is distinct from (
    exists (
      select 1 from public.facilities f join public.lab_providers lp on lp.id = f.lab_provider_id
      where f.type = 'lab' and f.is_active and lp.is_active and f.state = 'Lagos'
    )
    or exists (select 1 from public.lab_providers lp where lp.is_active and lp.regions @> array['Lagos'])
  ) then
    raise exception 'FAIL: region_service_available(Lagos, lab) diverged from the pre-migration exact-match logic';
  end if;

  -- New behaviour: a casing/whitespace/"...State" variant of the one live state must
  -- resolve identically to the canonical spelling, for every gated service.
  if public.region_service_available('lagos state', 'lab') is distinct from public.region_service_available('Lagos', 'lab') then
    raise exception 'FAIL: normalized fallback for ''lagos state'' diverged from region_service_available(Lagos, lab)';
  end if;
  if public.region_service_available(' LAGOS ', 'pharmacy') is distinct from public.region_service_available('Lagos', 'pharmacy') then
    raise exception 'FAIL: normalized fallback for '' LAGOS '' diverged from region_service_available(Lagos, pharmacy)';
  end if;

  -- A genuinely unrecognized location (not a Nigerian state at all — the live UK profile
  -- found in the 2026-09-23 audit) must still resolve to false. Normalization must never
  -- create a false positive.
  if public.region_service_available('United Kingdom', 'lab') then
    raise exception 'FAIL: region_service_available(United Kingdom, lab) must be false';
  end if;
  if public.region_service_available(null, 'lab') then
    raise exception 'FAIL: region_service_available(null, lab) must be false';
  end if;

  select count(*) filter (where state is not null),
         count(*) filter (
           where state is not null
             and not exists (select 1 from public.service_regions sr where sr.state = profiles.state)
         )
  into v_total, v_non_canonical
  from public.profiles;
  raise notice 'profiles.state audit: % of % non-null values do not exactly match a canonical service_regions.state (see migration header for the 2026-09-23 findings)', v_non_canonical, v_total;

  raise notice 'region_service_available normalized-state-fallback migration: all live assertions passed';
end $$;

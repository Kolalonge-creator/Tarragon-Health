-- Tarragon Health — fix region_service_available normalized-fallback review findings
--
-- /code-review high (8 parallel finder angles) on
-- 20260923212037_region_service_available_normalized_state_fallback.sql surfaced three
-- real SQL-side issues, independently confirmed by multiple angles. Fixes, in order:
--
-- 1. REUSE: private.normalize_ng_state re-derived a lowercase/trim/whitespace-collapse
--    text normalizer from scratch, duplicating the existing shared
--    private.normalise_term(text) (20260829093134_mdm_terminology_core.sql) — same
--    IMMUTABLE contract, same "shared normaliser" intent, only differing in that
--    normalise_term also folds non-alphanumeric characters to spaces (irrelevant for
--    Nigerian state names, which contain only letters and spaces). Rebuilt on top of it
--    so the two normalizers can no longer silently drift on their shared lower/trim/
--    whitespace-collapse core.
--
-- 2. CORRECTNESS (latent, not currently reachable): the `resolved` CTE's
--    `order by (sr.state = p_state) desc limit 1` has no deterministic secondary
--    tie-break. service_regions.state is unique only on the exact string, not on its
--    normalized key, so nothing before this migration stopped a future admin insert
--    (service_regions_insert only checks private.is_admin(), no format/uniqueness-of-
--    normalized-key check) from creating a second row that normalizes to an existing
--    key (e.g. a literal 'FCT' row alongside the seeded 'Abuja' row). If that ever
--    happened, a patient whose state exact-matches neither row would tie, and Postgres
--    would pick one arbitrarily — silently flipping availability for all five gated
--    services (they all share this one canonical_state resolution) non-deterministically.
--    Fixed at the root: a unique index on the normalized key makes the collision this
--    migration's own audit found "currently impossible" (all 37 states + Abuja normalize
--    distinctly, confirmed against live data before creating the index) *provably*
--    impossible going forward, not just improbable — an admin insert that would create
--    a normalized-key collision now fails outright instead of silently corrupting
--    resolution for both rows. A secondary deterministic ORDER BY is added anyway as
--    defense in depth (should the unique index ever need to be dropped for an
--    unanticipated reason).
--
-- 3. Documented, not fixed here: RegionGate's waitlist read/write path
--    (apps/web/src/components/region-gate.tsx) was found to still key
--    region_waitlist.state off the raw, non-canonicalized state prop — fixed in the
--    same PR at the application layer (canonicalizeNigerianState applied before every
--    waitlist read/write and in the "coming soon" display copy), not here; nothing on
--    the DB side needed to change for that finding.

create or replace function private.normalize_ng_state(p_state text)
returns text
language sql
immutable
set search_path = ''
as $$
  with base as (
    select regexp_replace(
             coalesce(private.normalise_term(p_state), ''),
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
  'Case/whitespace-insensitive Nigerian-state normalizer, built on the shared '
  'private.normalise_term(text) lower/trim/whitespace-collapse core: additionally strips '
  'a trailing "state" suffix ("Lagos State" -> "lagos") and folds common FCT/Abuja '
  'spellings to "abuja" (service_regions seeds the FCT row as state = ''Abuja'', see '
  '20260717100000_service_regions.sql). Pure text transform, no data access, no '
  'caller-identity check — used only as a fallback match inside '
  'public.region_service_available when the exact string does not match a canonical '
  'service_regions.state, and to enforce service_regions_normalized_state_key_unique '
  '(see 20260923213334). Returns null for blank/null input.';

-- Enforces, at the source, that no two service_regions rows can ever normalize to the
-- same key — the precondition public.region_service_available's `resolved` CTE relies on
-- for its canonical-state resolution to be unambiguous. Confirmed against live data
-- immediately before creating this index: all 37 states + the FCT/Abuja row normalize to
-- 37 distinct keys, so this cannot fail on existing rows.
create unique index if not exists service_regions_normalized_state_key_unique
  on public.service_regions (private.normalize_ng_state(state));

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
    order by (sr.state = p_state) desc, sr.state asc
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
-- Assertions — read-only re-run of the original migration's live checks (the function
-- body changed, its observable behaviour must not have), plus a new proof that the
-- collision the unique index guards against is now genuinely rejected.
-- ---------------------------------------------------------------------------------------
do $$
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

  if public.region_service_available('lagos state', 'lab') is distinct from public.region_service_available('Lagos', 'lab') then
    raise exception 'FAIL: normalized fallback for ''lagos state'' diverged from region_service_available(Lagos, lab) after the reuse refactor';
  end if;
  if public.region_service_available('United Kingdom', 'lab') then
    raise exception 'FAIL: region_service_available(United Kingdom, lab) must still be false';
  end if;

  -- The collision guard: a literal 'FCT' row would normalize to the same key as the
  -- seeded 'Abuja' row. This insert must now fail with a unique-index violation.
  begin
    insert into public.service_regions (state, display_name) values ('FCT', 'Federal Capital Territory (duplicate test)');
    raise exception 'FAIL: inserting a service_regions row that normalizes to an existing key (FCT vs Abuja) should have been rejected by service_regions_normalized_state_key_unique';
  exception
    when unique_violation then
      raise notice 'PASS: service_regions_normalized_state_key_unique correctly rejected a normalized-key collision (FCT vs Abuja)';
  end;

  raise notice 'fix_region_service_available_review_findings: all assertions passed';
end $$;

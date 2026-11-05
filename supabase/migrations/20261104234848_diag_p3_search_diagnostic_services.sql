-- Diagnostic directory Phase 3: find branches that do a specific investigation, near the patient or in a state/LGA.
-- Design: docs/plans/diagnostic-directory-design-2026-11-04.md §7, §9, §10, §12 (P3).
--
--   private.distance_km(lat1, lng1, lat2, lng2)  straight-line (haversine) distance, the same formula directory_search uses.
--   private.diagnostic_service_eligible(id)      now short-circuits: a service whose provider or branch is not listed, or
--                                                 whose availability is not recommendable, is ineligible without running the
--                                                 full check. Every short-circuit condition is also a reason in
--                                                 private.diagnostic_service_eligibility, so the fast path can only say
--                                                 "no" where the full check would too (proved in diag_p3_search.sql). This
--                                                 takes the per-service cost out of admin_dx_overview for draft listings.
--   public.search_diagnostic_services(...)       the search. Two result groups:
--        'eligible'     every Level 1 condition holds (private.diagnostic_service_eligibility returns no reason);
--        'unconfirmed'  the ONLY reasons are that the service is awaiting confirmation or referred out, so the branch is
--                       otherwise fully verified. Always ranked below every eligible branch, and only when asked for.
--      Nothing else is ever returned: a draft, suspended, expired, stale, unverified or incident-held listing never
--      appears. The preferred-partner band (group 1 in §10) is Phase 4 and is not here.
--
-- Deliberate departures from the design doc, for the founder to see:
--   * public.list_lab_test_locations is NOT turned into a wrapper. It feeds the paid lab booking picker, which must only
--     offer contracted (billable, routable) branches. The directory lists uncontracted branches by design (listing is not
--     a contract), so wrapping would either show uncontracted branches in a paid booking flow or empty the picker until
--     branches are listed. The two stay separate; Phase 6 revisits the patient copy.
--   * public.directory_search keeps its inline haversine. Rewriting a live function only to call the helper adds risk
--     for no behaviour change.
--   * No latitude/longitude index. Candidates are found by concept first (diagnostic_branch_services_concept_idx), which
--     is already selective; a bounding-box pre-filter on the branch tables would not be used.
--
-- Radius and page size are not written here: the caller passes them from proposed-config "directory.diagnostic_search".
-- The SQL only rejects nonsense input (a radius of 0, or wider than Nigeria).
--
-- Who sees what: every signed-in user with the directory open gets the public fields. Clinicians, care coordinators,
-- admins and directory verifiers also get when the service was last confirmed and which regulators' credentials are on
-- file. Internal notes, evidence sources, verifier names, contract status and commercial terms are never returned.

-- ---------------------------------------------------------------------------
-- 1. Distance
-- ---------------------------------------------------------------------------
create or replace function private.distance_km(p_lat1 double precision, p_lng1 double precision,
                                                p_lat2 double precision, p_lng2 double precision)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
              else 2 * 6371 * asin(sqrt(least(1, power(sin(radians((p_lat2 - p_lat1) / 2)), 2)
                     + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians((p_lng2 - p_lng1) / 2)), 2))))
         end;
$$;
revoke all on function private.distance_km(double precision, double precision, double precision, double precision) from public;
grant execute on function private.distance_km(double precision, double precision, double precision, double precision) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Eligibility fast path
-- ---------------------------------------------------------------------------
create or replace function private.diagnostic_service_eligible(p_service_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- CASE fixes the evaluation order: the full check runs only when the cheap necessary conditions hold.
  select case
           when not exists (
             select 1
               from public.diagnostic_branch_services s
               join public.diagnostic_branch_listings b on b.id = s.branch_listing_id and b.directory_status = 'listed'
               join public.diagnostic_provider_listings p on p.id = b.provider_listing_id and p.directory_status = 'listed'
              where s.id = p_service_id
                and s.availability in ('available', 'by_appointment'))
             then false
           else cardinality(private.diagnostic_service_eligibility(p_service_id)) = 0
         end;
$$;
revoke all on function private.diagnostic_service_eligible(uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. Search
-- ---------------------------------------------------------------------------
create or replace function public.search_diagnostic_services(
  p_concept_id          uuid,
  p_lat                 double precision,
  p_lng                 double precision,
  p_radius_km           numeric,
  p_state               text,
  p_lga                 text,
  p_include_unconfirmed boolean,
  p_limit               integer,
  p_offset              integer default 0
)
returns table (
  service_id            uuid,
  branch_listing_id     uuid,
  kind                  text,
  provider_name         text,
  branch_name           text,
  address               text,
  neighbourhood         text,
  town                  text,
  lga                   text,
  state                 text,
  phone                 text,
  latitude              double precision,
  longitude             double precision,
  distance_km           double precision,
  availability          text,
  appointment_required  boolean,
  preparation_note      text,
  performed_elsewhere   boolean,
  result_group          text,
  last_confirmed_at     timestamptz,
  credentials_on_file   text[],
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid       uuid := (select auth.uid());
  v_role      text;
  v_test      boolean;
  v_staff     boolean;
  v_verifier  boolean;
  v_by_point  boolean := p_lat is not null or p_lng is not null;
begin
  if v_uid is null then raise exception 'sign in to search the directory' using errcode = '42501'; end if;
  if not private.go_live_directory_open(v_uid) then raise exception 'the directory is not open yet' using errcode = '55000'; end if;

  if p_concept_id is null or not exists (
    select 1 from public.reference_concepts c
     where c.id = p_concept_id and c.investigation_category is not null and not c.is_ambiguous) then
    raise exception 'choose one specific investigation (search_investigations clarifies ambiguous terms)' using errcode = '22023';
  end if;
  if v_by_point then
    if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
      raise exception 'a location needs both latitude and longitude' using errcode = '22023';
    end if;
    if p_radius_km is null or p_radius_km <= 0 or p_radius_km > 1000 then
      raise exception 'p_radius_km must be above 0 and at most 1000 (read it from versioned config)' using errcode = '22023';
    end if;
  elsif nullif(btrim(coalesce(p_state, '')), '') is null then
    raise exception 'give a location or a state' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or coalesce(p_offset, -1) < 0 then
    raise exception 'p_limit must be 1 to 50 (read it from versioned config) and p_offset at least 0' using errcode = '22023';
  end if;

  select pr.role::text, coalesce(pr.is_test, false) into v_role, v_test from public.profiles pr where pr.id = v_uid;
  v_verifier := private.can_verify_diagnostic_directory();
  v_staff := v_verifier or v_role in ('clinician', 'care_coordinator', 'admin');

  return query
  with cand as (
    select s.id as sid, s.branch_listing_id as bid, s.availability as av, s.appointment_required as appt,
           s.preparation_note as prep, s.performed <> 'onsite' as elsewhere, s.confirmed_at as conf,
           case when p.lab_provider_id is not null then 'lab' else 'imaging' end as kd,
           coalesce(lp.name, ip.name) as pname,
           coalesce(ll.name, il.name) as bname,
           coalesce(ll.address, il.address) as addr,
           b.neighbourhood as nbh,
           coalesce(b.town, ll.town) as twn,
           b.lga as lg,
           coalesce(ll.state, il.state) as st,
           coalesce(ll.contact_phone, il.contact_phone) as ph,
           coalesce(ll.latitude, il.latitude)::double precision as lat,
           coalesce(ll.longitude, il.longitude)::double precision as lng,
           b.provider_listing_id as plid
      from public.diagnostic_branch_services s
      join public.diagnostic_branch_listings b on b.id = s.branch_listing_id and b.directory_status = 'listed'
      join public.diagnostic_provider_listings p on p.id = b.provider_listing_id and p.directory_status = 'listed'
      left join public.lab_provider_locations ll on ll.id = b.lab_location_id
      left join public.imaging_provider_locations il on il.id = b.imaging_location_id
      left join public.lab_providers lp on lp.id = p.lab_provider_id
      left join public.imaging_providers ip on ip.id = p.imaging_provider_id
     where s.concept_id = p_concept_id
       and s.availability in ('available', 'by_appointment', 'awaiting_confirmation', 'external_referral')
       and ((not b.is_test and not p.is_test) or v_test or v_verifier)
  ), placed as (
    select c.*, private.distance_km(p_lat, p_lng, c.lat, c.lng) as dist
      from cand c
     where (p_state is null or lower(btrim(c.st)) = lower(btrim(p_state)))
       and (p_lga is null or lower(btrim(c.lg)) = lower(btrim(p_lga)))
  ), judged as (
    select pl.*, private.diagnostic_service_eligibility(pl.sid) as reasons
      from placed pl
     where not v_by_point or (pl.dist is not null and pl.dist <= p_radius_km)
  ), grouped as (
    select j.*,
           case when cardinality(j.reasons) = 0 then 'eligible'
                when p_include_unconfirmed
                     and j.reasons <@ array['service_awaiting_confirmation', 'service_external_referral']::text[]
                  then 'unconfirmed'
           end as grp
      from judged j
  )
  select g.sid, g.bid, g.kd, g.pname, g.bname, g.addr, g.nbh, g.twn, g.lg, g.st, g.ph, g.lat, g.lng,
         round(g.dist::numeric, 1)::double precision,
         g.av, g.appt, g.prep, g.elsewhere, g.grp,
         case when v_staff then g.conf end,
         case when v_staff then (
           select coalesce(array_agg(distinct dc.regulator order by dc.regulator), '{}'::text[])
             from public.diagnostic_credentials dc
            where (dc.branch_listing_id = g.bid or dc.provider_listing_id = g.plid)
              and private.diagnostic_credential_effective_status(dc.status, dc.expires_on)
                    in ('verified_current', 'accreditation_verified', 'registered_accreditation_unverified', 'scope_partially_verified'))
         end,
         count(*) over ()
    from grouped g
   where g.grp is not null
   -- §10: eligible before unconfirmed; nearest first; ties by verification recency, then name. No score, no payment weight.
   order by case g.grp when 'eligible' then 1 else 2 end, g.dist nulls last, g.conf desc, g.pname, g.bname, g.sid
   limit p_limit offset coalesce(p_offset, 0);
end;
$$;
revoke all on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer) from public, anon;
grant execute on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer) to authenticated;
comment on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer) is
  'Diagnostic directory Phase 3: listed branches that do one specific investigation, by distance (p_lat/p_lng/p_radius_km) or by state/LGA. Only Level 1 eligible services, plus (when asked) otherwise-verified branches whose service is awaiting confirmation or referred out, ranked below. Radius and page size come from proposed-config "directory.diagnostic_search".';

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer)', 'EXECUTE') then
    raise exception 'anon must not execute search_diagnostic_services';
  end if;
  if not has_function_privilege('authenticated', 'public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer)', 'EXECUTE') then
    raise exception 'authenticated must execute search_diagnostic_services';
  end if;
  if abs(private.distance_km(6.4281, 3.4219, 6.6018, 3.3515) - 20.8) > 0.5 then
    raise exception 'distance_km is off: Victoria Island to Ikeja should be about 21 km';
  end if;
end;
$$;

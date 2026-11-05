-- Diagnostic directory Phase 4: Tarragon Preferred Partner placement (DIR-1).
-- Design: docs/plans/diagnostic-directory-design-2026-11-04.md §10; decision DIR-1 in docs/DECISIONS.md.
--
--   public.diagnostic_branch_partnerships   a commercial relationship with ONE branch, dated, attributed, never edited in place.
--                                            Separate from verification (it never makes a branch eligible) and from
--                                            lab_providers.is_active (it never makes a branch contracted, routable or billable).
--   admin_dx_set_partner / admin_dx_end_partner   admin only (not delegated verifiers): partner status is commercial.
--   admin_dx_partnerships(listing)          verifiers read the partnerships of one provider's branches.
--   search_diagnostic_services              gains p_partner_band_km and is_partner. Ranking groups (§10):
--        'partner'      an ELIGIBLE partner branch within d0 + band, where d0 is the distance to the nearest eligible branch;
--        'eligible'     every other eligible branch, partner or not (a far partner sits here at its own distance);
--        'unconfirmed'  as in Phase 3, always last, and never badged.
--      A state/LGA search has no distances, so it has no band: partners keep their badge but are not moved up.
--
-- Legal review (DIR-1 consequence): a partnership that pays Tarragon a commission cannot be recorded without a legal
-- review reference. That is enforced here, so no separate guard is needed (G-01): placement exists only once an admin
-- records a partnership, and a commission partnership only once legal review is cited.
--
-- The band margin is NOT written here: the caller passes it from proposed-config "directory.diagnostic_search".

-- ---------------------------------------------------------------------------
-- 1. Partnerships
-- ---------------------------------------------------------------------------
create table public.diagnostic_branch_partnerships (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid references public.organisations (id) on delete set null,
  branch_listing_id       uuid not null references public.diagnostic_branch_listings (id) on delete restrict,
  starts_on               date not null,
  ends_on                 date,
  has_commission          boolean not null,
  legal_review_reference  text,
  note                    text not null check (char_length(btrim(note)) between 10 and 1000),
  created_by              uuid not null references public.profiles (id) on delete restrict,
  created_at              timestamptz not null default now(),
  ended_at                timestamptz,
  ended_by                uuid references public.profiles (id) on delete restrict,
  end_reason              text,
  constraint diagnostic_branch_partnerships_dates check (ends_on is null or ends_on >= starts_on),
  constraint diagnostic_branch_partnerships_commission_reviewed check (
    not has_commission or char_length(btrim(coalesce(legal_review_reference, ''))) >= 5),
  constraint diagnostic_branch_partnerships_ended_attributed check (
    (ended_at is null and ended_by is null and end_reason is null)
    or (ended_at is not null and ended_by is not null and char_length(btrim(coalesce(end_reason, ''))) >= 10))
);
create unique index diagnostic_branch_partnerships_one_open
  on public.diagnostic_branch_partnerships (branch_listing_id) where ended_at is null;
comment on table public.diagnostic_branch_partnerships is
  'Tarragon Preferred Partner (DIR-1): a commercial relationship with one branch. Never affects eligibility, contract status, routing or billing. A commission partnership requires a legal review reference.';

alter table public.diagnostic_branch_partnerships enable row level security;
create policy diagnostic_branch_partnerships_select_verifiers on public.diagnostic_branch_partnerships
  for select to authenticated using (private.can_verify_diagnostic_directory());
grant select on public.diagnostic_branch_partnerships to authenticated;
revoke insert, update, delete, truncate on public.diagnostic_branch_partnerships from authenticated, anon;

create or replace function private.diagnostic_branch_is_partner(p_branch_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.diagnostic_branch_partnerships x
     where x.branch_listing_id = p_branch_listing_id
       and x.ended_at is null
       and x.starts_on <= private.lagos_today()
       and (x.ends_on is null or x.ends_on >= private.lagos_today()));
$$;
revoke all on function private.diagnostic_branch_is_partner(uuid) from public;

-- ---------------------------------------------------------------------------
-- 2. Admin functions
-- ---------------------------------------------------------------------------
create or replace function private.diagnostic_require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_admin() then
    raise exception 'only an admin may change partner status' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.diagnostic_require_admin() from public;

create or replace function public.admin_dx_set_partner(
  p_branch_listing_id uuid, p_starts_on date, p_ends_on date, p_has_commission boolean,
  p_legal_review_reference text, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  perform private.diagnostic_require_admin();
  if p_starts_on is null or p_has_commission is null then
    raise exception 'start date and commission answer are required' using errcode = '22023';
  end if;
  select organisation_id into v_org from public.diagnostic_branch_listings where id = p_branch_listing_id;
  if not found then raise exception 'branch listing not found' using errcode = '22023'; end if;
  insert into public.diagnostic_branch_partnerships
    (organisation_id, branch_listing_id, starts_on, ends_on, has_commission, legal_review_reference, note, created_by)
  values (v_org, p_branch_listing_id, p_starts_on, p_ends_on, p_has_commission,
          nullif(btrim(coalesce(p_legal_review_reference, '')), ''), btrim(coalesce(p_note, '')), auth.uid())
  returning id into v_id;
  perform private.diagnostic_log('diagnostic_branch_partnerships', v_id, 'partner_set', null,
    p_starts_on::text || coalesce(' to ' || p_ends_on::text, '') || case when p_has_commission then ' (commission)' else '' end, p_note);
  return v_id;
end;
$$;
revoke all on function public.admin_dx_set_partner(uuid, date, date, boolean, text, text) from public, anon;
grant execute on function public.admin_dx_set_partner(uuid, date, date, boolean, text, text) to authenticated;

create or replace function public.admin_dx_end_partner(p_partnership_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_admin();
  update public.diagnostic_branch_partnerships
     set ended_at = now(), ended_by = auth.uid(), end_reason = btrim(coalesce(p_reason, ''))
   where id = p_partnership_id and ended_at is null;
  if not found then raise exception 'no open partnership with that id' using errcode = '22023'; end if;
  perform private.diagnostic_log('diagnostic_branch_partnerships', p_partnership_id, 'partner_ended', null, null, p_reason);
end;
$$;
revoke all on function public.admin_dx_end_partner(uuid, text) from public, anon;
grant execute on function public.admin_dx_end_partner(uuid, text) to authenticated;

create or replace function public.admin_dx_partnerships(p_listing_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.diagnostic_require_verifier();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'branch_listing_id', x.branch_listing_id, 'starts_on', x.starts_on, 'ends_on', x.ends_on,
             'has_commission', x.has_commission, 'legal_review_reference', x.legal_review_reference, 'note', x.note,
             'created_at', x.created_at, 'created_by', (select full_name from public.profiles where id = x.created_by),
             'ended_at', x.ended_at, 'ended_by', (select full_name from public.profiles where id = x.ended_by),
             'end_reason', x.end_reason, 'in_force', private.diagnostic_branch_is_partner(x.branch_listing_id) and x.ended_at is null)
           order by x.created_at desc)
      from public.diagnostic_branch_partnerships x
      join public.diagnostic_branch_listings b on b.id = x.branch_listing_id
     where b.provider_listing_id = p_listing_id), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_dx_partnerships(uuid) from public, anon;
grant execute on function public.admin_dx_partnerships(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Search with the partner band (replaces the Phase 3 signature; it had no callers outside this feature)
-- ---------------------------------------------------------------------------
drop function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer);

create or replace function public.search_diagnostic_services(
  p_concept_id          uuid,
  p_lat                 double precision,
  p_lng                 double precision,
  p_radius_km           numeric,
  p_state               text,
  p_lga                 text,
  p_include_unconfirmed boolean,
  p_partner_band_km     numeric,
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
  is_partner            boolean,
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
  if p_partner_band_km is null or p_partner_band_km < 0 or p_partner_band_km > 50 then
    raise exception 'p_partner_band_km must be 0 to 50 (read it from versioned config)' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 or coalesce(p_offset, -1) < 0 then
    raise exception 'p_limit must be 1 to 50 (read it from versioned config) and p_offset at least 0' using errcode = '22023';
  end if;

  select case when pr.is_active then pr.role::text end, coalesce(pr.is_test, false) into v_role, v_test
    from public.profiles pr where pr.id = v_uid;
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
           end as grp,
           -- The badge belongs to an eligible branch only; an unconfirmed row is never badged.
           cardinality(j.reasons) = 0 and private.diagnostic_branch_is_partner(j.bid) as partner
      from judged j
  ), banded as (
    select g.*, min(g.dist) filter (where g.grp = 'eligible') over () as d0
      from grouped g
     where g.grp is not null
  ), ranked as (
    select b.*,
           case when b.grp = 'eligible' and b.partner and v_by_point and b.dist <= b.d0 + p_partner_band_km::double precision
                  then 'partner'
                else b.grp end as fgrp
      from banded b
  )
  select r.sid, r.bid, r.kd, r.pname, r.bname, r.addr, r.nbh, r.twn, r.lg, r.st, r.ph, r.lat, r.lng,
         round(r.dist::numeric, 1)::double precision,
         r.av, r.appt, r.prep, r.elsewhere, r.fgrp, r.partner,
         case when v_staff then r.conf end,
         case when v_staff then (
           select coalesce(array_agg(distinct dc.regulator order by dc.regulator), '{}'::text[])
             from public.diagnostic_credentials dc
            -- Only credentials that would count for THIS test under the eligibility rules (see Phase 3).
            where (dc.branch_listing_id = r.bid or dc.provider_listing_id = r.plid)
              and private.diagnostic_credential_effective_status(dc.status, dc.expires_on) <> 'expired'
              and (dc.regulator <> 'state_facility_licence' or lower(btrim(dc.state)) = lower(btrim(r.st)))
              and (
                (dc.status in ('verified_current', 'accreditation_verified')
                   and (dc.scope_concept_ids is null or p_concept_id = any (dc.scope_concept_ids)))
                or (dc.status = 'registered_accreditation_unverified'
                   and dc.regulator in ('mlscn_registration', 'nnra_authorisation', 'state_facility_licence'))
                or (dc.status = 'scope_partially_verified' and p_concept_id = any (dc.scope_concept_ids))))
         end,
         count(*) over ()
    from ranked r
   -- §10: partner band, then every other eligible branch, then unconfirmed; nearest first; ties by verification recency,
   -- then name. No score and no payment weight beyond the band itself.
   order by case r.fgrp when 'partner' then 1 when 'eligible' then 2 else 3 end,
            r.dist nulls last, r.conf desc, r.pname, r.bname, r.sid
   limit p_limit offset coalesce(p_offset, 0);
end;
$$;
revoke all on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, numeric, integer, integer) from public, anon;
grant execute on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, numeric, integer, integer) to authenticated;
comment on function public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, numeric, integer, integer) is
  'Diagnostic directory: listed branches that do one specific investigation. Groups: partner (eligible preferred partner within nearest eligible distance + p_partner_band_km), eligible, unconfirmed (opt-in, always last). Radius, band and page size come from proposed-config "directory.diagnostic_search".';

-- ---------------------------------------------------------------------------
-- 4. Self-check
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, numeric, integer, integer)',
    'public.admin_dx_set_partner(uuid, date, date, boolean, text, text)',
    'public.admin_dx_end_partner(uuid, text)',
    'public.admin_dx_partnerships(uuid)']
  loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon must not execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'authenticated must execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.diagnostic_branch_partnerships', 'SELECT') then
    raise exception 'anon must not read partnerships';
  end if;
  if has_table_privilege('authenticated', 'public.diagnostic_branch_partnerships', 'INSERT') then
    raise exception 'authenticated must not write partnerships directly';
  end if;
end;
$$;

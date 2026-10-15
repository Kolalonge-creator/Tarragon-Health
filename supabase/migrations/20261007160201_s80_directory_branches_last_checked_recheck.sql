-- S80 (S-19, 25.3 / 25.9): directory freshness covers branches, patients see "last checked", a complaint can force a re-check.
--
-- Builds on 20261006220445_s36g_directory_freshness.sql; nothing there is replaced except the four functions named below, each
-- with its signature unchanged (create or replace, so no overload is added and no call site changes).
--
--   1. Four branch tables join the six listings: lab_provider_locations, pharmacy_partner_locations,
--      specialist_provider_locations, imaging_provider_locations (the tables that exist on this tree). A branch's cadence is its
--      parent's (pharmacy branches 6 months, the rest 12), still the PROPOSED, UNSIGNED `directory.verification_cadence`.
--   2. public.directory_last_checked(table, ids): the patient screens' read. It returns the date and an "overdue" flag and
--      NOTHING else (never the verifier, the note or the history). Only for lab and pharmacy listings and their branches.
--   3. Event-driven re-check (S-19): private.directory_request_recheck(table, id, reason) marks a verified listing overdue now
--      (next_verification_due = yesterday, stale, reminder reset) so it shows on the ops list and in the next sweep notice.
--      public.request_directory_recheck is the staff door (needs the manage permission for that kind). NO trigger is attached:
--      the platform has no complaint or incident table that names a lab or pharmacy listing (complaints name a patient and a
--      category only; provider_complaints name clinical staff), so there is no clean trigger point yet. Whoever adds a
--      listing-linked complaint calls the private function from it.
--   Stale means a notice only. Nothing here deactivates, hides or suspends a listing.
-- Counts at write time: no rows are converted; branches start as "never verified" until a person records one.

-- 1. widen the two CHECKs
alter table public.directory_verifications drop constraint if exists directory_verifications_listing_table_check;
alter table public.directory_freshness drop constraint if exists directory_freshness_listing_table_check;
alter table public.directory_verifications add constraint directory_verifications_listing_table_check
  check (listing_table in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners',
                           'lab_provider_locations', 'pharmacy_partner_locations', 'specialist_provider_locations', 'imaging_provider_locations'));
alter table public.directory_freshness add constraint directory_freshness_listing_table_check
  check (listing_table in ('lab_providers', 'pharmacy_partners', 'specialist_providers', 'facilities', 'home_visit_providers', 'logistics_partners',
                           'lab_provider_locations', 'pharmacy_partner_locations', 'specialist_provider_locations', 'imaging_provider_locations'));

-- 2. the listings, with branches (a branch is listed only while its parent is active too)
create or replace function private.directory_listings() returns table (listing_table text, listing_id uuid, name text, is_active boolean)
language sql stable security definer set search_path = ''
as $$
  select 'lab_providers', id, name, is_active from public.lab_providers
  union all select 'pharmacy_partners', id, name, is_active from public.pharmacy_partners
  union all select 'specialist_providers', id, name, is_active from public.specialist_providers
  union all select 'facilities', id, name, is_active from public.facilities
  union all select 'home_visit_providers', id, name, is_active from public.home_visit_providers
  union all select 'logistics_partners', id, name, is_active from public.logistics_partners
  union all select 'lab_provider_locations', l.id, l.name || ' (' || p.name || ')', l.is_active and p.is_active
    from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id
  union all select 'pharmacy_partner_locations', l.id, l.name || ' (' || p.name || ')', l.is_active and p.is_active
    from public.pharmacy_partner_locations l join public.pharmacy_partners p on p.id = l.pharmacy_partner_id
  union all select 'specialist_provider_locations', l.id, l.name || ' (' || p.name || ')', l.is_active and p.is_active
    from public.specialist_provider_locations l join public.specialist_providers p on p.id = l.specialist_provider_id
  union all select 'imaging_provider_locations', l.id, l.name || ' (' || p.name || ')', l.is_active and p.is_active
    from public.imaging_provider_locations l join public.imaging_providers p on p.id = l.imaging_provider_id;
$$;

create or replace function private.directory_can_view() returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission('ops.console.view')
      or private.has_permission('partners.labs.manage') or private.has_permission('partners.pharmacies.manage')
      or private.has_permission('partners.facilities.manage') or private.has_permission('partners.specialists.manage')
      or private.has_permission('partners.home_visit.manage') or private.has_permission('partners.logistics.manage')
      or private.has_permission('partners.imaging.manage');
$$;

create or replace function private.directory_can_record(p_table text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.has_permission(case p_table
    when 'lab_providers' then 'partners.labs.manage'
    when 'lab_provider_locations' then 'partners.labs.manage'
    when 'pharmacy_partners' then 'partners.pharmacies.manage'
    when 'pharmacy_partner_locations' then 'partners.pharmacies.manage'
    when 'facilities' then 'partners.facilities.manage'
    when 'specialist_providers' then 'partners.specialists.manage'
    when 'specialist_provider_locations' then 'partners.specialists.manage'
    when 'imaging_provider_locations' then 'partners.imaging.manage'
    when 'home_visit_providers' then 'partners.home_visit.manage'
    when 'logistics_partners' then 'partners.logistics.manage'
    else 'no.such.permission' end);
$$;

-- a branch keeps its parent's cadence (PROPOSED config unchanged: version 1 stays the one active row)
create or replace function private.directory_cadence_months(p_table text) returns integer
language sql stable security definer set search_path = ''
as $$
  select coalesce((rules -> 'by_listing_table' ->> case p_table when 'pharmacy_partner_locations' then 'pharmacy_partners' else p_table end)::integer,
                  (rules ->> 'default_months')::integer, 12)
  from public.directory_verification_config where is_active;
$$;

-- 3. patient read: the date and an overdue flag, nothing else
create function public.directory_last_checked(p_listing_table text, p_listing_ids uuid[])
returns table (listing_id uuid, last_checked date, is_overdue boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if p_listing_table not in ('lab_providers', 'lab_provider_locations', 'pharmacy_partners', 'pharmacy_partner_locations') then
    raise exception 'last checked is shown for lab and pharmacy listings only' using errcode = '22023';
  end if;
  if coalesce(array_length(p_listing_ids, 1), 0) > 200 then raise exception 'too many listings' using errcode = '22023'; end if;
  return query
    select f.listing_id, (f.last_verified_at at time zone 'Africa/Lagos')::date, f.next_verification_due < current_date
    from public.directory_freshness f
    where f.listing_table = p_listing_table and f.listing_id = any (p_listing_ids) and f.last_verified_at is not null;
end $$;
revoke all on function public.directory_last_checked(text, uuid[]) from public, anon;
grant execute on function public.directory_last_checked(text, uuid[]) to authenticated;

-- 4. event-driven re-check
create function private.directory_request_recheck(p_listing_table text, p_listing_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_found boolean;
begin
  update public.directory_freshness f
     set next_verification_due = current_date - 1, is_stale = true, stale_since = coalesce(f.stale_since, current_date),
         last_notified_on = null, updated_at = now()
   where f.listing_table = p_listing_table and f.listing_id = p_listing_id and f.last_verified_at is not null;
  v_found := found;
  perform private.log_audit('directory.recheck_requested', p_listing_table, p_listing_id,
    jsonb_build_object('reason', left(btrim(coalesce(p_reason, '')), 200), 'applied', v_found));
  return v_found;
end $$;
revoke all on function private.directory_request_recheck(text, uuid, text) from public, anon, authenticated;

create function public.request_directory_recheck(p_listing_table text, p_listing_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.directory_can_record(p_listing_table) then
    raise exception 'you may not request a re-check for this kind of listing' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'say why the listing needs checking again (10 characters or more)' using errcode = '22023';
  end if;
  if not exists (select 1 from private.directory_listings() l where l.listing_table = p_listing_table and l.listing_id = p_listing_id) then
    raise exception 'that listing does not exist' using errcode = '22023';
  end if;
  return private.directory_request_recheck(p_listing_table, p_listing_id, p_reason);
end $$;
revoke all on function public.request_directory_recheck(text, uuid, text) from public, anon;
grant execute on function public.request_directory_recheck(text, uuid, text) to authenticated;

-- 5. assertions
do $$
begin
  if has_function_privilege('anon', 'public.directory_last_checked(text, uuid[])', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_directory_recheck(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.directory_request_recheck(text, uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.directory_request_recheck(text, uuid, text)', 'EXECUTE') then
    raise exception 'directory recheck/last-checked functions are executable by a role that must not run them';
  end if;
  if private.directory_cadence_months('pharmacy_partner_locations') <> 6 or private.directory_cadence_months('lab_provider_locations') <> 12 then
    raise exception 'branch cadence must follow the parent';
  end if;
  if (select count(*) from public.directory_verification_config where is_active) <> 1 then raise exception 'exactly one cadence config must be active'; end if;
  if not exists (select 1 from pg_constraint where conname = 'directory_freshness_listing_table_check' and pg_get_constraintdef(oid) like '%imaging_provider_locations%') then
    raise exception 'freshness check constraint not widened';
  end if;
end $$;

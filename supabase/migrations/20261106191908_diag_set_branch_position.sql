-- Diagnostic directory: a verifier can set (or correct) a branch's map position.
--
-- Gap found 2026-11-06 while verifying the first imported branches: a map position could only be given when a branch was
-- created (admin_dx_create_facility / admin_dx_add_branch). Every imported branch (P7) arrives with no coordinates, so it
-- could never be found by a distance search or become eligible (private.diagnostic_service_eligibility: branch_missing_coordinates),
-- and admin_dx_verify_branch_location would still stamp "location checked" on a branch with no position at all.
--
-- 1. admin_dx_set_branch_position: sets latitude/longitude on the branch's own lab or imaging location, refuses a point outside
--    Nigeria, and stamps the location check with how it was checked, in one audited step.
-- 2. admin_dx_verify_branch_location now refuses a branch that has no coordinates (redefined from its live body).

create or replace function public.admin_dx_set_branch_position(
  p_branch_listing_id uuid, p_latitude double precision, p_longitude double precision, p_source text, p_note text,
  p_hours_checked boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b public.diagnostic_branch_listings%rowtype; v_contracted boolean; v_old_lat double precision; v_old_lng double precision;
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_source, ''))) < 5 or char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say how the address, phone and map position were checked (source 5+ and note 10+ characters)' using errcode = '22023';
  end if;
  -- Nigeria's bounding box. A point outside it is a typo (swapped or sign-flipped), never a branch.
  if p_latitude is null or p_longitude is null or p_latitude not between 4.0 and 14.0 or p_longitude not between 2.6 and 14.7 then
    raise exception 'the map position must be inside Nigeria (latitude 4 to 14, longitude 2.6 to 14.7)' using errcode = '22023';
  end if;
  select * into b from public.diagnostic_branch_listings where id = p_branch_listing_id for update;
  if b.id is null then raise exception 'unknown branch listing' using errcode = '23503'; end if;
  if b.lab_location_id is not null then
    select p.is_active, l.latitude, l.longitude into v_contracted, v_old_lat, v_old_lng
      from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.id = b.lab_location_id;
  else
    select p.is_active, l.latitude, l.longitude into v_contracted, v_old_lat, v_old_lng
      from public.imaging_provider_locations l join public.imaging_providers p on p.id = l.imaging_provider_id where l.id = b.imaging_location_id;
  end if;
  if v_contracted is null then raise exception 'this branch has no location record' using errcode = '23503'; end if;
  -- A contracted provider's location also feeds the booking picker (list_lab_test_locations); only an admin moves it.
  if v_contracted then perform private.diagnostic_require_admin(); end if;
  if b.lab_location_id is not null then
    update public.lab_provider_locations set latitude = p_latitude, longitude = p_longitude where id = b.lab_location_id;
  else
    update public.imaging_provider_locations set latitude = p_latitude, longitude = p_longitude where id = b.imaging_location_id;
  end if;
  if not found then raise exception 'the branch location was not updated' using errcode = '23503'; end if;
  update public.diagnostic_branch_listings
     set location_verified_at = now(), location_verified_by = auth.uid(), location_source = p_source,
         hours_verified_at = case when p_hours_checked then now() else hours_verified_at end,
         hours_verified_by = case when p_hours_checked then auth.uid() else hours_verified_by end,
         updated_at = now()
   where id = p_branch_listing_id;
  -- A re-check that keeps the same point is a location check, not a move.
  perform private.diagnostic_log('diagnostic_branch_listings', p_branch_listing_id,
    case when v_old_lat is distinct from p_latitude or v_old_lng is distinct from p_longitude then 'position_set' else 'location_verified' end,
    case when v_old_lat is null then null else round(v_old_lat::numeric, 6)::text || ',' || round(v_old_lng::numeric, 6)::text end,
    round(p_latitude::numeric, 6)::text || ',' || round(p_longitude::numeric, 6)::text, p_source || ': ' || p_note);
end;
$$;

create or replace function public.admin_dx_verify_branch_location(p_branch_listing_id uuid, p_source text, p_note text, p_hours_checked boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_lat double precision; v_found boolean;
begin
  perform private.diagnostic_require_verifier();
  if char_length(btrim(coalesce(p_source, ''))) < 5 or char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say how the address, phone and map position were checked (source 5+ and note 10+ characters)' using errcode = '22023';
  end if;
  select true, coalesce(ll.latitude, il.latitude) into v_found, v_lat
    from public.diagnostic_branch_listings b
    left join public.lab_provider_locations ll on ll.id = b.lab_location_id
    left join public.imaging_provider_locations il on il.id = b.imaging_location_id
   where b.id = p_branch_listing_id;
  if v_found is null then raise exception 'unknown branch listing' using errcode = '23503'; end if;
  if v_lat is null then
    raise exception 'this branch has no map position yet: set it with the position fields' using errcode = '23514';
  end if;
  update public.diagnostic_branch_listings
     set location_verified_at = now(), location_verified_by = auth.uid(), location_source = p_source,
         hours_verified_at = case when p_hours_checked then now() else hours_verified_at end,
         hours_verified_by = case when p_hours_checked then auth.uid() else hours_verified_by end,
         updated_at = now()
   where id = p_branch_listing_id;
  perform private.diagnostic_log('diagnostic_branch_listings', p_branch_listing_id, 'location_verified', null, p_source, p_note);
end;
$$;

revoke all on function public.admin_dx_set_branch_position(uuid, double precision, double precision, text, text, boolean) from public, anon;
grant execute on function public.admin_dx_set_branch_position(uuid, double precision, double precision, text, text, boolean) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.admin_dx_set_branch_position(uuid, double precision, double precision, text, text, boolean)', 'EXECUTE') then
    raise exception 'anon can execute admin_dx_set_branch_position';
  end if;
end $$;

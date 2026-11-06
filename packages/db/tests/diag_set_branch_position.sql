-- Diagnostic directory: a verifier can set a branch's map position (migration *_diag_set_branch_position.sql).
--
-- Proves:
--   A  a patient cannot set a position
--   B  an imported-style branch (no coordinates) cannot be stamped "location checked" by the old function
--   C  setting a position writes the coordinates onto the branch's own location, stamps the check with its source, and is audited
--   D  a point outside Nigeria, and a swapped lat/lng, are refused and change nothing
--   E  the same works for an imaging branch
--   F  the old function still stamps a branch that already has coordinates
-- Sabotage: with the old stamp-only body restored, B stamps a branch with no position (so B discriminates).

begin;

create temp table results (check_name text, ok boolean, detail text);
grant all on results to public;

create function pg_temp.as_user(p_uid uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.as_postgres() returns void language plpgsql as $f$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxpos-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxpos', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;

create temp table ids (k text primary key, v uuid);
grant all on ids to public;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid; v_patient uuid;
  v_lab uuid; v_loc uuid; v_img uuid; v_iloc uuid;
  v_pl uuid; v_bl uuid; v_ipl uuid; v_ibl uuid;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  insert into public.lab_providers (name, is_active) values ('Proof Position Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  -- No coordinates: the shape every imported branch arrives in.
  insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, is_active)
  values (v_lab, 'Ikeja branch', 'Lagos', 'Ikeja', '1 Proof Road, Ikeja', '+2348000000011', true) returning id into v_loc;
  insert into public.imaging_providers (name, is_active) values ('Proof Position Scan ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_img;
  insert into public.imaging_provider_locations (imaging_provider_id, name, state, address, contact_phone, is_active)
  values (v_img, 'Wuse branch', 'FCT', '2 Proof Street, Wuse 2', '+2348000000012', true) returning id into v_iloc;

  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, true);
  v_bl := public.admin_dx_upsert_branch_listing(v_pl, v_loc, 'Ikeja', 'Ikeja', null, null, null, true);
  v_ipl := public.admin_dx_create_provider_listing('imaging', v_img, true);
  v_ibl := public.admin_dx_upsert_branch_listing(v_ipl, v_iloc, null, 'Wuse', null, null, null, true);
  perform pg_temp.as_postgres();

  insert into ids values ('admin', v_admin), ('patient', v_patient), ('loc', v_loc), ('bl', v_bl), ('iloc', v_iloc), ('ibl', v_ibl);
end $$;

-- A
do $$
begin
  perform pg_temp.as_user((select v from ids where k = 'patient'));
  begin
    perform public.admin_dx_set_branch_position((select v from ids where k = 'bl'), 6.6, 3.35, 'online map', 'patient trying it');
    insert into results values ('A1 a patient cannot set a position', false, 'call succeeded');
  exception when sqlstate '42501' then insert into results values ('A1 a patient cannot set a position', true, null);
  end;
  perform pg_temp.as_postgres();
end $$;

-- B
do $$
begin
  perform pg_temp.as_user((select v from ids where k = 'admin'));
  begin
    perform public.admin_dx_verify_branch_location((select v from ids where k = 'bl'), 'phone call', 'checked the address by phone');
    insert into results values ('B1 no position: the location cannot be stamped checked', false, 'stamped');
  exception when sqlstate '23514' then insert into results values ('B1 no position: the location cannot be stamped checked', true, null);
  end;
  perform pg_temp.as_postgres();
  insert into results select 'B2 ...and nothing was stamped', location_verified_at is null, null
    from public.diagnostic_branch_listings where id = (select v from ids where k = 'bl');
end $$;

-- C
do $$
declare r record;
begin
  perform pg_temp.as_user((select v from ids where k = 'admin'));
  perform public.admin_dx_set_branch_position((select v from ids where k = 'bl'), 6.601234, 3.351234,
    'OpenStreetMap + provider page', 'two sources agree within 50 m');
  perform pg_temp.as_postgres();
  select latitude, longitude into r from public.lab_provider_locations where id = (select v from ids where k = 'loc');
  insert into results values ('C1 the coordinates are on the branch''s own location', r.latitude = 6.601234 and r.longitude = 3.351234, r::text);
  select location_verified_at, location_verified_by, location_source into r from public.diagnostic_branch_listings where id = (select v from ids where k = 'bl');
  insert into results values ('C2 the check is stamped by the verifier with its source',
    r.location_verified_at is not null and r.location_verified_by = (select v from ids where k = 'admin') and r.location_source = 'OpenStreetMap + provider page', r::text);
  insert into results select 'C3 the change is audited', count(*) = 1, count(*)::text from public.diagnostic_directory_events
    where subject_id = (select v from ids where k = 'bl') and action = 'position_set' and to_value = '6.601234,3.351234';
end $$;

-- D
do $$
declare v_lat double precision;
begin
  perform pg_temp.as_user((select v from ids where k = 'admin'));
  begin
    perform public.admin_dx_set_branch_position((select v from ids where k = 'bl'), 51.5, -0.12, 'online map', 'a London point');
    insert into results values ('D1 a point outside Nigeria is refused', false, 'accepted');
  exception when sqlstate '22023' then insert into results values ('D1 a point outside Nigeria is refused', true, null);
  end;
  begin
    perform public.admin_dx_set_branch_position((select v from ids where k = 'bl'), 3.35, 6.6, 'online map', 'lat and lng swapped');
    insert into results values ('D2 swapped latitude and longitude is refused', false, 'accepted');
  exception when sqlstate '22023' then insert into results values ('D2 swapped latitude and longitude is refused', true, null);
  end;
  perform pg_temp.as_postgres();
  select latitude into v_lat from public.lab_provider_locations where id = (select v from ids where k = 'loc');
  insert into results values ('D3 ...and the stored position is unchanged', v_lat = 6.601234, v_lat::text);
end $$;

-- E, F
do $$
declare v_lat double precision; v_at timestamptz;
begin
  perform pg_temp.as_user((select v from ids where k = 'admin'));
  perform public.admin_dx_set_branch_position((select v from ids where k = 'ibl'), 9.0765, 7.4683, 'online map', 'imaging branch position');
  perform public.admin_dx_verify_branch_location((select v from ids where k = 'bl'), 'phone call', 'address confirmed again by phone');
  perform pg_temp.as_postgres();
  select latitude into v_lat from public.imaging_provider_locations where id = (select v from ids where k = 'iloc');
  insert into results values ('E1 an imaging branch gets its position too', v_lat = 9.0765, v_lat::text);
  select location_verified_at into v_at from public.diagnostic_branch_listings where id = (select v from ids where k = 'bl');
  insert into results values ('F1 a branch with a position can still be re-stamped', v_at is not null, null);
end $$;

-- Sabotage: restore the old stamp-only body; B1 must then stamp a branch with no position.
create or replace function public.admin_dx_verify_branch_location(p_branch_listing_id uuid, p_source text, p_note text, p_hours_checked boolean default false)
returns void language plpgsql security definer set search_path = '' as $f$
begin
  perform private.diagnostic_require_verifier();
  update public.diagnostic_branch_listings
     set location_verified_at = now(), location_verified_by = auth.uid(), location_source = p_source, updated_at = now()
   where id = p_branch_listing_id;
end $f$;
do $$
declare v_bl uuid;
begin
  -- a fresh branch with no position
  update public.lab_provider_locations set latitude = null, longitude = null where id = (select v from ids where k = 'loc');
  update public.diagnostic_branch_listings set location_verified_at = null, location_verified_by = null where id = (select v from ids where k = 'bl');
  perform pg_temp.as_user((select v from ids where k = 'admin'));
  begin
    perform public.admin_dx_verify_branch_location((select v from ids where k = 'bl'), 'phone call', 'checked the address by phone');
    insert into results values ('S1 SABOTAGE: the old body stamps a branch with no position (B1 discriminates)', true, null);
  exception when others then insert into results values ('S1 SABOTAGE: the old body stamps a branch with no position (B1 discriminates)', false, sqlerrm);
  end;
  perform pg_temp.as_postgres();
end $$;

select check_name, ok, detail from results order by check_name;
do $$
declare v_bad text;
begin
  select string_agg(check_name || ' (' || coalesce(detail, '') || ')', '; ') into v_bad from results where not ok;
  if v_bad is not null then raise exception 'diag set position proof FAILED: %', v_bad; end if;
  if (select count(*) from results) < 12 then raise exception 'diag set position proof ran only % checks', (select count(*) from results); end if;
  raise notice 'diag set position proof: all checks and the sabotage passed';
end $$;

rollback;

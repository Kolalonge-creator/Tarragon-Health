-- Diagnostic directory Phase 2b: admin reads and adding an uncontracted facility.
-- Migration: 20261104232336_diag_p2b_admin_reads_and_add_facility.sql.
--
--   A  a patient cannot read the overview or a provider's detail, nor create a facility
--   B  a verifier creates an imaging centre: the provider is NOT contracted (is_active false), both listings start as draft
--   C  the overview lists it; the detail returns its branch, and a service's eligibility reasons
--   D  a contracted provider cannot be given a new branch here (it would become orderable at once)
-- Sabotage: the contracted check removed from private.diagnostic_new_branch -> D's branch goes through.

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
  values (v, 'dxp2b-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxpb', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid; v_patient uuid;
  v_listing uuid; v_branch uuid; v_svc uuid;
  v_lab uuid; v_lab_listing uuid;
  v_detail jsonb; v_over jsonb;
  v_state text;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- A
  perform pg_temp.as_user(v_patient);
  begin perform public.admin_dx_overview(); v_state := 'ok'; exception when others then v_state := sqlstate; end;
  insert into results values ('A1 patient cannot read the overview', v_state = '42501', v_state);
  begin
    perform public.admin_dx_create_facility('imaging', 'Patient Made Centre', 'Main', 'Lagos', 'Lekki', 'Eti-Osa', '1 A Road, Lekki', null, null, null, true);
    v_state := 'ok';
  exception when others then v_state := sqlstate; end;
  insert into results values ('A2 patient cannot create a facility', v_state = '42501', v_state);
  perform pg_temp.as_postgres();

  -- B
  perform pg_temp.as_user(v_admin);
  v_listing := public.admin_dx_create_facility('imaging', 'Proof Scan Centre ' || substr(gen_random_uuid()::text, 1, 6), 'Lekki branch',
                                               'Lagos', 'Lekki', 'Eti-Osa', '5 Admiralty Way, Lekki', '+2348011111111', 6.44, 3.47, true);
  perform pg_temp.as_postgres();
  insert into results values ('B1 new provider is not contracted',
    (select not ip.is_active from public.diagnostic_provider_listings pl join public.imaging_providers ip on ip.id = pl.imaging_provider_id
      where pl.id = v_listing), null);
  insert into results values ('B2 both listings start as draft',
    (select pl.directory_status = 'draft' and bool_and(b.directory_status = 'draft')
       from public.diagnostic_provider_listings pl join public.diagnostic_branch_listings b on b.provider_listing_id = pl.id
      where pl.id = v_listing group by pl.directory_status), null);
  select id into v_branch from public.diagnostic_branch_listings where provider_listing_id = v_listing;

  -- C
  perform pg_temp.as_user(v_admin);
  v_svc := public.admin_dx_upsert_service(v_branch, (select id from public.reference_concepts where code = 'inv.mammography'),
                                          'available', 'onsite', null, true, null, null, 'Phone call with the centre manager');
  v_over := public.admin_dx_overview();
  v_detail := public.admin_dx_provider_detail(v_listing);
  perform pg_temp.as_postgres();
  insert into results values ('C1 overview lists the provider',
    exists (select 1 from jsonb_array_elements(v_over -> 'providers') p where (p ->> 'listing_id')::uuid = v_listing), null);
  insert into results values ('C2 detail returns the branch with its town and LGA',
    (v_detail -> 'branches' -> 0 ->> 'town') = 'Lekki' and (v_detail -> 'branches' -> 0 ->> 'lga') = 'Eti-Osa', v_detail -> 'branches' -> 0 ->> 'town');
  insert into results values ('C3 the service carries its reasons (draft, no NNRA, no state licence)',
    (v_detail -> 'branches' -> 0 -> 'services' -> 0 -> 'reasons') ?& array['provider_not_listed', 'missing_credential:nnra_authorisation',
                                                                           'missing_credential:state_facility_licence'],
    (v_detail -> 'branches' -> 0 -> 'services' -> 0 ->> 'reasons'));

  -- D
  -- A contracted lab fixture: its activation guard (licence, accreditation) has its own proofs, so it is bypassed here.
  insert into public.lab_providers (name, is_active, contact_email) values ('Proof Contracted Lab ' || substr(gen_random_uuid()::text, 1, 6), false, 'labs@proof.org')
  returning id into v_lab;
  set local session_replication_role = replica;
  update public.lab_providers set is_active = true where id = v_lab;
  set local session_replication_role = origin;
  perform pg_temp.as_user(v_admin);
  v_lab_listing := public.admin_dx_create_provider_listing('lab', v_lab, true);
  begin
    perform public.admin_dx_add_branch(v_lab_listing, 'New branch', 'Lagos', 'Yaba', 'Yaba', '9 Herbert Macaulay Way', null, null, null);
    v_state := 'ok';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('D1 no new branch for a contracted provider here', v_state = '42501', v_state);

  -- Sabotage: drop the contracted check
  create or replace function private.diagnostic_new_branch(
    p_provider_listing_id uuid, p_branch_name text, p_state text, p_town text, p_lga text, p_address text, p_phone text,
    p_latitude double precision, p_longitude double precision)
  returns uuid language plpgsql security definer set search_path = '' as $s$
  declare pl public.diagnostic_provider_listings%rowtype; v_loc uuid;
  begin
    select * into pl from public.diagnostic_provider_listings where id = p_provider_listing_id;
    insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
    values (pl.lab_provider_id, p_branch_name, p_state, p_town, p_address, p_phone, p_latitude, p_longitude, true) returning id into v_loc;
    return public.admin_dx_upsert_branch_listing(pl.id, v_loc, p_lga, p_town, null, null, null, true);
  end $s$;
  perform pg_temp.as_user(v_admin);
  begin
    perform public.admin_dx_add_branch(v_lab_listing, 'New branch', 'Lagos', 'Yaba', 'Yaba', '9 Herbert Macaulay Way', null, null, null);
    v_state := 'ok';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE: without the check the contracted lab gets an orderable branch (proves D1 discriminates)', v_state = 'ok', v_state);
end;
$$;

do $$
declare r record; v_fail int := 0;
begin
  for r in select * from results order by check_name loop
    raise notice '% % %', case when r.ok then 'PASS' else 'FAIL' end, r.check_name, coalesce(r.detail, '');
    if not r.ok then v_fail := v_fail + 1; end if;
  end loop;
  if v_fail > 0 then raise exception '% check(s) failed', v_fail; end if;
  if (select count(*) from results) < 9 then raise exception 'expected 9 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;

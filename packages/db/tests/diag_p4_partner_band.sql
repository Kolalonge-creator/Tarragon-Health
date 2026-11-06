-- Diagnostic directory Phase 4: preferred-partner band (DIR-1).
-- Migration: 20261105092110_diag_p4_preferred_partner_band.sql.
--
-- Patient at Victoria Island (6.4281, 3.4219). HbA1c. Band 3 km. Distances due north, about 1.11 km per 0.01 degree.
--   near     2.0 km  non-partner, eligible                         -> d0 = 2.0, so the band reaches 5.0 km
--   p4       4.0 km  partner, eligible                             -> partner group (inside the band)
--   p45      4.5 km  partner, eligible                             -> partner group (two partners, by distance)
--   mid     10.0 km  non-partner, eligible
--   far     18.0 km  partner, eligible                             -> eligible group at its own distance (outside the band)
--   unconf   1.5 km  partner, awaiting confirmation                 -> unconfirmed, last, never badged
--   unavail  3.0 km  partner, temporarily unavailable              -> never returned
--   notest   2.5 km  partner, does FBC but not HbA1c                 -> never returned
--   expired  1.0 km  partner of another provider, credential expired -> never returned (and never sets d0)
--
-- Proves:
--   A  only an admin sets or ends a partnership; a clinician and a patient are refused; patients cannot read partnerships
--   B  ranking: partners inside the band first, then every other eligible branch by distance (a far partner among them),
--      then unconfirmed; an ineligible partner (unverified, expired, unavailable, without the test) never appears
--   C  badges: only eligible partner rows carry is_partner; the unconfirmed partner does not
--   D  band 0: no partner is nearer than d0, so partners keep their badge but none is moved up
--   E  a state search (no distances) has no band
--   F  a commission partnership without a legal review reference is refused; with one it is accepted
--   G  one open partnership per branch; an ended one stops ranking at once; one starting tomorrow does not rank today;
--      an agreement past its end date does not block a renewal
--   A4 a delegated verifier sees that partnerships exist but not commission terms or notes
--   H  a band outside 0..50 is refused
-- Sabotage x2: (a) without the commission constraint the unreviewed commission partnership is accepted (proves F1);
--              (b) a partner check that ignores ended_at keeps the ended partner in the band (proves G2).

begin;

create temp table results (check_name text, ok boolean, detail text);
grant all on results to public;
create temp table fx (fk text primary key, fv uuid);
grant all on fx to public;

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxp4-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.id(p_k text) returns uuid language sql as $f$ select fv from fx where fk = p_k $f$;
-- Fixture keys in result order, with their group: "near:eligible,p4:partner,..."
create function pg_temp.order_of(p_lat double precision, p_lng double precision, p_r numeric, p_state text, p_band numeric)
returns text language sql as $f$
  select coalesce(string_agg((select fk from fx where fv = r.branch_listing_id) || ':' || r.result_group
                             || case when r.is_partner then '*' else '' end, ',' order by r.ord), '')
    from (select s.*, row_number() over () as ord
            from public.search_diagnostic_services((select fv from fx where fk = 'hba1c'), p_lat, p_lng, p_r, p_state, null,
                                                   true, p_band, 50, 0) s) r;
$f$;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid; v_lab uuid; v_lab2 uuid; v_pl uuid; v_pl2 uuid; v_cred uuid; v_cred2 uuid; v_loc uuid; v_bl uuid;
  v_hba1c uuid := (select id from public.reference_concepts where code = 'inv.hba1c');
  v_fbc uuid := (select id from public.reference_concepts where code = 'inv.fbc');
  r record;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', false);
  insert into fx values ('admin', v_admin), ('hba1c', v_hba1c),
    ('patient', pg_temp.mkuser(v_org, 'patient', 'patient', false)),
    ('clinician', pg_temp.mkuser(v_org, 'clin', 'clinician', false));

  -- Open the directory guard inside this rolled-back transaction (it normally changes only through set_go_live_guard()).
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = v_admin,
         change_note = 'Opened inside the P4 proof transaction' where key = 'directory_enabled';
  set local session_replication_role = origin;

  insert into public.lab_providers (name, is_active) values ('Proof Band Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  insert into public.lab_providers (name, is_active) values ('Proof Expired Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab2;
  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, false);
  v_pl2 := public.admin_dx_create_provider_listing('lab', v_lab2, false);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Identity confirmed for the proof');
  perform public.admin_dx_set_listing_status('provider', v_pl2, 'listed', 'Identity confirmed for the proof');
  v_cred := public.admin_dx_record_credential('provider', v_pl, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P4',
                                              null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  v_cred2 := public.admin_dx_record_credential('provider', v_pl2, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P4X',
                                               null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred2, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  perform pg_temp.as_postgres();
  update public.diagnostic_credentials set expires_on = current_date - 1 where id = v_cred2;

  for r in select * from (values
      ('near',    v_lab,  v_pl,  6.4461, 'available',             'hba1c', false),
      ('p4',      v_lab,  v_pl,  6.4641, 'available',             'hba1c', true),
      ('p45',     v_lab,  v_pl,  6.4686, 'available',             'hba1c', true),
      ('mid',     v_lab,  v_pl,  6.5180, 'available',             'hba1c', false),
      ('far',     v_lab,  v_pl,  6.5900, 'available',             'hba1c', true),
      ('unconf',  v_lab,  v_pl,  6.4416, 'awaiting_confirmation', 'hba1c', true),
      ('unavail', v_lab,  v_pl,  6.4551, 'temporarily_unavailable', 'hba1c', true),
      ('notest',  v_lab,  v_pl,  6.4506, 'available',             'fbc',   true),
      ('expired', v_lab2, v_pl2, 6.4371, 'available',             'hba1c', true)
    ) as t(k, lab, pl, lat, av, test, partner)
  loop
    insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
    values (r.lab, initcap(r.k) || ' branch', 'Lagos', 'Victoria Island', '1 Proof Road, Victoria Island',
            '+2348000000' || lpad((random() * 999)::int::text, 3, '0'), r.lat, 3.4219, true)
    returning id into v_loc;
    perform pg_temp.as_user(v_admin);
    v_bl := public.admin_dx_upsert_branch_listing(r.pl, v_loc, 'Eti-Osa', 'Victoria Island', null, null, null, false);
    perform public.admin_dx_verify_branch_location(v_bl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
    perform public.admin_dx_set_listing_status('branch', v_bl, 'listed', 'Branch confirmed for the proof');
    perform public.admin_dx_upsert_service(v_bl, case r.test when 'fbc' then v_fbc else v_hba1c end, r.av, 'onsite', null, false,
                                           null, null, 'Phone call with branch manager');
    if r.partner then
      insert into fx values ('pship_' || r.k,
        public.admin_dx_set_partner(v_bl, current_date - 10, null, false, null, 'Preferred partner agreement signed for the proof'));
    end if;
    perform pg_temp.as_postgres();
    insert into fx values (r.k, v_bl);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
do $$
declare v text; v_state text; v_n int; v_m int;
begin
  -- A: who may act
  perform pg_temp.as_user(pg_temp.id('clinician'));
  begin
    perform public.admin_dx_set_partner(pg_temp.id('near'), current_date, null, false, null, 'A clinician tries to make a partner');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('A1 a clinician cannot set a partner', v_state = '42501', v_state);
  perform pg_temp.as_user(pg_temp.id('patient'));
  begin
    perform public.admin_dx_partnerships(pg_temp.id('near'));
    v_state := 'returned';
  exception when others then v_state := sqlstate;
  end;
  select count(*) into v_n from public.diagnostic_branch_partnerships;
  perform pg_temp.as_postgres();
  insert into results values ('A2 a patient cannot call the partnership read', v_state = '42501', v_state);
  insert into results values ('A3 a patient reads no partnership rows', v_n = 0, v_n::text);

  -- B/C: ranking and badges
  perform pg_temp.as_user(pg_temp.id('patient'));
  v := pg_temp.order_of(6.4281, 3.4219, 30, null, 3);
  insert into results values ('B1 partners in the band first, then eligible by distance (far partner at its own place), then unconfirmed',
    v = 'p4:partner*,p45:partner*,near:eligible,mid:eligible,far:eligible*,unconf:unconfirmed', v);
  insert into results values ('B2 an expired, unavailable or test-less partner never appears',
    v not like '%expired%' and v not like '%unavail%' and v not like '%notest%', v);
  insert into results values ('C1 the unconfirmed partner is not badged', v like '%unconf:unconfirmed' and v not like '%unconf:unconfirmed*%', v);

  -- D: band 0
  v := pg_temp.order_of(6.4281, 3.4219, 30, null, 0);
  insert into results values ('D1 band 0: nobody is moved up, partners keep the badge',
    v = 'near:eligible,p4:eligible*,p45:eligible*,mid:eligible,far:eligible*,unconf:unconfirmed', v);

  -- B3: a small radius that excludes the nearest non-partner changes d0, so the band follows it
  v := pg_temp.order_of(6.4641, 3.4219, 1, null, 3);
  insert into results values ('B3 searching from the 4 km partner itself, 1 km radius: only branches within 1 km', v = 'p4:partner*,p45:partner*', v);

  -- E: state search has no band
  v := pg_temp.order_of(null, null, null, 'Lagos', 3);
  insert into results values ('E1 a state search moves no partner up', v not like '%:partner%' and v like '%p4:eligible*%', v);

  -- H: band input
  begin
    perform pg_temp.order_of(6.4281, 3.4219, 30, null, -1);
    v_state := 'returned';
  exception when others then v_state := sqlstate;
  end;
  insert into results values ('H1 a negative band is refused', v_state = '22023', v_state);
  begin
    perform pg_temp.order_of(6.4281, 3.4219, 30, null, null);
    v_state := 'returned';
  exception when others then v_state := sqlstate;
  end;
  insert into results values ('H2 a missing band is refused', v_state = '22023', v_state);
  perform pg_temp.as_postgres();

  -- F: commission needs legal review
  perform pg_temp.as_user(pg_temp.id('admin'));
  begin
    perform public.admin_dx_set_partner(pg_temp.id('mid'), current_date, null, true, null, 'Commission agreement, not yet reviewed');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  insert into results values ('F1 commission without a legal review reference is refused', v_state = '23514', v_state);
  begin
    perform public.admin_dx_set_partner(pg_temp.id('mid'), current_date, null, true, 'LEGAL-2026-014', 'Commission agreement, reviewed by counsel');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  insert into results values ('F2 commission with a legal review reference is accepted', v_state = 'accepted', v_state);

  -- G: one open per branch; ending; future start
  begin
    perform public.admin_dx_set_partner(pg_temp.id('p4'), current_date, null, false, null, 'A second open partnership attempt');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  insert into results values ('G1 a second open partnership on one branch is refused', v_state = '23505', v_state);
  perform public.admin_dx_end_partner(pg_temp.id('pship_p45'), 'Agreement ended by the branch for the proof');
  perform public.admin_dx_set_partner(pg_temp.id('p45'), current_date + 1, null, false, null, 'New agreement starting tomorrow');
  insert into results values ('G4 ending writes the audit trail',
    exists (select 1 from public.diagnostic_directory_events where subject_id = pg_temp.id('pship_p45') and action = 'partner_ended'), null);
  perform pg_temp.as_postgres();
  perform pg_temp.as_user(pg_temp.id('patient'));
  v := pg_temp.order_of(6.4281, 3.4219, 30, null, 3);
  perform pg_temp.as_postgres();
  insert into results values ('G2 the ended partner is no longer in the band or badged', v like '%near:eligible,p45:eligible,%' and v not like '%p45:partner%', v);
  insert into results values ('G3 a partnership starting tomorrow does not rank today', v not like '%p45:eligible*%', v);

  -- G5: a lapsed agreement does not block a renewal
  update public.diagnostic_branch_partnerships set starts_on = current_date - 60, ends_on = current_date - 1
   where id = pg_temp.id('pship_far');
  perform pg_temp.as_user(pg_temp.id('admin'));
  begin
    perform public.admin_dx_set_partner(pg_temp.id('far'), current_date, null, false, null, 'Renewed agreement after the old one ended');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('G5 a renewal after the end date is accepted and the lapsed row is closed on the record',
    v_state = 'accepted' and (select ended_at is not null from public.diagnostic_branch_partnerships where id = pg_temp.id('pship_far')), v_state);

  -- A4: a delegated verifier (not admin) sees that partnerships exist but not their commercial terms
  insert into public.user_permission_grants (profile_id, permission_key) values (pg_temp.id('clinician'), 'directory.diagnostic.verify');
  perform pg_temp.as_user(pg_temp.id('clinician'));
  select count(*) filter (where (e ->> 'has_commission') is not null or (e ->> 'legal_review_reference') is not null or (e ->> 'note') is not null),
         count(*)
    into v_n, v_m
    from jsonb_array_elements(public.admin_dx_partnerships(
           (select provider_listing_id from public.diagnostic_branch_listings where id = pg_temp.id('mid')))) e;
  perform pg_temp.as_postgres();
  insert into results values ('A4 a verifier sees partnerships but no commission terms or notes', v_n = 0 and v_m > 0, v_n || ' of ' || v_m);

  -- Sabotage b: a partner check that ignores ended_at keeps the ended partner in the band
  create or replace function private.diagnostic_branch_is_partner(p_branch_listing_id uuid)
  returns boolean language sql stable as $s$
    select exists (select 1 from public.diagnostic_branch_partnerships x
                    where x.branch_listing_id = p_branch_listing_id and x.starts_on <= current_date) $s$;
  perform pg_temp.as_user(pg_temp.id('patient'));
  v := pg_temp.order_of(6.4281, 3.4219, 30, null, 3);
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE b: ignoring ended_at keeps the ended partner in the band (proves G2 discriminates)', v like '%p45:partner%', v);

  -- Sabotage a: without the commission constraint, the unreviewed commission partnership goes through
  alter table public.diagnostic_branch_partnerships drop constraint diagnostic_branch_partnerships_commission_reviewed;
  perform pg_temp.as_user(pg_temp.id('admin'));
  begin
    perform public.admin_dx_set_partner(pg_temp.id('near'), current_date, null, true, null, 'Commission agreement, not yet reviewed');
    v_state := 'accepted';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE a: without the constraint the unreviewed commission is accepted (proves F1 discriminates)', v_state = 'accepted', v_state);
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
  if (select count(*) from results) < 21 then raise exception 'expected at least 21 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;

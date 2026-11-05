-- Diagnostic directory Phase 3: search_diagnostic_services and the eligibility fast path.
-- Migration: 20261104234848_diag_p3_search_diagnostic_services.sql.
--
-- Fixture (Lagos + Abuja, HbA1c):
--   VI       6.4281,3.4219  listed, available, provider MLSCN verified          -> eligible
--   Lekki    6.4400,3.4700  listed, awaiting_confirmation, otherwise verified   -> unconfirmed (about 5.6 km from VI)
--   Ikeja    6.6018,3.3515  listed, available                                   -> eligible (about 21 km from VI)
--   Draft VI 6.4300,3.4220  branch left as draft, available                     -> never returned
--   Abuja    9.0700,7.4900  listed, available, state FCT                        -> eligible
--   Test VI  6.4290,3.4230  a second, is_test provider, fully verified          -> only test users and verifiers see it
--
-- Proves:
--   A  anon cannot execute; a real (non-test) user is refused while the directory guard is off
--   B  radius search returns only listed, eligible branches inside the radius, nearest first; an unconfirmed branch is
--      ranked below EVERY eligible one even when nearer; it is left out when not asked for; a draft branch never appears
--   C  an expired credential removes every branch that relied on it, with no other change
--   D  a state search with no point returns the state's branches with no distance
--   E  a patient gets no confirmation date or credential list; a clinician gets both, listing only credentials that count
--      for the test searched (an out-of-scope accreditation or another state's licence is left out); a deactivated
--      clinician gets neither
--   F  a test listing is hidden from a real user and shown to a test user
--   G  bad input is refused: ambiguous concept, no location, zero radius, page size out of range
--   H  paging: offset 1 returns the second row and total_count stays the full count
--   I  the fast path agrees with the full check on every service in the fixture
-- Sabotage x2: (a) a fast path that skips the full check disagrees (proves I discriminates);
--              (b) an eligibility function that always says "eligible" brings the expired branch back (proves C discriminates).

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxp3-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;

-- Search wrapper: the ids of returned services, in order, as text for easy comparison.
create function pg_temp.ids(p_concept uuid, p_lat double precision, p_lng double precision, p_r numeric, p_state text,
                            p_unconf boolean, p_limit int default 50, p_offset int default 0)
returns text language sql as $f$
  select coalesce(string_agg(s.branch_listing_id::text || ':' || s.result_group, ',' order by s.ord), '')
    from (select r.*, row_number() over () as ord
            from public.search_diagnostic_services(p_concept, p_lat, p_lng, p_r, p_state, null, p_unconf, p_limit, p_offset) r) s;
$f$;

create temp table fx (fk text primary key, fv uuid);
grant all on fx to public;

-- ---------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_admin uuid; v_lab uuid; v_lab2 uuid; v_pl uuid; v_pl2 uuid; v_cred uuid; v_cred2 uuid;
  v_hba1c uuid := (select id from public.reference_concepts where code = 'inv.hba1c');
  v_loc uuid; v_bl uuid;
  r record;
begin
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', true);
  insert into fx values ('admin', v_admin), ('hba1c', v_hba1c);
  insert into fx values ('patient_test', pg_temp.mkuser(v_org, 'ptest', 'patient', true));
  insert into fx values ('patient_real', pg_temp.mkuser(v_org, 'preal', 'patient', false));
  insert into fx values ('clinician', pg_temp.mkuser(v_org, 'clin', 'clinician', true));

  insert into public.lab_providers (name, is_active) values ('Proof Search Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab;
  insert into public.lab_providers (name, is_active) values ('Proof Test-Only Lab ' || substr(gen_random_uuid()::text, 1, 6), false) returning id into v_lab2;

  perform pg_temp.as_user(v_admin);
  v_pl := public.admin_dx_create_provider_listing('lab', v_lab, false);
  v_pl2 := public.admin_dx_create_provider_listing('lab', v_lab2, true);
  perform public.admin_dx_set_listing_status('provider', v_pl, 'listed', 'Identity confirmed for the proof');
  perform public.admin_dx_set_listing_status('provider', v_pl2, 'listed', 'Identity confirmed for the proof');
  v_cred := public.admin_dx_record_credential('provider', v_pl, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P3',
                                              null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  v_cred2 := public.admin_dx_record_credential('provider', v_pl2, 'mlscn_registration', 'MLSCN', null, null, 'MLSCN/PROOF/P3T',
                                               null, null, current_date - 100, current_date + 200, 'https://web.mlscn.gov.ng/proof', null);
  perform public.admin_dx_set_credential_status(v_cred2, 'verified_current', 'Checked against the MLSCN approved list', current_date + 180);
  -- Credentials that do NOT count for HbA1c: ISO 15189 scoped to FBC only, and a state licence for another state.
  perform public.admin_dx_set_credential_status(
    public.admin_dx_record_credential('provider', v_pl, 'iso15189', 'MLSCN Accreditation Service', 'MLSCN', null, 'ISO/PROOF/P3',
      array[(select id from public.reference_concepts where code = 'inv.fbc')], 'FBC only', current_date - 100, current_date + 200,
      'https://web.mlscn.gov.ng/proof', null),
    'verified_current', 'Checked against the accreditation certificate', current_date + 180);
  perform public.admin_dx_set_credential_status(
    public.admin_dx_record_credential('provider', v_pl, 'state_facility_licence', 'Kano State Ministry of Health', null, 'Kano', 'KN/PROOF/P3',
      null, null, current_date - 100, current_date + 200, 'https://example.org/proof', null),
    'verified_current', 'Checked against the state register', current_date + 180);
  perform pg_temp.as_postgres();
  insert into fx values ('cred', v_cred);

  for r in select * from (values
      ('vi',      v_lab,  v_pl,  'VI branch',      'Lagos', 'Victoria Island', 'Eti-Osa', 6.4281, 3.4219, 'available',             true),
      ('lekki',   v_lab,  v_pl,  'Lekki branch',   'Lagos', 'Lekki',           'Eti-Osa', 6.4400, 3.4700, 'awaiting_confirmation', true),
      ('ikeja',   v_lab,  v_pl,  'Ikeja branch',   'Lagos', 'Ikeja',           'Ikeja',   6.6018, 3.3515, 'available',             true),
      ('draft',   v_lab,  v_pl,  'Draft branch',   'Lagos', 'Victoria Island', 'Eti-Osa', 6.4300, 3.4220, 'available',             false),
      ('abuja',   v_lab,  v_pl,  'Abuja branch',   'FCT',   'Wuse',            'AMAC',    9.0700, 7.4900, 'available',             true),
      ('testvi',  v_lab2, v_pl2, 'Test VI branch', 'Lagos', 'Victoria Island', 'Eti-Osa', 6.4290, 3.4230, 'available',             true)
    ) as t(k, lab, pl, nm, st, twn, lga, lat, lng, av, list)
  loop
    insert into public.lab_provider_locations (lab_provider_id, name, state, town, address, contact_phone, latitude, longitude, is_active)
    values (r.lab, r.nm, r.st, r.twn, '1 Proof Road, ' || r.twn, '+2348000000' || lpad((random() * 999)::int::text, 3, '0'), r.lat, r.lng, true)
    returning id into v_loc;
    perform pg_temp.as_user(v_admin);
    v_bl := public.admin_dx_upsert_branch_listing(r.pl, v_loc, r.lga, r.twn, null, null, null, r.lab = v_lab2);
    perform public.admin_dx_verify_branch_location(v_bl, 'phone call + Google Maps', 'Called the branch, address and phone confirmed', true);
    if r.list then
      perform public.admin_dx_set_listing_status('branch', v_bl, 'listed', 'Branch confirmed for the proof');
    end if;
    insert into fx values (r.k, v_bl);
    insert into fx values ('svc_' || r.k,
      public.admin_dx_upsert_service(v_bl, v_hba1c, r.av, 'onsite', null, false, null, null, 'Phone call with branch manager'));
    perform pg_temp.as_postgres();
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
  v text; v_expect text; v_state text; v_n bigint;
  v_conf timestamptz; v_creds text[]; v_dist double precision;
  v_amb uuid := (select id from public.reference_concepts where is_ambiguous and investigation_category is not null limit 1);
  g text;
begin
  select (array_agg(fv) filter (where fk = 'hba1c'))[1] as hba1c, (array_agg(fv) filter (where fk = 'vi'))[1] as vi, (array_agg(fv) filter (where fk = 'lekki'))[1] as lekki,
         (array_agg(fv) filter (where fk = 'ikeja'))[1] as ikeja, (array_agg(fv) filter (where fk = 'draft'))[1] as draft, (array_agg(fv) filter (where fk = 'abuja'))[1] as abuja,
         (array_agg(fv) filter (where fk = 'testvi'))[1] as testvi, (array_agg(fv) filter (where fk = 'cred'))[1] as cred,
         (array_agg(fv) filter (where fk = 'patient_test'))[1] as pt, (array_agg(fv) filter (where fk = 'patient_real'))[1] as pr,
         (array_agg(fv) filter (where fk = 'clinician'))[1] as clin,
         (array_agg(fv) filter (where fk = 'admin'))[1] as admin_id
    into f from fx;

  -- A
  insert into results values ('A1 anon cannot execute',
    not has_function_privilege('anon', 'public.search_diagnostic_services(uuid, double precision, double precision, numeric, text, text, boolean, integer, integer)', 'EXECUTE'), null);
  -- Guard changes normally go through set_go_live_guard(); the proof flips it directly, inside the rolled-back transaction.
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = false where key = 'directory_enabled';
  set local session_replication_role = origin;
  perform pg_temp.as_user(f.pr);
  begin
    perform pg_temp.ids(f.hba1c, 6.4281, 3.4219, 10, null, true);
    v_state := 'returned';
  exception when others then v_state := sqlstate;
  end;
  perform pg_temp.as_postgres();
  insert into results values ('A2 real user refused while the directory guard is off', v_state = '55000', v_state);
  set local session_replication_role = replica;
  update public.go_live_guards set is_on = true, changed_at = now(), changed_by = f.admin_id, change_note = 'Opened inside the P3 proof transaction' where key = 'directory_enabled';
  set local session_replication_role = origin;

  -- B (as the real patient, so the test-only provider stays hidden)
  perform pg_temp.as_user(f.pr);
  v := pg_temp.ids(f.hba1c, 6.4281, 3.4219, 10, null, true);
  v_expect := f.vi || ':eligible,' || f.lekki || ':unconfirmed';
  insert into results values ('B1 10 km from VI: VI eligible, Lekki unconfirmed below, no Ikeja, no draft', v = v_expect, v);
  v := pg_temp.ids(f.hba1c, 6.4281, 3.4219, 30, null, true);
  v_expect := f.vi || ':eligible,' || f.ikeja || ':eligible,' || f.lekki || ':unconfirmed';
  insert into results values ('B2 30 km: Ikeja (21 km, eligible) ranks above Lekki (6 km, unconfirmed)', v = v_expect, v);
  v := pg_temp.ids(f.hba1c, 6.4281, 3.4219, 30, null, false);
  v_expect := f.vi || ':eligible,' || f.ikeja || ':eligible';
  insert into results values ('B3 unconfirmed left out when not asked for', v = v_expect, v);
  insert into results values ('B4 the draft branch never appears', position(f.draft::text in pg_temp.ids(f.hba1c, 6.43, 3.422, 1000, null, true)) = 0, null);
  select r.distance_km into v_dist from public.search_diagnostic_services(f.hba1c, 6.4281, 3.4219, 30, null, null, false, 50, 0) r
   where r.branch_listing_id = f.ikeja;
  insert into results values ('B5 Ikeja distance about 21 km, rounded', v_dist between 20 and 22 and v_dist = round(v_dist::numeric, 1)::double precision, v_dist::text);
  perform pg_temp.as_postgres();

  -- D: state search, no point
  perform pg_temp.as_user(f.pr);
  v := pg_temp.ids(f.hba1c, null, null, null, 'fct', true);
  insert into results values ('D1 state search (case-insensitive) returns Abuja only', v = f.abuja || ':eligible', v);
  select r.distance_km into v_dist from public.search_diagnostic_services(f.hba1c, null, null, null, 'FCT', null, true, 50, 0) r limit 1;
  insert into results values ('D2 no distance without a point', v_dist is null, coalesce(v_dist::text, 'null'));
  perform pg_temp.as_postgres();

  -- E: field visibility
  perform pg_temp.as_user(f.pr);
  select r.last_confirmed_at, r.credentials_on_file into v_conf, v_creds
    from public.search_diagnostic_services(f.hba1c, 6.4281, 3.4219, 10, null, null, false, 50, 0) r limit 1;
  perform pg_temp.as_postgres();
  insert into results values ('E1 patient gets no confirmation date or credential list', v_conf is null and v_creds is null, null);
  perform pg_temp.as_user(f.clin);
  select r.last_confirmed_at, r.credentials_on_file into v_conf, v_creds
    from public.search_diagnostic_services(f.hba1c, 6.4281, 3.4219, 10, null, null, false, 50, 0) r
   where r.branch_listing_id = f.vi;
  perform pg_temp.as_postgres();
  insert into results values ('E2 clinician gets both, and only credentials that count for HbA1c in Lagos (no FBC-only ISO, no Kano licence)',
    v_conf is not null and v_creds = array['mlscn_registration'], array_to_string(v_creds, ','));
  update public.profiles set is_active = false where id = f.clin;
  perform pg_temp.as_user(f.clin);
  select r.last_confirmed_at, r.credentials_on_file into v_conf, v_creds
    from public.search_diagnostic_services(f.hba1c, 6.4281, 3.4219, 10, null, null, false, 50, 0) r
   where r.branch_listing_id = f.vi;
  perform pg_temp.as_postgres();
  insert into results values ('E3 a deactivated clinician gets neither', v_conf is null and v_creds is null, null);

  -- F: test listing visibility
  perform pg_temp.as_user(f.pr);
  insert into results values ('F1 real user does not see the test listing',
    position(f.testvi::text in pg_temp.ids(f.hba1c, 6.4281, 3.4219, 10, null, true)) = 0, null);
  perform pg_temp.as_postgres();
  perform pg_temp.as_user(f.pt);
  insert into results values ('F2 test user sees the test listing',
    position(f.testvi::text in pg_temp.ids(f.hba1c, 6.4281, 3.4219, 10, null, true)) > 0, null);
  perform pg_temp.as_postgres();

  -- G: bad input
  perform pg_temp.as_user(f.pr);
  foreach g in array array['ambiguous', 'nothing', 'radius0', 'limit51', 'half_point'] loop
    begin
      case g
        when 'ambiguous'  then perform pg_temp.ids(v_amb, 6.4281, 3.4219, 10, null, true);
        when 'nothing'    then perform pg_temp.ids(f.hba1c, null, null, null, null, true);
        when 'radius0'    then perform pg_temp.ids(f.hba1c, 6.4281, 3.4219, 0, null, true);
        when 'limit51'    then perform pg_temp.ids(f.hba1c, 6.4281, 3.4219, 10, null, true, 51);
        when 'half_point' then perform pg_temp.ids(f.hba1c, 6.4281, null, 10, null, true);
      end case;
      v_state := 'returned';
    exception when others then v_state := sqlstate;
    end;
    insert into results values ('G ' || g || ' refused with 22023', v_state = '22023', v_state);
  end loop;

  -- H: paging
  select string_agg(r.branch_listing_id::text, ','), max(r.total_count) into v, v_n
    from public.search_diagnostic_services(f.hba1c, 6.4281, 3.4219, 30, null, null, true, 1, 1) r;
  insert into results values ('H1 offset 1 limit 1 returns Ikeja with total 3', v = f.ikeja::text and v_n = 3, v || ' / ' || v_n);
  perform pg_temp.as_postgres();

  -- I: fast path agrees with the full check everywhere
  select count(*) into v_n from public.diagnostic_branch_services s
   where private.diagnostic_service_eligible(s.id) is distinct from (cardinality(private.diagnostic_service_eligibility(s.id)) = 0);
  insert into results values ('I1 fast path agrees with the full check on every service', v_n = 0, v_n::text);
  insert into results values ('I2 the fixture has both outcomes',
    exists (select 1 from fx where fk like 'svc_%' and private.diagnostic_service_eligible(fv))
    and exists (select 1 from fx where fk like 'svc_%' and not private.diagnostic_service_eligible(fv)), null);

  -- C: expiry (last, it changes the fixture)
  update public.diagnostic_credentials set expires_on = current_date - 1 where id = f.cred;
  perform pg_temp.as_user(f.pr);
  v := pg_temp.ids(f.hba1c, 6.4281, 3.4219, 1000, null, true);
  perform pg_temp.as_postgres();
  insert into results values ('C1 expired MLSCN credential removes every branch that relied on it', v = '', v);

  -- Sabotage b: an eligibility function that always says "eligible" -> the expired branches come back
  create or replace function private.diagnostic_service_eligibility(p_service_id uuid, p_depth integer default 0)
  returns text[] language sql stable as $s$ select '{}'::text[] $s$;
  perform pg_temp.as_user(f.pr);
  v := pg_temp.ids(f.hba1c, 6.4281, 3.4219, 1000, null, true);
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE b: with eligibility disabled the expired branches return (proves C1 discriminates)',
    position(f.vi::text in v) > 0, v);
end;
$$;

-- Sabotage a: a fast path that trusts listing status alone disagrees with the full check
do $$
declare v_n bigint;
begin
  -- Restore a real full check first (sabotage b replaced it) by forcing a credential reason for every service.
  create or replace function private.diagnostic_service_eligibility(p_service_id uuid, p_depth integer default 0)
  returns text[] language sql stable as $s$ select array['missing_credential:mlscn_registration'] $s$;
  create or replace function private.diagnostic_service_eligible(p_service_id uuid)
  returns boolean language sql stable as $s$
    select exists (select 1 from public.diagnostic_branch_services s
                     join public.diagnostic_branch_listings b on b.id = s.branch_listing_id and b.directory_status = 'listed'
                    where s.id = p_service_id and s.availability in ('available', 'by_appointment')) $s$;
  select count(*) into v_n from public.diagnostic_branch_services s
   where private.diagnostic_service_eligible(s.id) is distinct from (cardinality(private.diagnostic_service_eligibility(s.id)) = 0);
  insert into results values ('SABOTAGE a: a status-only fast path disagrees with the full check (proves I1 discriminates)', v_n > 0, v_n::text);
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
  if (select count(*) from results) < 25 then raise exception 'expected at least 25 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;

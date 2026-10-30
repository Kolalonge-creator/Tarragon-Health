-- ===========================================================================
-- Proof: search_clinical_staff_by_folio (OQ-666 follow-up to CMO OQ-358).
--
-- The admin / CMO people search finds a clinician by MDCN folio through a staff-only function, while the folio stays
-- unreadable from the base table and absent from the directory view. Proves, with simulated sessions in one
-- rolled-back transaction:
--   1. An admin and the CMO find a clinician by a partial, differently-cased folio; a term nobody holds finds nothing (control).
--   2. A colleague clinician, a patient, a care coordinator and a CMO of ANOTHER organisation get zero rows, not an error, so
--      the function cannot be used to test whether a folio exists. anon cannot execute it.
--   3. A one-character term returns nothing, and LIKE wildcards in the term are literal (a bare % or _ matches nothing).
--   4. The function returns ids only; the folio column is still refused on the base table to a colleague and absent from
--      the directory view (the OQ-358 lock is intact).
--   5. SABOTAGE: (a) the function without its entitlement check (a colleague then finds a clinician by folio);
--      (b) the function with the check but without the organisation clause (a foreign CMO then finds one);
--      (c) the table-level SELECT grant put back (a colleague then reads the folio column). Each check MUST flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Sabotaged rows print as PASS (caught) when the check flipped.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.as_val(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_docA uuid := gen_random_uuid();
  v_docB uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_cmo2 uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_staffA uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'Folio Search Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'folio-search-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_docA, v_docB, v_cmo, v_cmo2, v_admin, v_coord]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org,  'patient',          'Search Patient',     '+2348058880701'),
    (v_docA,  v_org,  'clinician',        'Search Doctor A',    '+2348058880702'),
    (v_docB,  v_org,  'clinician',        'Search Doctor B',    '+2348058880703'),
    (v_cmo,   v_org,  'clinician',        'Search CMO',         '+2348058880704'),
    (v_cmo2,  v_org2, 'clinician',        'Search Foreign CMO', '+2348058880705'),
    (v_admin, v_org,  'admin',            'Search Admin',       '+2348058880706'),
    (v_coord, v_org,  'care_coordinator', 'Search Coordinator', '+2348058880707')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number,
                                     license_verified_at, license_expires_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_docA, 'Search Doctor A', true, 'senior_medical_officer', 'MDCN', 'SRCH-ALPHA-77', now(), now() + interval '1 year', 'Probe', 'S-A', now() + interval '1 year'),
    (v_org, v_docB, 'Search Doctor B', true, 'senior_medical_officer', 'MDCN', 'SRCH-BRAVO-88', now(), now() + interval '1 year', 'Probe', 'S-B', now() + interval '1 year');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, status, doctor_tier, employment_type, credentialing_level,
                                     credential_type, credential_number, license_verified_at, verified_by, license_expires_at,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test) values
    (v_org, v_cmo, 'Search CMO', true, 'active', 'chief_medical_officer', 'employed', 2, 'MDCN', 'SRCH-CMO-11', now(), v_admin, now() + interval '1 year',
     'Probe', 'S-C', now() + interval '1 year', true),
    (v_org2, v_cmo2, 'Search Foreign CMO', true, 'active', 'chief_medical_officer', 'employed', 2, 'MDCN', 'SRCH-CMO-22', now(), v_admin, now() + interval '1 year',
     'Probe', 'S-C2', now() + interval '1 year', true);
  select id into v_staffA from public.clinical_staff where profile_id = v_docA;
  insert into fx values ('pat', v_pat), ('docA', v_docA), ('docB', v_docB), ('cmo', v_cmo), ('cmo2', v_cmo2), ('admin', v_admin),
    ('coord', v_coord), ('staffA', v_staffA);
end $$;

-- ---------------------------------------------------------------------------
-- REAL checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_b uuid := pg_temp.f('docB'); v_cmo uuid := pg_temp.f('cmo');
  v_admin uuid := pg_temp.f('admin'); v_sa uuid := pg_temp.f('staffA');
begin
  -- 1. entitled callers find a clinician by a partial, differently-cased folio
  perform pg_temp.rec('real', '1a an admin finds the clinician by a partial folio', v_sa::text,
    pg_temp.as_val(v_admin, 'authenticated', $q$select clinical_staff_id::text from public.search_clinical_staff_by_folio('alpha-77')$q$));
  perform pg_temp.rec('real', '1b the CMO finds the clinician by the full folio', v_sa::text,
    pg_temp.as_val(v_cmo, 'authenticated', $q$select clinical_staff_id::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
  perform pg_temp.rec('real', '1c (control) the CMO of the organisation finds its three clinicians by a shared prefix, not the foreign one', '3',
    pg_temp.as_val(v_cmo, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-')$q$));
  -- a platform admin is staff of every organisation (private.is_org_staff), exactly as for public.clinical_staff_folio()
  perform pg_temp.rec('real', '1c2 (control) a platform admin finds all four', '4',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-')$q$));
  perform pg_temp.rec('real', '1d (control) a folio nobody holds finds nothing', '0',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('NO-SUCH-FOLIO')$q$));

  -- 2. everyone else gets zero rows, never an error; anon cannot execute
  perform pg_temp.rec('real', '2a a colleague clinician gets zero rows', '0',
    pg_temp.as_val(v_b, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
  perform pg_temp.rec('real', '2b a patient gets zero rows', '0',
    pg_temp.as_val(v_pat, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
  perform pg_temp.rec('real', '2c a care coordinator gets zero rows', '0',
    pg_temp.as_val(pg_temp.f('coord'), 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
  perform pg_temp.rec('real', '2d a CMO of ANOTHER organisation gets zero rows for this organisation', '0',
    pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
  perform pg_temp.rec('real', '2e the foreign CMO still finds their OWN organisation''s clinician', '1',
    pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-CMO-22')$q$));
  perform pg_temp.rec('real', '2f anon cannot execute it', 'ERR:42501',
    pg_temp.as_val(null, 'anon', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));

  -- 3. short terms and wildcards
  perform pg_temp.rec('real', '3a a one-character term returns nothing', '0',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('S')$q$));
  perform pg_temp.rec('real', '3b a bare percent sign matches nothing (wildcards are literal)', '0',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('%%')$q$));
  perform pg_temp.rec('real', '3c a bare underscore pair matches nothing', '0',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('__')$q$));
  perform pg_temp.rec('real', '3d a null term returns nothing', '0',
    pg_temp.as_val(v_admin, 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio(null)$q$));

  -- 4. the OQ-358 lock is intact
  perform pg_temp.rec('real', '4a the function returns ids only', 'clinical_staff_id',
    (select string_agg(u.n, ',' order by u.ord) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, ord)
      where p.oid = 'public.search_clinical_staff_by_folio(text)'::regprocedure and u.m = 't'));
  perform pg_temp.rec('real', '4b a colleague is still refused the folio column on the base table', 'ERR:42501',
    pg_temp.as_val(v_b, 'authenticated', 'select credential_number from public.clinical_staff limit 1'));
  perform pg_temp.rec('real', '4c the directory view has no folio column', '0',
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'clinical_staff_directory' and column_name = 'credential_number'));
  perform pg_temp.rec('real', '4d a patient still reads the clinician name from the directory view', '1',
    pg_temp.as_val(v_pat, 'authenticated', $q$select count(*)::text from public.clinical_staff_directory where full_name = 'Search Doctor A'$q$));
end $$;

-- ---------------------------------------------------------------------------
-- SABOTAGE (a): no entitlement check; a colleague must now find a clinician by folio
-- ---------------------------------------------------------------------------
create or replace function public.search_clinical_staff_by_folio(p_term text)
returns table (clinical_staff_id uuid)
language sql stable security definer set search_path = '' as
$$ select cs.id from public.clinical_staff cs where strpos(lower(cs.credential_number), lower(p_term)) > 0 $$;
do $$
begin
  perform pg_temp.rec('sabotaged', '2a a colleague clinician gets zero rows', '0',
    pg_temp.as_val(pg_temp.f('docB'), 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
end $$;

-- SABOTAGE (b): the check but no organisation clause; a foreign CMO must now find this organisation's clinician
create or replace function public.search_clinical_staff_by_folio(p_term text)
returns table (clinical_staff_id uuid)
language sql stable security definer set search_path = '' as
$$ select cs.id from public.clinical_staff cs
    where private.can_credential_review() and strpos(lower(cs.credential_number), lower(p_term)) > 0 $$;
do $$
begin
  perform pg_temp.rec('sabotaged', '2d a CMO of ANOTHER organisation gets zero rows for this organisation', '0',
    pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', $q$select count(*)::text from public.search_clinical_staff_by_folio('SRCH-ALPHA-77')$q$));
end $$;

-- SABOTAGE (c): the table-level grant put back; a colleague must now read the folio column
grant select on public.clinical_staff to authenticated;
do $$
begin
  perform pg_temp.rec('sabotaged', '4b a colleague is still refused the folio column on the base table', 'ERR:42501',
    pg_temp.as_val(pg_temp.f('docB'), 'authenticated', 'select credential_number from public.clinical_staff limit 1'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'folio search proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: only % of 3 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then (case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end)
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
  from results order by phase desc, check_name;
rollback;

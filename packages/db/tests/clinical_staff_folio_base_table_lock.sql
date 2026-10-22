-- ===========================================================================
-- Proof: clinical_staff_folio_base_table_lock (CMO decisions OQ-358 / OQ-358b, step 2 of 2).
--
-- The MDCN folio (clinical_staff.credential_number) is readable on the BASE TABLE only by the clinician
-- themself, the CMO and credentialing staff (admin / CMO via private.can_credential_review()). Proves, with
-- simulated sessions in one rolled-back transaction:
--   1. A colleague clinician, a patient and anon are refused the column (insufficient_privilege), whether named
--      or reached through select *; the same colleague still reads every other column, joins the table to profiles,
--      and reads through a security_invoker view that embeds it (the embedded-join regression of #789).
--   2. public.clinical_staff_folio(): the clinician gets their OWN folio only; the CMO and an admin get a
--      colleague's; a colleague and a patient get zero rows; anon cannot execute it; the real service role reads it.
--   3. The directory view still serves the name to a patient and a colleague, and has no folio column.
--   4. Writes are untouched: an admin can still update credential_number.
--   5. Every column except the folio is selectable by authenticated (a column added later without a grant fails here).
--   6. Folio leaks through functions are closed: clinician_licence_public returns no folio column, the slot list no
--      longer names mdcn_number, and clinician_folio_for_document gives a null folio for lab results and verified
--      documents but still returns it for a prescription.
--   7. The audit copy: a folio change recorded in public.record_corrections is readable by an admin and the CMO only; a colleague
--      (including the one who made the change), a patient and a pharmacist see nothing.
--   8. Entitlement edges of clinical_staff_folio: a CMO of ANOTHER organisation, a pharmacist and a care coordinator get nothing.
--   9. SABOTAGE: (a) the table-level SELECT grant is put back; (b) clinical_staff_folio loses its entitlement check; (c) it loses
--      its organisation clause (a foreign CMO then reads); (d) clinician_licence_public gets its folio column back; (e) the
--      record_corrections policy is restored to the old one. Each check MUST flip.
-- The sabotaged rows are printed as PASS (caught) when the check flipped. Wrapped in BEGIN/ROLLBACK; mints fixtures.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

-- run a statement as a session and report 'ok', or the SQLSTATE of the failure
create function pg_temp.as_try(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql;
    v_out := 'ok';
  exception when others then
    v_out := sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

-- a scalar as a session; the failure code when it errors
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
  v_pat uuid := gen_random_uuid();
  v_docA uuid := gen_random_uuid();
  v_docB uuid := gen_random_uuid();
  v_cmo uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_staffA uuid;
  v_staffB uuid;
  v_staffCmo uuid;
  v_med uuid := gen_random_uuid();
  v_lab uuid := gen_random_uuid();
  v_lrd uuid := gen_random_uuid();
  v_pharm uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_cmo2 uuid := gen_random_uuid();
  v_org2 uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;
  insert into public.organisations (id, name, type) values (v_org2, 'Folio Lock Other Org', 'direct_consumer');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'folio-lock-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}'
    from unnest(array[v_pat, v_docA, v_docB, v_cmo, v_admin, v_pharm, v_coord, v_cmo2]) u;
  insert into public.profiles (id, organisation_id, role, full_name, phone) values
    (v_pat,   v_org, 'patient',   'Lock Patient',  '+2348058880601'),
    (v_docA,  v_org, 'clinician', 'Lock Doctor A', '+2348058880602'),
    (v_docB,  v_org, 'clinician', 'Lock Doctor B', '+2348058880603'),
    (v_cmo,   v_org, 'clinician', 'Lock CMO',      '+2348058880604'),
    (v_admin, v_org, 'admin',     'Lock Admin',    '+2348058880605'),
    (v_pharm, v_org, 'pharmacist', 'Lock Pharmacist', '+2348058880606'),
    (v_coord, v_org, 'care_coordinator', 'Lock Coordinator', '+2348058880607'),
    (v_cmo2,  v_org2, 'clinician', 'Lock Foreign CMO', '+2348058880608')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number,
                                     license_verified_at, license_expires_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at) values
    (v_org, v_docA, 'Lock Doctor A', true, 'senior_medical_officer', 'MDCN', 'LOCK-A', now(), now() + interval '1 year', 'Probe', 'L-A', now() + interval '1 year'),
    (v_org, v_docB, 'Lock Doctor B', true, 'senior_medical_officer', 'MDCN', 'LOCK-B', now(), now() + interval '1 year', 'Probe', 'L-B', now() + interval '1 year');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, status, doctor_tier, employment_type, credentialing_level,
                                     credential_type, credential_number, license_verified_at, verified_by, license_expires_at,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test) values
    (v_org, v_cmo, 'Lock CMO', true, 'active', 'chief_medical_officer', 'employed', 2, 'MDCN', 'LOCK-CMO', now(), v_admin, now() + interval '1 year',
     'Probe', 'L-C', now() + interval '1 year', true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, status, doctor_tier, employment_type, credentialing_level,
                                     credential_type, credential_number, license_verified_at, verified_by, license_expires_at,
                                     indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test) values
    (v_org2, v_cmo2, 'Lock Foreign CMO', true, 'active', 'chief_medical_officer', 'employed', 2, 'MDCN', 'LOCK-CMO2', now(), v_admin, now() + interval '1 year',
     'Probe', 'L-C2', now() + interval '1 year', true);
  select id into v_staffA from public.clinical_staff where profile_id = v_docA;
  select id into v_staffB from public.clinical_staff where profile_id = v_docB;
  select id into v_staffCmo from public.clinical_staff where profile_id = v_cmo;

  -- documents for the document-function checks (the triggers read the acting clinician from the session)
  perform set_config('request.jwt.claims', json_build_object('sub', v_docA, 'role', 'authenticated')::text, true);
  insert into public.medications (id, organisation_id, patient_id, drug_name, added_by) values (v_med, v_org, v_pat, 'LockDrug', v_docA);
  insert into public.lab_result_documents (id, organisation_id, patient_id, file_path, source, reviewed_by, reviewed_at,
                                           patient_interpretation, interpretation_sent_at)
  values (v_lrd, v_org, v_pat, 'lock/x.pdf', (enum_range(null::public.lab_result_document_source))[1], v_docA, now(), 'ok', now());
  update public.lab_result_documents set reviewed_by = v_docA, reviewed_at = now() where id = v_lrd;
  perform set_config('request.jwt.claims', '', true);

  insert into fx values ('org', v_org), ('pat', v_pat), ('docA', v_docA), ('docB', v_docB), ('cmo', v_cmo), ('admin', v_admin),
    ('staffA', v_staffA), ('staffB', v_staffB), ('staffCmo', v_staffCmo), ('med', v_med), ('lrd', v_lrd),
    ('pharm', v_pharm), ('coord', v_coord), ('cmo2', v_cmo2);
end $$;

-- ---------------------------------------------------------------------------
-- REAL checks
-- ---------------------------------------------------------------------------
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_a uuid := pg_temp.f('docA'); v_b uuid := pg_temp.f('docB');
  v_cmo uuid := pg_temp.f('cmo'); v_admin uuid := pg_temp.f('admin');
  v_sa uuid := pg_temp.f('staffA'); v_sb uuid := pg_temp.f('staffB');
  v_cols text; v_missing text;
begin
  -- 1. the column is refused, named or via select *
  perform pg_temp.rec('real', '1a colleague naming credential_number is refused', '42501', pg_temp.as_try(v_b, 'authenticated', 'select credential_number from public.clinical_staff'));
  perform pg_temp.rec('real', '1b colleague select * is refused', '42501', pg_temp.as_try(v_b, 'authenticated', 'select * from public.clinical_staff'));
  perform pg_temp.rec('real', '1c colleague filtering on credential_number is refused', '42501', pg_temp.as_try(v_b, 'authenticated', $q$select id from public.clinical_staff where credential_number = 'LOCK-A'$q$));
  perform pg_temp.rec('real', '1d the clinician is refused their own folio from the table too (the function is the door)', '42501', pg_temp.as_try(v_a, 'authenticated', 'select credential_number from public.clinical_staff where profile_id = ' || quote_literal(v_a)));
  perform pg_temp.rec('real', '1e a patient is refused', '42501', pg_temp.as_try(v_pat, 'authenticated', 'select credential_number from public.clinical_staff'));
  perform pg_temp.rec('real', '1f anon is refused', '42501', pg_temp.as_try(null, 'anon', 'select credential_number from public.clinical_staff'));
  -- the colleague still reads everything else, and embedded joins keep working
  perform pg_temp.rec('real', '1g colleague reads the other columns', 'LOCK DOCTOR A', upper(pg_temp.as_val(v_b, 'authenticated', 'select full_name from public.clinical_staff where id = ' || quote_literal(v_sa))));
  select string_agg(quote_ident(column_name), ', ') into v_cols from information_schema.columns
   where table_schema = 'public' and table_name = 'clinical_staff' and column_name <> 'credential_number';
  perform pg_temp.rec('real', '1h colleague reads every non-folio column in one select', 'ok', pg_temp.as_try(v_b, 'authenticated', 'select ' || v_cols || ' from public.clinical_staff'));
  perform pg_temp.rec('real', '1i colleague joins clinical_staff to profiles (embedded-join shape)', 'ok',
    pg_temp.as_try(v_b, 'authenticated', 'select cs.full_name, cs.credential_type, p.full_name from public.clinical_staff cs join public.profiles p on p.id = cs.profile_id'));
  perform pg_temp.rec('real', '1j colleague reads a security_invoker view that embeds clinical_staff', 'ok',
    pg_temp.as_try(v_b, 'authenticated', 'select count(*) from public.legacy_clinical_work_v'));
  perform pg_temp.rec('real', '1k a count(*) over the table still works (admin dashboard shape)', 'ok',
    pg_temp.as_try(v_admin, 'authenticated', 'select count(id) from public.clinical_staff where active'));

  -- 2. the folio function
  perform pg_temp.rec('real', '2a the clinician gets their OWN folio', 'LOCK-A', pg_temp.as_val(v_a, 'authenticated', format('select credential_number from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2b a colleague gets NO row for another clinician', '0', pg_temp.as_val(v_b, 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2c the CMO gets a colleague''s folio', 'LOCK-A', pg_temp.as_val(v_cmo, 'authenticated', format('select credential_number from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2d an admin gets a colleague''s folio', 'LOCK-B', pg_temp.as_val(v_admin, 'authenticated', format('select credential_number from public.clinical_staff_folio(array[%L]::uuid[])', v_sb)));
  perform pg_temp.rec('real', '2e a patient gets no row', '0', pg_temp.as_val(v_pat, 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2f anon cannot execute the function', '42501', pg_temp.as_try(null, 'anon', format('select * from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2g the real service role reads it', 'LOCK-A', pg_temp.as_val(null, 'service_role', format('select credential_number from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '2h a mixed batch returns only what the caller may see (clinician A: own row only)', '1',
    pg_temp.as_val(v_a, 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L, %L]::uuid[])', v_sa, v_sb)));
  perform pg_temp.rec('real', '2i an empty list returns nothing', '0', pg_temp.as_val(v_a, 'authenticated', 'select count(*)::text from public.clinical_staff_folio(array[]::uuid[])'));

  -- 3. the directory view
  perform pg_temp.rec('real', '3a a patient still reads the staff name from the directory view', '1', pg_temp.as_val(v_pat, 'authenticated', $q$select count(*)::text from public.clinical_staff_directory where full_name = 'Lock Doctor A'$q$));
  perform pg_temp.rec('real', '3b a colleague still reads the staff name from the directory view', '1', pg_temp.as_val(v_b, 'authenticated', $q$select count(*)::text from public.clinical_staff_directory where full_name = 'Lock Doctor A'$q$));
  perform pg_temp.rec('real', '3c the directory view has no folio column', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'clinical_staff_directory' and column_name = 'credential_number'));

  -- 4. writes untouched
  perform pg_temp.rec('real', '4a an admin can still set a folio', 'ok', pg_temp.as_try(v_admin, 'authenticated', format($q$update public.clinical_staff set credential_number = 'LOCK-A2' where id = %L$q$, v_sa)));
  perform pg_temp.rec('real', '4b ... and the function shows the new value to the CMO', 'LOCK-A2', pg_temp.as_val(v_cmo, 'authenticated', format('select credential_number from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  update public.clinical_staff set credential_number = 'LOCK-A' where id = v_sa;

  -- 5. every non-folio column is granted (a column added later without a grant fails here)
  select string_agg(column_name, ', ') into v_missing from information_schema.columns
   where table_schema = 'public' and table_name = 'clinical_staff' and column_name <> 'credential_number'
     and not has_column_privilege('authenticated', 'public.clinical_staff', column_name, 'SELECT');
  perform pg_temp.rec('real', '5 no non-folio column is missing from the authenticated grant', '', coalesce(v_missing, ''));

  -- 6. the function leaks
  perform pg_temp.rec('real', '6a clinician_licence_public returns no folio column', 'credential_type,checked_on',
    (select string_agg(u.n, ',' order by u.ord) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, ord)
      where p.oid = 'public.clinician_licence_public(uuid)'::regprocedure and u.m = 't'));
  perform pg_temp.rec('real', '6b the slot list no longer names mdcn_number', 'false', (pg_get_functiondef('public.list_bookable_consult_slots(timestamptz,timestamptz,text,text,uuid,text,text)'::regprocedure) ilike '%mdcn_number%')::text);
  perform pg_temp.rec('real', '6c a lab result document returns a null folio but still names the doctor', 'Lock Doctor A|',
    pg_temp.as_val(v_pat, 'authenticated', format($q$select full_name || '|' || coalesce(credential_number, '') from public.clinician_folio_for_document('lab_result_interpretation', array[%L]::uuid[])$q$, pg_temp.f('lrd'))));
  perform pg_temp.rec('real', '6d a prescription still returns the folio', 'LOCK-A',
    pg_temp.as_val(v_pat, 'authenticated', format($q$select credential_number from public.clinician_folio_for_document('prescription', array[%L]::uuid[])$q$, pg_temp.f('med'))));
  perform pg_temp.rec('real', '6e the slot list function names no credential_number at all', 'false', (pg_get_functiondef('public.list_bookable_consult_slots(timestamptz,timestamptz,text,text,uuid,text,text)'::regprocedure) ilike '%credential_number%')::text);

  -- 7. the audit copy (4a changed a folio, so a correction row exists)
  perform pg_temp.rec('real', '7a the correction row exists (control)', 'true', (select (count(*) >= 1)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = v_sa and 'credential_number' = any (changed_columns)));
  perform pg_temp.rec('real', '7b an admin reads the folio correction', 'true', pg_temp.as_val(v_admin, 'authenticated', format($q$select (count(*) >= 1)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
  perform pg_temp.rec('real', '7c the CMO reads the folio correction', 'true', pg_temp.as_val(v_cmo, 'authenticated', format($q$select (count(*) >= 1)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
  perform pg_temp.rec('real', '7d a colleague sees no folio correction', '0', pg_temp.as_val(v_b, 'authenticated', format($q$select count(*)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
  perform pg_temp.rec('real', '7e a patient sees no folio correction', '0', pg_temp.as_val(v_pat, 'authenticated', format($q$select count(*)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
  perform pg_temp.rec('real', '7f a pharmacist sees no folio correction', '0', pg_temp.as_val(pg_temp.f('pharm'), 'authenticated', format($q$select count(*)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
  perform pg_temp.rec('real', '7g0 (control) the colleague can still write a folio through the table policy, as before', 'ok',
    pg_temp.as_try(v_b, 'authenticated', format($q$update public.clinical_staff set credential_number = 'LOCK-A3' where id = %L$q$, v_sa)));
  update public.clinical_staff set credential_number = 'LOCK-A' where id = v_sa;
  perform pg_temp.rec('real', '7g a colleague who made a folio change cannot read the value they replaced', '0',
    (select pg_temp.as_val(v_b, 'authenticated', format($q$select count(*)::text from public.record_corrections where table_name = 'clinical_staff' and corrected_by = %L and 'credential_number' = any (changed_columns)$q$, v_b))));
  -- other corrections on the same table stay readable by the org (the policy only guards folio changes)
  update public.clinical_staff set bio = 'bio probe' where id = v_sa;
  perform pg_temp.rec('real', '7h a non-folio correction on clinical_staff is still readable by a colleague', 'true', pg_temp.as_val(v_b, 'authenticated', format($q$select (count(*) >= 1)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and not ('credential_number' = any (changed_columns))$q$, v_sa)));

  -- 8. entitlement edges
  perform pg_temp.rec('real', '8a a CMO of ANOTHER organisation gets no row', '0', pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '8b a pharmacist gets no row', '0', pg_temp.as_val(pg_temp.f('pharm'), 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '8c a care coordinator gets no row', '0', pg_temp.as_val(pg_temp.f('coord'), 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
  perform pg_temp.rec('real', '8d the foreign CMO still gets their OWN folio', 'LOCK-CMO2', pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', format('select credential_number from public.clinical_staff_folio(array[(select id from public.clinical_staff where profile_id = %L)]::uuid[])', pg_temp.f('cmo2'))));
end $$;

-- ---------------------------------------------------------------------------
-- SABOTAGE (a): put the table-level grant back; the colleague must now read the folio
-- ---------------------------------------------------------------------------
grant select on public.clinical_staff to authenticated;
do $$
declare v_b uuid := pg_temp.f('docB');
begin
  perform pg_temp.rec('sabotaged', '1a colleague naming credential_number is refused', '42501', pg_temp.as_try(v_b, 'authenticated', 'select credential_number from public.clinical_staff'));
end $$;

-- SABOTAGE (b): the folio function without its entitlement check; a colleague must now get rows
create or replace function public.clinical_staff_folio(p_staff_ids uuid[])
returns table (clinical_staff_id uuid, credential_number text)
language sql stable security definer set search_path = '' as
$$ select cs.id, cs.credential_number from public.clinical_staff cs where cs.id = any (p_staff_ids) $$;
do $$
declare v_b uuid := pg_temp.f('docB'); v_sa uuid := pg_temp.f('staffA');
begin
  perform pg_temp.rec('sabotaged', '2b a colleague gets NO row for another clinician', '0', pg_temp.as_val(v_b, 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
end $$;

-- SABOTAGE (c): the folio function WITH the CMO check but WITHOUT the organisation clause; a foreign CMO must now read
create or replace function public.clinical_staff_folio(p_staff_ids uuid[])
returns table (clinical_staff_id uuid, credential_number text)
language sql stable security definer set search_path = '' as
$$ select cs.id, cs.credential_number from public.clinical_staff cs
    where cs.id = any (p_staff_ids) and (cs.profile_id = (select auth.uid()) or private.can_credential_review()) $$;
do $$
declare v_sa uuid := pg_temp.f('staffA');
begin
  perform pg_temp.rec('sabotaged', '8a a CMO of ANOTHER organisation gets no row', '0', pg_temp.as_val(pg_temp.f('cmo2'), 'authenticated', format('select count(*)::text from public.clinical_staff_folio(array[%L]::uuid[])', v_sa)));
end $$;

-- SABOTAGE (d): clinician_licence_public gets its folio column back
drop function public.clinician_licence_public(uuid);
create function public.clinician_licence_public(p_profile uuid) returns table (credential_type text, credential_number text, checked_on date)
language sql stable security definer set search_path = '' as
$$ select cs.credential_type, cs.credential_number, current_date from public.clinical_staff cs where cs.profile_id = p_profile $$;
do $$
begin
  perform pg_temp.rec('sabotaged', '6a clinician_licence_public returns no folio column', 'credential_type,checked_on',
    (select string_agg(u.n, ',' order by u.ord) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as u(n, m, ord)
      where p.oid = 'public.clinician_licence_public(uuid)'::regprocedure and u.m = 't'));
end $$;

-- SABOTAGE (e): the record_corrections policy as it was before this change; a colleague must now read a folio correction
drop policy record_corrections_select on public.record_corrections;
create policy record_corrections_select on public.record_corrections for select to authenticated
  using (private.can_read_record_correction(table_name, organisation_id, patient_id, corrected_by));
do $$
declare v_b uuid := pg_temp.f('docB'); v_sa uuid := pg_temp.f('staffA');
begin
  perform pg_temp.rec('sabotaged', '7d a colleague sees no folio correction', '0', pg_temp.as_val(v_b, 'authenticated', format($q$select count(*)::text from public.record_corrections where table_name = 'clinical_staff' and entity_id = %L and 'credential_number' = any (changed_columns)$q$, v_sa)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'folio base-table lock proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || coalesce(expected, 'null') || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 5 then raise exception 'VACUOUS TEST: only % of 5 sabotages flipped a check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then (case when expected is distinct from actual then 'PASS (caught)' else 'FAIL' end)
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as result
  from results order by phase desc, check_name;
rollback;

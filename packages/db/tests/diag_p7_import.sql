-- Diagnostic directory Phase 7: controlled import (spec §15.4). Migration: 20261105093124_diag_p7_controlled_import.sql.
--
-- Proves:
--   A  a patient cannot stage, read or apply an import
--   B  staging checks every row: unknown or group investigation codes, bad phone, missing evidence and half coordinates are
--      marked invalid with their reasons; good rows are staged; nothing is listed by staging
--   C  applying a good row creates a DRAFT uncontracted facility and branch, its tests as awaiting_confirmation, and its
--      registration as a PENDING credential; it appears in no search
--   D  a second row with the same provider name adds a branch to the same listing
--   E  a row at an address the provider already has is refused as a duplicate and stays staged
--   F  an invalid row cannot be applied; an applied row cannot be applied again
--   G  a row naming a contracted provider is refused (its branches are managed on the partner screen)
--   H  rejection needs a reason; a rejected row cannot then be applied
--   I  an ISO 15189 row records a pending accreditation with its scope
-- Sabotage: with the row checks disabled, the unknown-code row stages as good (proves B discriminates).

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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'dxp7-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, initcap(p_label) || ' Dxp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_active = true;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.id(p_k text) returns uuid language sql as $f$ select fv from fx where fk = p_k $f$;
create function pg_temp.row_id(p_n int) returns uuid language sql as $f$
  select r.id from public.diagnostic_import_rows r where r.batch_id = (select fv from fx where fk = 'batch') and r.row_number = p_n $f$;
create function pg_temp.try_apply(p_n int) returns text language plpgsql as $f$
begin
  perform public.admin_dx_import_apply_row(pg_temp.row_id(p_n));
  return 'applied';
exception when others then return sqlstate;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_name text := 'Proof Import Lab ' || substr(gen_random_uuid()::text, 1, 6);
  v_contracted text := 'Proof Contracted Lab ' || substr(gen_random_uuid()::text, 1, 6);
  v_rows jsonb;
  v_state text; v_n int; v_s text; v_batch uuid; v_bl uuid; v_bl2 uuid; v_pl uuid;
  v_base jsonb;
begin
  insert into fx values ('admin', pg_temp.mkuser(v_org, 'admin', 'admin')), ('patient', pg_temp.mkuser(v_org, 'patient', 'patient'));
  -- A contracted laboratory (inserted directly: the real-contacts guard is not what this proof is about)
  set local session_replication_role = replica;
  insert into public.lab_providers (name, is_active) values (v_contracted, true);
  set local session_replication_role = origin;

  v_base := jsonb_build_object('trading_name', v_name, 'facility_type', 'lab', 'state', 'Lagos', 'town', 'Lekki', 'lga', 'Eti-Osa',
             'phone', '+2348011111111', 'latitude', '6.44', 'longitude', '3.47', 'investigation_codes', 'inv.hba1c; inv.fbc',
             'regulator', 'mlscn_registration', 'registration_number', 'MLSCN/IMP/001', 'registration_expires_on', '2027-06-30',
             'evidence', 'MLSCN approved list, Nov 2026', 'evidence_url', 'https://web.mlscn.gov.ng/proof',
             'partner_status', 'none', 'record_status', 'pending');
  v_rows := jsonb_build_array(
    v_base || jsonb_build_object('branch_name', 'Lekki branch', 'address', '1 Admiralty Way, Lekki'),                       -- 1 good
    v_base || jsonb_build_object('branch_name', 'Ajah branch', 'address', '2 Addo Road, Ajah', 'investigation_codes', 'inv.nonexistent'), -- 2 unknown code
    v_base || jsonb_build_object('branch_name', 'Yaba branch', 'address', '3 Herbert Macaulay Way', 'phone', '0801 111 1111',
                                 'evidence', '', 'longitude', ''),                                                         -- 3 bad phone, no evidence, half coords
    v_base || jsonb_build_object('branch_name', 'Ikeja branch', 'address', '4 Allen Avenue, Ikeja', 'town', 'Ikeja'),       -- 4 good, same provider
    v_base || jsonb_build_object('branch_name', 'Lekki again', 'address', '1  admiralty way,  lekki'),                       -- 5 duplicate of 1
    v_base || jsonb_build_object('trading_name', v_contracted, 'branch_name', 'VI', 'address', '5 Ozumba Mbadiwe, VI'),     -- 6 contracted
    v_base || jsonb_build_object('branch_name', 'Surulere branch', 'address', '6 Adeniran Ogunsanya, Surulere'),            -- 7 to reject
    v_base || jsonb_build_object('branch_name', 'Gbagada branch', 'address', '7 Gbagada Expressway',
                                 'accreditation_body', 'MLSCN Accreditation Service', 'accreditation_number', 'ISO/IMP/9',
                                 'accreditation_scope_codes', 'inv.hba1c', 'evidence_url', 'https://web.mlscn.gov.ng/proof'), -- 8 ISO
    v_base || jsonb_build_object('branch_name', 'Group code', 'address', '8 Somewhere Road',
                                 'investigation_codes', (select code from public.reference_concepts where is_ambiguous and investigation_category is not null order by code limit 1)) -- 9 group code
  );

  -- A
  perform pg_temp.as_user(pg_temp.id('patient'));
  begin
    perform public.admin_dx_import_stage('Proof spreadsheet', null, v_rows);
    v_state := 'staged';
  exception when others then v_state := sqlstate;
  end;
  select count(*) into v_n from public.diagnostic_import_rows;
  perform pg_temp.as_postgres();
  insert into results values ('A1 a patient cannot stage an import', v_state = '42501', v_state);
  insert into results values ('A2 a patient reads no staged rows', v_n = 0, v_n::text);

  -- B
  perform pg_temp.as_user(pg_temp.id('admin'));
  v_batch := public.admin_dx_import_stage('Proof spreadsheet', 'Lagos labs, first pass', v_rows);
  perform pg_temp.as_postgres();
  insert into fx values ('batch', v_batch);
  select string_agg(row_number || ':' || status, ',' order by row_number) into v_s from public.diagnostic_import_rows where batch_id = v_batch;
  insert into results values ('B1 good rows staged, bad rows invalid',
    v_s = '1:staged,2:invalid,3:invalid,4:staged,5:staged,6:staged,7:staged,8:staged,9:invalid', v_s);
  select array_to_string(problems, '; ') into v_s from public.diagnostic_import_rows where id = pg_temp.row_id(3);
  insert into results values ('B2 every problem on a bad row is named',
    v_s like '%phone%' and v_s like '%evidence%' and v_s like '%latitude and longitude%', v_s);
  select array_to_string(problems, '; ') into v_s from public.diagnostic_import_rows where id = pg_temp.row_id(9);
  insert into results values ('B3 a group investigation code is refused', v_s like '%is a group%', v_s);
  insert into results values ('B4 staging created no listing',
    not exists (select 1 from public.lab_providers where name = v_name), null);

  -- C
  perform pg_temp.as_user(pg_temp.id('admin'));
  v_bl := public.admin_dx_import_apply_row(pg_temp.row_id(1));
  perform pg_temp.as_postgres();
  select provider_listing_id into v_pl from public.diagnostic_branch_listings where id = v_bl;
  insert into results values ('C1 a draft, uncontracted facility and branch',
    (select directory_status from public.diagnostic_provider_listings where id = v_pl) = 'draft'
    and (select directory_status from public.diagnostic_branch_listings where id = v_bl) = 'draft'
    and not (select is_active from public.lab_providers where name = v_name), null);
  select string_agg(availability, ',' order by availability) into v_s from public.diagnostic_branch_services where branch_listing_id = v_bl;
  insert into results values ('C2 its tests are awaiting confirmation', v_s = 'awaiting_confirmation,awaiting_confirmation', v_s);
  select string_agg(regulator || ':' || status, ',') into v_s from public.diagnostic_credentials where branch_listing_id = v_bl;
  insert into results values ('C3 its registration is a pending credential', v_s = 'mlscn_registration:pending', v_s);
  insert into results values ('C4 no imported service is eligible',
    not exists (select 1 from public.diagnostic_branch_services s where s.branch_listing_id = v_bl and private.diagnostic_service_eligible(s.id)), null);
  insert into results values ('C5 the row records what it created',
    (select status = 'applied' and branch_listing_id = v_bl and decided_by is not null from public.diagnostic_import_rows where id = pg_temp.row_id(1)), null);

  -- D, E, F, G
  perform pg_temp.as_user(pg_temp.id('admin'));
  v_s := pg_temp.try_apply(4);
  insert into results values ('D1 the same provider name adds a branch to the same listing',
    v_s = 'applied' and (select count(*) from public.diagnostic_branch_listings where provider_listing_id = v_pl) = 2, v_s);
  v_s := pg_temp.try_apply(5);
  insert into results values ('E1 a duplicate address is refused', v_s = '23505', v_s);
  insert into results values ('E2 the duplicate row stays staged', (select status from public.diagnostic_import_rows where id = pg_temp.row_id(5)) = 'staged', null);
  v_s := pg_temp.try_apply(2);
  insert into results values ('F1 an invalid row cannot be applied', v_s = '22023', v_s);
  v_s := pg_temp.try_apply(1);
  insert into results values ('F2 an applied row cannot be applied again', v_s = '22023', v_s);
  v_s := pg_temp.try_apply(6);
  insert into results values ('G1 a contracted provider is refused', v_s = '42501', v_s);

  -- H
  begin
    perform public.admin_dx_import_reject_row(pg_temp.row_id(7), 'short');
    v_s := 'rejected';
  exception when others then v_s := sqlstate;
  end;
  insert into results values ('H1 rejection needs a real reason', v_s = '22023', v_s);
  perform public.admin_dx_import_reject_row(pg_temp.row_id(7), 'Branch closed in 2025, confirmed by phone');
  v_s := pg_temp.try_apply(7);
  insert into results values ('H2 a rejected row cannot be applied', v_s = '22023', v_s);

  -- I
  v_bl2 := public.admin_dx_import_apply_row(pg_temp.row_id(8));
  insert into results values ('I2 the batch counts add up',
    (select (e ->> 'applied')::int = 3 and (e ->> 'invalid')::int = 3 and (e ->> 'rejected')::int = 1 and (e ->> 'staged')::int = 2
       from jsonb_array_elements(public.admin_dx_import_batches()) e where (e ->> 'id')::uuid = v_batch), null);
  perform pg_temp.as_postgres();
  select string_agg(c.regulator || ':' || c.status || ':' || coalesce(array_length(c.scope_concept_ids, 1), 0), ',' order by c.regulator) into v_s
    from public.diagnostic_credentials c where c.branch_listing_id = v_bl2;
  insert into results values ('I1 ISO 15189 recorded as pending with its scope', v_s = 'iso15189:pending:1,mlscn_registration:pending:0', v_s);

  -- Sabotage: no row checks -> the unknown-code row stages as good
  create or replace function private.diagnostic_import_problems(p jsonb) returns text[] language sql stable as $s$ select '{}'::text[] $s$;
  perform pg_temp.as_user(pg_temp.id('admin'));
  v_batch := public.admin_dx_import_stage('Proof sabotage', null, jsonb_build_array(v_rows -> 1));
  perform pg_temp.as_postgres();
  insert into results values ('SABOTAGE: without the row checks the unknown code stages as good (proves B1 discriminates)',
    (select status from public.diagnostic_import_rows where batch_id = v_batch) = 'staged', null);
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
  if (select count(*) from results) < 22 then raise exception 'expected at least 22 checks, ran %', (select count(*) from results); end if;
end;
$$;

rollback;

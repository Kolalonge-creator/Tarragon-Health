-- Owed sign-offs ledger proof (migration 20261029204700). One rolled-back transaction, own org and own is_test fixtures.
--   * only the organisation's Chief Medical Officer can read the ledger; a plain clinician, an admin and anon see nothing;
--   * sign_owed_signoff: only the CMO, the word SIGN, a note of at least 20 characters, and only a row that is still waiting;
--   * signing records who and when, writes one audit entry, and a second signature on the same row is refused;
--   * no signed-in user can insert, update or delete a row directly; anon cannot execute the function;
--   * a CMO of another organisation can neither read nor sign this organisation's row.
--   SABOTAGE: the read policy dropped, so a plain clinician then sees the row (the "reads nothing" check must flip).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'owed-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'Owed ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, organisation_id = excluded.organisation_id;
  return v;
end $f$;
create function pg_temp.sql_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into v; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(v, 'ok');
end $f$;
create function pg_temp.anon_sql(p_sql text) returns text language plpgsql as $f$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into v; exception when others then perform pg_temp.back(); return 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return coalesce(v, 'ok');
end $f$;
create function pg_temp.chk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$f$ insert into results values (p_phase, p_name, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_org2 uuid; v_admin uuid; v_cmo uuid; v_cmo2 uuid; v_doc uuid; v_row uuid;
begin
  insert into public.organisations (name, type) select 'Owed proof org', type from public.organisations limit 1 returning id into v_org;
  insert into public.organisations (name, type) select 'Owed proof other org', type from public.organisations limit 1 returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_doc := pg_temp.mkuser(v_org, 'doc', 'clinician');
  v_cmo2 := pg_temp.mkuser(v_org2, 'cmo2', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'Owed CMO', 'MDCN', 'OWED-CMO-1', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, v_doc, 'Owed Doc', 'MDCN', 'OWED-D-1', true, 'active', now(), v_admin, 'senior_medical_officer', 'employed', 2, true);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org2, v_cmo2, 'Owed CMO two', 'MDCN', 'OWED-CMO-2', true, 'active', now(), v_admin, 'chief_medical_officer', 'contracted', 2, true, v_admin, true);

  insert into public.owed_signoffs (organisation_id, subject_key, title, detail, running)
    values (v_org, 'proof_subject', 'A proof subject', 'A thing that is running and still needs the CMO to sign it.', true) returning id into v_row;

  perform pg_temp.setf('org', v_org); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('cmo2', v_cmo2); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('row', v_row);

  -- reads
  perform pg_temp.chk('real', 'the CMO reads the ledger', '1', pg_temp.sql_as(v_cmo, $q$select count(*)::text from public.owed_signoffs where subject_key = 'proof_subject'$q$));
  perform pg_temp.chk('real', 'a plain clinician reads nothing', '0', pg_temp.sql_as(v_doc, $q$select count(*)::text from public.owed_signoffs where subject_key = 'proof_subject'$q$));
  perform pg_temp.chk('real', 'an admin reads nothing', '0', pg_temp.sql_as(v_admin, $q$select count(*)::text from public.owed_signoffs where subject_key = 'proof_subject'$q$));
  perform pg_temp.chk('real', 'another organisation''s CMO reads nothing', '0', pg_temp.sql_as(v_cmo2, $q$select count(*)::text from public.owed_signoffs where subject_key = 'proof_subject'$q$));
  perform pg_temp.chk('real', 'anon cannot read', 'ERR:42501', pg_temp.anon_sql($q$select count(*)::text from public.owed_signoffs$q$));

  -- signing refusals (nothing is signed by any of these)
  perform pg_temp.chk('real', 'a plain clinician cannot sign', 'ERR:42501', pg_temp.sql_as(v_doc, $q$select public.sign_owed_signoff('proof_subject', repeat('x', 30), 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'an admin cannot sign', 'ERR:42501', pg_temp.sql_as(v_admin, $q$select public.sign_owed_signoff('proof_subject', repeat('x', 30), 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'anon cannot execute the function', 'ERR:42501', pg_temp.anon_sql($q$select public.sign_owed_signoff('proof_subject', repeat('x', 30), 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'another organisation''s CMO cannot sign this row', 'ERR:22023', pg_temp.sql_as(v_cmo2, $q$select public.sign_owed_signoff('proof_subject', repeat('x', 30), 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'the word SIGN is required', 'ERR:22023', pg_temp.sql_as(v_cmo, $q$select public.sign_owed_signoff('proof_subject', repeat('x', 30), 'yes')::text$q$));
  perform pg_temp.chk('real', 'a note under 20 characters is refused', 'ERR:23514', pg_temp.sql_as(v_cmo, $q$select public.sign_owed_signoff('proof_subject', 'too short', 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'an unknown subject is refused', 'ERR:22023', pg_temp.sql_as(v_cmo, $q$select public.sign_owed_signoff('no_such_subject', repeat('x', 30), 'SIGN')::text$q$));
  perform pg_temp.chk('real', 'still unsigned after every refusal', '0', (select count(*)::text from public.owed_signoffs where id = v_row and signed_at is not null));

  -- direct writes
  perform pg_temp.chk('real', 'the CMO cannot update a row directly', 'ERR:42501', pg_temp.sql_as(v_cmo, $q$update public.owed_signoffs set signed_at = now(), sign_note = repeat('x', 30) where subject_key = 'proof_subject'$q$));
  perform pg_temp.chk('real', 'the CMO cannot insert a row directly', 'ERR:42501', pg_temp.sql_as(v_cmo, format($q$insert into public.owed_signoffs (organisation_id, subject_key, title, detail) values (%L, 'direct_insert', 'Direct insert', 'Written straight to the table, which nobody may do.')$q$, v_org)));
  perform pg_temp.chk('real', 'the CMO cannot delete a row directly', 'ERR:42501', pg_temp.sql_as(v_cmo, $q$delete from public.owed_signoffs where subject_key = 'proof_subject'$q$));

  -- the signature
  perform pg_temp.chk('real', 'the CMO signs', 'ok', case when pg_temp.sql_as(v_cmo, $q$select public.sign_owed_signoff('proof_subject', 'Read the document and checked it against the guideline.', 'sign')::text$q$) like 'ERR:%' then 'refused' else 'ok' end);
  perform pg_temp.chk('real', 'signed_by is the CMO', v_cmo::text, (select signed_by::text from public.owed_signoffs where id = v_row));
  perform pg_temp.chk('real', 'signed_at and the note are recorded', 'true', (select (signed_at is not null and sign_note like 'Read the document%')::text from public.owed_signoffs where id = v_row));
  perform pg_temp.chk('real', 'one audit entry for the signature', '1', (select count(*)::text from public.audit_log where action = 'owed_signoff.signed' and entity_id = v_row));
  perform pg_temp.chk('real', 'a second signature on the same row is refused', 'ERR:22023', pg_temp.sql_as(v_cmo, $q$select public.sign_owed_signoff('proof_subject', repeat('y', 30), 'SIGN')::text$q$));

  -- sabotage: without the read policy a plain clinician sees the row
  drop policy owed_signoffs_cmo_read on public.owed_signoffs;
  create policy owed_signoffs_sabotage on public.owed_signoffs for select to authenticated using (true);
  perform pg_temp.chk('sabotaged', 'a plain clinician reads nothing', '0', pg_temp.sql_as(v_doc, $q$select count(*)::text from public.owed_signoffs where subject_key = 'proof_subject'$q$));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'owed signoffs proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 1 then raise exception 'VACUOUS: the sabotaged read policy changed nothing, so the read checks prove nothing'; end if;
  raise notice 'ALL CHECKS PASSED (% real checks, sabotage caught)', (select count(*) from results where phase = 'real');
end $$;

select phase, check_name, expected, actual,
       case when phase = 'sabotaged' then case when expected <> actual then 'CAUGHT' else 'MISSED' end
            when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase desc, check_name;

rollback;

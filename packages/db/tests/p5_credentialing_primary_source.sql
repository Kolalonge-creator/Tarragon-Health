-- P5 proof: MDCN / DataFlow primary-source verification gate, grandfathering, six-month spot re-check, the licence-date
-- work list, the patient-safe "licence verified on" lookup. CMO answers Q14, Q15, Q17; OQ-109.
-- (The Q16 sampler is proved in s20_quality_and_safety.sql section 2b.)
--
-- Proves in one rolled-back transaction:
--   1. Grants: nothing for anon or PUBLIC; no direct writes to the new tables; private helpers not callable.
--   2. The gate: a real (non-test) clinician with no evidence is NOT eligible; test clinicians are exempt; the grandfathering flag
--      can only be switched OFF; a grandfathered clinician stays eligible until the end date or until evidence is recorded.
--   3. Recording evidence: only a reviewer, never for oneself, route/reference/date/evidence file all required, the evidence must be
--      that clinician's own upload, one reference cannot vouch for two people; recording ends the grandfathering.
--   4. The spot re-check: a sweep opens one item six months after the last verification, tells reviewers once, flags overdue once,
--      NEVER suspends (status and eligibility unchanged), and recording a re-check closes the item.
--   5. The work list and the date form: unverified, due re-checks and missing dates are listed for reviewers only; a date can be
--      filled once but never overwritten, never in the past, never by the clinician.
--   6. The patient lookup: a date only when a record exists and the licence is in date; nothing for unverified, suspended or
--      expired clinicians; no folio in the result.
--   7. SABOTAGE: the gate forced open; the "unverified is not eligible" check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
-- a scalar as a user
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'p5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'P5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
-- a REAL (non-test) clinician row, as the gate treats test rows as exempt
create function pg_temp.mkstaff(p_org uuid, p_uid uuid, p_label text, p_admin uuid, p_test boolean default false, p_licence timestamptz default null) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, license_expires_at, is_test)
  values (p_org, p_uid, 'P5 ' || p_label, 'MDCN', 'P5-' || p_label || '-' || substr(p_uid::text, 1, 8), true, 'active', now(), p_admin,
          'senior_medical_officer', 'employed', 2, p_licence, p_test)
  returning id into v;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_staff uuid, p_owner uuid, p_kind text) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.clinician_documents (organisation_id, owner_profile_id, clinical_staff_id, kind, storage_path, mime_type, size_bytes, sha256, is_test)
  values (p_org, p_owner, p_staff, p_kind::public.clinician_document_kind, p_org || '/' || p_owner || '/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000, repeat('b', 64), true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_pat_other uuid; v_org2 uuid;
  u_gf uuid; u_new uuid; u_t uuid; u_old uuid; u_dates uuid;
  s_gf uuid; s_new uuid; s_t uuid; s_old uuid; s_dates uuid;
  d_gf uuid; d_new uuid; d_other uuid; d_old uuid; d_old2 uuid;
  v_r text; v_sweep jsonb; v_list jsonb; v_n integer; v_cols text; u_coord uuid; s_coord uuid; v_app uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  u_gf := pg_temp.mkuser(v_org, 'grandfathered', 'clinician');
  u_new := pg_temp.mkuser(v_org, 'new', 'clinician');
  u_t := pg_temp.mkuser(v_org, 'testflag', 'clinician');
  u_old := pg_temp.mkuser(v_org, 'old', 'clinician');
  u_dates := pg_temp.mkuser(v_org, 'dates', 'clinician');
  -- park every other clinician so the work lists contain only our fixtures
  update public.clinical_staff set active = false where profile_id is null or profile_id <> all (array[u_gf, u_new, u_t, u_old, u_dates]);
  s_gf := pg_temp.mkstaff(v_org, u_gf, 'gf', v_admin, false, now() + interval '200 days');
  s_new := pg_temp.mkstaff(v_org, u_new, 'new', v_admin, false, now() + interval '200 days');
  s_t := pg_temp.mkstaff(v_org, u_t, 'testflag', v_admin, true, now() + interval '200 days');
  s_old := pg_temp.mkstaff(v_org, u_old, 'old', v_admin, false, now() + interval '200 days');
  s_dates := pg_temp.mkstaff(v_org, u_dates, 'dates', v_admin, false, null);
  -- the sweep processes only non-test clinicians; the grandfathered one is set by hand (the trigger below proves it cannot be set otherwise)
  perform pg_temp.rec('the grandfathering flag cannot be switched on by an update', '23514',
    pg_temp.try(format('update public.clinical_staff set psv_grandfathered = true where id = %L', s_gf)));
  perform pg_temp.rec('...nor on a new row', '23514',
    pg_temp.try(format('insert into public.clinical_staff (organisation_id, profile_id, full_name, active, psv_grandfathered) values (%L, %L, %L, false, true)', v_org, v_pat, 'x')));
  alter table public.clinical_staff disable trigger clinical_staff_guard_psv_grandfathered;
  update public.clinical_staff set psv_grandfathered = true where id = s_gf;
  alter table public.clinical_staff enable trigger clinical_staff_guard_psv_grandfathered;

  -- 1. Grants ---------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('anon cannot read verification records', 'false', has_table_privilege('anon', 'public.clinician_primary_source_verifications', 'SELECT')::text);
  perform pg_temp.rec('signed-in users cannot write verification records', 'false',
    (has_table_privilege('authenticated', 'public.clinician_primary_source_verifications', 'INSERT') or has_table_privilege('authenticated', 'public.clinician_primary_source_verifications', 'UPDATE') or has_table_privilege('authenticated', 'public.clinician_primary_source_verifications', 'DELETE'))::text);
  perform pg_temp.rec('signed-in users cannot write work items', 'false',
    (has_table_privilege('authenticated', 'public.credential_work_items', 'INSERT') or has_table_privilege('authenticated', 'public.credential_work_items', 'UPDATE'))::text);
  perform pg_temp.rec('PUBLIC cannot record a verification', 'false', has_function_privilege('anon', 'public.record_primary_source_verification(uuid, text, text, date, uuid, text)', 'EXECUTE')::text);
  perform pg_temp.rec('PUBLIC cannot read the work list', 'false', has_function_privilege('anon', 'public.credentialing_work_list()', 'EXECUTE')::text);
  perform pg_temp.rec('PUBLIC cannot use the patient lookup', 'false', has_function_privilege('anon', 'public.clinician_licence_verified_on(uuid[])', 'EXECUTE')::text);
  perform pg_temp.rec('PUBLIC cannot record dates', 'false', has_function_privilege('anon', 'public.record_clinician_credential_dates(uuid, timestamptz, timestamptz, text)', 'EXECUTE')::text);
  perform pg_temp.rec('the gate helper is not callable by signed-in users', 'false', has_function_privilege('authenticated', 'private.psv_satisfied(uuid, timestamptz)', 'EXECUTE')::text);
  perform pg_temp.rec('the sweep is not callable by signed-in users', 'false', has_function_privilege('authenticated', 'private.credential_recheck_sweep()', 'EXECUTE')::text);

  -- 2. The gate ---------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('Q14: a real clinician with no evidence is NOT eligible', 'false', private.clinician_is_eligible(u_new)::text);
  perform pg_temp.rec('a test clinician is exempt (fixtures keep working)', 'true', private.clinician_is_eligible(u_t)::text);
  perform pg_temp.rec('a grandfathered clinician stays eligible until evidence is recorded', 'true', private.clinician_is_eligible(u_gf)::text);
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', to_jsonb((pg_temp.today() + 10)::text)) where is_active;
  perform pg_temp.rec('...still eligible before the end date', 'true', private.clinician_is_eligible(u_gf)::text);
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', to_jsonb((pg_temp.today() - 1)::text)) where is_active;
  perform pg_temp.rec('...not eligible after the end date passes', 'false', private.clinician_is_eligible(u_gf)::text);
  update public.credentialing_config set rules = jsonb_set(rules, '{grandfather_ends_on}', 'null'::jsonb) where is_active;
  perform pg_temp.rec('...and eligible again with no end date', 'true', private.clinician_is_eligible(u_gf)::text);
  perform pg_temp.rec('the clinician''s own status shows the blocker', 'true',
    (pg_temp.q_as(u_new, 'select public.my_credential_status() -> ''blockers'' ? ''primary_source_missing''') )::text);

  -- 3. Recording evidence -----------------------------------------------------------------------------------------------
  d_new := pg_temp.mkdoc(v_org, s_new, u_new, 'mdcn_confirmation');
  d_other := pg_temp.mkdoc(v_org, s_gf, u_gf, 'mdcn_confirmation');
  d_gf := d_other;
  perform pg_temp.rec('a clinician cannot record their own verification', '42501',
    pg_temp.try_as(u_new, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('another clinician cannot record one', '42501',
    pg_temp.try_as(u_gf, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('a patient cannot record one', '42501',
    pg_temp.try_as(v_pat, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('an unknown route is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''phone_call'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('a missing reference is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''  '', %L, %L)', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('a future date is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today() + 1, d_new)));
  perform pg_temp.rec('a date older than a year is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today() - 400, d_new)));
  perform pg_temp.rec('someone else''s evidence file is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), d_other)));
  perform pg_temp.rec('no evidence file is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(), gen_random_uuid())));
  perform pg_temp.rec('a non-evidence document kind is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L)', s_new, pg_temp.today(),
      pg_temp.mkdoc(v_org, s_new, u_new, 'cv'))));
  perform pg_temp.rec('still not eligible after every refusal', 'false', private.clinician_is_eligible(u_new)::text);
  perform pg_temp.rec('a reviewer records the verification', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-NEW-0001'', %L, %L, ''checked on the DataFlow report'')', s_new, pg_temp.today(), d_new)));
  perform pg_temp.rec('Q14: the new clinician is now eligible', 'true', private.clinician_is_eligible(u_new)::text);
  perform pg_temp.rec('the record keeps route, date, verifier and evidence', 'mdcn_dataflow/initial/true/true',
    (select route || '/' || kind || '/' || (verified_by = v_admin)::text || '/' || (evidence_document_id = d_new)::text from public.clinician_primary_source_verifications where clinical_staff_id = s_new));
  perform pg_temp.rec('a verification record cannot be edited, even by the owner role', '23514',
    pg_temp.try(format('update public.clinician_primary_source_verifications set notes = ''x'' where clinical_staff_id = %L', s_new)));
  perform pg_temp.rec('the evidence document was stamped verified', 'true', (select (verified_by = v_admin and verified_at is not null)::text from public.clinician_documents where id = d_new));
  perform pg_temp.rec('an audit row names the reviewer', 'true',
    (select (count(*) = 1)::text from public.audit_log where action = 'clinician_primary_source.initial' and entity_id = s_new and actor_id = v_admin));
  perform pg_temp.rec('the same reference cannot vouch for a second person', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''df-new-0001'', %L, %L)', s_gf, pg_temp.today(), d_other)));
  perform pg_temp.rec('the clinician can read their own record, a patient cannot read any', '1/0',
    pg_temp.q_as(u_new, 'select count(*)::text from public.clinician_primary_source_verifications') || '/' ||
    pg_temp.q_as(v_pat, 'select count(*)::text from public.clinician_primary_source_verifications'));
  -- grandfathered: record the same evidence
  perform pg_temp.rec('a grandfathered clinician records the same evidence', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_written_confirmation'', ''MDCN-LTR-77'', %L, %L)', s_gf, pg_temp.today() - 5, d_gf)));
  perform pg_temp.rec('...which ends the grandfathering', 'false', (select psv_grandfathered::text from public.clinical_staff where id = s_gf));
  perform pg_temp.rec('...and they stay eligible', 'true', private.clinician_is_eligible(u_gf)::text);

  -- 4. The six-month spot re-check ------------------------------------------------------------------------------------
  -- s_old verified 200 days ago (due about 17 days ago, past the 14 day overdue line); s_new and s_gf were verified recently
  d_old := pg_temp.mkdoc(v_org, s_old, u_old, 'mdcn_confirmation');
  perform pg_temp.rec('an older verification is accepted', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_dataflow'', ''DF-OLD-0001'', %L, %L)', s_old, pg_temp.today() - 200, d_old)));
  v_sweep := private.credential_recheck_sweep();
  perform pg_temp.rec('the sweep opens exactly one re-check, for the clinician whose six months are up', '1',
    (select count(*)::text from public.credential_work_items where kind = 'credential_recheck' and clinical_staff_id = s_old and state = 'open'));
  perform pg_temp.rec('...none for the ones verified recently', '0',
    (select count(*)::text from public.credential_work_items where kind = 'credential_recheck' and clinical_staff_id in (s_new, s_gf)));
  perform pg_temp.rec('...and the due date is six months after the verification', 'true',
    (select (due_on = ((pg_temp.today() - 200) + interval '6 months')::date)::text from public.credential_work_items where clinical_staff_id = s_old and kind = 'credential_recheck'));
  perform pg_temp.rec('no evidence at all opens a "verification missing" item (the clinician with no dates, no record)', '1',
    (select count(*)::text from public.credential_work_items where kind = 'primary_source_missing' and clinical_staff_id = s_dates and state = 'open'));
  perform pg_temp.rec('reviewers were told once, through the credential notice with a catalogue key', 'true',
    (select (count(*) >= 1 and bool_and(payload ->> 'i18n_key' in ('credential.recheck_due', 'credential.recheck_overdue', 'credential.primary_source_missing')
        and template = 'credential_notice' and content_class = 'non_clinical'))::text
       from public.notifications where payload ->> 'clinical_staff_id' = s_old::text and payload ->> 'i18n_key' like 'credential.recheck%'));
  perform pg_temp.rec('overdue was flagged once', '1',
    (select count(*)::text from public.notifications where payload ->> 'clinical_staff_id' = s_old::text and payload ->> 'i18n_key' = 'credential.recheck_overdue' and recipient_id = v_admin));
  v_n := (select count(*) from public.notifications where payload ->> 'clinical_staff_id' = s_old::text and payload ->> 'i18n_key' like 'credential.recheck%');
  perform private.credential_recheck_sweep();
  perform pg_temp.rec('running the sweep again opens and tells nothing new', v_n::text,
    (select count(*)::text from public.notifications where payload ->> 'clinical_staff_id' = s_old::text and payload ->> 'i18n_key' like 'credential.recheck%'));
  perform pg_temp.rec('Q15: an overdue re-check NEVER suspends: status, active flag and eligibility are unchanged', 'active/true/true',
    (select status::text || '/' || active::text || '/' || private.clinician_is_eligible(u_old)::text from public.clinical_staff where id = s_old));
  perform pg_temp.rec('the CMO hub reader sees it as overdue', 'true',
    (pg_temp.q_as(v_admin, 'select (public.credentialing_work_list() -> ''rechecks'' -> 0 ->> ''overdue'')::boolean::text')));
  d_old2 := pg_temp.mkdoc(v_org, s_old, u_old, 'mdcn_portal_screenshot');
  perform pg_temp.rec('recording the re-check', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_register_check'', ''REG-OLD-0002'', %L, %L)', s_old, pg_temp.today(), d_old2)));
  perform pg_temp.rec('...closes the item and marks it a re-check', 'done/recheck',
    (select (select state from public.credential_work_items where clinical_staff_id = s_old and kind = 'credential_recheck') || '/' || (select kind from public.clinician_primary_source_verifications where reference = 'REG-OLD-0002')));
  perform pg_temp.rec('a re-check dated before the last verification is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_register_check'', ''REG-OLD-0003'', %L, %L)', s_old, pg_temp.today() - 100, d_old2)));

  -- 5. Work list and the date form --------------------------------------------------------------------------------------
  perform pg_temp.rec('a clinician cannot read the work list', 'ERR:42501', pg_temp.q_as(u_new, 'select public.credentialing_work_list()::text'));
  v_list := (pg_temp.q_as(v_admin, 'select public.credentialing_work_list()::text'))::jsonb;
  perform pg_temp.rec('the unverified list holds the clinician with no record', 'true', (v_list -> 'unverified' @> jsonb_build_array(jsonb_build_object('staff_id', s_dates)))::text);
  perform pg_temp.rec('...and not the verified ones', '0', position(s_new::text in (v_list -> 'unverified')::text)::text);
  perform pg_temp.rec('the missing-dates list holds the clinician with no licence date', 'true',
    ((v_list -> 'missing_dates') @> jsonb_build_array(jsonb_build_object('staff_id', s_dates, 'licence_missing', true)))::text);
  perform pg_temp.rec('a clinician cannot record their own dates', '42501',
    pg_temp.try_as(u_dates, format('select public.record_clinician_credential_dates(%L, now() + interval ''100 days'', null, ''read from the licence card'')', s_dates)));
  perform pg_temp.rec('a patient cannot record dates', '42501',
    pg_temp.try_as(v_pat, format('select public.record_clinician_credential_dates(%L, now() + interval ''100 days'', null, ''read from the licence card'')', s_dates)));
  perform pg_temp.rec('a past date is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_clinician_credential_dates(%L, now() - interval ''1 day'', null, ''read from the licence card'')', s_dates)));
  perform pg_temp.rec('a date needs a note saying where it was read', '23514',
    pg_temp.try_as(v_admin, format('select public.record_clinician_credential_dates(%L, now() + interval ''100 days'', null, ''short'')', s_dates)));
  perform pg_temp.rec('a reviewer fills the missing licence date', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_clinician_credential_dates(%L, now() + interval ''100 days'', null, ''read from the licence card'')', s_dates)));
  perform pg_temp.rec('a date already on file is never overwritten here', '23514',
    pg_temp.try_as(v_admin, format('select public.record_clinician_credential_dates(%L, now() + interval ''300 days'', null, ''read from the licence card'')', s_dates)));
  perform pg_temp.rec('the date is audited with the note', '1',
    (select count(*)::text from public.audit_log where action = 'clinical_staff.dates_recorded' and entity_id = s_dates and actor_id = v_admin));
  perform pg_temp.rec('the clinician now leaves the missing-dates list', 'false',
    ((pg_temp.q_as(v_admin, 'select public.credentialing_work_list()::text'))::jsonb -> 'missing_dates' @> jsonb_build_array(jsonb_build_object('staff_id', s_dates)))::text);

  -- review fixes: a repeat reference at a re-check, a far-future date, coordinators, in-flight applications, the legacy slot route
  perform pg_temp.rec('a re-check may repeat the same reference (a register number does not change)', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_written_confirmation'', ''mdcn-ltr-77'', %L, %L)', s_gf, pg_temp.today(), pg_temp.mkdoc(v_org, s_gf, u_gf, 'mdcn_portal_screenshot'))));
  perform pg_temp.rec('...but not on the same day twice', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_written_confirmation'', ''MDCN-LTR-77'', %L, %L)', s_gf, pg_temp.today(), pg_temp.mkdoc(v_org, s_gf, u_gf, 'mdcn_portal_screenshot'))));
  perform pg_temp.rec('...and never another clinician''s reference', '23514',
    pg_temp.try_as(v_admin, format('select public.record_primary_source_verification(%L, ''mdcn_written_confirmation'', ''MDCN-LTR-77'', %L, %L)', s_dates, pg_temp.today(), pg_temp.mkdoc(v_org, s_dates, u_dates, 'mdcn_confirmation'))));
  perform pg_temp.rec('a date many years away is refused', '23514',
    pg_temp.try_as(v_admin, format('select public.record_clinician_credential_dates(%L, now() + interval ''5000 days'', null, ''read from the licence card'')', s_new)));
  u_coord := pg_temp.mkuser(v_org, 'coordinator', 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, is_test)
    values (v_org, u_coord, 'P5 coordinator', 'MDCN', 'P5-COORD-1', true, 'active', now(), v_admin, 'care_coordinator', 'employed', 1, false) returning id into s_coord;
  perform pg_temp.rec('a care coordinator needs no MDCN verification (no registration to verify)', 'true', private.psv_satisfied(s_coord)::text);
  perform private.credential_recheck_sweep();
  perform pg_temp.rec('...and is never put on the work list or the sweep', '0',
    (select count(*)::text from public.credential_work_items where clinical_staff_id = s_coord) || '' );
  perform pg_temp.rec('...nor in the unverified or missing-dates lists', '0',
    position(s_coord::text in (pg_temp.q_as(v_admin, 'select public.credentialing_work_list()::text')))::text);
  -- an application already past the checks when the rule arrived can still have its primary-source check recorded
  insert into public.clinician_applications (organisation_id, profile_id, state, employment_type, licence_expires_at, mdcn_folio, is_test)
    values (v_org, v_pat, 'started', 'employed', now() + interval '300 days', 'P5-INFLIGHT-1', false) returning id into v_app;
  perform set_config('tarragon.credential_transition', 'on', true);
  update public.clinician_applications set state = 'training' where id = v_app;
  perform set_config('tarragon.credential_transition', 'off', true);
  insert into public.clinician_checks (organisation_id, application_id, kind, result, is_test) values (v_org, v_app, 'primary_source', 'pending', false);
  insert into public.clinician_documents (organisation_id, owner_profile_id, application_id, kind, storage_path, mime_type, size_bytes, sha256, is_test)
    values (v_org, v_pat, v_app, 'mdcn_confirmation', v_org || '/' || v_pat || '/inflight.pdf', 'application/pdf', 1000, repeat('d', 64), true);
  perform pg_temp.rec('an in-flight application can still record the primary-source check', 'ok',
    pg_temp.try_as(v_admin, format('select public.record_credential_check(%L, ''primary_source'', ''passed'', null, %L::jsonb)', v_app,
      jsonb_build_object('route', 'mdcn_dataflow', 'reference', 'DF-INFLIGHT-1', 'verified_on', pg_temp.today())::text)));
  perform pg_temp.rec('...and it stays in training (only the first pass through the checks moves state)', 'training',
    (select state::text from public.clinician_applications where id = v_app));
  perform pg_temp.rec('another check still cannot be recorded after the checks stage', '23514',
    pg_temp.try_as(v_admin, format('select public.record_credential_check(%L, ''identity'', ''passed'')', v_app)));

  -- the older patient-facing route: no availability can be published before verification
  perform pg_temp.rec('a clinician with no record cannot publish video-visit availability', '23514',
    pg_temp.try(format('insert into public.consult_availability_slots (organisation_id, clinician_profile_id, slot_start, slot_end) values (%L, %L, now() + interval ''1 day'', now() + interval ''1 day 30 minutes'')', v_org, u_dates)));
  perform pg_temp.rec('...one with a record can', 'ok',
    pg_temp.try(format('insert into public.consult_availability_slots (organisation_id, clinician_profile_id, slot_start, slot_end) values (%L, %L, now() + interval ''1 day'', now() + interval ''1 day 30 minutes'')', v_org, u_gf)));
  -- 6. The patient lookup (Q17) ------------------------------------------------------------------------------------------
  perform pg_temp.rec('a patient sees the LATEST verification date for a verified clinician', (pg_temp.today())::text,
    pg_temp.q_as(v_pat, format('select verified_on::text from public.clinician_licence_verified_on(array[%L::uuid])', s_gf)));
  perform pg_temp.rec('...also when asked by profile id', (pg_temp.today())::text,
    pg_temp.q_as(v_pat, format('select verified_on::text from public.clinician_licence_verified_on(array[%L::uuid])', u_old)));
  perform pg_temp.rec('Q17: no record, no badge (the clinician with no verification)', '0',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.clinician_licence_verified_on(array[%L::uuid])', s_dates)));
  -- licence on file is out of date: no badge
  update public.clinical_staff set license_expires_at = now() - interval '2 days' where id = s_new;
  perform pg_temp.rec('an expired licence on file removes the badge', '0',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.clinician_licence_verified_on(array[%L::uuid])', s_new)));
  update public.clinical_staff set license_expires_at = now() + interval '200 days', status = 'suspended', active = false where id = s_new;
  perform pg_temp.rec('a suspended clinician has no badge', '0',
    pg_temp.q_as(v_pat, format('select count(*)::text from public.clinician_licence_verified_on(array[%L::uuid])', s_new)));
  select string_agg(x.n, ',' order by x.ord) into v_cols from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as x(n, m, ord)
    where p.oid = 'public.clinician_licence_verified_on(uuid[])'::regprocedure and x.m = 't';
  perform pg_temp.rec('the lookup result columns are exactly staff_id, profile_id, verified_on', 'staff_id,profile_id,verified_on', v_cols);
  perform pg_temp.rec('the consultation lookup answers nothing for someone who is not that consultation''s patient', '',
    coalesce(pg_temp.q_as(v_pat, format('select public.consultation_clinician_licence_verified_on(%L)::text', gen_random_uuid())), ''));
  select id into v_org2 from public.organisations where id <> v_org limit 1;
  if v_org2 is not null then
    v_pat_other := pg_temp.mkuser(v_org2, 'patient-other-org', 'patient');
    perform pg_temp.rec('a patient of another organisation sees no badge', '0',
      pg_temp.q_as(v_pat_other, format('select count(*)::text from public.clinician_licence_verified_on(array[%L::uuid])', s_gf)));
  end if;
end $$;

-- 7. SABOTAGE: the gate forced open; "a real clinician with no evidence is NOT eligible" must flip -------------------------
create or replace function private.psv_satisfied(p_staff uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;
do $$
declare v_org uuid; v_admin uuid; v_u uuid; v_s uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin-sab', 'admin');
  v_u := pg_temp.mkuser(v_org, 'sab', 'clinician');
  v_s := pg_temp.mkstaff(v_org, v_u, 'sab', v_admin, false, now() + interval '200 days');
  insert into results values ('sabotaged', 'Q14: a real clinician with no evidence is NOT eligible', 'false', private.clinician_is_eligible(v_u)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'P5 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: forcing the gate open did not change the eligibility check'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged row is asserted to FAIL inside the DO block above. It is deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;

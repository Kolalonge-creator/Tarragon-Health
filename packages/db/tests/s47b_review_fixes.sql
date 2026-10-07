-- S47b proof: the review fixes (migration *_s47b_review_fixes.sql, and the edits to the S47 emergency card migration). One rolled-back transaction.
-- Proves:
--   1. account.phone_verified: the key holds no phone digits (fresh event, and a legacy key is rewritten, also by the anonymiser).
--   2. The anonymiser revokes the account's share links and emergency card; the anon doors answer gone / null afterwards (control: both worked before).
--   3. INV-04: every spelling of an HIV, hepatitis B or C code is sensitive (hiv_rna, hbv_dna, anti_hbc, hbsag variants, hcv_rna, hiv_p24), anti_hbs and
--      hba1c are not; an AI explanation row for a variant is refused; a legacy reading of a variant never rides a share link or the FHIR export (control: a
--      normal legacy reading does).
--   4. FHIR export for a guardian of a 15-year-old: mental health and reproductive items are withheld without the waiver, shown with it (control), shown to the
--      young person themselves and to the supporter of an adult; excluded_domains says what was actually withheld.
--   5. Emergency card medicines honour show_mental_health and show_reproductive (an antidepressant and a contraceptive are hidden by default, shown when the
--      switch is on).
--   6. SABOTAGE: the anonymiser's revoke removed, the old phone key restored, the legacy-branch filter removed, the adolescent gate removed.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.sqlstate_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  return r;
end $f$;
create function pg_temp.state_as_service(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role service_role;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'female', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's46-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'S46 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => p_age, days => 30))::date, p_sex::public.sex, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone,
     date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid
language plpgsql as $f$
declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician', 'male', 40);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S46 ' || p_label, 'MDCN', 'S46-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;
create function pg_temp.go_real(p_uid uuid) returns void language sql as $$ update public.profiles set is_test = false where id = p_uid $$;
create function pg_temp.guards_on(p_keys text[]) returns void language plpgsql as
$f$ begin
  execute format($q$create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = ''
    as $b$select p_key = any (%L::text[])$b$$q$, p_keys);
end $f$;
create function pg_temp.mkpatient(p_label text, p_with_doc boolean default true) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(pg_temp.f('org'), p_label, 'patient', 'female', 45);
  if p_with_doc then
    insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id) values (pg_temp.f('org'), v, pg_temp.f('doc'), pg_temp.f('doc'));
  end if;
  return v;
end $f$;
create function pg_temp.sresult(p_pat uuid, p_code text, p_status text, p_age interval) returns void language sql as
$$ insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status, created_at)
   values (pg_temp.f('org'), p_pat, p_code, p_status::public.result_status, now() - p_age) $$;
create function pg_temp.scomp(p_pat uuid, p_code text, p_age interval) returns void language sql as
$$ insert into public.screening_completions (organisation_id, patient_id, screen_type_id, performed_date)
   values (pg_temp.f('org'), p_pat, (select id from public.screen_types where code = p_code), (now() - p_age)::date) $$;
create function pg_temp.excl(p_pat uuid, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'reason' from jsonb_array_elements(private.compute_screening_order_exclusions(p_pat, pg_temp.f('org'), array[p_code])) e limit 1), 'none') $$;
-- one released lab result, items as jsonb [{code,num|text,unit,low,high,flag,sens}]
create function pg_temp.mkresult(p_pat uuid, p_released_at timestamptz, p_items jsonb) returns uuid language plpgsql as
$f$ declare v uuid; i jsonb; v_sens boolean;
begin
  v_sens := exists (select 1 from jsonb_array_elements(p_items) x where coalesce((x ->> 'sens')::boolean, false));
  insert into public.lab_results (organisation_id, patient_id, panel_code, panel_version_id, source, submitted_by_kind, release_state, received_at, is_test)
  values (pg_temp.f('org'), p_pat, 'membership_annual', (select id from public.lab_panel_versions where panel_code = 'membership_annual' and is_active),
          'portal_entry', 'partner', case when v_sens then 'clinician_disclosure_required' else 'awaiting_review' end, p_released_at - interval '1 day', true)
  returning id into v;
  for i in select * from jsonb_array_elements(p_items) loop
    insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, ref_low, ref_high, flag, sensitive_positive, is_test)
    values (v, pg_temp.f('org'), p_pat, i ->> 'code', (i ->> 'num')::numeric, i ->> 'text', coalesce(i ->> 'unit', 'mg/dL'),
            (i ->> 'low')::numeric, (i ->> 'high')::numeric, i ->> 'flag', coalesce((i ->> 'sens')::boolean, false), true);
  end loop;
  update public.lab_results set release_state = 'released', released_at = p_released_at, reviewed_by = pg_temp.f('doc'),
         disclosure_attested = v_sens, disclosure_method = case when v_sens then 'in_person' end
   where id = v;
  return v;
end $f$;

-- Fixtures ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  -- S46c: the sign-off task is offered to an employed named doctor first; a contracted one pulls from the pool with an availability block
  update public.clinical_staff set employment_type = 'employed', indemnity_exempt = false, indemnity_exempt_by = null where profile_id = pg_temp.f('doc');
  perform pg_temp.setf('stranger', pg_temp.mkdoc(v_org, 'stranger', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('cc', pg_temp.mkdoc(v_org, 'cc', 'care_coordinator', v_admin));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, clinical_director_id, care_coordinator_id)
    select v_org, pg_temp.mkuser(v_org, 'ccpat', 'patient', 'female', 45), pg_temp.f('doc'), pg_temp.f('doc'), pg_temp.f('cc');
  perform pg_temp.setf('pat', pg_temp.mkpatient('pat'));
  perform pg_temp.setf('other', pg_temp.mkpatient('other'));
end $$;



create function pg_temp.expl(p_pat uuid, p_key text) returns text language sql as
$$ select pg_temp.try_sql(format($q$insert into public.patient_result_explanations (organisation_id, patient_id, kind, subject_key, language, status)
      values (%L, %L, 'lab_analyte', %L, 'en', 'failed')$q$, pg_temp.f('org'), p_pat, p_key)) $$;
create function pg_temp.jq(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r text; begin r := pg_temp.q_as(p_uid, p_sql); if r like 'ERR:%' then raise exception 'query failed: %', r; end if; return r::jsonb; end $f$;
create function pg_temp.mkcard(p_pat uuid) returns text language plpgsql as
$f$ declare v text := encode(extensions.gen_random_bytes(32), 'hex');
begin
  insert into public.emergency_cards (patient_id, organisation_id, token, expires_at) values (p_pat, pg_temp.f('org'), v, now() + interval '30 days');
  return v;
end $f$;
create function pg_temp.mkmed(p_pat uuid, p_name text) returns void language sql as
$$ insert into public.medications (organisation_id, patient_id, drug_name, dose, frequency, is_active, source) values (pg_temp.f('org'), p_pat, p_name, '10 mg', 'daily', true, 'patient') $$;
create function pg_temp.share_codes(p_pat uuid) returns text language plpgsql as
$f$ declare v_j jsonb; v_tok text; v_open jsonb; v_raw text;
begin
  v_raw := pg_temp.q_as(p_pat, $q$select public.create_record_share(array['lab_results'])::text$q$);
  if v_raw like 'ERR:%' then raise exception 'share: %', v_raw; end if;
  v_j := v_raw::jsonb;
  v_tok := v_j ->> 'token';
  v_open := public.record_share_open(v_tok, null, true);
  return coalesce((select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(coalesce(v_open -> 'record' -> 'lab_results', '[]'::jsonb)) x), 'none');
end $f$;
create function pg_temp.fhir_codes(p_pat uuid) returns text language plpgsql as
$f$ declare v_j jsonb; v_raw text;
begin
  v_raw := pg_temp.q_as(p_pat, format($q$select public.fhir_export_snapshot(%L, array['lab_results'])::text$q$, p_pat));
  if v_raw like 'ERR:%' then raise exception 'fhir: %', v_raw; end if;
  v_j := v_raw::jsonb;
  return coalesce((select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(coalesce(v_j -> 'lab_results', '[]'::jsonb)) x), 'none');
end $f$;
create function pg_temp.names(j jsonb, p_section text, p_col text) returns text language sql as
$$ select coalesce((select string_agg(x ->> p_col, ',' order by x ->> p_col) from jsonb_array_elements(coalesce(j -> p_section, '[]'::jsonb)) x), 'none') $$;

-- 1. Phone key -----------------------------------------------------------------------------------------------------------------------
do $$
declare p uuid := pg_temp.mkpatient('phone'); v_phone text; v_key text; q uuid := pg_temp.mkpatient('phone2'); n integer;
begin
  select regexp_replace(phone, '\D', '', 'g') into v_phone from public.profiles where id = p;
  update auth.users set phone = (select phone from public.profiles where id = p), phone_confirmed_at = now() where id = p;
  select idempotency_key into v_key from public.domain_events where event_type = 'account.phone_verified' and patient_id = p;
  perform pg_temp.ck('a fresh phone-verified event is emitted', 'true', (v_key is not null)::text);
  perform pg_temp.ck('...and its key carries no phone digits', 'false', coalesce((v_key like '%' || v_phone || '%')::text, 'null'));
  perform pg_temp.ck('...it is keyed on when the phone was confirmed instead', 'true', coalesce((v_key ~ ':t[0-9]{8}T[0-9]+$')::text, 'null'));
  -- a legacy key (the old format) is rewritten, the event itself kept
  perform private.emit_domain_event('account.phone_verified', pg_temp.f('org'), '{}'::jsonb, 'account.phone_verified:' || q::text || ':2348012345678', q, 'profile', q);
  select private.scrub_phone_event_keys(null) into n;
  perform pg_temp.ck('a legacy key with the number in it is rewritten', '1', n::text);
  perform pg_temp.ck('...the event is still there and the number is gone from its key', '1,false',
    (select count(*)::text || ',' || bool_or(idempotency_key like '%2348012345678%')::text from public.domain_events where event_type = 'account.phone_verified' and patient_id = q));
  perform pg_temp.ck('scrubbing again changes nothing', '0', private.scrub_phone_event_keys(null)::text);
  -- the anonymiser scrubs too
  perform private.emit_domain_event('account.phone_verified', pg_temp.f('org'), '{}'::jsonb, 'account.phone_verified:' || p::text || ':2348099999999', p, 'profile', p);
  perform private.anonymise_patient_account(p);
  perform pg_temp.ck('after anonymisation no key of that patient holds the number', 'false',
    (select coalesce(bool_or(idempotency_key like '%2348099999999%'), false)::text from public.domain_events where event_type = 'account.phone_verified' and patient_id = p));
end $$;

-- 2. Anonymiser closes the public doors ------------------------------------------------------------------------------------------------
do $$
declare p uuid := pg_temp.mkpatient('anon'); v_j jsonb; v_tok text; v_card text; q uuid := pg_temp.mkpatient('anon_ctrl'); v_tokq text; v_cardq text;
begin
  v_j := pg_temp.q_as(p, $q$select public.create_record_share(array['vitals'])::text$q$)::jsonb;  v_tok := v_j ->> 'token';
  v_card := pg_temp.mkcard(p);
  v_j := pg_temp.q_as(q, $q$select public.create_record_share(array['vitals'])::text$q$)::jsonb; v_tokq := v_j ->> 'token';
  v_cardq := pg_temp.mkcard(q);
  perform pg_temp.ck('before: the share link opens and the emergency card is served', 'ready,true',
    (public.record_share_open(v_tok, null, false) ->> 'status') || ',' || (public.emergency_card_by_token(v_card) is not null)::text);
  perform private.anonymise_patient_account(p);
  perform pg_temp.ck('after: the share link answers gone', 'gone', public.record_share_open(v_tok, null, false) ->> 'status');
  perform pg_temp.ck('after: the share link row itself is inactive', 'false', (select bool_or(is_active)::text from public.record_shares where patient_id = p));
  perform pg_temp.ck('after: the legacy by-token door answers nothing', 'null', coalesce((public.record_share_by_token(v_tok))::text, 'null'));
  perform pg_temp.ck('after: the emergency card is not served', 'null', coalesce((public.emergency_card_by_token(v_card))::text, 'null'));
  perform pg_temp.ck('after: both rows are revoked, not deleted', 'false,false,true,true',
    (select (is_active)::text from public.record_shares where patient_id = p) || ',' || (select (is_active)::text from public.emergency_cards where patient_id = p) || ',' ||
    (select (revoked_at is not null)::text from public.record_shares where patient_id = p) || ',' || (select (revoked_at is not null)::text from public.emergency_cards where patient_id = p));
  perform pg_temp.ck('control: another patient''s link and card are untouched', 'ready,true',
    (public.record_share_open(v_tokq, null, false) ->> 'status') || ',' || (public.emergency_card_by_token(v_cardq) is not null)::text);
end $$;

-- 3. INV-04 ---------------------------------------------------------------------------------------------------------------------------
do $$
declare p uuid := pg_temp.mkpatient('inv04'); code text;
begin
  perform pg_temp.ck('every spelling of an HIV, hepatitis B or C code is sensitive', '14',
    (select count(*)::text from unnest(array['hiv', 'hiv_rna', 'hiv_p24', 'HIV_Ag_Ab', 'hbsag', 'HBs_Ag', 'hbv_dna', 'hbeag', 'anti_hbc', 'hepatitis_b_core', 'hcv_rna', 'anti_hcv', 'hep_c', 'hepatitis_c']) c
      where private.is_sensitive_result_code(c)));
  perform pg_temp.ck('anti_hbs (the immunity titre), hba1c, alt and creatinine are not sensitive codes', '0',
    (select count(*)::text from unnest(array['anti_hbs', 'hba1c', 'alt', 'creatinine', 'haemoglobin']) c where private.is_sensitive_result_code(c)));
  for code in select unnest(array['hiv_rna', 'hbv_dna', 'anti_hbc', 'hcv_rna']) loop
    perform pg_temp.ck('INV-04 trigger refuses an explanation for ' || code, '42501', pg_temp.expl(p, code));
  end loop;
  perform pg_temp.ck('control: a normal analyte can be explained', 'ok', pg_temp.expl(p, 'alt'));
  perform pg_temp.ck('the pattern list is data the CMO can read', 'true', (select (count(*) >= 6)::text from public.sensitive_result_code_patterns));
  -- legacy readings: a variant never rides a link or the export
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status) values
    (pg_temp.f('org'), p, 'hiv_rna', 40, 'copies/mL', now(), 'final'), (pg_temp.f('org'), p, 'hbv_dna', 3, 'IU/mL', now(), 'final'), (pg_temp.f('org'), p, 'alt', 24, 'U/L', now(), 'final');
  perform pg_temp.ck('share link: legacy readings of a blood-borne test are dropped, a normal one stays', 'alt', pg_temp.share_codes(p));
  perform pg_temp.ck('FHIR export: the same', 'alt', pg_temp.fhir_codes(p));
end $$;

-- 4. FHIR export and the adolescent gate ---------------------------------------------------------------------------------------------
do $$
declare child uuid; g uuid := pg_temp.mkpatient('guardian', false); adult uuid := pg_temp.mkpatient('adultpat', false); sup uuid := pg_temp.mkpatient('supporter', false);
        v_grant uuid; v_org uuid := pg_temp.f('org'); j jsonb;
begin
  child := pg_temp.mkuser(v_org, 'teen', 'patient', 'female', 15);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (child, g, 'manage', g) returning id into v_grant;
  alter table public.profile_access_categories disable trigger user;
  insert into public.profile_access_categories (profile_access_id, category) values (v_grant, 'medical_history'), (v_grant, 'medications');
  alter table public.profile_access_categories enable trigger user;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, source) values
    (v_org, child, 'Major depression', 'active', 'clinician'), (v_org, child, 'Hypertension', 'active', 'clinician'), (v_org, child, 'Pregnancy', 'active', 'clinician');
  perform pg_temp.mkmed(child, 'Sertraline'); perform pg_temp.mkmed(child, 'Levonorgestrel'); perform pg_temp.mkmed(child, 'Amlodipine');
  j := pg_temp.jq(g, format($q$select public.fhir_export_snapshot(%L, array['conditions','medications'])::text$q$, child));
  perform pg_temp.ck('guardian of a 15-year-old, no waiver: only the ordinary condition', 'Hypertension', pg_temp.names(j, 'conditions', 'condition_name'));
  perform pg_temp.ck('...and only the ordinary medicine', 'Amlodipine', pg_temp.names(j, 'medications', 'drug_name'));
  perform pg_temp.ck('...and excluded_domains says exactly what was withheld', 'mental_health,sexual_reproductive_health',
    (select string_agg(d, ',' order by d) from jsonb_array_elements_text(j -> 'excluded_domains') d));
  -- control: the mental health waiver
  insert into public.adolescent_confidentiality_waivers (organisation_id, patient_id, grantee_user_id, domain) values (v_org, child, g, 'mental_health');
  j := pg_temp.jq(g, format($q$select public.fhir_export_snapshot(%L, array['conditions','medications'])::text$q$, child));
  perform pg_temp.ck('control: with the mental health waiver the depression and the antidepressant appear, the reproductive ones still do not', 'Hypertension,Major depression|Amlodipine,Sertraline|sexual_reproductive_health',
    pg_temp.names(j, 'conditions', 'condition_name') || '|' || pg_temp.names(j, 'medications', 'drug_name') || '|' || (select string_agg(d, ',') from jsonb_array_elements_text(j -> 'excluded_domains') d));
  j := pg_temp.jq(child, format($q$select public.fhir_export_snapshot(%L, array['conditions','medications'])::text$q$, child));
  perform pg_temp.ck('control: the young person sees everything and excluded_domains is empty', '3,3,0',
    jsonb_array_length(j -> 'conditions')::text || ',' || jsonb_array_length(j -> 'medications')::text || ',' || jsonb_array_length(j -> 'excluded_domains')::text);
  -- an adult's supporter: not an adolescent, nothing to withhold
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (adult, sup, 'view', adult) returning id into v_grant;
  alter table public.profile_access_categories disable trigger user;
  insert into public.profile_access_categories (profile_access_id, category) values (v_grant, 'medical_history');
  alter table public.profile_access_categories enable trigger user;
  insert into public.patient_conditions (organisation_id, patient_id, condition_name, status, source) values (v_org, adult, 'Major depression', 'active', 'clinician');
  j := pg_temp.jq(sup, format($q$select public.fhir_export_snapshot(%L, array['conditions'])::text$q$, adult));
  perform pg_temp.ck('control: a supporter of an adult sees the condition (the gate is for adolescents)', 'Major depression,0', pg_temp.names(j, 'conditions', 'condition_name') || ',' || jsonb_array_length(j -> 'excluded_domains')::text);
  perform pg_temp.setf('teen', child); perform pg_temp.setf('teen_g', g);
end $$;

-- 5. Emergency card medicines --------------------------------------------------------------------------------------------------------
do $$
declare p uuid := pg_temp.mkpatient('card'); tok text; j jsonb;
begin
  tok := pg_temp.mkcard(p);
  perform pg_temp.mkmed(p, 'Sertraline'); perform pg_temp.mkmed(p, 'Levonorgestrel'); perform pg_temp.mkmed(p, 'Metformin');
  j := public.emergency_card_by_token(tok);
  perform pg_temp.ck('default card: an antidepressant and a contraceptive are hidden, metformin stays', 'Metformin', pg_temp.names(j, 'medications', 'drug_name'));
  perform pg_temp.ck('...and the card says those two are not shared', 'true,true', (j -> 'hidden_fields' ? 'mental_health')::text || ',' || (j -> 'hidden_fields' ? 'reproductive')::text);
  insert into public.emergency_card_fields (patient_id, organisation_id, show_mental_health) values (p, pg_temp.f('org'), true);
  j := public.emergency_card_by_token(tok);
  perform pg_temp.ck('control: with show_mental_health on the antidepressant appears, the contraceptive still does not', 'Metformin,Sertraline|true',
    pg_temp.names(j, 'medications', 'drug_name') || '|' || (j -> 'hidden_fields' ? 'reproductive')::text);
  update public.emergency_card_fields set show_reproductive = true where patient_id = p;
  perform pg_temp.ck('control: with both on all three appear', 'Levonorgestrel,Metformin,Sertraline', pg_temp.names(public.emergency_card_by_token(tok), 'medications', 'drug_name'));
  update public.emergency_card_fields set show_medications = false where patient_id = p;
  perform pg_temp.ck('medicines switched off: none, whatever the other switches say', 'none', pg_temp.names(public.emergency_card_by_token(tok), 'medications', 'drug_name'));
end $$;

-- 6. Sabotage ------------------------------------------------------------------------------------------------------------------------
-- A: the anonymiser without the revoke lines. The link must then still open.
do $$
declare p uuid := pg_temp.mkpatient('sabA'); v_j jsonb; v_tok text; v_def text;
begin
  v_j := pg_temp.q_as(p, $q$select public.create_record_share(array['vitals'])::text$q$)::jsonb; v_tok := v_j ->> 'token';
  v_def := pg_get_functiondef('private.anonymise_patient_account(uuid)'::regprocedure);
  v_def := replace(v_def, 'update public.record_shares set is_active = false', 'update public.record_shares set is_active = is_active');
  execute v_def;
  perform private.anonymise_patient_account(p);
  insert into results values ('sabotaged', 'after: the share link row itself is inactive', 'false', (select bool_or(is_active)::text from public.record_shares where patient_id = p));
end $$;
-- B: the old phone key. The number must then appear in the key.
do $$
declare p uuid := pg_temp.mkpatient('sabB'); v_phone text; v_key text;
begin
  create or replace function private.emit_phone_verified() returns trigger language plpgsql security definer set search_path = '' as $f$
    declare v_org uuid;
    begin
      select organisation_id into v_org from public.profiles where id = new.id and role = 'patient';
      perform private.emit_domain_event('account.phone_verified', v_org, '{}'::jsonb, 'account.phone_verified:' || new.id::text || ':' || regexp_replace(coalesce(new.phone, ''), '\D', '', 'g'), new.id, 'profile', new.id);
      return new;
    end $f$;
  select regexp_replace(phone, '\D', '', 'g') into v_phone from public.profiles where id = p;
  update auth.users set phone = (select phone from public.profiles where id = p), phone_confirmed_at = now() where id = p;
  select idempotency_key into v_key from public.domain_events where event_type = 'account.phone_verified' and patient_id = p;
  insert into results values ('sabotaged', '...and its key carries no phone digits', 'false', coalesce((v_key like '%' || v_phone || '%')::text, 'null'));
end $$;
-- C: the legacy-branch filter removed from the export. The blood-borne reading must then leak.
do $$
declare p uuid := pg_temp.mkpatient('sabC'); v_def text;
begin
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at, report_status) values (pg_temp.f('org'), p, 'hiv_rna', 40, 'copies/mL', now(), 'final'), (pg_temp.f('org'), p, 'alt', 24, 'U/L', now(), 'final');
  v_def := replace(pg_get_functiondef('public.fhir_export_snapshot(uuid,text[],text)'::regprocedure), 'and not private.report_excluded_code(lr.code)', '');
  execute v_def;
  insert into results values ('sabotaged', 'FHIR export: the same', 'alt', pg_temp.fhir_codes(p));
end $$;
-- D: the adolescent gate removed. The guardian must then see the depression.
do $$
declare v_def text; j jsonb;
begin
  v_def := replace(pg_get_functiondef('public.fhir_export_snapshot(uuid,text[],text)'::regprocedure), 'v_hide_mh := not private.guardian_may_view_confidential_domain(p_patient, v_uid, ' || chr(39) || 'mental_health' || chr(39) || ');', 'v_hide_mh := false;');
  execute v_def;
  delete from public.adolescent_confidentiality_waivers where patient_id = pg_temp.f('teen');
  j := pg_temp.jq(pg_temp.f('teen_g'), format($q$select public.fhir_export_snapshot(%L, array['conditions'])::text$q$, pg_temp.f('teen')));
  insert into results values ('sabotaged', 'guardian of a 15-year-old, no waiver: only the ordinary condition', 'Hypertension', pg_temp.names(j, 'conditions', 'condition_name'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S47b proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

-- Proof: who_cvd_2019_wssa v3 (migration *_who_cvd_2019_wssa_v3_verified_coefficients.sql). One rolled-back transaction.
-- Proves:
--   1. v3 exists, is UNSIGNED and INACTIVE, says coefficientsVerified and regionCheckedForNigeria, and every sex model is complete in the
--      two-endpoint shape; v3 keeps v2's bands, age range, reassessment rules and band actions; the instrument as a whole stays unsigned.
--   2. The completeness check (private.risk_sex_model_complete) accepts both shapes and refuses null, a half-filled two-endpoint model, and one
--      with no terms.
--   3. sign_risk_instrument now gets PAST the coefficient checks for v3: the CMO can sign it (inside this rolled-back transaction only), an
--      ordinary doctor cannot, and v1/v2 are still refused with coefficients_not_verified.
--   4. SABOTAGE: with the recalibration block stripped from one endpoint, the completeness check flips to false and signing is refused.
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_sex text default 'male', p_age integer default 45) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'whov3-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'WHOv3 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
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
  values (p_org, v, 'WHOv3 ' || p_label, 'MDCN', 'WHOv3-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
  values (p_org, s, 'result_review', p_admin, true);
  return v;
end $f$;

do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', 'male', 40);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('doc', pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('v1', (select id from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 1));
  perform pg_temp.setf('v2', (select id from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 2));
  perform pg_temp.setf('v3', (select id from public.risk_instrument_versions where code = 'who_cvd_2019_wssa' and version = 3));
end $$;

-- 1. v3 as shipped ------------------------------------------------------------------------------------------------------------
do $$
declare v2 jsonb; v3 jsonb;
begin
  select config into v2 from public.risk_instrument_versions where id = pg_temp.f('v2');
  select config into v3 from public.risk_instrument_versions where id = pg_temp.f('v3');
  perform pg_temp.ck('v3 exists', 'true', (pg_temp.f('v3') is not null)::text);
  perform pg_temp.ck('v3 is unsigned and inactive', 'true',
    (select (approved_by is null and approved_at is null and not is_active)::text from public.risk_instrument_versions where id = pg_temp.f('v3')));
  perform pg_temp.ck('the instrument as a whole is still unsigned', 'false', private.risk_instrument_signed('who_cvd_2019_wssa')::text);
  perform pg_temp.ck('v3 says the coefficients are verified', 'true', v3 ->> 'coefficientsVerified');
  perform pg_temp.ck('v3 says the region was checked for Nigeria', 'true', v3 ->> 'regionCheckedForNigeria');
  perform pg_temp.ck('every v3 sex model is complete', 'true',
    (private.risk_sex_model_complete(v3 #> '{models,lab,male}') and private.risk_sex_model_complete(v3 #> '{models,lab,female}')
     and private.risk_sex_model_complete(v3 #> '{models,non_lab,male}') and private.risk_sex_model_complete(v3 #> '{models,non_lab,female}'))::text);
  perform pg_temp.ck('every v3 sex model is the two-endpoint shape', 'two_endpoint_recalibrated,two_endpoint_recalibrated,two_endpoint_recalibrated,two_endpoint_recalibrated',
    (v3 #>> '{models,lab,male,shape}') || ',' || (v3 #>> '{models,lab,female,shape}') || ',' || (v3 #>> '{models,non_lab,male,shape}') || ',' || (v3 #>> '{models,non_lab,female,shape}'));
  perform pg_temp.ck('lab endpoints carry 9 terms, non-lab 7', '9,9,7,7',
    jsonb_array_length(v3 #> '{models,lab,male,mi,terms}')::text || ',' || jsonb_array_length(v3 #> '{models,lab,female,stroke,terms}')::text || ','
    || jsonb_array_length(v3 #> '{models,non_lab,male,mi,terms}')::text || ',' || jsonb_array_length(v3 #> '{models,non_lab,female,stroke,terms}')::text);
  perform pg_temp.ck('v3 keeps v2 bands, age range, reassessment and band actions', 'true',
    ((v3 -> 'bands') = (v2 -> 'bands') and (v3 -> 'ageRange') = (v2 -> 'ageRange') and (v3 -> 'reassess') = (v2 -> 'reassess') and (v3 -> 'bandActions') = (v2 -> 'bandActions'))::text);
  perform pg_temp.ck('v3 names its provenance note', 'docs/clinical/who-cvd-2019-wssa-coefficients.md', v3 #>> '{provenance,note}');
end $$;

-- 2. the completeness check -----------------------------------------------------------------------------------------------------
do $$
declare v3 jsonb; m jsonb;
begin
  select config into v3 from public.risk_instrument_versions where id = pg_temp.f('v3');
  m := v3 #> '{models,lab,male}';
  perform pg_temp.ck('null is not complete', 'false', private.risk_sex_model_complete('null'::jsonb)::text);
  perform pg_temp.ck('the older single shape is complete', 'true',
    private.risk_sex_model_complete('{"baselineSurvival": 0.95, "terms": [{"coef": 0.05, "factors": [{"var": "age", "center": 50}]}]}'::jsonb)::text);
  perform pg_temp.ck('the single shape with no terms is not complete', 'false',
    private.risk_sex_model_complete('{"baselineSurvival": 0.95, "terms": []}'::jsonb)::text);
  perform pg_temp.ck('a two-endpoint model missing its stroke endpoint is not complete', 'false', private.risk_sex_model_complete(m - 'stroke')::text);
  perform pg_temp.ck('a two-endpoint model whose endpoint lost its recalibration is not complete', 'false',
    private.risk_sex_model_complete(jsonb_set(m, '{mi}', (m -> 'mi') - 'recalibration'))::text);
  perform pg_temp.ck('a two-endpoint model whose slope is not a number is not complete', 'false',
    private.risk_sex_model_complete(jsonb_set(m, '{stroke,recalibration,slope}', '"0.6"'::jsonb))::text);
end $$;

-- 3. signing: v3 passes the coefficient checks, v1/v2 do not, only the CMO -------------------------------------------------------
do $$
declare r text;
begin
  perform pg_temp.ck('v1 is still refused: coefficients not verified', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_risk_instrument(%L)::text', pg_temp.f('v1'))) like 'ERR:coefficients_not_verified%')::text);
  perform pg_temp.ck('v2 is still refused: coefficients not verified', 'true',
    (pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_risk_instrument(%L)::text', pg_temp.f('v2'))) like 'ERR:coefficients_not_verified%')::text);
  perform pg_temp.ck('an ordinary doctor cannot sign v3', 'true',
    (pg_temp.q_as(pg_temp.f('doc'), format('select public.sign_risk_instrument(%L)::text', pg_temp.f('v3'))) like 'ERR:not authorised%')::text);
  perform pg_temp.ck('v3 is still unsigned after the refused attempts', 'false', private.risk_instrument_signed('who_cvd_2019_wssa')::text);
  -- the CMO can sign v3 (this transaction is rolled back; nothing is signed for real)
  r := pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_risk_instrument(%L)::text', pg_temp.f('v3')));
  perform pg_temp.ck('the CMO can sign v3', pg_temp.f('v3')::text, r);
  perform pg_temp.ck('...and the instrument is then signed and active on v3', 'true',
    (select (is_active and approved_by is not null)::text from public.risk_instrument_versions where id = pg_temp.f('v3')) );
  perform pg_temp.ck('...which is audited', '1', (select count(*)::text from public.audit_log where action = 'risk_instrument.signed' and entity_id = pg_temp.f('v3')));
end $$;

-- 4. SABOTAGE -----------------------------------------------------------------------------------------------------------------------
do $$
declare v3 jsonb; r text;
begin
  -- undo the test signature first so the sabotage runs against an unsigned v3, as in production
  update public.risk_instrument_versions set approved_by = null, approved_at = null, is_active = false where id = pg_temp.f('v3');
  select config into v3 from public.risk_instrument_versions where id = pg_temp.f('v3');
  update public.risk_instrument_versions
     set config = jsonb_set(v3, '{models,non_lab,female,stroke}', (v3 #> '{models,non_lab,female,stroke}') - 'recalibration')
   where id = pg_temp.f('v3');
  perform pg_temp.ck('SABOTAGE: with one recalibration stripped the model is no longer complete', 'false',
    (select private.risk_sex_model_complete(config #> '{models,non_lab,female}')::text from public.risk_instrument_versions where id = pg_temp.f('v3')));
  r := pg_temp.q_as(pg_temp.f('cmo'), format('select public.sign_risk_instrument(%L)::text', pg_temp.f('v3')));
  perform pg_temp.ck('SABOTAGE: signing the stripped v3 is refused as coefficients_missing', 'true', (r like 'ERR:coefficients_missing%')::text);
  perform pg_temp.ck('SABOTAGE: the stripped v3 stays unsigned', 'false', private.risk_instrument_signed('who_cvd_2019_wssa')::text);
end $$;

-- Report ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_fail integer; v_total integer; rec record;
begin
  select count(*), count(*) filter (where expected is distinct from actual) into v_total, v_fail from results;
  for rec in select * from results order by check_name loop
    raise notice '% | % | expected % | actual %', case when rec.expected is distinct from rec.actual then 'FAIL' else 'ok  ' end, rec.check_name, rec.expected, rec.actual;
  end loop;
  if v_fail > 0 then raise exception '% of % checks failed', v_fail, v_total; end if;
  raise notice 'who_cvd_2019_wssa v3: all % checks passed', v_total;
end $$;

rollback;

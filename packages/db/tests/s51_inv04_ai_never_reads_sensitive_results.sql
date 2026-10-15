-- S51 proof: INV-04, the AI read path never returns a positive HIV / HBsAg / HCV result (migration *_s51_inv04_ai_never_reads_sensitive_results.sql).
-- One rolled-back transaction. Sections:
--   1. Grants: anon has nothing on the views, tokens table or function.
--   2. lab_analyte_readings: the trigger flags a screening analyte that is not an explicit negative; ordinary analytes stay unflagged.
--   3. ai_readable_lab_readings (as the patient): positive HIV, reactive HBsAg and a blank hcv never appear; a NEGATIVE hcv and HbA1c still do.
--   4. ai_readable_lab_result_items: only RELEASED results, never sensitive_positive, never an unflagged non-negative screening code.
--   5. Another patient sees none of the first patient's rows through the views (security_invoker keeps RLS).
--   6. SABOTAGE: the views are replaced by unfiltered ones; the sensitive-row checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.q_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's51-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'S51 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

-- Fixtures (as the table owner) -------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_pat uuid; v_other uuid; v_rel uuid; v_held uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat');
  v_other := pg_temp.mkuser(v_org, 'other');
  perform pg_temp.setf('pat', v_pat);
  perform pg_temp.setf('other', v_other);

  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, value_text, unit) values
    (v_org, v_pat, 'hba1c', 6.1, null, '%'),
    (v_org, v_pat, 'hiv_screen', null, 'positive', ''),
    (v_org, v_pat, 'HBsAg', null, 'reactive', ''),
    (v_org, v_pat, 'hcv_ab', null, 'negative', ''),
    (v_org, v_pat, 'anti_hcv_numeric', 3.2, null, 'S/CO'),
    (v_org, v_pat, 'cd4_count', 410, null, 'cells/uL'),
    (v_org, v_pat, 'HBV DNA', 120, null, 'IU/mL'),
    (v_org, v_other, 'hba1c', 5.4, null, '%');
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, report_status) values (v_org, v_pat, 'potassium', 4.0, 'mmol/L', 'preliminary');

  -- results and items are written with triggers off: the S27 guard is not what is under test here
  set local session_replication_role = replica;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, release_reason, released_at, is_test)
    values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'released', 'RES-001', now(), true) returning id into v_rel;
  insert into public.lab_results (organisation_id, patient_id, source, submitted_by_kind, release_state, is_test)
    values (v_org, v_pat, 'pdf_upload', 'tarragon_team', 'awaiting_review', true) returning id into v_held;
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, value_text, unit, flag, sensitive_positive, is_test) values
    (v_rel, v_org, v_pat, 'creatinine', 0.9, null, 'mg/dL', 'normal', false, true),
    (v_rel, v_org, v_pat, 'hiv_screen', null, 'positive', '', 'positive', true, true),
    (v_rel, v_org, v_pat, 'hbsag', null, 'positive', '', 'positive', false, true),   -- flag missing: the code rule must still exclude it
    (v_rel, v_org, v_pat, 'hcv_ab', null, 'negative', '', 'negative', false, true),
    (v_held, v_org, v_pat, 'potassium', 4.2, null, 'mmol/L', 'normal', false, true);
  set local session_replication_role = origin;
end $$;

-- 1. Grants ------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'anon cannot read ai_readable_lab_readings', 'ERR:42501', pg_temp.q_anon('select count(*)::text from public.ai_readable_lab_readings'));
select pg_temp.ck('real', 'anon cannot read ai_readable_lab_result_items', 'ERR:42501', pg_temp.q_anon('select count(*)::text from public.ai_readable_lab_result_items'));
select pg_temp.ck('real', 'anon cannot execute the exclusion function', 'false', has_function_privilege('anon', 'private.is_ai_excluded_analyte(text, text)', 'EXECUTE')::text);
select pg_temp.ck('real', 'anon cannot read the token list', 'ERR:42501', pg_temp.q_anon('select count(*)::text from public.ai_excluded_analyte_tokens'));

-- 2. Trigger -----------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'positive HIV row is flagged sensitive', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'hiv_screen'));
select pg_temp.ck('real', 'reactive HBsAg row is flagged sensitive', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'HBsAg'));
select pg_temp.ck('real', 'numeric anti-HCV (not an explicit negative) is flagged sensitive', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'anti_hcv_numeric'));
select pg_temp.ck('real', 'a CD4 count is flagged sensitive (HIV marker)', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'cd4_count'));
select pg_temp.ck('real', 'hepatitis B DNA is flagged sensitive', 'true',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'HBV DNA'));
select pg_temp.ck('real', 'negative HCV is not flagged', 'false',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'hcv_ab'));
select pg_temp.ck('real', 'HbA1c is not flagged', 'false',
  (select sensitive_positive::text from public.lab_analyte_readings where patient_id = pg_temp.f('pat') and code = 'hba1c'));

-- 3. The AI view, as the patient --------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'AI view returns exactly HbA1c and the negative HCV', 'hba1c,hcv_ab',
  pg_temp.q_as(pg_temp.f('pat'), 'select string_agg(code, '','' order by code) from public.ai_readable_lab_readings'));
select pg_temp.ck('real', 'AI view never returns positive HIV', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_readings where code = 'hiv_screen'$q$));
select pg_temp.ck('real', 'AI view never returns reactive HBsAg', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_readings where lower(code) = 'hbsag'$q$));
select pg_temp.ck('real', 'a preliminary report never reaches the AI path', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_readings where code = 'potassium'$q$));
select pg_temp.ck('real', 'a negative result still reaches the AI path', '1',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_readings where code = 'hcv_ab'$q$));

-- 4. Result items ---------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'AI items view returns creatinine and the negative HCV of the released result only', 'creatinine,hcv_ab',
  pg_temp.q_as(pg_temp.f('pat'), 'select string_agg(analyte_code, '','' order by analyte_code) from public.ai_readable_lab_result_items'));
select pg_temp.ck('real', 'a held (unreleased) result item is not in the AI items view', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_result_items where analyte_code = 'potassium'$q$));

-- 5. Other patient ----------------------------------------------------------------------------------------------------------------
select pg_temp.ck('real', 'the other patient sees only their own row', 'hba1c',
  pg_temp.q_as(pg_temp.f('other'), 'select string_agg(code, '','') from public.ai_readable_lab_readings'));
select pg_temp.ck('real', 'the other patient sees no items', '0',
  pg_temp.q_as(pg_temp.f('other'), 'select count(*)::text from public.ai_readable_lab_result_items'));

-- 6. SABOTAGE: unfiltered views ---------------------------------------------------------------------------------------------
create or replace view public.ai_readable_lab_readings with (security_invoker = true) as
  select r.id, r.patient_id, r.organisation_id, r.code, r.value, r.value_text, r.unit, r.taken_at,
         r.reference_range_low, r.reference_range_high, r.abnormal_flag, r.report_status from public.lab_analyte_readings r;
select pg_temp.ck('sabotaged', 'AI view returns exactly HbA1c and the negative HCV', 'hba1c,hcv_ab',
  pg_temp.q_as(pg_temp.f('pat'), 'select string_agg(code, '','' order by code) from public.ai_readable_lab_readings'));
select pg_temp.ck('sabotaged', 'AI view never returns positive HIV', '0',
  pg_temp.q_as(pg_temp.f('pat'), $q$select count(*)::text from public.ai_readable_lab_readings where code = 'hiv_screen'$q$));

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S51 INV-04 proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

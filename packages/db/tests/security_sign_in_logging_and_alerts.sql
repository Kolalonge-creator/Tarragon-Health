-- Security audit 2026-11-05, H-7 (migration *_security_sign_in_logging_and_alerts.sql). One rolled-back transaction.
--
--   1. Shape: the four rules exist and are on; no session role can run their checks.
--   2. Sign-in trigger: a patient's sign-in now writes patient.logged_in, staff still write clinician.logged_in, and an
--      auth.users update that does not move last_sign_in_at writes nothing.
--   3. failed_sign_in_spike: 10 failures for one hashed account breach, 9 do not; the platform-wide total breaches at max_total.
--   4. staff_bulk_record_access: 30 different patients opened by one staff member breach, 29 do not; a test account is skipped
--      unless test rows are included; a patient reference never appears in the output.
--   5. privileged_change: a role change breaches, a name change does not.
--   6. patient_data_export: a directory export breaches.
--   7. The evaluator opens one alert for a spike.
--   8. SABOTAGE: the old trigger body (patients skipped) and an empty spike check; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
create temp table fx(label text primary key, id uuid) on commit drop;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'secalert-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'SecAlert ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.keys(p_code text, p_params jsonb, p_test boolean) returns text[] language plpgsql as
$f$ declare v text[]; begin
  execute format('select coalesce(array_agg(dedup_key), ''{}'') from private.%I($1, $2)', 'ops_check_' || p_code) into v using p_params, p_test;
  return v;
end $f$;
create function pg_temp.fail(p_hash text, p_n integer) returns void language sql as
$f$ insert into public.audit_log (action, entity_type, event, result)
    select 'auth.sign_in_failed', 'auth_identifier', jsonb_build_object('identifier_hash', p_hash, 'method', 'email_password'), 'failed'
      from generate_series(1, p_n) $f$;

do $$
declare
  v_org uuid; v_patient uuid; v_clin uuid; v_admin uuid; v_before integer; v_p jsonb; v_rule jsonb; v_out text;
  v_h10 text := repeat('a', 64); v_h9 text := repeat('b', 64); v_ids uuid[];
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  insert into fx values ('patient', v_patient), ('clinician', v_clin), ('admin', v_admin);

  -- 1. Shape ---------------------------------------------------------------------------------------------------------
  perform pg_temp.rec('the four security rules exist and are on', '4',
    (select count(*)::text from public.ops_alert_rules where enabled and code in ('failed_sign_in_spike', 'staff_bulk_record_access', 'privileged_change', 'patient_data_export')));
  perform pg_temp.rec('no session role can run a security check', '0',
    (select count(*)::text from unnest(array['failed_sign_in_spike', 'staff_bulk_record_access', 'privileged_change', 'patient_data_export']) c,
            unnest(array['anon', 'authenticated']) r
      where has_function_privilege(r, ('private.ops_check_' || c || '(jsonb,boolean)')::regprocedure, 'EXECUTE')));

  -- 2. Sign-in trigger -----------------------------------------------------------------------------------------------
  update auth.users set last_sign_in_at = now() where id = v_patient;
  perform pg_temp.rec('a patient sign-in writes patient.logged_in', '1',
    (select count(*)::text from public.audit_log where actor_id = v_patient and action = 'patient.logged_in'));
  update auth.users set last_sign_in_at = now() where id = v_clin;
  perform pg_temp.rec('a staff sign-in still writes clinician.logged_in', '1',
    (select count(*)::text from public.audit_log where actor_id = v_clin and action = 'clinician.logged_in'));
  select count(*) into v_before from public.audit_log where actor_id = v_patient;
  update auth.users set raw_user_meta_data = raw_user_meta_data where id = v_patient;
  perform pg_temp.rec('an update that does not move last_sign_in_at writes nothing', v_before::text,
    (select count(*)::text from public.audit_log where actor_id = v_patient));

  -- 3. failed_sign_in_spike --------------------------------------------------------------------------------------------
  select params into v_p from public.ops_alert_rules where code = 'failed_sign_in_spike';
  v_rule := v_p || '{"max_total": 1000000}';
  perform pg_temp.fail(v_h10, 10);
  perform pg_temp.fail(v_h9, 9);
  perform pg_temp.rec('10 failures for one account breach', 'true', ('account:' || left(v_h10, 16) = any (pg_temp.keys('failed_sign_in_spike', v_rule, false)))::text);
  perform pg_temp.rec('9 failures for one account do not', 'false', ('account:' || left(v_h9, 16) = any (pg_temp.keys('failed_sign_in_spike', v_rule, false)))::text);
  perform pg_temp.rec('the platform-wide total breaches at max_total', 'true', ('all' = any (pg_temp.keys('failed_sign_in_spike', v_p || '{"max_total": 19}', false)))::text);
  perform pg_temp.rec('old failures outside the window do not count', 'false',
    ('account:' || left(v_h10, 16) = any (pg_temp.keys('failed_sign_in_spike', v_rule || '{"window_minutes": 0}', false)))::text);

  -- 4. staff_bulk_record_access -----------------------------------------------------------------------------------------
  select params into v_p from public.ops_alert_rules where code = 'staff_bulk_record_access';
  select array_agg(gen_random_uuid()) into v_ids from generate_series(1, 30);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event, result)
    select v_org, v_clin, 'staff.chart_read', 'patient_chart', x, x, '{}', 'success' from unnest(v_ids[1:29]) x;
  perform pg_temp.rec('29 different patients do not breach', 'false', (v_clin::text = any (pg_temp.keys('staff_bulk_record_access', v_p, true)))::text);
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, subject_patient_id, event, result)
    values (v_org, v_clin, 'staff.chart_read', 'patient_chart', v_ids[30], v_ids[30], '{}', 'success'),
           (v_org, v_clin, 'staff.chart_read', 'patient_chart', v_ids[30], v_ids[30], '{}', 'success');
  perform pg_temp.rec('30 different patients breach (a repeat open is not counted twice)', 'true', (v_clin::text = any (pg_temp.keys('staff_bulk_record_access', v_p, true)))::text);
  perform pg_temp.rec('a test account is skipped unless test rows are included', 'false', (v_clin::text = any (pg_temp.keys('staff_bulk_record_access', v_p, false)))::text);
  select string_agg(dedup_key || detail::text, '') into v_out from private.ops_check_staff_bulk_record_access(v_p, true);
  perform pg_temp.rec('no patient reference in the output', 'false', (position(v_ids[1]::text in coalesce(v_out, '')) > 0)::text);

  -- 5. privileged_change --------------------------------------------------------------------------------------------------
  select params into v_p from public.ops_alert_rules where code = 'privileged_change';
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result) values
    (v_org, v_admin, 'profiles.updated', 'profiles', v_patient, '{"changed_columns": ["role"]}', 'success'),
    (v_org, v_admin, 'profiles.updated', 'profiles', v_clin, '{"changed_columns": ["full_name"]}', 'success');
  perform pg_temp.rec('a role change breaches', '1',
    (select count(*)::text from private.ops_check_privileged_change(v_p, true) where detail ->> 'change' = 'account_role' and (detail ->> 'changed_by')::uuid = v_admin));
  perform pg_temp.rec('a test account role change is skipped unless test rows are included', '0',
    (select count(*)::text from private.ops_check_privileged_change(v_p, false) where (detail ->> 'changed_by')::uuid = v_admin));

  -- 6. patient_data_export ---------------------------------------------------------------------------------------------------
  select params into v_p from public.ops_alert_rules where code = 'patient_data_export';
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result)
    values (v_org, v_admin, 'admin.patient_directory_exported', 'patient_directory', '{}', 'success');
  perform pg_temp.rec('a directory export breaches', '1',
    (select count(*)::text from private.ops_check_patient_data_export(v_p, true) where (detail ->> 'exported_by')::uuid = v_admin));

  -- 7. The evaluator ------------------------------------------------------------------------------------------------------------
  update public.ops_alert_rules set enabled = false, off_reason = 'proof isolation' where code <> 'failed_sign_in_spike';
  update public.ops_alert_rules set params = params || '{"max_total": 1000000}', last_evaluated_at = null where code = 'failed_sign_in_spike';
  perform private.ops_evaluate_alerts(false, true);
  perform pg_temp.rec('the evaluator opens one alert for the spiking account', '1',
    (select count(*)::text from public.ops_alerts where rule_code = 'failed_sign_in_spike' and dedup_key = 'account:' || left(v_h10, 16) and state = 'open'));
end $$;

-- 8. SABOTAGE -----------------------------------------------------------------------------------------------------------------------
do $$
declare v_patient uuid; v_p jsonb;
begin
  select id into v_patient from fx where label = 'patient';
  -- sabotage 1: the old trigger body, which skipped patients
  create or replace function private.log_clinician_login() returns trigger language plpgsql security definer set search_path to '' as $f$
  declare v_role public.user_role; v_org uuid;
  begin
    if old.last_sign_in_at is not distinct from new.last_sign_in_at then return new; end if;
    select role, organisation_id into v_role, v_org from public.profiles where id = new.id;
    if v_role is null or v_role = 'patient' then return new; end if;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event) values (v_org, new.id, 'clinician.logged_in', 'profile', new.id, '{}'::jsonb);
    return new;
  end $f$;
  update auth.users set last_sign_in_at = now() + interval '1 second' where id = v_patient;
  insert into results values ('sabotaged', 'a patient sign-in writes patient.logged_in', '2',
    (select count(*)::text from public.audit_log where actor_id = v_patient and action = 'patient.logged_in'));
  -- sabotage 2: a spike check that never returns anything
  create or replace function private.ops_check_failed_sign_in_spike(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
  language sql stable security definer set search_path = '' as $f$ select null::text, null::jsonb where false $f$;
  select params || '{"max_total": 1000000}' into v_p from public.ops_alert_rules where code = 'failed_sign_in_spike';
  insert into results values ('sabotaged', '10 failures for one account breach', 'true',
    (('account:' || left(repeat('a', 64), 16)) = any (pg_temp.keys('failed_sign_in_spike', v_p, false)))::text);
end $$;

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'security_sign_in_logging_and_alerts FAILED: %', v_bad; end if;
  if (select count(*) from results where phase = 'real') <> 17 then raise exception 'security_sign_in_logging_and_alerts: expected 17 checks'; end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

-- The runner fails on a trailing FAIL verdict, so a sabotage row that was caught reads CAUGHT (a missed one already raised above).
select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end end as result
from results order by phase, check_name;

rollback;

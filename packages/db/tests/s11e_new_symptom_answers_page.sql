-- S11e proof: the emergency-symptom answers weakness_or_numbness, difficulty_speaking and back_pain page like chest pain
-- (migration *_s11e_symptom_red_flag_pages_new_emergency_answers.sql).
--  1. At severity 6 each new type is a red flag and raises one open urgent_escalation alert for an entitled patient, and
--     enqueues the same number of notifications as the control (chest_pain), so it pages exactly as the existing types do.
--  2. At severity 5 a new type is not a red flag (the line is unchanged).
--  3. A patient without the doctor-escalation entitlement gets no clinician alert (the plan gate is unchanged).
--  4. SABOTAGE: with the three types removed from the handler again, a new type raises no red-flag alert, which proves
--     check 1 can fail.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

do $$
declare
  v_org uuid; v_doc uuid := gen_random_uuid(); v_adult uuid := gen_random_uuid(); v_free uuid := gen_random_uuid();
  v_product uuid; v_price bigint; v_t text; v_a0 integer; v_a1 integer; v_n0 integer; v_n1 integer; v_flag boolean;
  v_ctl_notifs integer; v_src text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_doc, 's11e-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_adult, 's11e-adult@example.invalid', 'x', now(), '{}', '{}'),
    (v_free, 's11e-free@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test) values
    (v_doc, v_org, 'clinician', 'S11e Clinician', (current_date - interval '40 years')::date, true),
    (v_adult, v_org, 'patient', 'S11e Adult', (current_date - interval '40 years')::date, true),
    (v_free, v_org, 'patient', 'S11e Free', (current_date - interval '40 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true;
  select id, price_kobo into v_product, v_price from public.service_products
   where 'vitals_red_flag_doctor_escalation' = any(features) order by code limit 1;
  insert into public.service_purchases (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
    values (v_org, v_adult, v_adult, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');
  if not private.patient_has_feature_access(v_adult, 'vitals_red_flag_doctor_escalation')
     or private.patient_has_feature_access(v_free, 'vitals_red_flag_doctor_escalation') then
    raise exception 'fixtures do not give the entitled/free split this proof needs';
  end if;

  -- Control: chest_pain at 6
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_adult;
  select count(*) into v_n0 from public.notifications;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
    values (v_org, v_adult, 'chest_pain', 6, 'control') returning is_red_flag into v_flag;
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_adult;
  select count(*) into v_n1 from public.notifications;
  v_ctl_notifs := v_n1 - v_n0;
  insert into results values ('real', 'control chest_pain is a red flag with one alert', 'true|1', v_flag::text || '|' || (v_a1 - v_a0));

  foreach v_t in array array['weakness_or_numbness', 'difficulty_speaking', 'back_pain'] loop
    select count(*) into v_a0 from public.clinician_alerts where patient_id = v_adult and level = 'urgent_escalation';
    select count(*) into v_n0 from public.notifications;
    execute format('insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values ($1, $2, %L::public.symptom_type, 6, $3) returning is_red_flag', v_t)
      into v_flag using v_org, v_adult, 'S11e answer';
    select count(*) into v_a1 from public.clinician_alerts where patient_id = v_adult and level = 'urgent_escalation';
    select count(*) into v_n1 from public.notifications;
    insert into results values ('real', v_t || ' at 6 is a red flag with one urgent alert', 'true|1', v_flag::text || '|' || (v_a1 - v_a0));
    insert into results values ('real', v_t || ' enqueues as many notifications as chest pain', v_ctl_notifs::text, (v_n1 - v_n0)::text);
    execute format('insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values ($1, $2, %L::public.symptom_type, 5, $3) returning is_red_flag', v_t)
      into v_flag using v_org, v_adult, 'S11e below the line';
    insert into results values ('real', v_t || ' at 5 is not a red flag', 'false', v_flag::text);
  end loop;

  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_free;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, v_free, 'weakness_or_numbness', 6, 'free');
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_free;
  insert into results values ('real', 'a patient without the entitlement gets no clinician alert', '0', (v_a1 - v_a0)::text);

  -- SABOTAGE: take the three types out of the handler again.
  select pg_get_functiondef('private.handle_symptom_red_flag()'::regprocedure) into v_src;
  v_src := replace(v_src, E',\n    -- S11e: the emergency-symptom question''s other answers (CMO decision 2026-10-05) page like the rest.\n    ''weakness_or_numbness'', ''difficulty_speaking'', ''back_pain''', '');
  if v_src = pg_get_functiondef('private.handle_symptom_red_flag()'::regprocedure) then
    raise exception 'sabotage did not change the function: the proof would be vacuous';
  end if;
  execute v_src;
  select count(*) into v_a0 from public.clinician_alerts where patient_id = v_adult and level = 'urgent_escalation';
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description) values (v_org, v_adult, 'back_pain', 6, 'sabotaged');
  select count(*) into v_a1 from public.clinician_alerts where patient_id = v_adult and level = 'urgent_escalation';
  insert into results values ('sabotaged', 'back_pain at 6 raises an urgent alert', '1', (v_a1 - v_a0)::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S11e proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
      from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the three types did not stop the page'; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
rollback;

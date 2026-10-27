-- Proof (S59d, OQ-S59d-05 decided): pregnancy answers are the person's own.
--   1. A check logged by someone else (logged_by_profile_id set and different from patient_id) is refused (42501) for the pregnancy pathway.
--   2. For any other pathway the check is recorded but a "pregnant" history answer is removed from the stored capture; other history stays.
--   3. The person themselves (no logger, or the same id) may record the pregnancy pathway and the "pregnant" answer untouched.
--   SABOTAGE: the trigger dropped, the proxy pregnancy pathway must then be recorded.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception. NOT RUN against the real schema by its author (Docker was down); the
-- trigger function was exercised on a stub schema on Postgres 16.
begin;

create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's59dx-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language, sex, state)
  values (v, p_org, 'patient'::public.user_role, 'S59d ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en', 'female', 'Lagos')
  on conflict (id) do update set is_test = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.ins(p_org uuid, p_patient uuid, p_logger uuid, p_key text, p_history jsonb) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.symptom_triage_assessments
    (organisation_id, patient_id, logged_by_profile_id, presenting_complaint_key, protocol_version, initial_capture, questions_asked, red_flag_screen,
     category, clinician_review_required, safety_net_message_key, rationale)
  values (p_org, p_patient, p_logger, p_key, (select min(version) from public.triage_protocols),
          jsonb_build_object('relevantHistory', p_history), '[]', '{}', 'urgent', false, 'routine', 'S59d proof')
  returning id into v;
  return v;
end $f$;

alter table public.symptom_triage_assessments disable trigger symptom_triage_assessments_01_age_gate;
alter table public.symptom_triage_assessments disable trigger symptom_triage_assessments_00_go_live_guard;

do $$
declare
  v_org uuid; v_p uuid; v_carer uuid; v_a uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  if not exists (select 1 from public.triage_protocols) then raise exception 'fixture: need a triage_protocols row'; end if;
  v_p := pg_temp.mkuser(v_org, 'person');
  v_carer := pg_temp.mkuser(v_org, 'carer');

  -- 1. refused for a proxy
  if pg_temp.try(format('select pg_temp.ins(%L, %L, %L, ''pregnancy_danger_signs'', ''[]''::jsonb)', v_org, v_p, v_carer)) <> '42501' then
    raise exception 'FAIL 1: the pregnancy pathway was recorded for a proxy';
  end if;
  -- 2. other pathways: recorded, pregnancy answer stripped, other answers kept
  v_a := pg_temp.ins(v_org, v_p, v_carer, 'headache', '["pregnant", "hypertension"]'::jsonb);
  if (select initial_capture -> 'relevantHistory' from public.symptom_triage_assessments where id = v_a) <> '["hypertension"]'::jsonb then
    raise exception 'FAIL 2: the proxy pregnancy answer was stored or other history lost: %', (select initial_capture from public.symptom_triage_assessments where id = v_a);
  end if;
  -- 3. the person themselves, with and without a logger id equal to their own
  v_a := pg_temp.ins(v_org, v_p, null, 'pregnancy_danger_signs', '["pregnant"]'::jsonb);
  if (select initial_capture -> 'relevantHistory' from public.symptom_triage_assessments where id = v_a) <> '["pregnant"]'::jsonb then raise exception 'FAIL 3a: the person''s own answer was touched'; end if;
  v_a := pg_temp.ins(v_org, v_p, v_p, 'headache', '["pregnant"]'::jsonb);
  if (select initial_capture -> 'relevantHistory' from public.symptom_triage_assessments where id = v_a) <> '["pregnant"]'::jsonb then raise exception 'FAIL 3b: the person''s own answer was touched (self logger)'; end if;

  -- SABOTAGE: the trigger dropped, the proxy pregnancy pathway must now be recorded
  drop trigger symptom_triage_assessments_02_proxy_pregnancy on public.symptom_triage_assessments;
  if pg_temp.try(format('select pg_temp.ins(%L, %L, %L, ''pregnancy_danger_signs'', ''[]''::jsonb)', v_org, v_p, v_carer)) <> 'ok' then
    raise exception 'VACUOUS TEST: with the trigger dropped the proxy pregnancy pathway was still refused';
  end if;
  raise notice 'PASS: pregnancy answers are the person''s own (pathway refused for a proxy, answer stripped, self untouched)';
end $$;

rollback;

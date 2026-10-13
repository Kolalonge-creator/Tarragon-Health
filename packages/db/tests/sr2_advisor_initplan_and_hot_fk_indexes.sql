-- SR2 proof: the six per-row auth.uid() policies are wrapped without changing who can see what, the duplicate index is gone, and the 26
-- hot-path foreign-key indexes exist (migration *_sr2_advisor_initplan_duplicate_index_and_hot_fk_indexes.sql).
-- Proves in one rolled-back transaction: none of the six policies still calls auth.uid() outside a (select ...) wrapper; a patient reads their
-- own emergency card and a different patient (same organisation, not staff) reads none, through the rewritten emergency_cards_select; the
-- same patient reads their own known device row and the other patient reads none; async_consults has exactly one patient/created_at index;
-- each of the 26 foreign-key columns is the leading column of an index.
-- SABOTAGE: emergency_cards_select opened to everyone (using true) and user_known_devices_select put back on bare auth.uid(); the
-- isolation check and the structure check must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.count_as(p_user uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  execute p_sql into r;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.bare_policies() returns text language sql as
$$ select count(*)::text from pg_policies
    where policyname in ('clinical_staff_attestations_insert', 'emergency_cards_select', 'emergency_cards_lookups_select',
                         'user_known_devices_select', 'patient_result_explanations_select', 'scribe_consents_insert_clinical')
      and regexp_replace(coalesce(qual, '') || coalesce(with_check, ''), '\(\s*SELECT\s+auth\.uid\(\)\s+AS\s+uid\s*\)', '', 'gi') ~ 'auth\.uid\(\)' $$;

do $$
declare
  v_org uuid; v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_missing text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_a, 'sr2-a-' || v_a || '@example.invalid', 'x', now(), '{}', '{}'), (v_b, 'sr2-b-' || v_b || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v_a, v_org, 'patient', 'SR2 A', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true),
         (v_b, v_org, 'patient', 'SR2 B', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '41 years')::date, true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, is_test = true;
  insert into public.emergency_cards (patient_id, organisation_id, token, is_active, consented_at, expires_at)
  values (v_a, v_org, md5(random()::text) || md5(random()::text), true, now(), now() + interval '30 days');
  insert into public.user_known_devices (profile_id, organisation_id, device_fingerprint) values (v_a, v_org, 'sr2-proof-' || v_a);

  perform pg_temp.ck('real', 'no rewritten policy calls auth.uid() outside a select wrapper', '0', pg_temp.bare_policies());
  perform pg_temp.ck('real', 'a patient reads their own emergency card', '1',
    pg_temp.count_as(v_a, format('select count(*)::text from public.emergency_cards where patient_id = %L', v_a)));
  perform pg_temp.ck('real', 'another patient reads none of it', '0',
    pg_temp.count_as(v_b, format('select count(*)::text from public.emergency_cards where patient_id = %L', v_a)));
  perform pg_temp.ck('real', 'a patient reads their own known device row', '1',
    pg_temp.count_as(v_a, format('select count(*)::text from public.user_known_devices where profile_id = %L', v_a)));
  perform pg_temp.ck('real', 'another patient reads none of it (known devices)', '0',
    pg_temp.count_as(v_b, format('select count(*)::text from public.user_known_devices where profile_id = %L', v_a)));
  perform pg_temp.ck('real', 'async_consults has exactly one patient/created_at index', '1',
    (select count(*)::text from pg_indexes where schemaname = 'public' and tablename = 'async_consults' and indexdef ~ '\(patient_id, created_at DESC\)'));

  select string_agg(t.tbl || '.' || t.col, ', ') into v_missing from (values
      ('clinical_tasks', 'organisation_id'), ('clinical_tasks', 'lead_clinician_id'), ('clinical_tasks', 'triage_event_id'),
      ('clinical_task_transitions', 'organisation_id'), ('clinical_task_transitions', 'actor_id'),
      ('clinician_alerts', 'backup_clinician_id'), ('clinician_alerts', 'monitoring_schedule_item_id'),
      ('emergency_events', 'clinician_alert_id'), ('emergency_events', 'vital_reading_id'),
      ('symptom_triage_assessments', 'clinician_alert_id'), ('symptom_triage_assessments', 'clinician_review_alert_id'),
      ('symptom_triage_assessments', 'emergency_event_id'),
      ('ops_incidents', 'clinician_alert_id'),
      ('care_message_threads', 'unread_alert_id'), ('care_messages', 'flagged_alert_id'),
      ('consultation_follow_ups', 'linked_outreach_task_id'), ('consultation_follow_ups', 'linked_referral_id'),
      ('vitals_readings', 'triage_event_id'),
      ('lab_results', 'organisation_id'), ('lab_results', 'document_id'), ('lab_results', 'partner_id'), ('lab_results', 'reviewed_by'),
      ('prescriptions', 'organisation_id'), ('prescriptions', 'encounter_note_id'), ('prescriptions', 'signed_by'),
      ('domain_events', 'organisation_id')) as t(tbl, col)
    where not exists (
      select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
       where i.indrelid = ('public.' || t.tbl)::regclass and a.attname = t.col);
  perform pg_temp.ck('real', 'all 26 foreign-key columns lead an index', '', coalesce(v_missing, ''));

  -- SABOTAGE: one policy opened to everyone, one put back on a bare auth.uid()
  alter policy emergency_cards_select on public.emergency_cards using (true);
  alter policy user_known_devices_select on public.user_known_devices using (profile_id = auth.uid());
  perform pg_temp.ck('sabotaged', 'another patient reads none of it (flips when sabotaged)', '0',
    pg_temp.count_as(v_b, format('select count(*)::text from public.emergency_cards where patient_id = %L', v_a)));
  perform pg_temp.ck('sabotaged', 'no policy calls bare auth.uid() (flips when sabotaged)', '0', pg_temp.bare_policies());
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'SR2 advisor proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

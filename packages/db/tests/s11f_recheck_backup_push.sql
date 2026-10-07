-- S11f proof: the server's backup push for the long recheck, and the postpartum window from the rule set
-- (migration *_s11f_recheck_backup_push_and_postpartum_window.sql).
--  1. backup_at is set only for an APPROVED rule set, only for a wait of at least minAfterMinutes: a draft (shadow)
--     result, and an approved 5 minute recheck, get none.
--  2. The queue function sends ONE reminder per recheck, only when due, only while the recheck is still pending and the
--     window is still open; a resolved recheck, a closed window and a second run send nothing.
--  3. Channel and content: in_app when there is no push subscription, push plus an in-app copy when there is; never sms or
--     email (INV-08); non_clinical; the payload is the reading id only (INV-07); the cron job exists.
--  4. triage_context_for_observation: postpartum follows the delivery date and the rule set's windowDays, and the
--     symptom question is passed as answered.
--  5. SABOTAGE: without the once-only guard a second run queues the reminder again, which proves check 2 can fail.
begin;
create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's11f-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S11f ' || p_label, (current_date - interval '30 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create or replace function pg_temp.res(p_check text, p_expected text, p_actual text) returns void
language sql as $f$ insert into results values ('real', p_check, p_expected, p_actual) $f$;

do $$
declare
  v_org uuid; v_p uuid; v_p2 uuid; v_cmo uuid; v_v2 uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid; v_r4 uuid; v_taken timestamptz;
  v_long jsonb; v_short jsonb; v_n integer; v_src text; v_ctx jsonb; v_sub uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_p := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  -- activation needs current indemnity cover or an exemption granted by someone else (clinical_staff trigger), so an admin grants one
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'S11f CMO', 'chief_medical_officer', true, now(), 'employed', true, pg_temp.mkuser(v_org, 'admin', 'admin')) on conflict do nothing;
  select id into v_v2 from public.triage_rule_sets where code = 'bp_care_triage' and version = 2;
  if v_v2 is null then raise exception 'rule set v2 is missing'; end if;

  v_long := jsonb_build_object('status', 'recheck_required', 'grade', null, 'ruleId', 'BP-X2', 'explanationKey', 'TRI-007',
    'actions', '[{"kind":"prompt_recheck","code":"TRI-007"}]'::jsonb, 'matchedRuleIds', '["BP-X2"]'::jsonb,
    'recheck', jsonb_build_object('afterMinutes', 120, 'windowMinutes', 240, 'waitMinutes', 120),
    'ruleSet', jsonb_build_object('code', 'bp_care_triage', 'version', 2));
  v_short := jsonb_set(jsonb_set(v_long, '{recheck}', jsonb_build_object('afterMinutes', 5, 'windowMinutes', 15, 'waitMinutes', 5)), '{ruleId}', '"BP-A1W"');

  -- 1a. shadow: the rule set is still a draft
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p, 'blood_pressure', 205, 100, 'manual', now()) returning id, taken_at into v_r1, v_taken;
  perform public.record_triage_result(v_r1, v_long, v_v2, null, 'a');
  perform pg_temp.res('a draft (shadow) rule set sets no backup push', 'true',
    (select (count(*) = 1 and bool_and(backup_at is null))::text from public.triage_pending_rechecks where observation_id = v_r1));

  -- approve v2 (inside this rolled-back transaction)
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v_v2;

  -- 1b. approved, long recheck
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p, 'blood_pressure', 206, 101, 'manual', now()) returning id, taken_at into v_r2, v_taken;
  perform public.record_triage_result(v_r2, v_long, v_v2, null, 'b');
  perform pg_temp.res('approved long recheck: backup 10 minutes after the 2 hour reminder', '130',
    (select (extract(epoch from (backup_at - v_taken)) / 60)::int::text from public.triage_pending_rechecks where observation_id = v_r2));
  -- 1c. approved, short recheck
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p2, 'blood_pressure', 182, 112, 'manual', now()) returning id into v_r3;
  perform public.record_triage_result(v_r3, v_short, v_v2, null, 'c');
  perform pg_temp.res('approved 5 minute recheck sets no backup push', 'true',
    (select (count(*) = 1 and bool_and(backup_at is null))::text from public.triage_pending_rechecks where observation_id = v_r3));

  -- 2. the queue
  perform pg_temp.res('nothing is due yet', '0', private.queue_triage_recheck_backup_reminders()::text);
  update public.triage_pending_rechecks set backup_at = now() - interval '1 minute', due_at = now() + interval '1 hour' where observation_id = v_r2;
  v_n := private.queue_triage_recheck_backup_reminders();
  perform pg_temp.res('one reminder when due: in_app only (no push subscription)', '1|in_app',
    v_n::text || '|' || (select string_agg(channel::text, ',') from public.notifications where recipient_id = v_p and template = 'triage_recheck_due'));
  perform pg_temp.res('a second run sends nothing', '0', private.queue_triage_recheck_backup_reminders()::text);
  perform pg_temp.res('the recheck is marked', 'true',
    (select (reminder_queued_at is not null)::text from public.triage_pending_rechecks where observation_id = v_r2));
  perform pg_temp.res('never sms or email, non_clinical, payload is the reading id only', 'true|true|true',
    ((select count(*) = 0 from public.notifications where template = 'triage_recheck_due' and channel::text in ('sms', 'email'))::text || '|' ||
     (select bool_and(content_class::text = 'non_clinical') from public.notifications where template = 'triage_recheck_due')::text || '|' ||
     (select bool_and(payload = jsonb_build_object('observation_id', v_r2)) from public.notifications where template = 'triage_recheck_due')::text));

  -- resolved: the patient measured again
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, taken_at)
    values (v_org, v_p2, 'blood_pressure', 207, 102, 'manual', now()) returning id into v_r4;
  perform public.record_triage_result(v_r4, v_long, v_v2, null, 'd');
  update public.triage_pending_rechecks set backup_at = now() - interval '1 minute', due_at = now() + interval '1 hour' where observation_id = v_r4;
  update public.triage_pending_rechecks set state = 'resolved' where observation_id = v_r4;
  perform pg_temp.res('a resolved recheck gets no reminder', '0', private.queue_triage_recheck_backup_reminders()::text);
  -- window closed
  update public.triage_pending_rechecks set state = 'pending', due_at = now() - interval '1 minute', reminder_queued_at = null where observation_id = v_r4;
  perform pg_temp.res('a closed window gets no reminder', '0', private.queue_triage_recheck_backup_reminders()::text);

  -- 3. with a push subscription: push plus an in-app copy
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key)
    values (v_org, v_p2, 'https://example.test/endpoint-' || gen_random_uuid()::text, 'k', 'a') returning id into v_sub;
  update public.triage_pending_rechecks set state = 'pending', due_at = now() + interval '1 hour', reminder_queued_at = null where observation_id = v_r4;
  v_n := private.queue_triage_recheck_backup_reminders();
  perform pg_temp.res('with a push subscription: push and an in-app copy', '1|in_app,push',
    v_n::text || '|' || (select string_agg(channel::text, ',' order by channel::text) from public.notifications where recipient_id = v_p2 and template = 'triage_recheck_due'));
  perform pg_temp.res('the cron job is scheduled every minute', '* * * * *',
    coalesce((select schedule from cron.job where jobname = 'triage-recheck-backup-push'), 'missing'));

  -- 4. context: postpartum from the rule set window
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v_p, (now() at time zone 'Africa/Lagos')::date - 30);
  v_ctx := public.triage_context_for_observation(v_r2);
  perform pg_temp.res('30 days after a birth is postpartum', 'true', (v_ctx #>> '{input,postpartum}'));
  perform pg_temp.res('the symptom question is passed as answered', 'true', (v_ctx #>> '{input,trigger,symptomsAnswered}'));
  update public.postnatal_profiles set delivery_date = (now() at time zone 'Africa/Lagos')::date - 50 where patient_id = v_p;
  perform pg_temp.res('50 days after is not', 'false', (public.triage_context_for_observation(v_r2) #>> '{input,postpartum}'));
  update public.triage_rule_sets set status = 'retired' where id = v_v2;
  update public.postnatal_profiles set delivery_date = (now() at time zone 'Africa/Lagos')::date - 30 where patient_id = v_p;

  -- 5. SABOTAGE: remove the once-only guard
  select pg_get_functiondef('private.queue_triage_recheck_backup_reminders()'::regprocedure) into v_src;
  v_src := replace(v_src, 'and p.reminder_queued_at is null', 'and true');
  execute v_src;
  update public.triage_pending_rechecks set state = 'pending', due_at = now() + interval '1 hour', backup_at = now() - interval '1 minute' where observation_id = v_r2;
  perform private.queue_triage_recheck_backup_reminders();
  insert into results values ('sabotaged', 'a second run sends nothing', '0', private.queue_triage_recheck_backup_reminders()::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S11f proof FAILED: %', (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
      from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: removing the once-only guard did not queue a second reminder'; end if;
end $$;
select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

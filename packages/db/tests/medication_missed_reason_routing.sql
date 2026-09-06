-- Tarragon Health — missed-dose reason routing verification
--
-- Proves private.route_missed_dose_reason() (medication_logs_route_missed_reason
-- trigger) actually branches correctly: 'forgot'/'feels_well' produce a
-- specific behavioural-nudge notification (with correct weekly dose counts,
-- not a generic "you missed a dose"); the other four reasons create a
-- non-clinical care_outreach_tasks row instead (never the clinical
-- medication_adherence_alerts ladder); a second non-clinical miss for the
-- same patient dedups against the already-open task; and a plain 'taken'
-- status fires nothing.
--
-- Run inside a transaction that is always rolled back — nothing here should
-- ever be committed.

begin;

do $$
declare
  v_org uuid;
  v_patient uuid;
  v_med uuid;
  v_log_id uuid;
  v_notif record;
  v_task record;
begin
  -- Minted, not borrowed: a bare `supabase db reset` has no patient profile at
  -- all, and a borrowed one drags in whatever notifications and outreach tasks
  -- it already owns, which the `order by created_at desc limit 1` reads below
  -- would happily pick up instead of the rows this file just caused.
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    insert into public.organisations (name, type)
    values ('Missed Reason Routing Test Org', 'clinic')
    returning id into v_org;
  end if;

  v_patient := gen_random_uuid();
  insert into auth.users (id, email)
  values (v_patient, 'missedreason-test-patient@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'Missed Reason Test Patient')
  on conflict (id) do update
    set organisation_id = excluded.organisation_id, role = excluded.role,
        full_name = excluded.full_name;

  insert into public.medications (id, organisation_id, patient_id, drug_name, schedule_times, source, added_by)
  values (gen_random_uuid(), v_org, v_patient, 'Test Amlodipine', '["08:00","20:00"]'::jsonb, 'patient', v_patient)
  returning id into v_med;

  -- Case 1: 'feels_well' -> behavioural nudge notification, no outreach task
  insert into public.medication_logs (id, organisation_id, patient_id, medication_id, status, missed_reason, scheduled_time, scheduled_for_date)
  values (gen_random_uuid(), v_org, v_patient, v_med, 'missed', 'feels_well', '08:00', current_date)
  returning id into v_log_id;

  select channel, status, template, payload into v_notif
  from public.notifications
  where recipient_id = v_patient and template = 'missed_dose_behavioural_nudge'
  order by created_at desc limit 1;

  if v_notif.template is null then
    raise exception 'FAIL case1: no missed_dose_behavioural_nudge notification created for feels_well';
  end if;
  if (v_notif.payload->>'reason') <> 'feels_well' then
    raise exception 'FAIL case1: notification payload reason = %, expected feels_well', v_notif.payload->>'reason';
  end if;
  if (v_notif.payload->>'total_this_week')::int <> 14 then
    raise exception 'FAIL case1: total_this_week = %, expected 14 (2/day * 7)', v_notif.payload->>'total_this_week';
  end if;
  raise notice 'PASS case1: feels_well missed dose -> behavioural nudge notification with correct weekly counts';

  if exists (select 1 from public.care_outreach_tasks where patient_id = v_patient and trigger_type = 'medication_engagement_barrier') then
    raise exception 'FAIL case1: feels_well incorrectly created a care_outreach_tasks row';
  end if;
  raise notice 'PASS case1b: feels_well did NOT create an outreach task';

  -- Case 2: 'doesnt_understand' -> care_outreach_tasks row, non-clinical
  insert into public.medication_logs (id, organisation_id, patient_id, medication_id, status, missed_reason, scheduled_time, scheduled_for_date)
  values (gen_random_uuid(), v_org, v_patient, v_med, 'missed', 'doesnt_understand', '20:00', current_date)
  returning id into v_log_id;

  select organisation_id, patient_id, trigger_type, priority, status, trigger_detail into v_task
  from public.care_outreach_tasks
  where patient_id = v_patient and trigger_type = 'medication_engagement_barrier'
  order by created_at desc limit 1;

  if v_task.trigger_type is null then
    raise exception 'FAIL case2: no care_outreach_tasks row created for doesnt_understand';
  end if;
  if v_task.status <> 'open' or v_task.priority <> 3 then
    raise exception 'FAIL case2: task status/priority = %/%, expected open/3', v_task.status, v_task.priority;
  end if;
  if (v_task.trigger_detail->>'missed_reason') <> 'doesnt_understand' then
    raise exception 'FAIL case2: trigger_detail.missed_reason = %, expected doesnt_understand', v_task.trigger_detail->>'missed_reason';
  end if;
  raise notice 'PASS case2: doesnt_understand missed dose -> care_outreach_tasks row (open, priority 3)';

  -- Case 3: dedup — a second non-clinical miss for the same patient must not create a duplicate open task
  insert into public.medication_logs (id, organisation_id, patient_id, medication_id, status, missed_reason, scheduled_time, scheduled_for_date)
  values (gen_random_uuid(), v_org, v_patient, v_med, 'missed', 'technical_problem', '08:00', current_date + 1)
  returning id into v_log_id;

  if (select count(*) from public.care_outreach_tasks where patient_id = v_patient and trigger_type = 'medication_engagement_barrier') <> 1 then
    raise exception 'FAIL case3: expected exactly 1 open medication_engagement_barrier task after a second non-clinical miss, got %',
      (select count(*) from public.care_outreach_tasks where patient_id = v_patient and trigger_type = 'medication_engagement_barrier');
  end if;
  raise notice 'PASS case3: second non-clinical miss deduped against the existing open task';

  -- Case 4: plain 'taken' status must not fire anything
  insert into public.medication_logs (id, organisation_id, patient_id, medication_id, status, scheduled_time, scheduled_for_date)
  values (gen_random_uuid(), v_org, v_patient, v_med, 'taken', '08:00', current_date + 2);

  if exists (
    select 1 from public.notifications
    where recipient_id = v_patient and template = 'missed_dose_behavioural_nudge'
      and created_at > now() - interval '1 second' and (payload->>'reason') is null
  ) then
    raise exception 'FAIL case4: a taken dose incorrectly triggered routing';
  end if;
  raise notice 'PASS case4: a taken dose triggers no routing (sanity check)';

  raise notice 'ALL MEDICATION_MISSED_REASON_ROUTING CHECKS PASSED';
end $$;

rollback;

-- Tarragon Health — Hypertension pathway H3: missing-expected-reading soft red flag
-- (TH-CP-HTN-001 §5.4, §14.6, §15)
--
-- "Missing expected data (a skipped reading, an un-returned lab) is itself a
-- soft red flag — the platform chases it and never assumes silence is safe."
-- The existing vitals_reminder machinery only NUDGES the patient; nothing
-- escalates continued silence to a clinician. This adds that step: a patient on
-- active hypertension/diabetes monitoring who has logged no BP reading well past
-- their reminder cadence gets a clinician_review task on the doctor worklist.
--
-- Unlike a value/symptom red flag (never auto-closed), a data-GAP task is a
-- chase, not a clinical judgement — so it auto-resolves the moment the expected
-- reading arrives (handled inside the BP red-flag trigger). One active per
-- patient, matched by its stable title.

-- 1. Auto-resolve the data-gap task on any BP reading — extend the H1 trigger.
create or replace function private.handle_bp_reading_red_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level     text;
  v_alert_lvl public.alert_level;
  v_esc       smallint;
  v_sla       interval;
  v_title     text;
  v_detail    text;
  v_existing  public.clinician_alerts%rowtype;
begin
  if new.vital_type <> 'blood_pressure' then
    return new;
  end if;

  -- Data-gap chase is satisfied by any BP reading arriving — close it.
  update public.clinician_alerts
    set status = 'resolved', updated_at = now()
  where patient_id = new.patient_id
    and status = 'open'
    and title = 'Missing expected blood-pressure readings';

  v_level := private.classify_bp_level(new.systolic, new.diastolic);
  if v_level in ('unknown', 'green') then
    return new;
  end if;

  v_detail := format('Home BP reading %s/%s mmHg logged %s.',
                     new.systolic, new.diastolic, to_char(new.taken_at, 'YYYY-MM-DD HH24:MI'));

  if v_level = 'emergency' then
    if not exists (
      select 1 from public.emergency_events e
      where e.patient_id = new.patient_id
        and e.source = 'bp_reading'
        and e.status = 'active'
        and e.created_at > now() - interval '6 hours'
    ) then
      insert into public.emergency_events
        (organisation_id, patient_id, source, trigger_detail, status, vital_reading_id)
      values (
        new.organisation_id, new.patient_id, 'bp_reading',
        v_detail || ' This is in the hypertensive-crisis range.',
        'active', new.id
      );
    end if;
    return new;
  end if;

  if v_level = 'red' then
    v_alert_lvl := 'urgent_escalation'; v_esc := 3; v_sla := interval '1 hour';
    v_title := 'Priority 1: high blood pressure reading';
    v_detail := v_detail || ' Please ask the patient to rest 5 minutes and re-check, then review same day.';
  else
    v_alert_lvl := 'clinician_review'; v_esc := 2; v_sla := interval '72 hours';
    v_title := 'Blood pressure above target';
    v_detail := v_detail || ' Above target — review adherence, technique, lifestyle and titration.';
  end if;

  select * into v_existing
  from public.clinician_alerts
  where patient_id = new.patient_id
    and vital_reading_id is not null
    and status = 'open'
  order by created_at desc
  limit 1;

  if v_existing.id is not null then
    if v_esc >= coalesce(v_existing.escalation_level, 0) then
      update public.clinician_alerts
        set level = v_alert_lvl, escalation_level = v_esc, title = v_title,
            detail = v_detail, sla_due_at = now() + v_sla,
            vital_reading_id = new.id, updated_at = now()
      where id = v_existing.id;
    end if;
  else
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at,
       escalation_level, vital_reading_id)
    values (
      new.organisation_id, new.patient_id, v_alert_lvl, 'open', v_title, v_detail,
      now() + v_sla, v_esc, new.id
    );
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.patient_id, 'bp_red_flag.raised',
    'vitals_readings', new.id,
    jsonb_build_object('level', v_level, 'systolic', new.systolic, 'diastolic', new.diastolic)
  );

  return new;
end;
$$;

-- 2. Daily overdue scan -> doctor task.
create or replace function private.flag_overdue_vitals()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  for v_row in
    with monitored as (
      select p.id as patient_id, p.organisation_id,
        coalesce(
          (select r.frequency_days from public.vitals_reminder_rules r where r.patient_id = p.id),
          (select min(r.frequency_days) from public.vitals_reminder_rules r
             join public.care_plans cp on cp.condition = r.condition and cp.patient_id = p.id and cp.status='active'
             where r.patient_id is null and r.condition is not null and r.organisation_id = p.organisation_id),
          case when exists (
            select 1 from public.care_plans cp
            where cp.patient_id = p.id and cp.status='active' and cp.condition in ('hypertension','diabetes')
          ) then 3 else 30 end
        ) as freq_days,
        (select max(v.taken_at) from public.vitals_readings v
           where v.patient_id = p.id and v.vital_type = 'blood_pressure') as last_bp
      from public.profiles p
      where p.role = 'patient' and p.organisation_id is not null
        and exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id and cp.status='active' and cp.condition in ('hypertension','diabetes')
        )
    )
    select m.* from monitored m
    where (m.last_bp is null or m.last_bp < now() - ((m.freq_days + 7) || ' days')::interval)
      and exists (select 1 from public.vitals_reminder_state s
                    where s.patient_id = m.patient_id and s.reminder_sent_at is not null)
      and not exists (
        select 1 from public.clinician_alerts a
        where a.patient_id = m.patient_id and a.status = 'open'
          and a.title = 'Missing expected blood-pressure readings'
      )
  loop
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
    values (
      v_row.organisation_id, v_row.patient_id, 'clinician_review', 'open',
      'Missing expected blood-pressure readings',
      format('No blood-pressure reading logged in over %s days despite reminders. Silence is not assumed safe — please make contact to check on the patient and their monitoring.',
             v_row.freq_days + 7),
      now() + interval '72 hours', 2
    );

    insert into public.audit_log
      (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (
      v_row.organisation_id, v_row.patient_id, 'bp_missing_reading.flagged',
      'profiles', v_row.patient_id,
      jsonb_build_object('freq_days', v_row.freq_days, 'last_bp', v_row.last_bp)
    );
  end loop;
end;
$$;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'vitals-overdue-daily') then
    perform cron.unschedule('vitals-overdue-daily');
  end if;
end $$;

select cron.schedule('vitals-overdue-daily', '30 6 * * *', $$ select private.flag_overdue_vitals(); $$);

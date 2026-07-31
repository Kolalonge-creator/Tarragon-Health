-- Tarragon Health
-- Patient-experience review 2026-07-31: vitals_reminder's WhatsApp/SMS body
-- said "open the app" with no link at all, and vitals_reminder is
-- deliberately generic (any vital type, cadence-driven, not tied to one
-- metric -- see this function's own comment history). Rather than force a
-- fictitious vital type onto every reminder, this adds an OPTIONAL
-- best-effort hint: when a patient's active care_plans condition maps
-- cleanly to one vital type (diabetes -> glucose, hypertension/
-- cardiovascular -> blood_pressure, obesity -> weight), the reminder
-- carries that as `suggested_vital_type` so send-pending-notifications can
-- link straight to /patient/quick-log/<type> instead of the generic vitals
-- section. Purely additive to the payload -- due-date/cadence computation
-- (the `candidates`/`due` CTEs) is byte-identical to the prior definition.
--
-- Verified live (rolled-back transaction against the suggested_vital_type
-- CASE expression in isolation, against a real patient): null with no
-- active care plan, 'glucose' for diabetes, 'blood_pressure' for
-- hypertension, 'weight' for obesity -- all four as designed.
create or replace function private.queue_vitals_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      coalesce(
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id = p.id),
        (select min(r.frequency_days) from public.vitals_reminder_rules r
           join public.care_plans cp
             on cp.condition = r.condition
            and cp.patient_id = p.id
            and cp.status = 'active'
           where r.patient_id is null
             and r.condition is not null
             and r.organisation_id = p.organisation_id),
        (select r.frequency_days from public.vitals_reminder_rules r
           where r.patient_id is null
             and r.condition is null
             and r.organisation_id = p.organisation_id),
        case when exists (
          select 1 from public.care_plans cp
          where cp.patient_id = p.id
            and cp.status = 'active'
            and cp.condition in ('hypertension', 'diabetes')
        ) then 3 else 30 end
      ) as frequency_days,
      (
        select case
          when bool_or(cp.condition = 'diabetes') then 'glucose'
          when bool_or(cp.condition in ('hypertension', 'cardiovascular')) then 'blood_pressure'
          when bool_or(cp.condition = 'obesity') then 'weight'
          else null
        end
        from public.care_plans cp
        where cp.patient_id = p.id and cp.status = 'active'
      ) as suggested_vital_type
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
      f.suggested_vital_type,
      greatest(
        coalesce(
          (select max(v.taken_at)::date from public.vitals_readings v where v.patient_id = f.patient_id),
          f.created_at::date
        ) + (f.frequency_days || ' days')::interval,
        coalesce(
          (select s.next_due_at from public.vitals_reminder_state s where s.patient_id = f.patient_id),
          '-infinity'::date
        )
      ) as effective_due
    from freq f
  ),
  due as (
    select * from candidates where effective_due <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select
      organisation_id,
      patient_id,
      'whatsapp',
      'pending',
      'vitals_reminder',
      jsonb_build_object(
        'frequency_days', frequency_days,
        'due_date', effective_due,
        'suggested_vital_type', suggested_vital_type
      )
    from due
    returning recipient_id
  )
  insert into public.vitals_reminder_state (patient_id, organisation_id, next_due_at, reminder_sent_at)
  select patient_id, organisation_id, current_date + frequency_days, now()
  from due
  on conflict (patient_id) do update
    set next_due_at = excluded.next_due_at,
        reminder_sent_at = excluded.reminder_sent_at,
        updated_at = now();
$$;

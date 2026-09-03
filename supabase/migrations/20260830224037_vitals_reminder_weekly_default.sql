-- Chronic disease monitoring §1.1/§1.2: reading-entry reminder default cadence
-- was inverted relative to the product spec. The spec's default is a weekly
-- prompt to log a BP/glucose reading, with every-3-days as a configurable
-- alternate (set via the existing patient/condition/group/global tiers in
-- vitals_reminder_rules) — not the other way around. This only changes the
-- bottom (hardcoded) fallback tier; any org/condition/patient rule already on
-- file, including a deliberately-set 3-day one, is untouched.

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
        ) then 7 else 30 end
      ) as frequency_days
    from public.profiles p
    where p.role = 'patient' and p.organisation_id is not null
  ),
  candidates as (
    select
      f.patient_id,
      f.organisation_id,
      f.frequency_days,
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
      jsonb_build_object('frequency_days', frequency_days, 'due_date', effective_due)
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

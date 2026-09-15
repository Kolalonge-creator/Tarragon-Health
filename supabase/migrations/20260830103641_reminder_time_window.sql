-- Tarragon Health — preferred time-of-day for non-urgent reminders
-- (Engagement/Retention gap #3b).
--
-- profiles.notification_channel_preference already lets a patient pick a
-- channel (see the already-live CommunicationPreferencesForm). This adds
-- the other real, actionable half: WHEN non-urgent reminders arrive. Only
-- the two reminder-queue functions named below are touched — the
-- critical/emergency escalation notification path is untouched and must
-- never respect this column.

alter table public.profiles
  add column preferred_reminder_hour smallint check (preferred_reminder_hour between 0 and 23);

comment on column public.profiles.preferred_reminder_hour is
  'Patient-chosen local hour (Africa/Lagos, 0-23) for non-urgent reminders. NULL = no preference, send as soon as due. Never applied to critical/escalation notifications.';

alter table public.notifications
  add column send_after timestamptz;

comment on column public.notifications.send_after is
  'Non-urgent reminders only. NULL = send on next sender tick, as today. Never set on priority=critical rows.';

create or replace function private.next_send_after_for_hour(p_hour smallint)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_hour is null then null
    when today_at > now() then today_at
    else today_at + interval '1 day'
  end
  from (
    select ((now() at time zone 'Africa/Lagos')::date + (p_hour || ' hours')::interval)
             at time zone 'Africa/Lagos' as today_at
  ) t;
$$;

revoke execute on function private.next_send_after_for_hour(smallint) from public;

create or replace function private.queue_vitals_reminders()
returns void
language sql
security definer
set search_path = ''
as $function$
  with freq as (
    select
      p.id as patient_id,
      p.organisation_id,
      p.created_at,
      p.preferred_reminder_hour,
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
      f.preferred_reminder_hour,
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
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
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
      ),
      private.next_send_after_for_hour(preferred_reminder_hour)
    from due
    returning recipient_id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
    select
      organisation_id,
      patient_id,
      'in_app',
      'pending',
      'vitals_reminder',
      jsonb_build_object(
        'frequency_days', frequency_days,
        'due_date', effective_due,
        'suggested_vital_type', suggested_vital_type
      ),
      private.next_send_after_for_hour(preferred_reminder_hour)
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
$function$;

create or replace function private.queue_medication_checkin_reminders()
returns void
language sql
security definer
set search_path = ''
as $function$
  with due as (
    select c.id, c.organisation_id, c.patient_id, c.checkin_type, m.drug_name, pr.preferred_reminder_hour
    from public.medication_adherence_checkins c
    join public.medications m on m.id = c.medication_id
    join public.profiles pr on pr.id = c.patient_id
    where c.status = 'pending'
      and c.reminder_sent_at is null
      and c.due_date <= current_date
  ),
  queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
    select
      organisation_id, patient_id, 'whatsapp', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name),
      private.next_send_after_for_hour(preferred_reminder_hour)
    from due
    returning id
  ),
  queued_in_app as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, send_after)
    select
      organisation_id, patient_id, 'in_app', 'pending', 'medication_adherence_checkin',
      jsonb_build_object('checkin_type', checkin_type, 'drug_name', drug_name),
      private.next_send_after_for_hour(preferred_reminder_hour)
    from due
    returning id
  )
  update public.medication_adherence_checkins c
    set reminder_sent_at = now()
  from due
  where c.id = due.id;
$function$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'preferred_reminder_hour'
  ) then
    raise exception 'FAIL: profiles.preferred_reminder_hour was not created';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notifications' and column_name = 'send_after'
  ) then
    raise exception 'FAIL: notifications.send_after was not created';
  end if;
  if private.next_send_after_for_hour(null) is not null then
    raise exception 'FAIL: next_send_after_for_hour(null) should be null';
  end if;
  raise notice 'PASS: reminder time-window columns + helper function created';
end $$;

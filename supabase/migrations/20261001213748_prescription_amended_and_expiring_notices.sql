-- Prescription PDF, phase 4: stale-copy notice on amendment, and an expiring-soon reminder.
--
-- 1. Amendment. private.amend_medication() inserts a NEW clinician row (previous_version_id set) and supersedes the old one. The existing
--    enqueue_medication_prescribed_notifications trigger fired for that insert exactly as for a brand-new prescription, so the patient's in-app
--    notice said "<drug> was prescribed for you": nothing told them their saved PDF was now out of date. For an amendment the in-app notice is
--    now 'prescription_updated_patient' ("updated: download the new version; the old PDF no longer works"). The email and the reminder-channel
--    rows are left exactly as they were (their templates live in the send-pending-notifications edge function, which is not redeployed here).
--    The function body below is the live definition with only the in-app branch changed.
-- 2. Expiring soon. private.queue_prescription_expiry_reminders(), run daily by pg_cron (06:35 UTC, after the other 06:xx reminder jobs), queues ONE in-app
--    notice per prescription ('prescription_expiring_soon') when a current clinician prescription expires within 7 days. Current = active, not
--    superseded, not yet expired. One per prescription for its lifetime (an amended prescription is a new row with its own expiry, so it
--    can remind again).

create or replace function private.enqueue_medication_prescribed_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_details       text;
begin
  if new.source not in ('clinician', 'specialist') or new.is_active is not true then
    return new;
  end if;

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  v_details := new.drug_name
    || coalesce(' ' || nullif(new.dose, ''), '')
    || coalesce(', ' || nullif(new.frequency, ''), '');

  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'medication_prescribed_patient',
      jsonb_build_object(
        'to_email',        v_patient_email,
        'patient_name',    coalesce(v_patient.full_name, 'there'),
        'drug_name',       new.drug_name,
        'dose',            coalesce(new.dose, ''),
        'frequency',       coalesce(new.frequency, ''),
        'details',         v_details,
        'prescriber_name', coalesce(new.prescriber_name, '')
      )
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    'medication_prescribed_patient',
    jsonb_build_object(
      'patient_name',    coalesce(v_patient.full_name, 'there'),
      'drug_name',       new.drug_name,
      'dose',            coalesce(new.dose, ''),
      'frequency',       coalesce(new.frequency, ''),
      'details',         v_details,
      'prescriber_name', coalesce(new.prescriber_name, '')
    )
  );

  if new.previous_version_id is not null and new.source = 'clinician' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending',
      'prescription_updated_patient',
      jsonb_build_object(
        'drug_name',  new.drug_name,
        'rx_number',  new.rx_number,
        'version',    new.version,
        'details',    v_details
      )
    );
  else
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending',
      'medication_prescribed_patient',
      jsonb_build_object(
        'patient_name',    coalesce(v_patient.full_name, 'there'),
        'drug_name',       new.drug_name,
        'dose',            coalesce(new.dose, ''),
        'frequency',       coalesce(new.frequency, ''),
        'details',         v_details,
        'prescriber_name', coalesce(new.prescriber_name, '')
      )
    );
  end if;

  return new;
end;
$$;

create or replace function private.queue_prescription_expiry_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with due as (
    select m.id, m.patient_id, m.organisation_id, m.drug_name, m.rx_number, m.expires_at
      from public.medications m
     where m.source = 'clinician'
       and m.is_active
       and m.superseded_at is null
       and m.expires_at is not null
       and m.expires_at > now()
       and m.expires_at <= now() + interval '7 days'
       and not exists (
         select 1 from public.notifications n
          where n.template = 'prescription_expiring_soon'
            and n.recipient_id = m.patient_id
            and n.payload->>'medication_id' = m.id::text
       )
  ), queued as (
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    select d.organisation_id, d.patient_id, 'in_app', 'pending', 'prescription_expiring_soon',
           jsonb_build_object('medication_id', d.id, 'drug_name', d.drug_name, 'rx_number', d.rx_number,
                              'expires_at', d.expires_at)
      from due d
    returning 1
  )
  select count(*) into v_count from queued;
  return v_count;
end;
$$;

revoke all on function private.queue_prescription_expiry_reminders() from public;
revoke all on function private.queue_prescription_expiry_reminders() from anon;

select cron.schedule(
  'prescription-expiry-reminders-daily',
  '35 6 * * *',
  $$select private.queue_prescription_expiry_reminders();$$
);

do $$
begin
  if has_function_privilege('anon', 'private.queue_prescription_expiry_reminders()', 'EXECUTE') then
    raise exception 'queue_prescription_expiry_reminders must not be anon-executable';
  end if;
  if not exists (select 1 from cron.job where jobname = 'prescription-expiry-reminders-daily') then
    raise exception 'expiry reminder job not scheduled';
  end if;
end $$;

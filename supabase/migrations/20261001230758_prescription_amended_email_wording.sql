-- The email for an AMENDED prescription said "A new medication has been added to your care plan" (the amendment goes through the same trigger as a
-- brand-new prescription), which hid that the patient's saved PDF is now out of date. For an amendment the email and the reminder-channel notice now use
-- the new template 'prescription_updated_patient' ("Your prescription for X was updated: download the new one, any copy you saved earlier no longer
-- works"). The template is a TEMPLATE_MAP entry in send-pending-notifications (so the patient's "medications" channel preferences are honoured: an
-- unclassified template is never gated) with a notification_templates row and en email/sms/push locale rows registered here as the documented fallback.
--
-- DEPLOY ORDER: the edge function must be deployed BEFORE this migration is applied, otherwise an amendment's email would fail as "unknown template".
-- (A new prescription is unchanged: it still sends 'medication_prescribed_patient'.) The in-app row now carries the same payload as the email.

insert into public.notification_templates (key, category, business_priority, audience, default_channels, description)
values ('prescription_updated_patient', 'medication', 'important', 'patient',
        array['email','in_app']::public.notification_channel[], 'A prescription was amended: download the new version.')
on conflict (key) do nothing;

insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('prescription_updated_patient', 'en', 'email', 'Your prescription for {{drug_name}} was updated',
   'Hi {{patient_name}}, your care team has updated your prescription for {{drug_name}} {{details}}. Please download the new prescription from the Tarragon Health app: any copy you saved earlier no longer works.'),
  ('prescription_updated_patient', 'en', 'sms', null,
   'Hi {{patient_name}}, your prescription for {{drug_name}} was updated. Open the Tarragon Health app to download the new one: any copy you saved earlier no longer works. Tarragon Health'),
  ('prescription_updated_patient', 'en', 'push', null,
   'Your prescription for {{drug_name}} was updated. Open the app to download the new one.')
on conflict do nothing;

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
  v_amended       boolean;
  v_template      text;
  v_payload       jsonb;
begin
  if new.source not in ('clinician', 'specialist') or new.is_active is not true then
    return new;
  end if;

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  v_amended := new.previous_version_id is not null and new.source = 'clinician';
  v_template := case when v_amended then 'prescription_updated_patient' else 'medication_prescribed_patient' end;
  v_details := new.drug_name
    || coalesce(' ' || nullif(new.dose, ''), '')
    || coalesce(', ' || nullif(new.frequency, ''), '');

  v_payload := jsonb_build_object(
    'patient_name',    coalesce(v_patient.full_name, 'there'),
    'drug_name',       new.drug_name,
    'dose',            coalesce(new.dose, ''),
    'frequency',       coalesce(new.frequency, ''),
    'details',         v_details,
    'prescriber_name', coalesce(new.prescriber_name, '')
  ) || case when v_amended
         then jsonb_build_object('rx_number', new.rx_number, 'version', new.version)
         else '{}'::jsonb end;

  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending', v_template,
      v_payload || jsonb_build_object('to_email', v_patient_email)
    );
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    v_template, v_payload
  );

  if new.previous_version_id is not null and new.source = 'clinician' then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'in_app', 'pending',
      'prescription_updated_patient',
      v_payload
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


do $$
begin
  if not exists (select 1 from public.notification_templates where key = 'prescription_updated_patient') then
    raise exception 'prescription_updated_patient template not registered';
  end if;
  if (select count(*) from public.notification_template_locales where template_key = 'prescription_updated_patient') < 3 then
    raise exception 'prescription_updated_patient locale rows missing';
  end if;
end $$;

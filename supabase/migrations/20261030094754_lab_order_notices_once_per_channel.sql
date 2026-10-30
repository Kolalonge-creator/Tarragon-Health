-- E8 (events harness): the patient's lab order notices arrived twice in the app.
--
-- Two lab producers wrote an explicit in-app row and then a second row on private.patient_reminder_channel(), which falls back to
-- the in-app inbox when the patient has neither an email preference nor a push subscription. For most patients that meant two
-- identical bell entries:
--   private.enqueue_lab_order_lab_notifications  (payment confirmed)  lab_order_patient_confirmation: in_app, in_app
--   private.handle_lab_order_sample_rejected     (sample rejected)    lab_sample_rejected:             in_app, in_app
--
-- The fix keeps the guaranteed rows (in-app, and the confirmation's explicit email) and sends the reminder-channel copy only when
-- it is a channel the explicit rows do not already cover: push for the confirmation (that call passes allow_email = false, so it
-- can only return push or the inbox), push or email for the rejection.
-- Both bodies below are the live bodies (checksums compared with production on 2026-10-30) with only that change. No rows are
-- rewritten: duplicates already sent stay as history.
-- Proof: packages/db/tests/events_lab_order_to_specimen_notices.sql.

create or replace function private.enqueue_lab_order_lab_notifications()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_provider      public.lab_providers%rowtype;
  v_facility_name text;
  v_bundle_name   text;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.provider_id is not null then
    select * into v_provider from public.lab_providers where id = new.provider_id;
  end if;
  if new.facility_id is not null then
    select name into v_facility_name from public.facilities where id = new.facility_id;
  end if;
  select name into v_bundle_name from public.panel_bundles where id = new.panel_bundle_id;

  -- The patient's own channel, only when it adds something: the in-app and email rows below already cover those two.
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending', 'lab_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
      'test_name', coalesce(v_bundle_name, 'your test'))
  where private.patient_reminder_channel(new.patient_id, false) = 'push';

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', 'lab_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
      'test_name', coalesce(v_bundle_name, 'your test')));

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'lab_order_patient_confirmation',
      jsonb_build_object('to_email', v_patient_email, 'order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number, 'lab_name', coalesce(v_facility_name, v_provider.name, 'the lab'),
        'test_name', coalesce(v_bundle_name, 'your test')));
  end if;

  if v_provider.contact_phone is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'sms', 'pending', 'lab_order_lab_alert',
      jsonb_build_object('to_phone', v_provider.contact_phone, 'lab_name', v_provider.name, 'facility_name', coalesce(v_facility_name, ''),
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'a lab test')));
  end if;

  if v_provider.contact_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (new.organisation_id, new.patient_id, 'email', 'pending', 'lab_order_lab_alert',
      jsonb_build_object('to_email', v_provider.contact_email, 'lab_name', v_provider.name, 'facility_name', coalesce(v_facility_name, ''),
        'patient_name', coalesce(v_patient.full_name, 'a patient'), 'patient_number', v_patient.patient_number,
        'order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'a lab test')));
  end if;

  return new;
end;
$function$;

create or replace function private.handle_lab_order_sample_rejected()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_bundle_name text;
  v_reopened boolean := false;
  v_reopened_count integer;
  v_alert_detail text;
begin
  if not (new.status = 'sample_rejected' and old.status is distinct from 'sample_rejected') then
    return new;
  end if;

  select name into v_bundle_name from public.panel_bundles where id = new.panel_bundle_id;

  -- 2a. A due-screening self-service booking: reopen it so the patient's
  -- existing "book this due screening" flow offers the test again. Only
  -- when it is still in the 'booked' state this order itself put it in —
  -- never claw back a schedule some other event has already moved on from.
  if new.screening_schedule_id is not null then
    update public.screening_schedules
    set status = case when due_date <= current_date then 'overdue' else 'pending' end
    where id = new.screening_schedule_id
      and status = 'booked';
    get diagnostics v_reopened_count = row_count;
    v_reopened := v_reopened_count > 0;
  end if;

  -- 2b. Notify the patient — confirmation-only, never the transactional
  -- interface (CLAUDE.md "What Claude Must Never Do").
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values
    (new.organisation_id, new.patient_id, 'in_app', 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened));

  -- The patient's own channel (email or push), only when it adds something: the in-app row above already covers the inbox.
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id), 'pending', 'lab_sample_rejected',
      jsonb_build_object('order_number', new.order_number, 'test_name', coalesce(v_bundle_name, 'your test'),
        'reason', new.rejection_reason, 'schedule_reopened', v_reopened)
  where private.patient_reminder_channel(new.patient_id) <> 'in_app';

  -- 2c. Operational escalation — "a new action", per spec §14.15's own
  -- diagram wording, for whoever needs to arrange the repeat.
  v_alert_detail := format(
    'Lab order %s (%s) had its sample rejected: %s.',
    coalesce(new.order_number, new.id::text), coalesce(v_bundle_name, 'lab test'), new.rejection_reason
  );
  v_alert_detail := v_alert_detail || case
    when v_reopened then ' The linked screening has been reopened so the patient can rebook it themselves.'
    when new.fulfilment = 'partner' then ' A repeat sample needs arranging with the lab.'
    else ' The patient needs to arrange a repeat sample.'
  end;

  perform private.raise_clinician_alert(
    new.organisation_id, new.patient_id, 'clinician_review',
    'Lab sample rejected — repeat needed', v_alert_detail,
    'operational', 'laboratory_failure'
  );

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id, new.rejected_by, 'lab_order.sample_rejected',
    'lab_orders', new.id,
    jsonb_build_object('reason', new.rejection_reason, 'schedule_reopened', v_reopened, 'fulfilment', new.fulfilment::text)
  );

  return new;
end;
$function$;

-- Proof that the live trigger functions now carry the fix (a replay that silently kept the old bodies would fail here).
do $$
begin
  if position('where private.patient_reminder_channel(new.patient_id, false) = ''push''' in pg_get_functiondef('private.enqueue_lab_order_lab_notifications()'::regprocedure)) = 0 then
    raise exception 'enqueue_lab_order_lab_notifications was not updated';
  end if;
  if position('where private.patient_reminder_channel(new.patient_id) <> ''in_app''' in pg_get_functiondef('private.handle_lab_order_sample_rejected()'::regprocedure)) = 0 then
    raise exception 'handle_lab_order_sample_rejected was not updated';
  end if;
end $$;

-- Adds order_id to the payload of the lab-order-requested patient email, so
-- send-pending-notifications can fetch and attach the take-anywhere test
-- request PDF to the email it already sends.
-- Founder requirement, 2026-09-10: the PDF must be generated automatically and
-- emailed to the patient, in addition to being downloadable in the app.
--
-- WHAT ALREADY EXISTED
-- ---------------------
-- private.enqueue_lab_order_requested_notifications (20260720120004) already
-- fires on every lab_orders insert and enqueues an email row via the
-- notifications table, rendered and delivered by the send-pending-
-- notifications Edge Function. What that row's payload did NOT carry was the
-- order's id -- only order_number (a human-readable label) and test_name. The
-- Edge Function has no other way to look the order back up, so it could not
-- have fetched the PDF even if it wanted to.
--
-- This migration changes nothing about WHEN the email is sent or WHO it goes
-- to -- only adds one field the Edge Function change (shipped alongside this
-- migration) needs to attach the PDF. The email/whatsapp copy, the
-- self_booked branching, and every existing behaviour are untouched.

begin;

create or replace function private.enqueue_lab_order_requested_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_test_name     text;
  v_order_ref     text;
  v_self_booked   boolean;
begin
  -- Every lab order notifies the patient. Self-booked orders get a showable
  -- confirmation to present at the lab; doctor/system orders get a "requested
  -- for you" message. The template branches on self_booked.
  v_self_booked := (new.origin = 'patient_initiated' and new.ordered_by is null);

  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  select name into v_test_name from public.panel_bundles where id = new.panel_bundle_id;
  v_test_name := coalesce(v_test_name, 'a lab test');
  v_order_ref := coalesce(new.order_number, 'your order');

  -- Email — the required, guaranteed channel.
  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'lab_order_requested_patient',
      jsonb_build_object(
        'to_email',     v_patient_email,
        'patient_name', coalesce(v_patient.full_name, 'there'),
        'order_number', v_order_ref,
        'test_name',    v_test_name,
        'self_booked',  v_self_booked,
        -- New: lets send-pending-notifications fetch and attach the PDF via
        -- /api/internal/notifications/lab-order-request-pdf/{order_id}. Kept
        -- as its own field rather than folded into order_number (a display
        -- string) because the Edge Function needs the real uuid, not the
        -- human-readable reference.
        'order_id',     new.id
      )
    );
  end if;

  -- Best-effort WhatsApp (SMS fallback). Unchanged: no PDF over WhatsApp/SMS,
  -- which is a notification channel, not a document-delivery one.
  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'whatsapp', 'pending',
    'lab_order_requested_patient',
    jsonb_build_object(
      'patient_name', coalesce(v_patient.full_name, 'there'),
      'order_number', v_order_ref,
      'test_name',    v_test_name,
      'self_booked',  v_self_booked
    )
  );

  return new;
end;
$$;

-- Proof runs inside its own sub-transaction, rolled back by deliberately
-- raising a sentinel once it has read what it needs. A first version of this
-- migration ran the same fixture build as a PLAIN insert with no rollback,
-- which committed a throwaway patient, lab order and two notification rows
-- straight into the live database -- caught only because cleaning it up
-- afterwards hit an unrelated audit-trigger defect (private.capture_record_
-- correction fails to delete an auth.users row once its profiles row is
-- already gone). That defect is real and worth a session of its own, but
-- fixing it is out of scope here; not repeating the mistake that exposed it
-- is not.
do $$
declare
  v_org       uuid;
  v_patient   uuid := gen_random_uuid();
  v_bundle    uuid;
  v_order     uuid;
  v_payload   jsonb;
begin
  select organisation_id into v_org
    from public.profiles where role = 'patient' and organisation_id is not null limit 1;
  if v_org is null then
    select id into v_org from public.organisations limit 1;
  end if;
  if v_org is null then
    raise exception 'no organisation exists — cannot run this proof';
  end if;

  select id into v_bundle from public.panel_bundles where self_bookable and is_active limit 1;
  if v_bundle is null then
    raise exception 'no self_bookable bundle exists — cannot run this proof';
  end if;

  begin
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_patient, 'lab-order-pdf-probe-v2@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_patient, v_org, 'patient', 'Lab Order PDF Probe')
    on conflict (id) do update
      set organisation_id = excluded.organisation_id, role = 'patient';

    insert into public.lab_orders
      (organisation_id, patient_id, panel_bundle_id, fulfilment, status, origin, total_kobo)
    values (v_org, v_patient, v_bundle, 'self_arranged', 'ordered', 'patient_initiated', 0)
    returning id into v_order;

    select payload into v_payload
      from public.notifications
     where recipient_id = v_patient and channel = 'email' and template = 'lab_order_requested_patient'
     order by created_at desc limit 1;

    if v_payload is null then
      raise exception 'FAIL: no email notification was enqueued for this lab order.';
    end if;
    if (v_payload->>'order_id')::uuid is distinct from v_order then
      raise exception 'FAIL: payload.order_id (%) does not match the order it was enqueued for (%).',
        v_payload->>'order_id', v_order;
    end if;

    raise exception 'ROLLBACK_PROBE';
  exception when others then
    if sqlerrm <> 'ROLLBACK_PROBE' then
      raise;
    end if;
  end;

  raise notice 'PASS: the lab-order email payload carries order_id, matching the order it belongs to';
end $$;

commit;

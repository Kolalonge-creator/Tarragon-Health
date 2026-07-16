-- Tarragon Health — pharmacy order notifications (medication pathway, Phase 1)
--
-- When a pharmacy order is paid for, two parties must be told immediately:
--   • the patient — a confirmation they can SHOW at the counter (WhatsApp, with
--     SMS fallback, + email), carrying the order number + their patient ID;
--   • the pharmacy — an alert with the patient name, patient number, and order
--     number, so a no-login partner pharmacy can fulfil it without ever opening
--     the dashboard (SMS + email to the contact details on pharmacy_partners).
--
-- This is a notification/confirmation layer only — it never gates the order and
-- never turns an inbound message into a platform action, so it sits squarely
-- inside CLAUDE.md's "WhatsApp/SMS is notifications, never a required interface"
-- rule. Orders are created client-side (useCreatePharmacyOrder, RLS insert), so
-- a DB trigger — not client code — is the trustworthy hook. It fires on the
-- same payment_confirmed transition the commission trigger already uses.
--
-- Rows are enqueued into `notifications`; the existing send-pending-notifications
-- Edge Function (every 5 min) renders + delivers them, with per-row retry and
-- graceful degradation when a channel's credentials are unset. recipient_id is
-- the order's patient for every row (the column is NOT NULL → profiles); the
-- pharmacy's real destination travels in payload.to_phone / payload.to_email,
-- which the dispatcher prefers over the recipient profile's phone.

create or replace function private.enqueue_pharmacy_order_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_items_summary text;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  -- Email lives on auth.users, not profiles — readable here because this
  -- function is SECURITY DEFINER (owned by a role that can see the auth schema).
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.pharmacy_partner_id is not null then
    select * into v_pharmacy from public.pharmacy_partners
      where id = new.pharmacy_partner_id;
  end if;

  -- Short human summary of the order items, e.g. "Metformin 500mg x2, Lisinopril x1".
  select string_agg(
           coalesce(item->>'drug_name', 'item')
             || case
                  when (item->>'quantity') is not null
                  then ' x' || (item->>'quantity')
                  else ''
                end,
           ', ')
    into v_items_summary
  from jsonb_array_elements(new.items) as item;
  v_items_summary := coalesce(v_items_summary, 'your medication');

  -- 1. Patient confirmation — WhatsApp (dispatcher falls back to SMS if the
  --    Meta template is unapproved or the send fails).
  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'whatsapp', 'pending',
    'pharmacy_order_patient_confirmation',
    jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'items_summary',  v_items_summary
    )
  );

  -- 2. Patient confirmation — email (showable at the counter), only if on file.
  if v_patient_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'pharmacy_order_patient_confirmation',
      jsonb_build_object(
        'to_email',       v_patient_email,
        'order_number',   new.order_number,
        'patient_name',   coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number,
        'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
        'items_summary',  v_items_summary
      )
    );
  end if;

  -- 3. Pharmacy alert — SMS, only for partners with a contact phone (this is the
  --    no-login fulfilment path; dashboard pharmacies get it too, harmlessly).
  if v_pharmacy.contact_phone is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'sms', 'pending',
      'pharmacy_order_pharmacy_alert',
      jsonb_build_object(
        'to_phone',       v_pharmacy.contact_phone,
        'pharmacy_name',  v_pharmacy.name,
        'patient_name',   coalesce(v_patient.full_name, 'a patient'),
        'patient_number', v_patient.patient_number,
        'order_number',   new.order_number,
        'items_summary',  v_items_summary
      )
    );
  end if;

  -- 4. Pharmacy alert — email, only for partners with a contact email.
  if v_pharmacy.contact_email is not null then
    insert into public.notifications
      (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending',
      'pharmacy_order_pharmacy_alert',
      jsonb_build_object(
        'to_email',       v_pharmacy.contact_email,
        'pharmacy_name',  v_pharmacy.name,
        'patient_name',   coalesce(v_patient.full_name, 'a patient'),
        'patient_number', v_patient.patient_number,
        'order_number',   new.order_number,
        'items_summary',  v_items_summary
      )
    );
  end if;

  return new;
end;
$$;

-- Same WHEN guard as the commission trigger: fire once, only on the transition
-- into payment_confirmed (never on every subsequent status update).
-- Dropped-then-created so a re-apply is idempotent.
drop trigger if exists pharmacy_orders_enqueue_notifications on public.pharmacy_orders;
create trigger pharmacy_orders_enqueue_notifications
  after update on public.pharmacy_orders
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed')
  execute function private.enqueue_pharmacy_order_notifications();

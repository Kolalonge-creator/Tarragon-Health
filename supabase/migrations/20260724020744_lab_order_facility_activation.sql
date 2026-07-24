-- Closes the "pick a lab near you -> order activates -> lab gets emailed"
-- gap for lab_orders. Two real gaps existed:
-- 1. Clinician-ordered lab_orders (useOrderLabTest) never set facility_id at
--    all -- there was no way for the patient to later choose a specific
--    physical location. Self-service flows (screening calendar, Annual
--    Health Check) already pick a facility before the order is even
--    created; this only closes the clinician-order path.
-- 2. lab_orders had NO partner-facing notification of any kind -- pharmacy
--    is the only order type with one (enqueue_pharmacy_order_notifications).
--    Mirrors that exact pattern: fires on the payment_confirmed transition
--    (never before payment, so a lab is never told to prepare for an unpaid
--    order), gracefully degrades per-channel on whichever contact columns
--    are populated.

alter table public.lab_providers
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

comment on column public.lab_providers.contact_email is
  'Lab-facing notification address (enqueue_lab_order_lab_notifications). .example addresses in seed data -- never sends to a real inbox until a real partner contact is populated.';

-- Backfill seeded partners (real named lab partners, same treatment as
-- pharmacy_partners' seeded contact info) -- idempotent via the null guard.
update public.lab_providers set contact_email = 'labs@synlab.example', contact_phone = '+2348030000101' where name = 'Synlab Nigeria' and contact_email is null;
update public.lab_providers set contact_email = 'labs@cerbalancet.example', contact_phone = '+2348030000102' where name = 'Cerba Lancet' and contact_email is null;
update public.lab_providers set contact_email = 'labs@healthtracka.example', contact_phone = '+2348030000103' where name = 'Healthtracka' and contact_email is null;
update public.lab_providers set contact_email = 'labs@afriglobalmedicare.example', contact_phone = '+2348030000104' where name = 'Afriglobal Medicare' and contact_email is null;

-- Patient (or org staff) chooses a physical facility for an order that
-- doesn't have one yet -- SECURITY DEFINER because lab_orders_update RLS is
-- staff-only (private.is_org_staff), same shape as
-- set_pharmacy_order_delivery_address. Deliberately narrow: only fills a
-- currently-null facility_id, only before payment, so it can never silently
-- redirect an already-paid/in-flight order to a different lab. provider_id
-- is server-derived from the chosen facility, never client-supplied.
create or replace function public.set_lab_order_facility(p_order_id uuid, p_facility_id uuid)
returns public.lab_orders
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.lab_orders%rowtype;
  v_facility public.facilities%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  if v_order.patient_id is distinct from (select auth.uid()) and not private.is_org_staff(v_order.organisation_id) then
    raise exception 'Not authorised to update this lab order' using errcode = '42501';
  end if;

  if v_order.facility_id is not null then
    raise exception 'This order already has a facility chosen' using errcode = '23514';
  end if;

  if v_order.status <> 'pending_payment' then
    raise exception 'A facility can only be chosen before payment' using errcode = '23514';
  end if;

  select * into v_facility from public.facilities where id = p_facility_id and is_active;
  if v_facility.id is null then
    raise exception 'Facility not found' using errcode = '23514';
  end if;
  if v_facility.lab_provider_id is null then
    raise exception 'This facility cannot take lab bookings yet' using errcode = '23514';
  end if;

  update public.lab_orders
    set facility_id = p_facility_id, provider_id = v_facility.lab_provider_id
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.set_lab_order_facility(uuid, uuid) from public;
grant execute on function public.set_lab_order_facility(uuid, uuid) to authenticated;

-- Lab-facing (+ patient confirmation) notifications on payment_confirmed --
-- the lab_orders equivalent of enqueue_pharmacy_order_notifications.
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

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'whatsapp', 'pending', 'lab_order_patient_confirmation',
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

drop trigger if exists lab_orders_enqueue_lab_notifications on public.lab_orders;
create trigger lab_orders_enqueue_lab_notifications
  after update on public.lab_orders
  for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed'::public.lab_order_status)
  execute function private.enqueue_lab_order_lab_notifications();

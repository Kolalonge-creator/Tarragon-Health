-- Tarragon Health — Medication Dispensing & Fulfilment Engine (notifications, part 3/3)
--
-- See 20260829142844_medication_dispensing_fulfilment_schema.sql for the full
-- context. Spec §63.16's acceptance criterion is the point of this file: the
-- patient must be able to know "has my medicine actually been supplied?" —
-- today the ONLY notification anywhere on the pharmacy_orders lifecycle
-- fires on the payment_confirmed transition (pharmacy_order_notifications.sql).
-- Nothing tells the patient afterward that it was actually prepared,
-- shipped, delivered, or couldn't be fulfilled at all.
--
-- One consolidated trigger function (not five) covers every subsequent
-- transition that matters to the patient: dispensed (pickup only — a
-- delivery order gets "out for delivery" instead, no double ping),
-- out_for_delivery, delivered, delivery_failed, and unavailable. Same
-- whatsapp+in_app(+email) fan-out shape as private.enqueue_pharmacy_order_
-- notifications, including the guaranteed in_app companion pattern
-- (20260811235133_guarantee_in_app_notification_companions.sql) — Meta
-- WhatsApp template approval and Termii sender-ID approval are both still
-- pending platform-wide, so in_app is the only channel guaranteed to reach
-- the patient today.

create or replace function private.enqueue_pharmacy_order_fulfilment_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_logistics     public.logistics_partners%rowtype;
  v_items_summary text;
  v_alt_names     text;
  v_failure       public.delivery_failure_reason;
  v_template      text;
  v_payload       jsonb;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.pharmacy_partner_id is not null then
    select * into v_pharmacy from public.pharmacy_partners where id = new.pharmacy_partner_id;
  end if;
  if new.logistics_partner_id is not null then
    select * into v_logistics from public.logistics_partners where id = new.logistics_partner_id;
  end if;

  select string_agg(
           coalesce(item->>'drug_name', 'item')
             || case when (item->>'quantity') is not null then ' x' || (item->>'quantity') else '' end,
           ', ')
    into v_items_summary
  from jsonb_array_elements(new.items) as item;
  v_items_summary := coalesce(v_items_summary, 'your medication');

  if new.status = 'dispensed' then
    if new.fulfilment_method = 'pickup' then
      v_template := 'pharmacy_order_ready_for_collection';
      v_payload := jsonb_build_object(
        'order_number',   new.order_number,
        'patient_name',   coalesce(v_patient.full_name, 'there'),
        'patient_number', v_patient.patient_number,
        'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
        'items_summary',  v_items_summary
      );
    end if;
    -- fulfilment_method = 'delivery': no notification here, out_for_delivery covers it.

  elsif new.status = 'out_for_delivery' then
    v_template := 'pharmacy_order_out_for_delivery';
    v_payload := jsonb_build_object(
      'order_number',          new.order_number,
      'patient_name',          coalesce(v_patient.full_name, 'there'),
      'items_summary',         v_items_summary,
      'courier_name',          coalesce(v_logistics.name, 'your courier'),
      'estimated_delivery_at', new.estimated_delivery_at,
      'requires_cold_chain',   new.requires_cold_chain
    );

  elsif new.status = 'delivered' then
    v_template := 'pharmacy_order_delivered';
    v_payload := jsonb_build_object(
      'order_number',  new.order_number,
      'patient_name',  coalesce(v_patient.full_name, 'there'),
      'items_summary', v_items_summary
    );

  elsif new.status = 'delivery_failed' then
    select failure_reason into v_failure
    from public.pharmacy_order_delivery_attempts
    where pharmacy_order_id = new.id
    order by attempted_at desc
    limit 1;

    v_template := 'pharmacy_order_delivery_failed';
    v_payload := jsonb_build_object(
      'order_number',    new.order_number,
      'patient_name',    coalesce(v_patient.full_name, 'there'),
      'items_summary',   v_items_summary,
      'failure_reason',  coalesce(v_failure::text, 'other')
    );

  elsif new.status = 'unavailable' then
    select string_agg(name, ', ') into v_alt_names
    from (
      select name from public.pharmacy_partners
      where is_active = true
        and id is distinct from new.pharmacy_partner_id
        and (v_pharmacy.regions is null or regions && v_pharmacy.regions)
      order by name
      limit 3
    ) alt;

    v_template := 'pharmacy_order_unavailable';
    v_payload := jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'items_summary',  v_items_summary,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'reason',         coalesce(new.unavailable_reason, ''),
      'alternatives',   coalesce(v_alt_names, '')
    );
  end if;

  if v_template is null then
    return new;
  end if;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'whatsapp', 'pending', v_template, v_payload);

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (new.organisation_id, new.patient_id, 'in_app', 'pending', v_template, v_payload);

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending', v_template,
      v_payload || jsonb_build_object('to_email', v_patient_email)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists pharmacy_orders_enqueue_fulfilment_notifications on public.pharmacy_orders;
create trigger pharmacy_orders_enqueue_fulfilment_notifications
  after update on public.pharmacy_orders
  for each row
  when (
    old.status is distinct from new.status
    and new.status in ('dispensed', 'out_for_delivery', 'delivered', 'delivery_failed', 'unavailable')
  )
  execute function private.enqueue_pharmacy_order_fulfilment_notifications();

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'pharmacy_orders_enqueue_fulfilment_notifications'
  ) then
    raise exception 'pharmacy_orders_enqueue_fulfilment_notifications trigger was not created';
  end if;
  if not exists (
    select 1 from pg_proc
     where proname = 'enqueue_pharmacy_order_fulfilment_notifications' and pronamespace = 'private'::regnamespace
  ) then
    raise exception 'enqueue_pharmacy_order_fulfilment_notifications function was not created';
  end if;
end;
$$;

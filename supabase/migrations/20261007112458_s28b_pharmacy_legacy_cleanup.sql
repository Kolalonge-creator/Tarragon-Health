-- S28b: the three older pharmacy gaps S28 raised (OQ-231, OQ-232), decided by the founder 2026-10-07.
--   OQ-231 Delivery data is no longer readable by patients. Part C.2: collection only, no home delivery. Live counts before this
--          change (checked 2026-10-07): 0 pharmacy_orders, 0 delivery attempts. The patient-facing directory view stops carrying
--          `delivery` and `delivery_fee_kobo`. The columns and the dormant logistics screens are removed in a separate pass (see the
--          progress note): that is a feature removal across about fifteen files, not a read-path fix.
--   OQ-232 The older pharmacist reads are audited (INV-10), the three legacy tables carry is_test (INV-13), and the order alert to a
--          pharmacy is the neutral in-app message instead of an SMS and an email that named the patient (INV-07, INV-08).
-- Live bodies of every replaced function were read with pg_get_functiondef on 2026-10-07; each change is marked S28b.

-- ---------------------------------------------------------------------------
-- 1. OQ-231: the directory view without delivery
-- ---------------------------------------------------------------------------
drop view public.pharmacy_partner_directory;
create view public.pharmacy_partner_directory
  with (security_invoker = false)
  as
  select id, name, regions, is_active, address, latitude, longitude, state, city, area,
         license_type, license_number, license_expires_at, license_verified_at
    from public.pharmacy_partners;
comment on view public.pharmacy_partner_directory is
  'The patient-, clinician- and finance-facing window onto pharmacy_partners. Licence and location columns only. S28b: no delivery or delivery-fee column (Part C.2). Never business_registration_number, contact details or onboarding columns. Owner-run on purpose (no security_invoker), same exception as lab_provider_directory.';
revoke all on public.pharmacy_partner_directory from public, anon;
grant select on public.pharmacy_partner_directory to authenticated;
grant select on public.pharmacy_partner_directory to service_role;

-- ---------------------------------------------------------------------------
-- 2. OQ-232 (INV-13): is_test on the three older tables, stamped from the patient
-- ---------------------------------------------------------------------------
alter table public.pharmacy_orders add column is_test boolean not null default false;
alter table public.pharmacy_order_dispenses add column is_test boolean not null default false;
alter table public.medication_dispense_flags add column is_test boolean not null default false;

update public.pharmacy_orders t set is_test = true from public.profiles p where p.id = t.patient_id and p.is_test;
update public.pharmacy_order_dispenses t set is_test = true from public.profiles p where p.id = t.patient_id and p.is_test;
update public.medication_dispense_flags t set is_test = true from public.profiles p where p.id = t.patient_id and p.is_test;

create function private.stamp_pharmacy_is_test() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- a row about a test patient is a test row, whoever writes it and whatever they pass
  new.is_test := coalesce(new.is_test, false) or coalesce((select p.is_test from public.profiles p where p.id = new.patient_id), false);
  return new;
end $$;
revoke all on function private.stamp_pharmacy_is_test() from public, anon, authenticated;
create trigger pharmacy_orders_stamp_is_test before insert on public.pharmacy_orders for each row execute function private.stamp_pharmacy_is_test();
create trigger pharmacy_order_dispenses_stamp_is_test before insert on public.pharmacy_order_dispenses for each row execute function private.stamp_pharmacy_is_test();
create trigger medication_dispense_flags_stamp_is_test before insert on public.medication_dispense_flags for each row execute function private.stamp_pharmacy_is_test();

-- ---------------------------------------------------------------------------
-- 3. OQ-232 (INV-10): the older pharmacist reads leave an audit row
-- ---------------------------------------------------------------------------
create or replace function public.pharmacist_orders()
returns table(order_id uuid, order_number text, status text, patient_name text, patient_number text, items jsonb, requested_at timestamp with time zone,
              payable_kobo bigint, confirmed_quantity text, confirmed_price_kobo bigint, estimated_fulfilment_at timestamp with time zone, cancellation_reason text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_partner uuid := private.pharmacist_partner();
begin
  if v_partner is null then return; end if;
  perform private.log_audit('pharmacist.orders_read', 'pharmacy_orders', null, jsonb_build_object('pharmacy_partner_id', v_partner));
  return query
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number, o.items, o.requested_at,
         coalesce(o.payable_kobo, o.total_kobo), o.confirmed_quantity, o.confirmed_price_kobo,
         o.estimated_fulfilment_at, o.cancellation_reason
    from public.pharmacy_orders o join public.profiles p on p.id = o.patient_id
   where o.pharmacy_partner_id = v_partner
   order by o.requested_at desc;
end $$;

create or replace function public.pharmacist_order_allergies(p_order_id uuid)
returns table(allergen text, reaction text, severity text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_patient uuid;
begin
  select o.patient_id into v_patient from public.pharmacy_orders o where o.id = p_order_id and o.pharmacy_partner_id = private.pharmacist_partner();
  if v_patient is null then return; end if;
  perform private.log_audit('pharmacist.order_allergies_read', 'pharmacy_orders', p_order_id, '{}'::jsonb);
  return query select a.allergen, a.reaction, a.severity::text from public.patient_allergies a where a.patient_id = v_patient order by a.allergen;
end $$;

create or replace function public.pharmacist_order_medications(p_order_id uuid)
returns table(drug_name text, dose text, frequency text)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare v_patient uuid;
begin
  select o.patient_id into v_patient from public.pharmacy_orders o where o.id = p_order_id and o.pharmacy_partner_id = private.pharmacist_partner();
  if v_patient is null then return; end if;
  perform private.log_audit('pharmacist.order_medications_read', 'pharmacy_orders', p_order_id, '{}'::jsonb);
  return query select m.drug_name, m.dose, m.frequency from public.medications m where m.is_active and m.patient_id = v_patient order by m.drug_name;
end $$;

create or replace function public.pharmacist_record_dispense(
  p_order_id uuid, p_drug_name text, p_quantity text, p_dispensed_on date, p_quantity_prescribed text default null::text, p_is_partial boolean default false,
  p_outstanding_note text default null::text, p_batch_number text default null::text, p_substituted_for text default null::text, p_substitution_reason text default null::text,
  p_controlled_tier text default null::text, p_enhanced_verification_confirmed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();
  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if coalesce(btrim(p_drug_name), '') = '' then
    raise exception 'Drug name is required' using errcode = '22023';
  end if;
  if p_controlled_tier is not null and not p_enhanced_verification_confirmed then
    raise exception 'Controlled/restricted medicines require the enhanced-verification confirmation' using errcode = '22023';
  end if;

  insert into public.pharmacy_order_dispenses
    (organisation_id, patient_id, pharmacy_order_id, drug_name, quantity, dispensed_on, source, recorded_by,
     quantity_prescribed, is_partial, outstanding_note, batch_number,
     substituted_for, substitution_reason, controlled_tier, enhanced_verification_confirmed)
  values
    (v_order.organisation_id, v_order.patient_id, p_order_id, btrim(p_drug_name),
     nullif(btrim(coalesce(p_quantity, '')), ''), coalesce(p_dispensed_on, current_date),
     'pharmacy', (select auth.uid()),
     nullif(btrim(coalesce(p_quantity_prescribed, '')), ''), coalesce(p_is_partial, false),
     nullif(btrim(coalesce(p_outstanding_note, '')), ''), nullif(btrim(coalesce(p_batch_number, '')), ''),
     nullif(btrim(coalesce(p_substituted_for, '')), ''), nullif(btrim(coalesce(p_substitution_reason, '')), ''),
     nullif(btrim(coalesce(p_controlled_tier, '')), ''), coalesce(p_enhanced_verification_confirmed, false));

  if v_order.status in ('requested', 'confirmed', 'unavailable') then
    update public.pharmacy_orders set status = 'dispensed' where id = p_order_id;
  end if;
  perform private.log_audit('pharmacist.dispense_recorded', 'pharmacy_orders', p_order_id, jsonb_build_object('partial', coalesce(p_is_partial, false)));
end;
$$;

-- verify_prescription was STABLE; an audited read cannot be. The returned columns and the rule that only a pharmacist gets an answer are unchanged.
create or replace function public.verify_prescription(p_rx_number text, p_verification_code text)
returns table(drug_name text, dose text, frequency text, route text, quantity text, duration_days integer, repeats_allowed integer, repeats_used integer, indication text,
              instructions text, status text, signed_at timestamp with time zone, expires_at timestamp with time zone, version integer, prescriber_name text, patient_name text)
language plpgsql security definer set search_path = '' as $$
declare
  v_med public.medications%rowtype;
  v_prescriber text;
  v_patient text;
  v_used integer;
begin
  if (select p.role from public.profiles p where p.id = (select auth.uid())) <> 'pharmacist' then
    return;
  end if;

  select * into v_med
  from public.medications m
  where m.rx_number = btrim(p_rx_number)
    and m.verification_code = upper(btrim(coalesce(p_verification_code, '')))
    and m.source = 'clinician';

  if v_med.id is null then
    return;
  end if;
  perform private.log_audit('pharmacist.prescription_verified', 'medications', v_med.id, '{}'::jsonb);

  select full_name into v_prescriber from public.profiles where id = v_med.added_by;
  select full_name into v_patient from public.profiles where id = v_med.patient_id;

  -- Table alias + qualified columns required: this function's own RETURNS TABLE clause implicitly declares a plpgsql variable named
  -- `status` (among others), which would otherwise collide with medication_repeat_requests.status ("column reference status is ambiguous").
  select count(*) into v_used
  from public.medication_repeat_requests mrr
  where mrr.medication_id = v_med.id and mrr.status = 'approved';

  return query select
    v_med.drug_name, v_med.dose, v_med.frequency, v_med.route, v_med.quantity,
    v_med.duration_days, v_med.repeats_allowed, coalesce(v_used, 0),
    v_med.indication, v_med.instructions,
    case
      when v_med.superseded_at is not null then 'superseded'
      when v_med.expires_at is not null and v_med.expires_at < now() then 'expired'
      when not v_med.is_active then 'cancelled'
      else 'active'
    end,
    v_med.created_at, v_med.expires_at, v_med.version,
    coalesce(v_prescriber, 'Tarragon care team'), coalesce(v_patient, 'Unknown patient');
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. OQ-232 (INV-07, INV-08): the order alert to a pharmacy is the neutral in-app message
--    Before: an SMS and an email naming the patient, her number and the medicines. Now: one in-app notice to the pharmacy's pharmacists.
--    The patient's own confirmations are unchanged.
-- ---------------------------------------------------------------------------
create or replace function private.enqueue_pharmacy_order_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_items_summary text;
begin
  select * into v_patient from public.profiles where id = new.patient_id;
  select email into v_patient_email from auth.users where id = new.patient_id;

  if new.pharmacy_partner_id is not null then
    select * into v_pharmacy from public.pharmacy_partners where id = new.pharmacy_partner_id;
  end if;

  select string_agg(
           coalesce(item->>'drug_name', 'item')
             || case when (item->>'quantity') is not null then ' x' || (item->>'quantity') else '' end,
           ', ')
    into v_items_summary
  from jsonb_array_elements(new.items) as item;
  v_items_summary := coalesce(v_items_summary, 'your medication');

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending',
    'pharmacy_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'), 'patient_number', v_patient.patient_number,
                       'pharmacy_name', coalesce(v_pharmacy.name, 'the pharmacy'), 'items_summary', v_items_summary));

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    new.organisation_id, new.patient_id, 'in_app', 'pending', 'pharmacy_order_patient_confirmation',
    jsonb_build_object('order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'), 'patient_number', v_patient.patient_number,
                       'pharmacy_name', coalesce(v_pharmacy.name, 'the pharmacy'), 'items_summary', v_items_summary));

  if v_patient_email is not null then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (
      new.organisation_id, new.patient_id, 'email', 'pending', 'pharmacy_order_patient_confirmation',
      jsonb_build_object('to_email', v_patient_email, 'order_number', new.order_number, 'patient_name', coalesce(v_patient.full_name, 'there'),
                         'patient_number', v_patient.patient_number, 'pharmacy_name', coalesce(v_pharmacy.name, 'the pharmacy'), 'items_summary', v_items_summary));
  end if;

  -- S28b: neutral, in-app, to the pharmacy's own pharmacists. Names no person, number or medicine; the pharmacist opens the order in the app.
  if new.pharmacy_partner_id is not null then
    if exists (select 1 from public.profiles pr where pr.pharmacy_partner_id = new.pharmacy_partner_id and pr.role = 'pharmacist' and pr.is_active) then
      perform private.rx_notify_pharmacy(new.pharmacy_partner_id, 'pharmacy_collection_waiting');
    elsif v_pharmacy.contact_email is not null then
      -- A partner with no login in the app must still hear about a paid order. Email only (never SMS, INV-08), and nothing about the
      -- patient or the medicines: the payload carries placeholders in place of her name, number and items.
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (new.organisation_id, new.patient_id, 'email', 'pending', 'pharmacy_order_pharmacy_alert',
              jsonb_build_object('to_email', v_pharmacy.contact_email, 'pharmacy_name', v_pharmacy.name, 'patient_name', 'a patient',
                                 'patient_number', null, 'order_number', new.order_number, 'items_summary', 'a new order'));
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Assertions
-- ---------------------------------------------------------------------------
do $$
declare c text;
begin
  foreach c in array array['delivery', 'delivery_fee_kobo'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_partner_directory' and column_name = c) then
      raise exception 'the directory view still carries %', c;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.pharmacy_partner_directory', 'SELECT') then raise exception 'anon can read the directory view'; end if;
  foreach c in array array['public.pharmacist_orders()', 'public.pharmacist_order_allergies(uuid)', 'public.pharmacist_order_medications(uuid)', 'public.verify_prescription(text,text)'] loop
    if has_function_privilege('anon', c, 'EXECUTE') then raise exception 'anon can execute %', c; end if;
  end loop;
  if (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'is_test'
        and table_name in ('pharmacy_orders', 'pharmacy_order_dispenses', 'medication_dispense_flags')) <> 3 then
    raise exception 'is_test missing on a legacy pharmacy table';
  end if;
end $$;

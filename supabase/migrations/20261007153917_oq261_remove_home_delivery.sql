-- OQ-261 (v5 spec Part C.2): no home delivery. Collection only. Removal pass that S28b left for later.
-- Pattern: OQ-16 count-first removal. Live counts on koiplnmbgnqnbywhpjlf, 2026-10-07, before this change:
--   pharmacy_orders                        0 rows
--   pharmacy_order_delivery_attempts       0 rows
--   pharmacy_orders with 'delivery' fulfilment, or any out_for_delivery / delivery_failed / delivered status   0
--   notifications on the three delivery templates                                  0
--   pharmacy_partners                      4 rows, all with delivery = true (the column default), 0 with any delivery_fee_kobo set
-- With no order and no attempt row there is nothing to convert; this is a structural change only.
--
-- REMOVED
--   pharmacy_partners:        delivery, delivery_fee_kobo
--   pharmacy_orders:          delivery_address, estimated_delivery_at, delivery_confirmed_at, delivered_at, logistics_partner_id, fulfilment_method
--   table:                    pharmacy_order_delivery_attempts
--   functions:                set_pharmacy_order_delivery_address, record_pharmacy_delivery_attempt,
--                             private.record_delivery_commission, private.enforce_logistics_partner_active
--   enum values / types:      pharmacy_order_status loses out_for_delivery, delivery_failed, delivered;
--                             types pharmacy_fulfilment_method, delivery_attempt_result, delivery_failure_reason dropped
--   pharmacist_update_profile loses its p_delivery argument
--   match_pharmacy_partner_statement, ops_exception_queue, ops_today_summary and pharmacist_flag_unavailable stop naming the removed statuses
--   (the ops queue label becomes 'Dispensed but not collected')
--
-- DELIBERATELY KEPT (founder 2026-10-07: logistics and direct pharmacy ordering are not in the MVP and must be easy to switch on
-- once a partner exists; the patient takes the prescription PDF to their own pharmacy):
--   public.logistics_partners and its permissions, directory readers, region 'delivery' service type and licence-expiry alert
--     (inactive placeholder row only, nothing patient-facing reads it)
--   pharmacy_orders.courier_reference, courier_assigned_at, requires_cold_chain (outside the OQ-261 list)
--   pharmacy_orders, pharmacy_partners, the catalogue, collection and dispensing flows: untouched apart from the delivery parts
-- Switching logistics on later means adding order-side columns and the delivery states back in a new migration; the partner directory
-- does not have to be rebuilt.
--
-- Live bodies of every replaced function and trigger were read with pg_get_functiondef / pg_get_triggerdef on 2026-10-07. Each
-- change is marked OQ-261. Ship the app code first: nothing in the code may read or write a dropped column when this runs.

-- ---------------------------------------------------------------------------
-- 0. The patient-facing directory view must not depend on the columns being dropped. Live already has it without delivery (the rebuilt S28
--    did that); a fresh replay of main-dev may still carry them, so rebuild it only when it does (same column list as live, same grants).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_partner_directory' and column_name in ('delivery', 'delivery_fee_kobo')) then
    drop view public.pharmacy_partner_directory;
    create view public.pharmacy_partner_directory
      with (security_invoker = false)
      as
      select id, name, regions, is_active, address, latitude, longitude, state, city, area,
             license_type, license_number, license_expires_at, license_verified_at
        from public.pharmacy_partners;
    comment on view public.pharmacy_partner_directory is
      'The patient-, clinician- and finance-facing window onto pharmacy_partners. Licence and location columns only. OQ-261: no delivery or delivery-fee column (Part C.2). Never business_registration_number, contact details or onboarding columns. Owner-run on purpose (no security_invoker), same exception as lab_provider_directory.';
    revoke all on public.pharmacy_partner_directory from public, anon;
    grant select on public.pharmacy_partner_directory to authenticated;
    grant select on public.pharmacy_partner_directory to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Triggers that depend on the dropped columns or on the status enum (recreated below where they still apply)
-- ---------------------------------------------------------------------------
drop trigger pharmacy_orders_enforce_logistics_partner_active on public.pharmacy_orders;
drop trigger pharmacy_orders_record_delivery_commission on public.pharmacy_orders;
drop trigger pharmacy_orders_enqueue_fulfilment_notifications on public.pharmacy_orders;
drop trigger pharmacy_orders_enqueue_notifications on public.pharmacy_orders;
drop trigger pharmacy_orders_enqueue_response_notifications on public.pharmacy_orders;
drop trigger pharmacy_orders_record_commission on public.pharmacy_orders;
drop trigger pharmacy_orders_snapshot_partner_cost on public.pharmacy_orders;

-- ---------------------------------------------------------------------------
-- 2. Functions that only the delivery flow used
-- ---------------------------------------------------------------------------
drop function public.set_pharmacy_order_delivery_address(uuid, jsonb);
drop function public.record_pharmacy_delivery_attempt(uuid, text, text, text);
drop function private.record_delivery_commission();
drop function private.enforce_logistics_partner_active();

-- ---------------------------------------------------------------------------
-- 3. Functions rewritten so none reads a dropped column or value
-- ---------------------------------------------------------------------------
-- The order status notification: collection only, no courier branch, no delivery states.
create or replace function private.enqueue_pharmacy_order_fulfilment_notifications()
returns trigger language plpgsql security definer set search_path to '' as $function$
declare
  v_patient       public.profiles%rowtype;
  v_patient_email text;
  v_pharmacy      public.pharmacy_partners%rowtype;
  v_items_summary text;
  v_alt_names     text;
  v_template      text;
  v_payload       jsonb;
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

  if new.status = 'dispensed' then
    -- OQ-261: every order is collected, so a dispensed order is always ready for collection
    v_template := 'pharmacy_order_ready_for_collection';
    v_payload := jsonb_build_object(
      'order_number',   new.order_number,
      'patient_name',   coalesce(v_patient.full_name, 'there'),
      'patient_number', v_patient.patient_number,
      'pharmacy_name',  coalesce(v_pharmacy.name, 'the pharmacy'),
      'items_summary',  v_items_summary
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
  values (new.organisation_id, new.patient_id, private.patient_reminder_channel(new.patient_id, false), 'pending', v_template, v_payload);

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
$function$;

-- Operations summary: the pharmacy block counted deliveries by delivered_at; it now counts dispensed orders.
-- There is no dispensed-at column on pharmacy_orders, so no turnaround figure is invented for pharmacy (the key is optional in the app schema).
create or replace function public.analytics_operations_summary()
returns jsonb language plpgsql stable security definer set search_path to '' as $function$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'target_ratio', 120,
    'clinician_load', (
      select coalesce(jsonb_agg(jsonb_build_object('clinician', name, 'tier', tier, 'patients', patients) order by patients desc), '[]'::jsonb)
      from (
        select coalesce(cs.full_name, p.full_name, 'Unknown') name, cs.doctor_tier::text tier, count(*) patients
        from public.care_team_assignment cta
        left join public.profiles p on p.id = cta.clinician_id
        left join public.clinical_staff cs on cs.profile_id = cta.clinician_id
        group by coalesce(cs.full_name, p.full_name, 'Unknown'), cs.doctor_tier
      ) t
    ),
    'over_target', (select count(*) from (select cta.clinician_id, count(*) c from public.care_team_assignment cta group by cta.clinician_id having count(*) > 120) x),
    'escalation_queue', (select coalesce(jsonb_agg(jsonb_build_object('level', level, 'open', c) order by c desc), '[]'::jsonb)
      from (select level::text level, count(*) c from public.clinician_alerts where status='open' group by level) t),
    'orders', jsonb_build_object(
      'lab', (select jsonb_build_object('total', count(*), 'completed', count(*) filter (where resulted_at is not null),
        'avg_turnaround_hours', coalesce(round(avg(extract(epoch from (resulted_at - ordered_at))/3600.0) filter (where resulted_at is not null and ordered_at is not null)::numeric, 1), 0))
        from public.lab_orders),
      'pharmacy', (select jsonb_build_object('total', count(*), 'dispensed', count(*) filter (where status = 'dispensed'))
        from public.pharmacy_orders),
      'referral', (select jsonb_build_object('total', count(*), 'confirmed', count(*) filter (where booking_confirmed_at is not null)) from public.specialist_referrals)
    )
  );
end; $function$;

-- Provider-organisation order queue: the returned delivered_at column goes (return type changes, so drop and recreate).
drop function public.provider_org_pharmacy_order_queue(uuid);
create function public.provider_org_pharmacy_order_queue(p_organisation_id uuid)
returns table(order_id uuid, order_number text, status text, patient_name text, patient_number text, total_kobo bigint, requested_at timestamp with time zone)
language sql stable security definer set search_path to '' as $function$
  select o.id, o.order_number, o.status::text, p.full_name, p.patient_number,
         o.total_kobo, o.requested_at
  from public.pharmacy_orders o
  join public.profiles p on p.id = o.patient_id
  join public.pharmacy_partners pp on pp.id = o.pharmacy_partner_id
  where private.is_provider_org_staff_for(p_organisation_id)
    and pp.organisation_id = p_organisation_id
    and o.status <> 'pending_payment'
  order by o.requested_at desc;
$function$;
revoke all on function public.provider_org_pharmacy_order_queue(uuid) from public, anon;
grant execute on function public.provider_org_pharmacy_order_queue(uuid) to authenticated, service_role;

-- Pharmacist profile: no delivery argument (signature changes, so drop and recreate).
drop function public.pharmacist_update_profile(text, text[], text, text, text, text, boolean, text, timestamp with time zone);
create function public.pharmacist_update_profile(p_name text, p_regions text[], p_city text, p_state text, p_contact_phone text, p_contact_email text, p_license_number text, p_license_expires_at timestamp with time zone)
returns void language plpgsql security definer set search_path to '' as $function$
declare
  v_partner_id uuid := private.pharmacist_partner();
begin
  if v_partner_id is null then
    raise exception 'Not a partner pharmacy account' using errcode = '42501';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Pharmacy name is required' using errcode = '22023';
  end if;

  update public.pharmacy_partners
  set name = btrim(p_name),
      regions = coalesce(p_regions, '{}'),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state = nullif(btrim(coalesce(p_state, '')), ''),
      contact_phone = nullif(btrim(coalesce(p_contact_phone, '')), ''),
      contact_email = nullif(btrim(coalesce(p_contact_email, '')), ''),
      license_number = nullif(btrim(coalesce(p_license_number, '')), ''),
      license_expires_at = p_license_expires_at
  where id = v_partner_id;
end;
$function$;
revoke all on function public.pharmacist_update_profile(text, text[], text, text, text, text, text, timestamp with time zone) from public, anon;
grant execute on function public.pharmacist_update_profile(text, text[], text, text, text, text, text, timestamp with time zone) to authenticated, service_role;

-- A sponsor's refill request: the order is a collection order by construction, so it no longer names a fulfilment method.
create or replace function public.sponsor_request_refill(p_beneficiary uuid, p_medication_id uuid)
returns uuid language plpgsql security definer set search_path to '' as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_drug text;
  v_med record;
  v_order_id uuid;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;

  if not private.can_act_for(p_beneficiary, 'manage_pharmacy'::public.caregiver_permission) then
    raise exception 'you do not have permission to act for this person'
      using errcode = '42501';
  end if;

  select m.organisation_id, m.drug_name
    into v_org, v_drug
    from public.medications m
   where m.id = p_medication_id
     and m.patient_id = p_beneficiary
     and m.is_active
     and m.source in ('clinician', 'specialist');

  if v_drug is null then
    raise exception 'that is not a current prescribed medication for this person'
      using errcode = '22023';
  end if;

  select pm.id, pm.drug_name, pm.pack_size, pm.price_kobo, pm.pharmacy_partner_id
    into v_med
    from public.pharmacy_medications pm
    join public.pharmacy_partners pp on pp.id = pm.pharmacy_partner_id
   where pm.drug_name ilike v_drug
     and pm.price_kobo > 0
     and pp.is_active
   order by pm.price_kobo asc
   limit 1;

  if v_med.id is null then
    raise exception 'no pharmacy in the network lists % yet', v_drug
      using errcode = '22023';
  end if;

  select po.id into v_order_id
    from public.pharmacy_orders po
   where po.patient_id = p_beneficiary
     and po.status = 'pending_payment'
     and po.items @> jsonb_build_array(jsonb_build_object('medication_id', v_med.id))
   limit 1;

  if v_order_id is not null then
    return v_order_id;
  end if;

  insert into public.pharmacy_orders (
    organisation_id, patient_id, pharmacy_partner_id, items, total_kobo, status
  ) values (
    v_org, p_beneficiary, v_med.pharmacy_partner_id,
    jsonb_build_array(jsonb_build_object(
      'medication_id', v_med.id,
      'drug_name', v_med.drug_name,
      'pack_size', v_med.pack_size,
      'price_kobo', v_med.price_kobo,
      'quantity', 1
    )),
    v_med.price_kobo, 'pending_payment'
  ) returning id into v_order_id;

  perform private.log_care_access(
    p_beneficiary, 'acted_for', 'refill_request',
    jsonb_build_object('medication_id', p_medication_id, 'order_id', v_order_id)
  );

  return v_order_id;
end;
$function$;

-- Four older functions test pharmacy_orders.status against literals that are about to stop existing in the enum; once a value is gone a
-- comparison to it raises "invalid input value for enum". Their bodies are long and otherwise right, so each is patched from its own live
-- definition (CREATE OR REPLACE keeps owner, search_path and grants) and the migration fails if a pattern is not found exactly once.
create function pg_temp.oq261_patch(p_sig regprocedure, p_old text, p_new text) returns void language plpgsql as $f$
declare v_def text := pg_get_functiondef(p_sig); v_new text;
begin
  if (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old) <> 1 then
    raise exception 'OQ-261: expected exactly one "%" in %, found %', p_old, p_sig, (length(v_def) - length(replace(v_def, p_old, ''))) / length(p_old);
  end if;
  v_new := replace(v_def, p_old, p_new);
  execute v_new;
end $f$;

select pg_temp.oq261_patch('public.match_pharmacy_partner_statement(uuid)'::regprocedure,
  $a$'dispensed', 'out_for_delivery', 'delivered')$a$, $b$'dispensed')$b$);
select pg_temp.oq261_patch('public.ops_exception_queue(text,integer)'::regprocedure,
  $a$when 'dispensed' then 'Dispensed but not delivered'$a$, $b$when 'dispensed' then 'Dispensed but not collected'$b$);
select pg_temp.oq261_patch('public.ops_exception_queue(text,integer)'::regprocedure,
  $a$else 'Delivery in progress too long'$a$, $b$else 'Dispensed but not collected'$b$);
select pg_temp.oq261_patch('public.ops_exception_queue(text,integer)'::regprocedure,
  $a$'dispensed', 'out_for_delivery')$a$, $b$'dispensed')$b$);
select pg_temp.oq261_patch('public.ops_today_summary()'::regprocedure,
  $a$'dispensed', 'out_for_delivery')$a$, $b$'dispensed')$b$);
select pg_temp.oq261_patch('public.pharmacist_flag_unavailable(uuid,text)'::regprocedure,
  $a$('dispensed', 'out_for_delivery', 'delivered', 'delivery_failed', 'cancelled')$a$, $b$('dispensed', 'cancelled')$b$);

-- ---------------------------------------------------------------------------
-- 4. The attempts table (0 rows), then the columns
-- ---------------------------------------------------------------------------
drop table public.pharmacy_order_delivery_attempts;

alter table public.pharmacy_orders
  drop column delivery_address,
  drop column estimated_delivery_at,
  drop column delivery_confirmed_at,
  drop column delivered_at,
  drop column logistics_partner_id,
  drop column fulfilment_method;

alter table public.pharmacy_partners
  drop column delivery,
  drop column delivery_fee_kobo;

-- ---------------------------------------------------------------------------
-- 5. Enum values and types. Dropping values means rebuilding pharmacy_order_status (no order uses a delivery state: count above).
-- ---------------------------------------------------------------------------
drop type public.pharmacy_fulfilment_method;
drop type public.delivery_attempt_result;
drop type public.delivery_failure_reason;

alter table public.pharmacy_orders alter column status drop default;
alter type public.pharmacy_order_status rename to pharmacy_order_status_old;
create type public.pharmacy_order_status as enum
  ('pending_payment', 'payment_confirmed', 'requested', 'confirmed', 'unavailable', 'dispensed', 'cancelled');
alter table public.pharmacy_orders
  alter column status type public.pharmacy_order_status using status::text::public.pharmacy_order_status;
alter table public.pharmacy_orders alter column status set default 'requested'::public.pharmacy_order_status;
drop type public.pharmacy_order_status_old;

-- ---------------------------------------------------------------------------
-- 6. The status-driven triggers, recreated exactly as they were except the notification one (no delivery states in its WHEN)
-- ---------------------------------------------------------------------------
create trigger pharmacy_orders_enqueue_fulfilment_notifications after update on public.pharmacy_orders for each row
  when (old.status is distinct from new.status and new.status = any (array['dispensed'::public.pharmacy_order_status, 'unavailable'::public.pharmacy_order_status]))
  execute function private.enqueue_pharmacy_order_fulfilment_notifications();
create trigger pharmacy_orders_enqueue_notifications after update on public.pharmacy_orders for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed'::public.pharmacy_order_status)
  execute function private.enqueue_pharmacy_order_notifications();
create trigger pharmacy_orders_enqueue_response_notifications after update on public.pharmacy_orders for each row
  when (old.status is distinct from new.status and new.status = any (array['confirmed'::public.pharmacy_order_status, 'cancelled'::public.pharmacy_order_status]))
  execute function private.enqueue_pharmacy_order_response_notifications();
create trigger pharmacy_orders_record_commission after update on public.pharmacy_orders for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed'::public.pharmacy_order_status)
  execute function private.record_pharmacy_commission();
create trigger pharmacy_orders_snapshot_partner_cost before update on public.pharmacy_orders for each row
  when (old.status is distinct from new.status and new.status = 'payment_confirmed'::public.pharmacy_order_status)
  execute function private.snapshot_pharmacy_order_partner_cost();

-- ---------------------------------------------------------------------------
-- 7. Assertions: "removed" is provable, not hopeful
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- columns gone
  select string_agg(table_name || '.' || column_name, ', ') into v_bad from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'pharmacy_orders' and column_name in ('delivery_address', 'estimated_delivery_at', 'delivery_confirmed_at', 'delivered_at', 'logistics_partner_id', 'fulfilment_method'))
       or (table_name = 'pharmacy_partners' and column_name in ('delivery', 'delivery_fee_kobo')));
  if v_bad is not null then raise exception 'OQ-261: columns still present: %', v_bad; end if;

  -- table, types and functions gone
  if to_regclass('public.pharmacy_order_delivery_attempts') is not null then raise exception 'OQ-261: attempts table still present'; end if;
  if exists (select 1 from pg_type where typnamespace = 'public'::regnamespace and typname in ('pharmacy_fulfilment_method', 'delivery_attempt_result', 'delivery_failure_reason', 'pharmacy_order_status_old')) then
    raise exception 'OQ-261: a delivery type is still present';
  end if;
  select string_agg(p.proname, ', ') into v_bad from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.proname in ('set_pharmacy_order_delivery_address', 'record_pharmacy_delivery_attempt', 'record_delivery_commission', 'enforce_logistics_partner_active');
  if v_bad is not null then raise exception 'OQ-261: functions still present: %', v_bad; end if;
  if exists (select 1 from pg_trigger where tgrelid = 'public.pharmacy_orders'::regclass and tgname in ('pharmacy_orders_enforce_logistics_partner_active', 'pharmacy_orders_record_delivery_commission')) then
    raise exception 'OQ-261: a delivery trigger is still present';
  end if;

  -- the status enum is exactly the collection set, and the five status triggers are back
  select string_agg(enumlabel, ',' order by enumsortorder) into v_bad from pg_enum where enumtypid = 'public.pharmacy_order_status'::regtype;
  if v_bad is distinct from 'pending_payment,payment_confirmed,requested,confirmed,unavailable,dispensed,cancelled' then raise exception 'OQ-261: status enum is %', v_bad; end if;
  if (select count(*) from pg_trigger where tgrelid = 'public.pharmacy_orders'::regclass and tgname in
      ('pharmacy_orders_enqueue_fulfilment_notifications', 'pharmacy_orders_enqueue_notifications', 'pharmacy_orders_enqueue_response_notifications', 'pharmacy_orders_record_commission', 'pharmacy_orders_snapshot_partner_cost')) <> 5 then
    raise exception 'OQ-261: a status trigger was not recreated';
  end if;

  -- no live function body still names a dropped thing
  select string_agg(p.oid::regprocedure::text, ', ') into v_bad from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~* '(pharmacy_order_delivery_attempts|pharmacy_fulfilment_method|delivery_failure_reason|delivery_attempt_result|out_for_delivery|delivery_failed|delivery_confirmed_at|estimated_delivery_at|delivery_address|fulfilment_method|logistics_partner_id|pharmacy_orders[^;]*delivered_at)';
  if v_bad is not null then raise exception 'OQ-261: functions still name a removed object: %', v_bad; end if;

  -- what is kept is still there
  if to_regclass('public.logistics_partners') is null then raise exception 'OQ-261: logistics_partners must stay (dormant)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'pharmacy_orders' and column_name in ('courier_reference', 'courier_assigned_at', 'requires_cold_chain') having count(*) = 3) then
    raise exception 'OQ-261: courier and cold-chain columns must stay';
  end if;

  -- the recreated functions are not callable by anon or public
  if has_function_privilege('anon', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE')
     or has_function_privilege('anon', 'public.provider_org_pharmacy_order_queue(uuid)', 'EXECUTE') then
    raise exception 'OQ-261: a recreated function is callable by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.pharmacist_update_profile(text,text[],text,text,text,text,text,timestamp with time zone)', 'EXECUTE') then
    raise exception 'OQ-261: pharmacist_update_profile lost its authenticated grant';
  end if;
end $$;

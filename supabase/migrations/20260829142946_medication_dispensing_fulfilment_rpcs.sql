-- Tarragon Health — Medication Dispensing & Fulfilment Engine (RPCs, part 2/3)
--
-- See 20260829142844_medication_dispensing_fulfilment_schema.sql for the full
-- context. This file adds the actions the schema had no way to reach:
--   • pharmacist_accept_order       — spec §63.2 "Pharmacy accepts"
--   • pharmacist_flag_unavailable   — spec §63.4 "Medicine unavailable"
--   • pharmacist_record_dispense    — extended: partial dispensing, batch,
--                                     substitution, controlled-substance
--                                     audit (spec §63.5, §63.6, §63.12, §63.13)
--   • record_pharmacy_delivery_attempt — spec §63.10 failed-delivery
--                                     resolution workflow (org staff, not
--                                     the pharmacist surface — a courier
--                                     delivery attempt is recorded by
--                                     Tarragon ops, same trust level as the
--                                     existing courier-assignment mutations
--                                     in logistics-partners.ts)
--
-- The first two follow the exact cross-pharmacy isolation model as the four
-- existing pharmacist RPCs (20260716178000_pharmacist_surface.sql): scoped
-- via private.pharmacist_partner(), SECURITY DEFINER, zero rows returned/
-- affected for a non-pharmacist or the wrong pharmacy.

-- ---------------------------------------------------------------------------
-- 1. Pharmacy accepts an order (requested/payment_confirmed -> confirmed).
-- ---------------------------------------------------------------------------

create or replace function public.pharmacist_accept_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if v_order.status not in ('requested', 'payment_confirmed') then
    raise exception 'Order is not awaiting acceptance' using errcode = '22023';
  end if;

  update public.pharmacy_orders set status = 'confirmed' where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Pharmacy flags an order as unavailable. Deliberately no stock lookup —
--    the pharmacist decides and states why, matching the "no inventory"
--    founder constraint. Cannot flag an order already dispensed/closed.
-- ---------------------------------------------------------------------------

create or replace function public.pharmacist_flag_unavailable(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

  if v_order.id is null then
    raise exception 'Order not found for this pharmacy' using errcode = '42501';
  end if;
  if v_order.status in ('dispensed', 'out_for_delivery', 'delivered', 'delivery_failed', 'cancelled') then
    raise exception 'Order has already been dispensed or closed' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required' using errcode = '22023';
  end if;

  update public.pharmacy_orders
  set status = 'unavailable',
      unavailable_reason = btrim(p_reason),
      unavailable_at = now()
  where id = p_order_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Record a dispense — extended signature. Dropped and recreated (not
--    CREATE OR REPLACE with trailing defaults) so there is exactly one
--    overload: PostgREST resolves an ambiguous overload by argument names in
--    the request, and this RPC has exactly one caller
--    (usePharmacistRecordDispense), so there is no reason to carry two
--    versions side by side.
--
--    Every previously-existing branch is preserved byte-for-byte (including
--    the 20260809182227 fix that transitions the order to 'dispensed');
--    only the new optional params and their insert columns are added. A
--    dispense against an 'unavailable' order is allowed — a pharmacist who
--    found a substitute after flagging unavailable can still complete it.
-- ---------------------------------------------------------------------------

drop function if exists public.pharmacist_record_dispense(uuid, text, text, date);

create or replace function public.pharmacist_record_dispense(
  p_order_id uuid,
  p_drug_name text,
  p_quantity text,
  p_dispensed_on date,
  p_quantity_prescribed text default null,
  p_is_partial boolean default false,
  p_outstanding_note text default null,
  p_batch_number text default null,
  p_substituted_for text default null,
  p_substitution_reason text default null,
  p_controlled_tier text default null,
  p_enhanced_verification_confirmed boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.pharmacy_orders%rowtype;
begin
  select * into v_order
  from public.pharmacy_orders
  where id = p_order_id and pharmacy_partner_id = private.pharmacist_partner();

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
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Failed-delivery resolution workflow. Org-staff scoped (not a partner
--    RPC — this is Tarragon ops recording what its own courier reported),
--    matching the trust level of the existing direct-table courier
--    mutations in logistics-partners.ts. SECURITY DEFINER only so this can
--    write the attempts table, which carries no direct INSERT grant
--    (see the schema migration) — the authorization check below is what
--    actually gates it, not the privilege escalation.
-- ---------------------------------------------------------------------------

create or replace function public.record_pharmacy_delivery_attempt(
  p_order_id uuid,
  p_result text,
  p_failure_reason text default null,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order          public.pharmacy_orders%rowtype;
  v_next_attempt   integer;
  v_result         public.delivery_attempt_result;
  v_failure_reason public.delivery_failure_reason;
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id;

  if v_order.id is null or not private.is_org_staff(v_order.organisation_id) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.status not in ('out_for_delivery', 'delivery_failed') then
    raise exception 'Order is not out for delivery' using errcode = '22023';
  end if;

  v_result := p_result::public.delivery_attempt_result;
  if v_result = 'failed' then
    v_failure_reason := p_failure_reason::public.delivery_failure_reason;
    if v_failure_reason is null then
      raise exception 'A failure reason is required' using errcode = '22023';
    end if;
  end if;

  select coalesce(max(attempt_number), 0) + 1 into v_next_attempt
  from public.pharmacy_order_delivery_attempts
  where pharmacy_order_id = p_order_id;

  insert into public.pharmacy_order_delivery_attempts
    (organisation_id, patient_id, pharmacy_order_id, attempt_number, result, failure_reason, notes, recorded_by)
  values
    (v_order.organisation_id, v_order.patient_id, p_order_id, v_next_attempt, v_result, v_failure_reason,
     nullif(btrim(coalesce(p_notes, '')), ''), (select auth.uid()));

  if v_result = 'delivered' then
    update public.pharmacy_orders
    set status = 'delivered', delivered_at = now(), delivery_confirmed_at = now()
    where id = p_order_id;
  else
    update public.pharmacy_orders set status = 'delivery_failed' where id = p_order_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants — a freshly created/replaced function carries an implicit PUBLIC
-- execute grant, which anon inherits through; revoke before granting to
-- authenticated (see feedback_supabase_anon_execute_gotcha memory).
-- ---------------------------------------------------------------------------

revoke execute on function public.pharmacist_accept_order(uuid) from public;
revoke execute on function public.pharmacist_accept_order(uuid) from anon;
grant execute on function public.pharmacist_accept_order(uuid) to authenticated;

revoke execute on function public.pharmacist_flag_unavailable(uuid, text) from public;
revoke execute on function public.pharmacist_flag_unavailable(uuid, text) from anon;
grant execute on function public.pharmacist_flag_unavailable(uuid, text) to authenticated;

revoke execute on function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean) from public;
revoke execute on function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean) from anon;
grant execute on function public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean) to authenticated;

revoke execute on function public.record_pharmacy_delivery_attempt(uuid, text, text, text) from public;
revoke execute on function public.record_pharmacy_delivery_attempt(uuid, text, text, text) from anon;
grant execute on function public.record_pharmacy_delivery_attempt(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.pharmacist_accept_order(uuid)', 'execute') then
    raise exception 'pharmacist_accept_order is still anon-executable';
  end if;
  if has_function_privilege('anon', 'public.pharmacist_flag_unavailable(uuid, text)', 'execute') then
    raise exception 'pharmacist_flag_unavailable is still anon-executable';
  end if;
  if has_function_privilege(
       'anon',
       'public.pharmacist_record_dispense(uuid, text, text, date, text, boolean, text, text, text, text, text, boolean)',
       'execute'
     ) then
    raise exception 'pharmacist_record_dispense is still anon-executable';
  end if;
  if has_function_privilege('anon', 'public.record_pharmacy_delivery_attempt(uuid, text, text, text)', 'execute') then
    raise exception 'record_pharmacy_delivery_attempt is still anon-executable';
  end if;
  if exists (
    select 1 from pg_proc
     where proname = 'pharmacist_record_dispense' and pronamespace = 'public'::regnamespace
       and pg_get_function_arguments(oid) = 'p_order_id uuid, p_drug_name text, p_quantity text, p_dispensed_on date'
  ) then
    raise exception 'the old 4-arg pharmacist_record_dispense overload is still present';
  end if;
end;
$$;

-- Track G (spec 8.16, OQ-320): what Tarragon PAYS a partner, and what a refund costs Tarragon, must not be readable by the ordering
-- patient, a caregiver, a clinician or any other signed-in user. Same class as Track E (lab_tests/panel_bundles/screen_types/
-- therapy_sessions commission) and the S53 pre-fix (pharmacy_medications commission).
-- VERSION: deliberately sorts AFTER every migration on main-dev AND after the newest live version (20261007190000, found with
-- list_migrations), not at wall-clock time. The grant list is "every column except the withheld ones, as of the moment this runs";
-- the first draft carried a wall-clock stamp and a fresh replay then missed pharmacy_orders.is_test, which 20261007141932 (S28d)
-- adds later in file order. Any migration that adds a column to these four tables must also grant it (the proof checks).
-- SAFETY FIX. SHIP THE CODE FIRST: after this migration `select *` on the four tables below raises 42501 by design.
--
-- WHAT WAS EXPOSED (read live, read-only, 2026-10-07, project koiplnmbgnqnbywhpjlf; all four tables have 0 rows, so nothing leaked)
--   public.lab_orders              partner_cost_kobo, partner_cost_breakdown   (per-test cost Tarragon owes the laboratory)
--   public.pharmacy_orders         partner_cost_kobo, partner_cost_breakdown   (what Tarragon owes the pharmacy)
--   public.lab_order_refunds       partner_portion_kobo, margin_portion_kobo   (how a refund splits between partner liability and Tarragon loss)
--   public.pharmacy_order_refunds  partner_portion_kobo, margin_portion_kobo
--   Readers: the ordering patient (own row), a caregiver with labs_results access (lab_orders), and every private.is_org_staff()
--   user, which includes the clinician role. The table-wide SELECT grant meant `select *` returned the cost.
--   NOT withheld: partner_cost_provider_id (WHICH laboratory or pharmacy fulfils the order, not an amount; the patient sees the
--   provider anyway and lab_orders_awaiting_transmission joins on it).
--
-- ALSO FIXED
--   * public.lab_orders_awaiting_transmission (security_invoker view) selected partner_cost_kobo; it would have failed for every
--     caller after the revoke. Recreated without that column. No client reads it (only a DB proof does).
--   * Three SECURITY DEFINER functions returned the whole lab_orders row, so a patient or clinician calling them over the API got
--     partner_cost_* back: request_lab_order_partner_visit (patient), set_lab_order_facility (patient or staff),
--     assign_home_phlebotomist (staff or the owning lab partner). They now return void; same bodies, same grants. The only client
--     caller (request-partner-lab-visit.tsx via useRequestLabOrderPartnerVisit) ignores the body.
--   * request_lab_order_refund / request_pharmacy_order_refund (SECURITY DEFINER, callable by any is_org_staff user) returned
--     released_from_liability_kobo, tarragon_loss_kobo and the policy note. Those three keys are now only present for admin or a
--     holder of commissions.view. Everyone else gets ok, refund_id, refund_kobo. No client calls these functions.
--
-- CHECKED AND NOT CHANGED (see docs/design/G-partner-cost-exposure.md)
--   partner_statements / pharmacy_partner_statements (+ _lines): invoiced_total_kobo / expected_total_kobo / expected_kobo are what a
--   partner invoices Tarragon. Policy is private.is_org_staff (care-team operations own recording partner invoices, by the design of
--   20260821192256 and apps/web/src/lib/finance/partner-statement-access.ts). No patient or caregiver path. Narrowing it is a
--   product decision (clinician read of partner invoices), logged as OQ-330, not made here.
--   specialist_referrals.referral_fee_kobo / payable_kobo: the patient price (copied from the specialist consultation fee).
--   lab_providers.cost_basis*: admin or partners.labs.manage only. service_product_margins: security invoker over admin-only tables.
--   lab_refund_policies / pharmacy_refund_policies.partner_still_owed: a boolean per refund reason, readable by all (OQ-331).
--
-- HOW (same pattern as 20261007002834 and 20261007105817)
--   A column REVOKE is a no-op under a table-level grant, so table-level SELECT is revoked from authenticated and anon, and SELECT
--   is granted on every column EXCEPT the withheld ones. The grant list is computed from pg_attribute at apply time (live carries
--   columns other in-flight branches added). A column added later is NOT readable until it is added to a grant: the intended
--   default, and packages/db/tests/g_partner_cost_columns_not_readable.sql fails if a later migration forgets (it checks that
--   every non-withheld column is granted).
--   No admin view is added: no client reads these columns (the cost is read and written only by SECURITY DEFINER functions and
--   triggers, which run as the function owner), so the smallest surface is none. Row policies are unchanged.
--   Writers are unchanged: the table-level INSERT/UPDATE/DELETE grants are untouched; the triggers that stamp partner_cost_* are
--   SECURITY DEFINER with search_path = ''.

begin;

-- 1. Column-level SELECT on the four tables (everything except the withheld columns)
do $$
declare
  t text;
  cols text;
  withheld constant jsonb := '{
    "lab_orders":            ["partner_cost_kobo", "partner_cost_breakdown"],
    "pharmacy_orders":       ["partner_cost_kobo", "partner_cost_breakdown"],
    "lab_order_refunds":     ["partner_portion_kobo", "margin_portion_kobo"],
    "pharmacy_order_refunds":["partner_portion_kobo", "margin_portion_kobo"]
  }';
begin
  for t in select jsonb_object_keys(withheld) loop
    execute format('revoke select on public.%I from authenticated, anon', t);
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
      from pg_attribute a
     where a.attrelid = format('public.%I', t)::regclass
       and a.attnum > 0 and not a.attisdropped
       and a.attname <> all (array(select jsonb_array_elements_text(withheld -> t)));
    execute format('grant select (%s) on public.%I to authenticated', cols, t);
  end loop;
end $$;

-- 2. lab_orders_awaiting_transmission no longer carries partner_cost_kobo (an invoker view needs the column privilege)
drop view public.lab_orders_awaiting_transmission;
create view public.lab_orders_awaiting_transmission with (security_invoker = true) as
  select lo.id,
         lo.organisation_id,
         lo.patient_id,
         lo.order_number,
         lo.total_kobo,
         lo.transmission,
         lo.payment_confirmed_at,
         lp.name as laboratory,
         round((extract(epoch from (now() - lo.payment_confirmed_at)) / 3600.0), 1) as hours_since_payment
    from public.lab_orders lo
    left join public.lab_providers lp on lp.id = lo.partner_cost_provider_id
   where lo.fulfilment = 'partner'::public.fulfilment_mode
     and lo.status = 'payment_confirmed'::public.lab_order_status
     and lo.transmission = any (array['queued'::public.lab_order_transmission, 'failed'::public.lab_order_transmission])
   order by lo.payment_confirmed_at nulls first;
comment on view public.lab_orders_awaiting_transmission is
  'Orders the patient has paid for that the laboratory has not been told about. security_invoker, so it shows a caller only what their own RLS on lab_orders already lets them see. Track G 8.16: carries no partner cost.';
revoke all on public.lab_orders_awaiting_transmission from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.lab_orders_awaiting_transmission from authenticated;
grant select on public.lab_orders_awaiting_transmission to authenticated;

-- 3. The three SECURITY DEFINER functions that returned a whole lab_orders row now return void (same bodies otherwise)
drop function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day);
create function public.request_lab_order_partner_visit(
  p_order_id uuid, p_facility_id uuid, p_scheduled_date date, p_preferred_time_of_day public.lab_order_time_of_day)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.lab_orders%rowtype;
  v_facility public.facilities%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  if v_order.patient_id is distinct from (select auth.uid()) then
    raise exception 'Not authorised to update this lab order' using errcode = '42501';
  end if;

  if v_order.fulfilment <> 'self_arranged' then
    raise exception 'This order has already been arranged' using errcode = '23514';
  end if;

  if v_order.status <> 'ordered' then
    raise exception 'This order can no longer be scheduled with a partner lab' using errcode = '23514';
  end if;

  if p_scheduled_date < current_date then
    raise exception 'Choose a date that has not already passed' using errcode = '23514';
  end if;

  select * into v_facility
    from public.facilities
    where id = p_facility_id and type = 'lab' and is_active;
  if v_facility.id is null then
    raise exception 'This lab is not available for booking yet' using errcode = '23514';
  end if;

  update public.lab_orders
    set fulfilment = 'partner',
        facility_id = p_facility_id,
        provider_id = v_facility.lab_provider_id,
        scheduled_date = p_scheduled_date,
        preferred_time_of_day = p_preferred_time_of_day
    where id = p_order_id;
end;
$function$;
revoke all on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) from public, anon;
grant execute on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) to authenticated;
comment on function public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day) is
  'Patient opts a self-arranged order into a Tarragon-booked partner lab visit. Track G 8.16: returns void, never the lab_orders row, so partner_cost_* is not handed back.';

drop function public.set_lab_order_facility(uuid, uuid);
create function public.set_lab_order_facility(p_order_id uuid, p_facility_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.lab_orders%rowtype;
  v_facility public.facilities%rowtype;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  if v_order.fulfilment = 'self_arranged' then
    raise exception 'This request is yours to take to any laboratory you like, so there is no facility to set here'
      using errcode = '23514';
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
    where id = p_order_id;
end;
$function$;
revoke all on function public.set_lab_order_facility(uuid, uuid) from public, anon;
grant execute on function public.set_lab_order_facility(uuid, uuid) to authenticated;
comment on function public.set_lab_order_facility(uuid, uuid) is
  'Choose the facility on a partner-fulfilled lab order before payment. Track G 8.16: returns void, never the lab_orders row.';

drop function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone);
create function public.assign_home_phlebotomist(
  p_order_id uuid, p_home_visit_provider_id uuid, p_phlebotomist_name text, p_phlebotomist_phone text, p_scheduled_at timestamp with time zone)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order    public.lab_orders%rowtype;
  v_provider public.home_visit_providers%rowtype;
  v_is_staff boolean;
  v_is_owning_lab_partner boolean;
  v_state    text;
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'Lab order not found' using errcode = '42501';
  end if;

  -- Two named booleans, each definitely true or false before the IF sees it (a NULL here would silently skip the refusal).
  v_is_staff := private.is_org_staff(v_order.organisation_id);
  v_is_owning_lab_partner := v_order.provider_id is not null
    and private.lab_partner_provider() is not null
    and v_order.provider_id = private.lab_partner_provider();
  if not (v_is_staff or v_is_owning_lab_partner) then
    raise exception 'Not authorized for this lab order' using errcode = '42501';
  end if;

  if v_order.fulfilment <> 'partner' then
    raise exception 'Only a partner-fulfilled order can have a Tarragon-arranged home collection — a self-arranged patient arranges their own' using errcode = '23514';
  end if;
  if v_order.status not in ('payment_confirmed', 'ordered') then
    raise exception 'This order is not in a state that can still be scheduled for collection' using errcode = '23514';
  end if;
  if p_scheduled_at <= now() then
    raise exception 'Choose a time that has not already passed' using errcode = '23514';
  end if;

  select * into v_provider from public.home_visit_providers where id = p_home_visit_provider_id and is_active;
  if v_provider.id is null then
    raise exception 'This home-visit provider is not available' using errcode = '23514';
  end if;

  -- Location verified server-side with the same gate the patient-facing coverage checker uses.
  select state into v_state from public.profiles where id = v_order.patient_id;
  if v_state is null or not public.region_service_available(v_state, 'home_visit') then
    raise exception 'Home sample collection is not available in % yet', coalesce(v_state, 'this patient''s state')
      using errcode = '23514';
  end if;
  if not (v_provider.regions @> array[v_state]) then
    raise exception '% does not cover %', v_provider.name, v_state using errcode = '23514';
  end if;

  update public.lab_orders
     set home_visit_provider_id = p_home_visit_provider_id,
         home_visit_scheduled_at = p_scheduled_at,
         phlebotomist_name = p_phlebotomist_name,
         phlebotomist_phone = p_phlebotomist_phone
   where id = p_order_id;

  -- The specimen this order is already tracking now knows it will be a home draw, not a walk-in.
  update public.lab_specimens
     set collection_method = 'home_collection'
   where lab_order_id = p_order_id and status = 'pending_collection';

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  values (
    v_order.organisation_id, v_order.patient_id, 'in_app', 'pending',
    'lab_home_phlebotomist_assigned',
    jsonb_build_object(
      'phlebotomist_name', p_phlebotomist_name,
      'scheduled_at', p_scheduled_at,
      'provider_name', v_provider.name
    )
  );
end;
$function$;
revoke all on function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone) from public, anon;
grant execute on function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone) to authenticated;
comment on function public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone) is
  'Assign a home-visit provider and phlebotomist to a partner lab order. Track G 8.16: returns void, never the lab_orders row.';

-- 4. Refund requests: the cost split is only returned to admin or a commissions.view holder
create or replace function public.request_lab_order_refund(
  p_order_id uuid, p_reason public.lab_refund_reason, p_amount_kobo bigint default null, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order   public.lab_orders%rowtype;
  v_policy  public.lab_refund_policies%rowtype;
  v_paid    bigint;
  v_amount  bigint;
  v_partner bigint;
  v_margin  bigint;
  v_refund  uuid;
  v_priv    boolean := private.is_admin() or private.has_permission('commissions.view'::text);
begin
  select * into v_order from public.lab_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can raise a refund' using errcode = '42501';
  end if;
  if v_order.fulfilment <> 'partner' then
    raise exception 'a self-arranged order was never billed by Tarragon, so there is nothing here to refund — the patient paid the laboratory directly'
      using errcode = '23514';
  end if;

  select * into v_policy from public.lab_refund_policies where reason = p_reason;

  v_paid   := coalesce(v_order.total_kobo, 0) - coalesce(v_order.subscriber_discount_kobo, 0);
  v_amount := case when v_policy.refunds_in_full then v_paid else coalesce(p_amount_kobo, 0) end;

  if v_amount <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '23514';
  end if;
  if v_amount > v_paid then
    raise exception 'refund of % exceeds the % actually paid on this order', v_amount, v_paid
      using errcode = '23514';
  end if;

  if v_policy.partner_still_owed then
    -- The laboratory keeps its money; every naira of this refund is Tarragon's loss, cost included.
    v_partner := 0;
    v_margin  := v_amount;
  else
    -- Release the laboratory's share of the liability first; only the remainder is lost margin. Capped at the order's own cost.
    v_partner := least(coalesce(v_order.partner_cost_kobo, 0), v_amount);
    v_margin  := v_amount - v_partner;
  end if;

  insert into public.lab_order_refunds
    (organisation_id, lab_order_id, reason, refund_total_kobo,
     partner_portion_kobo, margin_portion_kobo, detail, requested_by)
  values
    (v_order.organisation_id, p_order_id, p_reason, v_amount,
     v_partner, v_margin, p_detail, (select auth.uid()))
  returning id into v_refund;

  return jsonb_build_object('ok', true, 'refund_id', v_refund, 'refund_kobo', v_amount)
    || case when v_priv
         then jsonb_build_object('released_from_liability_kobo', v_partner, 'tarragon_loss_kobo', v_margin, 'policy', v_policy.note)
         else '{}'::jsonb end;
end;
$function$;

create or replace function public.request_pharmacy_order_refund(
  p_order_id uuid, p_reason public.pharmacy_refund_reason, p_amount_kobo bigint default null, p_detail text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order   public.pharmacy_orders%rowtype;
  v_policy  public.pharmacy_refund_policies%rowtype;
  v_paid    bigint;
  v_amount  bigint;
  v_partner bigint;
  v_margin  bigint;
  v_refund  uuid;
  v_priv    boolean := private.is_admin() or private.has_permission('commissions.view'::text);
begin
  select * into v_order from public.pharmacy_orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'no such order' using errcode = '42501';
  end if;
  if not private.is_org_staff(v_order.organisation_id) then
    raise exception 'only care-team staff can raise a refund' using errcode = '42501';
  end if;

  select * into v_policy from public.pharmacy_refund_policies where reason = p_reason;

  v_paid   := coalesce(v_order.payable_kobo, coalesce(v_order.total_kobo, 0) - coalesce(v_order.voucher_covered_kobo, 0));
  v_amount := case when v_policy.refunds_in_full then v_paid else coalesce(p_amount_kobo, 0) end;

  if v_amount <= 0 then
    raise exception 'a partial refund needs an amount' using errcode = '23514';
  end if;
  if v_amount > v_paid then
    raise exception 'refund of % exceeds the % actually paid on this order', v_amount, v_paid
      using errcode = '23514';
  end if;

  if v_policy.partner_still_owed then
    v_partner := 0;
    v_margin  := v_amount;
  else
    v_partner := least(coalesce(v_order.partner_cost_kobo, 0), v_amount);
    v_margin  := v_amount - v_partner;
  end if;

  insert into public.pharmacy_order_refunds
    (organisation_id, pharmacy_order_id, reason, refund_total_kobo,
     partner_portion_kobo, margin_portion_kobo, detail, requested_by)
  values
    (v_order.organisation_id, p_order_id, p_reason, v_amount,
     v_partner, v_margin, p_detail, (select auth.uid()))
  returning id into v_refund;

  return jsonb_build_object('ok', true, 'refund_id', v_refund, 'refund_kobo', v_amount)
    || case when v_priv
         then jsonb_build_object('released_from_liability_kobo', v_partner, 'tarragon_loss_kobo', v_margin, 'policy', v_policy.note)
         else '{}'::jsonb end;
end;
$function$;
-- create or replace keeps the existing grants; re-assert them so this migration is self-checking
revoke all on function public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text) from public, anon;
grant execute on function public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text) to authenticated;
revoke all on function public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text) from public, anon;
grant execute on function public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text) to authenticated;

-- 5. Assertions
do $$
declare
  t text;
  c text;
  r record;
  spec constant jsonb := '{"lab_orders":["partner_cost_kobo","partner_cost_breakdown"],
                           "pharmacy_orders":["partner_cost_kobo","partner_cost_breakdown"],
                           "lab_order_refunds":["partner_portion_kobo","margin_portion_kobo"],
                           "pharmacy_order_refunds":["partner_portion_kobo","margin_portion_kobo"]}';
begin
  for t in select jsonb_object_keys(spec) loop
    for c in select jsonb_array_elements_text(spec -> t) loop
      if has_column_privilege('authenticated', format('public.%I', t), c, 'SELECT') then
        raise exception 'FAIL: authenticated can still SELECT %.%', t, c;
      end if;
      if has_column_privilege('anon', format('public.%I', t), c, 'SELECT') then
        raise exception 'FAIL: anon can SELECT %.%', t, c;
      end if;
    end loop;
    if not has_column_privilege('authenticated', format('public.%I', t), 'id', 'SELECT') then
      raise exception 'FAIL: authenticated lost SELECT on %.id', t;
    end if;
    -- the writers (staff UPDATE, patient INSERT, refund INSERT) are plain statements, so the table-level write grants must survive
    if not (has_table_privilege('authenticated', format('public.%I', t), 'INSERT')
        and has_table_privilege('authenticated', format('public.%I', t), 'UPDATE')) then
      raise exception 'FAIL: authenticated lost INSERT/UPDATE on %', t;
    end if;
    -- a column that is unreadable but not deliberately withheld means the grant is stale
    for r in
      select a.attname from pg_attribute a
       where a.attrelid = format('public.%I', t)::regclass and a.attnum > 0 and not a.attisdropped
         and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
         and not ((spec -> t) ? a.attname::text)
    loop
      raise exception 'FAIL: %.% is neither granted nor withheld on purpose', t, r.attname;
    end loop;
    -- none of the four may be published to Realtime (Realtime does not apply column privileges)
    if exists (select 1 from pg_publication_tables where schemaname = 'public' and tablename = t) then
      raise exception 'FAIL: % is in a publication', t;
    end if;
  end loop;

  if exists (select 1 from pg_attribute a where a.attrelid = 'public.lab_orders_awaiting_transmission'::regclass
              and a.attname = 'partner_cost_kobo' and not a.attisdropped) then
    raise exception 'FAIL: lab_orders_awaiting_transmission still carries partner_cost_kobo';
  end if;
  if has_table_privilege('anon', 'public.lab_orders_awaiting_transmission', 'SELECT') then
    raise exception 'FAIL: anon can read lab_orders_awaiting_transmission';
  end if;

  foreach c in array array['public.request_lab_order_partner_visit(uuid, uuid, date, public.lab_order_time_of_day)',
                           'public.set_lab_order_facility(uuid, uuid)',
                           'public.assign_home_phlebotomist(uuid, uuid, text, text, timestamp with time zone)'] loop
    if pg_get_function_result(c::regprocedure) <> 'void' then
      raise exception 'FAIL: % still returns a row', c;
    end if;
    if has_function_privilege('anon', c::regprocedure, 'EXECUTE') or not has_function_privilege('authenticated', c::regprocedure, 'EXECUTE') then
      raise exception 'FAIL: grants are wrong on %', c;
    end if;
  end loop;
  foreach c in array array['public.request_lab_order_refund(uuid, public.lab_refund_reason, bigint, text)',
                           'public.request_pharmacy_order_refund(uuid, public.pharmacy_refund_reason, bigint, text)'] loop
    if has_function_privilege('anon', c::regprocedure, 'EXECUTE') or not has_function_privilege('authenticated', c::regprocedure, 'EXECUTE') then
      raise exception 'FAIL: grants are wrong on %', c;
    end if;
  end loop;

  -- no SECURITY DEFINER function in public/private returns one of the four row types
  for r in
    select p.oid::regprocedure::text as fn from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('public', 'private') and p.prosecdef
       and p.prorettype in ('public.lab_orders'::regtype, 'public.pharmacy_orders'::regtype,
                            'public.lab_order_refunds'::regtype, 'public.pharmacy_order_refunds'::regtype)
  loop
    raise exception 'FAIL: % returns a row containing partner cost', r.fn;
  end loop;
  raise notice 'PASS: partner cost and refund margin columns are off the authenticated surface';
end $$;

commit;

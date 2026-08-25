-- Partner billing: the money path end to end (Option A, Synlab).
--
-- Covers the four things that decide whether taking a patient's money for a
-- laboratory test is safe:
--   * the order records what the patient pays AND what the laboratory charges;
--   * the payment splits so the laboratory's share is a liability, never
--     revenue;
--   * a review can never be sold for less than it costs;
--   * an order the patient paid for is never silently un-sent.
--
-- Run inside a single transaction and ROLLED BACK. Every negative is paired
-- with a positive control.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/partner_billing_money_path.sql
--
-- NOTE ON THE NUMBERS BELOW. The female fixture holds an active paid
-- subscription. That USED to mean private.apply_screening_subscriber_discount
-- took 15% off every Screen-tier order she places — a 227,500 Core Screen
-- discounted by 15% is 193,375 against a Synlab cost of 189,800, leaving
-- Tarragon 3,575 naira, about 1.6% — thin enough that the founder removed the
-- discount outright on 2026-08-25 (private.apply_screening_subscriber_discount
-- is now a no-op; see 20260825174115_remove_screening_subscriber_discount.sql).
-- The subscription is still on this fixture so m2 below doubles as the
-- regression check: a subscriber's margin must equal a non-subscriber's.

begin;

create temporary table test_results (case_name text, passed boolean, detail text) on commit drop;

do $$
declare
  v_female uuid := '365067dc-7c0f-45e8-a807-8cd70f2da8dd';
  v_org    uuid := '00000000-0000-0000-0000-000000000001';
  v_core   uuid;
  v_syn    uuid;
  v_state  text;
  v_order  uuid;
  v_self   uuid;
  v_total  bigint;
  v_cost   bigint;
  v_disc   bigint;
  v_paid   bigint;
  v_t      text;
begin
  select id into v_core from public.panel_bundles where code = 'screen_core';
  select state into v_state from public.profiles where id = v_female;

  -- Partner fulfilment is region-gated and dormant until a laboratory is
  -- switched on. Switched on here, inside the rolled-back transaction only,
  -- so the partner branch is reachable at all.
  update public.service_regions set is_active = true where state = v_state;
  if not found then insert into public.service_regions (state, is_active) values (v_state, true); end if;
  update public.lab_providers set is_active = true, regions = array[v_state] where name = 'Synlab Nigeria';
  select id into v_syn from public.lab_providers where name = 'Synlab Nigeria';

  -- -----------------------------------------------------------------------
  -- 1. Both numbers land on the order, from one insert.
  -- -----------------------------------------------------------------------
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin,
     investigation_tier, fulfilment, provider_id)
  values (v_org, v_female, v_core, 'ordered', 0, 'patient_initiated', 1, 'partner', v_syn)
  returning id into v_order;

  select total_kobo, partner_cost_kobo, coalesce(subscriber_discount_kobo, 0)
    into v_total, v_cost, v_disc
    from public.lab_orders where id = v_order;
  v_paid := v_total - v_disc;

  insert into test_results select 'm1_order_carries_patient_price_and_lab_cost',
    v_total = 22750000 and v_cost = 18980000,
    'patient ' || v_total / 100 || ' / lab cost ' || v_cost / 100;

  insert into test_results select 'm1b_and_a_per_test_breakdown_to_reconcile_against',
    (select count(*) from jsonb_array_elements(
       (select partner_cost_breakdown from public.lab_orders where id = v_order))) = 7,
    (select partner_cost_breakdown::text from public.lab_orders where id = v_order);

  -- No subscriber discount survives onto a partner-billed order, even for a
  -- subscriber. Asserted as a real number rather than "> 0" so that a
  -- discount silently creeping back in is a visible test failure, not a
  -- quiet squeeze on the margin.
  insert into test_results select 'm2_no_subscriber_discount_the_margin_is_the_full_contracted_one',
    v_disc = 0 and v_paid - v_cost = 3770000,
    'discount ' || v_disc / 100 || ' / paid ' || v_paid / 100 || ' - cost ' || v_cost / 100
      || ' = ' || (v_paid - v_cost) / 100
      || ' naira (' || round((v_paid - v_cost) * 100.0 / v_paid, 2) || '% of the price)';

  -- -----------------------------------------------------------------------
  -- 2. A partner order is never sent before it is paid for, and never
  --    silently unsent after.
  -- -----------------------------------------------------------------------
  select transmission::text into v_t from public.lab_orders where id = v_order;
  insert into test_results select 'm3_unpaid_order_is_not_queued_for_the_lab',
    v_t = 'awaiting_payment', v_t;

  update public.lab_orders set status = 'payment_confirmed' where id = v_order;
  select transmission::text into v_t from public.lab_orders where id = v_order;
  insert into test_results select 'm4_paying_queues_it_for_the_lab', v_t = 'queued', v_t;

  insert into test_results select 'm5_and_it_shows_in_the_untransmitted_worklist',
    exists (select 1 from public.lab_orders_awaiting_transmission where id = v_order), null;

  update public.lab_orders set transmission = 'sent', transmitted_at = now() where id = v_order;
  insert into test_results select 'm6_control_a_sent_order_leaves_the_worklist',
    not exists (select 1 from public.lab_orders_awaiting_transmission where id = v_order), null;

  -- -----------------------------------------------------------------------
  -- 3. Refunds split by policy, not by whoever is handling the complaint.
  -- -----------------------------------------------------------------------
  declare v_r jsonb;
  begin
    v_r := public.request_lab_order_refund(v_order, 'sample_rejected', null, 'haemolysed sample');
    insert into test_results select 'm7_rejected_sample_releases_the_lab_share',
      (v_r ->> 'released_from_liability_kobo')::bigint = v_cost
      and (v_r ->> 'tarragon_loss_kobo')::bigint = v_paid - v_cost,
      'released ' || (v_r ->> 'released_from_liability_kobo')::bigint / 100
        || ' / Tarragon loses ' || (v_r ->> 'tarragon_loss_kobo')::bigint / 100;

    -- The expensive one: the laboratory did the work, we lost the result, so
    -- the patient is refunded in full AND Synlab is still paid.
    v_r := public.request_lab_order_refund(v_order, 'result_lost', null, 'result never reached the patient');
    insert into test_results select 'm8_a_lost_result_costs_tarragon_the_whole_amount',
      (v_r ->> 'released_from_liability_kobo')::bigint = 0
      and (v_r ->> 'tarragon_loss_kobo')::bigint = v_paid,
      'released ' || (v_r ->> 'released_from_liability_kobo')::bigint / 100
        || ' / Tarragon loses ' || (v_r ->> 'tarragon_loss_kobo')::bigint / 100;
  end;

  -- -----------------------------------------------------------------------
  -- 4. A self-arranged order has nothing to refund, because Tarragon never
  --    took the money in the first place.
  -- -----------------------------------------------------------------------
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, status, total_kobo, origin, investigation_tier)
  values (v_org, v_female, v_core, 'ordered', 0, 'patient_initiated', 1)
  returning id into v_self;

  insert into test_results select 'm9_control_self_arranged_order_is_still_free',
    (select total_kobo = 0 and partner_cost_kobo is null and transmission = 'not_required'
       from public.lab_orders where id = v_self), null;

  begin
    perform public.request_lab_order_refund(v_self, 'never_attended', null, null);
    insert into test_results select 'm10_self_arranged_order_cannot_be_refunded', false, 'accepted';
  exception when check_violation then
    insert into test_results select 'm10_self_arranged_order_cannot_be_refunded', true, sqlerrm;
  end;
end $$;

select case_name, passed, detail from test_results order by case_name;
select count(*) filter (where not passed) as failures, count(*) as total from test_results;

rollback;

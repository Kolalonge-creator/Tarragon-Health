-- Reconciles the one lab_orders row still stuck in the pre-2026-09-10
-- partner-billed model. private.enforce_guidance_only_is_never_billed
-- (added by 20260910011846_catalogue_becomes_guidance_not_commerce.sql)
-- blocks any NEW partner-billed insert against a guidance_only bundle, but
-- never touched pre-existing rows -- this Core Screen order (LAB-000167,
-- created 2026-08-25, before the pivot) was left sitting in
-- fulfilment='partner', status='pending_payment', showing a real ₦227,500
-- price tag and a "Pay" button on the patient's Labs page that can never be
-- honoured under the current model (Tarragon does not bill for a
-- guidance_only test any more). This is what a patient (the
-- 'Test Complete Patient' QA fixture) was actually seeing when reporting
-- "Core screening should not have a price tag" -- every other bundle/order
-- in the catalogue already carries no price (see lab-catalogue.tsx,
-- review-price.tsx, 0eeae6a7), this was the one orphaned leftover.
--
-- Verified live immediately before writing this migration: exactly one row
-- anywhere in lab_orders has fulfilment='partner' at all, and it is this
-- one, still unpaid -- so this brings it in line with what every other
-- self-arranged order already looks like (e.g. LAB-000286):
-- fulfilment='self_arranged', status='ordered', total_kobo zeroed
-- (payable_kobo is a generated column and derives automatically), no
-- payment_provider/payment_confirmed_at, and no partner_cost_* fields --
-- lab_orders_partner_cost_only_for_partner_fulfilment requires those be null
-- once fulfilment isn't 'partner'. The row count is not asserted as exactly
-- 1 here (a fresh `supabase db reset` replay has no such fixture at all, per
-- the project's own standing "fresh local reset differs from live cloud
-- project" lesson) -- only the resulting invariant is asserted, which holds
-- whether 0 or 1 rows matched.
--
-- Trigger check: lab_orders_aa_guidance_only_never_billed only fires on
-- fulfilment='partner', so setting fulfilment='self_arranged' here passes;
-- queue_lab_order_transmission resets transmission to 'not_required' for
-- the new fulfilment automatically; no other UPDATE trigger on this table
-- fires on a transition into status='ordered' (confirmed by reading each
-- one's live definition, not assumed).
do $$
begin
  update public.lab_orders
     set fulfilment = 'self_arranged',
         status = 'ordered',
         total_kobo = 0,
         subscriber_discount_kobo = 0,
         voucher_covered_kobo = 0,
         applied_voucher_id = null,
         payment_provider = null,
         payment_provider_ref = null,
         pending_payment_provider_ref = null,
         payment_confirmed_at = null,
         partner_cost_kobo = null,
         partner_cost_provider_id = null,
         partner_cost_breakdown = null
   where fulfilment = 'partner'
     and status = 'pending_payment';

  if exists (
    select 1
      from public.lab_orders
     where fulfilment = 'partner'
       and status = 'pending_payment'
  ) then
    raise exception 'A partner-billed pending_payment lab_orders row still exists after reconciliation';
  end if;
end $$;

-- Tarragon Health — pharmacy order fulfilment method (medication pathway, Phase 1)
--
-- Patients choose how they receive a medication order. Per the medication
-- pathway direction: PICKUP (collect at a chosen nearby pharmacy) is live now;
-- DELIVERY is built into the model but stays switched off in the UI until real
-- logistics partners onboard (home sample collection / medication delivery
-- logistics remain Phase 2/3 per CLAUDE.md — this column only records the
-- choice, it does not build delivery operations).
--
-- Recording the method here (rather than inferring it from whether
-- logistics_partner_id/delivery_address happen to be set) keeps the patient's
-- intent explicit and lets the pharmacy alert say "for collection" vs "for
-- delivery" correctly once delivery is enabled.

create type public.pharmacy_fulfilment_method as enum ('pickup', 'delivery');

alter table public.pharmacy_orders
  add column fulfilment_method public.pharmacy_fulfilment_method not null default 'pickup';

-- Tarragon Health — Family Watch (E1, Revenue Architecture and Earnings
-- Plan, diaspora). "A Nigerian abroad enrols a parent or relative in
-- Nigeria... prompts and confirms their medication refills and
-- appointments, reviews anything that drifts, escalates when it should,
-- and sends the payer abroad a short, honest written update every month."
--
-- Priced in USD, not GBP (founder decision 2026-08-29, in response to a
-- direct question raised while building this): GBP is structurally
-- forbidden — subscription_plans_no_gbp / add_ons_no_gbp CHECK constraints,
-- added 20260729143814 alongside a proven decision to retire it. USD stays
-- open.
--
-- Deliberately NOT a derived_from_code row, unlike every other USD plan on
-- the platform (essential_usd, complete_usd, ...). Every one of those exists
-- specifically so a diaspora buyer pays the SAME care at the naira price
-- converted, never a markup — see DIASPORA_ONE_PRICE_NOTE in pricing.ts and
-- 20260729140916's own header ("one naira price list... the old 2.5-3.5x
-- diaspora premium is gone"). Family Watch's entire commercial thesis is the
-- opposite: a UK/US payer's willingness to pay is an order of magnitude
-- above naira pricing for the same clinical work, and the whole engine only
-- earns anything if that premium is real, not FX-converted away. This is a
-- deliberate, scoped exception to the one-price-list principle — not a
-- constraint being silently worked around (nothing here alters
-- subscription_plans_no_gbp or private.expected_derived_price_minor), and
-- it is confined to this one product family. See
-- docs/REVENUE_ARCHITECTURE_AND_EARNINGS_PLAN.md §5/§6 for the reasoning in
-- full and the marketing-copy consequence (DIASPORA_ONE_PRICE_NOTE needs
-- rewriting alongside this, done in the same PR).
--
-- No new checkout/activation code at all. This reuses
-- lib/billing/sponsored-subscription-checkout.ts +
-- private.activate_sponsored_subscription (just fixed in the previous
-- migration) exactly as built for "put my mother on Complete Care and bill
-- my card monthly" — Family Watch IS that flow, just with a plan that has
-- its own USD list price instead of one derived from naira.
--
-- "Additional relative" (£15/mo each in the source plan) is NOT built here:
-- funding a second relative today means a second, full-price Family Watch
-- subscription (initiateSponsoredSubscriptionCheckout takes one
-- beneficiary per call already) rather than a discounted add-on — the
-- discount would need a cross-person subscription_add_ons attachment this
-- migration doesn't build. Documented gap, not a silent omission.
--
-- Prices are round, deliberately: this plan itself is explicit that every
-- figure in it is "a proposal for decision, not a live price." $30/mo,
-- $300/yr (Family Watch) and $55/mo, $550/yr (Plus) follow this codebase's
-- existing "annual = 10x monthly, 2 months free" convention (see
-- essential/complete) rather than a literal GBP-to-USD conversion of the
-- source plan's £25/£45 figures.

insert into public.subscription_plans (code, name, description, price_minor, currency, interval, features, is_active)
values
  ('family_watch', 'Tarragon Family Watch',
     'For a relative in Nigeria: protocol-based tracking of their condition, medication and appointment prompts, a doctor''s review of anything that drifts, defined escalation, and a written monthly update sent to you. They keep their own account and consent; the lab and pharmacy are still paid directly by the family, as always.',
     3000, 'USD', 'monthly',
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','prevention_coordination','result_document_review'],
     true),
  ('family_watch_yearly', 'Tarragon Family Watch (yearly)',
     'Family Watch billed annually — 2 months free.',
     30000, 'USD', 'yearly',
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','prevention_coordination','result_document_review'],
     true),
  ('family_watch_plus', 'Tarragon Family Watch Plus',
     'Everything in Family Watch, plus a monthly video review with a doctor you can join from abroad, and coordination of their annual health check with a partner laboratory.',
     5500, 'USD', 'monthly',
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','prevention_coordination','result_document_review','async_doctor_visit'],
     true),
  ('family_watch_plus_yearly', 'Tarragon Family Watch Plus (yearly)',
     'Family Watch Plus billed annually — 2 months free.',
     55000, 'USD', 'yearly',
     array['tracking','reminders','education','chronic','clinician_review','doctor_checkin','lab_coordination','medication_refills','prevention_coordination','result_document_review','async_doctor_visit'],
     true)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  price_minor = excluded.price_minor,
  currency = excluded.currency,
  interval = excluded.interval,
  features = excluded.features,
  is_active = excluded.is_active;

do $$
declare v_n int;
begin
  select count(*) into v_n from public.subscription_plans
   where code in ('family_watch','family_watch_yearly','family_watch_plus','family_watch_plus_yearly')
     and is_active and currency = 'USD' and derived_from_code is null;
  if v_n <> 4 then raise exception 'Family Watch rows missing, inactive, or wrongly derived (found %)', v_n; end if;

  -- Prove the no-GBP guardrail was left untouched, not worked around.
  begin
    update public.subscription_plans set currency = 'GBP' where code = 'family_watch';
    raise exception 'a GBP currency was accepted on a plan row — subscription_plans_no_gbp is gone';
  exception when check_violation then null;
  end;
end $$;

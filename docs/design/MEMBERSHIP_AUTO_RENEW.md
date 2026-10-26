# Membership auto-renewal

Founder decision 2026-10-26: a Member who ticks the box when paying by card has that card kept by Paystack, and the Membership renews for
another year unless they cancel. Cancelling is one tap, keeps the year already paid for, and stops the next charge. Built, tested, and
shipped **dormant**: the switch is OFF.

## The switch

`public.platform_modules` key `membership_auto_renew` (default OFF). It gates: saving a card, the daily sweep, the consent box at
checkout, the renewal card on the Membership page, the renewal notices, and (in the marketing PR) the public copy. Read it with
`public.membership_auto_renew_enabled()` (anon can call it, so ISR marketing pages can follow it).

## How it works

1. **Consent.** At checkout the person ticks "Renew my Membership automatically each year" (unticked by default; the constant is
   `RENEW_TICKED_BY_DEFAULT` in `membership-shop.tsx`). `order-checkout` records it on the order with `set_order_renewal_consent`
   before they reach Paystack. Gifts, sponsor-paid orders, Plus upgrades and payment-request orders can never carry it.
2. **Saving the card.** After the order is paid, `confirmPayment` offers the card Paystack reports to `save_membership_card`. The
   database saves it only if the order carries consent, the switch is on, **and Paystack says the authorization is `reusable`**. Bank
   transfer and USSD payments, and some prepaid or virtual cards, are not reusable and are simply not renewable (the order records
   `renewal_card_result = not_reusable`).
3. **Where the card lives.** `membership_cards`: service role only, no policy, all privileges revoked. It is deliberately **not** in
   `payments.raw`, which a patient can read. A patient sees only brand, last four and expiry (`my_membership_renewal()`).
4. **The sweep.** pg_cron `membership-auto-renew-daily` (06:00 UTC) calls the `membership-renewal` edge function. It charges
   memberships ending within 3 days, at most 3 attempts, at least 20 hours apart. Charging **before** `ends_at` means the existing
   `record_order_payment` extends from the old end date, so no day of the paid year is lost. Each attempt is its own order (orders are
   immutable), and the sweep verifies earlier attempts with Paystack before it makes another, so a charge that succeeded but never
   confirmed is never charged twice. A dropped connection on the charge is recorded as pending, not failed.
5. **Confirming.** A renewal charge goes through the same `confirmPayment` the webhook uses, so the payment row, the extension, the
   ledger posting, the 21-day refund window and the receipt all work as they do for a first purchase.
6. **Telling the person.** 30/14/7 days before the end, an auto-renewing Member gets `membership_auto_renewal_notice` (date, amount,
   card, how to cancel) instead of the plain reminder. They are told on a successful renewal, on the first failed charge and on the
   last one, and when they cancel. Never SMS.
7. **Cancel.** `cancel_membership_renewal()`: renewal off, saved card deleted, the paid year untouched, one confirmation. Turning it
   back on needs a new card payment with the box ticked (Paystack can only tokenise a card through a real charge).
8. **Price protection.** A renewal is charged only if the current price is no higher than the price the person was last SHOWN: the list
   price at the first payment, then the amount in each 30/14/7-day notice, then the amount of each renewal charged
   (`patient_memberships.renewal_notified_kobo`). If the price rose after that, the card is NOT charged: they get one
   `membership_renewal_price_changed` notice with the new amount and how to renew by hand. A price that fell is charged at the lower price.
9. **Monitoring.** Every run of the sweep reports itself (`membership_renewal_runs`), including a run with nothing due and a run that
   failed. A daily watchdog (`membership-renewal-watchdog`, 08:00 UTC, silent while the switch is off) opens an ops incident, once per
   cause per day, when the sweep has not reported in 26 hours (a missing or wrong vault secret, a crashed function, a stopped cron),
   when the last run failed or had failed charges, or when a membership ending within 2 days was never attempted.
10. **Processing fee on a renewal.** If Paystack adds its fee to a `charge_authorization` and reports no separate requested amount, the
   charge request carries the price it asked for (`metadata.renewal_expected_kobo`, set only by the server) and `confirmPayment` reads
   a larger amount with nothing separate as price plus fee. The database still demands the exact order price, and the fee is still
   capped at what Paystack reports taking, so an overcharge is refused. The first real test charge still confirms which way Paystack
   behaves.
11. **Refund.** A refund inside the window ends the Membership at once (existing behaviour); the nightly `membership-card-cleanup` job
   then deletes the card.

## Before the switch is turned on (checklist)

- [ ] **Paystack.** Confirm with Paystack support that reusable authorizations are enabled for this account and for Nigerian cards,
  and that `charge_authorization` works for a yearly charge. The processing-fee behaviour is handled either way (item 10) but has never
  been seen on a real renewal charge: check the recorded fee on the test charge.
- [ ] **Test mode end to end.** Buy with a Paystack test card with the box ticked; move `ends_at` to 2 days away; run the function;
  watch the renewal order, the extension, the ledger posting and all notices. Then one real, small, watched charge with a staff card.
- [ ] **Secrets.** Vault secret `membership_renewal_secret` and the edge function env `MEMBERSHIP_RENEWAL_SECRET` (same value). If
  either is missing the watchdog opens an incident within a day; do not rely on that, check it before turning the switch on.
- [ ] **Deploy** `membership-renewal`, and redeploy every function that bundles `_shared/commerce` (`order-checkout`, `order-verify`,
  `order-reconcile`, `paystack-webhook`) so they all carry the card-capture change.
- [ ] **Counsel.** Whether an unticked box is required, the wording of the consent text, the terms of service, and the data-protection
  notice for keeping a payment token. The 30-day price-change notice already exists and applies to a renewal's new price.
- [ ] **Go-live guard text.** `membership_billing_enabled` carries the attestation "no automatic renewal anywhere, so no recurring
  charge" (`20261007164447_s73_pricing_engine.sql`); update it when the switch is turned on.
- [ ] **Turn it on** through the platform-modules admin with a real activation note. The public pricing, FAQ and checkout copy then
  follow it; until then they say "does not renew by itself".

## Known limits

- The mobile app has the same unticked consent switch and the same renewal card with a one-tap cancel as the web (the
  `RENEW_ON_BY_DEFAULT` constant mirrors the web one). Both read the platform switch, so neither shows anything while it is off.
- Employer seats and vouchers never renew on a card.
- A renewal that fails three times is not retried again; the Membership then runs out and lapses on the existing 14-day grace path.
- The saved authorization code is stored as plain text in a service-role-only table (disk-level encryption only). Moving it to the
  Vault, or encrypting the column, is a reasonable hardening before the switch is turned on at scale.

Proof: `packages/db/tests/membership_auto_renew.sql` (registered in `ci.manifest`), `packages/commerce/src/renewal*.test.ts`,
`packages/integrations/src/payment-authorization.test.ts`, the `order-checkout` Deno tests, and the membership UI tests.

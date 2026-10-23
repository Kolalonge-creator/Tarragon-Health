# S71 checkout test run (Paystack test mode)

**STATUS: NOT RUN.** No Paystack test key has been supplied, so nothing below has been executed against Paystack or against the platform. This document is the exact list to run later. Do not record a result here until a person has run it, and record it in `docs/BUILD-PROGRESS.md` with the date.

Never put a key in this file, in chat, in a pull request or in git. The key goes only in a local `.env.sandbox` file outside git (see `docs/runbooks/provider-sandbox-check.md`). A key starting `sk_live_` must never be used: the script refuses it before the first request.

## Before you start
1. A staging or local project, never production. Test patient accounts only (`profiles.is_test = true`).
2. Paystack dashboard in **Test mode**. Settings, API Keys: copy the test secret key into `.env.sandbox` as `PAYSTACK_TEST_SECRET_KEY`.
3. The staging project's secrets hold the same test key as `PAYSTACK_SECRET_KEY` and the matching `PAYSTACK_WEBHOOK_SECRET`. The Paystack test webhook URL points at that project's `paystack-webhook` function.
4. Both go-live guards are attested ON for the test patient only: `checkout_enabled` and `sponsor_payment_enabled` (test patients pass the guard before a real patient does). With a guard OFF the app must fail closed: the shop shows its "not open" words and the health plan card is absent. Confirm that first, then turn it on for the test patient.
5. Node 22.18 or newer.

## Automated part (initialises, never pays)
```
node --env-file=.env.sandbox scripts/provider-sandbox-check.mjs --only paystack-checkout
```
Expected: three PASS lines (card, bank_transfer, ussd), each "initialise a ... checkout, leave it unpaid, and it reads as not paid", then nine SKIP lines marked NOT RUN, one per manual step below. Each PASS line prints the checkout link so you can pay it by hand in M1, M3 or M4. Exit code 0 if nothing failed. A FAIL means the adapter or the channel list differs from what Paystack accepts: fix the adapter before going on.
Add `--json out.json` to keep the record (secrets are masked).

## M1 Card payment, success
1. In the mobile app (or web) as the test patient, open Membership, pick an item with a recorded fee split.
2. Check the itemised block: clinician or partner fee, Tarragon service fee, "Payment processing (estimate)", "Total to pay". The lines add up to the total shown. If the price has no recorded split, one "Price" line shows instead.
3. Tap pay. Paystack's page opens with only card, bank transfer and USSD offered. Pay with Paystack's published test success card.
4. Expected: the app returns and says the payment is received; the order shows paid; the entitlement appears; a receipt exists; the paid amount equals the amount the person was shown, in kobo; the real processing fee is recorded on the order and replaces the estimate on the receipt.

## M2 Card payment, declined and abandoned
1. Pay with Paystack's published test declined card. Expected: the order shows failed; "The payment did not go through. You can try again."; no entitlement.
2. Start a checkout and close the page without paying. Expected: the order stays "created"; paying again reuses the same retry key and does not make a second order; no charge.
3. Tap pay twice quickly. Expected: one order only.

## M3 Bank transfer, paid late
1. Start a checkout, choose bank transfer, note the account Paystack shows, close the page without paying.
2. Expected on return: the title "Waiting for your bank", the words that transfers can take a few minutes, no "failed", no second charge, and a "Check again" button.
3. In the Paystack test dashboard simulate the transfer arriving. Tap "Check again" (or wait for the webhook or the reconcile sweep in M6). Expected: the order turns paid exactly once.

## M4 USSD, paid late
Same as M3 with the USSD channel. Expected: the same "Waiting for your bank" state, then paid exactly once after Paystack confirms it.

## M5 Webhook delivery and replay
1. After M1, in the Paystack dashboard open the transaction, Webhooks, and resend the `charge.success` event twice.
2. Expected: the platform answers 200 each time; the order stays paid once; one entitlement; one ledger posting; no duplicate receipt.
3. Send a test webhook with a wrong signature (Paystack's "Send test webhook" signs correctly; alter one character in a copy sent with curl). Expected: refused, nothing recorded.
4. Send an event for a reference that does not exist. Expected: acknowledged and ignored, nothing created.

## M6 Reconcile sweep
1. Make an order that Paystack shows as paid but the platform shows as created (pay it in M3 with the webhook URL temporarily unset in the Paystack dashboard).
2. Call `order-reconcile` once with the header `x-order-reconcile-secret` (the value is in the project's secrets; do not paste it anywhere). Expected: the order becomes paid through the same verify-then-record path as the webhook; calling again changes nothing.
3. Expected without the header or with a wrong one: 401. Without the secret configured: 503 (fails closed).

## M7 Refund
1. As the buyer, request a refund on the M1 order from Membership, history. Expected: only the buyer sees the button; the refund shows pending.
2. As an administrator, approve it. Expected: Paystack records the refund; the order shows refunded; the entitlement is ended; the posting is reversed; the amount refunded equals the amount paid in kobo.
3. Call `refund-reconcile` once with its secret header. Expected: the verdict is a match; no ops incident. Change the amount in Paystack's test refund if you want to see a mismatch raise an incident.
4. Expected for a second refund request on the same order: refused.

## M8 Sponsor covered order (no payment)
1. Give the test patient a sponsor programme covering the item in full (staging only).
2. Expected in the app: "Covered by <sponsor name>", no itemised fee lines and no payment step, the button reads "Use this cover". Tapping it makes a paid order of zero with no Paystack page.
3. Part cover: set the programme to cover part. Expected: "<name> pays <amount> of this", a negative reduction line, and the total equals the amount still due plus the processing estimate.
4. Budget used up: Expected: "The cover for this has run out, so you pay the usual price."
5. With `sponsor_payment_enabled` OFF for the patient: Expected: the card for health plan checks is absent and a covered order is refused with the "not open" words.

## M9 Foreign card estimate
1. Expected on the itemised block: a note that a card issued outside Nigeria costs more to process, with a processing amount and total, when the fee schedule has a figure.
2. Pay with a Paystack test international card if one is available in your test dashboard. Expected: the recorded fee is the real one and is shown on the receipt; the estimate was only an estimate. Record the gap between the estimate and the real fee; if it is large, tell the founder so the schedule (`commerce.processing_fee_estimate`) can be revised.

## What passing means, and what it does not
Passing proves the checkout, webhook, reconcile and refund paths against Paystack's test mode. It does not prove a live payment, a live bank transfer, settlement timing or the real foreign card fee. Nothing is switched on because this passed.

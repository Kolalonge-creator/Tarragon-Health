# Paystack "Pay with Transfer" — Implementation Spec

> Status: **proposed, not yet built**. Nothing in this document is live. Written 2026-08-29 against
> the Paystack integration as it actually exists in `apps/web`/`supabase` today — every file, table,
> and function named below is real and current as of this date; verify against live code before
> relying on any of it later, same discipline as everywhere else in this repo's docs.

## 0. Terminology correction

The proposal this spec is based on talks about a "Care Order." **That table doesn't exist.** The
real equivalent — the thing that's paid for one-off, per-transaction — is a **booking order**:
`lab_orders`, `pharmacy_orders`, `specialist_referrals`, or `video_visit_requests`, unified by
`CheckoutMetadata.kind === "booking"` in `apps/web/src/lib/billing/checkout-metadata.ts` and the
`BOOKING_TABLE` switch in both `apps/web/src/lib/billing/booking-ownership.ts` and
`supabase/functions/paystack-webhook/index.ts`. Everywhere below, "booking order" means one of
those four tables. Two other one-off checkout kinds exist alongside `booking` —
`voucher_payment` (Care Voucher purchase/instalment, `kind='voucher_payment'`) and
`sponsored_subscription` (a sponsor billed for someone else's plan) — both relevant to this spec,
see §1.

## 1. Scope: Tier 1 now, Tier 2 explicitly gated

The proposal's own framing is correct and matches how this platform actually works, so it's kept:

- **Tier 1 — Pay with Transfer (this spec, build now).** A temporary account number tied to one
  transaction, no customer BVN, no Customer Identification call. Applies to **one-off charges
  only** — confirmed against the codebase, every checkout kind that currently calls
  `initializeOneOffTransaction()` (`apps/web/src/lib/paystack/transactions.ts`) is a candidate:
  `booking` (`booking-checkout.ts`), `voucher_payment` (`voucher-checkout.ts`), and
  `sponsored_subscription` (`sponsored-subscription-checkout.ts`). This covers essentially all
  patient-facing Paystack revenue except the recurring base-plan subscription itself.
- **Tier 2 — Dedicated Virtual Accounts (later, explicit-ask-gated).** A permanent account per
  patient, useful for repeated top-ups against the same balance. The proposal called this "the Ajo
  plan" — **there is no Ajo plan or wallet-top-up feature in this codebase** (confirmed: no `Ajo`
  hits outside unrelated substring matches like "manager"; the Health Wallet concept was retired
  2026-07-31 per `CLAUDE.md`, replaced by Care Vouchers, which are purchased/laid-away as discrete
  one-off charges, not a repeatedly-topped-up balance). The closest real candidate is Care Voucher
  **layaway/instalments** (`supabase/migrations/20260731215226_care_vouchers_purchase_and_layaway.sql`)
  — if a sponsor pays several instalments toward the same voucher, a DVA could remove the "generate
  a new charge each time" friction. **Do not build Tier 2 without an explicit founder ask** — it
  requires collecting a patient's BVN and running Paystack Customer Identification, which is new
  regulated-data handling (`CLAUDE.md`'s NDPC/DPO item is still open) on top of being new product
  surface. This is the same class of guardrail `CLAUDE.md` already applies to the referral-matching
  engine, wellness testing, and Employer/HMO dashboards — treat it identically.

**Recurring subscription/add-on checkouts (`initializeTransaction()` with `paystackPlanCode`, used
by `onboarding/actions.ts` and `patient/subscription/actions.ts`) are out of scope entirely.**
Pay with Transfer produces no reusable authorization Paystack can charge again at renewal — only a
stored card (via the existing hosted-checkout `plan` flow) can do that. Don't offer Transfer as a
channel on the base-plan signup screen; only on one-off charges.

## 2. What already exists — don't rebuild this

The proposal's steps 4–6 (webhook verification, verify-before-trust, ledger, nightly reconciliation)
**are already built**, generically, for every Paystack charge regardless of channel:

- **Webhook + signature verification**: `supabase/functions/paystack-webhook/index.ts`. HMAC-SHA512
  over the raw body vs. `x-paystack-signature`, fails closed if `PAYSTACK_WEBHOOK_SECRET` is unset,
  always returns HTTP 200 (Paystack retries on non-2xx).
- **Idempotency / ledger**: `payment_transactions`
  (`supabase/migrations/20260712201507_payment_transactions.sql`), unique on
  `(provider, provider_event_id)` where `provider_event_id` is the Paystack transaction reference.
  A replayed webhook is a no-op via `23505` conflict.
- **State transition on success**: for `kind='booking'`, `charge.success` looks up the row by
  `pending_payment_provider_ref = event.data.reference`, flips `status` to `payment_confirmed`,
  sets `payment_provider`/`payment_provider_ref`, clears `pending_payment_provider_ref`.
- **Nightly reconciliation**: `apps/web/src/lib/finance/reconciliation-sweep.ts`, run by
  `apps/web/src/app/api/cron/reconcile-payment-providers/route.ts` at `0 9 * * *`
  (`apps/web/vercel.json`). Pulls `listSuccessfulTransactions()` (Paystack `/transaction?status=success`)
  for a 48h window and flags `missing_locally`/`status_mismatch`/`amount_mismatch` into
  `payment_reconciliation_flags` for a human at `/finance/reconciliation`. **This already covers Pay
  with Transfer charges with zero changes** — Paystack's success list includes bank-transfer-channel
  charges the same as card charges; the sweep doesn't distinguish by channel.

None of the above needs to be touched for Tier 1. What's missing is entirely on the "initiate a
transfer charge and render it in-app" side, and one webhook gap (§6).

## 3. Prerequisites (the long pole)

Same as the proposal: the Paystack business account needs full CAC/TIN verification and the
founder's BVN consented via NIBSS iGree before Pay with Transfer is enabled on the account at all.
**This is an account-configuration step outside this codebase — no migration or code change
substitutes for it.** Confirm with the founder whether this has been started; nothing below can be
tested against live Paystack (even in test mode, Pay with Transfer needs the feature enabled) until
it has. `apps/web/src/lib/paystack/client.ts`'s `isPaystackConfigured()` only checks that
`PAYSTACK_SECRET_KEY` is set — it has no way to know whether Transfer is enabled on the account, so
a misconfigured account fails at the `/charge` call itself, not earlier. Surface that failure
clearly (§9) rather than assuming a generic "payment failed."

## 4. Two build paths — recommendation

- **Path A — do nothing in-app, rely on hosted checkout's default Transfer channel.** Every one-off
  booking/voucher/sponsor checkout already redirects to Paystack's hosted `authorization_url`
  (`initializeOneOffTransaction()`). Hosted Checkout shows Transfer as a channel automatically once
  it's enabled on the business account, with **zero code changes here**. **Before writing any of the
  code in §5, confirm with the founder whether hosted Checkout already satisfies this request** —
  it may already be live the moment the account is enabled (§3). This is the same lesson as the
  2026-08-04 "code was fine, deployment wasn't promoted" entry in `CLAUDE.md`: don't build new code
  to solve a problem that a business-account setting already solves.
- **Path B — in-app custom UI** (this spec's actual net-new code, §5–§8): call `POST /charge` with
  a `bank_transfer` object, render the account number/bank/countdown directly in the booking
  checkout screen instead of redirecting to Paystack. Build this only once Path A is confirmed
  insufficient (e.g. product wants the transfer details inline rather than an off-platform redirect)
  — it's real, maintained surface (webhook branch, retry flow, UI) that Path A gets for free.

The rest of this spec assumes Path B is wanted; if only Path A is needed, stop after confirming the
account setting and skip to nothing.

## 5. New code

### 5.1 `apps/web/src/lib/paystack/transactions.ts` — new function

```ts
interface BankTransferChargeData {
  reference: string;
  status: string; // "pay_offline" while awaiting the transfer, per Paystack's /charge contract
  display_text?: string;
  bank_transfer?: {
    bank: { name: string; slug?: string };
    account_number: string;
    account_expires_at: string; // ISO8601
  };
}

/**
 * Pay with Transfer: a temporary, single-transaction account number, not a
 * customer-linked DVA. No BVN, no Customer Identification call. Response
 * carries the account details directly — no webhook wait needed to show
 * them. account_expires_at must be 15min–8h; anything outside is clamped by
 * Paystack, so pick 30min and don't rely on echoing back a longer value.
 */
export async function initializeBankTransferCharge(args: {
  email: string;
  amountMinor: number; // NGN only — Transfer is a Nigerian-rails-only channel
  reference: string; // caller-generated, so it can be correlated before any webhook arrives
  metadata: CheckoutMetadata;
  expiresInMinutes?: number; // default 30
}): Promise<PaystackResult<{
  reference: string;
  bankName: string;
  accountNumber: string;
  expiresAt: string;
}>>
```

Implementation: `paystackFetch("/charge", { method: "POST", body: { email, amount, currency: "NGN",
reference, bank_transfer: { account_expires_at }, metadata } })`. `bank_transfer` with no other keys
is Paystack's documented way to request the transfer channel specifically (as opposed to card OTP
flow) from the generic `/charge` endpoint. **Flag for the real test-mode round trip**: confirm the
exact response shape (`data.bank_transfer.bank.name` vs. a flatter shape) against a live test-mode
call before trusting the interface above — write it defensively (explicit `?.` chains, a clear
error if `bank_transfer` is absent from a `pay_offline`-status response) rather than assuming.

### 5.2 `apps/web/src/lib/billing/booking-checkout.ts` — new function

Parallel to `initiateBookingCheckout()`, not a modification of it — the existing function's
`checkoutUrl` return shape is relied on by the checkout-redirect page today and must keep working
for card payments and the Stripe branch.

```ts
export async function initiateBookingTransferCharge(args: {
  orderType: BookingOrderType;
  orderId: string;
  organisationId: string;
  patientId: string;
  amountKobo: number;
  email: string;
}): Promise<
  | { ok: true; reference: string; bankName: string; accountNumber: string; expiresAt: string }
  | { ok: false; error: string }
>
```

Same shape as `initiateBookingCheckout()`: build `CheckoutMetadata` with `kind: "booking"`, call
`initializeBankTransferCharge()`, then `update({ status: "pending_payment",
pending_payment_provider_ref: reference })` on the booking table — identical DB write to the
existing function, so the webhook handler in §6 needs **no new correlation logic**, only a new event
type to act on. NGN-only; reject non-NGN the same way `initiateBookingCheckout()` does. The caller
(a new server action under `apps/web/src/app/(dashboard)/patient/.../actions.ts`, following the
existing `requireOwnedBookingOrder()` ownership check from `booking-ownership.ts`) must validate
input with Zod per `CLAUDE.md`'s TypeScript rules — `orderId` a uuid, `orderType` one of the four
literals — before this function is ever called with user-supplied data.

**Regenerate-on-expiry**: the "generate a new account number" retry the proposal calls for is just
calling `initiateBookingTransferCharge()` again against the same `orderId` — it overwrites
`pending_payment_provider_ref` with a fresh reference. No new DB column needed; the old reference
simply stops being referenced by any row, and its `payment_transactions` history stays intact for
audit (never deleted).

### 5.3 `voucher-checkout.ts` / `sponsored-subscription-checkout.ts`

Same pattern as §5.2 if/when product wants Transfer offered there too — not required for an initial
Tier 1 ship scoped to booking orders. Note in the PR description if deferring these; don't silently
drop them from scope without saying so.

## 6. Webhook handler changes (`supabase/functions/paystack-webhook/index.ts`)

**`charge.success` needs no changes.** It already correlates on `event.data.reference` against
`pending_payment_provider_ref` regardless of which channel (card vs. transfer) produced the charge
— Paystack fires the same event either way.

**`charge.failed` is currently unhandled** (falls into the `default` case: recorded to
`payment_transactions`, no state change). For a hosted-checkout card decline this is fine — the
booking order just stays `pending_payment` and the patient retries from the same
`authorization_url`. For a Transfer charge that **expires** (late transfer, §9) or fails on **wrong
amount** (Paystack auto-refunds within 24h per the proposal), the same "stay pending, let them
retry" behavior is actually still correct — `initiateBookingTransferCharge()` regenerating a fresh
reference (§5.2) doesn't require `pending_payment_provider_ref` to be cleared first. So: **verify
this before adding a case** — if Paystack's `charge.failed` payload for an expired/mismatched
transfer doesn't need any DB write beyond what `payment_transactions` already logs, don't add
dead code. Add a `case "charge.failed":` only if there's a concrete reason to react (e.g. surfacing
a "your transfer didn't arrive in time" in-app notification) — confirm against a real test-mode
expiry before deciding either way; don't guess.

No new `payment_transaction_type` enum value is needed — `'charge.success'` and `'charge.failed'`
already exist in `supabase/migrations/20260712201507_payment_transactions.sql`.

## 7. State transitions

Unchanged from the existing booking-order state machine — Pay with Transfer is a new way to reach
the exact same transitions, not a new state machine:

```
<lab_order_status/pharmacy_order_status/referral_status initial value>
        │  initiateBookingCheckout() OR initiateBookingTransferCharge()
        ▼
  pending_payment  (pending_payment_provider_ref = <reference>)
        │
        ├─ charge.success webhook, reference matches ──▶ payment_confirmed
        │                                                (payment_provider_ref set,
        │                                                 pending_payment_provider_ref cleared)
        │
        └─ transfer expires / wrong amount / patient abandons
                 │
                 ▼
           stays pending_payment — patient calls initiateBookingTransferCharge()
           again, pending_payment_provider_ref overwritten with a fresh reference
```

## 8. Reconciliation

No new table, no new cron. `payment_reconciliation_flags` and `reconcile-payment-providers`
(§2) already diff Paystack's own success list against `payment_transactions` daily — a Transfer
charge that succeeded at Paystack but whose webhook never arrived is caught by the existing
`missing_locally` flag path exactly like a missed card-charge webhook is today. The one gap worth
naming: neither the sweep nor anything else currently expires a `pending_payment` booking order
whose transfer window closed and never got a `charge.failed`/`charge.success` either way (a
Paystack-side dropped webhook with no retry ever landing). If that turns out to be a real problem in
practice, extend `runReconciliationSweep()` to also flag booking orders stuck in `pending_payment`
past their `account_expires_at` — don't build this speculatively before confirming it's needed.

## 9. Failure modes → concrete handling

| Failure | Where it's handled |
|---|---|
| **Wrong amount transferred** | Paystack auto-refunds within 24h (their behavior, not ours). UI must render `amountKobo` (formatted ₦) in large type next to a copy-to-clipboard account number — this is a UI requirement on the new checkout screen (§5.2's caller), not a code path. |
| **Late transfer (window expires)** | UI shows a live countdown from `expiresAt`; on expiry, disable the "I've paid" state and show "generate a new account number," which calls `initiateBookingTransferCharge()` again (§5.2). |
| **Bank/NIBSS rail downtime** | Keep the existing card checkout (`initiateBookingCheckout()` → `authorization_url`) visible as a fallback link on the same screen, not a separate flow the patient has to discover. |
| **Paystack account not yet enabled for Transfer** | `/charge` with `bank_transfer` fails at the API call. Surface the actual Paystack error message (already threaded through `PaystackResult`'s `error` field) rather than a generic "payment failed" — this failure mode is expected until §3 is complete, and a generic error would be indistinguishable from a real outage. |

## 10. UI requirements (new, not yet built)

A new step in the booking checkout flow (wherever `initiateBookingCheckout()` is currently called
from) offering "Pay by transfer" alongside the existing card redirect:

- Bank name + account number in large type, with a copy button (`navigator.clipboard`).
- Exact amount in large type, explicitly labeled "transfer this exact amount."
- Live countdown to `expiresAt`.
- "I've sent it" is not a button that does anything server-side — there's nothing to poll
  synchronously; the webhook (§6) is what actually confirms payment. The screen should instead
  poll the booking order's own `status` (existing pattern — check how the current checkout-callback
  page confirms payment_confirmed) or subscribe to a Supabase Realtime change on the order row.
- On expiry: swap the account details for a "generate a new account number" button.
- Card fallback link, visible without scrolling, not buried in a secondary menu.

## 11. Config

No new environment variables — `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET`
(`.env.example`, already present) cover `/charge` the same as `/transaction/initialize`.

## 12. Test plan

Following this repo's existing conventions (`packages/db/tests/` for RLS, Jest for service
functions):

1. **`initializeBankTransferCharge()` unit tests** — mock `paystackFetch`, assert correct body
   shape (`bank_transfer.account_expires_at`, `currency: "NGN"` forced), assert non-NGN amount is
   rejected before the network call.
2. **`initiateBookingTransferCharge()` unit tests** — assert `pending_payment_provider_ref` is
   written on success; assert a failed Paystack call leaves the booking order untouched (no partial
   write); assert calling it twice on the same order overwrites the reference cleanly (retry path).
3. **Webhook idempotency** — replay the same `charge.success` payload twice (any channel), assert
   the second insert conflicts on `(provider, provider_event_id)` and produces no second state
   change. This test already exists for card charges if there's Deno test coverage for the edge
   function — extend it with a bank-transfer-channel fixture rather than writing a parallel test.
4. **Webhook signature rejection** — malformed/missing `x-paystack-signature`, and
   `PAYSTACK_WEBHOOK_SECRET` unset, both return `ok:false` and write nothing (fail-closed).
5. **Reconciliation sweep** — feed `listSuccessfulTransactions()` a mock transfer-channel result
   with no matching `payment_transactions` row, assert a `missing_locally` flag is written; this
   proves §8's "no new code needed" claim rather than just asserting it.
6. **RLS**: `payment_transactions` select policy already restricts to `is_org_staff(organisation_id)`
   — no new policy needed since Transfer charges write to the same table; a regression test here is
   optional, only add one if this spec's implementation touches the table's schema (it doesn't).
7. **Manual test-mode round trip** (can't be automated — needs real Paystack test-mode credentials):
   confirm `/charge` response shape against §5.1's interface, confirm `charge.success` fires and is
   correlated correctly for a transfer-channel charge, confirm an expired transfer's webhook
   behavior to settle the §6 open question.

## 13. Rollout checklist / open questions for the founder

- [ ] Confirm §3 (business verification + BVN-via-iGree) status — this blocks everything else.
- [ ] Confirm whether Path A (hosted-checkout default Transfer) already satisfies the ask before
      building any of Path B's in-app code (§4).
- [ ] Decide whether Tier 1 ships for `booking` only, or also `voucher_payment` /
      `sponsored_subscription` (§5.3) in the same pass.
- [ ] Resolve §6's open question (does `charge.failed` need a real case, or is `default` sufficient)
      against an actual test-mode expiry before writing that branch.
- [ ] Tier 2 (DVA) stays unscheduled until an explicit founder ask, per §1 — don't let "Pay with
      Transfer" scope quietly grow into it.

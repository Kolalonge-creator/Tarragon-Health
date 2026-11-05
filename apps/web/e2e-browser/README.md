# Browser E2E (Playwright)

Real-browser tests that drive the actual Next.js app — distinct from
`../e2e/` (Jest tests that hit the live project's DB/Edge Functions directly,
bypassing the UI entirely; see that directory's own header comment).

## Why these never run against the live project

`.env.local` points `NEXT_PUBLIC_SUPABASE_URL` at `koiplnmbgnqnbywhpjlf`, the
one true production Supabase project (CLAUDE.md). These specs create real
signup accounts, real checkout attempts, and real eligibility-roster data —
running them against production on every PR would pollute it continuously.
Supabase branching (an isolated, disposable database per run) isn't
available on the current plan (`PaymentRequiredException: Branching is
supported only on the Pro plan or above` — checked live 2026-09-23).

Instead: **a local Supabase stack**, the same tooling the existing
`supabase-db` CI job already uses successfully (`supabase start` +
`supabase db reset`) — free, fully isolated, no plan upgrade. `global-setup.ts`
refuses to even start the dev server unless `NEXT_PUBLIC_SUPABASE_URL` looks
local, so pointing this at production by mistake fails loudly instead of
quietly creating real data there.

## Running locally

```bash
# From the repo root — starts Postgres/Auth/Storage/etc. in Docker
supabase start
supabase db reset   # replay all migrations + supabase/seed/seed.sql (global catalogues only) onto the fresh stack
# S85: the end to end journeys live in e2e-browser/journeys, see journeys/README.md

# Grab that stack's connection details
supabase status -o env
```

Export the three values that matter (`API_URL` → `NEXT_PUBLIC_SUPABASE_URL`,
`ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SERVICE_ROLE_KEY` →
`SUPABASE_SERVICE_ROLE_KEY`) into your shell, then from `apps/web`:

```bash
pnpm test:e2e-browser
```

Optional: set `PAYSTACK_SECRET_KEY` (a real `sk_test_...` key — never
`sk_live_...`) to also run the checkout-initiation test in
`b2c-signup-to-entitlement.spec.ts`; without it, that one test skips (see its
own comment) rather than failing the run.

## What's covered

- **`clinical-documents.spec.ts`** — clinical document engine step 7: a patient uploads a document without knowing what it is, answers
  the one question and finds it in My Health Records (the same file again is refused); a Care Coordinator finds the patient (a name alone
  finds nobody) and uploads a laboratory report with the identity on it checked (a wrong date of birth is refused, the patient gets the
  values-free notice, the report stays held); a doctor opens the document side by side, records a review, and the patient then sees
  "Reviewed by a doctor" but not the note. Needs a production build (`E2E_PRODUCTION_BUILD=1`) and `ANTHROPIC_API_KEY` unset (no model is
  called; AI-024 is off). Point both `E2E_DB_URL` and `E2E_DATABASE_URL` at the stack's database.

- **`events-care-message-round-trip.spec.ts`** and **`events-booking-round-trip.spec.ts`** —
  events harness E5 to E7: a care message from patient to doctor and back, and a
  booking from slot to cancellation, each with the in-app bell asserted for every
  person involved (exactly one notice, in words, linking to the right screen). They
  need a production build locally, as CI uses: `E2E_PRODUCTION_BUILD=1`. In dev
  mode a first-compiled route can 404 and never clear. Email and push are not
  covered here.

- **`b2c-signup-to-entitlement.spec.ts`** — the signup form itself (a
  standalone UI check, since real email confirmation can't be completed
  headlessly), then a full authenticated journey using a pre-seeded,
  already-confirmed patient: login → onboarding → checkout-initiation (a
  real Paystack test-mode API call, skipped without a key) →
  entitlement-reflects-in-the-dashboard (proven by seeding the exact DB
  state `private.apply_service_purchase_payment` produces, not by
  completing a real payment on Paystack's own hosted page).
- **`employer-eligibility.spec.ts`** — the public, unauthenticated `/corporate`
  and `/hmo` "is my employer/HMO covered?" checker. This is the closest thing
  in this codebase to what an audit might call an "NGO journey" — there is no
  `funding_programme`/NGO cohort model actually built; what exists is an
  employer/HMO eligibility-roster match.

## Paystack test mode, locally (a real payment, end to end)

The hosted checkout runs in the deployed `order-checkout` edge function, which reads the
live key from Supabase secrets, so a Paystack test-mode payment cannot be made against
production from a local app. The whole round trip works on the local stack instead, and
`scripts/local-paystack-e2e.sh` (repo root) does the forty-odd manual steps:

```bash
supabase start
supabase db reset
PAYSTACK_SECRET_KEY=sk_test_... scripts/local-paystack-e2e.sh   # refuses sk_live_ and any non-local Supabase URL
```

It reads the stack's URL and keys from `supabase status -o env`, then seeds what a fresh
reset lacks (none of it is sellable otherwise): the Membership `catalog_items` row
(`membership_annual_no_panel`) switched active with one open `prices` row at 100,000 naira
(decision T2-01, 2026-11-04; `valid_from = now()` because of the tstzrange exclusion),
Membership Plus and the upgrade left inactive because they are retired and never sold, a
10% test discount code `LOCALTEST10` on the Membership only (a fresh reset has none), the
`checkout_enabled` and `membership_billing_enabled` guards and the `v5_checkout` and
`membership_two_member_tiers` modules switched on with their attribution columns filled
(the guard triggers are skipped with `session_replication_role = replica`; the attribution
columns are CHECK constraints, so they cannot be). It creates a test patient and a test
doctor through the admin auth API: the doctor is a senior medical officer, employed,
credentialing level 2, indemnity-exempt by another profile (self-exemption is a CHECK),
with the `lead_clinician` and `hypertension` competencies, so `private.lead_candidates`
returns a row and `create_order` does not raise `no_capacity`. The patient's email is on
`tarragonhealth.ng`, never `@tarragon.test`: Paystack rejects that TLD with "email must be
a valid email" and the checkout answers `payment_unavailable`.

It then writes a chmod-600 env file for the functions in a temp dir (the test key,
`PAYSTACK_WEBHOOK_SECRET` set to the same key because the webhook fails closed without it,
`ORDER_RETURN_URL` pointing at `http://localhost:3100/patient/membership/paid`, random
`PROCESS_EVENTS_SECRET` and `ORDER_RECONCILE_SECRET`; no Supabase URL or keys, the CLI
injects those), starts `supabase functions serve --env-file … --no-verify-jwt` and
`next dev -p 3100` with the local Supabase env exported, and prints the test login, the
URL, and curl one-liners for `process-events` (assigns the lead clinician; a queue, not a
trigger) and `order-reconcile` (closes a declined attempt and releases a single-use code).

Then by hand: sign in at `http://localhost:3100/login`, open `/patient/membership`, apply
`LOCALTEST10` to check quoting (100,000 becomes 90,000), pay, choose the **Success** radio on
Paystack's hosted test page (no card number needed), and land on "Payment received". The
return page calls `order-verify` locally; Paystack's webhook never reaches a laptop, so
the verify path is what marks the order paid. Check `orders.state = 'paid'` and an
`active` `patient_memberships` row with the psql lines the script prints. Declined stays
`created` until `order-reconcile` runs. `scripts/local-paystack-e2e.sh --teardown` stops
both processes; `supabase db reset` clears the data.

Proven once on 2026-11-03 against a freshly reset stack: `orders.state = 'paid'`, an
`active` `patient_memberships` row, one `discount_redemptions` row, and `process-events`
assigned the lead clinician.

Two gotchas: shell env beats `.env.local`, which is why the script exports the local
values rather than editing a file; and a Next 16 dev server in another git worktree holds
a lock that stops this one starting (the script says so if `/login` never answers).

## What this does NOT do

Neither spec drives Paystack's actual hosted checkout page to completion —
there's no test card to enter, and doing so would be flaky and out of this
app's own scope. `seedActiveServicePurchase` bypasses Paystack and the
webhook entirely, seeding the exact end state
`private.apply_service_purchase_payment` produces so the UI layer can be
proven honestly — it does not exercise the webhook's own request handling at
all.

Webhook-side payment processing (signature verification, idempotency, the
`charge.success`/refund state machine) is covered separately by
`supabase/functions/paystack-webhook/index.test.ts` — **not yet on
`main-dev` as of this PR**, only on the still-open
`test/paystack-webhook-replay-idempotency` branch (PR #722); check whether
it's merged before treating it as present. Read that test's own header
before assuming more than it proves, too: it runs against a hand-rolled
in-memory fake Supabase client, not a real Postgres instance, so it verifies
the webhook's own branching/idempotency *logic* correctly, not that a real
`charge.success` payload through the real webhook against a real trigger on a real database produces an `active`
`service_purchases` row. Three separate proofs, each real but partial:
this suite proves the UI honestly reflects the trigger's documented output;
`index.test.ts` proves the webhook's own decision logic against a fake DB;
and `packages/db/tests/payment_activation_amount_and_reference.sql`
(registered in `ci.manifest`, run by the `supabase-db` CI job) proves the
trigger itself against a real Postgres instance. No single test drives all
three at once — a real Paystack `charge.success` payload arriving at the
real deployed webhook against a real database is only provable by an actual
production/staging round trip, which is what the original implementation
plan's "real test-mode round trip" verification step (referenced in the
webhook's own header comment) was for.

## A known verification gap, stated plainly

These specs were written and validated for syntax/types/lint
(`playwright test --list`, `tsc`, `eslint`) but **could not be run against a
real server in the session that wrote them** — that sandbox had no Docker,
so no local Supabase stack could be started, and running them against
production was deliberately ruled out (see above). Selector choices are
grounded in the actual source of the pages they drive, not guessed, but the
first real run of this suite (in CI, or locally by someone with Docker) is
also the first time it's been executed at all. Read failures from that first
run as genuine signal, not assume-and-retry noise.

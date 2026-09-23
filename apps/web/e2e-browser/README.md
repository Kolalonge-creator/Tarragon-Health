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
supabase db reset   # replay all migrations + seed.sql onto the fresh stack

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

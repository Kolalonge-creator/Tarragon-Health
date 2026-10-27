# Provider sandbox check (one command per vendor)

Proves, against each vendor's own sandbox or test mode, that the code the platform really runs (the adapters in `supabase/functions/_shared/integrations`) talks to the vendor correctly. It prints PASS, FAIL or SKIP for each capability and nothing else; it never prints a secret.

## Run it
1. Make a file called `.env.sandbox` OUTSIDE git (it is ignored; never commit it) with only the variables for the vendors you want checked (list below).
2. `node --env-file=.env.sandbox scripts/provider-sandbox-check.mjs`
   - one vendor only: add `--only paystack` (or `zoom`, `resend`, `termii`)
   - checkout channels (card, bank transfer, USSD; initialises unpaid checkouts only, then lists the manual steps, all NOT RUN): `--only paystack-checkout`, see `docs/design/S71-checkout-test-run.md`
   - Zoom creates and deletes one short real meeting: add `--allow-zoom-meeting`
   - keep a record: add `--json sandbox-result.json` (secrets are masked in it too)
3. Needs Node 22.18 or newer (it runs the TypeScript adapters directly). Exit code 0: nothing failed and something passed. 1: a check failed. 2: refused, or no credentials were given.

## It refuses to run with a live Paystack key
Any variable holding `sk_live_...` (in any variable, not just the Paystack ones), or a Paystack key that does not start `sk_test_`, stops the run before the first request. Nothing is called.

## What the founder must supply (and nothing else is needed)
| Vendor | Variables | Where it comes from | What it unlocks |
|---|---|---|---|
| Paystack TEST | `PAYSTACK_TEST_SECRET_KEY` (starts `sk_test_`), optionally `PAYSTACK_WEBHOOK_SECRET` | Paystack dashboard, switch to Test mode, Settings, API Keys | Banks, initialize and verify a charge, duplicate reference, recipient, transfer and its idempotency, settlement listing |
| Zoom Server-to-Server app | `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, **`ZOOM_HOST_USER_ID`** (the dedicated host user's id or email), optional `ZOOM_SDK_KEY`, `ZOOM_SDK_SECRET`, `ZOOM_WEBHOOK_SECRET_TOKEN` | Zoom Marketplace: a Server-to-Server OAuth app with the meeting scopes, and a Meeting SDK app for the SDK keys; the host user must be a licensed user. Needs a Zoom plan that allows API meetings (the current account is the Free plan) | Create, link, dial-in, SDK token and host key, end and delete |
| Resend | `RESEND_API_KEY`, `RESEND_FROM` (a verified sender), optionally `RESEND_WEBHOOK_SECRET` | Resend dashboard: API key (a sending-only key is enough), verified domain | Send and the idempotency key; only ever to `@resend.dev` test inboxes |
| Termii | `TERMII_API_KEY`, optionally `TERMII_BASE_URL` | Termii dashboard | Balance and sender ID list. Reads only: no SMS is sent. A Nigerian sender ID registered and approved is the founder's step; until then that line is SKIP |
| Speech vendor | not used by this command | See `scripts/asr-eval/SCORING.md` | The gold-set score runs on the vendor's transcript files |

## Reading the result
- **PASS**: the vendor answered as the adapter expects.
- **FAIL**: something differs. The line says what. Typical first findings: `ZOOM_HOST_USER_ID` not set (Zoom's account-level token cannot use `me`); a Paystack transfer waiting for an OTP (turn transfer OTP off in the dashboard, which is the founder decision OQ-97); a reused charge reference not answered as a conflict.
- **SKIP**: not checked, with the reason (no credentials, no Nigerian dial-in numbers on the Zoom account, no settlement yet in test mode).
A FAIL on shape (a field name) means correct the mapping in the adapter and add that payload to `packages/integrations/src/fixtures`; then this command and the fixture tests agree.

## What this does not touch
No platform database, no production webhook endpoint, no live key. The webhook checks sign a made-up event with the secret you gave (or a throwaway one) and confirm the adapter agrees with an independent implementation of the vendor's documented algorithm. The deployed endpoints are checked separately by the vendors' own dashboards (Paystack "Send test webhook", Zoom "Validate" on the event subscription, Resend webhook test), whose answers are in the fixtures.

## After a green run
Record the date and the PASS/SKIP list in `docs/BUILD-PROGRESS.md`, then ask the founder which go-live items (payout guard, Zoom plan, speech vendor) are now unblocked. Nothing switches on because this passed.

## Audio fallback on real handsets
Separate tool, same idea: `docs/runbooks/audio-fallback-handset-measurement.md`.

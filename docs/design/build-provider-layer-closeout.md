# Provider layer completion: closeout

Branch `build/provider-layer-completion`. Nothing was applied, deployed, merged or switched on. No live vendor was called. No signed configuration value changed. All four provider flags, `payouts_enabled`, `payout_gl_posting` and AI-017 are as they were (OFF). Design: `docs/design/build-provider-layer.md`. Research and vendor audit: `docs/research/build-provider-layer.md`.

## Built
- Vendor audit of Zoom, Paystack, Resend, Termii and a speech shortlist, with every field mapping tabled; defects fixed (Zoom webhook constant-time compare, `start_time` format, Svix timestamp strictness, 256 KiB body cap on all three webhooks, payout send after a timeout or unreadable reply now looks the reference up).
- 31 recorded-fixture contract tests plus branch tests; `check-adapter-coverage.mjs` makes 100 percent of branches, lines, functions and statements on the fourteen vendor-facing modules a failing condition of `pnpm test` in `packages/integrations`.
- `scripts/provider-sandbox-check.mjs` and runbook: PASS / FAIL / SKIP per capability against vendor sandboxes; refuses `sk_live`; masks secrets; 10 tests with sabotage.
- Audio fallback handset probe and report tool; 6 tests.
- Speech gold-set pass-mark gate (95 percent), scaffold, `SCORING.md`; 23 tests across the harness.
- Payout re-audit: CMO as second approver enforced in the database (OQ-338), a batch cannot pay its own maker, maker-checker flag tied to the `payouts_enabled` guard both ways (flag cannot be turned off, renamed or deleted while the guard is on). Proof `p4y` (sabotage caught); S31x proof updated (59 of 59) and the S37 guard proof updated to turn the flag on first (S37 is a fresh-replay proof and cannot run against live data; it needs the CI replay).
- `public.provider_layer_health()` and a card on both chain-health pages. Proof `p4z` (sabotage caught); a provider whose every message failed its signature check (wrong or rotated secret) now shows as needing a look. No cron added.

## Credentials and accounts the founder must supply, per remaining check
| Check | Needs | Command |
|---|---|---|
| Paystack test mode: banks, charge, duplicate reference, recipient, transfer and its idempotency, settlements | A Paystack **test** secret key (`sk_test_...`); transfer OTP switched off in the dashboard (OQ-97) so a transfer does not wait for an OTP. A settlement exists only after real settled charges, so that line stays SKIP in test mode | `node --env-file=.env.sandbox scripts/provider-sandbox-check.mjs --only paystack` |
| Zoom: create, link, dial-in, SDK token, host key, end | A Zoom Server-to-Server OAuth app with meeting scopes (account id, client id, client secret), **a licensed dedicated host user and its id or email as `ZOOM_HOST_USER_ID`** (without it a Server-to-Server token cannot create a meeting), a Meeting SDK app for `ZOOM_SDK_KEY` and `ZOOM_SDK_SECRET`, the webhook secret token, and a Zoom plan that allows API meetings (the account is on the Free plan) | `... --only zoom --allow-zoom-meeting` |
| Resend: send, idempotency, webhook signature | A Resend API key, a verified sender (`RESEND_FROM`), the webhook signing secret | `... --only resend` |
| Termii: balance, sender ID | A Termii API key, and a **registered, approved Nigerian sender ID** (until then that line is SKIP, and SMS to Nigerian numbers will be filtered) | `... --only termii` |
| Speech vendor | A vendor account and API key (any of the shortlist), a recorded **scripted** gold set (24 clips, 5 accents), the CMO's reference transcripts and a reviewed `drug-names.json` | `node scripts/asr-eval/run.mjs <gold>/manifest.json` |
| Audio fallback values | Real handsets: at least 2 models, 5 runs per stressed condition; the CMO or founder decides the values | `docs/runbooks/audio-fallback-handset-measurement.md` |

## Proposed OQ text
- **OQ-PL-1**: Confirm `ZOOM_HOST_USER_ID` is set in production, or set it. Until it is, the first real Zoom room will fail (a Server-to-Server token cannot use `me`). Nothing breaks today because no real room has ever been created.
- **OQ-PL-2**: Should Paystack's transfer approval callback (Paystack asks our URL to approve each transfer; we answer yes only for a payout in a released batch) be turned on before `payouts_enabled`? It is the provider-side twin of our maker-checker. Needs the feature confirmed on the Paystack account.
- **OQ-PL-3**: Who is the CMO's deputy when the CMO is away? With the pair rule, nothing can be released without the CMO (decided in OQ-338 as deliberate), so a week of leave is a week without payouts unless a second CMO-tier doctor exists.
- **OQ-PL-4**: Schedule `provider-event-drain` and `settlement-reconcile` (vault secrets, staggered cron within the connection budget). The new health card will show "nothing is draining the inbox" once an event has waited over an hour, which is today's honest state.
- **OQ-PL-5**: The brief cited the speech pass mark as OQ-343; in the repo the decision is recorded in `docs/DECISIONS.md` as OQ-343 (renumbered in `OPEN-QUESTIONS.md`). No action, noted so nobody searches for the wrong number.

## Not proven, stated plainly
Every vendor behaviour in the research tables tagged [K] (recalled from the published reference; the vendor pages could not be opened in this session). The first real run of the sandbox check is the proof. Paystack settlement field names remain unproven until a real settlement is read. The browser probe page was not run on a handset. The gold-set gate has only synthetic scores.

## Apply and deploy order (lead)
1. Migrations in file order after merge: `20261020183417_p4y_payout_controls_reaudit.sql`, then `20261020190127_p4z_provider_layer_health_read.sql`. Live head when written: `20261020173600`. Both proved in a rolled-back transaction on the live project; nothing was left behind (checked). `release_payout_batch` was rewritten from its live definition (identical to the S31x file at the time).
2. Deploy functions `zoom-webhook`, `resend-webhook`, `paystack-webhook` (body cap; Zoom replay window) and anything importing `_shared/integrations` or `_shared/payouts` (`payouts`, `order-checkout`, `settlement-reconcile`, `provider-event-drain`). Code first, schema second is safe here either way: no function depends on the new SQL.
3. Web deploy (chain-health card). Until p4z is applied the card shows "could not be read", never healthy.
4. Nothing to switch on.

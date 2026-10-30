# Stage 2 exit criteria (DRAFT, for founder and CMO review)

Status: DRAFT, statuses updated 2026-10-29 from live checks. Every number is PROPOSED unless it is marked as already set. "[founder to set]" means only the founder can choose it. Nothing here is signed, and no agent has signed or attested anything.

**What this gates.** The go-live guard `public_signup_enabled` (`docs/BUILD-SPEC-v5.md` line 612: "Stage 2 exit criteria met"). While it is off and `signup_invites_required` is on, only people on the invite list can sign up. The list lives in the table `signup_invites` (migration `20261007231528_signup_invite_list.sql`; the brief called it `pilot_invites`, the real name is `signup_invites`). Turning the guard on opens sign-up to everyone. The database cannot check these criteria itself, so the founder or CMO records an attestation with a note (BUILD-SPEC line 1186).

**Rule.** The guard stays off until every row below is "Met" with its proof attached, and the rollout in section I has finished its hold-points. One "Not met" blocks it.

Status key: Met / Partly / Not met / Unknown (the repo cannot show it). Sources are `docs/STAGE-1-SIGNOFF.md` (2026-10-28), `docs/OPEN-QUESTIONS.md` (OQ) and `docs/legal/`.

## A. Stage 1 must be complete first

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| A1 | "Stage 1 complete" is written at the top of `docs/BUILD-PROGRESS.md` by the S40 gate run | That line exists, dated, after a fresh S40 run | Founder | Not met (sign-off says NOT complete) |
| A2 | All 25 safety cases pass, and the device-only rows pass on a real iPhone and a real Android phone, including case 1 end to end (offline guidance, reading syncs, page fires) | `SC-01` to `SC-25` results plus a written device log in STAGE-1-SIGNOFF section 3 | Engineering | Partly: 2 to 25 pass on automated proofs; case 1 passed on emulators only; no real phone yet |
| A3 | The CMO has reviewed the safety-case fixtures (`packages/clinical/fixtures/safety-cases.json`, 54 cases) and the safety case document is signed | Signed safety case with version and date | CMO | Partly: screening safety case v1.0 signed (#1440); fixture review not recorded |

## B. Clinical safety

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| B1 | A named on-call rota covers every hour of the week, with a backup for each shift, for the whole first batch period | Rota export with no gap (the rota gap view in the ops console) | CMO | Partly (checked 2026-10-29: 0 gap hours and 0 hours without a backup for the next 168 hours, but only 2 real clinicians alternate primary and backup, so there is no spare; the proposed `rota_cover_policy` asks for 5 or a smaller number confirmed in writing) |
| B2 | A real test page reaches a real on-call clinician by in-app, push and email, is acknowledged, and a deliberately unacknowledged one escalates at the signed times (5 and 10 minutes are PROPOSED in spec section 17) | Dated log of two live drills, one acknowledged, one not, with timestamps | CMO and Ops | Not met (proofs pass in the database; no live drill recorded) |
| B3 | The escalation SLA in `escalation_slas` is the active signed version and matches what ops can actually staff | Query: the active row of `escalation_slas`, plus the CMO's signature | CMO | Met with a caveat (v9 active and signed; it still names `whatsapp` and `whatsapp_nudge`, which the code reads as email by D-12, tracked as OQ-29; the record is stale, behaviour is correct) |
| B4 | No governed clinical config is live unsigned | The unsigned-config guard from #1432 reports zero rows; owed-signoffs ledger is empty | CMO | Met (checked 2026-10-29: all 4 owed sign-offs signed; the ledger has no unsigned row). Re-check on the day |
| B5 | Doctor capacity for the first batch: patients per doctor stays below a limit the CMO accepts | [founder to set with CMO]. No ratio is proposed here. | CMO | Not met (no number set) |

## C. Payments

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| C1 | One real Paystack payment with a live key succeeds end to end, and the webhook creates exactly one entitlement; a replayed webhook creates no second one | Live-key payment record, entitlement row, replay test result | Founder (key) and Engineering | Not met (test mode only; live webhook never run) |
| C2 | A refund of that payment works and reverses the entitlement | Refund record and ledger entries | Engineering | Not met on live key |
| C3 | Paystack settlements reconcile to the ledger with no unexplained difference over a full week | Reconciliation report, difference = 0 kobo (PROPOSED) | Founder and Finance | Not met |
| C4 | Open money questions are answered: the 250,000 kobo test leftover in account 2100 (OQ-28), and the CBN licence opinion | Written finance decision; counsel opinion | Founder and counsel | Not met |
| C5 | Rate limits on the payment and mobile routes (OQ-267) | Test showing refusals above the limit [founder to set limit] | Engineering | Partly (the 37 `/api/mobile/*` routes are covered by one proxy rule in #1449, per session with a per-IP flood cap, and safety routes are never session-limited. It is per server instance until Upstash is provisioned (runbook section 3). `order-checkout`, `order-verify`, `queue-next` and `queue-handback` are Supabase edge functions that bypass the proxy and are still unlimited) |

## D. Data protection

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| D1 | Point-in-time recovery is switched on in Supabase, with the retention window written down | Dashboard screenshot and the number in `BUSINESS_CONTINUITY_DR_SPEC.md` | Founder | Unknown (spec says nothing is verified) |
| D2 | A restore has been tested on a non-production branch and measured: time to recover (RTO) and data lost (RPO) | Dated restore drill note with both measured numbers. Targets: [founder to set] | Founder and Engineering | Not met |
| D3 | A signed processor agreement (DPA) exists for every processor that sees patient data (Supabase, Vercel, Paystack, Resend, Termii, Zoom, Anthropic, Voyage, Dojah, Twilio, Upstash) | `docs/PROCESSORS.md` rows all marked "signed" with file links | DPO | Not met (OQ-268: none signed; Anthropic is a draft) |
| D4 | Lawful cross-border transfer mechanism chosen for the eu-west-1 database | Counsel's written choice | DPO and counsel | Not met |
| D5 | Retention period and erasure process are set | `privacy.retention.retentionPeriodYears` and `privacy.transcript_retention` are non-null; one erasure request run end to end | DPO and counsel | Not met (both are null) |
| D6 | Public token endpoints cannot be guessed or brute-forced | Token length and entropy, and a database lockout where the secret is short | Engineering | Met (checked 2026-10-29: emergency-card tokens are 43 characters and prescription tokens 64 hex characters, both 256 bits; the passport (date of birth) and share (PIN) doors already count attempts in the database). A request-count limit on these doors is not required |
| D7 | Breach runbook rehearsed once | Dated tabletop note against `docs/legal/breach-notification-runbook.md` | DPO | Unknown |

## E. Security

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| E1 | Supabase security advisor shows no error-level finding that is not justified, and any warning left is listed with a reason | Advisor run output saved on the day | Engineering | Met with reasons (run 2026-10-29: 7 findings; the one ERROR is 18 deliberate owner-run views, see E2; warnings: 17 anon-executable and 1,824 signed-in-executable security-definer functions, mostly public-by-design token lookups and checked RPCs; leaked-password protection is off and needs the Supabase Pro plan; 1 extension in public; 7 functions without a fixed search path) |
| E2 | Every view that runs with its owner's permissions is on a reviewed list, is unreadable by anon, and (for directories) never carries a commission, contact, cost or credential-number column | `packages/db/tests/owner_run_views_allowlist.sql` passes in CI | Engineering | Met once #1448 merges (checked 2026-10-29: 18 owner-run views, all deliberate with a documented reason; converting them to `security_invoker` would break the patient-facing directories) |
| E3 | An independent security review of patient-scoped tables and staff access, with no open high finding | Review note and closed finding list | Engineering | Partly (S39 hardening merged; outside review not recorded) |
| E4 | Every function anonymous users can call is intended to be public | The list of anon-executable functions, each with a reason | Engineering | Partly (2026-10-29: 17 functions, all token lookups, public price and coverage lists and audit event triggers; each needs a one-line reason recorded) |

## F. AI governance

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| F1 | Every AI feature that is on has an approved prompt, approved knowledge sources and a passing evaluation run made by a person | `ai_systems` rows with approval records; evaluation run IDs | CMO | Not met (checked 2026-10-29: 15 AI systems enabled, 6 of them high-risk: Health Coach, case-brief drafting, lab and ECG extraction, risk scoring, coordinator draft reply; the guardrails and knowledge sources have no human approval) |
| F2 | Any AI feature without those approvals stays off (AI-017 scribe is off) | `ai_systems.is_enabled = false` for each | CMO | Met as of the last record; recheck |
| F3 | Anthropic processing agreement signed (see D3) | Signed file | DPO | Not met |

## G. Operations

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| G1 | A named incident owner and a named deputy, with phone numbers, for every hour of the first batch period | One page in `docs/runbooks/` signed by the founder | Founder | Not met |
| G2 | A support channel patients can reach, with a stated reply time [founder to set] and a person staffing it | Channel live; test message answered within the stated time | Ops | Unknown |
| G3 | A public status page exists and the incident owner knows how to post to it | Live URL; one test post | Ops | Not met (no status page in the repo) |
| G4 | A staging deployment of both apps exists (OQ-36) | Staging URLs; a passing smoke run | Engineering | Not met |
| G5 | Alerting on failed nightly jobs: if a scheduled run fails or is skipped, a named person is told within 1 hour (PROPOSED) | Forced failure triggers the alert | Engineering | Partly (screening scheduler skip alert shipped in #1435) |

## H. Legal and regulatory

| # | Must be true | Proof | Owner | Status |
|---|---|---|---|---|
| H1 | Nigerian counsel has answered the open question sets (`questions-for-nigerian-counsel-S39.md`, `-S83.md`, cover memo) | Written opinions filed in `docs/legal/` | Founder and counsel | Not met |
| H2 | MDCN position on the doctor-authority split, and on fee sharing (OQ-178) | Counsel or regulator letter | CMO and counsel | Not met |
| H3 | Terms and consent schedules are the signed versions the app shows | Signature record (membership terms sign-off exists as a file) | Founder | Partly |
| H4 | NDPC registration and DPO appointment | Already approved and accepted (2026-09-15) | DPO | Met |

## I. Staged rollout (how the guard is finally turned on)

Timeline: with a 7-day hold and 3 clean batches, the final switch is at least about 3 weeks after batch 1. Batch 1 can open earlier, once sections A to C and G1 are Met. The first batch is sized to what two on-call clinicians can cover until the rota reaches the number the CMO confirms.

1. **Batch 1.** Invite [founder to set; PROPOSED 25] people through `signup_invites`, with `signup_invites_required` on and `public_signup_enabled` off.
2. **Hold-point 1.** Do not invite anyone else until the first nightly screening run after batch 1 has completed for every batch-1 member with no skipped patient, no unacknowledged red page, and no open incident. Minimum wait [founder to set; PROPOSED 7 days].
3. **Batch 2.** Up to [PROPOSED double the previous batch], then the same hold-point.
4. **Stop rule.** Any red page unanswered past its SLA, any wrong patient shown another person's data, or any payment taken twice halts invitations until the CMO and founder sign a written cause and fix.
5. **Final step.** After at least [founder to set; PROPOSED 3] clean batches, the founder records the attestation that Stage 2 exit criteria are met, and only then turns `public_signup_enabled` on. Whoever turns it on writes the reason in the switch note.

## Sign-off block (empty on purpose)

Founder: ____ Date: ____  CMO: ____ Date: ____  DPO: ____ Date: ____

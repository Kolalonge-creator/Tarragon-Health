# S26 to S30: review against competitors and build plan

Date: 2026-10-07. Scope: S26 (entitlements, care pack lifecycle, refunds), S27 (partner lab portal, result release), S28 (pharmacy partner), S29 (Care Circle), S30 (fee schedules, earnings ledger).
Session prompts: `docs/v5-sessions/S26` to `S30`. Spec: `docs/BUILD-SPEC-v5.md` 4.4, 4.7, 4.8, 7.7, Modules 3, 8, 17, 21.

## 0. How this was produced, and what is not verified

- All five sessions are already built and mostly applied to production. This is therefore a review of what shipped plus a gap-closing plan, not a first build.
- Repo facts come from `origin/main-dev` (`BUILD-PROGRESS.md`, `OPEN-QUESTIONS.md`, `docs/design` and `docs/research` for each session) read on 2026-10-07, not from the live database. Before any session extends a function, check its live definition (CLAUDE.md lesson).
- Competitor facts come from (a) the repo's earlier research files (`research/S26.md`, `S27-competitors.md`, `S28.md`, `S29-ranked-design-plan.md`, `S30.md`, the two `competitor-review-*` files) and (b) three fresh web-research passes run today. Fresh passes were thin: clinician-side screens (Wheel, OpenLoop, Doximity and others) and most Nigerian pharmacy and lab portals are behind logins and were not confirmed. Anything tagged (inferred) is industry-pattern reasoning, not observation. No app was installed.
- The commerce and Care Circle pass reported after the first draft and is folded into 2.1, 2.4 and 4 (S26b, S29d). It used search snippets only, not full pages, so its terms (Noom 14-day, One Medical 30-day, Calm 30-day, Hims and Ro auto-renew) must be re-checked on vendor pages before quoting.
- Nothing here is legal or tax advice. The MDCN fee-splitting rule and the 5 percent withholding rate were not confirmed against primary text.

## 1. What shipped, and what is still not live

| Session | Built | State | Biggest unfinished items |
|---|---|---|---|
| S26 | `refunds` state machine, `request_order_refund`, `decide_order_refund`, `consume_entitlement`, expiry sweep, 7-day reminder (once, via `reminded_at`), `create_order` with beneficiary | Merged (#955), migration live, checkout dormant behind `v5_checkout` | Reminder cron hardcodes `in_app` channel; one reminder only; no Paystack test refund yet; refund timing config is PROPOSED (OQ-127) |
| S27 | `lab_results` release state machine, DB classifier, partner entry, patient upload, clinician release and disclosure, sensitive-positive rule, sex-specific ranges and units (S27g) | Merged, live | CMO has not signed the ranges, so every result is held (fails closed); explain gate has no consumer yet (OQ-179); critical-value release authority (OQ-180); no real partner lab has used it |
| S28 | Pharmacy chooser, collection code, locked after 5 wrong tries, partial and full dispense, one shared supply count, go-live guard, structured questions (S28c) | Live; guard OFF | No licence-verified partner pharmacy exists (OQ-274); one medicine per prescription (OQ-275); no mobile screen (OQ-277); controlled-medicine counter check (OQ-276); duplicate PR #993 still open to close |
| S29 | Care Circle invites, per-permission supporter view, neutral red alerts, pause sharing, preview, gifted membership waits for patient yes | Merged (#957), live | OQ-192 (older paths admit any caregiver grant); gift window 14 vs 30 days; supporters abroad rely on a single organisation (OQ-220); no native deep links |
| S30 | Versioned `fee_schedules`, append-only `earnings_ledger`, contracted clinicians only, queue fee, admin and clinician pages | Live; nothing seeded, zero lines | Founder has not entered a schedule; no refund reversal of a consultation share; pilot minimum can be gamed (OQ-180); counsel on fee-sharing (OQ-178) |

Two cross-cutting findings from the review itself:
1. **OQ numbers collide.** `docs/OPEN-QUESTIONS.md` uses OQ-127, 128, 133, 176 to 185, 192, 213 to 229, 270 to 277 and 280 to 289 more than once for unrelated topics (for example OQ-176 is both an S24 trigger issue and S27 lab ranges; OQ-270 is both S28 and S38). Any decision or code comment that cites a bare OQ number is ambiguous. Fix before more sessions add to it.
2. **S26 and S30 do not talk to each other.** A refund revokes the entitlement but a consultation share already posted to a clinician stays; OQ-184 records it as a manual adjustment. This is a real money gap once checkout is on.

## 2. Comparison with full competitor products

### 2.1 S26: entitlements, expiry, refunds

| Product | What is in the whole offering | Lesson for Tarragon |
|---|---|---|
| Reliance Health (NG) | Payer and beneficiary split is first class at purchase; annual benefit limits per category; full refund if payment taken but plan not accepted; cashback for clean claims | Our beneficiary split already matches. Annual use limits per benefit are shown to members; ours show remaining uses only |
| Calm | Gift codes, non-stacking, 30-day refund window, 5 to 10 day refund timing stated | Say refund timing in days at every step; state the stacking rule |
| MyFitnessPal | Non-US 14-day cooling-off respected | Matches our `refunds.cooling_off_days` (14); FCCPA expects refund limits written at checkout |
| Insight Timer | Non-refundable, no pro-rata, no real gifting | Do not copy: a bare no-refund stance conflicts with Nigerian consumer law and our gifting goal |
| Omada, Personify | Sponsor-paid entitlement ends with the sponsor contract; no consumer renewal event | Relevant only to the NGO and employer cohorts, not to individual Membership |

(inferred, from repo research) Best-in-class subscription products send reminders at several steps (30, 7, 1 day), keep read access for a short grace period after expiry, and show a refund status the user can follow.

Gap against best: single 7-day reminder; hardcoded channel; no grace period; no plain-words refund rule on the receipt; no refund SLA or denial reason shown; no weekly reconciliation against Paystack refund status; no pro-rata rule (current stance: none after the window, which is a founder decision, not a bug).

### 2.2 S27: lab results

| Product | Release and sensitive handling | Partner side | Lesson |
|---|---|---|---|
| Everlywell | Physician review, phone call on critical, positive STD held until contact or 3 failed attempts | Partner labs | Our hold-and-disclose rule is at the cautious end and matches; add the bounded fallback when contact fails |
| LetsGetChecked | Nurse calls positives | n/c | Same |
| Healthtracka (NG) | Results by email in 24 to 48 hours; free doctor consult on positives; partner labs held to ISO and MLSCN | Phlebotomist home collection | Show the patient an honest expected time; require lab quality proof before a lab goes live (our placeholder-contact guard is the start) |
| Epic MyChart | Immediate release by default since 2021; Houston Methodist auto-releases sensitive labs after 24 hours with a 10-day cap on clinician deferral; Colorado allows 3 business day hold unless patient asks | n/a | Immediate release is a US statutory model and does not transfer. Two ideas do: a patient can ask to see a held result, and no hold may last forever without an escalation |
| Function Health | Results as they arrive, clinician summary in 1 to 2 weeks | Quest | Fits wellness panels, not HIV or hepatitis |
| Eka Care, Practo | Patient uploads parsed into trends | Parsing API | Our patient upload stays held; trends need coded values |
| Quest, Labcorp (inferred) | Amended result versions kept; critical-value call log with read-back; turnaround dashboards | Delta checks, HL7 or FHIR | Corrections must supersede, never overwrite, and notify the patient |

Gap against best: no explicit lifecycle of preliminary, final, amended, corrected (a `s27f` corrections branch exists; verify whether merged); no critical-value call log with acknowledgement and SLA; no hold-aging escalation; patient "waiting for review" state with a time estimate should be checked; no specimen ID, rejection or recollection flow (spec section on the lab network); no turnaround dashboard for the partner or for Tarragon; no delta check; nobody has signed the ranges.

### 2.3 S28: pharmacy

| Product | Capabilities | Lesson |
|---|---|---|
| mPharma Bloom (observed) | Medication history, refills, reminders, pharmacist-patient messaging, instalment credit; consignment stock | Refill reminders and messaging matter; consignment makes the platform a supplier, which we must avoid (PCN duties) |
| Yodawy, JD Health, PharmEasy, 1mg | Send Rx to chosen pharmacy, price comparison, delivery | Delivery and price comparison are deliberately out of scope (Part C.2; OQ-283) |
| Medisafe, MyTherapy | Refill countdown, adherence | Already covered by the S28c refill reminder |
| Nigeria Electronic Pharmacy Regulations 2026 (observed, BusinessDay) | Aggregators register with PCN and appoint a Superintendent Pharmacist; telemedicine prescriptions accepted with clinical record and consent; controlled drugs excluded from online sale; Data Protection Act applies | Confirms controlled medicines must stay out; counsel should read the full text before the guard goes on |

Gap against best: nothing is live until a licence-verified partner exists; one medicine per prescription; no mobile screen; no counter check for controlled medicines; no stock confirmation step (prices were deliberately not shown); no pharmacy quality scorecard (turnaround, flags, complaints, per spec 21.7).

### 2.4 S29: Care Circle

| Product | Pattern | Lesson |
|---|---|---|
| Reliance Alafia (NG) | Buy a plan for an older relative | Matches pay-for-a-loved-one; ours is stricter (yearly Membership only, patient must accept) |
| Calm, Strava | Gift code never expires; privacy zones and per-item sharing | Our unanswered-gift expiry with refund is the safer choice for a health product |
| Medisafe Med Friends, Apple sharing, Life360 (inferred) | Supporter alerts for missed doses, summaries, one-tap pause | We have pause, preview and "I called them"; we deliberately show no readings or conditions (INV-07) |
| Reliance dependants | Added to a plan | We refuse family plans (founder narrowing) |

Added from today's pass (snippets, unverified): One Medical refunds an unredeemed gift to the buyer and nothing after redemption, and a full refund within 30 days if unused, which is the same shape as our "unanswered gift refunds the payer" and cooling-off rule. Medisafe's Medfriend is view-only, keeps "manage on behalf of" as a separate role, and alerts only after a delay (missed dose flagged at 1 hour); Life360 gives the person 5 minutes to respond before the circle is told. Our red alert goes to supporters at once; consider a short patient-first window for non-emergency check-in requests only, never for a red event, and put it to the CMO. Reliance publishes per-benefit sub-limits, so show remaining entitlement in the app. Auto-renew traps (Hims, Ro, Noom) are the pattern to avoid; our no-auto-renew rule is a selling point.

Gap against best (from `S29-ranked-design-plan.md`): warnings at 14 and 3 days before supporter access ends; supporter "needs attention" badge as push backup; native app deep links for the join link; clear rule for supporters abroad; tighten the older `profile_access` read paths (OQ-192) which are a real exposure.

### 2.5 S30: clinician fees and earnings

| Product | Pay and screens | Lesson |
|---|---|---|
| Uber (observed) | Weekly statement with period, line items and total; payout 1 to 3 days; optional paid instant cash-out | Statement must reconcile exactly to the payout; instant cash-out is an optional later add-on (OQ-199) |
| Amwell, Teladoc (observed, thin) | Per-visit or per-consult pay to contractors, rates not published | Pay per unit of work is the norm; ours varies by task type, which is better |
| Wheel, OpenLoop | Per encounter, flat rates vary by service and sync or async | Same shape as ours |
| Babylon (observed lesson) | Flat per-appointment pay, no weighting; accused of cherry-picking and losses; bankrupt 2023 | Keep fees different per task type and weight old work, never a volume quota |
| Deel, Remote (observed clause pattern) | Pay undisputed amount, hold disputed line | Add a dispute path per ledger line so one dispute never blocks a payout |
| Zocdoc | Provider pays per new patient | Never key clinician pay to acquisition or referral |
| Paystack Transfers (observed) | NGN fee 10, 25 or 50 per transfer by amount | Weekly payout fee is trivial; absorb it |

Gap against best: no per-line dispute button with response SLA; no gross, tax and net columns (D-09 says store, not calculate; Nigerian guides say 5 percent, unconfirmed); no refund reversal; no inactivity check on the pilot minimum; no pending versus approved versus paid status on each clinician line view (S31 holds payout state, check whether the line view joins it); clawbacks or rating deductions must not be added without appeal.

## 3. The best build, derived

Principles taken from the comparison, in priority order:

1. **Safety before polish.** Close the permission hole (OQ-192) and sign the lab ranges before anything else; neither needs much code.
2. **Say it in plain words and days.** Refund rule, refund timing, wait time for a held result, expiry dates: always stated, always in days.
3. **Corrections supersede, nothing is overwritten.** Lab corrections, ledger adjustments, fee schedule versions, refund records all follow one rule.
4. **Every hold has an owner and an end.** A held lab result, an unanswered gift, a stuck payout, a locked collection code each have a clock and an escalation, never an indefinite state.
5. **One money truth.** Refund, entitlement, ledger share and GL reversal change together or not at all.
6. **No referral-linked pay, no stored balance, no supplier role.** Reaffirmed by the MDCN risk, INV-09, and PCN duties.
7. **Dormant until real.** Pharmacy, payouts, checkout and fee schedules stay behind go-live guards until a real partner, a real test payment and counsel answers exist.

## 4. Build plan

Sessions are named with a letter after the original number so they stack on what is live. Each session follows the usual close-out (design note, RLS tests, sabotage test, `/code-review high`, BUILD-PROGRESS entry).

### Phase 0: unblock (no code, or tiny)

| # | Item | Owner |
|---|---|---|
| 0.1 | Renumber the colliding OQ entries; add a scan test or lint that rejects a duplicate heading number | build session |
| 0.2 | CMO signs lab panel v2 and ranges through `sign_lab_panels` (every result is held until then) | CMO |
| 0.3 | Close PR #993; merge or close the stale S28 and S26 side branches (`fix/s26-proof-and-types`, `s28/pharmacy-partner`, `s28c/pharmacy-extras`) after checking they are fully contained in main-dev | founder |
| 0.4 | Paystack test payment and test refund (runbook `docs/runbooks/S25-test-payment.md`) | founder supplies test key |
| 0.5 | Counsel one-pager: MDCN reading of a consultation share, 5 percent withholding and payer duty, PCN rules for the prescription flow, NDPA basis for supporter red alerts | founder |
| 0.6 | Founder decisions listed in section 6 | founder |

### S26b: entitlement and refund hardening

- Reminders at 30, 7 and 1 day via a SQL function that uses `private.patient_reminder_channel()`; remove the hardcoded `in_app` cron path. One row per step so each sends once.
- Plain-words refund and cancellation rule at checkout and on the receipt (wording from counsel); refund timing in days; message at each refund step.
- Refund SLA and denial reason shown to the patient; weekly reconciliation job comparing `refunds` to Paystack refund status.
- 7-day read-only grace after expiry with one-tap renew and no doctor time (needs decision 6.3).
- Refund calls a reversal for any posted consultation share (see S30b); GL posting stub completed.
- Tests: reminder idempotence per step, refund state machine under a failed provider call, reconcile finds a mismatch (sabotage flips).

### S27h: lab lifecycle and partner quality

- Result versions: preliminary, final, amended, corrected; amended replaces by supersession, patient notified once, history kept (verify what `s27f` already merged; build only the remainder).
- Critical-value path: tracked call to the responsible clinician, acknowledgement time, SLA clock, escalation through the existing S19 pages ladder; decide release authority for critical (OQ-180).
- Hold-aging: a held result has a visible clock for the clinician, escalation to the clinical lead at a PROPOSED threshold, and a patient message with an honest expected time. Never auto-release a sensitive positive.
- Bounded disclosure fallback after N failed contact attempts (Everlywell pattern), CMO-signed text.
- Specimen ID, rejection reason and automatic recollection request; turnaround dashboard for the partner and for the console; delta check against the patient's last value as a flag to the reviewer, not an auto-release.
- Wire `canExplainLabResult` into S32 audio and any AI summary.
- Partner onboarding checklist: licence and accreditation proof recorded before `is_active` (extends the existing placeholder-contact guard).
- Tests: safety cases 11 to 13 re-run, correction supersede, hold-aging escalation, sabotage of the explain gate.

### S28e: pharmacy readiness and reach

- Multi-medicine selection: one choice, one code per pharmacy visit (OQ-275).
- Mobile collection screen (OQ-277).
- Counter check against the controlled list; approved repeats routed through the partner list (OQ-276, CMO).
- Partner scorecard: turnaround to dispense, flags raised, complaint count, licence expiry warnings; removal rule per spec 21.7.
- Stock confirmation as yes or no only (no price display, per OQ-283).
- Activation runbook: verify licence, add locations, create pharmacist login, attest the three guard conditions, switch the guard on for one pharmacy only.
- Not built, on purpose: delivery, price comparison, consignment or supplier role, chat (structured questions only).

### S29d: Care Circle security and reach

- First: tighten the older `profile_access` read paths named in OQ-192 to the matching permission or category; prove with simulated sessions and a control, in its own PR before any real caregiver grant.
- 14 and 3 day warnings before supporter access ends; renewal only on the patient's tap.
- Supporter in-app "needs attention" badge as backup to push.
- Explicit cross-organisation rule for supporters abroad (OQ-220); native deep link for the join link.
- Apply the founder's gift window (14 or 30 days).
- Shared-phone and discreet mode stay in the S34 area.

### S30b: earnings completeness

- Per-line dispute: one tap, reason code, response SLA, resolves into an adjustment line; a disputed line is held out of the next payout while the rest pays.
- Statement shows gross, a withholding amount field (stored, not calculated, until D-09 is decided) and net; PDF statement and tax credit note once counsel answers (OQ-200).
- Refund reversal of a consultation share, automatic, linked to S26b; closes OQ-184.
- Pilot minimum: an inactivity check (declared block with no claims and no expired-claim inactivity) before a top-up posts (OQ-180); late-line netting (OQ-185).
- Pending, approved, paid and failed status on each line, joined to S31 payout state; retry for failed transfers.
- Founder enters and approves the first fee schedule in `/admin/earnings`; nothing is seeded by code.
- Deferred: instant cash-out (OQ-199), any rating-based deduction, any acquisition-linked pay.

### Merge order and parallelism

Phase 0 first. Then S29d security part and S26b in parallel (separate tables). S30b needs S26b's reversal hook, so it follows. S27h and S28e are independent of each other and can run beside S26b. Apply order for migrations: check live `list_migrations`, dry run in a rolled-back transaction, pin the version to the filename, deploy edge functions after.

## 5. Risks

| Risk | Mitigation |
|---|---|
| Money changes before a real Paystack test | S26b and S30b stay behind `v5_checkout` and `payouts_enabled`; test payment first |
| Lab results all held until CMO signs | Phase 0.2 first; doctors will otherwise see every normal result |
| Hold-aging could tempt auto-release | Written rule: escalation only; sensitive positives never auto-release (INV-04) |
| Corrections notification leaks condition | Neutral template through the INV-07 lint |
| Instant cash-out or clawbacks added later | Out of scope; needs a new decision and counsel |
| Tax or MDCN wrong | Store fields only; percentages default to zero; counsel one-pager |
| Competitor facts overstated | Most Nigerian competitor portals unverified; do not quote them externally |
| Duplicate work from overlapping sessions (S28 built twice) | Check `git branch -r`, open PRs and `list_migrations` before starting each session |

## 6. Decisions needed from the founder

1. Gift window: 14 or 30 days (OQ-225 note).
2. Cooling-off cost: Tarragon absorbs the Paystack fee on a 14-day refund (assumed yes).
3. Grace period after expiry: what read access includes, and whether it is 7 days.
4. Pro-rata refunds after the window: confirm none for now.
5. Refund SLA number and denial-reason wording.
6. Critical lab values: senior clinician only, or any tied clinician (OQ-180).
7. Hold-aging thresholds and the bounded-contact fallback count (CMO to sign).
8. Backup on-call fee and the pilot-minimum inactivity rule (OQ-179, OQ-180).
9. Whether consultation share stays at zero until counsel answers (recommended yes).
10. Whether to close PR #993 and the stale side branches.
11. Which pharmacy to verify first, and who verifies the licence.

## 7. Sources used

Repo: `docs/BUILD-PROGRESS.md`, `docs/OPEN-QUESTIONS.md`, `docs/DECISIONS.md`, `docs/design/S26` to `S30`, `docs/research/S26`, `S27-competitors`, `S28`, `S29-ranked-design-plan`, `S30`, `competitor-review-africa-2026-10`, `docs/research/S46-S50-competitor-gap-and-build-plan.md` (format).
Web (observed, via today's passes): Techpoint and MIT Solve on Healthtracka; Houston Methodist and Reliant Medical Group on MyChart release; Colorado bill text on sensitive results; BusinessDay on the Electronic Pharmacy Regulations 2026 and on withholding tax reform; Uber driver payment pages; Paystack transfers docs; Becker's on Babylon. Details and links are in the agents' reports and should be re-checked in each session's research step.

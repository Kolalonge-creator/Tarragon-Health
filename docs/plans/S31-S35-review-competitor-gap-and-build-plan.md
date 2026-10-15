# S31 to S35 review, competitor comparison and build plan

Date: 2026-10-07. Branch context: `s38/outcome-snapshots-analytics`. Status: DRAFT for founder decision. Nothing here is approved, signed or started. No code was changed to produce this document.

Sessions covered: S31 weekly payouts, S32 audio manifest and number stitching, S33 BP care course and breathing, S34 low-data, accessibility and size, S35 clinician console and patient summary (including S35b and S35c).

## 0. Evidence, and what this is not

- **Repo facts** were read from `origin/main-dev` (design notes, research notes, `BUILD-PROGRESS.md`, `OPEN-QUESTIONS.md`, `STAGE-1-SIGNOFF.md`), not from the S38 working branch. **Live facts** are from four read-only queries on 2026-10-07.
- **Competitor facts are weak.** Five research passes today used search snippets only, with almost no primary pages (two fetches were blocked with 403). Most per-product claims are background knowledge and are tagged that way in the sources. Every competitor number, price and tariff below is "re-verify before using in a decision". The earlier per-session competitor passes in `docs/research/S31..S35.md` are of the same quality and were not redone.
- This is not legal or tax advice, and no regulator (NAFDAC, MDCN, NHIA, FIRS) was consulted.
- Not verified at all: Wheel, OpenLoop, Teladoc, Amwell, Kangpe, Mobihealth, Helium, Reliance, Clafiya pay terms; Epic and Oracle screens; Nigerian fintech app sizes; Android Go market share in Nigeria; per-product lesson design for Omada, Livongo, Noom, Calm.

## 1. Headline findings

1. **All five sessions are merged. None has been used by a single person.** Live today: 0 payouts, 0 earnings-ledger lines, 0 verified clinician bank accounts, 0 `clinical_tasks`, 14 BPC lessons all unpublished, 0 recorded audio clips, `payouts_enabled` off. Nothing in S31, S33 (lessons) or S35 can show a real result until the triage rule set is signed and tasks flow (OQ-88) and the CMO acts. The design is ahead of the competitors in several places; the proof is behind all of them.
2. **The single biggest enabler is an end-to-end harness.** S35 could not write Playwright (OQ-212: no way to seed a clinician and a claimable task). The Stage 1 sign-off lists the same hole: the 5 authenticated sign-in specs "have never run", and Maestro, device timing and a real Paystack payout are all unrun. Every session below needs this first.
3. **Two things can lose money or trust silently** and should be fixed before any go-live: a payout stuck in `sent` after a lost webhook (OQ-197, decided "next session", not built), and withholding tax (OQ-193). The agent research says the payer is the withholding agent at 5 percent on professional fees, with no professional-services exemption (secondary sources), so "pay gross and let clinicians self-assess" leaves Tarragon exposed.
4. **The "ahead" claims are mostly on paper.** Whole-phrase clinical sign-off for spoken readings, claim-before-visible queueing, one audit row per summary open, and facts-to-confirm scribe review have no equivalent in any competitor we could find. But the audio system has no recording, the native player has never run, and the scribe is off with no evaluation run.
5. **Effectiveness is the gap in the BP course, not content.** Every comparator that reports a blood pressure effect pairs content with the patient's own readings, nudges and a human. S33 is 14 identical lessons with none of the three. Published African mHealth effects are small (about 2 mmHg at 12 months in the South African StAR trial, secondary), so plan for a modest effect and measure behaviour first.

## 2. Where each session stands

| Session | Built and live | Not done (the real list) | Position vs competitors |
|---|---|---|---|
| S31 payouts | 6 tables, weekly draft job, maker-checker approval (payee cannot approve own; ledger re-read must match), Paystack transfer with deterministic reference, `transfer.*` webhooks, verified-name bank check, clinician statement, CMO may approve (S36j, S36k). Applied and deployed 2026-10-06. Guard off. | Never run against Paystack. No lost-webhook check (OQ-197). No tax, no credit note, no PDF statement (OQ-193, OQ-200). No GL posting (OQ-194). Retention job for mismatched names not built (OQ-195). Go-live note wrong (OQ-198). No independent code review (self-reviewed only, found and fixed one hole). | Par to ahead on approval and bank verification. Behind on failure handling. Gap on tax documents and ledger posting. |
| S32 audio | Manifest of 835 clips, `packages/audio` (resolve, stitch, all-or-nothing, per-pattern sign-off, checksum-bound), importer, device layer (expo-audio, downloader), wording file signed by the founder 2026-10-07 (not the CMO). | Nothing recorded or signed. Native player never run on a device; needs a new EAS build (OQ-201). Listen buttons only on the emergency modal and only when a signed recording exists. No hosting for post-sign-up audio (OQ-204). BP unit clip NUM-P24 and EMG-001L not yet in the Production List. | No competitor found that couples a spoken reading to a triage sentence. Behind on reach (no IVR, feature phones) by design. |
| S33 BP course | 14 lessons seeded as DRAFT, `learning_course()` gate (published and in-date only), review-lapse auto-hide, reviewer credit only from a real record, BRE-01 pacer, understandability kit, English only. | No lesson read by a clinician, recorded or tested with people. No CMO approve screen (OQ-302, founder chose CMO-only). No offline lesson cache (OQ-307). No speed control (OQ-304). No personalisation, nudges, coach loop or outcome measure. Older programme functions would serve a draft lesson in an active programme (OQ-301, mitigated by keeping the programme inactive). | Ahead on governance and safety. Gap on personalisation, nudges, human loop, outcomes. |
| S34 low-data and accessibility | `media-policy.ts`, `useLowData()`, accessibility scan test, 16 touchables fixed, size-report script. No targets by founder decision (OQ-252). | No network-type detection (needs native module). No cold start, memory, logging speed, 200 percent font, TalkBack or VoiceOver check on any device. Preference not mirrored to `profiles.low_data_mode`. No data-use meter. No call site yet except the audio player. | Par to ahead on static checks. Gap on everything measured on a real phone. |
| S35 console | Queue page, task view, audited patient summary, lead list, safety-concern button, S35b per-section scribe review, S35c facts-to-confirm, consent gate, hash-bound sign, CMO quality page. Migrations applied. | No Playwright (OQ-212). Scribe not in the consultation room (OQ-210). No offline tolerance. No evidence link from AI text to transcript. No AI-017 evaluation run; scribe off (OQ-213, OQ-214). No messaging inside the task flow. Still in `apps/web`, not `apps/console` (OQ-209). `private.may_work_on_note` fails open for a caller with no staff row (found, task spawned). | Ahead on claim and audit design. Behind on scribe evidence, offline and mobile. |

Housekeeping found while reading: OQ numbers 213 to 216 are used twice (S35c and S36a); the Stage 1 sign-off still shows S33 as open though the log shows it merged; the S33 progress entry still says "en/pcm" though Pidgin was removed. Fix the numbering before anyone cites them.

## 3. Competitor comparison by area

Legend: Ahead, Par, Behind, Gap. "Best" names the product to study, not copy. All competitor entries are secondary or background knowledge unless stated.

### S31 payouts

| Capability | Best | Tarragon | Verdict |
|---|---|---|---|
| Immutable earnings record and per-line statement | Stripe Connect reports, Deel invoice per contract | Ledger plus per-line statement | Par |
| Cadence | Bolt Nigeria Monday to Sunday, paid early next week | Weekly Monday, minimum with carry-over | Par |
| Maker-checker approval | Deel invoice approval | Re-read at approval, payee cannot approve | Ahead |
| Idempotent transfer | Paystack unique reference | Deterministic reference | Par |
| Lost-webhook recovery | Paystack verify-by-reference endpoint | Webhooks only, human retry | Behind |
| `otp` status and balance pre-check | Paystack dashboard "confirm transfers" setting | Treated as needs-attention, no balance check | Behind |
| Tax documents | Nigerian receipt for tax deducted; Stripe 1099 (US only) | TIN stored, nothing issued | Gap |
| Ledger posting | Marketplaces post accrual and cash journals | None | Gap |
| Early cash-out | Bolt (once a day, small fee), Uber Nigeria daily access | None | Gap, defer |
| Dispute and clawback | Deel invoice rejection | Negatives netted forward | Behind |

Nigerian facts the plan relies on (secondary, confirm with counsel): withholding regulations effective 1 July 2024; 5 percent on professional and consultancy fees to a resident; remit by the 21st of the following month; a credit note or receipt is due; the small-company exemption reportedly excludes professional-services businesses; Paystack transfer fees about NGN 10 / 25 / 50 by size, plus NGN 50 stamp duty on transfers of NGN 10,000 or more (from 18 Feb 2026), minimum NGN 50, single-transfer cap NGN 10,000,000. The fee and stamp-duty figures matter: a per-clinician weekly transfer below a few thousand naira can cost a noticeable share, so the PROPOSED payout minimum should be set with them in view.

### S32 audio

| Capability | Best | Tarragon | Verdict |
|---|---|---|---|
| Spoken reading on a device | Talking BP monitors and glucometers (A&D class) | Stitched human clips plus mandatory triage sentence | Par on function, Ahead on coupling (none found doing it) |
| Offline emergency audio | None found in any comparator | Bundled in install | Ahead on paper, unproven |
| Outbound education | Kilkari (72 weekly IVR calls), MomConnect, PROMPTS | None | Gap by design (app only) |
| Dial-in audio on a basic phone | Viamo 3-2-1 | None | Gap by design |
| Clinical safety review | PROMPTS routes about 7 percent of messages to nurses | Checksum-bound phrase sign-off | Ahead on design, zero sign-offs done |
| Evidence of effect | Kilkari RCT: about 65 percent heard at least half; null on the primary outcome | None | Gap |
| Nigerian-language speech tech | Spitch, N-ATLaS, NaijaVoices (research stage) | Not used | Correct to avoid |

Licence facts worth keeping: Meta MMS-TTS is non-commercial; N-ATLaS needs a separate licence above 1,000 users; Nigerian-language speech recognition word error rates quoted at 29 to 42 percent are far too high for any clinical input. NAFDAC may treat software that monitors or triages as a medical device (Classes A to D); no source found addresses spoken triage guidance specifically, so this is a question for written advice, not an assumption.

### S33 BP course and breathing

| Capability | Best | Tarragon | Verdict |
|---|---|---|---|
| Plain-language rigour and teach-back | NHS and AHA style material | 14 lessons, PEMAT and CCI targets, teach-back each | Ahead on spec, Gap on proof |
| Clinical governance | Regulated digital therapeutics | Draft until CMO publishes, lapse hides lesson, null-gated credit | Ahead, unexercised |
| Personalised to the patient's readings | Hello Heart, Withings, Omada | Same 14 for everyone | Gap |
| Spaced nudges | Medisafe, Hello Heart, SMS programmes | None | Gap |
| Human coaching | Noom hypertension study (coach, calls every 2 weeks), Omada, Livongo | Care team exists; no loop from the course | Behind |
| Outcomes evidence | Omada about -4.8 mmHg at 12 months (retrospective); vendor figures of -10 to -21 are survivor-biased | None | Gap |
| Slow breathing | Meta-analysis about -5.6 / -3.0 mmHg; device-guided analysis shows no benefit | BRE-01, no BP claim, safety card first | Par to Ahead |
| Audio, speed, offline | Standard in meditation apps | None | Behind |

### S34 low-data, accessibility, size

| Capability | Best | Tarragon | Verdict |
|---|---|---|---|
| No autoplay, tap to load | Facebook Lite | Pure policy function, emergency exempt | Par to Ahead |
| Network-type detection | Lite apps, Android Data Saver | Unknown counts as not Wi-Fi (safe, but over-restrictive) | Gap |
| Data-use meter | Per-app usage on Android; WhatsApp | None | Gap (differentiator: a GB is about NGN 500 to 800 per secondary sources) |
| Static accessibility checks | WCAG 2.2 guidance | Role, label, target and scale scan; contrast tests | Par to Ahead |
| Screen-reader order, 200 percent visual, real users | Apple Health, mySugr (anecdotal) | None | Gap |
| Cold start and memory on low-end Android | Google Macrobenchmark | None | Gap |
| Setting follows the account | Facebook, WhatsApp | Per phone | Gap (minor) |

Device facts for choosing test phones (Statcounter via search snippet): Tecno 17.2, Apple 17.2, Samsung 16.3, Infinix 15.1 percent. iOS testing is not optional. No verified share for 3 GB-or-less phones was found; do not cite one.

### S35 clinician console

| Capability | Best | Tarragon | Verdict |
|---|---|---|---|
| Pull one task, patient hidden until claimed, timed hold | Few do this; Epic pools are browsable | Built, 50-session race proof | Ahead |
| Audited one-screen summary, one audit row, safety-first order | Glooko ordering; Epic break-the-glass | Built | Ahead on audit, Par on content |
| Scribe with consent, quotes, per-section confirm, hash-bound sign | Abridge (evidence links), Nabla, Corti (facts first) | Built, off, no evidence link, no evaluation | Behind |
| Scribe accuracy evidence | Studies: omissions 18 percent, hallucinations 11.5 percent in one pilot; 31 percent hallucination vs 20 percent in another (all secondary snippets) | Nothing measured | Gap |
| Offline tolerance | CommCare, Medic, OpenMRS, limited in Epic Haiku | None | Gap, critical for Nigeria |
| Mobile clinician app | Haiku, Doximity, Teladoc | None | Gap |
| Messaging in the task flow | Epic In Basket with MyChart | `care_messages` exists, not joined to tasks | Behind |
| Paging | Epic Secure Chat, PerfectServe | Acknowledge alarm, no voice rung | Par to Behind |
| Number masking for calls | Doximity Dialer | None | Gap |
| End-to-end tests | Mature vendors | None | Gap |

## 4. The best build: principles

1. **Prove before adding.** For each session the first work is a thin real run (one real payout, one recorded batch, one published lesson tested with people, one device measurement, one claimed task), not new features.
2. **Keep the designed-in advantages and add nothing that weakens them.** Claim-before-visible, deterministic triage, checksum-bound sign-off, gross-only until tax is decided, no AI-staged orders, no browsable patient list, no hard targets for size or start time (OQ-252).
3. **Fix the silent failures first** (lost webhook, tax, stale queue page offline, scribe omissions), because a competitor-style feature on top of a silent failure is worse than no feature.
4. **No feature may depend on a notification succeeding.** Every nudge is an in-app item first; push and email are extras.
5. **A human signs every clinical word and number.** Lessons, spoken phrases, rule sets, scribe notes. Where the founder has signed on the CMO's behalf (EMG/TRI wording, 2026-10-07), the CMO re-signs by raising `version` before launch.
6. **Measure outcomes at the lowest cost.** Behaviour proxies (readings logged per week, "try today" done) before blood pressure change.

## 5. Proposed sessions

Naming follows the repo habit (a letter suffix on the parent). Effort: S under a day, M a few days, L about a week or more. Each session ends with the usual design note, research note, proof, `/code-review high` and a progress entry.

### Phase 0: unblock (before any of the rest)

**S35d: end-to-end harness (S).** Seed a test clinician with tier, a test patient with a tie and access category, a CMO, and a claimable task, using the simulated-JWT pattern already in memory. Specs: concurrent claim (one winner), hold with one extension, reason-coded hand-back, expiry returns task, summary open writes exactly one audit row, denied state, safety-concern from every page, scribe consent declined means no panel, hash mismatch refused, on-call acknowledge, CMO approves a payout and a non-CMO is refused, a clinician with no tie reads nothing. Runs on the local Supabase stack in CI (branching is unavailable on the current plan). This closes OQ-212 and part of Stage 1 section 7. Also used by S31b, S33b and S34b.

**Decisions pack (no code).** One page for the founder, CMO and counsel listing section 7. The largest blockers are tax counsel (OQ-193), the Paystack settings and test payout (OQ-196), the CMO publishing lessons (OQ-302), a voice actor, and who runs the understandability test (OQ-306).

### S31 payouts

**S31b: money-safety completion (M).** All before `payouts_enabled` is ever turned on.
- Scheduled status check for payouts `sent` longer than an hour, using Paystack verify-by-reference and the existing `apply_payout_transfer_event` door (OQ-197). Never retry under a new reference without verifying the old one first.
- Balance pre-check before approving a batch, and the single-transfer cap; handle the `otp` status explicitly (visible, expires, never silently stuck).
- A `reversed` transfer re-credits the ledger and the payee sees it.
- Fee-aware payout minimum (transfer fee and stamp duty), as a PROPOSED value.
- Ledger posting: accrue on approval, clear cash on `transfer.success` (OQ-194), with fees and stamp duty as their own lines.
- 12-month retention job for mismatched resolved names (OQ-195); correct the go-live note through the sanctioned route (OQ-198).
- Independent `/code-review ultra`-level review, naming money, silent failure and duplicate-payment classes. This moves money and so far had only a self-review.
- Runbook and one real small payout to a test recipient on Paystack, then the founder attests `paystack_transfers_configured` (OQ-196). Not done by an agent.

**S31c: tax and documents (M, blocked on counsel).** After counsel confirms contractor status and rate: versioned PROPOSED withholding rule, deduction line on the statement, credit note, per-payout PDF statement, monthly remittance report (due by the 21st), TIN required before a payout is approved for a contractor type that needs it. Per-clinician contractor status confirmed by counsel, because on-call shifts and fixed lead fees could be read as employment (PAYE instead of WHT).

**S31d: later, only on demand (M).** Dispute and clawback flow; optional early cash-out, capped and opt-in with eligibility (OQ-199); refund holdback (OQ-200, needs S26). Not before the first month of real payouts.

### S32 audio

**S32c: first recording batch and a real device (M).** Tier 1 only, about 120 of 835 clips: about 25 emergency and triage sentences, about 65 number clips with connectors ("over", "millimetres of mercury", "milligrams per decilitre"), about 25 onboarding and navigation basics. One Nigerian-English speaker under a signed licence with consent, no cloning, raw master kept. Add EMG-001L and NUM-P24 to the Production List first. Ingest, then clinician sign-off per phrase. Cut the native build (`runtimeVersion` to native6), host audio (public bucket, OQ-204), run on a 4 GB Tecno or Infinix, wire Listen to EMG and TRI only. Tests: boundary-splice of every stitched number in the 90 to 200 and 50 to 130 range, cheap phone speaker, 10 to 20 target users repeat the reading and the action correctly. Ship tier 1 only after the device test.

**S32d: tiers 2 and 3 and policy (S to M).** NAV and HLP offers once tab names settle (OQ-205); screen-reader treatment decision per screen (OQ-207); written advice on whether spoken triage is regulated software (OQ-207). Basic-phone reach (IVR like Viamo or Kilkari) is recorded as an explicit "not now" decision, not forgotten.

Do not do: synthetic voice for clinical numbers, MMS-TTS, N-ATLaS in production, speech recognition for symptom input, any claim of improved outcomes.

### S33 BP course

**S33b: publish path and proof (M).** The CMO approve screen with the CMO's name recorded (OQ-302, option a); fix the older programme functions so a draft cannot leak (OQ-301); CMO reviews all 14 lessons against `docs/research/s33-understandability/cmo-review-checklist.md`; confirm or edit the BRE-01 values and safety card (OQ-305, note the card is visible today while lessons are not); run the 10 to 15 person understandability test with the stated pass rule, at least one site outside Lagos (OQ-306, founder to name who recruits). Publish only lessons that pass.

**S33c: make it work, not just exist (L).**
- Reading-linked suggestions: a deterministic, CMO-signed rule set (not AI) such as a high reading suggests the "what to do now" lesson, a week without readings suggests the measuring lesson, a new diagnosis starts the basics. PROPOSED config, same signing route as other clinical rules.
- In-app next-action items on days 1, 3 and 7 after each lesson, then weekly; email and push optional extras that never carry a condition (INV-07).
- Teach-back correct or incorrect logged per lesson with a 7-day re-ask; behaviour proxies (readings logged per week before and after, share of "try today" done); BP change only as a secondary outcome.
- A missed teach-back or a high reading after a lesson raises a care-team task through the existing queue (a new, CMO-signed task type), never a coordinator gate.
- Offline course cache (OQ-307); lesson speed control once the audio port has a rate (OQ-304); recorded lesson audio only after S32c proves the pipeline.
- Evaluation design written before launch: a comparison cohort and a pre-set success threshold for behaviour. Plan for a single-digit mmHg effect at best.
- Decide BRE-03 versus BRE-01 naming (OQ-300).

Do not do: loss-framed streaks, fear framing, BP-lowering claims for breathing, numeric targets in generic lessons, vendor "-20 mmHg" figures as targets, synthetic lesson voices.

### S34 low-data, accessibility, size

**S34b: device lab and the missing hooks (M).**
- Devices: a 4 GB Tecno or Infinix (the supported floor), a 6 GB mid-range phone, one older 3 GB phone as a below-the-floor check, plus one iPhone. Firebase Test Lab or BrowserStack for repeatability.
- Measure: cold start (time to initial and full display), time to log a reading, memory after a 5 minute session, bytes for the home screen and the log flow in low-data and normal mode, installed size. Weekly automated run, results as a time series and a PR comment that warns above 20 percent worse than the last release. **Never fails the build** (OQ-252).
- Add `expo-network` or NetInfo in the next native build so the Wi-Fi rule stops treating every connection as mobile data; mirror the preference to `profiles.low_data_mode`.
- Data-use meter ("you used X MB this week").
- Per release: a TalkBack and VoiceOver reading-order pass and a 200 percent font screenshot set on the reading and dose cards. Quarterly: 5 older or low-vision users.
- Wording: "tested against WCAG 2.2" with the coverage listed, never "compliant".

### S35 console

**S35e: offline-tolerant task view (L).** Cache the held task and its summary on the clinician's device, queue outcome and hand-back actions, show "last synced" and an unsent state; a queued signature reads "pending upload" and is never shown as final. First as a PWA/web behaviour on shared and low-end devices; a native clinician app only if the PWA proves insufficient. Each cached summary is itself PHI: encryption at rest, expiry, and a wipe on sign-out are part of the design note, and the audit row is still written when the page is opened (not when it syncs).

**S35f: scribe into the room, with evidence (M to L).**
- Mount scribe and summary in the consultation room (OQ-210).
- Decide the retention question (discard after the visit versus keep for evidence links) with the CMO and counsel; only then build the link from each AI sentence to its transcript span.
- Run the AI-017 evaluation on local, consented Nigerian-accented audio, with allergy, medicine and negation errors as the priority classes, before the switch is ever turned on. Do not seed a passing run (OQ-213, OQ-214). Use the word-error-rate harness already built.
- Fix `private.may_work_on_note` fail-open as its own migration with a sabotage proof.

**S35g: workflow completeness (M).** Care message thread shown on the task (the existing `care_messages`); reply drafting only if every draft needs an explicit edit and confirm (guarding against rubber-stamping); number masking and a voice rung in paging, which first needs a decision because D-12 allows only push, in-console alarm and email; keyboard shortcuts and safe batch acknowledge; acknowledge-latency metrics.

**S35h: move to `apps/console` (L, last).** Security hygiene, not a clinician-visible gain; follow `docs/design/S01d.md` (OQ-209). Do not widen the console role before the area is extracted.

Do not do: browsable shared worklists, a population panel view, AI-staged orders or prescriptions, a scribe that learns from edits on its own, a free ad-supported scribe model with data reuse, throughput targets that reward clicking through.

## 6. Sequencing

```
Phase 0:  S35d (E2E harness)  +  decisions pack
          |
          +--> S31b ---> [counsel] ---> S31c ---> (S31d later)
          +--> S32c ---> S32d
          +--> S33b ---> S33c   (S33c audio waits on S32c)
          +--> S34b
          +--> S35e, S35f ---> S35g ---> S35h
```

- Parallel after Phase 0: S31b, S32c, S33b, S34b, S35e are independent of each other and can be separate worktrees. They share no tables. S35f and S33c both touch AI governance paths and the clinical task types; run them in separate weeks.
- Run `list_migrations` on the live project at the start of each migration session. This repo has repeatedly had live migrations with no file, and the local clock has read earlier than a committed file twice (S36j, S36k).
- Order of value for the founder's pilot: S35d, S31b, S33b, S32c, S34b, S35f, S31c, S35e, S33c, S35g, S35h.
- **Gate:** S40 (Stage 1) is not passed. These sessions do not unblock S41 onward; several of them are the evidence S40 needs. Treat them as Stage 1 completion work.

## 7. Decisions needed

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D1 | Tax counsel: contractor versus employee per clinician type, withholding rate, credit note format, remittance duty (OQ-193) | Founder, counsel | S31c, payouts go-live |
| D2 | Confirm Paystack settings (OTP off, funded balance, webhook URL) and run one small real payout (OQ-196) | Founder | S31b close |
| D3 | Who owns the finance GL posting design (OQ-194) | Founder, finance owner | S31b |
| D4 | Voice actor and licence terms; CMO re-signs EMG/TRI wording on top of the founder's signature | Founder, CMO | S32c |
| D5 | Written advice on whether spoken triage is a regulated device (NAFDAC) | Founder, counsel | S32d, launch |
| D6 | CMO reads and publishes lessons; who recruits and runs the understandability test and budget (OQ-302, OQ-306) | CMO, founder | S33b |
| D7 | Rule set for reading-linked lesson suggestions and the new task type | CMO | S33c |
| D8 | Test phones to buy, and whether a device-lab subscription is acceptable | Founder | S34b |
| D9 | Scribe audio and transcript retention (discard or keep for evidence links); local speech-to-text evaluation budget (OQ-214) | CMO, counsel, founder | S35f |
| D10 | Voice rung in paging and call masking given D-12 | Founder | S35g |
| D11 | Is basic-phone reach (IVR) explicitly out of scope for now | Founder | S32d |
| D12 | PWA first or native clinician app | Founder | S35e |

## 8. Risks

- **Money moves before the tax answer.** Mitigation: the guard stays off and the approval screen refuses a payout for a clinician whose tax profile is incomplete once D1 is answered.
- **Cached PHI on a shared clinician device** (S35e). Mitigation: encryption, expiry, wipe on sign-out, design review by counsel.
- **Scribe errors cluster in allergy and medicine data.** Mitigation: no switch-on without the S35f evaluation; keep per-section confirmation.
- **Recording quality fails the stitched-number splice test.** Mitigation: one speaker, boundary tests before sign-off, text fallback already built.
- **A course that no one finishes.** Mitigation: in-app items, reading-linked suggestions, measure behaviour early, expect small effects.
- **Competitor evidence is thin.** Mitigation: nothing in this plan depends on a single competitor number; re-verify before using any figure outside this document.
- **Stale numbering and duplicate OQ ids** cause wrong citations. Mitigation: renumber the S35c/S36a collisions first.

## 9. Sources

In-repo: `docs/design/S31..S35.md`, `docs/research/S31..S35.md`, `docs/BUILD-PROGRESS.md` (S31 to S35, S36j, S36k), `docs/OPEN-QUESTIONS.md` (OQ-193 to 200, 201 to 207, 209 to 217, 252, 300 to 308), `docs/STAGE-1-SIGNOFF.md`, `docs/BUILD-SPEC-v5.md` lines 426 to 434, 496 to 528, 569 to 588, 716 to 731, 2205 to 2218.

Competitor (all secondary snippets; re-verify):
- Payouts: businessday.ng Bolt early cash-out; nairametrics Uber daily access; docs.stripe.com/connect; deel.com contractor withdrawals; paystack.com/docs/transfers; support.paystack.com transfer fees and stamp duty; ey.com and mondaq.com withholding regulations 2024; pwc.com/ng tax reform acts.
- Audio: PMC9288869 and PMC10175950 (Kilkari); reachdigitalhealth.org (MomConnect); digitalx.undp.org (Viamo); wusf.org (PROMPTS); thecable.ng (Spitch); techcabal.com (N-ATLaS); regdesk.co (NAFDAC).
- BP course: pubmed 31331557 (slow breathing); 2minutemedicine.com (device-guided breathing); axios.com (Hello Heart); PMC8984054, PMC10485713 (digital hypertension programmes); resolvetosavelives.org (Nigeria programme).
- Low-data: developer.android.com macrobenchmark and app startup; techcabal.com Q1 2026 smartphone market; gs.statcounter.com Nigeria vendor share; businessday.ng data prices; insideglobaltech.com (European Accessibility Act).
- Console: frontiersin.org (scribe hallucination study); utsystem.edu (Epic In Basket draft replies); mondaq.com (Nigeria telemedicine compliance).

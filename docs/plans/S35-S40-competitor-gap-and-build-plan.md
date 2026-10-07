# S35 to S40 review, competitor comparison and build plan

Drafted 2026-10-07. Inputs: `docs/v5-sessions/S35` to `S40`, spec lines 254-262, 511-551, 589-698, 1933-2000, 2082-2091, 2219-2256 (read from `origin/main-dev`), the progress log and open-question files on `origin/main-dev`, open PR bodies (#1013, #1014, #1018, #1022, #1025), `docs/STAGE-1-SIGNOFF.md`, the earlier S35 to S39 research notes, and five fresh competitor passes (one per area).

**Read this first.**
- The local checkout was 172 commits behind `origin/main-dev`. Everything below is read from `origin/main-dev`, not the working tree.
- **Evidence caveat.** The competitor passes were short web searches. Several vendor help pages returned 403, and Wheel, OpenLoop, Teladoc, Vezeeta, Mobihealth, Lark, Glooko and Medisafe gave almost nothing. Every row tagged UNVERIFIED must be re-checked before it drives a decision. Competitor numbers (ROI, minutes saved, fines, pricing) are vendor or blog figures. Nothing here is legal or clinical advice.
- Counts such as "53 of 55 PROPOSED values unsigned" come from `STAGE-1-SIGNOFF.md`, written earlier today. Several things have moved since (S39h confirmed `security.rules`). Re-measure before quoting.
- This plan builds nothing. It orders work, and every work package still starts with its own session prompt, design note and CMO/founder decisions.

---

## 0. Where S35 to S40 actually stand (2026-10-07)

| Session | What it was for | State |
|---|---|---|
| S35 clinician console + patient summary | Next task, task view, audited summary, consultation view, hand-back, signing | Built and merged (#963, #967, #975). Screens live in `apps/web/clinician`, not `apps/console` (OQ-209, decided). **Playwright never written** (OQ-212). Scribe and summary are not inside the consultation room (OQ-210). Two scribe consents unresolved (OQ-211). AI-017 still off; no evaluation run exists. |
| S36 ops, clinical lead, admin | Credentialing, search with audit, roster, reliability, directory, partner, speak-up, payouts | Built in pieces (S36a to S36k). Merged. Open decisions OQ-213 to OQ-216 and OQ-220 to OQ-247 (S36 numbering). **No Playwright** (credentialing, payout approval, result release were all deferred). No support inbox across app, email and phone. No automation of routine ops. |
| S37 go-live guards | Seven guards, sign-off screen | Built and merged, with S37b (safety-case attestation). **Only some guards are enforced anywhere** (OQ-184). Safety case not tied to a protocol version. One-person attestations (OQ-183). |
| S38 outcomes | Snapshots, report, risk, monthly report, sponsor figures, triage accuracy | Built through S38g. Mostly merged and applied. Triage-review switch is **off** (OQ-257). Sponsor consent text is a DRAFT (OQ-256). Accuracy report has no data. No HEARTS-vocabulary indicators. |
| S39 security | Catalog test, tied reads and writes, audited opens, registry, purge, export, secret scan | S39 to S39c merged and applied. S39d to S39h on stacked PRs #1013, #1014, #1018, #1022, #1025, mostly applied, **CI red on those PRs** (Playwright browser E2E, migration replay, TypeScript). #1022 reports **24 proofs that already fail on the live baseline**. Open: PITR off and never restored (OQ-266), DPAs unsigned (OQ-268), rate limits unprovisioned (OQ-267), erasure (OQ-262, counsel). |
| S40 Stage 1 gate | Run the full matrix, write "Stage 1 complete" | **Not passed.** `BUILD-PROGRESS.md` still opens with the plain title. Maestro, Playwright, device performance and the 25 safety cases have not been run as a set. Later modules (S51 to S66, S85) are already being built on open PRs, so the gate is currently being worked around, not satisfied. |

**The honest summary:** S35 to S39 delivered more database-level safety than most competitors publish. What is thin is *proof that it works end to end* (browser and device tests never run, 24 baseline proof failures, CI red) and the *operational* layer around it (backups, safety case discipline, inbox, recall, reconciliation).

---

## 1. Decisions needed before any session starts

| # | Decision | Owner | Blocks |
|---|---|---|---|
| D1 | **Gate stance.** Either finish S40 properly, or record a written, signed waiver naming each skipped check, owner and expiry. Part B work is already running past the gate. Pick one on purpose. | Founder | Everything in section 4, phase 0 |
| D2 | **Backups.** Upgrade Supabase to Pro, enable PITR, restore into a scratch project, record RTO and RPO. Already "decided" in OQ-266 but not done. | Founder | Phase 0; real patients |
| D3 | **Audio and transcript retention for evidence links.** Linking a note phrase to its transcript span (Abridge-style) needs retained audio or timed transcript. Counsel question, plus a retention number. | Founder + counsel | S35d-1 |
| D4 | **Paging ladder voice rung** (D-12 permits push, in-console alarm and email only) and **number masking** (needs a virtual-number vendor, a cost, a DPA). | Founder | S35d-4 |
| D5 | **Paystack transfer OTP.** Bulk transfers are blocked while OTP-on-transfer is on. Keep OTP and pay one by one, or turn it off and rely on in-app maker-checker. | Founder | S36l-3 |
| D6 | **MDCN register access.** No known public API (UNVERIFIED). Ask MDCN whether any lookup or bulk check exists. Otherwise a named human re-checks on a schedule. | Founder | S36l-1 |
| D7 | **Second signer for clinical guards.** The CMO signs everything today. Who is the independent countersigner: a retained external clinician as a separate identity? | Founder + CMO | S37c-1 |
| D8 | **Rollout cohorts.** With no staging environment, production cohorts are the staging. Agree a named allow-list, then a percentage step, with dwell times. | CMO + founder | S37c-3 |
| D9 | **HEARTS vocabulary.** Adopt Simple/HEARTS names (registered, under care, lost to follow-up, missed visit, visited with no BP) on clinician and NGO views. | CMO | S38h-1 |
| D10 | **Patient-visible access log.** Already OQ-281 (counsel, DPO). Competitor evidence is thin (UNVERIFIED), so this is a trust bet, not a copy. | Counsel + founder | S39i-5 |
| D11 | **NDPC level.** Confirm whether Tarragon is an ultra-high, extra-high or ordinary-high controller of major importance, and so whether the annual Compliance Audit Return (31 March) applies. | Founder + counsel | S39i-4 |
| D12 | **Restricted-record tier** (staff-as-patient, VIP, sensitive categories get an extra reason step). | Founder + CMO | S39i-2 |
| D13 | **Clinician-level quality views.** Allowed for the CMO only, as today? League tables carry gaming risk. | CMO + founder | S38h-4 |

---

## 2. Competitor comparison by session

Legend: **Ahead**, **Par**, **Behind**, **Gap** (nothing built), **Skip** (deliberately not copying). Confidence is the research agent's, not mine.

### S35: clinician console

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Work allocation | Epic In Basket and Secure Chat are push or browse inboxes (about 100 inbox views per physician per day; patient portal messages up 153% from 2020 to 2025; PCPs about 52 minutes per day on the inbox) | Pull-only Next task, no browsing, forced hand-back reason, claim timeout | **Ahead** |
| Urgent paging | Hospitals tell staff Secure Chat is "non-urgent only" and use separate paging tools | Acknowledge-gated page, 5 and 10 minute escalation | **Par/Ahead** |
| Scribe sign-off | Abridge, Nabla, Epic ART produce drafts the clinician edits | Hash-bound signature, nothing unsigned in the record, facts-to-confirm step, consent gate | **Ahead** (no competitor evidence found of hash binding) |
| Evidence link from note to source | Abridge "Linked Evidence" (phrase to transcript span and audio), described as the trust mechanism | None | **Gap**, needs D3 |
| Offline tolerance | Suki SDK buffers audio 15 s then goes offline, syncs on reconnect. Helium Health markets an offline-first EHR | None; console needs a connection | **Gap**, high value for Nigeria |
| Chart-aware drafting | Ambience (grounded in prior notes, labs, meds, problem list). Suki passes existing diagnoses into the session | Summary exists; scribe draft does not take the problem list as context | **Gap**, cheap |
| Note edit helpers | Nabla Magic Edit (expand, shorten, include/exclude per section), dot phrases | None | Gap, low priority |
| Number masking and callback | Doximity Dialer: masked caller ID, 1-hour proxy callback line | None | **Gap**, needs D4 |
| Population view | Glooko clinic dashboard ranks by risk then trigger severity (TIDE pilot: 86% less data-review time, small pilot) | Lead list ranked by time-to-need | **Par**; clinic-level "share at target" view missing |
| Real-time prompts during a call | Corti (red-flag prompts, UpToDate lookup) | None | **Skip for now**: weakest outcome evidence, highest alert-fatigue risk (about 90% override rate in a 2024 meta-analysis), and INV-01 allows only deterministic rules |
| AI-staged orders and learning from edits | Suki stages orders; Nabla learns from edits | None | **Skip** (INV-02; edits would change record-generating behaviour outside AI governance) |
| Multi-language patient instructions | Nabla 35+ languages | English only (D-14) | **Skip** |
| Coding (ICD/CPT) | Ambience AutoCDI | None | **Skip**: no insurer billing loop |

Failure modes to design against: scribe omissions (JMIR 2026 pilot of 356 reviewed notes: 18% omissions, 11.5% hallucinations, 2.5% potentially serious), modest time saving (UCLA trial: about 41 s per note), consent claims (Sharp/Abridge class action, allegations only), inbox overload, alert fatigue. Tarragon's facts-to-confirm and consent gate already address the first and third. Omission *detection* (empty-section flags, per-section tick) is still open.

### S36: ops, clinical lead, admin

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Credential monitoring | Medallion: continuous monitoring against primary sources with alerts. NCQA-style rules expect monitoring between recredentialing | Expiry auto-removal plus a manual MDCN check | **Behind** |
| Primary-source verification (Nigeria) | MDCN/DataFlow route for foreign-trained doctors; ECFMG for Nigerian credentials. MDCN's own inspectorate calls fake practitioners "massive" | Not recorded as an evidence type | **Gap** |
| Pre-expiry reminders | CredentialStream, symplr, Modio | None (hard removal only) | **Gap**, trivial |
| Rota | QGenda/Deputy: swaps with approval, open-shift pickup, credential-aware slots, coverage-gap alerts | Rota exists; swap and coverage-gap tooling unconfirmed | **Partial** |
| Support inbox | Zendesk SLA policies and skills routing; access-log API for who viewed what | `care_messages` is patient to care team only. No inbox across app, email, phone | **Gap** (spec 25.4) |
| Access accountability on support reads | Zendesk Access Log (paid add-on) | Reason-gated audited open exists | **Par**; extend to inbox reads |
| Payout controls | Stripe Connect: payout reconciliation report tied to the batch, minimum balances for refunds. Paystack: resolves account name on recipient creation | Maker-checker approval, CMO may approve | **Par**; resolved-name check, reconciliation report and refund reserve not confirmed |
| Content/knowledge governance | Infermedica: staged process, regression suite, dated releases with counts. Ada: continuous post-market review. Hospital content libraries: 24-month review, two medical reviews | Directory freshness only. No review dates, maker-checker or regression set for content | **Behind** (spec 25.1, 25.2) |
| Protected speak-up route | Not found in any product reviewed (absence of evidence) | Built (S36i) | **Ahead** |
| Role-split reliability data | Not found elsewhere | CMO names, ops aggregates with minimum group | **Ahead** |
| Routine-ops automation | Commure marketing claims (over 85% revenue-cycle work autonomous, vendor claim) | None | Gap, but **rules-based only**, never for credentials, payouts or clinical content |

Failure modes to design against: lapsed credentials unnoticed, one-time register checks, wrong-person payouts, negative balances after refunds, support agents browsing without a change record, onboarding that asks for the same document twice (Practo complaints, anecdotal).

### S37: go-live guards

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Preconditions evaluated on real data at switch time, trigger blocks other paths | Flag platforms rely on role permissions, not data-dependent preconditions | Built | **Ahead** |
| Signed value bound to content hash | Flag tools record who, not a hash | Built (S37) | **Ahead** |
| Separate approver | Unleash change requests need 1 to 10 approvals; LaunchDarkly approvals | One CMO attestation | **Behind** |
| Scheduled changes | Unleash, Flagsmith | None | **Gap** |
| Progressive rollout | Statsig, LaunchDarkly. CrowdStrike 2024 is the cautionary case | On or off only | **Gap**; allow-list then percentage |
| Hazard log and safety case tied to release | NHS DCB0129: living hazard log, updated per release, named clinical safety officer | Attestation text only, not tied to a version (S37b follow-up) | **Behind** |
| Stale-guard lifecycle | LaunchDarkly stale-flag reports, change history | None; no review-by date | **Gap** |
| Audit log outside the DB it protects | Flagsmith streams audit logs out by webhook | Append-only inside the same database | **Gap**, cheap |
| Post-market surveillance | DCB0129 and ISO 14971 require it | Incidents exist; no monthly safety review linking incidents to hazards | **Gap** |
| Enforcement coverage | n/a | Four of seven guards plus several live clinical flows not enforced (OQ-184) | **Own weakness, biggest real risk** |

Failures cited: Babylon (MHRA concerns, how safety-raisers were treated), Epic Sepsis Model (missed about two thirds of cases, local validation skipped), CrowdStrike (no staged rollout).

### S38: outcomes and analytics

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Small-cell suppression and subtraction control | Not documented by competitors | Min 11, held-back months, frozen figures | **Ahead** |
| Insufficient-data honesty | Simple counts any single reading under 140/90 | Fewer than 3 readings is never "controlled" | **Ahead** |
| Non-cost risk model, stored reasons, stored override | Innovaccer blends claims and social data; Obermeyer 2019 cost-proxy bias | Deterministic, explainable, never cost-based | **Ahead** |
| Personal report, no comparison, Care Circle sharing | Omada, Lark report cohort-level | Built | **Ahead** |
| HEARTS/Simple vocabulary | Registered, assigned, under care, lost to follow-up (12 months), controlled (registered over 3 months, BP under 140/90 in last 3 months), missed visit (3 months) | Different definitions, no LTFU/missed-visit/"visited, no BP" | **Behind** (and it is the language funders and the Ministry already use) |
| Registration cohorts | Simple and the DHIS2 package: quarterly registration cohorts | Personal-timeline cohorts (day 0/30/90/180) | **Gap** |
| Recall funnel | PAHO HEARTS QI: overdue patients called, reached, returned | None | **Gap** |
| DHIS2/NHMIS | National instance on DHIS2; FMOH adopted a HEARTS configuration; Dimagi pushes aggregates | None | **Not worth building now** (no facility orgunit; no obligation). Cheap step: DHIS2-shaped aggregate CSV |
| Matched-control ROI | Hinge 3.0x ROI (vendor), Omada claims | None | **Not buildable** (no claims data in Nigeria). Never imply it |
| Peer-reviewed publication | Omada hypertension cohort, JMIR Cardio 2023 (self-enrolled, non-randomised) | None | Later, once N is real |
| Accuracy by subgroup | Ada ED studies exist; nobody found publishing age/sex/region accuracy | Report built, no data, switch off | **Gap for everyone**: a chance to lead |
| Bias audit of Tarragon's own risk scores by sex, region, facility | Obermeyer lesson | Not done | **Gap** |

Failures cited: survivor bias in vendor outcome claims, company-run non-randomised analyses, FTC actions against telehealth marketing (consumer-protection, not outcomes reports), Teladoc goodwill impairment.

### S39: security, privacy, compliance

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Care-tied reads and writes, reason-free audited open (NHS model) | Epic break-the-glass, NHS SCR | Built (S39b, c, g) | **Par/Ahead** for a company this size |
| Alert triage workflow | NHS SCR: every flagged view goes to the Privacy Officer's Alert Viewer, with a user confirmation step | Alerts and a CMO review report, no case state | **Gap**, small |
| Snooping analytics | Protenus, Imprivata/FairWarning: same surname, same address, coworker, VIP, no-relationship | After-hours and bulk-opening rules only | **Gap**, a few SQL rules |
| Restricted-record tier | Epic break-the-glass on flagged patients | Reason on every opening, no restricted tier | **Gap** |
| Per-read audit on tied tables | Epic, NHS | Openings only (OQ-282, decided "per opening") | Accepted; sensitive-category table-level log is a listed next build |
| Patient-visible access log | Epic self-audit exists; patient-facing form UNVERIFIED | None | **Open** (OQ-281) |
| Backups with a tested restore | Standard expectation | **PITR off, no restore ever run** | **Behind, release blocker** |
| Compliance automation / attestation | Vanta, Drata, Secureframe; SOC 2 Type 1 roughly $15k to 30k (blog figures) | Manual register | Defer; ISO 27001 or NDPC audit first |
| Pen test and vulnerability disclosure | Cobalt from about $8.5k (review-site figure) | None | **Gap**; a security.txt is nearly free |
| MFA on every staff and admin entry | Change Healthcare 2024 breach entered via a portal with no MFA | Not confirmed | **Verify** |
| Tracker hygiene | FTC cases (Cerebral, GoodRx) | No ad SDKs on marketing site (S40 review); authenticated pages not scanned | **Verify** with a scan |
| NDPC obligations | GAID 2025: tiered DCPMI registration, annual CAR by 31 March for the top two tiers (50% late penalty reported by one source), DPIA, 72-hour breach notice, DPO | Registration approved, DPO accepted; level, CAR, DPIA and breach clock not recorded | **Open** (D11) |
| Processor DPAs | Standard | None signed (OQ-268) | **Behind** |
| Rate limits | Standard | Upstash never provisioned (OQ-267) | **Behind** |

Failures cited: Vastaamo (unreported breach, executive prison sentence), Cerebral and GoodRx (tracker sharing, FTC), Change Healthcare (no MFA, 4 TB over nine days), Health Fitness Corporation (no risk analysis, settlement).

### S40: stage gate

| Area | Best-in-class | Tarragon today | Position |
|---|---|---|---|
| Automated deterministic safety suite | Required for any clinical release | 54 BP fixture cases, CMO review of the fixture not recorded | **Par**, needs CMO record |
| Browser E2E in CI | Standard | Playwright job exists, **red on the S39 stack**, five console sign-in specs never run | **Behind** |
| Mobile E2E | Maestro CLI is free; hosted devices cost money (third-party figure) | Not run | **Gap** |
| Staging | Standard | None (OQ-36); production cohorts act as staging | **Waive with a rollback plan** |
| Hazard log and safety case per release | DCB0129 | Not versioned | **Behind** |
| Waiver register | Good practice | None | **Gap** |
| Device performance | n/a | Not measured, no targets (OQ-227) | Report, do not gate |

---

## 3. The best build, in one paragraph

The strongest product is not "more features". It is **Tarragon's existing database-level safety, made provable and made operable**: finish the gate honestly, bind the safety case to the thing it covers, make the clinician console survive patchy connections and show its evidence, close the credential and payout loops that competitors treat as table stakes, speak the Ministry's HEARTS language in outcomes, and lead on the two things nobody publishes (subgroup accuracy and anti-subtraction sponsor reporting). Everything else the competitors ship in this space (AI order staging, learning scribes, multi-language, coding, payer ROI, DHIS2 push, real-time call prompts) is either forbidden by an invariant, unmeasurable in Nigeria, or has weak evidence.

---

## 4. Build plan

Session ids use the project's lettering convention (next free letter after the last used one). Effort: S under 1 day, M 1 to 3 days, L over 3 days. Each package follows the standing rules: design note first, reconcile with what exists, proof script registered in `ci.manifest` with a sabotage step that flips, Jest alongside app code, `/code-review high` before the PR (name money, consent and fail-silent classes explicitly), `/code-review ultra` for anything touching RLS on patient tables. **Never hand-type a migration timestamp; check `list_migrations` on the live project for unrecognised recent versions before applying.** English only, no WhatsApp, no em dashes, no AI in triage, no AI output unsigned.

### Phase 0: make the gate real (do first, in this order)

| ID | Work | Effort | Acceptance |
|---|---|---|---|
| **S40-0a** | **Backups (D2).** Pro plan, PITR on, restore into a scratch project, record RTO/RPO in `BUSINESS_CONTINUITY_DR_SPEC.md`. Storage buckets (lab documents, transcripts) are not covered by database backups: add a separate copy plan | S | Restore drill logged with measured time and data loss |
| **S40-0b** | **Triage the red CI on the S39 stack** (#1013, #1014, #1018, #1022, #1025). Classify each failure: stale base, real regression, or already-failing baseline. Fix or quarantine the **24 proofs that fail on the live baseline** (each with an owner and a date, not silently excluded) | M | Every proof is green, or listed in a signed exclusions table with a reason |
| **S40-0c** | **Playwright against a local Supabase in CI** for the five S35/S36 flows never covered: next task, hand-back, claim timeout, scribe draft and sign, credentialing, payout approval, result review and release. Needs a clinician and task fixture (OQ-212) | L | Specs run green in CI, not on a developer laptop |
| **S40-0d** | **MFA and tracker check.** Confirm MFA on every staff and admin login; scan authenticated pages for third-party scripts | S | Written result; failures become tickets |
| **S40-0e** | **Resolve the safety-case 7 mismatch** (case text says 5 days, fixture and PROPOSED value say 6; OQ-273 wants 7 via a new signed rule set) and record CMO review of the 54-case fixture | S | CMO entry in the sign-off hub |
| **S40-0f** | **Waiver register in `STAGE-1-SIGNOFF.md`.** For each unrunnable check (Maestro on hardware, device performance, staging): name, owner, expiry, rollback plan. Do **not** waive unsigned PROPOSED values: sign the ones a release depends on, or ship those features disabled | S | Register complete; founder signs D1 |
| **S40-0g** | **Re-measure** PROPOSED values, open-question count and PR state, then run the 25-case table and write the result column | M | Sign-off doc has real pass/fail, or an explicit "waived" per row |

Only then decide whether to write "Stage 1 complete".

### Phase 1: close safety and trust gaps in what exists

**S37c: governed release v2 (the highest-value build in this plan)**
| Step | Work | Effort | Source of the idea |
|---|---|---|---|
| S37c-1 | **Hazard log table** (id, cause, effect, severity, likelihood, mitigation, residual risk, owner, linked guard). A clinical guard cannot be switched on while a linked hazard has unaccepted residual risk | M | DCB0129 |
| S37c-2 | **Bind attestation to a hash** of the protocol/config version. If the hash changes, the guard shows "on, safety case out of date" (amber, not auto-off, matching OQ-182) | M | DCB0129, closes S37b follow-up |
| S37c-3 | **Second countersigner** for clinical guards (D7) and a **rollout ladder**: named allow-list, then a percentage, with a dwell time and "no open incident" check at each step; each step is its own log row | L | Unleash approvals, Statsig, CrowdStrike lesson (D8) |
| S37c-4 | **Wire the unenforced guards** from OQ-184 (`on_call_cover_ok`, `lab_booking_enabled`, `prescribing_enabled`, `payouts_enabled`, `public_signup_enabled`) plus a written degraded state per guard ("what the patient sees when OFF"). Test that each is enforced where it should be | L | Own gap |
| S37c-5 | **Scheduled switch-on** that re-evaluates conditions when it fires; **review-by date** per guard (attestation older than 6 months shows amber) | M | Unleash, Flagsmith, LaunchDarkly |
| S37c-6 | **Nightly mirror of the guard and sign-off logs** to a second store (storage bucket or separate project) | S | Flagsmith audit streaming |
| S37c-7 | **Monthly safety review record** linking incidents and near-misses to hazards; flag when a guard's linked incident count crosses a CMO-set threshold | M | DCB0129, ISO 14971 |

Sizing note: S37c-4 is the real risk reduction. S37c-3 is the largest but depends on decisions D7 and D8.

**S39i: privacy monitoring v2**
| Step | Work | Effort |
|---|---|---|
| S39i-1 | **Alert case workflow** on `staff_record_opens` alerts: states open, justified, escalated, closed; clinician confirmation prompt; CMO/DPO queue | S |
| S39i-2 | **Snooping rules in SQL**: same surname, same address or phone, staff-as-patient, repeated unrelated opens, VIP list. **Restricted-record tier** for flagged patients with an extra reason step (D12) | M |
| S39i-3 | Table-level access log for sensitive categories (already on the S39h "next builds" list) and the DPO access-log report | M |
| S39i-4 | **NDPC pack**: confirm level (D11), calendar the 31 March return and engage a licensed compliance organisation if required, DPIA on file for clinical record, scribe, triage, 72-hour breach clock added to the runbook | M (mostly counsel) |
| S39i-5 | **Patient-visible access log** only if counsel agrees (D10) | M |
| S39i-6 | security.txt and a vulnerability-disclosure policy; scope and quote an external pen test | S |
| S39i-7 | Sign DPAs with processors, provision Upstash rate limits on payment, queue and mobile routes, review Sentry scrubbing and trace sampling (all already open, OQ-267, OQ-268) | M |

**S38h: outcomes in the Ministry's language**
| Step | Work | Effort |
|---|---|---|
| S38h-1 | Add HEARTS/Simple indicators beside, not instead of, S38's stricter 7-day-average control: **registered, under care, lost to follow-up (12 months), missed visit (3 months), visited with no BP taken**. Show a HEARTS-comparable 140/90 figure next to the personal-target figure. Clinician and NGO views only; sponsors keep suppression (D9) | M |
| S38h-2 | **Quarterly registration cohorts** view | M |
| S38h-3 | **Recall funnel**: overdue, contacted, reached, returned (uses existing tasks and notices) | M |
| S38h-4 | **Bias audit job** for the dropout and deterioration scores by sex, region and age band; report differences, never auto-adjust; CMO reviews (supports OQ-277). Clinician-level views stay CMO-only (D13) | M |
| S38h-5 | **Methodology appendix** on every sponsor export (definitions, denominator flow, suppression rule, what is not claimed) and a **DHIS2-shaped aggregate CSV** | S |
| S38h-6 | Triage accuracy **by age, sex and region** once the review switch is on (needs CMO, OQ-257). Do not publish before sample sizes allow | M, gated |

### Phase 2: clinician console that survives Nigerian conditions

**S35d**
| Step | Work | Effort | Gate |
|---|---|---|---|
| S35d-1 | **Scribe omission safeguards** on top of facts-to-confirm: empty sections flagged as possible omissions, per-section tick before signing (research follow-up 1) | M | none |
| S35d-2 | **Chart context into the draft**: pass the problem list, current medicines and pending proposal so the draft reuses existing items rather than creating duplicates. Draft-only; no medicine writes (OQ-213) | M | CMO on OQ-213 |
| S35d-3 | **Offline-tolerant console**: cache the held task's summary, queue actions, "last synced" label, queued signature reads "pending upload", never final. Local data protection and device-loss rule written first | L | none; high value |
| S35d-4 | **Evidence links** from note text to transcript span (D3) | L | D3 and counsel |
| S35d-5 | **Mount scribe and summary inside the consultation room** (OQ-210) and resolve the two-consent question (OQ-211) | M | founder |
| S35d-6 | **Clinic-level view**: share of lead patients at target, share with a reading in the last 7 days. Pair with S38h | S | none |
| S35d-7 | **Paging voice rung and number masking** (D4). Do not mix urgent paging with chat | M | D4 |
| S35d-8 | **Playwright coverage** for every new flow (extends S40-0c) | M | S40-0c |

Do not build in this phase: real-time call prompts, AI-staged orders, scribe that learns from edits, multi-language patient instructions, coding.

### Phase 3: operations that competitors treat as table stakes

**S36l**
| Step | Work | Effort | Gate |
|---|---|---|---|
| S36l-1 | **Credential monitoring**: scheduled MDCN re-check with a named human owner (D6), DataFlow/ECFMG as recorded evidence types, **60/30/7-day pre-expiry reminders** (in-app and email) | M | D6 |
| S36l-2 | **Rota**: manager-approved swaps, open-shift pickup, "no slot for a clinician whose credential or competency is not current", coverage-gap alert | M | none |
| S36l-3 | **Payouts**: show the Paystack-resolved account name to the checker and flag a mismatch with the clinician's legal name; **payout-to-line-items reconciliation report**; refund hold-back reserve; record the OTP decision (D5) | M | D5 |
| S36l-4 | **Support inbox** across app and email (phone as a logged note), SLA timers, skills routing, reads covered by the same audited-open rule. Built on `care_messages` plus an email-ingest queue. No WhatsApp. Check DPA and cross-border basis for any third-party tool | L | founder |
| S36l-5 | **Content governance**: review-by date, author is not reviewer, dated release notes with added/removed/changed counts, and a regression set for anything that feeds triage (spec 25.1, 25.2) | L | CMO |
| S36l-6 | **Rules-based ops automation**: appointment reminders, partner chasing, report generation. Never for credentials, payouts or clinical content | M | none |
| S36l-7 | **One onboarding case per clinician** with a single checklist and visible status (avoids repeated document requests) | S | none |
| S36l-8 | Resolve open S36 decisions (grant expiry OQ-221, overdue-listing behaviour OQ-236, reliability display OQ-225 to OQ-227) before building more on them | S | CMO, founder |

### Parked or rejected (with reason)

| Item | Reason |
|---|---|
| Real-time red-flag prompts during calls | Weakest outcome evidence; alert fatigue; INV-01 (deterministic only). Revisit as a measured experiment after S38h data exists |
| AI-staged orders, scribe learning from edits, auto-adjusting risk by bias findings | INV-02, AI governance |
| Multi-language patient instructions | English only (D-14) |
| DHIS2/NHMIS push | No facility orgunit or reporting duty. Revisit when an NGO or state counterparty is signed |
| Payer ROI / matched controls | No claims data; would invite unsupported claims |
| SOC 2 or a compliance-automation subscription | No buyer pulling it yet; NDPC audit and ISO 27001 come first |
| Bug bounty | Premature; do VDP and one pen test first |
| Clinician league tables | Gaming risk; CMO-only named view stays |

---

## 5. Sequence and dependencies

```
Phase 0 (gate)  S40-0a PITR ──┐
                S40-0b CI ────┼─> S40-0c Playwright ─> S40-0g re-run matrix ─> sign-off or waiver (D1)
                S40-0d/e/f ───┘
Phase 1         S37c-1,2 ─> S37c-4 ─> S37c-3 (needs D7, D8) ; S37c-5,6,7 any time
                S39i-1,2,3 ; S39i-4,6,7 in parallel (mostly counsel and vendor work)
                S38h-1 ─> S38h-2,3 ; S38h-4,5 independent ; S38h-6 waits for OQ-257
Phase 2         S35d-1 ─> S35d-2 ; S35d-3 (independent, biggest) ; S35d-4 waits D3 ; S35d-5 waits OQ-210/211
Phase 3         S36l-1,2,3,7 first ; S36l-4 and S36l-5 are the big ones
```

Parallel worktrees are fine for packages with no shared migration (S38h, S36l-1/2, S35d-3). Serialise anything touching `private.is_org_staff()`, `staff_may_read/write`, or RLS on patient tables. Each package that adds a table ships its grant, RLS test and registry row (the S39d registry must stay complete or the export breaks, as S39h showed).

Suggested order of value per effort: S40-0a, S40-0b, S37c-4, S37c-2, S39i-1/2, S35d-3, S38h-1, S36l-1/3, then the rest.

---

## 6. What to do first (the first week)

1. Founder decides D1, D2, D6, D7 (four short decisions).
2. Run S40-0a and S40-0b; both unblock everything else and need no new design.
3. Start S37c-1/2/4 (the safety-case and enforcement work), because it reduces risk on features that are already live.
4. In parallel, ask counsel D3, D10, D11 and the NDPC level question; their answers gate S35d-4, S39i-4/5.

## 7. Known weaknesses of this plan

- The research is shallow in places (see the caveat at the top). The Nigeria-specific competitors (Helium Health, Mobihealth, Reliance, Clafiya, Vezeeta, Wellahealth) returned almost nothing on clinician, ops or outcomes tooling, so "Behind" and "Ahead" calls against them are not supported by evidence.
- I did not read S35 to S39 code or run any proof. State comes from the progress log, PR bodies and open-question file, which can lag the code.
- Effort sizes are estimates for an agent-assisted solo workflow, not commitments.
- Several recommendations (restricted-record tier, patient access log, support inbox tooling) change patient-facing or privacy behaviour and need counsel before design is final.

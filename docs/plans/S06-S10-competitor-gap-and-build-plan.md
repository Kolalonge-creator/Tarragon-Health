# S06 to S10: competitor gap review and build plan

Date: 2026-10-07. Status: DRAFT for founder decision. Nothing here is approved, signed or started.
Scope: S06 (offline store and outbox), S07 (Today, BP logging, trends, reminders), S08 (medicines), S09 (My Health), S10 (event bus).
Sources of truth: `docs/v5-sessions/S06` to `S10`, `docs/BUILD-PROGRESS.md`, `docs/design/` and `docs/research/` notes for each, spec lines 83-105, 263-285, 474-484, 569-579, 838-846, 970-976, 1185-1192.

## 0. What this is, and the limits of the evidence

- These five sessions are already built. This is a **post-build upgrade plan**: compare each against the full competitor product, keep what already leads, close real gaps, and hand the rest to the later session that already owns it (S34, S37, S43/S44, S47, S53/S54, S70) so nothing is built twice.
- **Repo and database facts** were checked on 2026-10-07: `origin/main-dev` by grep and the live project `koiplnmbgnqnbywhpjlf` by two read-only queries. Anything else comes from the progress log, which has gone stale (section 1).
- **Competitor facts** come from four web research passes today. They used search snippets only; no app was installed, no vendor page read in full, no store reviews sampled. Prices, vendor outcome numbers and complaints are reported, not verified. Items marked (bk) are model background knowledge. UNKNOWN means it could not be found. Every row that drives a build decision should be re-checked in that session's own Step 2 research.
- Prior in-repo research (`docs/research/S06` to `S10`, `S06-platforms`, `S51-S55-review-and-build-plan.md`) is reused, not repeated.

## 1. Current state (corrections to the progress log)

| Session | Built | Production state (checked today) | Open items already on record |
|---|---|---|---|
| S06 | SQLite outbox, read mirror with cursor pull, drafts, purge, sync banner, `client_recorded_at` / `time_basis` | Migration `20261002205313` live | Budget numbers (cold start, size, memory) never measured on a device; no reconnect trigger (foreground flush every minute instead); forced sign-out wipes drafts and mirror; care plan, emergency card, tasks, released results not mirrored |
| S07 | Pure logic (Lagos days, averaging gate, trends, streaks), BP form with pulse and symptom ticks, technique guide, History with correction request, Reminders screen, Today list, `patient_tasks` view, `my_home_bp_target()` (PRs 872, 884-902) | Both S07 migrations live (checked 2026-10-07): `patient_tasks` view and `my_home_bp_target` | **No S07 entry in BUILD-PROGRESS**; BP bands differ from the live pipeline (OQ-67); readiness and voice deferred |
| S08 | `packages/medicines` (100% branches), schedules, dose events, server missed job, weekly adherence, pill count, refill reminders, catch-up sheet, reminder health card | 3 migrations live | Never run on Android or a real phone; exact-alarm needs native build (OQ-73); dependants (OQ-70/76); skip-for-side-effect not a signal (OQ-72); interactions and catalogue absent |
| S09 | Timeline events for vitals and prescriptions, `record_shares`, `/share/[token]`, share controls, offline emergency card | **Both migrations are live** (log says "not applied") | My Health hub page deferred; lock-screen shortcut not built; types splice |
| S10 | `domain_events`, deliveries, leases, backoff, dead letter, replay, `event_bus_health`, `process-events` | **Live and running**: migration applied, 7 subscribers, 11 events, 0 dead deliveries (log says "not applied, not deployed") | No console tile; real two-connection contention not proved; no event explorer |

**Action 0 (docs, no code):** correct the S09 and S10 entries, add the missing S07 entry, and confirm both `PROCESS_EVENTS_SECRET` values exist (events are being recorded, so they probably do; the log must say so).

## 2. Where Tarragon already leads (do not rebuild)

| Strength | Why competitors lack it |
|---|---|
| Idempotent outbox with terminal `rejected` rows kept, never dropped, per-account scoped | DHIS2's documented failure is losing unsynced data on user switch or delete; several outbox libraries drop after N tries |
| Device time kept beside server time inside a bounded window (`time_basis`) | No tool reviewed documents a skew policy (UNKNOWN) |
| Server `missed` ranks below any patient-written row, so a late offline sync is not overwritten | Not seen elsewhere |
| Reminder wording never names a medicine (INV-07), generic keyed templates | Medisafe and MyTherapy put names on the lock screen (bk); Medisafe shares data with pharma partners |
| Today list is authoritative even when a notification never fires | Standard failure of every reminder app on Transsion and Samsung battery managers |
| Emergency card with genotype and blood group with provenance, cached offline, printable with QR | Apple and Android Medical ID are free text, unverified; no international product treats genotype as first class |
| Share link: sections chosen, 1 hour to 30 days, revocable, lookups audited | Apple shares per data type and person; MyChart audits but patients cannot see it |
| Event bus as data: new type or version is an insert; lease token; dead urgent delivery opens an incident | Matches Svix and Medplum behaviour without sending PHI to a vendor |
| Core features not paywalled | Medisafe moved outside the US to a paid app on 2026-01-01 (free tier limited to 2 medicines); CareClinic and Qardio paywall reports |

## 3. Competitor comparison by session

Verdicts: **BUILD** (fits scale, law and Part C), **HAND OFF** (already owned by a named later session), **GATE** (needs a named decision or sign-off first), **SKIP** (banned, no fit, or failed elsewhere).

### 3.1 S06: offline store and sync

| Reference | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| CHT (Medic) | PouchDB to CouchDB; server decides each user's documents by contact hierarchy; `replication_depth`; scheduled server-side purge | Per-table cursor, 90-day first pull, device-side purge | Parity on purge. Scope rules matter later for supporters' phones: **HAND OFF** to S29/S69 |
| CommCare | Server computes diff from a sync token and a hash of device state; forms append-only | Cursor with 10-minute overlap, known miss window | **BUILD** a per-table count check after pull to detect rows missed beyond the overlap |
| DHIS2 Android | Optional encrypted DB, about 10-15% slower; detects data that never synced and prompts | Plain SQLite, banner and per-row state | **BUILD** encryption (see below); unsynced detection already covered |
| PowerSync | Per-user buckets, FIFO upload queue through your own API, rejected writes recorded server-side | Equivalent queue; rejection visible only on the phone | **BUILD** server-side rejection record with no health values |
| Android and Expo platform | `expo-sqlite` supports SQLCipher (`useSQLCipher`, SDK 54+); WorkManager 15-minute floor; NetInfo "connected" does not mean reachable | No encryption; no NetInfo dependency (documented in `background-sync.ts`) | **BUILD** encryption and a probe-based reconnect trigger together in one native build |
| Remote wipe (no product found) | Key revocation or a short key lease is the clean pattern (bk) | None | **GATE**: wiping an outbox with unsent clinical readings needs a founder rule |

Findings that matter most: (1) the phone holds the patient's readings, doses, symptoms and (later) emergency data **unencrypted at rest** on 2 GB handsets that are often shared; (2) the three headline performance budgets (cold start under 3 s, size under 40 MB, memory) are asserted only against a Jest stand-in; (3) after a forced sign-out the mirror and drafts are wiped, which on a shared phone is private but means a half-typed reading is lost.

### 3.2 S07: Today, BP, trends, reminders

| Reference | Full product | Weakness reported | Tarragon today | Verdict |
|---|---|---|---|---|
| Omada hypertension | Cellular cuff plus coach plus clinical specialist; readings reach the team without phone setup | Employer or payer gated; US cuff | Manual entry, BLE cuffs, care team review | The "no setup" idea does not transfer. Keep BYO battery cuff. **SKIP** hardware |
| Withings | Colour-coded ESH-based bands on device and app; pitches white-coat and masked detection; Pro model works without a phone | Wi-Fi sync only on the cheaper model | Bands in the app, home target pair configurable | **BUILD** clinician-only pattern flag (below). **SKIP** cellular cuff |
| Qardio | Irregular-heartbeat flag; monthly report sent to clinician or family (Qardio+ paid) | Rechargeable, report paywalled | History and trends; no scheduled report | **BUILD** clinician-ready monthly summary, not paywalled |
| Hello Heart | Cuff plus nudges and trends | Slow loading and repeated permission prompts reported (weak evidence) | Automatic Health syncs no longer prompt | Already aligned |
| MyTherapy | 20+ measurements, BP log, diary, printable report; free | Mostly local | Equivalent, plus offline outbox | Close gap on the printable report |
| Dario | Data-driven nudges and AI layer; heavy multi-condition app | Heavy on low-RAM phones | Rule-based, no AI in the path | Nudge idea fits only as neutral, signed templates. **HAND OFF** to S47 |
| Oura, WHOOP | Daily readiness, nightly BP-dipping, cuffless BP estimate; WHOOP drew an FDA warning in July 2025 and the FDA dropped enforcement in June 2026 | Opaque scores; cuffless BP not validated for treatment | Readiness deferred; no cuffless BP | **SKIP** cuffless BP display (see section 7). Readiness **HAND OFF** to S47b/S48b |
| Apple, Samsung | Apple: 30-day hypertension screening nudge (FDA cleared). Samsung: cuffless BP only after a 28-day upper-arm cuff calibration | Screening only | n/a | Cuff-in-the-loop framing is the safe rule if wearable BP ever appears |
| Propeller | Sensor-based asthma programme; **ceased operations 2026-08-25** (secondary source) | Hardware plus payer model collapsed | n/a | Reminder: no single hardware vendor dependency |

What none of the verified products showed (all UNVERIFIED, so treat as opportunity not fact): a guided **7-day home protocol** with a session average (two readings a minute apart, morning and evening) and a plain "not enough readings yet" gate; cuff-size guidance; sit-then-stand prompts. S07 already built the averaging gate and technique guide; the protocol wrapper and report are the gap.

### 3.3 S08: medicines

| Reference | Full product | Tarragon today | Verdict |
|---|---|---|---|
| Medisafe | Reminders, interaction warnings, 90+ trackers, refill, Medfriend (named person notified on a missed dose); pharma "digital drug companion" programmes; paid outside US from 2026 ($4.99 a month, $39.99 a year) | Reminders, adherence, supporter logging; no Medfriend-style notice; interactions web-only | **HAND OFF** to S53 (Medfriend as in-app notice to a consented supporter only) |
| MyTherapy | Free; reminders, measurements, diary, refill, printable doctor report | Equivalent; clinician sees weekly adherence in the chart (audited) | **BUILD** patient-held adherence PDF (hand it to any facility) |
| Round Health | Reminder windows with three nudges | Windows and one follow-up built (S08b/c) | Parity |
| Apple Health Medications | Reminders, three-tier interaction alerts (Critical, Serious, Moderate); US data only; unlisted drugs are not checked | No catalogue, rules on web only | **HAND OFF** to S53; copy the "not checked" honesty |
| Hero, Pillo, Hailie, Propeller | Dispensers and inhaler sensors, passive capture, subscriptions around $30-60 a month for Hero (per its pricing page) | n/a | **SKIP** hardware: cost, power, no refill supply chain |
| Amazon, Alto, Capsule, GoodRx | Refill from real dispensing data, delivery, discount cards | Pill count from patient entry | **SKIP**: no dispensing data in Nigeria, delivery removed (OQ-261) |
| mPharma (Mutti, Bloom) | Pharmacist tool with patient history, vendor-managed stock; 500+ pharmacies across several countries | Partner pharmacy portal (S28) | **HAND OFF** to S54: pharmacist-side history only through a tie, in-app |
| NAFDAC Greenbook and MAS | Greenbook lists registered products (NRN, active ingredient, strength, ATC); MAS is a free SMS check of a scratch code. No official API or redistribution licence found | Informational MAS prompt only; short code 38353 comes from a 2019-era article | **GATE**: get Greenbook terms in writing before any seed; re-verify the short code |
| Drugs.com, RxNorm, WHO ATC, BNF | Interaction and drug data; Drugs.com API is licensee-only; RxNorm free but US brands; WHO ATC electronic index is sold | None | **GATE**: no free source with Nigerian brand coverage was found; decide source with CMO and a pharmacist |

Gaps competitors leave open that fit Nigeria: offline-first reminders (done), brand-to-generic matching against NAFDAC data, honest "not checked" interaction wording, a pharmacist-side stock and history tool. Unverified: PRN min-gap and daily-max logging, tapering support, travel mode.

### 3.4 S09: My Health, emergency card, sharing

| Reference | Full product | Tarragon today | Verdict |
|---|---|---|---|
| Apple Health | Records from provider portals (little Nigerian coverage); Medical ID on lock screen; "Share During Emergency Call" to services; per-data-type, per-person sharing | Offline card cached in SecureStore, printable with QR; no lock-screen shortcut | **BUILD** minimal lock-screen surface (wallet pass and widget), native build |
| Android | Emergency info visible without unlocking; Health Connect Medical Records (FHIR) with fine-grained read permission; Google Wallet medical pass not found | n/a | FHIR read path **HAND OFF** to S43/S44 |
| Eka Care | ABHA-linked record store, share with doctors, EkaScribe; relies on a national ID layer | Share link, timeline | National rails do not exist here. **HAND OFF** Eka-style photo capture to S43 |
| Estonia | Patient portal shows who viewed their data and when; patient can lock data | Lookups audited in `record_share_lookups`; no patient-facing view | **BUILD** patient-visible access log |
| MyChart | One-session share tied to a knowledge factor (birthdate); full audit not patient-visible | Link token only | **BUILD** optional PIN on a share link |
| NHS App | Proxy by age: under 11 parent-controlled, 11-16 at GP discretion | Dependants model (S04) | Already handled by S04 |
| Function, InsideTracker | Biomarker timeline with trends; InsideTracker adds a contested "biological age" | Timeline events for vitals and prescriptions | Trend view **HAND OFF** to S43/S46. **SKIP** age scores (Part C) |
| Break-glass (no competitor shipped one with patient visibility, UNVERIFIED) | n/a | `emergency_access_grants` exists in the database | **BUILD** a patient-facing log of emergency access |

Nigeria-specific cautions reused from the research: a lock-screen card on a shared handset exposes one person's data to the household, so keep the lock-screen content minimal and put the full record behind biometric or PIN; OCR of thermal-printed or handwritten results is error-prone so the patient must confirm every field; NDPA 2023 treats health data as sensitive personal data needing purpose-specific, withdrawable consent, and whether an emergency card or break-glass read rests on "vital interests" needs counsel.

### 3.5 S10: event bus

| Reference | Full product | Tarragon today | Verdict |
|---|---|---|---|
| Svix | Retry ladder to about 10 hours, endpoint auto-disabled after 5 days of failures with an alert, per-message and bulk "Recover", signed payloads | Backoff 15 s doubling to 900 s, 8 attempts, dead letter, replay | **BUILD** auto-disable plus alert for partner endpoints, signed webhooks with key rotation, on the existing `integration_outbound_events` path fed by a bus subscriber |
| Hookdeck, Inngest | Event inspector, run replay, concurrency keys | `event_bus_health()` only, no explorer | **BUILD** admin event explorer (S37 tile) |
| pgmq (Supabase Queues) | At-least-once, no DLQ, no retry limit, archive on completion | Own lease-token queue with DLQ | **SKIP**: weaker than what exists |
| pg-boss, Graphile Worker | Postgres job queues; need a long-running worker | Edge function plus pg_cron every 15 s | **SKIP** unless edge limits bite; Railway worker is the fallback |
| Svix, Inngest, Trigger.dev as hosted services | Managed delivery | In-house | **GATE**: payloads would leave the Supabase region; DPO decision. Keep ids-only events so the question stays small |
| FHIR R5 Subscriptions Backport, Medplum, HAPI | SubscriptionTopic, id-only or full-resource bundles, handshake, heartbeat, event numbers | None | **BUILD later** as a facade over the bus for partners that ask; Nigeria Core FHIR IG (R4) is the target. Many partners will accept signed HTTPS JSON first (bk) |

Tarragon's differentiator here is not infrastructure but **clinical-safety delivery tiers** (a red delivery that dies opens an incident). The gap is observability and ordering: no per-patient ordering key, no subscriber lag alert, no screen to look at.

## 4. The best build: principles

1. **Make what exists real before adding surface.** Measure on devices, encrypt what is stored, prove the bus under contention, then add features. Babyl and Medsaf failed on integration and scale, not missing features.
2. **Patient-held and care-team-held artefacts come from the same record.** One adherence/BP report, one share link, one emergency card; no parallel stores.
3. **Honesty beats coverage.** "Not checked", "not enough readings yet", "waiting to send" are features. Never present a self-reported percentage as clinical adherence or a cuffless estimate as a measured BP.
4. **No hardware, no vendor lock-in, no PHI to third parties** by default. Competitors that depended on a device vendor or payer folded (Propeller, 2026).
5. **Everything clinical lands behind a guard and a signed config.** Nothing here signs a rule, flips a guard or writes a threshold without the CMO or founder.
6. **Hand off, do not duplicate.** The sessions below are deliberately small because S34, S37, S43/S44, S47, S53/S54 and S70 already own the larger competitor gaps.

## 5. Proposed sessions

IDs use a suffix so the INDEX still reads. Each ends with the usual BUILD-PROGRESS entry and `/code-review high`. Every DB change needs a proof script in `packages/db/tests/` registered in `ci.manifest` with a sabotage step; every app change a Jest test; migration versions come from the live `list_migrations` check, never hand-typed.

### P0: housekeeping (no code, half a day)
- Correct BUILD-PROGRESS (S07 missing, S09 and S10 marked applied). Run the S09 proof tests 7 and 8 against the now-live enum values. Splice `database.types.ts` for `record_shares`, `domain_events` and friends (own keys only). Confirm `process-events` is deployed and its two secrets match.
- Open items in `OPEN-QUESTIONS.md` that these sessions need answered: OQ-67, OQ-70, OQ-72, OQ-73, OQ-76.

### S06x: offline trust (3 stacked PRs)
**a. Encrypted local store.** Turn on SQLCipher through the `expo-sqlite` config plugin; key generated on first run and held in SecureStore/Keychain; one-time copy from the plain database to the encrypted one with a verify-then-delete step; fail-safe: if the key is lost the outbox must not be silently dropped (surface it, support code). Needs a native build and the same `runtimeVersion` bump as OQ-73.
**b. Honest sync.** Add NetInfo plus a real reachability probe (an authenticated HEAD to a lightweight endpoint) as the reconnect trigger, keep the foreground and 1-minute flush as a fallback; `offline_sync_rejections` table (id, kind, reason code, account, no health values, written best-effort on first rejection) with an admin/support read; post-pull per-table count check that widens the re-read on drift; on forced sign-out, keep drafts in the encrypted store tied to the account instead of wiping (decision D2).
**c. Device lab run.** Measure the three unmeasured budgets (cold start, size, memory) and logging speed on two Android floor phones (Tecno or Infinix, itel) and one iPhone; record numbers in the progress log, fix what misses. Merge with the S08 reminder matrix below.
Acceptance: a stolen phone's database file cannot be read without the key; a reading logged offline and rejected is visible to support without its values; the reconnect flush fires within a minute of signal return in the device run.
CMO/founder items: none to sign. Decisions D1-D3.

### S07x: home BP programme (2 PRs; Today screen itself stays with S47)
**a. Seven-day home check.** A "start a home check" card: schedule of two readings a minute apart, morning and evening, for 7 days (all numbers PROPOSED in `packages/shared/src/proposed-config`), session average shown only past the existing gate, then "your results are with your care team" as a task, not an alarm. No new thresholds: grading stays with S11/S12 (OQ-67 must be settled first).
**b. Clinician pattern flag and report.** Clinic readings entered by the care team (new `source = clinic`, append-only) compared with the home average to raise a **clinician-only** "possible white-coat or masked pattern" signal under a CMO-signed rule; never a label shown to the patient. A monthly BP-and-adherence summary reusing the Health Passport PDF, patient-held and not paywalled. Cuff guidance content (size, validated models, battery cuffs preferred during power cuts) from the CMO-signed list.
CMO to sign (chat, full text shown first, R6 method): protocol cadence and averaging, the white-coat/masked rule, cuff guidance wording.
Acceptance: protocol with 3 days of data prompts "not enough readings yet"; a pattern flag never reaches patient notification text (INV-07 lint); report excludes unreleased results.
Not here: readiness scores and weekly cards (S47b), edit history and plausibility (S47a), wearable BP (SKIP).

### S08x: medicines completion (small; most of Module 8 is S53/S54)
Fold these into S53/S54 acceptance, and build only the three below:
1. **PRN safety**: as-needed medicines get a minimum gap and a daily maximum (config), warn without blocking, never suggest a double dose. UNVERIFIED in competitors, so keep it conservative; clinician-set per medicine.
2. **Patient adherence report**: PDF "for any facility", weekly percentages labelled "doses you marked taken", skips shown separately, same formula as the server.
3. **Android reminder reliability**: exact-alarm permission asked in context, boot reschedule, Transsion/Samsung checklist links verified on the device lab run (shares the S06x-c matrix). Closes OQ-73.
S53/S54 must additionally hold: Greenbook written permission before seeding `medicine_catalogue`; interaction source decided before the table is built; checker prints "not checked" for unknown drugs; Medfriend as an in-app notice to a consented supporter only (no send required for correctness, no medicine name); refill wording says "based on what you told us"; OQ-70/72/76 closed.
CMO/pharmacist to sign: PRN limits per class, interaction severity wording.

### S09x: My Health completion (3 PRs)
**a. Hub and access log.** `/patient/my-health` hub (deferred in S09) linking Timeline, Emergency Card, Passport, Shares; a patient-facing access log (share lookups, staff reads through the audited path, emergency-access grants) from one function, newest first, no clinical content. Closes the Estonia-style gap and answers the competitor claim that no one shows break-glass to the patient.
**b. Safer sharing.** Optional PIN on a share link (shown separately from the URL, rate limited, locks after 5 misses), one-session mode, and a shorter default expiry (config). Keep the existing 30-day cap.
**c. Lock-screen presence.** Wallet pass (Apple Wallet, Google Wallet) and lock-screen widget carrying only: name initials, blood group, genotype, "allergies on file", emergency contact phone; everything else behind biometric. Native build; one decision on shared-phone default (D4).
Acceptance: revoked share and expired share both fail; PIN lockout test; the pass contains no medicine or condition names.
Hand-offs: photo-to-record with confirmation and biomarker trends (S43/S44/S46), FHIR export (S43/S44), "share during emergency call" and any location feature (S19/R10 decision, not here).

### S10x: bus operations (2 PRs)
**a. See it and trust it.** Console tile and event explorer for admins (attempts, payload ids, lag, dead letters, replay) wired into the S37 guards dashboard; lag alert that opens an incident when the oldest pending delivery exceeds a config age (today only dead urgent ones do); per-subscriber heartbeat; real two-connection contention test in the CI local stack (closes the open gap in the S10 note).
**b. Ordering and partners.** Optional ordering key (patient plus aggregate) so dose and observation events for one patient process in order; a `partner.webhook` bus subscriber that writes to the existing outbound events path with signed payloads, key rotation and auto-disable after repeated failure with an alert. Design note only for a FHIR Subscription facade.
Acceptance: two workers never process the same delivery; events for one patient arrive in order; a failing endpoint is disabled and an incident opened.
Not here: hosted queue vendors (GATE D5), pgmq (SKIP).

## 6. Sequencing

```
P0 ──► S06x-a ──► S06x-b ──► S06x-c ──┬─► S08x (item 3 shares the device run)
                                      └─► S09x-c (native build shared)
P0 ──► S10x-a ──► S10x-b
P0 + OQ-67 ──► S07x-a ──► S07x-b
P0 ──► S09x-a ──► S09x-b
S53/S54 start after the Greenbook and interaction-source decisions (D6)
```
- One native build and one `runtimeVersion` bump should carry: SQLCipher, NetInfo, exact-alarm permission, wallet pass and widget. Plan that build once; do not ship four.
- Parallel worktrees are safe for S06x, S10x and S09x-a (different tables). S07x waits on OQ-67. All sessions touch `registry.ts`, `ci.manifest` and `database.types.ts`: merge one at a time and rebase.
- Run the proofs on the live schema in a rolled-back transaction before opening each PR, then re-run in CI (the S09 lesson: a proof that never ran hid four bugs).

## 7. Considered and rejected

- Cuffless or wearable-estimated BP shown as a reading (WHOOP, Oura, Samsung without calibration). Not validated for treatment; the FDA called WHOOP's feature a medical-device function in July 2025. If ever shown, only as a screening nudge, labelled, and only with a cuff calibration loop.
- Hardware: cellular cuffs, smart dispensers, inhaler sensors. Cost, power, no supply chain, and Propeller's 2026 closure.
- Streaks that fail offline, leaderboards, points for logging speed (already excluded by S07/S08 research).
- Consumer wallet, pharmacy delivery, price-comparison against US data, discount cards.
- AI "biological age" or readiness scores, AI-written medicine advice, anything that puts a model in a triage or adherence path (INV-01).
- Scraping the Greenbook or a third-party drug API wrapper as a data source.
- A hosted queue or webhook vendor receiving patient identifiers without a DPO decision.

## 8. Risks

| Risk | Where | Mitigation |
|---|---|---|
| Encrypted store migration corrupts or strands queued readings | S06x-a | Copy, verify row counts and checksums, only then delete the old file; keep a one-release escape hatch; test with 1000 queued rows |
| Key loss makes the outbox unreadable | S06x-a | Keychain/SecureStore with backup excluded; on loss show a support code, never auto-drop |
| Reachability probe itself costs data | S06x-b | HEAD with no body, at most once per minute while rows wait |
| Home-check protocol creates alert fatigue or false reassurance | S07x | Averages only past the gate; flag is clinician-only; CMO signs cadence |
| White-coat/masked flag read as a diagnosis | S07x-b | Wording "pattern for review"; never in patient text |
| Lock-screen pass exposes a household member's data | S09x-c | Minimal fields, off by default on shared phones (D4), counsel on NDPA basis |
| Share PIN brute force | S09x-b | Rate limit, lockout, audit |
| Lag alert noise | S10x-a | Config age with a floor, one open incident per subscriber |
| Bus ordering key slows throughput | S10x-b | Opt in per event type, not global |
| Stale competitor facts | all | Each session re-checks its rows in Step 2; research here is snippet-level |
| CMO sign-off backlog | S07x, S08x, S09x | This plan adds 5 signing items; book them with the S41-S50 batch in the sign-off hub |

## 9. Decisions needed from the founder

| # | Decision | Recommendation |
|---|---|---|
| D1 | Encrypt the local database now (needs a native build) | Yes, bundle with the Android exact-alarm and NetInfo changes |
| D2 | After a forced sign-out: keep drafts (encrypted, per account) or wipe | Keep, per account; the mirror can still be wiped |
| D3 | Remote wipe: allowed to delete an outbox that has unsent readings after a lost-phone report | Only after one last upload attempt or a 30-day lease expiry, and never silently |
| D4 | Lock-screen wallet pass default on shared phones | Off until the patient turns it on; full record always behind biometric |
| D5 | Hosted queue or webhook vendor, or stay in-house | In-house; revisit if partner volume demands it, after a DPO review |
| D6 | Who obtains written Greenbook terms and chooses the interaction data source | Founder to ask NAFDAC; CMO and a pharmacist to pick the source; S53 starts after |
| D7 | Is a clinician-only white-coat/masked pattern flag in scope | Yes, behind a guard, CMO-signed |
| D8 | Real-device budget: who owns two Android floor phones and one iPhone for the lab run | Needed before S06x-c and S08x-3 can close |
| D9 | Counsel view on NDPA basis for emergency card and break-glass visibility | Needed before S09x-c ships |

## 10. Sources (reported, not verified in full)

- Omada, Dario, Withings, Qardio, Hello Heart, MyTherapy, Oura, WHOOP, Apple and Samsung BP: MobiHealthNews, STAT (2026-05-21 and 2026-06-23 on WHOOP), HLTH (Apple FDA clearance), eWeek and Samsung support (BP calibration), Withings and Qardio product pages, Apple App Store listing for MyTherapy.
- Propeller closure: rfp.wiki (secondary, verify).
- Medisafe pricing: help-center.medisafe.com (paid app outside the US). Hero pricing: herohealth.com/pricing. Amazon RxPass: Axios. mPharma: TechCrunch, Citi Newsroom. NAFDAC Greenbook and MAS: TheCable, Dubawa, Outsourcing-Pharma (2010), Prime Progress. Apple Medications interaction tiers: Apple support HT213351. WHO ATC: atcddd.fhi.no.
- Records and sharing: Cult of Mac, AppleInsider, STAT (Apple sharing), AARP (lock-screen emergency info), Android Developers (Health Connect Medical Records), MyChart proxy help, NHS App proxy pages, TEHIK and e-Estonia (access log), Eka Care press and App Store, FPF and KPMG on NDPA 2023.
- Sync and events: docs.communityhealthtoolkit.org (replication depth, purging), Dimagi docs, DHIS2 docs and community, PowerSync docs, Expo SQLite and Background Task docs (SDK 54/55), Supabase pgmq docs, Svix retry docs, Hookdeck docs, HL7 Subscriptions Backport IG, Medplum docs, Nigeria Core FHIR IG.
- Repo: `docs/research/S06` to `S10`, `S06-platforms.md`, `S51-S55-review-and-build-plan.md`, `S46-S50-competitor-gap-and-build-plan.md`, `S88-S100-post-v5-competitor-gap-and-build-plan.md`.

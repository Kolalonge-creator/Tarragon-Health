# S51 to S55: competitor comparison, gap build and record (2026-10-22)

Follows `docs/research/S51-S55-review-and-build-plan.md` (2026-10-07). That plan listed the gaps; this record covers the fresh competitor pass of 2026-10-22, what was built from it, what was decided, and what is still owed.

## 1. Evidence and its limits

- Web research by four parallel agents (AI assistants, medicines and pharmacy, learning content, whole-platform design). Their web search was thin: few official pages were opened and no app UI was seen. Treat their design and UI statements as unverified unless marked below.
- A browser pass of real store listings. Google Play web listings (ratings, review counts, price and paywall wording, screenshots) and the Apple App Store lookup service (US iOS ratings and iPhone screenshots) were opened and the screenshots viewed. These are marketing screenshots, not live apps. No app was installed or driven.
- Not captured: Hello Heart's Play listing (not searchable), Practo, Apollo and Omada on Android, Healthily's real app, and in-app flows beyond store screenshots. Three Play search results were wrong apps ("midoc", "Lark", "Kasha") and were discarded.
- Vendor outcome figures (Hello Heart, Omada, Wysa and similar) are marketing claims.

## 2. State of S51 to S55 before this pass

Merged to `main-dev` earlier with every clinical guard OFF: AI assistant (S51, S52), medicines and pharmacy (S53, S54, S54c), Learning Centre (S55). Not live for patients: `assistant_enabled`, memory, interaction check and others stay OFF pending CMO sign-off, data and partner work.

## 3. Competitor findings that mattered

**Safety (assistant).** ChatGPT Health under-triaged 52% of true emergencies and over-triaged 64.8% of non-urgent cases in a Nature Medicine study (Feb 2026, simulated vignettes, disputed by the vendor); its own explanation sometimes recognised danger while the advice did not escalate. Babylon's collapse followed unvalidated accuracy claims. Doctronic's autonomous prescription renewal (Utah pilot) is the prescribing path Tarragon has ruled out. Lark's SMS coaching and Noom's auto-renewing billing are patterns to avoid.

**Store facts (verified on listings, 2026-10-22).**

| App | Play | iOS (US) | Notes |
|---|---|---|---|
| Medisafe | 2.3 (250K) | 4.7 (101K) | Forced subscription angered long-time users; outside the US a 14-day trial then paid; interaction checker US and English only |
| MyTherapy | 4.4 (242K) | 4.8 | Free; streak calendar, refill threshold, PDF report |
| Ada | 4.7 (341K) | 4.8 | One question per screen, quick-reply chips, urgency label per possible cause |
| Wysa | 4.5 (152K) | 4.8 | Privacy promise on first screen, human-coach card beside the bot |
| Hello Heart | n/a | 4.8 (31.7K) | BP zones, one insight card, printable doctor report; sold through employers |
| Function Health | n/a | 4.9 | Private AI chat grounded in the user's own results; range bars |
| Omada | n/a | 4.7 (95K) | Human coach chat; AI food chips; learning path |
| Teladoc, One Medical, Ro, Zocdoc | n/a | 4.8 to 4.9 | Price shown up front; results with range gauges |
| Apple Health | n/a | 3.0 | Dense summary screens, low rated |
| Google Health (Fitbit) | 3.4 (1.32M) | 4.5 | Gemini coach; "Ask Coach" on every screen |
| NHS App | 3.3 | 2.7 (76) | Plain list rows, test results, repeat-prescription chips |
| MyDawa (Kenya) | 4.7 (10.5K) | n/a | Prescription upload, then payment, then category shop |
| Mobihealth, Virtual Doctors Africa | 500+ installs each | n/a | Plain doctor list and booking; no longitudinal care |
| Leadway Health (Nigeria HMO) | 100K+ | 23 ratings | List-heavy menus; claims and pre-authorisation |

iOS ratings run higher than Android for several apps (Medisafe 4.7 vs 2.3), so iOS alone overstates satisfaction.

**Nigeria specifics.** NAFDAC Mobile Authentication Service: scratch code sent by SMS to a short code (38353 comes from 2010-era sources, current code unconfirmed). NAFDAC Greenbook is the public registered-product check (confirmed live 2026-10-22). Android phones such as Tecno and Infinix kill background apps; iPhone caps pending local notifications at 64.

## 4. Built from this pass (all merged 2026-10-22, all new features OFF)

| PR | Content |
|---|---|
| #1289 | Home "next step" card with fixed order (red alert, due dose, due reading, refill, older items, lesson, caught up); failed reads never show an all-clear; `ReadingStatus` (word, colour and a distinct icon per level); naira price helper |
| #1286 | Triage floor test set (73 emergency, 74 non-urgent vignettes, all unsigned). Before change the deterministic floor missed 28 of 73 emergencies; an unsigned PROPOSED phrase block brought that to 0 missed and 8.1% over-triage. Learning expiry backlog with 30/14/7-day count-only notices and a "what changed" note |
| #1287 | Reading-grade publish gate, glossary, teach-back, record-triggered lessons (never above urgent guidance), local food portion guide drafts |
| #1288 | Cuff display photo reader (AI-022, registered disabled, governed call, photo held in memory only, patient confirms every number); result passport (sensitive-positive and reproductive results excluded) |
| #1290 | Reminder reliability on Android and iPhone, private "ran out or cannot afford" reason, refill runway bar, 48-hour stale-stock rule, NAFDAC Greenbook link |

Five migrations were applied to production before the merges, each dry-run first and pinned to its filename version: `20261022114731`, `20261022120001`, `20261022120002`, `20261022121347`, `20261022121743`.

## 5. Founder decisions recorded 2026-10-22

1. Price and per-pharmacy stock in the pharmacy chooser stay removed (OQ-714 stands). Item 9b was not built.
2. NAFDAC helper is a Greenbook link only; no text-message deep link and no short code in config.
3. Cuff reader approved for evaluation only (`docs/DECISIONS.md`).
4. Supporters, including manage-level, see a "ran out" reason only with exact-reason opt-in; old stored values were backfilled out of supporter reach.

## 6. Not built, by choice

AI-or-human label on every message, a shown reply-time promise, "Ask a doctor about this" after a lesson, USSD and SMS reminders, home delivery, autonomous prescription renewal, a public safety scorecard, chemist BP stations, Ramadan medication plans, an on-device cuff recogniser. Each needs a founder decision, a partner or a clinical author first.

## 7. Still owed (people, not code)

- **CMO:** sign the triage vignettes and the unsigned emergency phrases; confirm the 90/60 low-blood-pressure floor (the build agent's own number, OQ-S55-QG-07) and a glucose status band; write and sign lessons, glossary and portion guide; confirm the lab analyte allow-list; review the new unreviewed strings.
- **DPO:** retention classes for the new patient tables and the transient cuff image.
- **Cuff reader:** a human AI-022 evaluation on real cuff photos, defined guard conditions, per-user rate limiting, and a written go-live decision.
- **Mobile:** an EAS build with a `runtimeVersion` bump for iPhone Time Sensitive reminders and the passport's offline copy.
- **Not verified anywhere:** no phone feature ran on a real Android or iPhone, and the cuff reader has not read a real cuff photo. DB proofs were first run on a real database in CI.
- **Design:** the design-principles audit is code-level only; nobody has seen the running app. A real-screen pass of Tarragon's own app is still owed.

## 8. Process lessons

- A merge into `main-dev` deploys production at once and CI does not apply migrations, so apply migrations first, then merge.
- GitHub reports a PR blocked by pending required checks as "has merge conflicts" on a manual merge; auto-merge works while checks are pending but not once the PR is already mergeable.
- Concurrent sessions collide on numbered OQ ids; use descriptive ids.
- A merge script must stop on any file it cannot resolve and every push needs a conflict-marker search first (one commit briefly carried markers in two SQL proofs).
- Proofs written without a database fail on first CI runs (placeholder rows must stay draft, `CREATE OR REPLACE` cannot rename parameters, fixture profiles need their name and organisation).

# S80 to S85 build plan: Operations console, Research governance, and the four cross-cutting audits

Drafted 2026-10-07 on branch `s38/outcome-snapshots-analytics`. Planning document only: nothing here is built, applied or decided.
Inputs: `docs/v5-sessions/S80..S85`, `docs/BUILD-SPEC-v5.md` lines 83-105, 2072-2157, 2205-2320, a read-only repo audit of `origin/main-dev` (60c843718), and one web research pass.
Confidence tags: **V** verified from a cited source, **U** unverified or vendor-reported only, **I** inference. The research pass ran about 16 searches and fetched no full pages, so treat every competitor claim as **U** unless a link is given. Areas it could not verify are listed in section 9.

## 1. Bottom line

1. **None of S80 to S85 can start yet.** All six prompts require `docs/BUILD-PROGRESS.md` to begin "Stage 1 complete" (written by S40). It does not. S39 is still open and `docs/STAGE-1-SIGNOFF.md` is a draft. S80 and S81 say STOP in that case. This plan is the preparation.
2. **The repo is further along than the spec assumes.** On main-dev, 25.3, 25.5, 25.6 and 25.9 exist, 25.1, 25.2, 25.4, 25.7, 25.8, 25.10 are partial, and the whole S85 event spine exists. Only Module 26 is truly empty. The sessions are mostly **upgrade and close-the-gap work, not greenfield**.
3. **Two spec items are void or conflicted and need a founder answer before build:**
   - S80 acceptance test "Unreviewed Pidgin clinical string blocks the release build" has no object. D-14 (reverses D-13) made the product English only and PR #984 removed Pidgin. S86 (adding languages) is the same. Replace with an English clinical-wording gate plus a language-agnostic translation-state gate that activates when a second language is enabled. See OQ-A below.
   - INV-12 line in the spec carries an inline note that "the admin should be able to search for all patients". This conflicts with S39b/S39c (tied staff reads, audited access) and the memory entry "search any patient, audit every read silently". S83 must audit against the S39c model, not the older wording.
4. **The best build is a single "Governance and Operations" area, not 26 more screens.** Three shared mechanisms carry most of the value: (a) one content-and-translation state machine reused by CMS, symptom KB and AI knowledge sources, (b) an `automations` registry that makes the existing ~125 cron jobs owned and visible, (c) a research-data pipeline that is a thin, locked-down layer over the S38 `analytics` schema and the S39d registry. Section 5 gives the design.
5. **Three existing defects to fix first**, because each contradicts a spec rule or invariant: any admin can approve clinical content (only Clinical Director should), five of seven go-live guards are recorded but not enforced (OQ-184), and the S38/S39 unmerged stack means S83 would audit a moving target.

## 2. Hard constraints

- INV-01/INV-11: no model in triage; no AI output in the record unsigned. INV-10/INV-12: every staff read audited, clinicians see only tied patients. INV-13: `is_test` excluded everywhere. INV-14: guards enforced server and client side. INV-16: every decision records the version used.
- Research export must never contain a patient without research consent, and S38 `s38b_min_cell_20` small-cell rule applies to every research output (I: Nigerian population size and location make re-identification easy).
- PROPOSED values in `packages/shared/src/proposed-config`. Strings through `packages/i18n` (English only now). No em dashes in copy. "Your care team".
- No agent signs a clinical protocol, a content item, a translation, a prompt or an evaluation. Everything below that says "sign" is a CMO, clinical lead or DPO action. Seeded passing evaluations are forbidden (CLAUDE.md AI rule).
- Never copy referenced platforms; study and build original.

## 3. Sequencing

| Step | Work | Why this order |
|---|---|---|
| 0 | Founder items: OQ-A (Pidgin test), OQ-B (research scope), OQ-C (unmerged S39 stack), counsel questions, MDCN verification method | Non-engineering, long lead |
| 1 | Land S39 stack, close S40, write "Stage 1 complete" | Hard gate on all six prompts |
| 2 | **Fix-first migration set** (section 6) | Small, shippable, removes live contradictions |
| 3 | S83 audit (privacy/security/regulatory) | Cheapest to find gaps early, and its findings feed S80 and S81 |
| 4 | S84 audit (AI and clinical governance) | Its registry output is the input to S80 25.10 |
| 5 | S80 in 3 sub-sessions (S80a content/translation/KB, S80b automations/support/directory/finance consolidation, S80c AI monitoring/DSR/guards) | Module is large; one session per prompt is too big |
| 6 | S82 audit and fixes | Needs the screens S80 adds to exist so they are audited too |
| 7 | S81 research governance | Release 4, lowest urgency, depends on S38 and S39d |
| 8 | S85 journeys | Last, because it tests everything built so far; Journeys 3 and 4 stay blocked until S59/S60 and S79 land |

S81 is Release 4. Doing it before first revenue is optional; the plan keeps it designed and gated, not rushed.

## 4. Competitor comparison and what the best build is

### 4.1 S80 Module 25: Operations and admin console

| Fn | State today | Best of the field | Gap and decision for Tarragon |
|---|---|---|---|
| 25.1 Content CMS | **Partial.** `health_education_content` has status lifecycle, versions, review dates, overdue sweep, `reviewed_by_name`. Any admin can approve. No `content.published` event. | Common practice: brief, clinical read, physician sign-off, badge naming reviewer and date; 24-month re-review cycle started ~2 months early (**V**, StayWell policy; Healthline and Healthdirect similar). Healthily workflow not found (**U**). | Enforce reviewer role in the DB, not the UI. Reviewer must resolve to a `clinical_staff` row with MDCN number. One authoritative review-due column (already a known defect). Overdue admin view. Emit `content.published` through the outbox. Per-claim source links on clinical content (no vendor found offering this; real differentiator, **I**). |
| 25.1 Translation status | **Missing, and moot** while English only. | No vendor found with visible translation status (**U**). | Build the `translations` table and state machine now (it is cheap and D.8 needs it), enable no language. Build gate fails closed if a second language is turned on with unreviewed rows. |
| 25.2 KB change control | **Partial.** `triage_protocols` signed via `sign_triage_protocols`. No KB diff or regression gate. | Infermedica: 150,000+ doctor-hours, MDR Class IIb for Triage (**V**: Infermedica pages). Ada: MDR Class IIa via TUV SUD (**V**). Neither publishes KB release notes or test sets (**U**). UK DCB0129 asks for a living hazard log and a clinical safety officer (**V**). | Every KB change ships as a version with a diff, a hazard-log entry, and a signed regression run on a frozen test-case set. Test cases are owned data, not code. Regulatory class decision stays with NAFDAC counsel (OQ). Do not chase their disease count; keep the engine a routing engine, per S55-S60 plan. |
| 25.3 / 25.9 Directory and freshness | **Exists** (S36g): verification cadence, freshness sweep, in-app notices, 35-check proof. | Practo verifies registration number, qualifications and speciality against the council registry (**V**, summary only). Re-verify cadence unknown (**U**). MDCN has no public API found (**V** via news; **I** that checks stay manual). | Extend coverage to branch tables and `network_partner_organisations`. Add a patient-facing "last checked" date. Auto-hide stale listings after a grace period (config). HMO panel flag with date. Manual MDCN check recorded with evidence document, not scraped. |
| 25.4 Support inbox | **Partial.** Tickets, comments, history, view-as exist. No email or phone intake. | Intercom/Zendesk offer healthcare configurations and routing rules (**U**, third-party summary). No helpdesk found with a built-in clinical red-flag detector (**I**). | Build intake for email (Resend inbound) and a phone-call log, not a new tool. **Every inbound message gets a deterministic red-flag scan before any bot reply or routing** (INV-01 spirit). SLA clock visible to staff. In-app is the primary channel; WhatsApp stays removed. A support agent sees only what a ticket needs (INV-12). |
| 25.5 Config and guards | **Exists** (S37), but 5 of 7 guards unenforced (OQ-184). | Tarragon decision; no reference. | Enforce all seven guards server side with a test per guard that sabotages the gate. Add a generic non-clinical settings editor only if OQ-18 is reversed; otherwise leave. |
| 25.6 Finance | **Exists** across ~20 `finance_*` tables, refunds, payouts, statements, reconciliation. Spread across modules. | Stripe Connect refund and clawback handling (**V** docs, but Stripe is removed here: reference only). Paystack subaccounts and split reversal (**U**, plugin summary; check Paystack docs). | Do not rebuild. Add one Module 25 finance landing page linking existing screens, a per-partner statement view (gross, commission, refund clawbacks, net), a Paystack settlement-file reconciliation check, an aged-refund list, and an exception queue for failed transfers. Tax treatment stays with counsel. |
| 25.7 Safety, privacy, DSR | **Partial.** Request tables, breach clock (72h), incident tables. Erasure is a request only. S39 branch has `purge_test_account`, `export_patient_data`, registry. | OneTrust and Transcend: intake, identity verification, per-system execution, response-time log (**V** docs). Flo Anonymous Mode and Clue granular controls (**V**). NDPC GAID 2025 sets DSAR and DPO rules; exact deadlines not retrieved (**U**). | One request centre: intake, identity check by logged-in session, status tracking, SLA clock from config, per-request execution checklist driven by the S39d registry (every table classified). Where the clinical-record retention duty blocks erasure, say so plainly in the patient's screen. No sensitive detail in notifications (INV-07). |
| 25.8 Automations | **Partial.** ~100 pg_cron jobs and ~25 Vercel cron routes, no owner registry. | Commure/Athena/Epic admin automation not verified (**U**). | `automations` table: name, schedule, owner role, last run, last status, runbook link, kill switch. Read-only mirror of existing jobs first (no behaviour change), then owner assignment, then failure alerting to ops. Report generation owned here too. |
| 25.10 AI monitoring | **Partial.** Registry, interaction log with tokens and latency, incidents, drift, bias, dashboard, kill switch, patient "report this answer". No money cost, no sampling queue, no accuracy dashboard. | Langfuse: traces with cost, scores, annotation queues, datasets (**V**). Stratified sampling of a few hundred traces a day is a common pattern (**U**). Self-hosting avoids sending PHI to a vendor (**I**; check licence). | Add a price table (config, kobo) and a cost roll-up per system, per month. Sampling: PROPOSED rate, stratified by system and by flagged outcome, reviewed by a clinician in a queue that writes a score, not a record entry. Reported-answer queue with SLA. Escalation accuracy needs symptom-checker data (S59/S60); build the schema now, populate later (OQ-255 already defers). Stay inside your own stack; do not add a third-party tracing vendor. |

**Best build for S80, in one sentence:** a unified Governance area where every clinical artefact (content, KB version, protocol, prompt, knowledge source) goes through the same draft, reviewed, signed, published, review-due state machine with a named owner and a date, and every operational job has an owner.

### 4.2 S81 Module 26: Research and evidence governance

| Fn | Today | Field | Decision |
|---|---|---|---|
| 26.1 Research consent | Consent type exists, off by default, shown in privacy screens. Nothing reads it. | Clue and Flo set the bar: granular, changeable, withdrawable (**V**). | Wire consent into one function `private.research_eligible(patient, protocol)` used by every export. Withdrawal takes effect for the next export; document what cannot be recalled from an already-published aggregate. |
| 26.2 De-identified export | **Missing.** Precursors: `analytics.subjects` pseudonyms, `log_outcome_export`, population governance gates, S39d export. | HIPAA Safe Harbor (18 identifiers) and Expert Determination are the usual methods (**V** explainer), HIPAA itself does not apply (I: method reference only). | `research_protocols` (ethics ref, data-sharing agreement ref, field allow-list, de-identification method, approver) and `research_exports` (audited, per protocol, row count, content hash, recipient). Export reads only `analytics` views, applies the field allow-list, small-cell suppression at 20, date shifting or banding, no free text, no exact location. Edge function `research-export` checks approval, consent, guard, and writes the audit row before releasing. |
| 26.3 Pre-registered evaluations | Missing | Omada has 28 peer-reviewed studies and registered trials (**V**, vendor release). Many digital-health observational studies are registered late or not at all (**V**, RTI). Ada has a ClinicalTrials.gov-registered real-world study (**V**). | `research_evaluations` table: question, outcome, analysis plan, registration URL (OSF or ClinicalTrials.gov), registered-at, locked-at. Analysis jobs refuse to run on a protocol with no registration date earlier than the data cut. Negative results are stored and shown. |
| 26.4 No sale of data | Rule only | Nigeria-specific | A DB-level check: `research_exports.recipient_type` cannot be a commercial class; a test scans all export code paths for monetary fields. Add the statement to the privacy screen. Sponsor aggregate reporting (S38e) stays a different product and must be named as such. |

Decision needed (OQ-B): is S81 in scope before Release 4? Recommended: design now, build the schema and the consent function only, leave the export function dark behind a guard that requires an ethics approval reference.

### 4.3 S82 to S85 cross-cutting audits

| Session | State | What the audit must do | What good looks like |
|---|---|---|---|
| S82 D.1/D.2 | Offline queue, low-data mode, 835-clip audio manifest, a11y scan exist. Audio recorded and signed: none. Voice input: missing. 'What is this?' and tab tours attached to few screens. `profiles.low_data_mode` not written. Pidgin removed; D.1 size and start-time targets superseded (report only). | Produce `docs/audit-D1-D2.md`. Test on a throttled mid-range Android profile and on TalkBack and VoiceOver, 200 percent font, colour-blind check. Verify WCAG 2.2 AA target size (24 by 24 minimum, our kit uses 44) (**V**). Wire the existing `NAV_CLIPS` and `HLP_CLIPS` to every screen the audit finds uncovered. Persist `low_data_mode`. Decide voice input (D-decision, it was dropped in S47-1). | A gap list with severity, each fixed or logged as an OQ. No new features. Adjust the spec text that still says Pidgin and 2 GB devices. |
| S83 D.3/D.6 | Granular consent, append-only audit log, no ad SDKs, discreet mode partial (no neutral icon), regulatory memo exists. Counsel questions, DPA/processor register, PITR, avatar bucket, rate-limit store are on the unmerged S39 branch (OQ-265 to 269). | Audit against the S39c access model, not the older INV-12 wording. Verify every regulatory row has an owner and a status. Neutral app icon option (platform limits: iOS alternate icons, Android activity alias; **I**). Confirm GAID 2025 obligations (registration tier, DPO, audit returns) against exact text, which research did not retrieve (**U**). | A counsel question list, a gap list, a processors register, and fixes for code gaps only. Legal answers stay in OPEN-QUESTIONS. |
| S84 D.4/D.5/D.10 | 17 registered AI systems, `runGovernedAi`, kill switch, incidents, drift, bias, protocol versioning exist. Extraction paths and scribe call `ai_runtime_config` directly. No monthly symptom-checker accuracy audit. Three-output-kind labelling not unified. | Enumerate every call site by a repo scan and fail CI if one is unregistered. Convert direct callers to `runGovernedAi` or document why not. Verify each system has a signed version and an owner. Add the three-kind label as one shared component with a lint rule. Build the monthly accuracy audit schema and report skeleton (age, sex, region), populated when S59/S60 lands. Wysa and DCB0129 give the model: a hazard log per release and a named clinical safety officer (**V**). | Zero unregistered call sites, tested. A named clinical safety owner. Accuracy audit ready to run on day one of checker go-live. |
| S85 D.7 | Event spine built (S10). Six D.7.2 events unregistered: symptom check completed, wearable synced, mood/PHQ-9 logged, pregnancy recorded, entitlement created, Health Points awarded. E2E: three Playwright specs, three Maestro flows, non-blocking CI, no clinician fixture (OQ-212). | Register missing event types (the ones whose module exists; the rest stay listed as blocked). Seed a clinician fixture helper. Write Journey 1 and 2 as real tests; Journey 3 and 4 as skipped specs with the blocker named. Run on a throttled network profile. Make the e2e job required once stable. | Journeys 1 and 2 green and gating. A table of D.7.2 events against the real bus, with owners for each gap. |

## 5. Build design (shared mechanisms)

### 5.1 One governed-artefact state machine
Table `governed_artefacts` is not created. Instead each existing artefact table keeps its own rows and gains a view and a common set of columns where missing: `owner_clinical_staff_id`, `reviewed_by`, `reviewed_at`, `next_review_due` (single column), `version`. A shared function `private.assert_signer_role(artefact_kind, user)` is called from every publish RPC. This avoids a risky data migration (reuse, don't rebuild).

### 5.2 Translations
`translations(key, language, text, state, reviewed_by, reviewed_at, source_hash)` with unique `(key, language)`; `state` enum `draft | native_reviewed | clinical_reviewed`. Source change resets state to `draft` via `source_hash`. RLS: reading published rows is open; writes by content editors; transition to `clinical_reviewed` only by the clinical reviewer role. Event `translation.reviewed`. Release-build gate: a script lists keys flagged clinical in `clinical-wording.json` that are not `clinical_reviewed` in any enabled language and fails the build. With only `en` enabled it checks English wording signature instead (existing gate).

### 5.3 Automations registry
`automations(id, name, kind pg_cron | vercel_cron | edge, schedule, owner_role, owner_user, runbook_url, last_run_at, last_status, enabled, kill_switch_guard)`. A read-only sync job populates it from `cron.job` and a static list of Vercel routes. An alert fires to ops if `last_status` is failed or `last_run_at` is overdue by a config multiple. No job is rewritten.

### 5.4 Support intake and red-flag scan
Email inbound webhook and a phone-call log form both create `support_tickets` through one RPC. The RPC runs `packages/clinical` red-flag rules on the free text first; a hit creates an emergency-guidance reply in app and a page per INV-05, regardless of ticket category. Ticket body is not copied into any notification.

### 5.5 Research pipeline
```
research_protocols ──approve (CMO + DPO)──> status=approved
        │
research_exports (request) -> edge fn research-export
   checks: guard on, protocol approved + ethics ref + DSA ref, field allow-list,
           private.research_eligible() per row, is_test excluded, min cell 20,
           no commercial recipient
   writes: research_exports row + audit_log row + event research_export.created
```
Reads only from `analytics.*` views. Service role only; no staff role can read the table directly (INV-10).

### 5.6 AI monitoring additions
`ai_model_prices(model, input_per_mtok_kobo, output_per_mtok_kobo, effective_from)` (config-versioned), cost roll-up view per system per month, `ai_review_samples(interaction_id, sampled_by_rule, reviewer, score, notes)`. Reported answers get an SLA clock. The evaluation seeds stay untouched.

## 6. Fix-first migration set

1. Reviewer-role enforcement on `set_health_education_content_status` and `marketing_resources`/`clinical_resources` publish paths (today any admin approves).
2. Collapse `next_review_due` and `review_due_at` to one column (already flagged in the S55-S60 plan).
3. Enforce the five unenforced go-live guards (OQ-184) with one proof per guard, each with a sabotage step.
4. Clinician fixture helper for e2e-browser (OQ-212).
5. Register the six missing D.7.2 event types that have a producing module.

Each follows the standing rule: a BEGIN/ROLLBACK proof in `packages/db/tests/` registered in `ci.manifest`, apply and merge promptly, never hand-type timestamps, check `list_migrations` live first.

## 7. Per-session work packages, tests and exit criteria

| Session | Package | Key acceptance tests |
|---|---|---|
| S80a | `translations`, content publish gate, `content.published`, review-due admin view, KB version/diff/regression for triage protocols | Clinical content cannot publish without clinical reviewer (role test, sabotaged). Source edit resets translation to draft. Overdue content is not served. Enabling a language with unreviewed clinical keys fails the build script. KB release without a passing signed regression run is refused. |
| S80b | `automations` registry, support email and phone intake with red-flag scan, directory coverage extension and patient "last checked", finance landing and partner statement view | Registry matches `cron.job` exactly. Red-flag text in an email creates a page. Stale listing hidden after grace period. Statement net equals gross minus commission minus clawbacks. |
| S80c | AI cost and sampling queue, DSR request centre on the S39d registry, guard enforcement proofs, module-wide acceptance sweep | Cost roll-up equals sum of log rows. Erasure refused for a table the registry marks retention-required, with the reason shown. Each guard blocks its feature when off. |
| S81 | `research_protocols`, `research_exports`, `research_evaluations`, `research_eligible()`, `research-export` (dark behind guard), consent wiring, privacy copy | Patient without research consent is never in an export (include a withdrawn-consent case). Test account never exported. Cells under 20 suppressed. Export with no ethics ref is refused. No code path writes a commercial recipient. Every export has an audit row. |
| S82 | `docs/audit-D1-D2.md`, fixes | Gap list closed or logged; audio and walkthrough coverage report; a11y checks pass on listed screens |
| S83 | Gap list, counsel list, processor register, neutral icon option, fixes | Each D.6 row has owner and status; audit-log coverage test over every clinical read RPC |
| S84 | Call-site scan test, three-kind label component, accuracy-audit schema, safety-owner assignment | Scan fails on an unregistered call site (sabotage proves it). Every system has a signed current version |
| S85 | Journey 1 and 2 e2e, event-map report | Journeys green on throttled profile; event map has no unexplained gaps |

All modules: RLS proof per new table, each role, including one that must be refused. Typecheck, lint, Jest and `/code-review high` before PR, naming money, consent and silent-failure risks explicitly (CLAUDE.md).

## 8. Open questions for the founder

- **OQ-A.** Replace the Pidgin build-gate test with an English clinical-wording gate plus a dormant translation-state gate? (Recommended: yes.)
- **OQ-B.** Build S81 now (schema, consent function, dark export) or defer entirely to Release 4? (Recommended: schema and consent function now.)
- **OQ-C.** Merge the S39 stack before any of S80 to S85? It holds the registry, audited access, purge and export that S80c, S81 and S83 depend on. (Recommended: yes, it is a prerequisite.)
- **OQ-D.** Who is the named clinical safety officer for D.4 and the DCB0129-style hazard log?
- **OQ-E.** Is voice input back in scope (S82)? It was dropped in S47-1.
- **OQ-F.** Is regulatory classification of the symptom checker (NAFDAC) answered? It decides how strict 25.2 change control must be.
- **Counsel:** GAID 2025 deadlines and registration tier, research provisions and cross-border transfer basis for any non-Nigerian processors, tax treatment of partner payouts.

## 9. Evidence limits

Not verified by research, so do not rely on them: Healthily and NHS content workflows, Vezeeta, Zocdoc, Doctoralia, Flutterwave settlement, Helicone, Commure and Epic admin automation, exact GAID response deadlines, UK Biobank and Truveta models, Maestro and low-data benchmark patterns. A second research pass on these is worthwhile before S80a and S81 design notes.
Repo claims come from a read of `origin/main-dev` at 60c843718; the working tree is 135 commits behind, so recheck paths before use.

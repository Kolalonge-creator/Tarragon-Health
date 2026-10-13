# S51 to S55: review, competitor comparison and build plan

Date: 2026-10-07. Branch context: `s38/outcome-snapshots-analytics`.
Scope: S51 and S52 (Module 7, AI health assistant), S53 and S54 (Module 8, Medicines and pharmacy), S55 (Module 9, Health Learning Centre).

Evidence base: the five session prompts, `docs/BUILD-SPEC-v5.md` B.7 to B.9 and invariants, three read-only code audits (code and migrations only, nothing run, live row counts not checked), the two competitor reviews of 2026-10 (`docs/research/competitor-review-*.md`), and a light check of public reference-product pages. Competitor claims are vendor or press claims unless stated. The design/UX lens of both competitor reviews was never verified from screenshots.

---

## 1. Headline findings

1. **None of S51 to S55 is a greenfield build.** Each session prompt says "extend, do not rebuild", and the repo confirms it. The AI Coach (AI-001), a full medicine schedule, adherence and refill engine, a pharmacy order engine and a Health Education platform all exist under non-spec names. The real work is closing gaps and reconciling names, not building modules.
2. **The spec's table names do not exist and should not be created.** `assistant_conversations`, `assistant_messages`, `knowledge_items`, `content_items`, `course_progress`, `creators`, `interactions`, `pharmacy_prices` are absent. Live equivalents: `ai_conversations`, `ai_assistant_turns`, `lpe_content_blocks` / `health_education_content`, `health_education_programmes`, `health_education_progress`, `pharmacy_medications`. Recommendation: map onto live tables (per RECONCILIATION "live wins") and add adapter views only if an API shape needs them. This needs one decision (D1 below).
3. **Four items are safety or invariant problems, not features.** They should be done first, ahead of any new functionality:
   - **INV-04 risk (assistant):** `getRecentLabResults` reads lab results with no sensitive-positive or release-state filter, and no `sensitive_positive` column exists. The assistant could explain a positive HIV, HBsAg or HCV result.
   - **INV-01 drift (assistant):** the coach's red-flag list is a private regex copy in `apps/web/src/lib/ai-coach/keyword-guardrail.ts`, not `@tarragon/clinical`. Three deterministic lists can drift. English only, no Pidgin phrases. "Arm numb" alone is not matched.
   - **8.16 commission exposure (pharmacy):** `pharmacy_medications` carries `commission_rate`, `commission_rate_type`, `commission_flat_kobo`. Its select policy is `using (true)` for every authenticated user and the app does `select("*")`. The 2026-09-25 migrations narrowed `lab_providers` and `pharmacy_partners` but not this table (confirmed in the migration files; live grants not checked). A patient or clinician can read what Tarragon earns per item, which is the exact thing 8.16 forbids.
   - **Review-expiry rule (learning):** the spec says content past `review_due_at` is not served. Live behaviour is the opposite and deliberate: `review_due` stays `is_active`, and a pgTAP test asserts it.
4. **A spec/founder conflict on pharmacy delivery.** The spec says "no home delivery (founder decision)". The repo has delivery in schema, RPCs, staff UI and notification templates (OQ-16 calls it dormant, which understates it). Separately, spec 8.9 says "send the prescription for collection", but the built model is a pay-through-Tarragon retail order with billing, liability and refunds. These need a founder decision before S54.
5. **The assistant has no `assistant_enabled` go-live guard** (INV-14). Gating today is entitlement plus the AI-001 kill switch only. No voice, no memory, no clarifying questions, no monthly review sample.

---

## 2. Function-by-function status

Legend: Built / Partial / Missing. "Gap" is what the session must close.

### Module 7: AI health assistant

| # | Status | Gap |
|---|---|---|
| 7.1 text and voice, English and Pidgin | Partial (text only) | No voice input, no TTS, coach receives no language param, English-only system prompt, mobile copy hard-coded English. |
| 7.2 Claude on reviewed KB and own record | Built, with conflicts | Retrieval gated on `clinician_reviewed`, but 0 of 58 `lpe_content_blocks` are reviewed so retrieval is inert. No owner, version or review date on KB rows. Grounding is a prompt rule, not structural. |
| 7.3 explain own results, readings, medicines | Built, INV-04 risk | Lab tool has no sensitive-positive exclusion. Chat does not cite cached explanations. |
| 7.4 explain readings, never dose changes | Partial | Refusal is prompt plus eval only, no deterministic post-response check. "Within protocol limits" not implemented. |
| 7.5 food swaps, nudges, weekly reflection, daily nudge | Partial | Nudges exist for lifestyle lapses (AI-002), meal plans exist. No chat food swaps, no weekly reflection, no fixed daily nudge. AI-002 free text is not INV-07 term-linted (OQ-94). |
| 7.6 hand off to symptom checker | Partial | No coach action routes to the symptom checker. Checker and screen exist. No `assistant.handoff` event. |
| 7.7 pre-consultation summary | Partial | Deterministic prep exists, plus AI-013. Missing: changes since last review, question list, patient-approved send to clinician. |
| 7.8 deterministic red flag, crisis handoff | Built, not on the shared engine | See finding 3. Self-harm gets hospital copy, no crisis-specific handoff. |
| 7.9 limits, sources, report button | Partial | Report button on web only. Sources not shown to patients. Mobile has neither. |
| 7.10 re-engagement, silence signal | Near-missing | Only lifestyle-programme re-engagement. Nothing keyed to assistant silence. |
| 7.11 clarifying questions | Missing | No prompt rule or graph node. |
| 7.12 memory under consent | Missing | No memory store or consent record. New PHI store, needs NDPA delete and export and a registry entry. |
| 7.13 monthly clinician review | Missing (infra partial) | Reports feed `ai_safety_incidents` and `flagged_for_review`. No sampler, no review table, no reviewer screen, and staff read policy on conversations is deliberately narrow. |

### Module 8: Medicines and pharmacy

| # | Status | Gap |
|---|---|---|
| 8.1 add by search, pack or Rx photo, Tarragon Rx | Partial | Tarragon Rx and manual add built. Pack photo is a compare, does not prefill. No search (no catalogue). No Rx photo OCR. |
| 8.2 Nigerian medicine database | Missing | No `medicine_catalogue`. Needs a licensed data source. |
| 8.3 confirm and complex schedules | Built | Window editing gaps (OQ-76). |
| 8.4 reminders, USSD, taken/skipped/delayed | Partial | Reminders and log states built. USSD none. Reminder wording issues (OQ-69, OQ-71). |
| 8.5 weekly adherence to user, clinician, circle | Partial | Server RPC built with supporter and audited staff rules. No confirmed supporter-facing UI. CMO threshold sign-off pending (OQ-75). |
| 8.6 missed doses and silence as signals | Partial | Events emitted. Triggers not wired end to end (OQ-89, deferred to S26). |
| 8.7 interaction and duplication warnings | Partial | Curated TypeScript rules on web only, none on mobile, no `interactions` data, licensed reference data blocked on CMO and pharmacist (OQ-170). |
| 8.8 NAFDAC MAS prompt | Built (informational) | Only on the pack check screen. Short code 38353 in app copy should be re-verified. |
| 8.9 send Rx to chosen pharmacy with price compare | Partial, conflicts with spec | Pay-through-Tarragon order model, `prescriptions.state = sent` never written, no `pharmacy_prices`, no `price-compare`. |
| 8.10 refill countdown | Built | Reminder not tied to a chosen pharmacy. |
| 8.11 verified-batch sourcing | Partial | Dispense batch and flags exist. No `verified_batch`, no NAFDAC check on catalogue. |
| 8.12 pharmacist chat | Missing | Role and portal exist, no thread or messages. |
| 8.13 complex schedules | Built | |
| 8.14 pill count | Built | Taper meds need manual count. |
| 8.15 dependants | Partial | Guardian logging built. Local reminders owner-only (OQ-70, OQ-76). |
| 8.16 clinicians never see pharmacy earnings | Partial, exposure | See finding 3. |

### Module 9: Learning Centre

| # | Status | Gap |
|---|---|---|
| 9.1 multi-format content | Partial (strong text) | Audio is a raw URL, no player on mobile. Video is an external link. Infographic, FAQ, quiz types have no renderers. No "when to seek care" category. |
| 9.2 courses, daily lessons under 5 min | Partial | Programmes exist (Hypertension 101, Diabetes 101) but pacing is weekly, no per-lesson progress table, no events, no daily card on Today. BP care course (S33) not built as a course. |
| 9.3 search in local terms | Weak | Client-side substring filter per category. No synonym table. Embedding search exists but only serves the coach. |
| 9.4 "What can I do next?" | Partial | Goal link on web only. No standard footer, no per-item next-action field. |
| 9.5 myth-busting series | Partial (content only) | Myth articles live in the public marketing table, not the in-app library. No series. |
| 9.6 reviewer, sources, date, offline | Partial | Governance columns and lifecycle built. Patients see only "reviewed by our clinical team". `source_reference` not shown. Reviewer is free text. No offline downloads. |
| 9.7 clinician creator programme | Missing | Nothing. Credentialing network (S15) exists but not tied to content. |
| 9.8 share by link or email | Partial (marketing only) | No in-app share, `learn/[code]` is auth-gated. |

---

## 3. Comparison to full competitor products

Source key: **R** = Tarragon competitor reviews (Africa and global, 2026-10); **W** = public web check this session; **S** = spec reference list. Claims are vendor-reported.

### Module 7: assistant

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Wysa (S, W) | Always-visible SOS button to local crisis lines, built-in crisis detection with safety planning follow-up, clinical screeners (PHQ, GAD), hybrid AI plus human copilot. Vendor reports 82% of crisis instances detected and user-confirmed. | Regex red-flag floor, hospital copy for self-harm, no crisis-specific path, no SOS affordance. | Behind on crisis handling. Adopt: visible emergency button and a self-harm path with local helpline content (clinician-signed). |
| Lark Health (S) | Conversational coach across chronic conditions with voice and clarifying questions. Not verified this session. | Text coach, no voice, no clarification. | Behind on 7.1 and 7.11. |
| K Health (R, S) | AI intake then clinician handoff, white-label. Clinical evidence not verified. | Handoff to care team and prep summary exist. | Comparable in shape. Tarragon's deterministic floor is stronger by design. |
| Babylon (R) | Anti-pattern: AI superiority claims before independent validation, about 30% diagnostic accuracy in a 2020 BMJ study, regulator criticism. | Governance registry, kill switch, eval suites. | Keep ahead. Do not market accuracy. Publish method before any claim. |
| Ada (R) | Vendor-run accuracy study, Swahili hospital evaluation as local-language validation precedent. | Symptom triage engine exists, local validation not done. | Use the Tanzania study as the model for validating Pidgin and local conditions. |

Where Tarragon already leads: deterministic red-flag before model, read-only record tools, governed prompts and audit trail, report-an-answer plumbing, care-team handoff with an alert and thread.

### Module 8: medicines and pharmacy

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Medisafe (R, W) | Persistent reminders until confirmed, Medfriend notifies a family member on a missed dose, 90+ trackers, interaction warnings (US), pharmacy import, family management from one account. Moved to a paid tier in 2026 (free tier limited to two medicines). | Reminders, taken/delayed/skipped/missed log, supporter logging, circle permissions. No missed-dose notification to a supporter confirmed. Interaction rules web-only. | Close on schedule engine. Gaps: Medfriend-style in-app notice (competitor idea 2 in the global review), interaction coverage on mobile, a maintained interaction database. Medisafe's own caveat applies: a stale database is a safety risk. |
| MyTherapy (S) | Schedule and adherence log. Not researched in depth. | Equivalent. | No gap identified. |
| mPharma / Mutti (R) | Price-lock on chronic medicines for members, membership loyalty, pharmacy as primary-care point. | No price certainty feature. | Idea: a price-lock framed as certainty, but only with a contracted pharmacy partner. Do not copy sub-NGN 1,000 bundles (subsidised by margin). |
| Yodawy (S, W) | Chronic prescription tracking, monthly auto-refill, home delivery, nearest-pharmacy ordering, insurance integration. Price comparison and pharmacist chat not confirmed in my search. | Pay-through order engine, delivery code dormant. | Yodawy is delivery-led, which conflicts with the founder's no-delivery rule. Take only the refill tracking pattern. |
| WellaHealth (R) | Pharmacy network as physical touchpoint, embedded in partner apps. | Partner pharmacy network exists. | Distribution idea only. |
| NAFDAC MAS (W) | 12-digit scratch code, free SMS to a short code, reply in about a minute. Coverage reported as antibiotics, antimalarials, antidiabetics and antihypertensives. | Informational prompt on pack check. | Fine as is. Ask at add and at collection. Re-verify the short code and current coverage with NAFDAC before publishing copy. |
| Medsaf (R) | Counterfeit-control framing for pharmacy supply. | Dispense batch and flags. | Partner quality gate before listing (global idea 15). |

Where Tarragon already leads: signed prescriptions into medications (INV-02 enforced in the database), schedule validity enforced at the database, supply and weekly adherence with audited staff reads, reminder wording that never names a medicine.

### Module 9: learning

| Product | What the full product does | Tarragon today | Verdict |
|---|---|---|---|
| Healthily (S) | Question-led library, "what next" prompts. Its review process was not confirmable in my search. | 14 categories, seeded library, per-item status and history. | Content depth is a strength. Search and next-step are weak. |
| Noom / Headspace (S) | Daily short lessons in a course, streaks. | Weekly drip programmes. | Pacing gap (9.2). |
| Insight Timer (W) | Open creator marketplace, 20,000+ teachers (reported). Creator programme terms not confirmed. | None. | Tarragon's version must be the opposite of open: verified Nigerian clinicians only, reviewed before publish. Keep the design from the requirement, not from Insight Timer's open model. |
| BabyCenter, Altibbi (S) | Maternal and child library, Arabic-language telehealth content. Not researched. | `family_child` category, `womens_health`. | No gap identified without further research. |
| mDoc (R) | Coach-led nudges, USSD for basic phones, community. | None of the USSD or coach layer. | The reviews flag USSD as the low-bandwidth path. Founder decision 2026-10-06 says do not scope SMS or USSD status checks for now (see D3). |

---

## 4. Decisions needed from the founder before building

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Table naming: create spec names (`assistant_*`, `knowledge_items`, `content_items`, `creators`, `interactions`, `pharmacy_prices`) or map onto live tables? | Map onto live tables, add `creators`, `interactions`, `medicine_catalogue` and `pharmacy_prices` as genuinely new tables only where nothing live exists. Record in OPEN-QUESTIONS. |
| D2 | Pharmacy model for 8.9: keep the pay-through-Tarragon order engine, or move to "prescription sent to chosen pharmacy for collection, patient pays the pharmacy"? | Needs the founder. It changes revenue, billing, liability and refunds. Until decided, S54 builds comparison and choice on top of the existing order model and does not remove billing. |
| D3 | USSD dose confirmation (8.4): in or out? The 2026-10-06 decision says do not scope SMS or USSD status checks. INV-08 limits SMS to verification codes. | Treat as out of scope. Record as closed unless a short code is issued and INV-08 is amended. |
| D4 | Review-expiry rule (9.x): spec says hide expired content, repo keeps `review_due` content visible and flags it. | Follow the spec for clinical content (hide on `next_review_due < today`), keep the admin flag. Change the pgTAP test. Confirm with the CMO because it removes content from patients. |
| D5 | Remove delivery code now or leave dormant (OQ-16)? | Do the patient-facing and fee removal in S54 (pickup-only CHECK), schedule the table drops later using the count-first pattern. |
| D6 | Medicine and interaction data source (licensed) and who signs it. | Blocked on CMO and pharmacist (OQ-170). Build the schema, the checker and the ingestion with a small curated seed, but keep `interaction_check_enabled` off until a signed dataset exists. |
| D7 | Voice (7.1): in scope for Release 1 completion? Needs new native dependencies and an EAS build, and Pidgin speech accuracy is unproven. | Ship text and typed Pidgin first. Voice input and spoken replies as a flagged follow-up behind the same `assistant_enabled` guard. |
| D8 | Memory (7.12): a new PHI store. | Approve a consent-first design (section 5, S52) before build. |

---

## 5. Build plan

Order of work is by risk, then by dependency. Each session still follows its own prompt (research file, design note, build, prove, progress entry). This plan adds the concrete scope and the pre-work.

### Pre-work (do before or at the start of S51/S53/S55, small PRs)

| # | Item | Why now | Proof |
|---|---|---|---|
| P1 | Narrow `pharmacy_medications` read to a safe-column view or column grants. Mirror `20260925023144`. Switch `usePharmacyCatalogue` from `select("*")`. | 8.16, live exposure of earnings | DB test: patient, clinician, pharmacist roles refused the commission columns; patient still reads price and stock. Sabotage step. |
| P2 | Add a sensitive-positive filter to the assistant lab tool and the AI-003 explainer. Until `sensitive_positive` exists on results (S-series lab work), exclude analytes by a deterministic code list for HIV, HBsAg, HCV. | INV-04 | Unit test: such a result never reaches the model context. |
| P3 | Verify live whether the S24 migrations are applied and whether `pharmacy_medications` has live rows. | Audits did not check live state | Read-only SQL. |

### S51: assistant, conversation, explanations, hand-offs (7.1 to 7.7)

Goal: make AI-001 meet the spec's behaviour with the existing code, and add the guard.

1. **Go-live guard.** Add `assistant_enabled` to `go_live_guards` (conditions: approved KB row count above threshold, red-flag test suite passing, CMO sign-off). Check it in `runCoachTurn` and the three mobile routes. Fails closed.
2. **Shared red-flag source (7.8 groundwork, INV-01).** Make `lib/ai-coach` call the same rule source as `@tarragon/clinical` (`screenWrittenQuestion` / `WRITTEN_QUESTION_DANGER_PHRASES`), delete the private list, add a drift test. Add Pidgin phrases (clinician-signed per OQ line 129). Acceptance: "chest pain and my arm is numb" returns emergency copy with no model call.
3. **Language end to end (7.1).** Pass the profile language into the turn, system prompt and replies; route mobile strings through `@tarragon/i18n` (en, pcm). Pidgin replies are flagged "not yet clinician-reviewed" until signed.
4. **KB structure (7.2).** Add owner, version, review-due to the retrievable tables (D1 mapping). Return `sources` in the API response. Refuse to answer from general knowledge when nothing is retrieved (structural, not prompt-only). Seed review is a CMO task: retrieval stays inert until reviewed rows exist, so schedule that with the CMO.
5. **Explanations (7.3, 7.4).** Chat cites the cached explanation where one exists. Add a deterministic post-response screen: any dose number, "increase", "stop", "double" tied to a medicine triggers the standard refusal and a route to the care team. Read protocol limits from the protocol definition but never propose a step.
6. **Hand-offs (7.6, 7.7).** Add a `symptom_check` suggested action that opens the symptom screen. Emit `assistant.handoff`. Extend appointment prep with changes since last review and a question list, as a patient-approved draft (INV-11, never written to the record).
7. **Nudges (7.5).** Pre-lint AI-002 free text against the INV-07 term list (closes OQ-94). One daily nudge and a weekly reflection built from deterministic data first, model-polished text second, behind keyed generic notification templates.

Tests: red-flag no-model-call test, dose-refusal test, INV-04 filter test, language parity, sources-present test, guard fails closed, RLS unchanged (no new patient tables).

### S52: assistant, safety, transparency, memory, clinician review (7.8 to 7.13)

1. **Crisis path (7.8).** Visible emergency button on every assistant screen. Self-harm gets its own copy and routing (clinician-signed helpline content), plus an alert to on-call per INV-05. Offline bundle for emergency copy (INV-06) reused from the app.
2. **Transparency (7.9).** Report-an-answer on mobile. Show sources and a limits panel on both platforms. Reply carries sources.
3. **Clarifying questions (7.11).** A graph node that asks at most one or two questions when intent is under-specified, with evals.
4. **Memory (7.12).** New `assistant_memory` table (goals, preferences only, never clinical facts), a consent record written before first use (scribe consent is the pattern), view, edit, delete and export, `source` and `recorded_by`, RLS patient-only. Register in `ai_systems`. Off by default.
5. **Silence signal (7.10).** After a configured silence period for programme members, write a rule event the triage engine consumes (signal only, never a treatment change). Re-engagement push via a keyed generic template. Thresholds in PROPOSED config.
6. **Clinician review (7.13).** Monthly job selecting a random sample plus every reported conversation, a review table (reviewer, verdict, issue category, linked incident), and a reviewer screen. Access via a purpose-built RPC with a reason and audit, not by widening the conversation read policy. Respect OQ-543 (do not widen the console to the generic clinician role without extraction).
7. **Close-out.** Confirm all three spec acceptance tests, plus the module's guard conditions. Do not set `assistant_enabled` on. Never sign a prompt, evaluation run or knowledge approval as the agent.

Voice (D7) lands here as a separate flagged item if approved.

### S53: medicines, schedule and adherence (8.1 to 8.8)

1. **Catalogue (8.2).** `medicine_catalogue` (brand, generic, strength, form, NAFDAC number, source, version). Seed only from a licensed or founder-supplied source. Migration pattern with fixed ids from `gen_random_uuid()`.
2. **Add flow (8.1, 8.3).** Search-as-you-type from the catalogue, pack photo prefill (pack reader result fills the form; the patient confirms every field, nothing persists until confirmed), Rx photo as reference only. Keep manual add.
3. **Interactions and duplicates (8.7).** Move the curated rules from `apps/web/src/lib/rules/drug-safety.ts` into a shared package so mobile and web run the same check. Add `interactions` table (`drug_a`, `drug_b`, `severity`, `advice_key`, `source`, versioned), an `interaction-check` function on add. Warnings advise contacting the care team and never stop a medicine. Flagged off until a signed dataset exists (D6). Side-effect note field carried to the next consultation.
4. **Reminders (8.4).** Resolve OQ-69 and OQ-71 wording (generic templates only). Medfriend-style in-app notice to a consented supporter on a missed dose, in app only, no send required for correctness. USSD closed (D3).
5. **Adherence (8.5, 8.6).** Show the weekly percentage to supporters with the right permission. Wire the missed-dose and silence signals to the triage engine (this is OQ-89, deferred to S26; coordinate rather than duplicate).
6. **NAFDAC prompt (8.8).** Ask at add and at collection, re-verify the short code and covered classes before publishing copy.

Acceptance: duplicate ACE inhibitor raises a warning, refill reminder fires below the configured days, reminder text never names a medicine, interaction check never changes a prescription.

### S54: pharmacy and further detail (8.9 to 8.16)

1. **Decide D2 first.** Everything else here depends on it.
2. **Prices and stock (8.9, 8.11).** `pharmacy_prices` equivalent on the live table (price, `in_stock`, `updated_at`, `verified_batch`), a `price-compare` function listing partner pharmacies for a prescription, and a chooser UI. Patient chooses, clinicians never see the ranking driver.
3. **Send for collection (8.9).** Write `prescriptions.state = sent` with `pharmacy_partner_id` and `collection_code` when the patient chooses. Reuse the prescription PDF, QR and `/verify-rx/[token]` page.
4. **Refill (8.10).** Tie the running-low reminder to the chosen pharmacy.
5. **Quality (8.11).** Partner quality rules: no listing without a valid NAFDAC-registered source and licence (licence tracking exists). Batch flag on dispense (exists).
6. **Pharmacist chat (8.12).** New thread and message tables, patient and pharmacist only, RLS tested for each role, in-app only (no WhatsApp, F-02). Messages exclude clinical detail beyond the medicine in question; pharmacist-to-clinician escalation reuses care messages. Audit per INV-10 where staff read clinical data.
7. **Dependants (8.15).** Fix OQ-70 and OQ-76 so reminders and the catch-up sheet work for a guardian.
8. **8.16.** Verify P1 shipped, add a lint or DB test that fails if any commission column becomes readable by a patient or clinician role.
9. **Delivery removal (D5).** Patient-facing option removed, `fulfilment_method` pickup-only CHECK, delivery fee stopped, staff courier UI flagged. Later batch: count-first, drop tables and RPCs.
10. **Close-out.** Confirm every acceptance test, plus the no-delivery rule.

### S55: Learning Centre (9.1 to 9.8)

1. **Review-expiry (D4).** Change read RPCs and RLS to exclude `next_review_due < current_date` for clinical content; update the pgTAP test; keep the admin overdue queue.
2. **Reviewer and sources (9.6).** Show reviewer name, review date and sources on every patient item. Move reviewer to a verified clinician reference (`clinical_owner_id` mapping per D1).
3. **Courses and lessons (9.2).** Per-lesson progress table, `lesson.completed` and `course.completed` through the event outbox, a daily micro-lesson card on Today (under five minutes, estimated minutes enforced in the editor), BP care course content (coordinates with S33).
4. **Search (9.3).** Alias table (BP, sugar, high blood, pressure, and so on) reviewed by a clinician, used by the library search; one cross-category question-led entry point. No model call.
5. **Next step (9.4).** A required "what can I do next" field per item, rendered as a standard footer, linking to care plan goal, a booking, or a lesson.
6. **Formats (9.1).** Real audio player on mobile, renderers for FAQ and infographic, a "when to seek care" category.
7. **Myths (9.5).** A myth-busting series tag and programme, moved into the in-app library (marketing copies stay public).
8. **Offline (9.6).** Download-for-offline using the existing mobile offline store, a Downloads screen, respect for review expiry on cached items (re-check on sync).
9. **Creators (9.7).** `creators` table linked to credentialed clinicians (S15 network), submission to the existing review workflow, byline from verified profile, publish only after clinical review. No payout in this session.
10. **Share (9.8).** Share by link and email. Public shareable pages only for content flagged public and in date; the signed-in `learn/[code]` view stays gated.
11. **Pidgin.** No clinical string goes to Pidgin until a clinician signs it (existing OQ rule).

Acceptance: content past `review_due_at` is not served (the module's only listed test), plus lesson and course events, search alias test, offline expiry test.

---

## 6. Sequencing and parallelism

1. P1, P2, P3 (small, independent, can start now).
2. D1, D2, D4, D6 answered (blocks S53 data, S54 and S55 rule).
3. S51 then S52 (strict dependency).
4. S53 then S54 (strict dependency; S54 waits on D2).
5. S55 independent of both, can run in parallel with S51 or S53 in a separate worktree.
6. Everything depends on S40 (Stage 1 complete) per each prompt. Per project memory, that gate is not yet closed, so these sessions are still blocked until `docs/BUILD-PROGRESS.md` starts with "Stage 1 complete".

Rough relative sizing (engineering only, not calendar): S51 medium, S52 large (memory, review tooling), S53 medium, S54 large if D2 changes the order model, small if not, S55 medium. Items needing humans, not code: CMO review of knowledge base and Pidgin phrases, licensed medicine and interaction data, pharmacy partner contracts, NAFDAC verification.

## 7. Items to log in `docs/OPEN-QUESTIONS.md` (not yet recorded)

- Spec table names vs live tables (D1).
- Review-expiry behaviour conflict (D4).
- Assistant INV-04 exposure and missing `sensitive_positive`.
- Coach red-flag list not on the shared engine.
- `pharmacy_medications` commission exposure.
- Delivery code inventory vs "no delivery" and OQ-16 wording.
- 8.9 spec model vs built order model (D2).
- No OQ yet for medicine catalogue, pharmacist chat, USSD, `assistant_enabled`.

## 8. Limits of this review

- Code and migrations only. No live database state checked, so P3 matters.
- Competitor comparison relies on the two October reviews plus a few public pages. App-store listings and screenshots were not opened. Lark, MyTherapy, Healthily, BabyCenter and Altibbi were not researched in depth. Healthily's content review process and Yodawy's price comparison and pharmacist chat could not be confirmed.
- Vendor outcome figures (Wysa 82%, Hello Heart, Platos, mDoc) are marketing claims.
- NAFDAC MAS short code and coverage come from 2010-era and news sources and should be re-verified.

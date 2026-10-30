# Staff dashboard programme: clinician first (2026-10-30)

Status: proposal, nothing built. Follows `docs/design/UNIFIED-WEB-MOBILE-DESIGN.md` (patient layout) and applies the same rule to the staff dashboards: one spec per screen, shared display model, every state shown, tests before "done".

Evidence base: a read of `apps/web/src/app/(dashboard)/clinician/page.tsx`, the clinician competitor notes in `docs/research/S35.md` (second pass, 2026-10-06), `docs/research/competitor-review-global-2026-10.md`, the existing DB proofs in `packages/db/tests/` and the browser E2E in `apps/web/e2e-browser/`. Not done: no dashboard was run in a browser in this pass, and no live event was fired. Everything below about current behaviour comes from code and docs, not from looking at it.

## 1. What exists today (clinician)

- About 170 pages under `/clinician`. The home page (539 lines) stacks: greeting, Today's priorities, CMO governance card, tier blurb, two attestation cards, KPI tiles, Urgent escalations, Notes to complete, then the shared Worklist.
- Good already: every count is checked for `.error` and shown as unknown rather than zero; tier authority is enforced in the DB, not by the page.
- Weak: the home is a long stack with no single hero; about 50 destinations hang off the sidebar; the home fetches in one large server component with no per-section loading state.

## 2. What the competitor audits say to change (clinician)

From `S35.md` second pass and the global review. Each is tagged with whether it is already true.

| Finding | Source | State |
|---|---|---|
| Pull-next with a visible queue depth, no browsable list | Wheel, OpenLoop | Already built |
| Fixed priority labels with a countdown, from versioned config | Manchester triage | Already built |
| Summary order: safety first, then triage events, readings, medicines, plan, notes | Glooko, Omada | Applied in S35 |
| Lead list ranked by what needs a doctor soonest | Glooko | Applied in S35 |
| Scribe review that surfaces omissions (facts to confirm, per-section tick) | Abridge, Nabla study | Mostly built in S35c/S89 (facts stage, per-section ticks, unsupported-sentence flags). The remaining gap, a confirmed fact the draft drops or reverses, is closed by `lib/scribe/omissions.ts` (2026-10-30) |
| Consent as a hard three-state gate with a live indicator | Nabla, Doctolib | Open (overlaps OQ-211) |
| Offline-tolerant console (cache held task, queue actions, "pending upload") | Clafiya lesson | Open |
| Paging ladder with duplicate-suppression count | Rootly, Mitel | Open; voice rung needs a decision (D-12) |
| Printable clinician-ready report | mySugr, Hello Heart | Open |

Not doing (recorded decisions): AI-staged orders or titration (INV-02); a scribe that learns from edits on its own.

**Scribe omission check (2026-10-30).** The scribe already checked draft against facts (`groundingWarnings`: uncited text, unknown fact ids, invented numbers) but nothing checked facts against draft, so a confirmed negation, allergy or red flag that the draft dropped or reversed produced a clean-looking note. `apps/web/src/lib/scribe/omissions.ts` now compares each confirmed fact with the live draft text, deterministically (no model call, so no new AI call site and no registry change). A safety omission (negated symptom, allergy, red flag) blocks "Use in note" until it is added or marked "left out on purpose"; other omissions are listed but never block. A negated symptom must be kept as a negation in the same sentence, so "No chest pain" reversed to "Reports chest pain" is flagged. Medication facts are skipped by design: the draft is forbidden to name a medicine (INV-02). It is a lexical check, so a paraphrase can be flagged (one click clears it); it is built to over-flag rather than pass a dropped fact. `facts.ts` (byte-mirrored into the edge function) and the edge function are untouched, so nothing needs deploying.

## 3. Proposed clinician home (one spec, built in slices)

Order of content, top to bottom:

1. **Hero: your next action.** One card: the highest-priority item due to this doctor (class, countdown, one button). Source: the existing `TodayPriorities` and escalation ranking, no new logic.
2. **Today strip.** Appointments today, notes to complete, reviews due. Three tiles, each with an explicit unknown state.
3. **Urgent escalations** (top 5, as now).
4. **Everything else behind "More"**, grouped under the headings the sidebar already implies. Governance, attestation and CMO cards move to a "For you" section below the fold, not above the work.

Acceptance: loading, empty, error and offline state for each section; WCAG AA; 44px targets; before and after screenshots; Jest tests for the ranking and unknown-state logic; `/code-review high` on the diff (patient safety, silent-failure classes called out by name).

## 4. Events end to end: test matrix

Goal: for each event, prove trigger to delivery to the right dashboard, with a failure case. "Done" means a passing test, not a code read.

| # | Event | Path to prove | Existing proof | Gap to check |
|---|---|---|---|---|
| E1 | Abnormal screening result | trigger, `abnormal-result-handler`, clinician alert, Priority 1 on dashboard | `abnormal_screening_result_upgrade.sql` | Dashboard render after the alert, not just DB row |
| E2 | Dangerous vitals reading | `emergency_events` / `clinician_alerts`, paid vs Free gate | pulse and vitals proofs | Shown on clinician home hero |
| E3 | Escalation routing | auto-assignment, availability, CMO reassignment | `escalation_auto_assignment_*`, `emergency_escalation_tier_gate.sql` | UI shows assignee and countdown |
| E4 | Red page and acknowledge | page, ack-gated escalation, expired page | `alert_system_governance_and_ack_escalation.sql`, `ops_desk_expired_page.sql` | In-console alarm renders |
| E5 | Care message reply | patient message to clinician inbox and back, in-app notification | `clinician-queue-flow.spec.ts` covers queue only | Messages round trip |
| E6 | Booking and appointment | book, reminder, clinician sees it, cancel | `appointment_engine_core.sql`, `coordinator_phone_booking*.sql` | Browser journey |
| E7 | Notification delivery | `send-pending-notifications` deployed version vs source, fallback channel | `notification_delivery_fallback.sql` | CLAUDE.md warns this function has drifted; check deployed version first |
| E8 | Lab order and result | order, partner, result release, consult | partial | Not mapped yet |
| E9 | Prescription and renewal | request, review, pharmacy | partial | Not mapped yet |

First deliverable for events: a script that fires E1 to E4 against a local stack with the test patient and asserts the row appears in the clinician queue query the dashboard uses. Local Docker stack only (Supabase branching is unavailable on this plan).

## 5. Build order and PR plan

One worktree per PR, none merged without required CI.

1. **PR 1: events harness** (E1 to E4, tests only, no UI). Proves the pipeline before the UI depends on it.
2. **PR 2: clinician home slice** (hero, today strip, section states) with the display model in `packages/shared`.
3. **PR 3: scribe omission review** (the top open competitor finding).
4. **PR 4: E5 to E7 browser journeys.**
5. Then the next dashboard: Admin, Finance, Analytics, then partner side, using the same spec template.

## 6. Decisions (2026-10-30, founder)

1. "Comparable to competitors" means both visual parity with the patient redesign and feature parity with the tools in the audits.
2. Console move: redesign once, in `apps/web`, built only on shared `packages/ui` primitives, so the later move to `apps/console` needs no second design review.
3. Staff dashboards wait for the patient layout building blocks. Only the events harness proceeds first.
4. No voice rung in the paging ladder. D-12 and `inv08_no_sms_or_voice_notifications.sql` rule out automated voice. The named ops person phoning the on-call clinician stays as the last resort.

## 7. Events harness result (PR 1)

`packages/db/tests/events_reach_clinician_queue_end_to_end.sql`, registered in `ci.manifest`. Passes on the local stack and fails correctly under two sabotages (clinician read policy narrowed; symptom red-flag trigger disabled).

Findings:
- A critical screening result is paged only by the `abnormal-result-handler` Edge Function. The database trigger raises the alert but pages nobody; it just nudges the function and swallows any error. The harness asserts the nudge is still wired. Whether the function pages in production is covered only by its Deno test and the deployed-version drift job, not by this proof.
- A patient can read their own `clinician_alerts` rows (policy `clinician_alerts_select`, `patient_id = auth.uid()`), including `responsible_clinician_id`. No patient page reads this table. Open question for the CMO/DPO: remove the patient branch? This is an RLS change, so it needs `/code-review ultra` and is not made here.

## 8. Events harness 2: E3 routing and E4 ladder (PR 1, continued)

`packages/db/tests/events_escalation_routing_and_page_ladder.sql`, registered in `ci.manifest`. Passes locally; each of four sabotages (leave check, escalation triggers, ladder sweep, acknowledgement) flips it to a named FAIL.

Proved: an escalation goes to the alert's owner; the assigned doctor sees it with a level and due time to rank by; an owner on leave is skipped; with every doctor on leave the case stays open, unassigned and visible to org staff; the sweep is scheduled; an unacknowledged alert climbs backup at 1x, every senior doctor at 2x, admins at 3x, each once only; an acknowledged alert never climbs.

Findings (none changed here):
- The active `alert_rules` row still lists `whatsapp` in the abnormal-result `channel_sequence`. It is harmless in paging: `notify_clinician_alert` reads it through `normalize_escalation_channels`, which maps a retired token to email. But it still shows in the admin alert-rules screen. Cosmetic cleanup for the next alert-rules version, which needs CMO sign-off.
- `private.auto_assign_escalation` has two identical tier branches (both require senior or CMO), though its comment says "any clinical tier otherwise". Correct after F-05, which left one doctor tier. Dead code, not a defect.
- The ladder's timeout is 30 minutes for abnormal results but the sweep runs every 10 minutes, so a hop can fire up to 10 minutes late. Within tolerance, noted for the SLA review.

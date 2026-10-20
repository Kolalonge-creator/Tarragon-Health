# Design: pulse, SpO2 and temperature on the triage engine

Branch `build/vitals-rule-sets`. Nothing applied, deployed, signed, merged or switched on. Research: `docs/research/build-vitals-rule-sets.md`.

## 1. What and why
Blood pressure (`bp_care_triage`) and glucose (`glucose_care_triage`) run on the deterministic engine in `packages/clinical`. A dangerous heart rate, oxygen saturation or temperature was caught only by three older SQL triggers (`handle_pulse/spo2/temperature_reading_red_flag`) that no rule set, signature, fixture or phone shares. This adds ONE combined rule set, `vitals_care_triage` v1, seeded as an unsigned draft that grades in shadow beside them. One rule set because the three share a shape (one reading, no symptoms, no repeat flow) and the CMO signs once.

## 2. Decisions
- Starting values are the live older bands (read from `pg_get_functiondef`, 2026-10-16), so the divergence report compares like with like. They are PROPOSED; the CMO sees the NEWS2 comparison.
- Single reading only. No aggregate early-warning score, no symptoms, no cross-metric pattern (the standing wearables decision still holds).
- Two deliberate differences from the older triggers: (a) a value outside the physically possible range is rejected as a typo; (b) a FAST heart rate (101 to 149) in a patient under 18 is routed to a clinician (VT-PU3, amber) because adult fast-rate bands are not child bands; a slow rate (39 or below) and the emergency band (35 or below, 150 or above) apply to everyone. Typo gates: pulse 10 to 300, SpO2 30 to 100, temperature 20 to 46.
- Emergency and red are both red grades; the guidance code tells them apart (VIT-E01 emergency, VIT-E02 same-day care).
- The patient's own clinician-set amber line (SpO2, temperature) turns a green amber, as the older triggers do; it never touches a red.
- Manual, Bluetooth and photo-confirmed readings only. Wearable streams stay on the older triggers (connection budget, stale-value risk).
- A new task type `amber_vitals_review` (born unconfirmed) rather than reusing a BP or glucose one.
- Wording lives in `packages/i18n/src/vitals-wording.json`, unsigned, deliberately NOT in the English catalogue: no screen shows a vitals grade yet, and adding strings would grow the reviewed-strings ledger baseline.

## 3. Pieces
- Engine twin `supabase/functions/_shared/clinical/vitals-engine.ts` (same evaluator, actions, result shape and INV-05 check as the glucose twin), rules `packages/clinical/src/rules/vitals-care-v1.ts`, handler branch (`kind: vitals`) and ports in `observation-handler.ts` / `triage-ports.ts`.
- Migrations: `..._build_vitals_care_triage_v1_draft.sql` (rule set JSON, task type), `..._build_vitals_triage_wiring.sql` (producer trigger, context, writer, 10-minute sweep at minute 6), `..._build_vitals_shadow_divergence.sql`, `..._build_red_page_dedupe_key.sql`.
- PROPOSED config key `triage.single_reading_vitals_bands` and `vitals-drift.test.ts`: the registry, the rule set params, the phone's `vitals.device_red_rules` and the older SQL classifiers must agree. The band scan test now also covers pulse, SpO2 and temperature (legacy files allowlisted with exact counts).
- CMO hub: line "Pulse, oxygen and temperature triage rules" with inline panel (numbers, per-rule basis and NEWS2 comparison, open points, full wording, Sign) at `/clinician/vitals-triage-rules`, a line and panel for the task type, nav and search entries.

## 4. Parity tooling
`public.triage_vitals_shadow_divergence(days)` and `triage_vitals_shadow_disagreements(days, limit)` (admin or active clinical director, aggregates without patient ids, test accounts excluded). Classes: both_urgent, neither_urgent, shadow_only_urgent, live_only_urgent (dangerous), live_urgent_no_shadow (older trigger raised, engine left nothing: typo gate or missing event), with a `by_design` marker for the child's heart rate. The aggregate carries the engine grade against the live level so amber disagreements show too. Also fixed: `private.triage_parity_rows` (the BP engine parity report) counted every observation result, so glucose and vitals results appeared as "engine red, legacy none"; it now reads `bp_care_triage` only (patched in place from the live definition).

## 5. Duplicate paging
Before: once signed, the engine pages through `create_red_page`, and the older trigger either broadcasts to every clinician (unified paging flag off) or pages through the same function (flag on). The existing merge folds a repeat into an OPEN, UNACKNOWLEDGED family, but deliberately never an acknowledged one (INV-05), so an acknowledged page followed by the second pipeline's event for the same reading rang again.
Now: `private.red_page_dedupe_info` gives a key `vitals:<patient>:<metric>:<level>` (level emergency or red, from the guidance code or the unified basis / emergency source) plus the reading id. `create_red_page` (patched in place, four asserted replacements) folds an event into the page recorded in `red_page_dedupe_claims` (one claim per key and reading, so interleaved readings never overwrite each other) when that reading was claimed inside the existing reconcile look-back (4 hours, the CMO-owned `reconcile_lookback_hours`), on a page that is still open, acknowledged or not. The lookup and the claim writes are wrapped so that any error falls through to ordinary paging: a page is never lost to bookkeeping. Two companion patches, both in place with asserted anchors: an engine EMERGENCY result (VIT-E01) never joins a lower-severity family (as S19d already does for the unified emergency event), and it opens no second patient-outreach watch (the emergency event has one). A different reading, metric, worse level or closed page pages as before. Behind the unsigned state: shadow results return before this code and unified rows exist only when that flag is on, so nothing changes until signed.
Not solved by this: with unified paging OFF and the rules signed, the older trigger's broadcast and the engine's page both reach clinicians (the parity period the CMO accepted, Q1). Turning unified paging on makes them one page; that sequence is in the closeout.

## 6. Safety rules kept
INV-01 (no model), INV-05 (every red has guidance and a page; validator and DB check), INV-07 (ids only in events, neutral task notice), Free patients get the guidance record and no page, Africa/Lagos weeks for task keys, no em dashes, "your care team" wording.

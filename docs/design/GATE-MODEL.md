# G-01: one gate model (masters, features, protocols)

Founder decision, 2026-10-29 (recorded in `docs/DECISIONS.md`, section "Founder decision, 2026-10-29 (G-01: one gate model)").
Migration `20261029223751_gate_model_masters_and_features.sql`. Proof `packages/db/tests/gate_model_masters_and_features.sql`.

## 1. Why

Counted live on 2026-10-29, not from the docs:

| Gate system | Count | State |
|---|---|---|
| Go-live guards (`go_live_guards`) | 92 | 6 on, 86 off; 27 of the 86 had no condition branch at all (`unknown_guard`), so the switch function refused every attempt to open them |
| Platform modules | 29 | 3 on |
| Feature flags | 13 | 6 on |
| AI registry systems | 22 | 7 disabled; 67 guardrails and 5 knowledge sources with no approval |
| Governed configuration tables that refuse to go live unsigned | 44 | 90 sign/approve/activate functions, 62 sign-off panels on the CMO hub |
| Proposed-config registry values | 388 | 338 still marked `proposed` |
| Open-question ids in `docs/OPEN-QUESTIONS.md` | 834 | 6,148 lines |

Every v5 session was told "if the CMO has not signed it, ship it dark", so each feature produced a guard, a configuration version to
sign, a hub panel, a registry entry and an open question, each needing a round trip with the founder, who is also the CMO. Almost all
of the 86 dark guards protect something no real patient can reach anyway, because the master switches are off.

## 2. The model

A guard has a `kind`.

- **master** (nine): `public_signup_enabled`, `checkout_enabled`, `clinical_operations_enabled`, `prescribing_enabled`,
  `payouts_enabled`, `lab_booking_enabled`, `research_export_enabled`, `assistant_enabled`, `on_call_cover_ok`. Exactly as before:
  switched on only by the role it names, with a note, once every condition is met against real records. These are the Stage 1 gate.
  `on_call_cover_ok` is a live operational state (is the rota covered), not a feature, so it stays a decision.
- **feature** (everything else): open when its row is on, it is not held, and its parent master (if any) is on. An admin or the CMO
  switches it either way; no condition is evaluated; switching it OFF needs a reason of at least 20 characters, kept in `held_reason`
  and shown on the go-live page. A feature never creates a hub line or an owed signature.

`private.go_live_guard_on` is the one lookup every helper, trigger and policy builds on, so the parent rule applies everywhere at once.
The test-pair and test-patient bypasses sit above it and are unchanged.

The CMO signs **clinical protocols** (the patient-harm list): triage rules, glucose, vitals and blood pressure thresholds, escalation
SLAs, prescribing and interaction rules, screening and result-release rules, mental-health follow-up, fasting and low-carbohydrate
protocol wording, AI system approvals, and anything a person explicitly raised as owed. Everything else is an **operational setting**:
versioned and audited, no signature owed, never counted in the banner.

## 3. Mapping

Parents, only where the master's own enforcement already makes the feature unreachable:

| Parent | Features |
|---|---|
| `clinical_operations_enabled` | the ten `pathway_*` guards, the seven `therapy_*_enabled` guards, `symptom_checker_enabled`, `community`, `live_redflag_prompts_enabled`, `mental_health_worklist_enabled`, `wellbeing_summary_share_enabled`, `post_consult_checkins_enabled`, `low_carb_t2d_programme`, `fasting_safety`, `maternal_enabled` |
| `lab_booking_enabled` | `home_kit_sensitive_enabled`, `lab_structured_push_enabled`, `hpv_dna_enabled` |

Not parented on purpose: `membership_billing_enabled`, `sponsor_payment_enabled`, `access_fund_enabled`, `concierge_coordinator_enabled`
(the checkout master already gates `price_quote` and `create_order` for a real patient); `scribe_enabled`, `paper_diary_ai_reader`,
`document_capture_enabled`, `cuff_camera_enabled` (the AI registry, `ai_systems.is_enabled`, is their real gate; tying them to the chat
assistant's readiness would be false); the six features the CMO had already opened (screening scheduler and automation, the sensitive
opt-in, mental-health follow-up, sleep screen, reproductive content), which run today without clinical operations.

Held (a readiness fact, not a signature):

| Feature | Reason on the row |
|---|---|
| `sms_emergency_contact_enabled` | live SMS delivery never proven |
| `wallet_pass` | no Apple Pass certificate or Google Wallet issuer account |
| `settlement_tieout_daily` | reconcile function not scheduled; a daily incident with no owner |
| `directory_partner_stale_email` | partner contact addresses not confirmed real |
| `directory_hide_stale_partners` | could hide the one contracted laboratory |
| `therapy_pain_enabled`, `therapy_cbt_i_enabled`, `therapy_mood_enabled` | scaffolds, no content |
| `therapy_pulmonary_rehab_enabled` | no entry list until the COPD pathway runs |
| `pathway_post_stroke_care`, `pathway_sickle_cell_care` | scaffolds, no thresholds or enrolment path |
| `community` | no moderator or safety reviewer named |

Every other feature stands on its own and is opened from the go-live page.

## 4. What the migration does and does not do

Does: adds `kind`, `parent_key`, `held_reason`; names the masters, the parents and the holds; makes the lookup parent-aware; gives
`set_go_live_guard` its feature branch (no conditions, either role, a reason to hold); adds the fields to `go_live_guard_status`
(masters first); keeps the table guard strict and adds "a parent is a master, a master is never held".

Does not: switch any row on. A feature that is off today stays off until an admin or the CMO opens it (one click, attributed, logged).
That keeps the CI replay and every existing proof meaningful and makes the live opening a recorded human act. Opening the standalone
features live is the founder's next step, from `/admin/go-live` or `/clinician/go-live`, or in one SQL pass as the founder's own
session calling `public.set_go_live_guard(key, true, note)` per feature. The insert rule (a guard is created switched off) is kept.

Proofs edited for the new semantics (all rolled-back, all still prove enforcement): `pcc_post_consult_checkins`, `s62_tests_sweep_guard`,
`s77_live_redflag_prompts`, `f1_symptom_checker_go_live_guard` (a feature under the clinical-operations master: the master is switched
with it), `s07x_home_bp_programme`, `s07y_cuff_check`, `s09x_my_health_completion`, `record_lessons_and_portion_guide` (a feature opens
without its attestation; it is held again at once so the closed checks keep their meaning).

## 5. The hub

`readCmoSigningHub` now returns `items` (clinical, counted by the banner) and `operational` (same panels, a collapsed list, never
counted). The classifier `isClinicalSignoff` is the single place a hub line is placed; `cmo-signing-hub.test.ts` checks the known keys.
A new hub line has to be put in one list on purpose.

## 6. Rules from here (also in `CLAUDE.md`, "Gates")

1. Do not add a go-live guard for a new feature unless a real person could reach it while every master is off AND it can do harm.
   If you add one, it is `kind = 'feature'`, it names its parent master (or none), and it is opened at merge from the go-live page.
   Never write a condition branch for a feature; conditions are for masters.
2. Do not add a new master, a platform module or a feature flag. A master is a founder decision recorded in `docs/DECISIONS.md`
   and in the proof's fixed list.
3. Do not add a signed configuration table unless it is on the patient-harm list. Everything else is a setting: versioned, audited,
   a change note, no signature, no hub count.
4. One gate per feature, never two. If the AI registry gates it, no guard. If a master gates it, no second guard.
5. A `proposed` registry value under a signed protocol is in force by that signature; do not open a question for it.
6. An open question that blocks no master goes into `docs/OPEN-QUESTIONS.md` as "default taken: X" and closes.

## 7. Deferred (not in this change)

- Widening the ~20 operational activation functions from CMO-only to admin-or-CMO (each is its own function body; redefine each from
  its live body, never from the migration that first created it).
- Folding `platform_modules` and `feature_flags` into `go_live_guards` (29 + 13 rows; the dormant payer/provider/NGO platforms read
  `platform_modules` directly).
- Deleting the dead condition branches for features in `private.go_live_conditions*` (they are advisory now, recorded in the log).
- The bulk pass over `docs/OPEN-QUESTIONS.md` (834 ids) under rule 6, and marking registry values in force under rule 5.

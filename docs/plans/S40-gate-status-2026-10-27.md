# S40 Stage 1 gate status, 2026-10-27

**Verdict: the gate is NOT passed.** "Stage 1 complete" is not written in `docs/BUILD-PROGRESS.md` and this document does not write it. Only the founder and the CMO can pass the gate. An agent never signs a clinical protocol, rule set or go-live attestation. Nothing here was applied, pushed or signed. Live facts below come from SELECT-only queries against project `koiplnmbgnqnbywhpjlf` on 2026-10-27. This replaces the stale status tables in `docs/STAGE-1-SIGNOFF.md` (written 2026-10-07), which are left untouched.

Gate definition (`docs/v5-sessions/S40-stage-1-completion-gate.md`): run the full matrix (unit, database, integration, Maestro, Playwright, all 25 clinical safety cases, performance), list every acceptance test pass or fail, every unsigned PROPOSED value and every open question, and only if all pass write "Stage 1 complete". Status key: MET, NOT MET, NEEDS FOUNDER, NEEDS CMO, NEEDS COUNSEL, UNVERIFIED.

## 1. Criteria

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | All Stage 1 sections (S01 to S39) merged to main-dev | MET (code) | Every PR the draft listed as blocking is MERGED: 982, 986, 995, 1012, 997, 1011, 1013, 1014, 1018, 979, 1000 (S28c on top of live S28); 990 was reverted by 1001 and replaced by 1000; 993 closed. `git rev-list --count HEAD..origin/main-dev` = 0 at start. |
| 2 | Migrations for those sections applied live | UNVERIFIED | Not re-diffed today. The release-integrity job is the authority; read its last run. |
| 3 | Unit matrix passes | UNVERIFIED | Not run in this session. CI on main-dev is the evidence; last local counts quoted in the draft (mobile 1,553, web about 4,149) are old. |
| 4 | Database proofs pass | UNVERIFIED | 1,441 lines in `packages/db/tests/ci.manifest`; CI replay runs them per PR. Not run locally. |
| 5 | Integration (50 parallel claims etc.) | UNVERIFIED | Scripts exist (`s17_queue_concurrent_claim.sh`, `s18_lead_capacity_race.sh`, `s19_page_ack_sweep_race.sh`); not run in CI by design. |
| 6 | Maestro mobile flows | NOT MET | S85 ran one flow (`signed-out-sign-in-screen.yaml`) on a simulator against a stale 2026-09-13 build. Login, offline and checkout flows never run. Needs founder device or simulator. |
| 7 | Playwright console flows | NOT MET | S85 ran journeys 1, 2, 4 on a local stack with pending steps; the 5 authenticated sign-in specs from S01d never ran. |
| 8 | 25 clinical safety cases | UNVERIFIED | Proof locations in `docs/STAGE-1-SIGNOFF.md` section 3 still valid by name; results column blank. Fixture `packages/clinical/fixtures/safety-cases.json` has no recorded CMO review. Case 7 mismatch (5 days in spec, 6 in fixture) now resolved in the live rule set: `triage.silence_rule_days` has a sign-off row and live `bp_care_triage` is v7 approved. Confirm the CMO signed the number the spec case expects. |
| 9 | Performance | NOT MET (by decision) | OQ-227: no targets; reported, not gated. Cold start, size, memory never measured on a device. |
| 10 | Every PROPOSED value signed | NEEDS CMO / FOUNDER | Section 4. |
| 11 | Every open question decided | NEEDS FOUNDER / CMO | About 552 headings in `docs/OPEN-QUESTIONS.md`; the "Decision: open" count is a text match, not a status. Stage 1 blockers listed in section 7. |
| 12 | Milestones M0 to M10 acceptance | NOT MET | M0 needs a staging deployment (OQ-36, founder). M2 performance unmeasured. M6 needs a real Paystack test payment (founder key). M9 needs a real payout test with attestation (S31 guard OFF). |

## 2. Clinical configs not yet signed (live)

Live counts: `triage_rule_sets` approved 3 (bp_care_triage v7, glucose_care_triage v1, vitals_care_triage v1), draft 6, retired 3; `triage_protocols` 1 active of 10; `risk_questionnaire_configs` 1 active of 2; `escalation_slas` 1 active; `proposed_config_signoffs` 44 rows over 40 distinct keys; `go_live_attestations` 7 rows. All 27 CMO-owned Stage 1 keys named in the draft (paging, bp.*, triage.*, queue.*, lab.*, lead.*, quality.audit, medicines.dose_rules, written_care, care_change and the rest) now have a sign-off row. I matched by key only; whether each row is the latest version is UNVERIFIED.

Still unsigned and shown on the sign-off hub (`/clinician/clinical-signoff`, `readCmoSigningHub`), where the CMO sees the exact stored rule text or wording with a fingerprint:
- Draft triage rule sets: `bp_care_triage` v4, v5, v6 (superseded drafts, CMO should retire, not sign), `asthma_copd_care_triage` v1, `heart_failure_triage` v1, `ckd_monitoring_triage` v1. Triage rule-set panel. Not Stage 1 critical: these power dormant pathway guards.
- S85 D1 to D4 pack (`docs/plans/S85-S87-cmo-signoff-pack.md`): D1 180/120 symptom question (CMO fields still open: one symptom or two, 180/110 trigger, recheck window; OQ-551 says approved v3 names no follow-up task for red), D2 fertile-window label, D3 SMS exception (needs founder too), D4 languages. Text is in that pack.
- AI-017 scribe: system disabled, two evaluation suites not run. Not a Stage 1 blocker unless the founder counts S35c in scope.
- Dormant-feature values (about 240 of 282 registry keys have no sign-off): not Stage 1 gating, they gate their own guards.
- Founder-owned unsigned: `proxy.setup`, `commerce.care_pack_price_kobo`, `earnings.rules`, `payouts.rules`, `scribe.transcript_retention_days`, `privacy.transcript_retention` and `credentialing.rules` (founder and counsel).

## 3. Go-live guards

All 83 rows in `go_live_guards` are OFF, including `checkout_enabled`, `prescribing_enabled`, `scribe_enabled`, `payouts_enabled`, `lab_booking_enabled`, `clinical_operations_enabled`, `public_signup_enabled`, `community`, `membership_billing_enabled`, `on_call_cover_ok`, every `pathway_*` and every `therapy_*`. Attestations exist for `community` (3), `bp_pattern_flag`, `home_bp_programme`, `cuff_check_flag`, `cuff_visit_prompt` (2026-10-27) but those guards are still off. `platform_modules`: ON are `tied_staff_reads` and `tied_staff_writes` (INV-12); OFF are all others including `v5_checkout`, `membership_two_member_tiers`, `payer_platform`, `provider_org_platform`, `ngo_funded_cohort`, `cohorts`, `group_sessions`. Stage 1 does not require every guard on; it requires that any switch-on is a human act with attestations. Note the BP journey itself (`pathway_bp`, `public_signup_enabled`, `on_call_cover_ok`) is OFF, so no real patient is live.

## 4. E2E journeys (S85) and Part C scan (S87)

S85 (BUILD-PROGRESS line 1513, "incomplete by design", no pass claimed): DB event-map proof 48 checks plus 2 sabotage flips; Jest 36; Playwright J4 7 passed/3 pending/1 skipped, J2 13 passed/5 pending (needs a TEST rule-set fixture), J1 6 passed/9 pending/1 skipped, J3 12 pending (skeleton). 11 expected event-map gaps. Pending steps per journey: J1 9 plus Paystack skipped, J2 5 (CMO signature, web offline guidance S12, S64, S38), J3 12, J4 3 plus 1 skipped. Open: OQ-548 (aggregates over is_test), OQ-549 (untied clinician reads of reproductive and mental-health rows), OQ-550 (no web offline emergency guidance; phone fallback rules are BP_CARE_V1 while DB holds a later version), OQ-551, OQ-552.
S87 (line 1532): scanner and 12-entry allowlist merged (`packages/shared/src/part-c-scan`, `docs/audit-partC.md`). Findings: 2 CONFLICT (fertile window unlabelled in 6 files, SMS beyond codes and paging in 5 paths), 5 DORMANT, 2 NOT VERIFIED. Allowlist entries expire 2026-11-06. Removal migrations not done.

## 5. Release blockers (memory checklist, status by evidence)

| Blocker | Status |
|---|---|
| PITR and tested restore (OQ-266) | NEEDS FOUNDER. Last recorded `pitr_enabled: false`, no backup (2026-10-07); not re-checked today, UNVERIFIED. |
| Staff read tied to care relationship (INV-12) | MET for tied tables: `tied_staff_reads` and `tied_staff_writes` ON live since 2026-10-07; S39c audited access merged. Open: OQ-549 untied reproductive and mental-health reads; 103 org-wide tables left (OQ-280). |
| Erasure, retention, complete export | Built (S39d, S39e, S39f merged). OQ-262 decided: no erasure, restrict on request. Counsel questions in `docs/legal/questions-for-nigerian-counsel-S39.md`: NEEDS COUNSEL. |
| Signed DPAs with processors (OQ-268) | NEEDS FOUNDER and COUNSEL. None signed per last record. |
| Pharmacy partner (OQ-274/OQ-518) | NEEDS FOUNDER. No licence-verified partner; patients use prescription PDF. |
| Rate limits (OQ-267) | NEEDS FOUNDER (open); S88 workstream. |
| Paystack test payment, Zoom paid plan | NEEDS FOUNDER. |

## 6. Engineering workstreams in parallel (not touched here)

S85 journeys and web offline guidance; S87 scan rules and the SMS fix; S88 crash reporting, lab guard, staff-read tie; S89 copilot first slice; S90 care-gap engine. No small, safe engineering fix was identified in this pass (every open item needs a decision, a device or a signature), so no code was changed.

## 7. Ordered checklist to pass the gate (shortest path first)

Founder and CMO decide the scope question first, because it changes the length of the list: **is the gate "every open item" or "the BP journey can safely carry one real patient"?** The shortest honest path is the second.

1. Founder: confirm in `docs/DECISIONS.md` which criteria are gating. Waivers already given in chat were per-session only and are not a pass.
2. Founder (dashboard): upgrade Supabase to Pro, enable PITR, restore into a scratch project, record RTO and RPO (OQ-266).
3. CMO: on the sign-off hub, decide D1 (180/120 rule and the OQ-551 follow-up task) and D2, D3 with the founder; retire superseded `bp_care_triage` v4 to v6 drafts; confirm the safety-case fixture and the case 7 day count.
4. Founder and CMO: run the live BP journey on a real device: Maestro flows, device timing for case 1, safety cases 1 to 25 with results recorded in `docs/STAGE-1-SIGNOFF.md` section 3.
5. Founder: run Playwright console flows and the 5 sign-in specs on a machine with Docker; stage both apps (OQ-36).
6. Founder: real Paystack test payment (S25) and real payout test with attestation (S31).
7. Founder with counsel: sign the DPAs (OQ-268), answer the erasure and retention questions, record the pharmacy-partner position (OQ-274).
8. Founder: decide OQ-548, OQ-550, OQ-267 or defer each in writing.
9. Rerun CI and the release-integrity job on main-dev; confirm migrations applied (criterion 2).
10. Only then the founder or CMO writes "Stage 1 complete" at the top of `docs/BUILD-PROGRESS.md`.


## Update, 2026-10-27 (later the same day): items decided in chat

Founder decisions recorded in `docs/DECISIONS.md` (section "Founder decisions, 2026-10-27"):
- Gate scope is the FULL gate.
- D1 is superseded by `bp_care_triage` v7 (approved 2026-10-27 00:09 UTC); no signature needed; retire v4 to v6 drafts.
- D2 fertile-window wording is recorded as signed (founder acting as CMO) in `clinical-wording.json`.
- D3 is recorded as "SMS is for verification codes only"; the clinician Termii SMS and voice code is deleted on branch `s87/scan-rules-sms-allowlist`.
- PITR: the founder will upgrade Supabase to Pro and enable PITR, then run and record a restore test. Still open until done and verified.

The gate is still NOT passed. Remaining items are listed in the numbered checklist above; items 3 (D1 to D3) are now closed once this branch merges.

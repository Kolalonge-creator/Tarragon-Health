# S41 to S46 migrations: dry-run and apply plan (2026-10-07)

Status: PLAN ONLY. Nothing applied, nothing signed. Live project `koiplnmbgnqnbywhpjlf` read with SELECT only. Live ledger has 1,665 versions, newest `20261007200000` (S39h). Live is tiny: 9 real profiles, 0 rows in record_shares, family_history, screening_schedules, patient_documents, notification prefs.

## 1. Where the work is

No branch is pushed to origin and there is no PR for any of them (`git ls-remote` empty, `gh pr list` shows none). Each lives in a local worktree under `.claude/worktrees/` (s44 and s46 worktrees are locked, so possibly a live session). Every branch is stacked on an old base (`fb32a0b23` / `f0809ae2d`), about 140 commits behind `origin/main-dev`.

| Session | Branch | Migrations (bytes) | Creates |
|---|---|---|---|
| S41 | `s41/account-signin-consent` (inside s42) | `20261007121539_s41_onboarding_answers_and_lga` (8.8k) | `onboarding_answers`, `save_onboarding_answers`, `profiles.lga` |
| S42 | `s42/consent-privacy-dependants` (contains S41) | `131712_s42_consent_matrix` (29k), `133846_s42_privacy_centre_export_and_anonymiser` (14k), `135419_s42_dependants_handover_and_permissions` (21k), `141233_s42_drop_sms_enabled_preference` (1.5k), `142958_s42_proxy_coercion_safeguards` (6k) | 4 consent tables, `dependant_handovers`, `proxy_access_endings`, ~30 RPCs, triggers incl. two on `auth.users`/profiles, anonymiser, restates `private.can_read_clinical(uuid, care_access_category)` |
| S43 | `s43/health-passport` | `121906_s43_record_foundations` (48k), `122142_s43_share_links_and_emergency_card_fields` (29k), `122358_s43_biomarker_trends_and_vaccination_schedule` (18k) | `procedures`, `record_share_config`, `emergency_card_fields`, vaccination schedule v2 (unsigned), AI-018 row, guard `document_capture_enabled`, 30 functions |
| S44 | `s44/interoperability` (contains S43) | `152041` (23k), `152318` (11k), `152547` (12k), `152802` (16k), all `_s44_*` | `external_exchange_consents`, `external_records`, `patient_item_notes`, `fhir_export_log`, `lab_code_mappings`, `lab_result_pushes`, guard `lab_structured_push_enabled` |
| S45 | `s45/risk-screening-packages` | `131827_s45a_screening_status_not_applicable` (0.5k), `131904_s45_risk_screening_packages` (42k) | `risk_instrument_versions`, `risk_assessments`, `screening_rule_sets`, `screening_packages`, 3 guards, lab_orders trigger |
| S46 | `s46/results-and-health-report` (contains S45) | `141207_s46_results_serology_health_report` (68k), `141633_s46b_ai019_health_report_summary_registration` (1.6k) | 5 tables, 28 functions, AI-019, guard `health_report_generation_enabled`, serology rules v2 ACTIVE |
| S46c | `s46c/report-routing-and-caregiver-read` (contains S46) | `221347` (1.8k), `223108` (17k), `224629` (14k), all `_s46c_*` | report sign-off as S16 task, caregiver report read, hepatitis copy to yearly |

## 2. Dependencies and order

Order is by filename timestamp. Ledger order must equal file order, so apply exactly this sequence:

1. S41 `121539`
2. S43 `121906`, `122142`, `122358`
3. S42 `131712`
4. S45 `131827`, then `131904`
5. S42 `133846`, `135419`
6. S46 `141207`, `141633`
7. S42 `142958`
8. S44 `152041`, `152318`, `152547`, `152802`
9. S46c `221347`, `223108`, `224629`
10. HOLD `141233` (drop `sms_enabled`) until the new edge function and web/mobile builds are deployed (CLAUDE.md: code first, schema second; its own header says so).

Hard dependencies: S42 anonymiser needs S41 `onboarding_answers`; S44 needs S43 (`procedures`); S46 needs S45 (`screening_due`, risk, rule-set tables); S46c needs S46. S46c caregiver read soft-depends on S42 `dependant_handovers` (guarded by `to_regclass`, fails closed to "nothing"), so apply S42 first. Live objects all present: `go_live_open_patient`, `clinician_has_patient_access`, `emit_domain_event`, `go_live_conditions`.

Merge issue: no branch has a PR. Suggested three PRs, each rebased on current `origin/main-dev` first: (A) `s42` (carries S41), (B) `s44` (carries S43), (C) `s46c` (carries S45, S46). Expect conflicts in `packages/db/tests/ci.manifest`, `s36b_go_live_status_ops_read.sql`, `s37_go_live_guards.sql` (S43, S45, S46 each edit them), `docs/BUILD-PROGRESS.md`, `docs/OPEN-QUESTIONS.md`. Merge after apply (CI does not push migrations). Live also holds S39b, c, d, e, f, g, h migrations that are on unmerged branches, not main-dev; none of S41 to S46 was tested alongside them.

## 3. Per-migration checks

Collision: none of the 20 S41-S46 versions exists live, and none has a live row under a different name. Live-only orphans near them are the S39 branch migrations (`133517`, `150412`, `164500`, `181500`, `190000`, `193000`, `200000`, plus `120002` S18) that sit on origin branches, not lost. Re-run `list_migrations` right before applying; it moves daily.

| Migration | Risk |
|---|---|
| S43 `121906` | `alter type timeline_event_type add value` x2 (irreversible once committed; cannot be used in the same transaction). Drops and recreates family_history policies and several constraints and triggers. Updates only zero-row tables. |
| S43 `122142` | Drops `create_record_share(text[], integer)` and replaces it; nulls `record_shares.token` (0 rows live); truncates nothing. |
| S43 `122358` | Inserts vaccination schedule v2 inactive. Side effect: reminders pause until v2 is signed (OQ-S43-1); live v1 is active. |
| S42 `131712` | Replaces `enforce_patient_consent_withdrawal` (exists live) and adds a trigger on `care_circle_members`. |
| S42 `133846` | Triggers on `auth.users` and profiles (CLI event-trigger / grant gotchas apply). The anonymiser deletes and rewrites auth rows by design; only runs on a deletion request. |
| S42 `135419` | Restates `private.can_read_clinical(uuid, care_access_category)`. Live body matches except the new OQ-47 line (adult proxy never implies reproductive). No new overload is added, so the 42725 trap does not apply; live still has the 1-arg and caregiver_permission overloads, so confirm no new bare-literal call sites. Backfill `update` on profile_access (0 matching rows). |
| S45 `131827` | Enum add only; must be its own transaction. |
| S45 `131904` | Adds a trigger `lab_orders_zz_home_sensitive_kit_guard` on lab_orders; 3 guards inserted OFF. |
| S46 `141207` | Serology v2 is ACTIVE on apply, so the hepatitis rule changes at once (founder decision, legacy v1 kept). Replaces `screening_due`. 102 `from public/anon` revokes to spot-check. |
| S42 `141233` | Drops a column: do not apply yet. Zero rows hold data, but the old deployed edge function would fail. |
| S46c `223108` | Drops and recreates `clinician_health_report_queue()`. |

Anon execute and default privileges: live `pg_default_acl` for postgres gives tables to authenticated and service_role only (no anon), functions to authenticated and service_role only. Every migration uses `revoke ... from public, anon`. The proofs assert this, but run section 4's post-apply ACL query anyway (the "grant asserts can lie" memory).

Rollback: pure additions (tables, functions, rows) can be dropped. Not cleanly reversible: the three enum values, S42 `sms_enabled` drop, and the S46 serology rule switch (back to v1 by flipping `status`). Take a Supabase PITR/backup point before step 2.

## 4. Procedure

Dry run (the founder-approvable bit):
1. Local, not live: `supabase start`, `supabase db reset` on each PR branch rebased on main-dev, then the new proofs from `packages/db/tests/` (`s41_onboarding_answers`, `s42_*` x4, `s43_health_passport`, `s44_interoperability`, `s45_risk_screening_packages`, `s46_results_serology_health_report`, `s46c_*` x3). Sessions report passing proofs on bases without the S39 branches and without each other, so the combined replay has never been run. Run it.
2. Live rolled-back check, per migration: `begin; <file SQL>; <proof SQL>; rollback;` via `execute_sql`. Caveat: S43 and S45a add enum values; the proof cannot use them inside the same transaction, so those proofs only pass on the local stack. Use the live dry run for syntax, collision and ACL only. A rolled-back transaction is not a CI replay.

Real apply, one transaction per migration, in the section 2 order, after PRs are merged and after a fresh `list_migrations`:
`begin; <file SQL>; insert into supabase_migrations.schema_migrations (version, name, statements) values ('<filename timestamp>', '<name>', array[$m$<file SQL>$m$]); commit;`
Never bare `apply_migration` (it stamps wall-clock time).

Post-apply live checks: (a) `list_migrations` shows each version exactly as the filename; (b) `has_function_privilege('anon', oid, 'EXECUTE')` is false for every new function (join `pg_proc` on the new names) and `has_table_privilege('anon', ..., 'SELECT')` false for the new tables; (c) the seven guards exist and `is_on = false`; (d) one row each in `risk_instrument_versions`, `health_report_config_versions`, `screening_rule_sets` (v1 and v2), `serology_rule_versions` (active = 2); (e) `pg_policies` on `procedures` has no bare-literal `can_read_clinical`; (f) re-run the S36b/S37 proofs; (g) git diff of migration files against `schema_migrations.statements`.

## 5. What becomes signable, and what stays blocked

Signed by the CMO only; an agent signs nothing.

| Item (from `S41-S46-signoff-items.md`) | After | Status |
|---|---|---|
| Report settings v1 (`sign_health_report_config`) | S46 | Signable. But v1 has `statementApprovedByCmo: false`, so the guard condition "statement approved" can never be met. Needs a v2 row (new migration with the approved wording) |
| Disclaimer, report statement, emergency signs text | S46 | Placeholders; need CMO review of text, then a follow-up migration or config row |
| Screening rule sets v1 and v2 (`sign_screening_rule_set`) | S45, S46 | Signable |
| Immunisation schedule v2 (`sign_vaccination_schedule`) | S43 | Signable; clears the reminder pause |
| Anti-HBs 10 mIU/mL threshold | S46 | BLOCKED: nothing in the migration sets `threshold_approved_by`; no sign RPC exists |
| WHO 2019 instrument (`sign_risk_instrument`) | S45 | BLOCKED: `coefficientsVerified: false`, coefficients absent, signing raises `coefficients_not_verified`; also needs Nigeria region and licence confirmation |
| Lab code mappings (`confirm_lab_code_mapping`) | S44 | Signable per mapping; no lab pushes yet |
| AI-018 and AI-019 evaluations | S43, S46b | Registered only; no evaluation recorded |
| Guard conditions (section 4 of the items doc) | after S43, S44, S45, S46 | BLOCKED until a follow-up migration restates the LIVE `private.go_live_conditions` (live hash `96c421b2...`, 6,611 chars; not the repo copy). Until then every new guard reads "no defined condition" and cannot be switched on |

## 6. Risks, ranked

1. Combined stack never replayed together, and not against the live-only S39 migrations. Fix: step 1 above before any apply.
2. Restating `go_live_conditions` from the repo copy would erase live conditions. Always start from `pg_get_functiondef`.
3. Out-of-order ledger: 17 of these versions are older than 7 already-live S39 versions. Pinned insert works, but `supabase db push` would refuse without `--include-all`.
4. Irreversible: three enum values, and the S46 serology switch changes who is offered hepatitis tests immediately.
5. S42 `can_read_clinical` restatement and `auth.users` triggers: security-surface changes; run `/code-review ultra` on those two files and a simulated caregiver session proving reproductive access is refused.
6. Dropping `sms_enabled` before the edge function is redeployed would break notification preference reads.
7. All branches unpushed: a lost worktree loses the work. Push them.
8. Vaccination reminders pause on S43 apply until v2 is signed (zero vaccination records today, so low impact).

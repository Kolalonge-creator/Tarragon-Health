# S75 to S80 build: hand-off status (2026-10-07)

Branch `s75-80/build` (worktree `Tarragonhealth-wt/s75-80`). Based on `origin/main-dev`, then merged with main-dev again after S39, S39b and S39c landed. Nothing is pushed, no PR is open, nothing touched production. Decisions: `docs/plans/S75-S80-cmo-decisions.md`. Plan: `docs/research/S75-S80-review-and-build-plan.md`.

## What was built (all tracks merged into this branch)

| Track | Items |
|---|---|
| P1 | Employer view of PHQ-9 and GAD-7 removed; scan test keeps mental health, reproductive and pregnancy data out of every sponsor surface |
| A | Fee-at-risk proposals frozen and modelled "cost avoided" removed; institution dashboard reads audited; member notice of what a sponsor sees; proof that risk never gates care; per-supporter monthly report share flag (off by default); admin response-time report with data-quality strip |
| D | HbA1c, weight, PHQ-9, GAD-7 outcome measures as an inactive, unsigned `outcome_config` v3 plus day-180 BP; mental health outcomes readable only by the patient and an audited treating clinician |
| B76 | maternal, mental_health, paediatrics competencies; MDCN 12 month re-verification (inert until config v3 is activated); queue second key trigger_severity; task types by configuration; `clinician.task_completed`; richer clinician patient summary |
| B77 | `clinical_follow_ups` closure object with overdue escalation (inert until the CMO signs the times); live red-flag prompt engine behind a new guard that is OFF |
| B78 | Direct paging watchdog (INV-05); `page.unacknowledged`; optional re-page; response-time config and breach path (no published numbers); CMO workload dashboard; own reliability signal |
| C | Reviewed-strings ledger for clinical copy; finance no-float-money scan; directory branch tables and patient "last checked"; automations registry; phone support ticket intake and clinical close guard; AI model price table and cost view |

## What was proven, and what was not

- Whole-tree typecheck: clean. `pnpm test`: 18 of 18 tasks pass. `pnpm lint`: 19 of 19 pass. (Run before the second main-dev merge.)
- Before the second main-dev merge, on a database holding main-dev plus every new migration: **all 191 `.sql` proofs in the manifest passed**, including 15 new proofs written for this work. Real defects found by running them: the response-time config validator accepted a config with a missing key; a new helper counted a Care Coordinator as a clinician; several sabotage steps were vacuous; four existing proofs pinned counts that these additions legitimately changed (updated).
- **After** merging main-dev again (S39 hardening, S39b tied staff reads, S39c) and applying those five migrations forward, a full proof run was started but the local database died partway (Docker became unresponsive). 120 proofs passed before it died. One real failure showed before then: `escalation_auto_assignment_and_reassignment_authority.sql` case 1. It is unknown whether this is caused by our changes, by S39b, or is noise. **Not resolved.**
- `20261007160301_s75_80_review_fixes.sql` (independent review fixes) is written but **has not been applied or proved**: Care Coordinators out of PHQ-9/GAD-7 outcomes and direct follow-up reads; automations default-deny pause; watchdog false-incident fix; `response_time_breaches` closed to direct reads.
- **No clean `supabase db reset` replay was run** (it was refused as destructive of the local database, and Docker then failed). CI's migration replay job is the first true replay. The new migrations were applied in order on top of a restored main-dev baseline instead.

## To finish (in this order)

1. Restart Docker Desktop. Stop other sessions' stacks if memory is tight.
2. In `Tarragonhealth-wt/s75-80`: `npx supabase start` (the local `supabase/config.toml` uses project id `tarragon-s7580`, ports 574xx, and is marked assume-unchanged; do not commit it).
3. Apply `20261007160301_s75_80_review_fixes.sql`, then `./scripts/run-db-proofs.sh` (or loop `psql -f` over the manifest). Triage the `escalation_auto_assignment_and_reassignment_authority` failure first, and re-run `s39_security_catalog.sql`: the reviewer expects its owner-view allowlist to reject `analytics.v_outcome_measure_snapshots` (add it to the allowlist or make the view `security_invoker`).
4. Consider a true `supabase db reset` on a quiet machine, then the whole proof suite.
5. Run `/code-review high` on the diff before any PR (CLAUDE.md), asking explicitly for money, consent and silent-failure classes.
6. Before applying anything to production: the migration `20261007160102` replaces `private.go_live_conditions` and `attest_go_live_condition`. A read-only comparison of key sets with production showed every production key is preserved, but that is not a proof of identical logic. Review that diff by hand.

## Needs a person (not code)

- CMO: sign or activate nothing was done by an agent. Inactive/unsigned versions awaiting you: credentialing config v3, paging config v2, response-time config v1, clinical follow-up times, outcome config v3, plus authoring competency scenarios and titration steps.
- Confirm ledger namespaces (839 baseline strings, all "unreviewed (baseline)"); confirm whether `safety_concern.raised` should exist at all (not emitted, by design).
- Decide the leftover published number "Reply within N hours" on the written-question card (conflicts with S-9).
- Peer session `fix/content-approval-reviewer-role` has uncommitted work on `set_health_education_content_status` that conflicts with decision S-4 (two tiers). The direct-write hole via `health_education_content_write` is unexamined.

## Not built, with reasons

Legacy `is_test` sweep of about 54 analytics RPCs (decision S-17); data-subject-request timers (S39d/S39f own them); AI conversation sampling (S52 PR owns it); enforcing the unenforced go-live guards (would switch off running flows); scribe letters, prescription drafts and edit diff (needs a CMO-approved governed prompt and an INV-11 design); expiring Care Circle report links (no link exists); live prompt UI mounting (consultation room does not host the scribe, OQ-210); second-clinician re-offer (design only).

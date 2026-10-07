# S28 pharmacy collection: handoff for the next Claude Code session

Written 2026-10-07. Read this first, then `docs/design/S28.md` (S28c section), `docs/OPEN-QUESTIONS.md` (OQ-270..277 are the other session's S28, OQ-280..289 are S28c) and `docs/BUILD-PROGRESS.md` (S28c entry).

## What S28 is
Pharmacy partner: the patient sends a prescription to a chosen pharmacy and collects it there. Collection only, no home delivery (Part C.2). The downloadable prescription form stays available for any pharmacy at all times, regardless of pharmacy collection.

## What happened (the short version)
S28 was built twice by two sessions. The other session's S28 migration `20261007120114_s28_pharmacy_collection_and_dispensing` went live in production first. The founder chose "keep the live one, rebuild mine on top".

| PR | What | State |
|---|---|---|
| #990 | First S28 build (duplicate) | merged by mistake, then reverted |
| #1001 | Revert of #990 | merged |
| #993 | Other session's S28 branch | still OPEN, superseded by #1000. The founder must close it (closing was blocked for the agent). Comment: "Superseded by #1000" |
| #1000 | S28c + S28d on top of the live S28 | merged into main-dev, all 10 CI checks green |

## Production state (project `koiplnmbgnqnbywhpjlf`)
- Applied, versions pinned to filenames: `20261007141623_s28c_pharmacy_extras` and `20261007141932_s28d_pharmacy_legacy_cleanup`.
- Verified live: four new functions exist, anon has no execute, `pharmacy_orders.is_test` exists, directory has no delivery columns.
- **The guard is OFF**: `private.pharmacy_collection_on()` returns false (it is the S37 `prescribing_enabled` guard). The live S28 functions are closed to patients and pharmacists until it is switched on.

## What S28c/S28d built
- Repeat supply = a new send (new code, old code dead, only while another supply is allowed).
- Structured pharmacy questions only (six fixed questions, three fixed answers, no free text, no chat). Prescriber screen at `/clinician/pharmacy`.
- Batch and expiry recorded and required by the pharmacist, never described as "verified".
- Caregiver with `manage_pharmacy` can send, choose, withdraw and get a new code (`p_beneficiary` parameter, audited via `private.log_care_access`).
- Withdraw from a pharmacy (`patient_withdraw_from_pharmacy`).
- Go-live guard that blocks until a real pharmacy is approved; new S37 conditions `pharmacy_licence_current`, `pharmacy_rules_confirmed`, `notification_sender_deployed` (built on the s37b definitions of `go_live_conditions` and `attest_go_live_condition`; never restate from the original S37).
- Legacy cleanup: delivery fields removed from the directory view; `is_test` stamped on pharmacy orders, dispenses and dispense flags; five older pharmacist reads now audited; the pharmacy order alert is neutral and in-app, never SMS.
- No prices shown or compared.
- Proof: `packages/db/tests/s28c_pharmacy_extras.sql` (91 checks, 3 sabotages must flip), registered in `ci.manifest`.

## Not done / next steps (in priority order)
1. **Close #993** (founder).
2. **Switch the guard on**, only when ALL are true: a real pharmacy is approved; `pharmacy.collection_rules` (registry key, CMO-owned PROPOSED config) is confirmed; the CMO attests `pharmacy_licence_current`, `pharmacy_rules_confirmed`, `notification_sender_deployed` (via `public.attest_go_live_condition`; the founder is the CMO and asked to do it from chat using the JWT-simulation pattern in memory `feedback_cmo_signing_from_chat`). Never attest a condition that is not true.
3. **Delivery removal** (OQ-281): full removal of the delivery schema, attempts table and logistics screens (about fifteen files). A separate session was started for this; check it before duplicating.
4. **Mobile collection screen** (OQ-277): not built.
5. **Revoke S36h's free-text `pharmacist_flag_prescription`** (OQ-289): still callable through the API.
6. `verify_prescription` audits only matches; non-matching reads are not audited.
7. Full lint was not re-run after the last lint fix (a plain `<a>` replaced with `next/link` in the pharmacist counter). CI passed on #1000, so this is likely fine; confirm.
8. Cleanup: remove worktree `.claude/worktrees/s28` (needs founder go-ahead). Do not touch `s28-pharmacy` (other session).

## Rules and gotchas to keep
- INV-02 (signed prescription never changed by answers), INV-07 neutral notices (lint forbids terms like `prescri*`), INV-08 no SMS, INV-10 audited reads, INV-13 `is_test`, INV-14 go-live guards.
- Narrow trigger bypass flag: `tarragon.rx_route = 'on'` (transaction-local).
- Production migration apply: wrap the file in `begin; ... insert into supabase_migrations.schema_migrations(version,name,statements) values (...); commit;` and run with `npx supabase db query --project-ref koiplnmbgnqnbywhpjlf --linked -f file.sql`. Dry-run first with `begin; ... rollback;`. Needs the founder's explicit go-ahead each time. Check the live ledger for collisions first.
- English only (Pidgin removed). Required CI checks block merges; `main-dev` moves fast, so expect to re-merge `main-dev` into a branch before merging and keep both sides of doc/manifest/registry conflicts.
- Hook requires `/code-review high` on the current diff before push or PR.
- Auto-mode permission checks have blocked `gh pr close`/`gh pr merge` unless the founder says so in chat; do not work around a denial.
- Memory note: `project_s28_two_builds_20261007.md`.

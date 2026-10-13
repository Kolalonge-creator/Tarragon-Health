# P5 credentialing: closeout (2026-10-13)

Branch `s11s15/p5-credentialing`. Nothing was applied, deployed, signed or switched on. Design: `docs/design/S11-S15-credentialing.md`. Research: `docs/research/S11-S15-credentialing.md`.

## Built
- Q14: `primary_source` check kind, `clinician_primary_source_verifications` (append only), `private.psv_satisfied`, `clinician_is_eligible` gate, grandfathering flag (off-only), `record_primary_source_verification`, approval carries the record, staff upload of the MDCN or DataFlow file.
- Q15: `credential_work_items`, `private.credential_recheck_sweep` (cron 05:37 UTC), three `credential_notice` catalogue keys, CMO hub attention line, never suspends.
- Q16: `quality_config` v2 (`new_clinician_full_review_cases = 20`), registry v2 plus drift test, `new_clinician_review` audit reason, `auditReason` mirror.
- Q17: `clinician_licence_verified_on`, `consultation_clinician_licence_verified_on`, `LicenceVerifiedBadge` (+ server and client wrappers) on the doctor profile, care message author line, booking and consultation room.
- OQ-109: `credentialing_work_list`, `record_clinician_credential_dates`, work list forms on the credentialing and "Licences and cover" pages. OQ-108: purge left OFF. OQ-100: plan in the design note (section 9).
- Identity vendor interface, mock, `selectIdentity`, contract tests (no vendor).
- credentialing_config v3 (registry v3), applicant and reviewer screens for the new check, search keywords.

## Reused
S15 state machine and check table, maker-checker, document bucket, `credential_notice`, S20 audit tables, `ReviewedByDoctor` null-gating idea, `selectProvider`, S19/S35 CMO hub reader pattern.

## Tests
DB proofs (live project, inside begin/rollback, nothing left behind): `p5_credentialing_primary_source.sql` 72 checks (new, in `ci.manifest`, sabotage flips); `s15_clinician_credentialing.sql` 183 (seven checks, approval refused without the primary-source check, record carried to the clinician); `s20_quality_and_safety.sql` 215 (new section 2b and sabotage 11b); `s18` fixtures updated (non-test clinicians now carry a record). Jest (new): queue 3, shared 1, notifications 5, integrations 14, web 19. Re-run green on the live DB with this migration emulated: s16, s17, s19, s19b, s21, s22, s22b to d, s30, s35, s35c, s36d, s36e, two_tier_free_red_event_path, escalation and specialist-referral auto-assignment. Failing at baseline too (unrelated, not touched): s18 "backup-only shifts", s22e, two_tier_monthly_followup, s16b. tsc and ESLint clean for web, integrations, queue, notifications, shared.

## Not proven
- The migrations were never applied. To run the proofs against the live database inside a rolled-back transaction I emulated the enum change by swapping the enum type (an artefact only; the real file adds the value, and its second migration runs in a separate transaction). The full manifest was not replayed (no Docker): CI's "Supabase migration replay" is the first true replay.
- The sweep was exercised by direct calls, not by pg_cron. No real DataFlow or MDCN report was handled. The badge is proven by unit tests and the SQL lookup, not in a browser. The identity adapter has no real vendor.
- Other proofs that create non-test clinicians and reach an eligibility check may fail in CI; I ran about 25 related proofs, not all 140 that insert `clinical_staff`. Fix pattern: record a verification (see `s18` `mkdoc`) or mark the fixture `is_test`.

## Apply and deploy order
1. Merge after required CI is green (merge auto-applies migrations).
2. Migration `20261013223014_p5_primary_source_check_kind.sql` (enum value), then `20261013223016_p5_credentialing_primary_source_recheck_review.sql`. Check `list_migrations` for anything newer first.
3. Deploy edge function `send-pending-notifications` (its bundled catalogue gained three keys; nothing else changed). No other function changes.
4. Web deploys with the merge. No secrets, flags or guards change. `credential-recheck-sweep` is scheduled by the migration.
5. Then ops work (below).

## Ops work list (record evidence; nothing is pre-filled)
For each of the two active clinicians (a senior medical officer and the chief medical officer): upload the DataFlow report or MDCN letter under Training and profile; a reviewer other than that person records route, reference and date; enter the licence expiry date (and cover date where required) from the document on the same page. The CMO's own record must be entered by an admin. Until then both stay eligible (grandfathered) and appear on the work list and the CMO hub.

## Proposed open questions
- OQ-P5-1: set `grandfather_ends_on` for the two existing clinicians? (null today = open ended; a date makes them ineligible the day after.) CMO.
- OQ-P5-2: is exempting `is_test` clinicians from the gate acceptable? (needed so QA fixtures work; an admin can set the flag.)
- OQ-P5-3: `clinical_staff_directory` exposes `credential_number` (the folio) to every signed-in user in the organisation, including patients. Q17 says the folio is never shown. Review the view's column list (not changed here: it feeds many screens).
- OQ-P5-4: retention for verification evidence files (FK is RESTRICT; the document purge, still off, must skip them) and for ID document files; DPO and counsel. Also a DPIA before any identity vendor pilot.
- OQ-P5-5: DataFlow may not cover locally trained doctors; is a written MDCN confirmation or an in-person register check acceptable for them? (three routes allowed today.)
- OQ-P5-6: fold the two credential ladders (plan in the design note, CMO to sign the revised policy first).
- OQ-P5-7: does the 20-case early review (Q16) also cover Care Coordinators? (no: they do not take prescribing or red work.)

## Follow-ups
Show the early-review count to the clinician on Training and profile; a hub panel to set `grandfather_ends_on` (a new config version needs a CMO sign-off line); badge on the pharmacy and referral letters if wanted.

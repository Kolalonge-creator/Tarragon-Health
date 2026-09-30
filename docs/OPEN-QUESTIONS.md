# Open questions

Genuine conflicts between `docs/BUILD-SPEC-v5.md` and the live platform, found in S01 (2026-09-30).
Evidence for each is in `docs/RECONCILIATION.md`. **Work on the affected piece stops until answered;
the rest continues.** Answer by editing the "Decision" line (and copy the outcome into `docs/DECISIONS.md`).

Already settled, so not asked again: Platform Credit removal (S01b), WhatsApp removal (S01c), hybrid
clinician model, console split (S01d). See `docs/DECISIONS.md`.

Format: id, blocks (which sessions), options, recommendation, decision.

## A. Safety and invariant conflicts (highest priority)

### OQ-01 Pull queue versus push assignment
- Blocks: S15-S20, S30, S31, S76-S78.
- Conflict: v5 clinicians pull "Next task" and claim it (`clinical_tasks`, `task_claims`, `task_handbacks`, pages, rota, earnings). Live auto-assigns every escalation to a named doctor (`private.auto_assign_escalation`), skipping doctors on leave, and the CMO can rebalance. F-03 says both clinician types feed the same queue.
- Options: (a) one `clinical_tasks` table; employed doctors get tasks pushed to their personal queue, freelancers pull from the shared pool; (b) keep live push for employed doctors and build v5 pull queue separately, joined only at paging; (c) drop push entirely.
- Recommend (a). Reuses the live on-leave logic and one audit trail, and lets `employment_type` select push or pull and salary or per-task earnings. (c) is rejected by F-03.
- Decision:

### OQ-02 Clinician read scope (INV-12) versus `private.is_org_staff()`
- Blocks: S02, S15, S35. Critical: live today.
- Conflict: any active non-patient staff member in an org reads every patient on about 110 tables, including menstrual, pregnancy and contraception rows with no category check. INV-12 allows only patients with an active task, lead assignment or on-call page, plus audited break-glass.
- Options: (a) per-patient assignment RLS everywhere now; (b) phase it: reproductive, mental and sexual health and clinical notes first, the rest later; (c) keep org-wide but add mandatory read logging.
- Recommend (b) plus read logging (OQ-03). A full rewrite touches the highest-leverage security function in the codebase (`CLAUDE.md` warns twice); do it in tiers with simulated-session and sabotage tests. Needs `/code-review ultra`.
- Decision:

### OQ-03 How clinical reads are logged (INV-10)
- Blocks: S02, S35. Live: `audit_log` has only write-trigger rows.
- Options: (a) SECURITY DEFINER read RPCs for the clinician chart that insert into `audit_log`, direct table SELECT only for patients; (b) app-layer logging in server components; (c) pgaudit statement logging.
- Recommend (a), spec-aligned and tamper-resistant. (b) is bypassable, (c) is not patient-addressable.
- Decision:

### OQ-04 Admin global patient search
- Blocks: S36. Spec note on INV-12 says admin must be able to search all patients for support and investigations.
- Options: (a) unrestricted; (b) minimal identity fields only; (c) minimal fields plus a required reason and an `audit_log` row per search.
- Recommend (c). Live `admin` already reads all orgs, and `support_view_sessions` exists to reuse.
- Decision:

### OQ-05 SMS scope (INV-08 versus D-12)
- Blocks: S01c follow-on, S13, S19. Live: Termii sends clinician alert SMS, reminders, payment confirmations, sponsor nudges and patient links; 59 active SMS templates.
- Options: (a) auth verification codes only; (b) verification codes plus clinician paging; (c) also keep content-free patient reminders.
- Recommend (b) per D-12 (spec default is push, in-console alarm and email only for paging, so SMS paging is itself a choice). Deactivate the patient SMS templates, remove the WhatsApp-to-voice remap.
- Decision:

### OQ-06 Notification content naming a condition, drug or result (INV-07)
- Blocks: S13. Live templates say "your diabetes eye screening is due", `{{drug_name}}`, `{{condition_label}}`, "lab result", and "has not logged a reading" sent to a sponsor (reveals a person is on a care plan).
- Options: (a) rewrite all to generic keyed copy and add the lint; (b) exempt in-app inbox text (inside the authenticated app) but not push or email; (c) remove sponsor nudges.
- Recommend (a) for push and email, (b) for in-app bodies only if the spec owner agrees (INV-07 names "in-app previews" so the safe reading is no exemption), and rewrite the sponsor nudge generically.
- Decision:

### OQ-07 Care Vouchers under INV-09 (no stored balance)
- Blocks: S25, S29. Live: `care_vouchers` holds face value and redeemed amount (stored value); 0 rows; `CLAUDE.md` already flags a pending counsel opinion.
- Options: (a) keep; (b) rebuild as order-linked sponsor checkout (sponsor pays a specific order for a named beneficiary); (c) remove.
- Recommend (b), matching the spec's "pay for a loved one" and INV-09, with counsel input before any live use.
- Decision:

### OQ-08 Wellness points convert to spendable value
- Blocks: none urgent. `wellness_points_redemptions.kobo_credited` mints spendable value at 50 kobo per point (2 balance rows live).
- Options: (a) keep points non-monetary, remove the kobo conversion; (b) keep conversion; (c) remove points.
- Recommend (a). Keeps engagement, removes the stored-value path.
- Decision:

### OQ-09 Test-account flag (INV-13)
- Blocks: S02, S37, S38. No `is_test` column exists on any public table; 45 test accounts were hard-deleted 2026-09-30.
- Options: (a) `is_test` on `profiles`, derived elsewhere; (b) explicit column on `profiles`, `clinical_staff`, orders and payments as the spec lists.
- Recommend (b) plus backfill by `@tarragon.test` and a lint that every `analytics.*` and payout view filters it.
- Decision:

### OQ-10 Lab release gate and sensitive positives (INV-03, INV-04)
- Blocks: S27. Live stores lab results as documents plus extracted analyte readings, not as item-level results; no `release_state`, no `sensitive_positive`.
- Options: (a) item-level `lab_results` and `lab_result_items` for partner-portal entry only; (b) add `release_state` to `lab_result_documents` and classify by clinician tagging; (c) both.
- Recommend (c): item-level for partner-entered results, and for uploaded documents force clinician review before patient visibility. Block AI interpretation and audio for any sensitive positive.
- Decision:

### OQ-11 Signature gate on treatment changes (INV-02)
- Blocks: S24. No `prescriptions` or `care_plan_changes` table; `medications_update` gates on tier, not a signature; the patient can UPDATE their own `medications` row.
- Options: (a) new `prescriptions` and `care_plan_changes` tables with signature CHECKs, `medications` becomes a projection; (b) add signature columns and a trigger to `medications`.
- Recommend (a), and tighten the patient column allow-list on `medications`.
- Decision:

### OQ-12 Fertile-window display (Part C.1)
- Blocks: none. Live shows "Fertile window" and temperature-based ovulation confirmation with a disclaimer. C.1 allows conception planning labelled "not contraception".
- Options: (a) keep with disclaimer; (b) hide fertile window, keep period prediction; (c) opt-in conception-planning mode, off by default, disclaimer literally "not contraception".
- Recommend (c). Needs the reproductive-health category-scoped access model, not a copied RLS shape.
- Decision:

### OQ-13 On-call roster and paging (INV-05)
- Blocks: S19. Live has no roster or page record; red alerts go through the notification outbox (cron) and `backup_clinician_id`.
- Options: (a) roster plus page table with ack timer and direct invoke from the red trigger; (b) reuse `backup_clinician_id`; (c) third-party pager.
- Recommend (a), channel per OQ-05.
- Decision:

### OQ-14 Vitals threshold versioning (INV-16)
- Blocks: S11. `private.classify_*_level` hard-codes thresholds; `clinician_alerts` carries no version.
- Options: (a) versioned config table read by the classifiers plus `classifier_version` on alerts; (b) version-stamp function names; (c) leave.
- Recommend (a). Must not alter any live threshold value; load current values as version 1.
- Decision:

### OQ-15 Offline red rules and the `packages/clinical` location (INV-01, INV-06)
- Blocks: S11, S12. The spec's `packages/clinical` does not exist; the engine is `packages/symptom-triage-engine` and BP/glucose rules are duplicated in mobile TS; pulse, SpO2, temperature and symptom rules have no on-device copy.
- Options: (a) create `packages/clinical` as the single pure module consumed by web, mobile and edge; (b) rename `symptom-triage-engine`; (c) leave.
- Recommend (a) re-exporting the engine first, then porting the classifiers, with a test that no LLM import is reachable.
- Decision:

### OQ-16 Dormant pharmacy-delivery and therapy schema (Part C.2)
- Blocks: none. `pharmacy_order_delivery_attempts`, `logistics_partners`, `therapy_sessions` exist with 0 rows.
- Options: (a) drop now; (b) leave dormant until a removal batch; (c) keep therapy as a referral-only directory.
- Recommend (b) then drop with the count-first pattern from `CLAUDE.md`; keep the address form only if lab home collection needs it.
- Decision:

## B. Structure and platform conflicts

### OQ-17 Repo layout names
- Blocks: S02 onward (where new code lands).
- Conflict: spec has `apps/patient`, `apps/console`, `packages/{shared,clinical,queue,i18n,ui}`. Live has `apps/web` (marketing, patient web and staff areas), `apps/mobile`, and other packages. F-04 already fixes `apps/console` (S01d) and `apps/mobile` keeping its name.
- Options: confirm the mapping patient = `apps/mobile`, console = `apps/console` after S01d; create `packages/queue` and `packages/clinical` when their sessions start.
- Recommend exactly that.
- Decision:

### OQ-18 Where configuration and go-live guards live
- Blocks: S37, S14.
- Conflict: spec uses one `app_config` table. Live uses `platform_modules` (go-live guard), `feature_flags`, `escalation_slas`, `triage_protocols`, `cv_risk_config`. S01 added a code-side PROPOSED registry only.
- Options: (a) new `app_config` as the spec says; (b) reuse `platform_modules` and `feature_flags`, add versioned rows per domain; (c) registry in code only.
- Recommend (b) for guards and per-domain versioned tables for values, and move reads of the S01 registry to the database when each value's owning session lands.
- Decision:

### OQ-19 i18n approach
- Blocks: S03 onward (every new string).
- Conflict: live `packages/shared/src/ui-language.ts` is keyed by English source string, wayfinding only, with a deliberate rule that no clinical, emergency, dosing or consent string is translated to Pidgin until a clinician signs it. Spec wants stable-key catalogues in `packages/i18n` including audio-linked clinical content.
- S01 created `@tarragon/i18n` (key-based, parity test, seeded with 7 neutral keys) and left the old file alone.
- Options: (a) new strings go to `@tarragon/i18n`, old dictionary migrates later; (b) keep extending the old dictionary only.
- Recommend (a), with the live clinical-copy boundary kept: a clinical Pidgin string needs clinician sign-off and a native-speaker review flag first.
- Decision:

### OQ-20 Sentry on mobile and Edge Functions, secret scanning
- Blocks: none urgent. Spec wants Sentry in app, console and functions. `apps/web` and `services/ml` have it; `apps/mobile` and all 7 Edge Functions do not; CI has no secret-scanning step.
- Options: do each as its own change: mobile (needs an EAS build and `runtimeVersion` bump), Edge Functions (each redeploy, edge-drift job), a gitleaks CI step.
- Recommend gitleaks now, functions in the session that touches each function, mobile with the next native build.
- Decision:

### OQ-21 Phone verification through the Supabase Auth Send SMS hook
- Blocks: S03. Live has no `[auth.hook.send_sms]`; Termii sends only through `send-pending-notifications`; `CLAUDE.md` says Termii sender approval is off the near-term plan.
- Options: (a) build the hook and Termii OTP (spec); (b) keep Supabase default SMS provider for now.
- Recommend (a) only when the sender ID is approved; until then S03 builds the hook behind a provider interface with a mock.
- Decision:

### OQ-22 Video provider interface
- Blocks: S21. Live is Zoom, hard-wired (`apps/web/src/lib/zoom`, `zoom-webhook`, masked calls); spec wants a `VideoProvider` interface with an audio-only fallback and Daily, Agora or 100ms candidates (D-07).
- Options: (a) interface with a Zoom adapter and a mock, pick a second vendor later; (b) replace Zoom.
- Recommend (a).
- Decision:

### OQ-23 Table shape policy
- Blocks: S05-S09, S25, S27.
- Conflict: for most Section 4 tables live has a differently shaped equivalent (`vitals_readings`, `medication_logs`, `patient_consents`, per-domain purchase tables, `lab_result_documents`).
- Options: (a) live tables win, add adapter views or RPCs where v5's API shape is needed; (b) create the v5 tables and migrate; (c) mixed, per the recommendation in `docs/RECONCILIATION.md` section 6.2.
- Recommend (c): live wins for identity, health record, commerce, notifications and audit; v5 wins for the outbox, pages, rota, credentialing, earnings, scribe consent, proxy setup, outcome snapshots, `care_plan_changes` and `triage_events`.
- Decision:

### OQ-24 Role and naming collisions
- Blocks: S02, S15.
- Conflict: v5 `ops` has no single live role (care_coordinator, admin, lab_liaison, finance share it); v5 `clinicians.status` (suspended, offboarded) needs a column, live has only `active`; v5 "tier 1/2" (credentialing level) is not live `doctor_tier` (four-step seniority); live `public.referrals` is growth referrals while v5 `referrals` means `specialist_referrals`.
- Options: (a) keep the live account-role rule (never split by tier), add a credentialing-level column separate from `doctor_tier`, add `ops` as capability gates not a role; (b) add an `ops` account role.
- Recommend (a); it keeps `CLAUDE.md`'s "never re-split the account role" rule and avoids a second "Tier N" vocabulary.
- Decision:

### OQ-25 `audit_log` shape
- Blocks: S02, S39. Live is append-only by BEFORE UPDATE and DELETE triggers, not revoked grants; TRUNCATE is still granted to `service_role` and `postgres`; it lacks `subject_patient_id` and `ip`.
- Options: (a) add the two columns and revoke TRUNCATE; (b) leave it.
- Recommend (a), as part of the INV-10 work (OQ-03).
- Decision:

### OQ-26 Running the real migration-drift check
- Blocks: none. The repo's drift script needs `SUPABASE_ACCESS_TOKEN`, which was not available, so the exact full diff was bounded (at least 119 live rows without a same-version file, at least 107 files without a live row), not enumerated. Loss-risk classes are clean (UNTRACED 0, LOCAL-NOT-APPLIED 0, UNPUSHED 0).
- Options: the founder or CI runs the script with a token and pastes the result; or accept the bound.
- Recommend running it once in CI (release-integrity already does) before S02's first migration.
- Decision:

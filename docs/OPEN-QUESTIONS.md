# Open questions

Genuine conflicts between `docs/BUILD-SPEC-v5.md` and the live platform, found in S01 (2026-09-30).
Evidence for each is in `docs/RECONCILIATION.md`. **All 26 were answered 2026-09-30 (see each Decision line; mirrored in `docs/DECISIONS.md`).** Answer by editing the "Decision" line (and copy the outcome into `docs/DECISIONS.md`).

Already settled, so not asked again: Platform Credit removal (S01b), WhatsApp removal (S01c), hybrid
clinician model, console split (S01d). See `docs/DECISIONS.md`.

Format: id, blocks (which sessions), options, recommendation, decision.

## A. Safety and invariant conflicts (highest priority)

### OQ-01 Pull queue versus push assignment
- Blocks: S15-S20, S30, S31, S76-S78.
- Conflict: v5 clinicians pull "Next task" and claim it (`clinical_tasks`, `task_claims`, `task_handbacks`, pages, rota, earnings). Live auto-assigns every escalation to a named doctor (`private.auto_assign_escalation`), skipping doctors on leave, and the CMO can rebalance. F-03 says both clinician types feed the same queue.
- Options: (a) one `clinical_tasks` table; employed doctors get tasks pushed to their personal queue, freelancers pull from the shared pool; (b) keep live push for employed doctors and build v5 pull queue separately, joined only at paging; (c) drop push entirely.
- Recommend (a). Reuses the live on-leave logic and one audit trail, and lets `employment_type` select push or pull and salary or per-task earnings. (c) is rejected by F-03.
- Decision (founder, 2026-09-30): One `clinical_tasks` table; employed doctors get tasks pushed, freelancers pull from the shared pool; `employment_type` selects salary vs per-task earnings.

### OQ-02 Clinician read scope (INV-12) versus `private.is_org_staff()`
- Blocks: S02, S15, S35. Critical: live today.
- Conflict: any active non-patient staff member in an org reads every patient on about 110 tables, including menstrual, pregnancy and contraception rows with no category check. INV-12 allows only patients with an active task, lead assignment or on-call page, plus audited break-glass.
- Options: (a) per-patient assignment RLS everywhere now; (b) phase it: reproductive, mental and sexual health and clinical notes first, the rest later; (c) keep org-wide but add mandatory read logging.
- Recommend (b) plus read logging (OQ-03). A full rewrite touches the highest-leverage security function in the codebase (`CLAUDE.md` warns twice); do it in tiers with simulated-session and sabotage tests. Needs `/code-review ultra`.
- Decision (founder, 2026-09-30): All doctors are qualified for all cases (single clinical pool), but read access is to TIED patients only (active task, assignment or on-call page) plus audited break-glass with a reason that alerts the CMO. Founder remark 2026-09-30: "we only have a single tier of doctor"; live `doctor_tier` still has four values, Resolved same day by F-05: doctor tiers collapse to one (Senior Medical Officer level) plus the CMO.

### OQ-03 How clinical reads are logged (INV-10)
- Blocks: S02, S35. Live: `audit_log` has only write-trigger rows.
- Options: (a) SECURITY DEFINER read RPCs for the clinician chart that insert into `audit_log`, direct table SELECT only for patients; (b) app-layer logging in server components; (c) pgaudit statement logging.
- Recommend (a), spec-aligned and tamper-resistant. (b) is bypassable, (c) is not patient-addressable.
- Decision (founder, 2026-09-30): SECURITY DEFINER read RPCs for clinician chart views that write `audit_log`; direct table SELECT for patients only.

### OQ-04 Admin global patient search
- Blocks: S36. Spec note on INV-12 says admin must be able to search all patients for support and investigations.
- Options: (a) unrestricted; (b) minimal identity fields only; (c) minimal fields plus a required reason and an `audit_log` row per search.
- Recommend (c). Live `admin` already reads all orgs, and `support_view_sessions` exists to reuse.
- Decision (founder, 2026-09-30): Minimal identity fields in search; opening a record requires a typed reason and writes an audit row.

### OQ-05 SMS scope (INV-08 versus D-12)
- Blocks: S01c follow-on, S13, S19. Live: Termii sends clinician alert SMS, reminders, payment confirmations, sponsor nudges and patient links; 59 active SMS templates.
- Options: (a) auth verification codes only; (b) verification codes plus clinician paging; (c) also keep content-free patient reminders.
- Recommend (b) per D-12 (spec default is push, in-console alarm and email only for paging, so SMS paging is itself a choice). Deactivate the patient SMS templates, remove the WhatsApp-to-voice remap.
- Decision (founder, 2026-09-30): Verification codes plus clinician paging (D-12). Deactivate patient SMS templates; remove the WhatsApp-to-voice remap.

### OQ-06 Notification content naming a condition, drug or result (INV-07)
- Blocks: S13. Live templates say "your diabetes eye screening is due", `{{drug_name}}`, `{{condition_label}}`, "lab result", and "has not logged a reading" sent to a sponsor (reveals a person is on a care plan).
- Options: (a) rewrite all to generic keyed copy and add the lint; (b) exempt in-app inbox text (inside the authenticated app) but not push or email; (c) remove sponsor nudges.
- Recommend (a) for push and email, (b) for in-app bodies only if the spec owner agrees (INV-07 names "in-app previews" so the safe reading is no exemption), and rewrite the sponsor nudge generically.
- Decision (founder, 2026-09-30): Generic copy everywhere (push, email, SMS, in-app) plus a lint; rewrite the sponsor nudge generically.

### OQ-07 Care Vouchers under INV-09 (no stored balance)
- Blocks: S25, S29. Live: `care_vouchers` holds face value and redeemed amount (stored value); 0 rows; `CLAUDE.md` already flags a pending counsel opinion.
- Options: (a) keep; (b) rebuild as order-linked sponsor checkout (sponsor pays a specific order for a named beneficiary); (c) remove.
- Recommend (b), matching the spec's "pay for a loved one" and INV-09, with counsel input before any live use.
- Decision (founder, 2026-09-30): Rebuild as order-linked sponsor checkout (no standing balance); get counsel input before live use.

### OQ-08 Wellness points convert to spendable value
- Blocks: none urgent. `wellness_points_redemptions.kobo_credited` mints spendable value at 50 kobo per point (2 balance rows live).
- Options: (a) keep points non-monetary, remove the kobo conversion; (b) keep conversion; (c) remove points.
- Recommend (a). Keeps engagement, removes the stored-value path.
- Decision (founder, 2026-09-30): Keep points as non-monetary; remove the kobo conversion.

### OQ-09 Test-account flag (INV-13)
- Blocks: S02, S37, S38. No `is_test` column exists on any public table; 45 test accounts were hard-deleted 2026-09-30.
- Options: (a) `is_test` on `profiles`, derived elsewhere; (b) explicit column on `profiles`, `clinical_staff`, orders and payments as the spec lists.
- Recommend (b) plus backfill by `@tarragon.test` and a lint that every `analytics.*` and payout view filters it.
- Decision (founder, 2026-09-30): Explicit `is_test` column on profiles, clinical_staff, orders and payments; backfill by @tarragon.test; lint on analytics and payout views.

### OQ-10 Lab release gate and sensitive positives (INV-03, INV-04)
- Blocks: S27. Live stores lab results as documents plus extracted analyte readings, not as item-level results; no `release_state`, no `sensitive_positive`.
- Options: (a) item-level `lab_results` and `lab_result_items` for partner-portal entry only; (b) add `release_state` to `lab_result_documents` and classify by clinician tagging; (c) both.
- Recommend (c): item-level for partner-entered results, and for uploaded documents force clinician review before patient visibility. Block AI interpretation and audio for any sensitive positive.
- Decision (founder, 2026-09-30): Both paths: item-level results with release_state and sensitive_positive for partner entry; uploaded documents forced through clinician review; block AI and audio for sensitive positives.

### OQ-11 Signature gate on treatment changes (INV-02)
- Blocks: S24. No `prescriptions` or `care_plan_changes` table; `medications_update` gates on tier, not a signature; the patient can UPDATE their own `medications` row.
- Options: (a) new `prescriptions` and `care_plan_changes` tables with signature CHECKs, `medications` becomes a projection; (b) add signature columns and a trigger to `medications`.
- Recommend (a), and tighten the patient column allow-list on `medications`.
- Decision (founder, 2026-09-30): New `prescriptions` and `care_plan_changes` tables with signature CHECKs; `medications` becomes a projection; tighten patient column allow-list.

### OQ-12 Fertile-window display (Part C.1)
- Blocks: none. Live shows "Fertile window" and temperature-based ovulation confirmation with a disclaimer. C.1 allows conception planning labelled "not contraception".
- Options: (a) keep with disclaimer; (b) hide fertile window, keep period prediction; (c) opt-in conception-planning mode, off by default, disclaimer literally "not contraception".
- Recommend (c). Needs the reproductive-health category-scoped access model, not a copied RLS shape.
- Decision (founder, 2026-09-30): Opt-in conception-planning mode, off by default, disclaimer literally "not contraception".

### OQ-13 On-call roster and paging (INV-05)
- Blocks: S19. Live has no roster or page record; red alerts go through the notification outbox (cron) and `backup_clinician_id`.
- Options: (a) roster plus page table with ack timer and direct invoke from the red trigger; (b) reuse `backup_clinician_id`; (c) third-party pager.
- Recommend (a), channel per OQ-05.
- Decision (founder, 2026-09-30): On-call roster plus page table with ack timer; channel per OQ-05.

### OQ-14 Vitals threshold versioning (INV-16)
- Blocks: S11. `private.classify_*_level` hard-codes thresholds; `clinician_alerts` carries no version.
- Options: (a) versioned config table read by the classifiers plus `classifier_version` on alerts; (b) version-stamp function names; (c) leave.
- Recommend (a). Must not alter any live threshold value; load current values as version 1.
- Decision (founder, 2026-09-30): Versioned config table read by the classifiers plus `classifier_version` on alerts; current live values load unchanged as version 1.

### OQ-15 Offline red rules and the `packages/clinical` location (INV-01, INV-06)
- Blocks: S11, S12. The spec's `packages/clinical` does not exist; the engine is `packages/symptom-triage-engine` and BP/glucose rules are duplicated in mobile TS; pulse, SpO2, temperature and symptom rules have no on-device copy.
- Options: (a) create `packages/clinical` as the single pure module consumed by web, mobile and edge; (b) rename `symptom-triage-engine`; (c) leave.
- Recommend (a) re-exporting the engine first, then porting the classifiers, with a test that no LLM import is reachable.
- Decision (founder, 2026-09-30): Create `packages/clinical`: re-export the triage engine first, then port remaining classifiers; test that no LLM import is reachable.

### OQ-16 Dormant pharmacy-delivery and therapy schema (Part C.2)
- Blocks: none. `pharmacy_order_delivery_attempts`, `logistics_partners`, `therapy_sessions` exist with 0 rows.
- Options: (a) drop now; (b) leave dormant until a removal batch; (c) keep therapy as a referral-only directory.
- Recommend (b) then drop with the count-first pattern from `CLAUDE.md`; keep the address form only if lab home collection needs it.
- Decision (founder, 2026-09-30): Leave dormant; drop in a later removal batch using the count-first pattern.

## B. Structure and platform conflicts

### OQ-17 Repo layout names
- Blocks: S02 onward (where new code lands).
- Conflict: spec has `apps/patient`, `apps/console`, `packages/{shared,clinical,queue,i18n,ui}`. Live has `apps/web` (marketing, patient web and staff areas), `apps/mobile`, and other packages. F-04 already fixes `apps/console` (S01d) and `apps/mobile` keeping its name.
- Options: confirm the mapping patient = `apps/mobile`, console = `apps/console` after S01d; create `packages/queue` and `packages/clinical` when their sessions start.
- Recommend exactly that.
- Decision (founder, 2026-09-30): Mobile stays `apps/mobile`; console is `apps/console` after S01d; create `packages/queue` and `packages/clinical` when their sessions start.

### OQ-18 Where configuration and go-live guards live
- Blocks: S37, S14.
- Conflict: spec uses one `app_config` table. Live uses `platform_modules` (go-live guard), `feature_flags`, `escalation_slas`, `triage_protocols`, `cv_risk_config`. S01 added a code-side PROPOSED registry only.
- Options: (a) new `app_config` as the spec says; (b) reuse `platform_modules` and `feature_flags`, add versioned rows per domain; (c) registry in code only.
- Recommend (b) for guards and per-domain versioned tables for values, and move reads of the S01 registry to the database when each value's owning session lands.
- Decision (founder, 2026-09-30): Reuse `platform_modules` and per-domain versioned tables; no `app_config`; move S01 registry reads into the database as each owning session lands.

### OQ-19 i18n approach
- Blocks: S03 onward (every new string).
- Conflict: live `packages/shared/src/ui-language.ts` is keyed by English source string, wayfinding only, with a deliberate rule that no clinical, emergency, dosing or consent string is translated to Pidgin until a clinician signs it. Spec wants stable-key catalogues in `packages/i18n` including audio-linked clinical content.
- S01 created `@tarragon/i18n` (key-based, parity test, seeded with 7 neutral keys) and left the old file alone.
- Options: (a) new strings go to `@tarragon/i18n`, old dictionary migrates later; (b) keep extending the old dictionary only.
- Recommend (a), with the live clinical-copy boundary kept: a clinical Pidgin string needs clinician sign-off and a native-speaker review flag first.
- Decision (founder, 2026-09-30): New strings go to `@tarragon/i18n`; old dictionary migrates later; clinical Pidgin needs clinician sign-off and native review first.

### OQ-20 Sentry on mobile and Edge Functions, secret scanning
- Blocks: none urgent. Spec wants Sentry in app, console and functions. `apps/web` and `services/ml` have it; `apps/mobile` and all 7 Edge Functions do not; CI has no secret-scanning step.
- Options: do each as its own change: mobile (needs an EAS build and `runtimeVersion` bump), Edge Functions (each redeploy, edge-drift job), a gitleaks CI step.
- Recommend gitleaks now, functions in the session that touches each function, mobile with the next native build.
- Decision (founder, 2026-09-30): Add gitleaks secret scanning to CI now; Sentry on each Edge Function when that function is next touched; mobile with the next native build.

### OQ-21 Phone verification through the Supabase Auth Send SMS hook
- Blocks: S03. Live has no `[auth.hook.send_sms]`; Termii sends only through `send-pending-notifications`; `CLAUDE.md` says Termii sender approval is off the near-term plan.
- Options: (a) build the hook and Termii OTP (spec); (b) keep Supabase default SMS provider for now.
- Recommend (a) only when the sender ID is approved; until then S03 builds the hook behind a provider interface with a mock.
- Decision (founder, 2026-09-30): Build the Send SMS hook behind a provider interface with a mock; go live on Termii only when the sender ID is approved.

### OQ-22 Video provider interface
- Blocks: S21. Live is Zoom, hard-wired (`apps/web/src/lib/zoom`, `zoom-webhook`, masked calls); spec wants a `VideoProvider` interface with an audio-only fallback and Daily, Agora or 100ms candidates (D-07).
- Options: (a) interface with a Zoom adapter and a mock, pick a second vendor later; (b) replace Zoom.
- Recommend (a).
- Decision (founder, 2026-09-30): `VideoProvider` interface with a Zoom adapter and a mock; pick a second vendor later.

### OQ-23 Table shape policy
- Blocks: S05-S09, S25, S27.
- Conflict: for most Section 4 tables live has a differently shaped equivalent (`vitals_readings`, `medication_logs`, `patient_consents`, per-domain purchase tables, `lab_result_documents`).
- Options: (a) live tables win, add adapter views or RPCs where v5's API shape is needed; (b) create the v5 tables and migrate; (c) mixed, per the recommendation in `docs/RECONCILIATION.md` section 6.2.
- Recommend (c): live wins for identity, health record, commerce, notifications and audit; v5 wins for the outbox, pages, rota, credentialing, earnings, scribe consent, proxy setup, outcome snapshots, `care_plan_changes` and `triage_events`.
- Decision (founder, 2026-09-30): Mixed per the audit: live wins for identity, health record, commerce, notifications, audit; v5 wins for outbox, pages, rota, credentialing, earnings, scribe consent, proxy setup, outcome snapshots, care_plan_changes, triage_events.

### OQ-24 Role and naming collisions
- Blocks: S02, S15.
- Conflict: v5 `ops` has no single live role (care_coordinator, admin, lab_liaison, finance share it); v5 `clinicians.status` (suspended, offboarded) needs a column, live has only `active`; v5 "tier 1/2" (credentialing level) is not live `doctor_tier` (four-step seniority); live `public.referrals` is growth referrals while v5 `referrals` means `specialist_referrals`.
- Options: (a) keep the live account-role rule (never split by tier), add a credentialing-level column separate from `doctor_tier`, add `ops` as capability gates not a role; (b) add an `ops` account role.
- Recommend (a); it keeps `CLAUDE.md`'s "never re-split the account role" rule and avoids a second "Tier N" vocabulary.
- Decision (founder, 2026-09-30): Keep the account-role rule; no `ops` role; add a separate credentialing-level column (not `doctor_tier`) and a clinician status column.

### OQ-25 `audit_log` shape
- Blocks: S02, S39. Live is append-only by BEFORE UPDATE and DELETE triggers, not revoked grants; TRUNCATE is still granted to `service_role` and `postgres`; it lacks `subject_patient_id` and `ip`.
- Options: (a) add the two columns and revoke TRUNCATE; (b) leave it.
- Recommend (a), as part of the INV-10 work (OQ-03).
- Decision (founder, 2026-09-30): Add `subject_patient_id` and `ip`; revoke TRUNCATE from service_role and postgres, as part of the OQ-03 work.

### OQ-26 Running the real migration-drift check
- Blocks: none. The repo's drift script needs `SUPABASE_ACCESS_TOKEN`, which was not available, so the exact full diff was bounded (at least 119 live rows without a same-version file, at least 107 files without a live row), not enumerated. Loss-risk classes are clean (UNTRACED 0, LOCAL-NOT-APPLIED 0, UNPUSHED 0).
- Options: the founder or CI runs the script with a token and pastes the result; or accept the bound.
- Recommend running it once in CI (release-integrity already does) before S02's first migration.
- Decision (founder, 2026-09-30): Run the real drift script once in CI (release-integrity) before S02's first migration.

## C. Follow-ups created by decision F-05 (doctor tiers collapse to one plus CMO)

### OQ-27 Care Coordinator and the collapse migration
- Blocks: the tier-removal migration, S15.
- Assumption: the non-clinical Care Coordinator account stays as it is; only `medical_officer` is folded into `senior_medical_officer`.
- Options: (a) keep Care Coordinator unchanged; (b) remove it too (doctors do all coordination, matching the 2026-09-18 "direct doctor to patient" principle); (c) keep it but dormant until volume needs it.
- Recommend (a) or (c): removing it is a separate staffing decision and the repo's own principle already treats coordinators as a later scaling lever, not a gate.
- Decision (founder, 2026-09-30): Keep the Care Coordinator account but dormant until patient volume needs it. No migration now; never a gate between patient and doctor.

### OQ-28 Leftover test balance on GL account 2100 (customer funds)
- Raised by S01b (Platform Credit removal). Blocks: nothing in S01b; needs a finance decision.
- Finding: every Platform Credit balance and ledger row is 0, but general-ledger account 2100 "customer funds" still nets to a 250,000 kobo (NGN 2,500) credit. It comes from the 2026-09-17 E2E test run: a 1,000,000 kobo test top-up (entry 289), a 750,000 spend (entry 290, later reversed by adjustment 370) and its corrected re-post (entry 371). Account 2600 "Promotional credit outstanding" nets to 0. The period (2026-09) is still open. No real money is involved (Paystack test mode).
- Options: (a) post one dated adjustment entry that clears the 250,000 against an appropriate test-clean-up account, with a memo naming entries 289 to 371; (b) leave it and footnote it in the period close; (c) reverse the whole test set (entries 289, 290, 298, 299, 303, 304, 371) so the period shows no trace.
- Recommend (a): posted entries are append-only, (c) rewrites history the audit trail should keep, (b) leaves a phantom liability on a balance sheet.
- Decision:

### OQ-29 WhatsApp hop in the CMO-signed escalation ladder (raised by S01c)
- Blocks: nothing in S01c (a compatibility shim keeps alerting whole); needs CMO sign-off to finish properly.
- Finding: `escalation_slas` v8 (signed 2026-09-05) gives every urgent pathway the ladder `push, whatsapp_nudge` and every emergency pathway `push, whatsapp, sms`. WhatsApp has delivered nothing, ever (77 attempts, 68 failed, 9 suppressed, 0 sent), so those ladders are effectively push-only today. Removing WhatsApp without a replacement would shorten every urgent ladder to a single hop. Live recipients: 2 clinicians (1 has an active push subscription, both have a real email), 1 admin (email, no push).
- What S01c did, without editing the signed config: `private.normalize_escalation_channels` now reads a `whatsapp` or `whatsapp_nudge` token as `email` (founder decision D-12: paging is push, in-console alarm and email), and the built-in fallback ladder is `push, email, sms`. The in-console alarm already exists independently (the `clinician_alerts` Priority 1 row, plus the admin alarm when a ladder is exhausted).
- Options: (a) keep the shim and have the CMO sign a v9 that names `email` explicitly so the signed text matches behaviour; (b) sign v9 with a longer ladder (push, email, in-console alarm, then ops phone); (c) leave the shim as the permanent mapping.
- Recommend (a) now, (b) when D-12's ops-escalation step is built (S19). Not signed or seeded by the agent; signing is the CMO's act.
- Decision (founder, 2026-09-30): Keep the compatibility shim (a whatsapp token in the signed ladder reads as email); the CMO publishes escalation_slas v9 naming email explicitly. Not signed or seeded by the agent.

### OQ-30 Emergency-contact alerts have no working channel (raised by S01c)
- `private.notify_unacknowledged_emergencies` sent a patient's emergency contact both an SMS and a WhatsApp message. The WhatsApp half is removed. The SMS half has failed every time live (66 of 71 sms failures: "recipient has no phone number on file", and sms is deprioritised platform-wide with no provider approval), and OQ-05 limits SMS to verification codes and clinician paging, which does not include a patient's next of kin.
- So after S01c a patient in an unacknowledged emergency can still reach their own care team (in-app safety net, clinician alert) but their listed emergency contact is not reliably told by any channel.
- Options: (a) keep the contact SMS as a named exception to OQ-05 for real emergencies, to switch on when a sender ID is approved; (b) drop contact notification and rely on the care team calling the contact; (c) in-app invite to the contact once they have an account.
- Recommend (a), plus (b) as the working procedure today.
- Decision (founder, 2026-09-30): Keep the emergency-contact SMS as a named exception to OQ-05 for real emergencies, switched on once a sender ID is approved (OQ-21); until then the care team phones the contact.

### OQ-31 Legal and consent text that still names WhatsApp (raised by S01c)
- Finding: 12 rows in `consent_versions` (terms of service and consent wording, versions from 2026-07-29 to 2026-09-02) still say things like "WhatsApp is notification-only" and list WhatsApp (and Stripe, already removed) among third-party services. Consent and terms versions are immutable legal records patients agreed to, so S01c did not edit them. The newest active versions therefore describe a channel that no longer exists.
- Options: (a) publish new terms and consent versions that drop WhatsApp (and Stripe), with legal review, and decide whether existing users must re-accept or are only notified; (b) leave the current versions until the next planned legal refresh; (c) publish the new versions but do not require re-acceptance because the change removes a data flow rather than adding one.
- Recommend (c) via (a)'s review: removing a channel reduces processing, so a notice rather than a forced re-consent is the likely outcome, but that is counsel's call. Also update the vendor register row "WhatsApp Cloud API (Meta)" in `vendor_assessments` to retired once counsel agrees.
- Decision (founder, 2026-09-30): Publish new terms and consent versions without WhatsApp and Stripe after counsel review; notify users rather than forcing re-acceptance, since a data flow is being removed. Retire the WhatsApp vendor register row once counsel agrees.

### OQ-32 Remaining SMS to patients (raised by S01c, implements OQ-05)
- OQ-05 limited SMS to verification codes and clinician paging. S01c found these remaining patient-facing SMS paths and left them as they are (they were not WhatsApp): the routine push-failure fallback in `send-pending-notifications`, the patient join-link SMS (`send-patient-link`), the broadcast composer's SMS option, the patient-side emergency-contact SMS, and 59 active SMS templates. Live SMS has never delivered (71 failed, 0 sent), so nothing is lost by finishing OQ-05, but the code still allows it.
- Options: (a) remove all patient SMS now in one follow-up change; (b) leave until a sender ID is approved (OQ-21); (c) remove only the templates that name clinical terms (OQ-06) first.
- Recommend (a), as its own session: it is the same shape as this one and the data says it is safe.
- Decision (founder, 2026-09-30): Remove all patient-facing SMS in its own session (count first, then remove), as the follow-on to OQ-05.

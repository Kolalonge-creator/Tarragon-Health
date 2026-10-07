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
- Superseded (2026-10-06): The Pidgin part is moot: Pidgin was removed 2026-10-06 (D-14). The rest of the i18n approach stands (English strings in `@tarragon/i18n`).

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

## D. Raised by S01d (staff console split)

### OQ-33 `lab-liaison` and `lab-partner` cannot move until the lab result stack is a package (raised by S01d)
- Finding: both areas call `lib/lab-results/actions.ts` (the server actions patients and partners both use to upload and replace lab results). That file imports `lib/lab-reports/extraction-actions`, the AI extraction path, which imports the whole `lib/ai-governance` module (registry, audit, kill switch). The area itself is 2 to 7 files; its real dependency closure is about 25 more files, and one of them is a registered AI call site.
- Why it matters: moving an AI call site changes where `runGovernedAi()` and the registry run from. Nothing in governance may be weakened, and the call site must keep consulting `public.ai_runtime_config()`. That is a change that needs its own review, not a side effect of an area move.
- Options: (a) move `lib/ai-governance`, `lib/lab-reports` and `lib/lab-results` into `@tarragon/lab` and `@tarragon/ai-governance` packages in a dedicated step with the AI governance checks re-run; (b) leave both areas in `apps/web` until the lab work in the v5 sessions rebuilds them; (c) cut the two areas' dependency on extraction (they only need upload and status, not AI summarising) by splitting the actions file.
- Recommend (c) if the split is clean, otherwise (a). Both areas currently have zero accounts (0 `lab_liaison`, 0 `lab_partner` profiles live), so there is no urgency.
- Decision:

### OQ-34 Console sign-in is email and password only (raised by S01d)
- Finding: `apps/console` supports email and password plus the TOTP step-up. It has no phone OTP path and no password reset of its own; "Forgot your password?" links to the main app's reset page (from `WEB_APP_URL`), after which the person returns to the console.
- Question: do any staff roles sign in by phone OTP today, and do you want a reset flow on the console host itself? Live check needed on how existing staff accounts authenticate.
- Options: (a) keep as is (recommended: staff accounts are admin-provisioned with email and password); (b) add phone OTP; (c) add a reset flow on the console.
- Decision:

### OQ-35 Console has no Sentry yet (raised by S01d)
- The spec wants Sentry in the console. `apps/web`'s PII scrubber (`lib/sentry/scrub-pii.ts`) must be shared, not copied. Not done in S01d because it needs a DSN decision (same project as web or separate) and a shared observability package.
- Options: (a) new `@tarragon/observability` package (scrub, run-best-effort), separate Sentry project for the console (recommended: a console error must never mix into the patient project's alerts); (b) same project, tagged by app.
- Decision:

### OQ-36 Vercel project, domain and DNS for the console (raised by S01d, needs your action)
- Nothing has been created. Needed: a second Vercel project for `apps/console` (root directory `apps/console`, not `main-dev`-coupled to the web project's settings), the `console.` DNS record, the env vars listed in `apps/console/.env.example`, and `CONSOLE_BASE_URL` on the web project (runtime; setting it switches the redirects on).
- Rollout order per area (the dormant `ngo` area is safe in one step; every live area needs all four): (1) deploy the console with the area; (2) verify sign-in and the area on the console host with a real test account; (3) set or keep `CONSOLE_BASE_URL` on web so old links redirect; (4) only then delete the area's routes from `apps/web`. Steps 3 and 4 cannot be merged for an area that has live users.
- Decision:

### OQ-37 Retire the `apps/web` re-export shims (raised by S01d)
- About 40 one-line files (`lib/supabase/*`, `lib/auth/*`, `components/ui/*`, `lib/utils.ts`, `lib/icons.ts`, and others) re-export from `@tarragon/*` so 800-plus patient-side imports did not change. They are deliberate debt.
- Options: (a) one mechanical codemod later that rewrites imports and deletes the shims (recommended, once the areas have moved); (b) keep them permanently.
- Decision:

## D. Raised by S02 (2026-09-30)

### OQ-38 `scribe_consents` waits for a source-of-truth encounters table (raised by S02)
- v5 4.2 links `scribe_consents` to `encounter_id`. Live `clinical_encounters` is a derived summary index (RECONCILIATION 6), not authoritative, and OQ-23 keeps live wins for encounters. Nothing in S02 can reference a real encounter.
- Options: (a) build it in S21/S23 against whichever table S21 makes authoritative (recommended); (b) reference `video_consultations` now.
- Decision:

### OQ-39 `is_test` on orders and payments, and the existing metric surfaces (raised by S02)
- OQ-09 asks for `is_test` on orders and payments. There is no single orders or payments table, and three `*_quality_metrics` views plus 56 `analytics_*` RPCs read patient data without an `is_test` filter. S02 delivered the column on `profiles` and `clinical_staff`, the write guard, the convention and a ratchet for new views.
- Options: (a) do the column and the retrofit with S37/S38 when payouts and metrics are built (recommended); (b) a dedicated retrofit session now.
- Decision:

### OQ-40 Tied-patient read scope needs its data before it can be enforced (raised by S02)
- The audited-read gate admits only support.view_as holders and active break-glass grants. INV-12's other ways in (active task, lead assignment, on-call page) need tables that S16 to S19 create. Until then no clinician has a routine audited read of identity or consent data.
- Recommendation: extend `private.can_staff_read_patient_identity` in S16-S19; no S02 change needed. Confirm that a clinician needing a patient's identity before those sessions land should use break-glass.
- Decision:

### OQ-41 Employer-roster claim happens before a phone or email is verified (raised by S03)
- Finding: `private.handle_new_user()` matches a new account to an `employer_roster_members` row by `new.phone` (and by email) at INSERT time, before any code or link is confirmed, and marks the slot `claimed`. Phone-first sign-up (S03) puts the typed number on `auth.users.phone` at insert, so someone can sign up with a colleague's number, never verify it, and still consume that person's roster slot. The account itself stays unusable (phone confirmations are on), so nothing is exposed, but the slot is lost until an admin resets it. The same gap already existed for email sign-ups and for the old code-by-SMS path that created users.
- Options: (a) move the roster claim from the INSERT trigger to an `auth.users` UPDATE of `phone_confirmed_at` / `email_confirmed_at` (recommended; it is a change to a core trigger, so `/code-review ultra` and a fresh proof); (b) leave it and accept the nuisance; (c) only claim on insert when the identity is already confirmed.
- Decision:

### OQ-42 Assisted recovery: decisions needed before anyone can use it (raised by S03)
- Built and proved (`account_recovery_requests`, seven RPCs, `/admin/account-recovery`), not applied to production. Needs: (1) **a second active admin**: live has exactly one, and the feature deliberately has no single-person path, so it cannot run until a second admin exists (confirm two admins is the floor and name the second); (2) for the phone method the number is swapped to unconfirmed before its new owner verifies, which locks out the old number, and the new number is typed by the admin with only a "callback done" checkbox tying it to the real owner, so whoever holds that number can sign in by code (the safer alternative holds the old number until the new one is verified, and needs a session-bound flow started by the account owner; two distinct admins are the only control today); execute does end every session of the subject, but an access token already issued keeps working until it expires (at most one hour); (3) the email method uses `resetPasswordForEmail` to the address on file rather than `generateLink` plus our own email, so the link never passes through our server or the admin; (4) the subject is told on request and on execute (in-app, plus email if one exists, never SMS), decide whether a rejection should also notify them; (5) SIM-swap window 72 hours and request expiry 24 hours are proposed values; (6) scope is role `patient` only and only `profiles.role = 'admin'`, never delegated `support.view_as` holders; (7) `security.assisted_recovery_*` template keys are not registered in `notification_templates`, matching the existing `security.new_device_signin` precedent.
- Decision:

### OQ-43 SIM-swap risk on phone recovery and sign-in (raised by S03)
- A code to a verified phone is only as strong as the SIM. S03 adds friction where it is cheap: assisted recovery flags an account whose number changed in the last 72 hours and demands a separate review; number changes need a code on the NEW number; every new device is recorded and the owner is told by in-app notice and email. It does not yet block or delay a password reset by phone after a recent number change, and no telecom SIM-swap check (Nigerian carriers do not offer a public one) exists.
- Options: (a) add a delay or an email confirmation to phone recovery for accounts whose number changed recently (recommended once there is an email on most accounts); (b) accept the risk for launch and watch the new-device notices.
- Decision:

### OQ-44 Hosted Supabase settings S03 needs (your action, cannot be done from code)
- In the dashboard: enable Authentication > Hooks > Send SMS pointing at `auth-send-sms-hook` and set `SEND_SMS_HOOK_SECRET` and `SMS_LOG_PEPPER` (`supabase secrets set`), set the minimum password length to 8 and OTP length 6 with a 60 second resend, and confirm "Confirm email" and "Confirm phone" are on. Leave `SMS_PROVIDER` unset until the Termii sender ID is approved (OQ-21): unset REFUSES every send (phone sign-up then fails loudly instead of pretending a code was sent), and `mock` is for local stacks only. Then set it to `termii`. Enabling the hook before that means phone sign-up, phone change and code sign-in will not work on the hosted project, which is the same as today (no hook and no SMS provider), so enable it together with the Termii switch, not before. Deploy the function with `supabase functions deploy auth-send-sms-hook --no-verify-jwt`. Apply the two S03 migrations to production (`20260930205803`, `20260930210941`) each in its own transaction with the version pinned to the filename. Until the hook is enabled the hosted project keeps its current SMS behaviour.
- Also: provision Upstash (the auth rate limiter is per-instance until then, see `packages/auth/src/rate-limit.ts`).
- Decision:

### OQ-45 `profiles.phone` and `auth.users.phone` are kept in step only by app code (raised by S03)
- Changing the sign-in number updates `auth.users.phone` (after a code on the new number) and then `profiles.phone` from the server action. If the second write fails the action retries once, reports to Sentry and carries on, because the single-use code is spent and the sign-in number has already moved. Nothing in the database keeps the two in step.
- Options: (a) an `auth.users` AFTER UPDATE OF phone trigger that copies the confirmed number to `profiles.phone` (recommended; touches the auth schema, so its own proof and review); (b) accept the drift and repair from the Sentry reports.
- Decision:

### OQ-46 Termii: sender ID needs company documents; account base URL; DND route; wallet (raised by S03 follow-up, 2026-09-30)
- Checked in the Termii dashboard (new platform, `app.termii.ai`, workspace "Tarragon Health"): **0 approved sender IDs**. The "Tarragon" request (transactional, Nigeria, self-registered) has been a Draft since 12 Jul; the submit step now has a real sample message (Termii's own OTP template) but Termii refuses submission until these are uploaded: **CAC certificate of registration, a business/operating licence, and letters of authorisation for MTN, Airtel, Glo and 9mobile**. Estimated approval 5 business days after that. Nothing was submitted.
- **The account's API base URL is `https://v4.api.termii.com`**, not the `api.ng.termii.com` the platform hard-coded (the new hook's adapter now reads `TERMII_BASE_URL`; the legacy senders in OQ-32 still use the old host, which is one more reason they have never delivered). The send request format is unchanged.
- **The DND (transactional) route must be activated by Termii support** and the dashboard shows it active for 0 countries; OTPs on the generic route may not reach DND numbers and can get the sender ID blocked. **Wallet balance is about 2 naira**, so nothing can be sent until it is topped up.
- The hook sends Termii's OTP template word for word ("Your TarragonHealth verification code is N. This code expires in 10 minutes. Do not share with anyone."), which is longer than spec section 10's "code and brand name only"; carriers route by approved template, so the template wins. It promises 10 minutes, so the Supabase phone OTP expiry must be set to 600 seconds when the Phone provider is enabled.
- Options: (a) supply the documents and submit (recommended), then ask Termii support to activate DND; (b) try Termii's default sender for a pilot (their form says they may activate default IDs if the application is not approved), confirming first that default IDs work on the DND route.
- Decision:

### OQ-47 Add-elder proxy gives `manage` access before the elder has agreed (raised by S04)
- `addElderProxyDependentAction` (`apps/web/src/app/(dashboard)/patient/family/add-elder-actions.ts`) creates a login-less elder profile and gives the proxy `manage` on it at once. Through the dependent bypass in `private.can_read_clinical` that covers every category, reproductive health included. That is the opposite of v5 8.2 and safety case 23 ("the proxy sees nothing until the parent confirms"). The new `proxy_setups` flow is the compliant path; the old one is unchanged by S04.
- Options: (a) route "add a parent" through the new flow and keep the old action only for elders with no phone or capacity, with a recorded reason (recommended); (b) remove the old action; (c) leave both.
- Decision:

### OQ-48 The dependent-claim flow sends an SMS that is not a verification code (raised by S04)
- `claimDependentAccountAction` inserts a `notifications` row on channel `sms` (`dependent_account_claimed`), which INV-08 forbids (SMS is for verification codes only). Extends OQ-32; S04 does not change it.
- Decision:

### OQ-49 Optional consent types have no approved wording (raised by S04)
- `consent_versions` has rows only for the three original types. S04 adds the plumbing (`is_required`, withdrawal-aware logic, history) and seeds the optional purposes with `text_key`s, but the legal text (English) and the Pidgin equivalents need your approval and a native reviewer (OQ-19) before they are shown as real consent.
- Options: (a) ship the keys with clearly marked draft text behind a config flag until signed off (recommended); (b) hold the optional purposes entirely.
- Decision:

### OQ-50 Self-serve account deletion and data export are not in S04 (raised by S04)
- Live: export and deletion are admin-reviewed requests (`data_export_requests`, `data_deletion_requests`); there is no `delete_account` function and no self-serve download. Automated erasure needs a retention decision (clinical records, `audit_log` has no FK on purpose, finance ledger entries are never deleted).
- Options: (a) keep the reviewed workflow and add a two-tap request and status view (recommended); (b) automate erasure after a legal retention ruling.
- Decision:

### OQ-51 Categories chosen by the parent do not set `profile_access.permissions` (raised by S04 review)
- `confirm_proxy_setup` grants the chosen `care_access_category` rows but stores empty `permissions`. Tables or screens gated by the `can_read_clinical(uuid, caregiver_permission)` overload can still refuse the proxy, so "share Medicines" may not let them see medicines. The direction is safe (less access than shown), but the two models disagree.
- Options: (a) define one mapping from category to permissions and write both at confirmation (recommended, needs a clinical and product decision on the mapping); (b) make the permission overload read the category rows.
- Decision:

### OQ-52 Starting a setup creates an unverified account for any phone number (raised by S04 review)
- The proxy flow uses phone OTP with `shouldCreateUser: true`, as spec 8.2 describes, so any patient can create a password-less, unconfirmed account and profile for an arbitrary number (5 a day each). That also runs `handle_new_user`'s roster claim before verification (OQ-41).
- Options: (a) accept and add per-number and per-caller limits plus a cleanup of never-verified setup accounts (recommended); (b) send no code to a number with no account and let the parent sign up normally, then show the pending request after verification (changes spec 8.2).
- Decision:

### OQ-53 "A required consent cannot be withdrawn" is enforced only in the web action (raised by S04 review)
- `withdrawConsentAction` refuses required purposes, but the `patient_consents` insert policy and the withdrawal trigger still allow a patient to insert a withdrawn row for a required purpose directly.
- Options: (a) enforce it in `enforce_patient_consent_withdrawal` for current required versions and route account-level withdrawal to the data rights flow (recommended); (b) leave it app-level.
- Decision:


## E. Raised by S05 (2026-10-01)

### OQ-54 Audited staff reads on the remaining eight health-record tables need their screens moved first (raised by S05)
- Founder ruling 2026-10-01 was audited reads on all live clinical tables in S05. The call-site inventory (docs/design/S05.md section 5) found about 100 staff user-session reads across `vitals_readings` (about 17), `medications` (about 17, 8 of them embeds), `specialist_referrals` (about 22, including the sidebar counts on every clinician page), `clinical_encounter_notes` (6), `patient_conditions` (3), `patient_allergies` (2), `medication_logs` and `symptoms` (via `patient_timeline`), several through shared react-query hooks and four `security_invoker` views. Narrowing their SELECT policies without moving those would blank the clinician chart (the PR #789 failure). S05 delivered the audited path for all of them (`read_patient_chart_audited`) and closed the direct path only on `patient_documents` and `family_history` (0 callers).
- Options: (a) one follow-up session per surface, chart page first, then list screens with their own tied-list functions, closing each table's direct policy in the same change with a proof (recommended); (b) one large session with the staff Playwright suite running in CI; (c) keep org-wide staff reads on the list screens and rely on read logging only for them.
- Decision (founder, 2026-10-01): (a) one surface per session, chart page first, then list screens with their own tied-list functions; each session closes that table's direct policy with a proof.

### OQ-55 A new observation type is an enum value, not a zero-schema change (raised by S05)
- v5 says `observations.type` accepts new types without schema change. Live `vital_type` is an enum and the red-flag triggers are keyed off its values. Adding glucose-like types later is one `ALTER TYPE vital_type ADD VALUE` (the view already passes an unknown type through and reads the generic `value_numeric` / `value_unit`).
- Options: (a) keep the enum, one-line migration per new type (recommended: a lookup table would not make the triggers safer); (b) replace the enum with a `vital_types` lookup table (large change under about 15 triggers and 39 files).
- Decision (founder, 2026-10-01): (a) keep the enum; one `ALTER TYPE vital_type ADD VALUE` per new type.

### OQ-56 `dose_events` has no `pending` row (raised by S05)
- v5 `dose_events.status` includes `pending`; live `medication_logs` rows exist only once a dose is logged and are append-only. The view maps delayed to taken and not_available to skipped.
- Options: (a) S08 computes pending slots from `medications.schedule_times` and the Today screen shows them without storing a row (recommended); (b) pre-create pending rows nightly (breaks append-only).
- Decision (founder, 2026-10-01): (a) S08 computes pending slots from `schedule_times`; dose logs stay append-only.

### OQ-57 Prescriptions have a `draft` state v5 does not list (raised by S05)
- v5 states are signed, sent, dispensed, cancelled, so a prescription would exist only once signed. The database enforces INV-02 as a transition (leaving draft stamps the prescriber), which needs a draft to leave.
- Options: (a) keep `draft` (recommended; the patient never sees it); (b) create the row only at signing, giving up the DB-enforced transition.
- Decision (founder, 2026-10-01): (a) keep `draft`.

### OQ-58 Patients now read finalized clinical notes; supporters have no path to notes or referrals (raised by S05)
- INV-11 says the patient view shows signed notes only. Until now she saw only the published `consultation_patient_summaries`; she can now read the full finalized note (history, examination, assessment, plan). A Care Circle supporter reads prescriptions through the `medications` category, but no category is defined for notes or referrals, so they stay patient-only.
- Options: (a) keep the full finalized note readable and have the app show the plain-language summary first (recommended); (b) revoke the policy and expose notes only as the summary; and for supporters, map notes and referrals to `appointments_care_plan`.
- Decision (founder, 2026-10-01): patients see the published consultation summary only, not the clinical note. The finalized-note patient policy was dropped (migration `20261001065758_s05_patient_notes_summary_only.sql`). Supporters stay without a path to notes and referrals.

### OQ-59 A replayed vitals reading skips the app-layer pattern assessors (raised by S06)
- `POST /api/mobile/vitals` returns success on a duplicate `client_reading_id` (23505) without re-running `assessBpControlBestEffort`, `assessHeartRateBestEffort` or `assessGlucoseBestEffort`. The database red-flag triggers fire on the first insert, so an emergency is never missed or doubled. The gap is narrower: if the first request inserted the row and the phone never received the reply, and the server process died before the pattern assessors ran, the retry will not run them. Existing behaviour, not changed in S06 (it does not conflict with an invariant).
- Options: (a) leave it, the pattern assessors also run on the next reading and in the nightly pass (recommended while volume is low); (b) on a duplicate, re-run the assessors idempotently; (c) move the assessors into an event handler off `observation.recorded` (S11 and S12 scope).
- Decision (founder, 2026-10-02): (a) leave it. The next reading and the nightly pass re-run the assessors; revisit if volume grows or S11/S12 move them to an event handler.

### OQ-60 Offline tuning values live in code, not in versioned configuration (raised by S06)
- The clinical values (backdate window, stuck-notice hours, pull overlap) are versioned in `public.offline_sync_config`. Three engineering knobs are constants in `apps/mobile/src/lib/offline-budget.ts`: pull page size 200, at most 10 pages per run, first pull reads 90 days. They are performance tuning, not clinical, but the build rule says PROPOSED values live in configuration.
- Options: (a) leave as constants and revisit after a device lab run (recommended: they change with measurements, and a wrong value cannot harm care); (b) add three columns to `offline_sync_config` now.
- Decision (founder, 2026-10-02): (a) keep as constants; revisit after a device lab run.

### OQ-61 Nigerian Pidgin outbox strings need native review (raised by S06)
- The eight `outbox.*` strings in `packages/i18n/src/pcm.ts` (waiting, stuck, rejected, held, retry, remove, confirm, saved on phone) were written by the build session. They carry no clinical meaning, but "it has not reached your care team" is a promise about care, and OQ-19 requires native review before clinical Pidgin ships.
- Options: (a) a native Pidgin reviewer signs the eight strings before the next store build (recommended); (b) ship English only for these until reviewed.
- Decision (founder, 2026-10-02): (a) a native Pidgin reviewer signs the eight `outbox.*` strings before the next store build.
- Superseded (2026-10-06): Moot. Nigerian Pidgin was removed from the product on 2026-10-06 (D-14), so there is no `pcm` outbox wording to review.

### OQ-62 A dose logged offline for a medicine amended or stopped before sync (raised by S06)
- A dose log records what the patient did, so it is sent as logged even if the care team has since amended or stopped that prescription. The row keeps its device time (inside the bounded window) and its medication id. A log for a medication the patient has since deleted is refused by the foreign key and shows as "could not be saved" with a support code.
- Options: (a) keep as built, the log is a fact about what happened (recommended); (b) have the server refuse a dose log for a superseded medication and show a plainer message.
- Decision (founder, 2026-10-02): (a) accept the dose log as logged; only a deleted medication is refused.

### OQ-63 Nigerian Pidgin strings for the Vitals screen need native review (raised by design Phase 1)
- 66 new `vitals.*` strings in `packages/i18n/src/pcm.ts` were written by the build session (labels, errors, status words such as "E dey target" and "E pass target", the trend summary a screen reader reads). OQ-19 requires native review before clinical Pidgin ships, and these words carry clinical meaning.
- Options: (a) a native Pidgin reviewer with clinician input signs the strings before the next store build (recommended; the same reviewer pass as OQ-61); (b) show English for the clinical status words until reviewed.
- Decision: not yet asked.
- Superseded (2026-10-06): Moot. Nigerian Pidgin was removed from the product on 2026-10-06 (D-14), so the `pcm` Vitals strings no longer exist.

### OQ-64 The monitoring-cover card's wording against the house voice (raised by design Phase 1)
- The card shown on Vitals is headed "Nobody is alerted when one of your readings is dangerous" and its body contains an em dash. The house voice is warm with no fear-based urgency and no em dashes. The wording also implements a legal-accuracy rule (never imply an uncovered patient is unmonitored; the emergency safety net applies regardless of payment), so a rewrite is not a styling change.
- Options: (a) keep the facts, rewrite in the house voice, and have counsel confirm the accuracy rule still holds (recommended); (b) leave as is and only restyle it.
- Decision: not yet asked. Until then the card is only moved below the readings.


### OQ-65 `patient_tasks` does not exist; live `care_tasks` is the nearest table (raised by S07)
- v5 (spec line 225) names `patient_tasks` with `kind` (`log_bp`, `take_medicine`, `book_test`, `join_consultation`, `read_lesson`), `due_at`, `state`, `source_event_id`. Live `care_tasks` (`20260828222447_care_tasks.sql`) is a generic owner-role task: the patient reads her own rows and moves them only through `complete_care_task`, staff have full write, recurrence and escalation triggers already run on it, and it has no `kind`. `docs/RECONCILIATION.md` line 204 records it as DIFFERS. Other live task tables (`care_outreach_tasks`, `alert_follow_up_tasks`, `chronic_programme_coordinator_tasks`) serve other owners.
- Options: (a) add nullable `kind` (CHECK on the five values) and `source_event_id` to `care_tasks` and expose a `patient_tasks` view with `security_invoker`, the same pattern S05 used for `observations`, `dose_events` and the rest; no data conversion, no second source of truth, the existing triggers and RLS stay (recommended); (b) create a separate `patient_tasks` table (a parallel task store that staff, recurrence and escalation would not see); (c) adapt `care_tasks` only in app code with no schema change (the Today list could not tell a BP task from a lab task without parsing titles).
- `take_medicine` is not stored under any option: OQ-56 has S08 compute pending dose slots, and the Today screen merges stored tasks with those slots on the device.
- Decision (founder, 2026-10-03): (a) `patient_tasks` is a `security_invoker` view over `care_tasks` with nullable `kind` and `source_event_id`; the migration also updates `private.roll_recurring_care_task()` to copy `kind`; no second task table. S07 does not write a migration until answered.

### OQ-66 Plausibility limits: spec text is looser than the live, pathway-signed limits (raised by S07)
- Spec line 311 rejects systolic below 60 or above 300 and diastolic below 30 or above 200, with TRI-006. Live (`apps/web/src/lib/validation/vitals.ts:30-45`, mirrored in the app) accepts 60-260 and 30-160 and requires systolic above diastolic, and cites TH-CP-HTN-001 section 5.4 for those numbers. A typed 270/130 is refused on the phone and by the server, so it is never graded or alerted; the patient is told to re-check. Consumer cuffs report at most about 255/195 (one vendor's published range), so a value above 260 systolic from a cuff is almost always a typing error or an error code.
- Options: (a) keep the live limits, record the spec's 300/200 as superseded by the signed pathway, and add one safety line to the blocked-value message pointing to the existing emergency content, so a real crisis is never met with only a re-check prompt (recommended; no change to what the server accepts or to any alert; the wording needs Chief Medical Officer, house-voice and native Pidgin review first, and must not read as an alarm for an obvious typo such as 2700); (b) widen to the spec limits and add an "Is this right?" confirm step so a confirmed extreme is graded as an emergency (changes server validation and alert volume, needs the Chief Medical Officer); (c) keep the live limits with no message change (leaves the 270/130 case unaddressed).
- Decision (founder, 2026-10-03): (a) keep the live 60-260 / 30-160 limits (pathway TH-CP-HTN-001 section 5.4); the spec's 300/200 is superseded; add a safety line to the blocked-value message once the Chief Medical Officer, house-voice and native Pidgin reviews have signed the wording. S07 builds the plausibility function with limits in versioned configuration defaulting to the live values, so (b) later is a configuration change plus the confirm step.

### OQ-67 BP grading bands differ between the spec and live (raised by S07)
- Live (`private.classify_bp_level` in `20260720015223_bp_red_flag_engine.sql`, `lib/bp-classification.ts`, web copy): emergency when diastolic is at least 120 OR systolic is at least 200 (either alone, no symptom needed); red when systolic is at least 160 OR diastolic at least 100; amber when systolic is at least 135 OR diastolic at least 85; thresholds unversioned in SQL (OQ-14) and a version string in the app. So live is stricter than the spec for diastolic 120 or more without symptoms (live emergency, spec BP-R1 needs a red-flag symptom) and looser for systolic 180-199 with symptoms (live red, spec red with an emergency page). Spec rules BP-R1 to BP-A5 (lines 300-307, BP-G1 and BP-G2 at 308-309): red at 180/120 with a red-flag symptom, red at 200/130 regardless, amber at 180/110 on a repeat after 5 minutes, and a 7-day average rule. Clinical references read for S07 (AHA public guidance, ISH, ESH, WHO) use 180/120 as the severe line, and home targets vary (135/85, 135/75, 130/80). INV-01 and INV-16 require deterministic, versioned rules.
- Options: (a) S07 leaves grading untouched; S12 owns the rules and aligns the bands to the spec through a versioned `triage_thresholds` set signed by the Chief Medical Officer (INV-16), with live behaviour unchanged until then (recommended); (b) change the live bands now inside S07 (a safety change with no clinician sign-off and no versioning, and it would move alert volume); (c) keep live bands permanently and amend the spec.
- Interim in S07: the BP form captures optional symptoms and shows the existing on-device result and emergency guidance; a ticked red-flag symptom reuses the existing danger-sign path. S07 does not apply BP-R1 itself.
- Decision (founder, 2026-10-03): (a) S07 leaves BP grading untouched; S12 aligns the bands to the spec through versioned thresholds signed by the Chief Medical Officer (INV-16). A clinician decision is also needed for the home-BP default pair and for a low-BP flag, neither of which any guideline fixes.

### OQ-68 The dose reminder names the medicine, breaking INV-07 (raised by S07)
- `lib/dose-reminders.ts` schedules "Time for your ${item.drugName} dose (${item.time}).", hard-coded English, as a local notification. INV-07 says notifications never name a condition, reading or result; a medicine name can reveal a condition. Other legacy strings on the S07 screens (`bp-classification.ts`, `dose-reminders.ts`, and anything left on Home) were audited before Design Phase 1 moved Home and Vitals onto the kit; re-check at build time which are still hard-coded before listing them.
- Options: (a) S07 changes the reminder to keyed generic copy ("Time for your care plan check", no drug name) through `@tarragon/i18n`, and moves the strings of any file it touches; files it does not touch stay in the copy-lint baseline (recommended); (b) leave the medicine name and record it as accepted (conflicts with INV-07); (c) fix every legacy string in one pass (large, unrelated to S07).
- Pidgin versions of any new string need a native reviewer before the next store build (the OQ-61 pattern).
- Decision (founder, 2026-10-03): (a) the dose reminder becomes keyed generic copy with no medicine name, through `@tarragon/i18n`; strings in files S07 touches move to i18n; the Pidgin version needs native review.

### OQ-69 A due dose can raise two reminders: the one on the phone and the server's push (raised by S08)
- The phone holds its own local notification at the dose time. The existing cron `medication-dose-reminders-every-15-min` also queues a push and an in-app notice for the same dose, up to 15 minutes later if nothing has been logged. The server copy is useful when a phone maker has stopped the local one (docs/research/S08.md section 3), but a phone where both work shows the patient two reminders for one dose. S08 only removed the medicine name from the server text (INV-07).
- Options: (a) keep both: the server one is the backup for a killed local reminder (recommended until the real-device check shows how often local reminders are lost); (b) send the server one only to a patient whose phone has not reported a recent reminder plan (needs a new report from the phone); (c) drop the server dose reminder.
- Blocks nothing in S08. Related: OQ-05, OQ-21.

### OQ-70 Local reminders are planned only for the device owner's own medicines (raised by S08)
- A guardian who manages a dependant can view and log that person's doses, and the dependant's schedule is their own (8.15), but `replanDoseReminders` plans for the signed-in account only. Planning for dependants on the guardian's phone needs a neutral way to tell the doses apart without naming a medicine (a first name is not a condition, so INV-07 allows it) and a rule for which phone reminds, since the dependant may have their own.
- Options: (a) plan for every dependant the guardian manages, generic text plus the dependant's first name (recommended); (b) leave it: the Today list for that person is still correct, only the reminder is missing; (c) remind only on the dependant's own phone.

### OQ-71 Other server notification templates still name a medicine (raised by S08)
- S08 made `medication_dose_reminder` and `medication_refill_reminder` neutral and added a test (`packages/medicines/src/notification-wording.test.ts`). These still put `drug_name` in wording that reaches a push, an email or the in-app inbox: `medication_adherence_checkin`, `medication_review_due`, `medication_prescribed_patient`, `prescription_updated_patient`, `pharmacy_order_patient_confirmation`, `missed_dose_behavioural_nudge` (written by `private.route_missed_dose_reason`, whose wording is also a behavioural nudge the research would reject if it shames), and the `send-pending-notifications` lines that build text from `payload.drug_name`.
- Options: (a) S13 (notifications framework with the INV-07 lint) owns all of them (recommended); (b) fix them now in S08 (touches the prescription flow, which S24 changes).

### OQ-72 A skipped dose with a reason does not reach the care team as its own signal (raised by S08)
- The phone records a skip with a short key in `medication_logs.reason` (`side_effect`, `felt_well`, `other`; "I do not have it" is logged as `not_available`). `private.route_missed_dose_reason` only reads `status = 'missed'` with `missed_reason`, so a skip because of a side effect is stored and visible in the dose log but does not raise a review task. `not_available` already counts toward the 3 and 6 missed-dose alerts.
- Options: (a) a "side_effect" skip raises a care-team review task through the existing `care_outreach_tasks` path (recommended; needs the Chief Medical Officer's wording); (b) leave it for S11/S12 to read from the `medication_dose_recorded` signal, which carries the status but not the reason.

### OQ-73 Android exact alarms and boot persistence need a native build (raised by S08)
- `expo-notifications` 0.32 (SDK 54) does not expose `canScheduleExactAlarms`, and its `delivery: 'alarmClock'` option arrived in a later SDK (docs/research/S08.md section 3). On Android 12 and later, exact timing needs `SCHEDULE_EXACT_ALARM` in the manifest (not `USE_EXACT_ALARM`, which Play restricts), and alarms survive a reboot only with a boot receiver. `app.json` declares neither. The health check passes "unknown" for exact alarms and does not warn about them.
- Options: (a) declare `SCHEDULE_EXACT_ALARM`, add the in-context explanation and settings link, bump `runtimeVersion` and build (recommended, after the first real-device test on a Tecno or Infinix phone); (b) wait for the SDK upgrade that carries the newer `expo-notifications`. Either is a native-affecting change, so the OTA publisher will not ship it.

### OQ-74 Pidgin wording for the S08 strings needs a native reviewer (raised by S08)
- About 90 new keys (`medicines.notify.*`, `meds.*`) were written in English and a first Pidgin version. Same rule as OQ-61 and OQ-63: a native reviewer before the next store build. The reminder text and the skip reasons matter most.
- Superseded (2026-10-06): Moot. Nigerian Pidgin was removed from the product on 2026-10-06 (D-14). The English wording and its clinical review stand.

### OQ-75 Adherence below the line: what the care team sees and when (raised by S08)
- The weekly percentage is shown to the patient as a plain count with supportive wording and to tied clinicians as "doses marked taken". The `medication_adherence_low` signal fires once a week for a patient under 80 percent (the proposed line). The existing 3 and 6 missed-dose alerts still run separately. Whether the weekly signal should create a task, and the Chief Medical Officer's confirmation of 80 percent over 7 days, wait for S11 and S12; S08 never changes treatment or messages the patient about it.
- Options: (a) signal only until S12 defines the task (recommended); (b) also notify the patient's care team inbox now.

### OQ-76 Windows on existing medicines, and catch-up for dependants (raised by S08b)
- A flexible window can be set when a patient adds a medicine, but not edited afterwards, and a clinician-prescribed medicine has no window (its times are the care team's). The catch-up sheet covers the device owner's own medicines only; a guardian is not asked about a dependant's doses (same gap as OQ-70).
- Options: (a) add "change window" to a patient-added medicine's card and a clinician-side window on prescriptions in S24 (recommended); (b) leave windows as an add-time choice; for dependants, (c) ask the guardian too, per dependant, once OQ-70 is decided.
- Known limits found in the S08b review, recorded and not changed: (1) fixed in S08c: the phone's Today list now keeps yesterday's slot while its window is open (the web list still shows today only). (2) fixed in S08d: a failed catch-up read is recorded in the sync diagnostics and retried after 30 seconds and 2 minutes (then at the next open). (3) fixed in S08e: the database now refuses a `windowMinutes` that is not a whole number from 0 to 360 (`medications_schedule_window_valid`), exactly what the phone accepts. (4) fixed in S08g: follow-ups now have their own budget (`medicines.dose_rules.maxFollowUps`, 8, earliest first) and the rest of the notification cap is always due reminders, so follow-ups can shorten the days of due reminders by at most 8 places instead of up to half.
### OQ-80 Trends: no target is shown until the care team sets one, and the server's derived target is not visible to the app (raised by S07)
- The trends card shows the care team's target and calls a day "above" or "not above" it only when the patient has a `patient_bp_targets` row with a clinician recorded. Live has 0 such rows today, so no patient currently sees a target or a per-day status; the card still shows the averaging gate, the list and the morning and evening split. The reason: when there is no row, the server decides "above target" against a derived target (`private.patient_home_bp_target`: 135/85, or 130/80 for a patient with a diabetes, kidney, cardiovascular or heart failure care plan), and a patient cannot read it. A flat suggestion in the app could say "not above" about a reading the server has just flagged "above target" to a clinician. Two related facts: (1) the status rule is the server's own per-reading rule, at or above the target is above; the hypertension quality metric (20260829221025) instead counts a reading as controlled when it is at or below the target, so a reading exactly at the target is "above" for alerts and "controlled" for that metric; (2) a target remembered on the phone is shown when the server cannot be reached, so an offline patient can see a target the care team has since changed, and `set_by` is nulled if the clinician's record is deleted, which makes an existing target read as "not set"; (3) a shaded target band was not drawn on the Skia chart: its dashed lines are the classifier thresholds the status badges use, a different personal band would disagree with them, and chart drawing cannot be checked without a device.
- Options: (a) add a read-only function, for example `public.my_home_bp_target()`, that returns the target the server actually uses (explicit or derived) and which of the two it is, so the app shows the same number the alerts use and can label a derived one as the standard starting target (recommended; it is a small migration and needs your go-ahead to apply); (b) show a flat 135/85 suggestion in the app (simple, but can contradict a clinician alert for the high-risk groups); (c) keep it as built and have clinicians set an explicit target for each patient. Separately, ask the clinical owner which way the "at the target" boundary should go in the quality metric.
- Decision (founder, 2026-10-05): option (a), built, and applied to production (verified 2026-10-05: the function exists, anon cannot run it, the recorded SQL equals the file, and the proof passes on live in a rolled-back run). `public.my_home_bp_target()` is in `supabase/migrations/20261004213403_s07_my_home_bp_target.sql` with a proof script (`packages/db/tests/s07_my_home_bp_target.sql`, registered in `ci.manifest`, run against live in a rolled-back transaction with a sabotage step). It is read-only, answers only for the signed-in user, and returns the target the alerts use and where it came from. The app shows the care team's target as before, shows a derived or unattributed one as "a standard starting target ... your care team has not set one for you yet", and grades days against either. If the function is not on the server, the app falls back to the old explicit-row read (no statuses without a clinician-set row). Still open for the clinical owner: whether "exactly at the target" is above (alerts) or controlled (quality metric).
### OQ-77 A patient can still store a schedule the phone would reject (raised by S08e, FIXED in S08f)
- `medications.schedule_spec` is free-form JSON that a patient can write on their own patient-added medicine. The database now refuses a bad `windowMinutes` (S08e) and a spec of an unknown kind (S08), but not a malformed `times` list, a non-numeric `intervalDays`, empty `days`, a bad taper step or a window as long as the gap to the next dose. The server then expands no slots (or different ones) while the phone parses the spec as invalid and falls back to the plain daily times, so the patient's and the care team's numbers can differ, as the 400 minute window did.
- Options: (a) a `private.is_valid_schedule_spec(jsonb)` check constraint mirroring `parseScheduleSpec`, with the same cases proved on both sides (recommended); (b) leave it: only a patient writing malformed JSON by hand to their own record is affected.
- Decision (founder, 2026-10-05): option (a), done in S08f. `private.is_valid_schedule_spec` and the check constraint `medications_schedule_spec_valid` (migration `20261005154556`) refuse any spec the phone would refuse, rule by rule, and 60 shared cases (`SPEC_VALIDITY_CASES`) are judged the same on both sides. The database is deliberately a little stricter in two corners: a date before year 0001, and a dose text of emoji counted by characters rather than UTF-16 units.

### OQ-78 Nothing marks a blood pressure task done when a reading is logged (raised by S07)
- The Today list shows a `log_bp` task as done, for display only, when a reading was logged today and the task is once-off or daily (a weekly or monthly one stays open: one reading does not finish "three times a week"). Nothing is written. On the server the task stays open until a patient completes it through `complete_care_task` (online only) or staff close it, and `private.escalate_overdue_care_tasks()` (20260828222552, scheduled) marks an open task `missed` once it is overdue, which puts it on the coordinator's outreach worklist, and sends a priority 1 task on to clinical review after a grace period. A patient who logs a reading every day can therefore still have her task marked missed and be chased by a coordinator or reviewed by a clinician. Separately, programme-seeded tasks carry no `kind` yet (see the note in PR #887), so no seeded task reaches the Today list until the seeding function and the templates set one.
- Options: (a) design a server rule with the programme content owner that completes a matching daily `log_bp` task when a reading is inserted, and check it against the escalation ladder (recommended; it fixes the cause, but it changes what the care team sees, so it needs their sign-off, not a quiet trigger); (b) have the app call `complete_care_task` after a successful sync of the reading (online only, repeated for every phone, and silent when it fails); (c) leave it and accept the false escalations until the programme templates are reviewed.
- Decision (founder): pending.
### OQ-81 History: a correction request is tied to its reading by text, and cannot be raised offline or for someone else (raised by S07)
- The History screen lets a patient ask for a correction of a logged blood pressure reading. It reuses `data_correction_requests` (review by the care team) and `record_corrections` (the log of any change made) as they are, with no migration. Three consequences to decide on:
- (1) `data_correction_requests` has no link to the record it is about, only free text. The app writes the reading's id into the description (`[ref:vitals_readings:<id>]`, after a plain-words line such as "Blood pressure reading 152/96 mmHg, 2026-10-04 14:05 (Lagos)") and matches requests back to readings by it. It works and lets the reviewer find the exact row, but a request filed through the Privacy Centre's free-text form will not show against a reading. Cleaner: nullable `target_table` and `target_id` columns, a migration that needs your go-ahead.
- (2) A request is filed under the signed-in account by a trigger, so a carer acting for someone cannot raise one for them, and cannot see theirs. History is read-only in that case and says so. If carers should be able to ask on a dependant's behalf, that is a change to the correction workflow, not to this screen.
- (3) A request is not queued offline (the nearest rule is S06-2: no clinical change offline). It needs a connection and says so if it fails; the reading itself stays as saved until the care team has reviewed it. A reading still on the phone, or not accepted, has nothing on the server to correct, so no request is offered for it.
- History grades nothing: it shows the numbers, the time (Lagos), where the reading came from, whether the care team has it, and what happened to any request. The wording of the strings (including the Pidgin) needs the same CMO and native review as the BP form.
- Decision (founder): pending.

### OQ-79 Reminders: wording, Android exact alarms, notification buttons and the shared notification limit need a decision (raised by S07)
- Built: a Reminders screen for **blood pressure** reminders only: times and days the patient chooses, optional quiet hours, a "coming up" list and an Android help step. They are recurring local notifications (a rolling window), topped up on launch, on foreground and in the background task. **Medicine reminders are S08's** (`dose-reminders.ts` and the medicines package, already merged, with their own "dose|" identifiers and channel); an earlier version of this work also replaced those and was cut back when S08 landed. The two planners share the phone's limit of 64 pending notifications, so `reminders.behaviour` v2 (2026-10-05) splits it: `maxPending` 44 for medicines (down from 60) and `maxPendingBp` 18 for blood pressure, 62 together. 18 covers one blood pressure reminder a day for the whole 14-day horizon and two a day for 9 days; the screen says how far reminders are set up when the cap is hit. **Lowering the medicine budget from 60 to 44 is a change to merged S08 behaviour (a heavy medicine schedule is now planned about a quarter fewer days ahead) and needs the founder's confirmation.** Decisions made in the build and not final: (1) the notification wording is fixed and generic, "Time for your check-in.", so a lock screen never names a condition or a reading (INV-07), and the Pidgin strings were written by the build session and need a native reviewer; (2) Android exact alarms are not declared: without `SCHEDULE_EXACT_ALARM` (Android 12 and later) the phone may delay a reminder while it is idle, and declaring it needs a native build and a Play policy review; (3) there are no Taken or Snooze buttons on these notifications yet (tapping opens the app); the status rules are built and tested in `reminder-schedule.ts` but unused, because acting on a button with the app closed can only be proved on a real phone; (4) maker battery managers (Tecno, Infinix, Itel) can still drop reminders, so a reminder is never a safety guarantee; (5) reminders are NOT cancelled on sign-out, because an expired session also reports a sign-out and cancelling would silently end a patient's reminders; the text is generic (INV-07) and the next account replaces them, but a phone signed out on purpose keeps showing the generic reminder until its window ends (up to two weeks), so an explicit "Sign out" button could cancel them; (6) with the 18-notification budget a heavy setup (six reminders of four times) is planned only a few hours ahead; opening the app or the background task tops it up, but a maker's battery manager can stop the background task.
- Options: (a) test on a Pixel, a Tecno and an Infinix first (force-stop, reboot, idle, notification arrives on time), then decide on exact alarms and buttons from what is seen; a native Pidgin reviewer signs the strings and the founder confirms the generic wording and the 44/18 split before the next store build (recommended); (b) declare exact alarms now, in the next native build, without testing (adds a permission Google reviews, and does not by itself beat a maker's battery manager); (c) ship reminders with no further work and treat delays as expected.
### OQ-82 BP form: ticked symptoms, technique wording and Pidgin strings need clinical and native review (raised by S07)
- The blood pressure form now has an optional pulse, an optional symptom checklist (severe headache, chest pain, trouble breathing, vision change, confusion, dizziness, racing heartbeat) and a "Before you measure" guide. Decisions the build made that a clinician should own: (1) a tick is stored as a `symptoms` row at severity 6 (versioned config `bp.symptom_checklist`, PROPOSED), with the description "Ticked on the blood pressure form (not rated by the patient)", because the form does not ask the patient to rate it; 6 is the existing server paging line for chest pain, severe headache, vision change and confusion, and is below the line (8) for the other types, so ticking breathlessness, dizziness or palpitations records the symptom without paging (note: trouble breathing is on the red-flag list that shows the emergency guidance on the device, yet at severity 6 it does not page a clinician, so the patient is told to get help while the care team is not paged; the CMO may want a higher recorded severity for it); (2) ticking any of severe headache, chest pain, trouble breathing, vision change or confusion shows the bundled emergency guidance straight away on the device (no threshold, and it does not depend on the reading); (3) the technique steps (5 minute rest, 30 minutes with no caffeine, tobacco, exercise or food, two readings a minute apart) are PROPOSED values in `bp.home_protocol`. The Pidgin text for all 36 new `vitals.*` strings was written by the build session, as with OQ-63.
- Options: (a) the Chief Medical Officer confirms or changes the severity, the red-flag list and the technique wording, and a native Pidgin reviewer signs the new strings, both before the next store build (recommended); (b) ship English only for the new strings until reviewed; (c) drop the "emergency guidance on a tick" and show the checklist as information only (leaves a ticked chest pain with no on-device guidance).
- Decision (founder): pending.
- Superseded (2026-10-06): The Pidgin part is moot (Pidgin removed 2026-10-06, D-14). The clinical review of the symptom list and technique wording stands.

### OQ-83 Weakness, numbness and trouble speaking cannot be recorded as a symptom (raised by S07)
- The spec's red-flag list for blood pressure (BP-R1) includes weakness or numbness, but `symptom_type` has no value for it (the closest, "face/arm weakness or slurred speech", is a one-touch danger sign that writes an `emergency_events` row and only works online). The BP form therefore cannot log it with the other ticks. The form shows a fixed line instead: go to the nearest hospital now if you have weakness on one side, numbness or trouble speaking. Body position (an optional field the research suggested) is not captured either: there is no column for it.
- Options: (a) keep the fixed guidance line and add the symptom type later, with S11/S12 (recommended; it is an enum change plus the server red-flag rules, and the line already tells the patient what to do); (b) add a `neuro_deficit` symptom type now (one `ALTER TYPE ... ADD VALUE` and a trigger update, a safety-path change without clinician sign-off); (c) route it through the one-touch danger sign path (online only, so it fails exactly when it matters).
- Decision (founder): pending.

### OQ-84 A dead-lettered urgent delivery raises no alert (raised by S10) -- RESOLVED 2026-10-05
- Fixed in S10: a dead urgent delivery opens one open sev2 technical `ops_incidents` row per subscriber (summary names the subscriber and event type only). S19 and S37 still own paging and the dashboard tile.
- A delivery that exhausts its attempts goes to `dead` and is counted in `event_bus_health()` (`dead_urgent`) and logged by `process-events`, but nothing pages a person. Until subscribers exist (S11 onward) nothing can go dead, so there is no live gap today.
- Options: (a) S19 adds an ops alert when an urgent delivery goes dead, and S37 adds the dashboard tile (recommended; they own paging and the go-live dashboard); (b) add a cron check now that writes a `clinician_alerts`-style row when `dead_urgent > 0`.
- Decision (founder): pending. Must be settled before S12 registers the red-triage handler.

### OQ-85 `process-events` accepts the public publishable key (raised by S10) -- RESOLVED 2026-10-05
- Fixed in S10: the function also requires the shared secret header `x-process-events-secret` (constant-time check, fails closed with 503 when `PROCESS_EVENTS_SECRET` is unset, 401 on a mismatch). Needs the same value as the edge secret `PROCESS_EVENTS_SECRET` and the Vault secret `process_events_secret`.
- Like the other cron-called edge functions it uses `verify_jwt` with the publishable key the cron job sends, so anyone with that public key can trigger a processing pass. Processing is idempotent, so the risk is load, not wrong data.
- Options: (a) keep, matching the notification sender and the partner webhook drain (recommended for now); (b) add a dedicated shared secret header checked in the function and stored in Vault.
- Decision (founder): pending.

### OQ-86 (DECIDED) Three rules beyond the spec table, and four gaps in it (raised by S11)
- The spec's BP table (6.2) leaves gaps that the engine would otherwise grade wrongly. S11 added three rules, all PROPOSED and all in the draft rule set: **BP-P1** (pregnant user: amber, routed to a clinician, never graded on adult bands), **BP-P2** (age under 18: same), **BP-A6** (any red-flag symptom with a reading below the severe line: amber, emergency guidance shown, urgent review task due in 4 hours). Without BP-A6 a reading of 150/112 with a severe headache matched no rule (BP-A1 requires no symptoms, BP-R1 needs 120 diastolic) and 120/78 with chest pain read as green "within target". BP-A6 also keeps today's behaviour on the phone (guidance on any red-flag tick, S07).
- Guideline research (2026-10-05, `docs/research/S11-guidelines.md`) answered gaps 1 and 4: pregnancy lines are now BP-P3 and BP-P4 (red), and counting every reading in the average matches ESH and AHA practice. Still open for the CMO: BP-R2 is more cautious than any guideline, and (2) below, plus a postpartum state. Original gap list: (1) a pregnant user at a severe-range reading (obstetric lines are lower than 180/120); today she is red only through BP-R1/R2 and amber otherwise. (2) A low reading with no symptoms (95/60) is green "within target"; no guideline fixes a home low-BP number (see OQ-67). (3) Red-flag symptoms ticked with no reading at all are not graded by the BP rule set (a symptom_report trigger is S12). (4) Averages count every stored reading, so two readings taken a minute apart weigh double; S07's per-session averaging is not applied here.
- Options: (a) keep the additions as drafted and let the CMO edit the draft rule set before signing (recommended); (b) remove them and accept the gaps; (c) replace them with the CMO's own wording.
- Decision (founder, 2026-10-05): option (a), accept as drafted. The rule set stays a DRAFT: the CMO must still review and sign it, and nothing here is regulator- or CMO-approved.

### OQ-87 (DECIDED) Where the spec text and its own safety cases disagree, and message codes the spec leaves open (raised by S11)
- Spec 6.2 rejects a systolic "above 300" but safety case 5 says 300/40 must be rejected. 300 is not above 300, so the text and the case conflict. S11 uses a systolic maximum of 299 (PROPOSED in `params.validation`) so both hold; every other value behaves as the text says.
- The spec names TRI-001, TRI-003, TRI-005, TRI-006 and EMG-001 but not what BP-G2 shows ("TRI-003 or TRI-005") or what an amber shows. S11 uses TRI-003 for "above target, not an emergency", TRI-005 for "rest 5 minutes and measure again" (the BP-A1 recheck), TRI-002 for "your care team will look at this" (every amber), and EMG-001L for the low-pressure variant. The audio manifest (S32) needs these codes confirmed.
- The English wording of EMG-001, EMG-001L and TRI-001 to TRI-006 was written in this session for the CMO to review; the Pidgin entries are held as English until a native reviewer and the CMO sign the safety wording (extends OQ-74). EMG text says "go to the nearest hospital" and prints no number (PR #785).
- Options: (a) accept these codes and numbers as drafted for review (recommended); (b) the CMO supplies the numbering and wording.
- Decision (founder, 2026-10-05): option (a), accept as drafted. The rule set stays a DRAFT: the CMO must still review and sign it, and nothing here is regulator- or CMO-approved.

### OQ-88 Triage runs in shadow until the CMO approves a rule set (raised by S12)
- The only `bp_care_triage` rule set is a draft (OQ-86, OQ-87). The live pipeline (`private.classify_bp_level`, `vitals_readings_bp_red_flag`, `emergency_events`, `clinician_alerts`) pages and escalates today with different bands (OQ-67). If S12 also paged or opened clinical tasks from the draft, a patient could be paged twice with two different grades, and nothing would show which rule set a clinician was told to trust (INV-14, INV-16).
- S12 therefore grades on the server with the draft, stores the result with `shadow = true` and the rule set version, and emits `triage.graded` with `shadow: true`. The subscribers S16 (tasks) and S19 (paging) must ignore shadow events. On the phone the engine can only add guidance to what the older check shows (the stricter wins), and the repeat-reading prompt is shown because it only asks the patient to rest and measure again.
- Options: (a) shadow until the CMO approves, then S16/S19 act on non-shadow events and the live bands are retired in a later session (recommended); (b) let S12 drive paging now and retire the live triggers (a safety change with no clinician sign-off, and a risk of double paging); (c) keep the live pipeline permanently and drop the engine's paging.
- Decision (founder, 2026-10-05): option (a), shadow until the CMO signs. S12 is built to it and changes nothing about live behaviour.

### OQ-89 Symptom-only reports, silence and adherence are not wired yet (raised by S12)
- S11's engine grades `observation`, `adherence` and `silence` triggers. S12 wires only `observation` (a blood pressure reading, with ticked symptoms). Red-flag symptoms ticked with no reading are still handled by the live danger-sign path (OQ-86 gap 3). The nightly `silence.detected` job and the 7-day adherence rule need a care-pack patient (`pathway.state = care_pack_active`), and care packs arrive in S26; the server treats every patient as `self_guided`, so BP-A4 and BP-A5 cannot fire.
- Options: (a) wire silence and adherence in S26 with the care pack, and symptom-only reports with S19 (recommended); (b) wire them now with a stand-in pathway state (would grade patients as care-pack with no pack).
- Safety case 7 (silence task once) is proved in the engine (S11) but not end to end until S26.
- Decision (founder, 2026-10-05): option (a), wire silence and adherence with S26 and symptom-only reports with S19.

### OQ-90 Pregnancy and age are read from different places on the phone and the server (raised by S12)
- The server reads `patient_pregnancy.is_pregnant` and the date of birth from the profile. The phone has neither offline, so it passes `pregnant = false` and no age; BP-P1 and BP-P2 (route to a clinician) can therefore only fire on the server. A pregnant patient at a reading below the red line would not see the engine's "care team will look" message on the phone, only after the server grades her.
- Options: (a) cache date of birth and pregnancy flag with the emergency facts and pass them on the phone (recommended, small); (b) leave it (the server still grades and the live pipeline still alerts).
- Decision (founder, 2026-10-05): option (a). Built in S12 follow-up: `refreshPatientFacts` and `ageYearsOn` in `apps/mobile/src/lib/triage-device.ts`.
### OQ-91 Two emails still attach a PDF that names the request (raised by S13)
- `lab_order_requested_patient` attaches the take-anywhere request PDF (a founder requirement from 2026-08) and `preventive_care_plan_updated` attaches the care plan PDF. The email wording is now neutral, but the attachment itself lists test names and plan items, so an email client preview or a forwarded mailbox can show them. INV-07 says email never names a condition, reading or result.
- Options: (a) keep the attachment and accept it as the one exception, because the patient asked for a take-away document (recommended only with the founder's explicit sign-off); (b) send the document as a signed, login-protected link instead (no content in the email); (c) drop the attachment and show the PDF in the app only.

### OQ-92 Critical rows can still be sent by SMS in the escalation ladder (raised by S13)
- INV-08 limits SMS to verification codes, and D-12 allows clinician paging. `private.escalate_unconfirmed_critical_notifications()` can also move a PATIENT-facing critical alert to `sms` as the last hop, and the sender lets any critical row through. S13 leaves this alone so a safety alert is never silenced, and refuses every routine SMS.
- Options: (a) keep, because live SMS has never delivered (76 failed, 0 sent) and the hop is a no-op until a sender ID exists; (b) end the patient ladder at email and in-app and keep SMS for clinicians only (recommended, needs the CMO to confirm the ladder); (c) leave as is and re-check when a sender ID is approved.

### OQ-93 Pidgin notification text and local terms (raised by S13)
- Notification templates are English only (locale-keyed, so `pcm` rows can be added). Pidgin settings strings (quiet hours, discreet mode) were written by the build session and need a native reviewer. A Pidgin template set would need its own forbidden words: "sugar" and "pressure" are common words for diabetes and hypertension. "sugar" and "pressure" are already on the English list.
- Options: (a) add `pcm` template rows only after a native reviewer and the CMO approve them, and run the same lint (recommended); (b) keep notification text English only for now.
- Superseded (2026-10-06): Moot. Pidgin was removed 2026-10-06 (D-14); notification templates stay English only and no `pcm` rows will be added.

### OQ-94 Free-text notification content cannot be linted by wording (raised by S13)
- The lint checks fixed wording and placeholder NAMES, never values. Three paths put free text into a notification: `broadcast_announcement` (an admin writes subject and body), the LLM-personalised `message` in the lifestyle check-in (screened by `toneGuard`, not by the INV-07 term list), and `free_tier_reading_self_care_suggestion`, whose full text names the reading and now shows only "Something needs your attention" in the preview. The self-care text must stay readable in the app (confirm the card that shows it) because it is a safety message for a patient on the free plan.
- Options: (a) run the term list over broadcast subject and body and the LLM message at write time and refuse a hit (recommended); (b) leave broadcast as an admin responsibility with a warning in the composer; (c) confirm the in-app self-care card and close the third path.

## D. Raised by S15 (clinician credentialing)

### OQ-99 Credentialing screens are in `apps/web`, not `apps/console` (raised by S15)
- The session plan put the reviewer screens in a new console area. The console only serves roles whose area has been extracted, and CLAUDE.md forbids widening it to the `clinician` role (the CMO's account role); the CMO could not open it. The screens are therefore mounted under `/admin/credentialing` and `/clinician/credentialing` over shared components.
- Options: (a) keep in `apps/web` until S35 extracts the clinician area, then move the shared components (recommended); (b) extract a minimal credentialing area now and teach `console-areas` a role exception.
- Decision:

### OQ-100 Two credential ladders now exist (raised by S15)
- The older §29.7 ladder (`provider_restrictions`, warning, grace, service restriction, suspension on a CMO-signed policy) restricts new appointment bookings only. The S15 sweep suspends at expiry after an audited grace period, as decided. They act on the same dates. Eligibility now consults both, so the older one can only tighten.
- Options: (a) fold the older ladder into S15 so there is one expiry process and one grace concept (recommended, a later pass, needs the CMO because the policy is signed); (b) keep both and document it.
- Decision:

### OQ-101 A patient account becomes a clinician account (raised by S15)
- An applicant is a normal person account until activation, when `profiles.role` flips to `clinician`; a suspended or offboarded clinician flips back to `patient`. A doctor who is also a patient of Tarragon would lose the patient dashboard while active.
- Options: (a) advise a separate work account for the clinician login (recommended; the application page says nothing yet); (b) keep one account and allow both views, which needs a dual-role design the account-role rule forbids.
- Decision:

### OQ-102 Staff and applicant screens are English only (raised by S15)
- The spec asks for every user-facing string in `packages/i18n` (en, pcm). The existing admin and clinician pages are plain English and the people using these screens are clinicians and reviewers, so S15 follows that convention. Applicant copy avoids clinical jargon and em dashes.
- Options: (a) leave English, revisit if a Pidgin-speaking reviewer needs it (recommended); (b) move the copy into the i18n package.
- Decision:

### OQ-103 A CMO-approved test applicant gets a real-flag clinician row (raised by S15)
- `private.guard_is_test_flag()` only lets an admin or a service context set `is_test`; approval runs as the CMO, so `clinical_staff.is_test` is set only when the approver is also an admin. A QA applicant approved by a CMO needs an admin to flip the flag afterwards.
- Options: (a) accept and document (recommended); (b) let the approval function carry the flag by running as a service context.
- Decision:

### OQ-104 Applicant phone is required but not proved verified (raised by S15)
- `start_clinician_application` checks the email is confirmed and a phone number is present. Where S03 records a verified phone was not confirmed against auth, so a verified phone is not yet required.
- Options: (a) require the S03 phone-verified marker once confirmed (recommended); (b) leave as is.
- Decision:

### OQ-105 Training and test content must be written and approved before anyone can pass (raised by S15)
- Five draft training modules are seeded with placeholder text and no test scenarios exist. Nothing is approved by the agent. Until the CMO writes and approves at least one safety-critical scenario, `start_credential_test` refuses with a clear message and no application can pass the test.
- Blocks: the first real applicant. Decision: the CMO authors at `/clinician/credentialing/content`.

### OQ-106 MDCN verification route, turnaround and annual grace (raised by S15)
- There is no register to query; the founder set the evidence (current-year licence, portal screenshot, graduation certificate, NYSC). Written confirmation from MDCN is accepted as an optional document. The exact MDCN verification route and turnaround, and each year's renewal grace announcements, are not confirmed.
- Options: ops asks MDCN for written verification where it matters and records the reply (recommended); the audited grace period in S15 is the lever for an announced MDCN grace.
- Decision:

### OQ-107 One person verifying and approving (raised by S15)
- The person who verifies a check cannot approve the application (`separate_verifier_and_approver`, on). A sole founder who is both admin and CMO needs two accounts to credential anyone.
- Options: (a) keep on and use two accounts (recommended); (b) switch the config value off with a recorded reason, which weakens the control.
- Decision:

### OQ-108 Document retention has a date but no purge (raised by S15)
- `retain_until` is set at offboarding (7 years, PROPOSED, `document_retention_years_after_offboarding`). Nothing deletes a document after that date, and a rejected applicant's documents have no date at all.
- Options: (a) add a nightly purge with an audit row, and a retention for rejected applications (recommended, counsel sets the periods); (b) manual review.
- Decision:

### OQ-109 The two existing clinicians have no licence or indemnity dates (raised by S15)
- The sweep never suspends on a missing date (it would remove the only clinicians), so they are reported as "No date on file" on the licences and cover page until ops records them through a renewal. The founder-CMO is covered by an existing indemnity exemption.
- Action for ops: upload and record the licence for both, then the indemnity for any freelance clinician.

### OQ-110 Two triage task keys have no spec task type (raised by S16)
- The S11 rule set emits `adherence_review` and `silence_check`; spec 7.3 lists nine task types and neither is among them. The live keys `urgent_bp_review`, `bp_review` and `low_bp_review` map to `amber_bp_review` (the due time comes from the rule), `referral_review` to `admin_clinical`.
- S16 added one type, `adherence_follow_up` (class 8, 48 hours, logistics only, minimum tier `care_coordinator`), so the work is not dropped. A key that no type answers raises and dead-letters visibly.
- Options: (a) keep the extra type and have the CMO confirm the class and tier (recommended); (b) fold both into `symptom_review` (would send a check-in to a doctor's queue).
- Decision (founder, 2026-10-06): option (a), keep `adherence_follow_up`. The CMO confirms its class and tier when signing the rule set.

### OQ-111 Who is "the lead" until S18 (raised by S16)
- Spec 7.4 offers a task to the patient's lead clinician first. S18 builds lead assignment. Until then S16 uses `care_team_assignment.clinician_id` as the named clinician, only if they are eligible (S15), not on leave and at or above the type's tier. An employed doctor with no named clinician is chosen by least open load (reusing the leave and hours checks of escalation auto-assignment). The same `offered_to_lead` state and window serve both a lead and a pushed employed doctor.
- Options: (a) accept as a stand-in and replace the lookup in S18 (recommended); (b) hold all tasks in the pool until S18.
- Decision (founder, 2026-10-06): option (a), use `care_team_assignment` as the stand-in and replace the lookup in S18.

### OQ-112 A task pushed to one doctor is hidden from the pool only while the window lasts (raised by S16)
- A pushed or offered task returns to the pool when its window ends, and escalates when past due. Nothing yet tells the pushed doctor that a window is about to lapse, and S17's next-task query must not show an offered task to anyone else. Working hours and post-call rest for freelancers are also not applied (S17 and S18).
- Options: (a) S17 excludes offered tasks from other clinicians and S18 adds the hours rule (recommended); (b) show offered tasks to all, with a marker.
- Decision (founder, 2026-10-06): option (a). S17's next-task query hides offered tasks from other clinicians; S18 adds the working-hours and post-call rest rule.

### OQ-113 Paging fallback is email, not SMS (raised by S16, founder 2026-10-06)
- INV-08 limits SMS to verification codes and D-12 allows clinician paging. For S19 the founder chose email as the fallback after push and in-app. S16 only emits `clinical_task.escalated` (urgent); nothing pages from it yet.
- Decision (founder, 2026-10-06): email fallback. S19 builds the ladder; SMS stays off for paging until D-12 is exercised.

### OQ-114 Old alerts and escalations are read through a view, not merged (raised by S16)
- `legacy_clinical_work_v` unions open `escalations` and `clinician_alerts` for the queue screens. The old tables keep their own flows, so a red reading can both raise a live alert and, once the CMO signs a rule set (OQ-88), create a task. Retiring the live bands is a later, separate decision.
- Decision (founder, 2026-10-06): adapter view, not a backfill.
### OQ-95 Zoom adapter details to confirm on a live account (raised by S14)
- The Zoom adapter follows Zoom's published REST and Meeting SDK docs but has only run against a fake. Things S21 must check live: (1) a Meeting SDK token lifetime under 30 minutes may be refused, while the adapter never lets a token outlive the room (so a short room could trip it); (2) ending a scheduled meeting does not stop a rejoin, so the adapter ends then deletes it, and a second end reports success because the meeting is already gone, including for a number that never existed; (3) Zoom takes the participant label from the client SDK, so the app must join with the role word ("patient", "clinician", "observer") as the label or webhook presence events are dropped; (4) Zoom webhooks carry presence and meeting end but not connection quality, so quality samples must come from the device SDK; (5) the `endpoint.url_validation` challenge stays in the existing `zoom-webhook` function.
- Options: (a) verify each point in the first S21 live test and fix the adapter (recommended); (b) pick Daily, 100ms or Agora now, which have first-class quality events and audio-only toggles.
- Decision (founder, 2026-10-06): Stay on Zoom. Verify the five points in the first S21 live test (two phones, mobile data, one on 3G, about 20 minutes). If Zoom refuses tokens under 30 minutes, add a 30 minute token floor and keep the room closing on time. Consider Daily or 100ms only if that test shows poor audio-only or reconnect behaviour.
- Checked 2026-10-06 in the Zoom Marketplace: the only app is the Server-to-Server OAuth app "Tarragon Video Consult API"; no Meeting SDK app exists yet, so there is no SDK key or secret. Extra caveat for S21: Zoom has required apps that put people from outside the owning Zoom account (every patient) into a meeting to be approved or published, so the first live test must use a real outside participant, not only two staff on the same account. If that approval is slow, that alone can justify Daily or 100ms.
- Done 2026-10-06 (by the build session, in the Zoom Marketplace): created the app "Tarragon Consult SDK" (a General App, user-managed, Development stage) with the Meeting SDK feature switched on. Its Client ID and Client Secret are the SDK key and secret: set them as `ZOOM_SDK_KEY` and `ZOOM_SDK_SECRET` (the owner copies them; they were not read or stored by the session). Not done: production activation and any Zoom review for outside participants, which S21 starts.

### OQ-96 Speech-to-text vendor and Pidgin accuracy (raised by S14)
- D-08 leaves the vendor open, and S14 builds the interface and a mock only. Nigerian English and Pidgin accuracy, and medicine names in particular, are unproven on every candidate. The interface requires a recorded scribe consent id before a stream starts (INV-11).
- Options: (a) before S23, score two or three engines on 30 minutes of real, consented Nigerian consultation audio (English and Pidgin) with a clinician checking drug names, then choose (recommended); (b) start with a general engine and make the clinician edit step the safety net.
- Decision (founder): pending. Blocks S23.
- Decision (founder, 2026-10-06): Wait until S23 to choose. Start now on a scoring set of about 30 minutes of consented, de-identified Nigerian consultation audio (English and Pidgin) with a clinician checking medicine names. Until then the scribe stays off and clinicians write notes.
- Superseded (2026-10-06): The Pidgin part is moot (Pidgin removed 2026-10-06, D-14): the scribe is Nigerian English only (`en-NG`). Vendor scoring on Nigerian English stands.

### OQ-97 Paystack adapter: webhook secret, transfers and the older code (raised by S14)
- (1) Paystack signs webhooks with the secret key; the live function reads `PAYSTACK_WEBHOOK_SECRET`. The adapter defaults to the secret key and takes a separate webhook secret only if configured. Confirm the live value before S25. (2) Transfers use `source: balance`. Paystack asks for an OTP on transfers unless it is switched off for the account; the adapter reports an OTP-pending transfer as `needs_attention` for a person to look at. Decide in S31 whether to disable the OTP. (3) Transfer references are validated as lower case letters, digits, dash and underscore, 16 to 50 characters, from Paystack's published rules; confirm in test mode. (4) The live client in `apps/web/src/lib/paystack` still allows GBP and USD and the plan-based subscription flow, which the 2026-09-02 pivot retired; the adapter is NGN only and one-off only. The live code was not changed. (5) The live refund path has no idempotency of its own, so the refund caller must dedupe by its own refund record (S26).
- Options: (a) S25 moves checkout and the webhook onto the adapter and removes the retired code paths, S31 does the same for transfers (recommended); (b) leave the live clients and use the adapter only for new flows.
- Decision (founder, 2026-10-06): Naira only in the app and adapter. Diaspora payers pay a naira price with a foreign card (confirm international cards are on in Paystack) or sponsor through Care Circle (S29); no GBP/USD code, no second price list. Delete the retired GBP/USD and plan paths in S25 if unreachable. Confirm `PAYSTACK_WEBHOOK_SECRET` equals the secret key and drop the separate variable if so. Disable the transfer OTP for unattended weekly batches, and compensate with the S31 approval step, per-transfer and daily limits on the Paystack account, and an alert on any transfer needing attention.
- Checked 2026-10-06 in the live Paystack dashboard and Supabase: the account is Live and Approved; international payments are already on; the live webhook URL is the `paystack-webhook` function; `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_SECRET` hold identical values, so the separate variable is redundant (the adapter defaults to the secret key). Still open: (1) "Pass transaction fees to customers" is ON, so a customer may be charged more than the order amount; S25 must confirm whether verify reports the total with fees, because `paymentMatchesOrder` requires an exact amount and would reject genuine payments, and either turn pass-through off or compare against amount minus fees; (2) the transfer OTP is a security setting and must be switched off by the account owner in Paystack (Payouts, Transfers settings), together with per-transfer and daily limits.
- Decision (founder, 2026-10-06): keep "Pass transaction fees to customers" ON. The patient pays the price plus the payment processor's fee, and is told where the fee comes from before they pay. Built in S14: `VerifiedTransaction` now carries `requestedAmountKobo` (the price), `feesKobo` and the total, `paymentMatchesOrder` matches the order on the PRICE and returns `customerFeeKobo` (and rejects a charge above price plus the real fee or below the price), and the strings `pay.fee.*` (en, pcm) explain the fee. S25 must show price, fee and total on the checkout screen before payment, record the fee on the order and receipt, and keep it out of the care-team earnings base. Open for S25/S26: whether a refund returns the fee (recommended: yes for a full refund when we cancel, no for a patient-requested partial), and that cards issued abroad cost more, so the fee line must be computed or read from Paystack, never a fixed percentage in code. Pidgin text needs a native reviewer.
- Not done (security setting, owner only): switching off the transfer OTP in Paystack.
- Verify in S25 against Paystack test mode before relying on the fee logic: the field names `requested_amount` and `fees` on the verify and charge.success payloads come from published docs and have not been seen live. If `requested_amount` is absent while pass-through is on, the adapter treats the whole amount as the price and `paymentMatchesOrder` rejects the payment (safe, but it would block genuine payments), so check this first. The refund cap in the mock is the price only; confirm whether Paystack refunds up to the total including the fee.

### OQ-98 Email sending domain and staff email wording (raised by S14)
- The Resend adapter needs a verified sending domain with SPF, DKIM and DMARC, which this session could not check. Patient email is linted for INV-07 at the adapter boundary; staff email (partner, clinician) is deliberately not, because it may need operational detail, but it still must not carry a patient's name or reading into a shared inbox.
- Options: (a) confirm the domain records before S27 sends partner email, and review staff templates for patient detail then (recommended); (b) lint staff email with a smaller term list now.
- Decision (founder, 2026-10-06): Send from a subdomain (`mail.tarragonhealth.ng`) with SPF, DKIM and DMARC (`p=none` with reports for 2 to 4 weeks, then `quarantine`) before S27 sends partner email. From `Tarragon Health <care@mail.tarragonhealth.ng>` with a monitored Reply-To, not a no-reply address; every email points to the app. Staff email carries no patient name or reading, only a link into the console. Review the two PDF attachments (OQ-91) at the same time.
- Checked 2026-10-06: `mail.tarragonhealth.ng` is verified in Resend (SPF and DKIM). DMARC `p=none` with reports to `dmarc@tarragonhealth.ng` was added in Cloudflare at `_dmarc.mail` and resolves. Still open: the `dmarc@` mailbox does not exist yet (the Zoho login used was not an admin), Resend shows no webhook yet (add it after the S13 migration is applied and `resend-webhook` is deployed), and `RESEND_FROM` and `RESEND_REPLY_TO` are not changed in production because the live sender already reads `RESEND_FROM` and its current value could not be read.
- Done 2026-10-06 (by the build session): created the Resend webhook to `https://koiplnmbgnqnbywhpjlf.supabase.co/functions/v1/resend-webhook` listening for email.delivered, email.bounced, email.complained and email.failed. Its signing secret must be set as the `RESEND_WEBHOOK_SECRET` edge secret by the owner. The `resend-webhook` function is NOT deployed yet (only `send-pending-notifications` is), so Resend will show failed deliveries and retry until S13 is deployed. Done 2026-10-06: the Zoho Group "DMARC reports" (`dmarc@tarragonhealth.ng`, accepts mail from Everyone so outside report senders can reach it, member `kola.longe@tarragonhealth.ng`, no paid seat) now exists, so DMARC reports reach the founder. The Zoho org is "TarragonHealth", Mail Free plan, 3 users.

### OQ-115 availability_blocks arrives in S17, minimal (raised by S17)
- Spec 7.6 rejects a clinician with no current queue block, but S18 owns availability. S17 creates the table with declare and cancel only; a `declared` block counts. S18 adds the rota, confirmation and the minimum guarantee.
- Decision (founder, 2026-10-06): accepted as recommended.

### OQ-116 Who writes conflicts (raised by S17)
- Clinician declares (pending until the CMO confirms or lifts, blocks offers meanwhile, capped at five pending); the CMO records one against a named clinician; a conflict_of_interest hand-back adds one. Only the CMO lifts, with a reason of at least 10 characters. S15's free-text declarations are not parsed.
- Decision (founder, 2026-10-06): accepted. The CMO converts any S15 declarations by hand.

### OQ-117 Hand-back reason codes (raised by S17)
- S16 had `need_more_information` and `unavailable`; S17 changed the check to the spec's `needs_information` and `technical_problem` (table was empty).
- Decision (founder, 2026-10-06): the spec's five.

### OQ-118 Retry returns the existing claim (raised by S17)
- Spec 7.6 says reject at the cap; S17 returns the held claim with `already_claimed: true` so a retry over a dropped connection is safe. Only protects a clinician whose cap is 1; above 1 a retry takes a second task.
- Decision (founder, 2026-10-06): accepted. Revisit with a client request id if any clinician is given a cap above 1.

### OQ-119 Lease extension and heartbeat (raised by S17)
- One extension of the type's timeout, `queue_last_seen_at` on each call, no heartbeat. An expired claimant may reclaim the task. Without a heartbeat a silent expiry cannot be told from a power cut, so an expiry weighs 0.5 in the score and a person reviews patterns.
- Decision (founder, 2026-10-06): accepted. A heartbeat is a later option.

### OQ-120 Employed doctors and Next task (raised by S17)
- An employed doctor takes work pushed to them with no queue block and may also pull from the pool once they declare one.
- Decision (founder, 2026-10-06): both.

### OQ-121 Starvation (raised by S17)
- Strict class order then due time. Backstops: S16 escalates overdue tasks; `queue_health()` now reports the oldest open task per class. No aging rule.
- Decision (founder, 2026-10-06): strict order.

### OQ-122 Reliability numbers and queue limits need the CMO (raised by S17)
- 90 day window, 30 day half-life, prior of 5 events at 0.8, weights (expiry 0.5, other hand-back 0.25, reasoned 0), cooling-off 3 in 10 minutes, hard cap 6 in 60 minutes, review flag above 3 in 7 days, one extension, five pending self-conflicts. All PROPOSED in `queue.claims`. The score only breaks ties (S18) and never gates a claim or changes pay.
- Decision: open. CMO to confirm or change before S18 uses the score.

### OQ-123 Test isolation (raised by S17)
- A test clinician only sees test tasks and a real clinician never sees a test task.
- Decision (founder, 2026-10-06): accepted.
### OQ-124 No `pathway_enrolments` table exists; where does the lead live (raised by S18)
- Spec 7.5 records `pathway_enrolments.lead_clinician_id`, but that table does not exist (RECONCILIATION.md: new table only if care-pack states are needed). The 12-week pack is a `service_purchases` row scoped to a `chronic_programme_enrolment`.
- Options: (a) a `lead_assignments` table (current row plus history, end reasons, config version) anchored to the patient and optionally the purchase, mirrored into `care_team_assignment.clinician_id` in the same transaction (recommended); (b) build `pathway_enrolments` now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-125 Who may be a lead: spec says tier 2, F-05 collapsed tiers (raised by S18)
- Spec 7.5 says "active tier 2 clinicians". F-05 and S16 say doctor tier is the only gate and `credentialing_level` is not used. The `lead_clinician` and `on_call` competencies carry `requires_level` 2.
- Options: (a) lead pool = `lead_clinician` and `hypertension` competencies, active, eligible, doctor tier senior_medical_officer or chief_medical_officer; Medical Officer excluded (recommended); (b) any doctor tier with the competencies.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-126 `order.paid` has no producer until S25 (raised by S18)
- S18 registers the subscriber `lead.assign_on_order_paid` and a callable `assign_lead_clinician`, but nothing emits `order.paid` yet; care packs today are `service_purchases`.
- Options: (a) subscriber now plus a clinical-lead and admin "assign lead" action for the pilot; S25 emits the event (recommended); (b) hook the existing purchase path now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-127 Capacity and cover gates are exposed, not wired (raised by S18)
- Babylon lesson: sales must not outrun declared clinician capacity. S18 builds `lead_capacity_status()` and `rota_coverage_gaps()`; `on_call_cover_ok` has no implementation (S37), so S18 enables no gate (INV-14).
- Options: (a) read functions only; S25 checkout and S37 guard wire them (recommended); (b) block the existing purchase path now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-128 Working-hours, rest and fatigue numbers need clinical review (raised by S18, OQ-112)
- Defaults modelled on the NHS 2016 junior-doctor rules (11 hours rest, at most 7 consecutive shifts, at most 3 on-calls in 7 days) as configurable warnings with an override reason. They are not Nigerian norms.
- Options: (a) ship as PROPOSED warnings, CMO to set values (recommended); (b) leave rest rules off until the CMO supplies numbers.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-129 Patient wording when the lead changes, and whether the patient sees the lead's name (raised by S18)
- Spec 7.5 step 3 says to show the patient "name and photo of the lead clinician". The live care team card (`apps/web/src/components/your-care-team.tsx`), `docs/CLINICAL_TRUST_MODEL_SPEC.md` section 2 and CLAUDE.md ("never describe it as one named doctor") say the opposite: no single doctor's name or photo appears ahead of a real review, and `care_team_assignment.clinician_id` is internal routing only. Reassignment must also be told to the patient.
- Options: (a) keep the card as it is (no name), tell the patient in neutral words whenever their care team lead is set or changes, and keep `my_care_team_lead()` ready for the day the founder decides to show a name (recommended); (b) show the lead's name and photo as the spec says, which reverses the 2026-07-30 founder correction.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it: the patient notices say "your care team lead", never a name; the card is untouched. Pidgin text needs a native reviewer.

### OQ-130 Changing lead on request (raised by S18)
- Not in the spec: a patient asking for a different lead, or a clinician asking to be released from a patient for a non-conflict reason.
- Options: (a) clinical-lead-only action with a reason, audited, ending reason `patient_request` or `clinician_request` (recommended); (b) self-serve.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.

### OQ-131 Chart access starts at acknowledgement, not at the page (raised by S19)
- Spec INV-12 says a clinician sees patients for whom they hold "an on-call page". A paged clinician who has not answered has taken no responsibility, so S19 ties them to the chart only once they acknowledge.
- Options: (a) access from acknowledgement (recommended, built); (b) access from the moment of the page, so a clinician can look before acknowledging.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-132 What a red page should say to Care Circle supporters and the clinical lead's review (raised by S19)
- The spec's red event table also notifies Care Circle members with `red_alerts` and creates an incident review task for the clinical lead. S19 builds the page and the escalation only.
- Options: (a) Care Circle notices in S29 and the review task in S20 (recommended); (b) pull them into S19 now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-133 Acknowledgement targets and how long the lead is re-alerted (raised by S19)
- 5 and 10 minutes (spec) and a 5 minute repeat of the lead alert are PROPOSED numbers with no Nigerian benchmark. No re-alert ever reaches a person after the clinical lead and ops if all of them are away.
- Options: (a) ship the numbers, CMO to set them in `paging_config` (recommended); (b) add a third rung (a named deputy or the founder) with its own phone.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-134 Contractor status and declared hours (raised by S18, second pass)
- Declared availability blocks, a displayed weekly floor and a lead cap can look like control over a contractor (Hims lists contractor classification as a risk in its annual report; Wheel and Amwell Associates are 1099 contractors). Nigerian labour-law treatment of the freelance clinicians is not established here.
- Options: (a) take Nigerian employment-law advice before contracted clinicians are onboarded, and keep the weekly floor a display only (recommended, built); (b) enforce a minimum now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.
- Superseded (2026-10-06): Moot. The scribe is English only (`en-NG`) since Pidgin was removed 2026-10-06 (D-14).

### OQ-135 Strikes and a doctor's other job (raised by S18 and S19, second pass)
- NARD issued an ultimatum effective 1 October 2026 and has struck or threatened in each recent quarter; public hospitals are moving towards biometric work-hour logging; dual jobs are common. A freelance resident could be unreachable inside their own shifts, and the rota assumes people are available when they declared it.
- Options: (a) for now, rely on declared blocks and the backup, with the employed tier and the CMO as the last rung, and record the doctor's main-employer hours later using the existing availability rules (recommended); (b) add a strike-window switch that widens escalation, and a voice-call rung for the CMO tier only (D-12 currently allows push, in-console alarm and email only, so this needs a decision).
- Decision (founder, 2026-10-06): (a), as recommended. S18 and S19 built it.

### OQ-136 Acknowledgement targets are not clinically validated (raised by S19, second pass)
- 5 and 10 minutes match vendor example defaults (PagerDuty, Opsgenie) and the Manchester Triage targets measure first clinical contact, not acknowledgement; the Joint Commission requires a written, measured time but sets none. No Nigerian benchmark was found.
- Options: (a) ship the PROPOSED numbers, record them as policy and review the measured acknowledgement times from `paging_overview` after the pilot (recommended); (b) have the CMO set stricter numbers now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-124 S18 and S19 must merge before the S21 slot RPC (raised by S21)
- S21 books from confirmed `bookable_consultations` blocks. `availability_blocks` is on main-dev (S17) but confirmation, rota and `clinician_offerable` are only on PR 931 (S18 and S19), which is open with merge conflicts.
- Decision (founder, 2026-10-06): merge S18 first. S21 builds everything that does not read the rota first, and the slot RPC lands after PR 931.
- Update (2026-10-06, later): S18 and S19's migrations are now applied to production (ledger rows exist) while PR 931 is not merged, so the database enforces S18's block rules (minimum 2 hours, no declaring over leave). S21's slot function reads confirmed `bookable_consultations` blocks and works with or without S18's code; the S21 proof makes its blocks 2 hours long so it holds either way. PR 931 is merge-blocked on CI, not on conflicts.

### OQ-125 Authoritative encounters table (raised by S21, closes OQ-38)
- Decision (founder, 2026-10-06): new authoritative `encounters` table. `clinical_encounters` stays as a synced projection so current readers keep working. `consultation_scribe_consents` (renamed 2026-10-06, see OQ-161), rooms and events hang off `encounters`.

### OQ-126 How real the call is in S21 (raised by S21)
- Decision (founder, 2026-10-06): link-based Zoom now (audio-first join, server-owned fallback ladder, in-app waiting room and consent), masked phone callback as the last step. An in-app SDK is a later session.

### OQ-127 Cancellation and refund rule (raised by S21)
- Decision (founder, 2026-10-06): full refund when the patient cancels 2 hours or more before. Inside 2 hours a small fixed retention (PROPOSED value in config). A clinician cancel or no-show is always a full refund or a free rebook. The rule is shown before the pay button.

### OQ-128 Consent, transfer mechanism and MDCN text (raised by S21)
- Decision (founder, 2026-10-06): per-consultation in-app consent is accepted for NDPA and GAID purposes, the transfer mechanism covering Supabase, Zoom and Claude is accepted, and the MDCN position on recording and AI is accepted. Recording stays off by default. Counsel has not reviewed these separately.

### OQ-129 Consultations are for adults only (raised by S21)
- Decision (founder, 2026-10-06): no video, audio or phone consultation for anyone under 18. Booking checks the patient's age server-side. A dependant under 18 cannot book. Written questions for minors are not decided and stay as they are today until the founder says otherwise.

### OQ-130 Consultation price (raised by S21)
- Decision (founder, 2026-10-06): NGN 10,000 (1,000,000 kobo) for a consultation, replacing the 5,000 placeholder on `video_visit_credit`. One price for video, audio and phone, so a fallback never changes what the patient paid. Result interpretation (10,000) and written question (2,500) are unchanged.

### OQ-131 Zoom dial-in in Nigeria and the phone fallback (raised by S21; revised 2026-10-06)
- Confirmed 2026-10-06 from Zoom's rates page: Nigeria has toll dial-in (needs the Audio Conferencing add-on, Zoom-provided numbers only) and call-out at about GBP 1.08 to 1.68 a minute, which is too dear for a NGN 10,000 consultation.
- First decision (founder delegated the vendor, 2026-10-06): a Tarragon-owned number bridge on Africa's Talking Voice. Built, then **withdrawn the same day** by the founder: "instead of Africa's Talking, can we just turn off the Zoom video if the network is bad and people can still make the voice call."
- **Decision (founder, 2026-10-06): the phone fallback is Zoom's own dial-in.** The person rings a Nigerian number Zoom publishes for the room and types the meeting id and passcode; they land in the same call as the clinician. No second vendor, no number of ours, no callback route, no table holding anyone's phone number, nothing rung from our side. The older "turn the camera off" half already exists: audio only is offered in the room and an audio-only rejoin comes in audio first. The Africa's Talking adapter, bridge store, callback route and `phone_bridges` table were removed (migration `20261006164657_s21f_drop_phone_bridges_use_vendor_dial_in.sql`; the table had 0 rows).
- Built: `VideoProvider.dialIn` (Zoom reads the meeting's Nigerian numbers and phone passcode from the meeting each time and never stores them; rooms are created with `audio: both` and `global_dial_in_countries: [NG]`), a mock, `requestDialIn` in the room logic, and a "Join by phone call instead" card showing the number, meeting id and passcode with a tap-to-call link.
- **To confirm on the live Zoom account before real use:** (1) the account has the Audio Conferencing add-on, otherwise Zoom lists no toll numbers and the room says "we could not find a phone number" (a safe failure, not a broken call); (2) the Nigerian numbers actually appear in `settings.global_dial_in_numbers` for a meeting created by the Server-to-Server app; (3) `pstn_password` is returned and a phone caller can get past the passcode prompt; (4) a phone caller waits in the waiting room and the host can admit them (they show as a call-in user or a masked number, which is why the clinician is told to expect that); (5) a call costs the patient only their normal carrier charge.
- Consequences to accept: the patient pays the carrier for the call, the call is not private from the clinician's side in the way a bridge was (the clinician may see a masked number in the Zoom participant list), and we cannot see that someone dialled, so a consultation is never marked "on the phone" automatically (the in-app SDK, OQ-136, can). Open until the live checks above are done.

### OQ-132 What a red page should say to Care Circle supporters and the clinical lead's review (raised by S19)
- The spec's red event table also notifies Care Circle members with `red_alerts` and creates an incident review task for the clinical lead. S19 builds the page and the escalation only.
- Options: (a) Care Circle notices in S29 and the review task in S20 (recommended); (b) pull them into S19 now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-133 Acknowledgement targets and how long the lead is re-alerted (raised by S19)
- 5 and 10 minutes (spec) and a 5 minute repeat of the lead alert are PROPOSED numbers with no Nigerian benchmark. No re-alert ever reaches a person after the clinical lead and ops if all of them are away.
- Options: (a) ship the numbers, CMO to set them in `paging_config` (recommended); (b) add a third rung (a named deputy or the founder) with its own phone.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-134 Contractor status and declared hours (raised by S18, second pass)
- Declared availability blocks, a displayed weekly floor and a lead cap can look like control over a contractor (Hims lists contractor classification as a risk in its annual report; Wheel and Amwell Associates are 1099 contractors). Nigerian labour-law treatment of the freelance clinicians is not established here.
- Options: (a) take Nigerian employment-law advice before contracted clinicians are onboarded, and keep the weekly floor a display only (recommended, built); (b) enforce a minimum now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.
- Superseded (2026-10-06): Moot. The scribe is English only (`en-NG`) since Pidgin was removed 2026-10-06 (D-14).

### OQ-135 Strikes and a doctor's other job (raised by S18 and S19, second pass)
- NARD issued an ultimatum effective 1 October 2026 and has struck or threatened in each recent quarter; public hospitals are moving towards biometric work-hour logging; dual jobs are common. A freelance resident could be unreachable inside their own shifts, and the rota assumes people are available when they declared it.
- Options: (a) for now, rely on declared blocks and the backup, with the employed tier and the CMO as the last rung, and record the doctor's main-employer hours later using the existing availability rules (recommended); (b) add a strike-window switch that widens escalation, and a voice-call rung for the CMO tier only (D-12 currently allows push, in-console alarm and email only, so this needs a decision).
- Decision (founder, 2026-10-06): (a), as recommended. S18 and S19 built it.

### OQ-136 Acknowledgement targets are not clinically validated (raised by S19, second pass)
- 5 and 10 minutes match vendor example defaults (PagerDuty, Opsgenie) and the Manchester Triage targets measure first clinical contact, not acknowledgement; the Joint Commission requires a written, measured time but sets none. No Nigerian benchmark was found.
- Options: (a) ship the PROPOSED numbers, record them as policy and review the measured acknowledgement times from `paging_overview` after the pilot (recommended); (b) have the CMO set stricter numbers now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-124 S18 and S19 must merge before the S21 slot RPC (raised by S21)
- S21 books from confirmed `bookable_consultations` blocks. `availability_blocks` is on main-dev (S17) but confirmation, rota and `clinician_offerable` are only on PR 931 (S18 and S19), which is open with merge conflicts.
- Decision (founder, 2026-10-06): merge S18 first. S21 builds everything that does not read the rota first, and the slot RPC lands after PR 931.
- Update (2026-10-06, later): S18 and S19's migrations are now applied to production (ledger rows exist) while PR 931 is not merged, so the database enforces S18's block rules (minimum 2 hours, no declaring over leave). S21's slot function reads confirmed `bookable_consultations` blocks and works with or without S18's code; the S21 proof makes its blocks 2 hours long so it holds either way. PR 931 is merge-blocked on CI, not on conflicts.

### OQ-125 Authoritative encounters table (raised by S21, closes OQ-38)
- Decision (founder, 2026-10-06): new authoritative `encounters` table. `clinical_encounters` stays as a synced projection so current readers keep working. `consultation_scribe_consents` (renamed 2026-10-06, see OQ-161), rooms and events hang off `encounters`.

### OQ-126 How real the call is in S21 (raised by S21)
- Decision (founder, 2026-10-06): link-based Zoom now (audio-first join, server-owned fallback ladder, in-app waiting room and consent), masked phone callback as the last step. An in-app SDK is a later session.

### OQ-127 Cancellation and refund rule (raised by S21)
- Decision (founder, 2026-10-06): full refund when the patient cancels 2 hours or more before. Inside 2 hours a small fixed retention (PROPOSED value in config). A clinician cancel or no-show is always a full refund or a free rebook. The rule is shown before the pay button.

### OQ-128 Consent, transfer mechanism and MDCN text (raised by S21)
- Decision (founder, 2026-10-06): per-consultation in-app consent is accepted for NDPA and GAID purposes, the transfer mechanism covering Supabase, Zoom and Claude is accepted, and the MDCN position on recording and AI is accepted. Recording stays off by default. Counsel has not reviewed these separately.

### OQ-129 Consultations are for adults only (raised by S21)
- Decision (founder, 2026-10-06): no video, audio or phone consultation for anyone under 18. Booking checks the patient's age server-side. A dependant under 18 cannot book. Written questions for minors are not decided and stay as they are today until the founder says otherwise.

### OQ-130 Consultation price (raised by S21)
- Decision (founder, 2026-10-06): NGN 10,000 (1,000,000 kobo) for a consultation, replacing the 5,000 placeholder on `video_visit_credit`. One price for video, audio and phone, so a fallback never changes what the patient paid. Result interpretation (10,000) and written question (2,500) are unchanged.

### OQ-131 Zoom dial-in in Nigeria and the phone bridge vendor (raised by S21)
- Confirmed 2026-10-06 from Zoom's rates page: Nigeria has toll dial-in (needs the Audio Conferencing add-on, Zoom-provided numbers only) and call-out at about GBP 1.08 to 1.68 a minute, which is too dear for a NGN 10,000 consultation.
- Options: (a) Tarragon-owned number bridge on Twilio Voice; (b) LiveKit SIP or a Nigerian carrier trunk; (c) Zoom toll dial-in only, patient pays carrier rate.
- Recommend (a) behind an adapter with a mock, after checking NCC caller-ID rules with the carrier. Vendor choice is the founder's.
- Decision (founder delegated the choice, 2026-10-06, "which one will work in Nigeria, easy to connect, cheap"): **Africa's Talking Voice**. Their published Nigerian rates are about NGN 15 to 20 a minute a leg; Twilio is about USD 0.23 a minute (roughly NGN 350), which makes a bridged half hour dearer than the NGN 10,000 consultation. The adapter, bridge store, protected callback route and a database table are built (`phone-africastalking.ts`, `phone_bridges`, `/api/voice/africastalking/[secret]`). **Not yet run against a live account.** Before real use: create the Africa's Talking account, buy a Nigerian Voice number, set AT_VOICE_* and the callback URL, run the sandbox, and confirm with them (1) the callback fields and that `clientRequestId` is echoed, (2) that a bridged call shows our number to both people, (3) the Nigerian caller-ID rule with the carrier, (4) that the Dial's `maxDuration` is honoured (else cap call length on the number in their dashboard), (5) whether they can sign callbacks or restrict them to their IP addresses (today the only credential is a secret in the callback URL, which Vercel logs), and (6) what they do when a callback reply is lost or retried (today a retry is rejected, so the clinician would not be dialled and the app would show the bridge as connected). Open until then.

### OQ-132 Legacy video paths left alone in S21 (raised by S21)
- `consult_availability_slots` with `video_visit_requests` (a second slot system, used by mobile) and the org-wide `video_consultations` read policy that exposes `host_start_url` to any org staff member each have about 8 call sites. Narrowing either now would blank live screens (the PR 789 failure).
- Recommend: S21 leaves both, routes the new flow through `encounters` and issued join tokens, and a follow-up session inventories and migrates the call sites, then closes the policy.
- Decision: open.

### OQ-133 Cash refund of a cancelled consultation (raised by S21)
- S21 returns the consultation credit when the patient cancels 2 hours or more before, or when a clinician cancels or does not attend. Returning money already paid to Paystack is refund work that belongs to S26 and is not built here (INV-09: no balance, no stored value).
- Options: (a) credit returned, cash refund on request through S26; (b) cash refund automatically.
- Recommend (a) now, (b) when S26 lands.
- Decision: open.

### OQ-134 Pidgin for the scribe consent prompt (raised by S21)
- CON-001 is consent text. The i18n rules keep consent and legal text in one language until a clinician has signed off a translation, and `scribe_enabled` already needs legal review of CON-001 (spec 14). So the `consult.scribe.*` keys have English text in the Pidgin catalogue on purpose.
- Options: (a) English only until legal review and a clinician-signed Pidgin translation exist (recommended); (b) ship a Pidgin draft now.
- Decision: open.
- Superseded (2026-10-06): Moot. The scribe is English only (`en-NG`) since Pidgin was removed 2026-10-06 (D-14).

### OQ-135 Consultations are not behind a go-live guard yet (raised by S21)
- INV-14 and spec 14 say the `clinical_operations_enabled` guard blocks consultations. The guard mechanism (`app_config.go_live`) is S37. Until then a consultation can be booked as soon as a clinician has bookable slots and the patient holds a credit.
- Recommend: S37 wires the guard into `hold_appointment_slot` and `service_get_encounter_room`. Do not switch consultations on for real patients before then, or before the phone bridge vendor (OQ-131), the slot RPC (OQ-124) and the CMO's sign-off exist.
- Decision (founder, 2026-10-06): build it now, so consultations cannot be switched on until the guard is satisfied. S37 built it: `clinical_operations_enabled` is wired into `hold_appointment_slot`, `confirm_appointment_booking`, `service_get_encounter_room` and the booking screen. It starts off and cannot be switched on until an approved hypertension protocol and an approved triage rule set exist (neither does today). The phone bridge (OQ-131) and the CMO's own sign-off of the consultation policy are still separate human steps; the guard does not check them (see OQ-180 follow-ups).

### OQ-136 Automatic fallback needs the in-app call SDK (raised by S21)
- With link-based Zoom the page cannot see call quality and Zoom's presence webhook cannot tell patient from clinician, so automatic downgrade to audio only and automatic phone callback on a dropped call cannot be built honestly in S21. The ladder and its clock are proved in code (`stepLadder`) and the manual steps work (audio-only join, "call me", no-show reporting).
- Options: (a) a later session adds an in-app SDK (LiveKit or Zoom Video SDK, labels we control, client quality stats) and wires `stepLadder` to it; (b) accept manual fallback only.
- **Decision (founder, 2026-10-06): option (a) with the Zoom Meeting SDK, not LiveKit** (same Zoom room, same dial-in numbers, same waiting room). Built in the follow-up on PR 942 (`docs/design/S21.md` section 9):
  - The room joins inside the page with Component View, loaded from Zoom's CDN pinned to 6.5.0, only when the person taps join and only when `ZOOM_SDK_KEY` and `ZOOM_SDK_SECRET` are set. **Any** failure (keys unset, script blocked, unsupported browser, Zoom refusing the join, no host key) opens the existing link exactly as before; the room never depends on the SDK.
  - The SDK's own signals drive the ladder with the real policy: `connection-change` (Reconnecting is a drop, Connected is the return, Closed is the call ending), `network-quality-change` (the vendor's 0 to 5 scale, only while the camera is on, only the person's own link) and `audio-statistic-data-change` (packet loss and round trip, thinned to one sample per interval). Thresholds are `video.audio_fallback` v2 (PROPOSED: 10 percent loss, 600 ms, one sample per 3 seconds); the reconnect grace is the consultation's own policy row.
  - What the ladder now does on its own: `to_audio_only` records the mode change and tells the person to switch their camera off; `offer_video` asks the patient and never switches back by itself (only the patient's tap, and only the patient's client reports the return); a drop shows "your place is held for N seconds" and reports `reconnect_grace_started`; `to_phone` shows the existing dial-in card (numbers, meeting id, passcode) at once. The server still never marks a consultation "on the phone" itself, because it cannot see who dialled.
  - **Finding that changes the wording of the brief: the web Meeting SDK has no programmatic camera control.** Neither Component View nor Client View declares a stop-video or start-video call (read from `embedded.d.ts` and `index.d.ts` of @zoom/meetingsdk 6.5.0). So "turn the camera off in the SDK" cannot be done by us: audio only is a recorded mode plus a clear instruction to the person, as it was for the link. Rooms are created with `participant_video: true`, so a patient who chose audio only can still publish video until they switch the camera off. A consequence: Zoom stops sending the network level once the camera is off, so the way back to an offer of video depends on the audio statistics.
  - The clinician hosts: the SDK needs the meeting owner's host key (ZAK) to start as host (role 1). The adapter fetches it from Zoom (`GET /users/me/token?type=zak`, TTL equal to the join token) only for the clinician role and hands it to that one signed-in clinician; it needs the scope `user:read:zak` on the Server-to-Server app, and the Meeting SDK app must be in the same Zoom account (a Meeting SDK app joining another account's meetings needs an OBF token or ZAK from 23 February 2026; ours are all one account).
  - **Known exposure of the host key, to decide before real use.** The ZAK is the Zoom account owner's key, not the clinician's, and it is not bound to one meeting (only the SDK signature is). A clinician can read it from the server action's response in their own browser while it is valid (the token's lifetime, up to two hours) and, with the Zoom desktop client, could start any other meeting of that account if they knew its number (nine to eleven digits, not secret but not listed to them). Mitigations to choose between: one Zoom host user per clinician (so a ZAK only starts that clinician's own rooms), a short ZAK lifetime tied to the consultation, or no in-app hosting for clinicians (the clinician keeps the host link and only the patient uses the SDK). Until decided, keep the clinician on the link by leaving `ZOOM_SDK_KEY` set only where the patient-side in-app call is wanted, or accept the exposure for a closed pilot.
  - Other review notes, recorded not fixed: the in-app join, like the link, only records presence when `ZOOM_PRESENCE_WEBHOOK` is off or the webhook fires; rooms created before this change have no Nigerian dial-in numbers (settings are applied at creation); a clinician whose own connection fails is routed to the phone card like a patient (the ladder has one phone input); `SDK_TOKEN_SECONDS` and the webhook timestamp window are code constants, not registry values.
  - **Untested, and cannot be tested here (no SDK keys, Free Zoom plan, no live browser call):** that Component View renders correctly inside this Tailwind page (Tailwind's reset may need scoping, the box is `data-testid="call-root"`); that `join` is accepted with `customerKey` and a clinician ZAK; the units of `avg_loss` (assumed percent); whether the SDK needs anything the narrowed consultation CSP refuses (open the browser console on the first live call and look for violations: scripts are allowed from `source.zoom.us` only, with no blob scripts and no new frame source; the evidence for that is in `next.config.ts` and is from reading the 6.5.0 bundle, not from a run; a CSP block after a successful join does not trigger the link fallback, which only covers a failed join); the waiting-room flow (the patient waits on hold until the clinician admits them in Zoom's own participants panel); behaviour on a real weak network and a real dropped connection; the audio-only notice on real devices; whether Server-to-Server OAuth accepts the `me` alias on `/users/me/token` (the existing `createRoom` uses `/users/me/meetings` the same way; if Zoom wants the account owner's user id or email here, set it in the adapter); the Meeting SDK's minimum signature lifetime (believed to be about 30 minutes; our signature is capped at the room's end, so a join with less time left may be refused and fall back to the link). Treat the first live consultation as a test with a clinician watching, and read `encounter_events` afterwards.
  - Mobile is unchanged (OQ-158): the Expo app has no SDK embed, so the automatic ladder is a web feature for now.

### OQ-158 Mobile Care flow (raised by S21)
- The consultation room and Care tab changes are on the web (responsive). The Expo app keeps its own older video-visit screens, which hand off to the Zoom app by link. A mobile consultation room needs an EAS dev-client build to check on a device, which this session could not do.
- Recommend: a short mobile session after S21 merges: the waiting room, consent prompt and "call me" over the same RPCs, then device-tested. Decision: open.
- **Built 2026-10-06 (founder decision: build it with unit tests, flag it as untested on a phone). NOT RUN ON A REAL PHONE, NOT RUN IN ANY SIMULATOR OR EMULATOR.** Patients only (clinicians stay on the web). In the Care area: a "Your consultations" card (`my_upcoming_encounters`) and a consultation room screen: waiting room (when it opens, whether the care team has joined, refresh every 10 seconds while live and the app is in the foreground, slower while offline), the AI note-taker question (`open_scribe_prompt` then `record_scribe_consent`; shown as saved only after both succeed), "Join with video" and "Join with audio only" (the link comes from the server and is handed to the Zoom app with `Linking.openURL`; never stored or logged), "Join by phone call instead" (Zoom dial-in number as a tap-to-call link, meeting id, passcode; held in memory for the screen only), "Tell us nobody came" (`mark_encounter_no_show`, the wait rule stays the server's), and the ended and cancelled states. Joining and dial-in go through two bearer-authenticated routes, `/api/mobile/consultations/join` and `/api/mobile/consultations/dial-in`, which call the same `joinConsultation` and `requestDialIn` as the web room. No database change was needed. All strings are in `packages/i18n` (en and pcm).
- **What is proved and what is not.** Jest covers the routes (19 tests, including that a clinician or stranger is refused), the room state machine with the network mocked (polling floor, no overlap, background pause, offline, join, dial-in, scribe, no-show, link never kept), the database wrappers and the model. The mobile Jest setup has no component renderer, so the two screen files themselves (layout, the Zoom app hand-off, tap-to-call, accessibility labels read by VoiceOver or TalkBack, dark mode, large text) were never rendered anywhere. Before any release: build an EAS dev client, then on one iOS and one Android phone run join with video, join audio only, dial-in, the consent answer failing offline, and "nobody came". Android is the priority (the main user base), including a low-end device on a weak network.
- **Needs the web deploy first.** The two routes live in `apps/web`, so the app cannot join or dial in until that is deployed. The list, the waiting room and the consent question work against the database alone. This change is JS only (no native config or `runtimeVersion` change), so it can ship over the air once a build with runtime 0.2.0 exists.
- **Review fixes (2026-10-06):** join and dial-in are no longer retried blind after a timeout (a repeat would issue a second link or log a second ask); "the vendor is not set up" is an ordinary 200 answer with a reason code, so a gateway 503 is no longer read as "no phone number". Left as known: the two screens have no render test; polling a not-found consultation continues at the slower pace while the screen is open; a caregiver acting for someone cannot use the mobile room (the web room has the same rule).
- Status: built, unverified on a device. Decision on release: open.

### OQ-159 Clinician access after "Finish consultation" (raised by S21 review)
- `complete_encounter` marks the appointment completed, as the older `set_video_consultation_call_state` already does. `private.clinician_has_patient_access` only ties a clinician to a patient through a live appointment (and the other clauses), so after Finish a clinician who is not on that patient's care list can no longer open the chart to write the note or prescribe (INV-12 is doing its job; the timing is the problem).
- Options: (a) add one clause to `clinician_has_patient_access`: "my encounter with this patient ended in the last N hours" (recommended; the function is also being changed on the S19 branch, so this must be applied on top of whichever lands last, re-reading the live definition first); (b) keep the appointment `in_progress` until a signed note exists; (c) tell clinicians to finish last (done: the room says so).
- **Decision (founder, 2026-10-06): until a signed note exists, capped at 72 hours** (the third option, with a cap). One clause on `private.clinician_has_patient_access` in migration `20261006183117_s21g_...` (the body repeats the live definition read on 2026-10-06 after S16 and S19, plus the clause): a clinician keeps the patient they finished a consultation with until a finalized note exists for that consultation (`clinical_encounter_notes.video_consultation_id` equals the encounter's), for at most `chartAccessAfterFinishMaxHours` (72, PROPOSED, consultation policy v2). The room's finish hint says so. Another clinician never gains access this way.

### OQ-160 "Joined" is recorded when the link is issued, not when someone enters the call (raised by S21 review)
- A person can no longer report their own join from the app; the server records it after checking the person and the join window. With link-based Zoom the server still cannot see anyone enter the call, so a clinician who requests the link and never enters still counts as joined and can defeat a no-show report.
- **Decision (founder, 2026-10-06): real presence from Zoom's own webhook, with an identity that does not come from the client.** `POST /api/zoom/webhook` verifies Zoom's signature (the adapter's `parseWebhook`), maps `meeting.participant_joined` and `meeting.participant_left` to `service_record_join` and a `left` event, and answers Zoom's one-time URL challenge. The old "joined means the link was issued" path stays as the default and as the fallback for people who join by plain link or by phone.
- **Spoofing and the display name.** The label is chosen by the client, so a patient could join as "clinician". The webhook therefore ignores the label for identity. Zoom's published webhook reference lists `customer_key` ("the participant's SDK identifier") on the participant object, and the Meeting SDK `join` takes a `customerKey`, so the server mints one per (encounter, role): `p` or `c` plus 34 hex characters of HMAC-SHA256(server secret, "tarragon.participant.v1:encounter:role"), 35 characters (kept short of 36 to be safe; the limit was not confirmed in Zoom's docs). Only a key that verifies for the encounter the room belongs to counts, and its role is the role it was minted for. Tests prove a patient calling themselves "clinician", a made-up key, a key from another consultation and a label with no key all record nothing or only the patient's own role (sabotage: trusting the label fails 6 checks).
- **Residual weaknesses, stated plainly.** (1) A person who joins Zoom by plain link, by phone or from the Zoom app has no customer key and so proves nothing; they are never recorded by the webhook, only by the legacy path while it is on. **Consequence found in review, not new but now visible:** a patient who joins ONLY by phone dial-in (the very person the phone fallback is for) is not recorded as joined by anything, so the consultation never reaches in progress and the clinician could report them as absent after the wait. The dial-in path has never recorded a join (OQ-131: we cannot see who dialled). Options: record a join when the dial-in details are given (spoofable, like the old link path) only for a patient who is already on the consultation, or have the clinician confirm the caller in the room. Decide before real use. (2) A person can read their own key in their browser and pass it to someone else; that only lets someone present as that same role on that same encounter, never as the other person. (3) The key is deterministic per (encounter, role), so it does not expire by itself; the join window in `service_record_join` bounds it. (4) A webhook cannot say whether someone joined with video or audio, so the join is recorded with mode `unknown` (the `mode_changed` events carry the real mode). The room has a waiting room on, so a patient is first in the waiting room and `meeting.participant_joined` fires only when the clinician admits them; the waiting-room arrival event (`meeting.participant_joined_waiting_room`, which also carries `customer_key`) is therefore treated as arriving too, so a waiting patient counts as joined exactly as before and the clinician cannot report them absent. Subscribe the Zoom app to that event as well. Presence rows are not de-duplicated: a reconnect or a Zoom retry can add another `joined` row (harmless to the rules, which only ask whether one exists). (5) The URL-validation answer is an HMAC under the same secret that signs events, so on its own it would let anyone obtain a valid signature for a forged event body; the route therefore refuses a challenge that could be a signed message (a colon, whitespace or more than 256 characters; Zoom's real token alphabet is not documented, so this is a denylist), and `parseWebhook` now also refuses a validly signed event whose timestamp is more than five minutes from now (replay), both proved by tests. **The older `zoom-webhook` edge function had the same oracle (same secret, no check); it carries the same guard now (one shared helper, `isSafeWebhookChallenge`), but is NOT redeployed from here, and it still has no replay window (its signature check is older than this work and is not changed here): add the same five-minute check and redeploy it, or move the Zoom subscription to the new route.** Unverified: whether Zoom re-stamps `x-zm-request-timestamp` on a retried delivery; if it does not, a retry after five minutes is refused as stale (401) and presence for that event is lost, so watch the first live retries. (6) Webhook events are retried by Zoom on a non-2xx answer; the route answers 500 only for failures worth retrying and 200 for refusals the database will always repeat. (7) Zoom's published docs name `customer_key` on webhook participants, but an older forum request (closed 2021) asked for it on the join and left events; it was **not verified against a live event**. If a real event arrives without it, every key-less event is ignored and presence silently never records, which is why the switch below exists.
- **The safe default and the switch.** Presence from the webhook turns on only with `ZOOM_PRESENCE_WEBHOOK=1`, set after the event subscription points at `/api/zoom/webhook` and the URL validation has succeeded and a real event with `customer_key` has been seen. Until then the in-app join records the join when the person is given the way in (the old behaviour), so a missing webhook can never leave two people in a call that the database thinks nobody entered (which would let one report the other as absent and return a credit). **To do:** the new route handles participant events only and ignores `meeting.started` and `meeting.ended`, which the older `zoom-webhook` edge function turns into `video_consultations` status changes, so moving an app's single subscription URL to the new route would stop those; Zoom delivers an app's events to the URLs on its event subscriptions; the older `zoom-webhook` edge function shares the secret token, so decide whether the new route is a second subscription on the same app or the edge function forwards to it. Looking up the room by `provider_room_id` is a scan of a small table; add an index if consultation volume makes it matter.
- **Review fixes (2026-10-06, `/code-review high` on the SDK PR).** (1) **One subscription, both features:** Zoom takes one event-subscription URL per app, and it stays the older `zoom-webhook` edge function. That function now hands `meeting.participant_joined`, `..._joined_waiting_room` and `..._left` to `/api/zoom/webhook` unchanged (`forwardPresenceEvent`, with `APP_BASE_URL` already set as an edge secret), which verifies the signature itself; a 502 makes Zoom retry. Subscribe the app to those three events plus meeting started and ended and point it at the function, never at the route. The function used to key its audit row on the meeting only, so two people joining the same meeting collided and the second was dropped as a replay; participant events are now forwarded before that step. (2) **A present patient cannot be marked absent by a missing key:** the patient's join is still recorded when they are handed the way in (the link, the SDK, or the dial-in numbers), also with presence from the webhook on; only the clinician's join waits for the vendor, which is the case OQ-160 set out to close. Consequence: a patient who asks for a way in and never enters blocks the clinician's no-show report, exactly as the link flow always did. (3) **Silent failures show up:** an event for one of our consultations with no participant key is logged per event (so a vendor that never sends `customer_key` is visible), and a correctly signed event outside the 5 minute window is answered 200 and logged (new `stale_event` code) instead of 401, which Zoom counts as a failing endpoint. (4) **CSP:** on the consultation routes script and worker code may come only from `https://source.zoom.us/6.5.0/` (the pinned SDK path), not the whole host; the test fails if the version drifts from `ZOOM_SDK_VERSION`. Still true: `'unsafe-inline'` stays on these pages (the app's own inline scripts, until a nonce is added across the app), and the integrity hash covers only the first file, not what it loads. (5) **Still open, needs a decision:** the clinician's host key (ZAK) is not tied to one meeting (OQ-136).
- Decision: closed once the live checks above pass; open until then.
### OQ-137 Who are the backup readers for safety concerns (raised by S20)
- Context: spec 7.8 says a concern goes to the clinical lead and cannot be seen by ops. "Ops" here is an admin account (OQ-24), and there is no superadmin role, so nobody can be a backup by role. If the lead is away, conflicted or is the subject, nothing else can read it.
- Built: a named list (`safety_concern_readers`) that only the lead can add to. A concern nobody acknowledges within 48 hours (4 hours if the person marked it immediate) also becomes readable by them. A concern raised by the lead itself goes to them at once. With no one named, a neutral incident is opened so operations see that something is overdue, never what.
- Recommendation: name the founder (as a person, not as an admin account) as the first backup reader, and a second senior reviewer when one is hired.
- Decision (founder, 2026-10-06): the founder is the first backup reader, named as a person by the clinical lead (`add_safety_concern_backup_reader`), not by admin role. Add a second senior reviewer when hired. **Follow-up: the CMO calls the function once the migration is live.**

### OQ-138 Who audits the chief medical officer's own tasks (raised by S20)
- Context: the reviewer must be an eligible chief medical officer who is not the clinician. With one CMO, the CMO's own audits have no reviewer and stay unassigned (shown at the top of the lead's queue, and the nightly sweep retries).
- Recommendation: a second senior reviewer once hired; until then accept unassigned, or the founder reviews them in the lead area.
- Decision (founder, 2026-10-06): leave the CMO's own audits unassigned until a second senior reviewer exists. They show at the top of the lead's queue and the nightly sweep assigns them when a reviewer is added.

### OQ-139 May a safety concern be anonymous (raised by S20)
- Context: research (NHS Freedom to Speak Up) favours protected-but-named reporting because follow-up, feedback and the 12 month retaliation review all need an identity. A fully anonymous route cannot do those.
- Built: named but protected (readable only by the raiser, the lead and named backup readers).
- Recommendation: keep named but protected. Revisit only if clinicians say they will not use it.
- Decision (founder, 2026-10-06): named but protected. No anonymous route.

### OQ-140 The audit and speak-up numbers need the CMO (raised by S20)
- Context: 10 percent random sample plus every red event and titration, one audit per clinician per month once they complete 3 tasks, reviewer cap 40 a month, 14 days to complete, 20 audited tasks for level 1, pass mark 85 with no critical miss, score bands 85 and 70, reliability weight 2, acknowledge within 48 hours (4 for immediate), respond within 14 days, 12 month retaliation window. All PROPOSED in `quality_config` (mirrored as `quality.audit`).
- Recommendation: the CMO reviews the form items and the bands before the first real audit; changing any number is a new config version, never an edit.
- Decision (founder, 2026-10-06): accepted as proposed for a start, pending the CMO's sign-off (`quality.audit` stays `proposed`; changing any number is a new config version).

### OQ-141 Credential warning windows and the 31 December cluster (raised by S20)
- Context: S15 warns at 90, 30 and 0 days. Research suggests 60, 30, 14 and 7 days plus a reminder from November, because MDCN annual licences cluster at the end of December (MDCN lists 31 December for renewal; verify the current rule, fee and CPD requirement before relying on it).
- Not built here: this is S15's `credential_rule('notice_windows_days')` configuration, not S20's.
- Recommendation: add a November reminder and a capacity check before 1 January once the roster is large enough for a cluster to matter.
- Decision (2026-10-06): keep [90, 30, 0] for now. The mechanism already reads from `credentialing_config` via `credential_rule('notice_windows_days')`, so changing to [90, 60, 30, 14, 7, 0] is a one-row config update, not code. The November cluster reminder and a capacity-planning dashboard are worth adding once the roster is large enough for a 31 December cluster to create operational risk. Closed as configurable; reopen when the roster exceeds approximately 20 clinicians.

### OQ-150 What makes a patient a Member (raised by S22, built in S22b)
- The 2026-10-05 Membership has no checkout yet (S25). Until then a patient is a Member when `patient_memberships` has an active, in-date row, or still has the old `async_doctor_visit` plan feature. Only an admin (`/admin/members`) or the CMO (`/clinician/members`) can grant or end one, with a reason, audited; a dated membership lapses by itself. S25's checkout, a sponsor's Care Voucher and an employer's cohort should write the same table with source `purchase`, `voucher` or `employer`. The seam stays `private.patient_is_member(uuid)`. A grandfathered paid `async_consult_credit` still works for a non-Member. This reverses OQ-130 (the 2,500 per-question price): the per-question credit is no longer sold.

### OQ-151 Written question allowance and window are PROPOSED (raised by S22)
- 4 written questions per member per month, 24 hour window, 7 day free follow-up, up to 3 photos. All in `async_question.behaviour` v1, owner CMO. The founder asked the build to choose the allowance: four is about one a week beside 12 monthly calls, keeps a 24 hour window staffable, and a missed window returns the question. Review after the first month of real use. No rollover.

### OQ-152 Notes: stored states and `body jsonb` (raised by S22)
- Spec 4.3 wants `notes.state` and `body jsonb`. Live `clinical_encounter_notes` wins (OQ-23): `status` stays `draft` or `finalized`, and the S05 `public.notes` view derives `draft`, `signed`, `amended`. No `body jsonb`: the history, examination, assessment, diagnosis and plan columns already are the structured sections. A second stored state or a duplicate body would be two sources of truth.

### OQ-153 NDPA correction deadlines and MDCN text-only limits (raised by S22)
- Counsel to confirm the NDPA response deadline for a correction request on a clinical record and any clinical-record carve-out, and the primary MDCN telemedicine text on asynchronous advice (research read it only through secondary sources). The design does not depend on either: a correction is attached beside the note and never deletes; no written question ever produces a diagnosis (founder, 2026-10-06), a patient who needs one is called.

### OQ-154 Written questions for under-18s (raised by S22, extends OQ-129)
- Adults only. A minor's question is refused with a plain message. Whether a guardian may submit for a child is for the founder and CMO.

### OQ-155 Patient access to signed notes reverses part of OQ-58 (raised by S22)
- OQ-58 (2026-10-01) gave patients the published summary only. Founder decision 2026-10-06: summary by default, and the signed note on request once a clinician releases it, with a recorded withhold reason when not released, and CMO-only release for protected categories. OQ-58 is amended, not removed: nothing is released automatically.

### OQ-156 Pidgin strings for S22 need a native reviewer (raised by S22, extends OQ-19)
- Every new `pcm` string for written questions, the red-flag guidance shown before sending, the allowance and the release screens was written by the build session. The red-flag text is safety wording and must be reviewed with the CMO before the next store build.
- Superseded (2026-10-06): Moot. Nigerian Pidgin was removed from the product on 2026-10-06 (D-14), so no S22 `pcm` strings exist to review.

### OQ-157 Direct staff reads of `async_consults`, `care_messages` and summaries (raised by S22; closed by S22d and S22e)
- Closed: `async_consults` (S22: staff read only through the audited, claim-tied function), `consultation_patient_summaries` (S22d: staff only through a tie to the patient).
- Open, and a decision for the founder and CMO: `care_messages`, `care_message_threads` and `care_message_attachments` are the care team's shared inbox, readable by any org staff account (coordinators answer logistics there) and not audited per read (INV-10, INV-12). Options: (a) keep the inbox org-wide and add an audited "open thread" function so every read of message bodies is logged; (b) tie bodies to clinicians with a relationship to the patient (lead, claim, escalation, appointment) and let coordinators see only thread headers, which needs messages routed as tasks; (c) leave as is and record the decision. S22 recommends (a) as the smallest change that closes INV-10, and a separate decision on (b).
- **Decided 2026-10-06 (founder): option (a).** The inbox stays org-wide. Built in S22e (migration `20261006171107_s22e_audited_care_inbox.sql`, PR #948, applied to production, merged): staff open a thread or attachment only through `open_care_thread_audited` or `open_care_attachment_audited`, which write an `audit_log` row (`care_thread.open`, `care_attachment.open`) once per person per thread per 10 minutes. Staff can still read thread headers and the draft text they review. The staff branch is gone from the `care_messages` and `care_message_attachments` select policies, and the AI draft's `input_snapshot` (last messages verbatim) is no longer readable by staff. Patients, supporters with messaging access and break-glass readers read as before. Known and accepted: clinician alert excerpts of a flagged message still carry up to 500 characters of text (needed to triage an emergency). Option (b), tying message bodies to clinicians with a relationship to the patient, is still a separate decision and is not made.

### OQ-161 Two scribe consent records: patient answers in the app (S21) or the clinician records it (S23) (raised by S21)
- S23 (AI scribe) was built in parallel and its migration `20261006112016_s23_scribe_consents.sql` is live. Its `public.scribe_consents` is keyed by `encounter_note_id`, is **written by the clinician** (an insert policy needs an active clinician and a trigger stamps them), and records `language`. S21's consent is **answered by the patient in the app** at the start of every consultation (`open_scribe_prompt`, `record_scribe_consent`, `scribe_may_start`), stored per encounter. INV-11 and spec 9.3 describe the patient's own answer (CON-001 shown in the patient app); the clinician-recorded model is what the Abridge suits allege is the weak point (consent typed by someone other than the patient).
- To avoid a name collision S21's table is now `public.consultation_scribe_consents`. Two records of the same consent must not both exist: they can disagree.
- Options: (a) the patient's in-app answer is the only consent. S23 starts transcription only when `scribe_may_start(encounter)` is true and writes its `scribe_consents` row from that answer (server-side, never from a clinician's click), keeping the table as the audit and retention record (recommended); (b) keep the clinician-recorded model and drop S21's prompt (not recommended: against INV-11 and the research); (c) both, with transcription needing both.
- **Decision (founder, 2026-10-06): (a), as recommended.** The patient's in-app answer is the only consent. Built in migration `20261006183117_s21g_scribe_consent_patient_only_and_chart_access_after_finish.sql`: a granted `scribe_consents` row is accepted only while `scribe_may_start` is true for that clinician and patient (a live consultation the patient allowed in the app), is tied to that encounter by a new `encounter_id` stamped by trigger (the client cannot supply it), and the patient's withdrawal revokes the row and deletes its transcript in the same transaction. A recorded decline needs no precondition. S23's consent dialog no longer asks "I agree" for the patient: it starts the note-taker and says so when the patient has not allowed it; "Write the note myself" records nothing. S23's proof gained the patient-answer fixture. Consequences: a consultation that is not an S21 encounter (the older video-visit path) cannot use the scribe, because there is no in-app answer to read.
### OQ-170 No ledger posting for catalogue orders yet (raised by S25)
- v5 orders sit beside the live purchase tables and never touch `payment_transactions`, so none of the live finance posting triggers see them. A paid order is therefore not in the general ledger, the revenue-recognition views or the settlement reports. It is visible, not hidden: `payments` holds every verified payment with price, fee and total, and `orders.state` is the status. No money has moved through it (checkout is dormant).
- Needs a finance decision before the module is switched on: accounts for Membership (deferred revenue over 12 months?) and care pack income, where the Paystack fee sits (the patient pays it; it is not income and not a cost), and the refund reversal. S26 (refunds) and S30 (earnings ledger) are the natural place.
- Options: (a) a `finance_post_from_order` function that posts `payments` rows, built with the finance owner before go-live (recommended); (b) write a mirror row into `payment_transactions` so the live posting runs (rejected for now: it would also fire the service-purchase, voucher and fraud triggers, which read the same table).
- **Resolved 2026-10-06 (founder: "fix this")**: built in the same migration. Same accounts as a live service pack, so the finance pages need nothing new: Membership or care pack, Dr 1020 / Cr 2000 for the PRICE and a straight-line schedule into 4020 over the access window; an item with no window, Dr 1020 / Cr 4100 at sale. The processing fee is the patient's and Paystack settles the price, so it is not posted. Test orders are never posted (INV-13). A posting failure never undoes a payment: it opens a financial incident and an hourly job retries. The refund reversal is S26. The finance owner should still read the accounts above before go-live; they are the ones the existing service-pack posting uses.

### OQ-171 Paying for someone else is not open yet (raised by S25)
- `orders` carries `buyer_profile_id` and `beneficiary_patient_id`, but `create_order` refuses any beneficiary other than the buyer (`order_beneficiary_not_allowed`) until S29 (Care Circle) defines who may pay for whom and what the supporter may see. Spec 19.4 and 19.5 (supporter pays, sponsor-paid shown as already paid) wait for it. `shop.paid_for_you` is already in the catalogue strings.
- Decision: open, S29.

### OQ-172 Care pack price and what is sold at launch (raised by S25)
- The 2026-10-05 Membership (100,000 naira a year, 10,000,000 kobo) is founder-confirmed and seeded as `membership_annual`. The spec's 12,000 naira three-month BP care pack (spec line 696) is PROPOSED and seeded as `bp_care_pack_3m`. Both are seeded OFF. Do both exist at launch, or does the Membership replace the care pack? A Member who also buys a care pack would pay twice for overlapping clinician time. The lead-clinician capacity gate counts both.
- Options: (a) launch with the Membership only and keep the care pack off (recommended: matches the 2026-10-05 pivot, "Free or Member, nothing in between"); (b) both on.
- **Decided 2026-10-06 (founder): Membership only.** The care pack is no longer seeded; staff can add one later. Prices can be changed at `/admin/catalogue` with a reason; an order keeps the price it was made at.

### OQ-173 Retired payment code paths are still reachable (raised by S25, extends OQ-97)
- The OQ-97 decision said to delete the retired GBP/USD and plan-based paths in S25 "if unreachable". They are reachable: `handler.ts` still handles `subscription`, `add_on`, `sponsored_subscription` and the plan events, `apps/web/src/lib/paystack` still allows GBP and USD, and live rows in the older purchase tables depend on them. Removing them is a separate removal session with its own row count and `ship the code first, the schema second` order, not a side effect of a checkout build.
- S25 added the v5 branch and left the legacy one untouched. Naira only holds for everything S25 built (`create_order` has no currency; the adapter and `record_order_payment` reject anything but NGN).
- **Decided 2026-10-06 (founder): its own removal session after S26** (count live rows first, ship the code before the schema, prove with a rolled-back test).

### OQ-174 Fee estimate is configuration, and its numbers are unverified (raised by S25, extends OQ-97)
- Paystack has no fee-preview call, so the checkout shows an ESTIMATE labelled as one, from `commerce.processing_fee_estimate` (1.5 percent plus 100 naira, the 100 waived under 2,500 naira, cap 2,000 naira). The figures come from third-party summaries; the official pricing page could not be read when this was written. The exact fee is read from the verified payment and recorded on the order and receipt. Cards issued abroad cost more (reported 3.9 percent plus 100 naira, uncapped), so for those the estimate is too low; the screen says so (`pay.fee.international` exists, shown in the explanation block on web).
- Still to confirm against Paystack test mode before go-live: the field names `requested_amount` and `fees` on verify and `charge.success` (OQ-97). If `requested_amount` is absent, the database records an `amount` mismatch rather than accepting a different total, so a genuine payment is held for a person, never lost silently.
- Refunds and the fee (S26): recommended full refund when we cancel returns the fee, a patient-requested partial does not; Paystack reportedly keeps its processing fee on refunds, which would make a fee refund a Tarragon cost.
- **Fee numbers confirmed 2026-10-06** against paystack.com/pricing: local card and USSD 1.5% + NGN 100 (NGN 100 waived under NGN 2,500), capped at NGN 2,000; international 3.9% + NGN 100. Registry entry is now v2, confirmed. At the 100,000 naira Membership price the local fee is NGN 1,600 (total NGN 101,600). Still open: the `requested_amount` and `fees` field names in test mode, and the refund-and-fee rule (S26).

### OQ-175 Secrets and deploy steps for S25 (raised by S25)
- Before the module can be tried against Paystack test mode: set `ORDER_RETURN_URL` and `ORDER_RECONCILE_SECRET` as function secrets, add the Vault secret `order_reconcile_secret` with the same value (the 5-minute cron fails closed with a 401 until both exist), deploy `order-checkout`, `order-verify`, `order-reconcile` and the updated `paystack-webhook`, then run one test-mode payment end to end and one replay from the Paystack dashboard. Nothing in S25 was deployed or applied to production by the build session.
- Secrets and deploy done 2026-10-06. **Go-live order decided (founder):** merge PR 945, run one Paystack TEST-mode payment and one dashboard replay (the founder runs it with test keys in a local copy of the function secrets, with a published Paystack test card; the live key is never used), then a superadmin runs `set_platform_module('v5_checkout', true, '<why>')` and switches `membership_annual` on at `/admin/catalogue`. Nothing is switched on before that.
### OQ-170 Medicine safety checks beyond allergy, duplicate and controlled (raised by S24)
- Blocks: none. S24 enforces three checks at signing: a controlled medicine is a hard stop (no override), an allergy match or an empty allergy list or a duplicate active medicine needs the signer's stated reason. Drug-drug interaction, renal dosing, dose-range and drug-in-pregnancy checks need reference data this platform does not hold (a licensed interaction source and a CMO-approved dose table). The BP-class combination and pregnancy rules in `private.enforce_bp_prescribing_safety` still apply.
- Options: (a) the CMO and a pharmacist choose the reference source and S24b loads it as versioned data (recommended); (b) licence a commercial interaction service; (c) leave as is.
- Recommend (a). Until then the sign screen must not imply that an interaction check ran.

### OQ-171 Titration step table and the first approved protocol (raised by S24)
- Blocks: the "Suggest next step" button producing a proposal for a real patient. `public.protocols` has no row; the evaluator is built and tested on a placeholder marked draft with fictional drug names. The CMO writes the `htn_hearts_ng` definition (steps, thresholds, review window, adherence floor) and approves it. Until then the button answers "no approved step table yet" and a clinician proposes changes by hand.
- Decision needed from the CMO: the step table content, and the proposed stop thresholds (minimum readings, adherence floor, review window, stale-readings limit) which are PROPOSED values inside the protocol, not code.

### OQ-172 Who reviews an engine proposal, and when (raised by S24)
- A proposal is a draft `care_plan_changes` row that the lead clinician sees in the patient's chart panel. There is no queue task for it because a new task type needs CMO sign-off (the S16b pattern). Options: (a) add a `titration_review` task type, class 3, created when an engine proposal is saved (recommended once the step table exists); (b) weekly digest to the lead; (c) leave it chart-only.

### OQ-173 Caregivers, guardians and dependants confirming a change (raised by S24, extends OQ-70)
- Only the patient can confirm or decline a signed change. A parent of a dependant, or a caregiver holding the medications permission, cannot, so a change for a dependant simply expires after the window. Decide whether a guardian may confirm for a child and whether a caregiver may confirm for an adult who cannot (and with what proof).

### OQ-174 The confirm function acts as the signer for the length of the apply (raised by S24)
- `confirm_care_plan_change` runs for the patient but, so that every existing medication trigger sees the signer's own act (attribution, the clinician allow-list, confirm-only, prescribing safety), it sets the transaction-local session claims to the signer and puts them back before returning. It runs only after the patient, signed state, expiry, re-check and signer authority checks, and fails closed if the signer has lost authority. The alternative is to teach each trigger a signed-change exception, which spreads the exception across eight triggers. Security review wanted before go-live.

### OQ-175 Two copies of the controlled-medicine list (raised by S24)
- `apps/web/src/lib/rules/controlled-substances.ts` (PDF guard, advisory text) and `private.prescription_safety_findings` (the new hard stop) hold the same illustrative list. It is not an NDLEA or NAFDAC schedule lookup. A pharmacist or the CMO should own one list; until then add a name in both places.

### OQ-176 Service-role writes bypass the signed-medicine trigger (raised by S24)
- The medicine signature trigger applies to API sessions (role `authenticated`). A server route using the service role, or a migration, is trusted code and is not stopped. No current route writes a clinician-source medicine that way (checked 2026-10-06); a code scan test is the follow-up that would keep it so.

### OQ-177 What a consultation share is a share OF, inside the Membership (raised by S30)
- D-11 says the consultation share is configurable, and spec 7.7 says `consultation_share_pct` by consultation type. But under the 2026-10-05 Membership model there is no per-consultation price: consultations are inside the 100,000 naira a year Membership, so a "percent of the price" has nothing to be a percent of. **Built**: the share applies to the paid purchase amount when the consultation has one; otherwise to an optional `consultation_reference_price_kobo` per type that the founder sets in the schedule; otherwise the line is a zero line flagged "no price basis" for an admin to correct with an adjustment (never skipped). **Recommendation**: set a reference price per type, or drop the share and pay consultations as a fixed fee per type like tasks (a small change: add the types to `task_types`). Decide which.

### OQ-178 Fee sharing and the MDCN code (raised by S30; counsel needed)
- The MDCN Code of Medical Ethics forbids fee splitting and payment for referrals (public text, not checked against the current official copy). A percentage of a consultation the clinician delivers themselves is pay for their own service, but whether MDCN reads a percentage of a price paid to Tarragon that way is a legal question. Percentages are configuration the founder sets, and may be set to 0 for every type. **Recommendation**: get a one-page opinion from Nigerian counsel before any non-zero share; until then set all three to 0 and use fixed fees only.

### OQ-179 On-call shift fee: the backup, and being ready (raised by S30)
- Spec 7.7 has one `on_call_shift_fee_kobo`. **Built**: it is paid to the primary when the shift ends; the backup is paid `backup_fee_pct` of it (PROPOSED 0, in `earnings_config`). The fee does not depend on the clinician being paged or acknowledging anything. **Decide**: should the backup be paid something, and should a shift where the primary was marked as not reachable (S19 escalation reached the backup) pay differently?

### OQ-180 The pilot minimum can be earned by declaring hours and doing nothing (raised by S30)
- **Built**: only confirmed, eligible blocks count; only the shortfall is paid; one top-up per merged run; contracted clinicians only. **Not built**: any check that the clinician actually took work while declared (claims that expired for inactivity, S17 reliability events, an empty queue is not their fault). **Decide** the rule, or accept the risk for the pilot and review the first month's top-ups by hand (the admin summary shows them as their own kind).

### OQ-181 Work finished before the first schedule is approved (raised by S30)
- There is no schedule in the database until the founder approves one. **Built**: a finished task or consultation waits (the admin page shows how many); once a schedule is approved the sweep posts them at the FIRST approved schedule and the line says `retroactive_first_schedule`. **Decide**: confirm that is the intent, or pay such early work by hand with adjustments.

### OQ-182 The wait step is read at the final claim (raised by S30)
- Spec 7.7 says the step depends on how much of the due window had passed. **Built**: measured when the clinician who finishes the task claimed it. If a task is handed back and someone else claims it, the second clinician's step includes the time the first one held it. **Decide**: keep (simple, and the next clinician is rewarded for clearing something old), or measure from the first time the task became available to anyone.

### OQ-183 Staff screens use plain English in the page, not `packages/i18n` (raised by S30)
- The S30 prompt says every user-facing string goes through `packages/i18n` (en, pcm). Every existing admin and clinician page in `apps/web` (members, rota, credentialing) uses inline English, so the two S30 pages match them. The i18n package is for patient-facing text. **Recommendation**: staff screens stay English (the platform decision for staff tools); confirm.

### OQ-184 Refunds, tax and employed doctors who convert (raised by S30; deferred)
- A refunded purchase does not reverse a consultation share automatically; an admin posts a negative adjustment. S26 (refunds) should call a reversal. Withholding tax is stored nowhere and calculated nowhere (D-09). A clinician who changes from `employed` to `contracted` earns lines only for work finished after the change and a clinician changed the other way keeps their old lines (each line records `employment_type` as at entry).

### OQ-185 A late line can push a clinician past the pilot minimum (raised by S30)
- The top-up for a run of declared hours is computed once, from the lines in the ledger when the run is processed (two hours after it ends). A line posted later for work done inside the run (a retried posting, work finished before any schedule existed, a retroactive first schedule) is not netted off, so the clinician can end with more than the guarantee. The amounts are small and visible. **Decide** whether to reverse and repost top-ups when a late line lands, or accept it for the pilot.
### OQ-171 update (S24b, 2026-10-06): the CMO's screen for the step table now exists
- `/clinician/titration-protocols` lets the Chief Medical Officer paste a definition, check it, save it as a draft and approve it (functions `save_protocol_draft` and `approve_protocol`, CMO only, audited). The build wrote no clinical content and approved nothing: the page starts empty. Until the CMO approves a definition for `htn_hearts_ng`, "Suggest next step" still says no approved step table.

### OQ-174 update (S24b, 2026-10-06): reviewed and hardened; independent review still advisable
- Review: `docs/security/S24-confirm-care-plan-change-review.md`. Changes: the signer must hold a currently verified, unexpired licence when the change is applied; a signed stop that matches no active medicine is sent back; the session identity is asserted to be the patient's again before any later write. Residual: the signer's tie is not re-checked at confirm time (CMO to confirm that reading), and the review was written by the build session, so an outside reviewer is still advisable.

### OQ-170 No ledger posting for catalogue orders yet (raised by S25)
- v5 orders sit beside the live purchase tables and never touch `payment_transactions`, so none of the live finance posting triggers see them. A paid order is therefore not in the general ledger, the revenue-recognition views or the settlement reports. It is visible, not hidden: `payments` holds every verified payment with price, fee and total, and `orders.state` is the status. No money has moved through it (checkout is dormant).
- Needs a finance decision before the module is switched on: accounts for Membership (deferred revenue over 12 months?) and care pack income, where the Paystack fee sits (the patient pays it; it is not income and not a cost), and the refund reversal. S26 (refunds) and S30 (earnings ledger) are the natural place.
- Options: (a) a `finance_post_from_order` function that posts `payments` rows, built with the finance owner before go-live (recommended); (b) write a mirror row into `payment_transactions` so the live posting runs (rejected for now: it would also fire the service-purchase, voucher and fraud triggers, which read the same table).
- **Resolved 2026-10-06 (founder: "fix this")**: built in the same migration. Same accounts as a live service pack, so the finance pages need nothing new: Membership or care pack, Dr 1020 / Cr 2000 for the PRICE and a straight-line schedule into 4020 over the access window; an item with no window, Dr 1020 / Cr 4100 at sale. The processing fee is the patient's and Paystack settles the price, so it is not posted. Test orders are never posted (INV-13). A posting failure never undoes a payment: it opens a financial incident and an hourly job retries. The refund reversal is S26. The finance owner should still read the accounts above before go-live; they are the ones the existing service-pack posting uses.

### OQ-171 Paying for someone else is not open yet (raised by S25)
- `orders` carries `buyer_profile_id` and `beneficiary_patient_id`, but `create_order` refuses any beneficiary other than the buyer (`order_beneficiary_not_allowed`) until S29 (Care Circle) defines who may pay for whom and what the supporter may see. Spec 19.4 and 19.5 (supporter pays, sponsor-paid shown as already paid) wait for it. `shop.paid_for_you` is already in the catalogue strings.
- Decision: open, S29.

### OQ-172 Care pack price and what is sold at launch (raised by S25)
- The 2026-10-05 Membership (100,000 naira a year, 10,000,000 kobo) is founder-confirmed and seeded as `membership_annual`. The spec's 12,000 naira three-month BP care pack (spec line 696) is PROPOSED and seeded as `bp_care_pack_3m`. Both are seeded OFF. Do both exist at launch, or does the Membership replace the care pack? A Member who also buys a care pack would pay twice for overlapping clinician time. The lead-clinician capacity gate counts both.
- Options: (a) launch with the Membership only and keep the care pack off (recommended: matches the 2026-10-05 pivot, "Free or Member, nothing in between"); (b) both on.
- **Decided 2026-10-06 (founder): Membership only.** The care pack is no longer seeded; staff can add one later. Prices can be changed at `/admin/catalogue` with a reason; an order keeps the price it was made at.

### OQ-173 Retired payment code paths are still reachable (raised by S25, extends OQ-97)
- The OQ-97 decision said to delete the retired GBP/USD and plan-based paths in S25 "if unreachable". They are reachable: `handler.ts` still handles `subscription`, `add_on`, `sponsored_subscription` and the plan events, `apps/web/src/lib/paystack` still allows GBP and USD, and live rows in the older purchase tables depend on them. Removing them is a separate removal session with its own row count and `ship the code first, the schema second` order, not a side effect of a checkout build.
- S25 added the v5 branch and left the legacy one untouched. Naira only holds for everything S25 built (`create_order` has no currency; the adapter and `record_order_payment` reject anything but NGN).
- **Decided 2026-10-06 (founder): its own removal session after S26** (count live rows first, ship the code before the schema, prove with a rolled-back test).

### OQ-174 Fee estimate is configuration, and its numbers are unverified (raised by S25, extends OQ-97)
- Paystack has no fee-preview call, so the checkout shows an ESTIMATE labelled as one, from `commerce.processing_fee_estimate` (1.5 percent plus 100 naira, the 100 waived under 2,500 naira, cap 2,000 naira). The figures come from third-party summaries; the official pricing page could not be read when this was written. The exact fee is read from the verified payment and recorded on the order and receipt. Cards issued abroad cost more (reported 3.9 percent plus 100 naira, uncapped), so for those the estimate is too low; the screen says so (`pay.fee.international` exists, shown in the explanation block on web).
- Still to confirm against Paystack test mode before go-live: the field names `requested_amount` and `fees` on verify and `charge.success` (OQ-97). If `requested_amount` is absent, the database records an `amount` mismatch rather than accepting a different total, so a genuine payment is held for a person, never lost silently.
- Refunds and the fee (S26): recommended full refund when we cancel returns the fee, a patient-requested partial does not; Paystack reportedly keeps its processing fee on refunds, which would make a fee refund a Tarragon cost.
- **Fee numbers confirmed 2026-10-06** against paystack.com/pricing: local card and USSD 1.5% + NGN 100 (NGN 100 waived under NGN 2,500), capped at NGN 2,000; international 3.9% + NGN 100. Registry entry is now v2, confirmed. At the 100,000 naira Membership price the local fee is NGN 1,600 (total NGN 101,600). Still open: the `requested_amount` and `fees` field names in test mode, and the refund-and-fee rule (S26).

### OQ-175 Secrets and deploy steps for S25 (raised by S25)
- Before the module can be tried against Paystack test mode: set `ORDER_RETURN_URL` and `ORDER_RECONCILE_SECRET` as function secrets, add the Vault secret `order_reconcile_secret` with the same value (the 5-minute cron fails closed with a 401 until both exist), deploy `order-checkout`, `order-verify`, `order-reconcile` and the updated `paystack-webhook`, then run one test-mode payment end to end and one replay from the Paystack dashboard. Nothing in S25 was deployed or applied to production by the build session.
- Secrets and deploy done 2026-10-06. **Go-live order decided (founder):** merge PR 945, run one Paystack TEST-mode payment and one dashboard replay (the founder runs it with test keys in a local copy of the function secrets, with a published Paystack test card; the live key is never used), then a superadmin runs `set_platform_module('v5_checkout', true, '<why>')` and switches `membership_annual` on at `/admin/catalogue`. Nothing is switched on before that.

### OQ-176 Lab panel ranges and critical limits are unsigned (raised by S27)
- `lab.panels` (registry, mirrored by `lab_panel_versions` v1) holds adult reference ranges and critical limits for the Essential and Annual Health Check panels, PROPOSED by the build, owner CMO. They are not adjusted for age, sex or pregnancy, and the lipid limits are desirable targets, not lab-printed ranges, so many results will wait for review.
- Safe by design: a wrong range only adds reviews. An all-normal result is the only thing that auto-releases, and a result missing a required analyte is held too.
- Needed from the CMO: sign the ranges and critical limits (a new `lab_panel_versions` row, never an edit); whether HIV, HBsAg and HCV Ab belong in the Annual Health Check at all (they are optional and entered only if ordered); how an indeterminate screening value is handled (the portal refuses it today and asks for a new sample).

### OQ-177 The older partner PDF path conflicts with INV-03 (raised by S27)
- `lab_partner_upload_result` and the `lab_result_documents` triggers (live since 2026-07-27) let a patient read a partner's PDF at once and send them a "result document available" notice, with no hold for abnormal values and no sensitive-positive rule. Left unchanged, as the session rules require; the new partner portal does not use it.
- Recommended: point the old worklist upload at the new submit function (PDF only, held for review) and retire `lab_partner_upload_result` after counting live rows. Founder decision needed on timing.

### OQ-178 Releasing a result does not complete its queue task (raised by S27)
- `release_lab_result`, `record_lab_disclosure` and `withhold_lab_result` change the result, not the S16 task (`routine_result_review`, `critical_result_review`, `sensitive_result_disclosure`). The clinician still completes the task in the queue. Linking the two is a small follow-up once the Next-task console (S35) shows the task beside the result.

### OQ-179 Audio and AI explanation layers must read `explain_allowed` (raised by S27)
- `my_lab_results()` returns `explain_allowed = false` for a result with a sensitive positive and for a patient's own upload. The old AI summary on `lab_result_documents` and any future audio bundle (S32) do not read it yet. Before either is shown for a structured result, it must check this flag (INV-04).

### OQ-180 Who may release a critical value (raised by S27)
- A critical result creates a `critical_result_review` task for a senior doctor (class 2), but `release_lab_result` lets any eligible clinician tied to the patient release it. A positive HBsAg, HCV Ab or HIV needs a senior clinician by the database. Confirm with the CMO whether a critical result should need the same.

### OQ-181 Free patients' own outside uploads wait without a reviewer (raised by S27 review)
- Doctor time is a paid feature, so a Free patient's own upload creates no task (S27b). It stays held, and the patient is told it is waiting. A Member's upload makes a `routine_result_review` task. Decide whether Free patients should be told plainly that it will be looked at once they join, or whether the upload should be refused for them.
- Also found: a clinician refused by the tie check raises, which rolls back the "denied" audit row (`lab_review_actor`). The refusal is still enforced, but not recorded. Fixing it means returning a result instead of raising; left for a follow-up that changes the shared pattern, not just this module.

### S27c decisions (founder, 2026-10-06)
- **OQ-176 (part):** HIV, HBsAg and HCV Ab BELONG in the Annual Health Check. They stay optional per order (entered only when the test was actually done with the patient's consent), and any positive follows INV-04. Ranges and critical limits are still unsigned by the CMO.
- **OQ-177 CLOSED for the partner path:** `lab_partner_upload_result` and the old worklist upload now create a HELD result (S27c). Related, found while fixing it and not changed: the staff upload path for emailed results (`uploadResultDocumentForPatient`, Lab Liaison, clinician, admin) still writes a visible `lab_result_documents` row and notifies the patient at once. Same INV-03 class; needs its own decision.
- **OQ-178 CLOSED:** release, disclosure and withhold close the linked task (completed when the acting clinician holds the claim, cancelled with a reason when unclaimed, left alone when claimed by someone else).
- **OQ-179 PARTLY CLOSED:** one definition of "may be explained" in the database (`lab_result_explain_allowed`, also used by `my_lab_results`). No AI or audio path reads structured results today, so there is nothing yet to gate; S32 (audio) and any future AI summary must call it.
- **OQ-180 CLOSED:** a critical value can be released only by a Senior Medical Officer or the CMO.
- **Audit findings CLOSED:** a refused clinician now gets a returned refusal (the denied audit row commits); the review page opens a result only on click.
### OQ-190 Should the platform send the Care Circle invite itself, by email? (raised by S29)
- Today the patient shares the invite link from their own phone (share sheet or copy). INV-08 allows SMS only for sign-in codes and WhatsApp is removed, so no platform SMS or WhatsApp path exists. Email is an allowed channel, but `notifications` rows need a `recipient_id` (a profile) and an invitee may have no account yet.
- Options: (a) keep patient-shared links only (recommended for now: no new send path, nothing to leak, works for a phone invite too); (b) add an edge function that emails an email-type invite through Resend with the neutral template "Someone invited you to their Care Circle" and the link, rate-limited per patient.
- Recommendation: (a) for launch; revisit (b) if diaspora supporters turn out not to receive links reliably.
- **Decided 2026-10-06 (founder): patient-shared links only.** No platform-sent invite email. Revisit if diaspora supporters turn out not to receive links reliably.

### OQ-191 A paid-for care pack starts a lead assignment for a patient who did not ask for it (raised by S29)
- Pay for a loved one lets a supporter holding `pay_for_care` buy a care pack, and a paid care pack triggers lead clinician assignment (S18) for the beneficiary like any care pack. The patient ticked `pay_for_care`, is told "someone has paid for your care" and can remove the supporter, but is not asked to accept the pack itself.
- Options: (a) the tick is the consent; no further step (built); (b) a gifted care pack stays "waiting for you to accept" and assigns the lead only when the patient accepts in the app (needs an `accepted_at` on the entitlement and a screen).
- Recommendation: (b) before the care pack is switched on for sale; (a) is fine while only the Membership is sold, because it assigns no lead.
- **Decided 2026-10-06 (founder): yes, a gifted pack waits for the patient's acceptance.** Built in migration `*_s29b_gifted_care_pack_acceptance.sql`: a gift that grants a lead (care pack, Membership) is paid but pending; no Membership starts and no lead is asked for until the patient accepts (`respond_to_gifted_pack`); a decline refunds the payer through a finance incident (S26 builds refunds) and tells the payer nothing; an unanswered gift is swept as declined after `gift_decide_days` (30, PROPOSED). Proof `s29b_gifted_care_pack.sql`.

### OQ-192 Several older read paths admit ANY profile_access grantee with no permission check (found by S29)
- Found while deciding where Care Circle members live: `profiles_select` (the whole patient profile row), `booking_requests_select`, `vaccination_adverse_events_select`, `vaccination_card_extractions_select`, and the vaccination record and schedule updates admit any `profile_access` grantee, whatever `permissions` or categories they hold. For legacy family and caregiver grants that may be intended (a guardian of a child), but a caregiver with only `view_appointments` can read the patient's whole profile and booking requests.
- S29 does not touch them: Care Circle members are stored in a separate table that none of these policies read, so the Circle is not affected. There are 0 `profile_access` rows live today.
- Options: (a) leave until `profile_access` has real rows and the family flow is next reviewed; (b) tighten each to the matching category or permission now (a change to the RLS surface of several tables, to be proved with a simulated session and a control).
- Recommendation: (b) in its own small session, before any real caregiver grant is created.

### OQ-220 Supporters abroad: organisation, signup and the join link (raised by S29)
- The Care Circle, like the older care-access guard, requires the supporter and the patient to share an `organisation_id`. A supporter signing up from the diaspora lands in the default organisation today, so it works, but only because there is one. Signing up from an invite link loses the link across the email-verification redirect (the user reopens it).
- Not changed. If a second organisation or a distinct diaspora organisation is ever created, `accept_care_circle_invite` and `create_order` need an explicit cross-organisation rule.
- Native app deep links for the join link are not built (the link opens the web page).

### OQ-221 What a red alert tells a supporter, and who chose it (raised by S29, extends OQ-132)
- A member holding `red_alerts` gets "Someone in your Care Circle may need you. Please call them." in the app and as push, for every ROOT page (red event), once. No condition, reading or grade is shown, but the message itself says something is wrong. The patient ticks it knowingly (the wording says "when my care team sees something urgent"), and can untick it any time.
- To confirm with the founder and counsel: the NDPA basis (the patient's explicit consent, per tick), whether amber events should ever alert a supporter (built: red only), and whether a supporter abroad needs a second channel (built: push, in-app only; SMS is barred by INV-08).

### OQ-222 Care Circle PROPOSED values and permission wording to confirm (raised by S29)
- `care_circle.rules` v1 (PROPOSED, Founder): invite link lasts 72 hours, default access 365 days (choices of 30, 90, 365 offered), 5 invites a day per patient, 8 members, 5 wrong-account tries, 8 weekly averages. The five permission labels (`circle.perm.*`) are plain-language drafts; the Pidgin lines have not been reviewed by a native speaker.
- Not signed off by anyone: confirm by publishing a v2 entry as `confirmed`.

### OQ-223 The Care Circle contact hash has no secret pepper, and a payer can learn some state of the person they pay for (found by the S29 review)
- `invitee_hash` is plain SHA-256 of the normalised phone or email. Nigerian mobile numbers are about 10^10 possibilities, so the hash is reversible by anyone who can read the table. A keyed hash (HMAC) needs a server secret outside the database (a Vault secret added by hand, like `order_reconcile_secret`), so it was not done in this build without the founder adding that secret. Until then the invitee contact is hashed, not protected.
- `create_order` for a beneficiary raises `already_member` and `no_capacity`, which tells a payer holding only `pay_for_care` whether the patient already has a membership. Kept on purpose (the payer needs to know why a payment was refused); a single generic refusal for beneficiary orders is the stricter alternative.
- Recommendation: add the Vault pepper and move to HMAC before real invites are made; keep the payer messages.
- **Decided 2026-10-06 (founder): add the Vault secret.** Built: the S29 migration creates the Vault secret `care_circle_contact_pepper` (random per environment, if absent) and hashes invitee contacts with HMAC-SHA256 under it (`private.circle_contact_hash`); with no secret an invite fails closed (`circle_not_configured`). Rotating the secret makes every pending invite unusable. The payer-sees-membership-state message stays as it is.

### OQ-192 addendum (2026-10-06): live `create_order` already let any `profile_access` grantee pay
- S26's `create_order` (live since 2026-10-06) allows ANY `profile_access` grantee, whatever their permissions, to buy for the patient. The S29 `create_order` keeps that path (so nothing live changes) beside the Care Circle `pay_for_care` path, with the organisation and test-flag checks added to both. A gift that grants a lead now waits for the patient's yes whichever path paid. Tightening the older path to `manage_payments` is part of OQ-192.



### OQ-180 Guards live in `go_live_guards`, not `platform_modules` (raised by S37; conflicts with OQ-18)
- OQ-18 said go-live guards reuse `platform_modules`. `set_platform_module()` needs only a superadmin and a note, never evaluates a condition against data, and its row is updatable by the table owner. S37's requirement is a switch only a condition-evaluating function can flip, with who, when and why in an append-only log, provable even against the migration role. So S37 added `go_live_guards`, `go_live_guard_log` and `go_live_attestations` and left `platform_modules` untouched (it still serves the payer, provider-org, NGO and `v5_checkout` modules).
- Options: (a) keep two mechanisms, `platform_modules` for dormant whole platforms and `go_live_guards` for clinical go-live (recommended; the two answer different questions); (b) later migrate the four `platform_modules` rows onto the guard table and retire it, which needs each module's RLS and route guards re-pointed.
- Decision: open. Not blocking.

### OQ-181 Test accounts pass the guard as a pair (raised by S37)
- A booking where the patient and the clinician are both `is_test` passes `clinical_operations_enabled` (and the scribe start check passes `scribe_enabled`), so the consultation flow can be tried end to end with test accounts in the single production database before launch, and the existing DB proofs (all test accounts) keep their meaning. A real person is never reachable: `profiles.is_test` is changeable only by an admin or a service context.
- Options: (a) keep the test-pair rule (recommended); (b) remove it and exercise consultations only after launch (not recommended: nothing could be tested first).
- Decision: open.

### OQ-182 A guard that is on is not switched off when its condition lapses (raised by S37)
- If the only tier 2 clinician is suspended while consultations are on, the guard stays on and the dashboard shows a red notice. An automatic switch-off would close a live consultation service without a human decision, which is itself a patient-safety event; the existing rota gap alert and credential suspension already page people.
- Options: (a) show the notice only (recommended; as built); (b) send the founder and the CMO an in-app notice when a guard drifts (small, additive follow-up); (c) auto-switch-off (not recommended).
- Decision: open.

### OQ-183 Attestations are one person's word (raised by S37)
- Conditions the database cannot see (CON-001 legal review, speech provider configured, fee schedule approved, Paystack transfers configured, SYNLAB results flow tested, Stage 2 exit criteria) are recorded as attestations by an admin or the CMO with a note. No attestation exists; none was written by an agent. They are not verified by the system.
- Options: (a) accept a single attester with a permanent record (recommended for a solo founder); (b) require two people (founder and CMO) for the clinical ones.
- Decision: open.

### OQ-184 Guards wired later, and what each still needs (raised by S37)
- Not wired in S37 because each feature is either already live (and wiring would switch off running behaviour) or not on main-dev yet: `on_call_cover_ok` (care pack sales, not built), `lab_booking_enabled` (health check sales are live with SYNLAB active: wiring it now would stop them, so it needs a decision to either seed it on with the conditions recorded or leave it unwired), `prescribing_enabled` (S24 is PR 943), `payouts_enabled` (S30), `public_signup_enabled` (the pilot allow-list, `pilot_invites`), and the remainder of `clinical_operations_enabled`: "all clinical tasks" is live with S16 and left running; "care pack sales" is not built; the lab result consult request flow (`lab_result_consult_requests`, accept/reschedule/release functions) is live (one real cancelled request) and left running, so a real patient can still buy and book a result consult with the guard off. Wiring it is a founder decision because it would switch off a running flow; written questions (S22 `async_consults`) are likewise unguarded. Also not guarded: other places that create `video_consultations` and Zoom meetings directly (clinician escalation video, annual-review video, availability-slot video, the mobile health-check confirm-video-slot route) and `ensure_appointment_video_consultation`, which joins an already-booked appointment even after a switch-off. They need an inventory like OQ-132's before the guard can honestly be described as blocking every consultation; until then the dashboard lists exactly what is enforced. Also known: `reschedule_appointment`, the waiting-list functions (`join_waiting_list`, `offer_next_waiting_list_candidate`) `confirm_health_check_video_slot`, `ensure_appointment_video_consultation`, `mark_encounter_no_show` (a paused, paid consultation can still be marked a patient no-show, with no credit returned: the stop button needs a rule for bookings it interrupts) and the mutating room functions (`service_open_encounter_room`, `service_record_join`; the guard is read by the room view every caller goes through) still run while the guard is off (an offered hold is refused at confirm), the mobile `bookAppointment` shows the raw refusal text, and switching the guard off while people hold paid, confirmed bookings needs a decision on how they are told or refunded (the room says consultations are paused and that the care team will say what happens).
- Recommend: each session that builds the feature wires its guard in the same PR, using `private.go_live_open(key, patient, clinician)` in the database function and `go_live_guard_is_open` in the client.
- Decision: open.

### OQ-187 The room view still enables the join buttons while the guard is off (raised by S37)
- The room also still asks the patient to allow the AI note-taker while `scribe_enabled` is off (the answer is then refused with the generic save error), because the room view carries no scribe flag. `consultation_room_view` (S21c) feeds the room page and does not read the guard, so with the guard off the Join buttons can be enabled inside the join window and a press says consultations are paused; outside the window the page still says when the room opens. The refusal is correct (`service_get_encounter_room` and `joinConsultation`); the page text is not. Needs a one-line change to that view.
- Decision: open.

### OQ-186 The guard tables are deployment-wide, with no organisation_id (raised by S37)
- CLAUDE.md says every table has `organisation_id`. A go-live guard is one fact for the whole deployment (like `platform_modules` and `platform_switches`, which carry none either), and the log, attestations and sign-offs are read through one global admin-or-CMO policy. If a second organisation is ever onboarded onto this production database, an admin of one could read the other's guard history and attestation notes.
- Options: (a) accept as deployment-wide while there is one organisation (recommended; recorded in the migration header); (b) add `organisation_id` and scope the reads before a second organisation is onboarded.
- Decision: open.

### OQ-185 More conditions the guard does not check yet (raised by S37)
- The spec lists three conditions for `clinical_operations_enabled`. The consultation flow also depends on the CMO's confirmation of `consultations.policy` and the other PROPOSED values it uses, a configured Zoom account with dial-in (S21f), and the scribe's `CON-001` text. The sign-off screen now records the first; nothing stops the guard being switched on while it is unconfirmed.
- Options: (a) add "the consultation policy value is confirmed by the CMO" as a data condition once the CMO has used the screen (recommended; small); (b) leave it as a human check at switch-on.
- Decision: open.

## Raised by S35 (clinician area and patient summary)

### OQ-209 The S35 screens are in `apps/web`, not `apps/console` (raised by S35)
- The session plan put them in the console. The console serves only roles whose home is an extracted area, `clinician` is not, CLAUDE.md forbids widening it, and the other 215 clinician files are still in `apps/web`. Founder decision 2026-10-06: build under `/clinician` in `apps/web` now, as thin routes over shared components and package logic, so a later extraction is a move. Same answer as OQ-99 (credentialing).
- Decision: decided (founder, 2026-10-06). Extraction itself stays S01d step 8.

### OQ-210 The consultation room does not host the scribe or the patient summary (raised by S35)
- The scribe panel, the note editor and signing live in the note editor (`clinical-encounter-notes-section.tsx`, reached from the video-visit page), which is where a draft becomes a signed note (INV-11). The consultation room links to it ("Notes, scribe and prescribing"). `consultation_room_view` returns no patient id, so the room cannot open the audited summary, and `consultation_prep_bundle` still keys on `video_consultations.id`, not `encounters.id` (S22 design says build on `clinical_encounters`).
- Options: (a) add the patient id to the room view for the participating clinician only, then mount the summary and the scribe panel in the room (recommended, a small migration plus a component move); (b) leave the link.
- Decision: open.

### OQ-211 Two scribe consents (raised by S35)
- `consultation_scribe_consents` (S21, answered by the patient, read by `scribe_may_start`) and `scribe_consents` (S23, inserted by the clinician, the only one `scribe-draft` and `attach_scribe_draft_to_note` check) are unrelated. The edge function never reads the patient-answered row, so a patient who declines in the room does not stop a clinician recording consent on their behalf. Spec 9.3 has the patient answering in the app.
- Options: (a) make `scribe-draft` and the clinician insert require the patient's `granted` row for the same encounter (recommended; INV-11); (b) keep the clinician-recorded consent for phone consults where the patient has no room.
- Decision: open.

### OQ-212 Playwright for the clinician flows could not be written to run (raised by S35)
- Next task, hand-back, claim timeout and scribe sign need a clinician, a competency, a queue availability block and a claimable task. Tasks are created by `private.create_clinical_task`, which the API cannot call, and `apps/web/e2e-browser` has only a service-role REST helper and no direct database connection. The scribe draft also needs the model key. These are covered at the database (`s17_queue_next`, `s23c`, `s35_clinician_patient_summary`) and in Jest, not in a browser.
- Options: (a) give `e2e-browser` a `pg` connection helper to the local stack and add a seeded clinician fixture (recommended, its own session); (b) a test-only `public` seeding function behind the local-stack guard.
- Decision: open.

### OQ-213 Admin patient search: rate limit and who may open (S36a)
- Blocks: nothing. Live: `admin_patient_search` returns at most 25 rows and writes one audit row per search; exact email and phone digits are searchable, so a determined admin could probe whether an email is registered.
- Options: (a) accept, since the caller is the single founder admin and every search is audited (recommended while there is one admin); (b) a per-hour search cap once a second admin or delegated support role exists; (c) widen to a `support.patient_lookup` permission for the support team (needs a decision on what support may see, since opening a record shows date of birth and email).
- Decision: open. Recommend (a) now, (c) when support is staffed.

### OQ-214 Directory freshness and re-verification cadence (S36, spec 25.3 and 25.9)
- Blocks: the directory freshness build. Live: only licence-expiry notices exist for labs and pharmacies; no listing has a last-verified or next-due date. The research found no competitor that publishes a re-verification schedule.
- Options: (a) 12 months for every partner, 6 months for pharmacies; (b) tie the interval to the partner's licence expiry; (c) risk-tiered by volume.
- Decision: open. Needs the founder (partner terms) and the CMO (clinical partners). PROPOSED values live in versioned config, never in code.

### OQ-215 Payout approval and the ops "prepare draft" half (S36, spec 9.4 and roles table)
- Blocks: the payout screens. Live: S30 fee schedules and `earnings_ledger` exist with `payout_id` empty; S31 (payouts table, weekly draft job, Paystack transfers) is not built, so there is nothing to approve.
- Options: (a) wait for S31 and build both halves there (recommended); (b) build a read-only "unpaid earnings by clinician" view for ops now (small, test accounts excluded).
- Decision: open. Maker-checker (preparer and approver different people, enforced in the database) is the design in `docs/research/S36.md`.

### OQ-216 Speak-up concerns screen (S20, S36)
- Blocks: the clinician and lead screens for safety concerns. Live: the S20 functions exist; concerns are readable only by the person who raised them, the CMO and named backup readers, and never by operations. The founder is not yet a named backup reader (OQ-158).
- Decision: open. Build only after the CMO names backup readers and reviews the wording shown to someone raising a concern. Not in S36.

### OQ-220 Admin accounts can still reinstate a clinician directly (S36d, spec 9.4)
- Blocks: nothing. Spec 9.4 says only the clinical lead reinstates. Live (S15, unchanged): `public.reinstate_clinician` admits an admin account or the CMO (`can_credential_review`); the S15 proof reinstates as an admin. The new roster gives operations (a delegated `clinical_staff.manage` holder) only a REQUEST door, and `decide_clinician_change` is CMO only (an admin account is refused). The /clinician/roster screen is the CMO's; /admin/ops/clinicians offers ops no reinstate button.
- Options: (a) accept while the founder holds the only admin account (recommended); (b) tighten `reinstate_clinician` to the CMO and change the S15 proof, a one-line change to a shipped function.
- Decision: open. Recommend (a) now, (b) when a second admin exists.

### OQ-221 Role grants do not expire (S36d, spec roles table)
- Blocks: showing a grant expiry. Live: `user_permission_grants` has no expiry column, so the history view shows "No expiry" for every grant. Adding one means changing `private.has_permission`, the most reused security function (it gates RLS on many tables).
- Options: (a) accept; revoke by hand, the history shows who granted what and when (recommended now); (b) add `expires_at` and honour it in `has_permission`, with its own proof and a full re-run of the RLS tests.
- Decision: open.

### OQ-222 Ops cannot suspend through S15's own door (S36d)
- Blocks: nothing. S15's `suspend_clinician` admits only admin or CMO; ops is a delegated permission, so `ops_suspend_clinician` (reason of 10+ characters, audited, runs S15's own internal suspend) was added for `clinical_staff.manage` holders. Decision wanted: should ops be allowed to suspend at all without the CMO, or only to request it? Suspension is the safe direction (it removes a clinician from queues), which is why it was allowed.
- Decision: open. Recommend keep.

### OQ-223 Competency request notice reaches admins and the CMO only (S36d)
- Blocks: nothing. A request notifies reviewers (admin accounts and the active CMO) in app only; the requester is told in app when it is decided. No email, since the notice contains a clinician name.
- Decision: open.

### OQ-224 Roster is filtered to the caller's organisation (S36d)
- Blocks: nothing. `clinician_roster` shows clinicians of the caller's own organisation (all of them if the caller has no organisation, as the cross-org superadmin pattern elsewhere). S15's `credentialing_expiry_overview` does not filter by organisation. Decide if the platform will ever run more than one clinical organisation.
- Decision: open.
### OQ-225 Display settings of the reliability and SLA dashboard (S36e)
- Blocks: nothing; the dashboard works on the proposed values. Live in `reliability.dashboard` (PROPOSED, CMO owner): the rota gap view looks 7 days ahead; operations sees a score distribution only for a group of at least 5 clinicians; three neutral bands (85 and above, 70 to 84, under 70).
- Options: confirm, or change the three numbers. A smaller minimum group lets operations see a distribution for a small team, which makes a score close to one person's own.
- Decision: open. Needs the CMO (the sign-off screen at `/clinician/go-live` lists it).

### OQ-226 Which "SLA" the lead means (S36e)
- Blocks: whether to show more. Tasks are measured against each task's own due time (`clinical_tasks.due_at`, from the task type). Red-event pages are measured against the first escalation time in `paging_config` (5 minutes). The older `escalation_slas` (12 h critical result, 24 h abnormal result, for the alert ladder) is a different clock and is not on this page.
- Options: (a) as built; (b) add the older result-contact clock as a third panel.
- Decision: open. Needs the CMO.

### OQ-227 Who sees a clinician's own reliability score (S36e)
- Blocks: nothing. As built: only the CMO sees names with scores, listed by name and never by score. An administrator and an ops holder get aggregates and a distribution only (withheld below the minimum group). S17 lets the administrator read the raw events directly through its own RLS; this page does not widen that.
- Decision: open. Needs the founder and the CMO: should the founder also see the named list?

### OQ-228 No history or alert on this dashboard (S36e)
- Blocks: trend and alerting. The page is a live snapshot (pages and hand-backs over the 90-day reliability window); it stores nothing and sends nothing. There is no daily snapshot table, no chart over time and no export.
- Options: a daily snapshot job later (as S38 does for outcomes); a CSV export for the CMO (named data, audited).
- Decision: open. Not built in S36e.

### OQ-229 A new function instead of widening the S17/S18/S19 reads (S36e)
- Blocks: nothing. `queue_health()` is administrator-only and not organisation-scoped; `rota_coverage_gaps()`, `on_call_cover_status()` and `paging_overview()` admit only the credential reviewer (admin or CMO), so none serves an ops holder. Widening four functions would have changed four gates; one new read function (`reliability_dashboard`, a new name so no overload risk) reads the same tables and the same gap rule (`private.rota_gaps`) for both doors. Consequence: the dashboard re-implements the "waiting" count; if S16 changes what counts as waiting, update both.
- Decision: open. Reconcile when `queue_health()` is next touched.
### OQ-235 Directory verification cadence is built as PROPOSED, not signed (S36g, refines OQ-214)
- Blocks: calling the schedule final. Built: 12 months for every listing, 6 months for pharmacies, in `directory_verification_config` v1, mirrored as `directory.verification_cadence` (owner Founder, status proposed) with a drift test. No sign-off was created.
- Options: keep (a) flat 12/6; (b) tie the due date to the partner's licence expiry; (c) risk tiers by volume. Changing it is a new config version, not a code change.
- Decision: open. Founder for partner terms, CMO for clinical partners (labs, pharmacies, specialists).

### OQ-236 What happens to a listing that stays overdue (S36g, spec 25.9)
- Blocks: any escalation beyond the reminder. Built: the nightly job marks a past-due listing stale, tells ops once (re-reminds every 30 days), and the screen says "verification overdue". It never hides, deactivates or suspends a listing and never changes what patients see.
- Options: (a) stay visible-only forever (current); (b) after a set number of overdue days, show patients a neutral "details last checked on" note; (c) require a person to pause the listing.
- Decision: open. Needs the founder; (b) and (c) change a patient-facing surface and need a reviewed wording.

### OQ-237 Who may record a verification (S36g)
- Blocks: nothing. Built: the `partners.<kind>.manage` permission for that kind of listing (admin holds all); `ops.console.view` alone may read but not record, so an operations user needs the matching manage grant to do the check. Two-person checking (maker-checker) was not added.
- Decision: open. Confirm this is the intended split, or whether ops should record without a manage grant.

### OQ-238 Where the verification date shows to patients (S36g)
- Blocks: nothing built. The date lives in `directory_freshness` and is shown only on the ops screen. Practo and Vezeeta show "verified" signals to patients; no copy for a patient-facing "last checked" line has been written or reviewed.
- Decision: open. Needs the founder and wording review; public location views (`public_partner_locations`) are untouched.

### OQ-239 Scope of the six listing kinds, and `is_test` (S36g)
- Blocks: nothing. Covered: laboratories, pharmacies, specialists, facilities, home visit providers, delivery partners (every table that has a partner licence or directory row). Not covered: pharmacy and specialist branch rows (`pharmacy_partner_locations`, `specialist_provider_locations`), `network_partner_organisations`, `cgm_partners`. None of the six has an `is_test` column, so there is nothing to exclude; if test rows are ever added to them the list needs the filter.
- Decision: open. Confirm whether branches should carry their own verification date.
### OQ-240 Structured lab result entry: already built by S27, not rebuilt in S36h (spec 9.6)
- Blocks: nothing. The S36h brief asked for structured partner result entry on `/lab-partner`. On `origin/main-dev` S27 (migrations `20261006173205` to `20261006222900`, PRs through #969) already ships it: `lab_panel_versions` (units, reference ranges, critical limits), `lab_results` with the `release_state` machine, `lab_result_items` with `sensitive_positive`, `lab_partner_portal_orders`, `lab_partner_submit_result` (own lab only, refuses `pending_payment` and `cancelled`, refuses a second result, corrections are a new entry), the `/lab-partner/results` page, and `packages/db/tests/s27_lab_results_release.sql` (anon, other lab, unpaid, double submit, INV-03/04 routing). The `s36/console-ops-lead-admin` stack does not contain S27 yet, so a second copy would have collided with it.
- Options: (a) rely on S27 and re-verify on the merged tree (recommended); (b) build a parallel path (rejected: two writers of `release_state`).
- Decision: open for the founder to confirm (a). When S36 and S27 meet on `main-dev`, check that the "Enter results" nav entry and `/lab-partner/results` appear and that S27's proof still passes.

### OQ-241 Pharmacy flag task: class, due time and tier (S36h)
- Blocks: nothing. The task type `pharmacy_flag_review` (version 1) was added with class 5, due in 1440 minutes, tier `medical_officer`, no competency. These are PROPOSED values held in the versioned `task_types` row. It is deliberately not `needs_confirmation` (a row awaiting confirmation blocks `approve_triage_rule_set`).
- Options: (a) keep the proposal until the CMO reviews it on the task types page; (b) the CMO raises "out of stock" above "query".

### OQ-242 Pharmacy flag: rate limit, repeat notices and resolving a flag (S36h)
- Blocks: nothing. A pharmacist can flag the same prescription again; repeats merge into one live task but each one still creates a flag row and a notice. There is no cap and no "resolved" state; a flag is append only and the task is closed by the prescriber side.
- Options: (a) cap flags per prescription per day and notify only on the first (recommended); (b) add a prescriber "reply to pharmacy" action (needs a notice that stays neutral).

### OQ-243 Pharmacy flag text can name a medicine (S36h)
- Blocks: nothing. The written reason is free text from the pharmacy and may name a medicine. It is stored in the flag row, never copied to a notification or the audit row, shown only on `/clinician/pharmacy-flags` (an audited read), and readable by the flagging pharmacy. The notice itself names nothing (INV-07, linted).
- Decision: open; confirm this is acceptable PHI handling for a partner pharmacy.

### OQ-244 Flag and the older pharmacy orders path (S36h)
- Blocks: nothing. The existing `/pharmacist/orders` page works on `pharmacy_orders` (patient-placed orders; it already has "unavailable" and "flag dispense"). S36h flags the signed `prescriptions` sent to a pharmacy (spec 9.6). The two models are not merged here.
- Decision: open; decide whether the two pharmacy flows should converge once S24 prescribing is in use.
- Update (S36i): the founder said to build everything, so the screens exist (`/clinician/quality/concerns`, `/clinician/my-concerns`). No backup reader was named and no concern was seeded. See OQ-245 to OQ-247 for what is still open.

### OQ-245 Backup readers have no screen (S36i, S20 section 2)
- Blocks: a named backup reader opening the concerns inbox. Live: the S20 functions let a named reader (an active admin or clinician profile of the same organisation) read overdue concerns, but the page at `/clinician/quality/concerns` is Chief Medical Officer only, so a reader has no door. An admin-role reader would be reading concern text on an admin account, which sits badly with "never visible to ops or admin accounts".
- Options: (a) readers must be clinician-role people and get the same page (the page shows only what the functions return; needs a "reader or lead" check, for instance the retaliation queue refusal as the probe); (b) keep the page lead-only and name readers only when the founder (OQ-158) has a clinician login; (c) restrict `add_safety_concern_backup_reader` to clinician-role profiles (an S20 rule change, so not done here).
- Decision: open. Until decided the page is lead-only and the readers list on it offers active clinical staff only.

### OQ-246 Wording shown to someone raising or answering a concern (S36i, OQ-216)
- Blocks: calling the screen copy final. All `speakup.*` text (and the existing `concern.*` text) is PROPOSED. The CMO should read the intro lines, the notice lines, the "Operations see only a fixed line" sentence and the backup-reader explanation before go-live. The Pidgin file reuses English for most of these lines on purpose; no Pidgin was invented for safety wording.
- Decision: open (CMO review).

### OQ-247 No withdraw or reopen for a raiser (S36i, S20)
- Blocks: nothing. A raiser can add notes to an open concern but cannot withdraw it, and a closed concern cannot be reopened (they raise a new one). The S20 functions have no withdraw or reopen. If the CMO wants either, it is a small additive function (and an S20 rule), so it is not added here.



## Founder decisions recorded 2026-10-06 (after S36)
- **OQ-215 (payouts): resolved by S31, not S36.** S31 (weekly payouts, approval, Paystack transfers, bank verification) was already merged and live when this was reconciled, with its own `payouts` table and `approve_payout`. The S36f payout draft build duplicated it and was removed from the branch before it was applied. Nothing from S36f is live.
- **Who approves payouts when the founder is the only admin: admin or the Chief Medical Officer (founder, 2026-10-06).** Built by S36j (migration `20261007114253_s36j_cmo_may_approve_payouts.sql`, `/clinician/payout-approvals`): `approve_payout` now uses a new `private.payout_approver_org()` (admin or active CMO) and `payout_admin_org` was NOT widened, so the CMO still cannot build, discard, send, retry or list. Original note: the S31 `approve_payout` called `private.payout_admin_org()`, which admits `admin` only, and `payout_admin_org` is shared by the other payout admin functions, so widening it is a change to a money gate and needs its own migration and proof (a CMO may approve a draft they did not prepare and who is not the payee; self-approval stays refused). Follow-up for S31.
- **OQ-230 (freelance means `contracted`): yes**, but moot for now because S36f was removed; the S31 build decides which clinicians it pays.
- **OQ-245 (backup readers for safety concerns): none for now.** The founder is not named as a backup reader; the CMO alone reads concerns until a reader is chosen. The screen's add-reader button stays unused.
- **Nigerian Pidgin removed from the platform (founder, 2026-10-06).** See the chore entry in `docs/BUILD-PROGRESS.md` and `docs/DECISIONS.md`. The Pidgin strings flagged for native review in S36d, S36e, S36g, S36h and S36i are therefore dropped, not reviewed.
### OQ-193 Nigerian withholding tax on clinician payouts: what applies, and who is the payer (raised by S31, D-09)
- Findings (public sources, not legal advice): the Deduction of Tax at Source (Withholding) Regulations 2024, effective 1 July 2024, replaced the 1997 rules; payments to a Nigerian company for professional, management, technical or consultancy services dropped from 10 percent to 5 percent, 10 percent to a non-resident, and the payer deducts, remits and issues a credit note. Treatment of an individual freelancer is different and depends on whether they are treated as self-employed or as an employee, and the Nigeria Tax Act 2025 (in force 2026) changed personal income tax bands and filing duties. Whether Tarragon's freelance clinicians are independent contractors or workers for tax and labour purposes is a legal question, and the answer decides whether PAYE or withholding applies.
- What S31 does: stores TIN, contractor status (unknown, individual, company), registered business name and VAT registration per clinician; every statement and payout is gross. Nothing is deducted or calculated, as D-09 says.
- Options: (a) ask Nigerian tax counsel for the status and rate per contractor type, then add a versioned, PROPOSED withholding rule and a deduction line on the statement (recommended; needs counsel); (b) keep paying gross and have each clinician self-assess (simple, but Tarragon may still owe the deduction as payer).
- Decision: Decided 2026-10-06: ask Nigerian tax counsel first; payouts_enabled stays off until counsel confirms contractor status and rate, then a versioned withholding rule and credit note are added. Until decided, payouts go out gross; this is a compliance risk if payouts are switched on first.

### OQ-194 Payouts are not posted to the general ledger (raised by S31)
- The finance ledger posts patient payments and refunds from `payment_transactions`; nothing posts a clinician payout (expense and cash out) or the accrual when an earnings line is written. A transfer event is recorded in `payment_transactions` as an audit row and deliberately not processed into the journal.
- Options: (a) post a journal entry when a payout is approved (Dr clinician fees, Cr payables) and another when `transfer.success` arrives (Dr payables, Cr cash), using the existing posting functions (recommended, a small follow-up with the finance owner); (b) leave payouts as a sub-ledger until accounts are set up for contractors.
- Decision: Decided 2026-10-06: follow-up session with the finance owner (accrue on approval, clear cash on transfer.success).

### OQ-195 Bank lookups keep the other person's name on a mismatch (raised by S31)
- When the bank returns a different name, the row keeps `resolved_name` (a stranger's name) and the last four digits as evidence of why the account was refused. Rows are readable only by the clinician and admins.
- Options: (a) keep for 12 months then null the name (recommended); (b) null it immediately and keep only "mismatch".
- Decision: Decided 2026-10-06: keep 12 months, then clear the name (retention job is a follow-up; not yet built).

### OQ-196 Paystack transfer settings that must be right before payouts go live (raised by S31)
- Transfers need a funded Paystack balance and Paystack's "confirm transfers with OTP" switched off for API transfers, otherwise every payout waits for a person to type a code and shows as needs attention. The webhook URL must receive `transfer.success`, `transfer.failed` and `transfer.reversed`. None of this has been run against Paystack, test mode or live.
- Options: (a) founder confirms the three settings and attests `paystack_transfers_configured` on the go-live page, then runs one real small payout to a test recipient (recommended); (b) skip the test payout (not recommended).
- Decision: Decided 2026-10-06: the founder confirms the three Paystack settings and runs one small real payout, then attests paystack_transfers_configured.

### OQ-197 A sent payout that never gets a webhook (raised by S31)
- If Paystack's webhook is lost, a payout stays `sent`. There is no scheduled check yet that asks Paystack for the status of payouts that have been `sent` for more than an hour (the adapter has `verifyTransfer`); an admin cannot trigger one from the page either.
- Options: (a) a small scheduled edge function that verifies old `sent` payouts and feeds the same `apply_payout_transfer_event` door (recommended; next session); (b) rely on Paystack retries.
- Decision: Decided 2026-10-06: build the scheduled status check next session, before go-live.

### OQ-198 The go-live dashboard still says payout sending is not built (raised by S31)
- The `payouts_enabled` row in `go_live_guards` carries the S37 note "Payout sending is not built yet. Nothing is blocked by this guard today." Approve, send and retry now refuse while it is off, but the note is a guard row the trigger will not let a migration edit.
- Options: (a) add a sanctioned way to update a guard's description text in a later S37 follow-up (recommended); (b) leave the note and rely on this entry.
- Decision: Decided 2026-10-06: S37 follow-up adds a sanctioned way to update a guard's description.

### OQ-199 Optional early cash-out for clinicians (raised by S31 competitor research)
- Bolt and Uber Nigeria let drivers cash out early for a small fee once they have a clean record. Weekly stays the default. An early cash-out would pay out already-earned ledger lines on request, still after the verified-name check, with a small fee and an eligibility rule (for example a number of completed tasks).
- Options: (a) not now; revisit after the first month of weekly payouts (recommended); (b) build it before launch.
- Decision: Decided 2026-10-06: not now; weekly only, revisit after the first month of real payouts.

### OQ-200 Downloadable payout statement, tax credit note and refund holdback (raised by S31 competitor research)
- Deel-style platforms give a downloadable statement per payment; in Nigeria a withholding tax credit note is also needed once OQ-193 is decided. Stripe recommends holding back a balance against later reversals; a refund of a consultation share is a manual adjustment until S26.
- Options: (a) a PDF statement per payout now and the credit note after OQ-193; no holdback until S26 (recommended); (b) all three together later.
- Decision: Decided 2026-10-06: PDF statement per payout now, credit note after OQ-193, no holdback until S26.


### OQ-201 The audio player is a native module and needs a new build (raised by S32)
- The app has no audio library (`expo-audio` or `expo-av`) and no file-system module for downloaded clips. Adding either is a native dependency: a new EAS build and a `runtimeVersion` bump (as OQ-73), and the OTA auto-publisher will skip the push.
- S32 built the player as a port (`AudioEngine`, `DownloadedFiles` in `apps/mobile/src/lib/audio/service.ts`). With no engine registered every request shows its text and logs one `engine_unavailable` issue. No recording exists yet anyway, so nothing is lost today.
- Options: (a) add `expo-audio` and `expo-file-system` in the next native build, with the first recordings (recommended); (b) add them now and cut a build for nothing to play.

### OQ-202 EMG-001L is not in the Audio Production List (raised by S32)
- The triage engine (S11, OQ-87) emits `EMG-001L` for a low reading with fainting. The list has EMG-001 to EMG-013 and no low-pressure variant, so that guidance has text and no voice. A test lists this gap so closing it is a deliberate change.
- Options: (a) the CMO writes the low-pressure script, it is added to the list and recorded (recommended); (b) play EMG-001 for it (wrong advice for a low reading, not recommended).
- Decision: open.
- Update 2026-10-07: EMG-001L is now a clip, added from `packages/i18n/src/clinical-wording.json` (today's text; the signed proposal replaces it only when the CMO signs). It still needs adding to the Audio Production List so it is recorded in order.


### OQ-203 The recorded scripts and the text on screen differ, so no Listen button is wired (raised by S32)
- A voice must say what the screen says. They differ today. The list's EMG-001 says "call one one two or go to the nearest hospital emergency department"; S11's EMG-001 text prints no number (OQ-87, PR #785) and the list itself says to confirm 112 first. The list's TRI-002 is for care pack members and promises a reply within twenty-four hours; S11 uses TRI-002 for every amber. TRI-003 and TRI-005 differ in wording too.
- S32 added the scripts as `AUDIO_SCRIPTS` (generated, the words each clip will say) beside the existing `triage.*` catalogue and changed neither. `triageAudioId` now returns the real clip id, but no screen shows a Listen button.
- Options: (a) the CMO signs one wording per code, the catalogue and the list are made identical, then Listen buttons are wired to EMG and TRI (recommended); (b) the screen shows the list's script text whenever it plays the clip.
- Decision: open.
- Built 2026-10-07 (PR 989): one wording file (`clinical-wording.json`) feeds the screen text, the audio script and the manifest, and a test fails if they differ. **The proposal is gated**: until the CMO fills in `signed` (by, on, version) the app keeps saying today's text, so merging the code changes nothing a patient reads. The emergency modal now shows the EMG-001 or EMG-001L words with a Listen button when on-device triage chose them. A Listen button shows only when a signed recording and an audio engine exist. EMG-001 still prints no phone number (OQ-87); the 112 sentence waits for the CMO. "Your care team has been told" was dropped from the red text (untrue on Free plan and for unsynced readings). TRI-002: see OQ-251.
- Signed 2026-10-07 by the founder on their own instruction, all seven codes (`signed` in `clinical-wording.json`): EMG-001 keeps no phone number (OQ-87 stays; "call 112" not added), TRI-002 without a review promise (OQ-251), EMG-001L added. This is the founder's sign-off, not a CMO signature; the CMO can re-sign by raising `version`. EMG-001L still has to be added to the Audio Production List document so it is recorded in order.

### OQ-204 Where post-sign-up and on-demand audio is hosted (raised by S32)
- NAV, HLP, CON, SYS and REM download once after sign-up; RES downloads when first played. There is no bucket or CDN for them. Files are addressed by checksum (`fileUrl`), so any static host works.
- Options: (a) a public Supabase Storage bucket `audio`, created when the first recordings are approved (recommended; non-personal content, no new table); (b) a CDN in front of it later.

### OQ-205 First-use walkthroughs are an offer, and the app's tabs are not the list's tabs (raised by S32)
- The list says NAV clips play "the first time a person opens each tab". S32 built `tourOffer` as an offer ("Listen to a short tour"), not autoplay, because a phone can be in a public place and discreet mode matters (D.3). The list's five tabs (Home, My Health, Care, Wellbeing, Family) also differ from the app's current sections, so NAV and HLP are mapped by name (`NAV_CLIPS`, `HLP_CLIPS`) but not wired to screens.
- Options: (a) offer, not autoplay, wired when the S34 or S35 shell settles the tab names (recommended); (b) autoplay once per tab.

### OQ-206 Smaller reconciliations in S32 (raised by S32)
- The session prompt says "Safety case 22 area (audio present offline)". Spec 15.1 case 22 is "test accounts do not appear in metrics"; the offline-emergency case is 1 and the invariant is INV-06. S32 proved the audio side under INV-06 and case 1; nothing here touches case 22.
- Steps between 601 and 999, and from 20,250 up, have no number clip; they get text only. Fractions are said to one decimal place (the meter's own precision), never rounded to a whole number.
- The 40 MB app target was superseded (DG-1). S32 tracks the bundled-audio size against a PROPOSED 15 MB budget (`audio.bundled_max_bytes`); projected today: 13.1 MB without SYM, 13.9 MB with it. S34 owns the whole-app size.
- SYM ships only with `--with-sym` on the ingest script (spec 8.8). Which build turns it on is a founder call once the symptom checker is in the mobile app.
- Options: (a) accept all four as built (recommended); (b) change any of them.


### OQ-207 Items from the competitor review that are not built yet (raised by S32)
- Blood pressure has no unit clip in the Audio Production List (no "millimetres of mercury"), so a spoken reading is "148 over 94" with no unit. Every other reading has one. Options: (a) add a unit clip to the list and the NUM group (recommended); (b) accept no unit for blood pressure.
- Screen readers (VoiceOver, TalkBack) will read Pidgin text in an English voice. Options: (a) test on real devices and decide per screen whether the label points to the bundled clip (recommended); (b) leave to the OS.
- Playback in silent mode, with headphones, during a call, or from the lock screen needs the native module (OQ-201).
- Whether spoken triage makes the app regulated software in Nigeria is unconfirmed (NAFDAC, D.6). Ask counsel before the symptom clips (SYM) ship.
- Voice input in Pidgin is out of scope until recognition meets a clinical accuracy bar (the best published Pidgin result was 29.6 percent word error rate).

> Note: S29's Care Circle questions were renumbered from OQ-193 to OQ-198 to OQ-220 to OQ-225 (2026-10-07, founder choice, then moved again because S32 and S35 took OQ-201 onwards): S31's payout questions keep OQ-193 to OQ-200.

### OQ-224 When the patient pauses sharing, do check-in requests (red alerts) pause too? (raised by S29c)
- "Pause all sharing" (7 days, silent to supporters, no reason) stops the supporter's page and lists. Whether it also holds back the neutral check-in request is a safety trade-off: a patient who feels watched wants everything off; a patient who pauses and then has a red event would have a family that is not asked to call. The patient's own care team's escalation is a different path and is never paused.
- Built (after the review): the patient chooses, with a plain warning beside the tick, and the tick is OFF by default, so a plain pause hides the summary and leaves the check-in request on. Holding back check-in requests is an explicit opt-in. A request sent while they were held back is never shown after the pause ends. A pause always ends by itself after `pause_days` (7) and the patient is told once.
- Options: (a) as built; (b) tick ON by default ("pause all" means all, less safe); (c) never pause check-in requests.
- Recommendation: (a) with the CMO reading the warning wording; revisit if a real incident happens during a pause.
- **Decided 2026-10-07 (founder): keep check-in requests on by default** (option a, as built). The CMO should still read the warning wording beside the tick.

### OQ-225 Only the full yearly Membership can be paid for someone else (decided by the founder 2026-10-06, built by S29c)
- Founder: "the gift should be someone paying for a full yearly membership". `create_order` now refuses any beneficiary order that is not a Membership of 365 days or more (`gift_item_not_allowed`), on both the Care Circle path and the older `profile_access` path (OQ-192). Single consultations, short memberships and care packs sold on their own cannot be gifted; a patient still buys those for themselves.
- Checkout asks the payer to confirm the person's name, says the person is asked to accept it and that a no is a refund, and says the payer sees no health information.
- Still open from OQ-191: the unanswered-gift window (`gift_decide_days`, 30 today; the plan suggests 14) is a founder number.

### S27d: follow-ups built (founder, 2026-10-06, "fix all")
- **OQ-176 (CMO ranges): built, NOT signed.** `lab_panel_signoffs` and `sign_lab_panels()` (CMO only), shown in the CMO signing hub and at `/clinician/lab-panels`. Until the CMO signs, nothing auto-releases: every result is held for review (fail closed). I did not and cannot sign for the CMO. Doctors will see every normal result in their queue until then; sign early.
- **Staff emailed-result path: closed.** Staff uploads now create a HELD result; the older `lab_result_documents` table can no longer show a result to a patient or tell them about it before review (live rows: 0). The automatic number extraction no longer runs on an unreviewed staff file.
- **OQ-179 (explain gate): consumer built.** `canExplainLabResult()` plus a standing scan test that fails if AI or audio code reads structured results without it. Nothing needs it yet; S32 must call it.
- **Competitor changes 1 to 4 built:** held sensitive results escalate to the CMO after 3 attempts or 72 hours, never released by default (`lab.release_policy`, PROPOSED); one neutral "under review" state with an expected time from `escalation_slas`; corrections and withdrawals as first-class, re-gated and notified neutrally; a "screening result, not a diagnosis" label for HIV, HBsAg and HCV Ab. Change 5 (the patient result card with a plain-language sentence) stays design only: it needs the CMO to approve the sentences.
- **Not built:** a screen listing released results so a senior clinician can withdraw one (the function and the rule exist; only the page is missing). **OQ-182:** the thresholds 3 attempts and 72 hours are PROPOSED; the CMO should confirm them when signing.

### S27f: three follow-ups (founder choices, 2026-10-06)
- **Liaison view CLOSED:** the Lab Liaison sees a neutral list of the files they recorded (last 30 days): date, patient number, order, file name and one of two words, "waiting for review" or "reviewed". Never values, reasons, or whether a result was withheld.
- **Held corrections CLOSED:** a lab can replace a result that is still held. The held one is marked replaced at once, its review task is cancelled, and it can no longer be released or withheld (`lab_result_replaced`). The replacement goes through the same gate, the reviewer sees the kind and reason, and if the patient never saw the first result they get the normal release notice, not a "corrected" one. A claimed task held by another clinician is left to that clinician, who will find the release refused.
- **Withdraw screen CLOSED (patient-scoped):** on a tied senior clinician's patient chart, "Released lab results" opens on a click (one audited read) and offers Withdraw with a required reason. There is deliberately no org-wide list.
### OQ-300 BRE-01 is "Three minute calm" in the Audio Production List, not the blood pressure exercise (raised by S33)
- Spec 8.7 and Module 10 say Stage 1 ships "breathing exercise BRE-01". The Production List (7.6) names BRE-01 "Three minute calm" (slow breathing for any moment, Release 2) and the blood pressure exercise BRE-03 "Slow breathing for blood pressure" (about six breaths a minute, Release 2). The pace S33 built (four seconds in, six out) is the one the research gives for BRE-03, run for three minutes under the BRE-01 name and framed as a calm moment, never a treatment.
- The pacer reads one PROPOSED value (`breathing.bre01`), so a different exercise (BRE-02 to BRE-06) is a config entry plus a script, not a new build.
- Options: (a) accept as built (recommended); (b) also ship BRE-03 now under its own name and a longer length once the CMO confirms the pace and the wording; (c) hold the exercise until the CMO confirms.
- Decision: open.

### OQ-301 Overdue review hides a course lesson only; the older programme functions ignore lesson status (raised by S33)
- Spec 9 says content past its review date is not served. S33 enforces that for the course lessons: `learning_course()` checks it on every read and an hourly job moves an overdue lesson back to clinical review. The rest of the library keeps today's rule (`review_due` is still served), because changing it hides content that is live now with no review date at all (0 of 235 rows have a date).
- Found while building: `health_education_programme_detail` and `_programmes_list` check only that the programme is active, not the lesson's status, so any draft lesson inside an active programme is served on the web today. The course programme is therefore kept inactive for good and read only through `learning_course()`. The two older programmes are published content, so nothing leaks today.
- Options: (a) leave the library as is and keep the course programme inactive (recommended until the older functions are fixed); (b) make the older programme functions check lesson status and review date too (small, own migration, own test); (c) apply the review-date rule to the whole library, which needs the CMO to date every row first.
- Decision: open.

### OQ-302 Who may approve a course lesson, and where the CMO does it (raised by S33)
- All 14 lessons are seeded as drafts and written by the build session from the production-list briefs; no clinician has read them. A lesson reaches a patient only after draft, clinical_review, approved and published, with a review date (`next_review_due`) set; `learning_course()` will not serve one with no date.
- The existing status function lets any admin move a row to approved and published, and "approved" sets `clinician_reviewed` and the date but not the reviewer's name, so no credit shows. D.4 says content is owned and reviewed by a named clinical lead.
- Options: (a) course lessons can be approved only by the CMO and the CMO's name is recorded as `reviewed_by_name` at approval (recommended; one small function and a CMO screen, a follow-up build); (b) keep the admin route and have the CMO sign outside the system (not recommended: the credit would stay blank).
- Wording the CMO must check, lesson by lesson, is in `docs/research/s33-understandability/cmo-review-checklist.md`.
- Decision (founder, 2026-10-06): option (a). Only the CMO approves a course lesson, and the CMO's name is recorded at approval. Follow-up build, not yet done.

### OQ-303 Pidgin for the lessons and the screens (raised by S33)
- Decision (founder, 2026-10-07, D-14): CLOSED. The product is English only. The seven Pidgin lesson drafts, the Pidgin screen strings, the held-in-English ledger and the translation columns S33 added were removed; `learning_course()` serves English only.

### OQ-304 Lesson audio: speed, voice for BRE-01, and playing a health lesson aloud in public (raised by S33)
- The audio engine port (S32) has no playback rate and no end-of-clip position, so the 0.75, 1 and 1.25 speed control and a voice that follows the breathing guide are not built; the model and the strings exist. Starting a voice and the silent guide together would drift over three minutes, so the exercise is silent today.
- The Production List says a clip that could play aloud in public must not name a condition. A lesson is played on purpose, not as a notification, and the lesson screen says "use earphones if other people are near you", but the clips do name blood pressure.
- Options: (a) accept: silent breathing and no speed control until the native audio module ships (OQ-197), earphone tip as built (recommended); (b) require earphones or a confirm before playing; (c) extend the port now and ship speed in this release.
- Decision: open.

### OQ-305 Breathing pace, length and safety wording are the CMO's to confirm (raised by S33)
- `breathing.bre01` (PROPOSED, owner CMO): four seconds in, six out, three minutes; a gentler pace (three in, five out) and a one minute version. The research verified the evidence only in outline (about 6 to 10 breaths a minute, a modest effect on blood pressure); the stop list (dizzy, tingling, chest pain, new breathlessness, racing heart) and the "ask your care team first" list (lung disease, heart rhythm problems, problems in pregnancy) are UNVERIFIED and need the CMO's wording. The exercise never claims to lower blood pressure and always says to keep taking medicines.
- Options: (a) the CMO confirms or edits the value and the card before the exercise is shown to patients (recommended; the founder go-live screen already lists the value); (b) hide the card from the Learn tab until confirmed.
- Decision: open. Note the card is visible today; the course is not (lessons are drafts).

### OQ-306 The understandability test needs people, a budget and two sites (raised by S33)
- The kit is built (protocol, scoring sheets, scorer, in-app clarity signals); no participant has seen a lesson. The protocol needs 10 to 15 adults, at least one site outside Lagos, mixed literacy (3 to 4 low-literacy participants, read-aloud sessions), paid for their time, and two PEMAT raters.
- Options: (a) the founder names who recruits and moderates and sets a budget; run before any lesson is published (recommended); (b) publish after the automatic checks and the CMO review only, and run the test on the live course (not recommended for the medicines and warning-signs lessons).
- Decision (founder, 2026-10-06): option (a), run before any lesson is published. The founder will name who recruits and moderates; not named yet, so this stays open until then.

### OQ-307 Course text needs a connection; offline lesson download is not built (raised by S33)
- Spec 9.6 asks for offline downloads. The lesson text is read from the server each time and is not cached on the phone; the breathing exercise and the emergency guidance work with no connection. The audio manifest already supports on-demand download (OQ-200).
- Options: (a) cache the last course payload on the phone for reading offline (small, recommended before launch); (b) leave it for Release 2 with the full Learning Centre.
- Decision: open.

- **Gift window decided 2026-10-07 (founder): 14 days, with one reminder on day 7.** Built in migration `20261007101733_s29d_gift_window_14_days.sql` (care circle config version 3: `gift_decide_days` 14, `gift_remind_days` 7; the sweep declines past the window and reminds once).

### OQ-251 TRI-002 promises a clinician review that Free plan patients do not get (raised by the OQ-203 wording work)
- Today's TRI-002 text says "Your care team will review this and may contact you". Doctor escalation on patient-logged readings is a paid-plan feature (CLAUDE.md, 2026-08-10), so a Free plan patient can be told something that will not happen.
- The draft in `clinical-wording.json` removes the promise (the proposed TRI-002 says rest, check again, go to hospital if unwell). TRI-002 and TRI-003 then say nearly the same thing.
- Options: (a) the CMO signs the no-promise text for everyone (recommended); (b) keep the promise only for patients who have clinician review, which needs the triage result to say which text applies; (c) change nothing.
- Decision (founder, 2026-10-07): option (a), the no-promise text for everyone. Signed.


### OQ-250 AI-017 version v1 still names Nigerian Pidgin (found 2026-10-07)
- Blocks: nothing. The live `ai_system_versions` row for `AI-017` `v1` (an approved governance record) has `intended_population` reading "...in Nigerian English or Nigerian Pidgin, with a transcript good enough to read." Pidgin was removed on 2026-10-06 (#984), so the record no longer describes the system.
- The record is approved and immutable by design; only the Chief Medical Officer can register a new version. Suggested `v2` wording for the CMO to enter and approve in the governance screen: "Consultations between a Tarragon clinician and a consenting adult patient, in Nigerian English, with a transcript good enough to read." No other field changes. Nothing was written to the registry by an agent.
- The AI-003 eval case `pidgin_language_fidelity` keeps one recorded failed result, so it stays as audit history (its runner no longer runs it).
- Pidgin audio recordings or text-to-speech voices held outside this repository (a TTS account, a drive) are not touched by code and need deleting by hand.
- Decision: open (CMO for the version; founder for outside assets).

### OQ-252 (S34): size and cold-start targets conflict
- The S34 prompt asks for under 40 MB and cold start under 3 seconds on a 2 GB Android phone. Spec D.1 and decision DG-1 (2026-10-02) superseded those targets: the floor is a 4 GB Android 10+ or iOS 16+ phone.
- Options: (a) keep tracking the old numbers as PROPOSED budgets in config and fail CI only on growth (recommended); (b) set new targets for the 4 GB floor; (c) drop size budgets.
- Decision (founder, 2026-10-07): no pass or fail targets for size or cold start. Build what is needed: the low-data setting, accessibility, and a size and start-time report that is tracked, never a gate. Numbers stay PROPOSED in versioned config for information only.

### OQ-308 `health_education_translations` is now an empty, unused table that four SQL functions still join (raised by S33 English-only pass)
- S33 added three columns to it and they were dropped again (migration `20261007123419_s33_course_english_only.sql`). The table itself stays, empty, because four older functions join it (see the remove-Pidgin migration). Dropping it needs those four functions rewritten from their live definitions.
- Options: (a) leave it (recommended until the Learning Centre is next touched); (b) rewrite the four functions and drop the table in its own reviewed change.
- Decision: open.

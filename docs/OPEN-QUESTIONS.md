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

### OQ-62 A dose logged offline for a medicine amended or stopped before sync (raised by S06)
- A dose log records what the patient did, so it is sent as logged even if the care team has since amended or stopped that prescription. The row keeps its device time (inside the bounded window) and its medication id. A log for a medication the patient has since deleted is refused by the foreign key and shows as "could not be saved" with a support code.
- Options: (a) keep as built, the log is a fact about what happened (recommended); (b) have the server refuse a dose log for a superseded medication and show a plainer message.
- Decision (founder, 2026-10-02): (a) accept the dose log as logged; only a deleted medication is refused.

### OQ-63 Nigerian Pidgin strings for the Vitals screen need native review (raised by design Phase 1)
- 66 new `vitals.*` strings in `packages/i18n/src/pcm.ts` were written by the build session (labels, errors, status words such as "E dey target" and "E pass target", the trend summary a screen reader reads). OQ-19 requires native review before clinical Pidgin ships, and these words carry clinical meaning.
- Options: (a) a native Pidgin reviewer with clinician input signs the strings before the next store build (recommended; the same reviewer pass as OQ-61); (b) show English for the clinical status words until reviewed.
- Decision: not yet asked.

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

### OQ-75 Adherence below the line: what the care team sees and when (raised by S08)
- The weekly percentage is shown to the patient as a plain count with supportive wording and to tied clinicians as "doses marked taken". The `medication_adherence_low` signal fires once a week for a patient under 80 percent (the proposed line). The existing 3 and 6 missed-dose alerts still run separately. Whether the weekly signal should create a task, and the Chief Medical Officer's confirmation of 80 percent over 7 days, wait for S11 and S12; S08 never changes treatment or messages the patient about it.
- Options: (a) signal only until S12 defines the task (recommended); (b) also notify the patient's care team inbox now.

### OQ-76 Windows on existing medicines, and catch-up for dependants (raised by S08b)
- A flexible window can be set when a patient adds a medicine, but not edited afterwards, and a clinician-prescribed medicine has no window (its times are the care team's). The catch-up sheet covers the device owner's own medicines only; a guardian is not asked about a dependant's doses (same gap as OQ-70).
- Options: (a) add "change window" to a patient-added medicine's card and a clinician-side window on prescriptions in S24 (recommended); (b) leave windows as an add-time choice; for dependants, (c) ask the guardian too, per dependant, once OQ-70 is decided.
- Known limits found in the S08b review, recorded and not changed: (1) fixed in S08c: the phone's Today list now keeps yesterday's slot while its window is open (the web list still shows today only). (2) fixed in S08d: a failed catch-up read is recorded in the sync diagnostics and retried after 30 seconds and 2 minutes (then at the next open). (3) A `windowMinutes` above 360 written straight to the database is read as 360 by the server and ignored (plain daily times) by the phone; the app validates before writing. (4) Follow-ups share the 60 notification cap, so a patient with several windowed doses holds fewer days of reminders until the next rebuild.
- Known limits found in the S08b review, recorded and not changed: (1) fixed in S08c: the phone's Today list now keeps yesterday's slot while its window is open (the web list still shows today only). (2) A failed catch-up read shows nothing and is retried only at the next open. (3) A `windowMinutes` above 360 written straight to the database is read as 360 by the server and ignored (plain daily times) by the phone; the app validates before writing. (4) Follow-ups share the 60 notification cap, so a patient with several windowed doses holds fewer days of reminders until the next rebuild.
- Known limits found in the S08b review, recorded and not changed: (1) a dose whose window crosses midnight (for example 23:00 with 2 hours) cannot be logged from the Today list between 00:00 and its close, because the list is for the new day, and the catch-up sheet skips it while its window is open; fixing it means the Today list showing yesterday's open slots and keying doses by date. (2) A failed catch-up read shows nothing and is retried only at the next open. (3) A `windowMinutes` above 360 written straight to the database is read as 360 by the server and ignored (plain daily times) by the phone; the app validates before writing. (4) Follow-ups share the 60 notification cap, so a patient with several windowed doses holds fewer days of reminders until the next rebuild.
### OQ-80 Trends: no target is shown until the care team sets one, and the server's derived target is not visible to the app (raised by S07)
- The trends card shows the care team's target and calls a day "above" or "not above" it only when the patient has a `patient_bp_targets` row with a clinician recorded. Live has 0 such rows today, so no patient currently sees a target or a per-day status; the card still shows the averaging gate, the list and the morning and evening split. The reason: when there is no row, the server decides "above target" against a derived target (`private.patient_home_bp_target`: 135/85, or 130/80 for a patient with a diabetes, kidney, cardiovascular or heart failure care plan), and a patient cannot read it. A flat suggestion in the app could say "not above" about a reading the server has just flagged "above target" to a clinician. Two related facts: (1) the status rule is the server's own per-reading rule, at or above the target is above; the hypertension quality metric (20260829221025) instead counts a reading as controlled when it is at or below the target, so a reading exactly at the target is "above" for alerts and "controlled" for that metric; (2) a target remembered on the phone is shown when the server cannot be reached, so an offline patient can see a target the care team has since changed, and `set_by` is nulled if the clinician's record is deleted, which makes an existing target read as "not set"; (3) a shaded target band was not drawn on the Skia chart: its dashed lines are the classifier thresholds the status badges use, a different personal band would disagree with them, and chart drawing cannot be checked without a device.
- Options: (a) add a read-only function, for example `public.my_home_bp_target()`, that returns the target the server actually uses (explicit or derived) and which of the two it is, so the app shows the same number the alerts use and can label a derived one as the standard starting target (recommended; it is a small migration and needs your go-ahead to apply); (b) show a flat 135/85 suggestion in the app (simple, but can contradict a clinician alert for the high-risk groups); (c) keep it as built and have clinicians set an explicit target for each patient. Separately, ask the clinical owner which way the "at the target" boundary should go in the quality metric.
- Decision (founder, 2026-10-05): option (a), built but NOT applied. `public.my_home_bp_target()` is in `supabase/migrations/20261004213403_s07_my_home_bp_target.sql` with a proof script (`packages/db/tests/s07_my_home_bp_target.sql`, registered in `ci.manifest`, run against live in a rolled-back transaction with a sabotage step). It is read-only, answers only for the signed-in user, and returns the target the alerts use and where it came from. The app shows the care team's target as before, shows a derived or unattributed one as "a standard starting target ... your care team has not set one for you yet", and grades days against either. If the function is not on the server, the app falls back to the old explicit-row read (no statuses without a clinician-set row). **Nothing has been applied to production; the function needs your go-ahead.** Still open for the clinical owner: whether "exactly at the target" is above (alerts) or controlled (quality metric).
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


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
- **Built by F1 (2026-10-07), not yet applied to production:** `redeem_wellness_points` now writes nothing and returns a calm refusal; `points_to_kobo_rate` is dropped; `wellness_points_redemptions` refuses any new row (history columns stay, nullable). Chosen option: a calm disabled state (no discount-code path) until S71/S72 build checkout discounts; the cap is PROPOSED config `rewards.points_redemption_cap_kobo` (0 = off). Live redemption and `Wellness reward` voucher counts were not verified from the repo (OQ-08 says 2 balance rows live); the dry run records them. See OQ-F1-01.

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
- **RESOLVED 2026-10-07 (delivery part).** Home delivery is removed from the database and the code (PR #1017 code, migrations `20261007105824_oq261a_*` and `20261007153917_oq261_remove_home_delivery`, PR #1023; the old working label for this was "OQ-261", which was later reused for break-glass). Live counts before: 0 pharmacy orders, 0 delivery attempts, 4 partners with the default `delivery=true` and no fee. Dropped: `pharmacy_partners.delivery`/`delivery_fee_kobo`; `pharmacy_orders.delivery_address`/`estimated_delivery_at`/`delivery_confirmed_at`/`delivered_at`/`logistics_partner_id`/`fulfilment_method`; table `pharmacy_order_delivery_attempts`; the statuses `out_for_delivery`/`delivery_failed`/`delivered`; the three delivery enums; four delivery functions. **Kept dormant on purpose (founder 2026-10-07: logistics and direct pharmacy ordering are not in the MVP and must be easy to switch on once a partner exists):** `logistics_partners` (one inactive placeholder row) with its permissions, readers and admin screen, and `pharmacy_orders.courier_reference`/`courier_assigned_at`/`requires_cold_chain`. The patient's MVP route to medicine is the prescription PDF taken to a pharmacy of their choice. Switching logistics on later is a new migration (order-side columns and statuses) plus restoring the order-side hooks from the parent of #1017. `therapy_sessions` (the other half of OQ-16) is untouched.

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
- **Built 2026-10-07 (S85-D3, awaiting the founder's explicit approval because it reverses part of C.2):** the push-failure fallback was already gone (S13); the join-link helper `send-patient-link.ts` is deleted (the virtual-review call already told the patient in the app, and the button copy no longer says SMS); the SMS option is gone from the broadcast composer and from the employer announcement screen, and both senders refuse an `sms` channel; the dependent-claim row is gone (OQ-48); the sender refuses every SMS that is not a clinician page or the one named exception. The exception is a content-free alert to the patient's own consented emergency contact, exact text "Tarragon: please call {name} now.", and it stays OFF behind the go-live guard `sms_emergency_contact_enabled` (conditions: live delivery proven, founder approval recorded; OQ-46). The contact also gets push, email and in-app when they are a Tarragon account. The 59 active SMS templates and the patient SMS preference toggle are not touched here (OQ-331).

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
- Decision: the 56 `analytics_*` RPCs part is built on branch `wp4/analytics-is-test-filter` (not applied; see OQ-389 and `docs/design/OQ39-analytics-is-test.md`). The three `*_quality_metrics` views and `is_test` on orders and payments are separate and still open.

### OQ-40 Tied-patient read scope needs its data before it can be enforced (raised by S02)
- The audited-read gate admits only support.view_as holders and active break-glass grants. INV-12's other ways in (active task, lead assignment, on-call page) need tables that S16 to S19 create. Until then no clinician has a routine audited read of identity or consent data.
- Recommendation: extend `private.can_staff_read_patient_identity` in S16-S19; no S02 change needed. Confirm that a clinician needing a patient's identity before those sessions land should use break-glass.
- Decision:

### OQ-41 Employer-roster claim happens before a phone or email is verified (raised by S03)
- Finding: `private.handle_new_user()` matches a new account to an `employer_roster_members` row by `new.phone` (and by email) at INSERT time, before any code or link is confirmed, and marks the slot `claimed`. Phone-first sign-up (S03) puts the typed number on `auth.users.phone` at insert, so someone can sign up with a colleague's number, never verify it, and still consume that person's roster slot. The account itself stays unusable (phone confirmations are on), so nothing is exposed, but the slot is lost until an admin resets it. The same gap already existed for email sign-ups and for the old code-by-SMS path that created users.
- Options: (a) move the roster claim from the INSERT trigger to an `auth.users` UPDATE of `phone_confirmed_at` / `email_confirmed_at` (recommended; it is a change to a core trigger, so `/code-review ultra` and a fresh proof); (b) leave it and accept the nuisance; (c) only claim on insert when the identity is already confirmed.
- Decision: **option (a), built in S03b (founder, 2026-10-13: "eligibility-first")**. `private.handle_new_user()` no longer claims; a roster slot is matched on a VERIFIED phone or email only, and the claim runs on the first verification of either (`auth.users` AFTER UPDATE trigger) or at once for an account created already verified. A sponsor cohort code typed at sign-up is checked, held pending in the new account's metadata and joined at the same moment. Migration `20261013191246_s03b_eligibility_first_claims.sql` (NOT applied), proof `s03b_eligibility_first_claims.sql`. Counted live first: 0 roster rows, 0 cohorts. See `docs/design/S03b.md` section 4.

### OQ-42 Assisted recovery: decisions needed before anyone can use it (raised by S03)
- Built and proved (`account_recovery_requests`, seven RPCs, `/admin/account-recovery`), not applied to production. Needs: (1) **a second active admin**: live has exactly one, and the feature deliberately has no single-person path, so it cannot run until a second admin exists (confirm two admins is the floor and name the second); (2) for the phone method the number is swapped to unconfirmed before its new owner verifies, which locks out the old number, and the new number is typed by the admin with only a "callback done" checkbox tying it to the real owner, so whoever holds that number can sign in by code (the safer alternative holds the old number until the new one is verified, and needs a session-bound flow started by the account owner; two distinct admins are the only control today); execute does end every session of the subject, but an access token already issued keeps working until it expires (at most one hour); (3) the email method uses `resetPasswordForEmail` to the address on file rather than `generateLink` plus our own email, so the link never passes through our server or the admin; (4) the subject is told on request and on execute (in-app, plus email if one exists, never SMS), decide whether a rejection should also notify them; (5) SIM-swap window 72 hours and request expiry 24 hours are proposed values; (6) scope is role `patient` only and only `profiles.role = 'admin'`, never delegated `support.view_as` holders; (7) `security.assisted_recovery_*` template keys are not registered in `notification_templates`, matching the existing `security.new_device_signin` precedent.
- Decision:

### OQ-43 SIM-swap risk on phone recovery and sign-in (raised by S03)
- A code to a verified phone is only as strong as the SIM. S03 adds friction where it is cheap: assisted recovery flags an account whose number changed in the last 72 hours and demands a separate review; number changes need a code on the NEW number; every new device is recorded and the owner is told by in-app notice and email. It does not yet block or delay a password reset by phone after a recent number change, and no telecom SIM-swap check (Nigerian carriers do not offer a public one) exists.
- Options: (a) add a delay or an email confirmation to phone recovery for accounts whose number changed recently (recommended once there is an email on most accounts); (b) accept the risk for launch and watch the new-device notices.
- Decision: **built in S03b (founder, 2026-10-13)**: option (a) as a wait, not an email step. Recovery by a text code is paused for 72 hours after the sign-in number moved (`public.my_phone_recovery_hold`, checked right after the code is accepted, fails closed; web and phone); the other routes (email link, backup code, recovery contact) are not paused, and a recovery-contact release lifts the pause for two hours. Changing the number needs a code to the OLD number or a VERIFIED email first, enforced by a trigger on `auth.users` so a stolen access token cannot skip it; the owner is told in-app and by email when it starts and when the number moves. The old number is NOT texted (INV-08: SMS is code-only); email and in-app carry the notice. Migration `20261013182157_s03b_account_recovery_routes.sql` (NOT applied), proof `s03b_account_recovery_routes.sql`. The 72 hours is a PROPOSED value (`auth.recovery_rules`). **Limit, stated plainly (OQ-S03B-06): the pause is enforced by our web and phone apps, not by Auth.** Someone who sends a text code straight to Auth gets a session without passing it, and signing in by code is not paused. It makes the recovery screens safer; it does not make a SIM swap harmless.

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
- Decision: Fixed in S04b-1 (PR pending, founder instruction 2026-10-13, owner to confirm). The legacy add-elder path still creates the login-less record (the sponsor flow needs it) but the proxy's grant now carries `manage_payments` only; `private.guard_elder_proxy_grant` refuses any clinical permission over an elder_proxy who has not verified their own phone, and the blanket dependant read in both `private.can_read_clinical` overloads now applies to a `minor_child` only, so the proxy of an adult sees nothing until that adult chooses categories (the "Set up for my parent" flow). Open for you: this keeps the manage level for payments; if you would rather the old action be removed altogether and sponsors pay only through a confirmed proxy setup, say so.

### OQ-48 The dependent-claim flow sends an SMS that is not a verification code (raised by S04)
- `claimDependentAccountAction` inserts a `notifications` row on channel `sms` (`dependent_account_claimed`), which INV-08 forbids (SMS is for verification codes only). Extends OQ-32; S04 does not change it.
- Decision: Fixed in S04b-1. The claim flow now only starts a hand-over (`dependant_handovers`), attaches the number unconfirmed, and queues nothing: no SMS and no other notification. The only SMS is the Auth verification code the person triggers by signing in. The guardian is told on screen to ask them to sign in at app.tarragonhealth.ng; the record changes hands only when the person accepts (founder decision R3).
- Decision:
- **Resolved in code 2026-10-07 (S85-D3):** `claimDependentAccountAction` no longer queues any notification. The template never had a renderer, so that row could not have been sent. The person has no login or email yet, so the confirmation shown to the parent now says what to pass on (go to app.tarragonhealth.ng and sign in with that number).

### OQ-49 Optional consent types have no approved wording (raised by S04)
- `consent_versions` has rows only for the three original types. S04 adds the plumbing (`is_required`, withdrawal-aware logic, history) and seeds the optional purposes with `text_key`s, but the legal text (English) and the Pidgin equivalents need your approval and a native reviewer (OQ-19) before they are shown as real consent.
- Options: (a) ship the keys with clearly marked draft text behind a config flag until signed off (recommended); (b) hold the optional purposes entirely.
- Progress (S04b-2, migration `20261013181937`, NOT applied): drafts are a database concept now (`consent_versions.is_draft`). A draft is invisible to patients and anon, cannot be accepted, and can only be published by `public.publish_consent_wording` when a superadmin has switched on the platform module `optional_consent_wording`. Seeded one draft, `care_circle_sharing` (exact text in the PR for approval). `research` and `sponsor_reporting` already carry live wording (applied from other branches, see OQ-S04b2-1) and were left alone; they still need your approval as text of record.
- Decision:

### OQ-50 Self-serve account deletion and data export are not in S04 (raised by S04)
- Live: export and deletion are admin-reviewed requests (`data_export_requests`, `data_deletion_requests`); there is no `delete_account` function and no self-serve download. Automated erasure needs a retention decision (clinical records, `audit_log` has no FK on purpose, finance ledger entries are never deleted).
- Options: (a) keep the reviewed workflow and add a two-tap request and status view (recommended); (b) automate erasure after a legal retention ruling.
- Progress (S04b-2): chose option (a). Reused `data_export_requests` and `data_deletion_requests` (no third table). Export: two-tap request, stated timeline (`due_at`, 30 days), status, download when fulfilled (the S39f route and `export_my_data()`). Deletion: a grace period (7 to 30 days in the database, 14 PROPOSED in `privacy.deletion_grace`), nothing approved or completed before it ends, cancel until then (`public.cancel_my_data_deletion_request`), one open request per patient, requests and cancels written to `audit_log`, and a plain list of what is removed and what is kept (posted clinical records, audit logs, financial ledger entries, consent history). No clinical record is deleted by this flow. See OQ-S04b2-2 for what is still manual.
- Decision:

### OQ-51 Categories chosen by the parent do not set `profile_access.permissions` (raised by S04 review)
- `confirm_proxy_setup` grants the chosen `care_access_category` rows but stores empty `permissions`. Tables or screens gated by the `can_read_clinical(uuid, caregiver_permission)` overload can still refuse the proxy, so "share Medicines" may not let them see medicines. The direction is safe (less access than shown), but the two models disagree.
- Options: (a) define one mapping from category to permissions and write both at confirmation (recommended, needs a clinical and product decision on the mapping); (b) make the permission overload read the category rows.
- Decision: Fixed in S04b-1 with option (a), one mapping in SQL (`private.category_permissions`): appointments_care_plan -> view_appointments, view_care_plan; medications -> view_medication; labs_results -> view_results; messaging -> communicate_with_care_team; vitals, vaccinations, medical history map to nothing; reproductive_health never maps. `confirm_proxy_setup` writes both from the categories the parent ticked (the hand-supplied permission list is ignored), and the permission overload of `can_read_clinical` accepts a category the person chose, still requiring the permission to be in the grant's array. Needs a clinical read of the mapping (CMO) before it is called signed off.

### OQ-52 Starting a setup creates an unverified account for any phone number (raised by S04 review)
- The proxy flow uses phone OTP with `shouldCreateUser: true`, as spec 8.2 describes, so any patient can create a password-less, unconfirmed account and profile for an arbitrary number (5 a day each). That also runs `handle_new_user`'s roster claim before verification (OQ-41).
- Options: (a) accept and add per-number and per-caller limits plus a cleanup of never-verified setup accounts (recommended); (b) send no code to a number with no account and let the parent sign up normally, then show the pending request after verification (changes spec 8.2).
- Decision: Fixed in S04b-1 with option (b): starting a setup sends the code with `shouldCreateUser: false` on web and mobile, so no account, profile or employer-roster claim is created for a number nobody has verified. A number with no account gets the same answer as one with an account. A parent without an account signs up normally and sees the request once their number is verified.

### OQ-53 "A required consent cannot be withdrawn" is enforced only in the web action (raised by S04 review)
- `withdrawConsentAction` refuses required purposes, but the `patient_consents` insert policy and the withdrawal trigger still allow a patient to insert a withdrawn row for a required purpose directly.
- Options: (a) enforce it in `enforce_patient_consent_withdrawal` for current required versions and route account-level withdrawal to the data rights flow (recommended); (b) leave it app-level.
- Progress (S04b-2): chose option (a). `private.enforce_patient_consent_withdrawal` now refuses (SQLSTATE 23514) a withdrawal of a required consent by a signed-in person whose account is active; a closed account (`profiles.is_active = false`) and a service context are not blocked. The web and mobile actions explain the refusal and point to closing the account. Optional purposes stay individually withdrawable in two taps.
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
- **S07y evidence for the CMO (2026-10-20), nothing decided and no band changed.** `public.bp_band_divergence_report(days)` and the read-only pages `/clinician/bp-band-report` and `/admin/settings/bp-band-report` show, for the last 30 days, how many readings the app band (`private.classify_bp_level`, which the phone and web badge mirror; parity pinned in the DB proof and `bp-classification.test.ts`) and the level the live trigger `private.handle_bp_reading_red_flag` acts on place differently. Read from the live function on 2026-10-20, the two can differ in exactly three situations, and only these: (1) a personal target lower than 135/85 lifts a reading the app calls green to amber for the alert; (2) pregnancy lifts a reading at 140/90 to red and at 160/110 to emergency, where the app badge says amber or red; (3) now that the triage rule set is APPROVED (`approved_bp_rule_params()` is not null live), an emergency-range reading (200 systolic or 120 diastolic) with no red-flag symptom near it, not in pregnancy or after a birth, is acted on as red (Priority 1 alert, no patient emergency record) while the app badge still says crisis range. **Live data**: 4 real (non-test) patient accounts and 4 real blood pressure readings in all time, none in the last 30 days (456 test-account readings are excluded by design), so the report is empty today and will fill as real patients log. Run it before deciding; the shape of the answer is already known from the three situations above.
- **Decision needed from the CMO (not answered here)**: (a) Should the colour and words a patient sees on a reading ever differ from the level the alert pipeline acts on? If no: the badge must be fed the pipeline's level (a display-only change, S12 owns it; the server would have to return the level with the saved reading), including pregnancy and the no-symptom emergency case. If yes: say which of the three situations is allowed to differ and what the patient is told in each. (b) For the 200/120 reading without a symptom, which word does a patient see, "crisis range" (today's badge) or the red guidance the pipeline uses? (c) The original question is untouched and still needs its own signed answer: whether live bands move to the spec lines (180/120 with a symptom, 200/130 regardless, 180/110 repeat) through a versioned `triage_thresholds` set (S12), and the home default pair and a low-BP flag. Nothing in S07y moves a number.

### OQ-68 The dose reminder names the medicine, breaking INV-07 (raised by S07)
- `lib/dose-reminders.ts` schedules "Time for your ${item.drugName} dose (${item.time}).", hard-coded English, as a local notification. INV-07 says notifications never name a condition, reading or result; a medicine name can reveal a condition. Other legacy strings on the S07 screens (`bp-classification.ts`, `dose-reminders.ts`, and anything left on Home) were audited before Design Phase 1 moved Home and Vitals onto the kit; re-check at build time which are still hard-coded before listing them.
- Options: (a) S07 changes the reminder to keyed generic copy ("Time for your care plan check", no drug name) through `@tarragon/i18n`, and moves the strings of any file it touches; files it does not touch stay in the copy-lint baseline (recommended); (b) leave the medicine name and record it as accepted (conflicts with INV-07); (c) fix every legacy string in one pass (large, unrelated to S07).
- Pidgin versions of any new string need a native reviewer before the next store build (the OQ-61 pattern).
- Decision (founder, 2026-10-03): (a) the dose reminder becomes keyed generic copy with no medicine name, through `@tarragon/i18n`; strings in files S07 touches move to i18n; the Pidgin version needs native review.

### OQ-69 A due dose can raise two reminders: the one on the phone and the server's push (raised by S08)
- The phone holds its own local notification at the dose time. The existing cron `medication-dose-reminders-every-15-min` also queues a push and an in-app notice for the same dose, up to 15 minutes later if nothing has been logged. The server copy is useful when a phone maker has stopped the local one (docs/research/S08.md section 3), but a phone where both work shows the patient two reminders for one dose. S08 only removed the medicine name from the server text (INV-07).
- Options: (a) keep both: the server one is the backup for a killed local reminder (recommended until the real-device check shows how often local reminders are lost); (b) send the server one only to a patient whose phone has not reported a recent reminder plan (needs a new report from the phone); (c) drop the server dose reminder.
- Blocks nothing in S08. Related: OQ-05, OQ-21.
- Update 2026-10-07 (S53): kept as option (a). No change; still waiting for the real-device check.

### OQ-70 Local reminders are planned only for the device owner's own medicines (raised by S08)
- A guardian who manages a dependant can view and log that person's doses, and the dependant's schedule is their own (8.15), but `replanDoseReminders` plans for the signed-in account only. Planning for dependants on the guardian's phone needs a neutral way to tell the doses apart without naming a medicine (a first name is not a condition, so INV-07 allows it) and a rule for which phone reminds, since the dependant may have their own.
- Options: (a) plan for every dependant the guardian manages, generic text plus the dependant's first name (recommended); (b) leave it: the Today list for that person is still correct, only the reminder is missing; (c) remind only on the dependant's own phone.
- Update 2026-10-07 (S54): option (a) built on the phone (local reminders and the catch-up sheet); the server push copy is OQ-316.

### OQ-71 Other server notification templates still name a medicine (raised by S08)
- S08 made `medication_dose_reminder` and `medication_refill_reminder` neutral and added a test (`packages/medicines/src/notification-wording.test.ts`). These still put `drug_name` in wording that reaches a push, an email or the in-app inbox: `medication_adherence_checkin`, `medication_review_due`, `medication_prescribed_patient`, `prescription_updated_patient`, `pharmacy_order_patient_confirmation`, `missed_dose_behavioural_nudge` (written by `private.route_missed_dose_reason`, whose wording is also a behavioural nudge the research would reject if it shames), and the `send-pending-notifications` lines that build text from `payload.drug_name`.
- Options: (a) S13 (notifications framework with the INV-07 lint) owns all of them (recommended); (b) fix them now in S08 (touches the prescription flow, which S24 changes).
- Resolved 2026-10-07 (checked by S53): S13 rewrote them. Live read-only check: no active `notification_template_locales` body or subject for `medication_adherence_checkin`, `medication_review_due`, `medication_prescribed_patient`, `prescription_updated_patient`, `pharmacy_order_patient_confirmation`, `medication_dose_reminder` or `medication_refill_reminder` carries a drug placeholder; `missed_dose_behavioural_nudge` has no active locale row. The database lint trigger now refuses a clinical placeholder.

### OQ-72 A skipped dose with a reason does not reach the care team as its own signal (raised by S08)
- The phone records a skip with a short key in `medication_logs.reason` (`side_effect`, `felt_well`, `other`; "I do not have it" is logged as `not_available`). `private.route_missed_dose_reason` only reads `status = 'missed'` with `missed_reason`, so a skip because of a side effect is stored and visible in the dose log but does not raise a review task. `not_available` already counts toward the 3 and 6 missed-dose alerts.
- Options: (a) a "side_effect" skip raises a care-team review task through the existing `care_outreach_tasks` path (recommended; needs the Chief Medical Officer's wording); (b) leave it for S11/S12 to read from the `medication_dose_recorded` signal, which carries the status but not the reason.
- S08x (2026-10-13) reviewed this and left it open: it needs the CMO's wording and the S16 task path, so it is not a tiny change. The new `medication_prn_limit_repeated` signal is unrelated to skip reasons.

### OQ-73 Android exact alarms and boot persistence need a native build (raised by S08)
- `expo-notifications` 0.32 (SDK 54) does not expose `canScheduleExactAlarms`, and its `delivery: 'alarmClock'` option arrived in a later SDK (docs/research/S08.md section 3). On Android 12 and later, exact timing needs `SCHEDULE_EXACT_ALARM` in the manifest (not `USE_EXACT_ALARM`, which Play restricts), and alarms survive a reboot only with a boot receiver. `app.json` declares neither. The health check passes "unknown" for exact alarms and does not warn about them.
- Options: (a) declare `SCHEDULE_EXACT_ALARM`, add the in-context explanation and settings link, bump `runtimeVersion` and build (recommended, after the first real-device test on a Tecno or Infinix phone); (b) wait for the SDK upgrade that carries the newer `expo-notifications`. Either is a native-affecting change, so the OTA publisher will not ship it.
- S08x (2026-10-13) built option (a) in code: `SCHEDULE_EXACT_ALARM` and `RECEIVE_BOOT_COMPLETED` in `app.json`, a local Kotlin module (`apps/mobile/modules/exact-alarms`) for the check and the settings screen, the in-context explanation, the visible "may be a few minutes late" notice, a maker-aware "Keep reminders working" checklist, and `runtimeVersion` `0.1.0-native6`. **Still open until a real-device run**: nothing here has run on an Android phone and the Kotlin module has not been compiled. Close it after the Tecno/Infinix/Samsung lab run (shares the S06x-c matrix).

### OQ-74 Pidgin wording for the S08 strings needs a native reviewer (raised by S08; the S11 strings are listed in docs/PIDGIN-REVIEW-S11.md)
- About 90 new keys (`medicines.notify.*`, `meds.*`) were written in English and a first Pidgin version. Same rule as OQ-61 and OQ-63: a native reviewer before the next store build. The reminder text and the skip reasons matter most.
- Superseded (2026-10-06): Moot. Nigerian Pidgin was removed from the product on 2026-10-06 (D-14). The English wording and its clinical review stand.

### OQ-75 Adherence below the line: what the care team sees and when (raised by S08)
- The weekly percentage is shown to the patient as a plain count with supportive wording and to tied clinicians as "doses marked taken". The `medication_adherence_low` signal fires once a week for a patient under 80 percent (the proposed line). The existing 3 and 6 missed-dose alerts still run separately. Whether the weekly signal should create a task, and the Chief Medical Officer's confirmation of 80 percent over 7 days, wait for S11 and S12; S08 never changes treatment or messages the patient about it.
- Options: (a) signal only until S12 defines the task (recommended); (b) also notify the patient's care team inbox now.

### OQ-76 Windows on existing medicines, and catch-up for dependants (raised by S08b)
- A flexible window can be set when a patient adds a medicine, but not edited afterwards, and a clinician-prescribed medicine has no window (its times are the care team's). The catch-up sheet covers the device owner's own medicines only; a guardian is not asked about a dependant's doses (same gap as OQ-70).
- Update 2026-10-07 (S54): the catch-up half is built (a guardian is asked per dependant, answers recorded for the dependant). Editing a window after the fact is still open.
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
- **Resolved in code 2026-10-07 (S85-D3), signed ladder untouched:** the sender no longer treats "critical" as a reason to text. A critical SMS is allowed only for a recipient whose role is `clinician`; for anyone else it is marked failed (not suppressed) so the ladder still reaches its exhausted-ladder alarm to the admins instead of ending quietly. The signed `escalation_slas` rows still name `sms` as a rung; see OQ-330 for the CMO-signed change. A clinician phone call for an unreached patient is a task, not an SMS; no task is created by this change (OQ-331).

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
- Decision (founder, 2026-10-06): option (a). Keep in `apps/web` until S35 extracts the clinician area, then move the shared components.

### OQ-100 Two credential ladders now exist (raised by S15)
- The older §29.7 ladder (`provider_restrictions`, warning, grace, service restriction, suspension on a CMO-signed policy) restricts new appointment bookings only. The S15 sweep suspends at expiry after an audited grace period, as decided. They act on the same dates. Eligibility now consults both, so the older one can only tighten.
- Options: (a) fold the older ladder into S15 so there is one expiry process and one grace concept (recommended, a later pass, needs the CMO because the policy is signed); (b) keep both and document it.
- Decision (founder, 2026-10-06): option (a), as a later pass with the CMO, because the older policy is CMO-signed. Until then eligibility consults both and the older ladder can only tighten.

### OQ-101 A patient account becomes a clinician account (raised by S15)
- An applicant is a normal person account until activation, when `profiles.role` flips to `clinician`; a suspended or offboarded clinician flips back to `patient`. A doctor who is also a patient of Tarragon would lose the patient dashboard while active.
- Options: (a) advise a separate work account for the clinician login (recommended; the application page says nothing yet); (b) keep one account and allow both views, which needs a dual-role design the account-role rule forbids.
- Decision (founder, 2026-10-06): option (a). The application page now advises a separate work account for the clinician login (done in S15 follow-up).

### OQ-102 Staff and applicant screens are English only (raised by S15)
- The spec asks for every user-facing string in `packages/i18n` (en, pcm). The existing admin and clinician pages are plain English and the people using these screens are clinicians and reviewers, so S15 follows that convention. Applicant copy avoids clinical jargon and em dashes.
- Options: (a) leave English, revisit if a Pidgin-speaking reviewer needs it (recommended); (b) move the copy into the i18n package.
- Decision (founder, 2026-10-06): option (a). Leave English; revisit if a Pidgin-speaking reviewer needs it.

### OQ-103 A CMO-approved test applicant gets a real-flag clinician row (raised by S15)
- `private.guard_is_test_flag()` only lets an admin or a service context set `is_test`; approval runs as the CMO, so `clinical_staff.is_test` is set only when the approver is also an admin. A QA applicant approved by a CMO needs an admin to flip the flag afterwards.
- Options: (a) accept and document (recommended); (b) let the approval function carry the flag by running as a service context.
- Decision (founder, 2026-10-06): option (b), changed from the first recommendation after the live test run left an active, routable fake doctor with the real flag. Approval now carries the application's own test flag (set from the applicant's profile, which only an admin can mark as a test account) through a transaction-local setting the guard honours for that one clinician row. Proved in `s15_clinician_credentialing.sql`.

### OQ-104 Applicant phone is required but not proved verified (raised by S15)
- `start_clinician_application` checks the email is confirmed and a phone number is present. Where S03 records a verified phone was not confirmed against auth, so a verified phone is not yet required.
- Options: (a) require the S03 phone-verified marker once confirmed (recommended); (b) leave as is.
- Decision (founder, 2026-10-06): option (a), built as the config rule `require_verified_phone` (credentialing config version 2), OFF for now because no real account has a confirmed phone and SMS is not live, so switching it on today would stop every applicant. Turn it on once SMS verification is live. QA accounts are exempt.

### OQ-105 Training and test content must be written and approved before anyone can pass (raised by S15)
- Five draft training modules are seeded with placeholder text and no test scenarios exist. Nothing is approved by the agent. Until the CMO writes and approves at least one safety-critical scenario, `start_credential_test` refuses with a clear message and no application can pass the test.
- Blocks: the first real applicant. Decision: the CMO authors at `/clinician/credentialing/content`.
- Resolved 2026-10-06: the CMO approved all 8 training modules and all 14 test scenarios, and a live end-to-end run passed the test.

### OQ-106 MDCN verification route, turnaround and annual grace (raised by S15)
- There is no register to query; the founder set the evidence (current-year licence, portal screenshot, graduation certificate, NYSC). Written confirmation from MDCN is accepted as an optional document. The exact MDCN verification route and turnaround, and each year's renewal grace announcements, are not confirmed.
- Options: ops asks MDCN for written verification where it matters and records the reply (recommended); the audited grace period in S15 is the lever for an announced MDCN grace.
- Decision (founder, 2026-10-06): ops asks MDCN for written verification where it matters and records the reply; the audited grace period is the lever for an announced MDCN grace.

### OQ-107 One person verifying and approving (raised by S15)
- The person who verifies a check cannot approve the application (`separate_verifier_and_approver`, on). A sole founder who is both admin and CMO needs two accounts to credential anyone.
- Options: (a) keep on and use two accounts (recommended); (b) switch the config value off with a recorded reason, which weakens the control.
- Decision (founder, 2026-10-06): option (a). Keep the control on and use two accounts. The live test run proved it works (applicant, admin verifier, CMO approver).

### OQ-108 Document retention has a date but no purge (raised by S15)
- `retain_until` is set at offboarding (7 years, PROPOSED, `document_retention_years_after_offboarding`). Nothing deletes a document after that date, and a rejected applicant's documents have no date at all.
- Options: (a) add a nightly purge with an audit row, and a retention for rejected applications (recommended, counsel sets the periods); (b) manual review.
- Decision (founder, 2026-10-06): option (a), built. A nightly job (`/api/cron/credential-document-purge`, 03:40 UTC) removes the stored file, then the row with one audit entry, for documents past `retain_until` and for rejected applications past `rejected_application_document_retention_months` (24, PROPOSED). It does nothing while `document_purge_enabled` is false, which is the live setting until counsel confirms the periods.

### OQ-109 The two existing clinicians have no licence or indemnity dates (raised by S15)
- The sweep never suspends on a missing date (it would remove the only clinicians), so they are reported as "No date on file" on the licences and cover page until ops records them through a renewal. The founder-CMO is covered by an existing indemnity exemption.
- Action for ops: upload and record the licence for both, then the indemnity for any freelance clinician.
- Decision (founder, 2026-10-06): ops action, no code. Record both licences and any freelance clinician's indemnity through a renewal.

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

### OQ-453 S18 and S19 must merge before the S21 slot RPC (raised by S21)
- S21 books from confirmed `bookable_consultations` blocks. `availability_blocks` is on main-dev (S17) but confirmation, rota and `clinician_offerable` are only on PR 931 (S18 and S19), which is open with merge conflicts.
- Decision (founder, 2026-10-06): merge S18 first. S21 builds everything that does not read the rota first, and the slot RPC lands after PR 931.
- Update (2026-10-06, later): S18 and S19's migrations are now applied to production (ledger rows exist) while PR 931 is not merged, so the database enforces S18's block rules (minimum 2 hours, no declaring over leave). S21's slot function reads confirmed `bookable_consultations` blocks and works with or without S18's code; the S21 proof makes its blocks 2 hours long so it holds either way. PR 931 is merge-blocked on CI, not on conflicts.

### OQ-454 Authoritative encounters table (raised by S21, closes OQ-38)
- Decision (founder, 2026-10-06): new authoritative `encounters` table. `clinical_encounters` stays as a synced projection so current readers keep working. `consultation_scribe_consents` (renamed 2026-10-06, see OQ-161), rooms and events hang off `encounters`.

### OQ-455 How real the call is in S21 (raised by S21)
- Decision (founder, 2026-10-06): link-based Zoom now (audio-first join, server-owned fallback ladder, in-app waiting room and consent), masked phone callback as the last step. An in-app SDK is a later session.

### OQ-456 Cancellation and refund rule (raised by S21)
- Decision (founder, 2026-10-06): full refund when the patient cancels 2 hours or more before. Inside 2 hours a small fixed retention (PROPOSED value in config). A clinician cancel or no-show is always a full refund or a free rebook. The rule is shown before the pay button.

### OQ-457 Consent, transfer mechanism and MDCN text (raised by S21)
- Decision (founder, 2026-10-06): per-consultation in-app consent is accepted for NDPA and GAID purposes, the transfer mechanism covering Supabase, Zoom and Claude is accepted, and the MDCN position on recording and AI is accepted. Recording stays off by default. Counsel has not reviewed these separately.

### OQ-458 Consultations are for adults only (raised by S21)
- Decision (founder, 2026-10-06): no video, audio or phone consultation for anyone under 18. Booking checks the patient's age server-side. A dependant under 18 cannot book. Written questions for minors are not decided and stay as they are today until the founder says otherwise.

### OQ-459 Consultation price (raised by S21)
- Decision (founder, 2026-10-06): NGN 10,000 (1,000,000 kobo) for a consultation, replacing the 5,000 placeholder on `video_visit_credit`. One price for video, audio and phone, so a fallback never changes what the patient paid. Result interpretation (10,000) and written question (2,500) are unchanged.

### OQ-460 Zoom dial-in in Nigeria and the phone fallback (raised by S21; revised 2026-10-06)
- Confirmed 2026-10-06 from Zoom's rates page: Nigeria has toll dial-in (needs the Audio Conferencing add-on, Zoom-provided numbers only) and call-out at about GBP 1.08 to 1.68 a minute, which is too dear for a NGN 10,000 consultation.
- First decision (founder delegated the vendor, 2026-10-06): a Tarragon-owned number bridge on Africa's Talking Voice. Built, then **withdrawn the same day** by the founder: "instead of Africa's Talking, can we just turn off the Zoom video if the network is bad and people can still make the voice call."
- **Decision (founder, 2026-10-06): the phone fallback is Zoom's own dial-in.** The person rings a Nigerian number Zoom publishes for the room and types the meeting id and passcode; they land in the same call as the clinician. No second vendor, no number of ours, no callback route, no table holding anyone's phone number, nothing rung from our side. The older "turn the camera off" half already exists: audio only is offered in the room and an audio-only rejoin comes in audio first. The Africa's Talking adapter, bridge store, callback route and `phone_bridges` table were removed (migration `20261006164657_s21f_drop_phone_bridges_use_vendor_dial_in.sql`; the table had 0 rows).
- Built: `VideoProvider.dialIn` (Zoom reads the meeting's Nigerian numbers and phone passcode from the meeting each time and never stores them; rooms are created with `audio: both` and `global_dial_in_countries: [NG]`), a mock, `requestDialIn` in the room logic, and a "Join by phone call instead" card showing the number, meeting id and passcode with a tap-to-call link.
- **To confirm on the live Zoom account before real use:** (1) the account has the Audio Conferencing add-on, otherwise Zoom lists no toll numbers and the room says "we could not find a phone number" (a safe failure, not a broken call); (2) the Nigerian numbers actually appear in `settings.global_dial_in_numbers` for a meeting created by the Server-to-Server app; (3) `pstn_password` is returned and a phone caller can get past the passcode prompt; (4) a phone caller waits in the waiting room and the host can admit them (they show as a call-in user or a masked number, which is why the clinician is told to expect that); (5) a call costs the patient only their normal carrier charge.
- Consequences to accept: the patient pays the carrier for the call, the call is not private from the clinician's side in the way a bridge was (the clinician may see a masked number in the Zoom participant list), and we cannot see that someone dialled, so a consultation is never marked "on the phone" automatically (the in-app SDK, OQ-136, can). Open until the live checks above are done.

### OQ-461 What a red page should say to Care Circle supporters and the clinical lead's review (raised by S19)
- The spec's red event table also notifies Care Circle members with `red_alerts` and creates an incident review task for the clinical lead. S19 builds the page and the escalation only.
- Options: (a) Care Circle notices in S29 and the review task in S20 (recommended); (b) pull them into S19 now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-462 Acknowledgement targets and how long the lead is re-alerted (raised by S19)
- 5 and 10 minutes (spec) and a 5 minute repeat of the lead alert are PROPOSED numbers with no Nigerian benchmark. No re-alert ever reaches a person after the clinical lead and ops if all of them are away.
- Options: (a) ship the numbers, CMO to set them in `paging_config` (recommended); (b) add a third rung (a named deputy or the founder) with its own phone.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-463 Contractor status and declared hours (raised by S18, second pass)
- Declared availability blocks, a displayed weekly floor and a lead cap can look like control over a contractor (Hims lists contractor classification as a risk in its annual report; Wheel and Amwell Associates are 1099 contractors). Nigerian labour-law treatment of the freelance clinicians is not established here.
- Options: (a) take Nigerian employment-law advice before contracted clinicians are onboarded, and keep the weekly floor a display only (recommended, built); (b) enforce a minimum now.
- Decision (founder, 2026-10-06): (a), as recommended. S18 built it.
- Superseded (2026-10-06): Moot. The scribe is English only (`en-NG`) since Pidgin was removed 2026-10-06 (D-14).

### OQ-464 Strikes and a doctor's other job (raised by S18 and S19, second pass)
- NARD issued an ultimatum effective 1 October 2026 and has struck or threatened in each recent quarter; public hospitals are moving towards biometric work-hour logging; dual jobs are common. A freelance resident could be unreachable inside their own shifts, and the rota assumes people are available when they declared it.
- Options: (a) for now, rely on declared blocks and the backup, with the employed tier and the CMO as the last rung, and record the doctor's main-employer hours later using the existing availability rules (recommended); (b) add a strike-window switch that widens escalation, and a voice-call rung for the CMO tier only (D-12 currently allows push, in-console alarm and email only, so this needs a decision).
- Decision (founder, 2026-10-06): (a), as recommended. S18 and S19 built it.

### OQ-465 Acknowledgement targets are not clinically validated (raised by S19, second pass)
- 5 and 10 minutes match vendor example defaults (PagerDuty, Opsgenie) and the Manchester Triage targets measure first clinical contact, not acknowledgement; the Joint Commission requires a written, measured time but sets none. No Nigerian benchmark was found.
- Options: (a) ship the PROPOSED numbers, record them as policy and review the measured acknowledgement times from `paging_overview` after the pilot (recommended); (b) have the CMO set stricter numbers now.
- Decision (founder, 2026-10-06): (a), as recommended. S19 built it.

### OQ-466 S18 and S19 must merge before the S21 slot RPC (raised by S21)
- S21 books from confirmed `bookable_consultations` blocks. `availability_blocks` is on main-dev (S17) but confirmation, rota and `clinician_offerable` are only on PR 931 (S18 and S19), which is open with merge conflicts.
- Decision (founder, 2026-10-06): merge S18 first. S21 builds everything that does not read the rota first, and the slot RPC lands after PR 931.
- Update (2026-10-06, later): S18 and S19's migrations are now applied to production (ledger rows exist) while PR 931 is not merged, so the database enforces S18's block rules (minimum 2 hours, no declaring over leave). S21's slot function reads confirmed `bookable_consultations` blocks and works with or without S18's code; the S21 proof makes its blocks 2 hours long so it holds either way. PR 931 is merge-blocked on CI, not on conflicts.

### OQ-467 Authoritative encounters table (raised by S21, closes OQ-38)
- Decision (founder, 2026-10-06): new authoritative `encounters` table. `clinical_encounters` stays as a synced projection so current readers keep working. `consultation_scribe_consents` (renamed 2026-10-06, see OQ-161), rooms and events hang off `encounters`.

### OQ-468 How real the call is in S21 (raised by S21)
- Decision (founder, 2026-10-06): link-based Zoom now (audio-first join, server-owned fallback ladder, in-app waiting room and consent), masked phone callback as the last step. An in-app SDK is a later session.

### OQ-469 Cancellation and refund rule (raised by S21)
- Decision (founder, 2026-10-06): full refund when the patient cancels 2 hours or more before. Inside 2 hours a small fixed retention (PROPOSED value in config). A clinician cancel or no-show is always a full refund or a free rebook. The rule is shown before the pay button.

### OQ-470 Consent, transfer mechanism and MDCN text (raised by S21)
- Decision (founder, 2026-10-06): per-consultation in-app consent is accepted for NDPA and GAID purposes, the transfer mechanism covering Supabase, Zoom and Claude is accepted, and the MDCN position on recording and AI is accepted. Recording stays off by default. Counsel has not reviewed these separately.

### OQ-471 Consultations are for adults only (raised by S21)
- Decision (founder, 2026-10-06): no video, audio or phone consultation for anyone under 18. Booking checks the patient's age server-side. A dependant under 18 cannot book. Written questions for minors are not decided and stay as they are today until the founder says otherwise.

### OQ-472 Consultation price (raised by S21)
- Decision (founder, 2026-10-06): NGN 10,000 (1,000,000 kobo) for a consultation, replacing the 5,000 placeholder on `video_visit_credit`. One price for video, audio and phone, so a fallback never changes what the patient paid. Result interpretation (10,000) and written question (2,500) are unchanged.

### OQ-473 Zoom dial-in in Nigeria and the phone bridge vendor (raised by S21)
- Confirmed 2026-10-06 from Zoom's rates page: Nigeria has toll dial-in (needs the Audio Conferencing add-on, Zoom-provided numbers only) and call-out at about GBP 1.08 to 1.68 a minute, which is too dear for a NGN 10,000 consultation.
- Options: (a) Tarragon-owned number bridge on Twilio Voice; (b) LiveKit SIP or a Nigerian carrier trunk; (c) Zoom toll dial-in only, patient pays carrier rate.
- Recommend (a) behind an adapter with a mock, after checking NCC caller-ID rules with the carrier. Vendor choice is the founder's.
- Decision (founder delegated the choice, 2026-10-06, "which one will work in Nigeria, easy to connect, cheap"): **Africa's Talking Voice**. Their published Nigerian rates are about NGN 15 to 20 a minute a leg; Twilio is about USD 0.23 a minute (roughly NGN 350), which makes a bridged half hour dearer than the NGN 10,000 consultation. The adapter, bridge store, protected callback route and a database table are built (`phone-africastalking.ts`, `phone_bridges`, `/api/voice/africastalking/[secret]`). **Not yet run against a live account.** Before real use: create the Africa's Talking account, buy a Nigerian Voice number, set AT_VOICE_* and the callback URL, run the sandbox, and confirm with them (1) the callback fields and that `clientRequestId` is echoed, (2) that a bridged call shows our number to both people, (3) the Nigerian caller-ID rule with the carrier, (4) that the Dial's `maxDuration` is honoured (else cap call length on the number in their dashboard), (5) whether they can sign callbacks or restrict them to their IP addresses (today the only credential is a secret in the callback URL, which Vercel logs), and (6) what they do when a callback reply is lost or retried (today a retry is rejected, so the clinician would not be dialled and the app would show the bridge as connected). Open until then.

### OQ-474 Legacy video paths left alone in S21 (raised by S21)
- `consult_availability_slots` with `video_visit_requests` (a second slot system, used by mobile) and the org-wide `video_consultations` read policy that exposes `host_start_url` to any org staff member each have about 8 call sites. Narrowing either now would blank live screens (the PR 789 failure).
- Recommend: S21 leaves both, routes the new flow through `encounters` and issued join tokens, and a follow-up session inventories and migrates the call sites, then closes the policy.
- Decision: open.

### OQ-475 Cash refund of a cancelled consultation (raised by S21)
- S21 returns the consultation credit when the patient cancels 2 hours or more before, or when a clinician cancels or does not attend. Returning money already paid to Paystack is refund work that belongs to S26 and is not built here (INV-09: no balance, no stored value).
- Options: (a) credit returned, cash refund on request through S26; (b) cash refund automatically.
- Recommend (a) now, (b) when S26 lands.
- Decision: open.

### OQ-476 Pidgin for the scribe consent prompt (raised by S21)
- CON-001 is consent text. The i18n rules keep consent and legal text in one language until a clinician has signed off a translation, and `scribe_enabled` already needs legal review of CON-001 (spec 14). So the `consult.scribe.*` keys have English text in the Pidgin catalogue on purpose.
- Options: (a) English only until legal review and a clinician-signed Pidgin translation exist (recommended); (b) ship a Pidgin draft now.
- Decision: open.
- Superseded (2026-10-06): Moot. The scribe is English only (`en-NG`) since Pidgin was removed 2026-10-06 (D-14).

### OQ-477 Consultations are not behind a go-live guard yet (raised by S21)
- INV-14 and spec 14 say the `clinical_operations_enabled` guard blocks consultations. The guard mechanism (`app_config.go_live`) is S37. Until then a consultation can be booked as soon as a clinician has bookable slots and the patient holds a credit.
- Recommend: S37 wires the guard into `hold_appointment_slot` and `service_get_encounter_room`. Do not switch consultations on for real patients before then, or before the phone bridge vendor (OQ-131), the slot RPC (OQ-124) and the CMO's sign-off exist.
- Decision (founder, 2026-10-06): build it now, so consultations cannot be switched on until the guard is satisfied. S37 built it: `clinical_operations_enabled` is wired into `hold_appointment_slot`, `confirm_appointment_booking`, `service_get_encounter_room` and the booking screen. It starts off and cannot be switched on until an approved hypertension protocol and an approved triage rule set exist (neither does today). The phone bridge (OQ-131) and the CMO's own sign-off of the consultation policy are still separate human steps; the guard does not check them (see OQ-180 follow-ups).

### OQ-478 Automatic fallback needs the in-app call SDK (raised by S21)
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
  - **Host key decision (founder, 2026-10-06: build the recommendation).** Zoom has no host token for a single meeting, so the key stays but its reach shrinks, in three steps: (1) **a dedicated host user.** Every consultation meeting is created under one dedicated, licensed, low-privilege Zoom user (`ZOOM_HOST_USER_ID`, a Zoom user id or email; unset means the app's own user, as before), so a leaked key can only start meetings as that user and never as the account owner; the key is requested for the user the meeting itself reports as its owner (`host_id`), so it can never disagree with how the room was made. (2) **A short, fresh key per join.** The server asks Zoom for the key only when the clinician joins, only for the clinician on their own consultation, inside the join window, with a lifetime from the versioned configuration `consultations.host_key` (`ttlSeconds` 300, PROPOSED) and never longer than the token or the room; a rejoin asks again; it is not stored or logged. (3) **An audit event before it leaves the server.** Each issue writes an append-only `host_key_issued` event on the encounter through a server-only function that names the clinician it was issued to (checked against the encounter's clinician at that moment, so a later reassignment cannot change who the record says; no key, empty payload). With a dedicated host user configured, a key is only ever minted for that user: a meeting made before it was set, or by another path, is refused (the room falls back to the link) rather than given the account owner's key, and if that write fails the key is not handed out and the room falls back to the link (migration `20261006215422_s21h_host_key_issued_audit_event.sql`; only the server can write the event, never a signed-in user). Not changed: the join LINK flow still hands the clinician Zoom's own host link (its start key lasts about two hours and cannot be shortened from here); one Zoom user per clinician (the strongest option) waits for more clinicians and licences. **To confirm on the live account:** that Zoom allows creating meetings for another user from the Server-to-Server app and which scopes that and the start-key call need (the exact scope names are unconfirmed), and Zoom's minimum and maximum for the key lifetime.
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
### OQ-479 Medicine safety checks beyond allergy, duplicate and controlled (raised by S24)
- Blocks: none. S24 enforces three checks at signing: a controlled medicine is a hard stop (no override), an allergy match or an empty allergy list or a duplicate active medicine needs the signer's stated reason. Drug-drug interaction, renal dosing, dose-range and drug-in-pregnancy checks need reference data this platform does not hold (a licensed interaction source and a CMO-approved dose table). The BP-class combination and pregnancy rules in `private.enforce_bp_prescribing_safety` still apply.
- Options: (a) the CMO and a pharmacist choose the reference source and S24b loads it as versioned data (recommended); (b) licence a commercial interaction service; (c) leave as is.
- Recommend (a). Until then the sign screen must not imply that an interaction check ran.

### OQ-480 Titration step table and the first approved protocol (raised by S24)
- Blocks: the "Suggest next step" button producing a proposal for a real patient. `public.protocols` has no row; the evaluator is built and tested on a placeholder marked draft with fictional drug names. The CMO writes the `htn_hearts_ng` definition (steps, thresholds, review window, adherence floor) and approves it. Until then the button answers "no approved step table yet" and a clinician proposes changes by hand.
- Decision needed from the CMO: the step table content, and the proposed stop thresholds (minimum readings, adherence floor, review window, stale-readings limit) which are PROPOSED values inside the protocol, not code.

### OQ-481 Who reviews an engine proposal, and when (raised by S24)
- A proposal is a draft `care_plan_changes` row that the lead clinician sees in the patient's chart panel. There is no queue task for it because a new task type needs CMO sign-off (the S16b pattern). Options: (a) add a `titration_review` task type, class 3, created when an engine proposal is saved (recommended once the step table exists); (b) weekly digest to the lead; (c) leave it chart-only.

### OQ-482 Caregivers, guardians and dependants confirming a change (raised by S24, extends OQ-70)
- Only the patient can confirm or decline a signed change. A parent of a dependant, or a caregiver holding the medications permission, cannot, so a change for a dependant simply expires after the window. Decide whether a guardian may confirm for a child and whether a caregiver may confirm for an adult who cannot (and with what proof).

### OQ-483 The confirm function acts as the signer for the length of the apply (raised by S24)
- `confirm_care_plan_change` runs for the patient but, so that every existing medication trigger sees the signer's own act (attribution, the clinician allow-list, confirm-only, prescribing safety), it sets the transaction-local session claims to the signer and puts them back before returning. It runs only after the patient, signed state, expiry, re-check and signer authority checks, and fails closed if the signer has lost authority. The alternative is to teach each trigger a signed-change exception, which spreads the exception across eight triggers. Security review wanted before go-live.

### OQ-484 Two copies of the controlled-medicine list (raised by S24)
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
- **Update 2026-10-16 (S26b): the refund reversal is built** (see OQ-S26b-02 for what still has to call it). Withholding tax and the employed to contracted conversion below are unchanged.
- A refunded purchase does not reverse a consultation share automatically; an admin posts a negative adjustment. S26 (refunds) should call a reversal. Withholding tax is stored nowhere and calculated nowhere (D-09). A clinician who changes from `employed` to `contracted` earns lines only for work finished after the change and a clinician changed the other way keeps their old lines (each line records `employment_type` as at entry).

### OQ-185 A late line can push a clinician past the pilot minimum (raised by S30)
- The top-up for a run of declared hours is computed once, from the lines in the ledger when the run is processed (two hours after it ends). A line posted later for work done inside the run (a retried posting, work finished before any schedule existed, a retroactive first schedule) is not netted off, so the clinician can end with more than the guarantee. The amounts are small and visible. **Decide** whether to reverse and repost top-ups when a late line lands, or accept it for the pilot.
### OQ-485 update (S24b, 2026-10-06): the CMO's screen for the step table now exists
- `/clinician/titration-protocols` lets the Chief Medical Officer paste a definition, check it, save it as a draft and approve it (functions `save_protocol_draft` and `approve_protocol`, CMO only, audited). The build wrote no clinical content and approved nothing: the page starts empty. Until the CMO approves a definition for `htn_hearts_ng`, "Suggest next step" still says no approved step table.

### OQ-486 update (S24b, 2026-10-06): reviewed and hardened; independent review still advisable
- Review: `docs/security/S24-confirm-care-plan-change-review.md`. Changes: the signer must hold a currently verified, unexpired licence when the change is applied; a signed stop that matches no active medicine is sent back; the session identity is asserted to be the patient's again before any later write. Residual: the signer's tie is not re-checked at confirm time (CMO to confirm that reading), and the review was written by the build session, so an outside reviewer is still advisable.

### OQ-487 No ledger posting for catalogue orders yet (raised by S25)
- v5 orders sit beside the live purchase tables and never touch `payment_transactions`, so none of the live finance posting triggers see them. A paid order is therefore not in the general ledger, the revenue-recognition views or the settlement reports. It is visible, not hidden: `payments` holds every verified payment with price, fee and total, and `orders.state` is the status. No money has moved through it (checkout is dormant).
- Needs a finance decision before the module is switched on: accounts for Membership (deferred revenue over 12 months?) and care pack income, where the Paystack fee sits (the patient pays it; it is not income and not a cost), and the refund reversal. S26 (refunds) and S30 (earnings ledger) are the natural place.
- Options: (a) a `finance_post_from_order` function that posts `payments` rows, built with the finance owner before go-live (recommended); (b) write a mirror row into `payment_transactions` so the live posting runs (rejected for now: it would also fire the service-purchase, voucher and fraud triggers, which read the same table).
- **Resolved 2026-10-06 (founder: "fix this")**: built in the same migration. Same accounts as a live service pack, so the finance pages need nothing new: Membership or care pack, Dr 1020 / Cr 2000 for the PRICE and a straight-line schedule into 4020 over the access window; an item with no window, Dr 1020 / Cr 4100 at sale. The processing fee is the patient's and Paystack settles the price, so it is not posted. Test orders are never posted (INV-13). A posting failure never undoes a payment: it opens a financial incident and an hourly job retries. The refund reversal is S26. The finance owner should still read the accounts above before go-live; they are the ones the existing service-pack posting uses.

### OQ-488 Paying for someone else is not open yet (raised by S25)
- `orders` carries `buyer_profile_id` and `beneficiary_patient_id`, but `create_order` refuses any beneficiary other than the buyer (`order_beneficiary_not_allowed`) until S29 (Care Circle) defines who may pay for whom and what the supporter may see. Spec 19.4 and 19.5 (supporter pays, sponsor-paid shown as already paid) wait for it. `shop.paid_for_you` is already in the catalogue strings.
- Decision: open, S29.

### OQ-489 Care pack price and what is sold at launch (raised by S25)
- The 2026-10-05 Membership (100,000 naira a year, 10,000,000 kobo) is founder-confirmed and seeded as `membership_annual`. The spec's 12,000 naira three-month BP care pack (spec line 696) is PROPOSED and seeded as `bp_care_pack_3m`. Both are seeded OFF. Do both exist at launch, or does the Membership replace the care pack? A Member who also buys a care pack would pay twice for overlapping clinician time. The lead-clinician capacity gate counts both.
- Options: (a) launch with the Membership only and keep the care pack off (recommended: matches the 2026-10-05 pivot, "Free or Member, nothing in between"); (b) both on.
- **Decided 2026-10-06 (founder): Membership only.** The care pack is no longer seeded; staff can add one later. Prices can be changed at `/admin/catalogue` with a reason; an order keeps the price it was made at.

### OQ-490 Retired payment code paths are still reachable (raised by S25, extends OQ-97)
- The OQ-97 decision said to delete the retired GBP/USD and plan-based paths in S25 "if unreachable". They are reachable: `handler.ts` still handles `subscription`, `add_on`, `sponsored_subscription` and the plan events, `apps/web/src/lib/paystack` still allows GBP and USD, and live rows in the older purchase tables depend on them. Removing them is a separate removal session with its own row count and `ship the code first, the schema second` order, not a side effect of a checkout build.
- S25 added the v5 branch and left the legacy one untouched. Naira only holds for everything S25 built (`create_order` has no currency; the adapter and `record_order_payment` reject anything but NGN).
- **Decided 2026-10-06 (founder): its own removal session after S26** (count live rows first, ship the code before the schema, prove with a rolled-back test).

### OQ-491 Fee estimate is configuration, and its numbers are unverified (raised by S25, extends OQ-97)
- Paystack has no fee-preview call, so the checkout shows an ESTIMATE labelled as one, from `commerce.processing_fee_estimate` (1.5 percent plus 100 naira, the 100 waived under 2,500 naira, cap 2,000 naira). The figures come from third-party summaries; the official pricing page could not be read when this was written. The exact fee is read from the verified payment and recorded on the order and receipt. Cards issued abroad cost more (reported 3.9 percent plus 100 naira, uncapped), so for those the estimate is too low; the screen says so (`pay.fee.international` exists, shown in the explanation block on web).
- Still to confirm against Paystack test mode before go-live: the field names `requested_amount` and `fees` on verify and `charge.success` (OQ-97). If `requested_amount` is absent, the database records an `amount` mismatch rather than accepting a different total, so a genuine payment is held for a person, never lost silently.
- Refunds and the fee (S26): recommended full refund when we cancel returns the fee, a patient-requested partial does not; Paystack reportedly keeps its processing fee on refunds, which would make a fee refund a Tarragon cost.
- **Fee numbers confirmed 2026-10-06** against paystack.com/pricing: local card and USSD 1.5% + NGN 100 (NGN 100 waived under NGN 2,500), capped at NGN 2,000; international 3.9% + NGN 100. Registry entry is now v2, confirmed. At the 100,000 naira Membership price the local fee is NGN 1,600 (total NGN 101,600). Still open: the `requested_amount` and `fees` field names in test mode, and the refund-and-fee rule (S26).

### OQ-492 Secrets and deploy steps for S25 (raised by S25)
- Before the module can be tried against Paystack test mode: set `ORDER_RETURN_URL` and `ORDER_RECONCILE_SECRET` as function secrets, add the Vault secret `order_reconcile_secret` with the same value (the 5-minute cron fails closed with a 401 until both exist), deploy `order-checkout`, `order-verify`, `order-reconcile` and the updated `paystack-webhook`, then run one test-mode payment end to end and one replay from the Paystack dashboard. Nothing in S25 was deployed or applied to production by the build session.
- Secrets and deploy done 2026-10-06. **Go-live order decided (founder):** merge PR 945, run one Paystack TEST-mode payment and one dashboard replay (the founder runs it with test keys in a local copy of the function secrets, with a published Paystack test card; the live key is never used), then a superadmin runs `set_platform_module('v5_checkout', true, '<why>')` and switches `membership_annual` on at `/admin/catalogue`. Nothing is switched on before that.

### OQ-493 Lab panel ranges and critical limits are unsigned (raised by S27)
- `lab.panels` (registry, mirrored by `lab_panel_versions` v1) holds adult reference ranges and critical limits for the Essential and Annual Health Check panels, PROPOSED by the build, owner CMO. They are not adjusted for age, sex or pregnancy, and the lipid limits are desirable targets, not lab-printed ranges, so many results will wait for review.
- Safe by design: a wrong range only adds reviews. An all-normal result is the only thing that auto-releases, and a result missing a required analyte is held too.
- Needed from the CMO: sign the ranges and critical limits (a new `lab_panel_versions` row, never an edit); whether HIV, HBsAg and HCV Ab belong in the Annual Health Check at all (they are optional and entered only if ordered); how an indeterminate screening value is handled (the portal refuses it today and asks for a new sample).

### OQ-494 The older partner PDF path conflicts with INV-03 (raised by S27)
- `lab_partner_upload_result` and the `lab_result_documents` triggers (live since 2026-07-27) let a patient read a partner's PDF at once and send them a "result document available" notice, with no hold for abnormal values and no sensitive-positive rule. Left unchanged, as the session rules require; the new partner portal does not use it.
- Recommended: point the old worklist upload at the new submit function (PDF only, held for review) and retire `lab_partner_upload_result` after counting live rows. Founder decision needed on timing.

### OQ-495 Releasing a result does not complete its queue task (raised by S27)
- `release_lab_result`, `record_lab_disclosure` and `withhold_lab_result` change the result, not the S16 task (`routine_result_review`, `critical_result_review`, `sensitive_result_disclosure`). The clinician still completes the task in the queue. Linking the two is a small follow-up once the Next-task console (S35) shows the task beside the result.

### OQ-496 Audio and AI explanation layers must read `explain_allowed` (raised by S27)
- `my_lab_results()` returns `explain_allowed = false` for a result with a sensitive positive and for a patient's own upload. The old AI summary on `lab_result_documents` and any future audio bundle (S32) do not read it yet. Before either is shown for a structured result, it must check this flag (INV-04).

### OQ-497 Who may release a critical value (raised by S27)
- A critical result creates a `critical_result_review` task for a senior doctor (class 2), but `release_lab_result` lets any eligible clinician tied to the patient release it. A positive HBsAg, HCV Ab or HIV needs a senior clinician by the database. Confirm with the CMO whether a critical result should need the same.

### OQ-498 Free patients' own outside uploads wait without a reviewer (raised by S27 review)
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
- **Fixed by S71 (2026-10-07), except the profile row (OQ-404):** paying needs a Care Circle `pay_for_care` or a `manage` grant with `manage_payments`; `booking_requests`, `vaccination_adverse_events` and `vaccination_card_extractions` reads need the matching permission or category; `profiles_select` refuses expired and empty grants.
- **CLOSED 2026-10-21 (live audit; migration `20261021101733_oq192_profile_access_permission_tightening.sql`, proof `packages/db/tests/oq192_profile_access_permission_tightening.sql`).** Read-only scan of live `pg_policies` and `pg_proc.prosrc` (0 `profile_access` rows live). Fixed: vaccination records, schedules, adverse events and card extractions writes (manage + unexpired + vaccinations category), `dependant_handovers_read` (unexpired), `can_purchase_voucher_for` and `price_review_for_patient` (an expired grantee could still buy or price; expiry added, view-level grantees can still buy and quote, matching the client picker and a read-only quote), `redeem_promo_code` and `create_transaction_subsidy` (`manage_payments` + expiry), `report_exposure` and `sponsor_set_dependent_basics` (expiry), and expiry on `booking_requests_insert`, the menstrual tables and `reproductive_health_profiles` writes (category rule unchanged). Checked and safe: `can_act_for` (both), `can_read_clinical` (all three), `profile_access_active`, `may_act_for_photo`, `report_caregiver_scope`, `supporter_has_mental_health_consent`, `tracker_deletion_allowed`, `log_proxy_view`, `care_receipt` (money limited to the caller's own vouchers), `resolve_patient_service_access`, `sponsor_care_status` (needs `clinical_access`), the proxy, handover, sweep and notify functions (they act on the grant's own owner or grantee), and the policies `profile_access_categories_select`, `profiles_select_my_grantees`, `adolescent_confidentiality_waivers_insert`. The proof also scans for any new policy that reads `profile_access` without an expiry, `can_act_for`, `can_read_clinical`, `profile_access_active` or category check, and fails on one. Still open and unchanged: the profile row (OQ-404). Deliberately not changed: `private.activate_sponsored_service_purchase` (runs after the sponsor has already paid; refusing there would strand a paid purchase) and `booking_requests_insert` does not require `book_appointments`, because category-model grants cannot carry that permission (`private.category_permissions` has no mapping to it); requiring it would stop proxies booking. Founder call if proxies should book.
- **Status re-check 2026-10-16**: live `create_order` is the S71 version (it calls `private.order_beneficiary_check`, which needs a Care Circle `pay_for_care` or `can_act_for(..., manage_payments)`), so the addendum below (any grantee can pay) is closed. (Superseded 2026-10-21 by the CLOSED entry above: the vaccination policies and function bodies were audited and fixed.) See `docs/design/OQ192-and-oq-renumber.md`.

### OQ-220 Supporters abroad: organisation, signup and the join link (raised by S29)
- The Care Circle, like the older care-access guard, requires the supporter and the patient to share an `organisation_id`. A supporter signing up from the diaspora lands in the default organisation today, so it works, but only because there is one. Signing up from an invite link loses the link across the email-verification redirect (the user reopens it).
- Not changed. If a second organisation or a distinct diaspora organisation is ever created, `accept_care_circle_invite` and `create_order` need an explicit cross-organisation rule.
- Native app deep links for the join link are not built (the link opens the web page).
- **Update (S29e, 2026-10-16): the explicit cross-organisation rule is built.** A supporter whose organisation differs from the patient's may join only as a supporter-only account (`receives_care = false`), never holds `pay_for_care` (stripped by a trigger on the member row, so every path obeys it; `order_beneficiary_check` already refused paying across organisations), and needs at least one view permission left; a full patient of another organisation gets the same silent "no" as any bad link, so no bridge between two records is created. The block builder is the same one, so INV-07 is unchanged. Paying from abroad across organisations stays a finance decision. Native: `tarragonhealth://join/<token>` (the scheme was already in the build, no rebuild) opens a join screen in the app; the web page offers "Open in the app" and stays the fallback. Universal links (`https://` opened straight in the app) need an apple-app-site-association file, an assetlinks file and a native build, and are not done.

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

### OQ-499 addendum (2026-10-06): live `create_order` already let any `profile_access` grantee pay
- S26's `create_order` (live since 2026-10-06) allows ANY `profile_access` grantee, whatever their permissions, to buy for the patient. The S29 `create_order` keeps that path (so nothing live changes) beside the Care Circle `pay_for_care` path, with the organisation and test-flag checks added to both. A gift that grants a lead now waits for the patient's yes whichever path paid. Tightening the older path to `manage_payments` is part of OQ-192.



### OQ-500 Guards live in `go_live_guards`, not `platform_modules` (raised by S37; conflicts with OQ-18)
- OQ-18 said go-live guards reuse `platform_modules`. `set_platform_module()` needs only a superadmin and a note, never evaluates a condition against data, and its row is updatable by the table owner. S37's requirement is a switch only a condition-evaluating function can flip, with who, when and why in an append-only log, provable even against the migration role. So S37 added `go_live_guards`, `go_live_guard_log` and `go_live_attestations` and left `platform_modules` untouched (it still serves the payer, provider-org, NGO and `v5_checkout` modules).
- Options: (a) keep two mechanisms, `platform_modules` for dormant whole platforms and `go_live_guards` for clinical go-live (recommended; the two answer different questions); (b) later migrate the four `platform_modules` rows onto the guard table and retire it, which needs each module's RLS and route guards re-pointed.
- Decision: open. Not blocking.

### OQ-501 Test accounts pass the guard as a pair (raised by S37)
- A booking where the patient and the clinician are both `is_test` passes `clinical_operations_enabled` (and the scribe start check passes `scribe_enabled`), so the consultation flow can be tried end to end with test accounts in the single production database before launch, and the existing DB proofs (all test accounts) keep their meaning. A real person is never reachable: `profiles.is_test` is changeable only by an admin or a service context.
- Options: (a) keep the test-pair rule (recommended); (b) remove it and exercise consultations only after launch (not recommended: nothing could be tested first).
- Decision: open.

### OQ-502 A guard that is on is not switched off when its condition lapses (raised by S37)
- If the only tier 2 clinician is suspended while consultations are on, the guard stays on and the dashboard shows a red notice. An automatic switch-off would close a live consultation service without a human decision, which is itself a patient-safety event; the existing rota gap alert and credential suspension already page people.
- Options: (a) show the notice only (recommended; as built); (b) send the founder and the CMO an in-app notice when a guard drifts (small, additive follow-up); (c) auto-switch-off (not recommended).
- Decision: open.

### OQ-503 Attestations are one person's word (raised by S37)
- Conditions the database cannot see (CON-001 legal review, speech provider configured, fee schedule approved, Paystack transfers configured, SYNLAB results flow tested, Stage 2 exit criteria) are recorded as attestations by an admin or the CMO with a note. No attestation exists; none was written by an agent. They are not verified by the system.
- Options: (a) accept a single attester with a permanent record (recommended for a solo founder); (b) require two people (founder and CMO) for the clinical ones.
- Decision: open.

### OQ-504 Guards wired later, and what each still needs (raised by S37)
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

### OQ-505 More conditions the guard does not check yet (raised by S37)
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

## S03b: accounts that survive a lost number (2026-10-13)

### OQ-S03B-01 Apply order and the dashboard steps S03b needs (your action)
- Nothing from S03b is applied. Order: (1) redeploy `send-pending-notifications` (without it every S03b email fails as "unknown template"; the in-app notices work regardless), (2) apply `20261013182157_s03b_account_recovery_routes.sql`, then `20261013191246_s03b_eligibility_first_claims.sql`, each in its own transaction with the version pinned to its filename, (3) merge the app PR. This is additive, not a removal, so the usual "code first, schema second" rule does not apply: the app calls the new RPCs, so apply the migrations before the app is used. Merged first, the new screens show a plain error message rather than crash, and the older flows (email link, phone code, change number) keep working, except that the change-number step then asks for a confirmation the database cannot yet record, so apply the migrations in the same sitting as the merge.
- Dashboard: the confirm-it-is-you step for a number change by EMAIL sends a 6-digit code with `signInWithOtp({email})`. The hosted "Magic Link" email template must show `{{ .Token }}`; the Supabase default shows only the link. Until the template is edited, the email route of that step does not work and the old-number route does (an account with a confirmed phone can still change its number; an email-only account cannot until the template is edited).
- The first migration creates a Vault secret (`account_backup_code_pepper`). Rotating it makes every issued backup code unusable.
- Decision:

### OQ-S03B-02 Existing notices never reached anyone by email (found by S03b; the email half is FIXED in the S03b PR, the rest stays open)
- **Fixed in S03b (2026-10-13):** the sender now looks up the recipient's VERIFIED address from Auth for any `security.*` email row without `payload.to_email` (covers `security.new_device_signin`), and `security.assisted_recovery_requested` / `_executed` are registered. Needs the `send-pending-notifications` redeploy. **Still open below:** both older notices are `critical` (re-sent by SMS) and assisted recovery's SIM-swap flag over-fires.
- The dispatcher sends an email row only when `payload.to_email` names the address, and only for a template with an entry in `TEMPLATE_MAP`. `security.new_device_signin` (`record_login_device`) queues its email row with no `to_email`, and the three `security.assisted_recovery_*` templates have no `TEMPLATE_MAP` entry (OQ-42 point 7). Both therefore fail as "recipient has no email address" / "unknown template". S03b's own notices carry `to_email` and have entries. The older two are a small separate fix (add `to_email` in `record_login_device` and `queue_recovery_notice`, register the three templates). A second finding from the code review: those two older notices are queued with priority `critical`, and `private.escalate_unconfirmed_critical_notifications()` re-sends a sent, unopened critical notice on push, then email, then SMS about 40 minutes later, so a new-device or assisted-recovery notice can be TEXTED, which INV-08 forbids. S03b's own notices are `routine` for exactly this reason. A third: assisted recovery's SIM-swap flag reads `auth.users.phone_confirmed_at`, which GoTrue re-stamps on every successful SMS code, so the flag over-fires; S03b records when the number actually moved (`account_phone_changes`) and assisted recovery could read that instead.
- Decision:

### OQ-S03B-03 What the recovery contact route can and cannot do
- The link goes only to the patient's own VERIFIED email, or a code to their own VERIFIED phone. So the route cannot help a person who has lost every verified channel; that person still needs assisted recovery (OQ-42). What it does add: a human who can say "this is really them", a one-day wait with a notice at every step, and a way through when the text-code route is paused after a number change. If the founder wants the contact route to be able to move an account to a NEW email or number, that is a different feature (a session-bound flow started by the owner) and needs its own decision.
- The wait (24 hours), the request window (48 hours) and two requests a week are PROPOSED values.
- Decision:

### OQ-S03B-04 Backup codes are made on the web only
- Backup codes are generated and shown on the web profile page (`/patient/profile`), which the phone app already opens. The phone app has the recovery-side screen (sign-in recovery) but no generate-codes screen. A native screen is a small follow-up if wanted.
- **Built 2026-10-16 (PR from `feat/mobile-backup-codes-auth-pause`).** The sign-in-time "use a backup code" path already existed on the phone (it calls the same public route and limits as the web). New: a Backup codes block in phone Settings (count left, make or replace behind a confirmation step and a password re-check) served by `GET/POST /api/mobile/backup-codes`, which reuses `verifyPasswordAndRecordStepUp` and `public.generate_backup_codes` exactly as the web card does (single-use step-up bound to the session, per-day limit, old set ends at once, owner notified). Codes are held in screen state only. Open: (a) there is no Copy button and no screenshot block, because both need a native module (`expo-clipboard`, `expo-screen-capture`) and the phone's OTA rules forbid adding one without a new binary; the screen offers the system Share sheet and tells the person not to screenshot. Add both with the next native build if wanted. (b) Not run on a device.
- Decision:

### OQ-S03B-05 Not verified on a real device or against hosted Auth
- Nothing in S03b has run on a phone, against a real Termii send, or against the hosted Auth service. In particular: (a) how GoTrue words the failure when the `auth.users` number-change trigger refuses a change (the web card recognises two wordings; a third would show a generic error), (b) that `verifyOtp({email, type: "email"})` accepts the code from `signInWithOtp({email})` for an already signed-in user, (c) that `signInWithOtp({phone})` for a signed-in user re-sends through the Send SMS hook. The rolled-back database proofs ran on the real schema; the Auth round trips did not run.
- Decision:

### OQ-S03B-06 The 72 hour pause is enforced by our apps, not by Auth (found in the S03b code review)
- `my_phone_recovery_hold()` is asked by the web `verifyPhoneReset` and the phone `enforcePhoneRecoveryHold`, right after a recovery code is accepted. A person who sends the code straight to the hosted Auth API gets a session without passing either, and `updateUser({password})` then works. Signing in by code is not paused at all (it never was). Closing it properly means either (a) pausing code sign-in and the Send SMS hook for a recently changed number (the hook cannot tell a sign-in code from a recovery code, and the change-number code to the NEW number must still go out), or (b) a rule on password changes during the pause, which would also block the legitimate email-link reset. Neither is built. Decide whether the app-level pause is enough for launch.
- **Partly built 2026-10-16: option (a), at the Send SMS hook.** `public.auth_sms_hold(uuid)` (migration `20261016185844_s03b_auth_sms_hold.sql`, service role only) answers the same question as `my_phone_recovery_hold` for a user id. The hook (`supabase/functions/auth-send-sms-hook`) asks it before sending and, for an account inside the pause, WITHHOLDS the code but answers Auth with the same 200 as a real send, so no response differs between a paused and an unpaused account (no enumeration signal). No code is sent, so none can be entered, whoever calls Auth directly. It fails closed: if the hold cannot be read the hook answers 503 and sends nothing; a payload with no user id is refused. The code for a pending number change must still go out, so it is exempted only when the user object proves it: `phone_change` is set and its `phone_change_sent_at` is seconds old and newer than every other code timestamp; anything unclear is treated as a sign-in code and withheld. Email links, backup codes, the recovery contact route and password sign-in never pass through the hook and are untouched; a recovery-contact release lifts the pause for two hours as before.
- **Dashboard step the founder must do (once the function and the hook are deployed):** in the hosted project, Authentication > Hooks > Send SMS must be enabled, pointing at the `auth-send-sms-hook` function, with `SEND_SMS_HOOK_SECRET` set (this is the S03 hook; if it is already on, nothing more is needed). Without the hook enabled, Auth uses its built-in SMS provider and this protection does nothing. The code is safe to deploy first: deploy the migration, then `supabase functions deploy auth-send-sms-hook`; an old hook that does not call `auth_sms_hold` simply behaves as before. Deploy order matters the other way round too: if the NEW hook is deployed before the migration, every send fails closed with 503.
- Costs and limits, stated plainly: (1) a genuine owner inside the pause who asks for a text code gets nothing and no error (by design, to leak nothing); the number-changed notice by email and in-app already says text recovery is paused for a few days and our apps list the other routes. (2) A sign-in code is blocked as well as a recovery code, for 72 hours after ANY change of the sign-in number, including a first-time add (the log does not record whether there was a previous number); password sign-in still works. (3) Not built: refusing a session at mint time. Considered and rejected: a Custom Access Token hook cannot tell phone OTP from email OTP (both report `otp`), would block the owner's own email-confirmed number change, and a bug in it would stop every login; a trigger on `auth.mfa_amr_claims` would depend on GoTrue's internal write order. (4) What the hook payload contains (`phone_change`, the `*_sent_at` fields, and that they are already updated when the hook runs) is from Supabase's documentation and was NOT confirmed against the hosted service; the dependent branch only decides the number-change exemption, and its failure mode is withholding a number-change code (the person retries after the pause), not letting a code through.
- The phone also ignores a failed sign-out when the pause is on (it still shows the message); the session then stays, as it would for a code sign-in.
- Decision:

### OQ-S03B-07 Accepted limits of the public recovery routes (found in the S03b code review)
- Anyone who knows a person's email or number can (a) burn that person's backup-code attempts for an hour (ten wrong tries lock that route for that account, whatever the source), (b) open a recovery request that blocks their own for 48 hours and uses up two requests a week, and (c) send their recovery contact an in-app and email notice. The only brakes are the IP and identifier limiter (in-memory until Upstash exists, OQ-44) and the weekly cap. Each lockout affects only that route; the email link and the phone code are separate. The patient can cancel from any signed-in session.
- The sign-up programme-code check is a yes/no on a 40-bit code behind a per-IP limit of ten tries in 15 minutes: not practically enumerable, but not an authenticated surface either.
- Decision:
---

## Raised by S35c (scribe safety)

### OQ-213 The facts stage lists medicines the draft stage may not write (raised by S35c)
- The facts-to-confirm stage returns `medication_mentioned` facts (the exact words used) so the clinician can check them: medicine information is where audits of AI notes find most failures. Stage two still writes "Medication plan discussed with the clinician" and never names a medicine, so AI-017's guardrail `no_medication_names_or_doses` and INV-02 still hold for everything that reaches the note. The facts live only in the browser and are never stored.
- Needs the CMO's reading: is listing a mentioned medicine for confirmation inside that guardrail? If not, drop the `medication_mentioned` type from `FACT_TYPES` and the eval case `facts_cover_safety_items` changes with it.
- The new suite "AI-017 facts-to-confirm golden transcripts" (6 cases, required for release, threshold 100) is registered; no evaluation run exists and none was created. The two new prompts are not approved; AI-017 stays off.
- Decision: open.

### OQ-214 Language release needs a measured word error rate and a pass mark (raised by S35c)
- `pnpm scribe-wer manifest.json` measures speech-to-text on consented recordings against checked transcripts, per language, with dropped negations and missed protected terms. It has no pass mark. The mark for switching a language on (Nigerian English, Pidgin) is a PROPOSED value for the CMO, and no consented audio has been collected (OQ-96, speech vendor undecided).
- Options: (a) CMO proposes a maximum WER and a zero-tolerance rule for dropped negations, then it is added to the registry (recommended); (b) keep the scribe to typed notes only, with no speech-to-text, indefinitely.
- Decision: open.
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): proposed pass mark: zero tolerance for dropped negations and protected terms, plus a word-error ceiling the CMO sets after the first measured results; every note stays clinician-verified. Not yet a registry value.**

### OQ-215 The signed hash detects change; it is not a signature (raised by S35c)
- `signed_content_hash` is a plain sha256 of the signed text, stamped by trigger at finalize. It shows a stored note was altered afterwards; it does not prove who signed (the existing `finalized_by_staff` does) and nobody holds a key. A keyed or externally anchored signature is a larger decision.
- Options: (a) keep the tamper check (recommended for now); (b) add a periodic job that re-checks every hash and raises an incident on a mismatch; (c) a keyed signature held outside the database.
- Decision: open.

### OQ-216 No live recording indicator exists because nothing records (raised by S35c)
- The scribe takes pasted or typed notes only. The consent gate now shows the patient's three-state answer, but a live "recording" indicator with elapsed time and a stop button needs audio capture, which needs the speech vendor (OQ-96). Build it with that session.
- Decision: open.

### OQ-217 The amber warning window on the queue is 30 minutes (raised by S35c)
- `queue.sla_warning` (registry, PROPOSED, CMO) turns a held task's due badge amber inside 30 minutes. Display only: it changes no deadline, routing or fee. The CMO confirms or changes it on the go-live sign-off screen.
- Decision: open.
### OQ-506 Admin patient search: rate limit and who may open (S36a)
- Blocks: nothing. Live: `admin_patient_search` returns at most 25 rows and writes one audit row per search; exact email and phone digits are searchable, so a determined admin could probe whether an email is registered.
- Options: (a) accept, since the caller is the single founder admin and every search is audited (recommended while there is one admin); (b) a per-hour search cap once a second admin or delegated support role exists; (c) widen to a `support.patient_lookup` permission for the support team (needs a decision on what support may see, since opening a record shows date of birth and email).
- Decision: open. Recommend (a) now, (c) when support is staffed.

### OQ-507 Directory freshness and re-verification cadence (S36, spec 25.3 and 25.9)
- Blocks: the directory freshness build. Live: only licence-expiry notices exist for labs and pharmacies; no listing has a last-verified or next-due date. The research found no competitor that publishes a re-verification schedule.
- Options: (a) 12 months for every partner, 6 months for pharmacies; (b) tie the interval to the partner's licence expiry; (c) risk-tiered by volume.
- Decision: open. Needs the founder (partner terms) and the CMO (clinical partners). PROPOSED values live in versioned config, never in code.
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): clinical side: re-verify at each licence expiry, never more than 12 months apart (MDCN practising licences are annual). The founder still decides partner terms.**

### OQ-508 Payout approval and the ops "prepare draft" half (S36, spec 9.4 and roles table)
- Blocks: the payout screens. Live: S30 fee schedules and `earnings_ledger` exist with `payout_id` empty; S31 (payouts table, weekly draft job, Paystack transfers) is not built, so there is nothing to approve.
- Options: (a) wait for S31 and build both halves there (recommended); (b) build a read-only "unpaid earnings by clinician" view for ops now (small, test accounts excluded).
- Decision: open. Maker-checker (preparer and approver different people, enforced in the database) is the design in `docs/research/S36.md`.

### OQ-509 Speak-up concerns screen (S20, S36)
- Blocks: the clinician and lead screens for safety concerns. Live: the S20 functions exist; concerns are readable only by the person who raised them, the CMO and named backup readers, and never by operations. The founder is not yet a named backup reader (OQ-158).
- Decision: open. Build only after the CMO names backup readers and reviews the wording shown to someone raising a concern. Not in S36.
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): wording approved (OQ-246). Still blocked on the CMO naming backup readers (OQ-158).**

### OQ-510 Admin accounts can still reinstate a clinician directly (S36d, spec 9.4)
- Blocks: nothing. Spec 9.4 says only the clinical lead reinstates. Live (S15, unchanged): `public.reinstate_clinician` admits an admin account or the CMO (`can_credential_review`); the S15 proof reinstates as an admin. The new roster gives operations (a delegated `clinical_staff.manage` holder) only a REQUEST door, and `decide_clinician_change` is CMO only (an admin account is refused). The /clinician/roster screen is the CMO's; /admin/ops/clinicians offers ops no reinstate button.
- Options: (a) accept while the founder holds the only admin account (recommended); (b) tighten `reinstate_clinician` to the CMO and change the S15 proof, a one-line change to a shipped function.
- Decision: open. Recommend (a) now, (b) when a second admin exists.

### OQ-511 Role grants do not expire (S36d, spec roles table)
- Blocks: showing a grant expiry. Live: `user_permission_grants` has no expiry column, so the history view shows "No expiry" for every grant. Adding one means changing `private.has_permission`, the most reused security function (it gates RLS on many tables).
- Options: (a) accept; revoke by hand, the history shows who granted what and when (recommended now); (b) add `expires_at` and honour it in `has_permission`, with its own proof and a full re-run of the RLS tests.
- Decision: open.

### OQ-512 Ops cannot suspend through S15's own door (S36d)
- Blocks: nothing. S15's `suspend_clinician` admits only admin or CMO; ops is a delegated permission, so `ops_suspend_clinician` (reason of 10+ characters, audited, runs S15's own internal suspend) was added for `clinical_staff.manage` holders. Decision wanted: should ops be allowed to suspend at all without the CMO, or only to request it? Suspension is the safe direction (it removes a clinician from queues), which is why it was allowed.
- Decision: open. Recommend keep.

### OQ-513 Competency request notice reaches admins and the CMO only (S36d)
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
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): wording approved as written. The screens still stay closed until the CMO names backup readers (OQ-158).**

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
- Decision (founder, 2026-10-06): add `expo-audio` and `expo-file-system` and the player adapter now, with the `runtimeVersion` bump to `0.1.0-native6` held until the build is cut (decided 2026-10-07: build later, batched with other native work). Built in S32 (PR 961). Nothing plays until signed recordings exist. No build has been cut: do the bump and `eas build` together when there is more native work to batch.

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
- Decision (founder, 2026-10-06): (1) blood pressure gets a unit clip, NUM-P24 "millimetres of mercury" (added in `audio/source/extra-clips.json`, clinical review required; until it is recorded and signed, blood pressure audio is text only); (2) emergency clips play in silent mode and take audio focus, everything else respects silent mode, no lock-screen controls and no background playback; (3) screen readers: English only, plain labels and a hint, no Pidgin language tagging. Still open: a real-device TalkBack and VoiceOver pass, regulatory status of spoken triage, and Pidgin voice input (out of scope).

> Note: S29's Care Circle questions were renumbered from OQ-193 to OQ-198 to OQ-220 to OQ-225 (2026-10-07, founder choice, then moved again because S32 and S35 took OQ-201 onwards): S31's payout questions keep OQ-193 to OQ-200.

### OQ-514 When the patient pauses sharing, do check-in requests (red alerts) pause too? (raised by S29c)
- "Pause all sharing" (7 days, silent to supporters, no reason) stops the supporter's page and lists. Whether it also holds back the neutral check-in request is a safety trade-off: a patient who feels watched wants everything off; a patient who pauses and then has a red event would have a family that is not asked to call. The patient's own care team's escalation is a different path and is never paused.
- Built (after the review): the patient chooses, with a plain warning beside the tick, and the tick is OFF by default, so a plain pause hides the summary and leaves the check-in request on. Holding back check-in requests is an explicit opt-in. A request sent while they were held back is never shown after the pause ends. A pause always ends by itself after `pause_days` (7) and the patient is told once.
- Options: (a) as built; (b) tick ON by default ("pause all" means all, less safe); (c) never pause check-in requests.
- Recommendation: (a) with the CMO reading the warning wording; revisit if a real incident happens during a pause.
- **Decided 2026-10-07 (founder): keep check-in requests on by default** (option a, as built). The CMO should still read the warning wording beside the tick.

### OQ-515 Only the full yearly Membership can be paid for someone else (decided by the founder 2026-10-06, built by S29c)
- Founder: "the gift should be someone paying for a full yearly membership". `create_order` now refuses any beneficiary order that is not a Membership of 365 days or more (`gift_item_not_allowed`), on both the Care Circle path and the older `profile_access` path (OQ-192). Single consultations, short memberships and care packs sold on their own cannot be gifted; a patient still buys those for themselves.
- Checkout asks the payer to confirm the person's name, says the person is asked to accept it and that a no is a refund, and says the payer sees no health information.
- Still open from OQ-191: the unanswered-gift window (`gift_decide_days`, 30 today; the plan suggests 14) is a founder number.

### S27d: follow-ups built (founder, 2026-10-06, "fix all")
- **OQ-176 (CMO ranges): built, NOT signed.** `lab_panel_signoffs` and `sign_lab_panels()` (CMO only), shown in the CMO signing hub and at `/clinician/lab-panels`. Until the CMO signs, nothing auto-releases: every result is held for review (fail closed). I did not and cannot sign for the CMO. Doctors will see every normal result in their queue until then; sign early.
- **Staff emailed-result path: closed.** Staff uploads now create a HELD result; the older `lab_result_documents` table can no longer show a result to a patient or tell them about it before review (live rows: 0). The automatic number extraction no longer runs on an unreviewed staff file.
- **OQ-179 (explain gate): consumer built.** `canExplainLabResult()` plus a standing scan test that fails if AI or audio code reads structured results without it. Nothing needs it yet; S32 must call it.
- **Competitor changes 1 to 4 built:** held sensitive results escalate to the CMO after 3 attempts or 72 hours, never released by default (`lab.release_policy`, PROPOSED); one neutral "under review" state with an expected time from `escalation_slas`; corrections and withdrawals as first-class, re-gated and notified neutrally; a "screening result, not a diagnosis" label for HIV, HBsAg and HCV Ab. Change 5 (the patient result card with a plain-language sentence) stays design only: it needs the CMO to approve the sentences.
- **Not built:** a screen listing released results so a senior clinician can withdraw one (the function and the rule exist; only the page is missing). **OQ-182:** the thresholds 3 attempts and 72 hours are PROPOSED; the CMO should confirm them when signing.
### OQ-230 Two blood pressure control definitions (raised by S38)
- The July 2026 `bp_control` measure (for insurers and employers) is the most recent reading in a period under 140/90 for people covered the whole period. S38's `bp_control_90d` is the 7-day average 90 days after a person joined, against their own target, counting people who stopped logging as not controlled. They answer different questions and both stay, named apart; `bp_control_90d` is a new row in `outcome_measure_specs`. Nothing converts one into the other.
- Options: (a) keep both, named apart (recommended); (b) retire the payer one in favour of the 90-day measure once a payer asks for it.
- Decision: open (CMO).
- **Decided 2026-10-07 (founder): keep both, named apart.**

### OQ-231 Release 4 items not built (raised by S38)
- Risk stratification (22.3, `risk_scores`, `risk-model`), the personal monthly progress report (22.5), the symptom-checker accuracy dashboard (22.4), sponsor dashboards and exportable pilot reports (22.6, 22.9) and clinician worklists ordered by risk are Release 4 in the spec. S38 builds the data they need (snapshots, the de-identified layer, the suppression rules) and the 90-day report only. The research is clear that a risk score must be deterministic, explained, used only to order outreach and never to deny care; that rule is recorded here for the session that builds it.
- Decision: open (founder, when Release 4 is scheduled).
- **Decided 2026-10-07 (founder): after 90 days of real snapshots.** Build the risk scores, the personal monthly report, the accuracy dashboard and sponsor exports once the first cohort reaches day 90, so they can be tested against real data.

### OQ-232 Which readings count (raised by S38)
- Readings flagged only for a missing arm or position are counted; readings flagged as a duplicate or a sudden change are not, until a clinician clears them. Counting every flagged reading would let duplicates and typing errors move the rate; counting none would make most home readings invisible. The share of readings held back is not yet reported.
- Options: (a) as built (recommended); (b) count only fully valid readings; (c) count all and report the flagged share.
- Decision: open (CMO).
- **Decided 2026-10-07 (founder): as built.** Readings flagged only for a missing arm or position count; duplicates and sudden changes wait for a clinician. Reporting the share of readings held back is still a follow-up.

### OQ-233 Smallest group shown (raised by S38)
- Eleven is the usual rule in health reporting (and 20 when a cut uses two attributes). The Nigeria Data Protection Act and the NDPC's 2025 guidance require privacy by design but name no number that was found. Set in `outcome_config` v1 as PROPOSED, owner CMO, with counsel's view still needed before any figure leaves the company.
- Decision: open (CMO and counsel).
- **Decided 2026-10-07 (founder): raised to 20 now.** `outcome_config` v2 (applied to production as `20261006230528_s38b_min_cell_20.sql`): the smallest group shown is 20 and 30 for a cut by two attributes; the published measure `bp_control_90d` is spec v2 (minimum 20), v1 retired. Counsel should still confirm a figure before anything leaves the company.

### OQ-234 Adherence at a past date uses today's medicine list (raised by S38)
- S08's weekly adherence is computed from the person's current active medicines. A snapshot is taken within days of its window so the difference is small, but a medicine stopped or changed inside the window is not reconstructed. Adherence is stored beside BP and never used in the control figure.
- Decision: open (CMO); fix by reading the medicine history once S24 records changes.
- **Decided 2026-10-07 (founder): accept the approximation until S24 records medicine history.** Adherence stays beside BP, never inside the control figure.

### OQ-270 Who joined, and from when (raised by S38; was numbered OQ-235, which S36g already used)
- Day 0 is the earliest start of a Membership (purchased, voucher, employer or granted) or a care pack entitlement. A free user has no snapshots. Care pack and Membership are treated alike. If a person lets a membership lapse and joins again, day 0 stays the first start.
- Decision: open (CMO).
- **Decided 2026-10-07 (founder): the first Membership or care pack start, any source (purchased, voucher, employer, granted), is day 0.** A lapse and rejoin keeps the first start; free users have no snapshots.

### OQ-271 Not applied, console home (raised by S38; was numbered OQ-236, which S36g already used)
- The migration is not applied to production (apply before merging). The page is in `apps/web` (`/admin/outcomes`); S36 and S37 decide where the console version lives. The report is open to admins and the active CMO only; a clinical lead who is neither cannot see it yet.
- Decision: open.

### OQ-274 Risk points and tier cut-offs (raised by S38c)
- Every weight in `risk_config` v1 (for example 45 points for a 7-day average 20 or more above target, 40 for a red event, 50 for 10 days of silence; medium at 30, high at 60) is a PROPOSED starting value, not a clinical judgement. They only order outreach.
- Options: (a) CMO reviews against the first month of real scores and the fairness report before the worklist is relied on (recommended); (b) CMO sets values now.
- Decision: open (CMO).

### OQ-275 Monthly report thresholds, and what the care team did (raised by S38c)
- 3 readings for an average, a 5 mmHg change for "lower" or "higher", 2 grace days: PROPOSED. The report does not say what the care team did that month: counts of reviews or tasks would reveal that a task exists, including sensitive ones.
- Options: (a) leave it out (as built); (b) add a count of released notes and answered messages only, after the CMO approves the list.
- Decision: open (CMO).

### OQ-276 Sharing the monthly report with the Care Circle (raised by S38c, closed by S38d)
- Built once S29 merged (2026-10-06). No new permission and no sharing flag: a member with `weekly_bp_trend` sees, for up to three months, whether there were enough readings, the average (whole numbers), under or above target and the direction; a member with `adherence_summary` sees the share of medicines taken. With neither tick the block is absent (not shared, never zero). No target numbers, week split or reading counts are shared. The patient's own "see what they see" preview shows the same block. A paused circle, an expired or removed member sees none of it.
- Decision: built as proposed; the founder can narrow it (for example monthly adherence only) by removing a part from `private.circle_monthly_block`.

### OQ-277 Two risk tables with different jobs, worklist cost, who may read it (raised by S38c)
- `risk_scores` (this build, a daily ordering aid) is separate from `risk_predictions` and `patient_risk_scores` (condition models). The worklist reads each patient's latest score and tests the clinician tie row by row; fine at pilot size, needs a tie-first query before thousands of patients. Only role `clinician` can open it; care coordinators cannot yet (their work is logistics, not ordering by risk).
- Decision: open.
- **Decided 2026-10-07 (founder): admins and the CMO, in `apps/web`, for now.** Clinical leads who are neither cannot open it yet; S36 and S37 decide the console version.


### S27f: three follow-ups (founder choices, 2026-10-06)
- **Liaison view CLOSED:** the Lab Liaison sees a neutral list of the files they recorded (last 30 days): date, patient number, order, file name and one of two words, "waiting for review" or "reviewed". Never values, reasons, or whether a result was withheld.
- **Held corrections CLOSED:** a lab can replace a result that is still held. The held one is marked replaced at once, its review task is cancelled, and it can no longer be released or withheld (`lab_result_replaced`). The replacement goes through the same gate, the reviewer sees the kind and reason, and if the patient never saw the first result they get the normal release notice, not a "corrected" one. A claimed task held by another clinician is left to that clinician, who will find the release refused.
- **Withdraw screen CLOSED (patient-scoped):** on a tied senior clinician's patient chart, "Released lab results" opens on a click (one audited read) and offers Withdraw with a required reason. There is deliberately no org-wide list.
### OQ-300 BRE-01 is "Three minute calm" in the Audio Production List, not the blood pressure exercise (raised by S33)
- Spec 8.7 and Module 10 say Stage 1 ships "breathing exercise BRE-01". The Production List (7.6) names BRE-01 "Three minute calm" (slow breathing for any moment, Release 2) and the blood pressure exercise BRE-03 "Slow breathing for blood pressure" (about six breaths a minute, Release 2). The pace S33 built (four seconds in, six out) is the one the research gives for BRE-03, run for three minutes under the BRE-01 name and framed as a calm moment, never a treatment.
- The pacer reads one PROPOSED value (`breathing.bre01`), so a different exercise (BRE-02 to BRE-06) is a config entry plus a script, not a new build.
- Options: (a) accept as built (recommended); (b) also ship BRE-03 now under its own name and a longer length once the CMO confirms the pace and the wording; (c) hold the exercise until the CMO confirms.
- Decision: open.

## S39: security, privacy and compliance hardening (raised 2026-10-07)

### OQ-260 Staff can read most patient tables directly, untied and unaudited (INV-10, INV-12)
- Live check (read-only, simulated session): about 10 core tables are tied and audited (S05, S22e). On 226 other tables with a `patient_id`, the SELECT policy still contains `private.is_org_staff(organisation_id)`, so any active staff member of the organisation (including a care coordinator) can read them with no tie to the patient and no audit row. Worst: `scribe_transcripts` (staff can also delete), `patient_serology_status` (HIV, hepatitis status), mental health, therapy, sexual health and STI, reproductive and pregnancy tables, `clinical_encounters`. Next: labs, imaging, ECG, care plans, escalations, `patient_timeline`, medication reviews. A clinician with no tie read 1 of 1 serology rows and 1 encounter in the proof run.
- Why not fixed in S39: moving 226 tables to tied-only breaks coordinator logistics, clinician queues and rosters that list untied patients, and jobs that read as staff. OQ-02 decided "tied only plus audited break-glass" but never decided coordinator scope or the roster and queue exceptions. `private.is_org_staff` is not edited (it gates about 110 surfaces).
- Options: (a) tier 1 now (scribe transcripts, serology, mental health, therapy, sexual health, reproductive, encounters): replace the staff arm with `private.can_staff_read_clinical(patient_id, <category>)` and add audited read functions like `read_patient_chart_audited`; tier 2 (labs, imaging, ECG, care plans, escalations, timeline, medication reviews) in a second session after the coordinator scope is decided (recommended); (b) all 226 in one session; (c) leave as is until launch volume.
- Also decide: coordinator scope (logistics tables only, no result or note bodies), the roster and queue exceptions (alerts, escalations, monitoring roster as tie-creating lists), and whether staff may delete `scribe_transcripts` (recommended: no, never).
- **Decided 2026-10-07 (founder): tier 1 now, tier 2 later; then on 2026-10-07 the founder asked for BOTH tiers now (S39b).** The catalog test `s39_security_catalog.sql` does not sweep the admin role for this reason; add it once this is decided.

### OQ-261 Break-glass: no route for a same-organisation clinician, no immediate CMO alert, no weekly review (INV-12)
- `request_emergency_record_access` refuses a patient in the same organisation ("use the normal chart view"), which was right while in-org reads were org-wide. If OQ-260 makes reads tied-only, an untied in-org clinician needs a break-glass route. There is also no trigger alerting the CMO when a grant is made (only a 4-hourly nudge for grants near expiry) and no weekly review job. Zero grants have ever been made.
- Options: (a) allow same-organisation grants with a reason, notify the CMO at once (a keyed in-app notice with no patient name or condition, INV-07), and add a weekly review summary (recommended, built together with OQ-260); (b) later.
- Decision: open (founder, CMO).
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): covered by the audited record-opening path (S39c): opening-level log, weekly CMO review, alerts. `security.rules` v2 confirmed.**

### OQ-262 No executable erasure or anonymisation path (spec section 13, NDPA) (DECIDED 2026-10-07 by the CMO: no erasure, restrict on request)
- CMO decision: real data is never erased; on request the record is restricted, the patient gets a written reason, anonymisation after retention subject to counsel. Record restriction flag to build.
- Decision (founder): do NOT erase real patient data, no path for it. Test data (`is_test`) can be deleted: built in S39d as `purge_test_account`. Real-data erasure stays open for counsel (Q5).
- Deletion is a request workflow (`data_deletion_requests`) that an admin marks completed; no function removes or anonymises anything. 289 public tables carry a `patient_id`; their foreign keys to `profiles` are 323 CASCADE, 263 SET NULL, 174 RESTRICT, 39 NO ACTION, so a naive profile delete would wipe records the law may require us to keep in some tables and be blocked in others. Only 20 of 295 patient tables are classified in `table_classifications`. `analytics.subjects` keeps the pseudonym link unless erased with the patient, and `outcome_snapshots` is append-only (blocks UPDATE, not DELETE).
- Not built: what must be kept, for how long, and what anonymising a clinical record means are questions for Nigerian counsel (see `docs/legal/questions-for-nigerian-counsel-S39.md` Q5). Building before the answer risks deleting what must be kept.
- Options: (a) after counsel answers, one session: classify every patient table (delete, anonymise, keep) in a tested registry, add `private.erase_patient`, delete the analytics pseudonym row, and add a CI test that a new patient table must be classified (recommended); (b) manual SQL runbook meanwhile.
- Decision: open (founder, counsel).

### OQ-263 Retention periods are all empty (DECIDED 2026-10-07, periods in config v2/v3, report only)
- Decision (founder): international standard periods (NHS Records Management Code, HIPAA as references) held in `security.rules` retention; `retention_review_report` lists rows past their period for the CMO and admin; nothing is deleted (`real_data_auto_delete` false). Counsel confirms the figures (OQ-283).
- `data_retention_policies` has a period only for marketing and analytics (36 months). Clinical records, audit trail, financial records, consent records and communications are NULL ("no confirmed statutory period"). No cron enforces even that one, nor OQ-108 (document purge) or OQ-195 (12-month bank-name clear).
- Options: counsel sets the periods; then they go in versioned PROPOSED config and one nightly purge job writes an audit row (recommended). Until then NULL means keep, and the register says so.
- Decision: open (counsel, CMO).
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): NHS-aligned schedule adopted as PROPOSED (adult 8 y after last contact; child to 25/26; maternity 25 y; mental health 20 y; access log 8 y; consent and payments 6 y), no automatic deletion of real patient data, Nigerian counsel to confirm. Confirmed as part of `security.rules` v2.**

### OQ-264 Data export: admin-gated, incomplete, no mobile download (DECIDED 2026-10-07, complete export built in S39d)
- Decision (founder): build from the registry, keep the admin review as a 30-day clock. Built: `export_patient_data` (every registered table, credentials removed, admin only, audited) and `data_export_requests.due_at`. Not yet wired into the existing `/api/patient/data-export` route or a mobile download.
- `/api/patient/data-export` returns 403 until an admin fulfils a request, covers about 16 tables of 289 (missing all v5 tables such as outcome snapshots, consult messages, scribe notes, orders, entitlements, Care Circle grants, appointments), has no full-record PDF and no mobile download. Spec says export in JSON and PDF.
- Options: (a) build the export from the same classified registry as OQ-262 so it covers every patient table, keep the admin review step as a 30-day clock (OQ-50 recommendation), add mobile (recommended); (b) self-serve instant export of the patient's own rows.
- Decision: open (founder).

### OQ-265 Patient avatars sit in a public bucket
- `patient-avatars` is public; files are `<patient id>/<random uuid>.<ext>` and the profile stores the public address. Unlisted, but anyone given the address can open it for ever. Making it private means signed addresses at every place an avatar shows (about 6 renderers).
- Options: (a) private bucket plus signed addresses (recommended once the console split finishes); (b) accept, since the address is unguessable and the patient chose the picture. Recorded in the catalog test allowlist until decided.
- Decision: open (founder).

### OQ-266 Production backups: PITR is off and no backup is listed
- `supabase backups list` (read-only, 2026-10-07): `pitr_enabled: false`, `backups: []`. No restore has ever been tested; branching is unavailable on this plan so the DR spec's "restore on a branch" cannot be done. Storage files (lab documents, transcripts) are not covered by database backups.
- Options: (a) upgrade to Pro and enable PITR, then restore into a scratch project and record RTO and RPO in `docs/BUSINESS_CONTINUITY_DR_SPEC.md` (recommended before any real patient data: this is the most serious operational gap found); (b) scheduled `pg_dump` plus bucket export to storage outside Nigeria.
- **Decided 2026-10-07 (founder): upgrade to Pro, enable PITR, test a restore into a scratch project and record RTO and RPO.** The upgrade and the restore test are the founder's to do in the dashboard; not yet done.

### OQ-267 Rate limits: Upstash never provisioned; payment, queue and mobile routes unlimited
- Auth, SMS OTP and the prescription and passport doors are limited. In-memory fallback is used because Upstash was never provisioned (not coordinated across serverless instances). No request-rate limit found on `order-checkout`, `order-verify`, `queue-next`, `queue-handback` or the ~18 `/api/mobile/*` routes. `verify_prescription_public` can be called directly through the API, bypassing the page limit. S39 added counting and an alert on the emergency card and record share doors (not blocking: the emergency card must open).
- Options: provision Upstash and add a shared per-user wrapper for the routes above; a small `rate_limit_hits` table for the edge functions (recommended).
- Decision: open (founder).

### OQ-268 Processor register, DPAs and vendor findings
- `docs/PROCESSORS.md` is new. No signed DPA exists with any processor (Anthropic's is an unexecuted draft). Findings: Voyage AI, Twilio, Dojah, Vercel, Upstash and the HIBP check were missing from every register; the `vendor_assessments` seed still lists Stripe and WhatsApp as active; the Play Store text still names WhatsApp; Dojah receives a NIN or BVN in a GET query string; the Sentry scrubber covers emails and phones only and traces are sampled at 100%.
- Options: (a) sign DPAs, fix the stale documents, move Dojah to a POST body if the provider allows, widen the scrubber and cut the trace rate (recommended); (b) defer.
- Decision: open (founder, counsel).

### OQ-269 Two live bugs found by the S39 proof and fixed (for the record, no decision needed)
- `record_share_by_token` failed for any share that included the vitals section (a renamed column) or the lab results section (a status value that does not exist). Fixed in `20261007104237_s39_security_hardening_round1.sql` with a regression test. It shares lab results whose report status is final, corrected or amended; whether a lab result must also be clinician-released before it can be shared (INV-03) is for the CMO, since patients already read these rows directly.
- Decision: informational; CMO to confirm the INV-03 point.

### OQ-278 Tied direct reads on the other tables are not audited one by one (INV-10) (DECIDED 2026-10-07, built in S39c)
- Decision (founder): meet the NHS standard. A doctor may search for any patient and open the record with no reason to type; the audit runs in the background; the patient is not told.
- Built in S39c: `staff_record_opens`, an append-only log that is also the grant. An untied clinician reads tied tables only inside a window created by `open_patient_record`, so a read without a logged opening is impossible in the database. The log is per opening of a record, not per table read (see OQ-282).

### OQ-279 Staff writes are still organisation-wide on the tied tables (DECIDED 2026-10-07, built in S39g)
- Decision (founder): tie the writes. Built: `private.staff_may_write` (an active clinician who is tied or holds a live opening; never a coordinator or admin; never reproductive_health through an opening) now guards the INSERT, UPDATE and DELETE policies of the tied tables, with the old text saved and the switch `tied_staff_writes` as rollback.
- S39b changes SELECT only. An untied staff member can still INSERT, UPDATE or DELETE rows on those tables by policy (they cannot see the result). Writes are done mostly by functions and triggers.
- Options: (a) tie the write policies the same way in a follow-up once the read change has run for a while (recommended); (b) leave.
- Decision: open (founder).

### OQ-280 What S39b deliberately left organisation-wide (103 tables, listed with reasons in `staff_read_scope`)
- Scheduling and work queues (appointments, alerts, escalations, emergency events, outreach, care-team assignment, case management), logistics (lab orders and specimens, pharmacy), billing, self-tracking and system rules. Several hold clinical detail (lab orders, alerts, escalations). They stay so coordinators can book and the on-call route can pick up unassigned work; tying them needs the work-queue design (S35, S36) first.
- Options: (a) tie lab orders and the alert and escalation tables once unassigned-work visibility is designed (recommended); (b) leave.
- Decision: open (founder, CMO).

### OQ-281 May a patient ask who opened their record, and must they be told? (counsel) (DECIDED 2026-10-07 by the CMO: on request through the DPO)
- CMO decision: not shown in the app; the DPO answers a request within 30 days. DPO report for one patient still to build; counsel confirms NDPA.
- Founder direction: the patient is not told and need not know a doctor opened the record (NHS practice: the audit is background). Under the NDPA 2023 a patient may have a right to know who processed their data.
- Options: (a) keep it hidden, answer a request from the DPO with the access log (recommended pending counsel); (b) show the patient their access history in the app.
- Decision: partly superseded 2026-10-13 by the founder: routine staff openings are shown to the patient as name, role and time only (OQ-S09x-1). Counsel/DPO confirmation of the legal basis is still open. Question 21 in `docs/legal/questions-for-nigerian-counsel-S39.md`.

### OQ-282 The access log records the opening of a record, not each table read inside the window (DECIDED 2026-10-07 by the CMO: add a table-level log for sensitive categories)
- CMO decision: keep the opening log and add a table-level access log for HIV, sexual health, mental health and reproductive records. To build.
- `staff_record_opens` has one row per opening (who, which patient, when, tied or open, after hours), valid 8 hours. Reads of individual tables inside the window are not logged one by one, and a PostgREST GET runs read-only so a policy cannot write a row per read. Edits are covered by each table's own history where it has one (OQ-279).
- Options: (a) keep the opening-level log (NHS legitimate-relationship practice, recommended); (b) add database request logging (pgaudit) shipped to a log store for per-query detail.
- Decision: open (founder, CMO).
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): keep the opening-level log with the weekly review; per-query logging (pgaudit) not adopted for launch.**

### OQ-283 Retention periods are proposals until counsel confirms them (DECIDED 2026-10-07: follow the UK and US standards)
- Decision (founder and CMO): adopt the UK and US standards already in config (NHS Records Management Code of Practice for clinical records, HIPAA for the audit log and consent records). Counsel is asked only whether any Nigerian rule (MDCN, NDPA 2023) requires something longer or shorter. Real patient data is still never erased automatically. Under the UK GDPR a health record kept for care or a legal duty is outside the right to erasure, and HIPAA gives no erasure right, so a no-erase rule fits both.
- Held as versioned config `security.rules` v2 (`retention`): adult record 8 years after last contact, child to age 25 (26 if seen at 17), maternity 25, mental health 20, access log 8, consent relationship plus 6, payments 6, operational data 90 days to 2 years. Sources: NHS Records Management Code of Practice and HIPAA as references. `real_data_auto_delete` is false: nothing deletes real patient data (founder, 2026-10-07).
- Decision: open (counsel, DPO). Question 22 in the counsel list.

### OQ-284 The registry classification is a proposal until the CMO and DPO review it (DECIDED 2026-10-07, confirmed by the CMO in S39f)
- Decision (CMO): confirmed with corrections (STI partner notifications and the risk reassessment queue are clinical records; wellness points are operational; care access events are audit and still exported; wellbeing check-ins are clinical records). All 302 rows are marked reviewed.
- `data_registry` holds 302 patient tables classed by name (clinical record, mental health, maternity, consent, financial, audit, operational), all `reviewed = false`. A table can be in the wrong class (for example a mental-health table not named like one), which changes its retention period.
- Options: the CMO and DPO walk the list once and mark each class confirmed or corrected in a new migration (recommended); a proof already fails when a new patient table is missing from the registry.
- Decision: open (CMO, DPO).

### OQ-285 The export function is not yet behind the existing download route (DECIDED 2026-10-07, built in S39f)
- Built: `/api/patient/data-export` now serves the complete export through `export_my_data()`, only after an admin has fulfilled the request within 30 days. A mobile download is still to do.
- `/api/patient/data-export` still returns its own subset of tables (about 16). The complete function exists and is admin only; connecting the route and a patient download after admin fulfilment is the next UI piece.
- Decision: open (founder).

### OQ-286 The shared worklist shows the kind of care to any clinician without a logged opening (DECIDED 2026-10-07: leave as is)
- Founder decision: keep the labels as they are.
- `clinical_worklist()` returns the patient's name and a generic label such as "Therapy session awaiting approval" or "Abnormal screening result without follow-up" to every active clinician in the organisation. That reveals the kind of care (for example mental health) before anyone opens the record. Founder decision 2026-10-07: the queue shows the name and the item, opening is logged.
- Options: (a) keep as decided; (b) show a neutral label ("Item awaiting review") for the therapy and screening queues and the kind only after opening (recommended if the CMO wants mental and sexual health treated as sensitive).
- Decision: open (CMO, DPO).
## S28: pharmacy partner, collection and dispensing (raised 2026-10-07)

### OQ-516 Two prescription models, one supply count (decided)
- The paper and QR path is keyed on `medications.public_token`; the routed path is keyed on `prescriptions.state`. A prescription could be supplied by the QR scan, the phone desk and the partner list.
- **Decided 2026-10-07 (founder): one shared supply count.** All paths write `pharmacy_order_dispenses` and lock the same `medications` row. A PARTIAL partner supply is not counted by the partner path, but the QR and phone-desk paths count every row, so they can only refuse sooner, never supply more. Proved both ways in `s28_pharmacy_collection_and_dispensing.sql`. Known limit: after a partial partner supply the QR and phone-desk paths already count one supply (and the patient's supplies list shows it), so another pharmacy cannot supply the rest until the first completes; giving partial rows their own status in those paths is a follow-up.

### OQ-517 Older pharmacist functions still read patient data with no audit row (INV-10)
- `pharmacist_orders`, `pharmacist_order_medications` (the patient's whole active medicine list) and `pharmacist_order_allergies` belong to the dormant order model (0 orders). S28 makes the new prescription path audited and limited (the sent prescription, the patient's name and number, allergies, nothing else), but did not change the dormant order functions.
- Options: (a) audit and narrow them when the order model is revived, or retire it (recommended: retire with OQ-173's legacy removal session); (b) audit now.
- Decision: open (founder).

### OQ-272 Delivery schema is still present (Part C.2 says no home delivery)
- `fulfilment_method delivery`, `delivery_fee_kobo`, `logistics_partner_id`, delivery statuses and `pharmacy_order_delivery_attempts` remain (OQ-16 open). S28 is collection only and wires none of it.
- Decision: open (founder), with OQ-16.
- **RESOLVED 2026-10-07:** removed. See OQ-16 for exactly what went and what was kept.

### OQ-273 Not built in S28: price comparison, verified batches, pharmacist chat
- Price comparison (8.9) needs per-pharmacy prices; `pharmacy_medications` has 0 rows and the spec puts it in Release 2. Verified-batch sourcing (8.11) needs a NAFDAC check (8.8), also Release 2. Pharmacist chat (8.12) is a new message thread between a patient and a pharmacist and needs its own decision (who moderates, what it may discuss, retention).
- Options: (a) leave all three for Release 2 (recommended, as chosen); (b) chat first.
- **Decided 2026-10-07 (founder): send, collection code, dispense, flags only.**

### OQ-518 No pharmacy can receive a prescription until its licence is verified
- 4 partner rows exist (Medplus, HealthPlus, Alpha, MedsPal), all inactive with unverified licences. The chooser offers only active partners with a verified, unexpired PCN licence and a verified location, so today it shows none, and the `prescribing_enabled` go-live guard stays off. Verifying a licence, adding locations and creating pharmacist logins are admin steps, not code.
- **Decided 2026-10-07 (founder): switch on only when a real partner exists.** Until then the patient downloads the prescription PDF and takes it to any pharmacy (the existing path). Do not activate a partner without a verified licence (spec D.6).

### OQ-519 One medicine per prescription
- S24 signs one item per prescription (`issue_signed_prescription`), so a patient with three medicines chooses a pharmacy three times and gets three codes.
- Options: (a) let the patient choose once for all her waiting prescriptions and get one code per pharmacy visit (recommended, next); (b) leave.
- Decision: open (founder). **Built 2026-10-16 as option (a) in S28e** (`20261021090417_s28e_pharmacy_visits_stock_scorecard.sql`, not yet applied): the patient ticks several waiting prescriptions, chooses one pharmacy and gets ONE code for the visit (`patient_choose_pharmacy_for_visit`); at the counter each prescription is still its own item (own full or partial supply, own controlled check, the same shared supply count). **A single signed prescription that carries several items was NOT built**: S24 signing, the medicine row (one per prescription), the PDF and the QR verification all assume one item, so that is a change to the signing path and needs its own decision. Question for the founder: is one visit code over several single-item prescriptions what you meant by lifting the limit, or do you want the signing path changed so a doctor signs one prescription with several items?
- **Decided 2026-10-21 (founder): several medicines in one signed prescription = YES (earlier numbered OQ-275).** To be planned as a separate build that changes S24 signing, the prescription PDF and the QR verification together, with CMO review first. Not built. See `docs/DECISIONS.md`, 2026-10-21.

### OQ-520 Controlled medicines and repeats at the counter
- Signing hard-stops controlled medicines (an illustrative list, OQ-170). S28 adds no second check at the counter. After a full supply the prescription is `dispensed`, so an approved repeat is supplied through the existing QR and phone-desk path, not the partner list.
- Options: (a) add a counter check against the controlled list and let the partner list handle approved repeats (recommended); (b) leave.
- Decision: CMO 2026-10-07 (decision sheet item 5): add the second check at the counter, and let approved repeats continue through the existing QR and phone-desk path (not the partner list). Built in `20261008013742_oq276_controlled_medicines_at_the_counter.sql` (not yet applied to production): one list, `private.is_controlled_medicine`, now drives signing and every counter path (S28 verify and dispense, `verify_prescription`, the order screen's `pharmacist_record_dispense`, and `record_prescription_supply_public` for the QR page and phone desk). A match is refused with the plain outcome `controlled_medicine`, nothing is recorded, and the refusal is audited. The older order screen's "enhanced verification" tick-box no longer lets a controlled supply through. The list stays illustrative (OQ-170), not a verified NDLEA schedule. Still open: the read-only QR views (`verify_prescription_public`, `desk_verify_prescription`) do not flag a controlled medicine, only the recording is refused; the patient who chooses a pharmacy is not warned.

### OQ-521 Patient mobile screen and Pidgin review
- The patient chooser and code are on the web only. The mobile app has no screen for it yet, and the Pidgin strings need a native reviewer.
- Decision: open (founder). **Phone screen built 2026-10-16 in S28e** (`PharmacyCollectCard` on the Medications screen, English only; Pidgin was removed 2026-10-07). It was type-checked, linted and unit tested for its data layer; it has not been run on a device or simulator.

### OQ-711 Pharmacy breaches are suggestions, laboratories and clinics are not yet (raised by S28e)
- Spec 21.7 and the S28e brief say a poor-performing partner is flagged for staff, never removed automatically. S74 (already live in the repository) takes any partner out of NEW work by rule (`partner_quality_config.removal.auto_suspend`). S28e adds `removal.suggest_only_kinds = ["pharmacy"]`, so a pharmacy is only ever flagged; laboratories and clinics still pause by rule, unchanged. No pharmacy is active today, so nothing live changes. An expired pharmacy licence is flagged (not paused by rule) and still hides the pharmacy from patients through `pharmacy_location_choosable`.
- Options: (a) keep as built (pharmacies suggest-only, labs and clinics automatic); (b) make laboratories and clinics suggest-only too (add `"lab"`, `"clinic"` to the list: a new configuration version, no code change); (c) make pharmacies automatic again.
- Decision: open (founder with the CMO).

### OQ-712 Pharmacy scorecard numbers are proposals (raised by S28e)
- `partner.quality` v2 adds PROPOSED values: dispense target 72 hours, at least 10 supplies and 70 percent within target before turnaround counts, at least 10 sent and 30 percent "cannot supply" before it is flagged. Turnaround runs from the patient sending the prescription to the full supply, so it includes the patient's own time to reach the counter; nothing records when the patient arrives. Read it as a prompt to look.
- Known gap: a prescription sent to a pharmacy that it never answers and never supplies is not measured (turnaround counts only supplied ones, out of stock needs an explicit report). A "sent and still waiting past the target" count is the missing figure. Also left: a visit of N medicines sends N identical neutral notices; the caregiver cannot send several together or renew the visit-wide code (it would open medicines hidden from her).
- Decision: open (CMO and pharmacy lead). Nothing is signed. A flag only asks staff to look.

### OQ-713 The pharmacy collection rules need a fresh confirmation (raised by S28e)
- `pharmacy.collection_rules` is now version 3 (adds `max_items_per_visit`, 10). The go-live condition `pharmacy_rules_confirmed` reads the confirmation for the ACTIVE version, so any earlier confirmation no longer counts. Before the guard can go on, the CMO confirms version 3 at the sign-off hub. Decision: open (CMO), a go-live step in `docs/runbooks/pharmacy-activation.md`.

### OQ-714 The patient page still shows a price comparison (raised by S28e; DECIDED and removed 2026-10-21)
- OQ-283 and Part C.2 say the collection flow shows no price. S54 (`patient_price_compare`, `PriceCompare` on `/patient/pharmacy/collect/[id]`) showed prices and stock when a verified pharmacy had entered them. Live counts before removal: `pharmacy_medications` 0 rows, so the comparison was always the empty line.
- Decision (founder, 2026-10-21): remove it, not hide it. The comparison table, loader, row schema and `pharmprice.*` strings are gone from the web app, and `20261021060438_oq714_remove_patient_price_compare.sql` drops `public.patient_price_compare(uuid)`. Proof: `packages/db/tests/oq714_remove_patient_price_compare.sql` (with a sabotage step); a page test asserts no price or stock level shows while choosing.
- Kept on purpose: the catalogue columns (`price_kobo`, `stock_status`: portal and older order path), `verified_batch` and the NAFDAC attestation (partner quality), the shared matcher, S28e's yes-or-no stock confirmation, the visit and scorecard, pharmacist chat and dependants. The "take it to any pharmacy" line stays (`pharmcollect.any_pharmacy`).
- Ship order: web first, then the migration is applied (the migration is NOT applied by the pull request that adds it).
- Left over: see OQ-719 (an audio help clip still says "compare prices").

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

### OQ-254 Sponsor reporting built; what it still needs (raised by S38d, built by S38e)
- Built: sponsor cohorts (programme codes), joining, per-programme consent to share group figures, the aggregate-only sponsor report and its audited CSV (admin or CMO only). Left: (a) counsel must approve the consent text, which is seeded as a DRAFT and not current, so no member can consent and no sponsor figure exists until then (OQ-256); (b) a sponsor's own staff cannot log in to see their figures; today an admin or the CMO reads them and hands over the file (OQ-258).
- Decision: open (founder and counsel).

### OQ-255 Triage accuracy built as agreement with the automatic grade (raised by S38d, built by S38e)
- Built: an optional "was the grade right, should it have been higher, should it have been lower" field a clinician records after completing a task that came from an automatic grade, and an admin report of agreement (coverage first, small groups withheld, draft rule sets and test accounts left out). It measures agreement with the grade, not diagnostic accuracy; nothing records a final diagnosis. The capture is a platform switch, OFF until the CMO approves (OQ-257).
- Decision: open (CMO).
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): approved. The capture switch is ON (see OQ-257).**

### OQ-256 The sponsor consent text needs counsel (raised by S38e)
- `consent_versions` holds a DRAFT sponsor_reporting text (`2026-10-07-draft`, not current). The patient screen explains in plain words what a sponsor sees. Counsel should approve the legal text and the plain wording together, then the founder makes it current (until then sharing shows "not open yet").
- Decision: open (counsel).

### OQ-257 CMO approval to switch on triage grade reviews (raised by S38e)
- The switch `triage_agreement_capture` is off. It adds an optional step for clinicians and shows no patient identity. The admin page asks for a tick and a written note of who approved it and when (at least 10 characters), kept with the switch and in the audit log; it is a record, not a verification, so the CMO's approval itself still has to be real.
- Decision: open (CMO).
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): approved; `triage_agreement_capture` is ON with the approval note recorded in the switch and the audit log.**

### OQ-258 Sponsor staff access and a mobile way to join (raised by S38e)
- A sponsor's own staff (employer or insurer admins) cannot see their group figures directly; that needs a role decision (the institutions aggregate-only rule, I9, already limits what they may ever see). Joining a programme with a code is on the web only; the mobile app has no join screen yet.
- Decision (founder, 2026-10-07): sponsor staff are given access in the mobile app and see their figures there. Built as S38f on the existing institution logins (hmo_admin, corporate_admin, ngo_admin), no new role: see `docs/design/S38f.md`. Also built: web tab and file export for corporate and HMO admins, a Programmes screen for patients on the phone, and held-back months so two published months cannot be subtracted. Closed.

### OQ-259 Sponsor snapshot housekeeping (raised by S38f review)
- `sponsor_report_snapshots.member_set` stores every agreed member's id for every month so a month can be compared with the last published one. At very large programme sizes that is megabytes a month. Fix when it matters: keep the set only on the most recent published snapshot of each programme (a follow-up migration; none are needed while there are no programmes).
- `sponsor_staff_figures` writes one audit row per programme per view, so a sponsor with several programmes writes several rows per page load. Fix when it matters: one list-and-figures call that audits once.
- Decision: open (engineering), not urgent.
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
- **Decided 2026-10-07 (CMO, in chat, from docs/clinical-signoff/CMO-DECISION-SHEET-2026-10-07.md): the record turned out to be an unapproved draft, not an approved one, so its intended-population wording was corrected in place to Nigerian English only. Approval remains blocked until the two evaluation suites are run.**

### OQ-290 S53 and S54 were built before the Stage 1 gate (S40) closed (raised by S53, recorded 2026-10-07)
- The founder said on 2026-10-07: proceed anyway, build everything, switch nothing on. S53 and S54 follow that. Every go-live guard they add (`interaction_check_enabled`) is OFF; no dataset, review or sign-off is seeded as approved; the pharmacy and chat features stay behind existing guards and dormant modules.
- Blocks: nothing. Reversal is simply leaving the guards off.
- Decision (founder, 2026-10-07): build, do not switch on.

### OQ-291 Partner commission columns were readable by every signed-in user, on pharmacy and on laboratory tables (raised by S53)
- Found live 2026-10-07 (read-only): `pharmacy_medications` commission columns and the `commissions` ledger were readable by patients and clinicians. Fixed in the S53 pre-fix migration `20261007210001_*` (0 rows existed in both, so nothing had leaked). The same shape is still live on tables that DO hold rows: `lab_tests` (60 rows), `panel_bundles` (41), `screen_types` (38) expose `commission_rate` (and `commission_flat_kobo`, `commission_rate_type`) to every authenticated user, and `therapy_sessions.commission_kobo` is readable by the patient on their own sessions. This is the 8.16 rule ("clinicians never see which partner earns Tarragon more") applied to labs and therapy.
- Options: (a) repeat the pharmacy pattern for these four tables (column grants plus an admin-only view), with the client reads switched to explicit columns (recommended, before any patient is let in); (b) leave labs and accept that partner margins are visible (conflicts with the same founder rule).
- Blocks: nothing built. Not fixed in S53 because it touches the lab booking reads, outside this session.

### OQ-292 Where the Nigerian medicine catalogue's real data comes from (raised by S53)
- The seed is about 60 generic names with standard strengths and 29 brand names whose generic is beyond doubt. No NAFDAC number is present on any row and none was guessed; every row is `needs_pharmacist_review`. A real catalogue needs a licensed source or a pharmacist copying numbers from NAFDAC's register.
- Options: (a) a pharmacist reviews and fills numbers from NAFDAC's register, row by row, through the admin screen (recommended, small); (b) license a dataset (cost and licence terms unknown); (c) keep the small seed.
- Blocks: nothing. Search works on the seed.

### OQ-293 A photo of a prescription is not read or stored (raised by S53)
- The prescription photo was meant to be kept as reference only. No OCR was built (a wrong read of a dose is dangerous) and no photo upload for a medicine exists; the existing "consultation document link" for a specialist-started medicine is the only reference attachment.
- Options: (a) a private storage bucket where the patient attaches a reference photo to a medicine, never read by a model and never copied into the medicine's fields (recommended); (b) leave the link field.

### OQ-294 NAFDAC MAS short code and coverage need a human check before store publication (raised by S53)
- Copy uses short code 38353 and "if your pack has a scratch panel". Public pages from 2010 to 2012 (safemedicines.org, outsourcing-pharma, Daily Trust, Dubawa) agree on 38353 and the scratch panel, and say coverage began with antimalarials and antibiotics. The 2026 state was not confirmed from a NAFDAC page. The wording is hedged and says the reply is NAFDAC's, not Tarragon's. NAFDAC also runs the Greenbook app; not used.
- Decision: open (a person to confirm with NAFDAC; change the three `medicines.mas.*` strings if it differs).

### OQ-295 The patient's interaction note on the medicines list changed wording, and the add-time check is bound to the signed rules (raised by S53)
- Before S53 the patient list showed clinician-written rule text (including "stop one of them") to patients, live, with no signed dataset. S53 kept that note visible (removing a shipped safety note was judged worse than changing its words) but replaced the text with the four fixed patient sentences that say "your care team" and never tell anyone to stop a medicine. Only the NEW add-time check is behind `interaction_check_enabled`, and it opens only when the database holds a signed dataset whose `content_hash` equals `INTERACTION_DATASET_HASH` in the app build, so a rule edited after the sign-off closes the check until it is re-signed.
- Options: (a) as built (recommended); (b) also gate the list note behind the guard (patients then see no interaction note until a human signs; matches D6 literally, removes a live safety note).
- Decision: open (founder to confirm (a) or (b)).

### OQ-296 The phone has no pack-photo reader (raised by S53)
- The pack reader is a web server action holding the model vendor key. The phone keeps its typed "check my pack" and the catalogue search; "fill from a photo" is web only.
- Options: (a) a bearer-authenticated `/api/mobile/pack-read` route like `/api/mobile/health-samples`, governed the same way (recommended later); (b) leave.

### OQ-297 Missed-dose and silence signals still do not reach the triage engine (OQ-89, restated by S53)
- S53 did not duplicate S26. The signals (`medication_dose_missed`, `medication_adherence_low`, `medication_refill_due`) are emitted since S08; the engine grades them only for a care-pack patient, and no care-pack patient state exists yet. Nothing automatic changes a medicine.

### OQ-298 The supporter missed-dose notice uses the older profile-access grant, not the Care Circle (raised by S53)
- Consent is a `profile_access` grant with `clinical_access`, `view_medication` and `receive_alerts` named in the permission list (a grant with no list does not count). The newer Care Circle (S29) has five permissions and none for missed doses. One notice a day, in-app only, generic wording.
- Options: (a) as built (recommended for now); (b) add a `missed_dose_notice` permission to the Care Circle and move the trigger there (touches S29's permission check and screens).

### OQ-299 Side-effect notes: reviewed button is on the chart only, and a note creates no task (raised by S53)
- The clinician chart lists notes (audited read) with a "Mark these as discussed" button that stamps exactly the notes on screen (by id). A note does not create a task or an alert (a person who is unwell uses the existing side-effect report and emergency steps).
- Options: (a) as built, plus a place for it inside the consultation room (recommended, later); (b) leave as is.

## Raised by S51 (AI health assistant 1 of 2). Track B uses OQ-350 to OQ-368 so parallel sessions do not collide.

### OQ-350 Stage 1 gate (S40) not closed; the assistant is built but switched off (raised by S51)
- The founder said on 2026-10-07 to proceed anyway and build everything with nothing switched on. `assistant_enabled` is born off and every condition is unmet today. Recorded here so the override is on the record.
- Decision: recorded, no action.

### OQ-351 Positive screening rows are still readable by the patient on the base table (raised by S51)
- INV-04 for the AI path is closed (views, token list, reply screens). The base table `lab_analyte_readings` still lets a patient read their own row, including a positive HIV, HBsAg or HCV value, because its RLS predates the release machinery (the same family as OQ-177 for `lab_result_documents`). S51 adds `lab_analyte_readings.sensitive_positive` (trigger-maintained) so a later policy can use it.
- Options: (a) add the flag to the patient read policy so a flagged row is hidden until a clinician discloses (recommended, needs the CMO for the disclosure rule); (b) leave until the legacy path is retired.
- Decision: open.

### OQ-352 Knowledge base rows have no owner or review date today, so retrieval is inert (raised by S51)
- Live (2026-10-07): 6 reviewed and active health education rows with a reviewer name and no review date; 58 lifestyle blocks marked reviewed with no review date. The assistant uses a row only with an owner, a version and a FUTURE review date, so retrieval returns nothing until the CMO sets dates. The guard needs at least 20 such rows (`assistant.go_live`, PROPOSED, CMO).
- Options: (a) CMO sets owners and review dates on the reviewed rows and confirms the minimum (recommended); (b) lower the minimum for a pilot.
- Decision: open (CMO).

### OQ-353 Extra red-flag wording is PROPOSED; the written-question list is unchanged (raised by S51)
- The assistant screen is the shared written-question list plus extra phrases and word pairs (`packages/clinical/src/assistant-danger-screen.ts`), which keeps everything the old private regex list caught and adds "arm numb" and similar. The written-question list and its database function (`private.screen_care_message_for_emergency`) were NOT widened; a drift test pins the base list.
- Options: (a) CMO reviews the extra wording, then widen the written-question list and its function in one signed change (recommended); (b) keep two lists with the one-way drift test.
- Decision: open (CMO).

### OQ-354 The hand-off to the care team stays outside the assistant guard (raised by S51)
- The brief named the three mobile ai-coach routes. The `handoff` route ("I want to speak to someone") and the new `prep-draft` send are deliberately not behind `assistant_enabled`: both are a patient writing to their own care team, which must not wait on an AI guard. Message and quick-action are guarded.
- Decision: recorded; reverse only if the founder wants the whole assistant surface hidden.

### OQ-355 `go_live_conditions` is patched in place (raised by S51)
- Several sessions add a guard branch to `private.go_live_conditions`, and the live body already carries a condition (`clinical_safety_case_current`) that main-dev's files do not. S51 reads the live body, inserts one branch and re-creates it, with an assertion, instead of replacing the whole function. Other sessions should do the same.
- Decision: recorded.

### OQ-356 Model-polished nudge text and the INV-07 lint on the other free-text paths (raised by S51)
- The daily nudge and weekly reflection are fully deterministic. A model-polished version would be a new AI call site (register in `ai_systems` first). AI-002 nudge text is now linted against the INV-07 term list (a hit falls back to the generic template). `broadcast_announcement` and the self-care suggestion text, the other two paths in OQ-94, are unchanged.
- Decision: open (founder, whether polishing is wanted).

### OQ-357 Dose screens will sometimes over-block (raised by S51)
- The dose-change request screen and the dose-advice reply screen are regular expressions. Over-matching routes a patient to their care team with fixed copy; under-matching is the failure to avoid. The CMO should read the patterns in `apps/web/src/lib/ai-coach/reply-screen.ts` and the fixed refusal wording (PROPOSED).
- Decision: open (CMO).
### OQ-522 S28 replaced S36h's pharmacist screen, and the free-text flag door is still open in the database (raised by S28 merge, 2026-10-07)
- S36h (merged first) built a pharmacist page at `/pharmacist/prescriptions` with a free-text "Flag a problem", a prescriber page `/clinician/pharmacy-flags` and a task type `pharmacy_flag_review`. Founder decision 2026-10-07: S28's screen replaces it. Done: S28 owns `/pharmacist/prescriptions` (list, audited open, dispense, fixed-list questions); S36h's pharmacist form and its server action are removed; `/clinician/pharmacy-flags` redirects to `/clinician/pharmacy`, which also lists the earlier written messages read only; a fixed question now also creates the same `pharmacy_flag_review` task so the clinical queue still gets the work; `pharmacist_prescriptions()` is now audited (S28b).
- Still open: `public.pharmacist_flag_prescription(uuid, text, text)` (S36h, free text up to 500 characters) can still be called by a pharmacist through the API. No screen uses it. Recommended: revoke execute from `authenticated`, and drop it with the S36h proof once nothing calls it. Not done here because S36h's own proof exercises it and the function was applied live by another session.
### F1: fix-first set (2026-10-07), on `s55-60/f1-fix-first`
Four defects from `docs/design/S55-S60-build-plan.md` section 5, fixed ahead of S55 to S60. Nothing is applied to production; see the apply checklist in `docs/BUILD-PROGRESS.md` entry F1.

### OQ-F1-01 Points redemption is switched off until checkout discounts exist (OQ-08)
- Blocks: nothing urgent. Points keep accruing; they cannot be spent, converted or turned into a voucher.
- Options: (a) calm disabled state (built); (b) a Tarragon-funded discount-code path now, capped from config; (c) wait for S71/S72 checkout discounts.
- Recommend (a) now, (c) next. The founder still needs to set the cap (`rewards.points_redemption_cap_kobo`, integer kobo, currently 0), who funds the discount, and whether a cap is a share of the item price or a fixed amount (S58 asks the same).
- `private.issue_reward_voucher` is NOT removed: referral, prevention and promo-code rewards still use it. Whether those are also stored value under INV-09 is a separate question for OQ-07.
- S58 built the capped checkout discount and kept it off; see OQ-S58-01 for what the founder must set.
- Decision: open.

### OQ-F1-02 The signed escalation SLA (v7) has no `symptom_triage` pathway; the symptom checker cannot be switched on
- Blocks: switching on `symptom_checker_enabled`, and therefore all of Module 12 (S59, S60).
- Why: `private.handle_symptom_triage_assessment()` calls `private.escalation_sla_minutes('symptom_triage', ...)`, which raises "No active escalation SLA configured", so an urgent or review-required assessment cannot be recorded against v7. v6 once carried the pathway as a draft, but v7 (the 12-hour screening change) was signed without it.
- Built: the guard `symptom_checker_enabled` (seeded OFF, CMO switches it) with six conditions, two of them read from the data: a signed triage protocol, and the ACTIVE SLA carrying `symptom_triage` for both `urgent_escalation` and `clinician_review`. So the guard cannot be switched on until a signed SLA includes it. A DRAFT version (highest version plus one, unsigned, inactive) carries the pathway with proposed 60 minutes and 24 hours (values carried from draft v6, channels push then email now that WhatsApp is gone).
- Needed from the founder or CMO: read the draft, confirm or change the two minutes, and sign it. Signing replaces the whole active config, so the signer also signs whatever the previous draft carried (for example `pulse_vitals_red_flag`). Also the four attestations: a NAFDAC and counsel position, an engine licence or internal validation, localisation sign-off, an accuracy baseline.
- No agent signed or activated any SLA version.
- Decision: open.

### OQ-F1-03 Crisis flag reaches the queue and the on-call clinician, but not an S19 page row
- Blocks: nothing. The emergency event and its older alert ladder were already live; F1 adds a class 1 task, an urgent `crisis.detected` event and a neutral notice.
- Gap: `pages` rows are keyed to a graded triage event (a rule set), and the crisis route is deterministic with no approved rule set, so no page row, no 5 and 10 minute escalation ladder and no page acknowledgement exist for a crisis. The notice is the existing neutral `on_call_page` text and links to the On call page (which lists pages, not tasks), and the task uses the existing `red_event_unacknowledged` type (name is about page acknowledgement, not crisis).
- Options: (a) as built; (b) a dedicated task type `crisis_follow_up` (CMO confirms it, like `adherence_follow_up`) and a dedicated notice that links to the queue; (c) let `pages` be created from a task or a crisis event (changes S19 and needs its proof re-run).
- Recommend (b) then (c) with the S56 crisis card work.
- Also open (already in the plan): the staffed callback time for a crisis flag. (The helpline list question is closed: founder decision 2026-10-07, no helplines are shown; see OQ-S56-03.)
- Also open (already in the plan): who verifies the helpline list and the staffed callback time for a crisis flag.
- Decision: open.

### OQ-F1-04 Learning content past its review date is hidden; a protocol bump flags for review but never takes content offline
- Decision (founder, 2026-10-07, recorded in the F1 review): no silent outage. A protocol version bump must NOT mass-hide published education. It flags the matching items `review_due` with a stamped reason (`review_flagged_at`, `review_flag_reason`), the admin library shows a visible notice listing every flagged item that is still live, and each item keeps being served until its OWN review date.
- Built: one rule. An item is expired only when `next_review_due` (Lagos day) is today or earlier (a `review_due` status alone is a flag, not expiry); `next_review_due` is the authoritative column and `review_due_at` a deprecated mirror. Expired items are hidden at read time (table RLS and every patient and coach reader), flagged by the daily job, and cannot be republished until a future review date is set. The flag clears when an item leaves `review_due`.
- Why this and not a mass hide: a protocol bump is a governance event about the protocol, not evidence that every article on the condition is now wrong; taking a whole condition's library offline overnight would be a silent clinical-service outage with nobody told. The cost is that flagged content stays visible while its re-review is pending; the notice and the review date bound that.
- Open: the seeded library (235 published items locally) carries no review dates, so none of it ever expires today and a bump-flagged undated item is live until a clinician acts. The CMO or content owner needs to set a review date on each item. Whether a bump should also shorten an item's review date (for example to 30 days out) is a CMO call and is NOT done here.
- Decision: built as above; the date policy is open (CMO).

### F1 review notes (code-review high, 2026-10-07)
- Fixed after review: crisis failure incidents are per screen (`crisis_follow_up_failed:<screen id>`); a replay after a partial failure does not notify twice (`crisis.notified` marker); orphaned education recommendations (content hidden by expiry) are dropped on web and mobile; the closed symptom checker card no longer prints an emergency number (numbers are an unconfirmed localisation fact); a database refusal (42501) on the symptom checker insert returns the calm unavailable state.
- Review round 2 (2026-10-07): the protocol-bump behaviour was changed from hidden-until-re-approved to flagged, visible notice, served until its own date (OQ-F1-04); the crisis `crisis.notified` marker no longer depends on the event or task step, so a replay after a partial failure never pages the same person twice; a five-minute retry sweep (`retry-crisis-follow-ups`) completes a failed crisis follow-up by itself (at most five errors per screen); trigger functions and the flag job had their PUBLIC execute revoked.
- Accepted, recorded: the guard check on the web action answers for the signed-in person while the table checks the person acted for (only differs for a test account acting for a real dependant; the table is the gate). The AI coach medicine tool relies on RLS for expiry (patient sessions are covered; an admin session sees everything by design). The draft SLA's version is computed at apply time (highest plus one): re-check `max(version)` at apply. See OQ-F1-02, OQ-F1-03, OQ-F1-04.


### S60: symptom checker safety half (2026-10-07), on `s55-60/s60-symptom-safety`
Built on top of F1; nothing applied to production; `symptom_checker_enabled` stays OFF. See `docs/design/S60.md`.

### OQ-S60-01 NAFDAC and counsel position on a symptom checker
- Blocks: the `nafdac_position_recorded` attestation, so switching on `symptom_checker_enabled`.
- Built: a recorded-position table and form (admin at `/admin/symptom-safety`, CMO at `/clinician/symptom-safety`): the position in the counsel's words, a classification (decision support, regulated device, not yet determined), counsel, date, document reference, who attached it. Append-only. The attestation is refused until a determined position is on record. Nothing is recorded; the table is empty.
- Needed from the founder: request NAFDAC's view, obtain Nigerian counsel's opinion (including whether MDCN treats triage software as practice), record it. The plan recommends classifying conservatively as decision support until told otherwise.
- Decision: open (founder and counsel).

### OQ-S60-02 What the checker does when its engine fails, and the signed chest pain rule's severity floor
- Built: the red-flag floor runs first on the device; an engine error, timeout or missing protocol is never reassurance: the result is the more urgent of the degraded floor and `urgent`, with a clinician asked to look. PROPOSED config `symptom.degraded_mode`: severity floors ignored, unclassifiable is `urgent`, 3 second timeout.
- Finding for the CMO: the SIGNED v1 rule `chest_pain.cardiac_pattern` needs severity 6 or more. Chest pain with sweating at severity 5 or less does not fire as signed (urgent or lower via the questionnaire). It fires only in degraded mode. The acceptance test uses severity 7. Whether the signed rule itself should drop its severity floor is a clinical decision for the CMO; it was not changed.
- Also confirm: `urgent` as the unclassifiable category (alternative: `emergency`), and the timeout.
- Decision: open (CMO).

### OQ-S60-03 Prevalence and seasonal risk entries are empty drafts
- Built: PROPOSED config `symptom.risk_tightening`, an entry can only name a minimum category (never lower or replace one; strict schema; property test). Four placeholder entries (malaria season fever, typhoid, Lassa season, sickle cell history) are marked `UNVERIFIED DRAFT`, have no sign-off and take no effect.
- Needed from the CMO: which entries exist, their sources, seasons, states and minimum categories, then a new registry version with each entry `signed_off` and a named signer. Some entries name symptoms or history (abdominal pain, sickle cell disease) that no signed pathway asks yet; they stay inert until one does.
- Decision: open (CMO).

### OQ-S60-04 An accuracy baseline before launch, and INV-13
- Why it matters: the guard needs an accuracy baseline, and a baseline needs clinician-reviewed checks, which only exist once the checker is open. INV-13 excludes test accounts from every metric.
- Built: the scheduled audit counts real accounts only. An admin or the CMO can deliberately run it including test accounts for a finished month; that report is marked `includes_test_accounts` and is a pre-launch validation baseline. The attestation only needs a baseline row to exist; a baseline of zero reviewed checks is allowed to exist, and the attesting person's note must say what it rests on.
- Needed: the founder or CMO decides whether a test-session baseline may satisfy the guard (a recommended validation set of clinician-reviewed scripted cases), or whether launch is to a small supervised group first.
- Decision: open (founder and CMO).

### OQ-S60-05 Accuracy audit parameters, and what it cannot measure yet
- Built: PROPOSED `symptom.accuracy_audit`: minimum cell 10, 95 percent Wilson intervals, five age bands; matched, under-triaged (unsafe direction) and over-triaged per cell; complementary suppression; every report `publishable = false` by a CHECK.
- Cannot be measured yet: top-suggestion accuracy against the final diagnosis, because no differential exists (founder decision). The final diagnosis code is recorded now. CMO to confirm the parameters; publishing any figure needs an independent local validation and a founder decision.
- Decision: open (CMO).

### OQ-S60-06 Languages: the brief says English and Pidgin, the repository is English only
- The S60 brief asked for i18n in `en` and `pcm`. D-14 (founder, 2026-10-06) removed Pidgin and the other local languages, and `packages/i18n` has one locale. The `symptom.*` namespace is English only, with no Pidgin file. Confirm English only for the checker, including the on-device emergency guidance; localisation sign-off (a guard attestation) will need to say which languages are covered.
- Decision: open (founder).

### OQ-S60-07 The assessment table still lets all org staff read every assessment (INV-12)
- Existing behaviour, not changed in S60 (Step 1 of the prompt): `symptom_triage_assessments` select and update policies use `private.is_org_staff()`, so any staff account in the organisation can read every assessment. The new `symptom_reviews` table has no staff policy and is read only through an audited, tied function.
- Recommend: close the staff path on the assessment table the way S05f closed `symptoms`, with an audited read function, once the safety monitoring view and any admin screen that reads it have moved. Needs its own proof.
- Decision: open (founder).

### OQ-S60-08 An urgent result that cannot be recorded raises no clinician alert
- RESOLVED in the PR #1003 review fixes. Built: the patient always gets the result. If the check cannot be recorded (a database error, no protocol version), an emergency still raises the emergency event directly, and BOTH an urgent and an emergency result now call `public.report_unrecorded_symptom_check` (service role only), which opens one sev1 incident per patient per day (neutral text, INV-07) and a `symptom_review` follow-up task, and a failure of that call is itself reported to Sentry. No signed SLA is needed for the incident; the task uses the task type's own default due time.
- Decision: closed. (The SLA question for a recorded review time stays OQ-F1-02.)

### OQ-S60-09 Smaller follow-ups from S60
- The bundled red-flag floor is a frozen copy of the signed v1 rules (parity-tested against the database seed fixture). When the CMO signs a later protocol that changes a red flag, the bundled copy and its parity test must be updated in the same change. A lag cuts both ways: a NEW red flag would be missed by the floor (the engine still catches it), and a RELAXED or removed rule would keep firing from the floor in every client and on the server, because the floor can only raise. A protocol that relaxes a rule therefore needs the bundle updated first.
- No notification is sent when a review completes (a neutral template needs content approval, INV-07); the patient sees the state and the clinician's message in the app.
- The clinician review screen opens the audited read with a fixed reason; each open or refresh writes an audit row.
- The final diagnosis code is typed and shape-checked (ICD-10 pattern), not picked from a licensed code list.
- The stated review time reuses the `clinician_review` tier of the `symptom_triage` SLA (draft: 24 hours); the CMO should confirm that is the right tier for a patient-requested review.
- There is no mobile checker screen. The on-device floor is exposed as `apps/mobile/src/lib/symptom-red-flags.ts` for a future one.
- Decision: open (CMO for the first four, founder for the rest).

### OQ-S60-10 Who may ask for a clinician's time on a symptom check
- `request_symptom_review` creates a `symptom_review` clinical task for any patient the guard lets through, with no plan or Membership check. CLAUDE.md says the free tier consumes no doctor time, and the 2026-10-05 Membership pivot has not said who may ask a clinician to look at a symptom check (spec 12.10 says "optional doctor review within a stated time"). Harmless while the checker is OFF.
- Options: (a) any patient (as built; the review time is the SLA's, so the cost is the clinical team's); (b) Members only, with Free patients shown the care-team message route; (c) a per-month allowance. Needs the founder's answer before the checker opens.
- Decision: open (founder).

### OQ-S60-11 Details settled by the S60 review (recorded so they are not re-asked)
- The accuracy audit measures what the checker said (`category`), not a clinician's later override of the assessment: the question is how the checker itself performed.
- A baseline is the first report that has something in it, per basis (real accounts, or test accounts deliberately included). An empty month is recorded but is never the baseline, so an empty record cannot satisfy the go-live condition.
- A regulatory position satisfies the go-live condition only when its classification is "decision support, not a device" or "regulated device, registered". "Not yet determined" and "regulated device, not registered" are recorded but are not clearance.
- A prevalence entry cannot carry an empty list in a condition (the schema refuses it), so "everywhere" and "every month" are written by leaving the condition out, deliberately. The shipped Lassa draft names no states, so it would apply nationwide if signed as written; the CMO must name them (OQ-S60-03).
- Months for the audit are Africa/Lagos months, and the audit job runs at 03:30 UTC on the 2nd.
- A refusal to complete a review (no held task) is returned by the database as `denied` rather than raised, so the audit row of the attempt is kept.
- Decision: recorded, no action needed.

### OQ-S60-12 The go-live function patches are string replacements (follow-up from the PR #1003 review)
- `20261007142457_s60_regulatory_position_and_guard_wiring.sql` patches two live function bodies (`public.attest_go_live_condition`, `private.go_live_conditions`) with `replace()` on a marker, as F1 did, and raises if a marker is missing. That fails loudly rather than silently, but it is brittle: a later edit to either function can break a replay, and each new record-backed condition adds another patch.
- Proper fix: a small data-driven table (`go_live_condition_evidence`: guard key, condition code, a SQL-free evidence kind such as `exists_row:regulatory_positions:clearing`) read by one generic check inside the two functions, so a new record-backed condition is a row, not a function rewrite. Not done here because it rewrites both functions wholesale and re-proves every S37 and F1 guard proof; that is its own PR.
- Decision: open (engineering follow-up, no founder input).
- A second build of S60 patched the same two functions in `20261007131744_s60_regulatory_position_and_guard_wiring.sql`; same question, folded into this entry on 2026-10-16.
### OQ-S55-01 The spec says en and pcm; the product is English only (D-14)
- Blocks: nothing built; the `learn` namespace is English only and `LOCALES` is `["en"]`.
- Conflict: S55 asks for `learn` strings in en and pcm. Founder decision D-14 (2026-10-07, reverses D-13) removed Pidgin and every other language because unreviewed clinical translation is a safety risk.
- Built: English only. The search synonym table still holds everyday Nigerian words people type ("belle", "agbo", "hot body", "high blood") because search expansion maps what patients type to clinical words; it is not a translation of any content.
- Needed: the founder confirms the everyday words may stay in the PROPOSED synonym table (a new config version removes any). The CMO confirms each group.
- Decision: open.

### OQ-S55-02 Creator revenue share is not built
- Blocks: paying any creator; the creator programme itself (invite, verify, credit, suspend) is built.
- Needs: payment model (per item, per use, flat fee, none), who bears indemnity, whether creators contract with Tarragon, tax treatment (S30/S31 fee schedules and payouts exist for clinicians and may be the route). Credentialing evidence standard is also open: today an admin records what they sighted as free text next to the MDCN number.
- Decision: open (founder, with counsel).

### OQ-S55-03 Offline audio files are not downloaded on the phone
- The pack stores text, counts each lesson's recording size (from the bundled S32 manifest) against the cap and records whether it fits (`withAudio`). The app has no file-download module and the S32 `post_signup` downloader is not built, so recordings are only played when bundled; otherwise the lesson shows its text. Adding a download module is a native change (new build and `runtimeVersion` bump, as for OQ-201). Web has no manifest audio playback (it plays an existing `audio_url`).
- Decision: open (founder: when to ship the native module).

### OQ-S55-04 Offline pack size cap
- PROPOSED `learning.offline_pack`: 25 MB and 150 items per phone, audio on Wi-Fi only. Founder confirms (data cost, storage on 4 GB phones).
- Decision: open.

### OQ-S55-05 Zero-result search log and personal data
- The log is built and **OFF** (`learning.search_gap_log` has `enabled: false`; a patient's search never writes a row). It also only ever records a search the person submitted (Enter or the Search button), never the half-typed words of a type-ahead. To switch it on, a new `search_gap_log` config version with `enabled: true` is needed, after the founder and the DPO confirm it.
- PROPOSED rules once on: 60 characters, 6 words, shown to admins at 3 or more searches, deleted after 180 days, at most 5,000 rows (the lowest-count, oldest row makes room); phrases with an at-sign or five or more digits (however spaced) are never kept; no user, organisation, device or time of day is stored.
- Known limits: the count is searches, not distinct people, so one person repeating a phrase reaches the threshold alone; a name or a health phrase typed into the box (for example "i have ...") is not detectable and would be stored. A fixed-vocabulary log would remove these, at the cost of losing unknown words, which is the point of the log. The DPO should decide whether free-text phrases are acceptable as anonymous aggregate data at all.
- Decision: open (founder with the DPO).

### OQ-S55-06 235 seeded items have no review date, reviewer, source or self-care step
- The publish gate protects every new publication. The existing published items are grandfathered and listed in `/admin/settings/health-education/readiness`; none expires until a review date is set. This is clinical content work (the CMO or content owner), not an engineering fix. Until each item has a self-care step the template shows only the fixed actions for it.
- The publish gate fires on the move INTO published. It cannot stop an admin clearing the reviewer, source or self-care step on an item that is already published, and the reviewer name is typed free text (not tied to the person who approved). A republish from review due passes once the date is moved forward; no new review is forced. These are design choices to confirm with the CMO.
- Decision: open (CMO).

### OQ-S55-07 Myth-busting series and daily lessons need clinical authors
- Six DRAFT placeholders (titles and "needs a clinical author" only) sit in an inactive series. The topic list is a proposal. No micro-lesson exists yet (S33 BP course is not built), so the daily card draws nothing until clinicians author lessons. Nothing here can be published without a named clinical author and approval.
- Decision: open (CMO).

### OQ-S55-08 Saved lessons reach the clinician on the video visit screen only
- "Ask your care team about this" saves the lesson; a clinician tied to the patient sees it on `/clinician/video-visit/<id>` (audited). The S21 consultation room and the in-app message thread do not show it yet.
- Decision: open (product).

### OQ-S55-09 A course completes only when every module is understood, including a module that has since expired
- An expired module blocks `course.completed` until it is reviewed and republished. The alternative (complete over the in-date modules) could fire a completion event for a half-finished course. Chosen the strict reading; the founder can reverse it.
- Decision: open.

### OQ-S55-10 No consumer of lesson events yet; S47 Today screen not built
- `lesson.completed` and `course.completed` are on the outbox for S58 (rewards). The daily card is a reusable component mounted on the patient dashboard, the Learn page and mobile Home; S47 can mount it on Today.
- Decision: informational.

### OQ-S55-11 Creators: no earnings, authoring or reinstatement beyond re-verification
- A creator submits credentials at `/clinician/learning-creator` (no notice is sent to an invited clinician automatically; the admin screen tells the admin to pass the page on, and an invitation can be withdrawn); an admin verifies, suspends (their published items go back to review) or reinstates (back to invited with the old MDCN number and evidence cleared, so they must send credentials again, never straight to verified). Items written by a creator are still entered through the admin content form until the Module 25 CMS exists (S80).
- Decision: informational.

### OQ-S55-12 A failed lesson-event write opens one shared incident
- If `lesson.completed` or `course.completed` cannot be written, the patient's progress is still saved, an `audit_log` row is written for each failure and one open sev1 incident covers all of them. A systematic failure therefore pages once, not once per patient. Confirm sev1 is the right class for a rewards-event failure (S58 is the only consumer, not built).
### OQ-S56-01 Mental-health data is now per-patient: decisions and gaps for the founder and CMO (S56, 2026-10-07)
- Built (migrations 20261007150213 to 20261007152231, not applied to production): five tables (`mental_health_screens`, `mental_health_screening_schedules`, `wellbeing_checkins`, `wellbeing_checkin_preferences`, `therapy_sessions`) readable only by the patient and a Care Circle supporter holding the explicit `mental_health` category; staff read through `read_patient_mental_health_audited` (tie or break-glass, audited, refusals audited). Closes the INV-12 and INV-10 exposure for mental health (OQ-02 option b, mental health first). The other ~100 tables are unchanged.
- Decision needed (founder): break-glass grants are NOT category scoped. `private.has_emergency_access` ignores the category for everything except `reproductive_health`, so any active break-glass grant opens mental health. Options: (a) accept, since break-glass already needs a reason and alerts the CMO; (b) add `mental_health` to the categories break-glass never reaches, like reproductive health; (c) a per-category grant. Recommendation: (a) for now, because a person in a mental-health emergency is the case break-glass exists for.
- Decision needed (founder): support-view (admin view-as) deliberately does NOT open mental health. Confirm that an admin investigating a support case should not see mood or screen data without a tie or break-glass.
- Not moved, recorded: `obesity_ed_screens` (eating-disorder screens), `postnatal_checkins`, `sexual_health_screens`, alcohol tables, `safeguarding_concerns` still use org-wide staff reads. Mental-health-adjacent; each needs its own readers inventoried before it moves.
- Partly closed in the S56 review pass: `handle_emergency_event` still pages EVERY clinician in the organisation (the whole emergency ladder is out of scope), but for the two mental-health sources (`mental_health_screen`, `intake_screen`) the notification payload now carries the neutral label `a check-in` and the patient name `A patient` instead of the raw source name and the patient's name (INV-07, INV-12). Proven in `s56_mental_health_access.sql` with a control (a blood pressure emergency keeps its label) and a sabotage. Still open: the org-wide paging itself. The F1 path (class 1 task, on-call page) is the targeted route; narrowing the older broadcast to the on-call clinician needs a decision on who must still be paged when nobody is on call.
- Existing rows: `private.s56_neutralise_mental_health_text()` now rewrites old alert rows, old hazardous-alcohol alerts (which named AUDIT-C and the score) and old `emergency_events.trigger_detail` text for the two mental-health sources. The dry run records the counts.
- Decision: open.

### OQ-S56-02 Approving a psychiatry booking could not confirm it (CLOSED in the S56 review pass)
- `approve_therapy_session` set `status = confirmed` but not `scheduled_for`, so the table constraint `therapy_confirmed_needs_a_time` refused every confirm. Fixed: the function now takes the approving doctor's proposed time (`p_scheduled_for`, required to confirm and must be in the future), the queue has a time field, and a decided request cannot be decided twice. A refusal for lack of authority now returns an empty row instead of raising, so the refusal's audit row is kept.
- Still a product question (founder, clinical operations): the doctor proposes the time with no view of the practitioner's availability; the patient is not asked to accept it. Confirm that is the intended flow.
- Decision: open (the flow), closed (the defect).

### OQ-S56-03 Crisis card content and sign-offs the build cannot make
- FOUNDER DECISION 2026-10-07: there are no usable crisis helplines in Nigeria. The crisis card shows NO helpline number. It says go to the nearest hospital now and shows the national emergency number 112. The `crisis_helplines` table, the verify and unverify functions and the admin page `/admin/settings/crisis-helplines` were removed (the S56 migrations were never applied, so the migration was edited in place). Helplines can be added later: add a table with a verified-only gate (a number is never shown unless a human has verified it and the verification is recent) and a card section; `CrisisCardData.helplines` is kept in the type, always empty, so older callers still compile.
- The card shows the national emergency number 112 with "go to the nearest hospital" beside it. Older copy (`emergency-alert.tsx`, `emergency-guidance-modal.tsx`) says Nigeria has no single reliable emergency number, so those screens quote none. The CMO must confirm one wording for both (the 112 line is flagged for CMO approval).
- `crisis_card_config` v1 is a DRAFT (PROPOSED, owner CMO): emergency number 112, staffed callback 30 minutes. The callback time is not shown to a patient until the row is confirmed. Nobody has confirmed that anyone is staffed to call back within it. The card says "your care team has been told" only when an emergency event for the crisis exists.
- The marketing notice `mental-health-support-notice.tsx` no longer hard-codes a helpline number: it reads the same `crisis.*` copy and bundled emergency number as the card.
- Decision: open (CMO, ops).

### OQ-S56-04 Follow-up pathway is a DRAFT behind a guard that is off
- `mental_health_follow_up_config` v1 (task due times 3 days for moderate, 1 day for high, for PHQ-9, GAD-7, EPDS) is the build's proposal, not a clinical decision. Guard `mental_health_follow_up_enabled` (switch role: CMO) is seeded OFF with two attestations (timings confirmed, cover confirmed); a test account always gets the task so the pathway can be exercised. A crisis is never behind it. The older clinician alert for moderate and high results is unchanged.
- Decision: open (CMO signs the timings and attests both conditions).

### OQ-S56-05 Smaller reconciliations
- The brief asked for i18n in en and pcm. D-14 (2026-10-06) made the product English only and `pcm.ts` does not exist on this base, so the `mood` and `crisis` namespaces are English only.
- Care Circle (S29, `care_circle_members`) is not on this branch. The consent hook is `private.supporter_has_mental_health_consent(patient, user)` over `profile_access_categories`; S29's supporter views must call it before showing anything from the five tables.
- The patient proxy-confirmation card lists every `care_access_category` as an unticked box, so `mental_health` now appears there too (nothing is ticked by default). Confirm the label.
- Clinician reads of the chart go through the audited function; the clinician `/clinician/tasks/[taskId]` page does not yet render the hand-off summary (the chart's wellbeing card does).
- A clinician who is only a care coordinator (`doctor_tier = care_coordinator`) is refused mental-health reads even with a tie. Coordinators handle logistics; confirm.
- Decision: open.
### OQ-S55-14 Creator series are a members-only perk, with a switch (founder decision 2026-10-07)
- Content with a creator credit (`creator_id`) is locked for anyone who is not a Member (`private.patient_is_member`), a lapsed Member and anyone signed out. They get the title, the creator credit and the summary (the teaser); the body, video, audio, check question, lesson action and self-care text are withheld by the database (detail, library, feed, programme detail, trust, weekly lesson, shared link, offline pack and its status, a direct table select, and a progress write). The two AI knowledge-base searches leave creator content out for everyone. Staff, admins and the creator themselves are never locked. No payout or payment logic. Core non-creator content stays free.
- The switch is `learning_config` key `creator_perk` `{"members_only": true}` (PROPOSED, mirrored in proposed-config `learning.creator_perk`). An admin changes it with `set_learning_creator_perk(boolean, reason)` (new version row, audited, no deploy). A missing value fails closed (locked). There is no admin screen for it yet.
- Open: (a) a Member's caregiver or a Care Circle member acting for a Member is judged on their own membership, not the patient's; confirm whether a gifted or circle Membership should unlock for the circle. (b) The summary is the teaser; confirm authors write it as one. (c) A phone that is offline keeps lessons it already downloaded until its next refresh, so a lapsed Member can still read downloaded creator lessons until then (online reads lock at once, and the next refresh removes them); closing that would need the Membership state kept on the phone. (d) The perk is OFF in effect today because no creator content exists and the creator programme stays off.
- Also recorded (not changed): a shared link opens in the anon client, so a signed-in Member who opens a shared creator link sees the teaser there and reads the lesson inside the app; a care-event recommendation that points at a creator lesson is not shown to a non-member (the lesson row is hidden, so its card is dropped); opening a locked lesson records nothing (a "seen" write is skipped, "understood" is refused).
- The weekly clock: a condition track counts from its active care plan; the general track counts from the earlier of onboarding and first engagement, so finishing a first lesson never resets it. The feed's own unlock week (`private.health_education_unlock_week`) still falls back to first engagement only, so for a person who onboarded long before their first lesson the feed can unlock fewer lessons than the weekly card offers; decide whether the feed should use the same anchor.
- Decision: founder decided the perk; (a), (b) and (c) open.
- Recorded in review, not changed: re-taking an old lesson (fail then pass) restamps its finish time and counts as done this week; the mobile single-lesson viewer shows only the title if the lock lookup fails; the perk switch is not sign-off gated beyond an admin and a reason.
### OQ-523 Emergency location versus "routes are never shared" (raised 2026-10-07, S48)
- Spec 5.7 and the Module 5 acceptance test say routes are never shared; Part C bans public maps. The founder wants the patient to be locatable in an emergency, which is the opposite use of location data.
- Options: (a) route recording stays private and a separate consented emergency-location feature is built (recommended, decision S48-1); (b) one recorder with a sharing switch (rejected: breaks the acceptance test); (c) no emergency location.
- Needs before the guard can go on: written consent text, retention period, who may see the position and for how long, counsel's view under NDPA, and a decision on whether a red event may share without a fresh tap.
- Decision: (a), 2026-10-07 (founder). Open parts: consent wording, retention, counsel review.

### OQ-524 Silence line 7 days needs a new signed rule set (raised 2026-10-07, S11)
- Decision S11-1 sets the silence line to 7 days. The live signed rule set `bp_care_triage` v1 uses 5, and rule sets are versioned, never edited.
- Work: `bp_care_triage` v2 (rules, shared copy, device bundle, parity and fixture tests), registry `triage.silence_rule_days` v2, CMO signature. Spec safety case 7 (5 days) and `docs/BUILD-SPEC-v5.md` are not edited; this entry and S11-1 record the departure.
- Decision: 7 days (founder, 2026-10-07). Build: open.
### OQ-252 (S34): size and cold-start targets conflict
- The S34 prompt asks for under 40 MB and cold start under 3 seconds on a 2 GB Android phone. Spec D.1 and decision DG-1 (2026-10-02) superseded those targets: the floor is a 4 GB Android 10+ or iOS 16+ phone.
- Options: (a) keep tracking the old numbers as PROPOSED budgets in config and fail CI only on growth (recommended); (b) set new targets for the 4 GB floor; (c) drop size budgets.
- Decision (founder, 2026-10-07): no pass or fail targets for size or cold start. Build what is needed: the low-data setting, accessibility, and a size and start-time report that is tracked, never a gate. Numbers stay PROPOSED in versioned config for information only.

### OQ-358 An emergency message is answered even while the assistant is closed (raised by S51, from the code review)
- The red-flag screen is a deterministic safety net, so it does not wait for `assistant_enabled`. If a message matching it reaches the assistant while the guard is closed (a stale screen, a direct call), the patient gets the fixed emergency guidance, the clinician alert and escalation are raised, the turn is saved and `assistant.red_flag_detected` is recorded. Every other message gets "the assistant is not open yet" and nothing is saved.
- Decision: recorded (safety first). Reverse only if the founder wants a closed assistant to be silent even on an emergency, which we recommend against.

### OQ-359 Which other screening results the assistant must never explain (raised by S51)
- The INV-04 token list covers HIV, hepatitis B and C and the neighbouring markers a lab reports for them (hepatitis B DNA, antigen and antibody markers, CD4, viral load, p24), all PROPOSED. Syphilis, other STI tests, pregnancy tests and genetic results are NOT on it: that is a clinical and legal decision, not a coding one.
- Options: (a) CMO and counsel decide the list and it is changed in one place (`assistant.excluded_analytes` plus `ai_excluded_analyte_tokens`, kept in step by a test) (recommended); (b) widen now to every STI marker.
- Decision: open (CMO and counsel).

### OQ-360 Nudges reach patients who used the assistant once, whatever their plan now (raised by S51, from the code review)
- The daily nudge cron and the mobile `/nudge` route check the go-live guard, role and active status, not entitlement, because `has_ai_coach_access()` answers only for the signed-in person. A patient whose access later lapsed would still get a generic "your check-in is ready" note. The note names nothing and the guard is off today.
- Options: (a) a service-role access check function used by the cron and the nudge route (recommended before the guard is switched on); (b) accept.
- Decision: open.

### OQ-361 The conditions and medicines lists reach the model and the visit draft unfiltered (raised by S51, from the code review)
- INV-04 now covers lab results, explanations and the reply. `patient_conditions` and `medications` rows are still passed to the model and to the pre-visit question list as written. A condition row that names HIV or hepatitis would be seen by the assistant.
- Options: (a) filter those two reads with the same token list (recommended); (b) leave to the clinician's choice of what is recorded.
- Decision: open (CMO).
### OQ-525 A repeat supply is a new send (DECIDED and built in S28c; raised in the first S28 build)
- Founder 2026-10-07: a repeat is a new send. A collected prescription can be sent again, with a new code, only while the medicine still permits another supply (`private.supplies_remaining`: 1 plus clinician-approved repeats, never above 1 plus repeats allowed, minus complete, undisputed supplies). The old code stops working. The forward-only machine allows `dispensed` to `sent` only through the patient's own send function. A prescription already supplied some other way (QR check, phone desk) is no longer offered to a partner at all.

### OQ-526 Delivery data: hidden from patients, full removal still to do (S28d; extends OQ-16, OQ-272)
- Live counts before the change: 0 pharmacy orders, 0 delivery attempts. The patient-facing `pharmacy_partner_directory` view no longer carries `delivery` or `delivery_fee_kobo`. **Not built, a separate task:** dropping `pharmacy_partners.delivery`/`delivery_fee_kobo`, the legacy order delivery columns, `pharmacy_order_delivery_attempts` and the dormant logistics screens (about fifteen web files).
- **RESOLVED 2026-10-07:** that task is done (PR #1017 code, PR #1023 database). See OQ-16.

### OQ-527 The older pharmacist reads are audited and tagged (S28d; closes OQ-271)
- `pharmacist_orders`, `pharmacist_order_allergies`, `pharmacist_order_medications`, `pharmacist_record_dispense` and `verify_prescription` now leave an audit row. `is_test` is on `pharmacy_orders`, `pharmacy_order_dispenses` and `medication_dispense_flags`, backfilled and stamped from the patient on every insert. The order alert to a pharmacy is the neutral in-app message (an email with no patient detail for a partner with no app login; never SMS). `verify_prescription` audits matches only: wrong-code probing is not audited or limited (open).

### OQ-528 Prices are not shown (DECIDED, founder 2026-10-07)
- The collection flow shows no price and compares none. Prices return only when partner price data carries strength and form and is reliable. (The first S28 build compared by drug name; that code was not carried over.)

### OQ-529 Structured questions only, no chat (DECIDED and built in S28c; closes the chat part of OQ-273)
- A pharmacy asks the prescriber one of six fixed questions (`pharmacist_ask_prescriber`) and can report "cannot supply" (`pharmacist_report_out_of_stock`); the prescriber answers from three fixed replies (`answer_pharmacy_question`). No free text anywhere, so no chat liability. An answer never changes a signed prescription (INV-02). They ride on S36h's flag table (a new `question_code` column) and its `pharmacy_flag_review` task, so the clinical queue works as S36h built it.

### OQ-530 A caregiver can choose a pharmacy for the patient (DECIDED and built on web in S28c)
- A caregiver holding the existing `manage_pharmacy` permission (an unexpired `profile_access` manage grant) can choose, change, take back and renew the code for the patient. The database checks the permission on every call (`private.rx_patient`), the patient gets a neutral in-app update, the patient's access log records the caregiver (`acted_for`, `data_shared_pharmacy`) and the audit row says it was done for her. The explicit "Collect here" button is the consent. Mobile has no collection screen yet (OQ-277).

### OQ-531 Refill reminder opens the Medicines screen (S28c)
- The reminder stays neutral and opens Medicines, where each prescription carries "Choose where to collect"; a collected prescription that permits a repeat offers "Send again for your next supply". A deeper link straight to the chooser is not built.

### OQ-287 Pharmacy collection needs the S37 go-live guard (DECIDED and built in S28c)
- `private.pharmacy_collection_on()` is the S37 `prescribing_enabled` guard, closed by default: every patient choice, pharmacy list, counter check and supply, and every question refuses while it is off (the live S28 functions were open until this migration). Its conditions gain a licensed, verified pharmacy with a verified location (from the data), the collection rules confirmed by their owner (`pharmacy.collection_rules`, from the sign-off table) and the notification sender deployed (attested). Taking a prescription back, the downloadable form and the QR and phone-desk paths are never behind it.

### OQ-288 The prescriber sees questions and where each prescription has got to (S28c, closes OQ-217 of the first build)
- `/clinician/pharmacy` (nav and search entries) lists the fixed questions with their answers, where each prescription this clinician signed has got to, and S36h's earlier written messages (read only). Only the signer, only for a patient they are still tied to; one audited read per page view. `/clinician/pharmacy-flags` redirects there.

### OQ-289 S36h's free-text flag function is still callable through the API (raised by S28c)
- `public.pharmacist_flag_prescription(uuid, text, text)` takes free text up to 500 characters. No screen uses it any more (S28c removed the form and its server action). Recommended: revoke execute from `authenticated` and drop it with S36h's proof once nothing calls it. Not done because S36h's own proof exercises it and it was applied by another session.

### OQ-308 `health_education_translations` is now an empty, unused table that four SQL functions still join (raised by S33 English-only pass)
- S33 added three columns to it and they were dropped again (migration `20261007123419_s33_course_english_only.sql`). The table itself stays, empty, because four older functions join it (see the remove-Pidgin migration). Dropping it needs those four functions rewritten from their live definitions.
- Options: (a) leave it (recommended until the Learning Centre is next touched); (b) rewrite the four functions and drop the table in its own reviewed change.
- Decision: open.
### OQ-532 Device and server work for the CMO's 200/130 flow (raised by S11c, updated by S11d; first numbered OQ-91, which S13 already used)
- Built and tested: the engine, rule set v2, the server context and result recording, and (S11d) the phone's emergency-symptom question: a sheet shown over the blood pressure form after a reading of 200/130 or more (`symptom-question-sheet.tsx`, `symptom-question.ts`, text TRI-008), "yes" saves the symptoms as danger rows and shows the emergency guidance, "none" starts the rest and 2 hour recheck (TRI-007, remembered on the phone, the repeat task S12 creates is due at 2 hours). Three symptom_type values were added to the database (weakness_or_numbness, difficulty_speaking, back_pain).
- **The sheet appears only once the rule set is APPROVED** (OQ-88). While it is a draft the older on-device check still raises the emergency for 200/130 and the engine only adds guidance, so showing the question as well would give two answers. Approving the rule set (console, S37) turns the new flow on for the phone; until then nothing changes for the patient.
- Fixed in S11e (CMO, 2026-10-05): (1) a "yes" with weakness or numbness, trouble speaking or back pain now pages its own Priority 1 alert like chest pain (`private.handle_symptom_red_flag`, migration `20261005224251`, proof `s11e_new_symptom_answers_page.sql`); (3) the 2 hour wait now has a reminder: a neutral local notification scheduled on the phone (works offline and with the app closed), replaced by a newer reading and cancelled when the result is graded (`recheck-reminder.ts`).
- Fixed in S11f: (c) the reminder now has a server backup: ten minutes after the phone's own reminder was due, if the patient still has not measured again, ONE neutral push (or an in-app message when there is no push subscription; never email or SMS) is queued by `private.queue_triage_recheck_backup_reminders()`, only for an approved rule set and only for a long wait (`params.recheckBackupPush`, 60 and 10 minutes, PROPOSED); (b) the phone now knows pregnancy and the first 6 weeks after a birth (`obstetric-status.ts`, read from `patient_pregnancy` and `postnatal_profiles`, kept for offline readings, window from the rule set). Edge function `send-pending-notifications` was redeployed with the `triage_recheck_due` wording.
- Seen on an iOS simulator (S11f, iPhone 17, dev client, a throwaway harness never committed): the symptom question sheet (list, checked state with a tick, Yes disabled until one is chosen, None closes it), the real iOS permission prompt appearing once when undetermined, a refusal leaving `no_permission` with no error, and the reminder arriving as a banner with the app in the background: "Time to check in. It is time for your check-in. Open TarragonHealth when you are ready." Not seen: the full form flow in the signed-in app (no test account may be used against the production backend), and Android.
- Fixed in S11g and S11h: (a) the older server alert path now follows the 200/130 decision once the rule set is APPROVED: the old emergency range with no red-flag symptom (and not in pregnancy or after a birth) raises the Priority 1 alert but no patient emergency record; a symptom keeps it an emergency, and a symptom answered after the reading opens the emergency record then (migration `20261006000812`, proof `s11g`, a no-op until approval). The 160/100 and 135/85 bands are unchanged, so a 165/105 reading still pages Priority 1 for a reading the engine would treat as amber: that is the S12 band alignment of OQ-67 and needs the CMO. (f) Tapping the reminder or the server push now opens the blood pressure screen, from closed or running, once per tap (`notification-tap.ts`). (d) The Pidgin for the question's buttons and the reminder is drafted in the catalogue; the emergency guidance, triage messages and symptom names stay in English until a native reviewer and the CMO sign them; the full list is `docs/PIDGIN-REVIEW-S11.md`.
- Still owed: (e) Android: not run (no Java or emulator image on this machine); `SCHEDULE_EXACT_ALARM` is not declared (OQ-73), so a reminder can arrive minutes late in Doze and the server backup push covers it. The native Pidgin review itself.
- Decision: pending (item e, and the Pidgin sign-off).
### OQ-533 Roster claim and org placement happen at INSERT, before any verification (OQ-41 and OQ-52 follow-up, found by S41)
- New finding on top of OQ-41: `private.handle_new_user()` does more than mark the roster slot claimed. When an unverified sign-up's phone or email matches a pending roster row it also puts the new profile in the employer's organisation (`v_org_id := v_roster_org_id`) at INSERT. So an unverified account typed with a colleague's number is created inside that employer's organisation, not just a slot lost. Employers only see aggregates (I9), so no individual data leaks, but the profile counts in that organisation until someone removes it.
- Why S41 did not fix it: moving the claim to the `phone_confirmed_at` / `email_confirmed_at` UPDATE means creating the profile in the default organisation and moving it on confirmation. Organisation is a guarded authority column and every `organisation_id` on a new account's rows must follow, so this is a core-trigger change that needs `/code-review ultra` and its own proof, which the build plan did not allocate to S41.
- Recommendation: option (a) from OQ-41, plus a nightly cleanup of never-verified accounts older than 7 days (closes OQ-52 option (a) too). OQ-52 itself still needs a founder choice between its two options.
- Decision: open.

### OQ-534 The hosted confirmation email must carry the code for the optional email code box to work (raised by S41)
- Built: `verifySignupEmail` / `resendSignupEmail` call `verifyOtp({ type: 'signup' })` and `resend({ type: 'signup' })`. The six-digit code only exists in the email if the Supabase "Confirm signup" template includes `{{ .Token }}`. That is a hosted dashboard setting (same class as OQ-44), not something code can change.
- Until the template is edited the box shows, accepts a code that never arrives, and the link still works, so nothing breaks, but the box is useless. Do the template change before telling anyone the feature is live.
- Decision: open (your action in the dashboard).

### OQ-535 No canonical list of local government areas (raised by S41)
- `profiles.lga` is free text, 2 to 60 characters, optional. The repository has no list of the 774 areas, and a typed area is not matched to `service_regions` or any partner geography.
- Options: (a) keep free text and normalise later (current); (b) load an official LGA list as a reference table with state, and make the field a picker (recommended once a source is chosen, for example the National Bureau of Statistics list; needs a licence check and a state-spelling map to `service_regions`).
- Decision: open.

### OQ-536 Cohort codes: S41 stacks on S38e (PR #988); three seams left (raised by S41)
- S38e already built spec 1.8 and is live in production but not on `main-dev`. S41 reuses it and creates no second code system. Until #988 merges, S41's onboarding code box calls `join_cohort` and, if the function is missing, shows "could not check the code just now".
- (1) `programme_id` in the spec has no live equivalent: a cohort belongs to a sponsor organisation. Confirm one cohort per programme is acceptable, or add `programme_id` when programmes exist as rows.
- (2) `join_cohort` does not emit the `cohort.joined` event. S41 registered the event type; the emit belongs inside `join_cohort` (one added line after the insert) and must be made when #988 is next touched.
- (3) Entitlement creation from a sponsor programme waits for S26. A code gives eligibility only today; nothing is granted.
- The concurrency acceptance test (`s41_cohort_max_uses_concurrent.sh`) prints SKIPPED, not PASS, on any database without `join_cohort`. It passed against the real S38e functions on a local database (5 of 5 places taken by 30 simultaneous claims, never 6; the lock-free control broke the limit). It will run for real on the first CI run after #988 merges.
- Decision: open.

### OQ-537 Mobile parity for onboarding answers, programme code and email code (raised by S41)
- The mobile app has sign-up and sign-in screens but no onboarding flow, so there is no mobile place for the goal and condition step, the programme code box, or the email code box. The shared module (`@tarragon/shared` onboarding-answers) and the RPCs are ready for it.
- Recommendation: build the mobile onboarding in S42 alongside the proxy flow and dependants, which also need it.
- Decision: open.

### OQ-538 Home cards from onboarding answers: wording and order need a product and CMO read (raised by S41)
- The mapping from answers to Home cards (`focusFromAnswers`) is deterministic and changes only which existing cards lead, never a clinical rule. The goal and condition option wording ("A kidney condition", "A heart condition") and the order cards appear in are a product choice made without a clinician. The CMO should read the option list once; nothing here is signed or claims a clinical meaning.
- Decision: open.

## Raised by S42 (2026-10-07, numbered from 330 to avoid clashing with parallel sessions)

### OQ-330 Consent wording is placeholder text: counsel must approve it (extends OQ-49)
- Every matrix cell (20), every bundle, and the hand-over consent line use clearly marked draft wording in `packages/i18n` (`consent.matrix.*`, `consent.bundle.*`, `handover.consent_notice`); `consent_matrix_cells.wording_status = 'draft_pending_counsel'` and each matrix screen says so. No approved legal wording was invented.
- Decision: open (counsel). When approved, set `wording_status = 'approved'` and replace the keys' text.

### OQ-331 Should the care purpose be optional for reproductive and mental health data?
- S42 marks all five care cells required (care needs the data a person chooses to add; sensitive types stay protected by the category-scoped access model, not by this switch). A person who does not want such data held asks for deletion or does not add it. A different answer (care optional for those two types) would mean the care team loses sight of data the person already entered.
- **Decision (founder and CMO, 2026-10-23): keep the care purpose required** for all five cells, including reproductive and mental health data. A person who does not want such data held asks for deletion or does not add it. Counsel input on OQ-330 wording is still separate.

### OQ-332 Sponsor reporting is not wired because the sponsor report is on PR #988
- `private.consent_in_force(patient, data_type, 'sponsor_reporting')` is the seam. When #988 merges, `sponsor_outcome_report` should also require it (and decide how `profile_cohorts.reporting_consent` relates to the matrix: recommend the matrix cell becomes the single source and the cohort flag a mirror).
- Decision: open.

### OQ-333 Which matrix cell gates which Care Circle block
- Adherence summary and weekly BP trend are both mapped to vitals x Care Circle. Appointments, red alerts and pay-for-care carry no record content and are not data-type bound. No circle view shows reproductive, mental health or documents, so those cells are recorded but unused (the screen says so).
- Decision: open (product, CMO).

### OQ-334 No research export job exists; the roster is the only door
- `research_export_roster()` (admin, audited, excludes test accounts and dependants) lists who agreed and for which data type. Any future export must be built from it. The older optional consent types in `patient_consents` (research, sponsor_reporting, care_circle_sharing) have no versions and are superseded by the matrix; recommend retiring them.
- Decision: open.

### OQ-335 Is the anonymiser enough to count as erasure?
- It removes identity and sign-in and every personal row outside a retention category, and keeps clinical, audit, financial, consent and communications rows (no confirmed statutory period, so nothing is deleted). Date of birth is reduced to the year; `patient_number` is kept as the record key. Audit and correction trails may still hold earlier names. Completion stays admin-reviewed (OQ-50).
- Decision: open (DPO and counsel).

### OQ-336 The export has no stored file
- `artifact_path` is a logical key stamped at fulfilment; JSON and PDF are rendered at download from the live record under the patient's own session, so nothing is parked in storage and a withdrawal made since is reflected. Two JSON routes still exist (`/api/patient/data-export`, `/json`).
- Decision: open (founder: keep, or store a snapshot per request).

### OQ-337 A young person who never signs in
- Until they claim a login, the 03:30 job leaves the guardian at view only for ever. The spec rule (never exposed without consent) argues for an automatic end after N days. Also: dependants already claimed before this change have no hand-over row (the claim clears `dependent_kind`). Live counts today: 0 minors, 0 elder proxies, so nothing is affected yet.
- Decision: open (founder).

### OQ-338 Kept guardians
- A guardian the young person keeps stays view only with no expiry. Recommend yearly re-confirmation.
- Decision: open.

### OQ-339 The elder-proxy downgrade that already ran
- The old daily job treated every `is_dependent_account` row with a birthday over 18 as a child turning 18, so an elder proxy's `manage` grant was stepped to `view` on its first run. The job now covers `minor_child` only. Live count of affected elder grants: 0.
- Decision: none needed today.

### OQ-340 Category to permission mapping (closes OQ-51 in the safest direction)
- Appointments and care plan, medicines, results and messages map to view or message permissions; vitals, vaccinations, reproductive health and history map to nothing; no acting permission is ever implied. The mapping needs a product and clinical read.
- Decision: open.

### OQ-341 The add-an-adult path (closes OQ-47 partly)
- It now needs a recorded reason (cannot receive a code, or cannot set up themselves) and no longer reaches an adult's reproductive health through `manage`. Recommend removing it once the mobile and web "Set up for my parent" flow covers every case you care about.
- Decision: open.

### OQ-342 OQ-48 and the cooling-off
- The dependent-claim flow no longer queues an SMS (INV-08); the person is told by whoever set it up and signs in with a code. Other patient SMS paths (OQ-32) are untouched. The cooling-off (30 days) is PROPOSED config `proxy.cooling_off`.
- Decision: open (founder for the days).

### OQ-343 Apply order and review
- Apply the consent matrix, privacy centre, dependants and proxy migrations in file order. Apply the SMS-column migration only after the new `send-pending-notifications` function and the app builds are live. The new `account.created` trigger on `profiles` and `account.phone_verified` trigger on `auth.users` are on core tables and swallow their own errors by design: review them with `/code-review ultra` before production.
- Decision: open.

### OQ-344 Not run, and mobile gaps
- No browser, device or real SMS run of any new screen. The mobile privacy screen's older consent list still has hard-coded English; the mobile app has no PDF download link. Sponsor wording, Care Circle consent text and the hand-over consent text await counsel.
- Decision: open.

### OQ-345 The OQ-53 rule on the older consent table exempts service and migration contexts
- `patient_consents` now refuses a withdrawn row for a required version for any signed-in session (patient, clinician, admin). A context with no `auth.uid()` (service role, migrations, older proofs `s02` and `s04` that insert history as fixtures) is exempt, so a service-role code path could still write one. The new matrix table has no such exemption (proved for the table owner).
- Decision: open (tighten when the older proofs are rewritten, or accept).

## S43 (Health Passport part 1), raised 2026-10-07

Numbered `OQ-S43-n` because other sessions are adding `OQ-nnn` entries in parallel and the numbers have already collided once (two `OQ-225`). Renumber when merging if the founder prefers.

### OQ-S43-1 Applying the S43 migration pauses live vaccination reminders until the CMO signs schedule version 2
- Blocks: apply order, and the CMO's sign-off. Live today: the daily cron `vaccination-reminders-daily` runs `private.queue_vaccination_reminders()`, which was never tied to the sign-off (the 2026-07-30 migration said so on purpose). A signed version 1 exists, written against the old catalogue (typhoid listed, HPV one dose at age 9). Zero vaccination records exist, so nobody is reminded of anything today.
- Built: the function is renamed and wrapped; the wrapper does nothing unless the active signed sign-off carries a `schedule_config` (version 1 has none). Version 2 is inserted as an UNSIGNED draft (HPV two doses 26 weeks apart, typhoid excluded, R21 per-state, items marked V, NV or SEC from the CMO pack). I did not sign it and cannot.
- Still open, not built: (a) the schedule generator (`generate-vaccination-schedule`) and the catalogue still use the old ages and still list typhoid, so a patient's due dates and the typhoid card entry follow the old catalogue until the signed config drives them; (b) the wrapper is all-or-nothing, so it does not filter an old typhoid schedule row (none exist yet); (c) the CMO's questions in section B of the sign-off pack (single or double HPV, MR, MenFive, R21 states) stand.
- Options: (a) as built; (b) leave reminders running until v2 is signed (rejected: founder said no reminders until signed).
- Decision: open. CMO signs version 2 with `public.sign_vaccination_schedule` (no screen for it exists in the sign-off hub yet; it is a database call today) and the founder decides whether the generator moves to the config in S44 or a follow-up.

### OQ-S43-2 The S09 share function was broken for two of its sections, and what ships first
- Found by exercising every section: `record_share_by_token` selected `glucose_mmol` (the column is `glucose_mmol_l`), so choosing the **vitals** section made every opening raise; the **lab results** section compared `report_status` to `'released'`, which is not a member of that enum, so it raised too. Zero shares existed, so nobody was affected. Both are fixed in `record_share_open`; the old name stays as a wrapper.
- Apply order: schema first, then the web deploy. The new `/share/[token]` route and the patient screen call functions that only the migration adds. The already-deployed page keeps working through the wrapper (a PIN-protected link reads as not found to it).
- `record_shares.token` is now null for every link (only a hash is stored), so a link can be shown once at creation and never again. Decision for the founder: acceptable? The alternative (keep plaintext) leaves live links readable to anyone with database access.
- Decision: open.

### OQ-S43-3 Direct staff reads that conflict with INV-10, found and deliberately not changed
- `patient_timeline_select`, `lab_analyte_readings_select`, `vaccination_records_select` and `record_shares_org_staff_select` still admit `private.is_org_staff` directly. S05 listed the first three as its follow-up list; the share row is new to this review. New S43 tables (`procedures`, `emergency_card_fields`, `record_share_config`) have no staff read at all, and staff read procedures and family history only through `read_patient_history_audited`.
- The timeline staff read also means a staff member can see a patient's `trust_tier`, `symptom_logged` and `procedure_recorded` rows without an audit entry.
- Decision: open (the S05 follow-up owner).

### OQ-S43-4 Mental health and reproductive health in share links and summaries: the exclusion is partial
- The spec says these are excluded unless explicitly chosen. Built: they are not sections in the closed set, so no one can tick them by accident, and no explicit opt-in exists.
- **The limit, found in review:** a medicine, condition or lab result inside a general section is not classified by what it is for. A contraceptive in the medicines list, or a pregnancy hormone result in the results list, WOULD be shared (and listed in the facility summary and readable by a caregiver who holds only the labs category). The screen copy now says so plainly instead of promising an exclusion it cannot make.
- To close it: a CMO-signed tag list (which medicines and analytes are reproductive or mental health) applied in `record_share_open`, `patient_biomarker_*` and the summary, with the `reproductive_health` category and guardian rules. Do not build the tag list without the CMO.
- An explicit opt-in section needs the same access-category checks and counsel on what a link holder may see.
- Options: (a) leave them out entirely (as built); (b) add explicit sections after the access-category review.
- Decision: open (founder and CMO, X7).

### OQ-S43-5 Share defaults and link-preview bots
- `record_share_config` version 1: 72 hour default, 720 hour ceiling, 5 PIN tries, 4 digit minimum. PROPOSED; the founder and CMO confirm (X7). Mirrored in the code registry as `record_share.defaults` with a test.
- Risk: a messaging app that unfurls a link opens it, and on an unprotected link with a view cap that opening spends a view and is logged as an opening. A PIN stops a bot reading anything. Recommendation: say so beside the view cap, and prefer a PIN when a cap is set.
- Decision: open.

### OQ-S43-6 AI-018 (photo capture reading) is registered but off, and what turning it on needs
- Registered in `ai_systems` as `draft`, not enabled, not runtime governed, with three guardrails; the go-live guard `document_capture_enabled` is off and **cannot be switched on yet**: its conditions are not defined in `private.go_live_conditions` (I did not restate that function because several branches change it). The code is in place and tested with a fake model; nothing has run against a real image.
- To enable: evaluation suites passed and approved by the CMO; conditions added; vendor terms for patient document images confirmed (data processing counsel); `runtime_governed` flipped after the call site is deployed.
- Collision risk: the code `AI-018` was chosen from the live registry on 2026-10-07; another branch may take it.
- Decision: open (CMO, founder, counsel).

### OQ-S43-7 What a confirmed photo reading is allowed to become
- Built: confirmed fields stay on the document row, labelled "read from a photo, confirmed by you". They are not medicines, results or vitals and feed no alert, risk score or timeline value. A confirmed prescription line does not create a medication (INV-02 needs a clinician's signature).
- Open: should a confirmed reading offer a clinician a one-tap "review and file" (reusing the lab and vaccination review queues)? Not built.
- Decision: open.

### OQ-S43-8 Smaller items
- Vaccination reminder notifications put the vaccine name in the payload (INV-07 asks for no condition, reading or result in a notification). Existing behaviour, not changed.
- Migration timestamps `20261007230331`, `...122142`, `...122358` were hand-picked after the latest file (`20261007120347`) because the local clock reads earlier than that file; live `list_migrations` showed no collision at the time. Check again before applying.
- `packages/db/src/database.types.ts` is a stale copy (it lacks `record_shares`); only `packages/shared/src/database.types.ts` was spliced.
- Not built in S43 though in the spec's screen list: mobile capture, trends, history and share screens; an in-app crop (the phone's own crop applies before upload); the lock-screen widget (needs a native build); a CMO sign-off screen for the immunisation schedule.
- Part D.1 (offline-first): photo capture needs a connection to upload and read; it does not use the phone's write queue (S06), and there is no offline capture on the phone at all yet. A failed upload tells the person and keeps nothing half-saved.
- Two older proofs hard-coded "seven go-live guards" (`s37_go_live_guards.sql`, `s36b_go_live_status_ops_read.sql`); they now count the live total, so the next guard added by any session does not break them.


## S44 (interoperability, closes Module 2), raised 2026-10-07

Numbered `OQ-S44-n` for the same reason as `OQ-S43-n`.

### OQ-S44-1 Consent to exchange records with an outside system: placeholder wording, and S42's matrix
- Built: `external_exchange_consents` (per named system, import, export or both, withdrawable, audited) with a wording KEY `consent.external_exchange.v1_placeholder`. The screen says plainly that the wording is a placeholder. No legal wording was written.
- Found in review, not closed: the source name comes from the partner's own `x-fhir-source-system` header and the consent is matched by that name, so a partner holding an import-scoped key could name a system the person did consent to. The consent is not yet bound to the API key's partner (`api_keys.partner_integration_id`). Bind it before any real partner is issued an `fhir:import` key.
- Open: counsel's wording; whether S42's consent matrix absorbs this table (it is a narrower, source-named consent) or keeps it alongside. Acting-for supporters cannot grant it (consent is personal).
- Decision: open (counsel, founder).

### OQ-S44-2 Lab structured push: guard conditions, mapping confirmation, LOINC codes
- Built: `lab_structured_push_enabled` guard, OFF; it cannot be switched on until its conditions are added to `private.go_live_conditions` (not restated here, several branches change it). Mappings are proposed by an admin or lab liaison and confirmed only by the CMO through database functions; there is no screen for either yet. No lab mapping is seeded. The `fhir.mapping` lab analyte LOINC codes are PROPOSED (LDL omitted because direct and calculated LDL have different codes).
- Open: who confirms in practice, a screen for it, the guard conditions, the first real laboratory and its codes and units. Non-linear conversions (HbA1c % to mmol/mol) are not supported and reject.
- Decision: open (CMO, founder).

### OQ-S44-3 Export scope: items inside general sections are not classified by purpose
- Same limit as OQ-S43-4. Reproductive health and mental health are not sections, so they cannot be named, and the bundle's own tags say so; but a contraceptive in the medicines list or a pregnancy hormone in the results is exported. An explicit opt-in section needs a CMO-signed tag list and counsel. Not built.
- Decision: open (CMO, counsel).

### OQ-S44-4 Import: what is only stored, not filed
- Every received resource is kept in `external_records`. Only Observation (importable vitals), AllergyIntolerance, MedicationStatement, MedicationRequest and Immunization can become proposals. Condition, DocumentReference, Patient and anything else is `stored_only`: a clinician sees it through the audited read but there is no one-tap file. Adding Condition or DocumentReference is a migration (the proposal enum is closed on purpose).
- A partner now MUST send `x-fhir-source-system`; no partner has called the route yet.
- Decision: open (founder, CMO).

### OQ-S44-5 Health-store sync (HealthKit, Health Connect) now refuses without `wearable_device_data` consent
- Found: nothing enforced that consent anywhere. Built: the route fails closed on both calls. Consequence: no wording or consent version for that type exists, so nobody can grant it, so device-local sync is refused until counsel's wording is published and S42's screen can record it. The mobile app shows its generic "could not sync" message for the 403; a clear message is not built. Nothing here has ever run on a real device.
- Decision: open (counsel, founder: accept the pause, or allow the OS permission alone for now).

### OQ-S44-6 Patient correction and removal (2.14)
- Built: private notes, labels and a date on any item; correction requests naming an item. Not built: a patient delete or "entered in error" for vitals, medicines or allergies, because they feed alert, interaction and risk engines and removing one from those is a clinical decision. Staff tombstoning of clinician-sourced items is not built beyond the existing correction workflow and S43's tombstones for history.
- Notes are not shown to staff and are not in the export, share link or summary.
- Decision: open (CMO).

### OQ-S44-7 Validation and environment gaps
- The HAPI FHIR validator (Apache 2.0) was NOT run: the structural checks are our own schema and a round trip. Run it in CI before anything is sent to a real system.
- Types: `packages/shared/src/database.types.ts` was spliced from a local generation (only this session's tables and functions; `p_bundle_identifier` made nullable by hand). Migration timestamps are hand-picked after the newest on the stacked branches (the local clock reads earlier); recheck live `list_migrations` before applying.
### S45: risk, screening calendar and packages (2026-10-07). Numbered OQ-S45-n so they cannot collide with other open sessions
- **OQ-S45-1 WHO 2019 coefficients are missing, so the instrument is OFF.** The coefficient tables (beta values, baseline survival, centring values for Western sub-Saharan Africa, lab and non-lab) are in the Lancet appendix, which could not be obtained; the open copy at eprints.gla.ac.uk is the main paper only. Nothing was typed from memory. `risk_instrument_versions` v1 is UNSIGNED with null coefficients and `sign_risk_instrument` refuses to sign it. To go live: someone supplies the appendix tables, the engineer loads them as a new version, runs `runCvdValidationVectors` against vectors from the paper's published charts, the CMO checks the region mapping for Nigeria (the extract read did not list Nigeria) and the licence terms for embedding, then signs and switches `risk_instrument_who2019_enabled` on. Decision: CMO plus whoever can fetch the appendix.
- **OQ-S45-2 Band-to-action table is not decided.** Bands (under 5, 5 to under 10, 10 to under 20, 20 to under 30, 30 and over) and tiers (low, low_moderate, moderate, high, very_high) are PROPOSED. Who is told what at each band, follow-up intervals and the statin or referral cut-offs need the CMO from the primary PEN and HEARTS documents. Non-lab 10 percent "further assessment" trigger is also the CMO's.
- **OQ-S45-3 Package names and contents are unresolved.** `screening_packages` maps `essential` to `screen_essential`, `preventive` to `screen_core` (a guess), `full_screen` to the inactive `screen_comprehensive`, `annual_health_check` to the inactive bundle; all `name_status = provisional`. Live tiers are `screen_core/advanced/comprehensive`; the spec says Essential, Preventive, Full Screen. The bundled video consult is dropped (S25 membership). Weak-evidence tests (routine thyroid, annual HIV for everyone) in Essential are the CMO's call.
- **OQ-S45-4 Cervical rule.** v1 keeps the live catalogue rule (female, 25 to 65, every 36 months, smear). The plan says follow the national HPV DNA targets (35 and 45) only once the CMO confirms. Prostate is "optional" (offered, never auto-scheduled); the CMO decides whether it is discussion only.
- **OQ-S45-5 Every live bundle is `guidance_only = true`.** The existing trigger `lab_orders_aa_guidance_only_never_billed` refuses any billed order for them, so no package can be sold through Tarragon today and home collection orders cannot exist. The new home-kit guard is correct for when partner billing is enabled but untested in production conditions (the proof opens three bundles inside a rolled-back transaction). Booking and payment in one flow (3.10) is a seam only: `list_screening_packages()` returns price and rate card, and the S25 checkout owns the rest.
- **OQ-S45-6 HPV DNA SKU.** Dormant: `screening_packages.hpv_dna` has no bundle, `requires_positive_pathway`, and is hidden behind `hpv_dna_enabled`. A positive-result pathway (colposcopy, treatment, confirmatory testing) must be written and attested before it is sold.
- **OQ-S45-7 New guards have no condition text wired.** `private.go_live_conditions` is a plpgsql chain; the live copy already differs from the repo (it holds a `clinical_safety_case_current` condition that is in no migration on main-dev), so this session did NOT restate it. The four new guards (`risk_instrument_who2019_enabled`, `screening_scheduler_enabled`, `hpv_dna_enabled`, `home_kit_sensitive_enabled`) therefore report the fail-closed "unknown guard" condition and cannot be switched on until a later session adds their branches after the safety-case change merges. That is the safe direction.
- **OQ-S45-8 Nightly scheduler is a pg_cron job, not an edge function.** Same style as the S19 sweeps and keeps the rules, the guard and the writes in one transaction. `screening-scheduler` runs 02:15 UTC and does nothing while `screening_scheduler_enabled` is off or no rule set is signed. The existing app-driven scheduling (`submitRiskAssessment`) is unchanged. Founder to confirm pg_cron is acceptable for the spec's "edge function" wording.
- **OQ-S45-9 Staff read of the new table is audited and tie-checked, but the sign-off hub has no panel yet.** `sign_risk_instrument` and `sign_screening_rule_set` exist (CMO only); adding both to `GOVERNED_CONFIG_TABLES` and the hub needs a panel each (small follow-up).
- **OQ-S45-10 Existing `cv_risk_config` and the clinician panel still show the AFRO approximation** until the WHO guard is on; with the guard on, `assess.ts` stops showing it. The guard lookup answers for the signed-in clinician, so a test clinician sees it hidden once the guard is on.

### S46: results, hepatitis logic and the yearly Health Report (2026-10-07). Numbered OQ-S46-n so they cannot collide with other open sessions
- **OQ-S46-1 The hepatitis rule changed the live 2026-08-21 behaviour (founder confirmed the spec rule wins, 2026-10-07).** Before: hep_b and hep_c were never re-sold once a result was on file. Now: HIV and hepatitis C annual, HBsAg annual until a positive anti-HBs is recorded once. The change is data (`serology_rule_versions`, v1 legacy kept, v2 active; roll back by swapping the two `status` values) and is flagged in the migration header. Check any patient-facing or marketing copy and any catalogue description that still promises "once, ever" for hepatitis B or C; none was found in the app code, the catalogue text was not searched. A patient who bought hep B or C once will now be offered it again after 12 months.
- **OQ-S46-2 The anti-HBs threshold is unconfirmed.** 10 mIU/mL is the usual public marker and is stored as PROPOSED (`thresholdStatus: proposed_unsigned`). Until the CMO confirms it (sets `threshold_approved_by` on the active rule version) a numeric titre never sets immunity; only a laboratory-flagged positive, or a doctor recording immunity with a stated basis, does. Also open: anti-HBs is not an orderable test, a catalogue item or a panel analyte today, so no real lab result can reach the trigger yet. Adding it needs a catalogue entry, a partner price and a panel version (S27 panels are CMO-signed).
- **OQ-S46-3 Report settings are PROPOSED and unsigned.** BP target (below 140/90, a care-plan target overrides), borderline margins, the minimum BP reading count (3), the change tolerance, the recheck interval (4 weeks), the priority time windows and which sections a shared copy drops are placeholders for the CMO (`health_report_config_versions` v1, `report.settings` in the PROPOSED registry). No guideline citation is printed on the report yet (principle 4).
- **OQ-S46-4 Fixed wording needs the CMO.** "Screening and reports do not rule out disease" (the short standing line and the longer report statement) and the "get help sooner" emergency text are placeholder text keys (`disclaimer.screening.standing`, `report.statement.not_rule_out`, `report.emergency.signs`). The clinician page warns while `statementApprovedByCmo` is false. The emergency text names no phone number because the real emergency numbers are still a founder item.
- **OQ-S46-5 Yearly generation stays off.** Guard `health_report_generation_enabled` is off and the cron route is not in `vercel.json` (sub-daily crons block deploys, and this is a yearly job). The guard has no condition text wired for the same reason as OQ-S45-7, so it cannot be switched on yet. AI-019 is registered disabled; the template paragraph is the live path. A clinician reading a draft sees the AI draft only as a starting point and signing wipes it.
- **OQ-S46-6 S43 trends are on another branch.** The report uses `private.hr_biomarker_points` (same rules as S43's `private.biomarker_points`: released, not withdrawn, not replaced, never a sensitive code, units never converted). When S43 merges, swap the call so there is one definition. Also: the S27 tables are missing from `packages/shared/src/database.types.ts` on this stack (they are on main-dev); the types here were spliced by hand for S46's own objects only.
- **OQ-S46-7 (RESOLVED by S46c, 2026-10-07: sign-off is now an S16 clinical task, see OQ-S46-11) Sign-off routing is not an S16 task.** A draft is assigned to the patient's care-team doctor and appears in `/clinician/health-reports`; it is not a `clinical_tasks` row (the S16 task types are CMO-signed and a new type needs that sign-off). A doctor with no care-team link to the patient cannot see or sign it (INV-12). If nobody is assigned the draft waits unseen: needs a fallback owner.
- **OQ-S46-8 Gaps in the report.** (Caregiver read built in S46c, see OQ-S46-12 and OQ-S46-13.) Device data is a count by source, no wearable metric is judged (founder decision on wearable-only metrics stands). The expiring share link is S43's and is not wired to the shared PDF. No audio per section. A critical result is shown as "needs attention" if released; the escalation path runs first and is unchanged.
- **OQ-S46-9 Pathway coverage looks thin.** The coverage table has 15 rows. It has no hypertension HbA1c, no obesity kidney function, no heart-failure kidney function or ECG; whether those belong is a CMO call. The proof verifies every existing row, it does not claim the list is clinically complete.
- **OQ-S46-10 Audio for results.** No result audio clips exist in the S32 manifest, so `resultAudioAllowed` is false in practice. When clips are recorded they need the CMO's signed wording, and HIV, HBsAg and HCV Ab must never get one (the gate and a test enforce it).
- **OQ-S46-11 The report sign-off task type is NEW and UNCONFIRMED (S46c).** `health_report_signoff` (task_types v1) carries PROPOSED values for the CMO: priority class 8, due in 7 days, lead window 1 day, claim timeout 60 minutes, minimum tier senior medical officer (the Medical Officer tier was retired by F-05, so decision 12 "medical officer tier" now reads as the one doctor tier), pushable. Not `needs_confirmation`, on purpose (a row waiting for confirmation blocks `approve_triage_rule_set`, and no triage rule creates it, same choice as `pharmacy_flag_review`), so the CMO's confirm screen will not list it: the note on the row says UNCONFIRMED. A past-due task escalates like any class 8 task (S16 sweep, event `clinical_task.escalated`); confirm that paging the on-call doctor for a late yearly report is not wanted before that handler is wired for class 8. A draft whose task a lead cancels waits with no live task (nothing re-opens it yet). The S30 fee schedule has no entry for this type, so a signed report earns no fee until one is added. `assigned_clinician_id` on `health_reports` is now unused for routing and stays null.
- **OQ-S46-12 Caregiver read, access categories (S46c).** There is no mental health access category among the eight, so the PHQ-9 and GAD-7 content of a report needs an EXPLICIT `medical_history` grant plus the adolescent mental health waiver; confirm that mapping. Screening items map to `labs_results`, the cardiovascular risk band needs both `vitals_readings` and `labs_results`. The doctor's free-text summary is returned only when no section was withheld. The hand-over rule reads S42's `dependant_handovers` table when it exists; without it a guardian of someone aged 18 or over reads nothing (S42 is not in this stack). Read of the report is logged under the existing care access scope `health_summary` (metadata `kind: yearly_report`) rather than a new scope. The proof makes a stand-in `dependant_handovers` table when S42 is absent.
- **OQ-S46-13 Care Circle supporters read no report (S46c).** The S29 permission list (adherence, weekly blood pressure, appointments, red alerts, pay) has no report permission and the new read never consults the circle, so a supporter is refused even when the circle is active. If the founder wants circle sharing of the report, add a circle permission and gate it on the S42 consent matrix cell documents x care_circle_sharing (a bundle for it does not exist today). The caregiver shared copy (`?variant=shared`) is the same shared copy the patient prints; the expiring share link is still S43's.
- **OQ-S46-14 Hepatitis B and C catalogue copy corrected (S46c, founder instruction).** The Know Your Basics bundle description no longer promises once-ever or "never asked to pay again" for hepatitis B or C: blood group and genotype stay once for life, hepatitis B and C can be tested yearly, hepatitis B stops once the care team records protection. Every copy rewrite lived in `panel_bundles.description` (20260821191743, 20260821192511, 20260911203129); marketing pages, i18n and education articles carry no once-ever claim for hepatitis (searched). The older migrations are left as history, the new one restates the live value. `screen_types.once_per_lifetime` still marks hep_b and hep_c (the S46 rule ignores it for them); the label there is not patient-facing. The annual-health-check marketing page says "genotype and blood group (once)" which is still true.
- **OQ-S46-15 S46c migrations were run only on a scratch local stack.** Production untouched, nothing pushed.

### S47: CMO and founder choices applied (2026-10-07). Numbered OQ-S47-n. Chat selections, NOT signatures
Design note: `docs/design/S47-decisions-applied.md`. Everything below that needs a signature is loaded as an unsigned, proposed version.

**Still undecided (do not treat as decided)**
- **OQ-S47-1 WHO 2019 coefficients and the region.** The instrument stays OFF: someone must supply the appendix coefficients, Nigeria's region mapping must be confirmed and the licence checked. The go-live guard now lists those as conditions (`risk_instrument_signed_verified`, `nigeria_region_confirmed`, `coefficient_licence_checked`). Band actions are loaded (`risk.band_actions`, unsigned) but unverified against WHO PEN / HEARTS.
- **OQ-S47-2 NPHCDA schedule and the HPV dose conflict.** The immunisation schedule v2 stays held and reminders paused until the dated NPHCDA schedule is read; HPV two doses (founder) against a reported single dose since October 2023 is not settled.
- **OQ-S47-3 Tier bundle prices after removing HIV, hepatitis B and C.** The four tier bundles (Essential, Core, Advanced, Comprehensive) no longer contain those tests but their prices were NOT changed. Whether to reprice, and how a patient who wants one adds it, is a founder call. Every live bundle is still `guidance_only`.
- **OQ-S47-4 Retention period.** The privacy summary says the clinical record is kept for a stated retention period and that the period is "still to be confirmed". `privacy.retention.retentionPeriodYears` is null on purpose. Counsel wording is a placeholder.
- **OQ-S47-5 Hand-over expiry for a young person who never activated their own login.** The rule as chosen ends guardian access at the end of the grace period unconditionally. Whether a dependant record with no login of its own should be treated differently (the guardian may be the only person able to act) is an observation for the founder, not decided.
- **OQ-S47-6 (RESOLVED 2026-10-08 in S47d, wording still open under OQ-S47-15).** Feature screens did not ask for the optional-per-use consents. The database function (`feature_consent_state`), the server action (`grantFeatureConsentAction`) and the copy exist; the women's health, mental health questionnaire and device-sync screens still need the prompt wired in, and the old `wearable_device_data` consent that the health-store route reads is a different record from the matrix cell `device_data x care`. Which one governs is not settled.
- **OQ-S47-7 Guideline gaps still open.** The Nigeria 2023 HIV guideline retest interval was NOT read; the national cervical screening text was NOT read (ages 35 and 45, the 5 year milestone window and the HIV flag are from the chat selection); the WHO home BP protocol and the WHO anti-HBs statement were not read; the emergency number 112 is confirmed from secondary sources only and the emergency signs must be checked against the signed triage red-flag list before the report goes live.
- **OQ-S47-8 Higher-risk blood pressure group is detected from the problem list by ICD-10 prefix or name.** The prefixes and names are in the unsigned report settings (`higherRiskCriteria`), not clinical decisions made by an agent; the CMO should confirm them. A patient whose diabetes or kidney disease is not on the problem list gets the default 140/90 target. "Validated device" and "duplicate morning and evening" readings are guideline conditions the platform cannot check.
- **OQ-S47-9 (RESOLVED in the review fixes) The live `attest_go_live_condition` DOES carry the two research export pairs; the first restatement dropped them.** Fixed in `20261008030051`, and a proof now compares the allow-list with every pair captured from the live definition (16).

**Decided in chat and recorded (removed from the undecided list)**
- Consent matrix: `required_for_care` only for vitals and documents; reproductive, mental health and device data are optional per use (asked on first use, withdrawable, withdrawing stops that feature only). Counts: 0 withdrawn consents, no conversion.
- Emergency card defaults: on blood group and genotype, allergies, current medicines, emergency contacts; off until chosen conditions or diagnoses, reproductive health and mental health.
- AI-018 and AI-019 stay off (AI-018 test accounts first, AI-019 after a quarter of real report data).
- Lab code mappings: the lab liaison proposes, the CMO confirms (as built).
- The failing `src/lib/document-capture/no-other-readers.test.ts`: fixed by allow-listing `components/item-note.tsx` by name with a comment; the guard stays strict for every other file.

**Effect on earlier items:** OQ-S45-2 (band-to-action table) is now a PROPOSED unsigned config, still to be signed; OQ-S45-4 (cervical rule) is loaded as HPV DNA at 35 and 45, unsigned; OQ-S45-7 and OQ-S46-5 (guards with no conditions) are resolved by migration `20261008030051`; OQ-S46-2 (anti-HBs threshold) stays unconfirmed and now also never sets immunity from a titre alone; OQ-S46-3 and OQ-S46-4 (report settings and wording) are superseded by settings v2, still unsigned and still `statementApprovedByCmo = false`.
- **OQ-S47-10 A signed report is not re-checked after a later lab withdrawal (plausible, not fixed).** A report is frozen at signature. If a lab result it quotes is withdrawn or corrected afterwards, the signed report still shows the old value. The S46 correction flow exists but nothing prompts a clinician to open it when a result they signed against is withdrawn. Needs a decision: an alert to the signing clinician on withdrawal of any result inside a signed report, or a visible "a result in this report was later withdrawn" line.
- **OQ-S47-11 The legacy `record_share_by_token` spends a view on a plain GET (plausible, not fixed).** It calls `record_share_open(token, null, true)`, so a link preview or a crawler that fetches it counts as an opening and, with the default cap of 10, can use the views up. The newer `record_share_open(..., false)` preview path exists; the legacy door should use it for GET or be retired once no client calls it.
- **OQ-S47-12 Membership price changed from 100,000 to 120,000 naira (founder, 2026-10-08).** A new catalogue price version of 12,000,000 kobo was added; the 10,000,000 kobo version was closed (valid_to set), not edited, so existing subscriptions keep what they bought. Needs the founder to confirm: do current Members renew at the old price or move to the new one at renewal, and does the marketing and pricing copy elsewhere (pricing.ts, partner materials) still show the old figure. Nothing signed; the price is applied locally only.
- **OQ-S47-13 Day-90 hand-over end is now a soft end (founder, 2026-10-08).** At day 90 a guardian's access moves to an archive table (`profile_access_ended`) instead of being deleted, the young person can restore it within 30 days, and Care Circle seats for the same people are revoked in the same step. If the record belongs to a person who never activated their own login, access does NOT end: it is extended once by 30 days and an ops incident opens. Decide: what should happen to such records after the single extension, and whether a restore screen is wanted in the app (the database function `restore_ended_guardian_access` exists; no screen calls it yet).
- **OQ-S47-14 The annual panel still contains HIV, hepatitis B surface antigen and hepatitis C antibody (CMO).** The CMO decided HIV and hepatitis C testing is risk based, and the scheduler follows that. But the signed-off annual panel `membership_annual` (S27g) lists `hiv_screen`, `hbsag` and `hcv_ab` as part of the one yearly blood test every Member gets. Per instruction the panel was not changed; the proof only reports the mismatch. The CMO needs to decide whether the three analytes leave the annual panel (a new panel version, signed) or are ordered only when risk flags say so.
- **OQ-S47-15 Optional-per-use consent wording is a placeholder (counsel).** The first-use prompts for reproductive health, mental health and device data use draft wording (`consent.feature.<type>.ask`). The database refuses the write without the yes (S47d), so the wording is the only open part. Also note: a person who declines the mental health consent cannot save a questionnaire, including one whose answers would raise a crisis flag; the screen shows the question first, but the CMO should confirm that is the intended behaviour for the crisis items.
- **OQ-S47-16 Reproductive and mental health emergency-card medicine lists are deliberately narrow (CMO).** Only medicines used almost only for contraception, fertility treatment, termination or depression and psychosis are withheld when the switch is off (contraceptives, mifepristone, clomiphene, the common antidepressants and antipsychotics). Misoprostol, diazepam, lorazepam, lithium, amitriptyline and similar drugs stay on the card because they have other common uses and hiding them from a responder is the greater risk. The card counts what it withheld ("2 medicines are not shown") and never names it. The CMO should confirm the list.
- **Review fixes applied 2026-10-08** (see `docs/design/S47-decisions-applied.md`): phone digits out of the event key, the anonymiser closes share links and the emergency card, INV-04 code variants and legacy reading branches, the FHIR adolescent gate, emergency card medicines, anti-HBs immunity only from a released result, rejected BP readings excluded, higher-risk reason hidden from shared and caregiver copies, report build backoff and pre-check, late hand-over rows, exact condition matching.


## Raised by S80 (prepared work)

### OQ-310 Who runs the monthly AI review sample draw, and when? (raised by S80c)
- `draw_ai_review_sample(month, rate)` exists and takes the rate as a parameter; nothing schedules it, deliberately, because `ai.review_sample_rate` (0.05) is proposed and unsigned. Options: (a) a monthly cron that reads the confirmed config value and skips if it is only proposed (recommended); (b) the CMO draws it by hand each month.
- Decision: open.

### OQ-311 The 213 published health education items that were never clinician-reviewed (raised by S80 fix-first)
- Live on 2026-10-07: 219 published, 213 with `clinician_reviewed` not true. The new gate does not change them. Options: (a) leave published and re-review in priority order, high-risk categories first (recommended, avoids emptying the app); (b) move all to `review_due` so the CMO re-affirms each; (c) withdraw all not reviewed. Content past its review date is already hidden by the nightly sweep.
- Decision: open (CMO).

### OQ-312 The AI review queue reads patient-derived text without a patient tie (raised by the S80 code review)
- INV-12 says a clinician sees a patient only through an active task, lead assignment or page. The monthly AI review sample is a quality-assurance read: the reviewer sees the answer text, never who it was for, only within their own organisation, and each open is audited with the sample ids. It still has no per-patient tie. Same access class as the S20 clinical audits.
- Options: (a) accept it as a named quality-assurance access class, limited to the CMO and senior doctors (recommended; drop the medical officer tier from `private.ai_reviewer_ok`); (b) the CMO alone reviews; (c) redact the text before it is shown.
- Decision: open (CMO).

### OQ-313 Six consent types have no version row, on purpose (raised by the S83 audit fix)
- Added a current optional `research` version (the S81 export gate reads exactly this consent). Not added, because nothing yet obeys them and a withdraw switch that controls nothing is worse than none: `marketing` (no broadcast path checks it), `device_data` and `wearable_device_data` (wearables already hold per-connection consent), `care`, `care_circle_sharing` and `scribe_default` (the scribe asks per consultation and Care Circle has its own access grants, so a second consent would be a second source of truth).
- Options: (a) retire `device_data`, `wearable_device_data`, `care`, `care_circle_sharing` and `scribe_default` from the privacy list and keep only the enum values (recommended); (b) add a gate first, then a version, for `marketing` only when a marketing message is built; (c) add versions for all and wire gates later.
- Decision: open (CMO and data protection officer). Related: INV-08 fix `20261007214438` and the sponsor claim link replace the last SMS paths. Correction: the virtual-review join link did NOT still text a patient (S21 had already made it in-app only); the dead `send-patient-link.ts` was deleted, and that notice now also goes by push and email.

### OQ-539 update (guard enforcement, 2026-10-07)
- `payouts_enabled` was already enforced since S31 (`public.payout_prepare_send` refuses with `payout_guard_off`); only its status text was stale. `prescribing_enabled` now also refuses signing a prescription (draft to signed, signed-in clinician) and `lab_booking_enabled` refuses a patient-initiated Tarragon-billed lab order (migration `20261007222755`). Test accounts stay open. Still not enforced: `on_call_cover_ok` (care pack sales are not built) and `public_signup_enabled` (3 real people signed up in the last 30 days and no pilot allow-list exists, so enforcing it would lock out the next one: build an invite list first).
- Not covered by the new guards, on purpose: sessions with no signed-in user (migrations, owner scripts, the service role). 7 of 9 older lab and pharmacy proofs could not be re-run against production data (they need the CI seed) and fail identically with and without the migration; they insert as the owner, which the guards do not cover. Re-run them in CI replay.

### OQ-540 update 2 (signup invite list, applied 2026-10-07)
- Migration `20261007231528` is applied. It adds `signup_invites`, a BEFORE INSERT trigger on `auth.users` (GoTrue's role only; migrations, owner scripts and proofs are never gated) and the platform switch `signup_invites_required`, which ships OFF: nothing changes for anyone until an admin switches it on at `/admin/settings/signup-invites` (web app change, live once merged). With it on and `public_signup_enabled` off, a new person needs a phone, email or code invite, a phone a sponsor has paid for, or an admin-API account; people with an account are never affected.
- Known edges: (1) Care Circle supporters, employer cohorts and diaspora sponsors arrive as new people with no invite, so an admin must issue them a code or phone/email invite before the switch is turned on. (2) Anyone already in the sign-up funnel when the switch goes on is refused with a kind message, not a crash. (3) The proof cannot impersonate GoTrue's database role, so it exercises the real trigger through a test setting that can only make the gate stricter; a first real sign-up with the switch ON should be tried by hand once (invited, then uninvited) before relying on it. (4) The enforcing guard `public_signup_enabled` itself is still off and is now the "open to everyone" lever: switching it on opens sign-up regardless of the invite switch.
- Decision needed: when to switch invite-only on, and who issues the first invites.

### Edge functions deployed (2026-10-07), with two things to know
- `send-pending-notifications` (v90), `abnormal-result-handler` (v38) and `paystack-webhook` (v43) are deployed from this branch with the CLI and byte-verified against source; the webhook was smoke-tested (unsigned and forged requests are refused with `invalid_signature`). `verify_jwt` is unchanged (off) on all three.
- The live Paystack bundle had drifted from `main-dev` (it still carried the old Pidgin language list and lacked the Zoom host-key option in shared modules the payment path does not use); deploying from source brought it in line. `speech.ts` now reads empty in the live listing because the source file is types-only. This is the same drift the release-integrity job exists to catch: after merge, confirm that job is green.
- Code review (2026-10-07) found and fixed: admin-created accounts needed `signup_exempt` (six flows); phone invites match only the verified phone; a critical sms hop must end `failed` so the exhausted-ladder alarm fires; the abnormal-result fallback uses the emergency ladder; research export excludes pre-consent data and blanks rare months; the AI review function named the retired Medical Officer tier. A fresh-database rehearsal of the CI replay (188 proofs) is green on the merged tree.
- Production now also carries migrations from other sessions (`f05_retire_medical_officer_tier`) and a ninth guard (`symptom_checker_enabled`), so `s37_go_live_guards` and `s36b` fail against production data by design (they expect a fresh database); they pass on a fresh replay.
### OQ-541 The clinician does not send a prescription to a pharmacy; the patient chooses (raised by S54)
- The S54 brief asked for a clinician "send to nearest partner pharmacy" writing `state = sent`, the pharmacy and the code. The founder decided on 2026-10-07 (S28) that the patient chooses a verified pharmacy herself, S28 moved the code to a patient-only table and stopped writing `prescriptions.collection_code`, and spec 8.16 says clinicians never see which pharmacy earns more. Doing it the brief's way would reverse a same-day founder decision, so it was not built. What the patient gets is the comparison before choosing, and the signed prescription to take anywhere.
- Options: (a) as built (recommended); (b) a clinician "suggest a pharmacy" that only pre-selects it for the patient to confirm (stores a suggestion, never routes); (c) full clinician routing (reverses the S28 decision).
- **Decision (founder, 2026-10-07): option (b), built in S54c.** The care team may suggest a pharmacy after signing; the patient confirms before anything is sent; S28 (patient chooses, code on a patient-only table) and spec 8.16 stay intact. See `docs/design/S54.md` section 6. Follow-ups: OQ-330 to OQ-332.

### OQ-542 No pharmacy can be compared yet, and prices are per pack (raised by S54)
- Live: 4 partners, none active; `pharmacy_medications` has 0 rows. Real prices need a partner rate card entered by an admin. A price is per listed pack; the comparison sums ONE pack of each item and says so ("for one pack of each item"), it does not scale to the quantity written. A pharmacy's "prices last updated" date is the oldest line's. Matching is by the medicine's first word and the exact strength; a strength nobody lists finds nothing rather than a price for another strength.
- Options: (a) as built; (b) add a quantity-aware price (pack size parsing) once real rate cards exist (recommended then).

### OQ-543 main-dev carries the first S28 build, which conflicts with the live S28 (raised by S54)
- main-dev holds #990 (migration `20261006231000_s28_pharmacy_collection` and `20261007112458_s28b_*`); production has the other S28 (`20261007120114_s28_pharmacy_collection_and_dispensing`). Revert #1001 is open; #993 and #1000 follow. S54 is stacked on #993 and its own migration deliberately uses no S28 object (only a trigger on `prescriptions`), so it replays either way. Merge order for S53/S54: #1001 (revert), #993, #1000, then S53, then S54. S54 edits one S28 proof (`s28_pharmacy_collection_and_dispensing.sql`) so its fixture pharmacies carry the new NAFDAC-source attestation.
- Decision: open (lead).

### OQ-544 Pharmacist chat: retention, moderation, attachments (raised by S54)
- Built: text only, 1000 characters, 30 messages a day per thread per patient (an abuse limit, PROPOSED), first name only to the pharmacist, audited reads, no clinician or admin read, nothing in notifications. Not decided: how long threads are kept, who reviews a complaint about a pharmacist's answer, and whether photos are ever allowed (not built; a photo of a pack is a different, riskier thing).
- Options: (a) keep as built and decide retention with the data-protection officer before real use (recommended); (b) add a retention job now (needs a number).

### OQ-314 Delivery schema and screens are hidden, not removed (D5, restates OQ-16 and OQ-272)
- The CHECK stops any new delivery order and the screens are behind `PHARMACY_DELIVERY_ENABLED = false`. `pharmacy_order_delivery_attempts`, `logistics_partners`, the delivery fee column, the courier RPCs, the admin Logistics page and the delivery notification templates remain. A later batch counts, then drops them.

### OQ-315 No price comparison or pharmacist chat on the phone (raised by S54)
- Web only, as with the S28 chooser (OQ-277). The phone shows "collect at X" and fixes dependants' reminders and catch-up.

### OQ-316 Dependants: the server's push and in-app dose reminders still go to the dependant's own account (raised by S54)
- S54 fixes the guardian's phone (local reminders and the catch-up sheet, first name only in the text). The server job that queues push and in-app dose reminders still addresses the person whose medicine it is; a guardian who wants those too needs a rule for which phone reminds (OQ-70's last question).
- Options: (a) leave (recommended until a real guardian asks); (b) also queue to a guardian with the manage grant.

### OQ-317 A possible emergency in a pharmacist chat reaches the patient and the pharmacist, not the care team (raised by S54)
- The patient's own screen shows the emergency steps at once, and the pharmacist sees a "possible emergency" flag on the list and the thread (a deterministic phrase screen, the same list the care messages use; no model). Nothing is raised to the care team because the care team does not read the chat by design. Chat access: the patient herself, or the manager of a DEPENDANT account (a child or an adult dependant) with the pharmacy permission; never a 10 to 17 year old's thread, and never a relative with an ordinary manage grant on an independent adult (a medicine question can be about anything). A caregiver starting a chat without naming a medicine starts it as themselves, and the reply notice goes to the dependant's own account (a dependant with no login does not see it; the guardian finds it on the page). A pharmacy that stops being listed takes no more messages and its pharmacists see nothing.
- Options: (a) as built (recommended; the pharmacist is told to send the person to the emergency steps); (b) also raise a clinician alert from a flagged chat message (needs a decision on who answers a pharmacy's patient).

### OQ-545 Suggestion shows nearness as a tier, not a distance, and no opening hours (raised by S54c)
- The clinician sees "same city" or "same state" as the patient, then name order. There is no kilometre distance because patients have no stored coordinates (only city and state text), and no "open or closed" because nothing in the database records opening hours (`pharmacy_partners` and `pharmacy_partner_locations` carry none). Both were asked for in the brief; neither can be shown truthfully today.
- Options: (a) as built (recommended until real data exists); (b) add opening hours to branches (partner self-service, like availability) and an optional patient location (an explicit consent question, since it is personal data); (c) both.
- Decision: open (founder).

### OQ-546 The suggestion appears on the web chooser, not on the phone (raised by S54c)
- The phone has no pharmacy chooser at all (OQ-277, OQ-315), so there is nothing to put the suggestion into. The patient still gets the generic in-app notice (it names nothing) and the web page shows "Your care team suggests X". Nothing depends on the notice. Adding the phone chooser would carry this with it.
- Decision: open (founder), together with OQ-277.

### OQ-547 A suggestion expires after a configured window, and only the patient can answer it (raised by S54c)
- A pending suggestion stays until the patient accepts, declines or chooses elsewhere, the clinician withdraws it, the prescription is cancelled or dispensed, or it EXPIRES: `suggestion_valid_days` (PROPOSED, 14, versioned in `pharmacy_config` v2 and mirrored as `pharmacy.collection_rules` v2; CMO and pharmacy lead to set the number). An expired one cannot be accepted, the patient no longer sees it, the clinician sees it as expired and may suggest again (the patient is told again). There is still no chase. Acting-for: S28's `patient_choose_pharmacy` was read and matches only `patient_id = auth.uid()` (no supporter, guardian or care-circle rule at all; only the price comparison allows a `manage_pharmacy` grant holder), so the suggestion mirrors it exactly and is never wider: an authorised supporter cannot see or answer it, and a dependant's account takes none, because S28 truly cannot confirm for them. Widening both together (the chooser and the suggestion) is the real decision. A pharmacy that stops being listable disappears from the patient's card and cannot be accepted (the clinician sees it as unavailable). A dependant's account (nobody who can log in) takes no suggestion at all, and the clinician panel says so. The new table keeps `ON DELETE RESTRICT` on the patient and clinician profiles like its S28 sibling, so the erasure and retention routine (release blockers) must cover `prescription_pharmacy_suggestions`.
- Options: (a) as built (recommended); (b) change the number of days; (c) widen S28's chooser, and with it the suggestion, to a dependant's manager as for pharmacist chat (OQ-317), with its own proof.
- Decision: open (founder).
### OQ-S65-1 Directory: S36g said a listing is never hidden; S65 now hides stale ones from patient search (CMO decision Q21, 2026-10-07)
- **Changed on purpose**: `directory_search` leaves out a listing whose last verification (or creation date, if never verified) is older than TWICE its cadence: emergency-capable hospitals and 24-hour pharmacies 90 days, clinics and labs 180, everything else 365 (so hidden at 180, 360 and 730). Nothing is deleted, deactivated or suspended; staff still see it in Directory freshness; one verification brings it back. The S36g sweep itself is unchanged.
- **Still unsigned**: the intervals are [U] and PROPOSED (`directory.access_rules`). Owner to sign: CMO or founder.
- **Also reverses, behind a guard seeded OFF (`directory_enabled`)**: the 2026-08-03 founder decision that no facility is shown to patients. Nothing patient-facing reads the directory until a person switches the guard on. The existing facility selector used by lab and booking-request flows is not changed.
- **Side effect to know**: with the guard on, the 9 existing seed facilities (none verified) are shown as "Not yet verified" until they age out. Someone should phone-verify or deactivate them first.
- Decision: pending (sign the cadence; name the verification owner; decide whether to build a Health Facility Registry importer after asking the registry owners).

### OQ-S65-2 Ratings: encounters are not accepted as proof of a visit
- Q22 says a rating needs an encounter or order. An `encounters` row has no facility, so there is nothing to tie it to a facility. Accepted proofs are a lab order that reached `resulted` at a branch of the facility's lab provider, or a facility booking a staff member marked `completed`. Confirm this reading, or say how a consultation should map to a facility.
- Moderation target is 72 hours (PROPOSED, in `directory.access_rules`). Who moderates: any holder of `partners.facilities.manage`. The facility reply is recorded by staff for now; a signed-in facility portal does not exist.
- A comment containing a hold term (doctor, diagnosis, prescription and similar) is held and can only be published without the comment or rejected. The term list is PROPOSED and over-triggers by design.
- Decision: pending.

### OQ-S65-3 Care Circle one-tap alert: location is shown after sign-in, not inside the push or email
- The spec says "push and email, with location". INV-07 forbids naming a reading or condition and nothing allows a location in a notification, so the push and email say only that someone has asked for you. A supporter with `red_alerts` sees the location by signing in; that read is written to the care access log; the location is deleted after 24 hours. Location is stored only on the patient's own tap with consent on; coordinates sent without consent are discarded and the alert still goes.
- Consent text (`circle.help.consent.text`) needs counsel or founder sign-off before the guard `care_circle_help_alert_enabled` is switched on. Whether a supporter can be reached who has no signed-in account is not built (supporters need an account).
- Decision: pending.

### OQ-S65-4 Emergency pack: draft, no numbers, no facilities yet (CMO decisions Q17, Q18)
- The pack is a DRAFT (`signed` null). The app shows only the fixed first line ("Go to the nearest hospital now.") and the facilities list until the CMO signs; the step cards appear only once signed. Lassa and malaria sign lists are [U] drafts (the spec names them without listing signs).
- No telephone number appears anywhere in the pack (a table check and a test refuse 112, 767, 199, 911 and any digit run that looks like a number); a facility entry carries no phone either.
- All 37 state entries are an explicit "none listed". No facility was fabricated. Real entries need a person to verify an emergency-capable hospital per state; the Health Facility Registry import is a documented follow-up (no verified public API was found).
- Decision: pending (CMO signature; who verifies the first hospitals).

### OQ-S65-5 HMO and NHIA acceptance have no authoritative partner list yet
- `facilities.accepts_hmo` and `nhia` are the facility's claim and are shown as "claimed". A listing shows "confirmed" only after staff record a confirmation from the HMO's own provider list (`confirm_facility_hmo`) or set `nhia_confirmed_at`. No such list exists in the platform today, so every flag starts as claimed.
- Decision: pending.
### OQ-548 Journey aggregate figures cannot be tested over 300 people while test data is always is_test (raised by S85)
- Every aggregate in the platform (S38e sponsor report, S38f staff figures, the BP control report) excludes `is_test` members (INV-13). The rule for S85 is that test data is always `is_test`. So a real figure (rates, counts) over a 300 person cohort cannot be produced from test data; the journey asserts the exclusion and the small cell withholding, and records the "figure over 300" step as skipped.
- Options: (a) accept this and keep the figure maths proved by the existing S38 proofs (recommended); (b) allow a rolled-back transaction fixture with non-test rows inside one DB proof, never committed; (c) a test-only aggregate path that includes test rows. Needs a founder decision because (b) and (c) bend the is_test rule.
- Decision: open.
### OQ-549 An untied clinician can read reproductive and mental health rows for a whole organisation (raised by S85, journey 4)
- On main-dev, a real clinician session with no task, lead assignment or page reads `menstrual_cycles`, `mental_health_screens` and `wellbeing_checkins` for every patient in the organisation (300 rows each in the journey fixture). `vitals_readings`, `symptoms`, `lab_results`, `menstrual_daily_logs`, `reproductive_health_profiles`, `patient_pregnancy` and `contraception_plans` were correctly empty. INV-12 says a clinician sees only tied patients.
- S39b (PR 997, tied staff reads, 128 tables) is the planned fix and is not on main-dev. Journey 4 holds this as `pending(S39b)` only while the leak is exactly those three tables; a new leaked table fails the journey, and a table that stops leaking fails it until the list is shrunk.
- Decision: pending (merge S39b).
### OQ-550 The web app has no offline emergency guidance (raised by S85, journey 2)
- INV-06 is met on the phone (bundled rules, on-device red). On the web, with the network off, the vitals form only refuses to save and says so; no emergency guidance is shown and `offline.html` has none. Journey 2 records `guidance-with-network-off-web` as pending. Options: add static emergency text to the offline page and the service worker (recommended), or declare INV-06 phone only in the spec.
- Related finding: the phone's bundled fallback rules are `BP_CARE_V1` while the database holds v3; the journey asserts the device grade is never weaker than the server grade on the same facts.
- Decision: open.
### OQ-551 The approved bp_care_triage v3 names no follow-up task for a red reading (raised by S85, journey 2)
- With v3 approved (test fixture, local database only), a 190/120 reading with severe headache grades red (BP-R1) with actions show_emergency_guidance and page_on_call only. No follow-up task is created and the page's own class 1 task is cancelled on acknowledgement. The journey's "follow-up task" and "next day follow-up consultation" steps are pending (S64). The CMO may want a follow-up task action on BP-R1.
- Decision: open (CMO).
### OQ-552 Checkout is dormant on a fresh database, and the plan's "seed.sql does not exist" is a path error (raised by S85)
- `catalog_items.membership_annual` is inactive on a fresh stack, so journey 1 cannot create an order and records it as pending. Separately `supabase/seed/seed.sql` exists (the config path); the README and the CI path filter named `supabase/seed.sql`, which never existed. Both docs and the filter are corrected in this PR.
- Decision: informational.

## S66: menstrual and reproductive, private cycle section (raised 2026-10-07)
Numbering: the last number used on another branch was OQ-327; S66 starts at OQ-330 (check for clashes when merging).

### OQ-553 Sealed cycle data is never destroyed, and deletion on request sits beside "do not erase real data"
- Conflict: decision C/B3 (patient-entered tracker data deletable on request, clinician-recorded data sealed 8 years then destroyed) versus the founder direction recorded with S39c (`real_data_auto_delete` false, do not erase real data).
- Built: deletion is on request only, after a 14 day grace window (PROPOSED), with a counts-only receipt in `audit_log`. The destruction of SEALED data after the retention period is configuration only; no job exists.
- Options: (a) keep as built and decide the destruction job later with counsel; (b) build the job now behind a switch. Recommend (a). Counsel to confirm the 8 years.

### OQ-554 The new go-live guard cannot be switched on yet
- `reproductive_content_enabled` was added OFF. `private.go_live_conditions` has no branch for it, so it reads "unknown guard, never satisfied". The function is replaced wholesale by every session that adds a guard (S37, S37b, S28c) and S67 to S69 are adding theirs, so replacing it from this base would drop another session's branch.
- Options: (a) one later migration adds all new branches after S66 to S69 merge; (b) each session replaces it in merge order. Recommend (a). Needs: the CMO content-review condition (an attestation) for this guard.

### OQ-555 Other reproductive tables are still read directly by staff, unaudited
- The clinician Women's Health tab still reads `patient_pregnancy`, `antenatal_visits`, `postnatal_profiles`, `breast_symptom_reports` and `fertility_assessment_requests` straight from the tables (INV-10 gap). S66 moved only cycle and menopause rows to the audited function. Pregnancy and postnatal belong to S67 and S68. Recommend: those sessions extend `read_reproductive_pattern_report_audited` or add siblings that call `private.reproductive_staff_tied`.

### OQ-556 PIN lock limits (founder to confirm the threat model)
- The PIN guards a VIEW on the device. Server data is not behind it: someone holding an unlocked, signed-in session can still call the API. Web has PIN only (no WebAuthn biometric). A person with browser developer tools can clear the local record. Mobile lock not run on a real device. Confirm this is the intended protection (shared phone and over-the-shoulder), not protection against a device thief.

### OQ-557 Discreet naming beyond notifications
- Notification text, the dashboard tile ("Your tracker") and the locked screen are neutral. The page title "Your cycle", the sidebar "Women's Health", the Prevention card "Your cycle & life stage", the in-app link target `/patient/cycle` and the template keys `cycle_period_*` still name the topic. Decide whether to rename them or accept them.

### OQ-558 Clinician report reason is a fixed phrase
- `read_reproductive_pattern_report_audited` requires a reason of 10 or more characters (the S05f pattern). The Women's Health tab sends a fixed phrase because S39c's direction is "no reason to type". Confirm the function should drop the reason argument.

### OQ-559 Danger-sign, contraception and menopause wording are proposed copy
- All strings in `packages/i18n/src/cycle-copy.ts` (`CYCLE_COPY_REVIEW`, status `pending_cmo_review`), including the danger-sign thresholds ("every hour for several hours"), need CMO review; each [verify] in the CMO pack still has to be checked against its source.

### OQ-560 Live policy drift under the new functions
- Live RLS on the cycle tables uses `private.staff_may_read/write` (S39b, S39g) which `origin/main-dev` does not contain. S66 replaces no policy, so it works on both, but re-run the three S66 proofs after S39b to S39h merge.
## S68: postnatal and child (Module 16, 3 of 3) (raised 2026-10-07)
### OQ-561 Which pieces of S68 run only after the CMO signs (raised by S68)
- Everything below is PROPOSED config in `maternal_child_config` and `packages/shared/src/proposed-config/registry.ts` (keys `maternal_child.*`), mirrored by `maternal-child-mirror.test.ts`. Nothing is signed. `maternal_enabled` stays OFF. Until it is on: a real child's malnutrition class is stored but raises no alert and pages nobody (the screen says follow-up is not switched on and to message the care team), the feed log and the lifecycle functions refuse a real person with "not open yet". Test accounts pass (S37 rule).
- Decision: open (CMO signs the A6/A7 values; the founder or CMO flips the guard).
### OQ-562 MUAC age range and the 12 hour "same-day" line (raised by S68)
- Pack A7 says "MUAC under 115 mm" with no age range. WHO/UNICEF use 115 and 125 mm for 6 to 59 months; under 6 months MUAC is not a screening tool. The config applies MUAC from 6 to under 60 months (`muac_min_age_months`, `muac_max_age_months`) and treats weight-for-height z as the only rule below 6 months. "Same-day referral" is set as 12 hours (`sam_review_within_hours`). Both are proposals.
- Decision: open (CMO).
### OQ-563 WHO LMS source and licence (raised by S68; CMO pack question 5)
- Data comes from the published WHO workbooks (URLs in each row's `source_url` and in the generator). The licence terms for redistributing them inside a product were not checked. Golden tests use the `anthro` package (a third-party port) for 0 to 5 years and an independent calculation from the WHO 2007 workbooks for 5 to 19 years.
- Decision: open (CMO and counsel).
### OQ-564 Plausibility ranges for head circumference and MUAC (raised by S68)
- Weight-for-age (-6/+5), height-for-age (-6/+6), weight-for-height and BMI-for-age (-5/+5) follow the WHO Anthro documentation. Head circumference and MUAC-for-age use -5/+5 as an assumption. A flagged row is kept and still routed.
- Decision: open (CMO).
### OQ-565 EPDS cut-offs and the Nigerian validation range (raised by S68; pack A6)
- 10 and 13 (review within a week, within 48 hours) are provisional. Nigerian studies are said to report 7 to 12 depending on language and period (not re-verified). Local audit after the first 200 screens, then adjust.
- Decision: open (CMO).
### OQ-566 When to prompt the EPDS (raised by S68)
- `postnatal.checks.epds_prompt_windows` = week 6 is a proposal. The existing app opt-in (perinatal self-identification) is unchanged.
- Decision: open (CMO).
### OQ-567 Lifecycle stages, the loss path and its copy (raised by S68; founder items 8)
- Stage names, transitions, the 90 day baby-content hold and the 400 day look-back are proposals (`lifecycle.rules`). The loss wording is a placeholder (`mch.life.loss_note`, `maternal_child_content.loss.gentle_path`); the founder or CMO writes it. The stage history keeps the fact that a confirmed loss event happened (no note) even after the note is deleted: confirm that is acceptable.
- Decision: open (founder, CMO).
### OQ-568 NDPA wording for sealed clinician data (raised by S68; pack B3)
- Sealed for 8 years then destroyed is a proposal; counsel to confirm the period and the carve-out wording. Sealed means: clinician-recorded rows, a growth row that raised a nutrition alert or a trajectory alert, a baby check linked to an appointment.
- Decision: open (counsel).
### OQ-569 Deleting the loss note but not the stage fact (raised by S68)
- `lifecycle_events` is append-only, so a deleted loss note leaves an event row `pregnancy_loss_recorded` with no note. A person who wants even that gone has no path. Options: (a) accept (recommended, it is the audit of a state change); (b) allow a redaction function that nulls the kind to a neutral value.
- Decision: open.
### OQ-570 Nothing schedules the deletion sweep (raised by S68)
- `public.sweep_due_tracker_deletions()` (service role) exists and is not scheduled. Today a person completes their own deletion after the window. A cron entry needs the Vercel cron limit / pg_cron decision.
- Decision: open.
### OQ-571 NPHCDA schedule reconciliation not possible from the official source (raised by S68; pack A8)
- The NPHCDA site (nphcda.gov.ng) was fetched and searched; no schedule table or document was reachable. The catalogue (`vaccination_catalog`, `child_*`, migration `20260723200847`) was therefore NOT edited. Points to check against the agency's current schedule document: (1) malaria vaccine (R21): press says 4 doses at 5, 6, 7 and about 15 months where phased in; the catalogue has no malaria row; (2) IPV: press says a second dose was added in 2021 at 14 weeks; the catalogue has one dose; (3) rotavirus doses, measles second dose at 15 months, MenA (and any newer meningococcal product), vitamin A, HPV single dose age. Reminders stay generic (INV-07) and no wording advises delaying a dose.
- Decision: open (CMO or the immunisation lead supplies the schedule document).
### OQ-572 `sponsor_care_report.last_clinical_review` can reflect a maternal or child alert date (raised by S68)
- The function returns the latest date a clinician acknowledged ANY alert for the beneficiary. A review of a child growth alert or a postnatal wellbeing alert would move that date. It discloses no value, only that a review happened, but it can hint. Options: (a) accept; (b) exclude alerts whose title starts "Child growth check" or "Postnatal wellbeing" (a title match is brittle); (c) add an alert category column (a wider change).
- Decision: open.
### OQ-362 Staff reads of the new tables use `is_org_staff` today (raised by S68)
- Until S39b (tied staff reads, #997) lands, any staff member of the organisation can read the S68 tables through `private.maternal_staff_may_read`, which is one function. S39b must register the nine new tables (growth columns, baby checks, feed log, lifecycle, loss records, deletion receipts) in `staff_read_scope` as tied and change that one function.
- Decision: open (S39b follow-up).
### OQ-363 Real-clinician paging for severe acute malnutrition does not use the S19 on-call page (raised by S68; INV-05)
- The severe route uses the existing alert and `enqueue_critical_notification` loop (as the red-flag symptom handler does), not `create_red_page`, because that function takes a triage event from a BP rule set. A child nutrition triage rule set would be needed to feed the on-call page and its escalation timer.
- Decision: open (CMO, S11/S19 owners).
## S61/S62 open questions (2026-10-07; numbers are duplicated in this file, cite by title)
- **S61/S62 hypo band tier**: the legacy web and mobile glucose classifiers call 3.0 to 3.9 mmol/L without a danger event "urgent" (writes an urgent clinician alert on paid plans). Decision Q5 says amber with a 15 g message and a `hypo_follow_up` task. The new `diabetes_care_triage` rule set follows Q5; the legacy classifier is unchanged so live behaviour does not move before the CMO signs. Decide when the legacy path is retired in favour of the signed rule set.
- **S61/S62 Q6 on the live Free-plan path**: the pack recommends a life-threatening reading pages on call for every plan. This PR delivers it through the rule set (a draft grades as shadow; an approved one pages for every plan). It does not change `assess-glucose.ts`'s Free-plan behaviour. Needs the CMO signature on `diabetes_care_triage` and on-call cover (`on_call_cover_ok` blocks nothing today).
- **S61/S62 start at step 2**: the pack says start at step 2 (amlodipine plus losartan) when baseline is 160/100 to 179/109. The proposal format is one medicine per signed change, so the draft table starts everyone at step 1 and adds losartan next. Needs a multi-item proposal format or a CMO decision to accept the slower start.
- **S61/S62 pathway guards block real enrolment**: hypertension, diabetes and obesity programmes are active live with 0 enrolments; the new guard refuses real patients (including purchases) until the CMO switches `pathway_<code>` on. Confirm that is intended before applying.
- **S61/S62 glucose event entry**: `vitals_readings.glucose_events` exists and the classifiers read it, but no log form (web or mobile) lets a patient tick the events yet. Needs wording (CMO) and a screen.
- **S61/S62 glucose grading handler**: the pathway rule set is not yet run by an edge-function handler on glucose readings (the BP handler is the template). Until it is, the rule set is exercised by tests and the DB proof only.
- **S61/S62 non-BP outcome snapshots**: `outcome_snapshots` columns are BP-shaped; the check now allows other pathway codes but a writer needs generic metric columns first.
- **S61/S62 CKD fall rule**: Q12 says a fall over 20% or 5 mL/min "sustained" in a year; the rule fires on either, measured from the highest earlier value in the window, without a repeat-test confirmation. CMO to say whether a confirming second result is required.
- **S61/S62 scheduling**: `sweep_pathway_reviews` and `sweep_pathway_scheduled_tests` are not scheduled (no cron added). Decide the schedule with the other sweeps.
- **S61/S62 wrapped S37 functions**: `go_live_conditions` and `attest_go_live_condition` were renamed `_base` and wrapped. Any later migration that re-creates either in full drops the pathway branch; the proof asserts the wrapper.
## S64 (consultations gaps, 2026-10-07)

Numbered `OQ-S64-n` because the file already repeats several plain OQ numbers; cite by title as well.

### OQ-S64-1 Price of a dietitian visit and a pharmacist visit (raised by S64)
- CMO Q23 decided these are priced per item, but no price was given. `dietitian_consult_credit` and `pharmacist_consult_credit` are seeded INACTIVE at 0 kobo. While inactive or unpriced the database refuses to hold a slot for either and lists none, and the booking picker does not offer them. Nothing is assumed.
- Needed: a price for each (integer kobo), then activate both rows. Specialist bookings priced per item (also Q23) have no product or booking flow yet; that belongs to S65's directory half.
- Decision: open (founder).

### OQ-S64-2 How a dietitian or pharmacist is tiered and what they may read (raised by S64)
- `clinical_staff.care_role` lets an admin onboard a dietitian or pharmacist, but the schema only offers doctor tiers. A CHECK forces a non-doctor role onto the `care_coordinator` tier so auto-assignment, prescribing and signing can never reach them. That tier is also non-clinical for chart reads, so a dietitian cannot yet see a patient's chart before a visit beyond what a tie or task grants (INV-12).
- Options: (a) keep as built and grant the visit's own encounter notes and intake only (recommended), (b) a separate allied-health tier with its own read scope, which needs a CMO decision on what they may see.
- Decision: open (CMO).

### OQ-S64-3 Free-text intake is not screened for danger (raised by S64)
- The manual intake takes the patient's own words. Nothing reads them for red flags (INV-01 allows only deterministic rules and none exists for free text here). The screen carries the standing "do not wait for your visit, go to the nearest hospital now" line instead, and the intake is read before the visit, not instead of triage. If the CMO wants deterministic keyword screening of the text, it needs a signed rule set first.
- Decision: open (CMO).

### OQ-S64-4 The older video-visit request path promises a full refund in cash (raised by S64)
- `book-video-visit.tsx` (the `video_visit_requests` path S21 did not touch, OQ-132) still says "If nobody can take it, you get a full refund", and the unused string `refund.policy.consultation_cancel` says "Full refund if cancelled...". Both read as cash, which OQ-133 leaves undecided. S64 added the credit-based terms card to that path but did not rewrite its own copy (it is a different mechanism: a payment held before a doctor accepts).
- Decision: open (founder), tied to OQ-133 and OQ-132.

### OQ-S64-5 Re-check of a licence (Q19) is displayed, not scheduled (raised by S64)
- Q19: re-check at onboarding, annually, and on complaint. The booking list shows the number and checked-on date only when `credential_verified_at` is on record, so a clinician with no check shows no number. There is still no job that flags a check older than a year or a complaint-triggered re-check; `license_expires_at` tracking (2026-08-27) covers expiry only.
- Decision: open (CMO; a small follow-up job once the interval is signed).

### OQ-S64-6 Scribe safety panel does not read the patient's recorded allergies and medicines (raised by S64)
- The panel shows the allergy and medicine lines found in the AI draft first and requires one confirmation before signing. It does not display the patient's recorded allergy and medication lists beside them, so the clinician compares from the chart view. Showing both side by side needs an audited chart read inside the note editor.
- Decision: open (build when the audited-read hook for the editor exists).

### OQ-S64-7 Mobile (raised by S64)
- Nothing in S64 was built or run in the Expo app: no booking filters, intake form or terms card on the phone. The consultation room on the phone is still unrun on a real device (OQ-158). The audio and phone fallback logic is covered by unit tests only.
- Decision: open.
### OQ-573 Where the CMO signs a language registry change (raised by S86)
The S86 gate refuses to enable a language unless the registry (`i18n.language_registry`) carries a native review and, for clinical features, a CMO signature fingerprinting the exact text. No screen or RPC exists for the CMO to produce or publish that, and none is needed while English is the only language (D-14). Before any language returns, decide: add it to `/clinician/clinical-signoff` (the hub that already signs triage and risk sets) or keep it a reviewed pull request. Also decide who the native reviewer is per language. Not built; recommended: the sign-off hub, with the hash computed server side.
### OQ-309 The Paystack webhook still has a refund branch for a retired Platform Credit charge (raised by S87)
- Blocks: nothing. `supabase/functions/paystack-webhook/handler.ts` (around line 756) handles `metadata.kind = "platform_credit_topup"` by refunding and reconciling. Platform Credit was removed from the schema on 2026-09-30 (0 balances, 0 ledger entries, 0 top-ups), so the branch can only fire for a charge started before removal.
- Options: (a) keep the branch for 30 days as a safety net, then delete it; (b) delete it now.
- Recommend (a), then delete and remove the Part C allowlist entry. Deploy order: code first, nothing in the schema depends on it.
- Decision: pending.

### OQ-574 Employer roster invitations can be sent by SMS (raised by S87)
- Blocks: nothing. `dashboard/corporate/roster-manager.tsx` offers an "SMS" invitation channel for roster members. It is not a verification code or clinician paging, so it is outside the SMS rule (OQ-05, D3 draft of 2026-10-07).
- Options: (a) remove the SMS channel and invite by email or a link the employer shares; (b) keep as a named exception.
- Recommend (a). Decision: pending, with D3.
- **Decision (founder, 2026-10-07, D3): remove it.** Done in code (S85-D3): the "Invite by SMS" button is gone, the hook only accepts `email`, and a member with only a phone number sees "share your organisation code". The database function `employer_invite_roster_member` still accepts `'sms'` as a channel label (it only issues a token and sends nothing); narrowing it is a later schema change after this code is deployed (OQ-331).

### OQ-575 Part C.2 says clinicians are freelance only; the platform allows employed doctors (raised by S87)
- Blocks: nothing. The code models `employment_type` (employed or contracted) and four earnings screens say "paid by salary". The founder decision of 2026-09-30 allows employed doctors (pushed tasks) next to freelancers (pull from the pool).
- Decision (founder, 2026-10-07): update the spec row to match; keep the code. The spec file itself is never edited, so the change is recorded here and in `docs/DECISIONS.md` (S87-1) and the Part C audit treats this row as resolved.

### OQ-576 Dormant schema that Part C mentions, found live on 2026-10-07 (raised by S87)
- Counted live: `subscription_plans` 13 rows, `subscriptions` 0, `subscription_add_ons` 0, `logistics_partners` 1, `wellness_points_balances` 2 (points, not money). The `payment_provider` enum still holds `wallet` and `stripe` labels. `commission_type.delivery`, `pharmacy_refund_reason.delivery_failed` and `medication_access_barrier_reason.delivery_unavailable` remain after OQ-261.
- Options: (a) leave as dormant history; (b) one removal migration per removal-pattern in CLAUDE.md (count rows, delete enum values, assertion block, proof, then code first).
- Recommend (b) for the enum labels (zero rows) and the subscription tables, after OQ-97's code removal. Decision: pending.
- Not yet verified in S87: employer or institution reporting never exposes reproductive, pregnancy or mental health data (C.1); the scribe patient summary is never patient-visible without a clinician signature (INV-11); `escalation_slas` v8 still names a WhatsApp hop (OQ-198's ladder, normalised to email at read time).
### OQ-320 Partner cost and refund margin columns are still readable by the patient and org staff (raised by Track E)
- `lab_orders.partner_cost_kobo/_provider_id/_breakdown`, `pharmacy_orders.partner_cost_*`, `lab_order_refunds.margin_portion_kobo` and `pharmacy_order_refunds.margin_portion_kobo` are readable by the ordering patient and by any org staff (`is_org_staff`, which admits the clinician role). Live row counts today: 0 in all four tables, so nothing has leaked. Not fixed in the Track E migration because these tables are read with `select("*")` and embeds in many places.
- Options: (a) same column-grant plus owner-run view treatment as Track E, after a client sweep (recommended, as the next track, before the first partner order); (b) move the cost columns to a finance-only side table.
- Decision: open.

### OQ-321 Old installed mobile builds break on two reads when the Track E migration is applied (raised by Track E)
- Builds that predate this PR call `select("*")` on `panel_bundles` (lab booking lists) and `therapy_sessions` (therapy list); after the migration those two reads return a permission error until the app receives the JS update (OTA, no native change).
- Options: (a) publish the OTA first and apply the migration after adoption (recommended); (b) apply now and accept a short gap; both are the lead's call.
- Decision: open.

### OQ-322 Track E ships on top of the unapplied S53 pre-fix (raised by Track E)
- The same exposure on `pharmacy_medications` and the `commissions` ledger is fixed by migration `20261007002834` on branch `s53/medicines-schedule-adherence`, not yet applied live. Track E does not depend on it, but until both are live a patient can still read pharmacy commissions and a clinician can read the ledger.
- Decision: open (apply order is the lead's).
### OQ-577 Partner invoice totals are readable by care-team staff, clinicians included (raised by Track G)
- `partner_statements`, `partner_statement_lines`, `pharmacy_partner_statements` and `pharmacy_partner_statement_lines` carry what a laboratory or pharmacy invoices Tarragon (`invoiced_total_kobo`, `expected_total_kobo`, per-line `expected_kobo`, the partner's cost per test). Their only policy is `private.is_org_staff`, so any clinician or care coordinator in the org can read and write them, and `match_partner_statement` / `match_pharmacy_partner_statement` / `approve_*_statement` are open to the same people. This is how the 2026-08-21 migration and `apps/web/src/lib/finance/partner-statement-access.ts` were designed (recording what a lab delivered is a care-team operations job, the finance role is deliberately excluded). No patient or caregiver path; 0 rows live. Track G did NOT change it because it would break that designed workflow.
- Options: (a) leave it (care-team operations own partner invoices); (b) restrict read and write to admin plus a permission (for example `finance.vendors.manage`, which `approve_partner_statement` already requires on the write side) and move the recording screen to finance; (c) keep read for operations but hide the cost columns from clinicians with a column grant plus a view for finance.
- Decision: open. Recommendation (b) or (c) before the first real partner invoice, because a clinician reading what a laboratory charges is the same class of exposure Track G just closed on orders.

### OQ-578 Refund policy flags and notes are readable by every signed-in user (raised by Track G)
- `lab_refund_policies` and `pharmacy_refund_policies` have `select using (true)`: `partner_still_owed` (true means Tarragon keeps paying the partner on that refund reason, so the refund is Tarragon's loss) and a free-text `note`. No amount, so not fixed here.
- Options: (a) leave (policy, not a figure); (b) restrict to staff and admin. Decision: open, low priority.

### OQ-579 A patient can read the staff note on their own refund (raised by Track G)
- `lab_order_refunds.detail` and `pharmacy_order_refunds.detail` are free text typed by staff in `request_*_order_refund(p_detail)` and are readable by the order's patient through `*_patient_select`. A careless note ("we lose 40% on this") would reach the patient. Not a figure column, so not withheld.
- Options: (a) add `detail` to the withheld list and expose a separate patient-facing reason; (b) a UI warning to staff. Decision: open.

### OQ-580 Refunds can be raised and approved by any care-team user, including a clinician (raised by Track G)
- `request_lab_order_refund`, `request_pharmacy_order_refund`, `approve_lab_order_refund` and `approve_pharmacy_order_refund` check only `private.is_org_staff`, so a clinician or care coordinator can raise and approve a refund and post the journal entry. Track G only stops them seeing the cost split in the response. No client calls these functions today (0 rows, no UI). Whether refunds should need finance authority is a controls decision. Related: the cost split is returned to admin and to any `commissions.view` holder, so that permission must stay with finance and admin.
- Options: (a) add `finance.gl.post` or `finance.approvals.manage` to the approve functions and keep request for staff; (b) admin only. Decision: open, before a refund UI is built.

### OQ-581 Any migration that adds a column to the four cost tables must also grant it (raised by Track G)
- After Track G, `lab_orders`, `pharmacy_orders`, `lab_order_refunds` and `pharmacy_order_refunds` have column-level SELECT. A column added later is unreadable until granted (the safe default). The first draft of the migration missed `pharmacy_orders.is_test` (added by S28d, file `20261007141932`) because it carried an earlier stamp; the final file is stamped after the newest live version. The standing proof `g_partner_cost_columns_not_readable.sql` fails CI if any later migration adds a column without a grant.
- Options: (a) rely on the proof (current); (b) a DDL event trigger that auto-grants new columns on these tables. Decision: open, (a) is in place.

### OQ-582 Old web tabs lose two duplicate checks silently until reloaded (raised by Track G)
- An open tab from before the web deploy still calls `select *` on `lab_orders`; after the migration that returns a permission error. The lab and pharmacy lists show the error state (`listQueryState`), but the old clinician order form's duplicate-test warning and the old patient health-check booking's "already open" check treated an error as "no orders". The new code shows an alert instead. Old mobile builds are unaffected (they name their columns). Apply the migration after the web deploy and accept that a tab open across the deploy needs a reload.
- Decision: open (lead's call on timing), no action needed beyond the apply order.
### OQ-INT-01 One emitter for lesson.completed and course.completed (found while stacking S55 on main-dev, 2026-10-07)
- S33 (on main-dev) registers `lesson.completed` and `course.completed` with required keys `course_code`, `lesson_code`, `lesson_count` and emits them from `health_education_progress` for course lessons (completed means the teach-back was answered: `understood` or `needs_review`). S55 had registered the same two event types with other keys (`content_id`, `content_code`, `programme_id`, `programme_code`) and its own trigger, so every lesson would have failed the registered required-keys check, and S55's payload carried a content code that names a topic, which S33 deliberately avoids.
- Resolved in the stack: S55 relies on S33's emitter and carries no second one (its unapplied migrations no longer register or emit the events); the S55 proof asserts S33's payload contract. S58 rewards award from the same event, and S58b's `bp_ten_day_micro` drafts no longer share the code `bp_care_course` with S33's 14-lesson course.
- Not carried over, for a decision: S55's version wrote an audit row and opened ONE incident when an event write failed and never lost the patient's progress. S33's trigger has no such wrapper, so a failed event write raises and the progress insert fails. Decide whether S33's emitter should become best-effort with an incident (sev2 through `private.page_incident_sev`, added in S58b).
- Decision: pending.
### OQ-370 Device capabilities need the CMO and an admin before anything switches on (raised by S70a)
- Everything S70a built is off. Unsigned and PROPOSED: all numbers in `devices.plausibility`, `devices.dedupe`, `devices.cgm_events`, `devices.ecg_alert`, the two task types (class, due time, tier), the patient and safety wording, and "one working day" approximated as 1440 minutes.
- Decision: pending the CMO (read the primary guideline text; the pack's evidence is secondary).

### OQ-371 Go-live uses `platform_modules`, not `go_live_guards` (raised by S70a)
- A `go_live_guards` row needs a branch in `private.go_live_conditions()`, a function every parallel session edits; a second `create or replace` would silently drop the other's branch. Seven `platform_modules` rows were used. Decide whether to move them to guards once S66 to S69 have merged.

### OQ-372 The wearable Connect card is ungated (raised by S70a)
- Spec asks for a per-connector flag. The card has been live since 2026-07-31; gating it would switch off a working feature, so it was not done. New connectors (S70b) should be born gated.

### OQ-373 An extreme typed value above the typed limit (raised by S70a)
- OQ-66 keeps manual limits at 60-260 / 30-160. With the hold on, a DEVICE or photo 270/130 is now saved and triaged, but a typed 270/130 is still refused on the phone. Decide whether typed entry should follow with a confirm step (OQ-66 option b).

### OQ-374 A patient who insists an impossible number is real (raised by S70a)
- `resolve_held_reading` allows `confirmed_as_shown`, which records the answer but still does not save or triage the value. Decide what a care team should see (a task? a device-fault report?). Today a held value is visible only to the person.

### OQ-375 Photo and ECG recognition need a native build (raised by S70a)
- No on-device text recogniser and no real-device test exist. Adding one needs a native module, a fresh EAS build and a `runtimeVersion` bump (now `0.1.0-native5`). The HealthKit ECG read adds an authorisation type and has never run on hardware. Which package is for the founder.

### OQ-376 De-duplication side effects to review (raised by S70a)
- A sensor sample within 5 minutes and 0.3 mmol/L of a finger-prick, in the same triage band, is linked instead of stored (one gap in a CGM trace). A better source arriving later replaces the row in place, so the row's `taken_at` becomes the better source's. Pregnant BP is never merged. Confirm both are acceptable.

### OQ-377 Source badge coverage (raised by S70a)
- The badge is on the web readings list and the phone BP history. Other phone lists (glucose, weight) and the clinician readings views were not found to list per-reading sources; check before calling "every UI" done.

### OQ-583 BP-P1 routes every pregnant reading, wider than the wording of decision A1 (raised by S67)
- CMO selection A1 says "any BP at or above 140/90 in pregnancy: amber, clinician same day". Rule BP-P1 (unchanged since S11) grades EVERY pregnant reading amber and opens a `referral_review` task (de-duplicated to one a week, due in 24 hours), so 118/76 is also amber and a 24 hour task is not "same day". Rule set v4 keeps this as it is and the tests record it (139/89 is amber by BP-P1).
- Options: (a) keep, one weekly review task for every pregnant patient (recommended until the CMO signs, it never under-calls); (b) make BP-P1 fire only at 140/90 or more and make normal pregnant readings green with advice; (c) also shorten the task to "same day" (for example 8 hours). Needs the CMO.
- Decision: open.

### OQ-584 Kick counter: "normal not reached" and the drop factor are this build's reading of A3 (raised by S67)
- A3 says: if normal is not reached, 10 movements are not felt in 2 hours, or there is a clear drop, show the card. Built: 10 in 120 minutes fixed; her personal normal is the median minutes-to-10 of her latest 5 finished sessions once she has 3; a clear drop is taking 2 times her normal (also applied while still counting); a "less movement than usual" button always shows the card. The 2 times factor and the 3 and 5 session counts are PROPOSED in `maternal.rules` and are this session's proposal, not a published figure.
- Options: (a) CMO confirms or replaces the three numbers (recommended); (b) drop the personal-normal rule and keep only the fixed 10 in 2 hours plus the button.
- Decision: open.

### OQ-585 Risk flag vocabulary and who may set it (raised by S67)
- `pregnancies.risk_flags` accepts any snake_case code (shape check only) and only staff can set it. The old `patient_pregnancy.high_risk` was writable by the patient; a patient write that sets it now fails because the history trigger refuses a patient-set flag. The CMO owns the list of codes (previous pre-eclampsia, chronic hypertension, and so on) and which ones prompt an earlier contact.
- Options: (a) CMO supplies the list and it becomes a CHECK or lookup table (recommended); (b) keep free codes.
- Decision: open.

### OQ-586 Pregnancy content is empty and gated until the CMO reviews it (raised by S67)
- `pregnancy_content` (week cards, nutrition, medicine safety, danger signs) has no rows and patients read only `cmo_reviewed` rows. No clinical text was written. The fixed default "Ask your care team before you take any medicine, including herbal ones" and the offline danger-sign labels are shipped as app strings (draft, flagged `draft_pending_cmo`). There is no write path yet: a content tool and the review action belong in the CMO sign-off hub.
- Options: (a) CMO or a clinical writer drafts 40 week cards, nutrition and medicine pages, then reviews them (recommended); (b) ship the danger-sign guide only and leave week cards for a later release.
- Decision: open.

### OQ-587 S67 migrations and the proof script were NOT run (raised by S67)
- The four migrations and `s67_pregnancy.sql` were written but not executed anywhere: the isolated local stack would not start ("all predefined address pools have been fully subnetted" from Docker), a use of another session's running stack was judged out of scope, and nothing may be applied to `koiplnmbgnqnbywhpjlf`. They were desk-checked only. Expect small fixes on the first real run.
- Also not deployed: the engine change in `supabase/functions/_shared/clinical` (a fit or loss of consciousness shows the emergency guidance on a rejected reading) reaches the server only when the functions that import it are redeployed.
- Options: (a) run the four migrations and the proof in a rolled-back transaction on a fresh local stack once Docker has room, then fix (recommended); (b) CI replay will do it on the PR.
- Decision: open.

### OQ-588 New pregnancy tables use `is_org_staff`, not the S39b tied-staff rule (raised by S67)
- INV-12 says a clinician sees only patients they hold a task, lead or page for. S39b (#997) ties 128 tables to that rule but is not on this branch's base, so the new tables read staff access through one helper (`private.pregnancy_staff_may_read`). After S39b merges, retarget that one function and add the new tables to its list and to the S39b proof.
- Options: (a) retarget the helper after S39b merges (recommended); (b) copy the S39b predicate into each policy now.
- Decision: open.

### OQ-346 Patient screens for the counter, timer, birth plan, week card and schedule are not built (raised by S67)
- Built and tested: rules, storage, RLS, the offline outbox path, the phone's cached facts, the cards' wording, the offline danger guide and the PIN-lock seam. Not built: the web and mobile screens, the clinician view of sessions, the antenatal reminder notification template and cron, retiring the old `antenatal_booking` route, and wiring `maternal_enabled` into the screens. Nothing was run in a simulator or browser.
- Options: (a) a short follow-up session builds the screens on top of the finished logic (recommended); (b) fold it into S68.
- Decision: open.

### OQ-347 Kick and contraction results are decided on the phone and trusted by the server (raised by S67)
- The server stores the result the phone reached (same pure code as the tests) and turns a "go today" result into an emergency event. A tampered client could raise a false alert (a nuisance, limited to one an hour) or hide a real one (no worse than not using the counter). Re-deriving the result on the server from the stored movements and config version is possible with the same package.
- Options: (a) accept for now (recommended); (b) add a server recheck that flags a mismatch for review.
## S69 (community cohorts and challenges): questions from OQ-360

### OQ-589 Who may start a cohort? (raised by S69)
- Built: any signed-in adult patient can start up to 3 cohorts (PROPOSED), name it and become its moderator. Nothing checks that "Grace Fellowship" is a real church or that the organiser speaks for it; a stranger could start a group with a convincing name and invite people.
- Options: (a) as built plus admin freeze and report-and-remove (recommended while the module is off); (b) organisers are vetted by Tarragon before they can start a cohort; (c) a cohort only goes live after a second member joins and confirms.
- Decision: open. Recommend (a) for the test period, (b) before real launch.

### OQ-590 Residual re-identification: two published snapshots a few hours apart (raised by S69)
- Floor of 10, leave-one-out at 30 percent, rounding to 10, a 12 hour delay and a band instead of a count are all PROPOSED. If one person withdraws consent between two published snapshots the total drops by about their share (up to 30 percent when the cap is reached); others who know who withdrew could read their contribution approximately. Cohorts of exactly 10 are the weakest case.
- Options: raise the floor to 15 or 20; add a floor on cohort size to start a challenge; publish at most once a day; add small noise. The CMO, the DPO and counsel should choose, with the DPIA.
- Decision: open. Values stay in `community_config` (versioned) so changing them needs no deploy.

### OQ-591 What a member can see of other members (raised by S69)
- Built: first names and roles, to members and moderator only. A moderator knows who they invited. A "workplace" cohort could be started by a manager; the employer account itself reads nothing, but a manager who is also a patient is a moderator like any other.
- Options: initials instead of first names; hide names from other members and show only a count; forbid a person who is also an employer admin from moderating a workplace cohort.
- Decision: open.

### OQ-592 The effort-only rule depends on what is recorded (raised by S69)
- The rule reads: active conditions whose name or ICD-10 code points to heart failure, kidney disease or an eating disorder, the pregnancy record, active medicines named as insulins, and a positive eating-disorder screen. Someone with an undiagnosed or unrecorded condition, a recent birth (the postnatal record is not read), or a differently worded condition name is not restricted. The CMO should confirm the list, the wording match, and whether the postnatal period and "history of" entries (a resolved condition is currently NOT restricted: `status = resolved` is skipped, which may be wrong for an eating disorder in recovery) should count.
- Safety default kept: restricted people see "not available for you" and nothing else; the reason is never shown.
- Decision: open (CMO).

### OQ-364 Activity minutes have no wearable source yet (raised by S69)
- The wearable tables carry steps but no active-minutes reading, so `activity_minutes` is self-reported (1 to 180 a day, 300 a week, WHO range). The plan says "consented wearables"; that waits for S70 and per-category consent (`consent_activity`).
- Decision: open (S70).

### OQ-365 Templates, consent text and counsel are all drafts (raised by S69)
- The seven challenge templates are `proposed`; nothing is approved. The consent text version is `draft-1`. The go-live guard needs the CMO's signature on at least one template, a recorded DPIA and counsel's confirmation of the NDPA 2023 references [verify]. The templates carry no clinical claim beyond effort, but the CMO should read each label and the WHO 150 to 300 minute wording.
- Decision: pending (CMO, DPO, counsel).

### OQ-366 The go-live guard patches two shared functions (raised by S69)
- `private.go_live_conditions` and `public.attest_go_live_condition` are redefined by several sessions. Migration s69b reads the current definition and inserts the community branch and two attestable codes, and fails loudly if its anchor text moved. It is stamped after every known redefinition (S28c, 20261007153917). A later session that pastes a whole copy of either function will drop the community branch unless it keeps it.
- Decision: open (process). Add the community guard to the S37 guard list when S37 is next touched.

### OQ-367 Test accounts open the community even when the module is off (raised by S69)
- Same as the S37 consultations rule (a test account passes), so the whole flow can be proved before launch. A test account can only be in a test cohort. Say if you would rather have the module switch gate test accounts too.
- Decision: open (recommend as built).

### OQ-368 Care Circle 17.1 to 17.4: what was not changed (raised by S69)
- OQ-220: the join link now survives "Create an account" on the sign-in page (not run end to end in a browser). Still open: the same-organisation rule, native app deep links for the join link, and whether Paystack's foreign-card setting is switched on so diaspora supporters can pay (cannot be checked from the repository).
- Decision: open.

### OQ-369 Moderator succession and co-moderators (raised by S69)
- Only the person who starts a cohort is a moderator. The plan says lay moderators (a pastor's assistant, an estate chair) invite, remove and close; there is no function yet to make a second moderator. If the only moderator leaves, the cohort closes, so nobody is promoted by accident.
- Decision: open. Recommend a "make moderator" action by the moderator, with the person's own yes.

### OQ-593 Group audio (17.8) is schema only (raised by S69)
- Deferred by the founder 2026-10-07. When it is built: S21 real-device testing, the Zoom plan limit (Meeting versus Webinar, about 20 people), a clinician host tied to every attendee (INV-12), no recording and no scribe (the table already forbids both), roster of first names that is audit-logged.
- Decision: pending (founder, later).

### OQ-594 The solo wellness challenge still shows its title in the app (raised by S69)
- Fixed: the ending notice no longer names the challenge or progress (INV-07). The titles ("5-Day Vitals Streak") remain inside the app's own wellness screen, where they are not a notification. The template still carries a legacy `smsText` field; `private.patient_reminder_channel` never picks SMS, so INV-08 holds, but the field could be removed.
- Decision: open (low).
## S70 to S75 planning (2026-10-07)

Raised by the S70 to S75 review (`docs/research/S70-S75-review-and-build-plan.md`). Numbers start at 309 because earlier sessions reused OQ-180 to OQ-185, OQ-213, OQ-214 and OQ-173 for different topics; do not renumber those, check for a clash before adding new ones. Decisions are in `docs/DECISIONS.md` under "S70 to S75 planning". Clinical thresholds named here are PROPOSED values and need the CMO's signature on the built draft.

### OQ-595 Cross-source duplicate readings (raised by S70, function 18.9)
- No cross-source dedup exists; only per-source unique indexes. The module's acceptance test ("duplicate readings from two sources are de-duplicated") has no implementation.
- Decided (S70-1): link and count once, clinical device or manual outranks wearable. Open: the exact value tolerance and time windows (proposed BP 10 minutes, glucose 5 minutes) need the CMO's signature.
- Decision: decided; windows pending signature.

### OQ-596 CGM glucose and the red-flag engine (raised by S70)
- `ingest.ts` deliberately skips glucose assessment for CGM. A prolonged low produces no clinician signal.
- Decided (S70-2): sustained-event rules. Proposed: low below 3.0 mmol/L for 15 minutes or below 3.9 for 60 minutes; high above 13.9 for 120 minutes. Basis is the International Consensus on Time in Range and ADA 2026 [secondary, primary text not read].
- Decision: decided; thresholds, durations, patient wording and who is paged pending the CMO's signature.

### OQ-597 Personal ECG devices and irregular rhythm (raised by S70, function 18.6)
- Existing path is PDF or photo upload with extraction, linked to `clinician_alerts`. No typed `device.alert`, no HealthKit ECG read, no device connector.
- Decided (S70-3): routine clinician task within one working day, device's own result shown, no diagnosis wording. Open: the review window and patient wording for signature.
- Decision: decided; wording pending signature.

### OQ-598 Photo capture of device screens (raised by S70, function 18.3)
- Not built. Decided (S70-4): on-device text recognition first, patient confirms every number, any device accepted, wrist cuffs get a "less reliable" note.
- Open: whether to ever allow server-side vision. If so it must go through `runGovernedAi()` with a registered `ai_systems` row.
- Decision: decided for on-device; server vision not approved.

### OQ-599 Recommended devices list and real-device test (raised by S70, functions 18.1 and 18.2)
- Criteria decided (S70-5). Open: the actual models and distributors are founder-supplied; seed nothing invented. The existing rule stands that one A&D UA-651BLE and one Accu-Chek Guide are paired on a real EAS build before a supported list is published.
- Decision: criteria decided; list pending.

### OQ-600 BP control basis: home vs clinic (raised by S38 design, decided by S75-1)
- CMO pack recommended home below 135/85 and clinic below 140/90, reported separately. The founder and CMO chose to keep the 140/90 default (own target overrides).
- Risk: home readings are judged on the clinic threshold and control may be overstated. Revisit before any sponsor-facing report or the 180-day report.
- Decision: decided (keep 140/90); revisit flagged.

### OQ-601 Outcome definitions for HbA1c, weight, PHQ-9 and GAD-7 (raised by S75, function 22.1)
- Decided (S75-2): severity-banded with a caveat. Proposed: HbA1c change and share under 7%, weight loss of 5% or more (not in pregnancy or under 18), PHQ-9 and GAD-7 by baseline severity band. The meaningful-change figures vary with baseline severity [secondary].
- Open: exact bands and thresholds for CMO signature; PHQ-9 item 9 and score 20+ handling must reuse the existing mental-health follow-up.
- Decision: decided; values pending signature.

### OQ-602 Triage dashboard naming (raised by S75, extends OQ-255)
- Decided (S75-3): rename to "agreement"; no accuracy figure until an outcome-linked study with a written design exists. Open: the study design.
- Decision: decided.

### OQ-603 Risk stratification fairness review (raised by S75, function 22.3)
- Decided (S75-4): stay deterministic; monthly CMO review by age band, sex, region and language; no ML model before 90 days of real snapshots. Open: who prepares the monthly report and where it is signed.
- Decision: decided; owner of the monthly report pending.

### OQ-318 Paid two-week CGM programme (raised by S70, function 18.5)
- Decided (S70-6): the CMO drafts the protocol. Not sold until sensor supply, a legal import route and a naira price exist. Open: who supplies sensors without Tarragon importing them (the 2026-08-02 no-import decision stands), the price, and the review of OQ-310 first.
- Decision: protocol approved in principle; launch blocked.

### OQ-319 One minimum-cell function (raised by S75, extends OQ-233)
- Suppression is enforced separately in the BP report, the sponsor report, the S38f held-back rule, risk distribution and older corporate dashboards (`organisations.min_cohort_size`, a different threshold). The acceptance test needs one enforcement point.
- Decided (S75-5): keep 20 and 30, one database function. Open: counsel or the DPO confirms the number; reconcile `organisations.min_cohort_size`.
- Decision: decided; counsel pending.

### OQ-604 Device shop and the Tarragon band (raised by S74, function 21.5)
- Decided (S74-1): no device shop, no `shop_orders`; the catalogue stays guidance. D-22 (band purchasing paused) is now recorded in `docs/DECISIONS.md`. The spec's 21.5 is not built by decision.
- Decision: decided.

### OQ-605 Health Points at checkout and the leftover kobo conversion (raised by S72, function 19.9; finishes OQ-08)
- Decided (S72-1): a single-use, order-bound reduction on Tarragon's own fee only. The kobo conversion (`wellness_points_redemptions.kobo_credited`, `points_to_kobo_rate`, `lib/queries/wellness.ts`, `patient/wellness/points-card.tsx`) is still on main-dev and is removed in the same session. Open: the points cost and cap per order (PROPOSED config).
- Decision: decided; values pending.
- Update (S72): the kobo conversion was removed (migration `20261007231742`); the checkout now offers the points choice on web and mobile. Values still pending (OQ-331); production count to re-verify (OQ-428).

### OQ-606 Instalments (raised by S72, function 19.10)
- Decided (S72-2): not built. Reopen only on an explicit ask.
- Decision: decided.

### OQ-323 Community Access Fund legal vehicle (raised by S72, function 19.11; extends OQ-07)
- Decided (S72-3): Nigerian counsel opinion first (fund holder, tax and charity status). A donation is a restricted gift tied to a named grant, never a balance. Built with the switch off. Open: the published grant criteria and who approves a grant.
- Decision: decided; counsel pending.

### OQ-324 Subscription toggle and leftover Paystack plan codes (raised by S73, function 20.2)
- Decided (S73-1): an admin-only, audited enable toggle with a go-live guard on Membership; no `subscription_plans` rebuild. The six Paystack Plan codes recorded in migration `20260905060410` still need disabling in the Paystack dashboard (founder action).
- Decision: decided; dashboard action pending.

### OQ-325 HMO eligibility adapter (raised by S71, function 19.6)
- Decided (S71-1): adapter per HMO, manual operations verification as fallback, hashed member number (the HMAC pattern of OQ-223), no capitation. Open: which HMO first, and who in operations verifies.
- Decision: decided; first HMO pending.

### OQ-326 Partner settlement scope (raised by S74, function 21.6)
- Decided (S74-2): only where Tarragon collects and owes a partner; labs owe nothing (D-06); separate from S31 clinician payouts with a test that nothing is paid twice. Open: whether any pharmacy margin exists at all (OQ-283 hides prices).
- Decision: decided; scope may be empty at launch.

### OQ-327 Gaps found in the S70 to S75 review that need an owner
- OQ-192 (any `profile_access` grantee can read and pay) is still open and must be fixed before any real caregiver grant. OQ-39 (56 older `analytics_*` RPCs ignore `is_test`) is still open. `device.synced` and `device.alert` are not in the S10 event catalogue. Withings, Samsung, inhaler sensors and `LabResultsSource` are not built. `partner_quality`, `partner.quality_breach`, `partner.settlement_due` and `settlement-run` are not built. Price quoting (`price-quote`, `price.changed`, `discount_codes`, `price_books`) is not built.
- Decision: open; each is in the build plan.

### OQ-380 CMO signature on the outcome measure definitions (raised by S75b)
- `outcomes.measures` v1 (HbA1c, weight, PHQ-9, GAD-7 windows, thresholds, severity bands, response-time grouping, retention days, evaluation-design note) is PROPOSED. Until the CMO confirms it on the go-live sign-off screen, every report for those measures returns "awaiting signature" and no figure. Nothing was signed by this session.
- Open: the CMO confirms or asks for changes; any change is a new version.
- Decision:

### OQ-381 Pregnancy and age rules for the new measures (raised by S75b)
- Pregnancy is read from the current `patient_pregnancy.is_pregnant`, not from the state at the time of the result, so someone who became pregnant after day 0 is excluded from both ends. Members with no date of birth are excluded (`age_unknown`); all four measures are adult only (under 18 excluded, including PHQ-9 and GAD-7).
- Options: (a) keep, the safe direction (recommended); (b) store the pregnancy state at each window; (c) include adolescents with their own instruments.
- Decision:

### OQ-382 HbA1c source of truth (raised by S75b)
- Snapshots read `lab_analyte_readings` (patient-confirmed extraction and staff entry). Structured partner results in `lab_result_items` (S27) are not read, so a partner-reported HbA1c that never reached `lab_analyte_readings` is invisible to outcomes. Units other than % and mmol/mol are ignored.
- Options: (a) copy released HbA1c items into `lab_analyte_readings` (recommended, one source); (b) read both with de-duplication.
- Decision:

### OQ-383 What "programme completion" means (raised by S75c, function 22.2)
- Decided (S75-7, founder and CMO, 2026-10-07): programme completion = the entitlement was fully used: every consultation and test item in the Membership or care pack is used, or the term ended with the clinical items used. Implemented in the retention report (`fully_used`, labelled exactly that), kept in the engagement family, never combined with a clinical outcome. Revoked (refunded or cancelled) entitlements are not counted either way.
- Limitation: "fully used" reads each entitlement's own state and `remaining_uses`; sibling consultation or test entitlements bought in the same pack are not linked to it by the schema, so a pack whose items sit in separate entitlements may be under-counted. Revisit if S26 links them.
- Decision: decided.

### OQ-384 CMO door for the fairness review (raised by S75c, decision S75-4)
- `record_risk_fairness_review` works and is proven, but the CMO's clinician login cannot open `/admin/risk-fairness`, where the monthly list lives, so there is no button yet. Needs a `/clinician/...` page (the S36e and S37 two-door pattern). Also: who prepares the monthly note (OQ-317).
- Decision:

### OQ-385 Response times: scope and the S36e overlap (raised by S75c, function 22.7)
- Added turnaround, escalation, hand-back and follow-up rates by urgency band and finisher tier. "Follow-up" is only the `adherence_follow_up` task type; the CMO may want a wider definition. Hand-backs are counted from `handback_count`, which resets nothing but is a task-level count. No per-clinician view by design.
- Decision:

### OQ-386 Triage report old name (raised by S75a, decision S75-3)
- `triage_accuracy_report` remains as a deprecated wrapper of `triage_agreement_report` and the audit action changed from `triage.accuracy_report` to `triage.agreement_report`. Drop the wrapper in the migration after the web deploy.
- Decision:

### OQ-387 Latent bug in the payer board report (raised by S75a)
- S38 added measure specs (`bp_control_90d`, now `bp_control_180d`) that the payer board engine cannot compute; `generate_payer_board_report` looped every spec and would have raised on the first report once the payer module is on. Fixed by restricting it to known keys (`private.board_measure_keys()`); the older proof `payer_board_outcomes_report.sql` is in `ci.excluded` and already failed at its attest step before this session (not investigated).
- Decision:

### OQ-388 Floors raised for older dashboards (raised by S75a)
- Corporate, payer and reproductive dashboards used 5 to 10; they now use 20 (or the organisation's higher number). Small employers may see "withheld" where they saw figures. Counsel or the DPO confirms the number (OQ-233).
- Decision:

### OQ-389 OQ-39 progress (raised by S75a)
- Fixed for the surfaces touched: reproductive analytics, institution subsidy summary, payer dashboard, the new reports. The 56 older `analytics_*` RPCs still ignore `is_test`; see the S75 progress entry for the list. Retrofit or retire them in one session.
- Decision: **built, NOT applied (branch `wp4/analytics-is-test-filter`)**. Retrofit by one central predicate, not 56 edits and not retirement: schema `analytics_clean` with 51 `security_invoker` views (the relation minus `profiles.is_test`), 45 RPC bodies re-created from their live definitions with relations redirected, 6 record lookups and writers exempt on purpose, 4 config-only functions untouched, plus the nightly snapshot refresh and `get_geo_health_aggregates` that feed them. `analytics_clinical_rule_performance` had no caller anywhere and is dropped; `analytics_health_economics` and `analytics_population_dataset_preview` have no main-dev caller but are called by the unmerged branch `worktree-population-health-intelligence-gaps`, so they were kept (filtered). Migration `20261023175503_oq39_analytics_rpcs_exclude_test_accounts.sql`, design `docs/design/OQ39-analytics-is-test.md`, proof `oq39_analytics_exclude_test_data.sql` (catalogue scan that fails on any new unfiltered `analytics_*` function, behavioural run over every function, sabotage). The proof passed on a Postgres 17 loaded from a schema-only dump of live (not on a full `supabase db reset`, see BUILD-PROGRESS); do not mark INV-13 met for analytics until CI replay is green and the migration is applied.
## S73 pricing engine (2026-10-07)

### OQ-328 Sponsor coverage cannot be charged yet (raised by S73)
- The quote computes a sponsor's share from the price book entry, but `create_order` refuses any order with a sponsor share (`sponsor_billing_not_open`): without S71's sponsor entitlement the share would never be collected or posted. S71 lifts this.
- Decision: resolved by S71 (2026-10-07): a sponsor share is accepted only when a `sponsor_programmes` budget covers it, reserved atomically and released on cancel, failure or refund; the guard `sponsor_payment_enabled` is OFF. Collecting from the sponsor is OQ-403.

### OQ-329 Hardship pricing is a seam (raised by S73, extends OQ-323)
- `private.hardship_reduction()` returns 0. It must be replaced by Access Fund grants (S72); never by a self-declared discount.
- Decision: waits for S72 and counsel.
- Update (S72): answered differently, see OQ-423 (a grant uses the sponsor slot; this seam stays 0 on purpose).

### OQ-607 Kobo conversion for wellness points still present (raised by S73; extends OQ-08 and OQ-321)
- `redeem_wellness_points`, `wellness_points_config.points_to_kobo_rate`, `wellness_points_redemptions.kobo_credited` and the web, mobile and admin screens that use them were NOT removed: it touches three apps and the voucher path, and S72 owns it. The new fee-only points reduction is separate and OFF.
- Decision: remove in S72.
- Update (S72): removed, count-first and fail-safe (OQ-428).

### OQ-608 Values in `pricing.rules` are unsigned guesses (raised by S73)
- Points (100 points per step, 5,000 kobo per step, 5 steps, 50 percent of the service fee), minimum payable 10,000 kobo and 10 failed code tries an hour are PROPOSED, owner Founder. Points stay OFF until signed. Also decide whether a refund returns spent points (today it does not).
- Decision: open.

### OQ-609 Screens not built (raised by S73)
- No mobile what-is-included screen and no admin screens for price books and discount codes (the audited functions and an overview exist and are tested). Mobile `loadQuote` is not wired.
- Decision: open.

### OQ-610 What-is-included page needs a login (raised by S73)
- The page is behind patient sign-in, so a shared link asks the reader to sign in. A public version needs an anon-readable function, which conflicts with the no-anon rule for catalogue data.
- Decision: open.

### OQ-611 Migration stamp ahead of the clock (raised by S73)
- main-dev holds migration stamps later than the real clock; the S73 file is stamped 20261007164447 (real time plus 4 hours) so it sorts after them. Pin the version to the filename when applying.
- Decision: informational.

## S71 checkout and payments, part 1 (2026-10-07)

### OQ-400 Placeholders for consultation, lab package and home kit are unpriced; the Membership pivot said no one-off consults (raised by S71, function 19.1)
- Three catalogue items exist OFF with no price row: `consultation_single`, `lab_panel_standard`, `home_kit_sample` (new kind `home_kit`). They cannot be switched on until the founder prices them with `set_item_price`. The 2026-10-05 Membership pivot ("Free + 100k/year; no one-off consults") conflicts with `consultation_single`; it exists only because the module spec lists a consultation item and a sponsor programme needs something to cover. No `device` kind was added (no hardware sales, CLAUDE.md 2026-08-02).
- Decision needed: keep, rename or delete the consultation placeholder; give the lab package and home kit prices and the `clinician_fee`, `partner_fee` and `tarragon_service_fee` split, or leave them off.
- Decision: open.

### OQ-401 Paystack channel strings are not proved against Paystack (raised by S71, function 19.2)
- The checkout now sends `channels: ["card","bank_transfer","ussd"]`. The strings come from Paystack's published API reference and were proved only against the test double (the docs site returned HTTP 403 to the fetch tool in this session). `bank_transfer` ("Pay with Transfer") may also need enabling on the Paystack account. A wrong value would be rejected at initialise (a visible failure, not a silent one).
- Founder action: try card, transfer and USSD once with the test key and record it as the attestation `paystack_channels_verified` on the `checkout_enabled` guard.
- Decision: open.

### OQ-402 International card estimate is PROPOSED (raised by S71, functions 19.4 and 19.7)
- `commerce.processing_fee_estimate` v3 adds 3.9 percent + NGN 100 for cards issued outside Nigeria (from the 2026-10-06 reading of Paystack pricing). The checkout cannot know the card's country before payment, so it shows the local estimate and, separately, the international one. Confirm the figures against the account's own Paystack pricing.
- Decision: open (Founder).

### OQ-403 Sponsor receivable accounting is a guess (raised by S71, function 19.5)
- A sponsor-covered order posts Dr 1210 Sponsor receivable (new account) and Cr deferred revenue or revenue for the sponsor's share, and reverses it on refund or cancel. Whether a sponsor share is revenue when the sponsor has not yet been invoiced, VAT, and the recognition schedule on the sponsor part are finance decisions. Sponsor invoicing and collection are not built, so a receivable is posted and nothing collects it.
- Decision: open (finance). Attestation `sponsor_receivable_confirmed` on `sponsor_payment_enabled`.

### OQ-404 The profile row stays readable to any unexpired grantee with at least one permission (raised by S71, extends OQ-192)
- OQ-192 is fixed for paying (needs `pay_for_care` or `manage_payments`) and for booking requests and the two vaccination reads. `profiles_select` now refuses expired grants and grants with an empty permission list, but still shows the whole profile row to a grantee with, say, only `view_appointments`: every caregiver feature needs the person's name, and narrowing columns needs a view and app changes (a larger change to the RLS surface).
- Options: (a) leave as is (recommended for now); (b) give caregivers a narrow view (name, photo, date of birth only) and remove them from `profiles_select`.
- Decision: open.

### OQ-405 Counsel opinion and NDPA basis for sponsor payment and member numbers (raised by S71, extends OQ-07)
- Sponsor-paid items are the order-linked rebuild OQ-07 asked for (a sponsor ceiling, not a stored balance). Counsel is still needed before live use (guard `sponsor_payment_enabled`). Separately: an HMO member number is personal data even when only a keyed hash is stored (the HMO can link it); confirm the NDPA basis and the privacy notice wording for the check.
- Decision: open (counsel).

### OQ-406 Who verifies HMO checks, and for which HMO first (raised by S71, extends OQ-325)
- Built: an adapter interface and a stub that always answers "unavailable", so every check waits for operations; `ops_verify_hmo_eligibility` (admin; types the number again) and `admin_hmo_checks_pending`. Not built: an admin screen for the manual queue and for sponsor programmes (the audited functions are tested), a response-time target, and any real HMO adapter. No HMO has a public eligibility API that was found.
- Decision needed: first HMO, who in operations verifies, and the target time to answer.
- Decision: open.

### OQ-407 Merge order and the two wrapped go-live functions (raised by S71)
- The migration wraps `private.go_live_conditions` and `public.attest_go_live_condition` (rename to `*_base`) instead of replacing them. It must sort after the S70, S73 and S74 migrations; applied before them, their create-or-replace would drop the S71 guards' conditions. The S36b and S37 proofs now count 11 guards; another branch adding guards changes that number. After all branches merge, consider folding the wrappers into one dispatcher.
- Decision: informational.

### OQ-408 Sponsor cover applies only to the person themselves (raised by S71)
- A supporter paying for someone through the Care Circle does not get the sponsor cover and is not told the person has one (a payer must not learn a cohort or HMO status, OQ-223). The price-book path of S73 still applies to the beneficiary's cohort as built.
- Confirm that this is wanted, or decide that a sponsor-covered item should reach a beneficiary regardless of who opens it.
- Decision: open.

### OQ-409 Mobile has no quote, itemised or health plan screens (raised by S71; extends OQ-332)
- Mobile handles a covered reply (nothing opened, a plain notice), shows "Covered by" in the order list and the honest pending title, and maps the new errors, but its Membership screen still shows the catalogue price and the old fee lines (no `loadQuote`) and has no "check my health plan" card. Web has all of it.
- Decision: open (S71 follow-up or a mobile session).

### OQ-410 Two real sessions racing for the last of a budget were not exercised (raised by S71)
- `sponsor_reserve` locks the programme row (`for update`) before checking the budget, and the proof shows the check, the per-person allowance and the release paths in one transaction. A true two-connection race (as `scripts/run-db-proofs.sh` allows with a `.sh` proof) was not written.
- Decision: open (small follow-up).

### OQ-420 Community Access Fund: the published reasons, limits and who approves are unsigned (raised by S72, function 19.11; extends OQ-323)
- Built as PROPOSED, owner Founder and counsel (`access_fund.rules` v1, active row of `checkout_extras_config`): four published reasons (the cost is the main barrier, recent loss of income, supporting a dependant, referred by the care team), most one grant can cover 100,000 naira, a grant works for 60 days, smallest gift 1,000 naira, a pledge waits 14 days, at most 3 open pledges. Operations (admin) approve with a written reason; a second approver is not required (S72-3).
- Needed: review of the wording of the reasons, and the numbers; whether the CMO or only admins approve; and the guard condition `grant_criteria_signed_off`. Nothing opens until these and counsel (OQ-323) are done.
- **Decision (founder, 2026-10-23): accepted as proposed.** The four reasons, 100,000 naira per grant, 60 days, 1,000 naira smallest gift, 14 day pledge, 3 open pledges, admins approve with a written reason (no CMO approval step, no monthly CMO review). The guard condition `grant_criteria_signed_off` is attested only with the counsel opinion (OQ-323); the Fund stays OFF until then.

### OQ-421 How restricted gifts and Fund-paid orders are accounted for (raised by S72, function 19.11)
- No ledger entry is made for a donation or a grant. A donation is not revenue; it is a restricted gift held for a purpose, which needs a finance and counsel decision (a restricted-funds liability, who holds the money, tax and charity status). A Fund-paid order is booked by S71's path to account 1210 "Sponsor receivable", which is the wrong name for the Fund (the Fund owes nothing; it is Tarragon's own restricted money) and needs the same decision.
- Guard condition `restricted_gift_accounting_decided` keeps this closed. Test orders are never posted (INV-13), so nothing wrong can post before the decision.
- Decision: open (finance and counsel).

### OQ-422 Swap the Fund's minimum-cell function when S75 merges (raised by S72)
- S75 (`private.suppress_cell`) is not on this branch. The public report uses `private.fund_min_cell()`, which reads the same platform value (`outcome_config` min_cell, 20, S38b) and never lets it be below 2. When S75 lands, replace that one function's body with a call to the shared rule and keep the proof `s72_checkout_extras.sql` (it flips if the rule is weakened).
- Decision: informational (follow-up at merge).

### OQ-423 Hardship pricing is realised through the sponsor slot, not `hardship_reduction()` (raised by S72; answers OQ-329)
- The S73 seam `private.hardship_reduction()` still returns 0 on purpose. A Fund grant covers part or all of one item through an `access_grant` sponsor programme (a ceiling, a reservation per order, the S71 ledger, refund and event paths). A reduction in the hardship slot could not be tied to one order, reserved against the grant or reversed on a refund, and the same money in two slots would be counted twice.
- Consequence: the quote's line is the sponsor line ("Covered by Community Access Fund"), and a person who also has a price book gets the book, not the grant (the S71 rule that a price-book path wins). Confirm, or ask for a separate hardship line.
- Decision: open (founder).

### OQ-424 Payment request limits are unsigned (raised by S72, function 19.13)
- `payment_requests.rules` v1 (PROPOSED, owner Founder): a link works 7 days, 5 open per person, 10 made a day, 30 link lookups an hour per visitor, 10 payment starts an hour per payer. The link page shows no name of the person who asked; showing a first name would tell a stranger holding a leaked link that a named person uses Tarragon, so it was left out. Confirm the numbers and that no name is wanted.
- **Decision (founder, 2026-10-23): confirmed as proposed.** 7 day link, 5 open per person, 10 made a day, 30 lookups an hour per visitor, 10 payment starts an hour per payer, and no name of the person who asked on the link page.

### OQ-425 Payment requests can only ask for the yearly Membership (raised by S72; extends decision S29c)
- Founder decision S29c (2026-10-06) says nothing smaller than the full yearly Membership can be paid for someone else, so `create_payment_request` accepts only what `private.gift_item_allowed` allows. If one-off items ever return, the request follows with no change here. The request also cannot be paid when the person already has a Membership.
- Decision: informational.

### OQ-426 Donations are bank-transfer pledges; no Paystack, no bank details, no receipt (raised by S72, function 19.11)
- By instruction no live Paystack call exists. A pledge gives a reference; the page says the team will email the bank account details. Not built: where those details come from, the email, a donor receipt or tax acknowledgement, and an online card donation. All wait for the counsel opinion (what the fund holder is) and a bank account in the right name.
- Decision: open.

### OQ-427 No patient self-application for the Fund; web-only donation screen (raised by S72, function 19.11)
- Grants are approved by operations for a person (usually after the care team or a conversation). A screen where a person asks for help (and how that stays private and un-gameable) was not designed. The donation page and the operations screen are web only; mobile shows the person's support state through entitlements but has no donation screen.
- Decision: open.

### OQ-428 Re-verify the kobo-conversion counts before applying (raised by S72; finishes OQ-08, OQ-321, OQ-330)
- The migration removes `redeem_wellness_points`, `wellness_points_redemptions` and `points_to_kobo_rate` after counting; it aborts with a message if any redemption belongs to a non-test patient. The expected real count is zero (S73 recorded none) but production was not queried. Reward vouchers already issued from earlier redemptions are not touched. Also still open from OQ-331: whether a refund returns the points an order spent (today it does not).
- Decision: open (re-count before apply).

### OQ-429 Memberships paid by a sponsor or the Fund are recorded with source `employer` (raised by S72)
- `settle_sponsor_order` (S71) writes `patient_memberships.source = 'employer'` for any sponsor-covered Membership, including a Fund grant. The source is not shown to the person today (the entitlement card uses the order, not this field), but reports by source would mislabel it. Adding `sponsor` and `access_fund` values needs a constraint change.
- Decision: open (small follow-up).

### OQ-430 Other `{{...}}` strings never fill in (raised by S72)
- The i18n helper fills `{name}` only. Four entitlement strings used `{{count}}` and printed "{3} use left"; S72 fixed those. `admin.refunds.confirm_approve` (`{{amount}}`) has the same fault and was left alone. A scan test for double braces would stop it recurring.
- Decision: open (small follow-up).

### OQ-431 Nothing schedules the two expiry functions; the new pages were not walked in a browser (raised by S72)
- `expire_access_fund()` and `expire_payment_requests()` are safe to call often (admin or service role). Reads already treat an old pledge as lapsed and an old link as expired, and a grant past its date matches nothing, but the stored status changes only when one of these runs (a daily call from an existing cron route would do). Separately, the web and mobile screens were type-checked, linted and unit tested, and the new database functions proved, but no browser or phone walk-through, no Paystack test-key payment from a link, and no sign-up of a brand-new payer through `/login?redirect=` was run.
- Decision: open (follow-up).
### OQ-612 Partner quality numbers (raised by S74, function 21.7)
- The turnaround target (72 hours for a laboratory), the 80 percent on-time floor with at least 10 orders, three upheld complaints, the score weights (40/30/30) and floors (warn 70, suspend 50), the 30-day override and which breaches suspend are PROPOSED in `partner_quality_config` (mirrored as `partner.quality`). Nothing is signed. A wrong number can pause a real laboratory from new work.
- Decision: open; CMO to confirm before the nightly job is trusted on real partners. Partner rows are a shared directory with no `organisation_id` (like go-live guards); reads are admin and CMO only.

### OQ-613 Home test kits (raised by S74, function 21.1)
- Not built. A kit needs a named partner, a D-06 treatment (who is paid for the kit and the lab work) and a result path through `LabResultsSource`. The seam is documented in `apps/web/src/lib/lab-results/results-source.ts`. `ApiLabResultsSource` is a stub that connects to nothing.
- Decision: open; needs a partner.

### OQ-614 Settlement four eyes with one founder (raised by S74, function 21.6)
- `partner.settlement.four_eyes` is true: the person who drafts terms cannot approve them. A solo founder cannot satisfy it. Settlement ships guard-off and is empty at launch (no sponsor checkout, pharmacy prices hidden, OQ-283), so this does not block anything today.
- Decision: open; founder to say whether a second approver (accountant, CMO) exists. Also open: a refund after a statement is issued is only reported (`partner_double_payment_findings`), not clawed back.

### OQ-615 Pharmacy sourcing claim and batch record (raised by S74, function 21.2)
- A pharmacy declares its NAFDAC-registered suppliers and an admin records a check. The pharmacist may record the product NAFDAC number and supplier per supply, once. It is NOT required at dispense (S28c says Tarragon does not verify batches), and the patient directory view does not yet show the badge (`pharmacy_sourcing_verified()` exists).
- Decision: open; pharmacy lead and counsel to confirm wording before any patient-facing claim.

### OQ-616 Pharmacist chat scope (raised by S74, function 21.2)
- In app only, patient starts, 1,000 characters, 20 a day, open until collection plus 14 days, the pharmacy loses access when the patient changes pharmacy or takes the prescription back. No Tarragon staff read path. Caregivers (S28c pharmacy permission) are not included. The static emergency notice is the only safety text: no keyword triage (INV-01 spirit).
- Decision: open; CMO and DPO to confirm that no staff read path is acceptable for complaints, and whether caregivers may use it.

### OQ-617 go_live_conditions wrapper (raised by S74)
- S74 renames the live `private.go_live_conditions` to `go_live_conditions_s74_base` and puts a thin wrapper in front, to avoid copying another session's body. A later migration that replaces `go_live_conditions` whole removes the wrapper and the settlement guard then fails closed. The S37 and S36b proofs now expect eight guards.
- Decision: open; fold into S37 on the next rebase.

### OQ-618 Clinic calendar and migration timestamps (raised by S74, function 21.3)
- Clinic slots and reservations exist as schema and functions only, dormant under module 28; the proof for them and for the pharmacy chat and sourcing is NOT written or run (see BUILD-PROGRESS S74). The three S74 migrations are named 20261007161247 to 20261007161321 because the machine clock (12:34 UTC) sorted before existing files; whoever applies them must pin the version to the filename.
- Decision: open.
### OQ-619 Free red events are guidance-only (CMO decision 2026-10-08): the INV-05 consequence
- INV-05 says a red event never waits for a clinician to pull work and always pages the on-call clinician. By CMO decision (a sustainability decision, amendments C2) a red event on a **Free** patient now pages nobody, creates no clinical task and no clinician alert. A **Member** red event pages exactly as before. INV-05 therefore reads, from this change: "a red event on a Member never waits for a pull; on a Free patient it is guidance only." The spec text and `docs/design/S19.md` still carry the old wording until the CMO signs this.
- Built (`two-tier/free-red-path`, NOT applied): `private.patient_may_page_doctor()` is the one gate, fail closed toward paging (a missing patient or any error while working out membership counts as Member and pages). `public.create_red_page`, `public.create_tasks_from_triage_event` and the legacy trigger feature check (`vitals_red_flag_doctor_escalation`, now also true for a Member) all use it. The glucose app-layer check now also fails toward paging.
- The Free patient gets: the acknowledge-gated hospital screen; the plain sentence "A doctor has not been alerted, because you are on the Free plan. Doctor review is part of Membership."; a recheck line; the emergency-contact notice (existing mechanism, no health detail); a recheck notice after 30 minutes and a "did you get care" check-in after 6 hours (PROPOSED, `free_red_event.rules`, CMO to confirm), the answer stored in `free_red_events` where no clinician, CMO or admin can read it; a one-tap "Join as a Member" route that never blocks the guidance; a hospital search link (no hospital directory exists, so this is a generic maps search, not a Tarragon-curated list). The triage event is still logged and counted.
- Effect to know before applying: live has 0 active memberships and the Membership item is still inactive (S25), so on the day this is applied **every red event on a patient with no programme purchase is guidance-only**. Applying it before Membership is sellable removes doctor paging for essentially everyone.
- Extended by the founder on 2026-10-12 to the same Free rule (`20261013010515`): amber triage tasks, heart-failure rapid weight gain, and mental-health crisis follow-up (the doctor task and page only; the patient's crisis screen, emergency contact notice and hospital guidance are unchanged). Still reach a doctor on every plan, by standing rule: abnormal screening results and the lab critical-result path. Not asked for and so unchanged: the mental-health screen CONCERN alert (a high but non-crisis score) and legacy RED-level vitals, which on Free keep the old self-care suggestion with no recheck or check-in. `private.raise_crisis_follow_up` exists live only (migration `f1_crisis_priority_task_and_event`, not in main-dev) and is patched from its own text only if present. No Nigerian helpline numbers exist in the repo and none were invented; the founder needs to supply verified ones for the crisis screen.
- Recommended, optional: tell the DPO and have legal review the terms and consent wording (the safety promise changes; amendments C2 point 8). Mobile shows the new status box on the red screen but has no check-in card yet (the web card is built); the mobile Care Circle and `red_alerts` notices (S29) are unaffected.
- Options: (a) accept as built (recommended); (b) also put the four condition work-ups above on the Free rule; (c) hold the migration until Membership is on sale.
- Decision (2026-10-13, TT-12): only the CMO's signature is needed to go live. DPO and legal review are recommended and optional; nothing is blocked on them.
- Resolved by the 2026-10-12 review: the day-one effect (every patient with no programme purchase becomes guidance-only) is still real until Membership is on sale and legacy holders are converted; the apply runbook now makes the conversion migration run before the Free path matters. The "also put the four condition work-ups on the Free rule" option was taken (`20261013010515`). Still open: the CMO signature on the INV-05 wording (DPO and legal review are recommended, optional).


### OQ-620 Two-tier pricing: price, only Free and Member, lapse, organisation seats (raised by the two-tier pricing build, 2026-10-12)
- Built on branch `two-tier/pricing`, nothing applied. Founder 2026-10-12: the platform launches at 120,000 naira. The 12,000,000 kobo `prices` row starts the moment the migration is applied and the 10,000,000 row is closed at that instant (never edited), so 100,000 is never in force. The Membership item and `v5_checkout` stay off until staff switch them on.
- Organisation member price: flat 100,000 default plus per-organisation overrides (`/admin/organisation-prices`), band 50,000 to 200,000 naira accepted. Organisation-paid seats sit behind the dormant module `organisation_membership`.
- Only Free and Member: care packs, per-item doctor-time products, paid credits and the doctor-supported chronic pack are non-sellable with a CHECK (data kept; a held credit stays redeemable). NOT touched, because not named: `ai_coach_daily_pass_30d` and `continuous_monitoring_90d` are still active service products; marketing `/monitoring`, `/for-you` and `/gift` still describe the monitoring product. Decide.
- Lapse: `membership.lapse` (grace_days 14, reminders 30/14/7) PROPOSED; `private.patient_is_member` is the one Member function (grace included) and the Free red-event gate reads it. Hand-off of open work goes to a neutral `membership_handoff` task.
- Open: (1) seats are not posted to the ledger; (2) `employer_billing_configs.price_per_member_minor` is a second per-member price that seats ignore; (3) an organisation seat is not renewed automatically at its end; (4) the three new notification templates need the deployed `send-pending-notifications` to render email and push (check the deployed version); (5) `risk_is_current_member`, outcome and report helpers read `patient_memberships` by date without the grace.
- Decision: open.
- Answered 2026-10-12 (founder/CMO, `docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md` Update 5): refunds are 21 days and end access at once (TT-6); legacy programme holders are converted and Member has one meaning (TT-7); the grace can book (TT-8); renewals are included and a second opinion is a 5,000 naira Members-only extra (TT-9). Open items (1) to (3) and (5) above remain open; (4) is on the apply runbook.

### OQ-621 Prescription renewal spacing and the old renewal credit (raised by the 2026-10-12 review) - RESOLVED 2026-10-13
- Resolved by the founder/CMO on 2026-10-13: a renewal is NOT a separate request. It is discussed and prescribed at the Member's monthly doctor review. The 28 day spacing and the `membership.renewal` config are removed. Built: the standalone request is closed for a Member; the medicines screen (web and mobile) says so and offers an optional "add to my next review" note; the pre-call summary lists medicines due for renewal and the note; a Free person is told renewal is part of Membership with a Join link; a held credit still works for a non-Member (see TT-9). The lookahead for "due for renewal" is `membership.review` renewal_window_days = 30, PROPOSED, for the CMO to confirm.
- Finding kept for the record: before this change the old trigger passed everyone, because `medication_refills` is in the free feature list.
- Decision: resolved.

### OQ-622 Legacy conversion: no end date (raised by the 2026-10-12 review) - RESOLVED 2026-10-13
- Resolved by the founder on 2026-10-13: every legacy holder becomes a real Member; a holder with no end date gets a full 365 days from conversion (`membership.legacy_conversion` no_end_date_days, PROPOSED, versioned); a holder with an end date keeps it; no free year. Live there are none without an end date.
- Decision: resolved.

### OQ-623 Legal text for the 21 day refund (raised by the 2026-10-12 review)
- The Membership terms text, including the 21 day refund and the immediate end of access, is being drafted by another agent on a separate branch; this branch does not touch `docs/legal`. Counsel review is recommended and optional (founder 2026-10-13); the live Terms row is updated through the legal flow, not by this branch.
- Decision: pending the other branch.

## E. Community (patient peer-support groups): raised and DECIDED 2026-10-09 (see docs/COMMUNITY_SPEC.md)

Numbered `OQ-COM-nn` on purpose: the plain OQ-nnn sequence already has parallel-branch collisions. Decided in-session by the founder (also acting as CMO). The CMO's in-system acts (signing rule set v1, the safety wording, the weight-loss template, switching the `community` guard) are still owed; see the go-live list at the end of this section.

### OQ-COM-01 Does the founder's community request override Part C.1? -- DECIDED
- Blocks: every community migration, screen and function.
- Conflict: `docs/BUILD-SPEC-v5.md` C.1 (line 2174) bans "public feeds, public profiles, public maps and body-metric leaderboards" as "unmoderatable by a small team"; Module 17 (line 1709) repeats it. v5's community was private cohorts, challenges and anonymised totals only (S69).
- Decision (founder, 2026-10-09, free-text answer): "People on both free tier and members should be able to join groups. This will help to build more people that can join membership too." Read as: yes, build members-only topic groups; access is **not** gated by plan; community is an acquisition route into the paid membership. The answer did not address the dormant-guard option, and **does not need to**: the `community` guard is INV-14 and stays. If this reading is wrong, say so before the guard is switched on.
- Consequences: (1) no plan check anywhere in the community code paths; a Free member can read, post, react and report like anyone else. (2) Posting does not create doctor-time cost, so the 2026-08-10 Free rule is untouched (see OQ-COM-05). (3) A membership upgrade prompt may appear as a fixed, non-condition-naming call to action (never an ad, never based on what the member posted or which group they are in). (4) Add one line to C.1 saying members-only moderated topic groups are permitted and public, profile-based or metric-ranked surfaces remain forbidden. Copy to `docs/DECISIONS.md`.

### OQ-COM-02 Sensitive groups at launch? -- DECIDED
- Decision (founder, 2026-10-09): none at launch (recommended option). Launch groups: hypertension, diabetes, weight loss, general health. The schema keeps `sensitivity = 'sensitive'` for later; no sensitive group is created without a new written decision. Mental health additionally needs a human crisis owner first.

### OQ-COM-03 Who moderates, in which hours, and as what kind of account? -- DECIDED (names and hours still to be filled in)
- Decision (founder, 2026-10-09): a small named team: one named safety reviewer plus one or two moderators, declared weekday hours plus a weekend sweep, via a `community_staff` grant on an existing non-clinical staff role. **No new `user_role` value.** New-member posts wait for review outside declared hours.
- Still owed before go-live (guard condition 1): the actual names, their accounts, and the declared Africa/Lagos hours.

### OQ-COM-04 Under-18 policy -- DECIDED
- Decision (founder, 2026-10-09): adults only, 18 and over, for every group, no exceptions. Enforced from the profile's date of birth and re-checked on every post. A caregiver or parent uses their own account; nobody posts as a dependant. Extends OQ-129 and OQ-154.

### OQ-COM-05 Safety wording, the crisis owner, and what a Free patient gets -- DECIDED (CMO acts still owed)
- 2026-10-12 update (COM-21): the CMO approved the self-harm and emergency wording and named himself crisis owner in chat. Still owed in the system: the CMO loads and activates the starter rule set (his signature), and safety reviewers are named.
- Decision (founder, 2026-10-09): a Free member whose post is flagged gets the **immediate safety card** and their **own one-tap emergency-contact button**. No promise of a clinician review is made on Free. Paid plans may additionally get a care-team task (Phase 2, behind a feature flag, with the consent from OQ-COM-06). No exception to the 2026-08-10 Free rule is made for self-harm.
- Still owed from the CMO as in-system acts before go-live (guard conditions 2 and 3): (a) write and sign the `self_harm` and `emergency` phrase lists and the card wording as part of filter rule set v1; (b) name the human who owns the self-harm queue and the target response time (PROPOSED config). This decision picks the Free-plan behaviour; it does not write or sign those lists.

### OQ-COM-06 Consent and retention for community data -- DECIDED (counsel text owed)
- 2026-10-12 update (COM-21): founder and CMO accepted consent text v1 and 90 days retention. Counsel has not reviewed them; the counsel attestation stays open.
- Decision (founder, 2026-10-09): consent at join, in plain language: Tarragon may identify you to your care team only if a post suggests you may be in danger. Counsel drafts the wording. Without that consent the reviewer can only message the member in the app.
- Still owed before go-live (guard condition 4): counsel-approved consent text; retention for removed posts, reports and moderation events (PROPOSED defaults in the spec until then); the erasure behaviour on account deletion (depends on OQ-262); whether membership counts as sensitive personal data on the DPO register.

### OQ-COM-07 Which organisation owns a community group? -- DECIDED
- Decision (founder, 2026-10-09): one Tarragon-owned space. Every group belongs to the Tarragon platform organisation; membership gates access; employers, HMOs, payers, NGOs and sponsors see no community data and no per-organisation counts. This is the one deliberate exception to org-wide filtering and must be documented in the migration header. Requires `/code-review ultra` on the RLS.

### OQ-COM-08 Volunteer (peer) moderators -- DECIDED
- Decision (founder, 2026-10-09): not at launch. Staff moderators only. Revisit in Phase 2 with real data.

### OQ-COM-09 Weight loss and other higher-risk topics -- DECIDED (CMO approval owed)
- 2026-10-12 update (COM-21): the CMO approved the weight group's rules text in chat. Still owed in the system: he presses Approve on the group's rules (the database only accepts his own account).
- Decision (founder, 2026-10-09): the weight-loss group bans weights, calories, target figures and before-and-after posts, and is framed as healthy habits. Diet, detox and fasting claims are held. A pinned reviewed post says when to see the care team.
- Still owed: the CMO approves the group rules text and the pinned post (null-gated review attribution), as an in-system act.

### OQ-COM-10 Links, images, voice notes and direct messages -- DECIDED
- Decision (founder, 2026-10-09): no direct messages ever. No images or voice notes in Phases 1 and 2. Every outside link is blocked; **only links to Tarragon-owned pages are allowed**.
- Build note for the allow-list: parse the URL and match the **exact hostname** against a short list kept in versioned configuration (never a substring or suffix test, so `tarragonhealth.ng.example.com` and `tarragonhealth.ng@evil.com` are rejected). Normalise first (case, punctuation, look-alike characters) so obfuscated links are still caught. The contact filter test fixtures must include allowed, look-alike and obfuscated cases.

---

## Spec amendments to apply to `docs/COMMUNITY_SPEC.md`

1. Section 0 and 1: state that groups are open to Free and paid members alike; no plan gate in any code path (OQ-COM-01).
2. Section 4.3, `contact` row: "any URL or domain" becomes "any URL or domain except an exact-hostname match on the Tarragon allow-list" (OQ-COM-10).
3. Section 4.4 item 5 and Phase 2 care-team task: unchanged, restated as Free = card + own button only (OQ-COM-05).
4. Section 3.1 `community_groups.organisation_id`: always the Tarragon platform organisation (OQ-COM-07).
5. Section 6.1: add the fixed membership call to action rule (OQ-COM-01 consequence 3).
6. Phase 2: remove "peer moderators" from the default scope (OQ-COM-08 is no at launch; revisit only on data).

## What unblocks, and what still blocks go-live

Phase 1 build is **unblocked**: OQ-COM-01 to 04 are decided. The `community` guard stays off until all of the
following are recorded in the system:
1. Named moderators and safety reviewer, with declared hours (OQ-COM-03).
2. CMO-signed filter rule set v1, including the `self_harm` and `emergency` classes (OQ-COM-05).
3. A named human owner and target time for the self-harm queue (OQ-COM-05).
4. Counsel-approved join consent text and retention values (OQ-COM-06).
5. CMO approval of the weight-loss group rules and pinned post (OQ-COM-09).
6. A tabletop run of the safety hand-off with a test account (`is_test`).

### OQ-S04b2-1 Live consent wording that is not on `main-dev` (raised by S04b-2)
- Live `consent_versions` holds a current optional `research` version (migration `20261007220215_consent_research_version`, from `origin/fix/content-approval-reviewer-role`, not on `main-dev`) and a current `sponsor_reporting` version `2026-10-07` (S38e shipped it as a non-current draft). Both are shown to patients today. **Founder decision 2026-10-13: the live `research` and `sponsor_reporting` wording is approved as written, and the `care_circle_sharing` draft (`2026-10-13`) is approved as written but NOT published.** Publishing stays a separate audited superadmin step (`public.publish_consent_wording`, with the `optional_consent_wording` module on). Still open: that branch edits the same consent actions and panels as S04b-2 (names `grantConsentAction` and `recordConsent` kept the same on purpose); `s04_consent_is_optional.sql` fails against live (a current `research` row exists) though it passes on a fresh replay; OQ-S04b2-3 says Care Circle sharing may be redundant.
- Decision:

### OQ-S04b2-2 Closing an account has no automated executor (raised by S04b-2)
- After the grace period an admin reviews the request and marks it completed by hand (the existing workflow). Completing an approved request deactivates the profile (never deleted; that is what lets a required consent be withdrawn under OQ-53), bans the login, writes a withdrawal row for every consent still in force, and is audited. Nothing yet removes the contact details, preferences or device connections, or revokes Care Circle grants; the reviewer's note says what was done. The patient-facing text lists what is removed and what is kept, so an executor must be built to match it, using the S39d registry classes (`operational` removable, everything else kept) and never touching clinical records, audit logs or ledger entries.
- Constraint found in review: `patient_consents.patient_id` and `data_deletion_requests.patient_id` cascade from `profiles`, so the executor must DEACTIVATE the profile (`is_active = false`), never delete it, or the consent history and deletion record that the privacy page promises to keep would be deleted with it. Only `purge_test_account` removes profiles (test accounts).
- Also decided in the migration, for you to confirm: a guardian can record a consent for a DEPENDANT account only with `manage` access (`private.can_act_for(uuid)`), because the caregiver permission enum has no consent permission and consent for a child is a guardian-level act, not a delegable one.
- Options: (a) build a reviewed "close account" function the admin runs from the request, using the registry classes, with a proof (recommended, next session); (b) keep it manual and tracked by checklist.
- Decision:

### OQ-S04b2-3 Care Circle sharing consent may be redundant (raised by S04b-2)
- OQ-313 recommended retiring the `care_circle_sharing` consent type because Care Circle already has its own access grants (a second consent is a second source of truth). The brief for S04b-2 asked to seed it as a draft, so a draft exists, hidden. If OQ-313 (a) wins, delete the draft and do not publish it.
- Options: (a) keep hidden and decide with OQ-313; (b) publish after approval and wire a gate.
- Decision:

---

## S09x: My Health completion (raised 2026-10-13)

### OQ-S09x-1 Should routine staff openings appear in the patient's access log? (extends OQ-281) - RESOLVED 2026-10-13
- Founder decision 2026-10-13: yes, as a basic staff profile only. The patient sees the staff member's name and role (Senior Medical Officer, Chief Medical Officer, Care Coordinator) and when. Never the reason, the basis, any category (reproductive_health included: one generic "your record" line), the staff id, contact details, IP or device. Break-glass and emergency access stay shown and now also name the role. No name: role only. No clinical role (admin account): "Tarragon staff member" with no name (names come only from the clinical staff record). The wording says "Tarragon staff member", not "care team", because an open-basis row is a clinician with no tie to the patient.
- Built in `20261013214514_s09x2_access_log_staff_identity.sql`. No patient-level toggle (not cheap: the config version is CMO-signed and an agent never signs). `access_log.show_staff_opens` is now inert and left as stored; the governed kill switch is `access_log.show_staff_identity` (absent = shown), settable by a future CMO-signed config version without a migration.
- Follow-up OQ-S09x-6: role and name are resolved at read time, not snapshotted, so a promotion changes how an old opening reads. Fixing it needs a role column on `staff_record_opens` and `emergency_record_access_grants` (counsel/DPO may want that for the audit trail).
- Still open for counsel and the DPO: confirm the NDPA basis (OQ-S09x-2). This decision does not wait on it.

### OQ-S09x-7 Staff openings cannot be separated by purpose (raised by S09x2)
- `staff_record_opens` has no column that marks an administrative, support, security or investigation read; it is written only by `open_patient_record` for an active clinician, so every row looks like a clinical open (tied or open basis). S09x2 therefore shows only rows by someone with a `clinical_staff` row, and only openings at or after the release moment (`access_log_staff_identity_since`; earlier history stays hidden). A CMO or clinician opening a record to investigate cannot be hidden from the patient by design until the row carries a purpose flag. Decision needed: add a `purpose` class to the row and to `open_patient_record`, and hide the non-care classes from the patient log. Until then, an investigation by a clinician-account would be visible to the patient.
- Follow-up with OQ-S09x-6: staff role labels are hard-coded English in `private.staff_public_profile` (not in i18n); a future `doctor_tier` value maps to no label and falls back to "Tarragon staff member". Revisit with the snapshot columns.

### OQ-S09x-2 NDPA basis for the emergency card, break-glass visibility and the lock-screen pass (D9, counsel)
- Counsel was instructed (D9). The legal basis is not yet confirmed. The lock-screen pass is off by default (D4), its fields are CMO item C8 (approved text, not signed), and the wallet generator is dormant behind the `wallet_pass` guard, so nothing depends on the answer yet.

### OQ-S09x-3 Add `patient_lock_screen_pass` to the data registry (S39d)
- The table keys on `profile_id`, not `patient_id`, so it is not auto-registered (a `patient_id` column would put an unreviewed row in `data_registry`, which the CMO and DPO review must own). It holds one boolean per person, but the S39d export and purge should still list it. Decision for the registry reviewer.

### OQ-S09x-4 A locked share can be locked by anyone who holds the link
- Five wrong PINs lock a share permanently (the patient revokes it and makes a new one). Someone holding the link but not the PIN can therefore lock a share the patient meant to use. Chosen over a timed lock because a timed lock lets a patient fall back to guessing; revisit if patients report it.

### OQ-S09x-5 Wallet pass credentials (D9 / founder)
- Needs: an Apple Developer Pass Type ID certificate, a Google Wallet issuer account and service account, and a decision on who holds the signing key. When they exist, a session adds the `wallet_pass` conditions branch (`private.go_live_conditions`), the attestations and a `WalletSigner`. Until then `go_live_guard_status` shows the guard with an unmet "no defined condition".

### OQ-S07X-1 Clinic readings live in their own table, not as `source = 'clinic'` on the observation path (raised by S07x)
- The plan said a care-team clinic reading would be a new `source` value on the observation path. Read live on 2026-10-13: `vitals_readings` carries 19 insert triggers (the BP, pulse, SpO2, temperature, glucose and weight red-flag engines, the S12 `observation.recorded` event, the rule event, the monitoring-gap reset and baseline, wellness points, the timeline) and 19 functions and the `observations` view treat every row as the patient's own home log. A `clinic` value would page a clinician for a 150/95 measured in clinic as if the patient had taken it at home, or need every one of them edited.
- Built instead: `clinic_bp_readings` (append-only; a clinician tied to the patient writes through `record_clinic_bp_reading`; staff read; the patient has no policy). Proven: no vitals row, alert, emergency, observation event or notification is created, and `vital_source` has no clinic value.
- Cost: the `observations` view does not list clinic readings, and the patient does not see her own clinic reading in the app. Options: (a) keep as built (recommended); (b) later add a read-only union to the view and a patient-visible policy if the founder wants clinic readings shown to the patient; (c) the original plan, with every trigger and function above edited and proven (large, touches the red-flag surface).

### OQ-S07X-2 What counts as "taking blood pressure medicines" (raised by S07x; needed by C3 and C5)
- C3 (masked uncontrolled vs masked, and no white-coat flag for a treated patient) and C5 (BP-A7 only for a patient on BP medicines) both need this fact. There is no medicine class catalogue until S53. `private.patient_takes_bp_medicines` is true for an active medicine the HEARTS classifier `private.bp_drug_class` knows (the one the clinician ladder uses), or one linked to an active hypertension care plan, or whose indication says hypertension or blood pressure.
- Known gap: a BP medicine the classifier does not know, with no care-plan link and no indication, reads as untreated. For C3 that can wrongly allow a white-coat flag; for C5 it means BP-A7 does not fire. Both outcomes are routine and clinician-reviewed, but the CMO should know the limit before signing v4. Option: add the missing names to `bp_drug_class` (a small migration) or wait for S53.

### OQ-S07X-3 Is the clinician-only pattern flag part of a patient's data export? (raised by S07x, for the DPO)
- `bp_pattern_flags` is registered in `data_registry` with `in_export = false` because C3 says it is never patient-facing. A subject-access request may nevertheless reach it under NDPA 2023. The DPO decides; flipping it is one row in `data_registry`.

### OQ-S07X-4 The edge function must be redeployed before the CMO approves `bp_care_triage` v4 (raised by S07x)
- v4's BP-A7 reads a new input, `onBpMedicines`. The database now supplies it (the server context function is patched in the same migration set); the engine that reads it is in `supabase/functions/_shared/clinical`, deployed with the `process-events` edge function. If v4 were approved while the deployed function was the old build, the old engine refuses the rule set as invalid (it does not know the field), the handler throws and every blood pressure grade dead-letters until redeploy: loud (`event_bus_health()`), but a stall. Redeploy `process-events` from main-dev first (the release-integrity edge-drift job will also flag the stale build), then the CMO approves v4. A missing `onBpMedicines` means unknown and is treated as taking BP medicines (as v3 does), so the phone, which does not know it, still shows the amber guidance for a low reading; only the server, which sends a definite true or false, switches BP-A7 off for a patient it knows takes none.

### OQ-S07X-5 The home check configuration ships inside the app (raised by S07x)
- The phone reads `bp.home_programme` from the code registry (as the other S07 values do); the server reads the signed row. If the CMO signs a changed version, installed phones keep the old protocol until the next build or update, while the server records the result against the new bands. Today the two are identical (a test fails on drift). Moving the phone's read to a synced config is the same follow-up already noted for the other S07 values.

### OQ-S75X-1 PHQ-9 item 9 below the score line (raised by S75 exclusions; RESOLVED 2026-10-14, DECISIONS S75-9: option (a), the gap is accepted)
- The exclusion keeps a person out of every outcome report if their PHQ-9 TOTAL reached 20 (config v4 `safeguarding.score_from`). A person who answered item 9 above zero but scored under 20 is NOT excluded by this rule, because the S75 proof forbids any function on the outcomes path from reading item answers or the crisis flag (a positive item 9 follows the red pathway, not analytics). Their score is therefore in the mental-health figures, which only an admin, an analyst or the CMO read as suppressed aggregates.
- The other build (#1087) excluded them by reading item 9 and the crisis flag. Choose one: (a) accept the gap above, (b) let ONE function read the crisis flag solely to remove a person (and change the scan in `s75_outcome_measures.sql` check 7e to allow exactly that function), or (c) count a person as excluded when an escalation already exists for them. Until decided, v4 stays PROPOSED and inactive.

### OQ-S75X-2 Mental-health outcomes in the sponsor pack (raised by S75 exclusions; RESOLVED 2026-10-14, DECISIONS S75-9: the pack carries PHQ-9 and GAD-7 as suppressed group figures)
- Resolved: the CMO approved PHQ-9 and GAD-7 in the sponsor pack as suppressed group figures only. `private.outcome_measure_cohort` is the single sponsor-side reader of `outcome_mh_snapshots` (total score only, withheld below the minimum cell, never a person). Check 7a of `s75_outcome_measures.sql` names it; 7c and 7d still forbid any sponsor-named function from touching a mental-health object.

### OQ-S75X-3 Activate v4, not v3 (raised by S75 exclusions; for the CMO)
- `outcome_config` v3 (#1094) has no exclusions and v3 is left exactly as written, because a sign-off binds to a version. v4 is v3 plus the exclusions and the PHQ-9 / GAD-7 severity bands. To bring the exclusions in the CMO activates v4 instead of v3; activating v3 gives the measures without them. The sponsor pack and both reports show measure figures only once one of them is active.

## S11 to S15 end-to-end build: questions raised by the six packages (2026-10-13)

From the six package closeouts (`docs/design/S11-S15-*-closeout.md`), de-duplicated by the integration pass. P2's item 9b (a patient without a date of birth rejected on the BP path) is not listed: it was real and is fixed (P6, `withKnownAge`).

### OQ-624 Confirm the canary budgets and chain health thresholds (raised by P1)
- CMO: confirm the values in `chain.canary_and_health` (publish a new version to change; no hub signature needed).

### OQ-625 Synthetic canary organisation in production (raised by P1)
- Founder: the canary adds a synthetic organisation (`metadata.canary`) and three synthetic profiles. Accepted because the legacy BP and symptom triggers notify every clinician in the patient's organisation and ignore `is_test`; a fixture anywhere else would page real doctors.

### OQ-626 External heartbeat for the canary (raised by P1)
- Founder: add an outside monitor that alerts when `chain_canary_runs` stops moving? Today the only independent watcher is the in-database `stale_cron` rule.

### OQ-627 Retiring the legacy BP alerts (D1) (raised by P1)
- Retire nothing until the parity table has run over real readings. The legacy trigger also pages every clinician in the organisation, which the engine's on-call paging does not, so parity is a behavioural difference to decide, not only a grade difference.

### OQ-628 Retention of canary triage events (raised by P1)
- `triage_events` is append-only, so canary events (about 96 a day) cannot be pruned. Hand to the SR3 retention work.

### OQ-629 Signs ticked on the phone are not all stored on the server (raised by P2)
- Nine signs grade on the phone but only four map onto the server symptom log, so server paging for GL-R2, GL-R3, GL-R5 and GL-R7 from phone entries is incomplete. Proposed: add the five missing symptom types (separate enum migration) and send signs through the offline outbox. Decide whether to sign before that.

### OQ-630 Monitor and wearable glucose is not graded by v1 (raised by P2)
- Manual and Bluetooth meter readings only, to protect the connection budget and avoid paging stale lows from bulk syncs. A later version could grade them with a freshness window and dedupe interval from config.

### OQ-631 Both glucose pipelines page after signing (raised by P2)
- A severe low or suspected DKA is paged by the engine and by the older backstop until parity is shown. Proposed: run the divergence report for a stated period, then a count-first retirement migration of the SQL backstop and the two `glucose-red-flags` files.

### OQ-632 Unknown diabetes type is graded as an adult (raised by P2)
- Confirm.

### OQ-633 Ketone cases the decisions did not state (raised by P2)
- Urine moderate or large counts as raised ketones; ketones of 3.0 or more with warning signs are red even under glucose 11.0; nothing between 11.0 and 20.0 without ketones. Confirm or strike.

### OQ-634 Due time of the urgent glucose review and level 1 lows (raised by P2)
- 480 minutes is PROPOSED. A level 1 low opens no task (recurrent level 1 was not chosen).

### OQ-635 Nigerian diabetes guideline check before signing (raised by P2)
- Only the August 2020 draft of the FMoH guideline could be opened (4 mmol/L low line; 13.3 with urine ketones for DKA). The rules use ADA 3.9 and the CMO's 11.0. Check the final 2021 text and the treatment wording.

### OQ-636 Fast-sugar wording needs its own signature (raised by P2)
- Local examples (sweet drink, sugar, honey), 15 g and a 15 minute recheck (the draft says 10 to 15). Sign as wording, separately from the rules.

### OQ-637 Older glucose alerts compare the unrounded value (raised by P2)
- They call 70 mg/dL (3.88 mmol/L) a low; the new rules do not. Expect this as a divergence once the report covers the urgent tier. A bug of the older pipeline.

### OQ-638 Third BP band list in the clinical decision support engine (raised by P2)
- `apps/web/src/lib/cds/engine.ts` carries its own BP bands (200/120, 160/100, 135/85). Allowlisted with a reason; move it onto the rule set.

### OQ-639 Does a delivered push receipt end the unconfirmed wait? (raised by P3)
- `deliveredCountsAsConfirmed` is true per the plan. A silent phone can receive a push nobody sees. Recommend false once real data exists. CMO.

### OQ-640 "I could not get care" opens the call at once (raised by P3)
- `couldNotGetCareOutreachNow` is true. It adds work, never removes any. CMO to confirm.

### OQ-641 Invented timing numbers (raised by P3)
- `undeliveredMinutes` (5) and `expireHours` (6) are invented; confirm.

### OQ-642 Clinician SMS paging cannot send (raised by P3)
- The INV-08 trigger `notifications_suppress_sms_voice` fails every sms/voice insert including clinician pages, so the clinician ladder's last hop can never send. Decide whether to allow clinician SMS once a Termii sender ID exists.

### OQ-643 Emergency contact SMS keeps its old behaviour (raised by P3)
- `emergency_contact_alert` SMS is a named exception in `delivery.ts`. Decide with the open emergency-contact question.

### OQ-644 An unconfirmed task type blocks every triage rule set approval (raised by P3)
- `approve_triage_rule_set` refuses while ANY task type awaits confirmation, so the CMO must confirm both `red_patient_outreach` and `amber_glucose_review` before approving `bp_care_triage` v4 or the glucose rules. Accept, or change the function to look only at task types the rule set uses.

### OQ-645 DPIA for the red-alert channel and answers (raised by P3)
- Add the notification channel and `red_care_responses` (health data about seeking care, retention class proposed `review`).

### OQ-646 Signed document link lands on the home screen after login (raised by P3)
- Login only honours role-home redirects; a deep link after login needs a login change.

### OQ-647 Owner of `notifications.rules` v4 (raised by P3)
- v1 to v3 were owned by the founder, v4 by the CMO. Confirm.

### OQ-648 Second payout approver (raised by P4)
- Who approves when the founder is the only admin? Today the CMO. If neither is available nothing can be released (deliberate).

### OQ-649 Real payout limits (raised by P4)
- Set the `payouts.controls` numbers (per payout, per clinician per 7 days, per batch). Starting values are sized for a small pilot.

### OQ-650 Finance treatment of payouts (raised by P4)
- Account 5200 Clinician fees, expense and cash treatment, and withholding tax (D-09) need sign-off before `payout_gl_posting` is switched on.

### OQ-651 Retention of webhook inbox rows (raised by P4)
- Rejected rows (default 30 days) and verified raw bodies (customer emails): counsel and DPO.

### OQ-652 Audio-fallback table values (raised by P4)
- Real handset readings (3G, throttled, power saving) are needed before the CMO or founder choose the final `video.audio_fallback` values.

### OQ-653 Drug-name list and speech vendor pass mark (raised by P4)
- The CMO corrects `drug-names.json` (it drives the scribe highlight and the ASR scoring) and sets any pass mark (Q19).

### OQ-654 End date for grandfathering the two existing clinicians (raised by P5)
- `grandfather_ends_on` is null (open ended). A date makes them ineligible the day after unless evidence is recorded. CMO.

### OQ-655 Exempting `is_test` clinicians from the verification gate (raised by P5)
- Needed so QA fixtures work; an admin can set the flag. Acceptable?

### OQ-656 Retention and DPIA for credential evidence (raised by P5)
- Verification evidence files (FK RESTRICT; the document purge, still off, must skip them) and ID files. DPO and counsel. A DPIA before any identity vendor pilot.

### OQ-657 Doctors trained locally and DataFlow (raised by P5)
- DataFlow may not cover them; is a written MDCN confirmation or in-person register check acceptable? Three routes are allowed today.

### OQ-348 Fold the two credential ladders (raised by P5)
- Plan in the design note; the CMO signs the revised policy first.

### OQ-349 Does the 20-case early review cover Care Coordinators? (raised by P5)
- Built as no (they take no prescribing or red work). Confirm.

### OQ-658 Lead ineligibility is labelled licence_expired (raised by P5)
- `private.lead_ineligibility_reason` (S18) labels any ineligibility of a clinician with a licence date as licence_expired, so a clinician failing the new gate is recorded under the wrong reason. Needs a new `lead_end_reason` value.

### OQ-659 Licence and cover dates are typed by one reviewer (raised by P5)
- `record_clinician_credential_dates` has no second person and no attached file (a bound and an audit row only). Add maker-checker?

### OQ-660 First caller of the identity adapter must check consent (raised by P5)
- The adapter says the caller proves the consent row exists; no caller exists yet.

### OQ-661 Turn the daily silence and adherence sweep on? (raised by P6)
- It creates `adherence_follow_up` tasks for Members. Born off (`triage_coverage_config`). CMO and founder.

### OQ-662 BP-A4 task beside the existing adherence alert (raised by P6)
- `medicine-adherence-signals-daily` already raises a clinical-rule alert for low adherence; BP-A4 adds a task for the same Member. Keep both or let BP-A4 replace the alert for Members with a BP interest?

### OQ-663 A symptom alone has no engine rule (raised by P6)
- The CMO must sign a rule (a new rule set version, not made here) before the symptom bridge can page.

### OQ-664 Adherence window naming (raised by P6)
- The window comes from `medicine_config.adherence_window_days`; the engine field is named `percent7d`. Confirm they stay 7.

### OQ-665 Stored triage context is re-read when the result is written (raised by P6)
- Not the exact engine input; a symptom landing in that second could differ. Acceptable?

### OQ-666 `clinical_staff_directory` exposes the MDCN folio (raised by the integration pass)
- The view returns `credential_number` to every signed-in user in the organisation, including patients. CMO decision Q17 says the folio is never shown. NOT changed in the integration pass because many screens read it by design: referral letters, lab result PDFs and verified-document PDFs print the issuing doctor's registration number, and the admin search matches on it. Decide per document whether the folio should print, then narrow the view (a column-level change plus a clinician-only function for the places that must keep it).

## S16-S20 hardening: questions raised by the merged task layer (#1139), pager delivery (#1137) and quality v2 (#1135)

All undecided on 2026-10-15. Each has options and a recommendation; the recommendation is the agent's, not a decision. Source notes: `docs/design/S16-S20-task-layer.md`, `S16-S20-pager-delivery.md`, `S16-S20-quality-v2.md`. The CMO's 16 selections these build on are in `docs/DECISIONS.md` (S16-S20-1 to 16).

### OQ-432 Which queue wins for a symptom review that needs a doctor (raised by the task layer)
- The existing symptom triage already raises a `clinician_alerts` review alert; `docs/design/S55-S60-build-plan.md` plans a `symptom_reviews` task with its own SLA. A `symptom_review` task now would put the same review in two queues (the P5 parallel-paging problem). The completion check is ready; no producer existed when the task layer merged. Update after merging `origin/main-dev` on 2026-10-15: S60 (`20261015021409_s60_symptom_review_closes_its_task.sql`) now lets a completed `symptom_reviews` record close a `symptom_review` task, so a task path exists; whether the review alert is still raised beside it has not been checked here.
- Options: (a) the alert stays the only queue and the task type is retired; (b) the task replaces the alert for Members and the alert is suppressed; (c) both, with the alert closing the task.
- Recommendation: (b), decided together with Stage 3 (retire parallel older paging). Owner: CMO and founder.
- Decision: RESOLVED BY BUILD 2026-10-16 on option (b), for the producer that was actually missing. The symptom checker's "a human must look" outcome (`clinician_review_required` on a routine or self-care result, which raised only a `clinician_review` alert) now makes ONE `symptom_review` task for a patient whose plan includes doctor time (`private.patient_may_page_doctor`), with dedup key `symptom_triage:<patient>:<complaint>` so a repeat merges, and no alert beside it. The alert is still raised when the patient is on Free (unchanged; Free keeps today's behaviour, see OQ-678) and whenever the task cannot be made (audit row `symptom_triage.task_error` plus a sev2 incident, the alert is the fallback), so a review is never dropped. Urgent and emergency results are untouched. The rule-set path (`create_tasks_from_triage_event`) already ignores shadow events and Free patients and was not changed. Other `symptom_review` producers (a patient's own request, S59 skin photos, S56 follow-ups, S63) keep working. The CMO confirms or changes this; nothing was signed or confirmed. Migration `*_task_queue_gaps_symptom_producer_prescribing_lead_competency.sql`, proof `task_queue_gaps_oq432_433_435.sql`.

### OQ-433 Should `pharmacy_flag_review` and `admin_clinical` require `prescribing` (raised by the task layer)
- Only the titration producer passes `prescribing` today. A pharmacy-flag task is created by two functions in other sessions' files; whether it needs prescribing authority changes who may take it, so it is a clinical call.
- Options: (a) require `prescribing` for pharmacy_flag_review, leave admin_clinical; (b) require it for both; (c) leave both as they are.
- Recommendation: (a). Owner: CMO.
- Decision: RESOLVED BY BUILD 2026-10-16 on option (a), plus the prescription subtype of `admin_clinical` the type's own note already promised. `pharmacy_flag_review` always requires `prescribing`; `admin_clinical` requires it only when its dedup key starts `prescription:` or `repeat_prescription:` (no producer makes such a task today; the three live producers are psychiatry approval, sleep apnoea referral and mental-health hand-off, none a prescription). Held in `private.task_extra_competencies()`, a PROPOSED code constant (like `contact_attempt_lookback()`), not a `task_types` change, so no row awaits confirmation and the CMO's pack is untouched. Live counts before: 0 open `pharmacy_flag_review`, 0 open `admin_clinical`, 0 pharmacy flags, so nothing is stranded; a task keeps the competencies it was made with. Consequence to know: only one live clinician holds `prescribing`, and `queue_candidates` demands every required competency of every claimant, the CMO included. A pharmacy flag therefore waits in the pool for a prescriber; past its due time it escalates and the CMO is told (D2), but the CMO cannot take it without the competency. Keep the prescribing roster staffed. Still-pooled tasks of these types are widened by the migration's data step (0 live), and a repeat merging into a pooled task widens it too. The CMO confirms or changes this.

### OQ-434 Is 50% the right offer-window fraction, and are the class warning thresholds right (raised by the task layer)
- `queue_task_layer_config` v1: the offer window is the shorter of the type's window and 0.5 x the task's own due time; class warning minutes 60 to 2160; a 5 minute job allowance. All PROPOSED, never signed. There is no real claim data yet to tune them against.
- Options: (a) sign the v1 numbers for the pilot and review after 30 days of claims; (b) change now.
- Recommendation: (a). Owner: CMO.
- Decision: open.

### OQ-435 Skip a lead who lacks a task's required competency at offer time (raised by the task layer)
- `create_clinical_task` offers a task to the patient's lead without checking the lead holds the required competencies; the lead cannot claim it and the offer lapses after at most half the due time. Fixing it changes who is offered what.
- Options: (a) skip the lead at offer time and go straight to the pool; (b) keep the offer and let it lapse.
- Recommendation: (a), because (b) wastes up to half the due time on a task that cannot be claimed. Owner: CMO.
- Decision: RESOLVED BY BUILD 2026-10-16 on option (a). `create_clinical_task` skips a lead who lacks any competency the task requires (a revoked grant counts as missing), and the same check now applies to the employed doctor a pushable task is pushed to (`pick_employed_clinician_competent`). The task goes to a competent pushed doctor, else straight to the pool, and the transition reason records it, for example "to the pool (lead not offered: lacks prescribing)". A lead who holds everything is offered as before. The CMO confirms or changes this.

### OQ-436 An external dead-man check on the queue and paging heartbeats (raised by the task layer and pager delivery)
- `queue_watchdog`, `sweep_pages`, `reconcile_red_pages` and `sweep_paging_health` all run under the same pg_cron they monitor; a dead pg_cron kills the watchers and the console together. The SR1 external monitor (`/api/health/deep`) covers unacknowledged page age and cron freshness but not `queue_job_heartbeats`.
- Options: (a) add `queue_job_heartbeats` ages to `/api/health/deep` and the SR5 ops wall rules; (b) accept the current coverage.
- Recommendation: (a). Owner: founder.
- **Built 2026-10-16**: `/api/health/deep` now also checks `queue_job_heartbeats` (`sweep-clinical-tasks`, `expire-task-claims`, `queue-watchdog`), `paging_heartbeats` (`sweep_pages`, `process_events`, `reconciler`), open sev1 incidents and the canary, through `public.platform_deep_health()`; 200 only when everything is healthy. Setup: `docs/runbooks/external-dead-man-monitor.md`. Still needs a human: the secret, the outside monitor and the named phone (OQ-452).
- Decision: open.
- Decision: BUILT, needs secrets (2026-10-16). Instead of extending `/api/health/deep`, a separate read-only endpoint `/api/health/deadman` (migration `20261016185500_oq436_deadman_status.sql`, `public.deadman_status()`, service_role only) reports the `process_events` heartbeat age, deliveries due and unclaimed, dead letters and open sev1/sev2 incidents, and `.github/workflows/deadman-switch.yml` polls it every 5 minutes from a GitHub runner (outside Supabase and Vercel), opening or updating one `incident` issue and closing it on recovery. The paging logic is untouched. Thresholds are PROPOSED config `ops.deadman_thresholds` (founder to confirm). NOT watched yet: `queue_job_heartbeats` ages (the queue watchdog) are not in the endpoint; add them in a follow-up if wanted. **Founder steps (the workflow fails red until the first two exist):**
- Decision: BUILT, needs secrets (2026-10-16). Instead of extending `/api/health/deep`, a separate read-only endpoint `/api/health/deadman` (migration `20261016190347_oq436_deadman_status.sql`, `public.deadman_status()`, service_role only) reports the `process_events` heartbeat age, deliveries due and unclaimed, dead letters and open sev1/sev2 incidents, and `.github/workflows/deadman-switch.yml` polls it every 5 minutes from a GitHub runner (outside Supabase and Vercel), opening or updating one `incident` issue and closing it on recovery. The paging logic is untouched. Thresholds are PROPOSED config `ops.deadman_thresholds` (founder to confirm). NOT watched yet: `queue_job_heartbeats` ages (the queue watchdog) are not in the endpoint; add them in a follow-up if wanted. **Founder steps (the workflow fails red until the first two exist):**
- Decision: BUILT, needs secrets (2026-10-16). Instead of extending `/api/health/deep`, a separate read-only endpoint `/api/health/deadman` (migration `20261019204512_oq436_deadman_status.sql`, `public.deadman_status()`, service_role only) reports the `process_events` heartbeat age, deliveries due and unclaimed, dead letters and open sev1/sev2 incidents, and `.github/workflows/deadman-switch.yml` polls it every 5 minutes from a GitHub runner (outside Supabase and Vercel), opening or updating one `incident` issue and closing it on recovery. The paging logic is untouched. Thresholds are PROPOSED config `ops.deadman_thresholds` (founder to confirm). NOT watched yet: `queue_job_heartbeats` ages (the queue watchdog) are not in the endpoint; add them in a follow-up if wanted. **Founder steps (the workflow fails red until the first two exist):**
  1. GitHub, Settings, Secrets and variables, Actions, new repository secret `DEADMAN_STATUS_URL` = `https://<production app host>/api/health/deadman`.
  2. New repository secret `HEALTH_CHECK_SECRET` = the same value as the `HEALTH_CHECK_SECRET` environment variable on the Vercel production project (at least 24 characters; if Vercel does not have it yet, generate one, set it in Vercel, redeploy, then use the same value here).
  3. Optional email: secrets `RESEND_API_KEY`, `DEADMAN_EMAIL_TO` (comma separated), `DEADMAN_EMAIL_FROM` (a sender verified in Resend). Skipped with a notice unless all three exist.
  4. Run the workflow once by hand (Actions, Dead-man's switch, Run workflow) and confirm it is green; then create the second-layer third-party monitor described in `docs/PLATFORM_OUTAGE_RUNBOOK.md`.
  Caveats: GitHub cron is best effort (late or skipped runs), which is why the runbook adds the independent third-party monitor; the repository is public so the issue carries counts and ages only.

### OQ-437 Are the delivered-ack numbers right (raised by pager delivery)
- PROPOSED in `paging_delivery_config`: 90 seconds early advance (180 seconds for a route not confirmed), a 30 minute merge window, a 7 day test page, 120 seconds before a heartbeat is stale, a safe band of 100-139 / 60-89 for the urgent first hop.
- Options: (a) sign as shipped; (b) change before signing. The 5 and 10 minute timers are unchanged either way.
- Recommendation: (a), review after the first drill. Owner: CMO.
- Decision: open.

### OQ-438 Staged roll-out of the objective on-call readiness gate (raised by pager delivery)
- `paging_delivery_config` v1 is active with readiness OFF; v2 (same rules, readiness ON) is inactive and unsigned. Turning it on means each on-call clinician needs a working push subscription, a verified email and a test page acknowledged in 7 days before being added or swapped in; existing shifts are not cancelled. Urgent swap acceptance is also covered.
- Options: (a) activate v2 once everyone on the rota has passed a test page; (b) activate for new shifts only; (c) leave off.
- Recommendation: (a), with the pre-sign checklist in `docs/plans/S16-S20-cmo-signoff-pack.md`. Owner: CMO.
- Decision: open.

### OQ-439 Should the "expired" alarm come sooner than the lead's 12th repeat (raised by pager delivery)
- `expired` is reached after the lead's 12th repeat, about 70 minutes after the first page with today's `paging.rules`. The level 2 alerts and the `page_unanswered` incident already fire at 10 minutes.
- Options: (a) keep; (b) expire after the second timer plus one repeat (about 25 minutes).
- Recommendation: (b) for red events. Owner: CMO.
- Decision: open.

### OQ-440 Up to 15 seconds for a red grade that arises from a normal-looking reading (raised by pager delivery)
- Inside the safe band a blood pressure event waits for the 15 second cron; outside it, or for any red-flag symptom regrade, it is urgent. A red grade that comes from an in-band reading plus a symptom logged earlier waits up to 15 seconds.
- Options: (a) accept; (b) make every event urgent (risks flooding the edge function on a bulk upload); (c) look up open symptoms in the first-hop decision.
- Recommendation: (a) for the pilot. Owner: CMO and engineering.
- Decision: open.

### OQ-441 Who is the named ops person who phones when a page expires (raised by pager delivery; decision S16-S20-10)
- The incident `page_expired:<id>` ("Phone the on-call clinician now") currently goes to the ops incident queue and to every admin account. Decision 10 makes a named person the final fallback and no such person is named.
- Options: name a person and a deputy in config; or the founder until a hire.
- Recommendation: name both before the readiness gate is switched on. Owner: founder.
- Built 2026-10-16 (the mechanism, not the people): an ops desk roster (`ops_desk_contacts`, hours in Lagos time, active only with a phone number the person has confirmed on their own account), assignment of the incident to the primary on duty then the deputy after `deputy_after_seconds` (300, PROPOSED), a sev1 when nobody is on duty, an append-only call log, an attestable resilience checklist (backup power, second internet link, tested numbers, deputy cover) and a checklist gate on the on-call cover guard that ships OFF (`ops_desk_config` v2, inactive, unsigned). Runbook `docs/runbooks/ops-desk-expired-page.md`. Screens: `/admin/ops/desk`, `/clinician/ops-desk`.
- Still needed from a human: the founder names the primary and the deputy, each confirms their phone number on their account and the hours cover all 24; buy and test the backup power and second link and attest them; the CMO confirms the 5 minute deputy time and the 2 minute call gaps and decides whether to sign v2. No name, number or attestation was entered by the agent.
- Decision: open (the people are still unnamed).

### OQ-442 A repeat red event is silent while a page family is unacknowledged (raised by pager delivery)
- A merged repeat is recorded and counted but sends nothing new to the on-call clinician, who is already being alerted. The alternative is one re-send per merge window.
- Options: (a) keep silent; (b) one re-send per window.
- Recommendation: (a). Owner: CMO.
- Decision: open.

### OQ-443 Patient care-team notices now reach the patient's email (raised by pager delivery)
- `care_team_notice` used to fail with "no email address"; with the address resolver it now sends, treated as patient mail for quiet hours and discreet wording.
- Options: (a) keep email on; (b) in-app and push only for these notices.
- Recommendation: (a), if the wording is signed as neutral. Owner: CMO and founder.
- Decision: open.

### OQ-444 What a second audit reading means when the two differ (raised by quality v2)
- The second reviewer's reading is final when the two differ; both stay on record and the disagreement is flagged.
- Options: (a) as built; (b) a third reader on disagreement.
- Recommendation: (a) while there is only one CMO and a second reviewer is scarce (OQ-138). Owner: CMO.
- Decision: open.

### OQ-445 Who appoints the independent speak-up reader, and how they log in (raised by quality v2)
- The lead names the independent reader, so the lead chooses who hears concerns about the lead. An outside person needs an account (role `patient` with no clinician record works).
- Options: (a) the founder adds the first independent reader once through SQL and the lead cannot remove the last one; (b) CMO plus founder confirmation; (c) an outside body.
- Recommendation: (b). Needs a name first (decision 7 [verify]: who the independent guardian is). Owner: founder and CMO.
- Decision: open.

### OQ-446 Is invented scribe content a critical miss (raised by quality v2)
- Built as a critical miss, which triggers the second reviewer and, with a critical outcome, the reliability event.
- Options: (a) critical miss; (b) a quality deduction only.
- Recommendation: (a) until the first AI-017 evaluations are in. Owner: CMO.
- Decision: open.

### OQ-447 Scribe note link by time window or by task id (raised by quality v2)
- The audit finds the scribe note by author, patient, consent and a time window around the claim, not a foreign key. A key needs S23 to store the task id on the note.
- Options: (a) accept the window; (b) add the task id in S23.
- Recommendation: (b) when S23 is next touched. Owner: engineering.
- Decision: open.

### OQ-448 Speak-up check-ins after a concern is closed (raised by quality v2)
- Check-ins go out 30 and 90 days after raising whether or not the concern is closed (config is inert until signed).
- Options: (a) continue after closure; (b) stop at closure.
- Recommendation: (a), because detriment often follows closure. Owner: CMO.
- Decision: open.

### OQ-449 Licence dates for active clinicians and the 15 December deadline (raised by quality v2)
- `credentialing_config` v4 makes a missing licence date ineligible and cannot be activated while any active clinician lacks a date. Read-only check on 2026-10-15: two active clinician records have no date, one of them a test account. The 15 December proof notice is sent once per clinician per cycle; the expiry sweep suspends at 31 December without grace.
- Options: (a) enter the real dates (and retire or date the test account) then sign v4; (b) sign v4 later.
- Recommendation: (a). Owner: CMO. Also confirm the MDCN licence cycle [verify].
- Decision: open.

### OQ-450 Should the audit case file hide reproductive-health content from the reviewer (raised by quality v2)
- The case file shows only conversations the audited clinician wrote in during the work, with an age band, and applies no access-category gate, so a reviewer could read reproductive-health content.
- Options: (a) governance review of the clinician's own conversations is enough; (b) apply the category model and redact.
- Recommendation: (b), because CLAUDE.md warns against reproductive-health access that skips the category check. Owner: CMO and DPO.
- Decision: open.

### OQ-451 The sign-off hub has no panel for the paging and task layer configs (raised by the evidence pass)
- `quality_config` and `credentialing_config` have hub panels and signing functions. `paging_delivery_config` (activate v2) and `queue_task_layer_config` (a new version) have neither a hub line nor a signing function, so activating the readiness gate today needs SQL, and CLAUDE.md says anything the CMO signs belongs on the hub. The registry values (`queue.*`, `paging.*`, `lead.*`) are signed as proposed values in `/clinician/go-live`.
- Options: (a) add hub lines and signing functions for both tables; (b) keep SQL activation by a database owner.
- Recommendation: (a), before the readiness gate is switched on. Owner: engineering.
- **Built 2026-10-16 (option a)**: hub lines "Task layer rules" (`sign_queue_task_layer_config`) and "Pager readiness gate" (`activate_paging_delivery_config`, which refuses with a reason list until every on-call clinician has a working push subscription, a verified email and a test page acknowledged in the window), both counted in the banner. Nothing was signed or activated by the build; both versions stay as they were until the CMO acts.
- Decision: open (the signing and the activation are the CMO's).
### OQ-S57-01 Library content, creators and what the build could not create (S57, 2026-10-07)
- Built: the structure for the meditation and sleep library (`media_library`, publish gate, expiry read rule, series: intro, stress, grief, work, exams, faith-compatible reflection, sleep), 12 DRAFT placeholders (none servable), admin page `/admin/settings/media-library`. NO audio, script, prompt, spiritual text or clinical wording was written. Every real item needs an author, a named reviewer, a review date and, for audio, a recorded file with length and size.
- Faith-compatible reflection ships as an empty series with a placeholder. Who may write or approve spiritual content, and whether it needs a faith-leader reviewer as well as the CMO, is a founder decision. Decision: open (founder, CMO).
- S55 creators are not on this base. `media_library.creator_id` is a plain nullable uuid; the migration adds the foreign key and the "creator must be verified" check only if `learning_creators` exists when it runs (so S55 before S57 gives both). If S57 applies first, a follow-up migration must add the key. Creator pay or revenue share: not built (see OQ-S55-02).
- Language: the column exists and defaults to English. D-14 removed Pidgin and local-language UI; "local-language content by Nigerian creators" (10.9) is therefore structure only. Decision: open (founder), whether creator-led audio in Yoruba, Igbo, Hausa or Pidgin is allowed under D-14.
- The expiry flag job (`media_library_flag_expired`) is a function an admin can press; it is NOT scheduled. The read rule hides an expired item at once without it. A cron route calling it daily is a follow-up (the read rule makes it display-only).

### OQ-S57-02 Snoring and sleepiness questionnaire is a DRAFT, unsigned, behind a guard that is off (S57)
- `sleep_apnoea_screen_config` v1: eight yes/no items and a cut-off of 3, in the build's own wording, "STOP-Bang style" but NOT checked against the published tool. PROPOSED, owner CMO, unsigned. Two of the eight (body mass index above 35, neck size) are things many people do not know; "not sure" scores 0, which can under-flag; the CMO should decide whether to ask for height, weight and neck size and compute, or to score "not sure" differently.
- Until the CMO confirms (`confirm_sleep_apnoea_screen_config`, CMO only, never called by the build), the questionnaire saves answers and shows no result and creates no task, even with the guard on (proved). With it signed AND guard `sleep_apnoea_screen_enabled` on AND the cut-off met it creates one `admin_clinical` task (existing type; the referral competency routes it). Guard conditions: instrument signed (data), referral cover confirmed (attestation).
- There is no screen in the CMO sign-off hub for this instrument: confirming means calling the function. Adding a panel to `/clinician/clinical-signoff` is a follow-up. Changing items or the cut-off means inserting a new proposed version (SQL), then confirming it; no editor exists.
- Staff read the answers only through `read_patient_sleep_screens_audited` (tie or break-glass, audited). The older `sleep_log_entries` and `patient_sleep_goals` tables still use org-wide staff reads (not moved, same as OQ-S56-01's list).
- The older rule that raises a clinician alert for a very short night plus high sleepiness (`flagAbnormalSleep`) is unchanged.

### OQ-S57-03 PROPOSED values the build chose (S57), all unsigned
- `media_library_config` v1: download caps 5 MB a track and 50 MB a pack, Wi-Fi only; breathing length 3 to 5 minutes and no phase over 10 seconds; the smallest weekly sleep change worth mentioning (2 percentage points); a listen of 30 seconds counts as a session. The breathing PATTERN (seconds per phase) is not in config: it is set per item by the reviewer. The CMO or founder confirms or replaces them. Decision: open.
- The guard `wellbeing_library_clinical_scripts` (exercises and breathing scripts) is OFF; conditions are two attestations (scripts reviewed, care-team and crisis note confirmed). A test account always passes.

### OQ-S57-04 What is not built on the phone and why (S57)
- Audio playback and file downloads on mobile need native modules (an audio engine, a network state probe, file storage), i.e. a new app build and a `runtimeVersion` bump (same wall as OQ-201). The phone shows the library, exercises, paced breathing in words, the private journal, the wind-down planner, the weekly view and the questionnaire; for an audio item it says audio plays on the web for now. The Wi-Fi and size-cap decision (`downloadDecision`, `planPackRefresh`, with a refresh that never empties the pack) is pure, shared and tested; `mayDownload` never assumes Wi-Fi without a probe, so nothing downloads. S55's offline pack is not on this base; when it merges, adopt it instead of this seam.
- Web has no download (spec says downloads are a phone feature). S32's audio manifest is for bundled prompts, not creator audio, so `audio_clip_id` is an unused seam.
- No wind-down reminder is offered: a local notification needs the permission flow and a build, and a control that does nothing would be a false promise. The `reminder_enabled` column stays false for a later session; the reminder's words should be fixed and name nothing.
- Mobile sleep diary entry (latency, wakings) is not added to the phone's existing logging screen; the weekly view reads whatever the web diary stored.
- S33 BRE-01 is not on this base: a minimal in-house paced breathing component (web, circle plus words, reduced-motion aware) and a words-only version on the phone are built. When S33 merges, replace the renderers and keep the data seam (the library item).

### OQ-S57-05 Private journal: key custody and recovery (S57)
- The key is generated on the device and never leaves it. A new phone, a cleared browser or a lost key means synced copies cannot be opened (the server holds only ciphertext). That is the privacy guarantee and also a loss risk. Options: accept (recommended; the screen says so), add a recovery phrase, or add a passphrase-derived key. Decision: open (founder).
- On the web the key sits in IndexedDB next to the entries, so it protects against the server, backups and a casual look, not against someone controlling the browser profile. On the phone it is in the secure store.
- Turning backup off deletes every server copy (proved). There is no staff, Care Circle or break-glass read path of any kind (proved). A person who asks Tarragon to "export my journal" gets nothing from the server by design; DSR handling (OQ about data rights) should say so.
- Listening history (`media_sessions`) is patient-only and carries what the patient chose to open (for example a grief series). No staff or Care Circle path reads it. S58 rewards may use the `media.session_completed` event, which carries only the session id.

### OQ-S57-06 Deferred and recorded only
- 10.12 structured insomnia and anxiety programmes: deferred to Module 14 (S63) as planned. Nothing built.

### OQ-S57b-01 Sourced redraft of the sleep questionnaire (C12): what is verified and what is not (S57b)
- Redrafted in place (the S57 migrations were not yet live): the eight items now follow the published STOP-Bang tool, in the build's own wording; BMI is computed from height and weight (above 35), neck is a number in cm (40 or more), "not sure" scores one point. Sources and the full list of unverified points are in `docs/research/S57b.md`. Still an UNSIGNED draft; `confirm_sleep_apnoea_screen_config` was not called.
- NOT verified, for the CMO and counsel before confirming: (1) the licence: search results say the instrument belongs to University Health Network (Toronto) and a commercial use may need written permission; I could not open stopbang.ca; (2) neck threshold operator (the published form says 40 cm or larger, the original paper above 40 cm); (3) a cut-off of 3 in a Nigerian primary-care population (about 88 percent sensitivity and 42 percent specificity in the general-population meta-analysis, so many referrals will not have the condition); (4) whether to hide it under 18 (developed in adults); (5) "not sure scores a point" is a Tarragon design choice (config `unsure_points`; set 0 to change). Decision: open (CMO, counsel).

### OQ-S57b-02 crisis_follow_up task type needs the CMO's confirmation, and blocks rule-set approval until then (S57b, closes OQ-F1-03's second half)
- New task type `crisis_follow_up` (class 1, due at once, no lead window, senior medical officer, on_call), created as `needs_confirmation`. The crisis trigger now creates it instead of reusing `red_event_unacknowledged`; page recipient, idempotency and the loud failure path are unchanged (proved). Tasks made before this keep their old type.
- Side effect, deliberate: `approve_triage_rule_set` refuses while any task type awaits confirmation, so no triage rule set can be approved until the CMO runs `confirm_task_type('crisis_follow_up')` (same mechanism as `adherence_follow_up`). Crisis tasks are created whether or not it is confirmed. Decision: open (CMO confirms class, tier and competency).

### OQ-S57b-03 Daily expiry job (S57b)
- pg_cron job `media-library-expiry-sweep` runs daily at 01:25 UTC (02:25 Lagos), calls `private.media_library_expiry_sweep()`, audits what it flagged, and on any failure writes an audit row and opens an ops incident. `media_library_expiry_sweep_health()` (admin) reports the last run. No console tile shows the health yet (follow-up). Display-only: the read rule already hides expired items.

### OQ-S57b-04 Faith-compatible reflection and the draft scripts (S57b)
- A `faith_reflection` item cannot publish without a named faith-leader reviewer (name, role, date) as well as the clinical reviewer (proved). The CMO writes the content; the two faith drafts the content agent wrote in `docs/content/meditations/med-faith-*.md` were NOT seeded.
- 24 DRAFT narration scripts (10 meditation, 8 sleep, 6 breathing) are seeded from `docs/content` for the CMO to read in Settings, Calm and sleep library. All are placeholder, draft, not live, no audio, no reviewer, not servable. A script cannot publish as it stands even if the placeholder flag is cleared (no audio file; a breathing item has no steps or pattern). Found and fixed on the way: the publish gate let a script with NO `steps` key through (a NULL comparison); the fix is in the S57 media-library migration and the new proof covers it. The folder README and manifest list the myth-busting and BP micro-lesson drafts too; those belong to S55 and were not seeded here.
- The seeded breathing scripts are spoken guides; the machine-readable pattern and steps the breathing component needs must be added by the reviewer before publishing. Decision: open (CMO).

### OQ-S57b-05 Offline downloads built but inert (S57b)
- See `docs/design/S57b-offline-downloads.md`. Behind flag `mobile_offline_downloads` (OFF), needs a new EAS native build and a `runtimeVersion` bump (NOT done), never run on a real device. Integrity is size only until `media_library` gains a SHA-256 column (follow-up). Playback still needs a native audio engine (OQ-S57-04). Wind-down reminder left out (item 7): the in-app inbox route would be a notification that exists only to nudge, and OQ-S57-04's point stands that the words should be fixed and name nothing; not trivial enough to add safely here.

## Raised by S52 (AI health assistant 2 of 2)

### OQ-667 The emergency and self-harm wording is PROPOSED, and no hotline exists (raised by S52)
- The words in `packages/shared/src/assistant-emergency.ts` (the emergency guidance, the self-harm copy, the limits text) are written by a build session and are NOT signed. The self-harm copy is a clinical document. Nigeria has no usable national crisis helpline, so the copy points to the nearest hospital, the patient's emergency contact and the on-call page; `assistant.emergency.phoneNumbers` is empty on purpose and a number is shown only once the CMO adds one.
- Options: (a) CMO reviews and signs the wording, and adds any hospital desk number to configuration (recommended); (b) counsel review for the self-harm copy.
- Decision: open (CMO).

### OQ-668 The self-harm on-call page is not an S19 page row (raised by S52)
- S19 pages hang off a graded triage event, and a shadow grade (unapproved rule set, OQ-88) never pages. So a self-harm message raises the same class 1 task as the wellbeing-crisis fix (key `crisis:<patient>`), the neutral on-call notice, and the existing emergency escalation ladder as the second line, but no `pages` row and no S19 acknowledgement timer.
- Options: (a) once a crisis rule set is approved, route assistant crisis through `create_red_page` too (recommended); (b) leave.
- Decision: open.

### OQ-669 Silence signal consumption by the triage engine (raised by S52)
- `assistant.silence_detected` is written to the outbox. The triage engine's own silence trigger reads readings, not assistant messages, and a rule that reads this event needs the CMO's rule-set sign-off. Nothing consumes the event yet and it changes no treatment.
- Decision: open (CMO, with the triage rule set).

### OQ-670 Who may review (raised by S52)
- Only the Chief Medical Officer can open the monthly review, in line with "the clinical lead can audit every conversation". A second reviewer (a senior clinician with a tie) would need a purpose-built grant. The reviewer page lives in `apps/web` under `/clinician`, not in the console (OQ-99 and OQ-209).
- Decision: open (CMO).

### OQ-671 AI-020 needs its governance criteria before it can be switched on (raised by S52)
- AI-020 is registered disabled and the governance trigger refuses enabling it until evaluation, validation, guardrails and monitoring are in place (all outstanding). Memory therefore reads as "not switched on yet" to patients. No evaluation run, version approval or guardrail was seeded. Code AI-020 was chosen to avoid colliding with codes other sessions may take.
- Decision: open (CMO).

### OQ-672 How fast a cut-off self-harm page is retried (raised by S52 round 5)
- The page is now durable: a queue row is committed first, the wait is bounded, a still-running page is kept alive past the response, and `assistant_page_retry_due()` re-attempts any page still pending. The retry runs from the daily `assistant-silence` cron and after every later self-harm page (any patient). Sub-daily crons are not available on the current Vercel plan, so a page cut off with no further message from that patient can wait up to a day for its retry if no other self-harm page happens first.
- Options: (a) accept, the emergency escalation on its own SLA ladder is the second line (recommended until a Pro plan or a database scheduler is chosen); (b) move the retry to a database scheduler (pg_cron) or a Railway worker.
- Decision: open (founder, with the Vercel plan decision).

### OQ-673 The daily nudge no longer reaches test accounts (raised by S51 round 5)
- By coordinator instruction the nudge cron excludes `is_test` patients, so the nudge cannot be exercised end to end with a test account before `assistant_enabled` is on. It can be proved by the database proof (which stands in for the guard) and by calling `assistant_queue_nudge` directly.
- Decision: open (founder).
### OQ-S55-13 Weekly pacing replaces the daily lesson card (founder decision 2026-10-07)
- The founder prefers weekly lessons. `daily_micro_lesson()` is replaced by `weekly_micro_lesson()`: one lesson per programme week, chosen with the existing drip engine (`drip_week` against `private.health_education_unlock_week(condition)`, per-condition clocks), each at most the `micro_lesson` config minutes (5, PROPOSED). A lesson finished this week stays shown as done until the programme week turns over; an unfinished earlier lesson is offered only when nothing newer is due. Copy says "This week's lesson" on web (dashboard, Learn) and mobile (Home, Learn); the generic Today task label `today.kind.read_lesson` now reads "Read your lesson" (it is not tied to the weekly lesson). Events `lesson.completed` and `course.completed` are unchanged. The `micro_lesson` config key keeps its name (it describes the lesson shape, not the cadence).
- Offline the phone cannot work out the programme week, so it shows the lesson the server last chose for this person (kept on the phone) while it is still downloaded and in date, else the first in-date micro-lesson.
- Recorded, not changed: when a drip week holds more than one micro-lesson only one is offered per week (a missed one is offered only in a week with nothing due); the offline card does not know whether the lesson was finished this week.
- Open: lessons with no `drip_week` are available in any week and sort after dated ones; the CMO should set `drip_week` on every micro-lesson when authoring so weeks do not repeat or skip.
- Decision: founder decided; the drip_week authoring note is open.

### OQ-S59-01 What is signed before the assessment half can open
- Nothing in S59 is signed. Needed: the CMO signs the urgency map (`symptom.urgency_map`), the context entries (`symptom.context_tightening`, six drafts including the pregnancy branch), and confirms `symptom.dependant_policy` and `symptom.context_window_days`; the founder and counsel confirm `symptom.skin_photo_policy`. The checker stays OFF.
- Decision: open (CMO, founder).

### OQ-S59-02 The six levels are derived from four categories
- A four-category result cannot fully determine six levels. The draft map uses one extra input, "a clinician was asked to look", so "see a pharmacist" is reachable only from a self-care result with review. The CMO may want a richer input (an outcome-node flag) and would then need a protocol change. Until signed no level is shown.
- Decision: open (CMO).

### OQ-S59-03 Context entries are placeholders
- Drug names, thresholds (systolic 180, oxygen 92), the age band (4) and the categories in `symptom.context_tightening` are unverified placeholders. An unknown input never matches, by design (so more input can only raise a result), so a person with no date of birth or record gets no tightening. Confirm that is acceptable, or require a date of birth for a check.
- Decision: open (CMO).

### OQ-S59-04 Children are run through the adult pathways until paediatric pathways are signed
- The dependant policy (live, proposed) stops a known child being reassured below routine and asks a clinician to look. The three paediatric pathways exist only as an unsigned draft protocol row. Until signed, the picker offers adult pathways to a carer. Option: block the checker for under-age subjects until signed. Recommend: CMO reviews and signs the paediatric draft before the checker opens.
- Decision: open (CMO).

### OQ-S59-05 Signing the paediatric draft replaces the whole active protocol
- The draft carries the pathways active when it was made. The older v2 draft (adult fever, abdominal pain) is a separate row; signing one drops the other's additions. The CMO should merge into one draft before signing. Also, the bundled red-flag floor must be updated when a signed protocol changes a red flag (OQ-S60-09).
- Decision: open (CMO).

### OQ-S59-06 Booking is adults only, summaries for children are not offered
- OQ-129 stops a child being booked, so a carer's check for a child offers messaging, labs and clinics but no summary hand-off. Confirm that is wanted, or decide how a child's concern reaches a clinician (for example a carer booking an adult consultation to discuss it).
- Decision: open (founder).

### OQ-S59-07 Photos: retention job, intimate areas, children
- The job that deletes expired photo files is not built (SQL cannot remove hosted storage files); `skin_photos_due_for_purge()` lists them and `mark_skin_photo_purged()` records removal. A server job is needed before the checker opens. Intimate body areas are not offered. Photos of children sent by a carer are allowed; counsel should confirm. Retention values (30 and 90 days) are proposed.
- Decision: open (founder, counsel).

### OQ-S59-08 Summary visibility window and pregnancy
- A summary is visible to staff only while its linked consultation is open; it disappears afterwards (the patient still has it). Pregnancy ticked in a check is never copied into the summary, so a clinician learns it at the consultation. Confirm.
- Decision: open (CMO).

### OQ-S59-09 Mobile and voice
- No mobile checker screen or voice input was built (the only seam is the on-device red-flag floor from S60, and wording needs CMO sign-off). Recorded as deferred.
- Decision: open (founder).

### OQ-S59b-01 Children are refused until a paediatric protocol is signed; a date of birth is required
- Founder and CMO decision 2026-10-07, built: the database (trigger `symptom_triage_assessments_01_age_gate`) and the app refuse anyone under 18, and anyone with no date of birth. "Signed" means the ACTIVE protocol contains a pathway whose key starts `paediatric_`. A carer sees a calm state, can message the care team, and can book an ADULT consultation under their own account with the child's concern as free text (kept in the browser tab's session storage, never in a URL, and sent as the booking `reason`). The `symptom.dependant_policy` layer stays for when a paediatric protocol is signed.
- Seam recorded: consultations are adults only (OQ-129), so the booking is the carer's, not the child's. The booking page does not yet show the note back to the carer before booking. Confirm this wording and that a carer-as-adult booking is acceptable clinically.
- Decision: open (founder, CMO).

### OQ-S59b-02 The bundled red-flag floor must change in the same commit as a signed chest pain change
- Draft protocol `S59b draft: chest pain...` (inactive, unsigned) removes the severity floor (signed v1: 6) from `chest_pain.cardiac_pattern`. The bundled on-device floor and `db-seed-fixture.json` are kept equal to the SIGNED protocol, so they still say 6. When the CMO signs the draft (or the merged one) those two must be updated together. Guards: `floor-drift.test.ts`, and the server raises a Sentry error on every check where the active pathway's red flags differ from the bundled ones. Offline, the phone is looser than the signed rules in that window, which is the reason to update them straight away.
- Decision: open (CMO to sign; engineering to update the bundled copy at that moment).

### OQ-S59b-03 Reviews are for Members; skin photos are not yet
- `request_symptom_review` now needs Membership (`private.patient_is_member`, SQLSTATE TM001); Free people see the result, self-care steps and the message route. A request already on file is still returned after a membership ends. Skin photos for a doctor to review are also a doctor-time item but were NOT gated (not asked). Decide whether `register_skin_photo` should require Membership too.
- Decision: open (founder).

### OQ-S59b-04 Staff read of symptom assessments closed; override and monitoring moved
- The org-wide staff SELECT and UPDATE on `symptom_triage_assessments` are gone. Staff read through `read_symptom_session_audited` (tie, audit). The clinician override is now `override_symptom_assessment` (tied, audited, reviewing tier). `triage_safety_monitoring` was granted to every signed-in person (it runs as its owner); it is now served by `symptom_safety_monitoring()` to an admin or the CMO for their own organisation. No application code read these directly (a scan test enforces it), so no screen changed. Confirm no external consumer (BI, support tools) relied on the old view grant.
- Decision: open (founder).

### OQ-S59b-05 C4 prevalence redraft is for the CMO
- `symptom.risk_tightening` version 2 (draft, unsigned, inert): malaria (months 4 to 10) and Lassa (months 12 to 4, states Edo, Ondo, Bauchi, Taraba), with sources. Typhoid and sickle cell dropped (no signed pathway asks them). Sources, and what I could not verify, are in `docs/research/S59b.md`.
- Decision: open (CMO).

### OQ-S59b-06 C5 context redraft is for the CMO
- `symptom.context_tightening` version 2 (draft, unsigned, inert, raise-only): thresholds checked against NICE NG133, the 180 over 120 hypertensive line and NEWS2 (secondary summaries only; primary texts not opened). See `docs/research/S59b.md`.
- Decision: open (CMO).

### OQ-S59b-07 C8 merged draft protocol for the CMO
- One draft version now carries: signed adult pathways (chest pain without the severity floor), the adult v2 pathways (fever, abdominal pain) and the three paediatric pathways (young infant is under 2 months, IMCI group). Signing it replaces the whole active config. The older v2 row remains as a superseded draft. Paediatric content is NOT independently clinically reviewed. Until signed, nothing about children changes (the checker refuses them).
- Decision: open (CMO).

### OQ-S59b-08 Mobile checker was not run on a device
- The mobile screen (`symptom-checker-card.tsx`) type-checks and its pure model is tested, but it has not been run on a phone or simulator in this build, and it answers for the signed-in person only (a carer uses the web). It calls `/api/mobile/symptom-check`, which reuses `runSymptomStep`.
- Decision: open (needs a device test).

### OQ-S59b-09 Photo purge job needs its cron secret in production
- `/api/cron/skin-photo-purge` (daily 03:35) uses the existing `CRON_SECRET`. It answers 500 and reports to Sentry per failed photo; a failed removal never marks the record purged. Nothing is due while the checker is OFF.
- Decision: none (verify `CRON_SECRET` is set).

### OQ-674 The CMO-signed escalation ladders still name sms (raised by S85-D3)
- `escalation_slas` v8 (signed) lists `sms` as a rung (urgent and emergency ladders, and the built-in default push, email, sms). D3 allows SMS only for clinician paging. In code, the sender now refuses SMS to anyone who is not a clinician and records the refusal, so nothing reaches a patient by SMS regardless of the row. An agent must not edit a signed row.
- Options: (a) the CMO signs a v9 that removes `sms` from every patient-facing ladder and names the clinician phone-call task instead (recommended); (b) leave the row and rely on the code refusal.
- Decision:

### OQ-675 Loose ends of the SMS removal that need their own decision (raised by S85-D3)
- (1) `patient_notification_preferences.sms_enabled` and the patient settings toggle still exist, but nothing sends a patient SMS now; hide the toggle or leave it. (2) 59 active SMS template rows in `notification_template_locales`, most now unreachable. (3) `employer_invite_roster_member` and the `employer_invite_channel` enum still allow `'sms'`. (4) "A clinician phone call is a task": no task is created when an unreached critical patient notice runs out of rungs; today the admins get the exhausted-ladder alarm. Build the S16 task or accept the alarm.
- Options: (a) one removal migration per CLAUDE.md pattern for (1) to (3), after this code is deployed, and an S16 task rule for (4) (recommended); (b) leave.
- Decision:

### OQ-676 The emergency-contact SMS exception: switching it on (raised by S85-D3)
- The guard `sms_emergency_contact_enabled` is born off and needs two recorded attestations before an admin can switch it on: live SMS delivery proven (Termii sender ID approved, DND route active, a real message received on a real handset: OQ-46) and the founder's explicit approval of D3. Until then the contact is sent push, email and in-app if they are a Tarragon account, and the SMS row is suppressed with its reason on the row. A contact who is not a Tarragon account (the usual case, the profile holds only name and phone) currently gets nothing until the guard is on: consider collecting an email for the contact. The patient button now says plainly that the text cannot go yet and does not mark the contact as notified. The automatic path (the 10-minute trigger in `emergency_escalation.sql`) still sets `contact_notified_at` when it queues the row, so a patient screen can still read "alerted" there; fixing that needs a migration to the trigger (set it only when a copy was actually queued or the guard is on). Also: the exhausted-ladder alarm reaches only `profiles` with role `admin`; with none, a refused patient hop ends with a failure row and no in-app alarm. Delivery events reuse the `suppressed_cap` name for policy refusals because the event list is a CHECK constraint (widening it is a migration).
- Options: (a) approve D3, prove live delivery, then switch on (recommended); (b) also add a contact email field so the exception is not the only route; (c) drop the exception.
- Decision:

### OQ-677 Sexual health, STI and HIV records are on the open path (CMO choice, counsel to confirm)
- The CMO chose to keep these on the open (audited) path. UK practice (the NHS STI Directions) and the Nigerian HIV and AIDS (Anti-Discrimination) Act 2014 treat them as specially confidential. Counsel should confirm the open path is lawful in Nigeria, and the table-level log (OQ-282) is the compensating control.
- Decision: open (counsel). Revisit if counsel says a tie is required.

### OQ-678 Should a Free patient's symptom-check review raise a doctor alert at all (raised while resolving OQ-432)
- The symptom handler (`private.handle_symptom_triage_assessment`) raises its `clinician_review` alert for every plan, Free included. The 2026-10-12 Free rule (guidance only, no doctor page, no doctor task) covered amber triage tasks, heart-failure alerts and crisis follow-up but not this alert, and OQ-432 deliberately left it unchanged: a Member's review is now one task, a Free patient's is still the alert.
- Options: (a) leave it (the symptom checker is off behind `symptom_checker_enabled` and has no live assessments); (b) give a Free patient the calm in-app guidance record (`private.open_free_notice`, kind `amber`) instead of the alert, like amber triage; (c) keep the alert but mark it as Free so it does not count against doctor time.
- Recommendation: (b) before `symptom_checker_enabled` is switched on, so the Free rule holds on every doctor-facing path. Owner: CMO and founder.
### OQ-720 The visit summary cannot be built on the phone yet (raised by the doctor summary PDF)
- The spec asks for a summary that works offline on the phone when the data is in the mirror. The summary is built on the web and the PDF route needs a connection; the phone has no PDF library at all (`apps/mobile/package.json` has `expo-file-system` but no `expo-print` or `expo-sharing`). Adding either is a native dependency, which means a new EAS build and a `runtimeVersion` bump before an over-the-air update can carry it (the standing rule for this app), so it was not done inside a web-only change.
- What the phone does today: the patient opens the web page (`/patient/doctor-summary`) in the browser, online. The page says a connection is needed.
- Options: (a) add `expo-print` and `expo-sharing`, build the same sections from the S06 mirror on the phone (the model in `apps/web/src/lib/doctor-summary-pdf/model.ts` is pure and would move into a package), accept the native rebuild; (b) leave it online only and decide later; (c) generate on the server and cache the last PDF on the phone for offline viewing (this is not the same: it is a snapshot, not a summary built from what is on the phone now).
- Recommendation: (a), together with the next planned native build, so the rebuild is paid once. Owner: founder and engineering.
- Decision: open.

### OQ-679 What the summary can and cannot keep out (raised by the doctor summary PDF)
- Same limit as OQ-S43-4. There is no reproductive-health or mental-health section, and the symptom journal drops entries of the two reproductive symptom types (`testicular_pain`, `testicular_lump`) whole. That list is a code constant in `model.ts`, not a CMO-signed tag list. A free-text symptom note, a skip reason, or a contraceptive in the medicines list is printed whatever it is for, because nothing classifies it. The page says so and the PDF footer says a listed medicine or note is listed whatever it is for.
- The spec says these categories may be included if the existing category rules allow and the patient explicitly selects them. Not built: it needs the CMO-signed tag list and the access-category check, the same dependency as OQ-S43-4 and the S44 export.
- Audit: the summary writes one `audit_log` row per generation through the patient's own session (insert policy `audit_log_insert`, actor must be the caller). The audited-read helpers (`private.audit_patient_read`) are for staff reading someone else's record and are not callable by a patient, so they were not reused. The row holds the sections ticked and the period only, never a value.
- Options: (a) leave as built; (b) CMO signs the tag list, then add an explicit opt-in section behind the category checks. Owner: CMO and counsel.
- Decision: open.

### OQ-452 An external dead-man check for the pager and cron (raised by the 2026-10-15 pg_cron outage)
- Every watcher we built (`sweep_paging_health`, `queue_watchdog`, the reconciler, `paging_heartbeats`) runs inside the database under the same pg_cron that broke on 2026-10-14 (16:19 to 23:20 UTC) and 2026-10-15 (15:01 to 21:23 UTC). A database or cron outage therefore cannot be seen by them; on 15 October the first sev1 appeared 38 minutes in and the queue ones about four hours in; on 14 October the first `cron-failure` incidents were opened at 21:22 UTC, about five hours after the first failed run at 16:19 UTC. The pager design note already says the SR1 external monitor is the answer (OQ-436 asked for the same).
- **State of the external monitor, verified from code**: `/api/health/deep` reads the secret `HEALTH_CHECK_SECRET` (`apps/web/src/app/api/health/deep/route.ts`). If it is not set, the route answers 503 `{ok:false,error:"not configured"}` and reads nothing. The coordinator saw exactly that answer, so the variable is probably not set in production and no external monitor is calling it; I could not verify the deployed environment from here.
- Options: (a) set `HEALTH_CHECK_SECRET` and point an outside uptime service (not hosted on the same Supabase project or the same Vercel account if possible) at `/api/health/deep` every minute, alerting on non-200, on `ok:false` and on no answer, to a phone that reaches a named person; (b) also add a second outside probe that calls the database through a separate path and checks `paging_heartbeats` and `cron.job_run_details` age; (c) rely on the in-database watchdog only.
- Recommendation: (a) now, because it is a variable and a monitor, and (b) before the readiness gate and the unified red paging flag are switched on. It ties to the final fallback in decision S16-S20-10 (a named ops person phoning on-call). Owner: founder.
- **Built 2026-10-16 (the code half of a and part of b)**: the deep check covers the pager and queue heartbeats, open sev1 and the canary, answers 200 only when healthy, and leaks no detail; the runbook (the GitHub Actions probe is PR #1170's `deadman-switch.yml`, not duplicated here) and the runbook `docs/runbooks/external-dead-man-monitor.md` are added. NOT done, because they need the founder: setting `HEALTH_CHECK_SECRET` in production, creating the outside monitor account, naming the person who is phoned.
- Decision: open.
### OQ-S63-1 Table names and the existing `therapy_sessions` (raised by S63)
- The spec's `programmes`/`programme_enrolments` collide with 13 tables, and `therapy_sessions` is already the S56 therapist booking table. S63 uses `therapy_programmes`, `therapy_programme_sessions`, `therapy_enrolments`. Confirm the naming. Decision: open.

### OQ-S63-2 CMO must read, change or reject every S63 draft (raised by S63)
- Wave A session text, the 12 exclusion lists (local items flagged unverified: continuous leakage, over-50 onset and night symptoms for IBS, pregnancy and alcohol or sedative dependence for CBT-I, TB, sickle cell bone pain and HIV for pain), the `therapy_programme_config` numbers (only PHQ-9 and GAD-7 worsening and the CBT-I floor are CMO values; due windows, pelvic floor dose, other thresholds and checkpoints were chosen by the build). The plan also listed prolapse symptoms and infection for pelvic floor; not added. Decision: open.

### OQ-S63-3 Red-flag codes are not shown to the tied clinician without consent (raised by S63)
- A same-day task says only that a programme was stopped. The clinician sees which red flag fired only if the patient shares progress. Confirm, or allow the codes in the task for safety. Decision: open.

### OQ-S63-4 S56 crisis card shows 112; S63 shows no number (raised by S63)
- CMO decision is no phone number anywhere. The S56 `CrisisCard` still shows the emergency number. Decide whether to align. Decision: open.

### OQ-S63-5 Share-consent wording, and who resumes a paused programme (raised by S63)
- Consent text version is `draft-1`, unreviewed. A tied non-coordinator clinician may resume a worsening-paused programme; confirm the tier. Decision: open.

### OQ-S63-6 Audio and manifest (raised by S63)
- Clips `THP-PAN01..` are named but not in `audio/manifest.json`: add via `source/extra-clips.json` and the importer when recordings are commissioned. Group THP needs a title and review entry. Decision: open.

### OQ-S63-7 Mood crisis path reuses F1 task type, not `raise_crisis_follow_up` (raised by S63)
- That function is keyed on a questionnaire row. The programme crisis route uses the same task type, page and notices keyed on the enrolment. Wave C remains a scaffold until S56 merges and the path is tested. Decision: open.

### OQ-S63-8 `/code-review high` findings fixed, and what is still open (raised by S63)
- Fixed in the branch before the PR: the live screen uses the highest CONFIRMED list (a newer draft never replaces it); a resumed programme is assessed only on scores recorded after the resume; a failed inline check on the last session leaves the programme open for the bus handler; a missing active config fails closed; an entry-screen stop cannot be undone by answering again (72 hour PROPOSED cooldown); the crisis page is sent once per patient per hour and a failed crisis task now reaches the patient screen; permanent database rejections are shown, only transport faults are queued; the offline queue is scoped to the signed-in person; an offline copy of a session is read-only; offline stops no longer claim the care team was told; task dedup keys are opaque; audit rows point at the profile.
- Still open: no staff screen yet for `resume_therapy_enrolment` or the consent-gated `read_therapy_progress_audited` (RPCs only); a patient stop button exists on the player; sign-out does not clear the device cache; the go-live condition patches still use text replacement of function bodies (as S56 does); red-flag stops on scaffold programmes still raise a same-day task and page (a patient who reports a red flag gets a clinician even though the programme is not open); `guidanceKeyForRoute` and `assessWorsening` in `packages/shared` are mirrors used by tests only; the guard-open check is one call per programme. Decision: open.
## S58 (Module 11, Rewards and engagement)

### OQ-S58-01 Redemption is built but OFF: the founder must set the cap, the share and who funds it
- `apply_points_discount(order, points)` and `release_points_discount(order)` exist and are tested; they refuse while `reward_config.points_redemption_cap_kobo` is 0 (it is). Proposed (unsigned): 1000 points per 10 percent (`points_per_percent` 100, `max_share_bps` 1000, `min_points` 100). Open: the kobo cap per order, whether Tarragon or a partner funds the discount, whether discounts apply to every catalogue kind.
- S71/S72 must call `apply_points_discount` at checkout and `release_points_discount` when an order fails, is cancelled or expires (the order amount is immutable, so the checkout charges amount minus the redemption's `discount_kobo`). Until then nothing reaches it from the UI.
- Decision: open (founder). Closes OQ-F1-01 once decided.

### OQ-S58-02 Point values, caps, decay and tier thresholds are PROPOSED
- All twelve rules are active at version 1 with status `proposed`; the five new ones (course, lab, review, screening, plus tier thresholds 400 / 1200 / 3000) are new proposals. The seven earlier rules keep the points the old triggers paid (10, 10, 15, 20, 15, 50, plus catalogue values). New per-day caps (e.g. lessons 3 a day) and the 100 points daily cap are new. An admin can change any rule from `/admin/settings/reward-rules` as a new proposed version.
- Decision: open (founder).

### OQ-S58-03 Plausible-range bounds for "no points for an implausible reading"
- Proposed wide bounds (systolic 50 to 260, glucose 1 to 40 mmol/L, pulse 25 to 230, SpO2 50 to 100, temperature 30 to 43). They only decide whether a reading earns points; the triage path never reads them. A dangerous reading inside the bounds earns normally. CMO to confirm the bounds.
- Decision: open (CMO).

### OQ-S58-04 No refill reward yet
- The plan lists "refill" as a verified action. No dependable refill-collected event exists (pharmacy fulfilment, S34 onward). The rule is not seeded; add it when a verified event exists. Self-reported screening completions (`screening_completions`) are deliberately not rewarded (a result row, `screening_results`, is the verified signal).
- Decision: informational.

### OQ-S58-05 The spendable balance never resets and levels only count the calendar year
- Vitality-style "annual reset with status kept" is applied to the level counter only, so nobody loses spendable points (no loss framing). Points never expire. Alternative: an expiry date on points. Not chosen.
- Decision: open (founder).

### OQ-S58-06 Employer-funded reward pools (11.4) wait for Module 24
- Only the aggregate-only seam (`rewards_participation_aggregate`, minimum group 10 proposed) is built. Design rules for S79: employer funds a pool, never sees a person (I9), per-person cap, the employer's pool pays for the discount at checkout, no individual status leaves Tarragon.
- Decision: informational.

### OQ-S58-07 Challenge and class points still come from the catalogue row
- `challenge.completed` and `class.attended` are events; the points are read from the challenge or class itself (`points_source = catalogue`), still subject to caps and the daily limit. Class attendance is self-reported by the patient (existing behaviour), so it is the most gameable source; the daily limit and a per-day cap of 2 bound it.
- Decision: open (product).

### OQ-S58-08 A failed rewards event opens one shared incident
- If a rewards event cannot be written the person's own record is saved, an `audit_log` row (`rewards_event.error`) is written and one open incident (`rewards_event_failed`) covers all of them. Confirm severity and whether ops wants it.
- Decision: open.

### OQ-S58-09 Patient-facing notifications for points
- None are sent (INV-07 by absence; no streak or missed-day message exists). If the founder later wants a "you earned points" notice it must be neutral and key-based.
- Decision: informational.


## EMP: employer seat pilot kit (2026-10-16). Conservative defaults taken; nothing needs a decision to merge, several need one before the pilot is switched on.

### OQ-EMP-1 Paystack payment link: finance records receipt, no new webhook kind
- Chosen: the pilot invoice is paid by bank transfer or a Paystack payment link created by hand in the Paystack dashboard; finance SEES the money and records the method and reference (`confirm_employer_seat_pilot_payment`, idempotent, unique reference). Why: a new `metadata.kind` in the deployed `paystack-webhook` function touches the highest-risk deployed edge function and the S25 order path for a B2B one-off. Alternative: add a signed webhook kind that activates the pilot on a verified `charge.success`. Not built.
- Decision: open (founder). Counsel: none.

### OQ-EMP-2 No general ledger posting for a pilot invoice
- The invoice is an `employer_invoices` row; its paid status is finance's record. No journal entry is posted, no account was invented (S25 posting design not read for B2B revenue). Finance decides the accounts for employer seat revenue and deferral over the 12 month term.
- Decision: open (finance).

### OQ-EMP-3 No condition or programme uptake count in the employer report
- The report counts members with a completed consultation, consultations completed, and members who logged any check-in. A chronic-programme or screening-result count would let an employer infer a condition in a small workforce (the Ovia risk, spec 2180). A general "annual health check started" count is also left out until the CMO and DPO approve its definition.
- Decision: open (CMO, DPO).

### OQ-EMP-4 A departed employee's seat is not reusable
- Pilot seats are counted by seats ever made (any state). A leaver's seat is not given to a replacement. Alternative: free the seat if the leaver departs within N days of joining.
- Decision: open (founder).

### OQ-EMP-5 Re-identification by differencing across weekly reports
- Defences: the one platform minimum cell (`private.min_cell_floor`, S75a: 20 today, or the organisation's own number if higher), complementary suppression (`private.suppress_cell`), figures only through the last completed Lagos week, counts rounded to the nearest 5. Residual: two reports weeks apart can still be subtracted for a small group. Option: freeze a stored snapshot per week and never re-serve a changed past week. Counsel and DPO to say whether this is enough for a first pilot; with a platform floor of 20, an employer with fewer than about 40 members will see usage withheld until it grows.
- Decision: open (DPO).

### OQ-EMP-6 VAT, withholding tax and invoice wording
- The invoice carries the naira total only. Whether VAT applies to a health-service seat, withholding tax, and a purchase order field are counsel/finance points. Flagged NEEDS COUNSEL in the terms draft.
- Decision: open (counsel, finance).

### OQ-EMP-7 Legal drafts need counsel
- `docs/legal/employer-pilot-terms-DRAFT.md` and `docs/legal/employee-pilot-notice-DRAFT.md`: roles of controller and processor for the roster (employer to Tarragon), lawful basis for the work-email match, voluntariness inside an employment relationship, the DPA attachment, refund position, governing law, liability.
- Decision: open (counsel). Not for sending.

### OQ-EMP-9 Employee activity in the employer report: lawful basis, and the report ships OFF
- The usage block counts members with a consultation or a check-in from `encounters` and `vitals_readings`. No record shows the employee saw the notice or agreed, and the notice is a draft. Conservative default taken: `employer.seat_pilot.usage_report_enabled = false`, so a pilot reports seat counts only until counsel and the DPO sign the employee notice and the founder switches it on (an update of the active `employer_seat_pilot_config` row; the registry value must change with it). Alternative: record an in-app acknowledgement per seat and count only members who gave it.
- Decision: open (counsel, DPO).

### OQ-EMP-10 An ended or expired pilot: claims wait, one incident per pilot (decided default 2026-10-22)
- After a pilot ends or its claim window closes, new roster claims get no seat (`pilot_closed`) and wait. Ordinary arrears billing does NOT resume on its own, because that would bill an employer who only agreed to a block. Only ONE open incident per pilot is raised (reference `pilot-closed:<pilot id>`), not one per person. A new paid pilot re-offers seats to everyone who was refused. Alternative: hand the employer back to arrears billing after the pilot.
- Decision: open (founder), default implemented.

### OQ-EMP-11 The per-head overlap guard raises; it is not a batch operation
- `employer_generate_invoice` creates one invoice for one organisation per call and nothing in the repository calls it in a loop or from a schedule, so the guard `pilot_covers_this_period` can only refuse the single call finance made, with a plain message. A silent skip would hide a real double billing, so it raises. If a batch run is ever added it must catch this error per organisation.
- Decision: informational.

### OQ-EMP-12 A seat claimed on the last day runs the full twelve months
- The seat term is the catalogue duration from the claim day, not capped at the claim window. Documented in the employer terms draft (3.2). Alternative: cap the seat at a fixed end date.
- Decision: informational (founder).

### OQ-EMP-13 The live project is ahead of main-dev on the Membership ladder
- Live `private.grant_org_seat` writes `patient_memberships.tier` (migration `20261021110528 membership_evergreen_ladder_foundation`, live, not on main-dev). The pilot migration detects the column at run time and sorts after it, so it works on a main-dev replay and on live. When the ladder merges, its `grant_org_seat` body must carry the pilot block; the pilot proof fails if it does not.
- Decision: informational.

### OQ-EMP-8 starts_on is the offer date, not a gate
- Seats can be claimed from the day payment is confirmed until ends_on. A "not before" date would leave a paid employee waiting with no sweep to release them. Alternative: a daily sweep that grants seats when the window opens.
- Decision: informational (founder).
### OQ-AVS-1 The older consultation summary table is left in place
- `consultation_patient_summaries` (2026-08-29, publish-once, patient reads by policy, staff read by policy) already gives a patient a short recap of a video visit. It has no draft, no approval stamp, no checklist, no amendment or protected-note handling and no event. The after-visit summary (AVS) is built as its successor on `visit_summaries`, and the Care tab shows the new card above the notes card. The old table, its publish function and the `consultation_summary_ready` notification are not touched or removed, so a patient can still see both for a visit published the old way.
- Conservative default: do nothing to the old path in this PR. Decision needed (product): retire `publish_consultation_summary` once AVS is live, and whether to migrate the old rows (they would need a doctor to approve them again).
- Decision: open.

### OQ-AVS-2 Lab orders and referrals have no direct link to a note
- `prescriptions.encounter_note_id` is a real link; `lab_orders` and `specialist_referrals` have none. The draft picks up the ones the note's author ordered or referred for that patient in the window from two hours before the encounter to two hours after signing, and signed care plan changes the author signed in the same window. A doctor can remove or add steps before approving, so a wrong guess cannot reach a patient unreviewed, but a busy day could add a step from a second visit.
- Conservative default: the window rule above, shown to the doctor as a draft. Decision needed (clinical and product): add `encounter_note_id` to `lab_orders` and `specialist_referrals` at order time, then drop the window.
- Decision: open.

### OQ-AVS-3 The urgent-care block reuses the existing wording and has no condition-specific version
- Every summary shows the existing key `history.unwell` ("If you feel unwell now, do not wait for a review. Open Emergency in the menu, or go to the nearest hospital."). It names no number (OQ-87 stays) and no condition. EMG-001 was not used because it talks about "your reading".
- Conservative default: the generic line on every summary. Decision needed (CMO): whether a condition-specific "when to get help" line may be added per protocol, and then it must come from a signed wording code, not from the summary text.
- Decision: open.

### OQ-AVS-4 Plain-language review is advice plus a database floor, not a reading-level test
- The database refuses an em dash or en dash, the word warning, "your doctor", the word cure, "instant doctor" and "free healthcare" at approval. Sentence length and reading level are only advice in the review panel (more than 25 words in a sentence). There is no automatic reading-age score and no trained-reader check, as the BPC lessons have (`understandability`).
- Conservative default: the doctor owns the wording and signs it. Decision needed (CMO and product): whether to run the S-BPC style understandability check on a sample of real summaries before the card is switched on for everyone.
- Decision: open.

### OQ-AVS-5 An amendment hides the summary until a doctor approves it again
- Any amendment to a note hides its approved summary at once, both while the amendment is a draft and after it is signed, until the doctor reopens the summary (revision 2) and approves it again. The earlier approval is kept in `visit_summary_revisions`. This is the safest default for INV-11 and also means a trivial addendum (a late entry) hides the patient's summary until a doctor spends a minute re-approving.
- Decision needed (clinical): whether a late-entry amendment should keep the summary visible.
- Decision: open.

### OQ-AVS-6 Caregiver and proxy access is read only and excludes protected notes
- A caregiver reads a summary only with the `view_care_plan`, `view_medication` and `view_results` permissions together (a summary names medicines and tests), can tick nothing and add no task, and never sees the summary of a protected note (even after the patient's own release). A guardian of a 10 to 17 year old is not given any special path here: the category gate `guardian_may_view_confidential_domain` is not consulted because a summary is not tied to one access category (a note can mix topics).
- Conservative default: the narrowest reading above. Decision needed (product and privacy): whether a guardian should be able to tick items for a child, and whether the minor-confidentiality rule needs a per-note flag.
- Decision: open.

### OQ-AVS-7 The database proof was NOT run against the real schema
- The migration and `packages/db/tests/avs_visit_summaries.sql` (registered in `ci.manifest`, with two sabotage steps) were written but could not be run end to end: the live database was unreachable (connection timeouts, so no live definition was read; every function this feature extends was read from the migration files on `origin/main-dev`), a local Supabase stack could not finish replaying 1947 migrations on a machine under load, and Docker then stopped responding. What did run: the migration applied cleanly, including its closing assertions, in a scratch PostgreSQL 16 with stub tables, and a short behaviour script there showed a draft hidden, a forged approval refused, the signature stamped, an approved summary frozen, a pending and a signed amendment hiding it, an amendment of an amendment counted, a protected note hidden and the copy rules finding all four banned forms. The full proof, the replay in CI (`Supabase migration replay`) and the data registry check (`s39d_registry_purge_export.sql` A1) are still to be run by CI or on a local stack.
- Also not exercised: the web card, the clinician panel and the mobile section in a browser or on a phone (typechecked, linted and unit tested only).
- Before applying to production: re-read the live definitions of `private.may_work_on_note`, `private.is_clinical_tier` and `private.can_read_clinical(uuid, caregiver_permission)` with `pg_get_functiondef`, and check `list_migrations` for versions you do not recognise.
- Decision: informational.

### OQ-AVS-8 The "checked by" line is its own null-gated line, not the shared ReviewedByDoctor component
- `ReviewedByDoctor` is a server component keyed to an `escalations` row, so it cannot show an after-visit summary approval. The AVS card shows "Checked by {name} on {date}" only from the summary's own `approved_by_staff` and `approved_at` (both NOT NULL by CHECK once approved), and falls back to "Checked by your care team on {date}" when no staff name can be read, which is the same fallback wording `ReviewedByDoctor` uses. Nothing renders for a draft.
- Decision needed (product): whether to extract a shared presentational attribution component that both can use, with the doctor profile link.
- Decision: open.

### OQ-AVS-9 Audit rows for a patient opening a summary
- Opening a summary writes one `visit_summary.patient_read` audit row and one `visit_summary.viewed` event per summary, viewer and day (`record_visit_summary_opened`); reading the list writes nothing, so a refresh or a tick adds no rows. The count is a daily-open count, not a view count.
## PCC: post-consultation check-ins at 48 hours and 7 days (docs/design/PCC.md)

The CMO must sign the question wording, what each answer does and the offsets (check-in configuration version 1, on the CMO sign-off hub) before anything is sent, and an admin must then switch the `post_consult_checkins_enabled` guard on. Both start off. Nothing below was decided by an agent; each item states the conservative default that shipped.

### OQ-PCC-1 Question wording, offsets and timing are PROPOSED
- Four questions (how are you feeling, new or worsening symptoms, medicines as agreed, anything unclear), 48 hours and 7 days after the consultation ended, one reminder 24 hours after it opens, closed as not answered 48 hours after it opens, reminders only between 07:00 and 21:00 Africa/Lagos. Value: `consultations.post_checkin` (mirrored by `post_consult_checkin_config` version 1).
- Decision: the CMO signs or asks for a new version.

### OQ-PCC-2 What counts as a concern
- Default: "worse", "new or worsening symptoms" and "I cannot take my medicines" each raise a clinician alert (one per check-in, level `clinician_review`); "missed some doses" and "something was unclear" make a task for the clinician on the visit; a danger phrase in the note opens the existing emergency path. The level can be raised to `urgent_escalation` in a new config version.
- Decision: CMO.

### OQ-PCC-3 No new alert type
- Every alert reuses `symptom_escalation`, so it rides the existing `alert_rules` routing. (`medication_access_barrier` has no `alert_rules` entry and would sit unassigned, so "cannot take my medicines" is raised as `symptom_escalation` with its own title text.) `alert_raised` in the patient's result means an alert row was created; if routing marks it a duplicate of an open one the care team already has that alert. A dedicated `post_consult_checkin` type would need its own enum migration and a governed `alert_rules` entry.
- Decision: open (CMO, only if the alerts should be filtered apart).

### OQ-PCC-4 Clinician tasks are `care_tasks`, not `clinical_tasks`
- A new `task_types` row would carry `needs_confirmation` and, as `crisis_follow_up` did (S57b), block approving any triage rule set until the CMO confirms it. The low-priority "not answered" task and the "help" task therefore use `care_tasks` owned by the consultation's clinician. They are not part of the S16 queue, claim or paging machinery.
- Decision: open (CMO: should these become S16 task types?).

### OQ-PCC-5 Only video, audio and phone consultations
- Written (async) consultations are excluded; they have their own answer thread (S22). Confirmed by `encounter_types` in the config.
- Decision: open.

### OQ-PCC-6 Mobile has no native answer screen
- The Today list knows the `consult_checkin` kind and opens Care, where the web link lives; the patient answers on the web page `/patient/consult-checkin/[id]` (also reachable from the notification). A native screen over `my_post_consult_checkin` and `answer_post_consult_checkin` is not built and was not run on a device.
- Decision: product.

### OQ-PCC-7 Patient who has already written to the care team
- A pending (not yet opened) check-in is skipped when the patient sent a care message after the consultation within 24 hours before it falls due. A message from day 1 does not remove the day 7 check-in. An already-open check-in is never cancelled by a message. The cancel is not silent: the visit clinician gets a low-priority task saying the questions were not asked and why. The 24 hour window is `skip_if_patient_wrote_within_minutes` in the config.
- Decision: CMO (should any message about the visit end the loop?).

### OQ-PCC-8 The emergency event only alerts when its own entitlement check passes
- `emergency_events` raises its clinician alert for patients with the doctor-escalation entitlement. A consultation is a paid Member item, but the check-in does not rely on that: if the event raised no alert, the answer function raises one itself. Reading `clinician_alert_id` back, rather than assuming, is why. LIMITATION: that fallback alert is created but NOT paged (the emergency trigger's own paging only runs on its entitlement path); it waits on the alert ladder's acknowledge timeout. Page the owner, or every admin if none, the way the care-message screen does, once a check-in-specific template exists.
- Decision: informational.

### OQ-PCC-9 Post-merge steps (not done by the author)
- Apply the migration (merging auto-applies it); redeploy `send-pending-notifications` so `consult_checkin_due` and `consult_checkin_nudge` render (until then the in-app notice and the patient task still work); the CMO signs; an admin switches the guard on. Nothing is sent before the last two.

### OQ-PCC-10 Who may read the answers
- The consultation's clinician, and the clinician a flagged check-in's alert was routed to. Nobody else, including the CMO and admin (a break-glass read is the existing audited path). If the consultation's clinician has left and nothing was flagged, nobody can read a routine check-in; say if the lead clinician should.
- Decision: CMO.

### OQ-PCC-11 Old visits when the guard is first switched on
- An offset whose whole window (due time plus the open window) has already passed is skipped, so switching the guard on never sends a burst of check-ins about old visits. A visit 3 days old still gets its 7 day check-in, and its 48 hour check-in if that window has not passed.
- Decision: informational.

### OQ-PCC-12 The danger-phrase list can over-trigger on a free-text note
- The note is screened with the same list the care-message screen uses (`private.screen_care_message_for_emergency`), as the founder asked (reuse the existing deterministic check). A reflective note ("fitting back into my routine", "I swallowed the tablets fine") can match, which shows the hospital guidance and, if the patient does not acknowledge it, can message their emergency contact. Over-triggering is the accepted posture everywhere else this list is used. A note-specific list, or a confirm-first step before the emergency event, would need a CMO-signed phrase list.
- Decision: CMO.

### OQ-PCC-13 A late answer is taken
- An answer that arrives after the sweep expired the check-in is still accepted (a red flag is never refused because the clock got there first); it cancels the care team's "not answered" task. A cancelled check-in is refused.
- Decision: informational.
### OQ-700 Patient-first window for non-emergency check-in requests (raised by S29e) - CMO decision
- Built, OFF: platform module `care_circle_checkin_window` (`public.set_platform_module`, superadmin only). A supporter holding `red_alerts` can ask a person to check in (`request_circle_check_in`). The patient alone is told first (in-app plus their own reminder channel) and has `checkin_window_minutes` (PROPOSED 5, config `care_circle.rules` v4) to tap "I am fine"; if they do not, the circle members holding `red_alerts` get a neutral notice (`circle_check_in_unanswered`, critical, no reading and no cause; it names the person so the supporter knows whom to call, as a red alert does). At most 3 requests a day from one supporter about one person (`checkin_max_per_day`).
- What it does NOT touch: a red event. `private.notify_circle_red_alert` is unchanged, knows nothing of the window, and alerts supporters at once with the module on or off. The proof `s29e_care_circle_reach_and_checkin_window.sql` checks a red event reaches every `red_alerts` member immediately while a window is waiting, and a sabotage run (the window made to hold back a red event) flips that check.
- Questions for the Chief Medical Officer before the module is switched on: (1) is a patient-first window acceptable for a non-emergency check-in at all, and is 5 minutes right; (2) the patient's ask is ROUTINE priority (a critical one would enter the unconfirmed-critical follow-up ladder and repeat a stale question 40 minutes later): in-app is never held by quiet hours, but the push may be, so a patient asleep may not see it and the circle is then told after 5 minutes; the circle's "has not answered" notice is CRITICAL (like a red alert, so an unopened one is followed up). Confirm, or ask for the ask to bypass quiet hours; (3) the asker is told nothing when the patient answers (an answer tells nobody) and is told only if the circle could not be reached; confirm; (4) the circle notice goes to every `red_alerts` holder, including the asker.
- Wording: the check-in copy lives under the `checkin.` string prefix and the join-link chrome under `joinlink.`, NOT under `circle.`, because the reviewed-strings ledger (S-15) forbids new unreviewed strings in the `circle` consent namespace and no reviewer has read them. Neither prefix is in the ledger namespaces yet. Before the module is switched on the CMO (or a named reviewer) must read the `checkin.*` strings in `packages/i18n/src/en.ts` and the prefix should be added to the ledger with a real reviewer.
- Decision: open (CMO). Do not switch the module on without a signed decision.
## Blood pressure from a wearable (raised 2026-10-16, branch pr1/bp-wearable-estimate-exclusion)

### OQ-BPW-1 Should a wearable blood pressure estimate ever page the care team? (for the CMO; the switch is born OFF)
- Built: a wearable (cuffless) blood pressure is an estimate. It is shown with its label and is never counted in a home average, an outcome or risk number, or graded by the triage engine (always, no switch). The one change to a live alert path is behind platform module `device_cuffless_bp_informational`, born OFF: with it ON, a red or amber estimate gives the person the existing recheck guidance and raises no clinician alert or page.
- Trade-off: ON means a true crisis that only a watch saw does not page at red or amber (the person is told to rest and recheck with a cuff). OFF means an unreliable estimate can page a clinician. Pregnancy and the weeks after a birth are never patient-only: an estimate there pages as a cuff reading does. An emergency-level estimate (a red-flag symptom near the reading) still opens the emergency record whichever way the switch is set. The live rules already grade a 200/130-range reading with no symptom as red (S11g), so with the switch ON that case gets the guidance and no page.
- Question: (a) leave OFF until wearables are live and there is data (recommended, since 0 wearable blood pressure rows exist today); (b) switch ON before wearables go live; (c) also stay silent for an emergency-level estimate or for pregnancy (not recommended: the emergency record and the obstetric route are patient safety nets).
- Evidence for the policy: the CMO pack C1 text already says a watch or ring is not used for care decisions; AHA/ACC-2025 does not recommend cuffless devices for clinical assessment.

### OQ-BPW-2 Wearable heart rate is left as it is (decision recorded, not an oversight)
- A single dangerously low or high heart-rate value from any source, a wearable included, is still triaged (founder decision 2026-08-29). Optical wrist heart rate is far better validated than cuffless blood pressure, and the pulse trigger fires on `vital_type = 'pulse'` only, so a wearable blood pressure cannot reach it. Revisit only if the CMO wants wrist heart rate treated as informational too.

### OQ-BPW-3 A HealthKit or Health Connect blood pressure cannot be told from a watch estimate
- Both mobile bridges upload with `source = 'wearable'`. A blood pressure that a validated cuff wrote into the phone's health store (for example an Omron app) is therefore treated as an estimate until the bridge can carry the originating device. Until then the person can type a cuff reading in by hand, which counts. Needs a device run before a discriminator can be designed.

### OQ-BPW-4 The wearable-estimate label text is proposed copy outside the reviewed-strings ledger
- `bpe.estimate_label` ("Wearable estimate", the same words the web badge already shows) and `bpe.estimate_note` ("From a watch or ring, not a blood pressure cuff. It is not used in your average or your trend. When you can, check with an upper-arm cuff.") sit in a namespace the ledger does not cover, so no reviewer was invented. CMO to read the note; if it should be ledger-covered, move it under `vitals.` with a real entry.

### OQ-BPW-5 Latent fault found: the blood pressure handler cannot resolve a severity-2 "Missing expected blood-pressure readings" alert
- The first statement of `private.handle_bp_reading_red_flag` resolves that alert with a bare `status = 'resolved'`. The check `clinician_alerts_resolution_requires_documentation` (20260828204033) refuses a resolved severity-2 alert without `resolution_action` and `resolution_outcome`, and the generator (`20260720015541`) inserts the alert at level `clinician_review`, which classifies as severity 2. If such an alert is ever open, the next blood pressure insert for that patient would error and roll back. **None exists today** (live count 0, checked 2026-10-16), so nothing is failing; found because the PR 1 proof tried to close one. Fix is small (set the two columns when resolving, using the values the taxonomy allows) but changes a live safety path, so it is left for its own PR with the CMO's wording for the outcome.
### OQ-S19F-01 How long a held older clinician message waits for its page (raised by S19f)
- `hold_seconds = 60` in `legacy_notice_retirement_config` (PROPOSED). It is the longest the older notify-everyone message for a blood pressure red event, a blood pressure crisis or a glucose emergency waits for its on-call page before it is sent anyway (plus up to 15 seconds for the sweep). Too short sends needless duplicates; too long slows the fallback when no page comes.
- Recommended: switch version 1 (parallel run) on first and set the number from the measured page lag shown on the sign-off hub (the slowest 5 percent, plus a margin).
- Decision: open (CMO).

### OQ-S19F-02 Should a vitals page for a pregnant patient tell her Care Circle (raised by S19f)
- Version 4 of the retirement config lets a unified page tell the Care Circle with the neutral check-in notice. A symptom event for a patient with a pregnancy or reproductive-health footprint, and a reproductive symptom type, are withheld. A vitals event (oxygen, pulse, temperature) for a pregnant patient is NOT withheld: the notice carries no content and the event is not reproductive.
- Option A (as built): tell the circle for vitals events. Option B: withhold every unified page for a patient with a footprint.
- Decision: open (CMO and DPO).

### OQ-S19F-03 When to retire the older emergency messages (raised by S19f)
- Version 3 retires the notify-everyone message for a blood pressure crisis and a glucose emergency as well as the red level, through the separate `suppress_legacy_emergency_notice` key. Nothing about it can be proved on real patients until the parallel run has produced real events and the glucose rules are signed.
- Recommended: leave version 3 until version 2 has run on real traffic.
- Decision: open (CMO).

## Blood pressure acknowledgement (raised 2026-10-16, branch pr2/bp-immediate-acknowledgement)

### OQ-BPA-1 The web shows the signed emergency wording (EMG-001) for a crisis-range reading because it cannot ask the symptom question (for the CMO)
- The phone asks the emergency-symptom question first for a 200/130-range reading (CMO 2026-10-05) and shows EMG-001 only with a symptom. The web has no such question and no on-device engine, and its display band calls 200 systolic or 120 diastolic a crisis (wider than 200/130). After saving, the web now says "Received by TarragonHealth." and, for that band, the signed EMG-001; for a high band the signed TRI-005 (rest and measure again). It never says within target or a little above, because it does not know a person's own target or pregnancy. Options: (a) leave (recommended until the web asks the question); (b) add the same question to the web form; (c) show TRI-005 only for the top band (less safe: it can delay a hospital visit for a person with symptoms).

### OQ-BPA-2 New acknowledgement sentences are proposed copy and sit outside the reviewed-strings ledger
- `bpack.received`, `bpack.received_note` and `bpack.waiting_note` are in a namespace the ledger does not cover (as `hc.*` is), so no reviewer was invented for them. They say only what is true (received, saved on the phone and not yet sent, a wearable estimate is not used in averages) and are scanned for review, time and clinician words. The CMO should read them; if they should be ledger-covered, move them under `vitals.` and add a real entry.

### OQ-BPA-3 Free members and "Your care team will look at this" (TRI-002)
- The acknowledgement never adds a care-team promise of its own. TRI-002 (signed without a review promise, OQ-251) is the engine's wording and is unchanged. Whether it should be hidden for a Free patient whose red reading does not reach a doctor (two-tier decision 2026-10-08) is for the CMO; the acknowledgement does not depend on it.

## Medicine safety gaps S08y (raised 2026-10-20, branch s08y/medicines-safety)

### OQ-S08Y-1 Who writes, reviews and signs the interaction rules and the brand mappings (raised by S08y)
- Both tables are born empty; the build wrote no rule and no mapping. Needed from the CMO: who is the pharmacist who writes and checks ingredient-pair rules (and which public sources count), and the order of work (pharmacist review, then the CMO signs `medicine_interaction_rule_sets`, then the CMO presses `medicine_interaction_rules`). The existing S53 class dataset (85 rules, unsigned draft) is a separate mechanism; decide whether to keep both or retire one once the ingredient layer has content.
- Reviewers of a brand mapping are active clinical staff who did not enter the row. A partner-pharmacy `pharmacist` account may not review. Decide whether Tarragon wants a staff pharmacist role that can.
- Decision: open (CMO).

### OQ-S08Y-2 The supporter's "today's doses" reads the `profile_access` model, not Care Circle (S29) (raised by S08y)
- Care Circle members live in `care_circle_members` with their own per-block permissions (`adherence_summary` etc.) and deliberately do not use `profile_access` (S29 design). The new door follows the instruction to use `profile_access_categories` (category `medications`), so it reaches "People you support" on the web and the phone's supporting screen, and does not reach a Care Circle supporter. Decide whether a daily-dose block should also be added to `circle_supporter_view` under a new permission, which is a separate consent decision.
- Decision: open (founder).

### OQ-S08Y-3 New clinical-namespace strings were recorded as unreviewed baseline entries, and the ledger ceiling was raised by 17 (raised by S08y)
- `medicines.addcheck.advice.same_ingredient`, `medicines.rules.advice.*`, `medicines.nafdac.*` and `meds.supply.collect_link` are in a gated namespace. No reviewer can be named by a build, so they were added as `unreviewed (baseline)` entries and `baselineCeiling` went from 1143 to 1160, as earlier builds did. This is an honest record, not an approval. Needed: the CMO or a pharmacist reads those 17 strings (especially `medicines.rules.advice.high` and `medicines.nafdac.verify.*`) and replaces the baseline entries with a real reviewer and date. Compare OQ-NAFDAC-SCAN-3 (which chose a non-gated namespace instead).
- Decision: open (CMO).

### OQ-S08Y-4 The older S53 text still names the short code 38353 (raised by S08y)
- `medicines.mas.add_prompt` and `.collect_prompt` and the phone's `NAFDAC_MAS` constant tell people to text a code to 38353. The only public source found for that short code is the 2018 MAS guideline; the current nafdac.gov.ng page names the service without a code. The new how-to card does not repeat the code. Needed: someone confirms the code with NAFDAC (or removes it from the older text) before launch.
- Decision: open (CMO or pharmacist).

### OQ-S08Y-5 Should tied staff see the NAFDAC number a patient noted (raised by S08y)
- `medication_pack_numbers` has no staff read policy (like `medication_supply`), so only the person, someone acting for them and a supporter with the medicines category can read it. If the care team should see it at a medication review, that is an audited, tied read and a `staff_read_scope` row. Not built. This also answers OQ-NAFDAC-SCAN-4 for the storing half: the number is now kept as a note.
- Decision: open (product).

### OQ-S08Y-6 Low-supply link on the phone only; the web already has the link (raised by S08y)
- The web prescription card already offers "Choose where to collect"; the web has no pill count, so no low-supply trigger was added there. The phone opens the web page in the browser (no native S28 screen, OQ-277). If a native screen is wanted that is S28 work.
- Decision: open (product).
## Guided home blood pressure session (raised 2026-10-16, branch pr3/home-bp-guided-session)

### OQ-HBP-1 Drop day 1 from the seven-day average? (for the CMO; not built)
- The founder brief proposed discarding day 1 (ESH-2023). The CMO pack C1 listed it as option (b) and recommended (a) "average every reading", which is also the S11 decision. Building (b) changes the counting rule in three places that must stay identical (`assessHomeCheck`, `private.home_bp_assess_readings`, the 35-case parity block) and is a clinical choice, so it waits for the CMO. The configuration row is still unsigned, so choosing (b) at signing is open; this is a follow-up build of about a day once chosen.

### OQ-HBP-2 "Measure before you take your medicines" is not shipped (for the CMO)
- ESH-2023 recommends measuring before medicines. The approved C1 text (NG-2023 5.4.5: morning on waking, evening before bed) does not say it, and a medicine-timing sentence shown to patients is a clinical instruction, so the guided session leaves it out. If the CMO wants it, add one sentence to `hc.session.rest` at signing; the morning window runs to 12:00 and the evening session is "before bed", so the wording needs care for each.

### OQ-HBP-3 The panel names no band for a session mean (OQ-67 context)
- The guided panel shows a session's mean as two numbers and says nothing about whether it is high or low. The C2 words for a complete seven-day average stay in the existing card behind the signed row. The draft `bp_care_triage` bands are not used anywhere in this feature. Classification of an average (and what to say about a single session mean) still awaits the CMO under OQ-67.

### OQ-HBP-4 A second governed config was not created (decision recorded)
- The brief named a new `home_bp_protocol` config. S07x already ships it as `home_bp_programme_signoffs` with the guard `home_bp_programme` and its CMO hub panel (see `docs/design/BP-home-guided-session.md`). A second one would give the CMO two sign-offs for one protocol, so it was not built. If the founder wants a differently named row anyway, say so.

## Renumbering map (2026-10-16)

Several OQ numbers were handed out twice by parallel sessions. The first heading in this file keeps its number; each later duplicate was given a fresh number above 452 (`packages/shared/src/open-questions-unique.test.ts` now fails on a repeated `### OQ-N`). References INSIDE a renumbered entry were updated. References elsewhere (other docs, code comments, migration headers) were NOT rewritten: a bare "OQ-310" there cannot be told apart from the five other OQ-310 topics, and applied migration bodies are never edited. Read an old citation against this map; the number it most likely means is the one that kept its number unless the citing text matches a title below.

| Old | New | Title |
|---|---|---|
| OQ-124 | OQ-453 | S18 and S19 must merge before the S21 slot RPC (raised by S21) |
| OQ-125 | OQ-454 | Authoritative encounters table (raised by S21, closes OQ-38) |
| OQ-126 | OQ-455 | How real the call is in S21 (raised by S21) |
| OQ-127 | OQ-456 | Cancellation and refund rule (raised by S21) |
| OQ-128 | OQ-457 | Consent, transfer mechanism and MDCN text (raised by S21) |
| OQ-129 | OQ-458 | Consultations are for adults only (raised by S21) |
| OQ-130 | OQ-459 | Consultation price (raised by S21) |
| OQ-131 | OQ-460 | Zoom dial-in in Nigeria and the phone fallback (raised by S21; revised 2026-10-06) |
| OQ-132 | OQ-461 | What a red page should say to Care Circle supporters and the clinical lead's review (raised by S19) |
| OQ-133 | OQ-462 | Acknowledgement targets and how long the lead is re-alerted (raised by S19) |
| OQ-134 | OQ-463 | Contractor status and declared hours (raised by S18, second pass) |
| OQ-135 | OQ-464 | Strikes and a doctor's other job (raised by S18 and S19, second pass) |
| OQ-136 | OQ-465 | Acknowledgement targets are not clinically validated (raised by S19, second pass) |
| OQ-124 | OQ-466 | S18 and S19 must merge before the S21 slot RPC (raised by S21) |
| OQ-125 | OQ-467 | Authoritative encounters table (raised by S21, closes OQ-38) |
| OQ-126 | OQ-468 | How real the call is in S21 (raised by S21) |
| OQ-127 | OQ-469 | Cancellation and refund rule (raised by S21) |
| OQ-128 | OQ-470 | Consent, transfer mechanism and MDCN text (raised by S21) |
| OQ-129 | OQ-471 | Consultations are for adults only (raised by S21) |
| OQ-130 | OQ-472 | Consultation price (raised by S21) |
| OQ-131 | OQ-473 | Zoom dial-in in Nigeria and the phone bridge vendor (raised by S21) |
| OQ-132 | OQ-474 | Legacy video paths left alone in S21 (raised by S21) |
| OQ-133 | OQ-475 | Cash refund of a cancelled consultation (raised by S21) |
| OQ-134 | OQ-476 | Pidgin for the scribe consent prompt (raised by S21) |
| OQ-135 | OQ-477 | Consultations are not behind a go-live guard yet (raised by S21) |
| OQ-136 | OQ-478 | Automatic fallback needs the in-app call SDK (raised by S21) |
| OQ-170 | OQ-479 | Medicine safety checks beyond allergy, duplicate and controlled (raised by S24) |
| OQ-171 | OQ-480 | Titration step table and the first approved protocol (raised by S24) |
| OQ-172 | OQ-481 | Who reviews an engine proposal, and when (raised by S24) |
| OQ-173 | OQ-482 | Caregivers, guardians and dependants confirming a change (raised by S24, extends OQ-70) |
| OQ-174 | OQ-483 | The confirm function acts as the signer for the length of the apply (raised by S24) |
| OQ-175 | OQ-484 | Two copies of the controlled-medicine list (raised by S24) |
| OQ-171 | OQ-485 | update (S24b, 2026-10-06): the CMO's screen for the step table now exists |
| OQ-174 | OQ-486 | update (S24b, 2026-10-06): reviewed and hardened; independent review still advisable |
| OQ-170 | OQ-487 | No ledger posting for catalogue orders yet (raised by S25) |
| OQ-171 | OQ-488 | Paying for someone else is not open yet (raised by S25) |
| OQ-172 | OQ-489 | Care pack price and what is sold at launch (raised by S25) |
| OQ-173 | OQ-490 | Retired payment code paths are still reachable (raised by S25, extends OQ-97) |
| OQ-174 | OQ-491 | Fee estimate is configuration, and its numbers are unverified (raised by S25, extends OQ-97) |
| OQ-175 | OQ-492 | Secrets and deploy steps for S25 (raised by S25) |
| OQ-176 | OQ-493 | Lab panel ranges and critical limits are unsigned (raised by S27) |
| OQ-177 | OQ-494 | The older partner PDF path conflicts with INV-03 (raised by S27) |
| OQ-178 | OQ-495 | Releasing a result does not complete its queue task (raised by S27) |
| OQ-179 | OQ-496 | Audio and AI explanation layers must read `explain_allowed` (raised by S27) |
| OQ-180 | OQ-497 | Who may release a critical value (raised by S27) |
| OQ-181 | OQ-498 | Free patients' own outside uploads wait without a reviewer (raised by S27 review) |
| OQ-192 | OQ-499 | addendum (2026-10-06): live `create_order` already let any `profile_access` grantee pay |
| OQ-180 | OQ-500 | Guards live in `go_live_guards`, not `platform_modules` (raised by S37; conflicts with OQ-18) |
| OQ-181 | OQ-501 | Test accounts pass the guard as a pair (raised by S37) |
| OQ-182 | OQ-502 | A guard that is on is not switched off when its condition lapses (raised by S37) |
| OQ-183 | OQ-503 | Attestations are one person's word (raised by S37) |
| OQ-184 | OQ-504 | Guards wired later, and what each still needs (raised by S37) |
| OQ-185 | OQ-505 | More conditions the guard does not check yet (raised by S37) |
| OQ-213 | OQ-506 | Admin patient search: rate limit and who may open (S36a) |
| OQ-214 | OQ-507 | Directory freshness and re-verification cadence (S36, spec 25.3 and 25.9) |
| OQ-215 | OQ-508 | Payout approval and the ops "prepare draft" half (S36, spec 9.4 and roles table) |
| OQ-216 | OQ-509 | Speak-up concerns screen (S20, S36) |
| OQ-220 | OQ-510 | Admin accounts can still reinstate a clinician directly (S36d, spec 9.4) |
| OQ-221 | OQ-511 | Role grants do not expire (S36d, spec roles table) |
| OQ-222 | OQ-512 | Ops cannot suspend through S15's own door (S36d) |
| OQ-223 | OQ-513 | Competency request notice reaches admins and the CMO only (S36d) |
| OQ-224 | OQ-514 | When the patient pauses sharing, do check-in requests (red alerts) pause too? (raised by S29c) |
| OQ-225 | OQ-515 | Only the full yearly Membership can be paid for someone else (decided by the founder 2026-10-06, built by S29c |
| OQ-270 | OQ-516 | Two prescription models, one supply count (decided) |
| OQ-271 | OQ-517 | Older pharmacist functions still read patient data with no audit row (INV-10) |
| OQ-274 | OQ-518 | No pharmacy can receive a prescription until its licence is verified |
| OQ-275 | OQ-519 | One medicine per prescription |
| OQ-276 | OQ-520 | Controlled medicines and repeats at the counter |
| OQ-277 | OQ-521 | Patient mobile screen and Pidgin review |
| OQ-270 | OQ-522 | S28 replaced S36h's pharmacist screen, and the free-text flag door is still open in the database (raised by S2 |
| OQ-272 | OQ-523 | Emergency location versus "routes are never shared" (raised 2026-10-07, S48) |
| OQ-273 | OQ-524 | Silence line 7 days needs a new signed rule set (raised 2026-10-07, S11) |
| OQ-280 | OQ-525 | A repeat supply is a new send (DECIDED and built in S28c; raised in the first S28 build) |
| OQ-281 | OQ-526 | Delivery data: hidden from patients, full removal still to do (S28d; extends OQ-16, OQ-272) |
| OQ-282 | OQ-527 | The older pharmacist reads are audited and tagged (S28d; closes OQ-271) |
| OQ-283 | OQ-528 | Prices are not shown (DECIDED, founder 2026-10-07) |
| OQ-284 | OQ-529 | Structured questions only, no chat (DECIDED and built in S28c; closes the chat part of OQ-273) |
| OQ-285 | OQ-530 | A caregiver can choose a pharmacy for the patient (DECIDED and built on web in S28c) |
| OQ-286 | OQ-531 | Refill reminder opens the Medicines screen (S28c) |
| OQ-278 | OQ-532 | Device and server work for the CMO's 200/130 flow (raised by S11c, updated by S11d; first numbered OQ-91, whic |
| OQ-290 | OQ-533 | Roster claim and org placement happen at INSERT, before any verification (OQ-41 and OQ-52 follow-up, found by  |
| OQ-291 | OQ-534 | The hosted confirmation email must carry the code for the optional email code box to work (raised by S41) |
| OQ-292 | OQ-535 | No canonical list of local government areas (raised by S41) |
| OQ-293 | OQ-536 | Cohort codes: S41 stacks on S38e (PR #988); three seams left (raised by S41) |
| OQ-294 | OQ-537 | Mobile parity for onboarding answers, programme code and email code (raised by S41) |
| OQ-295 | OQ-538 | Home cards from onboarding answers: wording and order need a product and CMO read (raised by S41) |
| OQ-184 | OQ-539 | update (guard enforcement, 2026-10-07) |
| OQ-184 | OQ-540 | update 2 (signup invite list, applied 2026-10-07) |
| OQ-310 | OQ-541 | The clinician does not send a prescription to a pharmacy; the patient chooses (raised by S54) |
| OQ-311 | OQ-542 | No pharmacy can be compared yet, and prices are per pack (raised by S54) |
| OQ-312 | OQ-543 | main-dev carries the first S28 build, which conflicts with the live S28 (raised by S54) |
| OQ-313 | OQ-544 | Pharmacist chat: retention, moderation, attachments (raised by S54) |
| OQ-330 | OQ-545 | Suggestion shows nearness as a tier, not a distance, and no opening hours (raised by S54c) |
| OQ-331 | OQ-546 | The suggestion appears on the web chooser, not on the phone (raised by S54c) |
| OQ-332 | OQ-547 | A suggestion expires after a configured window, and only the patient can answer it (raised by S54c) |
| OQ-340 | OQ-548 | Journey aggregate figures cannot be tested over 300 people while test data is always is_test (raised by S85) |
| OQ-341 | OQ-549 | An untied clinician can read reproductive and mental health rows for a whole organisation (raised by S85, jour |
| OQ-342 | OQ-550 | The web app has no offline emergency guidance (raised by S85, journey 2) |
| OQ-343 | OQ-551 | The approved bp_care_triage v3 names no follow-up task for a red reading (raised by S85, journey 2) |
| OQ-344 | OQ-552 | Checkout is dormant on a fresh database, and the plan's "seed.sql does not exist" is a path error (raised by S |
| OQ-330 | OQ-553 | Sealed cycle data is never destroyed, and deletion on request sits beside "do not erase real data" |
| OQ-331 | OQ-554 | The new go-live guard cannot be switched on yet |
| OQ-332 | OQ-555 | Other reproductive tables are still read directly by staff, unaudited |
| OQ-333 | OQ-556 | PIN lock limits (founder to confirm the threat model) |
| OQ-334 | OQ-557 | Discreet naming beyond notifications |
| OQ-335 | OQ-558 | Clinician report reason is a fixed phrase |
| OQ-336 | OQ-559 | Danger-sign, contraception and menopause wording are proposed copy |
| OQ-337 | OQ-560 | Live policy drift under the new functions |
| OQ-350 | OQ-561 | Which pieces of S68 run only after the CMO signs (raised by S68) |
| OQ-351 | OQ-562 | MUAC age range and the 12 hour "same-day" line (raised by S68) |
| OQ-352 | OQ-563 | WHO LMS source and licence (raised by S68; CMO pack question 5) |
| OQ-353 | OQ-564 | Plausibility ranges for head circumference and MUAC (raised by S68) |
| OQ-354 | OQ-565 | EPDS cut-offs and the Nigerian validation range (raised by S68; pack A6) |
| OQ-355 | OQ-566 | When to prompt the EPDS (raised by S68) |
| OQ-356 | OQ-567 | Lifecycle stages, the loss path and its copy (raised by S68; founder items 8) |
| OQ-357 | OQ-568 | NDPA wording for sealed clinician data (raised by S68; pack B3) |
| OQ-358 | OQ-569 | Deleting the loss note but not the stage fact (raised by S68) |
| OQ-359 | OQ-570 | Nothing schedules the deletion sweep (raised by S68) |
| OQ-360 | OQ-571 | NPHCDA schedule reconciliation not possible from the official source (raised by S68; pack A8) |
| OQ-361 | OQ-572 | `sponsor_care_report.last_clinical_review` can reflect a maternal or child alert date (raised by S68) |
| OQ-313 | OQ-573 | Where the CMO signs a language registry change (raised by S86) |
| OQ-310 | OQ-574 | Employer roster invitations can be sent by SMS (raised by S87) |
| OQ-311 | OQ-575 | Part C.2 says clinicians are freelance only; the platform allows employed doctors (raised by S87) |
| OQ-312 | OQ-576 | Dormant schema that Part C mentions, found live on 2026-10-07 (raised by S87) |
| OQ-340 | OQ-577 | Partner invoice totals are readable by care-team staff, clinicians included (raised by Track G) |
| OQ-341 | OQ-578 | Refund policy flags and notes are readable by every signed-in user (raised by Track G) |
| OQ-342 | OQ-579 | A patient can read the staff note on their own refund (raised by Track G) |
| OQ-343 | OQ-580 | Refunds can be raised and approved by any care-team user, including a clinician (raised by Track G) |
| OQ-344 | OQ-581 | Any migration that adds a column to the four cost tables must also grant it (raised by Track G) |
| OQ-345 | OQ-582 | Old web tabs lose two duplicate checks silently until reloaded (raised by Track G) |
| OQ-340 | OQ-583 | BP-P1 routes every pregnant reading, wider than the wording of decision A1 (raised by S67) |
| OQ-341 | OQ-584 | Kick counter: "normal not reached" and the drop factor are this build's reading of A3 (raised by S67) |
| OQ-342 | OQ-585 | Risk flag vocabulary and who may set it (raised by S67) |
| OQ-343 | OQ-586 | Pregnancy content is empty and gated until the CMO reviews it (raised by S67) |
| OQ-344 | OQ-587 | S67 migrations and the proof script were NOT run (raised by S67) |
| OQ-345 | OQ-588 | New pregnancy tables use `is_org_staff`, not the S39b tied-staff rule (raised by S67) |
| OQ-360 | OQ-589 | Who may start a cohort? (raised by S69) |
| OQ-361 | OQ-590 | Residual re-identification: two published snapshots a few hours apart (raised by S69) |
| OQ-362 | OQ-591 | What a member can see of other members (raised by S69) |
| OQ-363 | OQ-592 | The effort-only rule depends on what is recorded (raised by S69) |
| OQ-370 | OQ-593 | Group audio (17.8) is schema only (raised by S69) |
| OQ-371 | OQ-594 | The solo wellness challenge still shows its title in the app (raised by S69) |
| OQ-309 | OQ-595 | Cross-source duplicate readings (raised by S70, function 18.9) |
| OQ-310 | OQ-596 | CGM glucose and the red-flag engine (raised by S70) |
| OQ-311 | OQ-597 | Personal ECG devices and irregular rhythm (raised by S70, function 18.6) |
| OQ-312 | OQ-598 | Photo capture of device screens (raised by S70, function 18.3) |
| OQ-313 | OQ-599 | Recommended devices list and real-device test (raised by S70, functions 18.1 and 18.2) |
| OQ-314 | OQ-600 | BP control basis: home vs clinic (raised by S38 design, decided by S75-1) |
| OQ-315 | OQ-601 | Outcome definitions for HbA1c, weight, PHQ-9 and GAD-7 (raised by S75, function 22.1) |
| OQ-316 | OQ-602 | Triage dashboard naming (raised by S75, extends OQ-255) |
| OQ-317 | OQ-603 | Risk stratification fairness review (raised by S75, function 22.3) |
| OQ-320 | OQ-604 | Device shop and the Tarragon band (raised by S74, function 21.5) |
| OQ-321 | OQ-605 | Health Points at checkout and the leftover kobo conversion (raised by S72, function 19.9; finishes OQ-08) |
| OQ-322 | OQ-606 | Instalments (raised by S72, function 19.10) |
| OQ-330 | OQ-607 | Kobo conversion for wellness points still present (raised by S73; extends OQ-08 and OQ-321) |
| OQ-331 | OQ-608 | Values in `pricing.rules` are unsigned guesses (raised by S73) |
| OQ-332 | OQ-609 | Screens not built (raised by S73) |
| OQ-333 | OQ-610 | What-is-included page needs a login (raised by S73) |
| OQ-334 | OQ-611 | Migration stamp ahead of the clock (raised by S73) |
| OQ-360 | OQ-612 | Partner quality numbers (raised by S74, function 21.7) |
| OQ-361 | OQ-613 | Home test kits (raised by S74, function 21.1) |
| OQ-362 | OQ-614 | Settlement four eyes with one founder (raised by S74, function 21.6) |
| OQ-363 | OQ-615 | Pharmacy sourcing claim and batch record (raised by S74, function 21.2) |
| OQ-364 | OQ-616 | Pharmacist chat scope (raised by S74, function 21.2) |
| OQ-365 | OQ-617 | go_live_conditions wrapper (raised by S74) |
| OQ-366 | OQ-618 | Clinic calendar and migration timestamps (raised by S74, function 21.3) |
| OQ-309 | OQ-619 | Free red events are guidance-only (CMO decision 2026-10-08): the INV-05 consequence |
| OQ-310 | OQ-620 | Two-tier pricing: price, only Free and Member, lapse, organisation seats (raised by the two-tier pricing build |
| OQ-311 | OQ-621 | Prescription renewal spacing and the old renewal credit (raised by the 2026-10-12 review) - RESOLVED 2026-10-1 |
| OQ-312 | OQ-622 | Legacy conversion: no end date (raised by the 2026-10-12 review) - RESOLVED 2026-10-13 |
| OQ-313 | OQ-623 | Legal text for the 21 day refund (raised by the 2026-10-12 review) |
| OQ-314 | OQ-624 | Confirm the canary budgets and chain health thresholds (raised by P1) |
| OQ-315 | OQ-625 | Synthetic canary organisation in production (raised by P1) |
| OQ-316 | OQ-626 | External heartbeat for the canary (raised by P1) |
| OQ-317 | OQ-627 | Retiring the legacy BP alerts (D1) (raised by P1) |
| OQ-318 | OQ-628 | Retention of canary triage events (raised by P1) |
| OQ-319 | OQ-629 | Signs ticked on the phone are not all stored on the server (raised by P2) |
| OQ-320 | OQ-630 | Monitor and wearable glucose is not graded by v1 (raised by P2) |
| OQ-321 | OQ-631 | Both glucose pipelines page after signing (raised by P2) |
| OQ-322 | OQ-632 | Unknown diabetes type is graded as an adult (raised by P2) |
| OQ-323 | OQ-633 | Ketone cases the decisions did not state (raised by P2) |
| OQ-324 | OQ-634 | Due time of the urgent glucose review and level 1 lows (raised by P2) |
| OQ-325 | OQ-635 | Nigerian diabetes guideline check before signing (raised by P2) |
| OQ-326 | OQ-636 | Fast-sugar wording needs its own signature (raised by P2) |
| OQ-327 | OQ-637 | Older glucose alerts compare the unrounded value (raised by P2) |
| OQ-328 | OQ-638 | Third BP band list in the clinical decision support engine (raised by P2) |
| OQ-329 | OQ-639 | Does a delivered push receipt end the unconfirmed wait? (raised by P3) |
| OQ-330 | OQ-640 | "I could not get care" opens the call at once (raised by P3) |
| OQ-331 | OQ-641 | Invented timing numbers (raised by P3) |
| OQ-332 | OQ-642 | Clinician SMS paging cannot send (raised by P3) |
| OQ-333 | OQ-643 | Emergency contact SMS keeps its old behaviour (raised by P3) |
| OQ-334 | OQ-644 | An unconfirmed task type blocks every triage rule set approval (raised by P3) |
| OQ-335 | OQ-645 | DPIA for the red-alert channel and answers (raised by P3) |
| OQ-336 | OQ-646 | Signed document link lands on the home screen after login (raised by P3) |
| OQ-337 | OQ-647 | Owner of `notifications.rules` v4 (raised by P3) |
| OQ-338 | OQ-648 | Second payout approver (raised by P4) |
| OQ-339 | OQ-649 | Real payout limits (raised by P4) |
| OQ-340 | OQ-650 | Finance treatment of payouts (raised by P4) |
| OQ-341 | OQ-651 | Retention of webhook inbox rows (raised by P4) |
| OQ-342 | OQ-652 | Audio-fallback table values (raised by P4) |
| OQ-343 | OQ-653 | Drug-name list and speech vendor pass mark (raised by P4) |
| OQ-344 | OQ-654 | End date for grandfathering the two existing clinicians (raised by P5) |
| OQ-345 | OQ-655 | Exempting `is_test` clinicians from the verification gate (raised by P5) |
| OQ-346 | OQ-656 | Retention and DPIA for credential evidence (raised by P5) |
| OQ-347 | OQ-657 | Doctors trained locally and DataFlow (raised by P5) |
| OQ-350 | OQ-658 | Lead ineligibility is labelled licence_expired (raised by P5) |
| OQ-351 | OQ-659 | Licence and cover dates are typed by one reviewer (raised by P5) |
| OQ-352 | OQ-660 | First caller of the identity adapter must check consent (raised by P5) |
| OQ-353 | OQ-661 | Turn the daily silence and adherence sweep on? (raised by P6) |
| OQ-354 | OQ-662 | BP-A4 task beside the existing adherence alert (raised by P6) |
| OQ-355 | OQ-663 | A symptom alone has no engine rule (raised by P6) |
| OQ-356 | OQ-664 | Adherence window naming (raised by P6) |
| OQ-357 | OQ-665 | Stored triage context is re-read when the result is written (raised by P6) |
| OQ-358 | OQ-666 | `clinical_staff_directory` exposes the MDCN folio (raised by the integration pass) |
| OQ-293 | OQ-667 | The emergency and self-harm wording is PROPOSED, and no hotline exists (raised by S52) |
| OQ-294 | OQ-668 | The self-harm on-call page is not an S19 page row (raised by S52) |
| OQ-295 | OQ-669 | Silence signal consumption by the triage engine (raised by S52) |
| OQ-296 | OQ-670 | Who may review (raised by S52) |
| OQ-297 | OQ-671 | AI-020 needs its governance criteria before it can be switched on (raised by S52) |
| OQ-298 | OQ-672 | How fast a cut-off self-harm page is retried (raised by S52 round 5) |
| OQ-299 | OQ-673 | The daily nudge no longer reaches test accounts (raised by S51 round 5) |
| OQ-330 | OQ-674 | The CMO-signed escalation ladders still name sms (raised by S85-D3) |
| OQ-331 | OQ-675 | Loose ends of the SMS removal that need their own decision (raised by S85-D3) |
| OQ-332 | OQ-676 | The emergency-contact SMS exception: switching it on (raised by S85-D3) |
| OQ-287 | OQ-677 | Sexual health, STI and HIV records are on the open path (CMO choice, counsel to confirm) |

### Which heading kept each old number

This is not an open question (the heading level keeps it out of the uniqueness scan only by its text, not an OQ id). Use it with the map above: an old citation of `OQ-N` that does not match a title in the map means the heading below.

| Number | Kept by (line, title) |
|---|---|
| OQ-124 | 706, No `pathway_enrolments` table exists; where does the lead live (raised by S18) |
| OQ-125 | 711, Who may be a lead: spec says tier 2, F-05 collapsed tiers (raised by S18) |
| OQ-126 | 716, `order.paid` has no producer until S25 (raised by S18) |
| OQ-127 | 721, Capacity and cover gates are exposed, not wired (raised by S18) |
| OQ-128 | 726, Working-hours, rest and fatigue numbers need clinical review (raised by S18, OQ-112) |
| OQ-129 | 731, Patient wording when the lead changes, and whether the patient sees the lead's name (raise |
| OQ-130 | 736, Changing lead on request (raised by S18) |
| OQ-131 | 741, Chart access starts at acknowledgement, not at the page (raised by S19) |
| OQ-132 | 746, What a red page should say to Care Circle supporters and the clinical lead's review (raise |
| OQ-133 | 751, Acknowledgement targets and how long the lead is re-alerted (raised by S19) |
| OQ-134 | 756, Contractor status and declared hours (raised by S18, second pass) |
| OQ-135 | 762, Strikes and a doctor's other job (raised by S18 and S19, second pass) |
| OQ-136 | 767, Acknowledgement targets are not clinically validated (raised by S19, second pass) |
| OQ-170 | 977, No ledger posting for catalogue orders yet (raised by S25) |
| OQ-171 | 983, Paying for someone else is not open yet (raised by S25) |
| OQ-172 | 987, Care pack price and what is sold at launch (raised by S25) |
| OQ-173 | 992, Retired payment code paths are still reachable (raised by S25, extends OQ-97) |
| OQ-174 | 997, Fee estimate is configuration, and its numbers are unverified (raised by S25, extends OQ-9 |
| OQ-175 | 1003, Secrets and deploy steps for S25 (raised by S25) |
| OQ-176 | 1027, Service-role writes bypass the signed-medicine trigger (raised by S24) |
| OQ-177 | 1030, What a consultation share is a share OF, inside the Membership (raised by S30) |
| OQ-178 | 1033, Fee sharing and the MDCN code (raised by S30; counsel needed) |
| OQ-179 | 1036, On-call shift fee: the backup, and being ready (raised by S30) |
| OQ-180 | 1039, The pilot minimum can be earned by declaring hours and doing nothing (raised by S30) |
| OQ-181 | 1042, Work finished before the first schedule is approved (raised by S30) |
| OQ-182 | 1045, The wait step is read at the final claim (raised by S30) |
| OQ-183 | 1048, Staff screens use plain English in the page, not `packages/i18n` (raised by S30) |
| OQ-184 | 1051, Refunds, tax and employed doctors who convert (raised by S30; deferred) |
| OQ-185 | 1054, A late line can push a clinician past the pilot minimum (raised by S30) |
| OQ-192 | 1133, Several older read paths admit ANY profile_access grantee with no permission check (found  |
| OQ-213 | 1264, The facts stage lists medicines the draft stage may not write (raised by S35c) |
| OQ-214 | 1270, Language release needs a measured word error rate and a pass mark (raised by S35c) |
| OQ-215 | 1276, The signed hash detects change; it is not a signature (raised by S35c) |
| OQ-216 | 1281, No live recording indicator exists because nothing records (raised by S35c) |
| OQ-220 | 1141, Supporters abroad: organisation, signup and the join link (raised by S29) |
| OQ-221 | 1146, What a red alert tells a supporter, and who chose it (raised by S29, extends OQ-132) |
| OQ-222 | 1150, Care Circle PROPOSED values and permission wording to confirm (raised by S29) |
| OQ-223 | 1154, The Care Circle contact hash has no secret pepper, and a payer can learn some state of the |
| OQ-224 | 1327, Roster is filtered to the caller's organisation (S36d) |
| OQ-225 | 1330, Display settings of the reliability and SLA dashboard (S36e) |
| OQ-270 | 1550, Who joined, and from when (raised by S38; was numbered OQ-235, which S36g already used) |
| OQ-271 | 1555, Not applied, console home (raised by S38; was numbered OQ-236, which S36g already used) |
| OQ-272 | 1709, Delivery schema is still present (Part C.2 says no home delivery) |
| OQ-273 | 1714, Not built in S28: price comparison, verified batches, pharmacist chat |
| OQ-274 | 1559, Risk points and tier cut-offs (raised by S38c) |
| OQ-275 | 1564, Monthly report thresholds, and what the care team did (raised by S38c) |
| OQ-276 | 1569, Sharing the monthly report with the Care Circle (raised by S38c, closed by S38d) |
| OQ-277 | 1573, Two risk tables with different jobs, worklist cost, who may read it (raised by S38c) |
| OQ-278 | 1649, Tied direct reads on the other tables are not audited one by one (INV-10) (DECIDED 2026-10 |
| OQ-280 | 1659, What S39b deliberately left organisation-wide (103 tables, listed with reasons in `staff_r |
| OQ-281 | 1664, May a patient ask who opened their record, and must they be told? (counsel) (DECIDED 2026- |
| OQ-282 | 1670, The access log records the opening of a record, not each table read inside the window (DEC |
| OQ-283 | 1677, Retention periods are proposals until counsel confirms them (DECIDED 2026-10-07: follow th |
| OQ-284 | 1682, The registry classification is a proposal until the CMO and DPO review it (DECIDED 2026-10 |
| OQ-285 | 1688, The export function is not yet behind the existing download route (DECIDED 2026-10-07, bui |
| OQ-286 | 1693, The shared worklist shows the kind of care to any clinician without a logged opening (DECI |
| OQ-287 | 2159, Pharmacy collection needs the S37 go-live guard (DECIDED and built in S28c) |
| OQ-290 | 1816, S53 and S54 were built before the Stage 1 gate (S40) closed (raised by S53, recorded 2026- |
| OQ-291 | 1821, Partner commission columns were readable by every signed-in user, on pharmacy and on labor |
| OQ-292 | 1826, Where the Nigerian medicine catalogue's real data comes from (raised by S53) |
| OQ-293 | 1831, A photo of a prescription is not read or stored (raised by S53) |
| OQ-294 | 1835, NAFDAC MAS short code and coverage need a human check before store publication (raised by  |
| OQ-295 | 1839, The patient's interaction note on the medicines list changed wording, and the add-time che |
| OQ-296 | 1844, The phone has no pack-photo reader (raised by S53) |
| OQ-297 | 1848, Missed-dose and silence signals still do not reach the triage engine (OQ-89, restated by S |
| OQ-298 | 1851, The supporter missed-dose notice uses the older profile-access grant, not the Care Circle  |
| OQ-299 | 1855, Side-effect notes: reviewed button is on the chart only, and a note creates no task (raise |
| OQ-309 | 2674, The Paystack webhook still has a refund branch for a retired Platform Credit charge (raise |
| OQ-310 | 2434, Who runs the monthly AI review sample draw, and when? (raised by S80c) |
| OQ-311 | 2438, The 213 published health education items that were never clinician-reviewed (raised by S80 |
| OQ-312 | 2442, The AI review queue reads patient-derived text without a patient tie (raised by the S80 co |
| OQ-313 | 2447, Six consent types have no version row, on purpose (raised by the S83 audit fix) |
| OQ-314 | 2483, Delivery schema and screens are hidden, not removed (D5, restates OQ-16 and OQ-272) |
| OQ-315 | 2486, No price comparison or pharmacist chat on the phone (raised by S54) |
| OQ-316 | 2489, Dependants: the server's push and in-app dose reminders still go to the dependant's own ac |
| OQ-317 | 2493, A possible emergency in a pharmacist chat reaches the patient and the pharmacist, not the  |
| OQ-318 | 2900, Paid two-week CGM programme (raised by S70, function 18.5) |
| OQ-319 | 2904, One minimum-cell function (raised by S75, extends OQ-233) |
| OQ-320 | 2695, Partner cost and refund margin columns are still readable by the patient and org staff (ra |
| OQ-321 | 2700, Old installed mobile builds break on two reads when the Track E migration is applied (rais |
| OQ-322 | 2705, Track E ships on top of the unapplied S53 pre-fix (raised by Track E) |
| OQ-323 | 2922, Community Access Fund legal vehicle (raised by S72, function 19.11; extends OQ-07) |
| OQ-324 | 2926, Subscription toggle and leftover Paystack plan codes (raised by S73, function 20.2) |
| OQ-325 | 2930, HMO eligibility adapter (raised by S71, function 19.6) |
| OQ-326 | 2934, Partner settlement scope (raised by S74, function 21.6) |
| OQ-327 | 2938, Gaps found in the S70 to S75 review that need an owner |
| OQ-328 | 2987, Sponsor coverage cannot be charged yet (raised by S73) |
| OQ-329 | 2991, Hardship pricing is a seam (raised by S73, extends OQ-323) |
| OQ-330 | 2216, Consent wording is placeholder text: counsel must approve it (extends OQ-49) |
| OQ-331 | 2220, Should the care purpose be optional for reproductive and mental health data? |
| OQ-332 | 2224, Sponsor reporting is not wired because the sponsor report is on PR #988 |
| OQ-333 | 2228, Which matrix cell gates which Care Circle block |
| OQ-334 | 2232, No research export job exists; the roster is the only door |
| OQ-335 | 2236, Is the anonymiser enough to count as erasure? |
| OQ-336 | 2240, The export has no stored file |
| OQ-337 | 2244, A young person who never signs in |
| OQ-338 | 2248, Kept guardians |
| OQ-339 | 2252, The elder-proxy downgrade that already ran |
| OQ-340 | 2256, Category to permission mapping (closes OQ-51 in the safest direction) |
| OQ-341 | 2260, The add-an-adult path (closes OQ-47 partly) |
| OQ-342 | 2264, OQ-48 and the cooling-off |
| OQ-343 | 2268, Apply order and review |
| OQ-344 | 2272, Not run, and mobile gaps |
| OQ-345 | 2276, The OQ-53 rule on the older consent table exempts service and migration contexts |
| OQ-346 | 2793, Patient screens for the counter, timer, birth plan, week card and schedule are not built ( |
| OQ-347 | 2798, Kick and contraction results are decided on the phone and trusted by the server (raised by |
| OQ-350 | 1861, Stage 1 gate (S40) not closed; the assistant is built but switched off (raised by S51) |
| OQ-351 | 1865, Positive screening rows are still readable by the patient on the base table (raised by S51 |
| OQ-352 | 1870, Knowledge base rows have no owner or review date today, so retrieval is inert (raised by S |
| OQ-353 | 1875, Extra red-flag wording is PROPOSED; the written-question list is unchanged (raised by S51) |
| OQ-354 | 1880, The hand-off to the care team stays outside the assistant guard (raised by S51) |
| OQ-355 | 1884, `go_live_conditions` is patched in place (raised by S51) |
| OQ-356 | 1888, Model-polished nudge text and the INV-07 lint on the other free-text paths (raised by S51) |
| OQ-357 | 1892, Dose screens will sometimes over-block (raised by S51) |
| OQ-358 | 2119, An emergency message is answered even while the assistant is closed (raised by S51, from t |
| OQ-359 | 2123, Which other screening results the assistant must never explain (raised by S51) |
| OQ-360 | 2128, Nudges reach patients who used the assistant once, whatever their plan now (raised by S51, |
| OQ-361 | 2133, The conditions and medicines lists reach the model and the visit draft unfiltered (raised  |
| OQ-362 | 2622, Staff reads of the new tables use `is_org_staff` today (raised by S68) |
| OQ-363 | 2625, Real-clinician paging for severe acute malnutrition does not use the S19 on-call page (rai |
| OQ-364 | 2823, Activity minutes have no wearable source yet (raised by S69) |
| OQ-365 | 2827, Templates, consent text and counsel are all drafts (raised by S69) |
| OQ-366 | 2831, The go-live guard patches two shared functions (raised by S69) |
| OQ-370 | 2737, Device capabilities need the CMO and an admin before anything switches on (raised by S70a) |
| OQ-371 | 2741, Go-live uses `platform_modules`, not `go_live_guards` (raised by S70a) |
### OQ-CGJ-1 A caregiver can join only inside the app's call, never by link or phone (raised by CGJ)
- A Zoom link or a phone dial-in carries no participant key, so a person who joined that way could not be tied to the patient's invite, seen by the clinician as "Caregiver present", or revoked. The caregiver's join therefore uses the same in-app Meeting SDK path as the patient and clinician, with its own server-minted join credential and a key bound to the one invite. There is no link fallback and no dial-in for a caregiver.
- Consequence: the feature is dead until the in-app call is live (`ZOOM_SDK_KEY`/`ZOOM_SDK_SECRET`, which today do not exist; OQ-136). The caregiver's page says so plainly instead of offering a way that cannot be attributed. The Expo app has no SDK, so a caregiver joins from the web browser (the supporter's invite card opens the web room).
- The room passcode is a room-level secret that the SDK needs, so the caregiver is handed the same passcode as the patient. The waiting room stays on, so the clinician admits the guest. Decision needed: whether to make the caregiver wait in the waiting room explicitly (it already does, the host admits) or to require a per-participant passcode (Zoom offers none).
- Conservative default: SDK only, no link, no phone. Decision: open (founder).

### OQ-CGJ-2 Removing a caregiver who is already inside the video cannot be done from our server (raised by CGJ)
- Zoom's REST API has no remove-participant call we could add to `VideoProvider` (the web SDK has none for a client that is not the host either; the clinician is the host in the embedded call). So "remove" does everything the platform controls: the pass is revoked for good, `service_get_caregiver_pass` and `service_record_caregiver_event` refuse it, the caregiver's page stops being available and their client leaves the call within its 10 second refresh, the person cannot be re-invited to that call, and an `encounter_events` row records it. A caregiver already inside the Zoom room is removed by the clinician in Zoom's own participant list, and the clinician panel tells them to.
- A caregiver who keeps their client open and ignores the page refresh stays connected until the clinician expels them. A re-entry presenting the removed key is logged by `/api/zoom/webhook` (once `ZOOM_PRESENCE_WEBHOOK=1`).
- To confirm on a live account: whether the Component View participants panel is shown to the host with a "Remove" action, and whether Zoom now offers an in-meeting-control REST call for removal.
- Decision: open (engineering, after the first live call).

### OQ-CGJ-3 The AI note-taker and a third person on the call (raised by CGJ)
- Scribe consent stays the patient's own in-app answer; a caregiver can neither give nor withdraw it (proved). But when the patient allowed the AI note-taker, a guest's voice is on the same call. The caregiver's page says an AI note-taker may be on if the patient allowed it; there is no per-guest consent.
- Conservative option not built: pause the scribe while a caregiver is present, or ask the guest. Decision needed from the CMO and the DPO before go-live.
- Decision: open (CMO, DPO).

### OQ-CGJ-4 Caregiver age (raised by CGJ)
- The brief says caregivers are adults. A supporter-only account is never asked for a date of birth (so a fail-closed rule would exclude exactly the daughter or son abroad who supports a parent). Built: a KNOWN age under `minAgeYears` (18) is refused, a dependant's account is always refused, and an UNKNOWN age is allowed because config `requireDateOfBirth` is false (versioned, PROPOSED, `consultations.caregiver_join`). Flipping it to true is a new config row, not code.
- The 18+ telemedicine gate for the PATIENT is untouched (`encounters_adult_gate`), and a minor patient's guardian flow stays S42's.
- Decision: open (founder; confirm the unknown-age default).

### OQ-CGJ-5 Wording of the new Care Circle permission is not in the reviewed-strings ledger (raised by CGJ)
- The permission label (`consult.cg.perm`: "Joining a call with my care team, only when I invite them to that call") sits OUTSIDE the `circle.*` namespace on purpose. The reviewed-strings ledger covers `circle.*` and its backlog may not grow; a new `circle.perm.attend_consultation` would need a real reviewer and date that no agent can supply. So the label is unreviewed, not hidden: it is a consent-adjacent string.
- Needs: the DPO or CMO to review the label and the invite copy (`consult.cg.*`); then either move the key under `circle.*` with a ledger entry or extend the ledger's namespaces.
- Also: `circle_consultation_invite` is a new template in `send-pending-notifications/templates.ts`; the deployed edge function must be redeployed (it drifts) before the push/email text goes out. The in-app text and the page work without it.
- Decision: open (CMO/DPO for the wording; ops for the deploy).

### OQ-705 Yearly proxy-access review: the proposed numbers and the silent-person rule (raised by the yearly review build, 2026-10-16)
- PROPOSED in `proxy_review_config` v1 (mirrored as `proxy.annual_review`): a proxy or caregiver grant is due for review 12 months after it was given or last kept or narrowed; the reminder repeats every 30 days, at most 4 times in a cycle. Nothing is signed.
- Rule built in, not a number: **silence never removes access.** An elder must never lose help because they did not answer. After the cap the reminders stop, and the item stays on the person's list as due (with a "waiting a while" line) until they answer. If the founder wants a harder rule (for example a flag for the care team after a long silence), that is a new decision.
- Scope: the person's own `profile_access` grants where they are an adult with their own login. Under-18 dependants (hand-over at 18 covers it) and records with no login of their own (`is_dependent_account`, nobody could answer) are out of scope, as are grants past their own `expires_at`. Care Circle members have their own expiry and renewal flow (S29) and are not part of this.
- Coercion check (same family as OQ-48): the proxy is told once per cycle, in the app only, that a yearly check is due ("You do not need to do anything"). It says nothing about the outcome, and narrowing and removal stay silent (D5). The "Yearly check due" badge on the proxy's "People whose care you manage" list shows only that it is due. Review of the build found the real risk: the notice and the badge tell a controlling proxy that a review is under way, and, as first built, the badge cleared when the person kept or narrowed (a timing signal). That was fixed: the proxy flag now shows for a fixed `proxy_notice_days` (14) counted from the notice, whatever the person does, so it carries no signal of their answer. What remains is the notice itself, and removal visibly ending the access. DECIDED 2026-10-19 (founder, in chat): `proxy_review_config.tell_proxy = false`, so the proxy is told nothing and sees no flag. The switch is data, not code: a new config version with `tell_proxy = true` turns the calm in-app notice, the badge and the `proxy_told` history on.
- Decision: open (founder). Counsel need not be asked.

### OQ-706 Yearly proxy-access review: mobile screen and email/push delivery not exercised (raised by the yearly review build, 2026-10-16)
- The mobile app has no proxy-controls screen today (narrow, remove, view log are web only), so the review card is web only. The in-app notice appears in the notification list on both. A mobile review card belongs with whichever session first brings the proxy controls to mobile.
- The patient push and email versions exist (`proxy_review_due` renderers in `send-pending-notifications`) and are queued only when the person's own channel preference allows, but the edge function must be redeployed to carry the two new renderers (`supabase functions deploy send-pending-notifications`); until then those two rows would fail while the guaranteed in-app row still works. No real push or email was sent in this build.
- UPDATE 2026-10-20: the phone now shows the yearly review card (Family and Privacy screens) with the same three answers, and the same rules: silence never removes access, a narrowing or removal tells the proxy nothing. Not yet seen on a device.
- Decision: informational (follow-up).
### OQ-702 Should a patient be able to replace a file after the care team has opened the alert (raised by the document supersede)
- Done: a replacement supersedes the original (new row, old row and file kept, alert handed over with the higher priority). Allowed only before review, as before.
- Open 1: an alert a clinician already acknowledged (not the document) is resolved as a handover and the replacement starts open again; the acknowledging doctor is not told. A short in-app note to the responsible clinician would close this.
- Open 2: a retry of the mobile POST after a response was lost returns "already replaced" although the replace worked (the old row is hidden, so the route reports it as not the patient's). An idempotency key from the app would remove it.
- Open 3: a staff supersede (module 57.14) of a never-reviewed document now hides the original from staff too. Say if staff should still see those.
- Open 4: other SECURITY DEFINER readers of `lab_result_documents` (care-gap, provenance, folio functions) were not audited one by one; each may still treat a replaced, never-reviewed document as present. Only `clinical_worklist` and `org_open_work_counts` were patched.
- Open 5: replacement is not rate limited (each call writes a row, an alert and an audit row) and does not check that a storage object exists at the path; a per-hour cap from versioned config is the gate to add.
- Open 6: the patient UPDATE policy from 20260912 still lets a patient rewrite metadata (filename, mime type, order link) on her own unreviewed upload; it existed only for the in-place replace and could be dropped.
- Open 7: the supersede flag is a transaction setting (`app.result_document_replace`); anyone who can run arbitrary SQL as an authenticated user can set it. Not reachable through the API today.

### OQ-PASSKEY-01 Turning passkeys on (your action, in this order)
- Passkeys ship OFF and nothing works until all of these are done. (1) After merge, redeploy the `send-pending-notifications` edge function (new `security.passkey_*` email templates). (2) In the Supabase dashboard, Authentication, Passkeys: enable, relying-party display name "Tarragon Health", relying-party id `tarragonhealth.ng` (permanent: changing it later invalidates every passkey), origins `https://app.tarragonhealth.ng` plus any other host that serves `/login`. (3) Confirm `select public.passkey_gate_ready()` is true. (4) Sign in as a test patient with a password, add a passkey in Settings, sign out, sign in with it on a real phone and laptop. (5) Only then flip the `passkeys` switch. There is no general switch screen yet: either ask a Claude session to call `public.set_platform_switch('passkeys', true, '<why>')` under a simulated admin session (audited), or in the Supabase SQL editor run `update public.platform_switches set is_on = true, changed_at = now(), change_note = '<why>' where key = 'passkeys';` (not audited). Note the migration's gate refuses to store a passkey while the switch is off, so step 4 needs the switch on for a test window; use a test account.
- The Auth passkey API is marked experimental by Supabase and may change.
- Decision: open (founder).

### OQ-PASSKEY-02 Mobile passkeys not built
- Needs a native passkey library (new native dependency), a `runtimeVersion` bump and a fresh EAS build (never auto-published by the OTA workflow), iOS associated domains plus an Apple App Site Association file and Android `assetlinks.json` on the production domain, the Android origin added to the Auth origins, and tests on real devices. Phone sign-in stays the default there.
- Decision: open (founder).

### OQ-PASSKEY-03 "Use a passkey" shows only on devices that have used one
- The sign-in page cannot ask the server who has a passkey before anyone says who they are (that would let anyone test which accounts exist), so the button appears only when this device remembers a passkey was added or used here. A passkey synced to a brand-new device will not show the button there; that person signs in the usual way. Alternative: always show the button when the switch is on (more discoverable, noisier for the many who will never use it).
- Decision: open (founder).

### OQ-PASSKEY-04 Adding a passkey needs a password
- A person who signs in only by phone code and has set no password is told to set one first. Reason: a session alone must not be able to plant a lasting way in (the same reason backup codes need the password). Alternative: accept a fresh phone-code re-check instead.
- Decision: open (founder).
### OQ-707 Share extras: mobile screen, and whether a label should ever gate access (raised by the share-extras build, 2026-10-19)
- The recipient label is a label only. Anyone holding the link (and the PIN, if one was set) can open it; the label does not check who opens it. The page says so. If you want the doctor to prove who they are, that is a different, larger feature.
- UPDATE 2026-10-20: the phone now has a native Share records screen (My Health, Share records) with all three fields, a PIN, send through the phone's share sheet, and revoke. Print / Save as PDF stays web only (it needs a native print module, which means a new app build); on the phone the link itself is sent and the recipient prints from the page.
- The date window trims vitals and lab results only (the other sections have no time dimension that matters to a visit).
- Options: (a) leave as is (recommended), (b) build the phone fields next.
- Decision: open.
### OQ-708 Share in a standard format: FHIR file and SMART Health Link (raised by the standard-format share build, 2026-10-20)
- Built: a recipient who has opened a share can save it as a FHIR R4 `collection` bundle (built in their browser from what is already on the page, so it is not a second view). The patient can also copy a SMART Health Link (`shlink:/...`) for a clinic's software; it asks `/api/shl/{token}`, which uses the same share door as the web link, so the PIN, lockout, view cap, date window, expiry, revoke and access log all apply.
- NOT verified: no receiving hospital system, EHR or SMART Health Links viewer has been tried. The bundle is a plain `collection` using the S44 mapping, not an International Patient Summary document, and no Nigeria Core or NPHCDA profile is claimed (none is published). Whether a Nigerian hospital can import it is unknown.
- Needs a server secret: `SHARE_LINK_KEY_SECRET` (32+ characters). The link's key is HMAC(secret, share token), never stored. Without the secret the button says "not available" and `/api/shl/*` answers 503. Changing the secret makes every SMART Health Link already handed out stop opening (the ordinary share link keeps working).
- Each manifest request counts as one view of the link, like a person opening it. A link capped at 1 view is used up by the first successful request; a system that retries after a failure on its side will find it closed.
- The file is sent inline in the manifest. If a recipient says it cannot take a file that large the answer is 413 (no separate download address yet). A normal shared record is far below any limit seen in practice, but this has not been measured on real data.
- What is left out on purpose: emergency blood group and contact (no neutral FHIR home for them), and conditions travel as "unconfirmed" because the share does not carry who confirmed them.
- Passkeys on the phone are NOT built. They need a native module, which means a new app runtime version and a fresh store build; an over-the-air update cannot carry it. Decide if and when to do that as a native release.
- Options: (a) leave as is until a real clinic asks (recommended), (b) pilot with one clinic and fix what their software rejects, (c) move to an International Patient Summary bundle.
- Decision: open.

### OQ-701 Who may read the audit log directly (raised by the audit_log narrowing)
- Done: `audit_log` is directly readable only by its own actor and by admins. Org staff, tied clinicians and the CMO account lost the organisation-wide read; the screens they use read through SECURITY DEFINER functions that self-gate.
- Open 1: should the CMO or a clinical-governance reviewer have a scoped direct read (for example by action prefix) instead of only the S20 sampling RPCs?
- Open 2: `authenticated` can still INSERT audit rows about itself (S02 follow-up 5). Moving every writer to a definer function would let that insert policy be dropped.
- Decision: open.

### OQ-NAFDAC-SCAN-1 NAFDAC number format is PROPOSED from public examples (raised by the pack-scan build, 2026-10-16)
- The accepted shape is an optional letter (never I or O), one or two digits, a hyphen, three to six digits, an optional letter (registry key `medicines.nafdac_number_format`, mirrored by `NAFDAC_NUMBER_CONFIG`, a test fails on drift). Examples seen in public sources: A4-1234, 04-1234, B4-xxxx, and a six-digit tail such as A11-101363 in the Greenbook database. What each prefix means was not found in a public NAFDAC page and is not used.
- Needed: a pharmacist or the CMO to check a sample of real Greenbook numbers against the pattern, then publish a confirmed version. The pattern only says whether text is shaped like a number; it never says a pack is real.
- Decision: open (CMO or pharmacist).

### OQ-NAFDAC-SCAN-2 "Scan the pack" needs an on-device text reader, which is a native module (raised by the pack-scan build, 2026-10-16)
- Checked `apps/mobile/package.json`: `expo-image-picker` and `expo-image-manipulator` are present; no text-recognition module (ML Kit or Vision) is. Reading printed text on the phone needs one, so it is a new native dependency: a new EAS build and a `runtimeVersion` bump, and the OTA auto-publisher will skip the push (as OQ-73). Nothing was added and `runtimeVersion` was not touched.
- Built and shipping now: the number parser, the catalogue lookup, the confirm-each-field UI, the typed NAFDAC number (offline too), and the camera path behind capability detection (`packScanAvailable()` is false until a native build calls `registerPackTextReader`). The Scan button is hidden until then. Nothing has run on a device.
- Options: (a) add a maintained Expo text-recognition module in the next native build and register it (recommended; photo stays on the phone, no AI system involved); (b) a server vision read through the existing governed pack reader (AI-007, `runGovernedAi`); needs a bearer-authenticated mobile route, a go-live guard that starts OFF, and a decision that a pack photo may leave the phone; (c) typed entry only.
- Decision: open (founder).

### OQ-NAFDAC-SCAN-3 New pack-scan wording sits outside the reviewed-strings ledger (raised by the pack-scan build, 2026-10-16)
- The ledger (S-15) gives clinical namespaces no room for new baseline entries and no reviewer exists to name, so the new strings live under `packscan.*`, outside the gated namespaces. That is a way round the gate, not a review. Needed: the CMO or a pharmacist reads the `packscan.*` keys (especially `packscan.nafdac.not_a_check` and `.in_catalogue`), then they move into a gated namespace with a real reviewer entry.
- Decision: open (CMO).

### OQ-NAFDAC-SCAN-4 The number is used for lookup and pre-fill only; it is not stored on the medication (raised by the pack-scan build, 2026-10-16)
- `medications` has no NAFDAC column and none was added (no migration in this change). A number the person confirms fills the name and strength they can edit, then is forgotten. An unverified catalogue row never counts as a match. If the care team should see the number, that is a separate additive column and a decision on who reads it.
- Decision: open (product).

## S07y: blood pressure taken at a pharmacy or clinic machine, and the paper diary (2026-10-20)

Design: `docs/design/S07y-reading-labels-and-diary.md`. All three guards (`pharmacy_bp_readings`, `paper_diary_entry`, `paper_diary_ai_reader`) are OFF and AI-021 is DISABLED. Nothing below is signed or approved by this build.

### OQ-S07YL-1 Is a pharmacy or clinic machine reading a "clinic-like" reading, and is the label wording right? (raised by S07y; CMO)
- Built: the person ticks "This was taken at a pharmacy or clinic machine" (optionally names the place). It is stored as an ordinary manual reading with the label `pharmacy_machine`, graded and triaged exactly like any reading, shown everywhere with "Taken at a pharmacy or clinic machine", and left out of the 7-day home average, the signed home check (C1) and, through it, the white-coat and masked comparison (C3). C1 to C3 are unsigned, so this exclusion is a proposal, not a clinical ruling.
- Behaviour worth knowing: if the guard is closed at the moment a labelled reading is saved (a stale page, or a reading the phone queued before the switch went off) the reading is saved as an ORDINARY one with the setting in its note and the person is told, never refused, so a dangerous value cannot be lost to a go-live switch. In that case the reading IS counted in the home average (it carries no label), which is today's behaviour for every reading.
- Needed: the CMO confirms (a) the wording of the tick, its hint and the label, (b) that such a reading is shown and graded but never counted as a home reading, and (c) whether a machine of unknown make and calibration should carry any caveat on the patient screen. Until then the guard has no conditions and cannot be switched on.
- Decision: open (CMO).

### OQ-S07YL-2 Which other blood pressure calculations should leave a pharmacy reading out? (raised by S07y; CMO)
- Left out by this build: `home_bp_assess`, `hbpm_average`, `bp_window_stats`, the phone's 7-day average and home check. Still counting a pharmacy reading as any cuff reading (found by the code reviews): the ML control-rate assessment (`assess-bp-control.ts`), `risk_compute`, `outcome_compute_snapshot` (the S38 control status), `patient_monitoring_core`, the S75 cohort day and 90-day views, the clinical summary, the S46 yearly health report averages (`health_report_collect`), the S29 and S42 weekly blood pressure series, the doctor summary's "latest readings" and FHIR export (`observations` does not carry the label). So a patient and a clinician can see two different "average BP" figures (the home average, which leaves a pharmacy reading out, and the report or outcome average, which does not). Option (b) below closes that in one place. Rationale for leaving the risk and control calculations alone for now: a high pharmacy reading is real evidence about this person's control, and hiding it from a risk score is the less safe default; keeping it out of the HOME average is a question about what the average means, not about whether the reading is real. A pharmacy reading also closes the open "Missing expected blood-pressure readings" soft flag and resets the monitoring-gap clock, as any reading does.
- Options: (a) leave as built (recommended until C1 to C3 are signed); (b) add the label to the diagnostic view's filter so every "diagnostic" reader drops it (one line, but it also changes risk and outcome figures); (c) decide reader by reader. The same list applies to `paper_diary` (OQ-S07YL-3).
- Decision: open (CMO).

### OQ-S07YL-3 May a paper-diary reading count toward the home average or the signed seven-day check? (raised by S07y; CMO)
- Built: a diary reading is labelled "From your paper diary", is IN the general 7-day home average (it is a home reading the person wrote down) and is OUT of the signed seven-day protocol (C1 is a guided session with technique and timing that a diary cannot prove). Both are proposals.
- Decision: open (CMO). Flipping either is one line in `home_bp_assess` or `hbpm_average`.

### OQ-S07YL-4 A dangerous OLD value from a diary pages the care team and shows the emergency guidance (raised by S07y; CMO)
- Asked for and built: a confirmed dangerous diary value fires the deterministic red-flag pipeline and the patient-facing emergency safety net exactly as a live entry does (proved for blood pressure, glucose and pulse). A value dated up to 30 days ago therefore opens an emergency record, can page, and shows "go to the nearest hospital now" even though the person may be well today. This errs on the safe side and a person who wrote a crisis number in a diary should be asked how they are.
- Needed: whether a value older than some number of hours should instead go to a same-day care-team review without the emergency takeover. That is a clinical threshold; none was invented here. Decision: open (CMO).

### OQ-S07YL-5 Confirm the PROPOSED limits (raised by S07y; CMO)
- `vitals.diary_import` v1: a diary reading may be dated up to 30 days back (database column `offline_sync_config.diary_window_days`, drift test), one save carries at most 20 rows, a photo is at most 8 MB. A pharmacy reading keeps the existing 72 hour window. Plausibility limits are the existing `devices.plausibility` (no new limit was added). Decision: open (CMO).

### OQ-S07YL-6 AI-021 (the diary reader) cannot be switched on yet (raised by S07y; CMO, DPO, founder)
- Registered disabled, draft, not runtime governed. No evaluation run, approval or knowledge source was seeded. Before it can go live: a set of real, consented, handwritten Nigerian diary pages as golden cases (none exist), an evaluation recorded by a person (digit confusions such as 1 and 7, 5 and 6, 0 and 6 are the main risk), the data agreement with the model provider, and a clinical safety case. The photo is sent to the provider for the read and is not kept by us; the DPO should confirm that is acceptable. The typed sheet needs none of this.
- Decision: open.

### OQ-S07YL-7 The three guards have no switch-on conditions (raised by S07y)
- A guard with no conditions reports "unknown guard" and cannot be switched on from the dashboard (fail closed). The conditions to add when the questions above are answered: for `pharmacy_bp_readings` and `paper_diary_entry` the CMO's confirmation of the label wording and the exclusions plus the clinical safety case; for `paper_diary_ai_reader` the AI-021 evaluation, the provider data agreement and the safety case. The `private.go_live_conditions` branches are patched by many open branches, so this build did not restate that function (the S43 reasoning). Test accounts pass the guards, so the whole flow can be exercised with a test account today.
- Decision: open (the session that adds the conditions).

### OQ-S07YL-8 Phase B: a pharmacist at a partner pharmacy records a reading (raised by S07y; founder, CMO, pharmacy lead)
- Not built; designed in `docs/design/S07y-reading-labels-and-diary.md` section 9. Needs: authorship (pharmacist or the confirming patient) and what the record shows; which pharmacy roles may write and who carries the duty of care at the counter for a dangerous value; code shape, lifetime and threat model; a write-only door (INV-10/12); whether the machine's make and calibration are recorded; abuse limits; an active licensed pharmacy (none today, OQ-274). It should be decided together with the assisted-entry seam (`private.pharmacy_assisted_entry_allowed`, PR #1185), not as a second seam.
- Decision: open.

### OQ-S07YL-9 Export, FHIR and the data registry (raised by S07y; DPO)
- `entry_origin` and `place_label` are columns on `vitals_readings`, so they are already part of the patient's own data export and the S39d registry row for that table. The place is a name the person typed; it is never used for any decision. The `observations` view (and so S44's FHIR export) does not carry the label; a pharmacy reading therefore exports as an ordinary patient-recorded observation. Options: carry the label into `observations.context` (a small change to a public view) so a receiving clinician sees the setting. Decision: open (DPO, interoperability).
### OQ-S06z-1 Price per megabyte behind the data-cost estimate is PROPOSED (raised by S06z, 2026-10-20)
- `offline.data_cost.price_per_mb_kobo` is 80 (N0.80 a MB, about N800 a GB), a guess at a mid-range prepaid bundle. It only feeds a figure labelled "estimate". Needed: the founder confirms or replaces it against current Nigerian prepaid prices, by publishing a new registry version (never an edit in place).
- Decision: open (founder).

### OQ-S06z-2 The Wi-Fi-only hold cap and the list of urgent kinds need the CMO's eyes (raised by S06z, 2026-10-20)
- Held: only a dose log (deadline: the earlier of `max_hold_hours`, 6, and one hour before the server would write "missed" for that dose) and a weight reading. Never held: danger-flagged entries, symptoms, red-alert answers, kick and contraction logs, and every reading other than weight (the phone's flag is not proof a reading is ordinary). This is a patient-safety trade (data saved against a delay), so the CMO should confirm the cap, the one-hour slack, and that weight and dose logs may wait at all. Setting the cap to 0 disables holding. Holding a normal blood pressure needs a stored "classified, normal" result per row; not built.
- Decision: open (CMO).

### OQ-S06z-3 Wi-Fi only does not cover the device-reading and health-sample queues (raised by S06z, 2026-10-20)
- A BLE reading or a wearable sample can carry an extreme value the phone cannot classify and the server's red-flag engine judges, so those queues are never held. They are a real share of data for a patient with a connected device; the meter counts them but the switch does not touch them. If the founder wants a "bulk only" hold (steps, sleep, HRV) it needs the server's red-flag-relevant types split out first.
- Decision: open (product, CMO).

### OQ-DUP-1-1 Duplicate lab value match numbers are PROPOSED (raised by DUP-1, 2026-10-20)
- `lab_value_match_config` v1: 2 day window, 0.5 percent value tolerance, same unit required. Engineering defaults, no published standard. The CMO or lab liaison confirms or changes them (a new config version, never an edit).
- Decision: open (CMO).

### OQ-DUP-1-2 A disputed analyte is left out of the Health Report facts (raised by DUP-1, 2026-10-20)
- When a structured result and a paper report disagree, the report omits that analyte entirely (no older reading is promoted either) instead of printing one value, and the trend shows both. Alternative: print both with a "two reports differ" line. Needs the report wording owner.
- Decision: open (product, CMO).

### OQ-DUP-1-3 Record exports still list both rows (raised by DUP-1, 2026-10-20)
- The FHIR snapshot and the record export list the structured and the filed reading with an `origin` label (evidence). Collapsing a duplicate there is not done (the AI explainer's two lab readers are also separate and not de-duplicated); a receiving system may see two Observations.
- Decision: open (product).

### OQ-DUP-1-4 No way to dismiss a disagreement that is only a unit label (raised by DUP-1, 2026-10-20)
- U/L against IU/L, or % against % HbA1c, is a disagreement by design (units are never converted). There is no unit alias table and no resolve action; it clears when a clinician withdraws or corrects one source. A confirmed alias list in config would remove the noise.
- Decision: open (CMO, lab liaison).

### OQ-DUP-1-5 The case-file note writes an audit row per open (raised by DUP-1, 2026-10-20)
- Each case-file open reads the note through the audited function (one row, 5 minute cache). Lazy loading or folding it into the existing audited read would cut the volume.
- Decision: open (engineering).

### OQ-DUP-1-6 Nothing reads or alerts on lab_value_link_failures yet (raised by DUP-1, 2026-10-20)
- A failed link is recorded and the value shows twice until re-linked. A sweep or an alert is not built.
- Decision: open (engineering).

### OQ-DUP-1-7 No central lab-code classifier for reproductive or mental health analytes (raised by DUP-1, 2026-10-20)
- The staff disagreement note withholds analytes by a keyword list plus `confidential_domain_of_text`, which classifies conditions and medicines, not lab codes. A reviewed central list would replace it.
- Decision: open (CMO, DPO).
### OQ-RCPT-1-1 Consent receipt download is web only (raised by RCPT-1, 2026-10-20)
- The mobile privacy screen has no session-authenticated way to fetch the web PDF route, and the mobile document flows use their own bearer routes. A bearer route (or an in-app render) would add it. Not built.
- Decision: open (product).

### OQ-RCPT-1-2 Receipt wording is placeholder until counsel approves it (raised by RCPT-1, 2026-10-20)
- The matrix wording is `draft_pending_counsel` (OQ-330), so a receipt says so on the page. The strings in `consent.receipt.*` are plain-language engineering text, not legal text. Counsel reviews them with the matrix wording.
- Decision: open (counsel).

### OQ-RCPT-1-3 A guardian cannot download a dependant's receipts (raised by RCPT-1, 2026-10-20)
- By design for this change (own rows only). If a guardian needs them, it is a new access rule on the audited function, with the category checks the dependant model already has.
- Decision: open (product, DPO).
### OQ-S08z-1 The starting time of each anchor is PROPOSED (raised by S08z, 2026-10-20)
- `medicines.dose_anchors.anchors` (and the seeded `dose_anchor_defaults`) hold a plausible starting time for each of ten parts of the day (waking, the five daily prayers, three meals, bedtime). They are placeholders: nothing is computed from location or a calendar, and the patient confirms the time of each anchor they use. Needed: the founder or CMO confirms or replaces them (a new registry version and a new migration row, never an edit in place).
- Decision: open (founder).

### OQ-S08z-2 A patient who shifts their day for a fast: care-team visibility and counselling (raised by S08z, 2026-10-20)
- Shifting reminders for a month of fasting can matter clinically (for example for diabetes or blood pressure medicines). The app gives no advice. The anchor, shift and slot-mapping tables are readable only by the patient and an acting guardian (see OQ-S08z-5), and the medicine record the care team reads holds only an opaque slot and the resolved clock time, so a care team does not see a shift and nothing prompts a conversation. Needed from the CMO: whether a shift should create a care-team signal or task (a privacy-preserving one, without naming a prayer), and what a fasting conversation looks like. Nothing was built that decides this.
- Decision: open (CMO).

### OQ-S08z-3 Clinician-prescribed schedules cannot be tied to the day yet (raised by S08z, 2026-10-20)
- Anchors are offered on patient-added medicines only (a prescribed schedule is fixed by the care team and the existing allow-list refuses a patient edit). A prescriber cannot choose "with dinner", and a patient cannot tie a prescribed medicine to their day. If wanted, it is a prescribing-flow change (INV-02: the prescriber signs the anchor) and a separate piece of work.
- Decision: open (product, CMO).

### OQ-S08z-4 The new `doseanchor.*` strings sit outside the reviewed-strings ledger (raised by S08z, 2026-10-20)
- The ledger gives the clinical namespaces (`medicines.*` among them) no room for new baseline entries and no reviewer exists to name, so the anchor and My day copy lives under `doseanchor.*`, outside the gated namespaces. That is a way round the gate, not a review. Needed: the CMO or a pharmacist reads the keys (especially `doseanchor.pick_help` and `doseanchor.myday.shift_help`), then they move into a gated namespace with a real reviewer entry.
- Decision: open (CMO).

### OQ-S08z-5 Which prayers a patient ties a medicine to is special-category data (raised by S08z, 2026-10-21)
- `patient_dose_anchors`, `patient_day_shifts` and `patient_dose_anchor_slots` name the prayers a person uses, which discloses religious belief (special-category data). They are readable by the person and an acting guardian only; tied clinicians and caregivers are deliberately NOT given read access. PROTECTED NOW (2026-10-21 fix): the anchor name no longer travels in `medications.schedule_spec`, which clinicians, caregivers, exports, the share link and printed reports read; it stores an opaque per-patient slot and the mapping lives only in the patient-private table. The validator refuses a prayer name in any stored schedule, and the migration's closing check and the DB proof fail if a policy names a clinical reader or any stored schedule names a prayer (proof reads as a tied clinician and as a caregiver, with a sabotage step). RESIDUAL: the resolved clock times and offsets, which medicines share a slot and how many distinct slots a person uses, remain visible to the care team; the patient's own export holds the mapping; an acting guardian reads it by design. They are listed in the S39d data registry as unreviewed, in the patient export. Needed: the DPO and CMO class review (retention, export wording, whether a guardian should see prayer names at all), and a decision on what a care team should see (a resolved time is already visible; a "day shifted" signal without the anchor names is the likely answer).
- Decision: open (DPO, CMO).

### OQ-S08z-6 A day shift is not checked against dose windows (raised by S08z, 2026-10-21)
- A flexible window may not overlap the next dose at the person's normal times, and that is enforced. During a shift two anchors can end up closer than a window for those dates (a shift moves each anchor independently), which only makes a dose read "due" a little longer. If it should be refused instead, the shift RPC and the phone need to check the shifted times of every active medicine with a window.
- Decision: open (product).


### OQ-S43m-1 The web symptom journal says severity is "of 5"; the database and the phone use 1 to 10 (raised by the S43m build, 2026-10-20)
- `i18n` key `journal.severity` reads "How bad: {value} of 5" and `/patient/symptom-journal` uses it, but `symptoms.severity` is entered on a 1 to 10 scale (phone `symptom-screen.tsx`, red-flag trigger at 8 and above). A person who logged 8 sees "8 of 5" on the web. The phone uses a new key, `mpass.journal.severity` ("out of 10"). Needed: change the web page to the same wording. Not changed here to keep the PR to the phone; the key `journal.severity` also collides in name with the private-journal keys and should be renamed when it is.
- Decision: open (product, small).

### OQ-S43m-2 The full activity timeline has no saved copy for offline reading (raised by the S43m build, 2026-10-20)
- The other Passport read screens fall back to a last good copy (`lib/passport-cache.ts`). The existing timeline screen reads with a growing limit and was only given an honest offline or failed message, not a cache, because a cached page of a growing list needs its own rule for which page to keep. Needed: decide whether to cache the newest 20 items.
- Decision: open (product).

### OQ-S43m-3 History and journal are not under the shared-phone or private-section lock, and procedures are not classified by category (raised by the S43m build, 2026-10-20)
- `procedures` has no access category: a supporter holding the general medical-history grant reads every procedure, including a reproductive one (a hysterectomy, a termination). The web page does the same. The phone mitigates by never keeping a supporter's read on the phone and by never serving a saved copy after access is refused, but it does not hide them. The symptom journal can hold free text of any kind, and neither screen sits behind the shared-phone mode or `PrivateSection`. Needed: decide whether procedures get a category (or a keyword rule like the emergency card's) and whether these two screens join the shared-phone mode.
- Decision: open (CMO, product).
### OQ-S09y-1 Virus scanning for outside records (raised by the S09y build, 2026-10-20)
- Uploads are limited by size (10 MB) and type (image and PDF) at the bucket, and are only ever opened through a short-lived signed URL by a doctor. There is no malware scan on the path (none exists for any upload on the platform). A PDF is the realistic carrier. Needed: a decision on a scanning step before a doctor opens a patient-supplied PDF.
- Decision: open (founder / security).

### OQ-S09y-2 Does the patient get told when a record is checked? (S09y)
- Checking changes the label on the patient's own page and phone only. No notification is sent (a new template would need wording sign-off). Needed: whether to send an in-app notice, and its words.
- Decision: open (product).

### OQ-S09y-3 Cover is shown to anyone with the live link (S09y)
- The member number appears on the printed card and on the public live link, only when the patient filled it in, with a note that it is unchecked. A stranger holding the link could copy a member number. There is no per-field switch for it (filling it in is the choice). Needed: whether cover should get its own show switch like the other card fields, and the NDPA basis for exposing it (counsel, with OQ-S09x-2).
- Decision: open (founder / counsel).

### OQ-S09y-4 Cover is not on the lock-screen card, on purpose (S09y)
- `my_health_config.lock_screen_pass` is unsigned and awaiting the CMO. If cover should ever be on the lock-screen card it must be added to that governed list and signed, not added in code.
- Decision: open (CMO).

### OQ-S09y-5 Care coordinators could call the shared worklist function (S09y finding) - FIXED in PR #1225
- `clinical_worklist()` and `org_open_work_counts()` checked only an active `clinical_staff` row, so a care coordinator (non-clinical, no clinical reads) could call them directly although the page redirects them and the S39e header says they are refused. The S09y migration now excludes `doctor_tier = 'care_coordinator'` from both guards (this closes it for every queue, not only `outside_records`). Proved with a simulated coordinator session, a tied-doctor control and a sabotage step in `s09y_my_health_gaps.sql`; `s39e` re-run clean.
- Decision: closed unless the CMO wants a coordinator to see queue counts again.

### OQ-S09y-6 Outside records on the phone take photos only (S09y)
- No document-picker package is installed, so the phone adds photos from the camera or library; a PDF is added on the web. Adding a picker is a native module and needs an EAS build and a runtimeVersion bump.
- Decision: open (product).

### OQ-S07Y-G1 The cuff arm-circumference table is unsigned and written from published tables not re-read in this build (raised by S07y, 2026-10-20)
- `bp_cuff_guidance_signoffs` v1 (22-26 small adult, 27-34 adult, 35-44 large adult, 45-52 extra large; accepted 15-60 cm) is on the CMO hub, unsigned and inactive, so the phone shows no cuff-size step. The ranges come from the AHA 2019 and ESH 2023 tables as remembered by the author; nobody has compared them with the documents or with NG-2023 section 3.1.1.
- Options: (a) the CMO compares them with the sources, edits the seed if any differs (a new version), then signs (recommended); (b) sign as written; (c) do not offer a size step and keep the six-line C4 guide only.
- Decision: open (CMO).

### OQ-S07Y-G2 Who enters recommended blood pressure monitors, and from which registry (raised by S07y, 2026-10-20)
- The editor at `/admin/settings/recommended-devices` lets an admin enter a model with its validation link and a NAFDAC number or distributor; the CMO reviews each at `/clinician/recommended-devices` (a hub line shows the count). The list is empty of reviewed rows, so every patient is told "no checked list yet, look it up at stridebp.org". `device_recommended_list` (the module that makes `recommended_devices()` return rows) is still off; the cuff step reads reviewed rows regardless of that module only through `bp_cuff_model_listing`, which also requires the module on, so a reviewed list does nothing until the module is switched on.
- Needed: who sources the first few models (the CMO from ValidateBP or STRIDE BP, or an admin), and when the module goes on. Tarragon sells nothing (2026-08-02).
- Decision: open (CMO and founder).

### OQ-S07Y-G3 The pre-visit sheet uses the programme gate, not the looser trend-card gate (raised by S07y, 2026-10-20)
- "Bring this to your visit" shows a 7-day average only with a SIGNED home programme and 12 readings over 3 days (with none signed it says "a 7-day average is not shown yet"). The in-app trend card shows an average at 3 readings over 3 days. A patient can therefore see an average in the app and "not enough readings yet" on the sheet. This is deliberate (never a thinner average on paper than the programme allows), not a bug.
- Options: (a) keep the stricter gate on the sheet (recommended until the CMO signs the programme); (b) use the trend card's gate so both agree; (c) raise the trend card to the programme gate.
- Decision: open (CMO).


### OQ-LSI-1-1 Mobile saves the picture through the in-app browser, not the photo library (raised by LSI-1, 2026-10-20)
- Saving straight to Photos needs a native media-library module and a permission, which would need a new build and runtime version. Press and hold in the in-app browser works with no new permission. Decide whether the extra step is acceptable.
- Decision: open (product).

### OQ-LSI-1-2 No platform kill switch for the lock-screen picture (raised by LSI-1, 2026-10-20)
- The per-person option (off by default, a tick every time, audited) is the only gate. A go-live guard would be one key plus a check in `lockScreenImageResponse` if the founder wants one.
- Decision: open (founder).

### OQ-LSI-1-3 The mobile picture URL carries the access token as a query parameter (raised by LSI-1, 2026-10-20)
- Same pattern as the verified-document PDF route. The token is short-lived and the picture is the person's own, but the URL may appear in browser history. A one-time signed link would remove it.
- Decision: open (engineering).
### OQ-S07Y-1 A home-log pair only sees home readings from before the clinic reading was saved (raised by S07y, 2026-10-20)
- The pair is made when the clinic reading is saved, from the patient's own manual or device readings within the window either side. A home reading logged after that moment (inside the window) is not picked up. The same-visit pair has no such limit. Fixing it means a daily sweep that re-pairs recent clinic readings; not built.
- Decision: open (product, CMO).

### OQ-S07Y-2 Do pairs and flags belong in a subject-access request? (raised by S07y, 2026-10-20)
- `cuff_check_pairs` and `cuff_check_flags` are registered `clinical_record`, `in_export = false`, clinician-only working data. Whether the patient's right of access covers them is the DPO's decision.
- Decision: open (DPO).

### OQ-S07Y-3 The neutral "bring your cuff to a visit" line has no patient screen yet (raised by S07y, 2026-10-20)
- `cuff_visit_prompt_open()` and the unsigned string `cuff.visit_prompt` exist; the guard `cuff_visit_prompt` is off and needs the CMO's wording attestation. A web and phone placement (on the cuff guidance card) is not built.
- Decision: open (product, CMO).

### OQ-S07Y-4 Switching the cuff rule on does not look back, and a wrong pair cannot be removed (raised by S07y review, 2026-10-20)
- Pairs are stored while the guard is off, but nothing is flagged until the guard is on, the rule is signed and a NEW pair or clinic reading arrives (the rule then judges all the patient's pairs together). There is no sweep at switch-on, and home-log pairs for clinic readings saved while the guard was off were never made. The tables are append-only, so a mistyped same-visit pair cannot be corrected; it leaves the judgement after five newer pairs, and an identical double submit is already merged. A correction path (a void row) and a switch-on sweep are not built.
- Decision: open (product, CMO).


### OQ-S46d-1 The suggested recheck weeks are placeholders (raised by S46d, 2026-10-20)
- Report settings v3 (unsigned) carries `retest`: 12 weeks for a lab value outside its range, 4 weeks for a blood pressure average above target, no per-analyte overrides, a mid-year line at 6 months shown only when something was off. None of these is a clinical decision. The CMO should set them (a lipid panel and a glucose are not repeated on the same schedule) and sign through `/clinician/health-report-config`. Until then v3 stays a draft and no report uses it.
- Decision: open (CMO).

### OQ-S46d-2 The anti-HBs threshold has no signer until the CMO uses the new door (raised by S46d)
- Nothing could set `serology_rule_versions.threshold_approved_by` before; `sign_serology_rule_threshold` (CMO only) now can, from `/clinician/serology-rules` or the sign-off hub. The threshold (10 mIU/mL) is the proposed value; a titre alone never records immunity until it is confirmed.
- Decision: open (CMO).

### OQ-S46d-3 A positive anti-HBs is held for review, not auto-released (raised by S46d)
- `anti_hbs` is a non-sensitive qualitative analyte with `holdForReview`, so EVERY value (negative and positive) waits for a clinician and is never explained by the generic result text. It is positive/negative only; a numeric titre cannot be entered through the panel, so the titre-versus-threshold path of the immunity trigger is not reachable until the CMO decides whether the add-on should be numeric (mIU/mL).
- Decision: open (CMO).

### OQ-S46d-4 Panel v3 is active while the lab sign-off still names an older panel (raised by S46d)
- Same situation as v2 in 20261013005133: the live lab sign-off row names panel v1. A draft `lab_panel_signoffs` row (same release policy) is created for the CMO to sign with panel v3 in view. anti_hbs is optional, so nothing becomes incomplete.
- Decision: open (CMO).

### OQ-S46d-5 The shared link is the latest signed report, not a fixed version (raised by S46d)
- A link opened after a correction shows the corrected version. The date window of a share (30 to 180 days) does not apply to the report. The heart risk band, questionnaires and reproductive screening are always left out of a link (the patient's own PDF `?variant=shared` still lets them include those in their own file).
- Decision: open (product).

### OQ-S46d-6 Audio slots exist only in code (raised by S46d)
- RPT-001 to RPT-007 (sections) and RPT-101 to RPT-103 (normal, low, high) are draft unrecorded slots in `packages/audio/src/report-audio.ts`. They are not in `audio/manifest.json` because the importer needs the production-list document. When wording is signed and recordings commissioned, add them with the production list. HIV, hepatitis B and C get no slot by design.
- Decision: open (CMO, content).

### OQ-S46d-7 Trend function duplication (OQ-S46-6 follow-up)
- The report charts reuse S43's TypeScript `chartGeometry`; the collector still reads points through `private.hr_biomarker_points`, not S43's `private.biomarker_points`. Swap the SQL when convenient so there is one definition.
- Decision: open (engineering).

### OQ-S46d-8 The DB proof and the migration were not executed (raised by S46d)
- Docker was unavailable. Run `scripts/run-db-proofs.sh` (or CI's migration replay) before merging; expect to adjust fixture details in `s46d_health_report_completion.sql` if a helper column differs. The merge auto-applies the migration.
- Decision: open (engineering, before merge).
### OQ-S47A-1 Plausibility limits for water, sleep, mood and inhaler puffs are PROPOSED (raised by S47a, 2026-10-20)
- Registry key `observations.plausibility` v1, mirrored by `observation_limit_signoffs` v1 (born unsigned and inactive) and, for the new types, by a database CHECK (`vitals_readings_s47a_lifestyle_plausible`, `inhaler_use_logs.puffs`). Hard limits: water 10 to 3000 ml in one log, sleep 0.5 to 24 hours, mood whole 1 to 5, puffs whole 1 to 20. Soft (ask to confirm, never refuse): water over 1500 ml, sleep under 2 or over 14 hours, puffs over 8. The first nine rows only restate limits already enforced on the phone, web and API.
- Needed: the CMO reads the table at `/clinician/observation-limits` (also a line on the sign-off hub) and signs `sign_observation_limits`. Signing is the CMO's record that the shipped numbers were reviewed (the same pattern as the home blood pressure programme); it does NOT change any number, because nothing reads the signed row at run time. The numbers in force are the bundled registry value and the CHECK. A later change of a limit is an engineering change (registry version, a migration for the CHECK, a new signed row); the mirror test fails until the registry and the seed agree. Signing does not switch the logs on.
- Decision: open (CMO).

### OQ-S47A-2 Inhaler use has no alert rule and no advice wording (raised by S47a, 2026-10-20)
- `inhaler_use_logs` records puffs and a reason and nothing else. The patient reads her own rows; staff have no direct read policy on purpose (the audited, tie-gated path is the only staff door, as for vitals), so a clinician view is a later piece. No frequency line (for example repeated reliever use in a week), no task, no page, no notice exists, and none was invented: that is a clinical rule set and the CMO's. The phone and web show no inhaler advice for the same reason; any wording in the `vitals.*` namespace needs a real reviewer entry in the reviewed-strings ledger.
- Needed: the CMO decides what repeated reliever use means, who is told and how fast, and supplies the wording; then a rule set is built on the S16 task layer.
- Decision: open (CMO).

### OQ-S47A-3 Do water, sleep and mood logs earn points? (raised by S47a, 2026-10-20)
- The rewards trigger `private.wellness_points_on_vitals_logged` is changed so the three new lifestyle types never earn (a water tap is easy to game, and rewards already exclude weight and waist for a similar reason). Streaks and "small daily goals" (spec 4.5) are the S47b work and are not built here.
- Needed: the founder decides whether any lifestyle log should earn, with what daily cap.
- Decision: open (founder). Default stays: no points.

### OQ-S47A-4 The trend-chart target bands are PROPOSED (raised by S47a, 2026-10-20)
- `observations.target_bands` v1: glucose 3.9 to 10.0 mmol/L (the time-in-range band the diabetes view already uses; a test fails if they drift) and the WHO healthy BMI band 18.5 to 24.9 turned into kilograms at the person's own height. No band is drawn for weight without a usable height. A care-team glucose target for the person is not yet read (the function accepts one); only the standard band shows today.
- The bands are behind the platform module `trend_target_bands` (born off) and are drawn only for an adult with a known date of birth who is not recorded as pregnant (`patient_pregnancy`) and has no delivery in the last 12 months (`postnatal_profiles`). A child has the growth chart; pregnancy and the postnatal period have their own guidance. Any failed read means no band.
- Needed: the CMO confirms both bands, and says whether a per-person glucose target should replace the standard one on the chart (the function accepts a care-team band but no code passes one yet, so the `care_team` caption is not reachable today). The phone has no single-series chart yet, so the bands are web-only in this change.
- Decision: open (CMO).

### OQ-S47A-5 New strings sit outside the reviewed-strings ledger namespaces (raised by S47a, 2026-10-20)
- The water, sleep, mood, inhaler and "Changed" wording lives under `observation.*`, outside the gated clinical namespaces, because the ledger takes no new baseline entries and no reviewer exists to name. That is a route around the gate, not a review (same as OQ-NAFDAC-SCAN-3). The typo sentences make no clinical claim.
- Needed: the CMO or a clinical lead reads the `observation.*` keys, then they move into a gated namespace with a real reviewer entry.
- Decision: open (CMO).

### OQ-S47A-6 Switching the logs and the chart bands on (raised by S47a, 2026-10-20)
- Platform modules `extended_observations` (the four logs) and `trend_target_bands` (the chart bands) are born off and the database refuses the rows while it is off. It needs: OQ-S47A-1 signed, an answer to OQ-S47A-3, and the edge function `process-events` redeployed with the S47a change to `observation-handler.ts` (it returns at once for kinds water, sleep and mood; an older deployed handler also finds nothing to grade because the context loader answers "not a blood pressure reading", but redeploy first all the same).
- Decision: open (founder).### OQ-S48A-1 The activity safety rules are PROPOSED and unsigned (raised by S48a, 2026-10-20)
- Every figure (48 hour red and amber windows, 7 day unsettled blood pressure window), every maximum level and every blocked kind for pregnancy, high-risk pregnancy, unsettled hypertension, arthritis and back pain is a starting proposal in `activity_safety_config` v1. The CMO reads and signs it on the sign-off hub ("Activity safety rules"). The gate already enforces these rows because it only ever restricts; if the CMO changes a row, that is a new version.
- Also needed from the CMO: the ICD-10 prefixes and name patterns that count as arthritis, back pain and hypertension; whether a diabetes rule is wanted (v1 has none); and whether `shadow` triage rows (graded by a rule set nobody has approved) should count towards rest. v1 counts them, which is the safe direction.
- Decision: open (CMO).

### OQ-S48A-2 Workout plans need clinician review and real audio (raised by S48a, 2026-10-20)
- Three starter plans (a gentle 10 minute routine, a chair-based class, a steady 20 minute routine) are written text only: `clinician_reviewed = false`, inactive, no audio. Patients see nothing until a clinician reviews a plan and an administrator activates it. No audio was recorded or generated.
- Needed: a clinician (and a physiotherapist for the chair-based class and the back-pain and arthritis lists) to review or replace the text, and a content owner and budget for recorded audio and low-data video (5.4).
- Decision: open (CMO and content owner).

### OQ-S48A-3 Private route recording: privacy review, retention, and whether the owner can download their own route (raised by S48a, 2026-10-20)
- The table, the owner-only policies and the guard (`private_route_recording`, off) exist; nothing records a route. Before any UI is built: a privacy review (home and workplace inference from a route), a retention period, and counsel's view. Routes are excluded from the patient export on purpose (acceptance: "Routes are never shared"); whether an owner-only download for data-rights requests should exist is the DPO's call.
- Decision S48-1 keeps emergency location a separate feature with its own consent and retention; it is not here.
- Decision: open (DPO, counsel, founder).

### OQ-S48A-4 Platform pedometer fallback needs a native dependency (raised by S48a, 2026-10-20)
- `expo-sensors` is not installed and `Pedometer` needs motion permission on both platforms, so it is a new native module, a new EAS build and a `runtimeVersion` bump. Not added. Steps continue to come from HealthKit and Health Connect and from manual entry.
- Decision: open (founder), bundle with the next native build.

### OQ-S48A-5 Two effort tables exist (raised by S48a, 2026-10-20)
- The older web `lib/activity/intensity.ts` has its own MET values by activity name (used for the history list and the WHO guideline card); the new config has `effort_met` per kind. They agree in direction but not in every figure. The gate never reads either for a decision (it uses the kind's intensity word). Needed: pick one source, probably the signed config, and have the web history read it.
- Decision: open (product, CMO).

### OQ-S48A-6 Which events count as "red" for the activity gate (raised by S48a, 2026-10-20)
- v1 reads `triage_events` only (any red grade, shadow rows included). Two gaps found in review and left, because they cannot be proven without the full database: (a) `triage_events` is written after grading, so a reading logged seconds ago may not have a row yet; (b) red-class emergencies raised on other paths (`emergency_events` from the pulse, SpO2, temperature and glucose red-flag triggers, `clinician_alerts`) are not consulted. The enrolment trigger and the plans list therefore rest on the graded record, not on the raw reading.
- Needed: confirm with the clinical lead that every red-class path ends in a `triage_events` row, or add `emergency_events` as a second red source (with a proof that builds its fixtures through the real triggers).
- Decision: open (CMO and engineering).

### OQ-S48A-7 Pregnancy and the enrolment gate when staff enrol a patient (raised by S48a, 2026-10-20)
- Pregnancy is part of the enrolment gate for the patient themself, for staff the category-scoped path (`staff_may_read(..., 'reproductive_health')`) entitles, and for a system actor. For other organisation staff it is left out, so the refusal wording cannot disclose it. The cost: an untied staff member can enrol a pregnant patient into a programme the patient's own enrolment would be refused. Organisation-wide staff insert on `patient_exercise_enrollments` is existing behaviour; S39b may want to tie it.
- Decision: open (CMO and DPO).### OQ-IPS-1 Validate the IPS export before anyone relies on it (raised by the IPS build, 2026-10-20)
- The file is IPS-shaped (structure) but no HL7 validator was run and no IPS or Nigeria Core profile is claimed. Run the HAPI validator against a real export and against the IPS implementation guide, record the result, and only then decide whether a later `fhir.ips_mapping` version may list a profile URL. Do not state conformance in product or marketing copy until then.
- Decision: open (founder / health-informatics advisor).

### OQ-IPS-2 Section titles and the author wording in the file (raised by the IPS build, 2026-10-20)
- Section titles, the Composition narrative and the preliminary status live in the PROPOSED config (founder-owned, not confirmed). "Preliminary" says the summary is not clinician-attested. Confirm the wording and status with the CMO before a facility is told to rely on it.
- Decision: open (CMO).

### OQ-IPS-3 `fhir_export_log` has no format column (raised by the IPS build, 2026-10-20)
- An IPS download is logged exactly like a collection export; it is recognisable only because its section list has no `documents`. Opening the "what is inside" preview is logged the same way (it uses the same audited call), so the "who made a copy" list counts previews; the preview text says so. If audit review needs to tell exports, IPS copies and previews apart, add a nullable `format` or `purpose` column in a separate additive migration.
- Decision: open (product / DPO).

### OQ-IPS-4 Items inside general sections are not sorted by purpose, for supporters too (raised by the IPS build, 2026-10-20)
- `fhir_export_snapshot` (S47b) hides reproductive and mental-health-named conditions, medicines and allergies only for a guardian of a 10 to 17 year old without a waiver. A supporter who holds only the medications or conditions category, and the person themselves, still get such items inside Problems and Medicines, as in the existing collection export. The summary says so in words (file narrative and page copy) but a sentence is not a control. Decide whether the snapshot should withhold those items for every non-self reader, and whether a stopped medicine should be left out of the Medicines section. Do not weaken the existing exclusion; this build adds no new way to read them.
- Decision: open (CMO / DPO).
- Decision: open (CMO / DPO).
### OQ-RRL-1 Counsel must review the letter wording and the reply period (raised by the records request build, 2026-10-20)
- `records_request.letter` v1 is engineer-written, UNSIGNED placeholder wording. It names the Nigeria Data Protection Act 2023 right of access as the person's own request and states no section, deadline or penalty. `records_request.response_days` (30) is a placeholder reminder period, not a statement of what the law requires. Counsel supplies approved wording and the period as a higher config version; until then the UI says the wording is a draft. Do not show anything as legal advice.
- Decision: open (counsel / founder).

### OQ-RRL-2 The guard `records_request_letters` cannot be switched on yet (raised by the records request build, 2026-10-20)
- It is born OFF and, like S43 and S44, has no entry in `private.go_live_conditions` (that function is changed by several branches), so it reports "no defined condition". Add conditions (counsel signed the wording; the founder confirms) in a separate change before anyone flips it.
- Decision: open (founder).

### OQ-RRL-3 No push or inbox reminder when a request is overdue (raised by the records request build, 2026-10-20)
- Overdue is derived and shown in the app (Passport banner, list, detail, phone list). No notification row is created because notification templates are reviewed for INV-07 and nothing may depend on a send. If the founder wants a nudge, it needs a reviewed template that names no facility, and the in-app list stays the source of truth.
- Decision: open (founder).

### OQ-RRL-4 Dependants and mobile creation (raised by the records request build, 2026-10-20)
- The tables are guarded for under-18 dependants (no rows), so a guardian cannot ask on a child's behalf yet; decide whether a guardian flow is wanted. The phone lists and tracks requests but the letter is made and printed on the web; a phone create flow and share sheet is a later decision.
- Decision: open (product).
### OQ-S49A-1 The 108 food rows are estimates and none is dietitian reviewed (raised by the S49a build, 2026-10-20)
- Every new row, and every old one, is `data_quality = 'estimated'` with `needs_dietitian_review = true`; a database CHECK stops anyone marking a row "no review needed" while it is still estimated. Values are from published West African and general composition ranges (street food, stews and drinks vary widely with oil and seasoning). The grams for wrap, ladle and bowl, and the small / medium / large figures (0.6x, 1x, 1.5x of the default), are household estimates, not measured.
- Needed: a registered dietitian reviews the table (a data change per row, setting `data_quality = 'dietitian_reviewed'` and `needs_dietitian_review = false` together), and measures the common portions. Until then the app says "an estimate to guide you" everywhere it shows a number, and the targets stay behind the CMO signature anyway.
- Decision: open (CMO or the dietitian the CMO names).

### OQ-S49A-2 Camera barcode scanning needs a new native module (raised by the S49a build, 2026-10-20)
- Typing the number printed under a barcode works on web and phone today (`lookup_barcode`, check digit verified). Scanning with the camera needs a barcode-scanner native module (for example `expo-camera`'s scanner); `apps/mobile` has only `expo-image-picker` and `expo-image-manipulator`. Adding one is a new EAS build and a `runtimeVersion` bump, and the OTA auto-publisher will skip that push. Nothing was added.
- Also open: the `barcodes` table is empty. The team must enter NAFDAC-numbered Nigerian packaged foods (code, which food row it maps to, product name, NAFDAC number). No overseas database is used. A packaged food with no matching food row first needs a food row.
- Decision: open (founder: approve the native build; ops: who curates barcodes).

### OQ-S49A-3 No clinician screen sets the nutrition-target hold yet (raised by the S49a build, 2026-10-20)
- `set_nutrition_target_hold(patient, hold, reason)` exists, is clinician-only and tie-checked, and the gate honours it (proved by a database test), but nothing in the clinician console calls it. Until a screen exists a hold can only be set by calling the function. Also decide who may set `eating_disorder_concern` and whether the patient is ever told (today: never; targets and the word summary simply do not appear).
- Decision: open (CMO for who may set it; product for the screen).

### OQ-S49A-4 The targets numbers are PROPOSED and unsigned (raised by the S49a build, 2026-10-20)
- `nutrition_target_config` v1 is seeded inactive: floors 1,200 kcal (women) and 1,500 kcal (men), maintenance estimate only, macros 50 / 20 / 30 percent, salt under 5 g (2,000 mg sodium), total sugars under 10 percent of energy, fibre 14 g per 1,000 kcal, word summary at 400 and 750 kcal. The CMO confirms or changes every number and signs it in the sign-off hub (line "Nutrition targets and meal summary"). Note the food list holds total sugars, not free sugars, so the sugar limit is stricter in effect than the WHO free-sugar line. Until it is signed no patient sees any target or word summary.
- Also for the CMO: whether pregnancy, the postnatal year, a positive eating-disorder screen and under 18 are the right groups to withhold (they are fixed in the database, not part of the signature), and whether kidney disease, heart failure or insulin use should join them.
- Decision: open (CMO).

### OQ-S49A-5 AI-008 prompt now lists 108 dishes; live re-evaluation not run (raised by the S49a build, 2026-10-20)
- The photo prompt's grounding line is built from the food table, with the hand-kept list as the fallback; every rule in the prompt is unchanged (proved by a deterministic test that the two prompts differ only on that line). `scripts/eval-ai008-meal-photo.ts` now runs each case twice (fallback and table). It needs `ANTHROPIC_API_KEY` and a Supabase service key and was NOT run in this build (no keys in the build environment). There is still no real Nigerian-dish photo in the suite, so dish-recognition accuracy is untested. The AI-008 governance record (prompt approval, evaluation run) was not touched or seeded: whether a changed prompt needs a fresh human approval is for the AI governance owner.
- The grounding can be switched back to the hand-kept list with no deploy: set `MEAL_VISION_TABLE_GROUNDING=off`.
- Decision: open (AI governance owner: run the eval and decide on re-approval).
## S27h: lab lifecycle and partner quality (2026-10-16)

Named OQ-S27h-NN (not a plain number) so they cannot collide with the repeated numbers elsewhere in this file.

### OQ-S27h-01 Hold-aging, delta and fallback thresholds are PROPOSED
- `lab.lifecycle` (registry) / `lab_lifecycle_config` (table): lead escalation after 720 minutes for a critical value and 1,440 for any other held result, repeated every 720 minutes up to 3 times; a delta flag at 50 percent change (creatinine 30, potassium 20, sodium 5, HbA1c 20, haemoglobin 20) against a released value up to 365 days old; the fallback message 1,440 minutes after the CMO was told. Every use is an alert or a flag; none can release a result. The CMO owns the numbers.
- Decision: open (CMO).

### OQ-S27h-02 The disclosure fallback wording needs the CMO's signature
- The mechanism is built and OFF. Wording v1 is "Your care team would like to speak with you. Please open the app and send them a message when you can." Until the CMO signs it on `/clinician/lab-fallback` (or the sign-off hub) nothing is sent; the sweep says so (an audit row per result and one open incident) instead of staying silent. The signature binds the exact words (md5 of the template body): editing the template afterwards makes it read as unsigned again. It never releases a result and needs the 3 failed attempts, not only the 72 hours.
- Known trade-off for the CMO: this message goes only to patients with a held sensitive result whose attempts are used up, so its existence lets someone who sees the patient's notices infer a class of result. The alternative is to send nothing and rely on the CMO incident and a person reaching the patient. If escalation happened on hours with fewer than 3 attempts, no fallback is sent (the S27d CMO incident is the signal).
- Decision: open (CMO). A build never signs it.

### OQ-S27h-03 The critical value call rides the S19 rota and times, not the `pages` table; acknowledging ties the clinician
- `pages` is bound to a triage event (`triage_event_id not null`). Making it generic would touch the paging ladder that protects red events, so the lab call has its own table (`lab_critical_calls`) and reuses the S19 rota (`on_call_now`, `page_recipient` 3 argument, conflict aware), the escalation times (`paging_rule`, 5 and 10 minutes, repeat interval and cap), the incident helper and the push, in-app and email channels.
- INV-12 decision made in this build, for the founder and CMO to confirm: a paged clinician is NOT tied to the patient by being paged. As for an acknowledged red event page, ACKNOWLEDGING an open critical value call ties that clinician to the patient until the call closes (one extra branch in `private.clinician_has_patient_access`, never for the patient, a conflicted clinician or one who is not eligible). Without it the called clinician could not open the value they were called about.
- Not covered: the S19c delivery watchdog reads `source_table = 'pages'`, so a critical call notification that never arrives is not reported by it. The mitigation is the repeat to the clinical lead and ops until someone acknowledges.
- Decision: open (founder, CMO). **ACCEPTED 2026-10-21 (founder): acknowledging the call ties the clinician to the patient, bounded to at most 24 hours and ending when the call closes. See `docs/DECISIONS.md`, 2026-10-21.**

### OQ-S27h-04 Preliminary results are never shown to the patient
- A preliminary result is held and cannot be released by anyone; the final arrives as a correction of kind "finalised". Some labs release a preliminary (for example a culture) to the clinician only. If the CMO wants a clinician-visible-and-releasable preliminary, that is a policy change.
- Decision: open (CMO).

### OQ-S27h-05 Partner onboarding proof is checked on switch-on only
- A laboratory cannot go live without a licence number, a verified date, a future expiry and an accreditation. A laboratory already live (Synlab) is not re-checked by this rule; the S74 quality job already suspends on an expired licence. Confirm Synlab's licence and accreditation are recorded so the desk can see them.
- Decision: open (ops).

### OQ-S27h-06 The `labtrend` strings are outside the reviewed-strings ledger
- The patient trend uses its own namespace (`labtrend`) so it does not add unreviewed strings to the clinical ledger (its ceiling can only shrink). They state facts only (two numbers, a direction word, a person's note). The CMO should decide whether `labtrend` joins the clinical namespaces and review the nine strings.
- Decision: open (CMO).

### OQ-S27h-07 The rejected-specimen staff notice may address the wrong id
- `lab_partner_reject_specimen` (20260829123304) inserts its staff notice with `recipient_id = clinical_staff.id`, but `notifications.recipient_id` references `profiles(id)`. Whether this raises on a real rejection depends on whether a CMO row exists; see the S27h BUILD-PROGRESS entry for what was verified and fixed.
- Decision: see the BUILD-PROGRESS entry.
### OQ-S26b-01 The grace length, the reminder steps and the refund timing are PROPOSED (raised by S26b)
- Built exactly as the plan states: reminders 30, 7 and 1 day before the end, a 7 day read-only grace after a pack ends, a 14 day cooling-off for every order that is not a Membership (the Membership keeps its 21 days, `membership.refund`), an answer within 3 days, money reaching the bank in 5 to 10 business days. All of it is in `entitlement_policy_config` and `packages/shared/src/proposed-config/registry.ts` (`entitlements.lifecycle`, `refunds.order_rules`), nothing in code.
- The grace is read-only: the pack shows as "ended recently" with a one-tap renew, `consume_entitlement` still refuses it, so it costs no doctor time. A Membership and an employer seat are not touched (they have their own rules).
- Decision: open (founder). Changing a number is a new config row, not a deploy.

### OQ-S26b-02 The v5 order to consultation link has no writer yet (raised by S26b; narrows OQ-184)
- OQ-184 asked that a refund reverse the consultation share a clinician already earned. The reversal is built and proved (`private.reverse_consultation_shares_for_refund`: one negative adjustment per linked share, pro rata on a part refund, old lines never touched). It finds the shares through `order_encounter_links`, which `public.link_order_encounter(order, encounter)` fills (service role).
- Nothing calls `link_order_encounter` yet, because nothing in the platform consumes a v5 order's entitlement for a consultation today (`consume_entitlement` has no caller; the consultation share is priced from the legacy `service_purchases` row). Whoever builds that consumption path must call the link in the same step. Until then a refund finds no linked share and reverses nothing, which is correct while checkout is off.
- Decision: open (engineering, with S30b).

### OQ-S26b-03 The deferred revenue release is a finance posting that finance has not reviewed (raised by S26b)
- The existing refund path posts Dr 4900 Refunds / Cr 1020 Cash. S26b adds, for an order that had a recognition schedule, Dr 2000 Deferred revenue / Cr 4900 for the part never recognised (so 4900 ends up holding exactly the revenue already recognised and 2000 holds nothing for the order). A point-of-sale order needs nothing. This replaces the unused S26 stub, which would have credited cash a second time.
- Open: an order refunded before it was ever posted (S25c skips posting it) still gets the cash-out posting from the existing path with no cash-in to match. That gap pre-dates S26b and is untouched.
- Decision: open (finance review).

### OQ-S26b-04 The Paystack refund lookup has not run against a live account (raised by S26b)
- The weekly `refund-reconcile` edge function reads `GET /refund/:transaction_reference` and maps the answer in `parseProviderRefund`. The endpoint and field names follow Paystack's published reference; there are no Paystack credentials yet, so the first real run is the check. A network failure records nothing; a mismatch raises an incident and blocks an admin retry until a person looks.
- Decision: informational until the Paystack test payment and test refund (runbook `docs/runbooks/S25-test-payment.md`).

### OQ-S26b-05 Pidgin was not written (raised by S26b)
- The brief asked for en and pcm strings. The founder removed Pidgin on 2026-10-07 and `packages/i18n` has no pcm catalogue, so the new strings are English only.
- Decision: closed by the 2026-10-07 decision.



## S30b: earnings completeness (2026-10-16)

Numbered with the `OQ-S30b-` prefix because the plain numbers are being renumbered by another session. Cite by title.

### OQ-S30b-01 The pilot minimum with no sign of work, and late lines: update to "The pilot minimum can be earned by declaring hours and doing nothing" and "A late line can push a clinician past the pilot minimum"
- **Built**: before a top-up posts, the run is checked. It is HELD (not paid, not dropped) when the clinician took no task while tasks were waiting, or took tasks that all timed out and finished none. A person releases or denies each hold on `/admin/earnings/disputes`; a release posts at the next daily run. A late line inside a run is netted off the top-up by a system adjustment (idempotent, only ever reduces). The rules are PROPOSED values (`earnings.disputes`).
- **Approximate by design**: "tasks waiting" counts tasks that existed before the run ended and were not taken by this clinician. It does not know whether this clinician was eligible for them (competencies, tier). That is why the outcome is a hold for a person, never an automatic refusal. **Decide** after the first month whether the rule should read eligibility, or whether holds are rare enough to leave as is.
- **Netting after payment**: if the top-up was already paid, the netting adjustment is a negative line in a later payout; a clinician whose net for a week is zero or below carries it over (existing S31 rule). **Decide** whether that is acceptable or netting should be skipped once the top-up is paid.

### OQ-S30b-02 Withholding is stored and blocks a send
- A finance user types a withholding amount on a DRAFT payout. Nothing calculates it (D-09). Statement and PDF show gross, withholding and net. A payout with a withholding above zero is REFUSED at send, because the transfer amount (net or gross), how the withholding is remitted and how it is posted to the books (OQ-193, OQ-194) are all undecided, and sending gross under a statement that says net would be wrong. **Decide with counsel**: the rate and basis, who remits it, the amount sent to the bank, the GL postings, and a tax credit note (OQ-200). Until then, leave withholding at zero.

### OQ-S30b-03 Dispute response clock and who is told
- PROPOSED: 72 hours to answer, a 60 day window to question a line. The overdue state is shown on the admin page; no notification is sent to finance when a question is opened or overdue (the clinician is told when it is answered). **Decide**: who is paged or emailed, and whether 72 hours is right.
- A line already linked to an approved or sent payout cannot be held (the money may already be on its way). Questioning it still works and resolves into an adjustment in a later payout.

### OQ-S30b-04 A system-posted adjustment (shared with S26b, the refund reversal)
- The ledger required every adjustment to have a human author. Late-line netting is posted by a job, so the check now accepts `created_by` null when the line states a `system_reason`. If S26b changed the same constraint, whichever migration applies second must keep both rules. Both agents use the shared `kind = 'adjustment'` pattern with `calculation.corrects` pointing at the line being corrected.
### OQ-715 Pay the Membership in parts: a founder decision against INV-09, with credit-risk, consumer-law and CBN questions for counsel (raised by S25b)
- On 2026-10-20 the founder explicitly decided to build pay-in-parts for the annual Membership (access after the first part, lapse if a later part is missed), reversing S72-2 ("no instalments"). It brushes INV-09 ("no stored balance for patients"): a patient who has paid one part owes the others. The founder has accepted the credit risk. It is built and proved but ships OFF: platform module `membership_instalments` defaults off, and the migration never switches it on. Plans that already exist keep running if the module is later switched off; only new plans stop.
- What the design does to stay inside the spirit of INV-09: no wallet table, no stored value, no top-up; each part is its own Paystack payment against one order in integer kobo; no card is kept and nothing is debited by us; the patient pays each part. See `docs/design/S25b.md`.
- For Nigerian counsel BEFORE the module is switched on: (1) is a plan with parts due after access begins consumer credit, a deferred-payment arrangement or an instalment sale under the FCCPC consumer protection regime, and what must be disclosed before the first payment; (2) does it need any CBN or lending licence, given that Tarragon extends access ahead of payment but holds no money and charges no interest or credit fee; (3) what may be done on a missed part (pausing access is built; any collections, reporting or charging beyond the parts is not built and should stay unbuilt unless counsel says otherwise); (4) whether the card fee per part (the customer pays Paystack's fee on each part) needs a clearer disclosure; (5) whether the 21 day Membership refund window running from the first part is acceptable when later parts fall after it (OQ-718); (6) data and consent wording for the reminders.
- The shipped numbers are PROPOSED (`instalments.membership_schedule`: 3 parts at 0, 30 and 60 days, 5 days of grace, reminders 3 days before and on the day). The founder confirms them; changing one is a new config row, not a deploy.
- Decision: decided to build (founder, 2026-10-20); switching it on is open (founder, counsel). **CLOSED 2026-10-21, moot: the founder withdrew pay-in-parts ("we are not doing installment payment again"); S25b is removed by `20261021183328_remove_membership_instalments.sql`, so this question no longer applies.**

### OQ-716 What a Member can use while parts are unpaid (raised by S25b)
- Built: Membership access is as normal while the plan is not lapsed. Doctor time is NOT pro-rated by the fraction paid. A lapsed plan ends the entitlement and `consume_entitlement` refuses it. One-off doctor-time entitlements follow their existing rules.
- Exposure to decide: a Member can use the monthly doctor time for up to about 65 days (the last due date plus grace) having paid one third. If a Member stops paying after using doctor time, that time was given on credit. The founder accepted credit risk in principle; the open question is whether a cap (for example, no more than one consultation until the second part is paid) is wanted. Not built: it would be a clinical access rule and needs the CMO.
- Decision: open (founder, CMO). **CLOSED 2026-10-21, moot: the founder withdrew pay-in-parts ("we are not doing installment payment again"); S25b is removed by `20261021183328_remove_membership_instalments.sql`, so this question no longer applies.**

### OQ-717 Clinician pay and the accounts for a partly paid Membership (raised by S25b)
- Built: each part posts Dr 1020 / Cr 2000 for that part with its own recognition schedule from the day it was paid to the end of the access window, so revenue is never recognised ahead of cash. No receivable is booked for parts not yet due. The full-price posting is skipped for a plan order.
- Not decided, so not guessed: (1) whether finance wants the unpaid parts shown as a receivable (Dr receivable / Cr deferred revenue at the start) instead; that would put a debt the patient may never pay on the books. (2) A part that stays unpaid after the plan lapses is not written off anywhere; it simply never arrives. (3) Clinician consultation pay is priced from the legacy path and is not tied to cash received; if a Member lapses after a consultation, the clinician has been paid for a visit the patient did not fully pay for. Whether pay should wait for the part covering that month is a finance and founder decision.
- Decision: open (finance review, founder). **CLOSED 2026-10-21, moot: the founder withdrew pay-in-parts ("we are not doing installment payment again"); S25b is removed by `20261021183328_remove_membership_instalments.sql`, so this question no longer applies.**

### OQ-718 The refund window and the cooling-off for a plan paid over 60 days (raised by S25b)
- Built: the refund rule is unchanged (21 days for a Membership) and is counted from the FIRST part. A refund of a partly paid order returns exactly what was paid, one refund per paid part against its own charge (a part paid between the request and the decision is included), and cancels the unpaid parts. The plain-words rule shown at checkout and on the receipt is the same.
- Open: a patient who pays the second part after day 21 can no longer ask for it back under this rule even though they paid it later. Whether the window should restart for each part, or the whole plan be refundable until the last part, is a consumer-law and founder question. Not built.
- Also open: the processing fee of each part is the customer's and is not refunded (OQ-97, price only).
- Decision: open (counsel, founder). **CLOSED 2026-10-21, moot: the founder withdrew pay-in-parts ("we are not doing installment payment again"); S25b is removed by `20261021183328_remove_membership_instalments.sql`, so this question no longer applies.**

### OQ-S06Z-1 The battery and battery saver cannot be read yet: a native module is needed (raised by S06z, 2026-10-21)
- Checked apps/mobile/package.json: expo-battery and expo-device are not installed, and nothing else exposes the battery level or Android battery saver / iOS Low Power Mode. S06z ships the pure decision (power-rules.ts, tested) and a port (power-port.ts, registerPowerReader) whose default answer is "unknown", and unknown defers nothing. The rules are wired (reconnect flush, background task, sync banner) but inert on a real phone until a reader is registered.
- Needed: add expo-battery in the next native build (new EAS build and runtimeVersion bump; not done because this change had to stay JS-only), then one registerPowerReader call at start-up. Also decide whether low_battery_percent (15, PROPOSED, offline.reconnect_power) is right.
- Decision: open (founder).

### OQ-S06Z-2 When bulk work waits, the background task skips the whole health-store sync (raised by S06z, 2026-10-21)
- On low power, or in low-data mode off Wi-Fi, the background task skips the health-store read as well as the upload. A read without an upload cannot advance the server cursor (it moves only past uploaded pages), so the next run would read and queue the same samples again, growing the queue toward its cap with duplicates. Nothing is lost; the samples are read on the next run that may upload. Splitting read from upload needs de-duplication in health-sync.ts. The Devices Sync now button and a foreground sync are the patient asking and still upload.
- Decision: open (product).

### OQ-S48B-1 Private route recording needs `expo-location`, a new native build and the same privacy review (raised by S48b, 2026-10-21)
- The recorder, its owner-only store, the screen card and tests with a stubbed location source are built, and sit behind the guard `private_route_recording` (off) plus each person's own switch (off). `expo-location` is not in `apps/mobile/package.json`, so `getLocationSource()` returns null and the card (when it ever shows) says recording needs a newer app. Adding it means a new EAS build, the iOS when-in-use location text, Android foreground location permission and a `runtimeVersion` bump. `runtimeVersion` was not touched.
- Still open from OQ-S48A-3: the privacy review (home and workplace inference), a retention period, counsel's view, and whether the owner may download their own route. Until those are answered the guard stays off. A route is held in memory until the person taps "Stop and save"; if the save fails (offline) it is not kept, and the screen says so. Whether a route should instead wait encrypted on the phone is a question for the privacy review.
- There is still NO share, export, map or send path anywhere; a scan test fails if one appears. Emergency location (S48-1) is separate and not built.
- Decision: open (founder, DPO, counsel).

### OQ-S48B-2 Training load, recovery and sleep band numbers are PROPOSED and unsigned (raised by S48b, 2026-10-21)
- `activity.readiness_bands` v1 (proposed-config registry, owner CMO): a recent 3 days against the person's own 28 day usual, "about your usual" within 10 percent, a 7 day load against a 28 day load with lighter below 0.8 and heavier above 1.3, minimum days of data before any band shows. They are starting numbers, not clinical findings. Needed: the CMO's view on the figures and on the wording ("lower than your usual", never "push harder", never a score against other people).
- It stays dormant: the cards render nothing without device data, and no provider has live credentials. The first real payload may show the reading-type mapping needs correcting. No governed database table was added (the figures live in versioned config in code), so there is no sign-off hub panel; if the CMO wants one, convert it to an `activity_readiness_config` table with the supersede guard.
- Decision: open (CMO).

### OQ-S48B-3 Workout plan content, audio and low-data video are still drafts (raised by S48b, 2026-10-21)
- The three starter plans stay unreviewed, inactive and text only. New database rules: every session 10 to 20 minutes, a chair-based class is gentle, an audio clip id is allowed only on a clinician-reviewed plan. Audio group `WKO` in `packages/audio` has three DRAFT unrecorded slots (one per starter plan); no audio and no video was recorded or generated. A low-data video slot kind does not exist yet and would be added the same way when a clip does.
- Older adults (from `older_adult_age` 65, PROPOSED) see chair-based classes listed first; this is order only, the gate decides what is shown.
- Needed: clinician and physiotherapist review of the text, a content owner and budget for recorded audio and video, and an administrator to activate a reviewed plan.
- Decision: open (CMO and content owner).

### OQ-S48B-4 The Movement screen on the phone no longer takes free-text activity names (raised by S48b, 2026-10-21)
- The phone now picks one of the seven kinds (as the web does for its common names) and the database derives the name. A person who used to type "walked to the market" now chooses Walking. Web still accepts free text such as Swimming or Yoga with no kind; the phone does not offer those. Needed: product decision on whether the phone should also offer an "Other" with a typed name.
- Decision: open (product).
### OQ-S43m-13 Two phone share screens were built; #1209's is kept (raised by the S43m merge, 2026-10-21; resolved 2026-10-21)
- #1209 and S43m PR 3 each built "Share my record" on the phone against the same functions. Founder decision: #1209's screen (`record-share-screen.tsx`, `lib/record-share.ts`, section `shareRecords`) is the one share path; S43m's own screen is removed from the S43m stack.
- **Resolved** by the S43m share-safeguards follow-up PR. Checked against #1209's code, these were missing and are now added: a lost answer to Create re-reads the list and says a link may already exist; a link with no views left cannot be sent again; a failed stop is shown on the link's own card (it was silent) and a link already stopped counts as stopped; a stopped link leaves the list at once; a note beside Medicines and Conditions says they include everything on those lists (OQ-S43m-7). The "link not kept in a saved copy" point needed no change: #1209 keeps no saved copy of the list.
- If the S43m stack branches are merged after this PR, their own copy of this entry must be dropped (one heading per id).
- Decision: closed.

### OQ-719 The audio help clip for the pharmacy chooser still says "Compare prices" (raised by OQ-714)
- `HLP-017` (screen `choose_pharmacy`, `packages/audio/src/screens.ts`) reads: "Compare prices at partner pharmacies, then choose where to collect your medicine. You pay the pharmacy when you collect." The price comparison was removed by OQ-714, so the words are now wrong for the screen. No recording exists yet (the manifest has no file, checksum or sign-off for it), so nothing audible is wrong today.
- Update 2026-10-21: the line was corrected in `audio-scripts.ts` and `audio/manifest.json` (new `script_hash`) in the OQ-714 pull request. The generated files are "do not hand-edit", so the Production List .docx must carry the same words, or the next importer run restores the old line.
- Earlier note, before that update: `audio-scripts.ts` and `audio/manifest.json` are generated from the Production List .docx by `scripts/audio/import-production-list.py` ("do not hand-edit"), and the .docx is not in the repository. A hand edit would also have to move the clip's `script_hash`.
- Options: (a) change the HLP-017 line in the Production List to "Choose a verified pharmacy to collect your medicine from. You pay the pharmacy when you collect." and re-run the importer before the clip is recorded (recommended); (b) record it as is and re-record later (not recommended).
- Decision (founder, 2026-10-21): wording chosen: "Choose a verified pharmacy to collect your medicine from, or take your prescription to any pharmacy you like. You pay the pharmacy when you collect." The repo carries it (`audio-scripts.ts`, manifest hash). DONE 2026-10-21: the Production List .docx (v1.0, in the company folder; original kept as `...v1.0.before-OQ-719.docx`) carries the same words, and the importer run against it leaves HLP-017's script and hash unchanged. CLOSED.

### OQ-S43m-4 A care team target has no unit, so a trend can be drawn against a target in another unit (raised by the S43m build, 2026-10-20)
- `care_plans.target_ranges` holds numbers with no unit, and `patient_biomarker_trend` returns the target without one. If a plan says HbA1c 7 or less (per cent) and the lab reported mmol/mol, a band drawn on the chart would sit far from every point. The web page draws it; the phone does not draw a target at all, shows it as words under the test, and says "this target is written without a unit, ask your care team which unit it uses". Needed: carry a unit on each target (additive column or key) and compare it with the result's unit before anything is drawn. Web has the same exposure.
- Decision: open (product, CMO for wording).

### OQ-S43m-5 `private.biomarker_points` does not exclude sensitive positives from legacy uploaded reports, and no category excludes reproductive or mental health analytes (raised by the S43m review, 2026-10-20)
- The live function (checked 2026-10-20) filters `not i.sensitive_positive` on released lab result items but not on `lab_analyte_readings` (the legacy upload branch), although S51 added `lab_analyte_readings.sensitive_positive`. Live counts: 0 legacy rows, 0 sensitive legacy rows, so nothing is exposed today. A caregiver holding only the `labs_results` category also reads every analyte, including hormone and infection panels, because analytes carry no access category. Needed: add `and not l.sensitive_positive` (a one-line additive migration with a proof) and decide whether analytes need a category. Not changed here: the phone PR adds no migration.
- Decision: open (CMO, product). Flagged as a separate task.

### OQ-S43m-6 The web results page has no words for the flags `critical`, `positive`, `negative` and `abnormal` (raised by the S43m review, 2026-10-20)
- `lab_result_items.flag` allows `normal, low, high, critical, positive, negative`, but `biomarkers.flag.*` only has `normal, low, high, critical_low, critical_high`. On the web a critical result prints no flag text at all. The phone maps every flag (and says "outside the laboratory's range" for any it does not know). Needed: the web page should use the same mapping.
- Decision: open (product, small).
- Decision: open (founder or whoever owns the Production List): update the .docx line to match.

### OQ-721 What is Membership Plus: scope, price and entitlements (raised 2026-10-21, with the removal of instalments)
- On 2026-10-21 the founder said the product is now three tiers, "free, membership and membership plus", and that there will be no instalments. The instruction gave no details for Membership Plus, so none are invented here.
- This conflicts with the earlier two-tier decisions: `docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md`, and in `docs/DECISIONS.md` the 2026-10-08 "Two-tier answers" and T-1 ("there are two tiers only"; one Member plan). The "Three-tier annual-only membership: Free, Membership, Membership Plus (2026-10-21)" entry in `docs/DECISIONS.md` and `docs/plans/three-tier-membership-build-brief.md` already propose an answer (a lower and a higher paid tier, an annual panel as the difference, a flat upgrade difference) and the build for it sits dark behind `membership_two_member_tiers`. It is not clear whether that proposal is the founder's final word.
- **Please state, for Membership Plus:** the yearly price in naira; what it includes that Membership does not (the annual blood test panel? doctor time? anything else); whether Membership keeps the panel; the mid-year upgrade price, if any; the refund window for each; and whether the 2026-10-08 two-tier wording (T-1, the 120,000 price, the T-numbered amendments) is formally superseded. Until answered, nothing about Membership Plus is built, switched on or shown to patients beyond what is already dark.
- Decision: **CLOSED 2026-10-21 (founder, answered in chat): the proposal already recorded in `docs/DECISIONS.md`, "Three-tier annual-only membership: Free, Membership, Membership Plus (2026-10-21)", and `docs/plans/three-tier-membership-build-brief.md` stands as the final scope, price and entitlements** (Membership NGN 84,000 a year; Membership Plus NGN 129,000 with the annual panel; flat NGN 45,000 mid-year upgrade; annual payment only, no instalments). That entry supersedes the 2026-10-08 two-tier decisions (T-1) as it already states. The Evergreen name is retired: customer-facing names are Membership and Membership Plus only. Nothing is switched on by this: the build stays dark behind `membership_two_member_tiers` until its listed conditions are met.
### OQ-TFLOOR-1 The assistant red-flag floor missed 28 of 73 emergency vignettes; proposed wording added, CMO to review (raised by the triage floor evaluation, 2026-10-22)
- What was run: a versioned set of 73 emergency and 74 non-urgent vignettes in everyday Nigerian English (`packages/clinical/fixtures/triage-floor-vignettes.v1.json`, runner `packages/clinical/src/triage-floor-eval.ts`, test `triage-floor-eval.test.ts`, limits `assistant.triage_floor_eval`, PROPOSED). Every vignette is `clinician_signed: false`; an engineer wrote them and no clinician has read them. This was prompted by the published finding that a consumer chatbot under-triaged about half of true emergencies and over-triaged most non-urgent cases.
- Result BEFORE any wording change: under-triage 38.4% (28 of 73 missed), over-triage 0.0% on the first 66 non-urgent vignettes. Missed, by id: E003, E004, E007 (high pressure with a bad headache, "my pressure is up and my head is paining me"); E009 (cannot move his left hand, mouth pulling to one side); E015 to E020 (diabetic emergency, "my sugar is very high and I am vomiting"); E021, E026 (very low sugar with sweating and confusion); E027 to E031 (fever with confusion, sleepy baby that will not wake, fast breathing); E032 to E035, E038 (pregnancy danger signs: headache with blurred vision, a fit, baby not moving); E052, E054, E056 (swollen tongue or throat after food or a tablet); E065, E066, E067 (bleeding that will not stop, vomiting blood, a child who drank kerosene).
- What I changed, and what I did not: the signed written-question list (`WRITTEN_QUESTION_DANGER_PHRASES`) and its database function are untouched. I added a clearly marked PROPOSED block to the assistant's own extras layer (`TRIAGE_FLOOR_PROPOSED_PHRASES` and four word pairs in `ASSISTANT_DANGER_PAIRS`, in `assistant-danger-screen.ts`), the same layer S51 used for its unsigned extras. After it the floor misses 0 of 73.
- Over-triage after the change: 6 of 74 (8.1%) once eight realistic information or history questions were included (for example "what are the signs of a stroke", "my father had a stroke two years ago"). Four of the six are tripped by the ORIGINAL signed list ("stroke", "seizure", "chest pain"); two by the new pairs (a swollen lip from the harmattan; one vomit with a normal sugar). The PROPOSED ceiling is 10%.
- NOT covered, and not built: a number written in a message ("BP is 220 over 130", "sugar 2.1") is not read by the text screen at all. The structured readings path catches numbers entered as readings; free text in the chat does not. Adding a numeric parser would be new rule logic and needs the CMO's decision on the cut-offs.
- Decisions needed from the CMO: (a) read all 139 vignettes, correct any label that is wrong, and sign the set (nothing is signed); (b) accept, change or remove each proposed phrase and pair; (c) confirm the over-triage ceiling (10%) and whether information questions such as "what are the signs of a stroke" should be answered rather than paged (today they trip the floor); (d) whether a numeric free-text rule is wanted; (e) whether the written-question list and its database function should get the same additions (a separate signed change).
- Decision: open.

### OQ-EXPIRY-1 Learning content expiry backlog: owner, thresholds, change note and a missed-day gap (raised by the expiry backlog build, 2026-10-22)
- Built: a review list for the admin team and the Chief Medical Officer (`/admin/settings/health-education/expiry`, `/clinician/learning-review`) with the 30, 14 and 7 day buckets and what is already hidden; an owner on each item; a daily job (`/api/cron/learning-expiry-alerts`, 06:15 UTC) that sends one generic in-app notice per owner and one digest per CMO; a "what changed since the last review" note, required when a previously published item is edited and published again, shown on the item. The S55 expiry rule is not changed.
- Open: (a) the thresholds (30, 14, 7) are PROPOSED (`learning.expiry_alerts`) and unsigned; (b) nobody is an owner yet: every live item shows "No owner yet" until an admin assigns one; the CMO digest counts the unowned ones; (c) a notice goes out only on the day an item is EXACTLY 30, 14 or 7 days away, so a day the job fails or is skipped loses that notice for that item (the screen still lists it and the next threshold still fires); say if you want a catch-up window instead; (d) items with no review date never expire and are not listed in the buckets, they are only counted ("live with no review date"); setting dates is still a clinical content task; (e) the "what changed" note is cleared when an item goes back to editing and is not asked for when an item is only reviewed again with nothing changed; confirm that is the rule you want.
- Review fixes 2026-10-22 (code-review high): a course lesson held back by the S33 job (inactive, back in clinical_review, date passed) now shows as hidden and is counted; the stale change note is cleared on every route out of service and cannot be edited on a live item; owner choices are limited to the caller's organisation; phrases that matched everyday text were closed at the end; "throat" no longer pairs with "swollen". NOT fixed: a missed daily run is not caught up on the next day (it needs a per-item record of the last notice; see (c)); the new SQL checks (E1-E4, S4) were written but not run, no database was available.
- Decision: open.

### OQ-S55-QG-01 Reading-grade gate: the maximum, and what the formula can and cannot tell (raised by the learning quality gates build, 2026-10-22)
- Built: patient content cannot move to `published` above a maximum Flesch-Kincaid grade unless the active Chief Medical Officer records a written override reason bound to the exact wording (`set_reading_grade_override`; editing the text voids it). The database computes the grade (`private.reading_grade`, the same formula as `packages/shared/src/learning/reading-grade.ts`, pinned by golden vectors in both).
- PROPOSED and unsigned: `learning.reading_grade` = `{max_grade: 8, min_override_reason_chars: 15}`. Needed: the CMO sets the maximum and the reason length. Clinician-level content (`reading_level = 'clinician'`) is exempt by design.
- Known limits: the syllable count is a vowel-group estimate (it can be a little off for drug names and Nigerian names), numbers are not words, a text of fewer than six words is not gated at all (the formula over one or two words is noise: the single word "Teaser" scores 8.4), and a grade says nothing about whether the content is clear or true. It is a screen, not a replacement for the understandability test (`learning.understandability_pass_rule`).
- Existing items: the 235 items already published are not re-checked or edited. `learning_reading_grade_report()` (admin or CMO, read-only) lists every item's grade so the CMO can see how many are above the maximum before deciding whether to rewrite them.
- Decision: open (CMO).

### OQ-S55-QG-02 Record-triggered lessons cannot be switched on yet, and the bands are applied by the app (raised by the learning quality gates build, 2026-10-22)
- Built, all OFF: guard `record_triggered_lessons_enabled` (created off, no defined condition, so `set_go_live_guard` cannot switch it on until conditions are added to `private.go_live_conditions`); versioned config `learning.record_lessons` (band-to-lesson mapping, the pattern size and window, a 72 hour suppression window after a red or emergency reading); six DRAFT lessons (`record-bp-in-target`, `record-bp-above-target`, `record-glucose-in-target`, `record-glucose-above-target`, `record-lab-hba1c-normal`, `record-lab-hba1c-high`) that cannot be published until a named clinical author, a named reviewer, a source, a future review date and a self-care step exist.
- Rules enforced: only the lowest band (green, or a normal lab value) can show a lesson from one reading; amber needs at least 3 amber readings inside 14 days and a high or low lab value needs 2 successive results (all PROPOSED); a red or emergency reading, or a critical lab value, shows the urgent-help box and never a lesson; a lab result is used only when released (INV-03) and a result that holds a sensitive positive is dropped whole (INV-04); the event carries ids only (INV-07); the lesson is logged once per person per lesson per Lagos day; a caregiver or a dependant's screen never logs one (the function acts only for the signed-in person's own rows).
- Where the bands come from: BP uses `private.classify_bp_level` (re-run in the database before anything is logged) and its web and phone mirrors. Glucose has no SQL classifier (`lib/vitals/glucose-red-flags.ts` and the phone's offline copy are the engines), so the glucose band is applied by the app and the database can only check that the readings are the person's own, recent, and that no red BP reading or emergency event sits inside the suppression window. Labs use the stored flag.
- Needed: (1) the CMO chooses the lessons, writes them, publishes them and signs the mapping and pattern sizes (nothing is signed); (2) the guard's conditions are defined (for example: all six lessons published and reviewed against NG-2023, the mapping signed); (3) the CMO confirms whether a single red reading should suppress lessons for 72 hours, or longer.
- Decision: open (CMO, founder).

### OQ-S55-QG-03 The food portion guide needs a clinician or dietitian to author and sign it (raised by the learning quality gates build, 2026-10-22)
- Built: the content model (an ordinary Learning Centre article whose body uses `[portion <ref> <hand>] Food name` lines, so it reuses the publish gate, review date, offline pack and search), a light renderer on web and phone (text first, hand outlines drawn from shared shapes, no images, works offline from a downloaded lesson), and two DRAFT items (`portion-guide-diabetes`, `portion-guide-bp`) covering swallows (pounded yam, eba or garri, amala, fufu), rice and jollof, beans, soups, plantain, yam, bread, drinks, fruit and protein, plus seasoning cubes, salt and fried food for blood pressure.
- Every item is `draft`, `is_placeholder`, no reviewer, no source, no review date, so the existing publish gate refuses it. A second trigger refuses any portion guide while the `portion_guide` configuration row is still `proposed`, so the placeholder amounts cannot go live by mistake.
- Every amount (for example "1 fist each meal", "1 seasoning cube for each pot") is a PROPOSED PLACEHOLDER in `learning.portion_guide` and is not clinical advice. The text of the draft items is mine, written in plain Nigerian English for a clinician or dietitian to rewrite.
- Needed: a clinician or dietitian authors and signs the food list, the wording and the amounts (including whether "best to leave out" is right for sweet drinks and which fruits to name), a new `confirmed` version of the config replaces the placeholder, and the CMO approves the two items through the normal flow. Hand sizes vary between people; whether the guide needs a sentence about that is for the author.
- Decision: open (clinician or dietitian, CMO).

### OQ-S55-QG-04 Teach-back: authoring screen, limits and sharing (raised by the learning quality gates build, 2026-10-22)
- Built: `health_education_content.teachback` (1 to 3 authored questions, 2 to 4 options, a right answer and a kind explanation, validated by trigger against the PROPOSED `learning.teachback` limits; not editable once the lesson is live), `lesson_teachback` (the questions without the answer key), `record_teachback_result` (marked in the database), `share_teachback_with_care_team` (reuses the "ask your care team" save), `consultation_shared_teachbacks` (tied clinician, audited, counts only, only while the lesson is still saved). The quiz never touches `health_education_progress`, so it never gates a lesson or a course.
- Private by construction: the result is one row per person and lesson (a retake replaces it and makes it private again), has no public score, streak or ranking, and a clinician sees it only if the person shared it. The clinician surface is the saved-lessons card on the video visit screen (the same single surface as OQ-S55-08).
- Not built: an authoring screen. `set_lesson_teachback(content_id, jsonb)` (admin or CMO, on a lesson that is not live) is the only writer. No lesson has a teach-back yet. Existing lessons keep their one `knowledge_check`; the two are deliberately separate.
- Needed: the CMO confirms the limits; clinical authors write the questions; the DPO and CMO confirm the retention class proposed in `data_registry` for `learning_teachback_results` and `learning_record_lesson_shows`; the team decides whether an authoring form belongs in the admin health-education manager (it fits the S80 CMS work).
- Decision: open.

### OQ-S55-QG-05 Glossary: drafts only, no admin screen, online only (raised by the learning quality gates build, 2026-10-22)
- Built: `learning_glossary_terms` (global catalogue; owner, reviewer, source and review date like content; a published term cannot be edited in place and new wording sends it back to draft), `learning_glossary()` (published, in-date, named-reviewer terms only), eight DRAFT terms (hypertension, systolic, diastolic, HbA1c, blood glucose, hypoglycaemia, cholesterol, creatinine) with no owner or reviewer, and tap-to-define on web and phone (first use of a term in a lesson only; a lesson with no terms is plain text). The reviewer's name is taken from the signed-in account.
- Not built: an admin screen for glossary terms (the writers are `save_glossary_draft`, `publish_glossary_term` and `retire_glossary_term`); offline glossary (the phone fetches it with the lesson and shows plain text without signal).
- Needed: the CMO reads and publishes the terms, names an owner and a source for each, and sets the review dates.
- Decision: open (CMO).

### OQ-S55-QG-06 Verification gaps of this build (raised by the learning quality gates build, 2026-10-22)
- The three SQL proofs (`reading_grade_gate.sql`, `learning_glossary_and_teachback.sql`, `record_lessons_and_portion_guide.sql`) were run only against a scratch PostgreSQL 16 with stand-in tables and functions for the platform objects they touch (Docker was not available, so no `supabase db reset`). The migrations and all proofs passed there, including every sabotage step. They have not been replayed on the full migration history, and they should run in the required `Supabase migration replay` job before anyone relies on them. In particular an existing trigger on `health_education_content` that is not in the stand-in could refuse a fixture.
- Neither migration has been applied to the live project and no live write was made. The types for the new tables and functions were spliced into `packages/shared/src/database.types.ts` by hand (not regenerated, per the standing rule), and not into the older copy in `packages/db`.
- Nothing was run in a browser or on a phone.
- Decision: open (CI).

### OQ-S55-QG-07 Low blood pressure floor and glucose bands for "what this reading means" lessons
- Review of the quality-gates branch found that the platform's blood pressure "green" includes a very low reading and the single-reading glucose classifier cannot tell "in range" from "high". A lesson saying "your reading is in a good range" would then reassure falsely.
- Built conservatively and PROPOSED: a low blood pressure floor of 90/60 (no in-range lesson below it; `LOW_BP_FLOOR` in packages/shared learning/record-lesson.ts and the same numbers in `record_lesson_shown`), and every glucose lesson is refused by the database and never offered by the app until a clinician-signed glucose band exists.
- Needs the CMO: confirm or replace the 90/60 floor, and sign a glucose in-range / above-range band so glucose lessons can be switched on.

### OQ-NAFDAC-HELPER-1 A patient-sent text to NAFDAC against INV-08 (raised by S54d, item 14)
- INV-08 says SMS is used only for phone verification codes. The NAFDAC helper (`nafdac_verify_helper_enabled`, born OFF) sends no SMS from Tarragon: it opens the person's OWN messages app with the 12 digit scratch code typed in (`sms:<number>?&body=<code>`), and the person presses send. Tarragon sends nothing and receives nothing. Whether that is acceptable is the founder's call.
- The number to text is UNVERIFIED. 38353 comes from 2010-era sources (a Mondaq article, a safemedicines.org post of 2010); a later press item says many over-the-counter and syrup packs no longer carry the PIN. It sits in versioned config `medicines.nafdac_verify_helper` marked `verified: false`, and the screen says so. NAFDAC must confirm the number, coverage and cost in writing before the guard is switched on. The Greenbook address (greenbook.nafdac.gov.ng, "Nigeria's Registered Product Database") was read on 2026-10-22.
- Related, not changed: the web pack-check text (`apps/web/src/lib/medications/pack-check.ts`, `NAFDAC_MAS`) and the collect page still print 38353 as fixed text (OQ-S08Y-4).
- Options: (a) founder confirms the patient-sent text fits INV-08, NAFDAC confirms the number, then the guard is switched on (recommended); (b) keep only the Greenbook link and drop the message button; (c) remove the helper.
- Decision: **RESOLVED 2026-10-22 (founder): Greenbook link only.** The `sms:` link, the pre-filled scratch-code text and the 38353 short-code config entry were removed from code, config, i18n, tests and the guard text; the block keeps the link to NAFDAC's public registered-product check and the wording "A registration match is not proof that a pack is genuine." INV-08 is no longer in play for this helper. The guard stays OFF. Not touched: the older `NAFDAC_MAS` text on the web pack-check and the mobile `medications.ts`, and the `medicines.mas.*` strings, which belong to main-dev and tell the person to text 38353 themselves; the founder may want those reviewed separately.

### OQ-S54D-1 Price and stock "as of" in the pharmacy chooser conflicts with OQ-714 (raised by S54d, item 9b)
- The request asked for "price and stock as of <time>" per partner pharmacy in the chooser. The founder removed the patient price comparison on 2026-10-21 (OQ-714, OQ-283, Part C.2: no price anywhere on the collection flow), and the chooser lists pharmacies BEFORE any is chosen, when no per-pharmacy stock exists (S28e holds one yes-or-no stock answer per prescription, after a pharmacy is chosen).
- Built instead, consistent with OQ-714: the stock answer on the collect page is dated and is NOT shown as available once older than `maxStockAgeHours` (48, PROPOSED, `medicines.runway_and_stock_freshness`); it then reads "Ask the pharmacy to confirm". No price, no commission data, no location collection.
- Not built: any price, and any per-pharmacy stock before choosing. Options: (a) leave as built (recommended); (b) a per-pharmacy stock flag a pharmacy sets for its own catalogue, with the same age limit, shown without a price (needs its own decision and proof); (c) reverse OQ-714.
- Decision: **RESOLVED 2026-10-22 (founder): option (a), as built.** Price and per-pharmacy stock stay removed from the chooser (OQ-714 stands). The 48-hour stale-stock rule and the runway bar stay.

### OQ-S54D-2 Who can read a "ran out or cannot afford" reason (raised by S54d, item 5)
- Built: a private reason is moved off the dose row (which a supporter holding the medicines category can read) into `medication_dose_reasons`. Readers: the person; someone acting for them (`private.can_act_for`, which includes a guardian and a manage-level supporter); a view-level supporter only after the person opts in for that exact reason (`dose_reason_sharing`, off by default, withdrawable); the tied care team through `read_dose_reasons_audited` (audited, INV-10). The supporter missed-dose notice (S53) fires only for status `missed` and never carries a reason. The reason raises no clinician alert, no outreach task and no notification by itself.
- Open: (1) a manage-level supporter acting for the person can read the reason even without the opt-in, because they can already log doses for them; option: narrow that to guardians of dependants only. (2) Reasons already stored in `medication_logs.reason` before this change stay readable by a supporter; live rows were not counted (no live access was used). (3) The care-coordinator access-barrier path (`medication_access_barriers`, which does raise a clinician alert) is untouched and separate.
- Decision: **RESOLVED 2026-10-22 (founder): tighten fully.** No supporter, a manage-level one included, reads a ran-out or cannot-afford reason unless the person opted in for that exact reason (policy `medication_dose_reasons_select`). Old values already stored on `medication_logs.reason` are copied to `medication_dose_reasons` and blanked by the same migration (`private.backfill_private_dose_reasons`), so a supporter no longer sees them on the dose row either. Proof groups B2b, B7b, B8b, G and sabotage F3 in `packages/db/tests/s54d_private_dose_reasons.sql`.

### OQ-S54D-3 Reminder reliability needs a real-device check on Android and iPhone (raised by S54d, item 4)
- Nothing here has been run on a Tecno, Infinix, Samsung or iPhone, or in a simulator. Built: a "Make reminders reliable" card (first run, Medications screen, Settings) with notification-permission guidance (including iPhone provisional), a one minute self-test whose answer is kept on the phone, one gentle follow-up 30 minutes after a dose with no answer (never more than one per dose, generic wording), the iPhone pending-notification cap held at 56 of the 64 allowed, and `interruptionLevel: timeSensitive` on dose reminders.
- Time Sensitive only takes effect in a build made with `IOS_TIME_SENSITIVE=1` (native: needs an EAS build and a `runtimeVersion` bump). Critical Alerts are NOT used and not requested. A later request to Apple for the Critical Alerts entitlement could be considered for emergency pages only, never for dose reminders; that is a founder decision.
- Battery-optimisation exemption is guided (opens the system screen) but not detected: detecting it needs a new native function (`PowerManager.isIgnoringBatteryOptimizations`) in the exact-alarms module, a native change. The self-test is the real check instead. Option: add the native function in the next planned EAS build.
- Decision: open (needs a device run).
### OQ-CUFF-1 A server-side vision step for the cuff display conflicts with OQ-598 (raised by the cuff camera and result passport build, 2026-10-22)
- OQ-598 (S70-4) decided on-device text recognition only and recorded "server vision not approved". This build was asked for explicitly to add a governed vision-model call as the alternative, because most Nigerian cuffs are not Bluetooth and no on-device recogniser ships (it needs a native module and a fresh EAS build, which cannot be exercised here).
- Built, dormant, as a courtesy step in front of the existing S70a photo screen: `POST /api/mobile/cuff-display-proposal`, AI-022 registered DISABLED (AI-021 is held by the unmerged S07y diary reader), `runGovernedAi()` with fail-closed governance, the `cuff_camera_enabled` go-live guard (OFF) AND the existing `device_photo_capture` module. The save route, source `photo_confirmed` and triage are unchanged.
- The guard has no branch in `private.go_live_conditions` (that function is edited by many open branches), so it reports "no defined condition" and cannot be switched on from the dashboard until conditions are added. Suggested conditions: AI-022 evaluation passed and approved by the Clinical Director, the vision provider data agreement in place, founder confirmation. A test account passes the guard, so the flow can be exercised today.
- Needs a written founder decision that overrides the OQ-598 line, plus a human evaluation of AI-022 (nothing was seeded: no evaluation run, prompt version, knowledge source or approval).
- Decision: open.

### OQ-CUFF-2 The cuff photo is never stored; where it does sit (raised by the cuff camera and result passport build, 2026-10-22)
- Followed the AI-007 pack reader pattern: the photo is read into memory for the one call and dropped. It is not written to storage, a queue, a row or a log, and the audit row holds "proposal_made" or "refused:<reason>", never a number or the image. Nothing persists until the person ticks every number, and then only the numbers are sent to the existing photo-readings route.
- On the phone the photo lives in the camera picker's cache until the operating system clears it, exactly as the S70a screen already did; this build does not add a longer copy.
- Open: a DPO decision on whether a transient image sent to the vision provider needs a line in `docs/PROCESSORS.md` and the data registry (no table was added, so no registry row was). The consent text tells the person the photo is sent, read and deleted.
- Decision: open (DPO).

### OQ-CUFF-3 Accuracy of the reader on real cuffs is unknown (raised by the cuff camera and result passport build, 2026-10-22)
- No clearly synthetic seven-segment image fixture could be made honestly, so the harness unit-tests the deterministic half with mocked model output (refusals, plausibility ranges from `devices.plausibility`, the hand-off to the confirm gate). Real-photo accuracy (glare, 1 versus 7, 5 versus 6, wrist cuffs, memory numbers) is untested.
- The prompt makes low confidence a retake, never a guess; an implausible pair is refused with a retake request; an impossible pulse is dropped rather than sinking a good pair. A human evaluation set of real cuff photos is needed before AI-022 can be enabled.
- No web upload fallback was built (the pack reader has one on the web); the phone is where the cuff is.
- Decision: open (CMO to own the evaluation set).

### OQ-CUFF-4 Written go-live conditions for the cuff_camera_enabled guard, and the rate limit (raised 2026-10-23, follows the 2026-10-22 "approve for evaluation only" decision)
- Built: the route now limits each signed-in person to 6 photos per 10 minutes and 30 per day (PROPOSED values, `BURST_RULE` and `DAILY_RULE` in `apps/web/src/app/api/mobile/cuff-display-proposal/route.ts`). Over the limit the route answers 429 with `Retry-After` and `{ status: "unavailable", reason: "rate_limited" }`, before the photo is read, and the phone shows its usual "type what the display shows" message. Test accounts and the closed guard never reach the limiter. Until Upstash Redis is provisioned the limiter is per server instance (packages/auth/src/rate-limit.ts), so this is a ceiling per instance, not a global cap.
- PROPOSED conditions for the guard (none is defined in `private.go_live_conditions`, so the dashboard cannot switch it on; adding a branch there is a separate migration and needs your approval of this list first). The guard may open only when all of these hold, each recorded with a name and a date:
  1. A human-run AI-022 evaluation on real cuff photos is recorded and passed. Suggested bar for the CMO to set: no accepted proposal that differs from the display on systolic or diastolic in the evaluation set, and every unreadable, glared or wrist-cuff photo ends in a retake, never a guess. The set must include glare, 1 versus 7, 5 versus 6, memory-recall screens and a wrist cuff.
  2. The Clinical Director has approved the AI-022 prompt version and the evaluation result in the AI registry (no agent seeds this).
  3. The DPO has given a written view on the transient image sent to the vision provider, and `docs/PROCESSORS.md` and the data registry carry whatever line that view requires.
  4. A data-processing agreement with the vision provider is in place that excludes storing the photo and training on it.
  5. The rate limit values above are confirmed or replaced using the evaluation's real retake counts, and Redis is provisioned or the founder accepts a per-instance limit in writing.
  6. The `device_photo_capture` module is on, and a phone build that contains the photo screen is out on both iOS and Android.
  7. The founder gives the further written go-live decision that the 2026-10-22 entry in docs/DECISIONS.md calls for.
- Switching the guard back off, or AI-022 off in the registry, must always leave the person able to type the numbers; that is already tested.
- Decision: open (founder approves the list; CMO sets the evaluation bar; DPO and the provider agreement are owed by people).

### OQ-PASSPORT-1 The result passport already existed in pieces; what was added (raised by the cuff camera and result passport build, 2026-10-22)
- Reconciled first: share links with time limit, PIN, view cap, window, revoke and a patient-visible access log (S09, S09x, share extras, `record_shares`, `record_share_lookups`, `my_access_log()`), a closed section list with no reproductive health, sensitive-positive filtering (`record_share_by_token`, restrictive policy on `lab_analyte_readings`), the printable shared view, and the patient-built visit summary PDF (`/api/patient/doctor-summary/pdf`, section choice, audit row, "prepared by the patient" line). None of it was rebuilt.
- Added: blood sugar and latest-lab sections on the same PDF builder, a "Result passport" title and "generated by the patient on <date>" line when those sections are ticked, the `result_passport_enabled` guard (OFF) checked by the page and both PDF routes, a calm page `/patient/result-passport` that builds the PDF and points to the existing share controls, a bearer route `POST /api/mobile/result-passport/pdf`, and a phone card that keeps a copy in the app's document folder for use offline. Share links stay live and ungated.
- Decision: open (founder confirms this reading of "build on the existing machinery").

### OQ-PASSPORT-2 Sensitive-positive and reproductive results are never offered, not offered as opt-in (raised by the cuff camera and result passport build, 2026-10-22)
- The brief allowed these only on explicit patient selection when category consent allows. INV-04 says a positive HIV, hepatitis B surface antigen or hepatitis C antibody result is disclosed by a clinician personally and never auto-released, and row level security already hides those rows from the patient. So the passport has no opt-in for them at all, and the lab section is an allow-list of common analytes (a code on neither list is left out and counted as "not shown"). Reproductive health records have no section.
- A per-category opt-in would need the category-scoped consent model written fresh (never copied from a sibling table) and a clinician disclosure path; not built.
- Decision: open (CMO).

### OQ-PASSPORT-3 No "reviewed by" line on the passport (raised by the cuff camera and result passport build, 2026-10-22)
- `lab_analyte_readings` carries no `reviewed_by` or `reviewed_at`, so there is nothing real to show; a null-gated `ReviewedByDoctor` line was therefore not rendered, and the PDF says it was generated by the patient and has not been checked by a clinician as a document. If release data that holds a real reviewer exists elsewhere (INV-03), a null-gated line can be added per result.
- Decision: open.

### OQ-PASSPORT-4 The phone copy needs a native build and has not run on a device (raised by the cuff camera and result passport build, 2026-10-22)
- `expo-file-system`'s native module must be in the installed binary (see `lib/offline-downloads/index.ts`), so the "Save a copy on this phone" button needs the same fresh EAS build and `runtimeVersion` bump as other native additions; where it is missing the button reports a calm failure. "Open or send" uses the built-in share sheet (a file URL works on iOS; Android needs a document provider and was not tested). Nothing was run on a physical phone or simulator.
- The lab allow-list codes (`PASSPORT_LAB_CODES`) are taken from codes seen in the repository; the CMO should confirm the list against what laboratories actually send.
- Decision: open.

- Update 2026-10-22 (OQ-CUFF-1, OQ-598): the founder decided "approve for evaluation only" (see docs/DECISIONS.md, 2026-10-22). The server vision call stays dormant; go-live still needs a human AI-022 evaluation, a DPO view, defined guard conditions, rate limiting and a further written decision.
### OQ-DP-01 Glucose readings have no status word on the patient history (raised by the design-principles pass, 2026-10-22)
- A single-reading classifier exists (`classifyLatestGlucoseLevel`) but no patient-facing word set is signed (`glucose-wording.json` is unsigned). Principle 2 (number + word + colour + icon) therefore cannot be met for glucose without new clinical wording.
- Options: (a) CMO signs a short word set per level, then glucose joins `readingStatus()`; (b) leave glucose as a number only. Recommend (a).
- Decision: open (CMO).

### OQ-DP-02 Home "safety message is waiting" line (raised by the design-principles pass, 2026-10-22)
- New plain, non-clinical Home copy (`dp.next.red_alert.*`): "A safety message is waiting for you". It names nothing clinical and does not claim a clinician was told. It sits below the emergency dialog. CMO to confirm the line, or reword.
- Also for the CMO to confirm (same item): the dose card (`dp.next.dose.*`: "A dose is due" / "Open your list and mark what you have taken today", no medicine name) and the safety-check card shown when the emergency read fails (`dp.next.safety_check.*`: "Check for safety messages"). Neither claims a clinician was told.
- Decision: open (CMO). Build order of the card is the founder's; items that were on the card before (screening, video times, check-in, review) now sit after refill, before the lesson. Confirm that placement.

### OQ-DP-03 Home has about 40 cards (raised by the design-principles pass, 2026-10-22)
- One next action is now correct at the top, but `(sections)/page.tsx` still stacks about 40 cards below it, each with its own query. No bundle measurement was run. Options: (a) founder picks a short list of cards to keep on Home and moves the rest behind "More"; (b) measure first with a bundle analysis and a low-end Android profile. Recommend (b) then (a).
- Decision: open (founder).

### OQ-DP-04 Doctor trust cue is not on every clinical item (raised by the design-principles pass, 2026-10-22)
- `ReviewedByDoctor` is keyed by escalation only. Medication changes, care-plan cards and AI-assisted summaries need an inventory of which carry `reviewed_by`/`signed_by`; add the cue only where a real record exists.
- Decision: open (product, then a build session).

### OQ-DP-05 Web has no offline write queue (raised by the design-principles pass, 2026-10-22)
- Mobile queues and shows a pending state. Web blocks the save offline and says so. A web queue needs ordering and conflict rules and a clinical-safety review (a queued red reading must never read as "sent"). Not built.
- Decision: open (founder).

### OQ-DP-06 Shared-phone mode only covers mental-health screens; non-discreet push body is template text (raised by the design-principles pass, 2026-10-22)
- No app-wide quick profile switch or "hide now". With `discreet_mode` off, a push body is the template text (up to 160 characters), protected by the INV-07 template lint only. Options: default discreet on for new accounts, or an app-wide hide. Recommend discussing with the S56 owner.
- Decision: open (founder).

### OQ-DP-07 Competitor patterns not built (raised by the design-principles pass, 2026-10-22)
- Range gauge on results, one insight card on Home, tappable suggested questions for the assistant, shareable doctor report from readings. The assistant and learning files are being edited by other sessions, so none was started.
- Decision: open (founder).

### Follow-up to OQ-S64-4: the older video-visit "full refund" line is accurate for its mechanism (2026-10-22)
- Checked while reconciling S61 to S65 against current `main-dev`. `book-video-visit.tsx` says "If nobody can take it, you get a full refund". That path (`video_visit_requests`) takes a real Paystack payment, holds it, and `/api/cron/video-visit-refunds` refunds it in cash through the Paystack Refunds API when no doctor accepts within 48 hours. So the sentence describes what happens; it is not a credit-versus-cash mix-up.
- No code was changed. The open question is still the founder one in OQ-S64-4 and OQ-133: whether this older path should stay as cash or move to the credit basis used elsewhere. Nigeria's FCCPC digital-markets guidance expects cancellation and refund terms to be clear and not misleading (U, from a law-firm summary), so whichever is chosen, the screen should state it plainly before payment.
- Also noted: `docs/design/htn-hearts-alignment-note.md` lists where the draft hypertension step table may differ from the national HEARTS-based protocol, for the CMO. Nothing in it is decided.

### OQ-S43m-7 A share link's medicines and conditions sections do not hold back reproductive or mental health items, unlike the emergency card (raised by the S43m review, 2026-10-20)
- The emergency card removes contraceptives, antidepressants and conditions that look reproductive or mental health unless their own switch is on (S47). The share link's `medications` and `conditions` sections list everything. The phone now says so beside those two switches ("tick them only if you are happy for the person to see all of it"); web has no such sentence. Needed: decide whether the share viewer applies the same rule as the card (a database change in `record_share_by_token`), or keeps the warning only. OQ-S43-4 is the earlier, wider form of this question.
- Decision: open (CMO, product).

### OQ-S43m-8 "Show everything" on the emergency card chooser does not show everything (raised by the S43m review, 2026-10-20)
- On the web, `ecf.preset_all` ("Show everything") applies the defaults, which leave conditions, reproductive health and mental health off. The phone uses a new label, "Use the standard choices" (`mpass.ecf.preset_standard`). Needed: rename the web button, or make it do what it says, with a plain note that three details are never switched on by a preset.
- Decision: open (product, small).

### OQ-S43m-9 The emergency card's saved copy was overwritten by a failed read (found and fixed by the S43m review, 2026-10-20)
- `loadEmergencyFacts` ignored every query error, so a dropped connection mid-load wrote an empty card (or the defaults over a hidden choice) over the saved copy that has to work with no signal. It now throws on any failed read, so the screen keeps the last saved copy and says so. A regression test covers each of the six reads. Recorded because the old behaviour was live in the shipped app.
- Decision: closed in this PR; no action unless the founder wants the same check on the other offline caches.

### OQ-S43m-10 Reading from a photo has never run, and the phone adds the route that would ask for it (raised by the S43m build, 2026-10-20)
- `document_capture_enabled` is off and cannot be switched on until its conditions are written (OQ-S43-6). The phone checks the guard itself and the new `POST /api/mobile/document-reading` checks it again, so with the guard off nothing is sent to any model and a photo is saved as a plain upload. With the guard on, the same route would run the web reader (AI-018). No real image was ever read by a model, on the web or the phone. There is also no atomic claim on a waiting photo: two requests close together (a timed-out one that is still running, then a second) can start two model runs for one photo, and the later answer overwrites the earlier. The phone disables Read now for a photo whose last request got no answer, but the server should claim the row (for example a `reading` state) before the model is called. Needed before switching it on: the guard conditions, the evaluation run and the CMO's approval of AI-018, then a real device test of the phone's upload, the confirm screen and a refused reading.
- Decision: open (CMO, founder).

### OQ-S43m-11 The record download cannot start from the phone (raised by the S43m build, 2026-10-20)
- `GET /api/patient/fhir-export` answers to the website's cookie session only. The phone's "Open the website to download" button opens the page in the browser, where the person signs in again. A bearer-token twin of the route (reusing the same builder and consent checks) would let the phone save and share the file directly. Not built: it is a new route that releases a whole record and deserves its own review.
- Decision: open (product).

### OQ-S43m-12 Turning and trimming uses buttons, not a drag box; a document photo is not queued while offline (raised by the S43m build, 2026-10-20)
- The trim is four steppers (4 percent a press, at most 40 percent an edge and 70 percent an axis) with a shaded preview, chosen so it works with a screen reader, large type and a low-end phone with no gesture library. It has not been tried by a person on a phone; a drag box could be added later. A document that cannot be saved for want of a connection stays on the add screen for a retry and is lost if the person leaves it (the screen says so); making it survive means a new outbox kind with an encrypted file store, which was left out of this change on purpose.
- Decision: open (product).
## S67 pregnancy screens (OQ-346 follow-up): questions from OQ-722

### OQ-722 S67-screens: the care team has no audited read of kick sessions, contraction sessions or the birth plan (raised by the S67 screens build)
- Checked: no function reads `kick_counts`, `contractions` or `birth_plans` for staff (only `antenatal_schedule_review_prompt` exists, and it reads neither). RLS lets org staff read the rows (`private.pregnancy_staff_may_read`), but a console tab that selected them directly would not write the audit entry INV-10 wants for an individual patient read. Nothing was added to the clinician Women's Health tab.
- Options: (a) a SECURITY INVOKER function `clinician_pregnancy_tools_summary(p_pregnancy_id)` that calls `private.log_audit('read', ...)` then returns the last sessions and the plan (recommended, same pattern as `antenatal_schedule_review_prompt`); (b) show only the emergency event the session already raises.
- Decision: open.

### OQ-723 S67-screens: the phone keeps the last "guard open" answer so the tools open with no signal (raised by the S67 screens build)
- `maternalGuardOpen` fails closed with no earlier answer, but after one successful check it remembers "open" on the phone and uses it offline (INV-06). A guard switched off while the phone is offline keeps showing the tools until the next successful check. The database does not read the guard for these tables (RLS only), so the guard is a courtesy gate on the screens, as for the other maternal cards.
- Options: (a) keep as built (recommended); (b) always fail closed offline (the tools vanish with no signal, which defeats the offline counter).
- Decision: open.

### OQ-724 S67-screens: web has no offline queue, so a web kick or contraction session that cannot be saved is not retried (raised by the S67 screens build)
- The fixed card still shows and says "could not be saved"; the phone path (outbox) retries. A web session that fails to save never raises the server-side care-team alert for a sign or before-37-weeks result.
- Options: (a) accept, the web screens are a secondary path (recommended for the test period); (b) keep a small local retry queue on web.
- Decision: open.

### OQ-725 S67-screens: the web danger-sign card is behind the guard, the red-flag check is not (raised by the S67 screens build)
- `PregnancyDangerCard` (web) follows the brief and shows only when `maternal_enabled` is open. The older `PregnancyRedFlagCheck` and the phone's bundled danger guide (opens only for an active pregnancy, but the phone copy of the guard answer also gates the new tools) are not gated. A real patient therefore sees danger-sign content on the red-flag check even while the new tools are off.
- Options: (a) as built (recommended; the safety content is never hidden); (b) gate the web card the same as the phone card.
- Decision: open.

### OQ-726 S67-screens: nothing was rendered in a browser or simulator; the screens are checked by tests and type checks only (raised by the S67 screens build)
- Web: React Testing Library plus axe, 23 tests. Phone: pure logic and outbox tests only (the mobile jest config renders no components), so `pregnancy-tools.tsx` has not been run on a device. Needs a look on web, an Android phone and an iPhone once `maternal_enabled` is on for a test account.
- Decision: open (needs a test session).

### OQ-727 UI-C: two pregnancy "what it may mean" lines are proposed clinical wording (raised by the UI-C devices, offline and alerts build)
- `alerttpl.preg.contact_today.meaning` and `alerttpl.preg.go_now.meaning` (packages/i18n/src/ui-device-offline-alert-copy.ts) are the new "what it may mean" line in the standard alert template used by the pregnancy cards. They are proposed copy, not signed. The title and step lines reuse the existing `preg.card.*` wording unchanged.
- Decision needed: CMO review of the two lines (`UI_C_COPY_REVIEW.clinicalKeys`).

### OQ-728 UI-C: no audio clip exists for device states, and the web has no ListenButton (raised by the UI-C build)
- Phone: Listen is wired on the device-state card (`DEVICE_STATE_CLIP`, all null today, so the explaining sentence is the text fallback) and on the pregnancy danger cards using existing clip EMG-008 (shows only if that clip can play). Web has no ListenButton at all, so change 7 was not built on web.
- Options: (a) record and sign three device-state clips, then fill `DEVICE_STATE_CLIP`; (b) port ListenButton to web (needs a web audio service).
- Decision: open.

### OQ-729 UI-C: parts skipped because open PRs own the files (raised by the UI-C build)
- Not touched: the data-connections hub and `wearable-connect-card.tsx` (#1295), the child growth card and child log (#1296/#1297), care circle (#1298), cohorts. `devices-screen.tsx`, `vitals-screen.tsx` and `packages/i18n/src/en.ts` are also edited by #1295 and other branches, in different hunks; expect a trivial merge at most. The web `wearable-connect-card` still lacks the three-state line and is a known red-styling offender.
- Decision: apply the same `deviceSyncState`/`lastSyncedInWords` helpers there after #1295 merges.

### OQ-730 UI-C: red styling on non-clinical patient cards (found by the new alert-tone lint)
- The lint (packages/shared/src/copy-lint/alert-tone-lint.test.ts) passes by listing 25 web patient cards that already use red: ask-tarragon-card, cancer-screening-card, communication-history-card, developmental-screening-card, goals-and-milestones-card, device-data-deletion-card, growth-tracking-card, hbpm-summary-card, held-readings-card, health-check-video-consult-card, hospital-admissions-card, lab-monitoring-card, lab-trend-card, nutrition-support-card, maternal-child-cards, optional-screenings-card, reproductive-health-card, verified-documents-card, senior-case-review-card, services-promo-card, wearable-connect-card, skin-photo-card, vaccination-card-import, written-question-card, weekly-summary-card. Many are probably error text or genuine alerts; each needs a human call (fix to green/amber/grey, or move to the clinical allowlist). The list can only shrink.
- Mobile screens use red in many files (e.g. womens-health, symptom, anchor-ui); the lint scopes mobile to the device, queue and alert-template files only.
- Decision: open.

### OQ-731 UI-C: nothing was run on a device or in a browser (raised by the UI-C build)
- Phone components (`LogQueueNote`, `AlertTemplate`, device rows) are covered by type checks and pure-logic tests only, as the mobile jest config renders no components. The queue note reads the existing outbox summary (`waiting`); the web has no offline queue, so change 10 is phone only.
- Decision: open (needs a test session).

### OQ-732 UI-C: someone else's device rows cannot show errors or a paused state (raised by the UI-C review fixes)
- `devices_i_manage` returns no status or last_sync_error column, so rows for people you support use "active" plus the real last-synced time (staleness and "waiting" now work from that). Showing an error or a paused state for them needs the RPC to return those columns, which is a migration, not done here.
- Decision: open.

### OQ-733 UI-C: the "no readings for N days" limit is a proposed value (raised by the UI-C review fixes)
- `devices.sync_staleness` (staleAfterDays 7) in packages/shared/src/proposed-config/registry.ts is proposed, CMO owned, unsigned. Until it is signed, a device with no sync for more than 7 days reads "Needs a quick fix".
- Decision: CMO to confirm or change the number.
### OQ-S59c-01 The follow-up after a symptom check needs a signed timing before it can run (raised by S59c)
- Built and born closed: a self-care or routine result is followed up "better, same or worse?" and "did you get care?" 24 hours (routine) or 48 hours (self-care) later, with one reminder 12 hours after it opens, open for 48 hours, notices only between 07:00 and 21:00 Lagos. All of it is `symptom.checkback`, an UNSIGNED DRAFT; the delays are product choices, not clinical thresholds. Nothing is scheduled until the CMO signs `checkback` through `sign_symptom_ux_config` AND the symptom checker guard is open for that patient.
- The CMO is asked to confirm or change: which results are followed up (self-care and routine only; urgent and emergency already put a human in the loop), the two delays, the "same after N hours points to a booking" times (24 and 72 hours), the reminder and the window.
- The outcome (progress, care received, newly ticked signs, action, hours since the check) is stored on `symptom_checkbacks` for the accuracy audit to read later; nothing reads it back yet.
- Decision: open (CMO).

### OQ-S59c-02 The describe-it table is routing words, in English and common Nigerian English, not Pidgin (raised by S59c)
- The synonym table (`symptom.describe_synonyms`) is an UNSIGNED DRAFT, so today the describe box is not shown at all and the checker is exactly as it was (the box appears only when a table is signed and matches the live one). It contains plain English and common Nigerian English ("my body is hot", "my head is paining me"); it contains no Pidgin (repository decision D-14, English only). Nobody who speaks Nigerian English has reviewed the phrases.
- A wrong route only changes which questions are asked; the red-flag floor runs over every answer either way, and the person always confirms a suggested check. The CMO (or a reviewer they name) should read the phrase list and the two numbers (`min_score` 2, `ambiguity_margin` 2) before signing.
- Founder question: whether Pidgin wording should ever be added (it would reverse D-14 for this one table). Not done.
- Decision: open (CMO, founder).

### OQ-S59c-03 "Why this result" restates signed rules in plain words; the CMO must read every sentence (raised by S59c)
- `symptom.result_explainer` is an UNSIGNED DRAFT with one reason per signed red-flag rule and per signed question-tree outcome, written from the rule labels and the rationale already on each outcome. It adds no clinical rule, and it has not been reviewed by a clinician. Until it is signed no explanation is shown at all, and a rule with no text shows nothing (nothing is invented).
- Two entries (the pregnancy and the weakened-defences headache rules) deliberately say only "something in your health history" so the screen, a copied card or a shared phone never repeats a pregnancy or HIV answer. The explanation also drops the pregnancy answer from "what you told us". The CMO may prefer different wording.
- Not built, by instruction: a ranking of causes, any diagnosis, any model-written text.
- Decision: open (CMO).

### OQ-S59c-04 Safety-net lines and the emergency number (raised by S59c)
- The generic safety net is always shown from the string catalogue (get worse quickly, something seriously wrong, nearest hospital, ask someone to take you). The pathway lines (`symptom.safety_net`) are an UNSIGNED DRAFT restating the signed red flags; unsigned means only the generic block shows.
- No helpline number is shipped. The one number the config can carry is the national emergency number, recorded as 112 with `confirmed: false`, so it is never shown. It appears only when the config is signed AND the CMO sets `confirmed` true in a new version (OQ-87 and the crisis card note say 112 awaits CMO confirmation). The wording is "where it connects in your area", not a promise.
- Decision: open (CMO).

### OQ-S59c-05 Danger wording typed in the describe box also raises a neutral emergency event (raised by S59c; DECIDED by the founder 2026-10-22)
- Decision: on a hit of the shared danger-phrase screen the device still shows emergency guidance at once and throws the words away, and ALSO calls `public.record_describe_danger(session, category)`, which raises an `emergency_events` row (source `symptom_triage`) through the existing path. Only a random per-session key, the coarse code `danger` or `self_harm`, the patient and the time are stored. It is once per session, runs whatever the plan, and is closed with the checker (INV-14). A failure is audited (`symptom_describe.error`), opens a sev3 incident and answers `recorded: false`; it never blocks the on-screen guidance. The screen says the care team was told ONLY when the event was recorded.
- Second review (2026-10-22), read from the code: the emergency path messages the person's emergency contact ten minutes after ANY active, unacknowledged event (`private.notify_unacknowledged_emergencies` -> `alert_emergency_contact_copies`: push, in-app and email with the person's name) unless `emergency_events.suppress_contact_notify` is true. So this event is now inserted with `suppress_contact_notify = true`: a typed phrase reaches the care team only, never the contact, unless the person chooses it another way. A side effect: the patient's own "alert my contact now" button also returns 0 for this event (the same switch); the person can still use it on any other emergency event. The red-alert watch (a message back to the patient) and the Care Circle notice (unified pages from allow-listed sources only, flag off) are not contact notices.
- Plans: `record_describe_danger` returns `doctor_alerted`, true only when a clinician alert was really raised. A plan without doctor time gets the event and the existing Free guidance record, no page, and the screen says "we saved this, we cannot promise someone will contact you, message your care team or go to a clinic now". Acting for someone else records nothing (web action refuses; the phone never shows the box). Rate limit: one event per person per `danger_event_min_gap_minutes` (PROPOSED, 30, in the describe config, so it needs the describe table signed; unsigned answers `not_enabled`) and once per session key.
- Question for the CMO and DPO: is "never the contact, even for self-harm" right, or should a clinician decide to call the contact? The rule as built never contacts anyone outside the care team on the person's behalf here.
- Status: decided and built; not signed, applied or live.

### OQ-S59c-06 A plan without doctor time gets guidance, not an alert, when a follow-up says "worse" (raised by S59c; DECIDED by the founder 2026-10-22: stays guidance-only, as built)
- `answer_symptom_checkback` follows the rule every symptom path already follows: if the person's plan does not include doctor time (`private.patient_may_page_doctor`) a "worse" or a new warning sign is shown on screen with the safe routes and no clinician alert is raised; an emergency still opens the emergency path. The screen says so plainly ("message your care team in the app, or go to a clinic today") and does not claim the care team was told.
- Confirm this is still the intended rule for the two-tier model (Free has no doctor time).
- Decision: open (founder, CMO).

### OQ-S59c-07 The follow-up is answered by the patient, in their own account, as an adult (raised by S59c)
- The follow-up goes to, and is answered by, the person the check was for. A carer acting for an adult cannot answer it, and checks for under 18s do not exist (the checker refuses under 18 until a paediatric protocol is signed). Staff read an answer only through the tied, audited read (`read_symptom_checkback_audited`); there is no staff table policy.
- Decision: open (founder).

### OQ-S59c-08 Signing is only half of switching a feature on: the signed text must be copied into the release (raised by S59c)
- The apps bundle a copy of each config so the screens work offline. A bundled copy is used only when it is signed and equals the live signed version (the signer's name is not compared; an unreadable live copy counts as unverified); anything else keeps the safe default and reports to Sentry, including the case where the live copy is signed but the bundle is not. So after the CMO signs a version, someone must paste the signed JSON (`symptom_ux_active_config(kind)`) into `packages/symptom-triage-engine/src/assessment-ux/drafts.ts`, the registry entry and, as the next version's seed, a migration, in one release. Until then nothing changes for a patient.
- Process question: who does this copy, and should it be a generated step? The `follow-up` timing is the one config the database owns outright; the app does not need a copy of it.
- Decision: open (founder).

### OQ-S59c-09 `send-pending-notifications` must be redeployed for the follow-up notices (raised by S59c)
- Two neutral templates (`symptom_checkback_due`, `symptom_checkback_nudge`) were added to the sender's source and the in-app copy. The deployed function does not have them until it is redeployed; until then a follow-up still appears in the app (the in-app item and the banner) but the push and email notice for it would not render. Nothing was deployed by this session.
- Decision: open (founder, at release).
### OQ-S56b-01 Who the mental health worklist shows (S56b, 2026-10-22)
- A clinician sees a patient only when they are TIED to them (`clinician_has_patient_access`: assignment, task, acknowledged page, appointment, referral). Break-glass grants are deliberately NOT a route onto a worklist (they are for an emergency read, not a standing list). A patient who never screened, checked in, logged sleep or sent a hand-off is invisible, and a care coordinator is refused (no scores). The CMO is a clinician like any other: no tie, no rows.
- The rules run set-based over the organisation on every open and every count; fine for the pilot, too heavy for the 25,000-Member tier. A nightly snapshot table (with the same tie filter at read time) is the follow-up (scale plan SR1).
- Decision: decided reading, founder to confirm (see OQ-S56b-11): record access via break-glass unchanged, worklist list tied-only. Engineering owns the snapshot.

### OQ-S56b-02 Every worklist number is a placeholder until the CMO signs (S56b)
- v1 (born unsigned and inactive): PHQ-9 rise 5 or more, GAD-7 rise 4 or more within 120 days; overdue 14 days after the date the signed schedule set; at least 5 short (under 5.5 hours) or poor (rated 2 or lower) nights out of at least 7 logged in 14 days; 8 or more check-ins in the 28 days before then 10 silent days; a hand-off unseen for 48 hours; follow-up task due in 72 hours; list capped at 100. None is a validated change threshold. The CMO can amend by signing a new version (the old one is never edited).
- Decision: open (CMO).

### OQ-S56b-03 Is "check-ins stopped" a fair thing to watch? (S56b)
- Module 46.13 and the S56 research say check-ins are a habit the patient controls and are never used to score risk. The worklist rule reads their silence for the tied clinician only (audited, not a score, not an alert). It is the rule most likely to feel like surveillance. Recommendation: switch it off in the first signed version unless the CMO wants it; it is one `enabled` flag in the rules.
- Decision: open (CMO and founder).

### OQ-S56b-04 What goes into the summary a patient sends (S56b)
- Included: the latest PHQ-9 and GAD-7 totals (three of each), the band the signed instrument already stored, the raw change since the one before, weekly mood and stress means for four weeks, sleep diary highlights for fourteen days, the patient's own note. Excluded on purpose: the private journal, questionnaire item answers (so item 9 never travels this way; the F1 crisis path owns that), check-in notes and tags, wearable data. The hand-off creates an `admin_clinical` task, so the clinician who claims it becomes tied; until someone claims it, no one is tied and it also shows on the worklist as unseen after 48 hours.
- Decision: open (CMO confirms the contents and the windows; `wellbeing.share_summary`).

### OQ-S56b-05 The calm tool's wording and pace need the CMO, and a real phone (S56b)
- The `panic.*` strings (including "You are safe right now. This feeling is strong, and it will pass.") and the pace (in 4 seconds, out 6, 60 seconds, then 5-4-3-2-1) are a PROPOSED draft. The CMO attests the exact words in the hub (bound to a fingerprint) and someone must try it with TalkBack or VoiceOver and with reduced motion on a real phone: the build ran only jsdom and source scans, not a device. The crisis wording is unchanged and 112 remains awaiting CMO approval (OQ-S56-03).
- On the web the exercise is offline only after the page has loaded (there is no service worker); on the phone it is fully bundled and the "is it open" answer is kept per person.
- Decision: open (CMO; whoever tests on a phone).

### OQ-S56b-06 Patterns are co-occurrence counts, and some may sting (S56b)
- The view compares the days on which mood was below the patient's own middle mood, split by their own middle sleep, their own middle blood pressure, a chosen tag and the day of the week, only after 21 days of check-ins in 90 and only when each group has 5 days and the shares differ by 25 points. It never says why. Tags such as grief or loneliness can produce a sentence a person may not want to see; the card can be hidden, is shown only on the person's own profile (never a caregiver acting for them) and sends nothing anywhere. The four sentence templates are pinned by fingerprint for the CMO's attestation.
- Decision: open (CMO reads the four sentences; founder may want tags left out).

### OQ-S56b-07 Hand-offs of kind `talk_request` and the worklist (S56b)
- "Tell my care team" after the calm tool sends a fixed, patient-visible sentence as the note, creates an `admin_clinical` task like every hand-off, and is a worklist reason after 48 hours unseen. It is not the urgent path: an emergency still goes through the crisis card and the F1 page. The sentence is part of the attested wording.
- Decision: open (CMO confirms 48 hours is the right wait for a request to talk).

### OQ-S56b-08 Test accounts bypass the wording attestation (S56b)
- `wellbeing_features_open()` lets a test account (and a test clinician with a test patient) through before the guard is on, and for the two wording guards also before the attestation, so the flows can be walked end to end. A real person is only reachable once the guard is on and, for the calm tool and patterns, an attestation carries the current fingerprint (proved with a non-test patient).
- Decision: open (founder confirms this is the intended test rule).

### OQ-S56b-09 What the build could not run (S56b)
- Docker was unavailable. The two migrations and the proof were run on a throwaway Postgres 16 with a hand-made stand-in for the platform tables (197 checks passed, six sabotages flipped); the real stack replay, the full `scripts/run-db-proofs.sh` and every older proof have NOT been run. Jest (shared, i18n, web, mobile), typecheck and lint were run for real. Nothing was run in a browser or on a phone.
- Decision: open (CI replay must pass before merge).

### OQ-S56b-10 Opt-out scope and a task type for worklist follow-ups (S56b review round 1, 2026-10-22)
- The patient opt-out switches off only the sleep-diary and check-in-silence rules. A patient who wants nothing on the list at all is not offered that: scores they entered into a clinical questionnaire, and anything they send, are clinical record. Decision: open (CMO/DPO: is that the right line, and is the notice sentence enough for NDPA transparency).
- Follow-ups use the existing `admin_clinical` type, which the hand-off already used. If the CMO wants a dedicated type (own competency, own due time) it should be added as a DRAFT awaiting confirmation like `crisis_follow_up`. Decision: open (CMO).
- S56's own hand-off task key (`mh_handoff:<id>`) is still readable by wider task readers; changing it was out of scope here. Decision: open (engineering follow-up).

### OQ-S56b-11 Founder decisions on OQ-S56b-01, -03 and -08 (S56b, 2026-10-22)
- OQ-S56b-03 decided: the "check-ins stopped" rule is DISABLED in the first draft rule set (v1 ships `missed_checkins.enabled = false`, the sign-off panel does not list it). The rule code stays; a later signed version may enable it (proved with a v2).
- OQ-S56b-08 decided: the test-account bypass stays as built (`is_test` is trigger-guarded).
- OQ-S56b-01, decided reading: record access via break-glass unchanged (an emergency grant still opens one patient's record through the audited read, proved), worklist LIST tied-only (an emergency grant never puts a patient on a list or in the count). CONFIRMED (founder, 2026-10-23): break-glass record access unchanged, worklist list and count tied-clinician only.
## S58b (pending credit, milestone celebrations, points returned on refund; 2026-10-22)

### OQ-S58b-01 Which switch turns points at checkout on, and who sets the numbers (raised by S58b)
- The brief asked to wire S58's `apply_points_discount` to checkout. It does not exist (S58 migration 3 dropped it on 2026-10-16; S71 to S73 own points at checkout). The live path is switched by `pricing_config.rules.points.enabled` (false) with `points_per_step` 100, `reduction_per_step_kobo` 5000, `max_steps_per_order` 5, `max_percent_of_service_fee` 50 (all PROPOSED). The S58 value `rewards.points_redemption_cap_kobo` (0) and OQ-S58-01's share and cap values belong to the unbuilt path and are not read by anything live.
- Founder: confirm that the S73 rules are the one true set (then retire `rewards.points_redemption_cap_kobo` and OQ-S58-01's redemption half), or ask for the S58 percentage-of-price model instead (that would be a second path and needs a decision against INV-09). Until then no live numbers were chosen and points stay off.
- Decision: DECIDED (founder, 2026-10-23): the S73 rules are the one true set, read from `pricing_config.rules.points` (live value checked 2026-10-23: `enabled` false, 100 points per step, 5000 kobo per step, 5 steps, 50 percent cap). `rewards.points_redemption_cap_kobo` stays unread and is to be retired with OQ-S58-01's redemption half; no second path is built. Points stay off until the founder turns the switch on.

### OQ-S58b-02 Should a refund return the points that were spent? (raised by S58b)
- Built as yes: a paid order that spent points and is refunded returns exactly those points once, as a non-earning `release` row. The alternative (keep them spent) means the cash comes back and the points do not. Partial refunds: the order model has only whole-order `refunded`, so a partial refund is not represented.
- Decision: open (founder). Confirm or remove the `refunded` branch of `private.orders_pricing_effects`.

### OQ-S58b-03 No notification for a milestone (raised by S58b)
- The brief made an in-app inbox item optional. It was not built: OQ-S58-09 says no points notification exists, and a milestone names a care step (INV-07). If wanted, it must be one neutral, key-based, in-app item ("You have a new card on your Wellness page") with no step named, never push-required.
- Decision: open (founder).

### OQ-S58b-04 Milestones and points for under-18 dependants (raised by S58b; resolved by the S04b-1 guard)
- No milestone or points row is ever written for an under-18 dependant. S04b-1 guards every `patient_id` table (including `points_award_decisions` and `milestones_achieved`); `public.points_award` returns 0 for a minor dependant before any write (it used to risk a 42501 inside the award path), milestone evaluation and the backfill skip them, and no card is shown. The earlier `show_to_minors` switch was removed because it could never apply. Only if the founder wants minors to hold milestones would `milestones_achieved` have to be classified `allowed` with `private.classify_minor_dependant_table` (a product and DPO decision, not done).
- Decision: closed unless the founder reopens (founder).

### OQ-S58b-05 Milestone list and the four-week rule are PROPOSED (raised by S58b)
- Seven milestones; four weeks of check-ins means 24 of the last 28 Lagos days (28 minus the `streak_grace` allowance of 1 per 7). A first blood pressure or glucose check celebrates whatever the value, if it is plausible; "first reading in range" is deliberately absent. Pending credit: expected within 15 minutes, ask after 120, look back 72 hours; a card is shown at most 72 hours after first shown. All unsigned, not clinical.
- Decision: open (founder). The CMO is informed that a dangerous but plausible first reading still celebrates the step.

### OQ-S58b-06 The DB proof has not run on the real schema (raised by S58b)
- Docker was down. The proof `s58b_pending_credit_milestones_refund.sql` passed (59 rows including 5 sabotage flips) only against a stubbed scratch Postgres 16 that stands in for upstream objects. Run it with `run-db-proofs.sh` on a local stack before merging; merging auto-applies migrations.
- Decision: open (engineering).

### OQ-OUT-01 The thresholds behind the engagement groups and the comparison are PROPOSED and unsigned
- Blocks: anyone acting on the comparison panel of the outcomes dashboard (`docs/design/OUTCOMES.md`).
- Built: `outcomes_dashboard_config` v1 (mirrored as `outcomes.dashboard`): "takes part a lot" is at least 12 active days in each 30 days after joining, "a little" is at most 4, a comparison group needs 30 people measured at both ends (never below the platform floor of 30 for a two-attribute cut), 95 percent intervals, adults only, blood pressure readings excluded from the engagement that draws the groups. These are engineering defaults, not clinical or statistical advice.
- Needed from the CMO (and a statistician if one is available): confirm or change the numbers. A change is a new config version, never an edit.
- Decision: open (CMO).

### OQ-OUT-02 Only a randomised holdout can say whether Health Points work
- The dashboard can only show associations. People who take part more are healthier and more motivated to begin with, so even the first-week baseline and the difference in differences cannot separate "points helped" from "keen people do better". The one design that can is a random holdout (for example, new Members are randomly assigned to earn Health Points or to a delayed start).
- Options: (a) keep the dashboard as an internal descriptive tool only and make no claim (built); (b) design a randomised rollout for the next cohort, with consent wording and the CMO's view on withholding a benefit from a random half; (c) wait for the programme to reach a size where a holdout is meaningful.
- Needed from the founder and CMO: whether to pursue (b), and when. Nothing in the build assumes it.
- Decision: open (founder and CMO).

### OQ-OUT-03 Medicine refill completion is not measured
- Asked for: "medication refill/adherence rate". Adherence is measured (S08 weekly adherence at day 90 and 180, kept apart from control). A refill actually collected is not: `medication_refill_state` records only that a reminder was sent. The page lists it under "not measured" instead of inventing a rate.
- Options: (a) wait for pharmacy dispensing records (S28) and define "refilled within N days of the due date" from them; (b) use the confirmed-refill action clinicians already take (`medications` confirm refill), which measures prescriber confirmation and not collection.
- Needed from the CMO: which definition counts as a refill.
- Decision: open (CMO).

### OQ-OUT-04 Glucose control has no signed definition beyond HbA1c
- Only HbA1c change and goal (S75 snapshots, which exist only once `outcome_config` v3 is active) are shown for diabetes. A share of glucose readings in the person's own range (`patient_glucose_targets`) or a CGM time in range would be a second measure, but no signed definition exists, so none was invented.
- Note: until S75's `outcome_config` v3 is activated by the CMO the HbA1c blocks read "not enough data yet" in production.
- Needed from the CMO: whether to add a glucose-in-range measure and its definition.
- Decision: open (CMO).

### OQ-OUT-05 "Time to first review" is the first acknowledgement of the alert raised for an abnormal screening result
- It reads `clinician_alerts.acknowledged_at` for alerts linked to a `screening_results` row (kinds marked sensitive or matching the protected patterns are left out). It is not the same as a doctor reading the result, and it does not cover lab results released under S27, or alerts from readings.
- Needed from the CMO: whether "acknowledged" is the right proxy, or whether the S16 task claim time (first claim of the linked task) should be used, and whether S27 lab results should be included.
- Decision: open (CMO).

### OQ-OUT-06 Who is left in a comparison group is itself selected
- Only people measured at both ends are compared, and people who take part more are more likely to be measured. The page shows the share not measured at both ends beside each group, but does not correct for it. A correction (weighting, or a sensitivity range counting every unmeasured person as not controlled) would be a statistical choice.
- Needed from the CMO or a statistician: whether to add a "worst case" row (everyone unmeasured counted as not controlled), which is the same stance as the existing blood pressure report.
- Decision: open (CMO).

### OQ-OUT-07 The Illinois workplace wellness trial sentence is general and its source is not checked in the repository
- `outcomes.dash.caveat.trial` says a large randomised workplace wellness trial in Illinois found that staff who joined in were already healthier before the programme began. This matches the published description of that study's participation finding, but the paper is not in the repository and the sentence has not been checked against it line by line.
- Needed: a human (CMO or counsel) to read the paper and confirm or soften the sentence before the page is shown to anyone outside the founder and the CMO. The page is internal either way.
- Decision: open (CMO).

### OQ-OUT-08 Sub-cells of two stored reports can still be subtracted
- The held-back rule guarantees that the people newly counted between two reports are 0 or at least the floor in total. It does not guard each sub-cell (for example "controlled" among them) one at a time, and it does not guard the monthly engagement cells (each month is disjoint, so those are safe). S38 and S75 accept the same residual.
- Options: (a) accept (the audience is the founder and CMO, who can already read more); (b) round counts to the nearest 5 in stored reports; (c) hold back unless the newly due people are at least twice the floor.
- Decision: open (founder).

### OQ-OUT-09 In a small pilot the outcome figures will often be frozen or withheld
- With fewer than 20 people newly due between reports the outcome cutoff does not move, and a cohort with one small category (for example 3 people with no readings) is withheld whole, as the existing blood pressure report already does. This is deliberate and calm on the page, but it means the dashboard may say "not enough data yet" for months.
- Needed from the founder: whether that is acceptable, or whether the platform floor of 20 should be lowered for this internal page only (not recommended: a founder who sees fewer than 20 people can usually guess who they are).
- Decision: open (founder).

### OQ-OUT-10 Where this page sits for the CMO, and who else might ask for it
- Super admin and the CMO read it; an analyst, finance user, doctor and care coordinator are refused. The CMO page is under `/clinician/engagement-outcomes` because a CMO account cannot open `/admin`. The reports are per organisation (the caller's own).
- Needed from the founder: whether an "analyst" role should ever read it, and whether a second organisation (a payer, a provider organisation) must never see it (it cannot today: the functions return only the caller's organisation to a super admin or CMO).
- Decision: open (founder).


### OQ-OUT-11 After the review, reports will be held back often and some figures were narrowed (2026-10-22)
- The held-back rule now covers every shown denominator and group, so in a small pilot almost every month some group moves by 1 to 19 people and the outcome figures stay at the previous cutoff. The first report is never held. Reports must also be made in order. Escalation status is current state, not state on the cutoff date. Points from lessons and courses are left out of all points figures because the ledger does not record their topic; mood, sleep and water readings are not counted as taking part; an escalation counts only when tied to an ordinary alert.
- Option: raise nothing and accept frozen months (built); or round the stored counts so smaller moves are not disclosive (see OQ-OUT-08).
- The Illinois sentence was reworded to a general one (no specific trial named); OQ-OUT-07 is now only about whether the general sentence is supportable.
- Decision: open (founder and CMO).


### OQ-OUT-12 OQ-OUT-09 and OQ-OUT-11 are DECIDED (founder, 2026-10-22): a founder-only unfrozen view
- Decision: keep the frozen, stored reports as they are, and add a super-admin-only read that works the held-back figures out to today (`read_outcomes_founder_unfrozen`, page `/admin/outcomes/engagement/founder`). Off by default, a reason required and audited, nothing stored, no export, not for the CMO. The minimum-cell rule and protected-data exclusions are not lifted. OQ-OUT-09 and OQ-OUT-11 are closed by this.
- Still open: the platform has no separate founder role, so "founder" is the super-admin account (`profiles.role = 'admin'`); if more than one such account exists, each can open the view. The switch is off until the founder turns it on (a new `outcomes_dashboard_config` version).
- Decision: closed (founder).
- CONFIRMED (founder, 2026-10-23): with no separate founder role, the unfrozen view stays gated to `profiles.role = 'admin'`, off by default, reason required and audited.
### OQ-S59d-01 Which draft does the CMO sign? (raised by S59d, 2026-10-22)
- There are now two unsigned drafts in `triage_protocols`: the S59 draft (signed adult pathways, chest pain with no floor, adult v2 extras, three paediatric pathways) and the S59d draft, which is a strict superset of it plus adult fever with suspected malaria or typhoid, pregnancy danger signs, high blood pressure complications and diabetes complications. Signing replaces the whole active config.
- Recommendation: sign the S59d version, not the S59 one; the S59d migration asserts that it keeps every pathway of the S59 draft and every rule key of its `fever`. The sign-off panel now shows every rule, question and source of a draft before the Sign button.
- Decision: open (CMO).

### OQ-S59d-02 Adult fever: the malaria and typhoid questions (raised by S59d, 2026-10-22)
- Open clinical questions F1 to F5 are listed in `docs/research/S59d-pathway-coverage.md` and on the sign-off panel: the 3-day prolonged-fever line (the v2 draft said 5), whether an untested fever is "routine: get tested" or urgent after some days, a positive test always urgent, fever in sickle cell disease (urgent drafted, many protocols say emergency), and the travel, rainy-season and Lassa hooks in `symptom.risk_tightening` version 3 (`any_trigger` is a new optional key that can only add a match).
- No Nigerian typhoid seasonality was found, so there is no typhoid season hook. The Nigerian national malaria guideline edition was not opened.
- Decision: open (CMO).

### OQ-S59d-03 Record readings as tightening for blood pressure and diabetes (raised by S59d, 2026-10-22)
- `symptom.context_tightening` version 3 adds drafts that raise a result from the recent record only: systolic 180 or diastolic 120 for the blood pressure pathway, glucose 3.8 or lower (below 3.9) or 20 or higher for the diabetes pathway, pregnancy with fever or belly pain. The glucose 20 line has no opened source. The look-back window (`symptom.context_window_days`) is unchanged.
- Decision: open (CMO).

### OQ-S59d-04 The diagnosis-to-urgency map, and what "agrees" means for the auto-fed audit (raised by S59d, 2026-10-22)
- The audit can only count a signed consultation diagnosis once a map says which urgency category the diagnosis maps to. `symptom_diagnosis_urgency_maps` version 1 (34 ICD-10 prefix placeholders, mirrored by the PROPOSED `symptom.diagnosis_urgency_map`) is unsigned and inactive; until the CMO confirms a version through `confirm_symptom_diagnosis_urgency_map`, rows keep the code and no category, and the audit counts nothing from them.
- A diagnosis does not have an urgency; the map is a clinical judgement about the urgency a presentation of that diagnosis deserved. The CMO may prefer to drop auto-feeding for diagnoses where this is too coarse, and to treat unmapped codes as not counted (as drafted).
- `agrees` compares the mapped category with the category the patient was GIVEN (clinician override first) and is a snapshot at link time; a later override does not change it.
- Decision: open (CMO).

### OQ-S59d-05 The pregnancy pathway must not be run for someone else (raised by S59d, 2026-10-22; decided 2026-10-22, CHANGED after review: founder to confirm)
- Founder decision (CMO/DPO question): BLOCK it. Only the person themselves answers `pregnancy_danger_signs` and pregnancy-context questions. When a carer or relative runs the check for another person, the pathway is not offered, the engine and the record never receive a pregnancy answer, and the result says plainly that pregnancy questions can only be answered by the person themselves, with the emergency guidance still shown.
- Enforced in `applyProxyPregnancyRule` (engine package), `runSymptomStep`, the loader `getActivePathway` (`forProxy`), the web picker, and the database trigger `symptom_triage_assessments_02_proxy_pregnancy` (migration `s59d_proxy_pregnancy_guard`). Mobile answers only for the person themselves.
- CHANGED after review: dropping a proxy's "pregnant" answer LOWERED urgency (headache.pregnancy_severe, fever.pregnant, the pregnancy context entries take it as input). Now a proxy's pregnancy answer is never stored but is used in memory, so rule-level results equal the self case, and the result is floored at least urgent with a plain line saying pregnancy changes how urgent this is and that pregnancy questions can only be answered by the person themselves. The blocked pathway screen leads with "If this is an emergency, go to the nearest hospital now" (112 only once signed and confirmed) and raises the same incident and follow-up task an unrecorded urgent result does.
- Decision: CONFIRMED (founder, 2026-10-23): a proxy's pregnancy answer is never stored, is used in memory, and floors the result at least urgent with the plain line.

### OQ-S59d-06 Reproductive-health symptom pathways were not drafted (raised by S59d, 2026-10-22)
- Menstrual, contraception and fertility symptoms are `reproductive_health` category data (no emergency break-glass, guardian gate for adolescents). A symptom pathway would store the answers in a session row with the weaker session-level read. Skipped on purpose; postnatal and early-pregnancy pathways are also not drafted (CMO question P4).
- Decision: open (CMO and DPO).

### OQ-S59d-07 Safety-net advice for diabetes and blood pressure pathways (raised by S59d, 2026-10-22)
- The pathways decide a category only. What to do right now (treat a low sugar with fast sugar then recheck, ketone testing, sit and rest before a repeat blood pressure) belongs to the safety-net advice, which is being built separately. Without it, an "urgent" low sugar reads as "be seen soon", which is not enough for a person who is shaky now.
- Decision: open (CMO, with the safety-net advice owner).

### OQ-S59d-08 Nothing yet lets a clinician type the ICD-10 code (raised by S59d, 2026-10-22)
- The audit feed needs `clinical_encounter_notes.diagnosis_code`, set on a draft note by the new `set_encounter_note_diagnosis_code`. No note editor field calls it yet, so no auto row can exist until the editor (and the scribe draft path) gain a code field. The free-text `diagnosis` is not parsed.
- Choices made and open: a signed amendment of any kind (correction, addendum or late entry) retracts the original's row, and only a coded amendment writes a new one; async and phone consultations are not linked (the chain is booking-based); a retraction after a monthly report was generated does not change that report (reports are permanent).
- Built 2026-10-23 (note-editor-icd10): the draft note card has an optional "ICD-10 code" input under Diagnosis (shape checked in the browser by `lib/clinical/icd10.ts`, the same pattern as the database check). It saves through `set_encounter_note_diagnosis_code` on Save changes and before signing; a malformed code blocks both. The scribe draft fills the same card, so it needs no separate field. The first save of a brand-new note has no code box; it appears once the draft exists. Other open choices below are unchanged.
- Decision: open (product, CMO).

### OQ-S59d-09 Check the live active protocol row before the app gate ships (raised by S59d, 2026-10-22)
- The app now treats only an ACTIVE and SIGNED triage protocol row as live (both `approved_at` and `approved_by` set), and a new NOT VALID constraint refuses an unsigned active row from now on. If the live active row was ever activated without both fields, the app gate would switch the checker off. Run the query in `docs/design/S59d.md` section 7 before merging. The checker is behind `symptom_checker_enabled` (OFF) either way.
- Decision: open (engineering, before merge).

### OQ-S59d-10 New patient wording needs the CMO's wording sign-off (raised by S59d, 2026-10-22)
- Forty `symptom.opt.*` labels were added for the draft pathways (English only, no diagnosis named, tested). They are new patient-facing clinical wording and must be reviewed with the pathways. The check screen must also collect the measurements the rules use (`systolic`, `diastolic`, `glucose_mmol_l`, `temperature_c`) for the measurement rules to fire; that screen is not part of this piece of work.
- Decision: open (CMO).

### OQ-WP3-01 Cascade stage definitions and control lines need the CMO's signature (raised by WP3, 2026-10-23)
- `outcome_cascade_config` v1 is PROPOSED, unsigned and inactive. Until the CMO signs it on the sign-off hub, every cascade figure and the pack's cascade and selection panel say "awaiting the CMO's signature". To decide: (a) the 140/90 line for hypertension control and the 7.0 percent line for diabetes (both fixed, not each person's own target, unlike the day-90 and day-180 reports); (b) "on treatment" means any active medicine recorded under the condition's care plan, because the medicine class is not held; (c) pregnant members and anyone under 18 are left out; (d) the lookback windows (90 days for blood pressure with a 7-day average of at least 3 readings, 180 days for HbA1c).
- Decision: open (CMO).

### OQ-WP3-02 "Screened" has no population denominator (raised by WP3, 2026-10-23)
- Tarragon holds no register of the people who could have been screened, so the screened stage is a share of enrolled Members, and population screening coverage, undiagnosed raised blood pressure and prevalence are listed as "not available" in every output. If the founder wants a true coverage figure, a sponsor-supplied eligibility list (or a census figure for a named programme) would have to be added as a new data source.
- Decision: open (founder, product).

### OQ-WP3-03 People who were eligible but did not enrol cannot be counted (raised by WP3, 2026-10-23)
- The selection panel compares members in a programme's figures with (a) other adult Members who are not in that programme and, for staff only, (b) members who joined but did not agree to share. A sponsor's eligible roster is not held, so seat take-up (codes handed out) is shown labelled as seats, not eligible people. Showing attributes of members who declined to share group figures is limited to the internal admin view; counsel should confirm that internal comparison is consistent with the sponsor-reporting consent text.
- Decision: open (counsel, DPO, founder).

### OQ-WP3-04 S38 and S75 count any reading with an empty flag list (raised by WP3 review, 2026-10-23)
- The S38 snapshot job, `private.v_bp_cohort_90d`/`v_bp_cohort_day` and the pack's other blood pressure figures admit a reading when `validation_status = 'valid' OR coalesce(validation_flags, '{}') <@ array['insufficient_context']`. An empty array is a subset of every array, so that also admits a `requires_validation` reading with no flags. WP3 uses the tightened rule (valid, or requires_validation with only insufficient_context) in its own code and did not edit S38. Whether S38 should change (it would move already-written snapshots' future rows, not past ones) is a CMO and engineering decision.
- Decision: open (CMO, engineering).

### OQ-WP3-05 Should a sponsor see how its members compare with other Members? (raised by WP3 review, 2026-10-23)
- The sponsor pack's selection panel withholds both attribute comparisons (people who declined, and other adult Members). Showing the comparison with other Members to a sponsor would describe people outside the programme who agreed to nothing with that sponsor, even as small-cell-suppressed shares. Counsel and the DPO would need to confirm before it is shown; the internal admin view keeps it.
- Decision: open (founder, counsel, DPO).

### OQ-WP1-01 Price changes for organisation member prices are not announced (raised by WP1, 2026-10-23)
- WP1 tells a holder (and the person who paid, when different) in the app when a LIST price changes. It does not cover `organisation_member_prices` (an employer's per-member price) or institutional price book rates: those members are not bought through an order the notice can follow, and there is no equally small hook. The employer, not the member, is the party told, through the employer contract.
- Decision: open (product). If members should be told, the hook belongs in the employer membership flow, not in `prices`.

### OQ-WP1-02 May the app say "about N a month, billed once a year"? (raised by WP1, 2026-10-23)
- The founder has said Member is one yearly payment and has refused any monthly figure or instalment (S72-2 stands). WP1 built the monthly line (kobo / 12, rounded half up to whole naira, always the sentence "Billed once a year, not monthly") but it is OFF: `pricing.transparency` `monthly_equivalent.enabled = false`, and web and mobile show nothing monthly while it is off.
- Question for the founder: confirm that "About ₦7,000 a month. Billed once a year, not monthly." is acceptable as a way to compare. If yes, flip `enabled` in the registry (a normal reviewed change). If no, remove the line.
- Decision: open (founder).

### OQ-WP1-03 All WP1 seeded wording is PROPOSED and unreviewed (raised by WP1, 2026-10-23)
- Seeded "not included" entries: Membership lists medicines (the sentence already in its description), care in a hospital or clinic and emergency treatment, a consultation and a lab package; the single consultation lists medicines and a lab package. The words `catalog.notincl.*`, `notincl.*` and `pricechange.*` and the bell line are new patient-facing copy. None has been read by the founder or the CMO. The consultation and the lab package have no live price, so they show "Ask us" on day one by design.
- Decision: open (founder for wording, CMO for the hospital and emergency line).

### OQ-WP7-01 WP3 should switch to the shared usable-reading helper (raised by WP7, 2026-10-23)
- WP7 (migration `20261023214131_wp7_bp_usable_reading_rule.sql`) put the OQ-WP3-04 rule in `private.bp_reading_usable(status, flags)` and converted the S38 snapshot job, `private.bp_window_stats` and the two cohort views to it. WP3 defines the same rule as `private.wp3_reading_usable`. When WP3 merges, replace its calls with `private.bp_reading_usable` and drop its copy, so the rule lives in one place.
- Already-written `outcome_snapshots` rows were not rewritten. Live count of snapshot rows that would differ under the new rule, read-only on 2026-10-23: 0 (all 767 live BP readings are waiting with only `insufficient_context`).
- Decision: open (engineering, at WP3 merge).

### OQ-S57c-01 Library audio: private bucket, stream only, drafts until reviewed (raised 2026-10-23)
- Built: PRIVATE Storage bucket `audio` (no storage policy at all) and 46 DRAFT `media_library` rows for the ElevenLabs masters in `audio/library/masters` (`med-*` codes; `audio_url` holds the storage path; length and size filled; every row `downloadable = false`). The recordings play only through `/api/media/{code}/stream`: signed-in, the catalogue's own rule decides (patients get only a published, in-date item), the file is fetched with the service role by a 60-second signed address and passed on with Range support, never cached, inline, and refused when opened as a page. The web player drops the download control. A person can still record what plays; no file or link is ever offered.
- DECIDED (founder, 2026-10-23): stream only on the platform, no download, 24-month review cycle, the founder as brand reviewer when publishing.
- Left out: MED-SER-FAITH (the CMO writes faith-compatible content, a named faith leader reviews it) and MED-BRE-001 to 005 (breathing is a script item with steps and a pattern behind `wellbeing_library_clinical_scripts`; the CMO decides how spoken guides are catalogued).
- Not built: the phone app has no audio library player (OQ line 3640: needs an audio engine and a runtimeVersion bump), so stream-only holds on the web only until that exists.
- Decision: open (CMO for the breathing guides and the faith item).

### OQ-QUEUED-1 A queued year's revenue schedule is not re-based when the year starts early (raised 2026-10-26)
- Built: a Membership year bought onto a running Plus year is queued and starts when the Plus year ends (`docs/DECISIONS.md`, 2026-10-26). Its revenue schedule is built at payment and starts on the queued start date.
- Gap: if the Plus year is refunded or ended early, the queued year starts at once, but a schedule already built keeps the later start. Nothing in finance re-bases a recognition schedule, and the difference is only timing of recognition for a rare case.
- Options: (a) add a finance function that moves a schedule's start; (b) accept the timing difference and say so in the finance notes; (c) build the schedule only when the year actually starts.
- Recommendation: (b) until a finance owner asks, because the case needs a race and the amounts are small.
- Decision (founder, 2026-10-26, "do what is best"): option (b). The queued year's recognition keeps its later start; only the timing of recognition differs, the amounts are small and the case needs a race. Finance can ask for (a) later. Nothing to build.

### OQ-BUNDLE-1 An annual-bundle result the patient uploads (raised 2026-10-26, RESOLVED 2026-10-27: no new build needed)
- Question: is a result uploaded for the annual bundle just a document, or is it read into platform values?
- Founder decision (2026-10-26): the upload stays a plain document and AI in the background reads it into platform values.
- Finding (2026-10-27, read from the code): this already exists. The bundle upload in "Your test requests" is the same patient upload (`uploadPatientResult` in `lib/lab-results/actions.ts`) that every patient result uses, and it calls `runLabReportExtraction` after saving. That is the registered system AI-005 (`labReportExtraction`, live, kill switch honoured, every outcome in `ai_interaction_log`). It reads the report into a DRAFT for a doctor to file from the clinician panel (`lab-report-extraction-panel.tsx`), so values reach `lab_results` only after a doctor confirms (INV-03). The earlier gap text in this entry was wrong. No new AI system, evaluation or approval is needed.
- Left as is: filing is a doctor action, so values appear in trends and the cascade of care after a doctor confirms, not instantly. A bundle result with no readable values stays a document and the doctor enters them by hand.

### OQ-PLUS-1 Membership Plus given without a checkout carries no collection state (raised 2026-10-26)
- Built: Membership Plus and the upgrade to it need an admin-approved state at checkout (`create_order`), stored on the order and copied to the membership, fixed after payment, shown to the member. Only while the module `membership_two_member_tiers` is on.
- Covered since the checkout review: a gift accepted later and a sponsor-covered Plus order carry the state the buyer chose (copied from the order); Plus cannot be requested through a supporter's payment link while the module is on.
- Gap: Plus can still arrive without any checkout: an employer seat (`grant_org_seat`, which maps a seat to Plus), an admin grant (`grant_membership_tier`), a legacy conversion, and the grandfathered rows. Those memberships have `collection_state` null, so Tarragon cannot tell where to arrange their blood collection.
- Options: (a) require a state when an employer registers a Plus seat or an admin grants Plus (a field on the roster row and on the grant form); (b) ask the member to choose from the approved list on first use of the collection flow; (c) leave null and let the care team arrange it by hand.
- Recommendation: (b) for legacy rows, (a) for seats and grants, because the employer and the admin already know the person's state.
- Decision (founder, 2026-10-26): Plus given without a checkout needs a collection state. Built: (a) an admin grant of Plus needs an approved state while the module is on (`grant_membership_tier`, a state field on the grant form); (b) a Plus member whose state is empty chooses it once from the approved list (`set_my_plus_collection_state`, web and mobile), which also covers employer seats and older rows. Not built: a state field on the employer roster row, because the member already chooses on first use and the employer rarely knows it; add it if an employer pilot asks.

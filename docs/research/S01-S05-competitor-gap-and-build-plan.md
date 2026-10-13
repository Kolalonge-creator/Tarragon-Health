# S01 to S05: competitor gap review and build plan

Date: 2026-10-07. Scope: S01 (reconcile and scaffold, plus S01b/c/d removals), S02 (identity, access, consent data model), S03 (sign-up, verification, recovery), S04 (consent, dependants, proxy), S05 (health record data model).
Spec source: `docs/BUILD-SPEC-v5.md` Module 1 rows 1.1 to 1.19 (lines 765 to 788), Module 2 rows 2.1 to 2.5 (lines 836 to 842), section 4.1 to 4.3, section 8.2.
State source: `docs/BUILD-PROGRESS.md`, `docs/design/S02` to `S05`, `docs/research/S03`, `S04`, `docs/OPEN-QUESTIONS.md`.

## 0. How this was produced, and what is not verified

- These five sessions are already built. This is a gap-closing and hardening plan, not a first build. Nothing here proposes rebuilding what exists.
- Repo state comes from the progress log and design notes, not from re-reading the live database. CLAUDE.md warns repeatedly that a migration file is not proof of a live definition. Every session below starts by checking live definitions.
- Competitor facts come from three web research passes made today (one search pass per topic, mostly search-result summaries, few full page reads). Cells the researchers could not verify are marked UNVERIFIED and must be re-checked in each session's Step 2. No app was installed. Vendor claims are marketing.
- Not researched or thin: Ovia, Omada (help page returned 403), CareClinic, Noom, M-TIBA/Afya consent, Eka Care family UX, Oracle Health, InsideTracker, Dario, Lifen, Hello Doctor, and almost every Nigerian health app (Healthtracka, Mobihealth, Kangpe, Doctoora, mPharma, Helium Health). Primary NDPA 2023 and GAID 2025 text was not read; the age threshold for "child" under GAID is UNVERIFIED.
- Raw research notes (comparison tables and URLs) were written to the session scratchpad and are summarised in section 2. Re-run them before treating any single claim as settled.

## 1. Where S01 to S05 stand

| Session | Built | Not applied or not exercised | Open |
|---|---|---|---|
| S01/b/c/d | Reconciliation, Platform Credit removed, WhatsApp removed, `apps/console` extracted | Console has no Sentry (OQ-35), Vercel/DNS for console needs founder (OQ-36), shims remain (OQ-37) | OQ-29 to OQ-37 |
| S02 | `is_test`, `discreet_mode`, `low_data_mode`, audit_log subject/ip, audited-read pattern, `proxy_setups`, `patient_consent_state` | Applied | `audit_log_select` is too broad; empty result on refusal is ambiguous (design S02 section 4) |
| S03 | Phone-first sign-up, `auth-send-sms-hook` with provider interface, breached-password check, phone-keyed limits, enumeration-safe recovery, assisted recovery (two admins, SIM-swap review), en/pcm auth strings | **Hook, secrets, dashboard settings and Termii sender ID not live** (OQ-44, OQ-46). Nothing exercised on a real device or real SMS | OQ-41 (roster claim before verification), OQ-42, OQ-43 (SIM swap), OQ-45 |
| S04 | Proxy "Set up for my parent" (safety case 23), `is_optional` consent versions, consent state helpers, applied 2026-10-01 | Proxy cannot send a real code until the SMS hook is live. No mobile proxy flow | OQ-47 to OQ-53 |
| S05 | v5 vocabulary as views over live tables, `record_source`, `client_id`, `prescriptions`, `read_patient_chart_audited`, closed 2026-10-02 after live click-through | Audited reads enforced on 2 of 10 tables at S05; later S05b to S05f moved most staff reads and S39b tied 128 tables. Re-count before assuming | OQ-54 to OQ-58 |

Spec rows with no build yet (from the progress log and grep on main-dev): 1.7 USSD registration (`ussd_pins` absent), 1.8 cohort codes at sign-up (S38e added sponsor cohorts; check whether `cohort_codes`/`profile_cohorts` as specified exist), 1.10 to 1.12 onboarding answers, plan preview and first-screen audio (audio is S32), 1.15 self-serve export and deletion (OQ-50; older `data_export_requests` and `data_deletion_requests` migrations exist and must be reconciled, not duplicated), 1.16 quiet hours and discreet wording (column exists, nothing reads it), 1.18 age-18 hand-over with the young person's agreement.

## 2. Competitor comparison by area

### 2.1 Sign-up, sign-in, recovery (rows 1.1 to 1.8)

| Capability | Best seen elsewhere | Tarragon today | Gap |
|---|---|---|---|
| OTP delivery | Fallback order trusted device, SMS, voice call, in-app or email (Apple); track delivery status not send status and switch channel after a timeout | Single channel (SMS) behind a hook; mock default | No voice or email fallback; "sent" is not "delivered"; DND failures are silent |
| Daily unlock | M-TIBA: phone plus 4-digit PIN, no OTP per login | Password, optional biometric App Lock | No PIN-first path for shared or low-skill users |
| Shared phones | Fintech one-device rule (CBN circular, March 2026, for financial apps) breaks households with one phone | Device recognition notice only | Needs per-profile PIN, not a one-device rule |
| New device | Read-only for 24 hours, old device notified (Nigerian fintech bar) | Notice by in-app and email | No restricted state for a new device |
| Recovery | Several independent routes: backup codes, named recovery contact, change-number flow confirming old number plus email (Apple, Samsung); face check for wrong number (Eka Care ABHA) | Phone code, email link, assisted recovery with two admins | No backup codes, no recovery contact (Care Circle member is a natural fit), no self-serve change-number flow |
| SIM swap | Telecom swap-check API exists for banks (April 2026); availability to non-financial firms UNVERIFIED | Admin review only (OQ-43) | Recent number change should raise friction on recovery |
| Eligibility before account | Omada: coverage check, then clinical eligibility, then account | Roster claim runs before verification (OQ-41) | Cohort and sponsor code should be validated first, claimed only after verified contact |
| Onboarding length | Noom quizzes reported near 113 screens: a trap on 2G | Short form | Keep it short; progressive profile |
| USSD | M-TIBA 4 to 5 step USSD registration; Hello Doctor call-back USSD puts cost on the provider | None | In Nigeria the user pays about NGN 6.98 per session since June 2025 (UNVERIFIED for sponsored codes). Needs a short code and a sponsor model |

### 2.2 Consent, privacy, dependants (rows 1.13 to 1.19)

| Capability | Best seen elsewhere | Tarragon today | Gap |
|---|---|---|---|
| Consent model | ABDM Consent Manager: artefact naming record types, date range, storage duration; individually revocable; recipients notified | Per-purpose append-only rows, required vs optional, withdrawal trigger | No time-boxed or recipient-specific consent; optional purposes not seeded (OQ-49) |
| Withdrawal | Apple "Stop Sharing" removes shared data at once | Two taps; required consent block enforced only in the web action (OQ-53) | Enforce in the database; make sharing revocation visibly immediate |
| Export and delete | Clue: GDPR export, delete by deleting account | Older request tables exist; no self-serve flow in v5 shape (OQ-50) | Self-serve with status and a stated timeline |
| Discreet use | Flo Anonymous Mode decouples identifiers; Flo FTC order and 2025 verdict show the cost of leakage | `discreet_mode` stored, unread | Wire into every sender; third-party SDK audit of health data leaving the device |
| Child and teen | MyChart: teen consent gates parent access, confidential categories withheld, proxy ends at 18. NHS: mandatory review at 13, competence check 13 to 15. Google Family Link flip-flop at 13 is a warning | Dependant profiles; hand-over at 18 exists without the young person's agreement | Age review points; hand-over needs agreement; protected categories already exist (reproductive) |
| Proxy | Separate proxy logins (one study: 64 to 76 percent of teen accounts read by parents, about a tenth had a proxy login) | Parent-confirmed proxy with categories unticked by default, 72 hour expiry; add-elder path gives `manage` before the elder agrees (OQ-47) | Close OQ-47, OQ-51, OQ-52; patient-visible log of what the proxy viewed; mobile flow |
| Coercive-control risk | Design assumption only, no vendor source | Not addressed | Patient can narrow or revoke a proxy without the proxy being told first |
| Law | NDPA 2023: health data sensitive, express and unbundled consent, burden of proof on controller, withdrawal explained first; GAID effective 19 September 2025 expects consent evidence in annual returns | Append-only consent history | Add a consent receipt (text version, language, time, channel) as evidence; counsel to confirm child age rules |

### 2.3 Health record (Module 2 rows 2.1 to 2.5, section 4.3)

| Capability | Best seen elsewhere | Tarragon today | Gap |
|---|---|---|---|
| Provenance | Health Connect stores origin app, device and recording method (manual, active, automatic, unknown) | `record_source` enum, `recorded_by`, `client_id` | Add recording method and device where missing; keep wearable estimates visually separate from validated readings (already badged in the older build) |
| Corrections | FHIR corrected, amended, entered-in-error; use cancelled when decisions were already made | Amend-and-supersede on medications; notes use amends link | One rule across tables: supersede with a status, never edit or hard-delete |
| Medication model | Schedule plus dose events; re-notify until taken or skipped (MyTherapy); adherence PDF (Medisafe) | Schedules and dose logs (S08 built) | Verify only |
| Genotype and blood group | Prominent in Nigerian use; certificates can be manipulated | Free-form per live columns (verify) | Add `self_reported` vs `lab_verified` flag |
| Ranges | Function Health buckets in range, out of range, other; shows no "optimal" as clinical | S46 and S43 own trends | Carry range source on every value |
| Who viewed my record | MyChart shows which apps accessed | Audit rows written; patient cannot see them | Patient-facing access log |
| Share link | Withings 7-day anonymised link; SMART Health Links passcode, expiry, wrong-attempt counter, no revocation or log | S09 owns this | Build revocation and an access log ourselves in S09 |
| Interoperability | Nigeria Core FHIR guide and NPHCDA immunisation guide exist | S44 owns this | Map to Nigeria Core and the NPHCDA guide in S44; IPS shape for the emergency card |
| OCR | Eka Care users report poor handwriting accuracy | Photo capture exists in the older build | Keep original image, label "from document, user confirmed" |

## 3. The best build: design decisions

1. **Channel fallback is the biggest S03 gap.** SMS first, a voice call after a timeout, then email where one exists. Log delivery status where the provider gives it. Never put marketing text in an OTP (it reclassifies the message and gets it filtered). INV-08 stays: SMS for verification codes only; voice for the same codes is a new channel and needs a founder decision (D1).
2. **A phone number is not a permanent identity.** Numbers die and are reassigned. Recovery needs routes that do not depend on the number: backup codes, a named recovery contact from the Care Circle, and a change-number flow that confirms the old number or an email.
3. **Per-profile PIN for shared phones**, not a one-device rule. A daily 4 to 6 digit PIN unlocks the session on that device; the OTP is for sign-in on a new device. A new device starts restricted for 24 hours (read plus log, no export or consent changes) and the old device is told in-app.
4. **Consent is evidence.** Every grant stores the exact text version, language, channel and time (a receipt the patient can view), optional purposes are off by default, withdrawal is enforced in the database, and sharing consent can carry an expiry and a recipient.
5. **The patient controls the proxy, and can see it.** A patient-visible log of proxy views, instant revocation, review points at 13 and 18, hand-over only with the young person's agreement, and a way to narrow access without alerting the proxy first.
6. **Discreet mode is real or it is removed.** Either every sender reads it, or the toggle is hidden.
7. **Record rules.** Every observation says who, how, where and on what device; corrections supersede; genotype and blood group carry a verified flag; ranges carry their source; the patient can see who viewed the record.
8. **No USSD until a sponsor and short code exist.** Spec row 1.7 is "Release 1 completion, only if the USSD short code is issued". The user pays per session, so a long menu is a cost to the poorest users. Plan a minimal sponsored flow (register and PIN only), built only on an issued short code.

## 4. Build plan

Each item is a stacked PR. Every session: check the live definition first, count rows before any structural change, write the proof with a sabotage step, register it in `ci.manifest`, run `/code-review high`, ship strings in en and pcm with native review flagged (OQ-19), PROPOSED values in `packages/shared/src/proposed-config`.

### Phase 0: switch on what is built (no new code unless noted)

| Item | Owner | Notes |
|---|---|---|
| P0-1 Termii sender ID and company documents | Founder | OQ-46. Everything in S03 and the proxy flow waits on it |
| P0-2 Dashboard settings: Send SMS hook, secrets, password minimum 8, OTP length 6, 60 second resend, confirm email and phone | Founder | OQ-44. Keep `SMS_PROVIDER` unset until P0-1 |
| P0-3 First real-device pass of sign-up, App Lock, phone recovery, proxy confirmation | Founder or tester | Nothing in S03/S04 has run on a phone |
| P0-4 Re-count `main-dev` vs live: S05 audited-read coverage (OQ-54) | Session | Close the remaining direct staff policies the progress log still lists |

### S03b: sign-in resilience (2 PRs)

- **S03b-a: delivery.** Voice-call fallback after timeout (adapter behind the same provider interface), delivery-status table fed by provider callbacks, channel switch in the UI ("send as a call"), OTP text lint (no marketing words). Proof: only the hook calls any provider (extend the INV-08 ratchet to voice).
- **S03b-b: accounts that survive a lost number.** Backup codes (shown once, hashed), recovery contact (Care Circle member, confirmed by that person), self-serve change-number flow, extra friction on recovery after a recent number change (closes OQ-43), eligibility-first cohort or sponsor code with claim after verification (closes OQ-41 and delivers 1.8 if absent).
- **S03b-c: shared phones.** Per-profile PIN for daily unlock, restricted state for a new device for 24 hours, in-app notice on the old device. Proof: restricted device cannot export, change consent or add a proxy.

### S04b: consent and family (3 PRs)

- **S04b-a: consent as evidence.** Seed optional purposes after wording approval (OQ-49), consent receipt view, database-level refusal to withdraw a required consent (OQ-53), optional expiry and recipient on sharing consents.
- **S04b-b: proxy and dependants.** Fix OQ-47 (no `manage` before the elder agrees), OQ-48 (the claim SMS is not a code), OQ-51 (categories to permissions), OQ-52 (no unverified account for an arbitrary number). Patient-visible proxy view log, instant revoke, narrow-without-notice, age 13 review prompt, age 18 hand-over with the young person's agreement (event `dependant.handover_due` 30 days before), mobile proxy flow.
- **S04b-c: privacy controls.** Self-serve export and deletion on the existing request tables (OQ-50; reconcile with `data_export_requests` and `data_deletion_requests`, do not add a third), quiet hours and `discreet_mode` read by every sender, audit that no health data leaves the device to a third-party SDK.

### S05b: record polish (2 PRs, small)

- **S05b-a: provenance and correction.** Recording method and device on observations where absent, one supersede-with-status rule across tables, `self_reported` vs `lab_verified` on genotype and blood group.
- **S05b-b: patient transparency.** "Who viewed my record" screen over `audit_log` (patient-scoped read, never the broad `audit_log_select`), range source on every lab value.
- Not here (owned by later sessions, do not duplicate): share link revocation and access log (S09), FHIR and Nigeria Core mapping (S44), biomarker trends (S46), vaccination record against the NPHCDA guide (S43).

### Parallelism and merge order

P0 first, in parallel with S04b-a (no dependency on SMS). S03b-a before S03b-b before S03b-c. S04b-b waits on P0-1 for any real code send but can be built and tested with the mock. S05b is independent.

## 5. To sign or approve

| Item | Signer |
|---|---|
| Optional consent purpose wording, en and pcm (OQ-49) | Founder plus counsel, native Pidgin reviewer |
| Consent receipt wording and retention period | Counsel (NDPA, GAID) |
| Age review points (13, 18) and what a teen can hide from a proxy | CMO and counsel |
| Rules for restricted new-device state | Founder |

## 6. Decisions needed from the founder

| # | Decision | Recommendation |
|---|---|---|
| D1 | Allow voice-call OTP as a second channel, as an explicit exception beside SMS (INV-08, OQ-05) | Yes; the same code, same purpose, only for delivery failure |
| D2 | Per-profile PIN as the daily unlock | Yes |
| D3 | Recovery contact is a Care Circle member | Yes |
| D4 | USSD: wait for a short code and a sponsor | Defer; record as "not before a sponsor pays the session cost" |
| D5 | Patient may narrow or revoke a proxy without telling the proxy first | Yes, with a logged reason optional |
| D6 | Genotype/blood group verified flag shown to clinicians | Yes |

## 7. Risk register

| Risk | Mitigation |
|---|---|
| OTP "sent" but never delivered, silent DND filtering | Delivery status, voice fallback, plain-language "didn't get a code" screen |
| Shared-phone PIN weaker than OTP | Rate limit, slow-down not lock-out, restricted new device |
| Proxy misuse or coercive control | Patient-visible log, instant revoke, protected categories stay gated |
| Duplicating existing export/deletion tables | Reconcile first (CLAUDE.md migration-drift lessons) |
| Hand-typed migration timestamps colliding | Use real timestamps; check `list_migrations` on live first |
| Competitor claims wrong or stale | Every claim re-verified in each session's Step 2; UNVERIFIED cells stay unverified |
| Counsel not yet consulted on child consent age | Gate S04b-b age work on counsel's answer |

## 8. Sources

From the three research passes (URLs are in the session scratchpad notes and must be re-checked): MyChart proxy and adolescent documentation; NHS proxy access and Gillick guidance; India ABDM Consent Manager; Flo Health FTC order and the 2025 Meta verdict; Apple and Google family-sharing documentation; Health Connect and FHIR resources (Observation status, Provenance); International Patient Summary; SMART Health Links; Withings HealthLink; Nigeria Core and NPHCDA FHIR guides; CBN device-binding circular (12 March 2026); NCC and CBN telecom identity risk system (April 2026); NDPA 2023 and NDPC GAID 2025 summaries; M-TIBA registration; Omada eligibility flow; Twilio and Nigerian SMS guidance on DND. Primary NDPA and GAID text was not read.

## 9. Decisions recorded 2026-10-07 (founder/CMO, selected in chat)

Four packages were presented with full detail and guideline grounds, and each recommended option was selected. This is a recorded decision, not a system sign-off: no governed config row exists yet for any of these, so nothing was written to a signing RPC. When each session builds its config row, it shows the exact text again and the CMO signs it in the sign-off hub.

| # | Package | Decision | Sign-off text approved in chat |
|---|---|---|---|
| A | Sign-in (S03b) | Voice OTP fallback, per-profile PIN, 24h restricted new device, backup codes, Care Circle recovery contact | "I approve voice OTP as a delivery fallback for verification codes only, per-profile PIN daily unlock, restricted new-device state, and backup-code plus recovery-contact recovery." |
| B | Proxy (S04b-b) | Review at 13, agreement-gated hand-over at 18, protected categories withheld from proxies, patient-controlled narrowing and revocation, proxy view log | "I approve the review at 13, agreement-gated hand-over at 18, protected-category withholding from proxies, and patient-controlled proxy narrowing and revocation." |
| C | Record (S05b) | Supersede-not-edit corrections, genotype/blood group verified flag, range-source labels, patient access log, provenance | "I approve supersede-not-edit corrections, the genotype/blood-group verification flag, range-source labelling, and patient access-log visibility." |
| D | Consent (S04b-a/c) | Consent receipts, DB-enforced withdrawal rule, optional purposes off by default, self-serve export/deletion, discreet mode and quiet hours, SDK audit. USSD deferred | "I approve the consent-receipt, withdrawal, export/deletion and discreet-mode package; USSD is deferred until a sponsor pays the session cost." |

Still open before code: counsel's reading of NDPA 2023 and GAID 2025 on the child age and any healthcare exception (gates the age-13 rule in B); consent wording and a native Pidgin reviewer (OQ-49, OQ-19); Termii sender ID and hosted settings (P0-1, P0-2). Voice OTP is a carve-out beside INV-08/OQ-05 and should be logged in `docs/DECISIONS.md` and `docs/OPEN-QUESTIONS.md` when S03b-a starts.

## 10. Amendments, founder decisions 2026-10-13 (override sections 3 to 9 where they differ)

| # | Decision | Effect on the plan |
|---|---|---|
| R1 | Registration is for adults (18 and over) only. No under-18 can register. | There are no teen accounts, so the "review at 13" rule and any teen self-access in package B are dropped. Sign-up must check date of birth and refuse under 18 with a calm message. |
| R2 | An adult may add their children as dependants under their own account, for immunisation tracking and preventive health tracking only. | Dependant profiles under 18 are scoped to the vaccination record and preventive tracking (growth, screening reminders). No consultations, prescriptions, messages, lab orders or protected categories (reproductive, mental health, HIV or STI) for an under-18 dependant. The guardian is the consenting party and the only viewer. |
| R3 | At 18 a dependant does not carry over silently. | The existing hand-over rule stands: the young person registers their own account and agrees before any record is handed over (event `dependant.handover_due` 30 days before the 18th birthday). The record stays with the guardian's account until they do. |
| R4 | English only. All Pidgin (pcm) is removed from the platform. | OQ-19 (native Pidgin reviewer) is closed as moot. Optional consent wording needs only the founder's approval, plus counsel's reading for legal sufficiency. The `pcm` strings in `@tarragon/i18n` and the language chooser are removed by the English-only removal work (check the state of PR 984 and main-dev first; do not duplicate). |

Counsel gate, reduced: with no teen accounts the open legal question narrows to (a) whether a guardian's consent is enough for a child's immunisation and preventive data under NDPA 2023 and GAID 2025, and (b) the retention and handover rule at 18. Primary text still has not been read; counsel confirms before S04b-b is signed.

Plan changes:
- S04b-b loses the age-13 review and the teen-confidentiality rules; gains a sign-up age check (18+), a dependant scope limit enforced in the database (an under-18 dependant can only hold immunisation and preventive-tracking rows), and removal of any existing path that lets a dependant under 18 reach clinical features.
- Existing under-18 dependants and any under-18 account already on the platform must be counted first (live), with the count recorded in the migration header.
- Package B's sign-off text is replaced by: "I approve adult-only registration, dependants under 18 limited to immunisation and preventive tracking under the guardian's consent, and agreement-gated hand-over at 18."
- Packages A, C and D are unchanged, except consent strings are English only.

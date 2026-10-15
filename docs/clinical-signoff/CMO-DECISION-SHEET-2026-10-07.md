# CMO decision sheet, 2026-10-07 (items still waiting on the Chief Medical Officer)

Prepared for the CMO to select from and sign in chat (the founder is the CMO; see the signing method in the project memory). Nothing here is signed. Every item lists what is pending, the evidence it rests on (international and Nigerian), the options, a recommendation, and exactly what happens on selection. Items already confirmed earlier today (the 34 registry values, triage rule set bp_care_triage v3, AI releases already approved) are not repeated.

**How grounded is this?** Sources were looked up on 2026-10-07. Where a figure is a norm from another health system (NHS, HIPAA) it is labelled as a reference, not as Nigerian law. Where no Nigerian statutory figure was found, this sheet says so instead of inventing one. Counsel still has to confirm retention and privacy figures before anything is treated as a legal position.


## OUTCOME (selected and executed by the CMO in chat, 2026-10-07)
| # | Item | Decision | Executed |
|---|------|----------|----------|
| 1 | Escalation SLA v9 (symptom_triage) | Sign as drafted | **Signed** (`sign_escalation_slas`, v9 active, signed by Kola Longe; 25 entries; urgent resolves push, email; review resolves batched push) |
| 2 | Record-access rules (`security.rules` v2) | Confirm as proposed | **Confirmed** in `proposed_config_signoffs` (value hash 9a3a3f6a...9129) |
| 3 | Retention periods (OQ-263) | NHS-aligned schedule, PROPOSED, counsel to confirm | **Confirmed** with item 2 (same registry value); no automatic deletion of real data |
| 4 | Controlled medicines at the counter (OQ-276) | Add counter check; approved repeats via the existing path | Decision recorded. **Build task queued** (not yet built) |
| 5 | Critical result contact time | Keep 12 hours | No change |
| 6 | Triage grade reviews (OQ-255, OQ-257) | Switch on | Already ON (switched on earlier today with the CMO approval note); decision recorded |
| 7 | Speak-up wording (OQ-246, OQ-216) | Approve as written | Recorded. Screens stay closed until the CMO names backup readers (OQ-158) |
| 8 | Access-log depth (OQ-261, OQ-282) | Opening-level log plus weekly review | Recorded; pgaudit not adopted |
| 9 | AI-017 wording and pass mark (OQ-250, OQ-214) | Correct the wording; approve after evaluations | AI-017 **v1 was an unapproved draft** (the open question wrongly called it approved), so its wording was corrected in place; approval stays blocked on the two evaluation suites |
| 10 | Directory re-verification (clinical partners) | At each licence expiry, never more than 12 months | Recorded as the CMO's input; the founder still owns partner terms |

## Already settled (documentation only, nothing to decide)
OQ-122, OQ-225, OQ-226, OQ-227 (reliability and queue values), OQ-274 (risk tiers) and OQ-275 (monthly report) are answered by registry values the CMO confirmed today (`reliability.dashboard`, `queue.*`, `risk.stratification`, `reports.monthly`). OQ-230, OQ-232, OQ-233, OQ-234 were decided by the founder today. Their headers still read "open" and should be tidied.

---

## 1. Escalation SLA v9: symptom-triage pathway (signable now)
**What is pending.** `escalation_slas` v9, drafted 2026-10-07, is v8 (signed 2026-09-05) plus two entries for the symptom checker: `symptom_triage` / `urgent_escalation` = **60 minutes** (push, then email) and `symptom_triage` / `clinician_review` = **1,440 minutes (24 h)** (batched push). Until it is signed, an urgent symptom-checker assessment cannot be recorded. Signing replaces the whole active config; v9 carries every v8 entry unchanged (pulse, SpO2, temperature, BP, emergency, screening), so nothing is dropped.
**Evidence.**
- Manchester Triage System (international reference): "urgent" target 60 minutes to first assessment; very urgent 10; standard 120; non-urgent 240.
- NHS 111 / NHS Pathways clinical call-back bands: 20 min, 1 h, 2 h, 6 h, 12 h, 24 h, set by acuity.
- Nigeria: no national triage-response standard was found; MDCN telemedicine and ethics rules do not set a minute figure.
**Housekeeping.** v9 still lists old `whatsapp` names in several channel sequences. They are harmless: the escalation function normalises them (`private.normalize_escalation_channels`) onto the live ladder push, email, SMS. A future version should tidy the labels.
**Options.** (a) Sign v9 as drafted (recommended). (b) Sign but tighten the urgent entry to 30 minutes. (c) Do not sign yet.
**Recommendation.** (a). 60 minutes matches the urgent band in both systems and the hop time (30 minutes per channel) is already conservative.
**On selection.** (a)/(b): the signing RPC `sign_escalation_slas` is run in your name, with the exact version shown back to you. (b) creates a v10 draft first and shows it before signing.

## 2. Contact time for a critical screening result (optional review, nothing pending)
**Current state.** Active v8 = **720 minutes (12 h)** for a critical result and 1,440 minutes (24 h) for an abnormal non-critical result (founder decision 2026-09-04, previously 120 minutes).
**Evidence.** RCPath has long used a key performance indicator of 85% of critical results delivered to emergency departments within 1 hour (2012 guidelines; the college published updated recommendations in 2026). ISO 15189 requires a laboratory to report critical results to clinicians within a defined time. These describe laboratories and hospital settings; Tarragon's results come from self-arranged labs and arrive by upload, so the comparison is imperfect. No Nigerian figure was found.
**Options.** (a) Keep 12 h. (b) Tighten critical results to 4 h. (c) Tighten to 1 h with a phone call from the clinician.
**Recommendation.** Your clinical judgement. If critical results are only ever seen after upload by a patient, (b) is a defensible middle; (c) only if a clinician is reachable 24 hours.
**On selection.** (a) nothing. (b)/(c) become a v10 draft that you then sign.

## 3. Record-access rules (`security.rules` v2, the one CMO-owned value still unsigned)
**Values.** An untied clinician may open a patient record without typing a reason, every opening is logged and cannot be edited; the grant window is **8 hours**; an alert opens after **20 untied openings in an hour**; **50 failed lookups an hour** alerts; after-hours means **22:00 to 06:00 Lagos**; reproductive health, care coordinators and other organisations are never reachable by this path.
**Evidence.** HIPAA Security Rule: audit controls (45 CFR 164.312(b)) and information-system activity review (164.308(a)(1)(ii)(D)) are required; practitioner guidance reads high-risk events as near-real-time alerts and summary reviews weekly. NHS: access rests on a legitimate relationship, with every access auditable. Nigeria Data Protection Act 2023 requires security and accountability measures; no figure for an access window is set.
**Options.** (a) Confirm as proposed (recommended). (b) Shorten the window to 4 hours. (c) Raise the alert to 10 openings an hour.
**Recommendation.** (a). The window is a usability choice (a full clinic shift); the controls that matter are the immutable log, the alert and the weekly review.

## 4. Retention periods (OQ-263: today every clinical period is empty)
**Proposed schedule (in `security.rules` v2).** Adult clinical record 8 years after last contact; child record until age 25 (26 if seen at 17); maternity 25 years; mental health 20 years after last contact; access log 8 years; consent 6 years after the relationship ends; payments ledger 6 years; operational data 90 days to 2 years; **no automatic deletion of real patient data**.
**Evidence.** NHS Records Management Code of Practice (2021, updated 2023): adults 8 years from last seen; children until 25th birthday (26th if 17 at the end of treatment); maternity 25 years; mental health 20 years after treatment ends or 10 years after death. HIPAA documentation (including audit-control records) must be kept 6 years (45 CFR 164.316(b)(2)). Nigeria Data Protection Act 2023, s.24(1)(d): keep personal data no longer than the purpose needs; no statutory clinical-record period was found in the NDPA or the 2025 GAID. The older NDPR framework's 3-years-after-last-use default is not suitable for clinical records.
**Options.** (a) Adopt the NHS-aligned schedule as PROPOSED, counsel to confirm (recommended). (b) Use one 6-year HIPAA-style period for everything. (c) Leave periods empty (keep everything) until counsel advises.
**Recommendation.** (a). It is the most protective documented schedule and matches your 2026-10-07 direction. Because auto-deletion stays off, an error is reversible.

## 5. Controlled medicines at the pharmacy counter (OQ-276)
**State.** Signing already refuses controlled medicines; the pharmacy counter has no second check, and a repeat after a full supply goes through the older QR and phone-desk path.
**Evidence.** NAFDAC Controlled Medicines Regulations 2019 govern dispensing and documentation in Nigeria; tramadol has been under national control since 2013 and codeine cough syrup without prescription is banned. UK reference: Schedule 2 and 3 prescriptions cannot be repeat-dispensed (only Schedule 4 and 5 can), are valid 28 days, and 30 days' supply is the recommended maximum. Tarragon's own position (2026-10-01): it does not prescribe controlled medicines.
**Options.** (a) Add a counter check against the controlled list and let approved repeats go through the existing path (recommended). (b) Leave as is. (c) Refuse any controlled medicine on the collection list and at the counter outright.
**Recommendation.** (a) now, with (c) as the policy statement: defence in depth for a rule you already hold.

## 6. Switching on triage grade reviews (OQ-255 and OQ-257)
**State.** An optional clinician step ("was the grade right, too low, too high") exists, OFF until you approve. It measures agreement with the automatic grade, not diagnostic accuracy; shows no patient identity; small groups are withheld; draft rule sets and test accounts are excluded.
**Evidence.** Triage systems are routinely audited for under- and over-triage; trauma triage is the best-known benchmark (under-triage under about 5%, over-triage in the 25 to 50% range is accepted there). That benchmark is from trauma systems and is a reference for how audits are read, not a Tarragon target.
**Options.** (a) Switch on now with a written approval note (recommended). (b) Switch on after 100 graded tasks exist. (c) Keep off.
**Recommendation.** (a). The step is optional, adds no patient exposure, and you cannot see whether the rules over- or under-grade without it.

## 7. Speak-up concern screens: wording (OQ-246, OQ-216)
**State.** Screens exist; concerns are readable only by the person raising them, the CMO and named backup readers, never operations. All `concern.*` and `speakup.*` text is PROPOSED and must be read before go-live. Key lines include: "Concerns raised by clinicians are private. Only you and any backup readers you have named can read them", "Backup readers can also read this (it was overdue)" and "A review has been opened with operations. Operations are told only that a review exists."
**Evidence.** Freedom to Speak Up (Francis, 2015) and the National Guardian's Office guidance set minimum standards (confidential route, timely acknowledgement and reply, no detriment). ISO 37002:2021 (whistleblowing management) and EU Directive 2019/1937 are international references. Nigeria: no comprehensive whistleblower statute for private health providers was verified; counsel should confirm.
**Options.** (a) Approve the wording as written (recommended, subject to your read of the lines above). (b) Approve with edits you give me. (c) Hold until backup readers are named.
**Note.** Naming the backup readers (OQ-158) is a separate step that only you can do.

## 8. Break-glass and access-log depth (OQ-261, OQ-282)
**State.** The new record-opening path (item 3) replaces typing a reason: one immutable row per opening (who, which patient, when, tied or open, after hours) and a weekly CMO review report. It does not log each table read inside the window.
**Evidence.** HIPAA activity review and the NHS legitimate-relationship model both work from access-level audit with periodic review; per-query logging (pgaudit) is a heavier option used where regulators demand it.
**Options.** (a) Keep opening-level logging plus the weekly review (recommended). (b) Add database request logging shipped to a log store.
**Recommendation.** (a) for launch; revisit (b) if counsel or an NDPC audit asks for query-level detail.

## 9. AI-017 scribe: wording of version v2, and the language-release pass mark (OQ-250, OQ-214)
**State.** The approved v1 record still says "Nigerian English or Nigerian Pidgin". Pidgin was removed on 2026-10-06. The release is blocked until two evaluation suites have been run; nothing here can be signed today.
**Suggested v2 wording.** "Consultations between a Tarragon clinician and a consenting adult patient, in Nigerian English, with a transcript good enough to read."
**Evidence.** NHS England guidance on AI-enabled ambient scribing (April 2025, summarised for LMCs) requires a supplier safety case (DCB0129), a deployment safety case signed by a Clinical Safety Officer (DCB0160), a medical-device determination (summarising tools are treated as at least MHRA Class I) and clinician verification of every note. WHO guidance on large multi-modal models (January 2024) calls for human oversight, transparency and accountability. No authoritative numeric word-error-rate standard exists; the guidance asks for a safety case, not a figure.
**Options.** (a) Register v2 as a draft now; approve it after the evaluations pass (recommended). (b) Leave v1. (c) Withdraw AI-017 until the speech vendor is chosen.
**Pass mark (OQ-214, proposal for you).** Zero tolerance for dropped negations and for protected terms, plus a ceiling on overall word error that you set after seeing the first measured results; every note stays clinician-verified.

## 9b. Directory re-verification cadence for clinical partners (OQ-214 directory, shared with the founder)
**Evidence.** The Medical and Dental Council of Nigeria issues practising licences annually (valid 12 months from 1 January, renewable through the year); practising without one is an offence. No competitor was found publishing a re-verification schedule.
**Options.** (a) Re-verify at each licence expiry, never more than 12 months apart (recommended). (b) A flat 12 months for every partner, 6 months for pharmacies. (c) Risk-tiered by volume.

---

## Sources (looked up 2026-10-07)
- NHS Records Management Code of Practice 2021: https://themdu.com/guidance-and-advice/latest-updates-and-advice/updated-guidance-on-medical-records-management-and-retention and https://www.csp.org.uk/system/files/retention_of_health_records_summary.pdf
- Nigeria Data Protection Act 2023 (s.24 storage limitation): https://www.mondaq.com/nigeria/data-protection/1375916/record-retention-compliance-for-business-organisations and https://assets.kpmg.com/content/dam/kpmg/ng/pdf/the-nigeria-data-protection-act-2023.pdf
- Manchester Triage System target times: https://metricgate.com/docs/manchester-triage-priority/
- NHS 111 call-back bands: https://democracy.eastsussex.gov.uk/documents/s39834/Minutes%20of%20Previous%20Meeting.pdf and https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-use-111/how-nhs-111-online-works/
- RCPath critical results: https://www.rcpath.org/asset/BB86B370-1545-4C5A-B5826A2C431934F5/
- NHS England ambient scribing guidance (summary): https://www.ashfords.co.uk/insights/articles/ai-enabled-ambient-scribing-in-the-nhs-benefits-risks-and-regulatory-considerations
- WHO LMM guidance: https://www.who.int/news/item/18-01-2024-who-releases-ai-ethics-and-governance-guidance-for-large-multi-modal-models
- HIPAA audit controls and documentation retention: https://uit.stanford.edu/security/hipaa/audit-controls-policy and https://petronellatech.com/compliance/hipaa-audit-controls/
- UK controlled drug prescription rules: https://archive.psnc.org.uk/dispensing-supply/dispensing-controlled-drugs/controlled-drug-prescription-forms-validity
- NAFDAC Controlled Medicines Regulations 2019 and Nigerian controls: https://guardian.ng/features/health/nafdac-outlines-measures-to-control-illicit-drugs-in-nigeria/
- Freedom to Speak Up review: https://www.gov.uk/government/groups/whistleblowing-in-the-nhs-independent-review and https://www.england.nhs.uk/wp-content/uploads/2019/09/BM1832_Freedom_to_Speak_Up_Guardians_report.pdf
- MDCN annual practising licence: https://mdcn.gov.ng/page/recent-news/increase-in-annual-practising-licence-fee

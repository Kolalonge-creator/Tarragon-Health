# S35 to S40 CMO decisions, 2026-10-07

Companion to `docs/plans/S35-S40-competitor-gap-and-build-plan.md`. Sixteen decisions were put to the CMO as selectable prompts in a Claude Code chat session on 2026-10-07, in four rounds. Each shows the question, the option chosen, the guideline basis shown at the time, and what it changes.

## Status of this record (read first)
- These are the CMO's **selections made in chat**. They are decision records, not entries in the platform sign-off hub. Any value that lives in the PROPOSED registry (`packages/shared/src/proposed-config/registry.ts`) still needs the owner's **confirm click** at `/clinician/go-live`, and a registry change is a code change that creates a new version. No signing RPC was executed, and no registry value, rule set, protocol or guard was changed by this record.
- Guideline references were written from the assistant's knowledge and **not re-fetched** in this session. Clause numbers, Nigerian licence cadences (MDCN, PCN, MLSCN), NDPA section numbers and Nigerian programme figures must be verified before anyone relies on them. Where no guideline gives a number (silent days, word error rate, minimum group sizes) the value is a PROPOSED judgement, not a citation.
- Nothing here is legal advice. Items touching privacy matching (Q12) wait for counsel.
- Pidgin and other languages are out of scope (English only, D-14).

## Round 1: release governance and the AI scribe

| # | Question | Decision | Basis (as shown) | Builds / records |
|---|---|---|---|---|
| Q1 (OQ-183, D7) | Who signs before a clinical go-live guard opens | **Two signers for the three clinical guards** (`clinical_operations_enabled`, `prescribing_enabled`, `scribe_enabled`): CMO attests, an independent retained clinician (separate identity) countersigns. Admin guards keep one signer. Switch-off stays instant with a note within 24 hours | NHS DCB0129/0160 clinical safety officer; ISO 14971:2019 independence of review; WHO AI ethics guidance 2021 | S37c-3. Needs a named external clinician (founder to appoint) |
| Q2 (D8) | Rollout with no staging environment | **Allow-list of about 10 patients for 14 days, stop criteria checked, then all eligible.** Stop criteria (PROPOSED): any unresolved red-event miss or paging failure; any patient-safety incident linked to the feature; scribe: any signed note with an unsupported medicine or dose | WHO HEARTS phased implementation; DCB0160 deployment safety case; FDA PCCP (Dec 2024); CrowdStrike lesson | S37c-3. Registry `guards.rollout` (PROPOSED, CMO) |
| Q3 (OQ-213) | May the scribe facts step list medicines mentioned | **Yes, display-only.** Never stored, never in the note, never with a dose. Note text stays "Medication plan discussed with the clinician". AI-017 stays OFF; prompts remain unapproved until its evaluation suites run | NHS England ambient scribe guidance 2025; JMIR 2026 pilot on omission rates; WHO AI ethics | None. OQ-213 closed |
| Q4 (OQ-214) | Speech-to-text pass mark | **Zero tolerance for dropped negations and protected terms, and a word error rate of at most 10 percent on at least 30 consented Nigerian English consultations**; typed notes remain the default until met. 10 percent and n=30 are PROPOSED values, not citations | No numeric guideline exists; NHS England guidance requires local accuracy testing | Registry `scribe.wer_pass_mark` (PROPOSED, CMO) |

## Round 2: outcomes and triage thresholds

| # | Question | Decision | Basis | Builds / records |
|---|---|---|---|---|
| Q5 (D9) | HEARTS vocabulary | **Add alongside S38 indicators** on clinician and NGO views: registered, under care, lost to follow-up (12 months), missed visit (3 months), controlled (BP under 140/90 within 3 months), visited with no BP taken. Sponsor views keep minimum group 11 | WHO HEARTS package and M&E indicators; Resolve to Save Lives Simple definitions | S38h-1. Registry `outcomes.indicator_set` |
| Q6 (OQ-230, OQ-232) | Meaning of "controlled" and minimum readings | **Show both views, and require a NICE-style home protocol before the label "controlled"** (at least 4 days, ideally 7, two readings morning and evening, about 8 readings); below that say "not enough readings". **Open sub-decision:** whether home averages use 135/85 (NICE home threshold) or stay at 140/90. Unresolved here; the CMO must choose before the rule set is written | NICE NG136; ESH 2023; ISH 2020; WHO 2021; AHA/ACC 2025 | `outcomes.snapshot_rules` v3 (new snapshots only; snapshots are append-only). Expect lower reported control until patients log more |
| Q7 (OQ-273) | Silence line | **7 days.** Safety case 7 text and fixture updated to 7. `bp_care_triage` v2 goes to the CMO for signature after parity tests | No guideline sets this; chosen to match the 7-day averaging window | v2 rule set (not signed here) |
| Q8 (OQ-255, OQ-257) | Triage grade review step | **Approve a 90-day pilot**, CMO reviews the agreement report monthly, small groups withheld, written approval note recorded with the switch. The switch `triage_agreement_capture` is turned on only after the CMO confirms in the admin page | Manchester Triage System audit practice; DCB0129/0160 post-deployment monitoring; WHO AI ethics | Switch stays OFF until confirmed |

## Round 3: workforce and access governance

| # | Question | Decision | Basis | Builds / records |
|---|---|---|---|---|
| Q9 (D6) | Keeping MDCN licences current | **Reminders at 60, 30 and 7 days, plus a quarterly register re-check** by a named person; expired licence still removes from queue overnight. Ask MDCN about bulk lookup (no public API known). Record DataFlow/ECFMG as evidence types | MDCN annual practising licence (verify); GMC/NMC/NCQA monitoring comparators; ICFJ report on fake practitioners | S36l-1. Registry `credentialing.recheck_cadence_days` = 90 (PROPOSED; founder, counsel, CMO) |
| Q10 (OQ-225 to OQ-227, D13) | Reliability dashboard | **Confirm as built:** rota gap 7 days ahead; ops sees a distribution only for 5 or more clinicians; three neutral bands (85 and above, 70 to 84, under 70); only the CMO sees named scores, ordered by name never by score. Older result-contact clock may be added later (OQ-226 option b). Founder and CMO are the same person today | Just Culture (NHS England 2018); aggregate oversight, individual supervision | Registry `reliability.dashboard` confirm click. No build |
| Q11 (OQ-221) | Grant expiry | **No change to `has_permission` now; add a quarterly access review** of every standing grant. Revisit expiry when a second admin exists | ISO/IEC 27001:2022 A.5.18, A.8.2; NHS DSPT periodic review | Scheduled review task and report |
| Q12 (D12) | Restricted-record tier | **Yes:** staff-as-patient and flagged records require an extra typed reason and alert the CMO and DPO, worked as a case (open, justified, escalated, closed). **Does not build until counsel answers**, because matching on surname or address is itself processing. Reproductive-health keeps its no-break-glass rule | NDPA 2023 sensitive data (verify sections); Caldicott Principles 2020; NHS SCR alert workflow; documented insider-access failures | S39i-1/2. OQ-261, OQ-280 updated |

## Round 4: content, hazards, bias, partners

| # | Question | Decision | Basis | Builds / records |
|---|---|---|---|---|
| Q13 | Content review cadence | **12 months for safety-critical content (triage, emergency, medicine), 24 months for general**, and immediately when a source guideline changes. Author cannot be reviewer. Every release carries a dated added/removed/changed list | PIF TICK (max 3 years); Infermedica/Ada practice; NICE/WHO surveillance; DCB0129 change control | S36l-5. Registry `content.review_cadence` |
| Q14 | Hazard residual-risk acceptance | **CMO accepts low and medium; high needs the second signer; unacceptable blocks the guard.** The matrix is a versioned PROPOSED config. Seed hazards are written by the CMO, not an agent | ISO 14971:2019; DCB0129 hazard log; IEC 62304 traceability | S37c-1. Registry `hazards.acceptability` |
| Q15 (OQ-277) | Bias audit of risk scores | **Quarterly audit by sex, age band and region, reported to the CMO, never auto-adjusted**; changes only through a new signed version; small groups withheld | Obermeyer 2019; WHO AI ethics (equity); MHRA/NHS AI Lab subgroup reporting | S38h-4. Registry `risk.audit_cadence` = quarterly |
| Q16 (OQ-235, OQ-236) | Clinical partner re-verification | **Every 12 months, staff-visible overdue flag only**; a person decides any pause; no automatic hiding. Non-clinical partners remain the founder's call | PCN, MLSCN, MDCN licence cycles (verify each); NCQA/Joint Commission comparators | Registry `directory.verification_cadence` confirm click |

## Still open after this record
1. **Q6 sub-decision:** home average threshold 135/85 versus 140/90.
2. **Appoint the independent clinician** (Q1) and agree a retainer. Until then clinical guards stay OFF.
3. **Registry confirm clicks** for each PROPOSED key named above, in the sign-off hub.
4. **Counsel:** Q12 matching rules, D3 transcript retention, D10 patient-visible access log, D11 NDPC level.
5. **Founder decisions not asked here (not clinical):** D1 gate stance, D2 backups, D5 Paystack OTP, D6 MDCN register access owner, D3 and D4 retention and number masking.
6. **Verification of guideline references** listed in the status section above.

## Signature
Decisions made by the CMO in chat on 2026-10-07 (rounds 1 to 4, sixteen questions, recommended option selected on every question). This block is a record of that selection. It is not a registry confirmation and does not replace the CMO's own review and sign-off steps in the platform.

CMO name and MDCN number: ______________________  Date: ______________

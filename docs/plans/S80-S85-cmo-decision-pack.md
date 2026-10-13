# S80 to S85 decision pack for CMO sign-off

Status: **UNSIGNED DRAFT.** Selections below were made in chat on 2026-10-07. They are not signed. Signature is a human act in `/clinician/clinical-signoff` (or the signed decisions log `docs/DECISIONS.md`); an agent does not sign. Guideline references are pointers to be checked against the source text before signing. Values are PROPOSED config until signed.

| # | Decision | Selected | Guideline basis (verify clauses) | Follow-up |
|---|---|---|---|---|
| 1 | OQ-D Clinical Safety Officer | CMO is CSO, DCB0129 style: hazard log, clinical safety case, release sign-off | UK DCB0129/DCB0160; ISO 14971; IEC 82304-1; WHO Global Strategy on Digital Health | Name a deputy CSO before scale; check CSO training/registration requirement |
| 2 | OQ-F Launch posture | Emergency guidance and find-care only. No symptom urgency grading, no possible causes, no AI in path. Full symptom checker stays off behind its go-live guard. Selected as the safest launchable option; **not a guarantee of being outside regulation** | IMDRF SaMD N12; EU MDR Rule 11, MDCG 2019-11; WHO 2019 digital health guideline; NAFDAC medical device rules (confirm) | Request NAFDAC written position; counsel opinion; keep BP threshold grading inside the care programme, not a public tool; review `symptom_triage` public entry points against this posture |
| 3 | OQ-A Language gate | English signed-wording gate plus dormant translation-state gate | WHO health information accuracy; NICE DTAC; ISO 17100 bilingual review principle | D-14 unchanged; Pidgin stays removed |
| 4 | OQ-B Research scope | Schema, `research_eligible()` consent function and privacy copy now; export dark behind an ethics-approval guard | Declaration of Helsinki 2013; CIOMS 2016; ISO 25237; NDPA 2023; NHREC National Code (confirm edition); NDPC GAID 2025 (research provisions not yet read) | Counsel: cross-border transfer basis, research provisions |
| 5 | 25.1 Review cadence | 24 months standard, 12 months for emergency, medicine-safety, pregnancy and mental-health content; early start 2 months; immediate review on new guideline edition | Publisher practice; NHS Information Standard style; WHO/NICE surveillance; Nigeria Standard Treatment Guidelines (confirm edition) | Overdue content auto-withdrawn |
| 6 | 25.10 AI monitoring | 5 percent stratified clinician sample per system per month; 100 percent of reported answers and red-flag-adjacent turns; monthly accuracy audit by age, sex, region (suppress under 20) | WHO AI for health 2021 and LMM 2024 guidance; NIST AI RMF; TRIPOD+AI, STARD, DECIDE-AI; CHAI; NDPA automated decisions | Cost roll-up in kobo; audit populates when checker goes live |
| 7 | OQ-C S39 stack | Merge first, then S80 to S85 | NDPA 2023; ISO 27001/27799; INV-10, INV-12 | Required CI green, apply migrations before merge; counsel on erasure versus National Health Act 2014 record duties |

## Not yet decided (defaults proposed, not applied)

- **OQ-E voice input:** default is defer (dropped in S47-1); revisit after S82 audit.
- **Pidgin audio and 'What is this?' coverage:** S82 reports gaps; audio recording and signing needs a human reader and clinical check.
- **GAID 2025 deadlines and registration tier:** not retrieved; counsel.

## Signature

CMO name: ______________  MDCN no.: ______________  Date: ______________

I have read the selections above, checked the cited guidelines against their source text, and approve decisions: [ ] 1 [ ] 2 [ ] 3 [ ] 4 [ ] 5 [ ] 6 [ ] 7

Signature: ______________ (signed in the sign-off screen, not by an agent)

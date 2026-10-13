# S66 to S70 CMO and founder sign-off pack

Recorded 2026-10-07 from selections made in chat by the founder acting as CMO. **Status: selections recorded, NOT signed.** No protocol, rule set or threshold is live. The binding signature is made in the sign-off hub (`/clinician/clinical-signoff`) by the CMO, never by an agent. Until then every value below is PROPOSED config (`packages/shared/src/proposed-config`) and `maternal_enabled` and the device guards stay off.
Guideline citations marked [verify] come from memory or search summaries and must be checked against the source document before signing. Context: `docs/design/S66-S70-build-plan.md`.

## A. Clinical items for CMO signature

| # | Item | Selected | Applies to |
|---|---|---|---|
| A1 | Pregnancy BP thresholds | Any BP at or above 140/90 in pregnancy: amber, clinician same day. Either value at or above 160/110: RED, page on-call. 140/90 or higher plus any danger-sign symptom: RED. Basis: ACOG PB 222, WHO pre-eclampsia recommendations, NICE NG133 [verify]. Matches `bp-care-v1` BP-P1/P3/P4, so no code change to sign. | S67 |
| A2 | Danger-sign group | Severe headache, visual disturbance, epigastric or right-upper-quadrant pain, breathlessness, plus convulsion or loss of consciousness (immediate emergency, no BP needed) and sudden swelling of face or hands. Reduced fetal movement and vaginal bleeding are separate always-urgent signs. | S67 |
| A3 | Fetal movement | Awareness of the baby's normal pattern from about week 28, optional counter. If normal is not reached, 10 movements are not felt in 2 hours, or there is a clear drop: fixed card to contact the care team or go to a facility today. Basis: RCOG Green-top 57, ACOG and Count the Kicks style guidance [verify]. | S67 |
| A4 | Contraction timer | 5-1-1 default. 7-1-1 or earlier for a later birth, a previous fast labour or a long journey (set in the birth plan). Go immediately, no timer: waters break, vaginal bleeding, reduced fetal movement, fits, severe headache, any contractions before 37 weeks. | S67 |
| A5 | Antenatal schedule | WHO 2016 eight contacts: within 12 weeks, then 20, 26, 30, 34, 36, 38, 40. Versioned config so the national schedule can replace it. Reminders generic. Earlier visit when a risk flag or amber BP exists, decided by the care team. Confirm the current Federal Ministry of Health position [verify]. | S67 |
| A6 | EPDS | 10 to 12: possible depression, review within the week. 13 or more: probable, clinician review within 48 hours. Any non-zero item 10: immediate crisis path regardless of total. Provisional; local audit after the first 200 screens, then adjust. Basis: Cox validation, NICE CG192, Nigerian studies show 7 to 12 [verify]. Never worded as a diagnosis. | S68 |
| A7 | Child growth | WHO 2006 standards (0 to 5), WHO 2007 reference (5 to 19). Severe acute malnutrition (MUAC under 115 mm, or weight-for-height z below -3, or bilateral oedema): RED, same-day referral. Moderate (MUAC 115 to under 125 mm or z -3 to under -2): amber, review within 3 days. Stunting and underweight: informational and counselling. Versioned reference, golden-tested against the WHO `anthro` package. | S68 |
| A8 | Immunisation | Current NPHCDA schedule, config-driven. Copy ages and malaria vaccine dose count directly from the NPHCDA source and reconcile `child_immunisation_nphcda` before reuse. Reminders generic, never name the vaccine or condition. Never advise delaying a dose. | S68 |
| A9 | Plausibility | Two classes. Impossible (held for confirmation, never triaged): systolic under 40 or over 300, diastolic under 20 or over 200, systolic not above diastolic, pulse under 20 or over 250, SpO2 under 50 or over 100, temperature under 30 or over 44 C, adult weight under 20 or over 400 kg, glucose outside 1.1 to 55 mmol/L. Extreme but possible: saved and triaged, often RED. Provisional; review after 3 months of real data. | S70 |
| A10 | De-duplication | Duplicate when same patient and vital type, values within tolerance (BP 3 mmHg each, glucose 0.3 mmol/L, weight 0.2 kg, pulse 3 bpm, SpO2 1 percent) inside 10 minutes. Keep one canonical row; precedence validated BLE, vendor cloud, phone or aggregator mirror, manual. The other is linked as superseded, never deleted. | S70 |
| A11 | Device rhythm alert | Ingest only a cleared device's own rhythm label, store it verbatim. Same-day clinician task, no on-call page, unless chest pain, fainting, breathlessness or pulse over 150 or under 40, which takes the existing red path. Patient sees only "Your device flagged something for your care team to look at". Needs a Kardia commercial agreement and counsel first. | S70 |
| A12 | Wrist SpO2 and CGM | Wrist PPG SpO2 is informational only and never triggers amber or red alone (prompt: recheck with a fingertip oximeter). CGM: under 3.0 mmol/L (54 mg/dL) for 15 minutes or more: RED. Under 3.9 mmol/L (70 mg/dL): amber. Over 13.9 mmol/L (250 mg/dL) for 2 hours or more: amber with DKA-sign check. Basis: ADA Standards of Care, international Time in Range consensus [verify]. | S70 |
| A13 | Contraception | Neutral method list from WHO MEC and the Nigerian National Family Planning Guidelines [verify], no ranking, referral button, factual emergency contraception information, no dosing advice. Fertility-awareness is never presented as contraception. | S66 |
| A14 | Fertile window | Only in an explicit "planning a pregnancy" mode, off by default. "This is not contraception" on screen, in exports and in any reminder. No push mentions fertile days. Wording says "estimate". | S66 |
| A15 | Menopause | Symptom log plus education (NICE NG23, International Menopause Society) [verify], urgent prompt for post-menopausal bleeding, no score yet, no hormone-therapy advice. | S66 |
| A16 | Challenge templates | Days with a health log, medicine check-in days, lessons, activity minutes (up to WHO 150 to 300 a week), low-salt days (WHO under 5 g), consistent-sleep days, "days I drank water with meals". No weight, calories, fasting, BP or glucose values. Anyone with heart failure, kidney disease, pregnancy, insulin use or an eating-disorder history sees logging and lesson challenges only. | S69 |

## B. Founder, DPO and counsel positions

| # | Item | Selected |
|---|---|---|
| B1 | Cohort membership | Sensitive data. Separate, withdrawable, explicit consent to join and again to contribute to totals. Generic cohort names, never condition-themed. Member list visible to the member and moderator only. No health data in moderator views. DPIA recorded before the flag turns on. Counsel to confirm NDPA 2023 section references [verify]. |
| B2 | Regulatory position | Clinical decision support with a clinician in the loop. Send a written query to NAFDAC on SaMD status of the pregnancy BP pathway and device rhythm routing, and to MDCN on remote monitoring practice, before `maternal_enabled` or the rhythm connector is switched on. Record replies in `docs/OPEN-QUESTIONS.md`. |
| B3 | Retention | Patient-entered tracker and pregnancy-loss notes are deleted on request after the grace window. Clinician-recorded or acted-on data is sealed, kept 8 years (counsel to confirm the period) then destroyed, access audited. Pregnancy-loss data never appears in sponsor, employer or Care Circle views. |

## C. Earlier decisions recorded the same day

Cohort rankings only (no member rank); section PIN optional and on by default with re-verification recovery; deletion split by who recorded the data; group audio deferred with a dormant module.

## D. To do before any of this takes effect

1. CMO opens the sign-off hub and signs each A item (or edits it). Record the signing note per item.
2. Founder copies B and C into `docs/DECISIONS.md` as numbered decisions (D-numbers not assigned here).
3. Verify every [verify] citation against its source document and attach the source to the sign-off note.
4. Send the NAFDAC and MDCN queries; engage counsel on B1, B3, Kardia and the NDPA references.
5. Load the values as PROPOSED config with mirror tests. Keep `maternal_enabled`, the rhythm connector, CGM escalation and `community_cohorts` guards off until the matching signature and reply exist.

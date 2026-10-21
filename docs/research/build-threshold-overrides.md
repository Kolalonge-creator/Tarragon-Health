# Research: personal (per-patient) alert thresholds, 2026-10-16

Evidence tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. Web searches were run on 2026-10-16; where a result was thin it says so. Nothing here is copied; each item says what was adopted and where it shows up in the design and code.

## 1. NEWS2, SpO2 Scale 2 (Royal College of Physicians)
- [G] The NEWS2 chart has a second oxygen-saturation scoring scale (Scale 2, target 88 to 92 percent) only for people with confirmed hypercapnic respiratory failure. The RCP says the decision to use it must be made by a competent clinical decision maker and recorded in the patient's notes; it is not something the score switches on by itself. ([RCP NEWS2 2017 report](https://www.rcp.ac.uk/media/a4ibkkbf/news2-final-report_0_0.pdf), [executive summary](https://www.rcp.ac.uk/media/ctulqqbn/news2-executive-summary_0.pdf)).
- Adopted: the SHAPE of the idea, not the content. A personal range is a named, documented, clinician-owned decision with a reason, made against a published scale that has a fixed, bounded alternative. In our design the alternative scale is the clamp table (`OVERRIDE_LIMITS`), the decision is a doctor's typed SIGN with a reason, and it is stored with who and when. Code: `propose_threshold_override` / `sign_threshold_override`, `threshold-override.ts`.
- Not adopted: the RCP chart is an in-hospital early warning score; Tarragon grades single home readings. Nothing about oxygen is touched.
- Unsuitable here: a patient must never choose their own range. The patient role is refused in the database (proof B3).

## 2. ESC 2024 and KDIGO 2021 (individualised blood pressure targets)
- [G] ESC 2024 recommends a treated systolic target of 120 to 129 for most adults if tolerated, with more lenient targets allowed for symptomatic orthostatic hypotension, age 85 and over, or moderate to severe frailty, and says home or ambulatory measurement should confirm the target ([ACC summary](https://www.acc.org/latest-in-cardiology/ten-points-to-remember/2024/09/05/14/11/2024-esc-guidelines-for-bp-esc-2024), [Medscape](https://www.medscape.com/viewarticle/new-blood-pressure-guidelines-lower-treatment-target-2024a1000fvc)).
- [G] KDIGO 2021 suggests a systolic target under 120 for adults with CKD who are not on dialysis, when measured by standardised office measurement, and warns of overtreatment if routine office readings are used ([KDIGO synopsis](https://www.acpjournals.org/doi/10.7326/M21-0834), [executive summary](https://www.sciencedirect.com/science/article/pii/S0085253820312692)).
- Adopted: both directions are real clinical needs, so a personal blood pressure target can move UP (frail, long-standing higher baseline) or DOWN (CKD). Engine: the target replaces the care-plan target only inside the seven-day-average amber rule BP-A2; a stricter target creates the same review task a stricter plan would (tighten), a looser one stops that amber (relax). Clamp: target 100/60 to 160/100, so no personal target can sit above the urgent line, and an average at or over the urgent line (180/110) is never relaxed.
- Not adopted: ESC and KDIGO targets are TREATMENT targets. This feature only changes how loudly an alert fires; it does not change what a doctor prescribes.
- Nigeria: home readings are the usual source and cuff quality varies; the tighten path is therefore always allowed (more review) while the relax path needs the doctor's signed reason and expires.

## 3. ADA Standards of Care, hypoglycaemia unawareness
- [G] For insulin-treated people with impaired awareness of lows, the ADA advises raising glycaemic targets and strictly avoiding hypoglycaemia for at least several weeks, which can partly reverse unawareness; glycaemic goals are individualised and unawareness is a listed factor ([2023 Standards section 6](https://diabetesjournals.org/care/article/46/Supplement_1/S97/148053/6-Glycemic-Targets-Standards-of-Care-in-Diabetes), [2025 Standards](https://diabetesjournals.org/care/article/48/Supplement_1/S128/157561/6-Glycemic-Goals-and-Hypoglycemia-Standards-of), [2024 PMC text](https://pmc.ncbi.nlm.nih.gov/articles/PMC10725808/)). Note: the 2025 and 2026 text of the avoidance recommendation itself was not read in full; the 2021 to 2024 wording is confirmed.
- [P] The reversal evidence rests on short-term studies of scrupulous avoidance (2 to 4 weeks) in type 1 diabetes ([Diabetes 1994](https://diabetesjournals.org/diabetes/article/43/12/1426/8324/Reversal-of-Hypoglycemia-Unawareness-But-Not)).
- Adopted: a higher "treat now" low line (3.9 up to 5.0 mmol/L) and a higher RED low line (3.0 up to 3.5), both TIGHTENING only, both time-limited (the "several weeks" fits the 90 day maximum and the monthly review). Engine `applyGlucoseOverride`: a green in the gap becomes amber with the existing GL-A1 treat-now message; a reading under the personal red line becomes red with the existing GL-R1 actions (page on-call, emergency guidance).
- Not adopted: nothing lowers a glucose line. There is deliberately no relax path for glucose: its ambers are treat-now messages and same-day reviews at 20 mmol/L or more, and a relaxed DKA or hyperosmolar amber is not a chronic-burden alert.
- Unsuitable: ADA's work is for insulin-treated adults; the feature refuses pregnancy and under 18 at the database, and the signing doctor owns the clinical judgement of who has unawareness.

## 4. Telemonitoring practice and alert fatigue
- [P] A framework study of telemonitoring programmes found that individually adjusting alert thresholds reduced alerts, that reviewing the patients who generate most of the workload showed where to adjust, and that the adjustments looked relatively safe ([PMC12206671](https://pmc.ncbi.nlm.nih.gov/articles/PMC12206671/)).
- [P] ICU work (dynamic individual alarm settings) is modelling, not a remote-monitoring trial ([Operations Research 2022](https://dl.acm.org/doi/10.1287/opre.2022.2300)). A survey of ICU staff rates individual alarm thresholds as important, with heart rate and blood pressure the most individualised ([PMC10324165](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10324165/)).
- [V] A vendor blog claims 60 to 80 percent fewer false alarms from personalised baselines with no source ([Mindbowser](https://www.mindbowser.com/rpm-alert-fatigue/)). [NV] Not used for any number here.
- [NV] No prospective remote-monitoring trial comparing fixed and personalised baselines on alert rate AND outcome was found.
- Adopted: "review the high-volume patients" becomes the CMO roster (applied-count per override) and a monthly review; adjustments are one setting at a time, not a free-form rule.

## 5. Competitor products
- Epic: native documentation on per-patient threshold editing was not found in public results ([NV]); a third-party integrator describes configuring thresholds for RPM patients inside Epic ([Mindbowser](https://www.mindbowser.com/remote-patient-monitoring-ehr-integration-for-epic/)) [V].
- Cadence: clinicians remotely titrate medicines under physician protocols ([Cadence](https://www.cadence.care/post/5-ways-remote-monitoring-can-improve-patient-care-for-clinicians)) [V]; a published description of its patient-level thresholds was not found [NV].
- A CMS-funded programme worked with nephrologists to set unique blood pressure parameters per patient ([AHRQ PSNet](https://psnet.ahrq.gov/perspective/remote-patient-monitoring)) [P/G perspective]. Omada and Livongo help-centre material was not found [NV].
- Adopted from the pattern: the clinician sets the range, per patient, with defaults for everyone else. Not copied: any vendor UI, wording or code.
- Where the competitor pattern looked unsafe or unsuitable: editable thresholds in vendor tools are usually free numbers with no ceiling. Ours are clamped in code AND the database, expire, are reviewed, and can never reach a red.

## 6. What the research changed in the design
1. Bounded, not free: fixed clamps in two places, with a test that pins them equal.
2. Tighten is easy, relax is hard: relaxing needs a signed reason, a tie, no symptom, an adult who is not pregnant or postpartum, an in-date override, and only two named amber rules.
3. Expiry is the default: the loader serves only active and in-date overrides, the engine checks the date again, and a sweep lapses them.
4. Review is part of the object: a monthly review date, a CMO roster with an overdue flag, a routine review task.
5. Provenance on every changed grade, without a number in it.

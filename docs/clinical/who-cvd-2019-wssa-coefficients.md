# WHO 2019 cardiovascular risk charts, Western sub-Saharan Africa: coefficient provenance and sign-off note

**Status: PROPOSED, UNSIGNED. Nothing in this file or in the code signs anything.** The instrument version this note describes is `who_cvd_2019_wssa` **v3** in `public.risk_instrument_versions`, inserted inactive and unsigned by migration `20261103030043_who_cvd_2019_wssa_v3_verified_coefficients.sql`. The go-live guard `risk_instrument_who2019_enabled` stays held. The Chief Medical Officer signs v3 with `public.sign_risk_instrument(<v3 id>)` from chat and then switches the guard on; this note is what they are asked to read first.

Prepared 2026-11-03 by a build session (an AI agent, not a clinician). Closes the coefficient half of OQ-S45-1 and OQ-S47-1 in `docs/OPEN-QUESTIONS.md`.

## 1. What the CMO would be signing

A 10-year cardiovascular risk estimate for a person aged 40 to 74 without known diabetes and without established cardiovascular disease or blood pressure at or above 160/100, shown to the patient and care team as one of five WHO bands (under 5 percent, 5 to under 10, 10 to under 20, 20 to under 30, 30 and over), never as a percentage. The laboratory model uses age, sex, systolic blood pressure, current smoking and total cholesterol; the non-laboratory model uses body mass index instead of cholesterol. The numbers behind it are, exactly, the ones that produce the WHO 2019 Western sub-Saharan Africa charts: the code reproduces all 2100 printed cells of those two charts (section 5). Bands, the age range, the "treatment already indicated" cut-offs, the yearly reassessment rule and the band actions are unchanged from v2 (which the CMO has already seen in the S45 sign-off pack); only the models and two flags (`coefficientsVerified`, `regionCheckedForNigeria`) are new.

What is **not** being signed: the band-to-action thresholds in `bandActions` are still marked `unverified_against_who_pen_hearts` (OQ-S45-2 / OQ-S47-1 second half), and a model is not a clinical judgement. The app never prescribes on the strength of a band.

## 2. Sources, exact URLs, hashes

| What | Where it came from | SHA-256 of the file read |
|---|---|---|
| The paper | The WHO CVD Risk Chart Working Group. *World Health Organization cardiovascular disease risk charts: revised models to estimate risk in 21 global regions.* Lancet Glob Health 2019;7:e1332-45. doi:10.1016/S2214-109X(19)30318-3. Open-access text read from the University of Bristol repository copy (https://research-information.bris.ac.uk/ws/files/208991078/Full_text_PDF_final_published_version_.pdf). | (text only; Table 2 and the licence line checked) |
| Appendix 1 (methods, Table 1.6 log hazard ratios, p 39 region list) | https://ars.els-cdn.com/content/image/1-s2.0-S2214109X19303183-mmc1.pdf (Elsevier's file store). The copy served by thelancet.com at `/cms/10.1016/S2214-109X(19)30318-3/attachment/07600bf0-22dd-470f-8e82-e52d5f1d80e7/mmc1.pdf` was hashed in the browser and is byte-identical. | `92b52f66f2d7f4f3cb207d7dbedb14975c758a9e97f09e7982f5d4294ec9cf80` |
| Appendix 2 (the printed charts) | https://ars.els-cdn.com/content/image/1-s2.0-S2214109X19303183-mmc2.pdf; thelancet.com's `.../attachment/0bb4f97c-d682-49b9-9d58-a16b58c87155/mmc2.pdf` is byte-identical. | `68ab741131d86897542a3b8e8598f185c34e2d66234b14ae97881667ddc1ca17` |
| The authors' scoring program (core coefficients and baseline survivals to 7 decimal places) | `whocvdrisk_erfc_score_v03.ado`, part of the Stata package `whocvdrisk` by Dr Stephen Kaptoge and Dr Lisa Pennells, Cardiovascular Epidemiology Unit, University of Cambridge (distribution date 02 Sep 2020), published at https://github.com/skkceu/stata (https://raw.githubusercontent.com/skkceu/stata/main/whocvdrisk_erfc_score_v03.ado). The Cambridge department page (https://www.phpc.cam.ac.uk/research/departmental-research-units/ceu/health-data-science/programs) lists `whocvdrisk` as the program that "calculates WHO 10-year CVD risk with recalibration to relevant country or GBD region" and names Dr Kaptoge as the contact. | `e1a395eb4ccb6e25d2a7704862c6fad6a51fed5995fbf1f23417882753db0e16` |
| The authors' region recalibration parameters | `whocvdrisk_t10_calparms_gbd_sens0.dta` from the same package (https://raw.githubusercontent.com/skkceu/stata/main/whocvdrisk_t10_calparms_gbd_sens0.dta); row `ccode = A01GBDR_005_WSSA`, `year = 2017`, columns `cal2_m{1,2}_{cons,slope}_ep_{chdmi,crbv}` (cal2 = region level, m1 = laboratory, m2 = non-laboratory). | `684963c2670993450cb0d8c9cd9a9a7ae5c0bc7681e4430e06f6986a49055910` |

A correction notice (Lancet Glob Health 2023;11:e196, doi:10.1016/S2214-109X(22)00522-8) says "The appendix of this Article has been corrected as of Dec 6, 2022" without saying what changed. The appendix files served by thelancet.com today (hashed above) are the ones used here, and the core coefficients in Table 1.6 agree digit for digit with the authors' own program, so whatever was corrected is not a number this instrument uses.

The World Health Organization also hosts a copy of appendix 1 (https://www.who.int/docs/default-source/cardiovascular-diseases/19tlgh0153-appendix.pdf, 45 pages, 2 Sep 2019 build); its Table 1.6 and p 39 region table are the same.

## 3. Licence

- **The paper and its appendices:** the article's copyright line is "© 2019 The Author(s). Published by Elsevier Ltd. This is an Open Access article under the CC BY 4.0 license." That is **CC BY 4.0, not CC BY 3.0 IGO** as the task brief assumed. The appendices are published with the article under the same terms. Attribution is given here and in the `provenance` block of v3's configuration.
- **The authors' Stata program and parameter file:** published by the authors on GitHub and linked from the University of Cambridge department page with no licence file. The values used are numerical model parameters (facts of the published method), and the program's help file cites the Lancet paper as the published method. **Open item for the CMO (or counsel):** whether to write to Dr Kaptoge to confirm re-use of the recalibration parameters is welcome; the Lancet paper itself says the authors "have made openly accessible the statistical code" for the models.
- A CRAN package, `WHORiskCalculator` 1.1.0 (MIT, maintainer Andrea Pedot, University of Milan), extracts the same parameters from the same file; it was used only as a cross-check of which columns mean what, not as a source of any number.

## 4. Nigeria is in Western sub-Saharan Africa

Appendix 1, page 39 ("Countries included in the 21 regions defined by the Global Burden of Disease Study", referenced from the paper's Figure 2 legend) lists under **Western Sub-Saharan Africa**: Benin, Burkina Faso, Cote d'Ivoire, Cameroon, Cabo Verde, Ghana, Guinea, Gambia, Guinea Bissau, Liberia, Mali, Mauritania, Niger, **Nigeria**, Senegal, Sierra Leone, Sao Tome and Principe, Chad, Togo. The authors' parameter file maps `NGA` to GBD region 5 (Western Sub-Saharan Africa) likewise. `regionCheckedForNigeria` is therefore `true` in v3.

## 5. What the model actually is (and why v1's `modelShape` was wrong)

v1 and v2 described the instrument as one Cox model per sex, risk = 1 − S0^exp(LP). That is not how the 2019 charts are built, and no per-region baseline survival exists anywhere in the paper. The published method (appendix 1 pp 40-41, "Methods used for recalibration") is:

1. Two pooled Cox models per sex and per model type, one for **myocardial infarction or coronary death** and one for **stroke**, derived in the Emerging Risk Factors Collaboration. Variables are centred: age at 60 years, systolic blood pressure at 120 mmHg, total cholesterol at 6 mmol/L, BMI at 25 kg/m², smoking and diabetes as 0/1. Each model has main effects plus age interactions (laboratory model: 9 terms; non-laboratory: 7). Log hazard ratios: appendix 1 Table 1.6, to 7 decimal places, identical to the authors' program. Baseline survivals at 10 years: the paper's Table 2 gives 3 decimal places; the authors' program gives 7 and those are used (men MI 0.9540108, stroke 0.9849257; women MI 0.9894159, stroke 0.9890569 for the laboratory model; men 0.9544258 / 0.9848260 and women 0.9887124 / 0.9885706 for the non-laboratory model).
2. **Region recalibration** of each endpoint's 10-year risk on the complementary log-log scale, p_cal = 1 − exp(−exp(intercept + slope × ln(−ln(1 − p)))), with the intercept and slope fitted by the authors to GBD 2017 incidence and NCD-RisC risk factor levels for the region (target year 2017, the year the charts use).
3. The two recalibrated endpoints combined: 10-year CVD risk = 1 − (1 − p_MI)(1 − p_stroke).

So v3 stores, for each of lab/non-lab × male/female, `{ shape: "two_endpoint_recalibrated", mi: {baselineSurvival, terms, recalibration}, stroke: {...} }`. The engine (`packages/clinical/src/risk/who-cvd-2019.ts`) and the web parser (`apps/web/src/lib/cv-risk/who-2019.ts`) accept this shape alongside the old one, and `sign_risk_instrument`'s completeness check was widened (`private.risk_sex_model_complete`) so that it inspects both endpoints and both recalibration numbers. The `diabetes` terms are carried for completeness; the engine never scores a person with known diabetes (they are routed to the diabetes pathway), so the term contributes zero.

Region recalibration parameters used (Western sub-Saharan Africa, 2017, region level):

| model | sex | MI or CHD death | stroke |
|---|---|---|---|
| lab | male | S0 = 0.9540108; intercept = -0.3095740079879761; slope = 0.9497053623199463 | S0 = 0.9849257; intercept = -0.8973300457000732; slope = 0.6761412024497986 |
| lab | female | S0 = 0.9894159; intercept = -0.5290281772613525; slope = 0.7057502269744873 | S0 = 0.9890569; intercept = -0.8381919264793396; slope = 0.6357288360595703 |
| non_lab | male | S0 = 0.9544258; intercept = -0.36387184262275696; slope = 1.0364793539047241 | S0 = 0.984826; intercept = -0.9692327976226807; slope = 0.6512733697891235 |
| non_lab | female | S0 = 0.9887124; intercept = -0.50197434425354; slope = 0.7591237425804138 | S0 = 0.9885706; intercept = -0.7182005047798157; slope = 0.663612961769104 |

(The intercepts and slopes are Stata single-precision values widened to double, exactly as the authors' program reads them.) The full term lists are in the migration and are reproduced in section 8.

**Nothing was typed by hand.** A script parsed the coefficients out of the `.ado` text, read the `.dta` with pandas, assembled the JSON, and parsed the chart cells out of the PDF text layer; the migration, the registry entry and the test fixture were all written from that output.

## 6. Verification against the published charts

Appendix 2 prints, for Western sub-Saharan Africa, the laboratory chart (p 5: 7 age bands × 5 blood-pressure bands × 5 cholesterol columns × men/women × smoker/non-smoker × with/without diabetes = 1400 cells) and the non-laboratory chart (p 27: the same without diabetes and with 5 BMI columns = 700 cells). Every one of the 2100 cells is reproduced exactly (rounded to the printed whole percent) by the v3 coefficients, using the cell midpoints age 42.5, 47.5 … 72.5; systolic 110 / 130 / 150 / 170 / 190; total cholesterol 3.5 / 4.5 / 5.5 / 6.5 / 7.5 mmol/L; BMI 17.5 / 22.5 / 27.5 / 32.5 / 37.5 kg/m². Any other convention that was tried (whole-year ages, 115 for "under 120", 18 or 19 for "under 20" BMI) breaks tens to hundreds of cells, so the convention is not a free choice.

This is a standing Jest test, `packages/clinical/src/risk/who-cvd-2019-wssa-charts.test.ts`, which reads the configuration out of the committed migration and the cells out of `packages/clinical/src/risk/fixtures/who-cvd-2019-wssa-chart-cells.json`. It also runs `runCvdValidationVectors` on six cells read directly off the printed charts (and on every scorable cell at least two points inside its band, more than 300 of them), and includes a sabotage case (a 20 percent error in one slope breaks more than 100 cells). The database proof `packages/db/tests/who_cvd_2019_wssa_v3_verified_coefficients.sql` shows v3 unsigned and inactive, the completeness check accepting both shapes and refusing half-filled ones, the CMO able to sign v3 (inside a rolled-back transaction only) while v1 and v2 are still refused, and a sabotage that strips one recalibration and flips signing back to refused.

The six hand-read vectors (printed value in brackets):

| chart | person | printed | band |
|---|---|---|---|
| lab p 5 | man, 70-74, non-smoker, SBP 140-159, cholesterol 5 to 5.9 | 18 | 10 to under 20 |
| lab p 5 | man, 55-59, smoker, SBP 120-139, cholesterol under 4 | 7 | 5 to under 10 |
| lab p 5 | woman, 70-74, smoker, SBP 140-159, cholesterol 6 to 6.9 | 21 | 20 to under 30 |
| lab p 5 | woman, 45-49, non-smoker, SBP 120-139, cholesterol 5 to 5.9 | 2 | under 5 |
| non-lab p 27 | man, 65-69, smoker, SBP 140-159, BMI 35 and over | 22 | 20 to under 30 |
| non-lab p 27 | woman, 60-64, non-smoker, SBP 120-139, BMI 25 to 29 | 6 | 5 to under 10 |

## 7. Limits the CMO should know

- The charts (and v3) are the **region** recalibration. The authors' file also holds a **Nigeria-specific** recalibration (`cal1`, country level) which can give noticeably different numbers from the region charts. The WHO charts as published are the region version, which is what v3 implements and what the printed charts show; switching to the country version would be a new, separately signed version.
- The recalibration target year is 2017 (GBD 2017). The authors' program expects the parameters to be refreshed when GBD updates; v3 pins 2017 and says so.
- The engine uses a person's actual age, blood pressure, cholesterol and BMI, not the chart cell midpoints, so a person's band can differ from the printed cell that contains them. That is the intended behaviour of the underlying model; the charts are a rounding of it.
- Ages 40 to 74 only, no known diabetes, no established disease, blood pressure under 160/100: outside those the engine records a reason and no band (unchanged from v1).

## 8. The complete term lists (as shipped in v3)

**lab / male / MI or CHD death** (baseline survival 0.9540108)

| coefficient | term |
|---|---|
| 0.0719227 | (age - 60) |
| 0.2284944 | (total_chol_mmol - 6) |
| 0.0132183 | (sbp - 120) |
| 0.6410114 | (diabetes - 0) |
| 0.5638109 | (smoker - 0) |
| -0.0045806 | (age - 60) x (total_chol_mmol - 6) |
| -0.0001576 | (age - 60) x (sbp - 120) |
| -0.0124966 | (age - 60) x (diabetes - 0) |
| -0.0182545 | (age - 60) x (smoker - 0) |

**lab / male / stroke** (baseline survival 0.9849257)

| coefficient | term |
|---|---|
| 0.0986578 | (age - 60) |
| 0.029526 | (total_chol_mmol - 6) |
| 0.0222629 | (sbp - 120) |
| 0.6268712 | (diabetes - 0) |
| 0.4981217 | (smoker - 0) |
| 0.00142 | (age - 60) x (total_chol_mmol - 6) |
| -0.0004147 | (age - 60) x (sbp - 120) |
| -0.026302 | (age - 60) x (diabetes - 0) |
| -0.0150561 | (age - 60) x (smoker - 0) |

**lab / female / MI or CHD death** (baseline survival 0.9894159)

| coefficient | term |
|---|---|
| 0.1020713 | (age - 60) |
| 0.2050377 | (total_chol_mmol - 6) |
| 0.015823 | (sbp - 120) |
| 1.070358 | (diabetes - 0) |
| 1.053223 | (smoker - 0) |
| -0.0051932 | (age - 60) x (total_chol_mmol - 6) |
| -0.0001378 | (age - 60) x (sbp - 120) |
| -0.0234174 | (age - 60) x (diabetes - 0) |
| -0.0332666 | (age - 60) x (smoker - 0) |

**lab / female / stroke** (baseline survival 0.9890569)

| coefficient | term |
|---|---|
| 0.1056632 | (age - 60) |
| 0.0257782 | (total_chol_mmol - 6) |
| 0.0206278 | (sbp - 120) |
| 0.8581998 | (diabetes - 0) |
| 0.7443627 | (smoker - 0) |
| -0.0021387 | (age - 60) x (total_chol_mmol - 6) |
| -0.0004897 | (age - 60) x (sbp - 120) |
| -0.0209826 | (age - 60) x (diabetes - 0) |
| -0.0200822 | (age - 60) x (smoker - 0) |

**non_lab / male / MI or CHD death** (baseline survival 0.9544258)

| coefficient | term |
|---|---|
| 0.073593 | (age - 60) |
| 0.0337219 | (bmi - 25) |
| 0.0133937 | (sbp - 120) |
| 0.5954767 | (smoker - 0) |
| -0.0010432 | (age - 60) x (bmi - 25) |
| -0.0001837 | (age - 60) x (sbp - 120) |
| -0.0200831 | (age - 60) x (smoker - 0) |

**non_lab / male / stroke** (baseline survival 0.984826)

| coefficient | term |
|---|---|
| 0.097674 | (age - 60) |
| 0.0159518 | (bmi - 25) |
| 0.0227294 | (sbp - 120) |
| 0.4999862 | (smoker - 0) |
| -0.0003516 | (age - 60) x (bmi - 25) |
| -0.0004374 | (age - 60) x (sbp - 120) |
| -0.0153895 | (age - 60) x (smoker - 0) |

**non_lab / female / MI or CHD death** (baseline survival 0.9887124)

| coefficient | term |
|---|---|
| 0.1049418 | (age - 60) |
| 0.0257616 | (bmi - 25) |
| 0.016726 | (sbp - 120) |
| 1.093132 | (smoker - 0) |
| -0.0006537 | (age - 60) x (bmi - 25) |
| -0.0001966 | (age - 60) x (sbp - 120) |
| -0.0343739 | (age - 60) x (smoker - 0) |

**non_lab / female / stroke** (baseline survival 0.9885706)

| coefficient | term |
|---|---|
| 0.1046105 | (age - 60) |
| 0.0036406 | (bmi - 25) |
| 0.0216741 | (sbp - 120) |
| 0.7399405 | (smoker - 0) |
| -1.29e-05 | (age - 60) x (bmi - 25) |
| -0.0005311 | (age - 60) x (sbp - 120) |
| -0.0203997 | (age - 60) x (smoker - 0) |
# CMO sign-off pack for S41 to S45 (2026-10-07)

Two items need a clinician's signature before the related code goes live: the cardiovascular risk instrument and the immunisation schedule. This pack gives the recommendation, the evidence, and the exact documents to read. **Nothing here is signed. An agent never signs clinical protocols; the CMO signs in the sign-off hub.** All values stay PROPOSED in versioned config until then.

Evidence tags: **[V]** read in a source during research, **[SEC]** secondary (news, search snippet), **[NV]** not verified. Several fetches failed (WHO data portal, NPHCDA FHIR IG, one NPHCDA page), so the first-party coverage is thin. Do not sign on this pack alone.

---

## A. Cardiovascular risk instrument

### Recommendation
Use the **WHO 2019 cardiovascular disease risk charts, "Western sub-Saharan Africa" region**, as the engine of record. Run the laboratory model when total cholesterol is on file, the non-laboratory (BMI) model otherwise. Show **risk bands, not a precise percentage**. Retire the in-repo AFRO approximation as the instrument (it is labelled "not the official chart"). Keep SCORE2 out of the primary path.

### Why
- Only candidate recalibrated for West Africa, covers fatal and non-fatal heart attack and stroke, open-access paper (CC BY 4.0) [V].
- The Nigerian national hypertension guideline (2023-2028) says the WHO chart should be used whenever possible [V]. WHO HEARTS builds on it [SEC].
- SCORE2 is calibrated to four European regions; none is sub-Saharan [V]. Pooled Cohort Equations and Framingham have no West African calibration [NV for PCE, SEC for Framingham].

### Comparison

| Instrument | Calibrated for West Africa | Lab needed | Guideline backing in Nigeria |
|---|---|---|---|
| WHO 2019 lab model | Yes, regional recalibration (not Nigerian outcome data) | Cholesterol | National hypertension guideline, HEARTS, PEN |
| WHO 2019 non-lab model | Same | No | Same. Ghana and Nigeria study (n=319): kappa 0.766 vs lab model, agreement only [V] |
| WHO/ISH 2007 | Older regional model | Optional | Superseded; different tier colours and cutoffs [V] |
| SCORE2 / SCORE2-OP | No | Yes | European guideline only |
| Pooled Cohort Equations, Framingham | No | Yes | None for Nigeria |

### Caveats the CMO must rule on
1. **Nigeria's region assignment is unconfirmed.** The paper's figure lists Burkina Faso, Benin, Ghana, Guinea and others under Western sub-Saharan Africa; Nigeria was not in the extract read. Confirm in Appendix 1 pp 25-29 and Appendix 2.
2. **No Nigerian outcome validation exists** for the model [V]. The authors say bias direction is unknown. Present as a band with a plain "estimate" label.
3. **Non-lab limits [V]:** performs poorly in people with diabetes; at the 20% line it flagged about 65% of men and 35% of women the lab model flagged; over 97% of lab >20% were >10% on non-lab. Proposal: use **>10% as the non-lab "needs further assessment" trigger**, and send **known diabetes down its own pathway, not through the chart**.
4. **Age range.** Charts target ages 40 to 74 [NV]. The app should refuse or flag outside that range.
5. **Score is not used when treatment is already indicated** (established cardiovascular disease, BP of 160/100 or higher, many diabetes or kidney cases) [NV, standard practice].
6. **Bands.** The 2019 charts use <5, 5 to <10, 10 to <20, 20 to <30, 30 and above [V]. Orange now means above 10% and red above 20%, shifted from WHO/ISH [V]. Never mix cutoffs between the two.
7. **Action thresholds are not verified.** PEN and HEARTS tier actions (follow-up interval, statin and referral cutoffs) could not be read in full. Search summaries disagree on follow-up intervals. The CMO must take them from the primary documents.
8. **Licence.** Coefficients are in the paper's appendix; confirm the terms for embedding them in a commercial app.
9. Tier-to-action mapping is a clinical decision recorded in PROPOSED config with a `version_id` on every assessment (INV-16).

### Documents to read before signing
- WHO CVD Risk Chart Working Group, Lancet Glob Health 2019;7:e1332-45, DOI 10.1016/S2214-109X(19)30318-3, with Appendix 1 pp 25-29 and Appendix 2. Open copy: https://eprints.gla.ac.uk/199197/1/199197.pdf
- Lab vs non-lab comparison in West Africa: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12148134/
- Nigeria national hypertension guideline 2023-2028: https://www.differentiatedservicedelivery.org/wp-content/uploads/HTN-GUIDELINES-2023_2028_21AUG_OK_131023.pdf
- WHO HEARTS and PEN Protocol 1: https://www.who.int/europe/teams/ncd-management/implementation-of-who-hearts-and-pen (find the risk-based management module and the PEN tables yourself)

### Decision to record
Instrument of record, model rule (lab when cholesterol present else non-lab), diabetes routing, age limits, band-to-action table, and who is told what at each band.

---

## B. Immunisation schedule

### Status
**Cannot be signed from the evidence gathered.** Only one first-party schedule was read: an NPHCDA-branded table hosted on UNICEF Nigeria. It is an image-only PDF with no date or version stamp, and it omits MenFive, MR, R21 malaria and single-dose HPV, so it predates them. Ask NPHCDA directly for the current dated national schedule; it is the only document that settles the open rows below.

### Founder decisions (2026-10-07)
HPV is entered as **two doses** (6 months apart) per the founder; typhoid is **not** in the schedule. Flag for the CMO: secondary sources report a single-dose HPV policy from Oct 2023, so confirm against NPHCDA's current dated document before signing. Dose count is config, not code.

### Proposed schedule (draft for review, not for signing yet)

| Age | Vaccine | Flag |
|---|---|---|
| Birth | BCG, OPV0, Hepatitis B birth dose | [V] UNICEF/NPHCDA PDF (hep B birth-dose time limit NV) |
| 6 weeks | Pentavalent 1, PCV1, OPV1, Rota 1, IPV1 | [V] |
| 10 weeks | Pentavalent 2, PCV2, OPV2, Rota 2 | [V] |
| 14 weeks | Pentavalent 3, PCV3, OPV3, Rota 3, IPV2 | [V] |
| 6 months | Vitamin A 100,000 IU | [V] |
| 9 months | Measles 1, Yellow fever, Meningitis vaccine | [V]; product (MenAfriVac vs MenFive) and routine age NV |
| 12 months | Vitamin A 200,000 IU | [V] |
| 15 months | Measles 2 | [V]; whether now MR NV |
| 5, 6, 7 months and 15 months | R21 malaria, 4 doses, phased by state from 2 Dec 2024 (Kebbi, Bayelsa first) | [SEC] Gavi, WHO AFRO |
| 9 to 13 years | HPV: 2 doses, 6 months apart (founder decision) | [V] PDF; [SEC] reports single dose since Oct 2023, CMO to confirm |
| Pregnancy | Td: at least 2 doses at antenatal care; 5-dose course if never vaccinated | [SEC] from papers, not an NPHCDA table |

Rotavirus timing is [V] from the PDF; the August 2022 introduction date is [NV] here.

### Conflicts and unknowns
- **HPV:** 2 doses (older PDF) vs single dose, ages 9 to 14 (Oct 2023 release). Likely the PDF is older, but it is undated, so that is inference.
- **Measles / MR:** MR was campaigned from Oct 2025 (ages 0 to 14); whether routine MCV1/MCV2 is now MR is NV.
- **MenFive:** introduced March 2024 by campaign; routine age and whether it replaces the 9-month dose NV.
- **Typhoid conjugate vaccine:** a 2026 paper says no national introduction; two consumer sites say 24 months. Treat as NOT in the schedule.
- **Not found at all:** COVID, adult and adolescent boosters, current R21 state list, IPV timing in other documents.

### Documents to obtain and compare
1. UNICEF Nigeria schedule page (check date): https://www.unicef.org/nigeria/documents/nigeria-immunization-schedule
2. WHO WIISE Nigeria page (shows last-updated): https://immunizationdata.who.int/global/wiise-detail-page/vaccination-schedule-for-nigeria?ISO_3_CODE=NGA
3. NPHCDA FHIR Immunization IG, recommendations page: https://build.fhir.org/ig/Nigeria-FHIR-Community/NPHCDA-ImmunizationIG/health-interventions-recommendations.html
4. NPHCDA site: https://nphcda.gov.ng (HPV page returned 404 when fetched)
5. National Routine Immunization Strategic Plan: https://www.nitag-resource.org/sites/default/files/2b302ead55915d61468ac747e2e437aee65871b1_1.pdf
6. WHO AFRO R21 notice: https://www.afro.who.int/pt/node/20312
7. WHO MenFive notice: https://www.who.int/news/item/12-04-2024-in-world-first--nigeria-introduces-new-5-in-1-vaccine-against-meningitis
8. UNICEF HPV introduction release: https://www.unicef.org/nigeria/press-releases/nigeria-vaccinate-77-million-girls-against-leading-cause-cervical-cancer
9. Td and hep B birth-dose practice study: https://pmc.ncbi.nlm.nih.gov/articles/PMC11837813

### Engineering consequence
Store the schedule as versioned, CMO-signed config (`vaccination_schedule_signoffs` already exists). No reminder logic, due-date push or "overdue" flag ships until the signed version is active. Make R21 availability a per-state flag, not a global rule.

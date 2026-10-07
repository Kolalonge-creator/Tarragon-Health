# CMO sign-off pack for S61 to S65 (2026-10-07)

Clinical parameters for condition pathways (S61/S62), digital therapy programmes (S63) and consultations, emergencies and directory (S64/S65). Each question gives the options, the guideline basis, what the guidelines disagree on, and a recommendation. Selecting an option in chat records the CMO's decision here and in `docs/DECISIONS.md`. **That is a decision record, not a database signature.** None of these items exists yet as a signable draft; formal signing happens in the sign-off hub (`/clinician/clinical-signoff`) once the drafts are built. An agent never signs. All values stay PROPOSED in versioned config until then. This pack does not say any value is regulator-approved.

Evidence tags: **[V]** read in a source this session, **[V-s]** seen only in a search snippet or secondary summary, **[U]** not verified. Blocked or unread: ADA Standards 2026 full text, AHA/ACC 2025 full text, ESC 2024 full text, WHO IRIS PDF, NICE pages (403), WHO HEARTS 2.0 numbers, all Nigerian maternal, malaria and mental-health guideline PDFs, any Nigerian diabetes, asthma, COPD, heart-failure or sickle-cell guideline. Where a Nigerian source is missing, the question says so.

Primary documents the CMO should open before signing: Nigeria National Guideline for Hypertension 2023 to 2028; Resolve to Save Lives "Hypertension treatment protocol: Nigeria" (May 2023); WHO 2021 hypertension pharmacological guideline; ISH 2020; NICE NG136. For diabetes, the ADA Standards of Care 2026 section 6 and 16 (not read here).

---

## Part 1. Hypertension (Module 13, S61/S62)

### Q1. First-line step ladder for the engine's titration proposals
The engine only drafts a proposal; a clinician signs and the patient confirms (INV-02). This is the step table that OQ-171 is waiting for.

| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Amlodipine 5 mg, then amlodipine 5 + losartan 50, then amlodipine 10 + losartan 100, then add HCTZ 25 mg, then refer. Review monthly until controlled. Telmisartan 40/80 or amiloride-HCTZ may substitute where stocked. Start at step 2 if 160/100 to 179/109 at diagnosis. | RTSL Nigeria protocol May 2023 [V]; Nigeria national guideline names CCB first-line, thiazide or ACEi/ARB second, single-pill combinations encouraged, no beta-blocker/ACEi/ARB monotherapy in Black patients [V] |
| B | Half-dose single pill start: telmisartan 40 + amlodipine 5, then 80 + 10, then add HCTZ 25 or chlorthalidone 12.5, then HCTZ 50 or chlorthalidone 25. Recheck 4 to 6 weeks. | WHO algorithm 1, printed as Appendix A of the Nigeria guideline [V]; ISH 2020 dual low-dose A+C start [V] |
| C | A with indapamide or chlorthalidone in place of HCTZ at step 4. | NICE NG136 and ISH prefer thiazide-like [V]; Nigeria and RTSL name HCTZ [V] |
| D | Hold: no step table yet, proposals stay off. | n/a |

Disagreement: diuretic choice (HCTZ in Nigeria and RTSL, indapamide or chlorthalidone in NICE and ISH); first-line in Black adults is CCB (Nigeria, RTSL, NICE) or A+C or C+D (ISH). Pharmacy supply decides between A and B. Women who could be pregnant: no losartan or telmisartan without effective contraception (RTSL, Nigeria) [V]; this becomes an exclusion rule. Step-4 doses and the supply list are for the CMO to confirm against the primary PDFs. Spironolactone as a fourth step (ISH) is not proposed; resistant hypertension refers (Nigeria, RTSL).

### Q2. Treatment targets
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Below 140/90 for adults without comorbidity; below 130/80 for CVD, diabetes or CKD, set by the clinician per patient. | Nigeria §5.4.2 [V]; WHO 2021 [V]; NICE <140/90 under 80 [V] |
| B | Below 130/80 for everyone. | AHA/ACC 2025 [V-s]; ISH 2020 [V] |
| C | Systolic 120 to 129 if tolerated. | ESC 2024 [V-s] |

Guidelines disagree. A is the conservative, Nigeria-aligned choice and matches the modest NHCI yardstick (39% control among enrolled [V]). Treating at 130 to 139 is a clinician decision only (Nigeria: only with CVD, high risk, diabetes or CKD; AHA treats at stage 1 [V-s]).

### Q3. Severe blood pressure rule
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Tiered. 180/110 or higher with no symptoms: amber, same-day clinician contact, recheck, take regular medicine. 180/110 or higher with any symptom (chest pain, new confusion, breathlessness, severe headache, visual change, weakness or speech change, fits): red, pages on-call, emergency card. | Nigeria §6.13 (emergency needs acute organ damage; urgency lowers over 24 to 48 h) [V]; NICE (same-day for 180/120 with life-threatening symptoms; review within 7 days otherwise) [V]. Headache, visual change and neurological deficit are a clinical extrapolation [U]. |
| B | Every reading at 180/110 or higher: go to hospital within 1 hour. | RTSL [V] |
| C | Asymptomatic severe reading: outpatient oral intensification, no referral. | AHA/ACC 2025 [V-s] |

The existing 200/130 phone question and BP-R rules are a separate, still-draft rule set (v3 awaiting your signature). This answer sets the intent for that review. Pregnancy: 160/110 or higher, or a severe headache or visual change, is hospital now (NICE NG133 [V]).

### Q4. Home blood pressure validation
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | 7 days, two readings one minute apart, morning before medicine and evening, discard day 1, home mean 135/85 or higher counts as raised. | NICE and ISH agree [V]; Nigeria threshold 135/85 [V], schedule not stated [U] |
| B | Minimum 4 days. | NICE minimum [V] |

---

## Part 2. Diabetes (S61, diabetes pathway)

All ADA numbers below come from snippets and secondary summaries, not the full 2026 text [V-s]. Read the full Standards before signing.

### Q5. Hypoglycaemia rule (resolves the spec example "2.8 mmol/L with confusion")
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Below 3.0 mmol/L at any time, or any confusion, seizure, unresponsiveness or "needed another person's help" at any reading below 3.9: red, pages on-call, emergency card. 3.0 to 3.9 without symptoms: amber with "take 15 g fast sugar, recheck in 15 minutes" and a `hypo_follow_up` task. Insulin or sulfonylurea use tightens, never loosens. Two or more Level 2 or 3 events raises a medication review task. | ADA: Level 1 below 3.9 mmol/L (70 mg/dL), Level 2 below 3.0 (54), Level 3 is defined by altered mental or physical state needing help; 15 g carbohydrate and recheck at 15 minutes [V-s]; review treatment after Level 2 or 3 [V-s] |
| B | Any reading below 3.9 is red. | Conservative; high alarm load |
| C | Only below 3.0 is red; confusion not an input. | Current app code without symptoms; fails the spec example |

Level 3 is defined by the event, not a number, so A makes 2.8 with confusion red by either route. Unconscious or unable to swallow: nothing by mouth, recovery position, get help [V-s]. No Nigerian source found [U].

### Q6. Does a dangerous reading page a clinician regardless of plan?
The platform was built so Free consumes no doctor time (2026-08-10). The v5 spec says red pages on-call (INV-05).
| Option | Detail |
|---|---|
| **A (recommended)** | Life-threatening class pages on-call for every patient regardless of plan: Level 3 hypoglycaemia or below 3.0, BP emergency, emergency symptoms. Everything amber follows the member entitlement. |
| B | Members only page; Free gets the full self-care and emergency guidance but no clinician page (today's behaviour). |
| C | Every red of any kind pages for every patient. |

Basis: INV-05 and patient safety; no guideline text addresses payer tier. This is a policy and cost decision as well as a clinical one. Note that A needs an escalation SLA and on-call cover to exist (the `on_call_cover_ok` guard currently blocks nothing).

### Q7. Targets and thresholds the diabetes pathway reports against
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | HbA1c below 7% for most adults, individualised by the clinician, 8% or higher flags a review. Time in range above 70% (3.9 to 10.0 mmol/L), time below 3.9 under 4%, below 3.0 under 1%. Diagnosis: fasting 7.0, 2-hour 11.1, HbA1c 6.5. Prediabetes alert uses ADA fasting 5.6 to 6.9 and HbA1c 5.7 to 6.4, labelled as screening. Reporting only; targets never trigger a medicine change. | ADA 2025/2026 [V-s]; WHO diabetes cut-offs [V-s] |
| B | As A but prediabetes uses the WHO fasting lower bound 6.1. | WHO IFG 6.1 to 6.9 [V-s] |
| C | HbA1c below 8% default for everyone. | Older or comorbid adults only [V-s] |

ADA and WHO disagree on the lower fasting bound (5.6 against 6.1 mmol/L). Pre-meal and post-meal targets (ADA 4.4 to 7.2 and below 10.0) are standard but unread [U].

### Q8. What the engine may propose for diabetes in v1
| Option | Detail |
|---|---|
| **A (recommended)** | Triage and insights only. No diabetes titration proposals in v1. The step table is drafted for a later release once the ADA and Nigerian texts are read. |
| B | Metformin dose proposals only, blocked when eGFR is below 45 and never started below 45; stop below 30. Other drugs are clinician-initiated. |
| C | Broader non-insulin proposals including SGLT2 inhibitors and GLP-1 agonists. |

Basis for B: metformin full dose at eGFR 45 or above, no start at 30 to 44, contraindicated below 30 [V-s]. Insulin changes are never proposed by the engine under any option (Part C, no automated dosing; a clinician-signed change only). Insulin start criteria (HbA1c above 10%, glucose 300 mg/dL or more, catabolic symptoms) were not verified [U]. A is recommended because the first-party diabetes text could not be read and there is no Nigerian diabetes step table.

---

## Part 3. Other pathways (S61, Release 3 scope)

### Q9. Combining pathways for people with two or more conditions
| Option | Detail |
|---|---|
| **A (recommended)** | One cardiometabolic pathway that runs each condition's own rule set and takes the most urgent result, never a third rule set. A test proves extra conditions never lower urgency. |
| B | The primary condition's rule set only; the others informational. |

### Q10. Weight management thresholds
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Alert at BMI 25 and 30 (WHO), add waist-to-height 0.5 or more as an extra flag. Weight milestones reward consistency, never body size. Medicine for weight (including GLP-1) stays a signed clinician decision with structured lifestyle support; no promotion. | WHO standard cut-offs [V-s]; NICE NG246 waist-to-height 0.5 to 0.59 raised, 0.6 high [V-s]; WHO GLP-1 guideline Dec 2025: conditional recommendation, BMI 30 or more, with structured lifestyle support [V-s] |
| B | Use 23 and 27.5 for Black African adults. | NICE NG246 snippet only; read the guideline directly before using [U] |

### Q11. Asthma and COPD rules
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Manual reliever log. Flag reliever use more than twice a week, or three or more canisters a year. Red: cannot finish a sentence, peak flow below 50% of best, no relief from the reliever. SpO2 below 92% counts as red only where a patient has an oximeter, as a conservative UK-style line. No sensor hardware. | GINA 2025 control questions and canister risk [V]; severe signs [V mixed]; GOLD 2025 exacerbation definition [V]. SpO2 92% is not a GINA number [V]. No Nigerian source [U]. |
| B | Omit the SpO2 line. | |

### Q12. Heart failure, CKD, sickle cell and post-stroke monitoring
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Sign heart failure (weight up more than 2 kg in 3 days) and CKD (refer for eGFR below 30, ACR 300 mg/g or higher, sustained fall over 20% or 5 mL/min in a year, or refractory hypertension). Defer sickle cell and post-stroke thresholds; their adult red lines were not verified. | HF weight rule from patient-facing guidance, not the primary guideline [V-s]; KDIGO 2024 [V-s]; sickle cell adult triage [U]; post-stroke BP 130/80 (ISH) [V], Nigeria start treatment about 10 days after the event [V] |
| B | Defer all four to a later release; guards stay off. | |
| C | Sign all four, using fever 38.5°C or higher, chest pain, priapism and stroke signs for sickle cell. | Sickle cell values [U] |

---

## Part 4. Digital therapy programmes (S63)

### Q13. Launch order
| Option | Detail |
|---|---|
| **A (recommended)** | Wave A first: panic breathing (builds on BRE-01), pelvic floor, IBS hypnotherapy. All audio, low risk, cheap. Wave B: CBT-I (stimulus-control-first) and pain programmes. Wave C: low mood, stress, anxiety, pulmonary rehab, after the mental-health work (S56) and COPD pathway. Every programme has a go-live guard, off. |
| B | CBT-I first, because it has the strongest evidence (European Insomnia Guideline 2023 first-line [V]; NICE MTG70 recommends digital CBT-I [V]). Needs the most safety logic. |
| C | Build the engine and scaffold all eight, ship none. |

### Q14. CBT-I safety settings
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Enter at ISI 15 or more (8 to 14 gets education only). Sleep restriction is behind a clinician flag; the default variant is sleep diary, wind-down and stimulus control. Time-in-bed floor 5.5 hours. Exclude bipolar disorder, psychosis, epilepsy or seizures, parasomnia, drowsy-driving or safety-critical work, pregnancy, alcohol or sedative dependence. Epworth 10 or more or STOP-Bang 3 or more: medical review first. | ISI bands [V]; sleep restriction cautions and 5 h floor [V-s, AASM fact sheet]; NICE: assess for sleep apnoea before referral [V]; Epworth and STOP-Bang cut-offs [V-s, check "10 or more"]; pregnancy and substance items [U] |
| B | Floor 5.0 hours as in the AASM sheet. | [V-s] |
| C | No sleep restriction in v1. | |

### Q15. Mood and anxiety programme safety
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Self-guided only below PHQ-9 15 and GAD-7 15; at or above 15 a clinician reviews before start. Any PHQ-9 item 9 above zero stops the programme, shows the emergency card ("go to the nearest hospital now", no helpline numbers), and creates a `crisis_follow_up` task. Worsening (PHQ-9 up 5 or more, GAD-7 up 4 or more, or PHQ-9 20 or more) raises a clinician review. | PHQ-9 and GAD-7 bands [V-s]; item 9 follow-up [V-s]; WHO mhGAP-IG 2023 safety planning [V]; reliable change thresholds vary by source (PHQ-9 5 to 6, GAD-7 4 to 6) [V-s]; Nigeria National Mental Health Act 2021 [V-s] |
| B | Clinician review before start at 10 or more. | Stricter, higher workload |
| C | Self-guided up to 19. | Looser |

### Q16. Programme exclusion lists
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Hard-stop and route to a clinician. IBS: unexplained weight loss, rectal bleeding, family history of bowel or ovarian cancer, anaemia or a mass, age over 50 with new onset, night symptoms. Pelvic floor: blood in urine, retention, a mass, continuous leakage suggesting a fistula. Back and neck pain: saddle numbness, bladder or bowel change, weakness in both legs, progressive deficit, trauma, fever, weight loss, cancer history, night pain, plus Nigerian additions (known TB, sickle cell bone pain, HIV). Pulmonary rehab held until the COPD pathway exists. Lists are CMO-editable config; items marked [U] stay draft until you confirm them. | NICE CG61 (weight loss, bleeding, family history, anaemia, masses) [V]; NICE NG123 PFMT 8 contractions three times a day for at least 3 months [V]; NICE NG59 and cauda equina data (single red flags are specific but not sensitive) [V]; nocturnal symptoms, over-50 rule, fistula, TB, sickle cell and HIV items [U]; ATS 2023 recommends rehab in stable COPD [V], contraindication thresholds [U] |
| B | Use only the verified items; leave the rest out. | |

---

## Part 5. Emergencies and consultation safety (S64/S65)

### Q17. Offline emergency card content
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | First line always "Go to the nearest hospital now." Chest pain: if alert and not allergic, chew aspirin 162 to 324 mg after you have asked for help or are on the way. Stroke: face, arm or speech change means hospital now, never aspirin. Hypoglycaemia, seizure (over 5 minutes or repeated, nothing in the mouth, recovery position), pregnancy (BP 160/110 or higher, severe headache, visual change, bleeding, fits), severe breathlessness. Malaria danger signs (fits, cannot drink, drowsy) and Lassa warning signs as short seasonal lines. | AHA/ARC 2020 aspirin 162 to 324 mg [V]; stroke aspirin avoidance from first-aid training sources, not an AHA text [V-s]; seizure rules (epilepsy charity) [V]; NICE NG133 [V]; WHO severe malaria criteria [V]; NCDC Lassa advisory [V] |
| B | As A but leave out aspirin entirely. | More conservative |

No Nigerian clinical emergency guideline was read. "Hospital now when no ambulance" is supported by inference, not a located WHO sentence [V-s].

### Q18. Which emergency numbers appear
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | No helpline numbers. 112 as "may connect" only where a state's entry has been test-called in the last quarter, shown with the date; Lagos 767 listed on the same terms. | 112 adopted by the federal government but not fully operational nationwide [V]; LASAMBUS 767 or 112, Lagos only [V]; FRSC 122 is a road-traffic line, current coverage unknown [V]; NCDC 6232 is an information line [V]; NEMSAS exists with partial coverage [V-s] |
| B | No numbers at all. | |
| C | Also list 122 and NCDC 6232. | Not clinical emergency lines |

### Q19. Clinician licence display and re-verification
| Option | Detail | Basis |
|---|---|---|
| **A (recommended)** | Show the MDCN registration number and "checked on" date on every clinician. Re-check at onboarding, at the licence's annual renewal, and on any complaint. A person checks manually; no public API or bulk register was found. | MDCN licences renew annually [V]; no public lookup located [U] |
| B | Show the number only, no date. | |

### Q20. Care Circle one-tap location alert
| Option | Detail |
|---|---|
| **A (recommended)** | Patient-initiated only. Location is sent only on the patient's own tap, with consent text and revocation, by push and email, and it never replaces the in-app route. No automatic location on a red page. Existing neutral push stays for red pages. |
| B | Also include location in the red-page alert to a nominated person. |
| C | Do not build this in v1. |

Basis: privacy and INV-07 (no clinical content in notifications); decision S48-1 exists but needs consent text and a guard. No guideline governs this.

---

## Part 6. Directory, ratings and access (S65)

### Q21. Directory verification cadence and hide rule
| Option | Detail |
|---|---|
| **A (recommended)** | Emergency-capable hospitals and 24-hour pharmacies re-verified every 90 days, clinics and labs every 180, others every 365. A listing past twice its cadence is hidden from patient search (not deleted). Two independent wrong-info reports trigger immediate re-verification. Every listing shows its last-verified date and tier (seed only, phone-confirmed, licence-checked). |
| B | The existing S36g cadence (12 months, 6 for pharmacies); hide at twice that. |
| C | Keep the sweep notify-only, never hide. |

Basis: the spec acceptance test (hide when unverified too long); Nigerian registry and GRID3 data are self-described as non-validated [V]; the intervals are my proposal, not a guideline [U]. Option A changes the S36g design that said it never hides a listing.

### Q22. Ratings
| Option | Detail |
|---|---|
| **A (recommended)** | Verified-visit ratings only (an encounter or order is required, one per visit), moderation with a visible process and a target response time, a reply right for the facility, no rating for a clinician's clinical judgement. |
| B | Labs only for now; defer consultation and facility ratings. |

### Q23. Which bookings sit inside the membership
| Option | Detail |
|---|---|
| **A (recommended)** | Doctor consultations follow the membership rule (Free sees the message route). Dietitian, pharmacist and specialist bookings are priced per item with the price, cancellation and refund terms shown before payment. |
| B | All included in membership. |
| C | All per item including doctor consultations. |

### Q24. Items marked [U] or [V-s]
| Option | Detail |
|---|---|
| **A (recommended)** | Every value tagged [U] or [V-s] stays PROPOSED draft. The CMO reads the named primary document before the matching rule set is signed in the hub. The pack records which. |
| B | Treat [V-s] values as acceptable now; [U] stays draft. |

---

## Decision record (to be filled from the chat answers)

All decided 2026-10-07 in chat by the CMO. Eighteen follow the recommendation; **Q18 and Q24 depart from it** (marked).

| Q | Decision |
|---|---|
| Q1 BP step ladder | A: RTSL Nigeria ladder (amlodipine, +losartan, higher doses, +HCTZ 25, refer; monthly review). Step-4 doses to be confirmed against the PDF. |
| Q2 BP target | A: below 140/90; below 130/80 with CVD, diabetes or CKD, clinician-set. |
| Q3 Severe BP | A: tiered. 180/110+ with no symptoms amber same-day contact; with any symptom red, pages on-call. |
| Q4 Home BP | A: 7 days, two readings morning and evening, discard day 1, mean 135/85+. |
| Q5 Hypoglycaemia | A: below 3.0 or any neuro symptom or assisted event below 3.9 is red; 3.0 to 3.9 asymptomatic amber with 15 g advice and `hypo_follow_up`. |
| Q6 Paging by plan | A: life-threatening class pages on-call for every plan; amber follows entitlement. Needs on-call cover and an SLA. |
| Q7 Diabetes targets | A: ADA targets and ADA prediabetes bound; reporting only. |
| Q8 Diabetes titration | A: triage and insights only in v1; no diabetes proposals. Never insulin. |
| Q9 Multi-condition | A: run each rule set, take the most urgent. |
| Q10 Weight | A: BMI 25 and 30, waist-to-height 0.5 flag; medicines stay a signed clinician decision. |
| Q11 Asthma and COPD | A: reliever log, GINA flags, SpO2 92% line only where the patient has an oximeter. |
| Q12 HF, CKD, SCD, stroke | A: sign HF and CKD thresholds; defer sickle cell and post-stroke. |
| Q13 Programme order | A: Wave A first (panic breathing, pelvic floor, IBS), all guards off. |
| Q14 CBT-I | A: ISI 15+, restriction clinician-gated, 5.5 h floor, exclusions as listed. |
| Q15 Mood and anxiety | A: self-guided below 15; item 9 above zero stops, shows hospital-now card, creates `crisis_follow_up`. |
| Q16 Exclusion lists | A: verified items plus local additions kept as draft until confirmed. |
| Q17 Emergency card | A: hospital now first; aspirin 162 to 324 mg for chest pain if alert and not allergic; never for stroke. |
| **Q18 Numbers (departs)** | **No emergency numbers at all.** Stricter than the recommendation (112 and Lagos 767 only if test-called). No numbers appear anywhere on the card. |
| Q19 Licence | A: MDCN number and checked-on date, re-check yearly. |
| Q20 Care Circle location | A: patient-initiated tap only, consent and revocation, needs guard. |
| Q21 Directory | A: 90/180/365 days, hide at twice cadence, two reports re-verify. |
| Q22 Ratings | A: verified-visit, moderated, with facility reply. |
| Q23 Bookings | A: doctor follows membership rule; dietitian, pharmacist, specialist per item. |
| **Q24 Unverified items (departs)** | **Accept [V-s] values now as design inputs; [U] stays draft.** Less cautious than the recommendation. The [V-s] values (ADA 2025/2026, AHA/ACC 2025, ESC 2024, KDIGO, GINA, WHO snippets) enter PROPOSED config as designed, still unsigned. |

**Consequences to carry into S61 to S65:**
- Q18: the 15.14 "emergency numbers by state" function becomes facilities only; the card never shows a number. Update S56/S65 designs and the crisis card wording to match.
- Q24: [V-s] values drive the draft rule sets, but each rule set is still signed separately in the hub, and the CMO reads the named primary document at that time. [U] items (Q3 headache/visual/neuro extrapolation, Q14 pregnancy and substance exclusions, Q16 Nigerian additions, Q12 sickle cell, pulmonary rehab thresholds, Q21 intervals) stay draft.
- Q6 needs on-call cover and an escalation SLA before the guard can turn on.
- Open OQ-171 (step table) is answered by Q1 for hypertension; OQ-172 (engine proposal review task) is still to be built.

**Attestation, given 2026-10-07:** "I have read this pack and the primary documents I name against it. These selections are my decisions as Chief Medical Officer, recorded for design. I understand they are not signatures and that each rule set will be signed separately in the hub." Attested by the CMO in chat.

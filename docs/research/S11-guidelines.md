# S11 guideline research: answers to OQ-86 and OQ-87

Searched 2026-10-05 (public guideline pages and summaries; full texts of NICE and AHA/ACC were not all retrievable, so a few lines below rest on guideline summaries and are marked). The Nigerian guideline text was read directly. This is evidence for the CMO, not a clinical sign-off.

## Severe-range reading, no symptoms (BP-R2, BP-A1)
- Nigeria 2023-2028 guideline (section 6.13): hypertensive emergency is severe (grade 3, 180/110 or more) hypertension **with acute organ damage**; urgency is severe hypertension **without** it, treated with the usual oral medicines over 24 to 48 hours, **no admission needed**. Diagnosis on one visit is allowed at 180/110 or more with organ damage.
- AHA/ACC 2025: severe hypertension (above 180/120) without organ damage is managed as an outpatient with oral medicines "in a timely manner". AHA public advice: retest after a minute; with chest pain, shortness of breath, back pain, numbness, weakness, vision change or difficulty speaking, call emergency services; without them, contact the care professional.
- ESC 2024: at 180/110 or more assess for a hypertensive emergency (headache, visual disturbance, chest pain, breathlessness, dizziness, neurological symptoms).
- NICE NG136: 180/120 or more with life-threatening symptoms or retinal signs needs same-day specialist assessment.
- WHO HEARTS: 180/110 or more, start treatment and refer; with chest pain, severe headache, weakness or visual loss, ambulance not a car.
- **Answer**: the 180/110 line, and "symptoms decide emergency versus urgent", match every source. BP-R2 (200/130 red with no symptoms) is **more cautious than any guideline found**; it will raise alerts guidelines would manage as an urgent same-day or 24 to 48 hour review. Kept as drafted; flagged to the CMO as an alert-volume decision (option: make BP-R2 amber with a same-day task).

## Pregnancy (OQ-86, gap 1) - evidence is strong, now built
- NICE NG133: severe hypertension is 160/110 or more; admit to hospital; treat; measure every 15 to 30 minutes until below 160/110.
- ACOG CO 767: persistent 160/110 or more over 15 minutes is an emergency, treat within 30 to 60 minutes (stroke risk). Postpartum pre-eclampsia is suspected with high BP plus persistent headache, severe abdominal pain, breathlessness or visual change, or 160/110 on two readings 15 minutes apart; postpartum treatment line 150/100.
- NHS: severe headache, visual disturbance or pain just below the ribs in pregnancy, or in the first 6 weeks after birth, needs urgent contact with maternity services.
- Nigeria 2023-2028: eclampsia and severe pre-eclampsia are hypertensive emergencies; every pregnant woman with hypertension is referred to a specialist; home devices must be validated for pregnancy.
- **Built (draft, PROPOSED)**: BP-P3 red at 160 systolic or 110 diastolic in pregnancy; BP-P4 red for 140/90 or more with headache, visual disturbance, upper-abdominal pain or breathlessness (new symptom code `epigastric_pain`); other pregnant readings stay amber BP-P1 (routed to a clinician). Not yet built: the postpartum (first 6 weeks) state, which has its own 150/100 line; the engine has no postpartum input.

## Red-flag symptom list (BP-R1, BP-A6)
- AHA, NICE, ESC and HEARTS together add **difficulty speaking** and, for AHA, **back pain** (dissection) to the spec's list. **Built**: `difficulty_speaking` and `back_pain` join the red-flag group; the S07 symptom checklist does not offer them yet (S12).
- Chest pain, weakness or numbness, confusion and speech difficulty are emergencies in their own right (heart attack, stroke), which supports BP-A6 showing guidance even with a normal reading (OQ-86 gap 3).

## Low pressure (OQ-86, gap 2)
- Sources define hypotension as systolic under 90 (or 60 diastolic) and call it an emergency with fainting, confusion, chest pain, rapid pulse, cold clammy skin or shortness of breath; asymptomatic low readings are usually benign. This supports BP-R3 and BP-A3 as drafted. **No guideline sets a home action line for a low reading with no symptoms.** Left as a CMO choice (option: amber 24 hour review for systolic under 90 on a patient taking blood pressure medicines).

## Averaging (OQ-86, gap 4)
- ESH, AHA/AMA and the 7-2-2 style protocols average **all** readings: 2 readings 1 minute apart, morning and evening, 3 to 7 days (at least 12 readings for a diagnosis). Duplicate readings in a session are meant to be in the average, so "counted twice" is **not a defect**. ESH drops day 1. BP-A2's minimum of 5 readings is a deliberately lighter screening trigger than the 12-reading diagnostic rule. **Answer: no change.**

## Plausibility limit (OQ-87)
- No guideline sets a "plausible" ceiling. Device validation (ISO 81060-2) tests only 96 to 176 systolic; display ranges come from each manual, and I could not verify 280 or 300 as a standard figure. **Answer: the 299 limit stays as a PROPOSED value; it is a data-quality line, not clinical.**

## Repeat timing (BP-A1)
- AHA public advice retests after 1 minute; the spec rests 5 minutes first (standard measurement preparation). Both are accepted practice; the 5 minute wait is the more cautious reading. No change.

## Emergency wording (OQ-87)
- The wording matches the sources' action (go to hospital now, do not drive yourself, tell them the reading and symptoms) with no phone number, per repo decision. Still needs the CMO and a native Pidgin reviewer.

## Sources
- NICE NG133, hypertension in pregnancy: https://www.nice.org.uk/guidance/ng133/chapter/recommendations (via search summary; page blocked to fetch)
- ACOG Committee Opinion 767 and Practice Bulletin 222 (via the PSMF, CMQCC and ILPQC copies found by search)
- NICE NG136: https://www.nice.org.uk/guidance/ng136
- ESC 2024 elevated BP and hypertension guideline: https://academic.oup.com/eurheartj/article/45/38/3912/7741010
- AHA/ACC 2025 high blood pressure guideline: https://www.ahajournals.org/doi/10.1161/HYP.0000000000000249
- AHA, when to call 911 for high blood pressure: https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/when-to-call-911-for-high-blood-pressure
- AHA/AMA self-measured BP statement: https://www.ahajournals.org/doi/10.1161/CIR.0000000000000803
- WHO HEARTS technical package: https://www.who.int/docs/default-source/ncds/cardiovascular-diseases/heart-package-tool-for-the-development.pdf
- Guidelines for Prevention and Management of Hypertension in Nigeria 2023-2028 (read in full text): https://www.differentiatedservicedelivery.org/wp-content/uploads/HTN-GUIDELINES-2023_2028_21AUG_OK_131023.pdf
- NHS, pre-eclampsia symptoms: https://www.nhs.uk/conditions/pre-eclampsia/symptoms/

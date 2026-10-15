# S11 to S15: CMO decision and sign-off pack (2026-10-07)

Companion to `docs/research/S11-S15-review-and-build-plan.md`. Every clinical choice that plan needs from the CMO is here as a question with the guideline basis, options, consequences and a recommendation. **Nothing here is signed.** The CMO's selections are recorded as decisions (`docs/DECISIONS.md`); an agent never signs. Database signing (`approve_triage_rule_set` and the other `sign_*` RPCs) applies only after a draft rule set exists and the CMO has read its full text, and is a separate step.

## How to read the evidence tags

- **[V]** read directly in the source this session. Only one: the Nigerian National Guideline for the Prevention and Management of Hypertension 2023 to 2028 (FMoH), sections 3.2, 6.5, 6.13 and the grading table.
- **[SEC]** seen in search-result summaries of the guideline, not the guideline text. Check the primary document before signing.
- **[NV]** not verified; recalled from background knowledge. Must be checked by the CMO.
- **[REPO]** what the live code or rule set does today (read from `origin/main-dev`; v3 approved 2026-10-07).

Primary sources the CMO should open:

| Short name | Document |
|---|---|
| NG-HTN | FMoH Nigeria, National Guideline for the Prevention and Management of Hypertension in Nigeria 2023 to 2028 |
| NG-DM | FMoH Nigeria, Guideline for Diabetes Management in Nigeria (2nd edition) [NV: not opened] |
| AHA/ACC 2025 | 2025 AHA/ACC High Blood Pressure Guideline |
| ESH 2023 | 2023 ESH Guidelines for the Management of Arterial Hypertension |
| ISH 2020 | 2020 ISH Global Hypertension Practice Guidelines |
| NICE NG133 | Hypertension in pregnancy: diagnosis and management |
| ACOG PB 222 | Gestational Hypertension and Preeclampsia, Practice Bulletin 222 (2020) |
| ADA SoC 2026 | ADA Standards of Care in Diabetes 2026, section 6 (glycaemic goals and hypoglycaemia) and section 15 (pregnancy) |
| ADA/EASD 2024 | Hyperglycemic Crises in Adults with Diabetes: a Consensus Report (2024) |
| ISPAD 2022 | ISPAD Clinical Practice Consensus Guidelines (children and adolescents) |
| WHO HEARTS / PEN | WHO HEARTS technical package; WHO PEN |
| NDPA / GAID | Nigeria Data Protection Act 2023; NDPC General Application and Implementation Directive 2025 |
| MDCN | Medical and Dental Council of Nigeria: Code of Medical Ethics, primary source verification service, annual licence |

---

## Part 1. Blood pressure (rule set `bp_care_triage` v3)

What v3 does today [REPO]: severe line 180/120, urgent line 180/110, extreme line 200/130 (recheck after 2 hours); red when severe range plus a red-flag symptom (BP-R1); red when systolic below 90 with fainting, confusion or chest pain (BP-R3); pregnancy or first 6 weeks postpartum: red at 160/110 (BP-P3) and red at 140/90 with a pre-eclampsia symptom (BP-P4); pregnant without those routes to a clinician (BP-P1); under 18 routes to a clinician (BP-P2). Repeat after 5 minutes (window 15), silence task at day 7.

### Q1. Keep the old live blood-pressure alerts running next to v3?
- Basis: single deterministic source of truth (INV-01); S12b divergence report exists to compare them. No guideline dictates this; it is a patient-safety consistency question. With 7 test patients and no readings since 18 September, there is no real data yet to show parity.
- Options: **(a) keep both until the live canary and a window of real readings show parity, then retire the old bands in one signed migration (Recommended)**; (b) retire the old bands now (fastest, but v3 has never graded a real reading in production); (c) keep both permanently (risk: one reading, two grades, two pages).
- Consequence of (a): until retired, a reading may page by both paths; acceptable only because there is almost no traffic.

### Q2. How an asymptomatic severe reading is handled (no symptoms, confirmed on repeat)
- Guideline basis: AHA/ACC 2025 [SEC] folds "urgency" into **"severe hypertension" above 180/120 without acute target-organ damage, to be treated as an outpatient**; emergency requires organ damage. ESH 2023 [SEC] gives no fixed emergency BP value, the definition is clinical (organ damage). NG-HTN [V] grade 3 is 180/110 or more; **hypertensive urgency (severe, no organ damage) is treated with oral medicines over 24 to 48 hours, no admission needed; emergency needs severe hypertension plus acute organ damage (6.13).** Home mean 135/85 or more is hypertensive (NG-HTN [V], ESH 2023 [SEC], ISH 2020 [SEC]).
- Today [REPO]: asymptomatic urgent-range reading asks for a repeat after rest; confirmed (or timed out) becomes an amber urgent-review task for a clinician, not an emergency. Symptoms turn it red.
- Options: **(a) keep: repeat, then amber urgent review; red only with symptoms (Recommended; matches NG-HTN 6.13 and AHA/ACC 2025)**; (b) make a confirmed 180/120 or more red even without symptoms (more pages, more false alarms, contradicts the outpatient-treatment position); (c) keep (a) but add a same-day patient-facing "contact your care team today" line at 180/120 or more (adds a patient message, needs wording sign-off, only honest if a clinician can actually respond that day).
- Note: the Free plan does not get doctor time (CLAUDE.md, 2026-08-10); option (c) wording must not promise a review there (OQ-251).

### Q3. Pregnancy and postpartum: red on a single reading, or only after a repeat?
- Guideline basis: NICE NG133 [SEC]: severe hypertension is 160/110 or more; admit for assessment. ACOG PB 222 [SEC]: severe range **persistent for 15 minutes or more** is a hypertensive emergency (urgent treatment, do not wait for proteinuria). ACOG postpartum treatment line 150/100 [NV]. NG-HTN [V]: pregnant women with hypertension should be referred to a specialist; severe pre-eclampsia and eclampsia are treated as emergencies (6.13). Home devices must be validated for pregnancy (6.5 [V]).
- Today [REPO]: red on a single reading at 160/110 or more (BP-P3), with a repeat prompt in parallel.
- Options: **(a) keep red on the first reading and keep the repeat prompt running in parallel (Recommended: the cost of a false red in pregnancy is a hospital visit; the cost of waiting 15 minutes is the risk the guidelines exist to prevent)**; (b) require a repeat after 15 minutes before red (matches ACOG's "persistent" wording, lowers false pages, adds delay in the highest-risk group); (c) red on first reading only with a symptom, otherwise repeat (loosens the current rule).
- Also confirm: postpartum window stays 42 days (6 weeks). Late postpartum hypertension and pre-eclampsia can occur beyond 6 weeks (ACOG [NV]); option to extend the window to 12 weeks for the symptom rule only (BP-P4) — say if you want that.

### Q4. Wrist cuffs and unvalidated devices
- Guideline basis: ESH 2023 and ISH 2020 [SEC] prefer validated upper-arm devices; NG-HTN 6.5 [V] requires devices validated in pregnancy; ESH/AHA recommend a validated device list [NV].
- Today [REPO]: `cuff_type` recorded (upper arm, wrist, not sure); a note is shown for wrist.
- Options: **(a) grade every reading normally, show the note, and add "repeat with an upper-arm cuff if you have one" to the repeat prompt; never downgrade a red because of cuff type (Recommended)**; (b) treat wrist readings as amber at most (unsafe: can hide a true red); (c) refuse wrist readings (excludes many Nigerian patients who own wrist devices).

### Q5. Hypotension line
- Today [REPO]: red when systolic below 90 with fainting, confusion or chest pain; amber below 100 (params `low.redSystolic 90`, `amberSystolic 100`). OQ-67: no guideline fixes a home low-BP number [NV].
- Options: **(a) keep as is, symptom-led (Recommended)**; (b) add red for systolic below 80 regardless of symptoms (needs your clinical judgement; no guideline cited); (c) remove the amber-at-100 line.

---

## Part 2. Glucose (new rule set `glucose_care_triage` v1; today glucose runs on older rules, see the plan's finding 3)

What runs today [REPO, `glucose-red-flags.ts`, TH-CP-DM-001]: severe hypo below 3.0 mmol/L emergency; 3.0 to below 3.9 urgent; glucose 11.0 or more with ketones 3.0 mmol/L or more emergency (suspected DKA); 20.0 or more "very high"; 14.0 persistent-high; ketones 1.5 to below 3.0 moderate. Pattern bands run server-side only.

### Q6. Hypoglycaemia bands
- Guideline basis: ADA SoC 2026 [SEC]: **Level 1 is 3.0 to 3.8 mmol/L (54 to 69 mg/dL), the alert value that needs treatment; Level 2 is below 3.0 mmol/L (54 mg/dL); Level 3 is a severe event with altered mental or physical state needing help from another person, at any glucose value.** ISPAD 2022 [NV] uses the same 3.9 alert and 3.0 clinically significant values for children. NG-DM [NV: not opened].
- Today: the 3.0 and 3.9 numbers already match. **The gap is Level 3: any glucose value with confusion, unable to self-treat, seizure or loss of consciousness is not an explicit red.**
- Options: **(a) adopt the three ADA levels: below 3.0 = red; 3.0 to 3.8 = urgent with a "treat now with fast sugar, recheck in 15 minutes" message; any value with confusion, seizure, unconscious or cannot swallow = red (Recommended)**; (b) keep two bands only; (c) as (a) but also page for recurrent Level 1 (e.g. 2 in 7 days) as an amber review (a pattern rule, needs a number from you).
- Treatment wording ("15 g fast carbohydrate, recheck in 15 minutes", the "rule of 15") is a clinical message that needs your wording sign-off and must be checked against NG-DM [NV].

### Q7. Suspected DKA and ketones
- Guideline basis: ADA/EASD 2024 [SEC]: DKA = glucose above 200 mg/dL (11.1 mmol/L) or known diabetes, **beta-hydroxybutyrate 3.0 mmol/L or more preferred**, and acidosis (pH below 7.3 or bicarbonate below 18). Intermediate ketone bands (1.5 to 2.9 mmol/L = high risk, urgent same-day advice) come from UK JBDS and ISPAD sick-day guidance [NV].
- Today [REPO]: 11.0+ with ketones 3.0+ = emergency; 1.5 to below 3.0 = moderate.
- Options: **(a) keep emergency at glucose 11.0 or more with BHB 3.0 or more (or urine moderate/large); add: BHB 1.5 to 2.9 with vomiting, abdominal pain, fast breathing or drowsiness = red, without those symptoms = urgent same-day review (Recommended)**; (b) keep exactly today's bands; (c) red for any ketones 1.5 or more with glucose above 11.0 (more pages).
- Population note: SGLT2 inhibitors can cause DKA with near-normal glucose (euglycaemic DKA) [NV]. Option to add "on an SGLT2 inhibitor with ketones 1.5+ = urgent" — say if you want it.

### Q8. Severe hyperglycaemia without ketones
- Guideline basis: ADA/EASD 2024 [SEC] HHS is typically glucose 600 mg/dL (33.3 mmol/L) or more with hyperosmolality; symptoms (thirst, confusion, dehydration) drive urgency.
- Today [REPO]: 20.0 "very high"; 14.0 persistent.
- Options: **(a) 20.0 or more = urgent same-day review; 20.0 or more with symptoms (vomiting, drowsy, confused, very thirsty and not keeping fluids down) = red; 33.3 or more = red regardless (Recommended)**; (b) 20.0 or more = always red; (c) leave "very high" as amber only.

### Q9. Who the glucose rules apply to
- Guideline basis: ADA SoC 2026 section 15 [NV]: pregnancy glucose targets are tighter (fasting below 5.3, 1 hour below 7.8, 2 hours below 6.7 mmol/L); ISPAD 2022 [NV]: children and adolescents have their own targets and ketone rules; adult rules misgrade both groups (the same logic the BP engine uses for BP-P1 and BP-P2).
- Options: **(a) the engine grades adults 18+ with type 1 or type 2 only; pregnancy (including gestational diabetes) and under-18 route to a clinician as amber, with the same red lines for severe hypo and suspected DKA applying to everyone (Recommended)**; (b) apply adult bands to all; (c) build pregnancy and paediatric glucose rule sets now (large, needs obstetric and paediatric sign-off, not recommended yet).

---

## Part 3. Critical notifications and the care-team response (S13, S19)

### Q10. Patient critical ladder: does it end in SMS? (OQ-92)
- Basis: INV-08 limits SMS to verification codes and clinician paging (D-12). NDPA 2023 data minimisation and GAID 2025 DPIA expectations [SEC]: a message to a phone number that may be shared or lost carries health risk. Live SMS has never delivered (76 failed, 0 sent).
- Options: **(a) end the patient ladder at push, email and in-app, then clinician-initiated outreach (a call by the on-call clinician); keep SMS for clinicians only (Recommended)**; (b) keep a last-hop SMS for confirmed red when push failed, with generic wording only; (c) leave as is until a sender ID exists.

### Q11. How long a red alert can go unconfirmed before escalation
- Basis: no guideline fixes this. Time-critical logic: ACOG PB 222 [SEC] urgent treatment within 30 to 60 minutes of confirmed severe hypertension in pregnancy; stroke and DKA pathways are time-critical. Today a routine push falls back to email after 240 minutes; that is far too slow for a red.
- Options (values are PROPOSED config, not code): **(a) 10 minutes unopened or unconfirmed, then the on-call clinician is asked to call the patient (Recommended)**; (b) 5 minutes (more calls, more fatigue); (c) 30 minutes (matches the obstetric window but leaves a long gap for glucose or chest pain).
- The patient-side screen still shows the guidance first; this timer is only about a patient who did not see it.

### Q12. Lock-screen and email wording for a red
- Basis: NDPA 2023 sensitive personal data (health) [SEC]; INV-07 (no condition, reading or result in a notification). Today the push is generic ("something needs your attention").
- Options: **(a) keep generic for reds too; the guidance appears only after opening the app (Recommended)**; (b) add a neutral urgency word ("Please open the app now") for reds only; (c) allow plain emergency wording on the lock screen (breaches INV-07, not recommended).

### Q13. Patient "I have sought care" response on a red
- Basis: closes the loop, reduces repeated paging; risk is a patient marking it resolved when it is not. No guideline cited.
- Options: **(a) record the response and show it to the on-call clinician; it never stops paging by itself, only a clinician acknowledgement does (Recommended)**; (b) let the patient response stop paging after the first hospital-bound confirmation; (c) do not build it.

---

## Part 4. Clinician governance (S15, S20)

### Q14. Licence verification standard before a clinician sees patients
- Basis: MDCN [SEC]: annual practising licence; **primary-source verification is offered via the MDCN DataFlow portal, applicant-initiated; there is no public register or API** (S15 research). Founder rule 2026-10-06 [REPO]: current-year licence plus a portal screenshot, graduation certificate and NYSC certificate. Practising without a current licence is an offence and the employer can be liable [SEC].
- Options: **(a) keep the evidence set and also require a recorded MDCN written or DataFlow verification (reference stored) before first independent patient contact for every new clinician; handle the two existing clinicians by recording the same evidence now (Recommended)**; (b) keep the evidence set only, ask MDCN where it matters (today's rule); (c) require DataFlow only for contracted clinicians.

### Q15. How often to re-verify
- Basis: annual licence expiry [SEC]; US NCQA continuous monitoring (30 days) has no Nigerian feed to monitor [SEC], so a human re-check is the substitute.
- Options: **(a) expiry-driven notices at 90, 30 and 0 days (already live) plus a mid-year spot re-check of MDCN status for every active clinician (Recommended)**; (b) expiry-driven only; (c) quarterly re-check (heavier for a small roster).
- Open: the two active clinicians have no licence or indemnity dates on file (OQ-109), so the live sweep protects nobody until ops records them.

### Q16. Review of a new clinician's early cases
- Basis: focused professional practice evaluation (FPPE) and ongoing evaluation (OPPE) are Joint Commission and NCQA concepts [NV]; they are not Nigerian regulation. The percentages are a design choice, not a guideline figure (S15 research).
- Today [REPO, S20]: every red event and titration is audited; 10 percent of the rest; a per-clinician monthly floor; a level 1 clinician's tasks are all audited until a count is met.
- Options: **(a) keep S20's sampling and add: 100 percent of a new clinician's first 20 prescribing or red cases, then taper (Recommended; you set 20)**; (b) keep S20 as is; (c) 100 percent for the first 3 months regardless of count.

### Q17. Patient-facing "verified clinician" badge
- Basis: CLAUDE.md null-gating rule (nothing shown that is not held); CLINICAL_TRUST_MODEL_SPEC. MDCN's own website lists no public register [SEC].
- Options: **(a) show "Licence verified on <date>" only when a stored verification record exists; no badge otherwise; never show the folio number publicly (Recommended)**; (b) show name and specialty only, no badge; (c) show folio number as well (privacy and impersonation risk).

### Q18. Consent for the AI scribe
- Basis: NHS England guidance [SEC] accepts implied consent with disclosure and a right to dissent for individual care; NDPA 2023 requires a lawful basis and, for sensitive data, explicit consent in most cases [SEC, confirm with counsel]; INV-11 [REPO]: the adapter refuses to start without a scribe consent id.
- Options: **(a) explicit, recorded consent at the start of each encounter; a patient can decline without any effect on care (Recommended; already how the adapter works)**; (b) consent once per course of care with a per-visit reminder; (c) implied consent with notice (not recommended under NDPA).

### Q19. Acceptance test before any speech-to-text vendor is used for clinical notes
- Basis: AfriSpeech-MultiBench [SEC, authors affiliated with one vendor]: medical-domain word error rates on African-accented English range from about 15 percent (best vendor) to 27 percent (Whisper-large-v3); Nigerian Pidgin about 30 percent [SEC]. English-only now (D-14). Drug names and doses are the costly errors.
- Options: **(a) no vendor is chosen until a gold set of 20 to 30 consented real consult clips, clinician-corrected, has been scored; thresholds set after seeing results; every drug name and number in a draft is highlighted for the signing clinician (Recommended)**; (b) set a threshold now (overall error at or below 10 percent; you would need to confirm the figure); (c) pick a vendor on published benchmarks (not recommended: vendor-run).

---

## Part 5. Attestation and recording

### Q20. Recording your decisions
- What is recorded: your selections and any free-text notes are written to `docs/DECISIONS.md` as "CMO decision pack S11 to S15" with the date and the evidence tags above, and the open items to `docs/OPEN-QUESTIONS.md`. Nothing is signed in the database. Rule changes are made as new DRAFT rule set versions (BP v4 if Q2, Q3 or Q5 change anything; `glucose_care_triage` v1 for Part 2), shown to you in full, then signed by you through the existing flow.
- Options: **(a) I have read the cited sources for the questions I answered; record my selections as CMO decisions, not as a signature (Recommended)**; (b) record as provisional, I will verify the [SEC] and [NV] items first; (c) do not record.

---

## Items that are founder or counsel decisions, not CMO sign-off

iOS Critical Alerts entitlement; removing the two leftover WhatsApp edge functions; Paystack transfer OTP and approval limits; one NIN/BVN verification vendor pilot; retention periods for credential documents; provider event inbox and reconciliation. All are in the build plan section 4 and 5.

## Limits

Guideline numbers other than NG-HTN came from search summaries, not the documents. NG-DM was not opened. JBDS, ISPAD, ACOG postpartum, SGLT2 and obstetric glucose targets are from memory. Treat every [SEC] and [NV] tag as "check before signing". This is decision support, not clinical advice.

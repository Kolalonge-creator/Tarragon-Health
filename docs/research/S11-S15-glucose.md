# S11 to S15 package P2 (glucose): competitor and guideline research

Date: 2026-10-13. Method: standard web searches (snippet level, 14 queries) plus one full read of the Nigerian guideline draft. Tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. "Adopted" means adapted as a design idea, never copied code, text or visual design. Nothing here is clinical advice; every band and word is for the Chief Medical Officer.

## 1. How a single glucose reading is graded and what the user sees

**Dexcom (G6, G7, Follow)** [V]. Urgent Low is a fixed alert at about 3.1 mmol/L (55 mg/dL) that cannot be turned off or silenced; only the sound or vibrate style and snooze can change, and "Always Sound" lets it break through a silent phone. A separate, earlier "Urgent Low Soon" warns within about 20 minutes of a predicted 55. The reading is a sensor reading, graded by the device, not by a clinician. NF: any clinician paging, any ketone advice.
Adopted: the idea of a floor that is fixed and unmuteable. GL-R1 (under 3.0) is red for everyone and no setting, plan or population route can lower it, and the on-device guidance does not depend on the network. Unsuitable for Nigeria: predictive alerts need continuous sensors, which this population mostly does not wear.

**FreeStyle Libre 2 and LibreLinkUp** [V]. Urgent low fixed at 3.1 mmol/L (55 mg/dL), cannot be disabled in the app, Silent Mode can mute it for up to 6 hours. Low alarm adjustable (the default is 60 per Abbott product pages; a third-party guide says 70, not confirmed). A "signal loss" alarm after 20 minutes; LibreLinkUp (the follower app) has its own urgent low fixed at 55 and a "no recent data" notice.
Adopted: a follower is told only of the fixed severe floor, and silence is a signal (the existing silence rule). Not adopted: user-adjustable alarm levels. A patient-adjustable band is exactly what the CMO sign-off exists to prevent.

**Medtronic Guardian Connect** [V]. Urgent low fixed at 55 mg/dL and cannot be changed; the standard low alert is 70 and adjustable; predictive low alert up to 60 minutes ahead; a 2019 retrospective study of 3,133 users found excursions prevented after 59 percent of predictive low alerts [P, company-linked].
Adopted: two tiers (fixed urgent, adjustable ordinary) mapped onto ADA level 2 (red, fixed) and level 1 (amber, treat now). Not adopted: prediction (needs a continuous stream we do not collect).

**mySugr (Roche)** [V]. Colours follow user-set target ranges: green in range, orange outside, red for hypo or hyper. Hypo and hyper counts on the home screen, symptoms (hypo or hyper feeling) can be logged with the reading. No found treat-now prompt or escalation in the manual (NF, absence of evidence).
Adopted: symptom chips on the glucose entry (the nine signs the rules read), colour always paired with words. Not adopted: user-set ranges deciding the grade.

**Glooko** [V/NV]. Glooko Mobile reminders are about testing (arrive home with no reading in 4 hours), not lows. Glooko holds a patent on flagging a reading under a predefined hypoglycaemia threshold and then prompting for symptoms, causes and treatment (a patent describes a method, not necessarily the shipped app). NF: thresholds or message text.
Adopted: the same ordering as the patent's idea, which is also what the ADA levels imply: number first, then ask about signs. Our entry asks the signs on the same form so one save grades everything.

**Livongo / Teladoc** [V and P]. Meter message after every reading: for a low, treat with juice or glucose tablets and recheck in 15 minutes; for a high, drink water, take medicine as prescribed, recheck in 30 minutes (JMIR 2017 study). Out-of-range defaults vary by source (50 or 60 mg/dL low, 400 high; members can set their own); a coach calls or texts within 3 to 5 minutes; friends and family can be notified if the member opts in.
Adopted: the treat-and-recheck shape of the message (GLU-T01), and the idea that the number alone decides whether a human is told (here: a red pages, an amber opens a same-day task, and a Free patient gets the in-app guidance only). Unsafe or unsuitable for Nigeria: the 400 mg/dL default is far above any line the CMO chose (33.3 mmol/L is 600 mg/dL; 20.0 is the urgent line), and a 3 to 5 minute coach response is not something this platform can promise with its doctor supply. We make no response-time claim in patient wording.

**One Drop** [V]. Predictive low (under 70 mg/dL) and high (over 180) probability alerts, overnight hypo prediction, claimed 87 to 99 percent accuracy from company-sponsored work; coaching around trends. 
Not adopted: any model-based alert. INV-01 forbids a model in triage, and the accuracy numbers are vendor claims.

**BeatO (India)** [V and one user review]. Colour-coded readings (high, low, controlled), emergency SMS to doctor or family on out-of-range readings, a connect-to-educator path. One independent user reports the app crashing during a hypoglycaemic episode and the alert not working when set up.
Adopted: the lesson, not the feature. Guidance must work with no app logic running on a server and no network (the 600 ms on-device budget), and a notification must never be the only way a feature works. Unsuitable: SMS to family is not a patient ladder step here (CMO Q10).

**Lark Diabetes** [V]. AI coach acts as "first line of defence" and escalates a clinically defined crisis to a live clinical resource chosen by the health-system partner; no published thresholds, message text or response target found.
Adopted: nothing to copy. Our escalation is a rule set plus a page and a task, signed by the CMO. Unsuitable: an AI first line (INV-01).

## 2. Guidelines

- **ADA Standards of Care in Diabetes 2026, section 6** [G, NV for 2026 text]. Only the 2025 text and the 2017 classification were retrievable. Level 1 under 3.9 and at least 3.0 mmol/L (70 and 54 mg/dL), level 2 under 3.0, level 3 a severe event with altered mental or physical status needing help from another person, at any glucose. Rules GL-R1 to GL-R3, GL-A1. The 2026 numbers should be checked against the live section 6 before signing; the classification has been stable.
- **ADA/EASD/JBDS/AACE/DTS consensus on hyperglycaemic crises 2024** [P, summary level]. DKA needs glucose 200 mg/dL (11.1 mmol/L) or more or known diabetes, beta-hydroxybutyrate 3.0 mmol/L or more or urine ketones 2+ or more, and acidosis; HHS is 600 mg/dL (33.3 mmol/L) or more with hyperosmolality and no significant ketonaemia. Rules GL-R4, GL-R6. The platform has no pH or bicarbonate, so GL-R4 is "suspected" DKA by glucose plus ketones, which is what the older rule already did.
- **Ketone bands** [P/NV]. A 2026 consensus slide summary (Dhatariya et al.) lists under 0.6 normal, 0.6 to 1.5 elevated, above 1.5 and under 3.0 high ("contact your healthcare professional"), 3.0 or more "seek urgent care immediately". I could not confirm that JBDS itself says "same day" for 1.5 to 2.9: the same-day review in GL-A2 is the CMO's own judgement (Q7).
- **ISPAD 2022** [G, partly]. Sick-day guidance prefers blood ketones; target ketones under 0.6; I could not confirm 1.5 and 3.0 as ISPAD cut-offs and I could not retrieve the hypoglycaemia chapter. Used only for the statement that children have their own targets and rules (GL-P2).
- **Hypoglycaemia treatment** [G/P]. 15 g of fast carbohydrate and recheck in 15 minutes is the standard "rule of 15" (ADA material, ACP MKSAP); one trial summary notes it rests on two 1980s studies and that 15 to 20 g may be needed with modern insulins. The proposed GLU-T01 uses 15 g and says "treat again if still low". IDF/IDF Africa hypoglycaemia guidance: NF, no document found.
- **Euglycaemic DKA with SGLT2 inhibitors** [NV in this review]. The CMO did not choose the SGLT2 rule, so none was added and no SGLT2 field is carried. Note: GL-R5 (raised ketones with vomiting, stomach pain, fast breathing or drowsiness is red at any glucose) already catches the dangerous presentation.

## 3. Nigerian FMoH diabetes guideline (NG-DM): what could and could not be opened

- OPENED: the **24 August 2020 draft** (with reviewers' comments still in the text) of "National Guidelines on the Prevention, Control and Management of Diabetes Mellitus", via differentiatedservicedelivery.org, read from the PDF text. Findings that matter here: it calls a glucose **under 4 mmol/L (72 mg/dL)** low and a danger for people on insulin or sulfonylureas; mild hypoglycaemia is "4 mmol/L or less"; treatment is **fast-acting glucose immediately: half a cup or glass of a sweet drink, 2 cubes or 3 to 4 teaspoons of sugar or honey, 6 large or 12 small jellybeans**; re-test **10 to 15 minutes** after treatment; repeat if still low; severe hypoglycaemia (unconscious, seizure, cannot help themselves) is for specialist care with intravenous glucose; for DKA it lists warning signs including **glucose 13.32 mmol/L (240 mg/dL) or more with illness or ketones in urine** and says to refer to a higher level of care; DKA "cannot be treated at primary care".
- NOT OPENED: the **final 2021 published guideline**. I could not find it; the draft may differ. Every Nigerian-specific statement in this package is therefore [NV] against the final text.
- Effect on the design: the proposed treatment wording now uses the draft's local examples (sweet drink, sugar, honey) instead of glucose tablets, which are not what most people here have. Two differences are shown to the CMO rather than hidden: the draft's "low" line is 4.0 (ours 3.9, the ADA value) and its DKA warning line is 13.3 with urine ketones (ours is 11.0 with blood ketones 3.0 or more or urine moderate or large).
- Not opened and not searched further: the Diabetes Association of Nigeria clinical practice guidelines.

## 4. Where the competitor ideas show up in the build

| Idea | Where |
|---|---|
| Fixed urgent floor that no setting lowers (Dexcom, Libre, Guardian) | `GL-R1`, `GL-R2`, `GL-R3` are red for every patient; the engine ignores plan, age, pregnancy and type for them (`glucose-engine.test.ts`, the "never depend on who the patient is" test) |
| Ask about signs with the number (mySugr symptom log, Glooko patent) | Nine sign chips and an optional ketone result on the same quick-log form (`vitals-screen.tsx`), fed to the same engine call |
| Treat now and recheck message after a low (Livongo meter) | `GLU-T01`, wording in `packages/i18n/src/glucose-wording.json`, unsigned |
| Works with no network (BeatO user review) | `gradeGlucoseOnDevice` with the 600 ms budget, tested with a hanging store and a thrown network error |
| Escalation chosen by the clinical owner, not the vendor (Lark) | Rule set signed by the CMO, task type `amber_glucose_review` confirmed by the CMO, page only from a signed red |
| Do not trust one vendor's thresholds | Guideline basis for every rule on the sign-off hub, with the gaps (`glucose-triage-basis.ts`) |

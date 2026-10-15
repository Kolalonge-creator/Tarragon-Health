# CMO and founder decision pack for S70 to S75 (2026-10-07)

Companion to `docs/research/S70-S75-review-and-build-plan.md`. Part 1 holds clinical items for the CMO. Part 2 holds founder and legal decisions. **Nothing here is signed.** A selection recorded in chat is a decision, not a signature on a platform item; no platform draft exists yet for these, so each becomes PROPOSED configuration (INV-16) when its session is built, and the CMO signs that draft in the normal sign-off screen. An agent never signs a clinical protocol.

Evidence tags: **[V]** read in a source this session, **[SEC]** secondary (search summary, press), **[NV]** recall, not verified. Citations below are from search summaries or memory. **Open the primary document before signing any item tagged SEC or NV.** I did not read full guideline texts this session.

---

## Part 1. Clinical items (CMO)

### C1. Duplicate readings from two sources (S70, 18.9)
**Problem.** A reading from a Bluetooth cuff and the same reading arriving through Health Connect are stored twice, inflating counts and skewing averages used in BP control.
**Options.** (a) clinical device or manual entry outranks wearable estimate, link duplicates, show one; (b) newest wins; (c) keep all, flag only.
**Recommendation (a).** Match on patient, type, value within a tolerance, and a time window (BP 10 minutes, glucose 5 minutes). Keep both rows, link them, count once. Reason: wearable BP and glucose are estimates; a validated cuff is the better measurement. Home BP guidance requires validated devices [SEC: ESH 2023 emphasis on validated devices; ValidateBP list].
**Needs signing:** precedence order and time windows.

### C2. CGM glucose and the red-flag engine (S70, 18.5)
**Problem.** CGM readings arrive every few minutes and currently skip the glucose red-flag engine by design. A person on a sensor can be low or high for hours with no clinician signal.
**Guideline basis.** International Consensus on Time in Range: more than 70% of readings 3.9 to 10.0 mmol/L, under 25% above 10.0, under 5% below 3.9 [SEC, confirmed by search]; below 3.0 mmol/L under 1% [NV]; above 13.9 under 5% [NV]. ADA Standards of Care 2026 call for individualised goals and CGM-derived measures alongside HbA1c, HbA1c under 7% for most adults [SEC].
**Options.** (a) sustained-event rules: low below 3.0 for 15 minutes or below 3.9 for 60 minutes, high above 13.9 for 120 minutes, raising a clinician task and showing the existing emergency safety copy for severe lows; (b) a daily summary review only; (c) leave as is.
**Recommendation (a),** thresholds in PROPOSED config, tested by replaying CGM traces. Severe low must reach the patient at once offline-capable (INV-06 spirit). Alert text neutral (INV-07).
**Needs signing:** thresholds, durations, patient wording, who is paged.

### C3. Irregular rhythm from a personal ECG device (S70, 18.6)
**Guideline basis.** A single-lead recording of 30 seconds or more can be diagnostic only after a physician reviews it; screen-positive results need confirmation [SEC: ESC AF guidance via search]. Tarragon shows the device's own cleared result and never reads the tracing itself.
**Options.** (a) any device-flagged irregular or inconclusive result creates a routine-priority clinician task within one working day, patient told a clinician will review; symptoms plus irregular rhythm (chest pain, fainting, breathlessness) go through the existing red triage; (b) every result urgent; (c) patient notice only.
**Recommendation (a).** No diagnosis wording to the patient. Notification neutral.
**Needs signing:** priority, review window, patient wording.

### C4. Photo-captured readings (S70, 18.3)
**Problem.** Many Nigerian home devices have no Bluetooth. A photo of the screen read on the phone, always confirmed by the patient, brings those readings in.
**Guideline basis.** Home BP of 135/85 mmHg or above defines hypertension in 2017 ACC/AHA, 2018 ESC/ESH, JSH 2019 and ISH 2020 [SEC]; guidance stresses validated upper-arm devices [SEC].
**Options.** (a) photo capture allowed for any device, stored as patient-confirmed device reading with a "photo-confirmed" label, same triage as manual, plausibility checks, and an in-app prompt to use an upper-arm validated cuff; (b) allow only for devices on the recommended list; (c) do not build.
**Recommendation (a).** Wrist cuffs get a "less reliable" note; no value is ever saved without patient confirmation.
**Needs signing:** device-type warning wording, whether wrist devices are accepted.

### C5. Recommended device list criteria (S70, 18.2)
**Recommendation.** A model is listed only if (1) it appears on the ValidateBP list or has a published validation to ISO 81060-2 or AAMI/ESH/ISO universal standard [SEC], (2) it is NAFDAC-registered or sold by an authorised local distributor, (3) the distributor name is recorded. Glucometers: manufacturer ISO 15197 compliance [NV]. The CMO owns the list; Tarragon sells nothing.
**Options.** (a) the recommendation; (b) distributor availability only; (c) no list.

### C6. BP control definition for outcome reports (S75, 22.1; OQ-213)
**Problem.** Home and clinic thresholds differ. S38 uses the person's own target, else 140/90.
**Guideline basis.** Home threshold 135/85 [SEC]; clinic threshold 140/90 [NV, long-standing]; many guidelines recommend a treated target under 130/80 where tolerated [NV: ISH 2020, ESC/ESH 2023, ACC/AHA]; the Nigerian national hypertension guideline 2023 to 2028 [V per earlier pack, primary text not re-read].
**Options.** (a) home readings controlled below 135/85 (7-day average), clinic readings below 140/90, a named personal target overrides; report which basis was used; (b) a single 130/80 target for all; (c) keep the current 140/90 default only.
**Recommendation (a).** Report home and clinic basis separately; never mix in one rate.

### C7. Other outcome measures (S75, 22.1)
Proposed definitions, all PROPOSED config:
- **HbA1c:** change from baseline at 90 and 180 days; improvement of 0.5 percentage points or more reported as "meaningful" [NV]; share under 7% for adults without frailty or pregnancy [SEC].
- **Weight:** share with a loss of 5% or more [NV, common programme benchmark]; excluded for pregnancy and under 18.
- **PHQ-9 and GAD-7:** cut-off 10 or more is the usual screen [SEC]; a change of about 5 (PHQ-9) and 4 (GAD-7) is the common meaningful change, but estimates vary with baseline severity [SEC, confirmed by search]; response = 50% reduction and remission = under 5 [NV].
**Options.** (a) the above, with severity-banded reporting and the caveat shown; (b) fixed 5-point rule only; (c) defer mental health outcomes until a clinical lead owns them.
**Recommendation (a),** and any person with a PHQ-9 item 9 above zero or a score of 20+ is handled by the existing mental-health follow-up, never by the report.

### C8. "Accuracy" language for the triage dashboard (S75, 22.4)
The live dashboard measures agreement between the automatic grade and a clinician's grade, not accuracy against what happened to the patient (OQ-255).
**Options.** (a) rename to "agreement", publish no accuracy figure until an outcome-linked study with a stated design exists; (b) keep "accuracy"; (c) hide until data exist.
**Recommendation (a).** A published validation precedent of this kind exists for other symptom tools [NV]; the design, not the number, must come first.

### C9. Risk stratification safeguards (S75, 22.3)
Scores are deterministic with reasons, worklist ordered for clinician call-back, never used to deny or delay care (spec).
**Options.** (a) keep deterministic, add a monthly fairness review by the CMO (by age band, sex, region, language), no ML model until 90 days of real data; (b) start an ML model now; (c) stop the worklist.
**Recommendation (a).**

### C10. Paid two-week CGM programme (S70, 18.5; decision D8)
Eligibility proposal: adults 18+ with type 2 diabetes or prediabetes not on insulin or sulfonylurea, not pregnant; people on insulin go to their own clinician. Stop rules: any severe low, sensor skin reaction, or patient request. Output: a clinician-reviewed 14-day report (time in range, variability) and a plan; no new medicine without a prescriber (INV-02). ADA 2026 supports CGM in more people and individualised goals [SEC].
**Options.** (a) approve the clinical protocol now, launch only when sensor supply and price are fixed; (b) defer the whole programme; (c) include insulin users.
**Recommendation (a),** protocol drafted by the CMO into the protocol sign-off screen, nothing sold until then.

### C11. Minimum cell size for sponsor and public figures (S75, D7)
Current: 20 for one attribute, 30 for two, with complementary suppression; several surfaces enforce it separately. Statistical disclosure practice often uses 5 to 11 as a floor [NV]; 20 is stricter. The Nigeria Data Protection Act 2023 is the national law [V]; my search found nothing in it that sets a number, so this is a policy choice and the DPO or counsel should confirm (OQ-233).
**Options.** (a) keep 20/30, enforce in one database function; (b) lower to 10; (c) per-sponsor setting.
**Recommendation (a).**

---

## Part 2. Founder and legal decisions

| ID | Decision | Recommendation |
|---|---|---|
| D1 | Device shop vs the 2026-08-02 no-import decision | Partner-fulfilled listing, distributor is seller of record; no stock; band stays paused (D-22) |
| D2 | Points at checkout vs OQ-08 | Single-use reduction on Tarragon's own fee only, never a balance; remove kobo conversion |
| D3 | Instalments (19.10) | Licensed partner carries the credit risk; Tarragon never lends; counsel to confirm |
| D4 | Community Access Fund vehicle | Counsel first; donation is a restricted gift tied to a named grant, never a user balance |
| D5 | Subscriptions (20.2) | Do not rebuild plans; audited admin enable toggle on Membership; disable six old Paystack Plan codes |
| D6 | HMO eligibility (19.6) | Adapter plus manual ops verification fallback; hashed member number; no capitation |
| D9 | Photo capture engine | On-device text recognition first; server vision only through the AI governance registry |
| D11 | Partner settlement scope | Only where Tarragon collects and owes a partner; labs owe nothing (D-06) |
| D12 | Personal ECG route | Upgrade the existing report upload and add HealthKit ECG classification; no vendor API |

## Records after selection
Selections go into `docs/DECISIONS.md` (D-series) and `docs/OPEN-QUESTIONS.md` when the founder asks. D-22 is still missing from `DECISIONS.md`.

---

## Selections recorded in chat, 2026-10-07 (NOT a signature)

Chosen by the founder/CMO in a chat prompt. No platform draft exists for these yet, so nothing was signed in the database. Each becomes a PROPOSED config draft when its session is built; the CMO signs that draft in the sign-off screen after opening the primary guideline documents tagged SEC or NV above.

| Item | Selection | Note |
|---|---|---|
| C1 Dedup | Device or manual outranks wearable, link, count once | As recommended |
| C2 CGM alerts | Sustained-event rules | Thresholds to be drafted and signed later |
| C3 ECG rhythm | Routine clinician task within 1 working day | As recommended |
| C4 Photo reading | Any device, labelled photo-confirmed | As recommended |
| C5 Device list | Validated and NAFDAC or authorised distributor | As recommended |
| C6 BP control | **Keep 140/90 default only** | Differs from recommendation (home below 135/85, clinic below 140/90). Consequence: home readings, which run lower than clinic readings, are judged on the clinic threshold, so control may be overstated. Revisit before any sponsor-facing report. |
| C7 Outcomes | Severity-banded with caveat | As recommended |
| C8 Accuracy | Rename "agreement", no accuracy claim | As recommended |
| C9 Risk model | Deterministic plus monthly fairness review | As recommended |
| C10 CGM programme | Approve protocol, launch later | CMO drafts protocol; nothing sold yet |
| C11 Min cell | Keep 20 and 30, one database function | Counsel/DPO to confirm (OQ-233) |
| D1 Device shop | **Keep guidance only** | Differs from recommendation. 21.5 and `shop_orders` recorded as not built by decision; no partner-fulfilled listing. |
| D2 Points | Fee-only, order-bound reduction | As recommended; remove kobo conversion |
| D3 Instalments | **No instalments** | Differs from recommendation. 19.10 recorded as not built by decision. |
| D4 Access Fund | Counsel first, restricted gifts | Build with switch off |
| D5 Subscriptions | Audited enable toggle on Membership | Disable six Paystack Plan codes |
| D6 HMO check | Adapter plus manual fallback | No capitation |
| D9 Photo engine | On-device first | |
| D11 Settlement | Only where Tarragon collects | Not labs (D-06) |
| D12 ECG route | Upgrade upload plus HealthKit ECG | |

Effects on the build plan: S74 drops 21.5 (device shop) and S72 drops 19.10 (instalments); S75 keeps one BP threshold.

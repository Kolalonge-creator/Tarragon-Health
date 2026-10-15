# S06 to S10: founder decisions and CMO sign-off pack

Date: 2026-10-07. Companion to `docs/plans/S06-S10-competitor-gap-and-build-plan.md`. Status: DRAFT, for selection in chat. Nothing here is signed.

## How to read this

- **Part A** (D1 to D9) are founder and DPO decisions.
- **Part B** (C1 to C8) are clinical items for the Chief Medical Officer. Each shows the exact proposed text, the guideline it rests on, the options, and a recommendation.
- Choosing an option in chat records a decision. For Part B it records **approval of that exact text**. The signing step itself (the CMO chat-signing method, R6 in the S46-S50 plan) only runs when the versioned config row exists. Those rows are created by S07x, S08x and S09x, which are not built yet. Until then an approved item is "approved text, awaiting its row"; I will not claim it signed, and I will not sign anything the agent has not been told to sign item by item.
- All numbers are PROPOSED values and live in `packages/shared/src/proposed-config`, versioned, never in code (INV-16).

## Guideline base used (what each citation means)

| Tag | Source | How it was read |
|---|---|---|
| **NG-2023** | Guidelines for Prevention and Management of Hypertension in Nigeria 2023-2028 (FMoH). Text extracted and read today | Sections cited by number below |
| **NG-2020** | Nigerian Hypertension Society guidelines 2020 | Existence confirmed; detail not retrieved. Not relied on |
| **TH-CP-HTN-001** | Tarragon hypertension pathway (`guideline/`) | Already signed; this pack must not contradict it |
| **ESH-2023** | European Society of Hypertension 2023 guidelines | From search summaries and ACC commentary, not the full text |
| **AHA/ACC-2025** | 2025 AHA/ACC high blood pressure guideline | From search summaries; full text not read |
| **ISH-2020** | International Society of Hypertension 2020 | From the S07 research note |
| **S11-G** | `docs/research/S11-guidelines.md` (NICE NG133/NG136, ACOG, ESC 2024, WHO HEARTS) | Already in the repo; re-used |
| **WHO-2003** | WHO "Adherence to long-term therapies" | From the S08 research note |
| **NDPA-2023** | Nigeria Data Protection Act 2023 | General principle only; section numbers not verified. Counsel must confirm |
| (bk) | Model background knowledge, not verified today | Re-check before signing |

Limit: this is evidence for the CMO, not a clinical sign-off. Where only a summary was read, the item says so.

---

## Part A: founder and DPO decisions

### D1. Encrypt the phone's local database (SQLCipher)
- **Why:** the offline store holds readings, doses and symptoms unencrypted on 2 GB handsets that are often shared or lost. DHIS2 offers optional encryption at about 10-15% speed cost; `expo-sqlite` supports SQLCipher on SDK 54+.
- **Basis:** NDPA-2023 security-of-processing duty (counsel to confirm the section); privacy-by-design.
- **Options:** (a) Yes, in the one planned native build, with the key in the device keychain and a verified copy-then-delete migration; (b) later; (c) no.
- **Recommend (a).** Cost: a native build and a `runtimeVersion` bump, already needed for Android exact alarms (OQ-73).

### D2. After a forced sign-out, what happens to unsent drafts
- **Why:** today a session expiry wipes drafts and the read mirror (a shared-phone privacy choice); a half-typed reading is lost.
- **Options:** (a) keep drafts, encrypted and tied to the account; wipe the mirror only; (b) wipe everything (today); (c) keep everything.
- **Recommend (a).** Never lose the outbox (already true).

### D3. Remote wipe of a lost phone
- **Why:** no product reviewed documents a safe rule. The outbox may hold unsent clinical readings.
- **Options:** (a) wipe only after one last upload attempt or a 30-day key lease expiry, never silently, with the patient told; (b) immediate wipe on report; (c) no remote wipe.
- **Recommend (a).** A reading is a clinical fact; losing it silently is the failure DHIS2 documents.

### D4. Lock-screen emergency pass (Apple/Google Wallet, widget): default on shared phones
- **Why:** Apple and Android show Medical ID without unlocking, which on a household handset exposes one person's data.
- **Options:** (a) off until the patient turns it on; minimal fields only; (b) on by default; (c) do not build.
- **Recommend (a).** Field list is C8.

### D5. Hosted queue or webhook vendor (Svix, Inngest, Trigger.dev) or stay in-house
- **Why:** payloads would leave the Supabase region. Events already carry ids only.
- **Options:** (a) stay in-house, revisit after DPO review; (b) adopt a vendor now.
- **Recommend (a).**

### D6. Medicine data: who gets NAFDAC Greenbook terms and who picks the interaction source
- **Why:** no official API or redistribution licence for the Greenbook was found; no free interaction source with Nigerian brand coverage was found; S53 cannot seed a catalogue without both.
- **Can international data be used? Yes for generics, not for Nigerian brands (checked 2026-10-07):**
  - openFDA / DailyMed drug labels: US public domain, free for commercial use; give generic-ingredient interaction and warning text; US brand names only.
  - WHO Model List of Essential Medicines (24th, Sept 2025) and WHO ATC: CC BY-NC-SA 3.0 IGO, **non-commercial only**; Tarragon is commercial, so a licence is needed before shipping them.
  - DrugBank: commercial use needs a paid licence. NIH RxNav interaction API: discontinued.
  - Nigeria Essential Medicines List, 7th edition 2020 (FMoH): the national formulary list; not a brand/NAFDAC-number database.
  - Therefore the Nigerian brand-to-generic-to-NRN mapping still needs the NAFDAC Greenbook or a hand-curated list.
- **Options:** (a) hybrid: catalogue from the Greenbook with written NAFDAC terms (fallback: hand-curated top Nigerian brands); interactions as generic-ingredient rules curated from public-domain labels and the Nigeria EML, signed by the CMO and a pharmacist, checker off until signed, unknown drugs say "not checked"; (b) buy a commercial interaction licence; (c) manual entry only, no catalogue or checker; (d) scrape (rejected).
- **Recommend (a).** It uses international data where it is free and legal, keeps the CMO as the signer, and does not block S53.

### D7. A clinician-only white-coat / masked pattern flag
- **Why:** NG-2023 section 6.2 reports masked hypertension in 13% of Nigerians generally and 27% of those treated (REMAH study) and lists who should be checked; section 3.2 lists indications for out-of-office monitoring. Withings markets this; no competitor was verified to do it.
- **Options:** (a) yes, behind a guard, clinician-only, CMO-signed rule (C2); (b) no.
- **Recommend (a).**

### D8. Who owns the test devices
- **Why:** cold start, size, memory and reminder delivery were never measured on real phones. Needed: two Android floor phones (Tecno or Infinix, itel) and one iPhone.
- **Options:** (a) founder supplies the phones; (b) buy them from the project budget; (c) defer the device pass (leaves the claims unproven).
- **Recommend (a) or (b); not (c).**

### D9. Counsel's view on the legal basis for the emergency card and for patient-visible emergency-access logs
- **Why:** NDPA-2023 treats health data as sensitive and needs purpose-specific, withdrawable consent; whether an emergency read rests on "vital interests" needs counsel.
- **Options:** (a) instruct counsel now, before S09x-c ships; (b) ship the card with consent only and no break-glass.
- **Recommend (a).**

---

## Part B: CMO sign-off items

Each item states: proposed text, grounding, options, recommendation. "Evidence" says how well the source was actually read.

### C1. Home blood pressure check protocol v1 (S07x-a)

**Proposed text (patient-facing wording to be simplified and Pidgin-reviewed separately):**
1. Use a validated upper-arm cuff that fits. The cuff bladder should cover at least two thirds of the upper arm; a wrist or finger device, or a watch or ring, is not used for care decisions.
2. Before measuring: rest 5 minutes seated with back supported, feet flat, arm resting at heart level; no smoking or caffeine in the previous 30 minutes; empty bladder; do not talk.
3. Take 2 readings, 1 minute apart, in the morning on waking and in the evening before bed, for 7 days. At least 3 days (12 readings) is acceptable for a first review.
4. Every reading is recorded and counted. The home average is shown only once the gate is met: at least 12 readings over at least 3 days for a "complete" protocol average. Below that the screen says "not enough readings yet" and shows the list.
5. Results go to the care team as a task, not an alarm. Grading of any single reading stays with the signed S11/S12 rule set.

**Grounding:**
- Rest 5 minutes, 30 minutes without smoking or caffeine, bladder emptied, seated with back rest, feet on floor, arm at heart level, no talking, cuff bladder over two thirds of arm: **NG-2023 section 3.1.1**. Validated devices, checkable at stridebp.org: **NG-2023 section 3.1**. Validated devices also required in pregnancy: **NG-2023 section 6.4**.
- "At least 12 measurements comprising duplicate morning and evening recording over three days preceding the clinic visit; morning on waking, evening before bedtime": **NG-2023 section 5.4.5**. Evidence: read in full text.
- 7 days, two readings morning and evening, 1 minute apart: **ESH-2023** (average excludes day 1) and **AHA/ACC-2025** (at least 3 days, preferably 7; validated oscillometric devices; cuffless devices not recommended for clinical assessment). Evidence: search summaries.
- Self-monitoring improves adherence and control: **NG-2023 section 3.2**.
- Averaging every reading was already decided in S11-G ("no change"); **ESH-2023** drops day 1, which is the one place the sources differ.

**Options:**
- (a) Approve as written (7 days target, 3-day / 12-reading minimum, average all readings). **Recommended**: it is the Nigerian minimum with the international target, and keeps S11's signed averaging.
- (b) As (a) but drop day 1 when 6 or more days exist (ESH-2023).
- (c) 3-day protocol only (the Nigerian minimum), no 7-day target.
- (d) Return for changes.

### C2. Home BP thresholds used for the protocol average (S07x-a and OQ-67 residue)

**Proposed text:** On a complete protocol average, home mean 135/85 or above is "above the home hypertension level"; 130-134 / 80-84 is "borderline"; below 130/80 is "within the home target for most adults". The personal target for a treated patient is set by a clinician (default suggestion 130/80, labelled "starting suggestion, not yet confirmed" until `set_by` and `set_at` exist). Wording is "above your target range", never "uncontrolled". Pregnancy lines stay as signed in S11-G (160/110 red; 140/90 with symptoms red).

**Grounding:** home mean 135/85 is hypertension: **NG-2023 table of out-of-office thresholds** (home BP mean 135/85), **ESH-2023**, **ISH-2020**. Treatment target below 130/80: **NG-2023** (general, diabetes, CKD) and **AHA/ACC-2025**. Borderline 130-135 / 80-85: **ESH-2023** summary (search), (bk) re-check. Evidence: Nigerian table read; ESH borderline band from a summary.

**Options:**
- (a) Approve as written. **Recommended.**
- (b) Use 135/85 as the only home line (no borderline band).
- (c) Use 130/80 as the home hypertension line (AHA/ACC-2017 style); more alerts, Nigerian guideline does not support it as the diagnostic line.
- (d) Return for changes.

### C3. Clinician-only white-coat and masked pattern rule (S07x-b)

**Proposed text:** When a patient has both a clinic reading (entered by the care team, `source = clinic`) and a complete home protocol average within 30 days:
- **Possible masked pattern** (untreated) or **masked uncontrolled** (treated): clinic below 140/90 and home mean 135/85 or above.
- **Possible white-coat pattern** (untreated only): clinic 140/90 or above and home mean below 135/85.
The output is one routine clinician task, "pattern for review", visible to the care team only. It is never shown to the patient, never in a notification (INV-07), and never changes a medicine (INV-02). Priority groups for outreach to complete a protocol: diabetes, chronic kidney disease, high-normal clinic BP, hypertension-mediated organ damage.

**Grounding:** definitions and prevalence (masked 13% general, 12% untreated, 27% on treatment; REMAH 2017; masked uncontrolled very common in diabetes and CKD): **NG-2023 section 6.2**. White-coat in 15-30% of people with raised clinic BP, no trial answers whether to treat, "clinical decisions remain empirical": **NG-2023 section 6.3**. Indications for out-of-office monitoring (grade 1 hypertension, marked office elevation without organ damage, high-normal office BP, resistant hypertension, high variability): **NG-2023 section 3.2**. Home BP recommended to identify white-coat or masked: **ESH-2023**. Evidence: Nigerian sections read in full; ESH from a summary. Because the Nigerian guideline calls white-coat treatment decisions empirical, the flag only asks for review.

**Options:**
- (a) Approve for all adults with a protocol and a clinic reading. **Recommended** (the data is cheap and the prevalence is high).
- (b) Restrict to the priority groups only (diabetes, CKD, high-normal, organ damage).
- (c) Masked pattern only; no white-coat flag.
- (d) Do not build.

### C4. Cuff and measurement guidance content (S07x-b)

**Proposed text:** (1) Choose a validated upper-arm device; check the model at stridebp.org. (2) Measure your upper arm; the cuff should fit it (the bladder covering at least two thirds of the arm); tell your care team if the cuff is too tight or loose. (3) A cuff that runs on batteries is the safer choice when power cuts are frequent; carry spare batteries. (4) Use the same arm each time (the arm with the higher reading at the first visit). (5) Wrist, finger, watch and ring devices are not used for care decisions. (6) In pregnancy, use a device validated for pregnancy.

**Grounding:** first-visit both-arm rule, cuff sizing table by mid-arm circumference, validated-device requirement: **NG-2023 section 3.1.1**. Pregnancy validation: **NG-2023 section 6.4**. Cuffless devices not recommended for clinical assessment: **AHA/ACC-2025** (summary). Battery advice is a practical Nigerian judgement, not a guideline statement (say so). Evidence: Nigerian text read in full.

**Options:** (a) Approve. **Recommended.** (b) Approve without the battery advice. (c) Return.

### C5. Low blood pressure line (S12, OQ-67 residue)

**Proposed text:** A systolic below 90 (or diastolic below 60) with fainting, confusion, chest pain, rapid pulse, cold clammy skin or breathlessness is an emergency (already BP-R3 / BP-A3 in the S11 draft). **Asymptomatic low readings:** Option A raises an amber 24-hour care-team review for systolic below 90 only in a patient taking blood pressure medicines.

**Grounding:** S11-G found that sources define hypotension as under 90 systolic and treat it as an emergency only with symptoms, and that **no guideline sets a home action line for a low reading without symptoms**. NG-2023 mentions postural hypotension evaluation in treated patients under out-of-office monitoring (section 3.2). This is a clinical judgement, not guideline-derived. Evidence: confirmed absence in guidelines.

**Options:** (a) Amber 24-hour review for systolic below 90 on a patient taking BP medicines. **Recommended** (a medicine-related risk, low alert volume). (b) No action without symptoms. (c) Amber for everyone with systolic below 90.

### C6. Medicine adherence display and the review trigger (S08, OQ-75)

**Proposed text:** Weekly adherence is shown as "doses you marked taken", over the last 7 completed Lagos days, only when at least 3 doses were due; as-needed medicines excluded; a skip is shown separately and counts as not taken; a clinician-held medicine is excused. It is a self-report and never described as a clinical measure or a grade. Review trigger (care-team task, never an alarm): weekly adherence below 80% for 2 consecutive weeks, or 3 consecutive missed doses of a medicine the clinician marked critical.

**Grounding:** **WHO-2003**: adherence to long-term therapy about 50% in developed countries, worse in developing; a multi-factor problem. The 80% line is a population convention from claims-based measures, not a clinical cut-off for any drug, and self-report overestimates adherence (the same point is made in **NG-2023 section 5.4.5**: questionnaires overestimate adherence; interventions that improve it include linking therapy to habits, self-monitoring of BP, simplified dosing). Evidence: Nigerian text read; WHO from the S08 note.

**Options:** (a) Approve as written. **Recommended.** (b) Raise the review line to 90% for critical medicines (antiretroviral-style). (c) Review trigger on two missed weeks only, no consecutive-doses rule. (d) Return.

### C7. As-needed (PRN) limits and interaction wording (S08x, S53)

**Proposed text:** (1) A clinician may set, per medicine, a minimum gap and a daily maximum for as-needed use. If the patient logs a dose outside them, the app says "This is sooner than your care plan says. Check with your care team before taking another" and does not block the log. The app never suggests a double dose after a missed one. (2) Interaction and duplicate warnings use three tiers (Critical, Serious, Moderate), always advise contacting the care team, never tell the patient to stop a medicine, and say "not checked" for any medicine not in the signed dataset. (3) The checker stays off until a signed dataset exists.

**Grounding:** this is a **clinical-safety judgement**; no national guideline for app-level PRN limits was found. Three-tier alert design follows Apple's published scheme (Critical, Serious, Moderate); clinicians override up to 95% of computerised alerts (AHRQ PSNet), which is why tiers and plain wording matter. "Not checked": unlisted drugs are not checked by Apple Health. NG-2023 section 5.4.5 supports simplified regimens. Evidence: competitor and AHRQ summaries; not guideline-grounded. The CMO and a pharmacist should treat this as their own call.

**Options:** (a) Approve as written; limits are clinician-set per medicine, no defaults. **Recommended.** (b) PRN limits for named drug classes only (analgesics, bronchodilators). (c) Defer PRN limits; approve the interaction wording only. (d) Return.

### C8. Emergency card: what the lock-screen pass may show (S09x-c)

**Proposed text:** Lock-screen and wallet pass show only: initials, blood group, genotype with its provenance badge, "allergies on file" (not the allergens), the emergency contact's phone number, and "full record needs your unlock". Everything else (medicines, conditions, allergens, readings) appears only after biometric or PIN, and in the printed card the patient chooses to print. No condition or medicine names on the lock screen.

**Grounding:** blood group and genotype are first-class here (sickle cell trait/disease is common in Nigeria; transfusion and pregnancy decisions depend on them) (bk, the national sickle-cell guideline was not retrieved). Minimum-disclosure principle and sensitive-data consent: **NDPA-2023** (counsel D9). Apple and Android show Medical ID without unlocking and let users pick fields; a shared-phone default is a Nigerian privacy judgement, not a clinical guideline. Evidence: competitor behaviour verified by search; legal basis not verified.

**Options:** (a) Approve; pass is off by default (D4). **Recommended.** (b) Also show allergens on the lock screen (faster for responders, more exposure). (c) Return.

---

## Order of work after selection

1. Record every answer in `docs/DECISIONS.md` (founder items) and `docs/plans/S06-S10-cmo-decisions-2026-10-07.md` (clinical items, with the exact text chosen).
2. P0 housekeeping merges; D8/D9 and D6 are external actions.
3. S06x, S10x, S09x-a can start in parallel worktrees; S07x waits only on the written OQ-67 follow-up for the band set.
4. When each config row exists, the item is signed in chat through the existing CMO signing RPC after you approve that specific row.

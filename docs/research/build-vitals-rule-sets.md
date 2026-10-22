# Research: single-reading dangerous vitals (pulse, SpO2, temperature)

Evidence tags: [G] guideline or regulator, [P] peer reviewed, [V] vendor claim, [NV] not verified, [OLD] the platform's own older live classifier.
Searched 2026-10-16. Nothing here was copied; bands, structure and wording are the platform's own.

## 1. What the bands should be (NEWS2 and oxygen guidance)
- NEWS2 single-parameter points [G, Royal College of Physicians 2017, chart reproduced in NHS documents]: pulse 3 points at 40 or below and 131 or above, 2 at 111 to 130, 1 at 41 to 50 and 91 to 110; SpO2 scale 1: 3 at 91 or below, 2 at 92 to 93, 1 at 94 to 95; temperature 3 at 35.0 or below, 2 at 39.1 or above, 1 at 35.1 to 36.0 and 38.1 to 39.0. Total 0 to 4 low, 5 to 6 medium, 7 or more high; a single parameter of 3 is "low-medium" and still triggers urgent clinical review. Scale 2 (target 88 to 92) only under a clinician's direction.
- BTS oxygen guideline [G]: target saturation 94 to 98, 88 to 92 for people at risk of hypercapnic failure.
- WHO IMCI [G]: fever is 37.5 or above in a young child; heart and breathing rates are age specific.
- Nigerian guidance [NV]: no national threshold set for single home readings was found.

Comparison with the starting values (the live older classifiers, [OLD]): pulse emergency 35 or below / 150 or above is wider than NEWS2's 3-point line (40 / 131); SpO2 emergency under 90 is one point less sensitive than NEWS2's 91; temperature red from 39.0 is close to NEWS2's 39.1 (2 points); under 35.0 emergency matches NEWS2's 35.0 except at exactly 35.0. The older bands were written to avoid alert fatigue on a single logged number, which is the right instinct for a page; the CMO is shown the table and decides.

## 2. How other products handle it
- NEWS2 [G] and hospital early-warning systems: aggregate several parameters (and consciousness, oxygen use) into one score, designed for observations taken by staff on a ward. ADOPTED: the idea of tiers with a different response per tier (our red pages, amber is a review task, green saved) and the "one parameter at its highest score still escalates" principle. NOT ADOPTED: the aggregate. A home reading is a single number from a consumer device with no consciousness or oxygen-use input, and an aggregate would hide which single reading was dangerous. Recorded as a deliberate non-goal.
- Epic Deterioration Index [V/NV]: a 0 to 100 model score over many chart variables, refreshed about every 15 to 20 minutes; the published evidence is largely vendor or health-system material and one independent comparison found it weaker than a vitals model [NV, garbled extraction, not relied on]. NOT ADOPTED: an opaque model (INV-01: no model call in triage). ADOPTED: that the alert goes to a named team with a routed response, which our page and task already do.
- Biofourmis / Cadence remote monitoring [V/NV]: personalised baselines per patient; no public alert-threshold documentation found. ADOPTED in the small: the patient's own clinician-set amber line (already in the platform: patient_spo2_targets, patient_temperature_targets) is carried into the engine, and can only make a reading MORE urgent. A COPD pilot abstract [P, small] suggests per-patient SpO2 limits reduce false alarms; not relied on.
- Withings (ScanWatch heart rate alerts) [V]: alerts only at rest; automatic mode sets limits from the person's own statistics, custom mode lets the person set them; the help text calls 50 to 100 normal. ADOPTED: nothing in code. NOTED: a resting-only rule is a real false-alarm control for wearables, relevant to the open question on wearable readings, which this version does not grade. Omron: no relevant public alert thresholds found [NV].

## 3. Unsafe or unsuitable for Nigeria
- Applying adult resting heart rate bands to children pages parents for normal readings; handled with a clinician route under 18.
- A page for every 121 beats a minute after a walk or with a fever is noisy; the older trigger accepted it. Kept for parity, flagged for the CMO.
- Finger-clip oximeters read low with cold hands, dark nail polish and movement; the wording tells the patient to go for care rather than wait. A repeat-reading flow (as blood pressure has) is a possible later version.
- A known COPD patient with a target of 88 to 92 would be paged at 92; the personal line cannot lower a red. Flagged.
- Malaria and other febrile illness are common; same-day care for 39.0 and above is the safe direction.

## 4. Where this shows in design and code
Tiers and one-parameter escalation: `vitals-care-v1.ts` (red pages, amber task, green saved). Personal line: rules VT-OX4, VT-TE4 and the context function. Resting-only idea: recorded as a follow-up, not coded. No aggregate score: design note section 2.

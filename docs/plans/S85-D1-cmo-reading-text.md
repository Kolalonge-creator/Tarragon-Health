# D1 for the CMO to read: blood pressure at or above 180/120 (draft `bp_care_triage` version 4)

Status: waiting for the CMO. Not signed. Not applied to production. The founder has decided the 180/120 line; the clinical signature is yours.
Where to sign once it is applied: `/clinician/triage-rules` (the newest draft, version 4), by `approve_triage_rule_set`. Signing version 4 retires version 3.

## The rule to sign

1. A blood pressure reading of 180/120 or higher (either number alone) asks the emergency-symptom question. The patient cannot skip it. This replaces the 200/130 line.
2. If the patient ticks any emergency symptom (chest pain, breathlessness, severe or new headache, weakness or numbness, difficulty speaking, confusion, a change in vision, back pain): RED. The patient sees offline emergency guidance with the nearest facility, the on-call doctor is paged at once, a consented Care Circle member is alerted, and a follow-up consultation task is opened.
3. If the patient has none of them: AMBER. The patient is told to take their usual medicine if not yet taken and rest, and a reminder asks them to measure again after 2 hours (with a backup push). Your care team is alerted the same day through the existing Priority 1 alert. If the second reading is still high (180/110 or more), or no second reading is taken within 4 hours, a same-day task is opened for a clinician within 4 hours.
4. Pregnancy and the first 6 weeks after a birth keep their own lines (160/110, and 140/90 with a pre-eclampsia symptom). Under 18 is routed to a clinician. Nothing here changes them.
5. The rule is applied by fixed arithmetic. No model decides any of it.

## What changes for patients

Readings from 180 to 199 systolic (or 120 to 129 diastolic) used to get a 5 minute repeat and a clinician task if confirmed. They now get the symptom question first, then red or the 2 hour recheck. Readings below 180 systolic and 120 diastolic behave exactly as before. A patient with a symptom was already red at 180/120; the difference is that a patient with no symptom is now asked, instead of being sent straight to the 5 minute repeat.

## Decisions still yours (the draft carries today's values, it does not choose)

1. Is "severe or new headache" one symptom or two? The draft keeps one.
2. Should 180/110 be the trigger line instead of 180/120? The draft keeps 180/120 for the question, and keeps 180/110 as the "still high" line at the recheck (one notch stricter than the founder's wording; it never lowers a grade).
3. The recheck window. The draft keeps 2 hours, with the second reading accepted between 2 and 4 hours.

## Things to know before signing

- A phone that has not refreshed its rules (offline, new install) keeps the 200/130 line until it syncs. Same-day clinician contact for a no-symptom reading comes from the existing Priority 1 alert, which exists on paid plans only; its text still says "rest 5 minutes", not 2 hours. Readings entered on the web, by a Bluetooth device or a wearable are not asked the question (only the phone asks); a symptom logged within 10 minutes still gives RED.
- The rule text records the open decisions and cannot be edited after you sign; any change to them needs a version 5 and a second signature.

## Grounding and the honest caveat

- ACC/AHA 2017: above 180/120 with new or worsening target organ damage is a hypertensive emergency; without it, same-day or outpatient review. Checked in secondary summaries.
- NICE NG136: 180/120 or higher with life-threatening symptoms is same-day specialist assessment; otherwise investigate target organ damage promptly and repeat within 7 days. Checked in secondary summaries.
- ESC/ESH 2023 and ISH grade 3 (180/110): VERIFY. Nigerian guidelines (FMoHSW 2023, Nigerian Hypertension Society 2020): VERIFY.
- Neither NICE nor ACC/AHA treats a headache alone as organ damage. RED for a headache here is a deliberately cautious remote-care rule, not a guideline quotation. Please say so in your rationale.

## Tests the CMO can read

- Every reading from 60/30 to 260/140, with and without each symptom, in pregnancy, postpartum and age 16: a red under version 3 is a red under version 4 with the guidance and the page. No symptomatic grade falls.
- 179/119: no question. 180/120, 190/120: the question; a symptom gives red; none gives the 2 hour recheck. 200/130: as before.
- Run `pnpm --filter @tarragon/clinical test` and the DB proof `packages/db/tests/s85d1_bp_care_triage_v4_draft.sql`.

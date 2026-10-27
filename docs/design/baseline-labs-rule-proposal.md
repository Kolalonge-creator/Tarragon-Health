# Baseline labs before starting or increasing a blood pressure or glucose-lowering medicine

Status: PROPOSED for the CMO. Not signed. Nothing here is built as a rule yet. Sign through the CMO sign-off hub once the built check exists; an agent never signs it.

Why this exists: the 2026-10-21 membership decision names a baseline-labs prescribing rule as a condition before the lower tier is switched on. The aim is a rule that works with what is realistic in Nigeria: a partner or own lab, a blood draw, no special equipment.

## The rule (proposed wording)

Before a doctor starts, or increases the dose of, any of the medicines below, the record must hold a result from the last 12 months for the tests listed against it. If it does not, the doctor orders the missing tests first, and the medicine can be started the same day only when the doctor records that the delay would cause more harm than starting (then the tests are done within 7 days).

| Medicine group | Tests required in the record |
|---|---|
| ACE inhibitor or ARB (for example lisinopril, losartan) | Creatinine with eGFR, potassium, sodium. Repeat creatinine and potassium 1 to 2 weeks after starting or increasing. |
| Thiazide-type diuretic (for example hydrochlorothiazide, indapamide) | Creatinine with eGFR, potassium, sodium, fasting glucose or HbA1c. |
| Calcium channel blocker or beta blocker | No blood test required. Blood pressure and pulse checks as usual. |
| Metformin | Creatinine with eGFR (do not start if eGFR is under 30; review the dose if under 45), HbA1c or fasting glucose. |
| Sulfonylurea or insulin | Creatinine with eGFR, HbA1c, fasting glucose. Doctor reviews the hypoglycaemia plan with the patient. |
| Any of the above in a woman who could be pregnant (ACE inhibitor, ARB, statin) | A pregnancy test first, which a patient can do with a pharmacy kit; the doctor records the answer. |

Supporting checks that help but do not block: urine test strip for protein and glucose where available; lipid profile (already in the annual bundle).

## How it fits the platform

- The annual bundle already contains creatinine, potassium, sodium, fasting glucose, HbA1c and lipids. A patient who has done their bundle in the last 12 months already satisfies this rule for every row above except pregnancy. This is the main reason to make the bundle easy for everyone.
- A patient without a recent result gets a doctor-ordered baseline set (creatinine, potassium, sodium, fasting glucose, HbA1c) as a normal self-arranged request they take to a partner lab or their own lab, same as the bundle.
- A rule result that cannot be read (for example an uploaded picture that has not been reviewed) counts as missing, never as passed.
- The check shows the doctor what is missing and why. It never blocks emergency care and never applies to the Free-tier safety guidance.

## For the CMO to decide

1. The thresholds above (eGFR 30 and 45, repeat at 1 to 2 weeks, 12-month freshness, 7-day completion when starting without results).
2. Whether starting before results is allowed at all, and who records the reason.
3. Whether HbA1c can be omitted where a patient has an unreliable HbA1c (sickle cell trait or disease, recent transfusion, anaemia) and fasting glucose should be used; this is relevant in Nigeria.
4. Whether a calcium channel blocker alone really needs no baseline in your protocol.

## Build notes (for the later session, not this one)

A prescribing check on the existing sign-off hub (`lib/queries/cmo-signing-hub.ts`), versioned config under `packages/shared/src/proposed-config`, a proof script that a start without the tests is refused and a start with them passes, and a sabotage step. Nothing in this file is active until signed.

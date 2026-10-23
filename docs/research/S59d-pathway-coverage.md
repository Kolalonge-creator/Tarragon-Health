# S59d pathway coverage matrix (DRAFT, for the Chief Medical Officer)

Status of everything below: DRAFT. Nothing here is signed, activated or approved. The pathways live in ONE unsigned, inactive `triage_protocols` row created by migration `20261023163600_s59d_draft_pathways_protocol.sql`, a superset of the S59 draft (signed adult pathways, chest pain with no severity floor, adult v2 extras, three paediatric pathways). Sign that version, not the S59 draft. The same rules, questions, sources and the questions below are shown on the sign-off panel (`/clinician/clinical-signoff`, "Read every rule, question and source in this version"), from `packages/symptom-triage-engine/src/protocols/s59d-review-notes.ts`.

How sources were handled: one page was fetched and read in the drafting session (the WHO malaria fact sheet). Every other document is named from knowledge and was NOT opened; two links tried (the CDC Hear Her page and an ADA Standards article) failed, so no link is given for them. The CMO checks each claim against the document before signing.

| Pathway key | What it covers | Red flags (emergency / urgent) | Hooks that can only raise | Status |
|---|---|---|---|---|
| `fever` | Adult fever with suspected malaria or typhoid. Redraft of the v2 draft `fever`, same key, every old rule key kept | 10 / 9 | rainy season, Lassa season and states, recent travel (`symptom.risk_tightening` v3); pregnancy with fever or belly pain (`symptom.context_tightening` v3) | Draft, unsigned |
| `pregnancy_danger_signs` | Bleeding, severe headache with sight change, reduced baby movement, severe belly pain, fever, fits, breathing trouble | 7 / 8 | existing pregnancy entries in `symptom.context_tightening` | Draft, unsigned |
| `hypertension_complication` | Severe headache, chest pain, stroke signs, very high reading, breathlessness | 6 / 5 | recent systolic 180 or diastolic 120 from the record (`symptom.context_tightening` v3) | Draft, unsigned |
| `diabetes_complication` | Low sugar, high sugar and DKA signs, foot problems | 9 / 8 | recent low (3.8 or less) or high (20 or more) glucose from the record (`symptom.context_tightening` v3) | Draft, unsigned |
| Reproductive health symptoms | Not drafted | none | none | Skipped on purpose, see "Not drafted" |

Counts are of rules in each category in `s59d-drafts.ts`; a test checks that every pathway has both.

## Safety properties (tested in `s59d-drafts.test.ts`)
- A red flag is final; no walk outcome is an emergency; no red flag is below urgent; the three complication pathways and pregnancy never end in self-care.
- Adult fever can reach self-care only after a negative malaria test, no red flag, drinking and passing urine.
- More input never lowers urgency (10 pathways x 400 random pairs, plus a sabotage case that proves the check can fail).
- Chest pain with sweating is an emergency in the signed pathway, the S59b no-floor draft, the pregnancy pathway and the blood pressure pathway.
- A draft is never live: `liveProtocolConfig`/`selectLivePathway`/`livePathways` return nothing for a row that is not active AND signed, and the safe engine escalates ("protocol unavailable") instead of answering.

## A. Fever (`fever`)
Sources: WHO malaria fact sheet (page read: severe features, test before treat); Nigeria NMEP national guidelines for diagnosis and treatment of malaria (not opened); WHO guidelines for malaria (not opened); WHO typhoid material and Nigerian treatment guidelines (not opened).
Could not be verified: the 3-day prolonged-fever line (the v2 draft said 5); any Nigerian typhoid seasonality (so no typhoid season hook); the 40 C line (carried over from v2); fever in sickle cell disease (urgent or emergency); what travel means within Nigeria.
Changes from the v2 draft: prolonged fever is 3 days not 5; an untested fever ends in routine "get tested", never self-care; a positive test is urgent with a clinician; nine rules added.
CMO questions: F1 to F5 (see `s59d-review-notes.ts`).

## B. Pregnancy (`pregnancy_danger_signs`)
Sources: CDC Hear Her urgent maternal warning signs (not opened, link failed); WHO antenatal care recommendations, danger signs (not opened); NICE NG133 (not opened); RCOG reduced fetal movements guideline (not opened).
Could not be verified: bleeding as urgent versus emergency; gestation is not asked; postnatal signs not covered; no Nigerian maternal protocol checked.
Privacy: pregnancy is sensitive data. The pathway reads nothing from the `reproductive_health` category; it only records what the person ticks in the check. It must only be offered to the pregnant person for themselves (OQ-S59d-05).
CMO questions: P1 to P5.

## C. High blood pressure complications (`hypertension_complication`)
Sources: ESC/ESH and ACC/AHA hypertensive emergency definitions (not opened); FAST and BE-FAST (not opened); NICE NG133 (not opened).
Could not be verified: the no-symptom "urgent" line; home cuff accuracy; Nigerian hypertension guidance.
CMO questions: H1 to H3.

## D. Diabetes complications (`diabetes_complication`)
Sources: ADA Standards of Care, hypoglycaemia levels (not opened, link failed); ADA/EASD hyperglycaemic crises consensus (not opened); IWGDF/IDSA diabetic foot infection guidelines (not opened).
Could not be verified: the 20 mmol/L line; ketone thresholds (not coded); treatment advice for a low sugar (belongs in safety-net advice, OQ-S59d-07); Nigerian diabetes guidance.
CMO questions: D1 to D4.

## Not drafted
Reproductive health symptoms (menstrual, contraception, fertility). They are `reproductive_health` category data, the category the access model protects hardest (no emergency break-glass, guardian gate for adolescents), and a symptom pathway would store the person's answers in a session row that a care-circle grantee can read. That needs a decision on how such answers are stored and shared first (OQ-S59d-06). Postnatal and early-pregnancy pathways are likewise not drafted (P4).

## What the patient wording needs
Forty new `symptom.opt.*` labels were added to `packages/i18n/src/en.ts` so the pathways can be shown. They are plain, English-only and name no diagnosis (tested), but they are new patient-facing clinical wording and need the CMO's wording sign-off before the pathways are signed.

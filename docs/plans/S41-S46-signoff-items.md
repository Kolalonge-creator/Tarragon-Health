# Items for the CMO and founder to sign (S41 to S46), 2026-10-07

**Nothing here is signed.** None of the S42 to S46 migrations is applied to production, so the sign-off rows and screens do not exist yet. Signing happens in the CMO sign-off hub (or the sign RPCs) after the migrations are applied. An agent does not sign; once you approve the text below I can prepare the migration that restates the guard conditions, and you sign the clinical items yourself.

## 1. Yearly Health Report settings (`health_report_config_versions`, v1, PROPOSED, UNSIGNED)

Source: migration `20261007141207_s46_results_serology_health_report.sql` (branch `s46/results-and-health-report`). A care-plan BP target for the patient overrides the default.

| Setting | Proposed value | What it does | Your call |
|---|---|---|---|
| Maximum priorities | 3 | Hard cap on the top section | Confirm |
| Minimum BP readings | 3 | Fewer than this prints "too few readings to judge" | Confirm |
| BP target | below 140 systolic and below 90 diastolic | Default "on target" line | Confirm or change. Some guidelines use below 130/80 for higher-risk people |
| BP borderline margin | 5 mmHg | Within 5 of the line counts as borderline, not pass or fail | Confirm |
| Lab borderline margin | 5 percent | Same idea for lab values against the lab's own range | Confirm |
| Change tolerance | 3 percent | Smaller changes are "same as last year" | Confirm |
| Recheck interval | 4 weeks | Printed with a borderline value | Confirm |
| Priority windows | BP within 4 weeks, lab within 4 weeks, screening within 3 months, risk within 4 weeks | "By when" on each priority | Confirm |
| Trend minimum points | 2 | Fewest results needed to show a trend | Confirm |
| Trend years | 3 | How far back trends reach | Confirm |
| Sections left out of a shared copy | reproductive screening, risk, questionnaires | Shared copy drops these by default | Confirm |
| Statement approved by CMO | false | The fixed statement below cannot be used until this is true | Set when you approve the wording |

## 2. Disclaimer and emergency wording (placeholder text keys, English only)

- **Standing disclaimer** (`disclaimer.screening.standing`, shown on the risk check, calendar and lab results):
  "Screening and reports do not rule out disease. If you feel unwell, speak to your care team."
- **Report statement** (`report.statement.not_rule_out`, in the report's "What this report cannot tell you" section):
  "Screening and reports do not rule out disease. A normal result today does not mean a condition can never develop, and a result outside the range does not mean you have one. If you feel unwell, speak to your care team."
- **Emergency signs** (`report.emergency.signs`):
  "Get help straight away if you have chest pain, trouble breathing, sudden weakness on one side, a very bad headache or fainting. Go to the nearest hospital."

Notes for the reviewer: the emergency text lists signs the app itself should not be diagnosing, so check it against the triage red-flag wording you signed. It says "Go to the nearest hospital" with no number; Nigeria emergency numbers were a standing open item. No em dashes are used.

## 3. Other unsigned clinical values built this round

| Item | Proposed | Where |
|---|---|---|
| Anti-HBs immunity threshold | 10 mIU/mL. A numeric titre never sets immunity on its own until you confirm | S46, `serology_rule_versions` |
| WHO 2019 cardiovascular instrument | Coefficients missing: someone must supply them from the paper's appendix (DOI 10.1016/S2214-109X(19)30318-3), then confirm Nigeria's region and the licence | S45, `risk_instrument_versions` |
| Screening rule set v1 and v2 | v1 is a copy of the live catalogue; v2 is the new serology-aware set | S45/S46, `screening_rule_sets` |
| Immunisation schedule v2 | HPV two doses, no typhoid, R21 per state. Reminders stay paused until signed | S43 |
| Hepatitis rule | Spec rule is active in code: HIV and hepatitis C annual, HBsAg annual until immunity is recorded once | S46, `serology_rule_versions` v2 |

## 4. Go-live guard conditions (proposed text)

Today a guard with no conditions reports "unknown guard" and cannot be switched on. The live `private.go_live_conditions` already differs from the repo (it has `clinical_safety_case_current` as an attestation, and conditions for pharmacy, scribe and payouts), so the new conditions must be added by restating the live function, not the repo copy. Proposed conditions, with "data" meaning checked automatically and "attestation" meaning a person attests:

| Guard | Proposed conditions |
|---|---|
| `risk_instrument_who2019_enabled` | Data: an active signed risk instrument version with verified coefficients. Attestation: Nigeria region mapping confirmed. Attestation: licence for the coefficients checked. Attestation: clinical safety case current |
| `screening_scheduler_enabled` | Data: an active signed screening rule set. Attestation: clinical safety case current |
| `hpv_dna_enabled` | Attestation: positive-result pathway (colposcopy, treatment, confirmatory testing) in place. Data: an active laboratory that offers HPV DNA. Attestation: clinical safety case current |
| `home_kit_sensitive_enabled` | Attestation: clinician human-disclosure path for reactive results in place. Attestation: clinical safety case current |
| `lab_structured_push_enabled` | Data: at least one laboratory with CMO-confirmed code mappings. Attestation: lab panel ranges signed. Attestation: laboratory contract names this channel |
| `document_capture_enabled` (S43, AI-018) | Attestation: AI-018 evaluation recorded. Attestation: model provider data agreement recorded. Attestation: how long the original photo is kept is approved. Attestation: clinical safety case current |
| `health_report_generation_enabled` | Data: report settings signed and active. Data: statement wording marked CMO-approved. Attestation: clinical safety case current |

Decision for you: is "clinical safety case current" required on every one of these, or only on the ones that reach a patient with a clinical conclusion (risk instrument, report, HPV, home kits)? I assumed all clinical guards.

## 5. Hepatitis copy (found and being fixed)

You confirmed hepatitis can be tested yearly. The search found live catalogue copy that now contradicts the rule: the "Know Your Basics" bundle and several lab test descriptions say hepatitis B and C are "done once and kept for life" and "you will never be asked to pay for them again". No such text exists in the app code, marketing pages or i18n. A copy fix is being added to the follow-up build, with blood group and genotype staying once-for-life.

## 6. Build follow-ups now running

- The Health Report sign-off becomes an S16 clinical task instead of routing by care-team assignment. If no suitable task type exists, a new one is added marked unconfirmed and you confirm it.
- Caregivers and guardians can read a dependant's signed report, following the consent matrix and access categories, and honouring handover at 18.

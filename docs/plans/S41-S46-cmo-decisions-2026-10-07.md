# CMO and founder decisions, 2026-10-07 (selected in chat)

Recorded from the user's selections in this session. **These are chat decisions, not signatures.** The sign RPCs and sign-off screens do not exist in production until the S42 to S46 migrations are applied; the formal CMO signature (and each signed value's `version_id`) follows then. Evidence tags: [V] read in a source, [SEC] search snippet, [NV] not verified. Guideline sources are in `docs/plans/S41-S45-cmo-signoff-pack.md` and the research summary below.

## Decided

| # | Decision | Selected | Grounding |
|---|---|---|---|
| 1 | BP "on target" rule | Comorbidity-aware: below 140/90 by default; below 130/80 with diabetes, CKD, known CVD or high CV risk; a care-plan target overrides | Nigeria Hypertension Guideline 2023-2028 [V]; WHO 2021 [SEC] |
| 2 | Minimum home readings for a BP summary | At least 12 readings over at least 3 days, duplicate morning and evening, validated device; always print "based on N readings over D days" | Nigeria guideline [V]; ESH 2023 [SEC] |
| 3 | Borderline | Guideline categories only: BP high-normal 130-139 / 80-89; labs only when outside the lab's own range. The 5 mmHg and 5 percent margins are dropped | No guideline defines a generic margin |
| 4 | Other report settings | Signed as Tarragon product rules, not guideline facts: max 3 priorities, change tolerance 3%, recheck 4 weeks, priority windows (BP 4 weeks, lab 4 weeks, screening 3 months, risk 4 weeks), trends from 2 points over 3 years. Review yearly | Product design |
| 5 | Report statement | Expanded text: "This report summarises your checks. It is not a diagnosis. No test is perfect: a result can wrongly show a problem or miss one, and a normal result today does not mean a condition can never develop. A result outside the range means more tests are needed to know what it means. If you feel unwell or notice anything unusual, speak to your care team, whatever this report says." | NHS screening pages [V]; Cancer Research UK [SEC] |
| 6 | Emergency wording | "Get help straight away if you have chest pain, trouble breathing, sudden weakness on one side, a very bad headache or fainting. Call 112 or your state's emergency line, or go to the nearest hospital." Check the signs against the signed triage red-flag list before it goes live | 112 is the NCC-run national number [SEC]; coverage uneven |
| 7 | Hepatitis B immunity | Anti-HBs of 10 mIU/mL or more is protective. Once recorded (lab-flagged or by a doctor), routine HBsAg stops unless new exposure is recorded. A numeric titre alone never sets immunity | FMOH 2016 hepatitis guideline [V]; CDC [SEC] |
| 8 | HIV and hepatitis C frequency | Risk-based, offered yearly for those who qualify. Not automatic annual testing for every adult | Nigeria FMOH 2016 risk list [V]; WHO [SEC]. Nigeria 2023 HIV guideline interval NOT read [NV] |
| 9 | Guard safety case | Every new clinical guard also requires the attestation "a current clinical safety case and hazard log, signed off" | Matches live guards |
| 10 | CVD risk instrument | Design approved, **instrument held**: WHO 2019 charts, Western sub-Saharan Africa; lab model with cholesterol else non-lab; five bands (under 5, 5-10, 10-20, 20-30, 30 and over); ages 40-74; no scoring where treatment is already indicated (established CVD, BP 160/100 or higher); known diabetes on its own pathway; non-lab above 10 percent triggers further assessment. Held until someone supplies the appendix coefficients, Nigeria's region is confirmed and the licence is checked | WHO CVD Risk Chart Working Group, Lancet Glob Health 2019 [V paper]; Nigeria guideline [V] |
| 11 | Immunisation schedule v2 | **Held** until NPHCDA's current dated schedule is read. Reminders stay paused. Conflict to settle: HPV two doses (founder) vs reported single dose since Oct 2023 [SEC] | NPHCDA / UNICEF / WHO WIISE |
| 12 | Health report sign-off task | Confirmed as built: class 8, due in 7 days, claim timeout 60 minutes, medical officer tier; late reports escalate as an ordinary class 8 task (no on-call page) | Product design |
| 13 | Cervical screening rule | HPV DNA at 35 and 45. Women living with HIV are flagged to the care team, not auto-scheduled by this rule. HPV DNA sale stays behind its own guard | WHO elimination targets adopted by Nigeria [SEC] |
| 14 | Package names and contents | Keep live tier names (screen_core, screen_advanced, screen_comprehensive). HIV, HCV and HBsAg are added by risk and history through the screening rules, not bundled for everyone | Risk-based decision above |
| 15 | Mental-health sections for caregivers | Keep the build's rule: withheld unless an explicit medical_history grant plus, for ages 10 to 17, the young person's waiver. Never shown to Care Circle supporters | Platform privacy rule |
| 16 | Care Circle supporters and reports | No, not at this stage | Product decision |

## Consequences for the builds (not yet done)

- S46 `health_report_config` v1 values change: BP target becomes comorbidity-aware, minimum readings 12 over 3 days, borderline margins removed, statement and emergency text replaced, `statementApprovedByCmo` set only when signed. S46 also assumed hepatitis C annual for everyone, which decision 8 replaces with risk-based yearly.
- S45 screening rule set needs the cervical rule and the risk-based HIV and HCV rules before it can be signed.
- Go-live guard conditions: add the conditions listed in `S41-S46-signoff-items.md` section 4 plus the safety-case attestation on every clinical guard, by restating the live `private.go_live_conditions`.
- The live catalogue copy for "Know Your Basics" was already corrected to yearly hepatitis B and C (S46c).
- Items still blocked: WHO coefficients and region confirmation, NPHCDA schedule, Nigeria 2023 HIV guideline interval, counsel wording for consent.

## Guideline research gaps to close before signing

- Nigeria 2023 HIV guideline retest interval not read.
- WHO's home BP protocol and WHO anti-HBs statement not read.
- Cervical screening guideline text (two-volume national plan) not read; WHO age bands were from recollection.
- Emergency number confirmed only from secondary sources.

# CMO review pack: 27 PROPOSED values awaiting confirmation (2026-10-07)

Source: `packages/shared/src/proposed-config/registry.ts`, latest version of each CMO-owned key, all `proposed`. Confirming a value means publishing a new registry entry (higher version, status `confirmed`) that names who confirmed it and when; the old entry is kept so past decisions can name the version they used (INV-16). Nothing below is confirmed yet. The raw values follow the judgement-call list.

## Judgement calls the reviewer should decide, not skim

1. **Lab reference ranges are not sex-specific** (`lab.panels`). Haemoglobin 12 to 17.5 g/dL is one range for everyone: a man at 12.5 reads as normal; most guidelines put the male lower limit near 13. Creatinine 0.6 to 1.3 mg/dL is also a single range. Decide: split by sex, or accept a wider range and let the clinician judge.
2. **Units** are mg/dL for glucose, creatinine and lipids. Confirm the partner lab (SYNLAB) reports in the same units, or results will be misread by a factor of about 18 (glucose) to 88 (creatinine).
3. **Critical limits**: fasting glucose low 40 and high 400 mg/dL, HbA1c high 14 percent, potassium 2.5 and 6.5, sodium 120 and 160, haemoglobin 7 and 20, white cells 1 and 30, platelets 20 and 1000. These decide what is held and escalated.
4. **Panel names** are still `essential` and `annual_health_check` although packages were removed; the Membership has one annual blood test and review. The hepatitis B surface antigen is already in the annual panel as optional and sensitive. **Anti-HBs is not in it** (decision S46-1 adds it as a clinician add-on in S46a; that will be a new `lab.panels` version for you to confirm).
5. **Silence rule is 5 days** (`triage.silence_rule_days`) but the safety fixture SC-07a uses 6 days and SC-07d treats 4 days as below the line. Spec case 7 says 5. Decide whether "5 days with no readings" triggers on day 5 or day 6.
6. **Home BP starting target below 135/85** (`bp.starting_suggestion_target`): a suggestion before a clinician sets a personal target. Many guidelines use 130/80 for diabetes or kidney disease. Decide whether the starting suggestion should be lower for those patients.
7. **Home measurement protocol** (`bp.home_protocol`): two readings one minute apart, 7 days, 5 minutes rest, none within 30 minutes of caffeine, exercise or smoking.
8. **Lab release**: disclosure of a sensitive positive is attempted 3 times and escalated after 72 hours; the expected-from-SLA fallback is 1440 minutes, while the live escalation SLA for a critical result is 720 minutes (v7, signed 2026-09-04). Check these agree.
9. **Doctor tier names** in `lead.rules` and `queue.task_types` use `medical_officer` and `senior_medical_officer`. Decision F-05 collapses to one doctor tier plus the CMO; the Medical Officer tier is being retired. Decide whether these values should be confirmed as written or revised after that removal.
10. **Fatigue and rota limits** (`lead.rules`): 11 hours minimum rest, 7 consecutive days, 72 hours per 7 days, 8 hours rest after a long on-call shift.
11. **Audit sampling** (`quality.audit`): 10 percent random, always a red event or titration, graduation score 85, no critical misses.
12. **Training pass mark** 80 percent with every red scenario correct; Tier 1 graduation after 20 audited tasks (`clinician.tier1_audited_task_count`).

## Raw values (as they stand in the registry)

### paging.escalation_minutes v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Page escalation times: 5 and 10 minutes)
[
 5,
 10
]

### triage.silence_rule_days v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Silence rule days)
5

### adherence.threshold v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Adherence threshold: 80 percent over 7 days)
{
 "percent": 80,
 "windowDays": 7
}

### clinician.min_practice_years_after_house_job v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Minimum practice years: 2 years after house job)
2

### clinician.training_test v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Training test pass mark)
{
 "passPercent": 80,
 "allRedScenariosCorrect": true
}

### clinician.tier1_audited_task_count v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Tier 1 audited task count)
20

### queue.handback_review_threshold v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Hand-back review threshold: more than 3 in 7 days)
{
 "moreThan": 3,
 "windowDays": 7
}

### clinician.max_lead_patients v1 [proposed] from 2026-09-30
source: docs/BUILD-SPEC-v5.md Section 17 (Max lead patients per clinician)
60

### bp.home_protocol v1 [proposed] from 2026-10-03
source: docs/research/S07.md section 3
{
 "readingsPerSession": 2,
 "minGapMinutes": 1,
 "targetDays": 7,
 "restMinutes": 5,
 "avoidBeforeMinutes": 30,
 "morningHours": [
  4,
  12
 ],
 "eveningHours": [
  17,
  24
 ]
}

### bp.average_gate v1 [proposed] from 2026-10-03
source: docs/research/S07.md section 3 (Omada averaging gate)
{
 "windowDays": 7,
 "rules": [
  {
   "minReadings": 3,
   "minDays": 3,
   "minPerDay": 1
  },
  {
   "minReadings": 4,
   "minDays": 2,
   "minPerDay": 2
  }
 ]
}

### bp.trend_display v1 [proposed] from 2026-10-03
source: docs/research/S07.md section 4
{
 "minReadingsForChart": 3,
 "gapBreakDays": 2
}

### bp.starting_suggestion_target v1 [proposed] from 2026-10-03
source: docs/research/S07.md section 3 (home thresholds differ by guideline)
{
 "systolicBelow": 135,
 "diastolicBelow": 85
}

### bp.symptom_checklist v1 [proposed] from 2026-10-04
source: docs/design/S07.md section 3; supabase 20260905011852_symptom_red_flag_handler_pages_a_clinician.sql
{
 "severity": 6
}

### medicines.dose_rules v2 [proposed] from 2026-10-05
source: docs/research/S08.md sections 2 and 5 (decision table rows 4, 5, 9, 15)
{
 "undoSeconds": 120,
 "doubleTapGuardMs": 800,
 "lowSupplyDays": 7,
 "adherenceMinDoses": 3,
 "stalePlanHours": 24,
 "followUpMinWindowMinutes": 30,
 "catchUpMaxItems": 12,
 "catchUpMinGapMinutes": 240,
 "catchUpRetrySeconds": [
  30,
  120
 ],
 "serverMissedAfterMinutes": 720,
 "backdateWindowHours": 72,
 "futureSkewMinutes": 5,
 "maxFollowUps": 8
}

### lab.release_policy v1 [proposed] from 2026-10-06
source: docs/research/S27-competitors.md; docs/design/S27.md
{
 "disclosure": {
  "maxAttempts": 3,
  "escalateAfterHours": 72
 },
 "expectedFromSla": {
  "pathway": "screening_abnormal_result",
  "tier": "urgent_escalation",
  "fallbackMinutes": 1440
 }
}

### lab.panels v1 [proposed] from 2026-10-06
source: docs/design/S27.md; docs/research/S27.md; spec 4.4
{
 "panels": {
  "essential": {
   "analytes": [
    {
     "code": "fasting_glucose",
     "label": "Fasting glucose",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 70,
     "refHigh": 99,
     "criticalLow": 40,
     "criticalHigh": 400
    },
    {
     "code": "hba1c",
     "label": "HbA1c",
     "kind": "numeric",
     "unit": "%",
     "refLow": 4,
     "refHigh": 5.6,
     "criticalHigh": 14
    },
    {
     "code": "creatinine",
     "label": "Creatinine",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 0.6,
     "refHigh": 1.3,
     "criticalHigh": 4
    },
    {
     "code": "potassium",
     "label": "Potassium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 3.5,
     "refHigh": 5.1,
     "criticalLow": 2.5,
     "criticalHigh": 6.5
    },
    {
     "code": "sodium",
     "label": "Sodium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 135,
     "refHigh": 145,
     "criticalLow": 120,
     "criticalHigh": 160
    },
    {
     "code": "total_cholesterol",
     "label": "Total cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 200
    },
    {
     "code": "ldl_cholesterol",
     "label": "LDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 130
    },
    {
     "code": "hdl_cholesterol",
     "label": "HDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 40
    },
    {
     "code": "triglycerides",
     "label": "Triglycerides",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 150
    },
    {
     "code": "alt",
     "label": "ALT",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 7,
     "refHigh": 56
    }
   ]
  },
  "annual_health_check": {
   "analytes": [
    {
     "code": "fasting_glucose",
     "label": "Fasting glucose",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 70,
     "refHigh": 99,
     "criticalLow": 40,
     "criticalHigh": 400
    },
    {
     "code": "hba1c",
     "label": "HbA1c",
     "kind": "numeric",
     "unit": "%",
     "refLow": 4,
     "refHigh": 5.6,
     "criticalHigh": 14
    },
    {
     "code": "creatinine",
     "label": "Creatinine",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 0.6,
     "refHigh": 1.3,
     "criticalHigh": 4
    },
    {
     "code": "potassium",
     "label": "Potassium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 3.5,
     "refHigh": 5.1,
     "criticalLow": 2.5,
     "criticalHigh": 6.5
    },
    {
     "code": "sodium",
     "label": "Sodium",
     "kind": "numeric",
     "unit": "mmol/L",
     "refLow": 135,
     "refHigh": 145,
     "criticalLow": 120,
     "criticalHigh": 160
    },
    {
     "code": "total_cholesterol",
     "label": "Total cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 200
    },
    {
     "code": "ldl_cholesterol",
     "label": "LDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 130
    },
    {
     "code": "hdl_cholesterol",
     "label": "HDL cholesterol",
     "kind": "numeric",
     "unit": "mg/dL",
     "refLow": 40
    },
    {
     "code": "triglycerides",
     "label": "Triglycerides",
     "kind": "numeric",
     "unit": "mg/dL",
     "refHigh": 150
    },
    {
     "code": "alt",
     "label": "ALT",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 7,
     "refHigh": 56
    },
    {
     "code": "ast",
     "label": "AST",
     "kind": "numeric",
     "unit": "U/L",
     "refLow": 10,
     "refHigh": 40
    },
    {
     "code": "haemoglobin",
     "label": "Haemoglobin",
     "kind": "numeric",
     "unit": "g/dL",
     "refLow": 12,
     "refHigh": 17.5,
     "criticalLow": 7,
     "criticalHigh": 20
    },
    {
     "code": "wbc",
     "label": "White cell count",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 4,
     "refHigh": 11,
     "criticalLow": 1,
     "criticalHigh": 30
    },
    {
     "code": "platelets",
     "label": "Platelets",
     "kind": "numeric",
     "unit": "10^9/L",
     "refLow": 150,
     "refHigh": 450,
     "criticalLow": 20,
     "criticalHigh": 1000
    },
    {
     "code": "tsh",
     "label": "TSH",
     "kind": "numeric",
     "unit": "mIU/L",
     "refLow": 0.4,
     "refHigh": 4
    },
    {
     "code": "hiv_screen",
     "label": "HIV screen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hbsag",
     "label": "Hepatitis B surface antigen",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    },
    {
     "code": "hcv_ab",
     "label": "Hepatitis C antibody",
     "kind": "qualitative",
     "unit": "",
     "sensitive": true,
     "optional": true
    }
   ]
  }
 }
}

### written_care.behaviour v1 [proposed] from 2026-10-06
source: docs/design/S22.md; OQ-151; spec 7.3 async_question and 23.16
{
 "monthlyAllowance": 4,
 "windowMinutes": 1440,
 "reminderPercent": 75,
 "followUpDays": 7,
 "maxPhotos": 3,
 "maxPhotoBytes": 8388608,
 "questionMinChars": 10,
 "questionMaxChars": 2000,
 "messageMaxChars": 2000,
 "callDueMinutes": 1440,
 "timezone": "Africa/Lagos",
 "unsignedNoteReminderHours": 24,
 "unsignedNoteLeadHours": 72,
 "correctionResponseDays": 30
}

### care_change.behaviour v1 [proposed] from 2026-10-06
source: docs/design/S24.md
{
 "confirmWindowDays": 7,
 "referralChaseDays": 7,
 "minPatientSummaryChars": 10,
 "minRationaleChars": 10
}

### queue.rules v1 [proposed] from 2026-10-06
source: docs/design/S16.md; spec 7.3 and 7.4
{
 "class3_promotion_window_minutes": 240,
 "escalate_after_due_minutes": 0,
 "dedup_tightens_due": true
}

### lead.rules v1 [proposed] from 2026-10-06
source: docs/design/S18.md; docs/research/S18.md; spec 7.2, 7.5, 7.9
{
 "max_lead_patients": 60,
 "lead_min_doctor_tier": "senior_medical_officer",
 "required_competencies": [
  "lead_clinician",
  "hypertension"
 ],
 "block_min_hours": 2,
 "minimum_guarantee_kinds": [
  "queue",
  "on_call"
 ],
 "rota_max_shift_hours": 24,
 "rota_horizon_days": 14,
 "gap_alert_hours": 48,
 "min_eligible_on_call": 2,
 "fatigue_min_rest_hours": 11,
 "fatigue_max_consecutive_days": 7,
 "fatigue_max_shifts_per_7_days": 3,
 "fatigue_max_hours_per_7_days": 72,
 "fatigue_long_shift_hours": 10,
 "fatigue_max_long_shifts_per_7_days": 4,
 "post_call_rest_hours": 8,
 "post_call_rest_min_shift_hours": 8,
 "contracted_needs_declared_hours": true,
 "contracted_min_declared_hours_per_week": 10,
 "swap_urgent_hours": 4,
 "override_reason_min_chars": 10
}

### paging.rules v1 [proposed] from 2026-10-06
source: docs/design/S19.md; spec 7.9
{
 "escalation_minutes": [
  5,
  10
 ],
 "lead_repeat_minutes": 5,
 "lead_repeat_max": 12,
 "unclosed_alert_minutes": 60,
 "page_access_hours": 24
}

### queue.claims v1 [proposed] from 2026-10-06
source: docs/design/S17.md; spec 7.6 and 7.8
{
 "max_extensions": 1,
 "handback_review": {
  "more_than": 3,
  "window_days": 7
 },
 "handback_cooldown": {
  "count": 3,
  "window_minutes": 10,
  "exempt_reasons": [
   "conflict_of_interest",
   "technical_problem"
  ],
  "hard_count": 6,
  "hard_window_minutes": 60
 },
 "handback_excludes_task_for": [
  "conflict_of_interest",
  "outside_competence",
  "other"
 ],
 "max_pending_self_conflicts": 5,
 "escalated_requires_on_call": true,
 "reliability": {
  "window_days": 90,
  "half_life_days": 30,
  "prior_events": 5,
  "prior_good": 0.8,
  "weights": {
   "completed_on_time": 1,
   "completed_late": 1,
   "claim_expired": 0.5,
   "handed_back_other": 0.25,
   "handed_back_reasoned": 0
  },
  "good": {
   "completed_on_time": 1,
   "completed_late": 0.4,
   "claim_expired": 0,
   "handed_back_other": 0,
   "handed_back_reasoned": 1
  }
 }
}

### quality.audit v1 [proposed] from 2026-10-06
source: docs/design/S20.md; spec 7.8
{
 "sampling": {
  "random_rate_percent": 10,
  "always_reasons": [
   "red_event",
   "titration"
  ],
  "floor_min_tasks": 3,
  "floor_per_clinician_per_month": 1,
  "reviewer_monthly_cap": 40,
  "due_days": 14
 },
 "tier1": {
  "audited_task_count": 20,
  "graduation_min_score": 85,
  "max_critical_misses": 0
 },
 "form": {
  "version": 1,
  "safety_items": [
   "identity_and_consent_confirmed",
   "red_flags_recognised_and_acted_on",
   "decision_within_competence_and_protocol",
   "no_unsigned_treatment_change",
   "safety_netting_and_follow_up_given",
   "escalated_when_needed"
  ],
  "quality_items": [
   "history_adequate",
   "reasoning_documented",
   "communication_clear",
   "plan_appropriate",
   "patient_questions_answered",
   "documentation_timely"
  ],
  "quality_max": 4
 },
 "outcomes": {
  "satisfactory_min": 85,
  "minor_concerns_min": 70,
  "rationale_min_chars": 20
 },
 "reliability": {
  "audit_weight": 2,
  "good_by_outcome": {
   "satisfactory": 1,
   "minor_concerns": 0.6,
   "significant_concerns": 0.2,
   "unsafe": 0
  }
 },
 "speak_up": {
  "acknowledge_hours": 48,
  "immediate_acknowledge_hours": 4,
  "respond_days": 14,
  "max_per_day": 10,
  "retaliation_review_months": 12
 }
}

### queue.task_types v1 [proposed] from 2026-10-06
source: docs/design/S16.md; spec 7.3 and 7.4
[
 {
  "code": "red_event_unacknowledged",
  "priority_class": 1,
  "default_due_minutes": 0,
  "min_doctor_tier": "senior_medical_officer",
  "required_competencies": [
   "on_call"
  ],
  "lead_window_minutes": 0,
  "claim_timeout_minutes": 30,
  "pushable": false,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "critical_result_review",
  "priority_class": 2,
  "default_due_minutes": 120,
  "min_doctor_tier": "senior_medical_officer",
  "required_competencies": [
   "result_review"
  ],
  "lead_window_minutes": 0,
  "claim_timeout_minutes": 30,
  "pushable": false,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "amber_bp_review_due_soon",
  "priority_class": 3,
  "default_due_minutes": 0,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [
   "hypertension"
  ],
  "lead_window_minutes": 0,
  "claim_timeout_minutes": 30,
  "pushable": false,
  "creatable": false,
  "source_task_keys": []
 },
 {
  "code": "amber_bp_review",
  "priority_class": 4,
  "default_due_minutes": 1440,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [
   "hypertension"
  ],
  "lead_window_minutes": 240,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": [
   "urgent_bp_review",
   "bp_review",
   "low_bp_review"
  ]
 },
 {
  "code": "symptom_review",
  "priority_class": 5,
  "default_due_minutes": 1440,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [
   "adult_general"
  ],
  "lead_window_minutes": 1440,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "titration_signoff",
  "priority_class": 6,
  "default_due_minutes": 2880,
  "min_doctor_tier": "senior_medical_officer",
  "required_competencies": [
   "prescribing",
   "hypertension"
  ],
  "lead_window_minutes": 2880,
  "claim_timeout_minutes": 60,
  "pushable": true,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "async_question",
  "priority_class": 7,
  "default_due_minutes": 1440,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [
   "adult_general"
  ],
  "lead_window_minutes": 1440,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "routine_result_review",
  "priority_class": 8,
  "default_due_minutes": 2880,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [
   "result_review"
  ],
  "lead_window_minutes": 1440,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": []
 },
 {
  "code": "admin_clinical",
  "priority_class": 9,
  "default_due_minutes": 4320,
  "min_doctor_tier": "medical_officer",
  "required_competencies": [],
  "lead_window_minutes": 1440,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": [
   "referral_review"
  ]
 },
 {
  "code": "adherence_follow_up",
  "priority_class": 8,
  "default_due_minutes": 2880,
  "min_doctor_tier": "care_coordinator",
  "required_competencies": [],
  "lead_window_minutes": 1440,
  "claim_timeout_minutes": 30,
  "pushable": true,
  "creatable": true,
  "source_task_keys": [
   "adherence_review",
   "silence_check"
  ]
 }
]

### triage.bp_rule_set v1 [proposed] from 2026-10-05
source: docs/design/S11.md; docs/BUILD-SPEC-v5.md Section 6.2; OQ-86, OQ-87
{
 "code": "bp_care_triage",
 "ruleSetVersion": 1,
 "adultAgeYears": 18
}

### triage.wiring_rules v1 [proposed] from 2026-10-05
source: docs/design/S12.md; OQ-88
{
 "symptomLinkMinutes": 10,
 "historyDays": 14,
 "missingEventCatchUpHours": 24,
 "contextBudgetMs": 600,
 "subjectWaitMs": 250,
 "staleAfterDays": 7
}

### reliability.dashboard v1 [proposed] from 2026-10-06
source: docs/design/S36e.md; docs/design/S17.md (reliability is a tie-break only)
{
 "gap_days": 7,
 "min_group": 5,
 "bands": [
  {
   "key": "a",
   "min": 85
  },
  {
   "key": "b",
   "min": 70
  },
  {
   "key": "c",
   "min": 0
  }
 ]
}


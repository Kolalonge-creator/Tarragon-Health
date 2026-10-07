/**
 * Versioned configuration for values the v5 spec marks PROPOSED (Section 17).
 *
 * RULE: a PROPOSED value is loaded from here via `getProposedConfig`, never
 * hard-coded at a call site. The Chief Medical Officer or founder confirms a
 * value by publishing a NEW entry (higher `version`, status "confirmed"); old
 * entries are kept so a past decision can name the version it used (INV-16).
 *
 * This is the code-side registry for values needed before their database home
 * exists (`app_config`, `triage_rule_sets`, `fee schedules`). A later session may
 * move reads to the database; the keys, owners and versions stay the same.
 *
 * Money is integer kobo (INV-15). Values the spec has not yet fixed (triage
 * thresholds 6.2, task due windows 7.3, lead windows and claim timeouts 7.4)
 * are deliberately absent: the sessions that build them add them here.
 */
export type ConfigOwner = "CMO" | "Founder" | "Founder and counsel";
export type ConfigStatus = "proposed" | "confirmed";

export type ConfigValue =
  | number
  | string
  | boolean
  | null
  | readonly ConfigValue[]
  | { readonly [k: string]: ConfigValue };

export interface ProposedConfigEntry {
  readonly key: string;
  readonly value: ConfigValue;
  readonly owner: ConfigOwner;
  readonly status: ConfigStatus;
  /** Monotonic per key, starting at 1. */
  readonly version: number;
  /** ISO date (YYYY-MM-DD) from which this entry applies. */
  readonly effectiveFrom: string;
  /** Where the value comes from, for the reviewer. */
  readonly source: string;
  /**
   * Regex source strings that must never appear in application code: the
   * hard-coded shape of this value. Checked by the repo scan in the test suite.
   */
  readonly guardPatterns?: readonly string[];
}

const SPEC = "docs/BUILD-SPEC-v5.md Section 17";
const FROM = "2026-09-30";

export const PROPOSED_CONFIG: readonly ProposedConfigEntry[] = [
  {
    key: "paging.escalation_minutes",
    value: [5, 10],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Page escalation times: 5 and 10 minutes)`,
  },
  {
    key: "triage.silence_rule_days",
    value: 5,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Silence rule days)`,
    guardPatterns: ["silence\\w*\\s*[=:]\\s*5\\b"],
  },
  {
    key: "adherence.threshold",
    value: { percent: 80, windowDays: 7 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Adherence threshold: 80 percent over 7 days)`,
    guardPatterns: ["adherence\\w*\\s*(>=|<=|<|>)\\s*80\\b"],
  },
  {
    key: "clinician.min_practice_years_after_house_job",
    value: 2,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Minimum practice years: 2 years after house job)`,
  },
  {
    key: "clinician.training_test",
    value: { passPercent: 80, allRedScenariosCorrect: true },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Training test pass mark)`,
  },
  {
    key: "clinician.tier1_audited_task_count",
    value: 20,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Tier 1 audited task count)`,
  },
  {
    key: "queue.handback_review_threshold",
    value: { moreThan: 3, windowDays: 7 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Hand-back review threshold: more than 3 in 7 days)`,
  },
  {
    key: "clinician.max_lead_patients",
    value: 60,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Max lead patients per clinician)`,
    guardPatterns: ["maxLead\\w*\\s*[=:]\\s*60\\b"],
  },
  {
    key: "auth.phone_otp",
    // Spec 8.2: six-digit code, resend after 60 seconds, maximum 5 attempts per hour. Mirrored (not imported) by
    // supabase/functions/auth-send-sms-hook/handler.ts because a Deno function cannot import this package;
    // a test in packages/auth pins the two together.
    value: { codeLength: 6, resendSeconds: 60, maxSendsPerHour: 5 },
    owner: "Founder",
    status: "confirmed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC.replace("Section 17", "Section 8.2")} (Verify: six-digit code, resend after 60 seconds, max 5 attempts per hour)`,
  },
  {
    key: "proxy.setup",
    // Spec 8.2 "Set up for my parent": the setup expires after 72 hours. The per-day cap on how many setups one person
    // may start is not in the spec; it is a PROPOSED abuse limit (each setup costs a verification code SMS). Mirrored
    // in SQL only as an upper bound (create_proxy_setup refuses ttl above 72 and a cap above 20).
    value: { ttlHours: 72, maxPerDay: 5 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC.replace("Section 17", "Section 8.2")} (Set up for my parent: expires after 72 hours); maxPerDay is a proposed abuse limit, not from the spec`,
  },
  {
    key: "commerce.care_pack_price_kobo",
    // 12,000 naira pilot price, stored as integer kobo (INV-15).
    value: 1_200_000,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (12,000 naira care pack for the pilot)`,
    guardPatterns: ["\\b1[_,]?200[_,]?000\\b"],
  },
  {
    key: "commerce.processing_fee_estimate",
    // The estimate shown BEFORE payment for Paystack's processing fee on a local card or bank payment (S25, OQ-97): 1.5 percent
    // plus 100 naira, the 100 waived under 2,500 naira, capped at 2,000 naira. Paystack has no fee-preview call, so this is only an
    // estimate and is labelled as one; the exact fee comes from the verified payment and is recorded on the order and receipt.
    // v1 was unverified; v2 below confirms it against paystack.com/pricing.
    value: { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S25.md section 2 item 7; docs/research/S25.md (Paystack pricing, unverified)",
  },
  {
    key: "commerce.processing_fee_estimate",
    // Confirmed against Paystack's published pricing on 2026-10-06 (v2). Still only an ESTIMATE on screen: Paystack has no fee-preview call,
    // international cards cost more (3.9% + NGN 100, uncapped), and the exact fee is read from the verified payment.
    value: { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000 },
    owner: "Founder",
    status: "confirmed",
    version: 2,
    effectiveFrom: "2026-10-06",
    source: "paystack.com/pricing read 2026-10-06: local card and USSD 1.5% + NGN 100 (NGN 100 waived under NGN 2,500), capped at NGN 2,000; international 3.9% + NGN 100",
  },
  {
    key: "privacy.transcript_retention",
    // Spec: "To confirm with counsel". null means no value exists yet; callers must treat it as unset.
    value: null,
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: `${SPEC} (Transcript retention: to confirm with counsel)`,
  },
  // S07 (Today screen, BP logging, trends, reminders). Every value below is a
  // proposal for the Chief Medical Officer or founder to confirm; none is a
  // clinical threshold the app grades on (grading stays with S11/S12, OQ-67).
  {
    key: "bp.home_protocol",
    // Home self-measurement routine (AHA/AMA, ISH, ESH, WHO HEARTS read for S07):
    // 2 readings at least 1 minute apart, morning and evening, 7 days. The 3-day minimum
    // lives in bp.average_gate. minGapMinutes is applied by the averaging code; the others
    // are read by the guided technique and reminder screens (not built yet).
    // Session hours are local (Africa/Lagos) hour-of-day, start inclusive, end exclusive.
    value: {
      readingsPerSession: 2,
      minGapMinutes: 1,
      targetDays: 7,
      restMinutes: 5,
      avoidBeforeMinutes: 30,
      morningHours: [4, 12],
      eveningHours: [17, 24],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 3",
  },
  {
    key: "bp.average_gate",
    // An average is shown only when one rule is met: at least `minDays` days that
    // each hold at least `minPerDay` readings, with at least `minReadings` readings
    // across those days (the published Omada eligibility rule). Below the gate the
    // app says "not enough readings yet".
    value: {
      windowDays: 7,
      rules: [
        { minReadings: 3, minDays: 3, minPerDay: 1 },
        { minReadings: 4, minDays: 2, minPerDay: 2 },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 3 (Omada averaging gate)",
  },
  {
    key: "bp.trend_display",
    // Fewer than `minReadingsForChart` readings in the window shows a list, not a
    // trend line; a gap of more than `gapBreakDays` days breaks the line.
    value: { minReadingsForChart: 3, gapBreakDays: 2 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 4",
  },
  {
    key: "bp.starting_suggestion_target",
    // Home target shown as a "starting suggestion, not yet confirmed" until a
    // clinician has set a personal target (who and when). Home guidelines differ
    // (135/85 ISH, 135/75 ESH, 130/80 AHA/ACC), so this is a pair to confirm, not a rule.
    value: { systolicBelow: 135, diastolicBelow: 85 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 3 (home thresholds differ by guideline)",
  },
  {
    key: "bp.symptom_checklist",
    // A symptom ticked on the blood pressure form is stored as a symptoms row. The form does
    // not ask the patient to rate it, so it is recorded at this severity, with a description
    // saying it was ticked rather than rated. 6 is the existing server paging line for
    // chest pain, severe headache, vision change and confusion (handle_symptom_red_flag).
    // The CMO confirms the value; grading itself stays with S11/S12 (OQ-67).
    value: { severity: 6 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-04",
    source: "docs/design/S07.md section 3; supabase 20260905011852_symptom_red_flag_handler_pages_a_clinician.sql",
  },
  {
    key: "reminders.behaviour",
    value: { snoozeMinutes: 30, maxSnoozes: 3, missedAfterMinutes: 120, maxPending: 60, horizonDays: 14 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 5 (MyTherapy snooze default; iOS 64 pending cap)",
  },
  {
    key: "reminders.behaviour",
    // v2 (S07 reminders, 2026-10-05): iOS keeps only 64 pending local notifications in total, and
    // two planners now share them: medicines (S08, `maxPending`) and blood pressure
    // (S07, `maxPendingBp`). 44 + 18 = 62, two under the limit, so neither can push the other's
    // soonest reminder out. `maxPending` came down from 60 to make room; everything else is as v1.
    // 18 covers a once-a-day blood pressure reminder for the whole 14-day horizon, and twice a day for 9 days.
    value: { snoozeMinutes: 30, maxSnoozes: 3, missedAfterMinutes: 120, maxPending: 44, maxPendingBp: 18, horizonDays: 14 },
    owner: "Founder",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-05",
    source: "docs/research/S07.md section 5 (iOS 64 pending cap); shared between S07 blood pressure and S08 medicine reminders",
  },
  {
    key: "streaks.rules",
    // Consecutive local days with at least one reading. A freeze is earned every
    // `freezeEarnEveryDays` days of a run, held up to `freezeCap`, and is shown as a
    // freeze, never as a reading.
    value: { freezeEarnEveryDays: 7, freezeCap: 2 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-03",
    source: "docs/research/S07.md section 6",
  },
  {
    key: "medicines.dose_rules",
    // Medicines (S08). The missed window, snooze limits and notification cap come from
    // `reminders.behaviour`, and the weekly percentage band from `adherence.threshold`;
    // this entry holds only what is specific to medicines.
    //  undoSeconds: how long a just-logged dose can be taken back before it leaves the phone.
    //  doubleTapGuardMs: a second tap on the same dose inside this is ignored.
    //  lowSupplyDays: running-low reminder fires when the supply lasts this many days or fewer.
    //  adherenceMinDoses: fewer due doses than this and no percentage is shown.
    //  serverMissedAfterMinutes: the server marks an unanswered dose missed after this long. Longer than the
    //  on-device two hours so a phone that was offline has time to sync a "taken" first (mirrors medicine_config).
    //  followUpMinWindowMinutes: a flexible window at least this long gets one gentle follow-up at its middle.
    //  catchUpRetrySeconds: when the catch-up read fails, try again after each of these delays (then stop until the next app open).
    //  catchUpMinGapMinutes: the catch-up sheet is offered at most this often, so it never nags on every app open.
    //  catchUpMaxItems: the most doses the catch-up sheet asks about at once.
    //  stalePlanHours: a reminder plan older than this is shown as out of date in the health check.
    //  backdateWindowHours mirrors offline_sync_config (S06): the oldest "I took it earlier" time the server keeps.
    value: {
      undoSeconds: 120,
      doubleTapGuardMs: 800,
      lowSupplyDays: 7,
      adherenceMinDoses: 3,
      stalePlanHours: 24,
      followUpMinWindowMinutes: 30,
      catchUpMaxItems: 12,
      catchUpMinGapMinutes: 240,
      catchUpRetrySeconds: [30, 120],
      serverMissedAfterMinutes: 720,
      backdateWindowHours: 72,
      futureSkewMinutes: 5,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-04",
    source: "docs/research/S08.md sections 2 and 5 (decision table rows 4, 5, 9, 15)",
  },
  {
    key: "medicines.dose_rules",
    // Medicines (S08). The missed window, snooze limits and notification cap come from
    // `reminders.behaviour`, and the weekly percentage band from `adherence.threshold`;
    // this entry holds only what is specific to medicines.
    //  undoSeconds: how long a just-logged dose can be taken back before it leaves the phone.
    //  doubleTapGuardMs: a second tap on the same dose inside this is ignored.
    //  lowSupplyDays: running-low reminder fires when the supply lasts this many days or fewer.
    //  adherenceMinDoses: fewer due doses than this and no percentage is shown.
    //  serverMissedAfterMinutes: the server marks an unanswered dose missed after this long. Longer than the
    //  on-device two hours so a phone that was offline has time to sync a "taken" first (mirrors medicine_config).
    //  followUpMinWindowMinutes: a flexible window at least this long gets one gentle follow-up at its middle.
    //  maxFollowUps (v2, S08g): the most follow-ups held at once, earliest first. The rest of the notification cap is
    //  always due reminders, so follow-ups cannot shorten the days of due reminders by more than this. 8 of 44 leaves 36.
    //  catchUpRetrySeconds: when the catch-up read fails, try again after each of these delays (then stop until the next app open).
    //  catchUpMinGapMinutes: the catch-up sheet is offered at most this often, so it never nags on every app open.
    //  catchUpMaxItems: the most doses the catch-up sheet asks about at once.
    //  stalePlanHours: a reminder plan older than this is shown as out of date in the health check.
    //  backdateWindowHours mirrors offline_sync_config (S06): the oldest "I took it earlier" time the server keeps.
    value: {
      undoSeconds: 120,
      doubleTapGuardMs: 800,
      lowSupplyDays: 7,
      adherenceMinDoses: 3,
      stalePlanHours: 24,
      followUpMinWindowMinutes: 30,
      catchUpMaxItems: 12,
      catchUpMinGapMinutes: 240,
      catchUpRetrySeconds: [30, 120],
      serverMissedAfterMinutes: 720,
      backdateWindowHours: 72,
      futureSkewMinutes: 5,
      maxFollowUps: 8,
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-05",
    source: "docs/research/S08.md sections 2 and 5 (decision table rows 4, 5, 9, 15)",
  },
  {
    key: "events.bus_rules",
    // Event bus (S10). The live values are the active row of `event_bus_config` (versioned in the database);
    // this entry mirrors it so the owner and the version are recorded with the other PROPOSED values.
    //  batchSize: deliveries claimed per pass. leaseSeconds: how long a claimed delivery belongs to one worker before another may take it.
    //  maxAttempts: tries before a delivery goes to the dead letter. backoffBaseSeconds doubles each try up to backoffMaxSeconds,
    //  plus up to jitterPercent extra, so retries from many deliveries do not arrive together.
    value: {
      batchSize: 50,
      leaseSeconds: 60,
      maxAttempts: 8,
      backoffBaseSeconds: 15,
      backoffMaxSeconds: 900,
      jitterPercent: 20,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-05",
    source: "docs/design/S10.md; docs/research/S10.md",
  },
  {
    key: "credentialing.rules",
    // Clinician credentialing (S15). The live values are the active row of `credentialing_config` (versioned in the
    // database); this entry mirrors it, and a test fails if the migration seed and this value drift apart. Keys are the
    // database's own snake_case names so the two can be compared directly.
    //  min_practice_years / pass_percent / all_red_correct / audited_task_count repeat the clinician.* spec values
    //  (confirmed together here as one decision record). referees_required and referee_independent_contact: two referees,
    //  reached through an independently sourced institutional contact. test_*: attempt cap, cooldown, scenarios per attempt.
    //  notice_windows_days: licence and indemnity notices at 90 days, 30 days and on the day (founder, 2026-10-06).
    //  grace_max_days: the longest audited grace period a reviewer can record. separate_verifier_and_approver: the person who
    //  verified a check cannot approve. document_*: upload size cap and how long documents are kept after offboarding.
    value: {
      min_practice_years: 2,
      pass_percent: 80,
      all_red_correct: true,
      audited_task_count: 20,
      referees_required: 2,
      referee_independent_contact: true,
      test_max_attempts: 3,
      test_retake_cooldown_hours: 24,
      test_scenarios_per_attempt: 10,
      notice_windows_days: [90, 30, 0],
      grace_max_days: 14,
      separate_verifier_and_approver: true,
      document_max_bytes: 8388608,
      document_retention_years_after_offboarding: 7,
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S15.md; docs/research/S15.md; spec 7.1 and 17",
  },
  {
    key: "credentialing.rules",
    // Version 2 (OQ-104, OQ-108): the same rules plus three. Both switches start off: no real account has a confirmed
    // phone yet and SMS is not live, so requiring one would stop every applicant, and the purge stays off until counsel
    // confirms the periods (the rejected-application period is a proposal).
    value: {
      min_practice_years: 2,
      pass_percent: 80,
      all_red_correct: true,
      audited_task_count: 20,
      referees_required: 2,
      referee_independent_contact: true,
      test_max_attempts: 3,
      test_retake_cooldown_hours: 24,
      test_scenarios_per_attempt: 10,
      notice_windows_days: [90, 30, 0],
      grace_max_days: 14,
      separate_verifier_and_approver: true,
      document_max_bytes: 8388608,
      document_retention_years_after_offboarding: 7,
      require_verified_phone: false,
      document_purge_enabled: false,
      rejected_application_document_retention_months: 24,
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S15.md; OQ-104; OQ-108",
  },
  {
    key: "lab.release_policy",
    // Lab release policy (S27d). Live value is the active row of `lab_panel_signoffs`.config; a test fails if the migration seed and this
    // value drift. maxAttempts and escalateAfterHours are the founder's competitor-research follow-up: a held sensitive result that
    // cannot be disclosed escalates to the CMO and is NEVER released by default. expectedFromSla points at escalation_slas (the source of
    // truth for the contact window); 1,440 minutes is only the fallback if that row is ever missing.
    value: {
      "disclosure": {
        "maxAttempts": 3,
        "escalateAfterHours": 72
      },
      "expectedFromSla": {
        "pathway": "screening_abnormal_result",
        "tier": "urgent_escalation",
        "fallbackMinutes": 1440
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/research/S27-competitors.md; docs/design/S27.md",
  },
  {
    key: "lab.panels",
    // Lab panels and release thresholds (S27). Live values are the active row of `lab_panel_versions`; a test fails if the
    // migration seed and this value drift. Adult reference and critical limits only, NOT signed: the CMO sets them (OQ-176).
    // Any value outside the range holds the result for a clinician, so a wrong range makes more reviews, never an early release.
    value: {
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
              "refLow": 4.0,
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
              "criticalHigh": 4.0
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
              "refLow": 4.0,
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
              "criticalHigh": 4.0
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
              "refLow": 12.0,
              "refHigh": 17.5,
              "criticalLow": 7.0,
              "criticalHigh": 20.0
            },
            {
              "code": "wbc",
              "label": "White cell count",
              "kind": "numeric",
              "unit": "10^9/L",
              "refLow": 4.0,
              "refHigh": 11.0,
              "criticalLow": 1.0,
              "criticalHigh": 30.0
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
              "refHigh": 4.0
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
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S27.md; docs/research/S27.md; spec 4.4",
  },
  {
    key: "written_care.behaviour",
    // Written questions and clinical notes (S22). Live values are the active row of `written_care_config`; this entry mirrors
    // it and a test fails if the migration seed and this value drift. monthlyAllowance 4 was chosen by the build at the
    // founder's request (about one a week beside 12 monthly calls; review after the first month of real use).
    // windowMinutes 1440 is the spec's 24 hour async_question window. Photos: 3 of at most 8 MB, compressed on the phone.
    value: {
      monthlyAllowance: 4,
      windowMinutes: 1440,
      reminderPercent: 75,
      followUpDays: 7,
      maxPhotos: 3,
      maxPhotoBytes: 8388608,
      questionMinChars: 10,
      questionMaxChars: 2000,
      messageMaxChars: 2000,
      callDueMinutes: 1440,
      timezone: "Africa/Lagos",
      unsignedNoteReminderHours: 24,
      unsignedNoteLeadHours: 72,
      correctionResponseDays: 30,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S22.md; OQ-151; spec 7.3 async_question and 23.16",
  },
  {
    key: "care_change.behaviour",
    // Care plan changes (S24). Live values are the active row of `care_change_config`; this entry mirrors it and a test
    // fails if the migration seed and this value drift. A signed change waits confirmWindowDays for the patient before it
    // lapses; a referral is chased after referralChaseDays. Titration thresholds live in the protocol definition, not here.
    value: { confirmWindowDays: 7, referralChaseDays: 7, minPatientSummaryChars: 10, minRationaleChars: 10 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S24.md",
  },
  {
    key: "queue.rules",
    // Task queue rules (S16). Live values are the active row of `queue_config`; this entry mirrors it and a test fails
    // if the migration seed and this value drift. class3_promotion_window_minutes is spec 7.3 ("within 4 hours of its
    // due time"). dedup_tightens_due: a repeat trigger merging into a live task pulls the due time earlier, never later.
    value: { class3_promotion_window_minutes: 240, escalate_after_due_minutes: 0, dedup_tightens_due: true },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S16.md; spec 7.3 and 7.4",
  },
  {
    key: "lead.rules",
    // Lead clinician, declared availability and on-call rota rules (S18, spec 7.2 and 7.5). Live values are the active row
    // of `lead_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // max_lead_patients repeats clinician.max_lead_patients. lead_min_doctor_tier and required_competencies: who may lead
    // (founder decision F-05: doctor tier is the gate; OQ-125). block_min_hours: the shortest declared block. rota_*, gap_alert_hours,
    // min_eligible_on_call: the rota and when uncovered hours raise an incident. fatigue_* and post_call_*: NHS-derived warnings
    // and rest (the 2016 doctors in training contract FAQ: 11 hours rest, 72 hours in 168, at most 3 rostered on-calls and 4 long shifts in 7 days), PROPOSED and not Nigerian norms, CMO to set (OQ-128); a rota override needs a written reason of
    // override_reason_min_chars. contracted_needs_declared_hours: a contracted clinician is offered work only inside declared hours. contracted_min_declared_hours_per_week: the pilot floor shown to a contracted clinician (a pilot value in the published Amwell programme is 10 hours; displayed, not enforced). swap_urgent_hours: a swap on a shift starting within this many hours applies on acceptance and is audited, so urgent cover never waits for a reviewer.
    value: {
      max_lead_patients: 60,
      lead_min_doctor_tier: "senior_medical_officer",
      required_competencies: ["lead_clinician", "hypertension"],
      block_min_hours: 2,
      minimum_guarantee_kinds: ["queue", "on_call"],
      rota_max_shift_hours: 24,
      rota_horizon_days: 14,
      gap_alert_hours: 48,
      min_eligible_on_call: 2,
      fatigue_min_rest_hours: 11,
      fatigue_max_consecutive_days: 7,
      fatigue_max_shifts_per_7_days: 3,
      fatigue_max_hours_per_7_days: 72,
      fatigue_long_shift_hours: 10,
      fatigue_max_long_shifts_per_7_days: 4,
      post_call_rest_hours: 8,
      post_call_rest_min_shift_hours: 8,
      contracted_needs_declared_hours: true,
      contracted_min_declared_hours_per_week: 10,
      swap_urgent_hours: 4,
      override_reason_min_chars: 10,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S18.md; docs/research/S18.md; spec 7.2, 7.5, 7.9",
  },
  {
    key: "paging.rules",
    // Red event paging (S19, spec 7.9). Live values are the active row of `paging_config`; this entry mirrors it and a test
    // fails if the migration seed and this value drift. escalation_minutes repeats paging.escalation_minutes: the backup is
    // paged at the first, the clinical lead and ops at the second. lead_repeat_minutes: how often the clinical lead and ops are
    // re-alerted (push and in-app only) while nobody has acknowledged, lead_repeat_max times at most, then a sev1 incident.
    // unclosed_alert_minutes: how long an acknowledged page may stay unclosed before the lead and ops are told once. page_access_hours: how long an ACKNOWLEDGED page can keep a clinician tied to a
    // patient's chart (INV-12) before it closes itself; an unacknowledged page never closes itself.
    value: { escalation_minutes: [5, 10], lead_repeat_minutes: 5, lead_repeat_max: 12, unclosed_alert_minutes: 60, page_access_hours: 24 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S19.md; spec 7.9",
  },
  {
    key: "queue.claims",
    // Claim, hand-back and reliability rules (S17, spec 7.6 and 7.8). Live values are the active row of
    // `queue_claim_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // handback_cooldown: this many hand-backs (reasons in exempt_reasons do not count) inside the window closes the queue
    // for the rest of it; hard_count of any reason inside hard_window_minutes does too, so hand-back cannot be used to re-roll.
    // handback_excludes_task_for: only these reasons bar the clinician from being offered that task again. reliability: PROPOSED numbers, CMO to confirm (OQ-H).
    value: {
      max_extensions: 1,
      handback_review: { more_than: 3, window_days: 7 },
      handback_cooldown: { count: 3, window_minutes: 10, exempt_reasons: ["conflict_of_interest", "technical_problem"], hard_count: 6, hard_window_minutes: 60 },
      handback_excludes_task_for: ["conflict_of_interest", "outside_competence", "other"],
      max_pending_self_conflicts: 5,
      escalated_requires_on_call: true,
      reliability: {
        window_days: 90,
        half_life_days: 30,
        prior_events: 5,
        prior_good: 0.8,
        weights: { completed_on_time: 1, completed_late: 1, claim_expired: 0.5, handed_back_other: 0.25, handed_back_reasoned: 0 },
        good: { completed_on_time: 1, completed_late: 0.4, claim_expired: 0, handed_back_other: 0, handed_back_reasoned: 1 },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S17.md; spec 7.6 and 7.8",
  },
  {
    key: "pharmacy.collection_rules",
    // Pharmacy collection codes (S28, spec 9.6). Live values are the active row of `pharmacy_config`; this entry mirrors it and a test
    // fails if the migration seed and this value drift. PROPOSED, owned by the CMO with the pharmacy lead: how long the code is, how many
    // days it stays valid, and how many wrong tries lock it (the patient then gets a new code in the app).
    value: { code_length: 8, code_valid_days: 14, max_wrong_attempts: 5 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S28.md; spec 9.6 and 8.9",
  },
  {
    key: "queue.sla_warning",
    // When a held task's due time turns from blue to amber on the clinician queue and task screens (S35): this many minutes
    // before it is due. Display only: it changes no deadline, routing or fee. PROPOSED, CMO to confirm; the value on the
    // go-live sign-off screen is the one in force.
    value: { warn_within_minutes: 30 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S35.md; docs/research/S35.md (OpenMRS keeps thresholds in data, not in the formatter)",
  },
  {
    key: "outcomes.snapshot_rules",
    // Outcome snapshots and the 90-day BP control report (S38, spec 4.10 and Module 22). Live values are the active row of
    // `outcome_config`; this entry mirrors it and a test fails if the migration seed and this value drift. Every number is PROPOSED
    // and owned by the CMO: the snapshot days, the 7-day window, the days allowed for offline readings to arrive, the readings needed
    // for a verdict, the default target when a person has none, and the smallest cell ever shown. v1: 11, the usual health-reporting
    // rule, and 20 when a cut uses two attributes.
    value: {
      days: [0, 30, 90, 180],
      window_days: 7,
      grace_days: 3,
      min_readings: 3,
      default_target: { systolic: 140, diastolic: 90 },
      min_cell: 11,
      min_cell_cross: 20,
      report_spec: "bp_control_90d",
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S38.md; spec 4.10 and Module 22; docs/research/S38.md",
  },
  {
    key: "outcomes.snapshot_rules",
    // v2 (2026-10-07): the smallest group shown raised from 11 to 20 by founder decision (OQ-233), 30 for a cut by two attributes,
    // until counsel confirms a figure. Same rules as v1 otherwise; v1 is kept so past snapshots can name the version they used.
    value: {
      days: [0, 30, 90, 180],
      window_days: 7,
      grace_days: 3,
      min_readings: 3,
      default_target: { systolic: 140, diastolic: 90 },
      min_cell: 20,
      min_cell_cross: 30,
      report_spec: "bp_control_90d",
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S38.md; spec 4.10 and Module 22; docs/research/S38.md",
  },
  {
    key: "pharmacy.collection_rules",
    // Version 2 (S54c): adds suggestion_valid_days, how long a care-team pharmacy suggestion waits for the patient before it expires.
    // Same code rules as version 1 (S28, spec 9.6); the live values are the active row of `pharmacy_config`.
    value: { code_length: 8, code_valid_days: 14, max_wrong_attempts: 5, suggestion_valid_days: 14 },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S28.md; docs/design/S54.md section 6; spec 9.6 and 8.9",
  },
  {
    key: "quality.audit",
    // Clinical audits, tier 1 count, the audit form, reliability weight and the speak-up clocks (S20, spec 7.8). Live values are the
    // active row of `quality_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // Every number is PROPOSED and owned by the CMO (OQ-140): the sample rate, the tier 1 count and pass mark, the score bands,
    // and the acknowledge and respond times for a safety concern.
    value: {
      sampling: {
        random_rate_percent: 10,
        always_reasons: ["red_event", "titration"],
        floor_min_tasks: 3,
        floor_per_clinician_per_month: 1,
        reviewer_monthly_cap: 40,
        due_days: 14,
      },
      tier1: {
        audited_task_count: 20,
        graduation_min_score: 85,
        max_critical_misses: 0,
      },
      form: {
        version: 1,
        safety_items: ["identity_and_consent_confirmed", "red_flags_recognised_and_acted_on", "decision_within_competence_and_protocol", "no_unsigned_treatment_change", "safety_netting_and_follow_up_given", "escalated_when_needed"],
        quality_items: ["history_adequate", "reasoning_documented", "communication_clear", "plan_appropriate", "patient_questions_answered", "documentation_timely"],
        quality_max: 4,
      },
      outcomes: {
        satisfactory_min: 85,
        minor_concerns_min: 70,
        rationale_min_chars: 20,
      },
      reliability: {
        audit_weight: 2,
        good_by_outcome: {
          satisfactory: 1,
          minor_concerns: 0.6,
          significant_concerns: 0.2,
          unsafe: 0,
        },
      },
      speak_up: {
        acknowledge_hours: 48,
        immediate_acknowledge_hours: 4,
        respond_days: 14,
        max_per_day: 10,
        retaliation_review_months: 12,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S20.md; spec 7.8",
  },
  {
    key: "earnings.rules",
    // The rules around fees that are not money (S30, spec 7.7). Live values are the active row of `earnings_config`; this entry
    // mirrors it and a test fails if the migration seed and this value drift. The AMOUNTS are not here on purpose: fee schedule
    // amounts are set by the founder in the admin console (versioned in `fee_schedules`) and are never hard-coded.
    value: {
      lead_month: { min_active_days: 15 },
      on_call: { backup_fee_pct: 0 },
      minimum_guarantee: { counted_kinds: ["task", "consultation", "on_call_shift"] },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S30.md; spec 7.7 and 17",
  },
  {
    key: "payouts.rules",
    // The rules of the weekly payout run (S31, spec 7.7). Live value is the active row of `payouts_config`; a test fails if the
    // migration seed and this value drift. The minimum is a floor below which earnings carry over to the next week.
    value: {
      cadence: { weekday: 1, hour_lagos: 6 },
      minimum_payout_kobo: 100000,
      carry_over_below_minimum: true,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S31.md; spec 7.7",
  },
  {
    key: "queue.task_types",
    // Task types and priority classes (S16, spec 7.3 and 7.4). Live values are the active `task_types` rows; this entry
    // mirrors them, and a test compares it with the migration seed. Each row: code, priority class (1 is first), default
    // due minutes, minimum doctor tier, required competencies, lead window minutes (0 for none), claim timeout minutes,
    // pushable (an employed doctor may be pushed it), creatable (false for a class reached only by promotion) and the
    // triage task keys it answers. adherence_follow_up is not in the spec table (OQ-S16-1).
    value: [
      { code: "red_event_unacknowledged", priority_class: 1, default_due_minutes: 0, min_doctor_tier: "senior_medical_officer", required_competencies: ["on_call"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: true, source_task_keys: [] },
      { code: "critical_result_review", priority_class: 2, default_due_minutes: 120, min_doctor_tier: "senior_medical_officer", required_competencies: ["result_review"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: true, source_task_keys: [] },
      { code: "amber_bp_review_due_soon", priority_class: 3, default_due_minutes: 0, min_doctor_tier: "medical_officer", required_competencies: ["hypertension"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: false, source_task_keys: [] },
      { code: "amber_bp_review", priority_class: 4, default_due_minutes: 1440, min_doctor_tier: "medical_officer", required_competencies: ["hypertension"], lead_window_minutes: 240, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["urgent_bp_review", "bp_review", "low_bp_review"] },
      { code: "symptom_review", priority_class: 5, default_due_minutes: 1440, min_doctor_tier: "medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "titration_signoff", priority_class: 6, default_due_minutes: 2880, min_doctor_tier: "senior_medical_officer", required_competencies: ["prescribing", "hypertension"], lead_window_minutes: 2880, claim_timeout_minutes: 60, pushable: true, creatable: true, source_task_keys: [] },
      { code: "async_question", priority_class: 7, default_due_minutes: 1440, min_doctor_tier: "medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "routine_result_review", priority_class: 8, default_due_minutes: 2880, min_doctor_tier: "medical_officer", required_competencies: ["result_review"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "admin_clinical", priority_class: 9, default_due_minutes: 4320, min_doctor_tier: "medical_officer", required_competencies: [], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["referral_review"] },
      { code: "adherence_follow_up", priority_class: 8, default_due_minutes: 2880, min_doctor_tier: "care_coordinator", required_competencies: [], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["adherence_review", "silence_check"] },
    ],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S16.md; spec 7.3 and 7.4",
  },
  {
    key: "triage.bp_rule_set",
    // Blood pressure triage rules (S11). The thresholds themselves live in the rule set, `packages/clinical`
    // (`BP_CARE_V1`) and the `triage_rule_sets` row of the same code and version; this entry records the owner and
    // the sign-off state so the go-live guards dashboard lists it. The rule set stays a draft (the database row is
    // never `approved`) until the CMO signs it. Rules BP-P1, BP-P2 and BP-A6 are additions beyond the spec table.
    value: { code: "bp_care_triage", ruleSetVersion: 1, adultAgeYears: 18 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-05",
    source: "docs/design/S11.md; docs/BUILD-SPEC-v5.md Section 6.2; OQ-86, OQ-87",
  },
  {
    key: "triage.bp_rule_set",
    // Version 2 (CMO decisions 2026-10-05): at 200/130 the system asks the symptom question, then medicine, rest and a
    // 2 hour recheck (BP-R2 is retired); under 90 systolic is flagged; pregnancy and the 6 weeks after birth have their own lines.
    value: { code: "bp_care_triage", ruleSetVersion: 2, adultAgeYears: 18 },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-05",
    source: "docs/DECISIONS.md S11 CMO decisions; docs/research/S11-guidelines.md",
  },
  {
    key: "triage.wiring_rules",
    // Triage wiring (S12). These are copied into migration 20261005220819 (the SQL cannot read this registry), so a
    // change here needs a new migration. symptomLinkMinutes: a symptom ticked within this many minutes of a reading
    // (before or after it) is graded with that reading. historyDays: how far back the grader looks for earlier readings.
    // missingEventCatchUpHours: the sweep re-emits a reading with no event if it is newer than this. The phone's own
    // limits (contextBudgetMs: how long it waits for local history before grading with what it has, so a red result is
    // never held back; subjectWaitMs: the same for reading the session; staleAfterDays: how long since the phone last checked for the approved rule set before the BP screen says its guidance may be out of date) are engineering budgets for the 1 second red
    // rule (INV-06), kept with the rest so they are reviewed together.
    value: { symptomLinkMinutes: 10, historyDays: 14, missingEventCatchUpHours: 24, contextBudgetMs: 600, subjectWaitMs: 250, staleAfterDays: 7 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-05",
    source: "docs/design/S12.md; OQ-88",
  },
  {
    key: "notifications.rules",
    // Notification framework (S13). The live values are the active row of `notification_rules_config` (versioned in the
    // database); this entry mirrors it so the owner and the version are recorded with the other PROPOSED values.
    //  quietHours: routine push and email wait until quiet hours end (21:00 to 07:00 Africa/Lagos); critical rows and the
    //  in-app inbox are never held. routinePushPerDay: the most routine pushes one person gets in 24 hours; the rest stay in
    //  the inbox. receiptCheckMinutes: when an Expo ticket's receipt is first checked. receiptGiveUpHours: after this a ticket
    //  with no receipt is left alone.
    value: {
      quietHours: { enabled: true, start: "21:00", end: "07:00" },
      routinePushPerDay: 4,
      receiptCheckMinutes: 15,
      receiptGiveUpHours: 24,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-05",
    source: "docs/design/S13.md; docs/research/S13.md",
  },
  {
    key: "notifications.rules",
    // v2 (S13b): adds pushFallback. One generic email when a routine push was accepted but not opened within afterMinutes
    // (240), for pushes no older than maxAgeHours (24), at most perRecipientPerDay (1) a day, batchSize (200) per 15 minute pass.
    // Live value: the active row of `notification_rules_config`.
    value: {
      quietHours: { enabled: true, start: "21:00", end: "07:00" },
      routinePushPerDay: 4,
      receiptCheckMinutes: 15,
      receiptGiveUpHours: 24,
      pushFallback: { enabled: true, afterMinutes: 240, maxAgeHours: 24, perRecipientPerDay: 1, batchSize: 200 },
    },
    owner: "Founder",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S13.md; docs/research/S13.md",
  },
  {
    key: "video.audio_fallback",
    // Video consultations (S14 interface, wired in S21). Connection quality arrives as a sample every few seconds.
    //  poorSamplesToDowngrade: that many poor samples in a row drop the call to audio only (one bad sample never does).
    //  goodSamplesToOfferVideo: that many good samples in a row, while audio only, let the app OFFER video again; the
    //  patient taps, it never switches back by itself because that spends their data.
    //  poorBelowKbps: a bitrate under this counts as poor even if the vendor labels it fair.
    value: { poorSamplesToDowngrade: 3, goodSamplesToOfferVideo: 6, poorBelowKbps: 100 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S14.md; docs/research/S14.md",
  },
  {
    key: "video.audio_fallback",
    // Version 2 (S21 follow-up, in-app Zoom Meeting SDK, OQ-136): the same three values plus what the SDK actually reports.
    // The SDK gives a network level (0 to 5, which the code reads on the vendor's own scale) while the camera is on, and audio
    // statistics (packet loss, round trip time) all the time. Audio statistics are what lets the ladder see a link recover
    // while the camera is off.
    //  poorAudioLossPercent: average audio packet loss at or above this counts as a poor sample (unit unconfirmed against a live
    //  call; see OQ-136).
    //  poorAudioRttMs: audio round trip time at or above this, in milliseconds, counts as a poor sample.
    //  sampleIntervalSeconds: statistics arrive about every second; they are thinned to one sample per this many seconds, so
    //  "3 poor samples in a row" means a few seconds of bad link, not a few packets.
    value: { poorSamplesToDowngrade: 3, goodSamplesToOfferVideo: 6, poorBelowKbps: 100, poorAudioLossPercent: 10, poorAudioRttMs: 600, sampleIntervalSeconds: 3 },
    owner: "Founder",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S21.md; docs/research/S21.md",
  },
  {
    key: "consultations.host_key",
    // The clinician's Zoom host key (S21 follow-up, OQ-136, founder decision 2026-10-06). A host key lets its holder start meetings as the
    // dedicated consultation host user, and it cannot be tied to one meeting, so it is kept short: minted fresh each time a clinician joins,
    // never stored, never longer than the room.
    //  ttlSeconds: how long the key lives. It is only needed at the moment of joining; a rejoin asks for a new one. Zoom's own minimum and
    //  maximum apply (unconfirmed against the live account; see OQ-136).
    value: { ttlSeconds: 300 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S21.md; docs/OPEN-QUESTIONS.md OQ-136",
  },
  {
    key: "consultations.policy",
    // Remote consultations (S21, founder decisions OQ-124 to OQ-131). Mirrored by consultation_policy_config v1 (a drift
    // test compares the two).
    //  minAgeYears, requireDateOfBirth: adults only; no date of birth means no booking (fail closed).
    //  cancelWindowHours: a patient who cancels this many hours or more before gets the consultation credit back.
    //  lateCancelCreditReturned: whether a late cancel also gets it back (false: the credit is kept).
    //  holdMinutes: how long a slot is held while the patient pays.
    //  reconnectGraceSeconds: a lost connection has this long to return before the call moves to the phone.
    //  clinicianNoShowWaitMinutes, patientNoShowWaitMinutes: how long after the start time before a no-show can be marked.
    //  sessionMinutes: planned length; the clock pauses during reconnect grace.
    //  flagWindowDays: how long after a consultation the patient can flag a problem for human review.
    //  joinOpensMinutesBefore, joinClosesMinutesAfter: the window around the start time in which a room can be joined.
    //  bookingLeadMinutes: the soonest a slot can be booked from now. bookingHorizonDays: how far ahead slots are listed.
    //  chartAccessAfterFinishMaxHours: after a clinician finishes a consultation they keep that patient's chart until a signed note exists,
    //  for at most this long (OQ-159, founder 2026-10-06). Added in policy v2.
    value: {
      minAgeYears: 18,
      requireDateOfBirth: true,
      cancelWindowHours: 2,
      lateCancelCreditReturned: false,
      holdMinutes: 10,
      reconnectGraceSeconds: 120,
      clinicianNoShowWaitMinutes: 15,
      patientNoShowWaitMinutes: 10,
      sessionMinutes: 30,
      flagWindowDays: 3,
      joinOpensMinutesBefore: 15,
      joinClosesMinutesAfter: 60,
      bookingLeadMinutes: 30,
      bookingHorizonDays: 14,
      chartAccessAfterFinishMaxHours: 72,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S21.md; docs/research/S21.md",
  },
  {
    key: "scribe.transcript_retention_days",
    value: 90,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S23.md",
  },
  {
    key: "scribe.claude_model",
    value: "claude-sonnet-5-5",
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S23.md",
  },
  {
    key: "scribe.claude_max_tokens",
    value: 4096,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S23.md",
  },
  {
    key: "scribe.prompt_cache_ttl_seconds",
    value: 3600,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S23.md",
  },
  {
    key: "care_circle.rules",
    // Version 1 (S29, spec 4.7): the rules the Care Circle shipped with. Kept as history; version 2 (S29c) adds the 14 and 3 day
    // expiry notices, the pause length and what a supporter can do about a check-in request, and is the one in force.
    value: { invite_ttl_hours: 72, default_grant_days: 365, max_invites_per_day: 5, max_members: 8, max_attempts: 5, view_weeks: 8, alert_visible_hours: 3, expiry_notice_days: 7, gift_decide_days: 30 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S29.md; docs/research/S29.md; spec 4.7, 8.6",
  },
  {
    key: "care_circle.rules",
    // Care Circle (S29, spec 4.7). Live values are the active row of `care_circle_config`; this entry mirrors it and a test fails
    // if the migration seed and this value drift. invite_ttl_hours: how long an invite link works. default_grant_days: how long a
    // supporter's access lasts unless the patient chooses otherwise (the patient can renew or end it any time). max_invites_per_day:
    // per patient, counting cancelled ones. max_members: active supporters per patient. max_attempts: wrong-contact tries before an
    // invite is dead. view_weeks: how many weekly blood pressure averages a supporter sees. alert_visible_hours: how long a check-in request stays on a supporter's screen. expiry_notice_days: how many days before a member's access ends the patient gets the first notice, and expiry_final_notice_days the second (each is sent once per expiry date, so a renewal starts them again). pause_days: how long \"pause all sharing\" lasts (the patient can end it sooner). gift_decide_days: how long a patient has to accept a care pack or Membership someone else paid for before it is treated as declined and the payer is refunded.
    value: { invite_ttl_hours: 72, default_grant_days: 365, max_invites_per_day: 5, max_members: 8, max_attempts: 5, view_weeks: 8, alert_visible_hours: 3, expiry_notice_days: 14, expiry_final_notice_days: 3, pause_days: 7, gift_decide_days: 30 },
    owner: "Founder",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S29.md; docs/research/S29.md; docs/research/S29-ranked-design-plan.md; spec 4.7, 8.6",
  },
  {
    key: "care_circle.rules",
    // Care Circle (S29, spec 4.7). Live values are the active row of `care_circle_config`; this entry mirrors it and a test fails
    // if the migration seed and this value drift. invite_ttl_hours: how long an invite link works. default_grant_days: how long a
    // supporter's access lasts unless the patient chooses otherwise (the patient can renew or end it any time). max_invites_per_day:
    // per patient, counting cancelled ones. max_members: active supporters per patient. max_attempts: wrong-contact tries before an
    // invite is dead. view_weeks: how many weekly blood pressure averages a supporter sees. alert_visible_hours: how long a check-in request stays on a supporter's screen. expiry_notice_days: how many days before a member's access ends the patient gets the first notice, and expiry_final_notice_days the second (each is sent once per expiry date, so a renewal starts them again). pause_days: how long \"pause all sharing\" lasts (the patient can end it sooner). gift_remind_days: the day on which a patient with a gift still waiting is reminded, once. gift_decide_days (14 from version 3, founder 2026-10-07): how long a patient has to accept a care pack or Membership someone else paid for before it is treated as declined and the payer is refunded.
    value: { invite_ttl_hours: 72, default_grant_days: 365, max_invites_per_day: 5, max_members: 8, max_attempts: 5, view_weeks: 8, alert_visible_hours: 3, expiry_notice_days: 14, expiry_final_notice_days: 3, pause_days: 7, gift_decide_days: 14, gift_remind_days: 7 },
    owner: "Founder",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S29.md; docs/research/S29.md; docs/research/S29-ranked-design-plan.md; spec 4.7, 8.6",
  },
  // S26: entitlements lifecycle, care pack expiry, refunds
  {
    key: "entitlements.expiry_reminder_days",
    // Days before an entitlement expires to send the CON-010 renewal reminder.
    value: 7,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S26.md; docs/research/S26.md",
  },
  {
    key: "refunds.cooling_off_days",
    // FCCPA consumer-protection cooling-off period: a patient may request a full refund within this window.
    value: 14,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S26.md; docs/research/S26.md",
  },
  {
    key: "refunds.consultation_cancel_grace_hours",
    // Full refund if consultation cancelled at least this many hours before start. Inside this window, the
    // cancellation retention applies. Clinician cancel or no-show is always a full refund regardless.
    value: 2,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S26.md; OQ-127",
  },
  {
    key: "refunds.late_cancel_retention_kobo",
    // Fixed amount retained when a patient cancels a consultation inside the grace window. 0 = full refund
    // regardless. Clinician cancel is always full refund.
    value: 0,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S26.md; OQ-127",
  },
  {
    key: "risk.stratification",
    // Risk points for ordering clinician outreach (S38c, Module 22.3). Live value is the active row of `risk_config`; a test fails if
    // the migration seed and this value drift. PROPOSED, owned by the CMO (OQ-274): every weight and tier cut-off. Points only order
    // outreach; they are never a clinical grade and never gate, price or deny care.
    value: {
      joined_min_days: 7,
      bp_window_days: 7,
      min_readings: 3,
      above_target: { systolic: 10, diastolic: 5 },
      well_above_target: { systolic: 20, diastolic: 10 },
      rising_systolic: 10,
      silence_days: { medium: 5, high: 10 },
      adherence_low_pct: 60,
      triage_lookback_days: 30,
      points: {
        deterioration: { above_target: 25, well_above_target: 45, rising: 15, red_event: 40, amber_event: 15, last_snapshot_uncontrolled: 15, low_adherence: 10 },
        dropout: { silent_medium: 25, silent_high: 50, fewer_readings: 20, low_adherence: 20, no_readings_ever: 40 },
      },
      tiers: { medium_min: 30, high_min: 60 },
      override_max_days: 30,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S38c.md; docs/research/S38.md section 22.3",
  },
  {
    key: "reports.monthly",
    // The personal monthly progress report (S38c, Module 22.5). Live value is the active row of `monthly_report_config`; drift test.
    // PROPOSED, owned by the CMO (OQ-275): readings needed before any average or direction is shown, and the wait for late syncs.
    value: {
      min_readings: 3,
      grace_days: 2,
      direction_threshold_systolic: 5,
      default_target: { systolic: 140, diastolic: 90 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S38c.md; docs/research/S38.md section 22.5",
  },
  {
    key: "audio.bundled_max_bytes",
    value: 15000000,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S32.md (about 13 MB projected for the bundled groups without SYM, 14 MB with it, at 48 kbps mono; the 40 MB whole-app target was superseded by DG-1)",
    guardPatterns: ["\\b15[_,]?000[_,]?000\\b"],
  },
  {
    key: "audio.mono_bitrate_kbps",
    value: 48,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "Audio Production List v1.0 section 3.3 (app copies at about 32 to 48 kbps mono; the upper end is used so the projection errs high)",
  },
  {
    key: "audio.speech_chars_per_minute",
    value: 900,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "Audio Production List v1.0 section 5 (about 900 characters per minute of continuous speech)",
  },
  {
    key: "audio.number_clip_seconds",
    value: 2,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S32.md (an estimate for one number clip; replace with the measured average once the number clips are recorded)",
  },
  {
    key: "directory.verification_cadence",
    // How often a partner or directory listing must be re-verified (S36g, spec 25.3 and 25.9; open question OQ-214/OQ-235). Live values
    // are the active row of `directory_verification_config`; this entry mirrors it and a test fails if the migration seed and this value
    // drift. UNSIGNED: no founder or CMO confirmation exists. A listing past its date is only marked "verification overdue"; nothing is
    // ever hidden or suspended automatically.
    value: {
      default_months: 12,
      due_soon_days: 30,
      by_listing_table: { pharmacy_partners: 6 },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S36.md; spec 25.3, 25.9; OQ-214",
  },
  {
    key: "reliability.dashboard",
    // The reliability and SLA dashboard (S36e, spec 9.5 and 9.4). Display settings only: how far ahead the rota gap view looks, how many
    // clinicians a group must hold before the operations view may show a score distribution (a group of one or two is someone's own
    // score), and the three neutral score bands used to group clinicians. Reliability stays advisory (S17): bands are for reading
    // the spread, not for ranking anyone, and nothing here suspends or changes pay. OQ-225 asks the CMO to confirm these.
    value: {
      gap_days: 7,
      min_group: 5,
      bands: [
        { key: "a", min: 85 },
        { key: "b", min: 70 },
        { key: "c", min: 0 },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S36e.md; docs/design/S17.md (reliability is a tie-break only)",
  },
  {
    key: "breathing.bre01",
    value: {
      inhale_seconds: 4,
      exhale_seconds: 6,
      duration_seconds: 180,
      short_duration_seconds: 60,
      gentle_inhale_seconds: 3,
      gentle_exhale_seconds: 5,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S33.md section 5 and docs/research/S33.md section 4 (about six breaths a minute with a longer out-breath; the pace and length are the CMO's to confirm, and the exercise is never presented as a treatment)",
  },
  {
    key: "learning.understandability_pass_rule",
    value: { min_participants: 10, min_recall: 0.8, max_unsafe: 0 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/research/S33.md section 5 (10 to 15 community participants per language; 80 percent give the message and name the action; any unsafe misunderstanding means rewrite and retest). Scoring: packages/i18n/src/understandability.ts",
  },
  {
    key: "bp.starting_suggestion_target",
    // v2 (CMO, 2026-10-07): aligned to NICE NG136 home (HBPM) averages, which is the only band the device can apply
    // on its own: under 80 years below 135/85; 80 years or more below 145/85. Tighter targets (type 2 diabetes with kidney,
    // eye or cerebrovascular damage: clinic below 130/80; CKD with ACR 70 mg/mmol or more: home below 125/75, NICE NG203)
    // depend on facts the phone does not hold, so they are set by the care team as the personal target, never inferred here.
    value: {
      systolicBelow: 135,
      diastolicBelow: 85,
      ageBands: [{ fromAgeYears: 80, systolicBelow: 145, diastolicBelow: 85 }],
      careTeamSetTargets: [
        {
          when: "type 2 diabetes with kidney, eye or cerebrovascular damage, or chronic kidney disease with ACR 70 mg/mmol or more",
          clinicBelow: "130/80",
          homeBelow: "125/75",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "NICE NG136 (home average 135/85; 145/85 from age 80); NICE NG28 and NG203 (130/80 clinic, 125/75 home for ACR 70 or more); docs/clinical-signoff/STANDARDS-CROSS-CHECK-2026-10-07.md",
  },
  {
    key: "lab.panels",
    // v2 (2026-10-07): one Membership panel, sex-specific haemoglobin, creatinine and HDL ranges, limits re-checked against published
    // standards (docs/clinical-signoff/STANDARDS-CROSS-CHECK-2026-10-07.md). Mirrors the lab_panel_versions seed in
    // 20261007121842_s27g_lab_panel_membership_sex_ranges.sql; a test fails if the two drift. Stays `proposed` until the CMO signs
    // lab_panel_signoffs v2 with sign_lab_panels(); it is the signed sign-off row, not this entry, that releases results.
    value: {
      "panels": {
        "membership_annual": {
          "analytes": [
            {
              "code": "fasting_glucose",
              "label": "Fasting glucose",
              "kind": "numeric",
              "unit": "mg/dL",
              "refLow": 70,
              "refHigh": 99,
              "criticalLow": 45,
              "criticalHigh": 360
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
              "criticalHigh": 4,
              "bySex": {
                "male": {
                  "refLow": 0.7,
                  "refHigh": 1.3
                },
                "female": {
                  "refLow": 0.6,
                  "refHigh": 1.1
                }
              }
            },
            {
              "code": "potassium",
              "label": "Potassium",
              "kind": "numeric",
              "unit": "mmol/L",
              "refLow": 3.5,
              "refHigh": 5.1,
              "criticalLow": 3,
              "criticalHigh": 6
            },
            {
              "code": "sodium",
              "label": "Sodium",
              "kind": "numeric",
              "unit": "mmol/L",
              "refLow": 135,
              "refHigh": 145,
              "criticalLow": 121,
              "criticalHigh": 150
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
              "refLow": 40,
              "bySex": {
                "male": {
                  "refLow": 40
                },
                "female": {
                  "refLow": 50
                }
              }
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
              "refHigh": 40
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
              "criticalHigh": 20,
              "bySex": {
                "male": {
                  "refLow": 13,
                  "refHigh": 17.5
                },
                "female": {
                  "refLow": 12,
                  "refHigh": 15.5
                }
              }
            },
            {
              "code": "wbc",
              "label": "White cell count",
              "kind": "numeric",
              "unit": "10^9/L",
              "refLow": 3,
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
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/clinical-signoff/STANDARDS-CROSS-CHECK-2026-10-07.md; WHO haemoglobin thresholds 2024; Royal College of Pathologists critical results",
  },
  {
    key: "triage.silence_rule_days",
    // v2 (decision S11-1, 2026-10-07): 7 days, not 5. Takes effect when the CMO approves bp_care_triage v3 in the database; the live rule set
    // carries its own copy of this number and stays at the earlier line until then. The rule set, not this entry, is what the engine reads.
    value: 7,
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md S11-1; OQ-273 (spec safety case 7 said 5 days)",
    guardPatterns: ["silence\\w*\\s*[=:]\\s*7\\b"],
  },
  {
    key: "triage.bp_rule_set",
    // v3 names bp_care_triage v3: the CMO's version 2 decisions plus the 7 day silence line. The database row is a draft until the CMO approves it.
    value: { code: "bp_care_triage", ruleSetVersion: 3, adultAgeYears: 18 },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md S11-1; supabase/migrations/20261007152136_s11c_bp_care_triage_v3.sql",
  },
];

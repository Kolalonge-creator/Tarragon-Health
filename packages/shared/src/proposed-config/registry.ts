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
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S21.md; docs/research/S21.md",
  },
];

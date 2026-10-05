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
];

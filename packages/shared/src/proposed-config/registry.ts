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
import { BIOMARKER_GRADE_BANDS } from "./biomarker-grade-bands";
import { DEVICE_RED_RULES, EMERGENCY_PACK } from "./emergency-pack";
import { OBSERVATION_LIMITS_V1 } from "./observation-limits-data";
import { THERAPY_EXCLUSION_LISTS, THERAPY_PROGRAMME_CONFIG } from "./therapy-config-data";

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
    key: "auth.recovery_rules",
    // S03b (founder decisions 2026-10-13). Live values are the active row of `account_recovery_config`; this entry mirrors it and a
    // test fails if the migration seed and this value drift. backup_code_count: codes per set (the founder said ten).
    // backup_code_regenerations_per_day: sets one person can make in 24 hours. backup_code_attempts_per_hour: wrong tries on one
    // account before redeeming is refused for an hour. contact_delay_hours: the wait between the recovery contact confirming and
    // the one-time link being allowed. contact_request_hours: how long a request waits for the contact to answer.
    // contact_release_hours: how long the link can be asked for once the wait is over. contact_requests_per_week: requests one
    // person can start in a week (each one disturbs the contact). number_change_hold_hours: how long recovery by a text code is
    // paused after the sign-in number moved (OQ-43). number_change_confirm_minutes: how long a confirmation from the old number or
    // the verified email stays good for starting a number change. step_up_minutes: how long a password re-entry stays good for making
    // backup codes or naming a recovery contact. All are PROPOSED; none is spec-fixed except the count of ten.
    value: {
      backup_code_count: 10,
      backup_code_regenerations_per_day: 3,
      backup_code_attempts_per_hour: 10,
      contact_delay_hours: 24,
      contact_request_hours: 48,
      contact_release_hours: 48,
      contact_requests_per_week: 2,
      number_change_hold_hours: 72,
      number_change_confirm_minutes: 15,
      step_up_minutes: 10,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S03b.md; docs/research/S01-S05-competitor-gap-and-build-plan.md section 10; OQ-41, OQ-43",
  },
  {
    key: "auth.passkey_rules",
    // Optional passkeys (docs/design/passkeys.md). add_authorisation_minutes: how long a password re-entry stays good for
    // adding ONE passkey (single use; the database also clamps the value it is given to 1..15). start_per_ip_per_5min and
    // verify_per_ip_per_5min: how often one source may ask for, or try, a passkey sign-in. label_max_chars: the longest name a
    // person can give a passkey. All PROPOSED.
    value: {
      add_authorisation_minutes: 3,
      start_per_ip_per_5min: 30,
      verify_per_ip_per_5min: 20,
      label_max_chars: 60,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/passkeys.md; founder decision 2026-10-16 (passkeys strictly optional, off by default)",
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
    key: "glucose.symptom_checklist",
    // A warning sign ticked on the glucose form is stored as a symptoms row so the server can grade it with the glucose rules (R2 follow-up).
    // The form does not ask the patient to rate it, so it is recorded at this severity, with a description saying it was ticked rather than
    // rated. 3 is deliberately BELOW both paging lines of the older symptom trigger (handle_symptom_red_flag pages from severity 5 for any type,
    // and from severity 4 for the paediatric types lethargy and dehydration_signs in a child under 5, which two glucose signs map onto), so a
    // glucose-form tick never pages through that older path on its own: the governed glucose engine is the one place a glucose sign pages.
    // Unlike blood pressure (bp.symptom_checklist is 6, on purpose, because blood pressure still leans on the older trigger), do not raise this
    // without reading docs/design/glucose-sign-storage-gap.md. The CMO confirms the value.
    value: { severity: 3 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/design/glucose-sign-storage-gap.md; supabase 20260905011852_symptom_red_flag_handler_pages_a_clinician.sql",
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
    key: "events.bus_rules",
    // S10x adds the operations values. Same live source (the active row of `event_bus_config`, now version 3; a test fails if the
    // migrations and this entry drift apart). lagAlertSeconds: when the oldest due, unclaimed, non-urgent delivery of a subscriber is
    // older than this, one incident opens for that subscriber (none while one is open). lagAlertFloorSeconds: the database refuses a
    // lower value, so a typo cannot turn the alert into noise. partnerDisableAfterFailures: consecutive failed attempts after which a
    // partner webhook endpoint is switched off and an incident opens; partnerDisableFloor is the lowest the database allows.
    value: {
      batchSize: 50,
      leaseSeconds: 60,
      maxAttempts: 8,
      backoffBaseSeconds: 15,
      backoffMaxSeconds: 900,
      jitterPercent: 20,
      lagAlertSeconds: 600,
      lagAlertFloorSeconds: 120,
      partnerDisableAfterFailures: 20,
      partnerDisableFloor: 5,
    },
    owner: "Founder",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S10x.md",
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
    key: "credentialing.rules",
    // Version 3 (Q14, Q15) adds the primary-source and re-check keys to version 2 (OQ-104, OQ-108): the same rules plus three. Both switches start off: no real account has a confirmed
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
      primary_source_required: true,
      primary_source_routes: ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
      primary_source_max_age_days: 365,
      recheck_months: 6,
      recheck_overdue_days: 14,
      credential_date_max_days: 1100,
      grandfather_ends_on: "2027-01-13",
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S11-S15-credentialing.md; CMO answers Q14 and Q15 (MDCN verification before first independent contact; six-month spot re-check). grandfather_ends_on is 2027-01-13 (90 days from 2026-10-15; follow-up OQ-344, set by migration, also carried to versions 4 and 5).",
  },
  {
    key: "credentialing.rules",
    // Version 4 (S20 v2, CMO decision 8 recorded 2026-10-07), on top of version 3 (primary-source and re-check keys): notices at 90, 30, 7 and 0 days,
    // the proof-of-renewal deadline (15 December for the 31 December cycle), a missing licence date counted as ineligible, and the evidence sources
    // a verification can name. INACTIVE in `credentialing_config` until switched on; the switch is refused while an active clinician has no licence date.
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
      notice_windows_days: [90, 30, 7, 0],
      grace_max_days: 14,
      separate_verifier_and_approver: true,
      document_max_bytes: 8388608,
      document_retention_years_after_offboarding: 7,
      require_verified_phone: false,
      document_purge_enabled: false,
      rejected_application_document_retention_months: 24,
      primary_source_required: true,
      primary_source_routes: ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
      primary_source_max_age_days: 365,
      recheck_months: 6,
      recheck_overdue_days: 14,
      credential_date_max_days: 1100,
      grandfather_ends_on: "2027-01-13",
      renewal_cycle: {
        cycle_end_month: 12,
        cycle_end_day: 31,
        proof_deadline_month: 12,
        proof_deadline_day: 15,
      },
      missing_licence_date_ineligible: true,
      verification_sources: ["mdcn_register_lookup", "document_sighted", "insurer_confirmation", "other"],
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 4,
    effectiveFrom: "2026-10-14",
    source: "docs/plans/S16-S20-review-and-build-plan.md section 5; docs/design/S16-S20-quality-v2.md",
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
    key: "lab.lifecycle",
    // Lab lifecycle (S27h). Live value is the active row of `lab_lifecycle_config`.rules; a test fails if the migration seed and this value
    // drift. Every use is an alert or a flag: hold-aging tells the clinical lead (never releases), the delta percent flags a change to the
    // reviewer (never releases), the fallback wait only times a neutral message that the CMO must have signed (never releases). The critical
    // value call reuses paging.rules (escalation_minutes). The CMO still owes the thresholds and the fallback wording.
    value: {
      "holdAging": {
        "leadEscalateMinutes": { "critical": 720, "default": 1440 },
        "repeatMinutes": 720,
        "repeatMax": 3
      },
      "delta": {
        "percent": 50,
        "windowDays": 365,
        "perAnalytePercent": { "creatinine": 30, "potassium": 20, "sodium": 5, "hba1c": 20, "haemoglobin": 20 }
      },
      "disclosureFallback": { "afterEscalatedMinutes": 1440 }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/research/S26-S30-competitor-review-and-build-plan.md section S27h; escalation_slas v7 (12h critical, 24h non-critical)",
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
    key: "queue.task_layer",
    // The task layer's rules (S16-S20 hardening, CMO decisions 1 to 3 of 2026-10-07). Live values are the active row of
    // `queue_task_layer_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // lead_window_cap_fraction: an offer window is the task type's window or this share of the task's own due time, whichever is
    // shorter (decision 1; defect D1). escalated_non_red_any_eligible: an escalated task that is not red is claimable by any eligible
    // clinician; red (class 1) is unchanged (INV-05). handback_also_excludes_task_for: reasons that bar the same clinician from the
    // same task again, on top of queue.claims (D7). escalation_alert: classes up to immediate_max_class alert the clinical lead at once
    // on the listed channels (never SMS or WhatsApp), the rest an in-app notice plus a daily digest (decision 2; D2). completion: the
    // coded outcomes each task type may close with, the contact-attempt sequence a critical result needs when it cannot be released,
    // and the note limit (decision 3; D4). watchdog: how stale a queue job may be, and how long the oldest open task of each class may
    // wait before an alert (D6). Every number is PROPOSED; the CMO signs v2 in the console.
    // Two further PROPOSED numbers are code constants until that v2 (config v1 cannot be edited in place): a contact attempt may be
    // dated up to 24 hours before its task existed (CONTACT_ATTEMPT_LOOKBACK_HOURS; private.contact_attempt_lookback()), and further
    // immediate escalations within 10 minutes of the last alert are folded into one follow-up (private.escalation_coalesce_window()).
    // A third PROPOSED code constant (OQ-433): private.task_extra_competencies() adds the `prescribing` competency to every
    // pharmacy_flag_review task and to an admin_clinical task whose dedup key starts prescription: or repeat_prescription:.
    // A task keeps the competencies stored on it when it was made. Offers also skip a lead (or an employed doctor) who lacks a
    // required competency (OQ-435); the transition reason records why. The CMO confirms or changes both in the v2 pack.
    value: {
      lead_window_cap_fraction: 0.5,
      escalated_non_red_any_eligible: true,
      handback_also_excludes_task_for: ["needs_information", "technical_problem"],
      escalation_alert: {
        immediate_max_class: 2,
        immediate_channels: ["in_app", "push", "email"],
        notice_channels: ["in_app"],
        digest_channels: ["in_app", "email"],
      },
      completion: {
        default_codes: ["completed_action_taken", "completed_no_action_needed", "referred_on", "patient_unreachable_documented"],
        codes_by_type: {
          critical_result_review: ["result_released", "contact_attempts_documented"],
          titration_signoff: ["signed", "amended", "rejected"],
          pharmacy_flag_review: ["prescription_confirmed", "prescription_amended", "pharmacy_contacted", "prescription_withdrawn"],
          symptom_review: ["answer_signed"],
          async_question: ["guidance", "needs_call", "needs_more_information", "answer_signed"],
          written_question_call: ["call_done"],
          red_event_unacknowledged: ["acknowledged", "dispositioned"],
        },
        legacy_kind_types: ["async_question", "written_question_call"],
        contact_attempts: { min_attempts: 3, methods: ["phone_call", "video_call", "in_app_message", "emergency_contact"] },
        note_max_chars: 1000,
      },
      watchdog: {
        job_max_age_minutes: { "sweep-clinical-tasks": 5, "expire-task-claims": 5 },
        class_warning_minutes: { "2": 60, "3": 120, "4": 720, "5": 720, "6": 1440, "7": 720, "8": 1440, "9": 2160 },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-14",
    source: "docs/plans/S16-S20-review-and-build-plan.md section 5 (decisions 1 to 3); docs/design/S16-S20-task-layer.md",
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
    key: "lead.rules",
    // Lead clinician, declared availability and on-call rota rules (S18, spec 7.2 and 7.5). Live values are the active row
    // of `lead_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // max_lead_patients repeats clinician.max_lead_patients. lead_min_doctor_tier and required_competencies: who may lead
    // (founder decision F-05: doctor tier is the gate; OQ-125). block_min_hours: the shortest declared block. rota_*, gap_alert_hours,
    // min_eligible_on_call: the rota and when uncovered hours raise an incident. fatigue_* and post_call_*: NHS-derived warnings
    // and rest (the 2016 doctors in training contract FAQ: 11 hours rest, 72 hours in 168, at most 3 rostered on-calls and 4 long shifts in 7 days), PROPOSED and not Nigerian norms, CMO to set (OQ-128); v2 (CMO, 2026-10-07) lowers the weekly hours warning from 72 to 48, the EU Working Time Directive average; a rota override needs a written reason of
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
      fatigue_max_hours_per_7_days: 48,
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
    version: 2,
    effectiveFrom: "2026-10-07",
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
    key: "paging.delivery_rules",
    // Red event pager delivery (S19c, S16-S20 review Stage 1, CMO decisions 9, 10, 11 and 15). Live values are the active row of
    // `paging_delivery_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // delivered_ack_seconds: a page never shown on the paged clinician's console or device after this long pages the next person
    // early (the 5 and 10 minute timers in paging.rules stay). reconcile_after_seconds / reconcile_lookback_hours: a red triage event
    // with no page after the first is paged by the reconciler; it looks back this many hours. merge_window_minutes: a repeat red event
    // for a patient with an open page family joins it instead of ringing again. engine_heartbeat_stale_seconds: older than this a
    // paging engine heartbeat is stale and opens an incident. device_seen_stale_minutes: an on-call console not seen for this long
    // is shown as silent. readiness_test_page_days: on-call needs a test page acknowledged within this many days.
    // test_page_min_interval_seconds: the least time between two test pages to one clinician. page_notification_stuck_seconds: a page
    // notification still waiting to send after this long opens an incident (the sender may be down). objective_readiness_required:
    // 1 = on-call also needs a working push subscription, a verified email and a recent test page; 0 = checklist only.
    // first_hop_safe_*: a blood pressure reading inside this band is queued on the normal 15 second cron; outside it (or with no band)
    // the event is urgent and nudges process-events at once. It only chooses speed: every reading is graded either way.
    value: {
      delivered_ack_seconds: 90,
      delivered_ack_seconds_unconfirmed_route: 180,
      reconcile_after_seconds: 60,
      reconcile_lookback_hours: 4,
      reconcile_per_pass_max: 20,
      merge_window_minutes: 30,
      engine_heartbeat_stale_seconds: 120,
      device_seen_stale_minutes: 10,
      device_seen_keep: 20,
      readiness_test_page_days: 7,
      test_page_min_interval_seconds: 120,
      page_notification_stuck_seconds: 120,
      page_notification_retry_stuck_seconds: 660,
      first_hop_safe_systolic_min: 100, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_systolic_max: 139, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_diastolic_min: 60, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_diastolic_max: 89, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      objective_readiness_required: 0,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-14",
    source: "docs/design/S16-S20-pager-delivery.md; docs/plans/S16-S20-review-and-build-plan.md section 5, decisions 9, 10, 11, 15",
  },
  {
    key: "shift_start.test_rules",
    // Shift-start test page (migration 20261016190204). Live values are the active row of `shift_start_test_config`; this entry mirrors it
    // and a test fails if the migration seed and this value drift. lead_minutes: the test page goes to the primary and the backup this long
    // before the shift starts. grace_minutes: the shift is counted as not covered if a test page is still unacknowledged this long after
    // the shift starts (the deadline). undelivered_after_minutes: a test page with no receipt on any device or screen after this long is
    // shown to the clinician as "not reached you" with instructions. late_send_minutes: a shift that started less than this long ago, with
    // no test yet (a tick was missed), still gets one; an older shift never does, so switching the guard on does not disturb a running shift.
    // max_per_run: test pages sent per one-minute tick. proof_lookback_days: the go-live guard wants a test page acknowledged this recently.
    // The feature itself is OFF until the CMO switches the go-live guard `shift_start_test` on.
    value: {
      lead_minutes: 10,
      grace_minutes: 15,
      undelivered_after_minutes: 5,
      late_send_minutes: 3,
      max_per_run: 20,
      proof_lookback_days: 30,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/build-shift-start-test.md; docs/research/build-shift-start-test.md",
  },
  {
    key: "paging.delivery_rules_v2",
    // The same delivery rules with objective on-call readiness SWITCHED ON (a working push subscription, a verified email and a recent
    // acknowledged test page to be put on the rota; swaps are never blocked). Shipped as an INACTIVE, unsigned row (paging_delivery_config
    // version 2): the CMO activates it once every on-call clinician has passed a test page. Not active until then.
    value: {
      delivered_ack_seconds: 90,
      delivered_ack_seconds_unconfirmed_route: 180,
      reconcile_after_seconds: 60,
      reconcile_lookback_hours: 4,
      reconcile_per_pass_max: 20,
      merge_window_minutes: 30,
      engine_heartbeat_stale_seconds: 120,
      device_seen_stale_minutes: 10,
      device_seen_keep: 20,
      readiness_test_page_days: 7,
      test_page_min_interval_seconds: 120,
      page_notification_stuck_seconds: 120,
      page_notification_retry_stuck_seconds: 660,
      first_hop_safe_systolic_min: 100, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_systolic_max: 139, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_diastolic_min: 60, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      first_hop_safe_diastolic_max: 89, // band-ok: speed pre-screen for the urgent lane, not a triage band (every reading is still graded)
      objective_readiness_required: 1,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-14",
    source: "docs/design/S16-S20-pager-delivery.md; paging_delivery_config version 2 (inactive)",
  },
  {
    key: "paging.unified_red_rules",
    // Unified red-event paging (S19d, S16-S20 review Stage 3, CMO decision 11 part 3, defect P5). Live values are the active row of
    // `unified_red_paging_config`; this entry mirrors version 1 and a test fails if the migration seed and this value drift. The row ships
    // INACTIVE and UNSIGNED: no active row means every flag reads OFF and the older notification paths run exactly as before. The CMO
    // switches it on from the sign-off hub after running the staging test pack, and can switch it off at any time.
    // Each source key: 1 = that red-class event (SpO2 red, pulse red, temperature red, a red-flag symptom, any emergency event except
    // blood pressure, which already has the triage-engine page) creates a page through the same ladder as the blood pressure page.
    // suppress_legacy_clinician_notice: 1 = for the RED levels (SpO2, pulse, temperature, red-flag symptom) the older "notify every clinician"
    // step is skipped, but only when a page with a named, reachable clinician was created or joined; a failed page, a no-cover page or a
    // primary with no push subscription and no verified email leaves the older notice running.
    // suppress_legacy_emergency_notice: the same for EMERGENCY events. 0 in v1: the page and the older broadcast run side by side until the
    // CMO has seen delivery proven and signs a later version with 1. An emergency never merges into an open page; it makes its own.
    value: {
      spo2_red: 1,
      pulse_red: 1,
      temperature_red: 1,
      symptom_red_flag: 1,
      emergency_event: 1,
      suppress_legacy_clinician_notice: 1,
      suppress_legacy_emergency_notice: 0,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/design/S16-S20-unified-red-paging.md; docs/plans/S16-S20-review-and-build-plan.md section 5, decision 11",
  },
  {
    key: "paging.legacy_notice_retirement_rules",
    // Retiring the older "notify every clinician" message for blood pressure and glucose, and the Care Circle notice for unified red-event
    // pages (S19f). Live values are the active row of `legacy_notice_retirement_config`; this entry mirrors the four seeded versions and a test
    // fails if the migration seed and this value drift. All four versions ship INACTIVE and UNSIGNED: no active signed row means every key reads
    // OFF and the older paths run exactly as before. The CMO switches ONE version on from the sign-off hub after the test pack.
    // observe: 1 = record, for every event, whether and when its page arrived (nothing changes for anyone). suppress_legacy_bp_notice and
    // suppress_legacy_glucose_notice: 1 = the older message for the RED level of that pathway is held until the page of that same event is
    // confirmed with a reachable paged clinician, then dropped; otherwise it is sent. suppress_legacy_emergency_notice: the SEPARATE key that
    // also covers emergency-level events (blood pressure crisis, glucose emergency). circle_notice_unified_page: 1 = a neutral check-in
    // notice also goes to Care Circle members who allowed red alerts when the page is a unified page (never for a symptom event when the patient
    // has a pregnancy or reproductive-health record). hold_seconds: how long a held message waits for its page before it is sent.
    // emergency_hold_seconds: the much shorter wait for an EMERGENCY-level message; emergency_engine_fresh_seconds: how recent the event-bus
    // heartbeat must be to hold an emergency message at all (older: sent at once). min_parallel_days / min_parallel_events: the evidence a
    // retiring version needs from the parallel run (days switched on, real events measured) before it can be signed.
    // Version 1 = parallel run. 2 = retire red-level BP and glucose. 3 = 2 plus emergency-level. 4 = Care Circle notice only.
    value: {
      versions: {
        "1": { observe: 1, suppress_legacy_bp_notice: 0, suppress_legacy_glucose_notice: 0, suppress_legacy_emergency_notice: 0, circle_notice_unified_page: 0, hold_seconds: 60, emergency_hold_seconds: 15, emergency_engine_fresh_seconds: 30, min_parallel_days: 7, min_parallel_events: 20 },
        "2": { observe: 1, suppress_legacy_bp_notice: 1, suppress_legacy_glucose_notice: 1, suppress_legacy_emergency_notice: 0, circle_notice_unified_page: 0, hold_seconds: 60, emergency_hold_seconds: 15, emergency_engine_fresh_seconds: 30, min_parallel_days: 7, min_parallel_events: 20 },
        "3": { observe: 1, suppress_legacy_bp_notice: 1, suppress_legacy_glucose_notice: 1, suppress_legacy_emergency_notice: 1, circle_notice_unified_page: 0, hold_seconds: 60, emergency_hold_seconds: 15, emergency_engine_fresh_seconds: 30, min_parallel_days: 7, min_parallel_events: 20 },
        "4": { observe: 1, suppress_legacy_bp_notice: 0, suppress_legacy_glucose_notice: 0, suppress_legacy_emergency_notice: 0, circle_notice_unified_page: 1, hold_seconds: 60, emergency_hold_seconds: 15, emergency_engine_fresh_seconds: 30, min_parallel_days: 7, min_parallel_events: 20 },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/S19f-legacy-notice-retirement-and-circle-notice.md; docs/design/S16-S20-unified-red-paging.md sections C and D",
  },
  {
    key: "free_red_event.rules",
    // Two-tier (CMO decision 2026-10-08, C2): the Free red-event path. Live values are the active row of `free_red_config`; this
    // entry mirrors it and a test fails if the migration seed and this value drift. recheck_minutes: when the Free patient is
    // nudged to rest and take the reading again. checkin_minutes: when they are asked whether they got care (the answer is kept
    // for them and never shown to a doctor). The CMO confirms both numbers.
    value: { recheck_minutes: 30, checkin_minutes: 360 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/OPEN-QUESTIONS.md two-tier Free red events; docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md C2",
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
    key: "partner.quality",
    // Partner quality rules (S74, spec 21.7): the turnaround target for a laboratory, how many upheld complaints are too many, the licence warning
    // window, the score weights and floors, and which breaches take a partner out of NEW work. Live values are the active row of
    // `partner_quality_config`; this entry mirrors it and a test fails if the migration seed and this value drift. PROPOSED: the CMO owns the
    // numbers (OQ-360). Nothing here moves money; laboratories are paid by the patient directly (D-06).
    value: {
      window_days: 90,
      turnaround: { lab_target_hours: 72, min_orders: 10, min_within_target_percent: 80 },
      complaints: { category_codes: ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"], upheld_limit: 3 },
      licence: { expiring_days: 30 },
      weights: { turnaround: 40, complaints: 30, licence: 30 },
      score: { warn_below: 70, suspend_below: 50 },
      removal: {
        auto_suspend: true,
        suspend_on: ["licence_expired", "complaints_upheld_limit", "turnaround_below_target", "score_below_floor"],
        override_days: 30,
        reason_min_chars: 20,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S74.md; docs/research/S74.md; spec 21.7 and B.21 safety rules",
  },
  {
    key: "partner.settlement",
    // Partner settlement rules (S74, spec 21.6, decision S74-2). Live values are the active row of `partner_settlement_config`. PROPOSED, owned by the
    // founder (OQ-326): the statement period, the day after month end the run may build drafts, whether a second person must approve terms, and the
    // kinds of partner and source that can ever accrue. Laboratories are not in `partner_kinds`: they are owed nothing (D-06).
    value: {
      period: "calendar_month_lagos",
      close_after_days: 5,
      four_eyes: true,
      source_kinds: ["sponsor_paid_item", "pharmacy_margin"],
      partner_kinds: ["pharmacy", "clinic"],
      basis_points_max: 10000,
      reason_min_chars: 20,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S74.md; docs/DECISIONS.md S74-2; spec 21.6",
  },
  {
    key: "pharmacy.chat",
    // The in-app pharmacist and patient conversation (S74, spec 21.2): longest message, messages per sender per day, and how many days it stays open
    // after the medicine is collected. Live values are the active row of `pharmacy_chat_config`. PROPOSED, owned by the CMO with the pharmacy lead.
    value: { max_body_chars: 1000, max_per_sender_per_day: 20, open_days_after_supply: 14 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S74.md; spec 21.2",
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
    key: "security.rules",
    // Security thresholds (S39). Live values are the active row of `security_config`; this entry mirrors it and a test fails if the
    // migration seed and this value drift. PROPOSED, owned by the security owner (CMO until one is named): how many failed lookups on a
    // public token door in one hour open a security incident. The answer to guessing is to see it, never to lock the door, because the
    // emergency card must open for a stranger in an emergency.
    value: { lookup_failure_alert_per_hour: 50 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S39.md; spec section 13",
  },
  {
    key: "security.rules",
    // Security thresholds (S39, S39c). Live values are the active row of `security_config`; this entry mirrors it and a test fails if the
    // migration seed and this value drift. PROPOSED, owned by the security owner (CMO until one is named). v1 (S39): failed lookups on a public
    // token door in one hour that open a security incident (the answer to guessing is to see it, never to lock the door). v2 (S39c): how long an
    // opening of a patient record stays valid for an untied clinician, how many untied openings in an hour raise an incident, the after-hours
    // band (Lagos hours), and the retention periods (NHS Records Management Code and HIPAA as references, counsel to confirm). Retention is
    // config only: real_data_auto_delete is false, nothing deletes real patient data (founder, 2026-10-07).
    value: {
      lookup_failure_alert_per_hour: 50,
      record_open_window_hours: 8,
      untied_open_alert_per_hour: 20,
      after_hours_start: 22,
      after_hours_end: 6,
      retention: {
        adult_clinical_record_years_after_last_contact: 8,
        child_record_until_age: 25,
        child_record_until_age_if_seen_at_17: 26,
        maternity_record_years: 25,
        mental_health_years_after_last_contact: 20,
        access_audit_log_years: 8,
        consent_years_after_relationship_end: 6,
        payments_ledger_years: 6,
        operational_data_days_min: 90,
        operational_data_days_max: 730,
        real_data_auto_delete: false,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S39c.md; spec section 13; founder direction 2026-10-07",
  },
  {
    key: "security.rules",
    // Security thresholds (S39, S39c, S39d). Live values are the active row of `security_config`; this entry mirrors it and a test fails if the
    // migration seed and this value drift. PROPOSED, owned by the security owner (CMO until one is named). v1 (S39): failed lookups on a public
    // token door in one hour that open a security incident (the answer to guessing is to see it, never to lock the door). v2 (S39c): how long an
    // opening of a patient record stays valid for an untied clinician, how many untied openings in an hour raise an incident, the after-hours
    // band (Lagos hours), and the retention periods (NHS Records Management Code and HIPAA as references, counsel to confirm). v3 (S39d): the review clock, in days, for a patient data export request. Retention is
    // config only: real_data_auto_delete is false, nothing deletes real patient data (founder, 2026-10-07).
    value: {
      lookup_failure_alert_per_hour: 50,
      record_open_window_hours: 8,
      untied_open_alert_per_hour: 20,
      after_hours_start: 22,
      after_hours_end: 6,
      export_review_days: 30,
      retention: {
        adult_clinical_record_years_after_last_contact: 8,
        child_record_until_age: 25,
        child_record_until_age_if_seen_at_17: 26,
        maternity_record_years: 25,
        mental_health_years_after_last_contact: 20,
        access_audit_log_years: 8,
        consent_years_after_relationship_end: 6,
        payments_ledger_years: 6,
        operational_data_days_min: 90,
        operational_data_days_max: 730,
        real_data_auto_delete: false,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S39d.md; spec section 13; founder direction 2026-10-07",
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
    key: "pharmacy.collection_rules",
    // Version 3 (S28e, OQ-275): adds max_items_per_visit, how many waiting prescriptions a patient can send to one pharmacy together under one code.
    // Every other value is version 2's. The live values are the active row of `pharmacy_config`.
    value: { code_length: 8, code_valid_days: 14, max_wrong_attempts: 5, suggestion_valid_days: 14, max_items_per_visit: 10 },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-16",
    source: "docs/design/S28.md section S28e; docs/OPEN-QUESTIONS.md OQ-275; spec 9.6",
  },
  {
    key: "partner.quality",
    // Version 2 (S28e, spec 21.7): adds the pharmacy figures (turnaround to dispense, how often a pharmacy reports it cannot supply) and
    // removal.suggest_only_kinds, the kinds of partner the rule only FLAGS for staff and never suspends by itself. Everything else is version 1's,
    // so laboratories and clinics behave as before. Live values are the active row of `partner_quality_config`. PROPOSED, CMO owned (OQ-360).
    value: {
      window_days: 90,
      turnaround: { lab_target_hours: 72, min_orders: 10, min_within_target_percent: 80 },
      pharmacy: { dispense_target_hours: 72, min_dispenses: 10, min_within_target_percent: 70, min_sent: 10, out_of_stock_percent: 30 },
      complaints: { category_codes: ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"], upheld_limit: 3 },
      licence: { expiring_days: 30 },
      weights: { turnaround: 40, complaints: 30, licence: 30 },
      score: { warn_below: 70, suspend_below: 50 },
      removal: {
        auto_suspend: true,
        suspend_on: ["licence_expired", "complaints_upheld_limit", "turnaround_below_target", "score_below_floor"],
        suggest_only_kinds: ["pharmacy"],
        override_days: 30,
        reason_min_chars: 20,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-16",
    source: "docs/design/S28.md section S28e; docs/design/S74.md; spec 21.7",
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
    key: "quality.audit",
    // Version 2 (Q16): adds sampling.new_clinician_full_review_cases. Clinical audits, tier 1 count, the audit form, reliability weight and the speak-up clocks (S20, spec 7.8). Live values are the
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
        new_clinician_full_review_cases: 20,
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
    version: 2,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S20.md; spec 7.8; docs/design/S11-S15-credentialing.md (CMO answer Q16: 100 percent review of a new clinician's first 20 red or prescribing cases)",
  },
  {
    key: "quality.audit",
    // Version 3 (S20 v2, CMO decisions 5, 6 and 7 recorded 2026-10-07), on top of version 2 (new clinicians' first 20 cases): the secret-seeded
    // stratified sample (a floor that catches up later in the month, AI-scribe notes at 20 percent), the audit form's phase comments,
    // avoidability rating and scribe items, the second review on a critical miss, and the speak-up check-ins at 30 and 90 days. INACTIVE and
    // unsigned in `quality_config` until the Chief Medical Officer signs it (public.sign_quality_config); versions 1 and 2 stay as they were.
    value: {
      sampling: {
        random_rate_percent: 10,
        always_reasons: ["red_event", "titration"],
        floor_min_tasks: 3,
        floor_per_clinician_per_month: 1,
        reviewer_monthly_cap: 40,
        due_days: 14,
        new_clinician_full_review_cases: 20,
        seed: {
          rotation: "monthly",
        },
        stratified: true,
        floor_catchup_until_day: 21,
        floor_current_month_from_day: 20,
        scribe_assisted_rate_percent: 20,
      },
      tier1: {
        audited_task_count: 20,
        graduation_min_score: 85,
        max_critical_misses: 0,
      },
      form: {
        version: 2,
        safety_items: ["identity_and_consent_confirmed", "red_flags_recognised_and_acted_on", "decision_within_competence_and_protocol", "no_unsigned_treatment_change", "safety_netting_and_follow_up_given", "escalated_when_needed"],
        quality_items: ["history_adequate", "reasoning_documented", "communication_clear", "plan_appropriate", "patient_questions_answered", "documentation_timely"],
        quality_max: 4,
        phases: ["assessment", "decision", "action", "documentation"],
        phase_comment_max_chars: 2000,
        avoidability: {
          required_unless_outcome: "satisfactory",
          scale: ["not_applicable", "not_avoidable", "slightly_avoidable", "possibly_avoidable", "probably_avoidable", "definitely_avoidable"],
        },
        scribe_items: ["no_clinically_relevant_omission", "no_invented_content"],
        scribe_critical_items: ["no_invented_content"],
      },
      outcomes: {
        satisfactory_min: 85,
        minor_concerns_min: 70,
        rationale_min_chars: 20,
      },
      second_review: {
        required_on: ["critical_miss"],
        reply_max_per_audit: 5,
        reply_min_chars: 20,
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
        checkin_days: [30, 90],
        anonymous_max_per_day_per_org: 10,
        about_lead_routes_to: "independent_reader",
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-14",
    source: "docs/plans/S16-S20-review-and-build-plan.md section 5; docs/design/S16-S20-quality-v2.md",
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
    key: "earnings.disputes",
    // S30b: the response clock and reasons for a clinician's question about one earnings line, and the activity check on the pilot
    // minimum. Live value is the active row of `earnings_disputes_config`; a test fails if the migration seed and this value drift.
    // Holds no money. The check HOLDS a suspicious top-up for a person; it never pays or drops one on its own.
    value: {
      dispute: {
        response_sla_hours: 72,
        window_days: 60,
        reason_codes: ["wrong_amount", "missing_work", "duplicate", "wrong_type", "other"],
      },
      pilot_minimum: {
        activity_check: true,
        hold_when_no_claims_and_work_waited: true,
        hold_when_expired_claims_and_no_completed: true,
      },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/research/S26-S30-competitor-review-and-build-plan.md (S30b); OQ-180, OQ-185",
  },
  {
    key: "finance.reconciliation",
    // The money reconciliation screen (/finance/money-reconciliation). Read-only: it lists places where payments, orders, entitlements,
    // refunds, earnings reversals, payouts and the general ledger disagree. Passed to the database as arguments, so no policy number lives
    // in SQL. Holds no money. Finance may tighten the windows; a looser window only hides a mismatch for longer.
    value: {
      // an approved or failed refund on an already-refunded order that has still not gone back is flagged after this long. It mirrors the
      // existing one-day rule in private.flag_refund_delays. (The stuck-while-sending window is NOT here: it is the one existing policy,
      // refund_rules.stuck_processing_hours, so the incident, the settle button and this screen cannot disagree.)
      unsent_refund_minutes: 1440,
      // a record that is normally created within seconds of another is only flagged after this long
      grace_minutes: 15,
      page_size: 50,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-21",
    source: "docs/design/S26.md section 9 (stuck refund, reversal hook); S25 (one writer for a paid order); S30 and S31",
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
    key: "payouts.controls",
    // Payout batch maker-checker limits (S31x, OQ-97). Paystack's transfer OTP stays OFF by founder decision, so these ARE the
    // compensating controls: a payout is sent only from a batch one approver proposed and a different approver released, and these caps
    // apply at proposal, at release and at send. Live value is the active row of `payout_controls_config`; a test fails if the migration
    // seed and this value drift. Kobo. The founder sets the real numbers; these are starting points sized for the first pilot cohort.
    //  perPayoutMaxKobo: no single weekly payout above this (150,000,000 kobo = 1.5 million naira).
    //  perClinicianRolling7DaysMaxKobo: one clinician's sent, succeeded and batched-and-approved payouts in any 7 days, plus the new one.
    //  perBatchMaxKobo / perBatchMaxCount: a batch's total and its number of payouts.
    value: {
      perPayoutMaxKobo: 150000000,
      perClinicianRolling7DaysMaxKobo: 150000000,
      perBatchMaxKobo: 1000000000,
      perBatchMaxCount: 20,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S11-S15-p4-providers.md; OQ-97",
  },
  {
    key: "providers.layer",
    // The provider layer's operating values (S14x): the webhook inbox, the circuit breaker and settlement reconciliation. Live value is
    // the active row of `provider_layer_config`; a test fails if the migration seed and this value drift.
    //  inbox: lease and attempt limits and backoff for retrying a webhook that failed; maxBodyBytes caps what is stored per event.
    //  circuit: this many consecutive outages open the breaker; after openSeconds one probe is let through.
    //  reconciliation: a paid charge no settlement lists after unsettledAfterHours is a break; breaks are bucketed by age.
    value: {
      inbox: { leaseSeconds: 120, maxAttempts: 8, backoffBaseSeconds: 30, backoffMaxSeconds: 3600, maxBodyBytes: 262144 },
      circuit: { failureThreshold: 5, openSeconds: 60 },
      reconciliation: { unsettledAfterHours: 72, ageingBucketsHours: [24, 72, 168], lookbackDays: 7 },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S11-S15-p4-providers.md",
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
    key: "queue.task_types",
    // Task types and priority classes (S16, spec 7.3 and 7.4). Live values are the active `task_types` rows; this entry
    // mirrors them, and a test compares it with the migration seed. Each row: code, priority class (1 is first), default
    // due minutes, minimum doctor tier, required competencies, lead window minutes (0 for none), claim timeout minutes,
    // pushable (an employed doctor may be pushed it), creatable (false for a class reached only by promotion) and the
    // triage task keys it answers. adherence_follow_up is not in the spec table (OQ-S16-1). v2 (F-05, 2026-10-07): the Medical Officer tier is retired, so every doctor task type has senior_medical_officer as its minimum; nothing else changed.
    value: [
      { code: "red_event_unacknowledged", priority_class: 1, default_due_minutes: 0, min_doctor_tier: "senior_medical_officer", required_competencies: ["on_call"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: true, source_task_keys: [] },
      { code: "critical_result_review", priority_class: 2, default_due_minutes: 120, min_doctor_tier: "senior_medical_officer", required_competencies: ["result_review"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: true, source_task_keys: [] },
      { code: "amber_bp_review_due_soon", priority_class: 3, default_due_minutes: 0, min_doctor_tier: "senior_medical_officer", required_competencies: ["hypertension"], lead_window_minutes: 0, claim_timeout_minutes: 30, pushable: false, creatable: false, source_task_keys: [] },
      { code: "amber_bp_review", priority_class: 4, default_due_minutes: 1440, min_doctor_tier: "senior_medical_officer", required_competencies: ["hypertension"], lead_window_minutes: 240, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["urgent_bp_review", "bp_review", "low_bp_review"] },
      { code: "symptom_review", priority_class: 5, default_due_minutes: 1440, min_doctor_tier: "senior_medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "titration_signoff", priority_class: 6, default_due_minutes: 2880, min_doctor_tier: "senior_medical_officer", required_competencies: ["prescribing", "hypertension"], lead_window_minutes: 2880, claim_timeout_minutes: 60, pushable: true, creatable: true, source_task_keys: [] },
      { code: "async_question", priority_class: 7, default_due_minutes: 1440, min_doctor_tier: "senior_medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "routine_result_review", priority_class: 8, default_due_minutes: 2880, min_doctor_tier: "senior_medical_officer", required_competencies: ["result_review"], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: [] },
      { code: "admin_clinical", priority_class: 9, default_due_minutes: 4320, min_doctor_tier: "senior_medical_officer", required_competencies: [], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["referral_review"] },
      { code: "adherence_follow_up", priority_class: 8, default_due_minutes: 2880, min_doctor_tier: "care_coordinator", required_competencies: [], lead_window_minutes: 1440, claim_timeout_minutes: 30, pushable: true, creatable: true, source_task_keys: ["adherence_review", "silence_check"] },
    ],
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
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
    key: "notifications.rules",
    // v3 (S04b-3, founder decision 2026-10-13): quiet hours are OFF until a person turns them on (window 21:00 to 07:00
    // Africa/Lagos until they change it). Discreet mode and quiet hours are applied by the one sender; safety messages
    // are never held. Live value: the active row of `notification_rules_config`.
    value: {
      quietHours: { enabled: false, start: "21:00", end: "07:00" },
      routinePushPerDay: 4,
      receiptCheckMinutes: 15,
      receiptGiveUpHours: 24,
      pushFallback: { enabled: true, afterMinutes: 240, maxAgeHours: 24, perRecipientPerDay: 1, batchSize: 200 },
    },
    owner: "Founder",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S13.md; founder decision 2026-10-13",
  },
  {
    key: "notifications.rules",
    // v4 (S13 R4, CMO answers Q10 to Q13): adds redUnconfirmed. A red alert the patient has not confirmed (opened a notice,
    // acknowledged the guidance, replied, or a push receipt says delivered) within unconfirmedMinutes (30, CMO Q11, matching the
    // obstetric treatment window; the plan had recommended 10) opens one clinician outreach task and alerts the on-call
    // clinician. undeliveredMinutes (5): when every push for the alert ended in a receipt error and no email was delivered, the
    // call is due that long after the error instead. expireHours (6): an alert older than this opens no task. deliveredCountsAsConfirmed
    // (true, per the plan): a delivered push receipt counts as confirmation; false needs a human action, which is safer and
    // sends more calls, CMO to decide. couldNotGetCareOutreachNow (true): the patient's "I could not get care" answer brings the
    // call forward. criticalReceiptCheckMinutes (2): critical Expo tickets are checked from this age, not 15.
    // The other keys are v3's, unchanged. Live value: the active row of `notification_rules_config`.
    value: {
      quietHours: { enabled: false, start: "21:00", end: "07:00" },
      routinePushPerDay: 4,
      receiptCheckMinutes: 15,
      receiptGiveUpHours: 24,
      pushFallback: { enabled: true, afterMinutes: 240, maxAgeHours: 24, perRecipientPerDay: 1, batchSize: 200 },
      redUnconfirmed: {
        enabled: true,
        unconfirmedMinutes: 30,
        undeliveredMinutes: 5,
        expireHours: 6,
        deliveredCountsAsConfirmed: true,
        couldNotGetCareOutreachNow: true,
        criticalReceiptCheckMinutes: 2,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 4,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S11-S15-p3-critical-notifications.md; CMO decision Q11 (2026-10-07)",
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
    key: "consultations.caregiver_join",
    // A Care Circle member invited by the patient into ONE consultation call (CGJ, founder decision: per call, no standing access).
    // Mirrored by `consultation_caregiver_config` version 1 (a drift test compares the two).
    //  inviteExpiryMinutes: how long an invite lasts at most; it also ends when the call's join window closes or the call ends.
    //  maxCaregiversPerCall: how many invited people one call may hold at once.
    //  minAgeYears: a caregiver is an adult; a KNOWN age under this is refused.
    //  requireDateOfBirth: false because a supporter-only account is never asked for a date of birth, so true would exclude exactly the
    //  daughter or son who supports a parent from another city. A dependant's account is refused either way (OQ-CGJ-4).
    value: { inviteExpiryMinutes: 240, maxCaregiversPerCall: 1, minAgeYears: 18, requireDateOfBirth: false },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/CGJ.md; docs/OPEN-QUESTIONS.md OQ-CGJ-1 to OQ-CGJ-5",
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
    key: "consultations.call_length",
    // Tiered call length (CMO decision C8, 2026-10-08, docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md). Mirrored by
    // followup_config kind 'call_length' version 1 (a drift test compares the two). The length and this version are stamped on the
    // encounter when it is created (INV-16).
    //  longMinutes: the yearly results call (yearlyResultsMinutes) and any Member with a condition on the problem list or an abnormal
    //  or held result in the last abnormalLookbackDays. routineMinutes: everyone else (a doctor may shorten a routine call down to routineMinMinutes).
    //  minMinutes, slotGridMinutes: the shortest bookable call and the grid its start sits on (private.slot_is_open).
    //  maxExtensionMinutes: the most a doctor can add to one call. conditionStatuses, abnormalFlags, heldReleaseStates: what counts as a need.
    value: {
      routineMinutes: 15,
      routineMinMinutes: 10,
      longMinutes: 20,
      yearlyResultsMinutes: 20,
      abnormalLookbackDays: 90,
      minMinutes: 10,
      slotGridMinutes: 5,
      maxExtensionMinutes: 15,
      conditionStatuses: ["active", "controlled", "uncontrolled", "suspected", "under_investigation"],
      abnormalFlags: ["low", "high", "critical", "positive"],
      heldReleaseStates: ["awaiting_review", "clinician_disclosure_required", "withheld"],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md C8; supabase/migrations/20261013005607_two_tier_followup_data_model_and_config.sql",
  },
  {
    key: "followups.policy",
    // Monthly follow-up (founder decisions D4 and C5): the doctor offers several times and the Member picks one. Mirrored by
    // followup_config kind 'offers' version 1 (a drift test compares the two).
    //  entitlementMonths, carryOverMonths: 12 follow-up months per membership, an unused month lapses (no stockpile).
    //  minSlots, maxSlots, offerValidHours, minLeadMinutes: how many times a doctor offers, how long an offer lives, the soonest time offered.
    //  bulkMaxPatients: the most Members one bulk offer can name. lateCancelConsumes, patientNoShowConsumes: what a late cancel and a Member
    //  no-show do to the month. holdMinutes: the live hold passed to hold_appointment_slot.
    value: {
      entitlementMonths: 12,
      carryOverMonths: 0,
      minSlots: 2,
      maxSlots: 6,
      offerValidHours: 72,
      minLeadMinutes: 120,
      bulkMaxPatients: 50,
      lateCancelConsumes: true,
      patientNoShowConsumes: false,
      holdMinutes: 10,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md D4, C5; supabase/migrations/20261013005607_two_tier_followup_data_model_and_config.sql",
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
  {
    key: "care_circle.rules",
    // Care Circle (S29, spec 4.7). Live values are the active row of `care_circle_config`; this entry mirrors it and a test fails
    // if the migration seed and this value drift. Version 4 (S29e) adds the patient-first window for a supporter's NON-EMERGENCY
    // check-in request: checkin_window_minutes is how long the patient alone is asked before the circle is told, and
    // checkin_max_per_day caps requests from one supporter about one person. The window never applies to a red event, and the whole
    // feature is OFF until the Chief Medical Officer rules (platform module `care_circle_checkin_window`, OQ-700). All other keys are as in version 3.
    value: { invite_ttl_hours: 72, default_grant_days: 365, max_invites_per_day: 5, max_members: 8, max_attempts: 5, view_weeks: 8, alert_visible_hours: 3, expiry_notice_days: 14, expiry_final_notice_days: 3, pause_days: 7, gift_decide_days: 14, gift_remind_days: 7, checkin_window_minutes: 5, checkin_max_per_day: 3 },
    owner: "Founder",
    status: "proposed",
    version: 4,
    effectiveFrom: "2026-10-16",
    source: "docs/design/S29.md; docs/research/S26-S30-competitor-review-and-build-plan.md (S29d); spec 4.7, 8.6",
  },
  // S69: community cohorts and challenges (spec 17.6 to 17.9). Live values are the active row of `community_config` and the rows of
  // `challenge_templates`; a test (community-mirror.test.ts) fails if either drifts from the migration seed.
  {
    key: "cohorts.rules",
    // min_contributors: the floor below which a cohort total is hidden (never below 10, enforced by the database; the institutional floor of 5
    // is NOT used here). max_single_share_pct: leave-one-out, a total is hidden when its biggest contributor holds more than this share, so
    // removing that one person would move the total too far. round_total_to and progress_step_pct: published figures are rounded.
    // publish_delay_hours and snapshot_every_hours: a snapshot is readable only this long after it is taken, so one entry is never a visible
    // jump. activity_minutes_week_cap and activity_minutes_day_max: WHO 150 to 300 minutes a week, capped. board_min_cohorts: cohorts needed for
    // a comparison. participation_keep_days: how long a member's own effort rows survive after a challenge ends. blocked_name_terms: a cohort
    // name may not start a word with one of these (generic names only).
    value: { min_contributors: 10, max_single_share_pct: 30, round_total_to: 10, publish_delay_hours: 12, snapshot_every_hours: 6, invite_ttl_hours: 72, max_invites_per_day: 20, max_members_per_cohort: 200, max_cohorts_per_moderator: 3, max_active_challenges: 2, challenge_min_days: 7, challenge_max_days: 60, activity_minutes_week_cap: 300, activity_minutes_day_max: 180, board_min_cohorts: 3, progress_step_pct: 5, participation_keep_days: 30, blocked_name_terms: ["diabet", "sugar", "hypertens", "blood pressure", "bp", "hiv", "aids", "cancer", "kidney", "renal", "dialysis", "heart", "stroke", "asthma", "sickle", "obes", "weight", "slim", "diet", "pregnan", "fertil", "mental", "depress", "anxiety", "addict", "recovery", "cholesterol", "epilep", "tb", "tubercul", "hepatitis", "patient", "sick", "disease"] },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S69.md; docs/research/S69.md; docs/plans/S66-S70-cmo-signoff-pack.md (A16, B1)",
  },
  {
    key: "cohorts.challenge_templates",
    // The only challenges a moderator can start (CMO sign-off pack A16): effort counts only, never weight, calories, fasting, blood pressure or
    // glucose. Proposed until the Chief Medical Officer signs each one through `sign_challenge_template`; nothing is approved by this entry.
    value: [
      { code: "log_days", label: "Check in with your health log", description: "Days you add something to your own health log.", metric: "log_days", unit: "days", default_days: 14, target_per_member: 8 },
      { code: "medicine_days", label: "Medicine check-in days", description: "Days you answer your medicine check-in.", metric: "medicine_checkin_days", unit: "days", default_days: 14, target_per_member: 8 },
      { code: "lessons", label: "Learn together", description: "Short health lessons you finish.", metric: "lessons_completed", unit: "lessons", default_days: 14, target_per_member: 3 },
      { code: "move_together", label: "Move together", description: "Minutes of activity you do. Up to 300 minutes a week count.", metric: "activity_minutes", unit: "minutes", default_days: 7, target_per_member: 150 },
      { code: "low_salt_days", label: "Lower-salt days", description: "Days you tell us you chose lower-salt food.", metric: "low_salt_days", unit: "days", default_days: 14, target_per_member: 8 },
      { code: "regular_sleep", label: "Regular bedtime days", description: "Days you tell us you kept a regular bedtime.", metric: "consistent_sleep_days", unit: "days", default_days: 14, target_per_member: 8 },
      { code: "water_with_meals", label: "Water with meals", description: "Days you tell us you drank water with meals.", metric: "water_with_meals_days", unit: "days", default_days: 14, target_per_member: 8 },
    ],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S69.md; docs/plans/S66-S70-cmo-signoff-pack.md (A16)",
  },
  // S63: digital therapy programmes. DRAFT, unsigned: the CMO confirms or replaces both entries by publishing a higher version.
  {
    key: "therapy.exclusion_lists",
    // Per programme: the entry questions and red flags that stop it (14.9). Live values are the rows of `therapy_exclusion_rules`
    // at list version 1; a test fails if the migration seed and this value drift. Items with unverified: true are local Nigerian
    // additions that stay draft until the CMO confirms them (Q16). An empty list (pulmonary_rehab) fails closed. The build never signs a list.
    value: THERAPY_EXCLUSION_LISTS as unknown as ConfigValue,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S63.md; docs/plans/S61-S65-cmo-signoff-pack.md Q13 to Q16; NICE NG123 and CG61 style exclusions",
  },
  {
    key: "therapy.programme_config",
    // Task due windows, outcome instruments, checkpoint sessions, worsening thresholds and the CBT-I and pelvic floor settings.
    // Live values are the active row of `therapy_programme_config`; a test fails on drift. phq9 and gad7 worsening values and the CBT-I
    // floor are CMO decisions (Q14, Q15); every other number was chosen by the build so the engine can run and is for the CMO to replace.
    value: THERAPY_PROGRAMME_CONFIG as unknown as ConfigValue,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S63.md; docs/plans/S61-S65-cmo-signoff-pack.md Q14, Q15",
  },
  // S26: entitlements lifecycle, care pack expiry, refunds
  {
    key: "entitlements.lifecycle",
    // S26b: renewal reminders go this many days before an entitlement ends, longest first, one message per step. After the end an entitlement
    // stays readable (never usable for doctor time) for grace_days, with a one-tap renew. A Membership and an employer seat have their own
    // rules (membership.lapse) and are not reminded by this. PROPOSED, founder decision pending. Mirrored by entitlement_policy_config
    // (kind lifecycle) in the migration seed, with a drift test.
    value: { reminder_days_before: [30, 7, 1], grace_days: 7 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/research/S26-S30-competitor-review-and-build-plan.md (S26b); supabase/migrations/20261021091357_s26b_entitlement_and_refund_hardening.sql",
  },
  {
    key: "refunds.order_rules",
    // S26b: the plain-words refund rule shown at checkout and on the receipt. cooling_off_days applies to every order that is not a Membership
    // (a Membership uses membership.refund). decision_sla_days is how long the care team has to answer; bank_days_min/max is the usual time for
    // money to reach the bank after it is sent; stuck_processing_hours is how long a refund may sit mid-send before an incident is raised and an admin may settle it; earnings_rescan_days is how long after a refund completes the clinician share reversal keeps looking for a share linked or posted late.
    // PROPOSED, founder decision pending; no counsel-dependent legal claim is made. Mirrored by entitlement_policy_config (kind refund_rules).
    value: { cooling_off_days: 14, decision_sla_days: 3, bank_days_min: 5, bank_days_max: 10, stuck_processing_hours: 2, earnings_rescan_days: 60 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/research/S26-S30-competitor-review-and-build-plan.md (S26b); supabase/migrations/20261021091357_s26b_entitlement_and_refund_hardening.sql",
  },
  {
    key: "entitlements.expiry_reminder_days",
    // Superseded 2026-10-16 by entitlements.lifecycle (reminders at 30, 7 and 1 day). Kept so older references still resolve.
    value: 7,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S26.md; docs/research/S26.md",
  },
  {
    key: "refunds.cooling_off_days",
    // Superseded for the Membership by membership.refund (21 days, decision 2026-10-12). Superseded 2026-10-16 for every other order by
    // refunds.order_rules (cooling_off_days), which the database now enforces. Kept so older references still resolve.
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
    key: "rewards.points_redemption_cap_kobo",
    // F1 (OQ-08, founder decision 2026-09-30): wellness points are non-monetary and never convert to money or a
    // voucher. The only future use of a point is a capped discount at checkout (S71/S72). This is the largest
    // discount, in integer kobo, that one redemption may take off a single order. 0 means redemption is switched
    // off, which is the state until the founder sets a cap and S71/S72 build the checkout path. Nothing may read
    // this as a points-to-kobo rate.
    value: 0,
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/OPEN-QUESTIONS.md OQ-08 and OQ-F1-01; docs/design/S55-S60-build-plan.md section 4.3",
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
    key: "rewards.plausible_ranges",
    // S58 (spec Module 11). Live value is the `plausible_ranges` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // A logged reading outside these bounds is treated as a device or typing error and earns no points. Wide on purpose: a dangerous reading is still plausible and still earns normally; the triage path never reads this.
    value: {"systolic": [50, 260], "diastolic": [30, 160], "glucose_mmol_l": [1, 40], "pulse_bpm": [25, 230], "temperature_c": [30, 43], "spo2_pct": [50, 100], "ketones_mmol_l": [0, 15], "respiratory_rate_bpm": [4, 60], "peak_flow_l_min": [50, 900]},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.daily_points_cap",
    // S58 (spec Module 11). Live value is the `daily_points_cap` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // Most points one person can earn in a Lagos day across all rules, so effort stays steady and nothing can be farmed.
    value: {"points": 100},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.minor_age_years",
    // S58 (spec Module 11). Live value is the `minor_age_years` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // Under this age: fixed rewards only, no tiers shown as a contest, no redemption. No variable or chance-based reward exists at any age.
    value: {"years": 18},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.tiers",
    // S58 (spec Module 11). Live value is the `tiers` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // Yearly tiers. The year counter resets each 1 January (Lagos); earned status carries through the next year, so a tier is never taken away mid-year. The spendable balance never resets.
    value: {"timezone": "Africa/Lagos", "carry_status_next_year": true, "tiers": [{"key": "sprout", "min": 0}, {"key": "leaf", "min": 400}, {"key": "branch", "min": 1200}, {"key": "canopy", "min": 3000}]},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.streak_grace",
    // S58 (spec Module 11). Live value is the `streak_grace` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // A consistency badge tolerates this many quiet days inside its window. A streak is only ever a badge condition: no counter shows a reset and nothing notifies a missed day.
    value: {"window_days": 7, "missed_days_allowed": 1},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.employer_aggregate",
    // S58 (spec Module 11). Live value is the `employer_aggregate` row of `reward_config`; rewards-mirror.test.ts fails if the two drift. UNSIGNED.
    // Module 24 seam: an employer-style report shows counts only and suppresses any group smaller than this (I9: aggregate only).
    value: {"min_group": 10},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; docs/design/S55-S60-build-plan.md section 4.3",
  },
  {
    key: "rewards.rules",
    // S58 (spec 11.1): what earns Health Points, by rule code, with caps and decay. Live value is the active `reward_rules` version 1
    // seed; rewards-mirror.test.ts parses the migration marker. No rule may reference weight, BMI or any body metric (CHECK constraint).
    // Points are not clinical, so the founder owns them; every rule is UNSIGNED and an admin changes one as a new proposed version.
    value: [{"code": "vitals_logged", "trigger_event": "vitals.logged", "points": 10, "caps": {"per_day": 1}}, {"code": "meal_logged", "trigger_event": "meal.logged", "points": 10, "caps": {"per_day": 1}}, {"code": "adherence_checkin_completed", "trigger_event": "adherence.checkin_answered", "points": 15, "caps": {"per_day": 1}}, {"code": "education_lesson_completed", "trigger_event": "lesson.completed", "points": 20, "caps": {"per_day": 3}}, {"code": "lpe_task_completed", "trigger_event": "lifestyle.task_completed", "points": 15, "caps": {"per_day": 1}}, {"code": "lpe_goal_achieved", "trigger_event": "lifestyle.goal_achieved", "points": 50}, {"code": "challenge_completed", "trigger_event": "challenge.completed", "points": 0, "points_source": "catalogue"}, {"code": "wellness_class_attended", "trigger_event": "class.attended", "points": 0, "points_source": "catalogue", "caps": {"per_day": 2}}, {"code": "course_completed", "trigger_event": "course.completed", "points": 40, "caps": {"lifetime": 20}, "verified_action": true}, {"code": "lab_done", "trigger_event": "lab_result.released", "points": 30, "caps": {"per_day": 1, "decay": [{"upto": 2, "pct": 100}, {"upto": 6, "pct": 50}, {"pct": 25}]}, "verified_action": true}, {"code": "review_attended", "trigger_event": "encounter.completed", "points": 40, "caps": {"per_day": 1, "decay": [{"upto": 1, "pct": 100}, {"upto": 4, "pct": 50}, {"pct": 25}]}, "verified_action": true}, {"code": "screening_done", "trigger_event": "screening.completed", "points": 40, "caps": {"per_day": 2, "decay": [{"upto": 2, "pct": 100}, {"upto": 6, "pct": 50}, {"pct": 25}]}, "verified_action": true}],
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S58.md; supabase/migrations/20261007170413_s58_rewards_foundation.sql",
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
    key: "lab.panels",
    // v3 (2026-10-12, CMO C1/C6): HIV screen, HBsAg and anti-HCV are REQUIRED every year, not "only if ordered". Same analytes and limits
    // as v2 otherwise. Mirrors lab_panel_versions v2, made by 20261013005133_membership_annual_screening_required.sql; a test fails if the
    // two drift. Stays `proposed` until the CMO signs; nothing auto-releases before that.
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
              "sensitive": true
            },
            {
              "code": "hbsag",
              "label": "Hepatitis B surface antigen",
              "kind": "qualitative",
              "unit": "",
              "sensitive": true
            },
            {
              "code": "hcv_ab",
              "label": "Hepatitis C antibody",
              "kind": "qualitative",
              "unit": "",
              "sensitive": true
            }
          ]
        }
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-12",
    source: "docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md (C1, C6); docs/clinical-signoff/STANDARDS-CROSS-CHECK-2026-10-07.md; WHO haemoglobin thresholds 2024; Royal College of Pathologists critical results",
  },
  {
    key: "lab.panels",
    // v4 (S46d, 2026-10-20): v3 plus anti-HBs as a clinician-set add-on (founder decision S46-1): optional, never chosen by the patient, no price, every result held for a clinician. Mirrors
    // lab_panel_versions v3, made by 20261020183958_s46d_health_report_completion.sql; a test fails if the two drift. Stays `proposed` until the CMO signs.
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
              "sensitive": true
            },
            {
              "code": "hbsag",
              "label": "Hepatitis B surface antigen",
              "kind": "qualitative",
              "unit": "",
              "sensitive": true
            },
            {
              "code": "hcv_ab",
              "label": "Hepatitis C antibody",
              "kind": "qualitative",
              "unit": "",
              "sensitive": true
            },
            {
              "code": "anti_hbs",
              "label": "Hepatitis B surface antibody (anti-HBs)",
              "kind": "qualitative",
              "unit": "",
              "optional": true,
              "addOn": true,
              "orderedBy": "clinician",
                  "holdForReview": true
            }
          ]
        }
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 4,
    effectiveFrom: "2026-10-20",
    source: "docs/DECISIONS.md S46-1; docs/design/S46d.md",
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
  {
    key: "commerce.membership_prices",
    // Two-tier decisions D2 (2026-10-08) and C3/C10 (2026-10-12): the individual Membership is 120,000 naira a year and an
    // organisation pays a flat 100,000 naira per member, adjustable per organisation from the admin dashboard. Both integer kobo
    // (INV-15). Volume tiers (80k/70k/60k) were dropped. The platform launches at 120,000 (founder, 2026-10-12): the database row takes
    // effect the moment the migration is applied and the 100,000 row is closed at the same instant, so the old figure is never in
    // force. The database holds the live rows (prices, organisation_member_prices); this is the code-side mirror and the mirror test
    // pins both migrations' numbers to these.
    value: { individual_kobo: 12_000_000, organisation_member_kobo: 10_000_000 },
    owner: "Founder",
    status: "confirmed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md (D2, C3, C10); supabase/migrations/20261013003317_two_tier_membership_pricing.sql",
  },
  {
    key: "employer.seat_pilot",
    // EMP (docs/design/EMP.md): limits for an employer seat pilot and the rounding of its report. max_seats_per_pilot and
    // max_window_days stop a typo in a finance form; usage counts are shown rounded to report_round_to; usage_report_enabled stays false until counsel and the DPO have signed the employee notice (OQ-EMP-7, OQ-EMP-9), so a pilot reports seat counts only. The minimum cell is NOT here: the report uses the one platform rule, private.min_cell_floor (S75a, OQ-233), so there is a single number to change (I9). The
    // price is NOT here: a pilot seat is priced at the organisation price in force (commerce.membership_prices). Mirrored by
    // employer_seat_pilot_config in the migration seed, with a drift test. UNSIGNED: the founder has not approved the limits.
    value: { max_seats_per_pilot: 500, max_window_days: 120, report_round_to: 5, usage_report_enabled: false },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/EMP.md; supabase/migrations/20261022002100_employer_seat_pilot_kit.sql",
  },
  {
    key: "membership.lapse",
    // Founder decision 2026-10-12: when a Membership year ENDS NATURALLY the person keeps Member status for a 14 day grace, then is
    // Free again (state lapsed). A refund is different: it ends Member access at once (membership.refund, decision 2026-10-12). Renewal reminders go 30, 14 and 7 days before the end (in-app, push or email; never SMS). Mirrored by
    // membership_lapse_config in the database (the migration seed), with a drift test.
    value: { grace_days: 14, reminder_days_before: [30, 14, 7] },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "Founder decision 2026-10-12 (lapse and grace); supabase/migrations/20261013010732_two_tier_only_free_and_member.sql",
  },
  {
    key: "membership.refund",
    // Founder/CMO decision 2026-10-12: a Membership is refundable only within 21 days of purchase; an approved refund ends Member access
    // immediately (no grace). Mirrored by membership_policy_config (kind refund) in the migration seed, with a drift test.
    value: { window_days: 21 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "Founder/CMO decision 2026-10-12 (review of integration/two-tier); supabase/migrations/20261013012113_two_tier_refund_window_and_immediate_end.sql",
  },
  {
    key: "membership.legacy_conversion",
    // Founder decision 2026-10-13: every legacy programme or plan holder becomes a real Member. A holder with an end date keeps it; a holder
    // with an active purchase and no end date gets a full 365 days from conversion. PROPOSED. Mirrored by membership_policy_config
    // (kind legacy_conversion), with a drift test.
    value: { no_end_date_days: 365 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "Founder decision 2026-10-13 (legacy holders); supabase/migrations/20261013012113_two_tier_refund_window_and_immediate_end.sql",
  },
  {
    key: "membership.review",
    // Prescription renewals are discussed at the monthly review, not requested separately (decision 2026-10-13). The pre-call summary
    // lists the medicines whose prescription expires within this many days of the call. PROPOSED; the CMO confirms the window.
    value: { renewal_window_days: 30 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "Founder/CMO decision 2026-10-13 (renewals at the monthly review); supabase/migrations/20261013013400_two_tier_renewal_at_monthly_review.sql",
  },
  {
    key: "commerce.second_opinion",
    // A second opinion is an extra 5,000 naira (500,000 kobo, INV-15), sold to Members only. The price is the service_products row for
    // second_opinion_credit; this entry is the code-side mirror and a test pins the migration to it.
    value: { item_code: "second_opinion_credit", price_kobo: 500_000, members_only: true },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "Founder/CMO decision 2026-10-12 (second opinion extra); supabase/migrations/20261013012811_two_tier_renewals_included_second_opinion_member_only.sql",
  },
  {
    key: "commerce.organisation_member_price_limits",
    // Floor and ceiling an admin can set for one organisation's member price, so a typo cannot set 1 naira: 50,000 to 200,000 naira.
    // PROPOSED: the founder confirms the band. The default (100,000) and the individual price (120,000) both sit inside it. Mirrored
    // byte for byte by organisation_price_limits (the migration seed) and enforced by a table trigger as well as the admin RPC.
    value: { item_code: "membership_annual", min_kobo: 5_000_000, max_kobo: 20_000_000, default_kobo: 10_000_000 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/v5-sessions/00-AMENDMENTS-2026-10-08-two-tier.md (C10); supabase/migrations/20261013003317_two_tier_membership_pricing.sql",
  },
  {
    key: "ops.service_targets",
    // SR1 (docs/plans/SCALE-READINESS-PLAN.md section 2). The numbers the platform is held to at every stage (500, 5,000,
    // 25,000, 100,000 Members). PROPOSED: the CMO and founder have not signed them, and this entry must not be marked confirmed by an agent.
    // The page acknowledgement ladder (5 and 10 minutes) is paging.escalation_minutes, not repeated here.
    value: {
      redEventPagedWithinSeconds: 60,
      readingSavedAndGradedWithinSeconds: 5,
      nextTaskWithinSeconds: 2,
      chartSummaryOpensWithinSeconds: 3,
      lostPaymentConfirmationsAllowed: 0,
      lostLabResultsAllowed: 0,
      lostNotificationsAllowed: 0,
      duplicatedTasksAllowed: 0,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/plans/SCALE-READINESS-PLAN.md section 2 (service targets); to be signed by the CMO and founder",
    guardPatterns: ["redEventPagedWithin\\w*\\s*[=:]\\s*60\\b", "nextTaskWithin\\w*\\s*[=:]\\s*2\\b"],
  },
  {
    key: "ops.health_thresholds",
    // SR1: where /api/health/deep turns a measure from public.platform_health_snapshot() into ok, degraded or down.
    // Minutes unless the name says otherwise. PROPOSED by engineering; the founder confirms once the on-call route exists (SR5).
    // An unacknowledged page going "down" at 10 minutes lines up with the second step of paging.escalation_minutes.
    value: {
      dbQueryTimeoutMs: 3000,
      connectionsDegradedPercent: 70,
      connectionsDownPercent: 90,
      overdueTaskDegradedMinutes: 15,
      overdueTaskDownMinutes: 60,
      unacknowledgedPageDegradedMinutes: 5,
      unacknowledgedPageDownMinutes: 10,
      notificationBacklogDegradedMinutes: 10,
      notificationBacklogDownMinutes: 30,
      criticalUnopenedDegradedMinutes: 10,
      criticalUnopenedDownMinutes: 30,
      eventBacklogDegradedMinutes: 10,
      eventBacklogDownMinutes: 30,
      webhookBacklogDegradedMinutes: 5,
      webhookBacklogDownMinutes: 30,
      outboundDeadLetterDegradedCount: 1,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/plans/SCALE-READINESS-PLAN.md section 3 (Phase 3 alert rules); supabase/migrations/20261013010258_sr1_platform_health_snapshot.sql",
  },
  {
    key: "ops.deadman_thresholds",
    // OQ-436: where /api/health/deadman (polled from OUTSIDE Supabase and Vercel by .github/workflows/deadman-switch.yml) turns the four
    // numbers from public.deadman_status() into ok, degraded or down. Seconds unless the name says otherwise. process-events runs
    // every 15 seconds and the paging engine itself calls a heartbeat stale at 120 seconds (paging_delivery_config), so 180 seconds
    // of silence is "down" and 10 deliveries due for 5 minutes and still unclaimed is "down" (one or a few is a warning). PROPOSED by engineering; the founder confirms. Do not mark confirmed from an agent.
    value: {
      dbQueryTimeoutMs: 5000,
      heartbeatDegradedSeconds: 90,
      heartbeatDownSeconds: 180,
      dueOlderThanSeconds: 300,
      dueUnclaimedDegradedCount: 1,
      dueUnclaimedDownCount: 10,
      deadLetterDegradedCount: 1,
      deadLetterDownCount: 25,
      openSev1Sev2DegradedCount: 1,
      openSev1Sev2DownCount: 5,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/OPEN-QUESTIONS.md OQ-436; supabase/migrations/20261019204512_oq436_deadman_status.sql; docs/PLATFORM_OUTAGE_RUNBOOK.md external dead-man's switch",
  },
  {
    key: "ops.alert_rules",
    // SR5 operations alert rules (docs/plans/SCALE-READINESS-PLAN.md section 3). Live values are the rows of `ops_alert_rules`; this
    // entry mirrors the migration seed and a test fails if they drift. Every number is a proposal for the founder and CMO: the
    // 60 second page target, 70 percent connection and disk lines, 2 percent send failures, 3 percent Zoom join failures and
    // 10 percent phone fallback come from the plan. disk_limit_bytes is a placeholder until SR1 records the real plan.
    value: {
      unacknowledged_page: { severity: "sev1", params: {} },
      queue_starvation: { severity: "sev2", params: { grace_minutes: 0 } },
      rota_gap_12h: { severity: "sev1", params: { hours: 12 } },
      notification_failure_rate: { severity: "sev2", params: { window_minutes: 15, max_failure_percent: 2, min_volume: 20, stuck_pending_minutes: 10 } },
      payment_webhooks_unprocessed: { severity: "sev2", params: { older_than_minutes: 5, errored_window_minutes: 60 } },
      zoom_webhooks_unprocessed: { severity: "sev2", params: { older_than_minutes: 5, errored_window_minutes: 60 } },
      db_connections: { severity: "sev2", params: { max_percent: 70 } },
      db_disk: { severity: "sev2", params: { max_percent: 70, disk_limit_bytes: 8589934592 } },
      stale_cron: { severity: "sev2", params: { lookback_hours: 72, factor: 2, min_slack_minutes: 2 } },
      lab_result_unreviewed: { severity: "sev2", params: { review_target_hours: 24 } },
      zoom_join_fallback: { severity: "sev2", params: { window_minutes: 60, min_volume: 20, max_failed_percent: 3, max_fallback_percent: 10 } },
      edge_function_errors: { severity: "sev2", params: { signal: "edge_error_rate_percent", max_value: 1, max_age_minutes: 15 } },
      edge_function_drift: { severity: "sev2", params: { signal: "edge_drift_count", max_value: 0, max_age_minutes: 480 } },
      cost_projection: { severity: "sev3", params: { signal: "cost_projection_percent_of_budget", max_value: 100, max_age_minutes: 1440 } },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-12",
    source: "docs/plans/SCALE-READINESS-PLAN.md section 3; supabase/migrations/20261013005350_sr5_alert_rules_and_operations_wall.sql",
  },
  {
    key: "community.rules",
    // Community groups (decisions COM-1 to COM-10, docs/COMMUNITY_SPEC.md). Live values are the active row of `community_config`; this entry mirrors it
    // and community-mirror.test.ts fails if the migration seed and this value drift. PROPOSED: post length, the first post a new member waits for (lowered from three to one in the Phase 2 review: Mayo Connect posts at once, so we measure first-post drop-off and can raise it again), rate
    // limits, the cool-down after repeated blocked attempts, the number of reporters that hides a post, how long a removed post's text is kept, and the
    // limits on the unmask. The retention figure and the consent version are counsel's (OQ-COM-06); the rest are the founder's and the CMO's.
    // A change is a NEW version here AND a new community_config row; the old one is never edited.
    value: {
      post_max_chars: 2000,
      edit_window_minutes: 15,
      new_member_premoderated_posts: 1,
      appeal_window_days: 14,
      quality_sample_pct: 10,
      image_max_bytes: 4194304,
      qa_questions_per_member: 3,
      qa_answer_grace_minutes: 60,
      overdue_safety_minutes: 30,
      overdue_queue_minutes: 60,
      rate_posts_per_hour: 6,
      rate_posts_per_day: 30,
      block_cooldown: {"max_blocks": 3, "window_minutes": 10, "cooldown_minutes": 60},
      auto_hide_report_threshold: 3,
      removed_body_retention_days: 90,
      unmask: {"min_reason_chars": 20, "max_per_day": 5, "signal_window_days": 30},
      consent_version: "v1-2026-10-12-founder-cmo",
      feed_page_size: 20,
      max_page_size: 50,
      welcome_days: 14,
      return_nudge_days: 3,
      avatars: ["leaf", "sun", "river", "hill", "star", "seed", "cloud", "stone", "wave", "bird"],
      handle_words: {
        adjectives: ["calm", "brave", "bright", "gentle", "steady", "kind", "warm", "quiet", "bold", "clever", "cheerful", "patient", "sunny", "swift", "wise", "lively", "hopeful", "honest", "mellow", "sturdy", "tender", "vivid", "witty", "zesty", "noble", "merry", "serene", "spry", "plucky", "radiant"],
        nouns: ["river", "hill", "leaf", "sparrow", "baobab", "palm", "harbour", "lantern", "meadow", "pebble", "breeze", "cedar", "comet", "dune", "ember", "falcon", "garden", "heron", "island", "jasmine", "kestrel", "lagoon", "maple", "orchid", "plateau", "quartz", "reed", "savanna", "thistle", "willow"],
      },
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-09",
    source: "docs/COMMUNITY_SPEC.md sections 4.1 to 4.5; supabase/migrations/20261009193728_community_guard_and_seed.sql",
    guardPatterns: ["post[_ ]?max[_ ]?chars\\w*\\s*[=:]\\s*2000\\b", "premoderated\\w*\\s*[=:]\\s*3\\b", "auto[_ ]?hide\\w*\\s*[=:]\\s*3\\b"],
  },
  {
    key: "privacy.deletion_grace",
    // S04b-2 (OQ-50): how long a patient has to change their mind after asking to close their account and erase what the law
    // allows to be erased. Nothing is approved or completed before it ends and the patient can cancel until then. The database
    // counts it from its own clock and holds it to 7..30 days whatever the app asks for (data_deletion_requests.requested_grace_days). Fourteen days is a PROPOSED
    // figure, not from the spec; counsel and the founder confirm.
    value: { days: 14 },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/OPEN-QUESTIONS.md OQ-50; supabase/migrations/20261013181937_s04b2_consent_receipts_withdrawal_rule_deletion_grace.sql",
  },
  {
    key: "bp.home_programme",
    // S07x: the seven-day home blood pressure check (CMO-approved text C1, C2, C3 of 2026-10-07, NOT signed). Live value is the active, signed row of
    // `home_bp_programme_signoffs`.config; home-bp-mirror.test.ts fails if the migration seed and this value drift. The phone bundles this value, so a change
    // reaches installed phones only with the next build or update; the server (which records the result and raises the care-team task) always uses the signed row.
    // protocol: C1 (2 readings a minute apart, morning and evening, 7 days, minimum 3 days and 12 readings, every reading averaged).
    // bands: C2 (home mean 135/85 or above is above the home hypertension level; 130-134 / 80-84 is borderline). pattern: C3 (clinic 140/90, 30 days).
    value: {
      "protocol": {
        "readingsPerSession": 2,
        "minGapMinutes": 1,
        "targetDays": 7,
        "minDays": 3,
        "minReadings": 12,
        "restMinutes": 5,
        "avoidBeforeMinutes": 30,
        "morningHours": [4, 12],
        "eveningHours": [17, 24]
      },
      "bands": {
        "aboveSystolic": 135,
        "aboveDiastolic": 85,
        "borderlineSystolic": 130,
        "borderlineDiastolic": 80
      },
      "pattern": {
        "clinicSystolic": 140,
        "clinicDiastolic": 90,
        "windowDays": 30
      },
      "tasks": {
        "reviewDueMinutes": 2880,
        "patternDueMinutes": 2880
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md Part B C1 to C3; Nigeria hypertension guideline 2023-2028 sections 3.1.1, 3.2, 5.4.5, 6.2, 6.3; supabase/migrations/20261013182514_s07x_home_bp_programme.sql",
  },
  {
    key: "bp.cuff_check",
    // S07y: "home cuff vs clinic cuff". EVERY number here is a proposal (the CMO has not seen it; nothing is signed). Live value is the active, signed row of
    // `cuff_check_rules`.config; cuff-check-mirror.test.ts fails if the migration seed and this value drift. The server alone applies it (the phone does not bundle it).
    // pairing: a home-log pair uses the patient's own manual or device readings within windowHours either side of a clinic reading, at least minHomeReadings of them.
    // difference: the own cuff reads differently when own minus clinic reaches 10 systolic or 5 diastolic (mmHg), in either direction.
    // consistency: at least minPairs of the newest maxPairs pairs inside lookbackDays, at least minSharePercent of them off in the SAME direction.
    // tasks: a routine review task, due in 7 days. The result is for the care team only: never a diagnosis, never in a notification (INV-07).
    value: {
      "pairing": {
        "windowHours": 24,
        "minHomeReadings": 2
      },
      "difference": {
        "systolic": 10,
        "diastolic": 5
      },
      "consistency": {
        "minPairs": 3,
        "maxPairs": 5,
        "lookbackDays": 365,
        "minSharePercent": 75
      },
      "tasks": {
        "reviewDueMinutes": 10080
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/S07y.md; supabase/migrations/20261020184217_s07y_home_cuff_vs_clinic_check.sql. No guideline fixes these numbers: the 5 mmHg diastolic figure echoes common device-validation mean-difference limits, the rest are engineering proposals.",
  },
  {
    key: "bp.cuff_sizing",
    // S07y. PROPOSED, unsigned. Arm circumference (whole cm, rounded half up) to cuff size, from the published AHA 2019 and ESH 2023 cuff-size tables (docs/research/S07y.md).
    // Live value is the active, signed row of `bp_cuff_guidance_signoffs`.config; cuff-sizing-mirror.test.ts fails if the migration seed and this value drift.
    // The CMO checks the ranges against the Nigerian guideline (NG-2023 section 3.1.1) before signing. The wording lives in packages/i18n (hc.cuff.*); wordingSha256 pins it (cuff-wording-pin.test.ts), so changing a word needs a new version and a new signature.
    value: {
      "sizes": [
        { "key": "small_adult", "minCm": 22, "maxCm": 26 },
        { "key": "adult", "minCm": 27, "maxCm": 34 },
        { "key": "large_adult", "minCm": 35, "maxCm": 44 },
        { "key": "extra_large", "minCm": 45, "maxCm": 52 }
      ],
      "measureMinCm": 15,
      "measureMaxCm": 60,
      "wordingSha256": "1179c39d263814d87b9563886afd9fc18f2764d58368f29f0bb53318033162cf"
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/research/S07y.md; AHA 2019 (Muntner) and ESH 2023 (Mancia) cuff-size tables; supabase/migrations/20261021113725_s07y_cuff_guidance_and_bp_band_report.sql",
  },
  {
    key: "offline.trust",
    // S06x. PROPOSED: how long a phone may go without checking in before its encrypted-store key lease expires and it does its last upload
    // attempt and wipes (D3 in docs/plans/S06-S10-cmo-decisions-2026-10-07.md says 30 days; the server column
    // offline_sync_config.device_lease_days mirrors it, offline-trust-mirror.test.ts fails if they drift), the least gap between two reachability
    // probes while rows wait (a HEAD with no body, so it costs almost no data), how long a probe may take, and how many hours a phone waits after it first sees its own lease as lapsed (offline, so the server cannot confirm) before it wipes, and how many rejection reports one account may file a day (a per-account cap in the database stops a flood).
    value: {
      device_lease_days: 30,
      probe_min_interval_seconds: 60,
      probe_timeout_seconds: 8,
      rejection_report_daily_cap: 200,
      lease_grace_hours: 24,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-cmo-decisions-2026-10-07.md D1 to D3; supabase/migrations/20261013181713_s06x_offline_trust.sql",
    guardPatterns: ["lease\\w*days?\\s*[=:]\\s*30\\b", "probe\\w*(interval|seconds)\\w*\\s*[=:]\\s*60\\b"],
  },
  {
    key: "device_lab.budgets",
    // S06x-c / S08x-3 device lab run. PROPOSED: the performance budgets the device lab harness (scripts/device-lab, packages/shared/src/device-lab)
    // reports against. They come from docs/S06X_DEVICE_CHECKLIST.md and docs/plans/S06-S10-competitor-gap-and-build-plan.md (S06x-c).
    // Sizes are decimal megabytes (1 MB = 1,000,000 bytes, as Android Settings shows them). memory_mb_max is null on purpose: no memory budget is
    // set, so the harness records the number and says "no budget". enforcement is "report_only": the harness NEVER fails a build or a release on
    // these numbers, it reports them. cold_start is the median of cold_start_runs; reconnect_flush is measured from the network returning to the
    // waiting-to-send notice clearing.
    value: {
      cold_start_ms_max: 3000,
      cold_start_runs: 5,
      installed_size_mb_max: 40,
      memory_mb_max: null,
      log_store_write_ms_max: 50,
      log_visible_ms_max: 300,
      log_latency_runs: 10,
      reconnect_flush_seconds_max: 60,
      probe_requests_per_minute_max: 1,
      enforcement: "report_only",
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/S06X_DEVICE_CHECKLIST.md; docs/plans/S06-S10-competitor-gap-and-build-plan.md S06x-c; docs/device-lab/RUNBOOK.md",
    guardPatterns: ["cold\\w*start\\w*(ms)?\\s*[=:]\\s*3_?000\\b", "installed\\w*size\\w*(mb)?\\s*[=:]\\s*40\\b"],
  },
  {
    key: "offline.freshness",
    // S06y. PROPOSED: how many hours old the copy of the record kept on the phone (the emergency card, the medicines list, today's doses) may be before
    // the app adds a calm "this may be out of date, connect to refresh" notice. Below it the app only says when the copy was last updated. 24 hours is a
    // starting point for the CMO to confirm or change; nothing is signed and no clinical rule depends on it. Read through loadFreshnessConfig() in
    // apps/mobile/src/lib/freshness.ts, never as a literal.
    value: {
      stale_after_hours: 24,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/S06y-freshness.md; docs/plans/S06-S10-competitor-gap-and-build-plan.md section 5 (S06x offline trust)",
    guardPatterns: ["stale\\w*hours?\\s*[=:]\\s*24\\b"],
  },
  {
    key: "offline.reconnect_power",
    // S06z. PROPOSED: the least gap between two reconnect-triggered flushes of everything waiting on the phone (a flapping signal must not
    // start a flush every few seconds), and the battery level at or below which the phone counts as low on power. At low power or in the
    // phone's battery saver the app skips non-essential pulls and the bulk health-sample upload; saving a reading and sending an urgent
    // entry are never delayed. Nobody has judged these two numbers clinically or on a real handset.
    value: {
      reconnect_flush_min_gap_seconds: 20,
      low_battery_percent: 15,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-21",
    source: "docs/design/S06.md, docs/design/S06x.md section 5, branch s06z/reconnect-flush-and-power",
  },
  {
    key: "my_health.sharing_and_access_log",
    // My Health completion (S09x). Live values are the active row of `my_health_config`.config (sharing, access_log); my-health-mirror.test.ts fails if the
    // migration seed and this value drift. PROPOSED: the default share expiry (12 hours, shorter than the 24 the first share screen used; the 30 day cap is
    // unchanged), the PIN length, how many wrong PINs lock a share, how many from one client in a window, and the one-session window. show_staff_opens is
    // INERT since S09x2 (founder decision 2026-10-13): my_access_log() no longer reads it and always shows a routine staff opening as name and role only.
    // It stays false in the signed v1 row because changing it needs a new CMO-signed version, which an agent never produces.
    value: {
      sharing: {
        default_expiry_hours: 12,
        max_expiry_hours: 720,
        expiry_options_hours: [1, 6, 12, 24, 72, 168, 720],
        pin_digits: 6,
        pin_max_misses: 5,
        pin_client_max_misses: 3,
        pin_client_window_minutes: 15,
        one_session_window_minutes: 30,
      },
      access_log: { page_size: 50, max_page_size: 100, show_staff_opens: false },
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-competitor-gap-and-build-plan.md section 5 (S09x); docs/design/S09x.md; supabase/migrations/20261013181946_s09x_my_health_completion.sql",
    guardPatterns: ["pin\\w*miss\\w*\\s*[=:]\\s*5\\b", "default\\w*expiry\\w*\\s*[=:]\\s*12\\b"],
  },
  {
    key: "my_health.lock_screen_pass",
    // CMO item C8 (docs/plans/S06-S10-cmo-decisions-2026-10-07.md): APPROVED TEXT, NOT SIGNED. The only things a lock-screen or wallet pass may carry.
    // Live value is the active row of `my_health_config`.config.lock_screen_pass; the CMO signs it through sign_my_health_config. Off by default (D4).
    value: {
      default_enabled: false,
      fields: ["initials", "blood_group", "genotype", "genotype_provenance", "allergies_on_file", "emergency_contact_phone", "unlock_hint"],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md C8 and D4; supabase/migrations/20261013181946_s09x_my_health_completion.sql",
  },
  {
    key: "activity.safety_rules",
    // Activity safety gate (S48a, spec 5.2 / 5.5). PROPOSED, UNSIGNED: the CMO owns every number and every blocked kind below. Live values are the
    // active row of `activity_safety_config`.config; activity-gate-parity.test.ts fails if the migration seed and this value drift. The gate only
    // ever restricts, so enforcing unsigned rules errs toward rest; signing records the CMO's review, it does not switch the gate on.
    //  lookback: a red triage event inside red_hours is rest; an amber one inside amber_hours is gentle-only; unsettled_bp_days is how far back a
    //            BP-observation amber or red marks hypertension as not settled.
    //  kinds:    effort_met is for display and weekly load; intensity is what the gate compares to a rule's max_intensity.
    value: {
      lookback: { red_hours: 48, amber_hours: 48, unsettled_bp_days: 7 },
      kinds: {
        walking: { effort_met: 3.5, intensity: "gentle" },
        chair_based: { effort_met: 2.5, intensity: "gentle" },
        cycling: { effort_met: 6, intensity: "moderate" },
        dancing: { effort_met: 5, intensity: "moderate" },
        farm_manual_work: { effort_met: 5, intensity: "moderate" },
        running: { effort_met: 8, intensity: "vigorous" },
        football: { effort_met: 8, intensity: "vigorous" },
      },
      condition_match: {
        hypertension: { name_patterns: ["hypertens", "high blood pressure"], icd10_prefixes: ["I10", "I11", "I12", "I13", "I15"] },
        arthritis: { name_patterns: ["arthrit"], icd10_prefixes: ["M05", "M06", "M15", "M16", "M17", "M18", "M19"] },
        back_pain: { name_patterns: ["back pain", "lumbago", "sciatica", "slipped disc"], icd10_prefixes: ["M54"] },
      },
      rules: {
        amber: { max_intensity: "gentle", blocked_kinds: [] },
        pregnancy: { max_intensity: "moderate", blocked_kinds: ["football"] },
        pregnancy_high_risk: { max_intensity: "gentle", blocked_kinds: ["football", "running"] },
        hypertension_unsettled: { max_intensity: "gentle", blocked_kinds: [] },
        arthritis: { max_intensity: "moderate", blocked_kinds: ["running", "football"] },
        back_pain: { max_intensity: "moderate", blocked_kinds: ["football", "farm_manual_work"] },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/BUILD-SPEC-v5.md Module 5 (5.2, 5.5) and invariants INV-01, INV-14; docs/design/S48a.md; supabase/migrations/20261020180745_s48a_activity_safety_gate.sql",
  },
  {
    key: "activity.goals",
    // Weekly activity goal (S48a, spec 5.1). 150 minutes a week of moderate activity is the commonly cited adult guideline figure; a person can set their own.
    value: { weekly_active_minutes_default: 150, daily_steps_default: 7500 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/BUILD-SPEC-v5.md Module 5 (5.1); supabase/migrations/20261020180745_s48a_activity_safety_gate.sql",
  },
  {
    key: "activity.readiness_bands",
    // Training load, recovery and sleep bands from stored device readings (S48b, spec 5.6). PROPOSED, unsigned, owner CMO. Compared with the person's
    // OWN usual only, never with other people. recent_days against the baseline before it; a band needs at least min_recent_days and
    // min_baseline_days days with data. usual_band_pct: within this percent either way is "about your usual". load: the last acute_days average
    // against the chronic_days average (needs min_chronic_days days with data); below light_ratio is lighter, above heavy_ratio is heavier.
    // Pinned by activity-readiness.test.ts. Dormant until real provider data exists (no provider credentials today).
    value: {
      recent_days: 3,
      baseline_days: 28,
      min_recent_days: 2,
      min_baseline_days: 7,
      usual_band_pct: 10,
      load: { acute_days: 7, chronic_days: 28, min_chronic_days: 14, light_ratio: 0.8, heavy_ratio: 1.3 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-21",
    source: "docs/BUILD-SPEC-v5.md Module 5 (5.6); docs/design/S48b.md",
  },
  {
    key: "activity.workout_plans",
    // Workout plan display rules (S48b, spec 5.3 / 5.4). session_minutes mirrors the database CHECK workout_plans_session_minutes_chk (a mirror test
    // fails on drift). older_adult_age: from this age a chair-based class is listed first (a display order only, the gate decides what is allowed).
    value: { session_minutes: { min: 10, max: 20 }, older_adult_age: 65 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-21",
    source: "docs/BUILD-SPEC-v5.md Module 5 (5.3, 5.4); supabase/migrations/20261021182454_s48b_activity_offline_plans_route_status.sql",
  },
  {
    key: "medicines.prn_limits",
    // As-needed (PRN) limits (S08x, decision C7). There are NO default limits: a clinician sets a shortest gap and/or a most doses in a
    // Lagos day per medicine, and only inside these bounds. A dose outside them is still logged; the patient is shown a notice.
    // Live values are the active, SIGNED row of `prn_limit_rules`; this entry mirrors the v1 seed and a test fails on drift.
    //  minGapMinutesBounds / dailyMaxBounds: the range a clinician may enter.
    //  repeatSignal: that many flagged doses of one medicine inside that many days raises one care-team signal (never an alarm).
    // PROPOSED, CMO and a pharmacist to confirm; the rule stays inactive until the CMO signs it in the sign-off hub.
    value: {
      minGapMinutesBounds: [15, 1440],
      dailyMaxBounds: [1, 24],
      repeatSignal: { flaggedDoses: 3, windowDays: 7 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md C7; docs/design/S08x.md",
  },
  {
    key: "medicines.adherence_report",
    // The patient's printed adherence report (S08x, decision C6): how many completed 7-day weeks it covers. The formula is the app's
    // (doses you marked taken over doses due, as-needed left out); the minimum doses and missed window come from `medicines.dose_rules`
    // and `reminders.behaviour`. Display only: it changes no treatment and raises no task.
    value: { weeks: 8 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/plans/S06-S10-decisions-and-cmo-signoff-pack.md C6; docs/design/S08x.md",
  },
  {
    key: "record.doctor_summary_pdf",
    // The patient-generated visit summary PDF (blood pressure, medicines, adherence, symptoms): the period choices and the row caps.
    // Display only: it changes no treatment, raises no task and classifies no reading. Wearable readings are listed but never averaged
    // or charted (`averageSources`); the list is the reading sources a home cuff, a typed entry or a confirmed photo of a cuff display can have.
    value: { periodDays: [30, 60, 90], defaultDays: 30, maxBpRows: 30, maxSymptoms: 30, maxSkippedDoses: 30, averageSources: ["manual", "device", "photo_confirmed"] },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/BUILD-SPEC-v5.md 2.9; docs/design/S43.md; docs/design/doctor-summary-pdf.md",
  },
  {
    key: "triage.coverage",
    // The daily silence (BP-A5) and adherence (BP-A4) sweep (P6, plan item R3). The LINES themselves (7 days of silence, 80 percent) are
    // in the signed bp_care_triage rule set and are read from it; this entry holds only the switch and who counts as having a blood
    // pressure interest. Live values are the active row of `triage_coverage_config`; this mirrors the v1 seed and a test fails on drift.
    //  enabled: born OFF. A human turns it on after the CMO confirms Members should get these tasks (a task is made for a Member only,
    //    never a Free patient, under the two-tier model).
    //  bp_interest_days: a Member with no hypertension care plan counts as having a blood pressure interest if they read in this many days.
    value: { enabled: false, bp_interest_days: 90 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/OPEN-QUESTIONS.md OQ-89; docs/design/S11-S15-p6-coverage.md",
  },
  {
    key: "triage.threshold_override_policy",
    // N-overrides: clinician-signed personal thresholds. Live value is the active row of `threshold_override_policies` (born unsigned: nothing can be proposed until the CMO
    // signs it); this entry mirrors the v1 seed and a test fails on drift. The safety CLAMPS (how far a line may move) are code, not config: OVERRIDE_LIMITS in
    // supabase/functions/_shared/clinical/threshold-override.ts, mirrored by private.threshold_override_limits().
    //  maxDays: the longest an override may run before it returns to the signed default by itself.
    //  reviewDays: the monthly review cadence (the review date, never the expiry, moves at review).
    //  reviewTaskDueMinutes: how long the routine review task has to be done.
    value: { maxDays: 90, reviewDays: 30, reviewTaskDueMinutes: 4320 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/build-threshold-overrides.md",
  },
  {
    key: "triage.glucose_monitor",
    // Follow-up OQ-320 (founder answer 2026-10-15): glucose from continuous monitors and wearables is graded by glucose_care_triage, behind the same unsigned
    // rule set (so nothing pages or opens a task until the CMO signs it). Three guards protect the production connection budget and stop a stale value paging;
    // live values are the active row of `triage_glucose_monitor_config`, this mirrors the v1 seed and a test fails on drift.
    //  enabled: the producer and the dedupe are active (grading is still shadow while the rule set is a draft).
    //  freshMinutes: a monitor reading older than this when it reaches the server is not graded (a bulk sync of old values must not page a stale low).
    //  dedupeMinutes: the same level (grade and rule) for the same patient is not graded again within this long, for monitor readings only.
    //  sources: the reading sources these guards apply to (the vital_source values for a monitor and a wearable). A bulk sync grades only its latest reading.
    value: { enabled: true, freshMinutes: 30, dedupeMinutes: 60, sources: ["wearable", "cgm"] },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/OPEN-QUESTIONS.md OQ-320; docs/design/FU-engine-closeout.md",
  },
  {
    key: "chain.canary_and_health",
    // P1 (S11 to S15 end to end): the clinical-chain canary and the chain health page. Live values are the active row of
    // `chain_canary_config`; this entry mirrors the v1 seed and a test fails on drift.
    //  intervalMinutes: the cadence the cron job is built for (minutes 11 and 41 of the hour).
    //  gradedSeconds / taskSeconds / pageSeconds / notificationSeconds / ackSeconds: the time each stage of a canary run has to finish.
    //  minEvalAgeSeconds: a run is judged only after this long. staleAfterMinutes: no finished run for this long is itself an incident.
    //  health: thresholds the chain health page turns into ok, attention or down (minSample is the fewest real events before a
    //  percentile is shown; ungradedReadingMinutes is how long a real BP reading may sit with no grade; deadLetterWindowDays is how far back a dead letter still counts).
    // PROPOSED, CMO to confirm. The budgets are generous on purpose: the event processor runs every 15 seconds.
    value: {
      intervalMinutes: 30,
      gradedSeconds: 180,
      taskSeconds: 240,
      pageSeconds: 240,
      notificationSeconds: 300,
      ackSeconds: 600,
      minEvalAgeSeconds: 660,
      staleAfterMinutes: 100,
      rotaHours: 4,
      retentionDays: 30,
      health: {
        minSample: 20,
        stuckDeliverySeconds: 300,
        deadLettersMax: 0,
        readingToGradedP95Seconds: 120,
        pageToAckP95Seconds: 600,
        canaryStaleMinutes: 100,
        ungradedReadingMinutes: 10,
        deadLetterWindowDays: 14,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-13",
    source: "docs/research/S11-S15-review-and-build-plan.md R1; docs/design/S11-S15-p1-chain.md",
  },
  {
    key: "sponsor.rules",
    // Sponsor-paid items and HMO eligibility (S71, module 19). Live values are the active row of `sponsor_config`; this entry mirrors it and a test
    // fails if the migration seed and this value drift. hmo_checks_per_day: eligibility requests one person may make in 24 hours (abuse limit).
    // member_number_min_length and member_number_max_length: the length a normalised HMO member number must have to be hashed at all (format only).
    // The per-programme values (share, budget, per-person allowance, how many days an HMO pass stays valid) are DATA on each sponsor programme,
    // set by an admin with a reason, never code.
    value: { hmo_checks_per_day: 5, member_number_min_length: 4, member_number_max_length: 40 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S71.md; docs/DECISIONS.md S71-1; OQ-325",
  },
  {
    key: "access_fund.rules",
    // Community Access Fund (S72, function 19.11). Live values are the `access_fund` object of the active row of `checkout_extras_config`; this entry
    // mirrors it and a test fails if the migration seed and this value drift. min_donation_kobo: smallest pledge. max_grant_kobo: the most one grant can
    // cover. grant_valid_days: how long an approved grant can be used. pledge_valid_days: how long a pledge waits for the bank transfer.
    // max_open_pledges: pledges one donor may have waiting. criteria: the PUBLISHED reasons operations may cite when approving a grant (keys; the words are
    // in packages/i18n). None of this is signed: the criteria need review and counsel is needed on the legal vehicle (OQ-323) before the guard can open.
    value: {
      min_donation_kobo: 100_000,
      max_grant_kobo: 10_000_000,
      grant_valid_days: 60,
      pledge_valid_days: 14,
      max_open_pledges: 3,
      criteria: ["care_cost_is_a_barrier", "recent_loss_of_income", "supporting_a_dependant", "referred_by_the_care_team"],
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S72.md; docs/DECISIONS.md S72-3; OQ-323; OQ-420",
  },
  {
    key: "payment_requests.rules",
    // Payment requests (S72, function 19.13). The `payment_requests` object of the active `checkout_extras_config` row. expiry_days: how long a link works.
    // max_open_per_person and creates_per_day: how many a person may have open and make in a day. lookups_per_hour: how many times one visitor may open
    // links in an hour (identified by a hash the website makes, never an address). payments_per_hour: how many times one payer may start paying from a link.
    value: { expiry_days: 7, max_open_per_person: 5, creates_per_day: 10, lookups_per_hour: 30, payments_per_hour: 10 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S72.md; OQ-424",
  },
  {
    key: "pricing.rules",
    // Pricing engine (S73, module 20). Live values are the active row of `pricing_config`; this entry mirrors it and a test fails if the
    // migration seed and this value drift. points: a single-use reduction on Tarragon's own service fee only (S72-1, D2), never a balance,
    // OFF (enabled false) until the founder signs the values: points_per_step points buy one step, each step takes reduction_per_step_kobo off the
    // service fee, at most max_steps_per_order steps and at most max_percent_of_service_fee of that fee. third_party_component_keys: the price
    // components that belong to a clinician or a partner and that no discount may reduce. service_fee_component_key: Tarragon's own fee component.
    // min_payable_kobo: a buyer is never left paying less than this by a Tarragon discount (sponsor coverage and approved hardship grants are not
    // Tarragon discounts). code_failed_tries_per_hour: wrong discount code tries a person may make in an hour.
    value: {
      points: { enabled: false, points_per_step: 100, reduction_per_step_kobo: 5000, max_steps_per_order: 5, max_percent_of_service_fee: 50 },
      third_party_component_keys: ["clinician_fee", "partner_fee"],
      service_fee_component_key: "tarragon_service_fee",
      min_payable_kobo: 10000,
      code_failed_tries_per_hour: 10,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S73.md; docs/DECISIONS.md S72-1, S73-1; OQ-321, OQ-324",
  },
  {
    key: "commerce.processing_fee_estimate",
    // v3 (S71, 19.4 and 19.7): adds the estimate for a card issued outside Nigeria, which a Care Circle supporter abroad will often use. Paystack lists
    // 3.9 percent + NGN 100, uncapped, for international cards (the 2026-10-06 reading recorded in v2). The local figures are unchanged. Still only an
    // ESTIMATE on screen, labelled as one: the exact fee is read from the verified payment. PROPOSED until the founder confirms it against the
    // Paystack dashboard for this account.
    value: { localBasisPoints: 150, flatKobo: 10_000, flatWaivedBelowKobo: 250_000, capKobo: 200_000, internationalBasisPoints: 390, internationalFlatKobo: 10_000 },
    owner: "Founder",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S71.md; paystack.com/pricing as read 2026-10-06 (international 3.9% + NGN 100)",
  },
  {
    key: "maternal.rules",
    // S67 (module 16, pregnancy). Every number is PROPOSED from the CMO selections A3, A4 and A5 recorded 2026-10-07
    // (docs/plans/S66-S70-cmo-signoff-pack.md); none is signed and maternal_enabled stays off until the CMO signs.
    // antenatal.contactWeeks: WHO 2016 eight contacts (the first "by" week 12); the national schedule replaces this by a new version.
    // kicks: awareness from week 28; 10 movements in 120 minutes; a personal normal needs 3 finished sessions (median of the latest 5);
    //   a session that takes 2 times her normal to reach 10 is a clear drop (the drop factor is this build's proposal, see OQ-341).
    // contractions: 5-1-1 by default, 7-1-1 for a later birth, a previous fast labour or a long journey; any contraction before week 37 is an instant go sign.
    value: {
      antenatal: { contactWeeks: [12, 20, 26, 30, 34, 36, 38, 40] },
      kicks: { startWeek: 28, windowMinutes: 120, movementsTarget: 10, normalMinSessions: 3, normalLatestSessions: 5, dropFactor: 2 },
      contractions: {
        standard: { intervalMinutes: 5, durationSeconds: 60, sustainedMinutes: 60 },
        earlier: { intervalMinutes: 7, durationSeconds: 60, sustainedMinutes: 60 },
        preTermBeforeWeek: 37,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S66-S70-cmo-signoff-pack.md items A3, A4, A5 (basis WHO 2016 ANC [verify], RCOG Green-top 57 [verify])",
    guardPatterns: ["movementsTarget\\s*[=:]\\s*10\\b", "contactWeeks\\s*[=:]\\s*\\[\\s*12\\b", "preTermBeforeWeek\\s*[=:]\\s*37\\b"],
  },
  {
    key: "maternal.bp_rule_set",
    // Names the draft rule set that carries the pregnancy rules (bp_care_triage v5 = v4 plus A2). v4 is S07x's decision C5 (low blood pressure on
    // medicines) and stays exactly as it is; v5 adds only the pregnancy changes on top of it. Not signed; the database row is a draft.
    value: { code: "bp_care_triage", ruleSetVersion: 5, pregnancyRaisedSystolic: 140, pregnancyRaisedDiastolic: 90, pregnancySevereSystolic: 160, pregnancySevereDiastolic: 110 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S66-S70-cmo-signoff-pack.md items A1, A2; packages/clinical/src/rules/bp-care-v5.ts",
  },
  {
    key: "assistant.excluded_analytes",
    // INV-04 (S51 pre-fix). Analyte-code tokens for screening analytes the assistant and the explainer must never read unless the
    // result is an explicit negative. Mirrored by public.ai_excluded_analyte_tokens in migration
    // *_s51_inv04_ai_never_reads_sensitive_results.sql; assistant-safety-mirror.test.ts pins the two together. The CMO confirms the list.
    value: ["hiv", "hbsag", "hbs_ag", "hcv", "hepatitis", "hep_b", "hep_c", "hepb", "hepc", "hbv", "hbeag", "hbe_ag", "anti_hbc", "anti_hbs", "cd4", "viral_load", "p24", "aids", "retroviral"],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/BUILD-SPEC-v5.md INV-04; docs/design/S51.md",
  },
  {
    key: "assistant.go_live",
    // S51: the go-live guard assistant_enabled needs at least this many reviewed, owned knowledge rows with a future review date.
    // Mirrored by public.assistant_config (key go_live) in migration *_s51_assistant_guard_knowledge_events.sql. The CMO confirms the number.
    value: { min_approved_kb_rows: 20 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S51.md; docs/BUILD-SPEC-v5.md B.7 (go-live guard assistant_enabled)",
    guardPatterns: ["min_approved_kb_rows\\s*[=:]\\s*20\\b"],
  },
  {
    key: "assistant.nudges",
    // S51 (7.5): the daily nudge goes only to a patient with an assistant conversation in the last recent_days, at most max_per_run in a run.
    // Mirrored by public.assistant_config (key nudges); read by public.assistant_nudge_candidates() with no built-in fallback.
    value: { recent_days: 30, max_per_run: 2000 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S51.md; docs/BUILD-SPEC-v5.md B.7 (nudges)",
  },
  {
    key: "devices.plausibility",
    // S70a (18.9). Two classes. IMPOSSIBLE values are held as "please confirm" and never triaged or saved to the record until the
    // person re-checks. EXTREME BUT POSSIBLE values are saved and triaged as normal (a real crisis is never blocked). The typed-entry
    // limits for MANUAL entry stay as the pathway-signed ones (OQ-66); these bounds are wider and only decide what is held.
    // Mirrored in the migration seed (device-plausibility-begin) with a test that fails on drift. Provisional, review after 3 months of real data (A9).
    value: {
      impossible: {
        systolic_mmhg: { min: 40, max: 300 },
        diastolic_mmhg: { min: 20, max: 200 },
        systolic_must_exceed_diastolic: true,
        pulse_bpm: { min: 20, max: 250 },
        spo2_pct: { min: 50, max: 100 },
        temperature_c: { min: 30, max: 44 },
        weight_kg_adult: { min: 20, max: 400 },
        glucose_mmol_l: { min: 1.1, max: 55 },
      },
      adult_age_years: 18,
      wrist_ppg_spo2_informational: true,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S66-S70-cmo-signoff-pack.md A9, A12; docs/design/S70a.md",
  },
  {
    key: "devices.dedupe",
    // S70a (18.9, acceptance test). Same patient and vital type, from DIFFERENT sources, values within tolerance, inside the window:
    // one canonical row, the other linked and never deleted. Windows follow the recorded decision S70-1 / OQ-309 (BP 10 minutes,
    // glucose 5 minutes), which replaces the pack's 10 minutes for everything. Temperature has no tolerance in the pack, so it is not merged.
    // glucose_band_edges_mmol_l is not a clinical threshold: two values that fall either side of one are never merged, so a merge
    // can never hide the worse of two readings. BP, pulse and SpO2 use the existing live classifiers for the same purpose.
    value: {
      tolerance: { systolic_mmhg: 3, diastolic_mmhg: 3, glucose_mmol_l: 0.3, weight_kg: 0.2, pulse_bpm: 3, spo2_pct: 1 },
      window_minutes: { blood_pressure: 10, glucose: 5, weight: 10, pulse: 10, spo2: 10 },
      precedence: ["ble_device", "vendor_cloud", "phone_mirror", "photo_confirmed", "manual"],
      mirror_providers: ["apple_health", "android_health_connect"],
      glucose_band_edges_mmol_l: [3.0, 3.9, 11.0, 13.9],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md S70-1 (branch docs/s70-s75-decisions), OQ-309; docs/plans/S66-S70-cmo-signoff-pack.md A10",
  },
  {
    key: "devices.cgm_events",
    // S70a (18.5, decision S70-2, OQ-310). Sustained-event rules for continuous glucose monitor streams. They create a clinician TASK
    // (never an instant red page; the live single-reading emergency backstop for a reading under 3.0 is unchanged) and show the severe-low
    // safety copy at once. Thresholds, durations and wording are PROPOSED: the CMO signs them. Basis: International Consensus on Time in Range
    // and ADA Standards of Care (secondary sources, primary text not read; OQ-310). cooldown_minutes stops a stream flooding the queue.
    value: {
      rules: [
        { code: "low_severe", kind: "low", below_mmol_l: 3.0, minutes: 15, due_minutes: 240, cooldown_minutes: 120 },
        { code: "low", kind: "low", below_mmol_l: 3.9, minutes: 60, due_minutes: 1440, cooldown_minutes: 240 },
        { code: "high", kind: "high", above_mmol_l: 13.9, minutes: 120, due_minutes: 1440, cooldown_minutes: 480 },
      ],
      max_gap_minutes: 20,
      task_type: "cgm_glucose_review",
      severe_low_copy:
        "Your sensor shows a very low sugar level. If you feel shaky, sweaty, confused or faint, take a fast sugar now, such as juice or glucose tablets, and check again soon. If you cannot swallow, or someone cannot wake you, call emergency services now. Your care team has been told.",
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md S70-2 (branch docs/s70-s75-decisions), OQ-310; docs/plans/S66-S70-cmo-signoff-pack.md A12",
  },
  {
    key: "devices.cgm_agp",
    // Display-only continuous glucose profile (ambulatory glucose profile layout) for the patient and the clinician. It never creates a task or a
    // page: the sustained-event rules above stay the only CGM safety path. The five range bands follow the International Consensus on Time in
    // Range (secondary source, primary text not read). The pattern numbers are product choices, PROPOSED, for the CMO to confirm or change:
    // a window is only named when enough days of that time of day were recorded, and the words it produces describe readings, never a cause
    // and never a dose. percentiles 15 and 75 copy the example report the founder shared (its legend names the 15th and 75th); the usual AGP uses
    // 25 and 75 with 5 and 95 as an outer band, so the CMO should confirm which one clinicians expect. dedupe_minutes drops a reading that follows
    // another by less than that, so one sensor reaching us by two routes is not counted twice.
    value: {
      window_days: 14,
      timezone: "Africa/Lagos",
      bin_minutes: 30,
      slot_minutes: 15,
      min_active_pct: 70,
      min_days_with_data: 10,
      min_readings_per_bin: 20,
      dedupe_minutes: 2,
      band_edges_mmol_l: { very_low: 3.0, low: 3.9, high: 10.0, very_high: 13.9 },
      percentiles: { lower: 15, upper: 75 },
      pattern: { min_run_minutes: 120, low_share_pct: 10, high_share_pct: 50 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-21",
    source: "Founder request 2026-10-21 (glucose profile for the diabetes chat); International Consensus on Time in Range; docs/DECISIONS.md S70-2 for the sustained-event path it sits beside",
  },
  {
    key: "devices.ecg_alert",
    // S70a (18.6, decision S70-3, OQ-311). A personal ECG device's OWN result label is stored verbatim. An irregular, inconclusive or
    // unrecognised label creates a routine clinician task due within one working day (1440 minutes is the proposed stand-in for it).
    // The patient sees only the fixed sentence below, never a diagnosis, and no notification names a condition (INV-07). Chest pain,
    // fainting or breathlessness goes through the existing red triage, not this path. The label map is a lookup of words, not a diagnosis.
    value: {
      task_type: "device_rhythm_review",
      due_minutes: 1440,
      patient_copy: "Your device flagged something for your care team to look at.",
      label_map: {
        inconclusive: ["inconclusive", "poor recording", "poor reading", "unclassified", "unrecognized", "unrecognised"],
        irregular: ["atrial fibrillation", "afib", "irregular", "arrhythm", "bradycardia", "tachycardia", "high heart rate", "low heart rate"],
        normal: ["sinus rhythm", "normal"],
      },
      red_symptoms: ["chest_pain", "fainting", "breathlessness"],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md S70-3 (branch docs/s70-s75-decisions), OQ-311; docs/plans/S66-S70-cmo-signoff-pack.md A11",
  },
  {
    key: "devices.task_types",
    // The two task types S70a adds to `task_types` (S16 pattern). Each row: code, priority class, default due minutes, minimum doctor tier,
    // required competencies, lead window minutes, claim timeout minutes. Flagged for the CMO: nothing here is signed.
    value: [
      { code: "cgm_glucose_review", priority_class: 4, default_due_minutes: 1440, min_doctor_tier: "senior_medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 240, claim_timeout_minutes: 30 },
      { code: "device_rhythm_review", priority_class: 5, default_due_minutes: 1440, min_doctor_tier: "senior_medical_officer", required_competencies: ["adult_general"], lead_window_minutes: 1440, claim_timeout_minutes: 30 },
    ],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S70a.md; queue.task_types pattern (S16)",
  },
  {
    key: "mental_health.follow_up_rules",
    // Task due times (minutes) for the follow-up after a moderate or high PHQ-9, GAD-7 or EPDS result. Live values are the active row
    // of `mental_health_follow_up_config`; a test fails if the migration seed and this value drift. The pathway is behind the CMO
    // switched guard mental_health_follow_up_enabled (off). The build proposed these numbers; they are not a clinical decision.
    value: {
      phq9: { moderate_due_minutes: 4320, high_due_minutes: 1440 },
      gad7: { moderate_due_minutes: 4320, high_due_minutes: 1440 },
      epds: { moderate_due_minutes: 4320, high_due_minutes: 1440 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S56.md; spec 10.2",
  },
  {
    key: "crisis.card",
    // The crisis card (function 10.3). Live values are the active row of `crisis_card_config`; a test fails on drift.
    // emergency_number: the national emergency line (the card always also says go to the nearest hospital now). No helplines: the founder
    // decided 2026-10-07 that none are usable in Nigeria. callback_sla_minutes: the staffed callback time after a crisis flag; it is
    // shown to a patient only once this row is confirmed, never while it is a draft.
    value: { emergency_number: "112", callback_sla_minutes: 30 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S56.md; spec 10.3",
  },
  {
    key: "learning.micro_lesson",
    // S55 (spec 9.2): a weekly lesson (one per programme week) takes under five minutes, asks for one action and ends in one check question. Live value is the
    // active `micro_lesson` row of `learning_config`; a test fails if the migration seed and this value drift. UNSIGNED.
    value: { max_minutes: 5, check_questions: 1 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55.md; spec 9.2",
  },
  {
    key: "learning.offline_pack",
    // S55 (spec 9.6): the size cap for lessons kept on a phone, counted over text and audio together, and the item cap. Expired and
    // unpublished items are never included. Live value is the `offline_pack` row of `learning_config`. UNSIGNED.
    value: { max_total_bytes: 25000000, max_items: 150, audio_wifi_only: true },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55.md; spec 9.6; OQ-S55-04",
  },
  {
    key: "learning.creator_perk",
    // S55 follow-up (founder decision): creator series are a Membership perk. true = a person who is not a Member sees the title, the
    // creator credit and the teaser of a creator lesson but not its body or audio; false = creator content is open to everyone. No
    // payment logic. Live value is the active `creator_perk` row of `learning_config`; an admin changes it with
    // set_learning_creator_perk() (a new version row, audited), no deploy. A missing value fails closed (locked). UNSIGNED.
    value: { members_only: true },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55.md section 8; founder decision 2026-10-07",
  },
  {
    key: "learning.search_gap_log",
    // S55 (spec 9.3): rules for the zero-result search log (no patient reference): longest phrase kept, most words, how many searches
    // before an admin sees a phrase, and retention. Live value is the `search_gap_log` row of `learning_config`. UNSIGNED.
    value: { enabled: false, max_query_chars: 60, max_words: 6, min_count_to_show: 3, retention_days: 180, max_rows: 5000 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55.md; spec 9.3; OQ-S55-05",
  },
  {
    key: "learning.search_synonyms",
    // S55 (spec 9.3): everyday and local words grouped so that any one finds the others. Search expansion only. Live value is the
    // `search_synonyms` row of `learning_config`; web, mobile and the database search all read it. UNSIGNED: the CMO confirms the groups,
    // and the founder confirms whether the Nigerian everyday words stay (OQ-S55-01).
    value: {
      groups: [
        { terms: ["bp", "blood pressure", "pressure", "high blood", "hypertension", "bp reading"] },
        { terms: ["sugar", "diabetes", "blood sugar", "glucose", "sugar level", "high sugar"] },
        { terms: ["belle", "pregnancy", "pregnant", "antenatal", "expecting"] },
        { terms: ["heart", "cardiac"] },
        { terms: ["drug", "drugs", "medicine", "medicines", "medication", "tablets", "pills"] },
        { terms: ["kidney", "kidneys", "kidney disease", "ckd"] },
        { terms: ["hot body", "fever", "high temperature"] },
        { terms: ["weight", "overweight", "belly fat", "obesity"] },
        { terms: ["sleep", "insomnia", "cannot sleep", "sleeping"] },
        { terms: ["salt", "sodium"] },
        { terms: ["exercise", "workout", "walking", "physical activity"] },
        { terms: ["vaccine", "vaccines", "vaccination", "immunisation", "immunization"] },
        { terms: ["tired", "fatigue", "weak body"] },
        { terms: ["herb", "herbs", "herbal", "local medicine", "agbo"] },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55.md; spec 9.3; OQ-S55-01",
  },
  {
    key: "symptom.degraded_mode",
    // S60 (spec 12.8, INV-06): what the symptom checker does when its engine errors, times out or has no protocol to run. The
    // bundled red-flag floor runs first either way. In degraded mode the severity floors on the signed red-flag rules may be
    // ignored (a strictly more sensitive screen), and a run that fired no flag is never reassurance: it is routed to at least
    // this category with a human review. The CMO confirms or changes it.
    value: { ignore_severity_floors: true, unclassifiable_category: "urgent", engine_timeout_ms: 3000 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S60.md section 3; spec 12.8; docs/OPEN-QUESTIONS.md OQ-S60-02",
  },
  {
    key: "symptom.risk_tightening",
    // S60 (spec 12.2 and 12.11): Nigerian prevalence and seasonal risk, as a layer that can only RAISE an urgency (a minimum
    // category), never lower or replace one. Every entry below is a DRAFT: status "draft", no clinical sign-off, a placeholder
    // provenance that says so. The engine ignores an entry until it is "signed_off" with a named signer and date, so shipping
    // this changes nothing for any patient. The CMO decides which entries exist, their wording, seasons, regions and minimums;
    // none of the months, states or symptom keys below is clinical advice. `applies_when` keys that no signed pathway asks yet
    // (for example sickle_cell_disease history) will simply not match until a signed pathway collects them.
    value: {
      entries: [
        {
          id: "malaria_season_fever",
          label: "Fever during the rainy season",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder. The CMO must confirm the season and the source (for example national malaria programme guidance) before this is signed." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { months: [4, 5, 6, 7, 8, 9, 10], any_associated_symptom: ["fever"] },
          minimum_category: "routine",
        },
        {
          id: "typhoid_fever_with_abdominal_pain",
          label: "Fever with abdominal pain",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder. Needs a sourced definition and a signed abdominal pain pathway that collects these symptoms." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { any_associated_symptom: ["fever"], complaint_keys: ["abdominal_pain"] },
          minimum_category: "routine",
        },
        {
          id: "lassa_season_fever",
          label: "Fever in the dry season in a high-risk state",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder. The CMO must name the season, the STATES (this draft names none, so it would apply nationwide if signed as written) and the source (for example national disease control centre guidance) before this is signed." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { months: [11, 12, 1, 2, 3, 4], any_associated_symptom: ["fever"] },
          minimum_category: "urgent",
        },
        {
          id: "sickle_cell_history_with_symptom",
          label: "Sickle cell history with fever or pain",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder. Needs a signed pathway that records sickle cell history, and the CMO's minimum category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { any_history: ["sickle_cell_disease"], any_associated_symptom: ["fever", "breathlessness"] },
          minimum_category: "urgent",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S60.md section 4; spec 12.2 and 12.11; docs/OPEN-QUESTIONS.md OQ-S60-03",
  },
  {
    key: "symptom.accuracy_audit",
    // S60 (spec 12.12): the monthly accuracy audit. Cells with fewer reviewed cases than min_cell_size are suppressed (a
    // group of a few people is a person, and a rate over a handful of cases is noise). Intervals are Wilson score intervals at
    // this confidence. The live value is the active row of `symptom_accuracy_config`; a test fails if the migration seed and
    // this value drift. The first report is a baseline, not a claim: nothing here lets a figure be published.
    value: { min_cell_size: 10, confidence_level: 0.95, age_bands: [[0, 4], [5, 17], [18, 39], [40, 59], [60, 150]] },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S60.md section 6; spec 12.12; docs/OPEN-QUESTIONS.md OQ-S60-05",
  },
  {
    key: "paging.watchdog",
    // S78a (spec 23.15, CMO decision S-8). Mirrors paging_config version 2, which is PROPOSED and INACTIVE: the active row stays version 1 until the CMO signs
    // a new version. watchdog_grace_seconds: how long a red triage event may exist with no page before the database watchdog creates it itself (INV-05; the
    // outbox path normally pages in seconds). watchdog_lookback_minutes: how far back the watchdog looks. repage_after_ack_minutes: an acknowledged page still
    // not closed after this long pages the acknowledging clinician and the backup once more; null = disabled. Until version 2 is active the watchdog uses
    // 60 seconds and 360 minutes as hard defaults and the re-page is off.
    // The three S78a keys of that version; the rest of version 2 repeats paging.rules and a test keeps them identical.
    value: { watchdog_grace_seconds: 60, watchdog_lookback_minutes: 360, repage_after_ack_minutes: null },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S75-S80-cmo-decisions.md S-8; spec 23.15",
  },
  {
    key: "response_time.targets",
    // S78b (spec 23.16, CMO decision S-9). Mirrors response_time_config version 1, which is PROPOSED, UNSIGNED and INACTIVE: no number is published to
    // patients and the breach sweep reads nothing until the CMO signs and activates a version. written_question_minutes and amber_review_minutes are how long
    // a written question or an amber review may wait; appointment_start_late_minutes how long after the booked time a visit may still not have started;
    // lookback_days how far back the sweep looks; patient_notice_cooldown_hours the shortest gap between two "slower than usual" notices to one patient.
    value: { written_question_minutes: 1440, amber_review_minutes: 1440, appointment_start_late_minutes: 15, lookback_days: 7, patient_notice_cooldown_hours: 12 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S75-S80-cmo-decisions.md S-9; spec 23.16",
  },
  {
    key: "outcomes.measure_rules",
    // Outcome measures added to S38's snapshots (S75, CMO decision S-5): HbA1c, weight, PHQ-9 and GAD-7, with the day-180 BP report.
    // The database holds them as `outcome_config` v3, which is v2 plus this block. v3 is PROPOSED, UNSIGNED and INACTIVE: the live
    // config stays v2 (`outcomes.snapshot_rules` v2 above stays the one in force) until the CMO activates v3. The migration seed and
    // this value are checked against each other by a test. Every number is PROPOSED and owned by the CMO: the goals (HbA1c under 7.0
    // percent or the care-plan target, weight down 5 percent or more, a 50 percent fall for response, below 5 for remission), the
    // windows around each day within which the nearest result is used, and the lowest baseline for which response and remission
    // are counted. PHQ-9 and GAD-7 are never shown to a sponsor (S-3, S-5).
    value: {
      bp_report_days: [90, 180],
      measures: {
        hba1c: {
          days: [0, 90, 180],
          goal_below_percent: 7.0,
          use_care_plan_target: true,
          valid_min: 3.0,
          valid_max: 20.0,
          baseline_before_days: 90,
          baseline_after_days: 14,
          followup_tolerance_days: 30,
          definition: "HbA1c, as a percentage. Change is the value near the day minus the baseline value near joining. A person reached the goal when the value near the day is under 7.0 percent or at their own care-plan HbA1c target. The result nearest the day inside the window is used.",
          limitations: "Only people with an HbA1c result are counted in the measure; a person with no result near a day is shown as no result, never as not improved. Results come from the lab results recorded on the platform, not from every lab a person may have used. A before and after view without a comparison group says nothing about cause.",
        },
        weight: {
          days: [0, 30, 90, 180],
          goal_loss_percent: 5.0,
          valid_min: 20,
          valid_max: 400,
          min_age_years: 18,
          baseline_before_days: 14,
          baseline_after_days: 7,
          followup_tolerance_days: 14,
          definition: "Weight in kilograms. Change is the percent difference between the weight near the day and the baseline weight near joining. A person reached the goal when weight fell by 5 percent or more. The weight nearest the day inside the window is used. Adults only.",
          limitations: "Only people who logged a weight are counted; a person with no weight near a day is shown as no result, never as not improved. Weight changes for many reasons, including pregnancy, illness and fluid; the measure is not a judgement of any person. A before and after view without a comparison group says nothing about cause.",
        },
        phq9: {
          days: [0, 30, 90, 180],
          max_score: 27,
          response_fall_percent: 50,
          remission_below: 5,
          min_baseline_for_outcome: 5,
          baseline_before_days: 14,
          baseline_after_days: 14,
          followup_tolerance_days: 21,
          definition: "PHQ-9 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
          limitations: "Only total scores are used; no answer to any single question is read. A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor.",
        },
        gad7: {
          days: [0, 30, 90, 180],
          max_score: 21,
          response_fall_percent: 50,
          remission_below: 5,
          min_baseline_for_outcome: 5,
          baseline_before_days: 14,
          baseline_after_days: 14,
          followup_tolerance_days: 21,
          definition: "GAD-7 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
          limitations: "A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor.",
        },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S75-outcome-measures.md; docs/plans/S75-S80-cmo-decisions.md S-5; ADA Standards of Care; DPP; Kroenke 2001",
  },
  {
    key: "follow_ups.rules",
    // Loop closure (S77, spec 23.8, CMO decision S-20): an overdue order, referral, lab request or follow-up task goes to the lead clinician after
    // 24 hours (routine) or 4 hours (a follow-up waiting on an abnormal result). Live values are the row of `clinical_follow_up_config`, which is born
    // inactive and unsigned; the sweep escalates only when the CMO has signed it. A test fails if the migration seed and this value drift.
    value: { routine_escalate_after_hours: 24, abnormal_escalate_after_hours: 4 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S75-S80-cmo-decisions.md S-20; spec 23.8; supabase/migrations/20261007160101_s77_clinical_follow_ups_closure.sql",
  },
  {
    key: "credentialing.rules",
    // Version 5 (S-18, S76 B2): version 4 plus the MDCN register re-check cadence (reverify_months, reverify_notice_days). Inserted INACTIVE: the sweep
    // does nothing until the chief medical officer signs and activates it. Version 4 notes follow.
    // Version 4 (S20 v2, CMO decision 8 recorded 2026-10-07), on top of version 3 (primary-source and re-check keys): notices at 90, 30, 7 and 0 days,
    // the proof-of-renewal deadline (15 December for the 31 December cycle), a missing licence date counted as ineligible, and the evidence sources
    // a verification can name. INACTIVE in `credentialing_config` until switched on; the switch is refused while an active clinician has no licence date.
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
      notice_windows_days: [90, 30, 7, 0],
      grace_max_days: 14,
      separate_verifier_and_approver: true,
      document_max_bytes: 8388608,
      document_retention_years_after_offboarding: 7,
      require_verified_phone: false,
      document_purge_enabled: false,
      rejected_application_document_retention_months: 24,
      primary_source_required: true,
      primary_source_routes: ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
      primary_source_max_age_days: 365,
      recheck_months: 6,
      recheck_overdue_days: 14,
      credential_date_max_days: 1100,
      grandfather_ends_on: "2027-01-13",
      reverify_months: 12,
      reverify_notice_days: 30,
      renewal_cycle: {
        cycle_end_month: 12,
        cycle_end_day: 31,
        proof_deadline_month: 12,
        proof_deadline_day: 15,
      },
      missing_licence_date_ineligible: true,
      verification_sources: ["mdcn_register_lookup", "document_sighted", "insurer_confirmation", "other"],
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 5,
    effectiveFrom: "2026-10-15",
    source: "docs/plans/S75-S80-cmo-decisions.md S-18 (S76 B2); builds on version 4 (S20 v2)",
  },
  {
    key: "assistant.emergency",
    // S52 (7.8, INV-06). Nigeria has no usable national crisis helpline, so `phoneNumbers` is EMPTY on purpose: the CMO adds a number
    // (a hospital line, a clinic desk) here and nowhere else, and it is shown only once set. `nearestHospitalsShown` is how many hospitals
    // the emergency reply lists. The self-harm and emergency WORDING in packages/shared/src/assistant-emergency.ts is PROPOSED (OQ-293).
    value: { nearestHospitalsShown: 3, phoneNumbers: [], selfHarmCopyStatus: "proposed_awaiting_cmo_signoff" },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S52.md; docs/BUILD-SPEC-v5.md B.7 7.8; founder decision 2026-10-07 (no crisis helpline in Nigeria, nearest hospital)",
  },
  {
    key: "assistant.silence",
    // S52 (7.10): silence_days of no message from a programme member write an assistant.silence_detected event (a signal, never a treatment
    // change); reengage_after_days later one generic note, at most one per reengage_cooldown_days. Mirrored by assistant_config (key silence)
    // in migration *_s52_assistant_safety_memory_review.sql; assistant-safety-mirror.test.ts pins them together.
    value: { silence_days: 7, reengage_after_days: 10, reengage_cooldown_days: 30 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S52.md; docs/BUILD-SPEC-v5.md B.7 7.10",
  },
  {
    key: "assistant.paging",
    // S52 (INV-05): a self-harm page repeats for the same conversation no sooner than repeat_hours, or no_cover_repeat_minutes when nobody was
    // on call. Mirrored by assistant_config (key paging).
    value: { repeat_hours: 6, no_cover_repeat_minutes: 30, page_wait_ms: 4000, hospital_lookup_ms: 2500 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S52.md; docs/BUILD-SPEC-v5.md INV-05",
  },
  {
    key: "assistant.review",
    // S52 (7.13): how many randomly chosen conversations the Chief Medical Officer reviews each month, on top of every reported one.
    value: { monthly_sample_size: 20 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S52.md; docs/BUILD-SPEC-v5.md B.7 7.13",
  },
  {
    key: "assistant.memory",
    // S52 (7.12): at most max_items goals and preferences, each at most max_chars characters; consent_text_version names the wording the
    // patient agreed to. Mirrored by assistant_config (key memory).
    value: { max_items: 30, max_chars: 200, consent_text_version: "mem-v1" },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S52.md; docs/BUILD-SPEC-v5.md B.7 7.12",
  },
  {
    key: "media_library.config",
    // S57 (functions 10.7, 10.9, 10.10). Identical to the active row of `media_library_config` v1 (a test fails on drift). UNSIGNED.
    // download: Wi-Fi only, 5 MB a track (plan 4.2) and a 50 MB pack (the build's proposal). breathing: 3 to 5 minutes (spec 10.7) and the
    // longest single phase. sleep_feedback: the smallest weekly change in percentage points worth mentioning. session: the shortest listen
    // that counts as a session.
    value: {
      download: { wifi_only: true, max_track_bytes: 5242880, max_pack_bytes: 52428800 },
      breathing: { min_seconds: 180, max_seconds: 300, max_phase_seconds: 10 },
      sleep_feedback: { change_epsilon_pct: 2 },
      session: { min_listened_seconds: 30 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S57.md; spec 10.7, 10.9, 10.10; docs/OPEN-QUESTIONS.md OQ-S57-03",
  },
  {
    key: "sleep.apnoea_screen",
    // S57 (function 10.11), redrafted S57b. Identical to `sleep_apnoea_screen_config` v1 (a test fails on drift). DRAFT, UNSIGNED: eight items
    // following the published STOP-Bang tool (Chung et al.) in the build's own wording; docs/research/S57b.md lists what is and is not verified.
    // BMI is computed from height and weight (above 35); neck is a number in cm (40 or more); "not sure" scores unsure_points. Cut-off 3 of 8.
    // The CMO must read, amend and confirm (public.confirm_sleep_apnoea_screen_config). Until then the questionnaire saves answers and
    // does nothing else: no result, no task.
    value: {
      cut_off: 3,
      unsure_points: 1,
      items: [
        { id: "snoring", kind: "yes_no", points: 1 },
        { id: "tired", kind: "yes_no", points: 1 },
        { id: "observed_pauses", kind: "yes_no", points: 1 },
        { id: "high_blood_pressure", kind: "yes_no", points: 1 },
        { id: "bmi", kind: "bmi", points: 1, above: 35 },
        { id: "age_over_50", kind: "yes_no", points: 1 },
        { id: "neck", kind: "neck_cm", points: 1, at_least: 40 },
        { id: "sex_male", kind: "yes_no", points: 1 },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S57.md; spec 10.11; docs/OPEN-QUESTIONS.md OQ-S57-02",
  },
  {
    key: "symptom.urgency_map",
    // S59 (spec 12.4): the six urgency levels, DERIVED from the four triage categories. The four-category result stays the source
    // of truth and what every escalation keys off; this table only decides what extra wording a screen may show. It is an UNSIGNED
    // DRAFT: while status is "draft" (or the map fails its validity check: total, monotone, emergency maps to the top level) no
    // level is derived and the screen shows only the four-category result. The CMO decides every row. `review_required` rows apply
    // when a clinician has been asked to look at the result.
    value: {
      status: "draft",
      clinical_sign_off: null,
      rows: [
        { category: "emergency", qualifier: "any", level: "emergency_now" },
        { category: "urgent", qualifier: "any", level: "doctor_within_24_hours" },
        { category: "urgent", qualifier: "review_required", level: "doctor_today" },
        { category: "routine", qualifier: "any", level: "doctor_within_days" },
        { category: "self_management", qualifier: "any", level: "self_care" },
        { category: "self_management", qualifier: "review_required", level: "see_pharmacist" },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S59.md section 3; spec 12.4; docs/OPEN-QUESTIONS.md OQ-S59-02",
  },
  {
    key: "symptom.context_tightening",
    // S59 (spec 12.2 and 12.6): what the health record already says (age, sex, pregnancy, known conditions, medicines, recent
    // readings) can only RAISE an urgency, as a minimum category, never lower or replace one. Every entry is an UNSIGNED DRAFT
    // (status "draft", no sign-off): the engine ignores an entry until it is "signed_off" with a named signer and date, so shipping
    // this changes nothing for any patient. The drug names, thresholds, ages and categories below are placeholders for the CMO to
    // confirm or replace, not clinical advice. Reading thresholds live HERE, never in code.
    value: {
      entries: [
        {
          id: "pregnancy_severe_symptom",
          label: "Pregnant and a severe symptom",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder pregnancy branch (spec 12.6). The CMO chooses the complaints, the severity and the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { pregnant: true, min_severity: 6, complaint_keys: ["headache", "chest_pain", "breathlessness", "abdominal_pain"] },
          minimum_category: "urgent",
        },
        {
          id: "pregnancy_headache_with_vision_change",
          label: "Pregnant with a headache and a change in vision",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder. The CMO confirms the symptom keys and the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { pregnant: true, complaint_keys: ["headache"], any_associated_symptom: ["visual_disturbance", "vision_loss"] },
          minimum_category: "emergency",
        },
        {
          id: "young_child_danger_sign",
          label: "A young child with a general danger sign",
          provenance: { source: "UNVERIFIED DRAFT", note: "IMCI-style general danger signs. The CMO sets the age band (the 4 here is a placeholder) and confirms the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { age_max: 4, any_associated_symptom: ["convulsions", "unable_to_drink_or_feed", "vomits_everything", "lethargic_or_unconscious"] },
          minimum_category: "emergency",
        },
        {
          id: "blood_thinner_with_headache",
          label: "Taking a blood thinner and a headache",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder drug names and severity. The CMO confirms which medicines count and the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { any_medicine: ["warfarin", "rivaroxaban", "apixaban", "dabigatran"], complaint_keys: ["headache"], min_severity: 4 },
          minimum_category: "urgent",
        },
        {
          id: "high_bp_reading_with_symptom",
          label: "A recent very high blood pressure reading and a symptom",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder threshold (systolic). The CMO confirms the threshold, the look-back window and the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { reading_at_least: { key: "systolic", value: 180 }, complaint_keys: ["headache", "chest_pain", "breathlessness"] },
          minimum_category: "urgent",
        },
        {
          id: "low_oxygen_reading",
          label: "A recent low oxygen reading",
          provenance: { source: "UNVERIFIED DRAFT", note: "Placeholder threshold. The CMO confirms the threshold, the look-back window and the category." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { reading_at_most: { key: "spo2_pct", value: 92 } },
          minimum_category: "urgent",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S59.md section 3; spec 12.2 and 12.6; docs/OPEN-QUESTIONS.md OQ-S59-03",
  },
  {
    key: "symptom.dependant_policy",
    // S59 (spec 12.6): a check answered by a parent or carer for a child. Until the CMO signs paediatric pathways, a child is run
    // through the signed adult pathways, so a result for a known child is never lower than this category and always asks a clinician
    // to look. It can only raise. A person whose age is unknown is not matched (an extra input never lowers a result). Live now
    // (proposed, not yet confirmed by the CMO).
    value: { max_age_years: 17, minimum_category: "routine", clinician_review_required: true },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S59.md section 4; spec 12.6; docs/OPEN-QUESTIONS.md OQ-S59-04",
  },
  {
    key: "symptom.skin_photo_policy",
    // S59 (spec 12.7): photos of a visible problem for a clinician to look at. Never scored or classified. Limits and retention. The
    // live value is the active row of `skin_photo_policy_config` (the storage bucket limits are set from it too); a test fails if
    // the migration seed and this value drift. Retention counts from submission while unreviewed and from the review once reviewed.
    // The deletion job is not built (OQ-S59-07): until it runs, `retention_until` records when a photo is due to go.
    value: {
      max_bytes: 4000000,
      allowed_types: ["image/jpeg", "image/png"],
      max_open_per_patient: 5,
      retention_days_unreviewed: 30,
      retention_days_after_review: 90,
      signed_url_seconds: 60,
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S59.md section 6; spec 12.7; docs/OPEN-QUESTIONS.md OQ-S59-07",
  },
  {
    key: "symptom.context_window_days",
    // S59 (spec 12.2): how far back a reading from the health record counts as "recent" for the context layer. Whole days, 1 to 90
    // (the database clamps it). The CMO confirms it alongside the context entries.
    value: 14,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S59.md section 3; spec 12.2; docs/OPEN-QUESTIONS.md OQ-S59-03",
  },
  {
    key: "symptom.adult_age_years",
    // S59b (founder decision 2026-10-07): the symptom checker refuses anyone under this age until a paediatric protocol is in the
    // signed config, and refuses anyone with no date of birth. A policy age, not a clinical threshold. The database holds the same
    // number in private.symptom_checker_adult_age(); a Jest test fails if the two differ.
    value: 18,
    owner: "Founder",
    status: "confirmed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S55-S60-build-plan.md section 10; docs/OPEN-QUESTIONS.md OQ-S59b-01",
  },
  {
    key: "symptom.risk_tightening",
    // S59b REDRAFT for the CMO (hold item C4, 2026-10-07). Still ALL DRAFT, unsigned, inert. Changes from version 1: the typhoid and
    // sickle cell entries are dropped (no signed pathway asks abdominal_pain or sickle_cell_disease, so they could never match); the
    // Lassa entry now names states and has sources; the malaria entry has sources. Raise-only, as before. Sources and what could not
    // be verified: docs/research/S59b.md.
    value: {
      entries: [
        {
          id: "malaria_season_fever",
          label: "Fever during the rainy season",
          provenance: {
            source: "https://www.doctorswithoutborders.org/latest/nigeria-preventing-long-and-deadly-malaria-season-claiming-more-lives-borno",
            note: "Nigeria's rainy season runs about April to October and malaria transmission peaks in it (MSF and WHO-recommended seasonal chemoprevention material). The season is shorter in the north, longer in the south: the CMO may split it by state. Minimum category is the CMO's call.",
          },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { months: [4, 5, 6, 7, 8, 9, 10], any_associated_symptom: ["fever"] },
          minimum_category: "routine",
        },
        {
          id: "lassa_season_fever",
          label: "Fever in the dry season in a high-burden state",
          provenance: {
            source: "https://www.who.int/emergencies/disease-outbreak-news/item/Lassa-fever---Nigeria",
            note: "NCDC situation reports (as relayed in the press, see docs/research/S59b.md) name Edo, Ondo, Bauchi and Taraba as the main burden states and a dry season peak from December to April. Other states report cases (for example Ebonyi and Nasarawa in 2026): the CMO decides whether to widen the list. A person whose state is unknown still matches (the safe direction).",
          },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { months: [12, 1, 2, 3, 4], states: ["Edo", "Ondo", "Bauchi", "Taraba"], any_associated_symptom: ["fever"] },
          minimum_category: "urgent",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/research/S59b.md section C4; docs/OPEN-QUESTIONS.md OQ-S59b-05",
  },
  {
    key: "symptom.context_tightening",
    // S59b REDRAFT for the CMO (hold item C5, 2026-10-07). Still ALL DRAFT, unsigned, inert, raise-only. Dropped: the young-child
    // entry (children are refused by the checker until a paediatric protocol is signed) and abdominal_pain (not in any signed
    // pathway). Thresholds are checked against the sources named in each provenance; see docs/research/S59b.md for what could not be
    // verified. Reading thresholds live HERE, never in code.
    value: {
      entries: [
        {
          id: "pregnancy_severe_symptom",
          label: "Pregnant and a severe symptom",
          provenance: { source: "UNVERIFIED THRESHOLD", note: "No source found for severity 6 as a pregnancy cut-off; it is the CMO's number. The complaints are those of the signed pathways only." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { pregnant: true, min_severity: 6, complaint_keys: ["headache", "chest_pain", "breathlessness"] },
          minimum_category: "urgent",
        },
        {
          id: "pregnancy_headache_with_vision_change",
          label: "Pregnant with a headache and a change in vision",
          provenance: { source: "NICE NG133 (hypertension in pregnancy), via secondary summaries", note: "Severe headache with visual disturbance is a listed feature of pre-eclampsia. The guideline text itself was not opened; confirm against it. Emergency is the CMO's call (it is a possible severe pre-eclampsia pattern)." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { pregnant: true, complaint_keys: ["headache"], any_associated_symptom: ["visual_disturbance", "vision_loss"] },
          minimum_category: "emergency",
        },
        {
          id: "blood_thinner_with_headache",
          label: "Taking a blood thinner and a headache",
          provenance: { source: "UNVERIFIED", note: "The bleeding-risk logic is general; no guideline cut-off found for a non-injury headache on an anticoagulant. Drug names and severity are the CMO's call." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { any_medicine: ["warfarin", "rivaroxaban", "apixaban", "dabigatran"], complaint_keys: ["headache"], min_severity: 4 },
          minimum_category: "urgent",
        },
        {
          id: "high_systolic_reading_with_symptom",
          label: "A recent very high top blood pressure number and a symptom",
          provenance: { source: "ESC/ESH and ACC/AHA definitions of hypertensive emergency (180 over 120 or higher with symptoms), via secondary summaries", note: "Threshold 180 matches the commonly cited line. The guideline documents were not opened. A home reading is not proof of organ damage, so this only raises the minimum." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { reading_at_least: { key: "systolic", value: 180 }, complaint_keys: ["headache", "chest_pain", "breathlessness"] },
          minimum_category: "urgent",
        },
        {
          id: "high_diastolic_reading_with_symptom",
          label: "A recent very high bottom blood pressure number and a symptom",
          provenance: { source: "Same as the systolic entry", note: "Diastolic 120 is the other half of the same commonly cited line." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { reading_at_least: { key: "diastolic", value: 120 }, complaint_keys: ["headache", "chest_pain", "breathlessness"] },
          minimum_category: "urgent",
        },
        {
          id: "low_oxygen_reading",
          label: "A recent low oxygen reading",
          provenance: { source: "NEWS2 SpO2 scale 1 (Royal College of Physicians), via secondary summaries", note: "NEWS2 scores 91 or below the highest (3 points) on scale 1. Version 1 used 92. Home pulse oximeters are less reliable, so this only raises the minimum. The CMO confirms the number and the look-back window." },
          status: "draft",
          clinical_sign_off: null,
          applies_when: { reading_at_most: { key: "spo2_pct", value: 91 } },
          minimum_category: "urgent",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/research/S59b.md section C5; docs/OPEN-QUESTIONS.md OQ-S59b-06",
  },
  {
    key: "i18n.language_registry",
    // Language readiness (S86, decision D-14). DORMANT: English is the only language and the only entry. A language can appear
    // here only after a forward translation, an independent back translation, a reconciliation and a native clinical review, with
    // the CMO's signature per string set recorded as `set_hash` in `native_review` and `clinician_signoff` (the fingerprint of the
    // English and translated text signed). `enabled_for` lists the features a language is switched on for; the gate in
    // packages/i18n/src/language-readiness.ts refuses any entry whose keys, signatures or audio clips are not complete. Adding
    // a language is a new version of this entry, published by the CMO (the sign-off route is OQ-313; until it exists, a reviewed
    // pull request, and a build must never type a signature or a hash). The source
    // language needs no review or recording (a missing clip shows its text, spec 8.8) and `status` is not used for it.
    value: {
      source_language: "en",
      features: {
        emergency_triage: { message_prefixes: ["triage."], audio_groups: ["EMG", "TRI", "SYM", "NUM"], clinical: true },
        course: { message_prefixes: ["course.", "lesson.", "breathing."], audio_groups: ["BPC", "BRE"], clinical: true },
        results_consult: { message_prefixes: ["labres.", "labs.", "consult.", "summary."], audio_groups: ["RES", "CON"], clinical: true },
        // Everything not claimed above (medicines, vitals, titration, scribe, reminders and any key added later) falls to this
        // CLINICAL catch-all on purpose: new wording needs the CMO's signature unless someone names it non-clinical below.
        health_and_care: { message_prefixes: [""], audio_groups: ["HLP", "REM"], clinical: true },
        general_ui: {
          message_prefixes: ["app.", "common.", "auth.", "drawer.", "appearance.", "greeting.", "kit.", "audio."],
          audio_groups: ["ONB", "NAV", "SYS"],
          clinical: false,
        },
      },
      languages: {
        en: {
          status: "draft",
          source: true,
          enabled_for: ["emergency_triage", "course", "results_consult", "health_and_care", "general_ui"],
          native_review: {},
          clinician_signoff: {},
        },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S86.md; docs/DECISIONS.md D-14 and S86-1; docs/research/S86.md",
  },
  {
    key: "consultations.access",
    // Who can be booked and when patients are reminded (S64, spec 15.1, 15.3, 15.9; CMO decisions Q19 and Q23, 2026-10-07).
    //  perItemRoles: roles priced per visit (Q23). A role is offered only while its service_products row is active and priced.
    //  perItemPriceKobo: null on purpose. No price has been set for either role (OQ-S64-1); the products are seeded inactive at 0 and the
    //  database refuses to hold a slot for them until a price is set, so no price can be assumed from here.
    //  reminderHoursBefore: the milestones the reminder job sends, mirrored by queue_appointment_reminders (a drift test compares them).
    //  These are the three every visit can get (7 days only when booked 7 or more days ahead, inside a 160 to 168 hour window). A 72 hour
    //  reminder for high-priority visits and a 15 minute one exist in the job and are older than S64.
    //  The 24 hour reminder is the "one to two days" one. longLeadMilestone is sent only for a visit booked at least that far ahead.
    //  intake: the limits on the patient's manual intake (mirrored by the table checks).
    //  licenceRecheck: Q19, the registration number and checked-on date are shown only when a check is on record.
    value: {
      perItemRoles: ["dietitian", "pharmacist"],
      perItemPriceKobo: null,
      reminderHoursBefore: [168, 24, 2],
      longLeadMilestone: "7d",
      intake: { maxReasonChars: 500, maxAnswerChars: 400, maxAnswers: 5 },
      licenceRecheck: { atOnboarding: true, annualRenewal: true, onComplaint: true },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S64.md; docs/plans/S61-S65-cmo-signoff-pack.md Q19, Q23",
  },
  {
    key: "triage.bp_rule_set",
    // v4 of this registry entry names bp_care_triage v6, a DRAFT (founder decision D1, 2026-10-07): the emergency-symptom question from 180/120 instead of 200/130.
    // The database row is a draft and the CMO has NOT signed it. The CMO still decides: whether "severe or new headache" is one symptom or two,
    // whether 180/110 should be the trigger, and the recheck window (params.proposedForCmo in the rule set).
    value: { code: "bp_care_triage", ruleSetVersion: 6, adultAgeYears: 18 },
    owner: "CMO",
    status: "proposed",
    version: 4,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S85-D1.md; supabase/migrations/20261015150837_s85d1_bp_care_triage_v6_draft_180_120.sql",
  },
  {
    key: "diabetes.glucose_thresholds",
    // Moved out of apps/web/src/lib/vitals/glucose-red-flags.ts and apps/mobile/src/lib/glucose-red-flags.ts (same numbers, v1 of the
    // old files was "2026-09-01.1"). Q5: below severeHypo, or any neuro symptom or assisted event below hypoAlert, is red.
    // hypoAlert is ADA Level 1 (3.9), severeHypo is ADA Level 2 (3.0). Counts and windowDays are the old pattern-flag constants.
    // level2MedReviewCount: Q5 option A says two or more Level 2 or 3 events raise a medication review task.
    value: {
      severeHypo: 3.0,
      hypoAlert: 3.9,
      highForDka: 11.0,
      veryHigh: 20.0,
      persistentHigh: 14.0,
      ketoneHigh: 3.0,
      ketoneModerate: 1.5,
      persistentHighMinCount: 3,
      recurrentHypoMinCount: 2,
      windowDays: 14,
      treatCarbGrams: 15,
      recheckMinutes: 15,
      level2MedReviewCount: 2,
      level2MedReviewWindowDays: 30,
      insulinOrSulfonylureaDueMinutes: 240,
      otherHypoFollowUpDueMinutes: 1440,
      urgentReviewDueMinutes: 240,
      routineReviewDueMinutes: 4320,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q5, Q6; ADA hypoglycaemia levels (secondary summary, CMO to read the full Standards)",
    guardPatterns: ["severeHypo\\s*[:=]\\s*3(\\.0)?\\b", "hypoAlert\\s*[:=]\\s*3\\.9\\b"],
  },
  {
    key: "diabetes.reporting",
    // Q7 option A. Reporting only: nothing here triggers a medicine change. Prediabetes uses the ADA lower fasting bound (WHO says 6.1)
    // and is labelled as screening, not a diagnosis. Diagnosis cut-offs are shown for context and never graded by the engine.
    value: {
      hba1cIndividualisedTargetPct: 7,
      hba1cReviewPct: 8,
      timeInRangeTargetPct: 70,
      rangeLowMmol: 3.9,
      rangeHighMmol: 10.0,
      timeBelowRangeMaxPct: 4,
      timeBelowLowRangeMaxPct: 1,
      timeBelowLowRangeMmol: 3.0,
      prediabetesFastingMinMmol: 5.6,
      prediabetesFastingMaxMmol: 6.9,
      prediabetesHba1cMinPct: 5.7,
      prediabetesHba1cMaxPct: 6.4,
      diagnosisFastingMmol: 7.0,
      diagnosisTwoHourMmol: 11.1,
      diagnosisHba1cPct: 6.5,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q7 option A",
  },
  {
    key: "bp.pathway_rules",
    // Q2 targets, Q3 severe tiering, Q4 home validation. Targets are set per patient by a clinician; these are the defaults.
    // 180/110 with no symptom is amber (same-day contact); with any symptom in `severeSymptoms` it is red and pages on-call.
    // The 200/130 phone question and the BP-R rules stay in bp_care_triage (a separate draft awaiting signature).
    value: {
      targetStandard: { systolic: 140, diastolic: 90 },
      targetWithCvdDiabetesCkd: { systolic: 130, diastolic: 80 },
      severe: { systolic: 180, diastolic: 110 },
      severeSymptoms: ["chest_pain", "confusion", "breathlessness", "severe_headache", "visual_disturbance", "weakness_or_numbness", "difficulty_speaking", "seizure"],
      amberContactDueMinutes: 1440,
      homeValidation: { days: 7, readingsPerSession: 2, minGapMinutes: 1, sessions: ["morning", "evening"], discardFirstDays: 1, meanSystolic: 135, meanDiastolic: 85 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q2, Q3, Q4 option A",
  },
  {
    key: "pathways.weight",
    // Q10 option A: WHO BMI cut-offs plus waist-to-height 0.5. Rewards consistency, never body size.
    value: { bmiOverweight: 25, bmiObese: 30, waistToHeightRaised: 0.5, waistToHeightHigh: 0.6 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q10 option A",
  },
  {
    key: "pathways.asthma_copd",
    // Q11 option A (the SpO2 line is the only part option B drops). Manual reliever log, no sensor.
    value: { relieverUsesPerWeekFlag: 2, relieversPerYearFlag: 3, peakFlowRedBelowPctOfBest: 50, spo2RedBelowPct: 92, reviewDueMinutes: 1440 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q11 option A; GINA 2025 control questions (not a GINA number for SpO2)",
  },
  {
    key: "pathways.heart_failure",
    // Q12 option A: weight up by more than weightGainKg in weightGainDays. Patient-facing guidance, not the primary guideline.
    value: { weightGainKg: 2, weightGainDays: 3, reviewDueMinutes: 1440 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q12 option A",
  },
  {
    key: "pathways.ckd",
    // Q12 option A (KDIGO 2024, secondary summary): refer on any one of these.
    value: { referEgfrBelow: 30, referAcrMgPerG: 300, sustainedFallPct: 20, sustainedFallMlPerMin: 5, fallWindowDays: 365, reviewDueMinutes: 4320 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q12 option A",
  },
  {
    key: "pathways.cadence",
    // 13.18: a weekly automated review, and a clinician review monthly while uncontrolled, quarterly once controlled. 13.16: complication
    // check intervals (eye, foot, kidney) used to generate due dates; the live diabetes_complication_checks recheck cadence is untouched.
    value: {
      automatedReviewDays: 7,
      clinicianReviewUncontrolledDays: 30,
      clinicianReviewControlledDays: 90,
      milestoneDueDays: { baseline: 0, first_review: 30, three_month_review: 90, six_month_review: 180 },
      scheduledTestIntervalDays: { eye: 365, foot: 365, kidney: 365 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S62.md; spec 13.16, 13.18; Q1 (review monthly until controlled)",
  },
  {
    key: "pathways.hypertension_step_table",
    // DRAFT step table from CMO decision pack Q1 option A (Resolve to Save Lives, Nigeria protocol, May 2023; Nigeria national guideline
    // 2023-2028). NEVER approved by an agent: it is seeded as a `protocols` row with status draft, and the evaluator only lets a draft
    // drive a TEST patient's proposal. Drug names, doses and the supply list are for the CMO to confirm against the primary PDFs.
    // One medicine per signed change, so "amlodipine 10 + losartan 100" is two signed steps (raise amlodipine, then raise losartan).
    // The pack's "start at step 2 when 160/100 to 179/109" is NOT expressible in the one-item proposal format: see OQ in docs/OPEN-QUESTIONS.md.
    // Women who could be pregnant: the evaluator already stops every proposal unless pregnancy is recorded as "no".
    // Telmisartan 40/80 or amiloride-HCTZ may substitute where stocked: a clinician choice, named in the step rationale only.
    value: {
      code: "htn_rtsl_ng",
      version: 1,
      status: "draft",
      params: {
        minReadings: 4,
        windowDays: 7,
        minAdherencePercent: 80,
        reviewWindowDays: 28,
        staleAfterDays: 3,
        requireValidated: true,
        validation: { systolicMin: 60, systolicMax: 260, diastolicMin: 30, diastolicMax: 160 },
      },
      steps: [
        {
          id: "step_1_amlodipine_5",
          label: "Start amlodipine 5 mg",
          requires: [],
          propose: { action: "start", item: { drugName: "Amlodipine", dose: "5 mg", frequency: "once daily", route: "oral", durationDays: 30, quantity: "30 tablets", repeatsAllowed: 0, indication: "Hypertension" } },
          rationale: "Step 1 of the draft ladder. A clinician may substitute telmisartan or amiloride-hydrochlorothiazide where stocked.",
        },
        {
          id: "step_2_add_losartan_50",
          label: "Add losartan 50 mg",
          requires: [{ drugName: "Amlodipine", dose: "5 mg" }],
          propose: { action: "start", item: { drugName: "Losartan", dose: "50 mg", frequency: "once daily", route: "oral", durationDays: 30, quantity: "30 tablets", repeatsAllowed: 0, indication: "Hypertension" } },
          rationale: "Step 2 of the draft ladder. Not for anyone who could be pregnant.",
        },
        {
          id: "step_3a_raise_amlodipine_10",
          label: "Raise amlodipine to 10 mg",
          requires: [{ drugName: "Amlodipine", dose: "5 mg" }, { drugName: "Losartan", dose: "50 mg" }],
          propose: { action: "change", changes: "Amlodipine", item: { drugName: "Amlodipine", dose: "10 mg", frequency: "once daily", route: "oral", durationDays: 30, quantity: "30 tablets", repeatsAllowed: 0, indication: "Hypertension" } },
          rationale: "First half of step 3 of the draft ladder (amlodipine 10 mg with losartan 100 mg).",
        },
        {
          id: "step_3b_raise_losartan_100",
          label: "Raise losartan to 100 mg",
          requires: [{ drugName: "Amlodipine", dose: "10 mg" }, { drugName: "Losartan", dose: "50 mg" }],
          propose: { action: "change", changes: "Losartan", item: { drugName: "Losartan", dose: "100 mg", frequency: "once daily", route: "oral", durationDays: 30, quantity: "30 tablets", repeatsAllowed: 0, indication: "Hypertension" } },
          rationale: "Second half of step 3 of the draft ladder.",
        },
        {
          id: "step_4_add_hctz_25",
          label: "Add hydrochlorothiazide 25 mg",
          requires: [{ drugName: "Amlodipine", dose: "10 mg" }, { drugName: "Losartan", dose: "100 mg" }],
          propose: { action: "start", item: { drugName: "Hydrochlorothiazide", dose: "25 mg", frequency: "once daily", route: "oral", durationDays: 30, quantity: "30 tablets", repeatsAllowed: 0, indication: "Hypertension" } },
          rationale: "Step 4 of the draft ladder.",
        },
        {
          id: "step_5_refer",
          label: "Refer: not controlled on three medicines",
          requires: [{ drugName: "Amlodipine", dose: "10 mg" }, { drugName: "Losartan", dose: "100 mg" }, { drugName: "Hydrochlorothiazide", dose: "25 mg" }],
          propose: null,
          rationale: "End of the draft ladder: refer.",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S61-S65-cmo-signoff-pack.md Q1 option A (RTSL Nigeria protocol May 2023); OQ-171",
  },
  {
    key: "security.rules",
    // Security thresholds (S39, S39c, S39d, S39h). Live values are the active row of `security_config`; this entry mirrors it and a test fails if the
    // migration seed and this value drift. CONFIRMED by the CMO on 2026-10-07 (selected in chat, S39h; review against real log data at 90 days), owned by the security owner (CMO until one is named). v1 (S39): failed lookups on a public
    // token door in one hour that open a security incident (the answer to guessing is to see it, never to lock the door). v2 (S39c): how long an
    // opening of a patient record stays valid for an untied clinician, how many untied openings in an hour raise an incident, the after-hours
    // band (Lagos hours), and the retention periods (NHS Records Management Code and HIPAA as references, counsel to confirm). v3 (S39d): the review clock, in days, for a patient data export request. Retention is
    // config only: real_data_auto_delete is false, nothing deletes real patient data (founder, 2026-10-07).
    value: {
      lookup_failure_alert_per_hour: 50,
      record_open_window_hours: 8,
      untied_open_alert_per_hour: 20,
      after_hours_start: 22,
      after_hours_end: 6,
      export_review_days: 30,
      retention: {
        adult_clinical_record_years_after_last_contact: 8,
        child_record_until_age: 25,
        child_record_until_age_if_seen_at_17: 26,
        maternity_record_years: 25,
        mental_health_years_after_last_contact: 20,
        access_audit_log_years: 8,
        consent_years_after_relationship_end: 6,
        payments_ledger_years: 6,
        operational_data_days_min: 90,
        operational_data_days_max: 730,
        real_data_auto_delete: false,
      },
    },
    owner: "CMO",
    status: "confirmed",
    version: 4,
    effectiveFrom: "2026-10-07",
    source: "docs/DECISIONS.md (CMO decisions 2026-10-07); spec section 13; founder direction 2026-10-07",
  },
  {
    key: "maternal_child.growth.reference_versions",
    value: {"under5_version": "who-2006-v1", "over5_version": "who-2007-v1", "under5_max_age_days": 1856, "wfh_max_age_days": 1826, "recumbent_until_age_days": 730, "length_height_correction_cm": 0.7},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, WHO 2006 standards to day 1856, WHO 2007 reference from month 61; weight-for-height to 60 months (1826 days); recumbent length to 730 days; 0.7 cm length/height difference (WHO igrowup). CMO pack A7. Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.growth.plausibility",
    value: {"weight_for_age_z": [-6, 5], "height_for_age_z": [-6, 6], "weight_for_height_z": [-5, 5], "bmi_for_age_z": [-5, 5], "head_circumference_for_age_z": [-5, 5], "muac_for_age_z": [-5, 5]},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, WHO biologically implausible z-score ranges. Weight-for-age, height-for-age, weight-for-height and BMI-for-age follow the WHO Anthro documentation; head circumference and MUAC use +-5 as an assumption for the CMO to confirm (OQ-353). Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.growth.nutrition_routing",
    value: {"sam_muac_mm_lt": 115, "sam_wfh_z_lt": -3, "sam_oedema": true, "sam_review_within_hours": 12, "mam_muac_mm_lt": 125, "mam_wfh_z_lt": -2, "mam_review_within_days": 3, "muac_min_age_months": 6, "muac_max_age_months": 60, "stunting_hfa_z_lt": -2, "underweight_wfa_z_lt": -2},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, CMO pack A7 (selected, NOT signed): severe = MUAC under 115 mm, or weight-for-height z below -3, or bilateral oedema (red, same-day, 12 hours here); moderate = MUAC 115 to under 125 mm or z -3 to under -2 (amber, within 3 days); stunting and underweight informational. The pack names no MUAC age range: 6 to 59 months is the WHO/UNICEF range for these cut-offs and is a proposal (OQ-351). Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.epds.cutoffs",
    value: {"item_count": 10, "possible_min": 10, "probable_min": 13, "possible_review_within_days": 7, "probable_review_within_hours": 48, "item_10_any_nonzero_is_crisis": true},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, CMO pack A6 (selected, NOT signed, provisional): 10 to 12 possible, review within the week; 13 or more probable, clinician review within 48 hours; any non-zero item 10 goes to the crisis route whatever the total. Local audit after the first 200 screens. Basis and Nigerian cut-off range 7 to 12 still to be verified (OQ-354). Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.postnatal.checks",
    value: {"windows": [{"code": "week_1", "days": 7}, {"code": "week_6", "days": 42}], "epds_prompt_windows": ["week_6"], "feed_log_grace_days": 7},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, Mother and baby checks at week 1 and week 6 after delivery (founder scope S68; the existing postnatal_checkins windows). EPDS prompted at week 6 as a proposal for the CMO to place (OQ-355). Windows are generated from this row, never typed in code. Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.lifecycle.rules",
    value: {"transitions": {"start_trying": {"from": ["tracking"], "to": "trying"}, "stop_trying": {"from": ["trying"], "to": "tracking"}, "pregnancy_confirmed": {"from": ["tracking", "trying", "postnatal", "parenting"], "to": "pregnant"}, "delivery_recorded": {"from": ["tracking", "trying", "pregnant"], "to": "postnatal"}, "pregnancy_loss_recorded": {"from": ["pregnant"], "to": "tracking"}, "postnatal_period_ended": {"from": ["postnatal"], "to": "parenting"}, "parenting_ended": {"from": ["parenting"], "to": "tracking"}}, "stage_content": {"tracking": "cycle", "trying": "conception", "pregnant": "pregnancy", "postnatal": "postnatal", "parenting": "child"}, "stage_bp_rule_set": {"pregnant": "pregnancy", "postnatal": "postpartum"}, "loss_baby_content_hold_days": 90, "max_days_back": 400},
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, Founder scope S68 (16.11): transitions only on confirmed events. Stage names, the stage to content map, the rule-set names S67 reads, the 90 day hold on baby content after a loss and the 400 day look-back are proposals for the CMO and founder (OQ-356). Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "maternal_child.retention.rules",
    value: {"grace_days": 7, "sealed_retention_years": 8, "scopes": ["feed_log", "child_growth", "baby_checks", "pregnancy_loss"]},
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "S68, CMO/founder pack B3 and C (selected 2026-10-07, not signed): patient-entered tracker and pregnancy-loss notes deleted on request after the grace window; clinician-recorded or acted-on data sealed 8 years (counsel to confirm the period) then destroyed. Grace window length is a proposal. Mirrored in supabase/migrations (maternal_child_config); see maternal-child-mirror.test.ts.",
  },
  {
    key: "directory.access_rules",
    // S65 (CMO decisions Q21, Q22, Q23, 2026-10-07): how long a listing may go unverified before patient search leaves it out (twice its
    // cadence), when two reports force re-verification, the ratings moderation target and the booking reminder times. Mirrors the active row of
    // `directory_verification_config` (version 2); a test fails if the migration seed and this value drift. UNSIGNED: the Q21 intervals are [U].
    value: {
      default_months: 12,
      due_soon_days: 30,
      by_listing_table: { pharmacy_partners: 6 },
      visibility: {
        cadence_days: { emergency_hospital: 90, pharmacy_24h: 90, clinic: 180, lab: 180, other: 365 },
        hide_multiple: 2,
        reports_to_reverify: 2,
        reports_per_person_per_day: 10,
      },
      ratings: {
        moderation_target_hours: 72,
        min_ratings_to_show_average: 3,
        hold_terms: ["diagnos", "misdiagnos", "prescri", "wrong medicine", "wrong drug", "treatment plan", "doctor was wrong", "the doctor", "clinical judgement"],
      },
      booking: { reminder_minutes_before: [10080, 1440, 120], min_lead_minutes: 60, max_days_ahead: 90 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S65.md; docs/plans/S61-S65-cmo-signoff-pack.md Q21 to Q23",
  },
  {
    key: "emergency.pack",
    // The offline emergency content pack (S65, INV-06). DRAFT: `signed` is null and an agent never sets it. No telephone number of any kind
    // (CMO decision Q18). Mirrors `emergency_pack_config` version 1; a test fails if they drift.
    value: EMERGENCY_PACK as unknown as ConfigValue,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S65.md; CMO decisions Q17 and Q18",
  },
  {
    key: "vitals.device_red_rules",
    // Thresholds the phone evaluates itself for pulse, SpO2 and temperature (INV-06). They copy the live SQL classifiers; a parity test
    // reads the migrations and fails if either side moves. Not new clinical thresholds.
    value: DEVICE_RED_RULES as unknown as ConfigValue,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "supabase/migrations/20260829140000_pulse_red_flag_engine.sql; 20260807090139_spo2_red_flag_engine.sql; 20260807090237_temperature_red_flag_engine.sql",
  },
  {
    key: "care_circle.help_alert",
    // The patient's one-tap "I need you" alert to their Care Circle (S65, Q20). Cooldown stops an accidental double tap from becoming two alerts;
    // a shared location is deleted after location_keep_hours. Mirrors `care_circle_help_alert_config` version 1.
    value: { cooldown_minutes: 10, max_per_day: 5, location_keep_hours: 24, consent_text_version: 1 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S65.md; CMO decision Q20",
  },
  {
    key: "private_section.lock",
    // The section lock for cycle and, later, pregnancy and other private sections (S66 builds it, S67 to S69 reuse it). It guards a view on
    // the device; the server data is never behind it. on_by_default is the founder decision "optional, on by default" (the person may turn
    // it off on purpose and is not asked again). pin_min_digits and pin_max_digits: allowed PIN length. free_attempts: wrong tries before
    // the first lockout. lockout_seconds: the wait after each further wrong try (the last value repeats). relock_after_background_seconds:
    // how long the app or tab may be away before the PIN is asked again. pbkdf2_iterations: work factor of the on-device PIN hash.
    value: {
      pin_min_digits: 4,
      pin_max_digits: 6,
      free_attempts: 5,
      lockout_seconds: [30, 60, 300, 900, 3600],
      relock_after_background_seconds: 30,
      pbkdf2_iterations: 20000,
      on_by_default: true,
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S66.md; docs/plans/S66-S70-cmo-signoff-pack.md section C",
  },
  {
    key: "reproductive_privacy.rules",
    // Live values are the active row of `reproductive_privacy_config`; this entry mirrors it and a test fails if the migration seed and this
    // value drift. deletion_grace_days: how long after a person asks to delete what they entered in the cycle and menopause trackers before
    // it is removed, during which they can cancel (decision C). sealed_retention_years: how long data a clinician recorded or acted on is kept
    // sealed before destruction, counsel to confirm (decision B3). report_window_months: how far back the clinician pattern report reads.
    value: { deletion_grace_days: 14, sealed_retention_years: 8, report_window_months: 12 },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S66.md; docs/plans/S66-S70-cmo-signoff-pack.md B3 and C",
  },
  {
    key: "capacity.cover_rules",
    // Capacity, cover, surge, fatigue and fire drills (S16-S20 Stage 5, CMO decisions 12 to 15). Live values are the active row of
    // `capacity_cover_config`; this entry mirrors it and a test fails if the migration seed and this value drift. SHIPS WITH THE THREE
    // SWITCHES OFF: gate_enforce (new care pack sales close when lead headroom, 72 hours of rota cover or the oldest open task cross a
    // limit), hard_rest_enforce (11 hours rest after a shift with overnight pages, only the CMO overrides) and drill_enabled (a monthly
    // unannounced test page). Version 2 is the same config with all three ON, inactive and unsigned. min_lead_headroom: fewest free lead
    // places before sales close. rota_horizon_hours / rota_gap_tolerance_hours: hours of the rota that must have a primary and a backup.
    // oldest_task_max_class: task classes up to this one count when the oldest open task passes its watchdog warning time. surge_*: the
    // CMO's surge mode (max hours, first routine class it widens to any eligible clinician, multiplier on routine warning times).
    // pause_*: the CMO's pause (max hours; an admin request lapses after pause_confirm_minutes; routine classes from pause_hold_min_class
    // are not offered while paused). overnight_*: the Lagos hours that count as overnight. cover_offer_pages: overnight pages in one shift
    // that trigger the offer of the next shift. drill_*: the monthly drill (drill_roster_lookahead_days: who counts as on the rota;
    // drill_min_gap_minutes: no drill within this many minutes of another test page; drill_busy_hours: nobody holding a page opened within
    // this many hours is drilled), the target (90 percent within 300 seconds, PROPOSED) and the time after which an unanswered drill is a
    // miss. A drill result is informational only: weight 0, never pay or removal.
    value: {
      gate_enforce: 0,
      min_lead_headroom: 3,
      rota_horizon_hours: 72,
      rota_gap_tolerance_hours: 0,
      oldest_task_max_class: 5,
      override_max_hours: 24,
      override_reason_min_chars: 20,
      reason_min_chars: 20,
      surge_max_hours: 12,
      surge_widen_min_class: 4,
      surge_routine_window_multiplier: 2,
      pause_max_hours: 24,
      pause_confirm_minutes: 240,
      pause_hold_min_class: 6,
      hard_rest_enforce: 0,
      rest_hours: 11,
      overnight_start_hour: 22,
      overnight_end_hour: 7,
      rest_min_overnight_pages: 1,
      rest_override_max_days: 3,
      cover_offer_pages: 2,
      cover_offer_lookahead_hours: 36,
      drill_enabled: 0,
      drill_interval_days: 30,
      drill_roster_lookahead_days: 30,
      drill_min_gap_minutes: 10,
      drill_busy_hours: 6,
      drill_ack_target_seconds: 300,
      drill_ack_target_pct: 90,
      drill_missed_after_minutes: 60,
      drill_hour_start: 8,
      drill_hour_end: 20,
      drill_max_per_run: 2,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/design/S16-S20-capacity-cover.md; docs/plans/S16-S20-review-and-build-plan.md section 5, decisions 12 to 15",
  },
  {
    key: "capacity.cover_rules_v2",
    // Version 2 of capacity.cover_rules: the same rules with gate_enforce, hard_rest_enforce and drill_enabled SWITCHED ON. Shipped as an
    // INACTIVE, unsigned row (capacity_cover_config version 2). The CMO signs it in the sign-off hub to switch the three on; signing a
    // version with gate_enforce on is refused while the on_call_cover_ok go-live guard is off.
    value: {
      gate_enforce: 1,
      min_lead_headroom: 3,
      rota_horizon_hours: 72,
      rota_gap_tolerance_hours: 0,
      oldest_task_max_class: 5,
      override_max_hours: 24,
      override_reason_min_chars: 20,
      reason_min_chars: 20,
      surge_max_hours: 12,
      surge_widen_min_class: 4,
      surge_routine_window_multiplier: 2,
      pause_max_hours: 24,
      pause_confirm_minutes: 240,
      pause_hold_min_class: 6,
      hard_rest_enforce: 1,
      rest_hours: 11,
      overnight_start_hour: 22,
      overnight_end_hour: 7,
      rest_min_overnight_pages: 1,
      rest_override_max_days: 3,
      cover_offer_pages: 2,
      cover_offer_lookahead_hours: 36,
      drill_enabled: 1,
      drill_interval_days: 30,
      drill_roster_lookahead_days: 30,
      drill_min_gap_minutes: 10,
      drill_busy_hours: 6,
      drill_ack_target_seconds: 300,
      drill_ack_target_pct: 90,
      drill_missed_after_minutes: 60,
      drill_hour_start: 8,
      drill_hour_end: 20,
      drill_max_per_run: 2,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/design/S16-S20-capacity-cover.md; capacity_cover_config version 2 (inactive)",
  },
  {
    key: "capacity.pilot_lead_cap",
    // Pilot lead cap (decision 12): 40 patients per lead clinician for the pilot, a conservative guess (panel evidence is unverified).
    // Shipped as a NEW lead_config draft (next version number, copied from the row in force; existing rows untouched), inactive and unsigned; the CMO signs it in the sign-off hub.
    value: 40,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-15",
    source: "docs/design/S16-S20-capacity-cover.md; lead_config draft (inactive); decision 12",
  },
  {
    key: "ops_desk.rules",
    // Ops desk resilience (OQ-441, decision S16-S20-10). Live values are the active row of `ops_desk_config`; a test fails if the migration seed and this value drift. deputy_after_seconds: how long the named primary has to acknowledge a page incident before the deputy is told (PROPOSED). uncovered_roster_alarm: 1 opens a sev1 when a real rota runs and no ops contact is on duty. checklist_gates_readiness: 0 = the resilience checklist is recorded and gates nothing (ships OFF); version 2 turns it on. checklist_max_age_days: a statement older than this no longer counts. call_note_max_chars: the longest note on a logged call.
    value: {
      deputy_after_seconds: 300,
      uncovered_roster_alarm: 1,
      checklist_gates_readiness: 0,
      checklist_max_age_days: 90,
      call_note_max_chars: 500,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/runbooks/ops-desk-expired-page.md; supabase/migrations/20261020173800_ops_desk_expired_page_resilience.sql",
  },
  {
    key: "ops_desk.rules_v2",
    // Version 2 of ops_desk.rules: the same rules with the checklist gate ON. Shipped as an INACTIVE, unsigned row (ops_desk_config version 2). The CMO signs it in the sign-off hub.
    value: {
      deputy_after_seconds: 300,
      uncovered_roster_alarm: 1,
      checklist_gates_readiness: 1,
      checklist_max_age_days: 90,
      call_note_max_chars: 500,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "ops_desk_config version 2 (inactive)",
  },
  {
    key: "ai.review_sample_rate",
    value: 0.05,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S80-S85-cmo-decision-pack.md decision 6 (5 percent stratified clinician sample per AI system per month; flagged answers always included). Unsigned until the CMO signs.",
  },
  {
    key: "content.review_interval_months",
    value: { standard: 24, high_risk: 12, start_early_months: 2 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S80-S85-cmo-decision-pack.md decision 5 (24 months standard; 12 months for emergency, medicine-safety, pregnancy and mental-health content). Unsigned until the CMO signs.",
  },
  {
    key: "outcomes.measures",
    // Programme reporting (S75b slimmed, S75c): the response-time grouping rules, the retention days and the evaluation-design note a sponsor pack carries.
    // Live values are the active row of `outcome_measure_config`; this entry mirrors it and a test fails if the migration seed and this value drift. Every
    // number is PROPOSED and owned by the CMO; nothing here is signed. The outcome MEASURES (HbA1c, weight, PHQ-9, GAD-7: windows, goals, exclusions and
    // severity bands) are in outcome_config and mirrored as `outcomes.measure_rules`; the sponsor pack shows them only once the CMO has activated that config.
    value: {
        response_times: {
          min_clinicians_per_group: 3,
          priority_bands: {
            urgent: [1, 2],
            soon: [3, 5],
            routine: [6, 9],
          },
        },
        retention: {
          days: [30, 90, 180],
          engaged_window_days: 30,
        },
        pack: {
          evaluation_design: "What this pack is: a descriptive before-and-after summary of the members who agreed to share group figures, taken at the day they joined and again 90 and 180 days later. There is no comparison group, members were not chosen at random, and the people who stay are not the same as the people who leave. For these reasons the figures describe what happened to these members and cannot show what would have happened without the programme. Differences between months or groups can arise from who joined, not from anything the programme did.",
          caveat: "A change in a measure is not a verdict on the programme. Results for the same programme will differ with who joined, how long they stayed and how often they were measured.",
        },
      },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S75.md; docs/plans/S70-S75-cmo-signoff-pack.md C7; decision S75-2",
  },
  {
    key: "outcomes.measure_rules",
    // Version 2 (S75 exclusions and severity bands): version 1 plus, on each measure, who is NOT counted (`exclusions`: under 18 or age unknown for all; pregnant
    // for HbA1c and weight; a PHQ-9 total of 20 or more for PHQ-9 and GAD-7) and, for PHQ-9 and GAD-7, the severity `bands`. The database holds it as
    // `outcome_config` v4, which is v3 plus these keys. PROPOSED, UNSIGNED and INACTIVE like v3: the CMO activates v4 (not v3) to bring the exclusions in.
    // Only the TOTAL score is read to remove a person; item 9 and the crisis flag are never read. A test compares this with the migration seed.
    value: {
      bp_report_days: [90, 180],
      measures: {
        hba1c: {
          days: [0, 90, 180],
          goal_below_percent: 7.0,
          use_care_plan_target: true,
          valid_min: 3.0,
          valid_max: 20.0,
          baseline_before_days: 90,
          baseline_after_days: 14,
          followup_tolerance_days: 30,
          definition: "HbA1c, as a percentage. Change is the value near the day minus the baseline value near joining. A person reached the goal when the value near the day is under 7.0 percent or at their own care-plan HbA1c target. The result nearest the day inside the window is used.",
          limitations: "Only people with an HbA1c result are counted in the measure; a person with no result near a day is shown as no result, never as not improved. Results come from the lab results recorded on the platform, not from every lab a person may have used. A before and after view without a comparison group says nothing about cause. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
          exclusions: {
            min_age_years: 18,
            age_required: true,
            pregnancy: true,
          },
        },
        weight: {
          days: [0, 30, 90, 180],
          goal_loss_percent: 5.0,
          valid_min: 20,
          valid_max: 400,
          min_age_years: 18,
          baseline_before_days: 14,
          baseline_after_days: 7,
          followup_tolerance_days: 14,
          definition: "Weight in kilograms. Change is the percent difference between the weight near the day and the baseline weight near joining. A person reached the goal when weight fell by 5 percent or more. The weight nearest the day inside the window is used. Adults only.",
          limitations: "Only people who logged a weight are counted; a person with no weight near a day is shown as no result, never as not improved. Weight changes for many reasons, including pregnancy, illness and fluid; the measure is not a judgement of any person. A before and after view without a comparison group says nothing about cause. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
          exclusions: {
            min_age_years: 18,
            age_required: true,
            pregnancy: true,
          },
        },
        phq9: {
          days: [0, 30, 90, 180],
          max_score: 27,
          response_fall_percent: 50,
          remission_below: 5,
          min_baseline_for_outcome: 5,
          baseline_before_days: 14,
          baseline_after_days: 14,
          followup_tolerance_days: 21,
          definition: "PHQ-9 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
          limitations: "Only total scores are used; no answer to any single question is read. A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
          exclusions: {
            min_age_years: 18,
            age_required: true,
            safeguarding: {
              score_from: 20,
            },
          },
          bands: [["minimal", 0, 4], ["mild", 5, 9], ["moderate", 10, 14], ["moderately_severe", 15, 19], ["severe", 20, 27]],
        },
        gad7: {
          days: [0, 30, 90, 180],
          max_score: 21,
          response_fall_percent: 50,
          remission_below: 5,
          min_baseline_for_outcome: 5,
          baseline_before_days: 14,
          baseline_after_days: 14,
          followup_tolerance_days: 21,
          definition: "GAD-7 total score only. Response is a fall of 50 percent or more from the baseline total. Remission is a total below 5. Both are counted only for people whose baseline total was 5 or more.",
          limitations: "A screening score is not a diagnosis. People with no score near a day are shown as no result. Readable only by the person and by a clinician with a written reason; never shown to a sponsor. People under 18, or with no date of birth on record, are not counted in any measure; people who are pregnant are not counted in HbA1c or weight; and people whose PHQ-9 total reached the safeguarding line (20 or more) are not counted in PHQ-9 or GAD-7. They are followed up through the existing routes, never through a report.",
          exclusions: {
            min_age_years: 18,
            age_required: true,
            safeguarding: {
              score_from: 20,
            },
          },
          bands: [["minimal", 0, 4], ["mild", 5, 9], ["moderate", 10, 14], ["severe", 15, 21]],
        },
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-13",
    source: "docs/design/S75.md (exclusions); docs/design/S75-outcome-measures.md; docs/plans/S75-S80-cmo-decisions.md S-5; decision S75-2",
  },
  {
    key: "notifications.rules",
    // v5 (follow-up FU-notify, CMO answers 2026-10-16): redUnconfirmed changes two switches and keeps the rest of v4.
    //  deliveredCountsAsConfirmed false (OQ-329): a delivered push receipt no longer ends the unconfirmed-red wait; only the patient's own
    //  action does (opened a notice, acknowledged the guidance, replied). couldNotGetCareOutreachNow false (OQ-330): "I could not get care"
    //  is recorded and shown to on-call but the clinician call waits for the 30 minute rule. undeliveredMinutes 5 and expireHours 6 are
    //  kept as answered (OQ-331). Owner is the CMO (OQ-337). Live value: the active row of `notification_rules_config`.
    value: {
      quietHours: { enabled: false, start: "21:00", end: "07:00" },
      routinePushPerDay: 4,
      receiptCheckMinutes: 15,
      receiptGiveUpHours: 24,
      pushFallback: { enabled: true, afterMinutes: 240, maxAgeHours: 24, perRecipientPerDay: 1, batchSize: 200 },
      redUnconfirmed: {
        enabled: true,
        unconfirmedMinutes: 30,
        undeliveredMinutes: 5,
        expireHours: 6,
        deliveredCountsAsConfirmed: false,
        couldNotGetCareOutreachNow: false,
        criticalReceiptCheckMinutes: 2,
      },
    },
    owner: "CMO",
    status: "proposed",
    version: 5,
    effectiveFrom: "2026-10-16",
    source: "docs/design/FU-notify-closeout.md; CMO answers OQ-329, OQ-330, OQ-331, OQ-337 (2026-10-16)",
  },
  {
    key: "credentialing.rules",
    // Version 6 (follow-up FU-notify, OQ-346): version 5 plus verification_evidence_retention_years_after_employment (6: employment plus 6 years,
    // RECORDED ONLY, nothing enforces or deletes by it). document_purge_enabled stays false and the purge skips every evidence document.
    // Inserted INACTIVE and unsigned, like version 5.
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
      notice_windows_days: [90, 30, 7, 0],
      grace_max_days: 14,
      separate_verifier_and_approver: true,
      document_max_bytes: 8388608,
      document_retention_years_after_offboarding: 7,
      require_verified_phone: false,
      document_purge_enabled: false,
      rejected_application_document_retention_months: 24,
      primary_source_required: true,
      primary_source_routes: ["mdcn_dataflow", "mdcn_written_confirmation", "mdcn_register_check"],
      primary_source_max_age_days: 365,
      recheck_months: 6,
      recheck_overdue_days: 14,
      credential_date_max_days: 1100,
      grandfather_ends_on: "2027-01-13",
      reverify_months: 12,
      reverify_notice_days: 30,
      verification_evidence_retention_years_after_employment: 6,
      renewal_cycle: {
        cycle_end_month: 12,
        cycle_end_day: 31,
        proof_deadline_month: 12,
        proof_deadline_day: 15,
      },
      missing_licence_date_ineligible: true,
      verification_sources: ["mdcn_register_lookup", "document_sighted", "insurer_confirmation", "other"],
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 6,
    effectiveFrom: "2026-10-16",
    source: "docs/design/FU-notify-closeout.md; OQ-346 (2026-10-16); builds on version 5 (S76 B2)",
  },
  {
    key: "privacy.webhook_inbox_retention",
    // OQ-341 (answered 2026-10-16). Live value: the active row of `provider_event_retention_config`; a test fails on drift.
    //  purgeEnabled false: the count-first purge (run_provider_event_retention) refuses to act and is not scheduled until the DPO signs a new version.
    //  rejectedDays 30: rejected (bad signature) rows are deleted after this long. verifiedRawBodyDays 90: a verified, processed raw body keeps its
    //  customer emails this long, then they are redacted (the row, its hash and its status stay). batchLimit: rows per run.
    value: { purgeEnabled: false, rejectedDays: 30, verifiedRawBodyDays: 90, redactCustomerEmails: true, batchLimit: 500 },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/FU-notify-closeout.md; OQ-341; docs/legal/dpia-addendum-red-alert-channel.md",
  },
  {
    key: "proxy.cooling_off",
    // S42, OQ-48 (coercion safeguard): after a parent ends an arrangement that someone else set up for them, that person cannot
    // start a new setup for the same number for this many days. The parent can still invite them again from their own account.
    // The spec gives no number; this is a PROPOSED value. SQL caps it at 365 and defaults to 30 when none is passed.
    value: { days: 30 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: FROM,
    source: "S42 safeguard (OQ-48): not from the spec; proposed",
  },
  {
    key: "proxy.annual_review",
    // Yearly "still need this person's access?" review (NHS proxy-access standard: grant, redact, review, revoke). A proxy or caregiver grant is due for
    // review 12 months after it was given or last kept. The reminder repeats every 30 days, at most 4 in a cycle (the first plus three). Access is NEVER
    // removed by silence. tellProxy is a safeguarding switch (OQ-705): true sends the proxy one calm in-app notice per cycle and shows them a "due" flag; false tells them nothing. proxyNoticeDays is how long the proxy's flag shows, counted from the notice and not from the person's answer. Live value is the active row of `proxy_review_config` v1; a Jest mirror test compares the two.
    value: { intervalMonths: 12, repeatDays: 30, maxReminders: 4, tellProxy: false, proxyNoticeDays: 14 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "Build proposal 2026-10-16 (NHS proxy-access standard, January 2026); not from the v5 spec; OQ-705",
  },
  {
    key: "pharmacy.quality",
    // Partner pharmacy quality rule (S28, spec 8.11). A pharmacy can be chosen for a collection only while its verified
    // licence has at least this many days left. Live value: the active row of `pharmacy_quality_config`; a test fails if the
    // migration seed and this value drift. PROPOSED by the build, never signed: the CMO owns the rule.
    value: { min_licence_days_left: 30 },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-06",
    source: "docs/design/S28.md; docs/research/S28.md",
  },
  {
    key: "immunisation.schedule",
    // The national immunisation schedule as versioned data (S43, spec 2.6). Registry version 1 mirrors sign-off row version 2 (the UNSIGNED draft): HPV is two doses
    // six months apart and typhoid is not in the schedule (founder, 2026-10-07). It mirrors the draft row in
    // `vaccination_schedule_signoffs` (version 2) and a test fails if they differ. Until the CMO signs it in the database
    // (public.sign_vaccination_schedule) no due-date reminder is sent: private.queue_vaccination_reminders() does nothing
    // without a signed schedule that carries this config. Items marked NV are not verified against a dated NPHCDA table.
    value: {
      status: "draft_unsigned",
      country: "NG",
      doses: [
        {
          vaccine: "BCG",
          catalog_code: "child_bcg",
          at_weeks: [0],
          evidence: "V",
        },
        {
          vaccine: "OPV",
          catalog_code: "child_opv",
          at_weeks: [0, 6, 10, 14],
          evidence: "V",
        },
        {
          vaccine: "Hepatitis B birth dose",
          catalog_code: "child_hep_b_birth",
          at_weeks: [0],
          evidence: "V",
          note: "birth-dose time limit not verified",
        },
        {
          vaccine: "Pentavalent",
          catalog_code: "child_penta",
          at_weeks: [6, 10, 14],
          evidence: "V",
        },
        {
          vaccine: "Pneumococcal conjugate",
          catalog_code: "child_pcv",
          at_weeks: [6, 10, 14],
          evidence: "V",
        },
        {
          vaccine: "Rotavirus",
          catalog_code: "child_rota",
          at_weeks: [6, 10, 14],
          evidence: "V",
          note: "three doses in the pack; the live catalogue lists two",
        },
        {
          vaccine: "IPV",
          catalog_code: "child_ipv",
          at_weeks: [6, 14],
          evidence: "V",
          note: "two doses in the pack; the live catalogue lists one",
        },
        {
          vaccine: "Vitamin A",
          catalog_code: null,
          at_weeks: [26, 52],
          evidence: "V",
          note: "100,000 IU at 6 months, 200,000 IU at 12 months; no catalogue entry yet",
        },
        {
          vaccine: "Measles 1",
          catalog_code: "child_measles",
          at_weeks: [39],
          evidence: "V",
        },
        {
          vaccine: "Yellow fever",
          catalog_code: "child_yellow_fever",
          at_weeks: [39],
          evidence: "V",
        },
        {
          vaccine: "Meningitis vaccine",
          catalog_code: "child_men_a",
          at_weeks: [39],
          evidence: "NV",
          note: "product (MenAfriVac or MenFive) and routine age not verified",
        },
        {
          vaccine: "Measles 2",
          catalog_code: "child_measles",
          at_weeks: [65],
          evidence: "V",
          note: "whether this is now MR is not verified",
        },
        {
          vaccine: "R21 malaria",
          catalog_code: null,
          at_months: [5, 6, 7, 15],
          evidence: "SEC",
          per_state_rollout: true,
          note: "phased by state since 2 Dec 2024; availability is a per-state flag, never a national rule",
        },
        {
          vaccine: "HPV",
          catalog_code: "child_hpv_girls",
          age_years: {
            min: 9,
            max: 13,
          },
          dose_count: 2,
          dose_interval_weeks: 26,
          evidence: "V",
          note: "founder decision: two doses; secondary sources report single-dose policy since Oct 2023, the CMO confirms before signing",
        },
        {
          vaccine: "Td in pregnancy",
          catalog_code: null,
          in_pregnancy: true,
          min_doses: 2,
          never_vaccinated_course_doses: 5,
          evidence: "SEC",
          note: "from papers, not an NPHCDA table",
        },
      ],
      excluded: [
        {
          code: "typhoid",
          reason: "founder decision 2026-10-07: not in the schedule",
        },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S45-cmo-signoff-pack.md section B; founder decisions 2026-10-07",
  },
  {
    key: "records_request.letter",
    // Records request letter (docs/design/RRL.md). UNSIGNED PLACEHOLDER WORDING: written by an engineer, not by counsel, and nothing here has been
    // reviewed as legal text. It asks a facility for the person's own records and names the Nigeria Data Protection Act 2023 right of access only
    // because the person asked for that framing; it states no section number, no deadline as law and no penalty. Counsel replaces it by publishing
    // a higher version (OQ-RRL-1). The letter is printed or handed over by the person; the platform never sends it.
    value: {
      wording_status: "unsigned_placeholder_pending_counsel",
      title: "Request for a copy of my health records",
      greeting: "To the Medical Records Officer, {facility}",
      intro:
        "I am the person these records are about. I am asking for a copy of the health records you hold about me, and I am making this request under my right of access to my own personal data under the Nigeria Data Protection Act 2023.",
      identity_heading: "Details that identify me",
      identity_labels: { name: "Name", date_of_birth: "Date of birth", phone: "Phone" },
      fill_in: ["Hospital or patient number, if you know it:", "Address or email to send the records to:"],
      scope_heading: "What I am asking for",
      scopes: {
        discharge_summary: "My discharge summary or summaries",
        lab_results: "My laboratory results",
        imaging_report: "The written reports of my scans and X-rays",
        whole_record: "My whole record, as far as it can be given to me",
      },
      format: "Either a paper copy or an electronic copy will do. Please tell me if there is a form to fill in or a charge, and what you need from me to prove who I am.",
      timing: "I would be grateful for a reply as soon as you can, and I will follow up with you after {days} days. If you need more time or more information from me, please tell me.",
      closing: "Thank you for your help.",
      sign_off: "Yours faithfully,",
      footer: "Prepared at my request with TarragonHealth.",
      draft_notice: "Draft wording, not yet checked by a lawyer.",
    },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/RRL.md; spec 2.3 and 2.11 (records fill the Passport); wording pending counsel",
  },
  {
    key: "records_request.response_days",
    // How long after the person hands the letter over the app treats a request as overdue. A PLACEHOLDER pending counsel and not a statement of what
    // the law requires: the app only says "you asked on <date>, you hoped for a reply by <date>". It sets a reminder, never a legal claim.
    value: { days: 30, label: "placeholder_pending_counsel" },
    owner: "Founder and counsel",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/RRL.md; OQ-RRL-1",
  },
  {
    key: "fhir.mapping",
    // FHIR export mapping (S44, spec 2.10). Identifiers, not thresholds, but they decide what an outside system believes a value means, so they
    // are versioned data a human reviews, not code. The Nigeria Core and NPHCDA implementation guides are both still under development
    // (docs/plans/S41-S45-build-plan.md section 6): `profiles` is empty on purpose and no profile URL is claimed. Adding one is a new version.
    // A test fails if a vital's LOINC code here is not also an accepted import code for the same vital in `fhir_loinc_vital_type_mappings`,
    // so what we export can always be read back. Lab analyte LOINC codes are PROPOSED (the CMO or lab informatics confirms them); an analyte
    // with no entry is exported with Tarragon's own analyte code only, never a guessed LOINC.
    value: {
      ig_status: "nigeria_core_and_nphcda_under_development",
      base_url: "https://tarragonhealth.ng/fhir",
      profiles: {},
      systems: {
        loinc: "http://loinc.org",
        ucum: "http://unitsofmeasure.org",
        icd10: "http://hl7.org/fhir/sid/icd-10",
        snomed: "http://snomed.info/sct",
        observation_category: "http://terminology.hl7.org/CodeSystem/observation-category",
        interpretation: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
        condition_clinical: "http://terminology.hl7.org/CodeSystem/condition-clinical",
        condition_verification: "http://terminology.hl7.org/CodeSystem/condition-ver-status",
        patient_number: "https://tarragonhealth.ng/fhir/identifier/patient-number",
        lab_analyte: "https://tarragonhealth.ng/fhir/CodeSystem/lab-analyte",
        vaccine: "https://tarragonhealth.ng/fhir/CodeSystem/vaccine",
        document_type: "https://tarragonhealth.ng/fhir/CodeSystem/document-type",
        record_source: "https://tarragonhealth.ng/fhir/CodeSystem/record-source",
        data_quality: "https://tarragonhealth.ng/fhir/CodeSystem/data-quality",
      },
      vitals: {
        blood_pressure: { loinc: "85354-9", display: "Blood pressure panel", systolic: "8480-6", diastolic: "8462-4" },
        pulse: { loinc: "8867-4", display: "Heart rate" },
        glucose: { loinc: "15074-8", display: "Glucose [Moles/volume] in Blood" },
        weight: { loinc: "29463-7", display: "Body weight" },
        temperature: { loinc: "8310-5", display: "Body temperature" },
        spo2: { loinc: "59408-5", display: "Oxygen saturation in Arterial blood by Pulse oximetry" },
        waist_circumference: { loinc: "56086-2", display: "Waist Circumference at umbilicus by Tape measure" },
        respiratory_rate: { loinc: "9279-1", display: "Respiratory rate" },
        peak_flow: { loinc: "33452-4", display: "Peak expiratory flow rate" },
      },
      lab_analyte_loinc: {
        fasting_glucose: "1558-6",
        hba1c: "4548-4",
        creatinine: "2160-0",
        potassium: "2823-3",
        sodium: "2951-2",
        total_cholesterol: "2093-3",
        hdl_cholesterol: "2085-9",
        triglycerides: "2571-8",
        alt: "1742-6",
        ast: "1920-8",
        haemoglobin: "718-7",
        wbc: "6690-2",
        platelets: "777-3",
        tsh: "3016-3",
      },
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S45-build-plan.md section 6; spec 2.10; docs/research/S44.md",
  },
  {
    key: "fhir.ips_mapping",
    // International Patient Summary export (spec 2.10; docs/design/IPS.md). The IPS (ISO 27269, HL7 IPS) is under national adoption balloting in
    // Nigeria in 2026 and the Nigeria Core FHIR implementation guide is still a draft, so NO profile URL is claimed and nothing here says the
    // file conforms to the IPS or Nigeria Core IG: it is "IPS-shaped" (a document Bundle with the IPS section structure) and nothing more.
    // Section codes are LOINC document-section codes the IPS uses. A required IPS section with nothing to show is written with
    // emptyReason "unavailable" (not recorded here), never "nilknown": we must not tell a hospital a person has no known allergies.
    value: {
      ig_status: "ips_shaped_no_conformance_claimed",
      profiles: {},
      composition_type: { system: "http://loinc.org", code: "60591-5", display: "Patient summary Document" },
      title: "International Patient Summary",
      author_name: "Tarragon Health",
      composition_status: "preliminary",
      document_identifier_system: "https://tarragonhealth.ng/fhir/identifier/ips-document",
      empty_reason_system: "http://terminology.hl7.org/CodeSystem/list-empty-reason",
      empty_reason_code: "unavailable",
      // A section the database did not give this reader (a supporter without that category) is "withheld", never "unavailable": "nothing
      // recorded" and "not shared with you" must not read the same to a clinician.
      withheld_reason_code: "withheld",
      // A summary is short: the newest readings of each kind and the newest results of each test, not years of daily logs.
      vitals_per_type: 5,
      results_per_analyte: 3,
      sections: [
        { key: "problems", loinc: "11450-4", display: "Problem list - Reported", title: "Problems", required: true },
        { key: "allergies", loinc: "48765-2", display: "Allergies and adverse reactions Document", title: "Allergies and intolerances", required: true },
        { key: "medications", loinc: "10160-0", display: "History of Medication use Narrative", title: "Medicines", required: true },
        { key: "immunizations", loinc: "11369-6", display: "History of Immunization note", title: "Immunizations", required: false },
        { key: "results", loinc: "30954-2", display: "Relevant diagnostic tests/laboratory data Narrative", title: "Results", required: false },
        { key: "vital_signs", loinc: "8716-3", display: "Vital signs", title: "Vital signs", required: false },
      ],
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/IPS.md; spec 2.10; ISO 27269 (International Patient Summary)",
  },
  {
    key: "risk.who_cvd_2019",
    // WHO 2019 cardiovascular risk charts, Western sub-Saharan Africa (S45, function 3.2). Live value is the `config` of `risk_instrument_versions`
    // (code who_cvd_2019_wssa); a test fails if the migration seed and this value drift. NO COEFFICIENTS are loaded (the paper's appendix was not
    // obtained) so the instrument cannot score and cannot be signed. Bands and cut-offs come from docs/plans/S41-S45-cmo-signoff-pack.md.
    // OQ-S45-1 and OQ-S45-2 ask the CMO to confirm the region mapping for Nigeria and the band-to-action table.
    value: {
          "instrument": "who_cvd_2019_wssa",
          "regionLabel": "Western sub-Saharan Africa",
          "regionCheckedForNigeria": false,
          "coefficientsVerified": false,
          "ageRange": {
                "min": 40,
                "max": 74
          },
          "bands": [
                {
                      "code": "lt5",
                      "lowPct": 0,
                      "highPct": 5,
                      "tier": "low"
                },
                {
                      "code": "5to10",
                      "lowPct": 5,
                      "highPct": 10,
                      "tier": "low_moderate"
                },
                {
                      "code": "10to20",
                      "lowPct": 10,
                      "highPct": 20,
                      "tier": "moderate"
                },
                {
                      "code": "20to30",
                      "lowPct": 20,
                      "highPct": 30,
                      "tier": "high"
                },
                {
                      "code": "ge30",
                      "lowPct": 30,
                      "highPct": null,
                      "tier": "very_high"
                }
          ],
          "nonLabFurtherAssessmentAtOrAbovePct": 10,
          "treatmentAlreadyIndicated": {
                "systolicAtOrAbove": 160,
                "diastolicAtOrAbove": 100,
                "establishedCvd": true
          },
          "knownDiabetes": "route_to_diabetes_pathway",
          "models": {
                "lab": {
                      "male": null,
                      "female": null
                },
                "non_lab": {
                      "male": null,
                      "female": null
                }
          },
          "modelShape": "Each sex entry: { baselineSurvival: number, terms: [ { coef: number, factors: [ { var: age|sbp|smoker|diabetes|total_chol_mmol|bmi, center: number } ] } ] }. Risk = 1 - baselineSurvival ^ exp(sum of coef * product of (var - center)).",
          "reassess": {
                "afterDays": 365,
                "majorChanges": [
                      "new_chronic_condition",
                      "smoking_status_change",
                      "bp_at_or_above_160_100"
                ]
          }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S45-cmo-signoff-pack.md section A; docs/design/S45.md",
  },
  {
    key: "report.settings",
    // Yearly Tarragon Health Report settings (S46, function 3.15). Live value is the `config` of `health_report_config_versions` v1, UNSIGNED. Every
    // number is a placeholder for the CMO (OQ-S46-3); the BP target, margins and windows are not clinical decisions made by an agent. A test fails if
    // the migration seed and this value drift.
    value: {
          "maxPriorities": 3,
          "minBpReadings": 3,
          "bpTarget": {
                    "systolicBelow": 140,
                    "diastolicBelow": 90
          },
          "bpBorderlineMarginMmHg": 5,
          "labBorderlineMarginPct": 5,
          "changeTolerancePct": 3,
          "recheckWeeks": 4,
          "priorityWindows": {
                    "bp": "within 4 weeks",
                    "lab": "within 4 weeks",
                    "screening": "within 3 months",
                    "risk": "within 4 weeks"
          },
          "trendMinPoints": 2,
          "trendYears": 3,
          "statementKey": "report.statement.not_rule_out",
          "statementApprovedByCmo": false,
          "shareExcludedSections": [
                    "screening_reproductive",
                    "risk",
                    "questionnaires"
          ]
},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/research/health-report-study.md; docs/design/S46.md",
  },
  {
    key: "report.settings",
    // Yearly Tarragon Health Report settings (S46 function 3.15, updated by S47). Live value is the `config` of `health_report_config_versions` v2
    // (v1, the S46 placeholder with the 5 mmHg / 5 percent margins, is superseded and stays unsigned in the table), UNSIGNED. The chat selections of
    // 2026-10-07 are loaded here as values; they are not a signature (OQ-S46-3). Guideline-based: the BP targets, the high-normal band, the minimum
    // 12 readings over 3 days. Tarragon PRODUCT RULES, not guideline facts: maxPriorities, changeTolerancePct, recheckWeeks, priorityWindows,
    // trendMinPoints, trendYears (listed in `productRules`). There is no borderline margin. A test fails if the migration seed and this value drift.
    value: {
      "maxPriorities": 3,
      "minBpReadings": 12,
      "minBpDays": 3,
      "bpTarget": {
        "systolicBelow": 140,
        "diastolicBelow": 90
      },
      "bpTargetHigherRisk": {
        "systolicBelow": 130,
        "diastolicBelow": 80
      },
      "bpHighNormalBand": {
        "systolicFrom": 130,
        "systolicBelow": 140,
        "diastolicFrom": 80,
        "diastolicBelow": 90
      },
      "higherRiskCriteria": {
        "icd10Prefixes": {
          "diabetes": [
            "E10",
            "E11",
            "E12",
            "E13",
            "E14"
          ],
          "ckd": [
            "N18"
          ],
          "cvd": [
            "I20",
            "I21",
            "I22",
            "I23",
            "I24",
            "I25",
            "I50",
            "I63",
            "I64",
            "I65",
            "I66",
            "I69",
            "I70",
            "I73"
          ]
        },
        "namePatterns": {
          "diabetes": [
            "^(type [12] )?diabetes( mellitus)?( type [12])?$"
          ],
          "ckd": [
            "^(chronic kidney disease|ckd)( stage [1-5][ab]?)?$"
          ],
          "cvd": [
            "^(coronary (artery|heart) disease|ischaemic heart disease|ischemic heart disease|myocardial infarction|angina( pectoris)?|stroke|heart failure|peripheral arter(y|ial) disease)$"
          ]
        },
        "excludePatterns": [
          "pre.?diabet",
          "family history",
          "gestational",
          "history of family",
          "risk of",
          "heat.?stroke",
          "sunstroke",
          "suspected"
        ],
        "elevatedRiskTiers": [
          "high",
          "very_high"
        ]
      },
      "changeTolerancePct": 3,
      "recheckWeeks": 4,
      "priorityWindows": {
        "bp": "within 4 weeks",
        "lab": "within 4 weeks",
        "screening": "within 3 months",
        "risk": "within 4 weeks"
      },
      "trendMinPoints": 2,
      "trendYears": 3,
      "productRules": [
        "maxPriorities",
        "changeTolerancePct",
        "recheckWeeks",
        "priorityWindows",
        "trendMinPoints",
        "trendYears"
      ],
      "guidelineBasis": [
        "bpTarget",
        "bpTargetHigherRisk",
        "bpHighNormalBand",
        "minBpReadings",
        "minBpDays"
      ],
      "statementKey": "report.statement.not_rule_out",
      "statementApprovedByCmo": false,
      "shareExcludedSections": [
        "screening_reproductive",
        "risk",
        "questionnaires"
      ]
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md decisions 1 to 6; docs/research/health-report-study.md; docs/design/S46.md; docs/design/S47-decisions-applied.md",
  },
  {
    key: "report.settings",
    // v3 (S46d, 2026-10-20): v2 plus a suggested-recheck block. Live value is the `config` of `health_report_config_versions` v3, UNSIGNED. The weeks are placeholders
    // for the CMO (a laboratory value outside its range: 12 weeks; blood pressure above target: 4 weeks; a mid-year line at 6 months, shown only when something
    // was off), not clinical decisions made by an agent. A test fails if the migration seed and this value drift.
    value: {
      "maxPriorities": 3,
      "minBpReadings": 12,
      "minBpDays": 3,
      "bpTarget": {
        "systolicBelow": 140,
        "diastolicBelow": 90
      },
      "bpTargetHigherRisk": {
        "systolicBelow": 130,
        "diastolicBelow": 80
      },
      "bpHighNormalBand": {
        "systolicFrom": 130,
        "systolicBelow": 140,
        "diastolicFrom": 80,
        "diastolicBelow": 90
      },
      "higherRiskCriteria": {
        "icd10Prefixes": {
          "diabetes": [
            "E10",
            "E11",
            "E12",
            "E13",
            "E14"
          ],
          "ckd": [
            "N18"
          ],
          "cvd": [
            "I20",
            "I21",
            "I22",
            "I23",
            "I24",
            "I25",
            "I50",
            "I63",
            "I64",
            "I65",
            "I66",
            "I69",
            "I70",
            "I73"
          ]
        },
        "namePatterns": {
          "diabetes": [
            "^(type [12] )?diabetes( mellitus)?( type [12])?$"
          ],
          "ckd": [
            "^(chronic kidney disease|ckd)( stage [1-5][ab]?)?$"
          ],
          "cvd": [
            "^(coronary (artery|heart) disease|ischaemic heart disease|ischemic heart disease|myocardial infarction|angina( pectoris)?|stroke|heart failure|peripheral arter(y|ial) disease)$"
          ]
        },
        "excludePatterns": [
          "pre.?diabet",
          "family history",
          "gestational",
          "history of family",
          "risk of",
          "heat.?stroke",
          "sunstroke",
          "suspected"
        ],
        "elevatedRiskTiers": [
          "high",
          "very_high"
        ]
      },
      "changeTolerancePct": 3,
      "recheckWeeks": 4,
      "priorityWindows": {
        "bp": "within 4 weeks",
        "lab": "within 4 weeks",
        "screening": "within 3 months",
        "risk": "within 4 weeks"
      },
      "trendMinPoints": 2,
      "trendYears": 3,
      "productRules": [
        "maxPriorities",
        "changeTolerancePct",
        "recheckWeeks",
        "priorityWindows",
        "trendMinPoints",
        "trendYears",
        "retest"
      ],
      "guidelineBasis": [
        "bpTarget",
        "bpTargetHigherRisk",
        "bpHighNormalBand",
        "minBpReadings",
        "minBpDays"
      ],
      "statementKey": "report.statement.not_rule_out",
      "statementApprovedByCmo": false,
      "shareExcludedSections": [
        "screening_reproductive",
        "risk",
        "questionnaires"
      ],
      "retest": {
        "offValueWeeks": 12,
        "bpWeeks": 4,
        "byAnalyte": {},
        "midYearMonths": 6
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 3,
    effectiveFrom: "2026-10-20",
    source: "docs/design/S46d.md; docs/research/health-report-study.md",
  },
  {
    key: "screening.serology_rules",
    // Hepatitis and HIV repeat rules (S46, function 3.12; founder decision 2026-10-07, the spec rule wins). Live value is `serology_rule_versions` v2 (registry version 1 is this entry's own).
    // The anti-HBs threshold is PROPOSED and unconfirmed (OQ-S46-2). Version 1 (legacy once-ever) is documented in the migration header.
    value: {
          "hiv": {
                    "repeatMonths": 12,
                    "suppressWithinInterval": false
          },
          "hep_c": {
                    "repeatMonths": 12,
                    "suppressWithinInterval": true
          },
          "hep_b": {
                    "repeatMonths": 12,
                    "suppressWithinInterval": true,
                    "stopsWhenHbvStatus": [
                              "immune"
                    ],
                    "immunityTest": "anti_hbs"
          },
          "antiHbs": {
                    "thresholdMiuPerMl": 10,
                    "thresholdStatus": "proposed_unsigned"
          }
},
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S45-build-plan.md X2; docs/design/S46.md",
  },
  {
    key: "screening.serology_rules",
    // Hepatitis and HIV repeat rules, version 2 (S47): HIV and hepatitis C are RISK-BASED, offered yearly to people who qualify; hepatitis B stops on recorded immunity unless a new exposure is on record; the anti-HBs threshold (10 mIU/mL) is PROPOSED and unconfirmed and a numeric titre alone never sets immunity. Live value is `serology_rule_versions` v3 (active). The risk lists are unverified against the Nigeria 2023 HIV guideline (interval NOT read).
    value: {
      "hiv": {
        "repeatMonths": 12,
        "suppressWithinInterval": false,
        "riskBased": true
      },
      "hep_c": {
        "repeatMonths": 12,
        "suppressWithinInterval": true,
        "riskBased": true
      },
      "hep_b": {
        "repeatMonths": 12,
        "suppressWithinInterval": true,
        "stopsWhenHbvStatus": [
          "immune"
        ],
        "immunityTest": "anti_hbs",
        "reopensOnNewExposure": true
      },
      "antiHbs": {
        "thresholdMiuPerMl": 10,
        "thresholdStatus": "proposed_unconfirmed",
        "numericTitreAloneSetsImmunity": false
      },
      "riskCriteria": {
        "hcv": [
          "transfusion_or_transplant",
          "injecting_drug_use",
          "haemodialysis",
          "contact_with_infected_person",
          "healthcare_sharps_exposure",
          "liver_disease_or_raised_enzymes",
          "living_with_hiv",
          "tattoo_or_scarification",
          "men_who_have_sex_with_men",
          "sex_work",
          "prison_history"
        ],
        "hiv": [
          "ongoing_risk",
          "sexually_active_adult"
        ]
      },
      "riskCriteriaSource": {
        "hcv": "Nigeria FMOH 2016 hepatitis guideline risk list (read); WHO risk groups (search snippet only)",
        "hiv": "Product wording of 'ongoing risk or sexually active adult'. The Nigeria 2023 HIV guideline retest interval was NOT read.",
        "evidence": "unverified"
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 2,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md decisions 7 and 8; docs/design/S47-decisions-applied.md",
  },
  {
    key: "screening.cervical_hpv_dna",
    // Cervical screening by HPV DNA at ages 35 and 45 (S47 decision 13). Live value is the cervical_smear rule of `screening_rule_sets` v3 (UNSIGNED). Women living with HIV are flagged to the care team and not auto-scheduled by this rule. The HPV DNA sale stays behind hpv_dna_enabled. Milestone window and ages are unverified against the national cervical screening guideline text, which was not read.
    value: {
      "code": "cervical_smear",
      "method": "hpv_dna",
      "sex": "female",
      "ageFrom": 35,
      "ageTo": 49,
      "ageMilestones": [
        35,
        45
      ],
      "milestoneWindowYears": 5,
      "frequencyMonths": null,
      "oncePerLifetime": false,
      "isOptional": false,
      "autoSchedule": true,
      "excludeWhenHiv": true
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md decision 13; docs/design/S47-decisions-applied.md",
  },
  {
    key: "risk.band_actions",
    // What each cardiovascular risk band leads to (S47, chat selections, NOT a signature). Live value is the `bandActions` of risk_instrument_versions v2 (UNSIGNED; the WHO instrument itself stays OFF, coefficients missing). The app never prescribes (INV-02): the actions say review. Thresholds are NOT verified against WHO PEN / HEARTS.
    value: {
      "appPrescribes": false,
      "thresholdsStatus": "unverified_against_who_pen_hearts",
      "bands": {
        "lt5": {
          "copyKey": "risk.action.lt5",
          "lifestyleAdvice": true,
          "reassessMonths": 12
        },
        "5to10": {
          "copyKey": "risk.action.5to10",
          "lifestyleAdvice": true,
          "bpCheckEveryMonths": 6
        },
        "10to20": {
          "copyKey": "risk.action.10to20",
          "careTeamReviewWithinWeeks": 4,
          "recheckEveryMonths": 3,
          "doctorDecidesAboutMedicines": true
        },
        "20to30": {
          "copyKey": "risk.action.20to30",
          "doctorReviewWithinWeeks": 2,
          "recheckEveryMonths": 3
        },
        "ge30": {
          "copyKey": "risk.action.ge30",
          "doctorReviewWithinWeeks": 1
        }
      }
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md; docs/design/S47-decisions-applied.md",
  },
  {
    key: "handover.grace_days",
    // Hand-over at 18 (S47 decision 6): guardian view-only for a 90 day grace period, notices on days 1, 30, 60 and 85, and guardian access ENDS automatically at the end of the grace period unless the young person chose a guardian to keep. Live value is the active row of `handover_config` v1 (PROPOSED).
    value: {
      "grace_days": 90,
      "notice_days": [
        1,
        30,
        60,
        85
      ]
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md; docs/design/S47-decisions-applied.md",
  },
  {
    key: "privacy.retention",
    // Account deletion stance (S47): anonymise, keep the clinical record. Deletion stays admin-reviewed. The retention PERIOD is NOT decided and is deliberately null: the privacy summary says the clinical record is kept for a stated retention period without inventing a number. Wording is a placeholder pending counsel.
    value: {
      "stance": "anonymise_keep_clinical_record",
      "retentionPeriodYears": null,
      "retentionPeriodStatus": "unconfirmed",
      "statementKey": "privacy.retention.statement",
      "wordingStatus": "draft_pending_counsel",
      "deletionRequest": "admin_reviewed"
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/plans/S41-S46-cmo-decisions-2026-10-07.md; docs/design/S47-decisions-applied.md",
  },
  {
    key: "consent.required_for_care",
    // Consent matrix policy (S47, chat decision): required_for_care applies ONLY to vitals and documents. Reproductive health, mental health and device data are optional per use for the care purpose: asked when the person first uses the feature, withdrawable, and withdrawing stops that feature only. Live value is `consent_matrix_cells` after migration 20261008032719. Counsel wording stays a placeholder.
    value: {
      "requiredForCare": [
        "vitals",
        "documents"
      ],
      "optionalPerUse": [
        "reproductive",
        "mental_health",
        "device_data"
      ],
      "withdrawalStops": "that_feature_only"
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S47-decisions-applied.md",
  },
  {
    key: "emergency_card.defaults",
    // Emergency card defaults (S47, chat decision). ON: blood group and genotype, allergies, current medicines, emergency contacts (and the identity lines the card always carried). OFF until chosen: ongoing conditions or diagnoses, reproductive health, mental health. The live link, the printed page, the QR text and the phone's offline card agree; a hidden detail reads 'not shared'.
    value: {
      "on": [
        "blood",
        "allergies",
        "medications",
        "emergency_contact",
        "date_of_birth",
        "sex",
        "patient_number"
      ],
      "off": [
        "conditions",
        "reproductive",
        "mental_health"
      ],
      "hiddenReads": "not shared"
    },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S47-decisions-applied.md",
  },
  {
    key: "results.sensitive_code_patterns",
    // Every spelling of an HIV, hepatitis B or hepatitis C analyte code (S47 review fix, INV-04). Live value is `sensitive_result_code_patterns`. The list is data so a new variant is a row. anti_hbs (the immunity titre) is deliberately not on it.
    value: [
      {
        "pattern": "^hiv",
        "virus": "hiv"
      },
      {
        "pattern": "^(hbv|hbs|hbe|hbc|hbcore)",
        "virus": "hbv"
      },
      {
        "pattern": "^anti_?hb[ce]",
        "virus": "hbv"
      },
      {
        "pattern": "^(hep_?b|hepatitis_?b)",
        "virus": "hbv"
      },
      {
        "pattern": "^(hcv|anti_?hcv)",
        "virus": "hcv"
      },
      {
        "pattern": "^(hep_?c|hepatitis_?c)",
        "virus": "hcv"
      }
    ],
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-07",
    source: "docs/design/S47-decisions-applied.md",
  },
  {
    key: "consultations.post_checkin",
    // Post-consultation check-ins (PCC, founder decision: a fixed short check-in at 48 hours and 7 days, red flags escalate, no model).
    // Mirrored by post_consult_checkin_config version 1 (a drift test compares the two). Born INACTIVE and unsigned: the sweep schedules nothing
    // until the CMO signs it on the sign-off hub AND an admin switches the post_consult_checkins_enabled guard on. The wording and each
    // option's route are what the CMO signs. Quiet hours: the sender defers for a person's own quiet window; notification_window here only holds
    // the reminder inside 07:00 to 21:00 Africa/Lagos. The task exists whatever the time.
    value: {
      "offsets": [
        {
          "code": "h48",
          "after_minutes": 2880
        },
        {
          "code": "d7",
          "after_minutes": 10080
        }
      ],
      "encounter_types": [
        "video",
        "audio",
        "phone"
      ],
      "nudge_after_minutes": 1440,
      "max_nudges": 1,
      "expire_after_minutes": 2880,
      "skip_if_patient_wrote_within_minutes": 1440,
      "notification_window": {
        "start_hour": 7,
        "end_hour": 21
      },
      "concern_alert_level": "clinician_review",
      "free_text_max_chars": 500,
      "task_title": "A quick check-in after your visit",
      "task_description": "A few short questions so your care team knows how you are getting on.",
      "questions": [
        {
          "id": "feeling",
          "text": "How are you feeling since your visit?",
          "options": [
            {
              "code": "better",
              "label": "Better",
              "route": "ok"
            },
            {
              "code": "same",
              "label": "About the same",
              "route": "ok"
            },
            {
              "code": "worse",
              "label": "Worse",
              "route": "concern_alert",
              "alert_type": "symptom_escalation"
            }
          ]
        },
        {
          "id": "new_symptoms",
          "text": "Have you noticed any new or worsening symptoms?",
          "options": [
            {
              "code": "no",
              "label": "No",
              "route": "ok"
            },
            {
              "code": "yes",
              "label": "Yes",
              "route": "concern_alert",
              "alert_type": "symptom_escalation"
            }
          ]
        },
        {
          "id": "medicines",
          "text": "Are you taking your medicines as agreed with your care team?",
          "options": [
            {
              "code": "yes",
              "label": "Yes",
              "route": "ok"
            },
            {
              "code": "none_prescribed",
              "label": "I was not given any medicines",
              "route": "ok"
            },
            {
              "code": "some_missed",
              "label": "I have missed some doses",
              "route": "clinician_task"
            },
            {
              "code": "cannot_take",
              "label": "I cannot take them",
              "route": "concern_alert",
              "alert_type": "symptom_escalation"
            }
          ]
        },
        {
          "id": "unclear",
          "text": "Is anything from your visit unclear?",
          "options": [
            {
              "code": "no",
              "label": "No, it is all clear",
              "route": "ok"
            },
            {
              "code": "yes",
              "label": "Yes, I would like some help",
              "route": "clarify_task"
            }
          ]
        }
      ]
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/PCC.md; supabase/migrations/20261016183857_pcc_post_consult_checkins.sql",
  },
  {
    key: "biomarkers.grade_bands",
    // Tarragon's Good / Acceptable / Needs-attention bands for the patient results cards (/patient/biomarkers). The data lives in
    // ./biomarker-grade-bands.ts. PROPOSED: until the CMO publishes a confirmed version no patient sees a Tarragon grade and the cards
    // show only the laboratory's own flag. Bands are population-level adult starting points, not individual targets.
    value: BIOMARKER_GRADE_BANDS,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "Founder decision 2026-10-20; public guidance: NICE lipid and diabetes guidance, WHO glucose criteria, KDIGO eGFR staging. CMO to confirm every band.",
  },
  {
    key: "biomarkers.lifestyle_guide",
    // General "helps / go easy on" habits shown under a person's results on /patient/biomarkers. Identical for everyone, labelled as general
    // guidance on screen, never personalised and never generated. No health claim about a specific food or drink is made here. PROPOSED:
    // the CMO edits or approves the wording by publishing a new version.
    value: {
      items: [
        { kind: "do", title: "Plan alcohol-free days", detail: "Regular breaks from alcohol ease the load on your liver." },
        { kind: "do", title: "Eat leafy greens often", detail: "Spinach, kale, ugu and other dark leafy greens are a good everyday choice." },
        { kind: "do", title: "Keep moving", detail: "A brisk walk most days supports your heart, blood sugar and blood pressure." },
        { kind: "do", title: "Drink enough water", detail: "Staying hydrated helps your kidneys and keeps blood tests more reliable." },
        { kind: "limit", title: "Go easy on ultra-processed foods", detail: "Sweets, biscuits, chocolate and crisps." },
        { kind: "limit", title: "Go easy on sugary drinks and snacks", detail: "Soft drinks, sweetened juices and sugary tea or pap." },
      ],
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "Founder decision 2026-10-20; general public-health healthy-eating guidance. CMO to approve the wording.",
  },
  {
    key: "medicines.nafdac_number_format",
    // Reading a NAFDAC registration number off a medicine pack (typed, or read from a photo). `pattern` is the anchored regex
    // source of a canonical number: an optional letter (never I or O), one or two digits, a hyphen, three to six digits, an
    // optional letter. Public examples seen: A4-1234, 04-1234, B4-xxxx, A11-101363 (the Greenbook database prints a six-digit tail).
    // The pattern only decides whether text is SHAPED like a number; it is not a check that a number is real or a pack genuine.
    // `maxTextLength` bounds the text scanned from a photo; `nameMatchLimit` and `minNameLength` bound the known-medicine names offered
    // from it; `contextLookback` is how many characters before a number are checked for a batch, lot or date label. Mirrored by NAFDAC_NUMBER_CONFIG in packages/medicines; a test fails on drift.
    // PROPOSED: a pharmacist or the CMO to confirm against NAFDAC's Greenbook (see OQ-NAFDAC-SCAN-1).
    value: {
      pattern: "^[A-HJ-NP-Z]?[0-9]{1,2}-[0-9]{3,6}[A-HJ-NP-Z]?$",
      maxTextLength: 6000,
      nameMatchLimit: 3,
      minNameLength: 4,
      contextLookback: 16,
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/S53-pack-scan.md; NAFDAC Greenbook public examples",
  },
  {
    key: "lab_value.duplicate_match",
    // DUP-1: when the same lab value reaches a record by two routes (a partner lab's structured result and a filed paper report), a pair is a
    // DUPLICATE when the code matches, the dates are within window_days, the unit is the same and the values are within value_tolerance_pct of
    // each other. Same test and window but a different value or unit is a DISAGREEMENT: both are shown and a clinician is told, none is picked.
    // Live values are the active row of `lab_value_match_config`; this entry mirrors it and a test fails if the migration seed and this value drift.
    // PROPOSED: the CMO or the lab liaison confirms the window and the tolerance.
    value: { window_days: 2, value_tolerance_pct: 0.5, require_same_unit: true },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/DUP-1.md",
  },
  {
    key: "observations.plausibility",
    // S47a (BUILD-SPEC-v5 4.3, 4.7): the typo gate for every hand-typed number. Hard limits refuse with a plain message; soft limits (water, sleep,
    // inhaler puffs) only ask the person to confirm. Mirrored in the database CHECK for the lifestyle types and the inhaler log; a test fails on drift.
    // PROPOSED: the Chief Medical Officer confirms the lifestyle-type limits (OQ-S47A-1).
    value: OBSERVATION_LIMITS_V1,
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-09-30",
    source: "docs/BUILD-SPEC-v5.md Module 4 (4.3, 4.7); docs/research/S46-S50-competitor-gap-and-build-plan.md S47a",
  },
  {
    key: "observations.target_bands",
    // S47a (BUILD-SPEC-v5 4.6): the shaded band on the glucose and weight trend charts. Glucose is the usual time-in-range band that
    // apps/web/src/lib/vitals/time-in-range.ts already uses (DEFAULT_TIR_LOW / DEFAULT_TIR_HIGH; a test fails if they drift). Weight is the WHO healthy BMI
    // band, turned into kilograms at the person's own height. A care-team target for the person replaces the standard band.
    // PROPOSED: the Chief Medical Officer confirms (OQ-S47A-4).
    value: {
      glucose_mmol_l: { low: 3.9, high: 10.0 },
      healthy_bmi: { low: 18.5, high: 24.9 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-09-30",
    source: "apps/web/src/lib/vitals/time-in-range.ts; WHO BMI bands (apps/web/src/lib/obesity/classify.ts bmiCategory)",
  },
  {
    key: "nutrition.daily_targets",
    // Daily nutrition targets and the word-summary lines (S49a, v5 6.5 and 6.7). Live value is `nutrition_target_config`.config, seeded INACTIVE and
    // unsigned; the CMO signs it through sign_nutrition_target_config. Maintenance estimates only (Mifflin-St Jeor); `floor_kcal` are the SAFE MINIMUMS and
    // the plan never shows a calorie target below them. WHO anchors: salt under 5 g (2000 mg sodium), free sugars under 10 percent of energy.
    // Targets are never shown for pregnancy, the postnatal year, a clinician hold, a positive eating-disorder screen or anyone under 18 (database gate).
    // packages/shared/src/nutrition/targets.test.ts fails if this drifts from the migration seed.
    value: {
      min_age_years: 18,
      energy: {
        activity_factors: { low: 1.2, light: 1.375, moderate: 1.55, high: 1.725 },
        default_activity: "light",
        floor_kcal: { female: 1200, male: 1500 },
        ceiling_kcal: 3500,
        round_to_kcal: 10,
      },
      macros_pct_of_energy: { carbs: 50, protein: 20, fat: 30 },
      salt_sugar_fibre: { sodium_mg_max: 2000, sugar_pct_of_energy_max: 10, fibre_g_per_1000_kcal: 14 },
      meal_summary: { light_below_kcal: 400, heavy_above_kcal: 750, salty_above_sodium_mg: 800, sugary_above_sugar_g: 25 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-20",
    source: "docs/design/S49a.md; supabase/migrations/20261020181309_s49a_food_logging_foundation.sql",
  },
  {
    key: "triage.single_reading_vitals_bands",
    // The combined registry of single-reading dangerous vitals bands (pulse, SpO2, temperature) and the typo gates around them. These are the starting
    // values of the DRAFT rule set `vitals_care_triage` v1, taken over unchanged from the live older classifiers (private.classify_pulse_level,
    // classify_spo2_level, classify_temperature_level, read 2026-10-16) so that the shadow divergence report compares like with like. Four places hold
    // these numbers and a drift test (packages/clinical/src/vitals-drift.test.ts) fails when any two disagree: this entry, the rule set params in
    // packages/clinical/src/rules/vitals-care-v1.ts (which the migration seeds), the phone's `vitals.device_red_rules`, and the older SQL classifiers.
    // The CMO signs the RULE SET; this entry is how a reviewer sees the numbers, with their owner and version, in one place.
    // Pulse and the others use "at or below" / "at or above" (inclusive) and "below" (exclusive) exactly as the rule set reads them.
    // amberReviewDueMinutes is the due time of the amber review task (72 hours, the older amber alert's review time); minAdultAgeYears is the age under which
    // a fast heart rate (101 to 149) is routed to a clinician instead of paged.
    value: {
      validation: { pulseMin: 10, pulseMax: 300, spo2Min: 30, spo2Max: 100, temperatureMin: 20, temperatureMax: 46 },
      minAdultAgeYears: 18,
      amberReviewDueMinutes: 4320,
      pulse: { emergencyAtOrBelow: 35, emergencyAtOrAbove: 150, redAtOrBelow: 39, redAtOrAbove: 121, amberAtOrBelow: 49, amberAtOrAbove: 101 },
      spo2: { emergencyBelow: 90, redAtOrBelow: 92, amberAtOrBelow: 94 },
      temperature: { emergencyAtOrAbove: 40, emergencyBelow: 35, redAtOrAbove: 39, amberAtOrAbove: 38 },
    },
    owner: "CMO",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/build-vitals-rule-sets.md; triage_rule_sets vitals_care_triage version 1 (draft)",
  },
  {
    key: "assisted_entry.limits",
    // A helper (family member or other caregiver) entering readings for the person: how many per helper per person per hour and per helper per
    // day. PROPOSED, Founder owned, no clinical meaning. Live value is the active row of `assisted_entry_config`.rules.
    value: { max_per_helper_per_person_per_hour: 6, max_per_helper_per_day: 30 },
    owner: "Founder",
    status: "proposed",
    version: 1,
    effectiveFrom: "2026-10-16",
    source: "docs/design/build-assisted-entry.md; supabase/migrations/*_assisted_entry_and_caregiver_red_care.sql",
  },
];

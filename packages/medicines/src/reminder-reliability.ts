/**
 * Reminder reliability (item 4): the numbers, the self-test and what to tell a person whose phone may stop reminders.
 *
 * Pure and offline. The values mirror the PROPOSED config `medicines.reminder_reliability` (a test fails on drift). Nothing here
 * carries wording that names a medicine: the notification text is a keyed generic string (INV-07).
 */
export interface ReminderReliabilityConfig {
  /** One gentle follow-up this long after a dose time with no answer. */
  unconfirmedFollowUpMinutes: number;
  /** The cap per dose. */
  maxUnconfirmedFollowUpsPerDose: number;
  selfTestDelaySeconds: number;
  selfTestAnswerWindowSeconds: number;
  selfTestStaleDays: number;
  /** iOS keeps at most this many pending local notifications. */
  iosPendingLimit: number;
  iosTimeSensitive: boolean;
}

export const REMINDER_RELIABILITY_CONFIG: ReminderReliabilityConfig = {
  unconfirmedFollowUpMinutes: 30,
  maxUnconfirmedFollowUpsPerDose: 1,
  selfTestDelaySeconds: 60,
  selfTestAnswerWindowSeconds: 120,
  selfTestStaleDays: 30,
  iosPendingLimit: 64,
  iosTimeSensitive: true,
};

// ---- Self-test: schedule a notification about a minute away, then ask "did you see it?" ----

export type SelfTestAnswer = "saw" | "not_seen";

export interface SelfTestRecord {
  startedAtMs: number;
  dueAtMs: number;
  answer: SelfTestAnswer | null;
  answeredAtMs: number | null;
}

export function startSelfTest(nowMs: number, cfg: ReminderReliabilityConfig = REMINDER_RELIABILITY_CONFIG): SelfTestRecord {
  return { startedAtMs: nowMs, dueAtMs: nowMs + cfg.selfTestDelaySeconds * 1000, answer: null, answeredAtMs: null };
}

/** "wait": not due yet or too soon to ask. "ask": show "did you see it?". "done": already answered. */
export function selfTestStep(rec: SelfTestRecord, nowMs: number, cfg: ReminderReliabilityConfig = REMINDER_RELIABILITY_CONFIG): "wait" | "ask" | "done" {
  if (rec.answer !== null) return "done";
  return nowMs >= rec.dueAtMs + cfg.selfTestAnswerWindowSeconds * 1000 ? "ask" : "wait";
}

export function answerSelfTest(rec: SelfTestRecord, answer: SelfTestAnswer, nowMs: number): SelfTestRecord {
  return { ...rec, answer, answeredAtMs: nowMs };
}

/** What the screen says about the last test. "working" needs no action; "needs_help" shows the steps; "retest" asks for a new test. */
export function selfTestOutcome(
  rec: SelfTestRecord | null,
  nowMs: number,
  cfg: ReminderReliabilityConfig = REMINDER_RELIABILITY_CONFIG,
): "never_tested" | "pending" | "working" | "needs_help" | "retest" {
  if (rec === null) return "never_tested";
  if (rec.answer === null) return "pending";
  const answeredAt = rec.answeredAtMs ?? rec.startedAtMs;
  if (nowMs - answeredAt > cfg.selfTestStaleDays * 86_400_000) return "retest";
  return rec.answer === "saw" ? "working" : "needs_help";
}

/** Reads what was kept on the phone. Anything malformed is "no record", which asks for a new test rather than guessing. */
export function parseSelfTest(raw: string | null): SelfTestRecord | null {
  if (raw === null) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const startedAtMs = o["startedAtMs"];
  const dueAtMs = o["dueAtMs"];
  const answer = o["answer"];
  const answeredAtMs = o["answeredAtMs"];
  if (typeof startedAtMs !== "number" || !Number.isFinite(startedAtMs)) return null;
  if (typeof dueAtMs !== "number" || !Number.isFinite(dueAtMs)) return null;
  if (answer !== null && answer !== "saw" && answer !== "not_seen") return null;
  if (answeredAtMs !== null && (typeof answeredAtMs !== "number" || !Number.isFinite(answeredAtMs))) return null;
  return { startedAtMs, dueAtMs, answer, answeredAtMs };
}

// ---- Notification permission, calmly (Android and iPhone) ----

export type PermissionState = "allowed" | "provisional" | "undetermined" | "denied_can_ask" | "denied_settings";

/** iOS authorization status numbers as expo-notifications reports them: 0 not determined, 1 denied, 2 authorized, 3 provisional, 4 ephemeral. */
export function permissionState(input: { granted: boolean; canAskAgain: boolean; iosStatus?: number | null }): PermissionState {
  if (input.iosStatus === 3) return "provisional";
  if (input.granted) return "allowed";
  if (input.iosStatus === 0) return "undetermined";
  return input.canAskAgain ? "denied_can_ask" : "denied_settings";
}

export type PermissionGuidance =
  | { action: "none" }
  | { action: "ask"; messageKey: "reliability.permission.ask" }
  | { action: "open_settings"; messageKey: "reliability.permission.denied" | "reliability.permission.provisional" };

/** Provisional (iPhone) delivers quietly to Notification Center only: no banner, no sound. A dose reminder may be missed, so it gets the same Settings guidance as denied. */
export function permissionGuidance(state: PermissionState): PermissionGuidance {
  switch (state) {
    case "allowed":
      return { action: "none" };
    case "undetermined":
    case "denied_can_ask":
      return { action: "ask", messageKey: "reliability.permission.ask" };
    case "provisional":
      return { action: "open_settings", messageKey: "reliability.permission.provisional" };
    case "denied_settings":
      return { action: "open_settings", messageKey: "reliability.permission.denied" };
  }
}

/** iPhone keeps at most `iosPendingLimit` pending local notifications, shared with every other reminder the app holds, so dose reminders stay `reserve` under it. Android is not capped by the system the same way. */
export function cappedPending(maxPending: number, isIos: boolean, cfg: Pick<ReminderReliabilityConfig, "iosPendingLimit"> = REMINDER_RELIABILITY_CONFIG, reserve = 8): number {
  return isIos ? Math.min(maxPending, cfg.iosPendingLimit - reserve) : maxPending;
}

import { addDays, lagosLocalDate, lagosTimeToUtcMs, DAY_MS, MINUTE_MS } from "./lagos";
import { slotsBetween, slotKey } from "./schedule";
import type { ScheduleSpec } from "./types";

/**
 * Which local notifications a phone should hold for doses, and how to bring the
 * phone's pending list in line with that plan.
 *
 * Rules (docs/research/S08.md sections 3 and 5):
 * - The Today list is the source of truth. A notification is a convenience, so
 *   nothing here assumes one was delivered.
 * - iOS keeps at most 64 pending local notifications, so only the earliest
 *   `maxPending` future ones inside `horizonDays` are planned, and the app plans
 *   again on launch, on foreground, after any dose is logged or edited, on a
 *   timezone or clock change, and in the background task.
 * - Doses of different medicines due at the same minute share one notification,
 *   which also spends fewer of the 64.
 * - This module carries no wording. The notification text is a keyed generic
 *   string with no medicine, dose or condition (INV-07).
 */
export const DOSE_NOTIFICATION_PREFIX = "dose|";

export interface ReminderMedicine {
  id: string;
  active: boolean;
  spec: ScheduleSpec;
}

export type NotificationKind = "due" | "follow_up";

export interface PlannedNotification {
  /** Stable id: the same dose minute always gets the same id, so planning twice never duplicates. */
  id: string;
  fireAtMs: number;
  /** "follow_up" is the single gentle second reminder in the middle of a flexible window. */
  kind: NotificationKind;
  /** The slots this notification covers, as `${medicationId}|${date}|${time}`. Carried in the payload, never in the text. */
  slotKeys: string[];
}

export interface PlanConfig {
  maxPending: number;
  horizonDays: number;
  /** A flexible window at least this long (minutes) gets one follow-up at its middle. */
  followUpMinWindowMinutes: number;
}

export function planDoseNotifications(
  medicines: readonly ReminderMedicine[],
  closedSlots: ReadonlySet<string>,
  nowMs: number,
  cfg: PlanConfig,
): PlannedNotification[] {
  const today = lagosLocalDate(nowMs);
  const last = addDays(today, cfg.horizonDays);
  const horizonMs = nowMs + cfg.horizonDays * DAY_MS;
  const byFire = new Map<number, { keys: string[]; kind: NotificationKind }>();
  const add = (fireAt: number, key: string, kind: NotificationKind) => {
    const existing = byFire.get(fireAt);
    if (!existing) byFire.set(fireAt, { keys: [key], kind });
    else {
      existing.keys.push(key);
      // A dose that is due at this instant outranks a follow-up for another.
      if (kind === "due") existing.kind = "due";
    }
  };

  for (const med of medicines) {
    if (!med.active) continue;
    const windowMinutes = med.spec.windowMinutes ?? 0;
    for (const slot of slotsBetween(med.spec, today, last)) {
      const key = slotKey(med.id, slot);
      if (closedSlots.has(key)) continue;
      const start = lagosTimeToUtcMs(slot.date, slot.time);
      if (start > nowMs && start <= horizonMs) add(start, key, "due");
      if (windowMinutes >= cfg.followUpMinWindowMinutes) {
        const middle = start + Math.floor(windowMinutes / 2) * MINUTE_MS;
        if (middle > nowMs && middle <= horizonMs) add(middle, key, "follow_up");
      }
    }
  }

  return [...byFire.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, cfg.maxPending)
    .map(([fireAtMs, v]) => ({ id: `${DOSE_NOTIFICATION_PREFIX}${fireAtMs}`, fireAtMs, kind: v.kind, slotKeys: v.keys.sort() }));
}

export interface NotificationDiff {
  toSchedule: PlannedNotification[];
  /** Pending dose notifications that are no longer wanted (logged, stopped, edited away). */
  toCancel: string[];
}

/** Compare the plan with the ids the phone currently holds. Ids outside the dose prefix are never touched. */
export function diffNotifications(planned: readonly PlannedNotification[], pendingIds: readonly string[]): NotificationDiff {
  const have = new Set(pendingIds);
  const want = new Set(planned.map((p) => p.id));
  return {
    toSchedule: planned.filter((p) => !have.has(p.id)),
    toCancel: pendingIds.filter((id) => id.startsWith(DOSE_NOTIFICATION_PREFIX) && !want.has(id)),
  };
}

export type ReminderIssue =
  | "notifications_off"
  | "exact_alarms_off"
  | "nothing_scheduled"
  | "plan_out_of_date"
  | "maker_may_stop_reminders";

export interface ReminderHealthInput {
  notificationsAllowed: boolean;
  /** Android 12+ exact-alarm permission. Null where it does not apply (iOS, older Android). */
  exactAlarmsAllowed: boolean | null;
  /** Dose notifications the plan wants right now, and how many the phone actually holds. */
  plannedCount: number;
  pendingCount: number;
  /** When the plan was last rebuilt, UTC ms, or null if never. */
  lastPlannedAtMs: number | null;
  nowMs: number;
  /** Phone maker, lower case, from the device (for example "tecno"), or null. */
  manufacturer: string | null;
  /** Rebuild older than this is stale. */
  stalePlanHours: number;
}

/** Makers whose phones are known to stop apps and their alarms in the background (docs/research/S08.md section 3). */
export const AGGRESSIVE_BACKGROUND_MAKERS: readonly string[] = [
  "tecno",
  "infinix",
  "itel",
  "transsion",
  "samsung",
  "xiaomi",
  "oppo",
  "realme",
  "vivo",
  "oneplus",
  "huawei",
  "honor",
];

/**
 * The reasons reminders on this phone may be unreliable, in the order to fix
 * them. An empty list means nothing is known to be wrong, not that delivery is
 * guaranteed: the Today list still shows every dose. The phone-maker note is added
 * only alongside evidence that reminders are not being kept.
 */
export function reminderIssues(input: ReminderHealthInput): ReminderIssue[] {
  const out: ReminderIssue[] = [];
  if (!input.notificationsAllowed) out.push("notifications_off");
  if (input.exactAlarmsAllowed === false) out.push("exact_alarms_off");
  if (input.notificationsAllowed && input.plannedCount > 0 && input.pendingCount === 0) out.push("nothing_scheduled");
  const stale =
    input.lastPlannedAtMs === null || input.nowMs - input.lastPlannedAtMs > input.stalePlanHours * 60 * 60 * 1000;
  if (stale && input.plannedCount > 0) out.push("plan_out_of_date");
  // A maker known to stop background apps is only worth warning about when something shows it
  // happening (nothing scheduled, or a plan that has not been rebuilt). Otherwise the card would
  // sit on most Android phones forever and the warnings that matter would be ignored.
  const maker = input.manufacturer?.toLowerCase() ?? "";
  const lookingStopped = out.includes("nothing_scheduled") || out.includes("plan_out_of_date");
  if (lookingStopped && AGGRESSIVE_BACKGROUND_MAKERS.some((m) => maker.includes(m))) out.push("maker_may_stop_reminders");
  return out;
}

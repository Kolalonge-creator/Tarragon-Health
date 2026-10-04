import { REMINDER_ID_PREFIX, type PlannedNotification, type ReminderKind } from "./reminder-plan";

/**
 * Applies a plan to the phone's scheduled notifications (S07 reminders). It
 * only talks to a small interface, so the rules are tested without the real
 * notification library; reminder-notifications.ts supplies the real one.
 *
 * Rules:
 * - Only identifiers this feature owns (REMINDER_ID_PREFIX) are ever cancelled.
 *   Nothing else scheduled on the phone is touched.
 * - It is a diff, not a rebuild: notifications that are already right are left
 *   alone, so running it on every launch, foreground and background task is cheap
 *   and safe, and it never makes a gap.
 * - Stale ones are cancelled first, then missing ones scheduled, so the phone's
 *   own limit (64 pending on iOS) is never exceeded in between.
 * - One failed schedule never stops the rest. The result says how many failed
 *   and the next run tries again.
 * - It asks for notification permission only when told it may (the patient has
 *   just switched something on) and only when there is something to schedule.
 * - `preserve` names kinds that must NOT be cancelled this time, for when the
 *   plan for that kind could not be worked out (for example the medicine list was
 *   unreadable): losing every dose reminder because of a failed read is worse
 *   than leaving the old ones.
 * - Never throws.
 */
export type PermissionState = "granted" | "denied" | "undetermined";

export interface NotificationsPort {
  getPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  ensureChannel(): Promise<void>;
  listScheduledIds(): Promise<string[]>;
  cancel(identifier: string): Promise<void>;
  schedule(n: PlannedNotification): Promise<void>;
}

export interface ApplyOptions {
  askPermission: boolean;
  preserve?: readonly ReminderKind[];
}

export type SyncStatus = "synced" | "nothing_to_do" | "no_permission" | "failed";

export interface SyncResult {
  status: SyncStatus;
  permission: PermissionState;
  scheduled: number;
  cancelled: number;
  kept: number;
  failed: number;
}

function kindOf(identifier: string): ReminderKind {
  return identifier.startsWith(`${REMINDER_ID_PREFIX}dose:`) ? "dose" : "bp";
}

export async function applyPlan(
  port: NotificationsPort,
  plan: readonly PlannedNotification[],
  options: ApplyOptions,
): Promise<SyncResult> {
  const result: SyncResult = { status: "synced", permission: "undetermined", scheduled: 0, cancelled: 0, kept: 0, failed: 0 };
  try {
    const existing = (await port.listScheduledIds()).filter((id) => id.startsWith(REMINDER_ID_PREFIX));
    if (plan.length === 0 && existing.length === 0) return { ...result, status: "nothing_to_do" };

    result.permission = await port.getPermission();
    if (result.permission !== "granted" && options.askPermission && plan.length > 0) {
      result.permission = await port.requestPermission();
    }
    if (result.permission !== "granted") return { ...result, status: "no_permission" };

    const wanted = new Set(plan.map((p) => p.identifier));
    const preserved = new Set(options.preserve ?? []);

    for (const id of existing) {
      if (wanted.has(id) || preserved.has(kindOf(id))) continue;
      try {
        await port.cancel(id);
        result.cancelled += 1;
      } catch {
        result.failed += 1;
      }
    }

    await port.ensureChannel().catch(() => {});
    const have = new Set(existing);
    for (const n of plan) {
      if (have.has(n.identifier)) {
        result.kept += 1;
        continue;
      }
      try {
        await port.schedule(n);
        result.scheduled += 1;
      } catch {
        result.failed += 1;
      }
    }
    if (result.failed > 0) result.status = "failed";
    return result;
  } catch {
    return { ...result, status: "failed" };
  }
}

/** Cancels everything this feature scheduled, for sign-out. Never throws. */
export async function cancelAllReminders(port: Pick<NotificationsPort, "listScheduledIds" | "cancel">): Promise<number> {
  let cancelled = 0;
  try {
    for (const id of await port.listScheduledIds()) {
      if (!id.startsWith(REMINDER_ID_PREFIX)) continue;
      try {
        await port.cancel(id);
        cancelled += 1;
      } catch {
        // keep going
      }
    }
  } catch {
    // nothing to cancel
  }
  return cancelled;
}

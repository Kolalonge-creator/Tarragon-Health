import { REMINDER_ID_PREFIX, type PlannedNotification } from "./reminder-plan";

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
 *   just switched something on), only when there is something to schedule, and only
 *   when she has never been asked. After a refusal it never asks again (that is for
 *   the phone's settings), so a screen cannot keep prompting.
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
    if (result.permission === "undetermined" && options.askPermission && plan.length > 0) {
      result.permission = await port.requestPermission();
    }
    if (result.permission !== "granted") return { ...result, status: "no_permission" };

    const wanted = new Set(plan.map((p) => p.identifier));

    for (const id of existing) {
      if (wanted.has(id)) continue;
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

/**
 * Runs jobs one at a time, in the order they were asked for. Reminder syncs can be
 * requested together (the app coming to the foreground, an edit on the Reminders
 * screen, the Medications screen, the background task), and two running at once
 * can apply an older plan after a newer one and bring back a reminder the patient
 * just switched off. Each job builds its plan when its turn comes, so it sees the
 * latest settings. A job that throws does not stop the ones behind it.
 */
export function createSerialQueue(): { run<T>(job: () => Promise<T>): Promise<T> } {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run<T>(job: () => Promise<T>): Promise<T> {
      const result = tail.then(job, job);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}

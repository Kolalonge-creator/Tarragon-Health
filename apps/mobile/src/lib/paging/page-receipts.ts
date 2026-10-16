import AsyncStorage from "@react-native-async-storage/async-storage";
import { recordNotificationDisplayed, type Result } from "./page-api";

/**
 * The delivered receipt for a page push (S19c decision 9, S19e). When a page notification reaches this phone it is reported
 * to the database (`record_notification_displayed`), which sets the page's delivered time. That stops the early advance to the
 * backup (90 s on a confirmed route, 180 s otherwise) and is the evidence that lets a mobile-only clinician pass the on-call
 * test-page gate.
 *
 * A receipt must not be lost to a flaky connection, so a failed report is kept (bounded, 24 hours) and retried when the app is
 * next active, and by the background task. A receipt the server refuses (not a page for this person) is dropped, not retried.
 * The server is idempotent per page, clinician and channel, so a repeat is harmless.
 *
 * Client-reported, like the web console's: it shows the route works, not proof against someone bypassing their own check.
 */
const KEY = "tarragon.paging.pending-receipts";
const MAX_PENDING = 20;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingReceipt {
  readonly notificationId: string;
  readonly at: number;
}

export interface ReceiptDeps {
  readonly send: (notificationId: string) => Promise<Result<boolean>>;
  readonly load: () => Promise<PendingReceipt[]>;
  readonly save: (pending: PendingReceipt[]) => Promise<void>;
  readonly now: () => number;
}

export const realDeps: ReceiptDeps = {
  send: (id) => recordNotificationDisplayed(id),
  load: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((p): p is PendingReceipt => typeof p?.notificationId === "string" && typeof p?.at === "number");
    } catch {
      return [];
    }
  },
  save: (pending) => AsyncStorage.setItem(KEY, JSON.stringify(pending)),
  now: () => Date.now(),
};

/** A server answer that a retry cannot change (the session is gone or the row is not ours) versus one that might work later. */
function isTransient(message: string): boolean {
  return !/not authori[sz]ed|42501|jwt|unknown page/i.test(message);
}

/** Reports one receipt now; keeps it for a retry when the call fails for a reason that can pass. Returns what happened. */
export async function reportPageReceipt(notificationId: string, deps: ReceiptDeps = realDeps): Promise<"sent" | "kept" | "dropped"> {
  const r = await deps.send(notificationId);
  if (r.ok) return "sent";
  if (!isTransient(r.error)) return "dropped";
  const pending = await deps.load();
  if (!pending.some((p) => p.notificationId === notificationId)) {
    pending.push({ notificationId, at: deps.now() });
  }
  try {
    await deps.save(pending.slice(-MAX_PENDING));
  } catch {
    // storage full: the receipt is lost, but the page still follows its normal timers
    return "dropped";
  }
  return "kept";
}

/** Retries what is kept. Entries older than 24 hours are dropped; a transient failure leaves the rest for next time. */
export async function flushPageReceipts(deps: ReceiptDeps = realDeps): Promise<{ sent: number; left: number }> {
  const pending = await deps.load();
  if (pending.length === 0) return { sent: 0, left: 0 };
  const keep: PendingReceipt[] = [];
  let sent = 0;
  for (const p of pending) {
    if (deps.now() - p.at > MAX_AGE_MS) continue;
    const r = await deps.send(p.notificationId);
    if (r.ok) sent += 1;
    else if (isTransient(r.error)) keep.push(p);
  }
  try {
    await deps.save(keep);
  } catch {
    // leaving the old list is safe: a repeat receipt is idempotent
  }
  return { sent, left: keep.length };
}

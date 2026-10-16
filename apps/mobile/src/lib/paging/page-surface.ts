import type { ActivePage, Result } from "./page-api";
import { startPageRepeats, stopPageRepeats, type AlarmPort } from "./page-alarm";
import { readPagePush } from "./page-push";
import { reportPageReceipt, type ReceiptDeps } from "./page-receipts";

/**
 * The decisions of the on-call page route (S19e): when a pushed page is reported, when the repeats ring and stop. Everything here
 * takes its dependencies, so it is tested without a phone. The native glue is in page-native.ts.
 */

export interface SurfaceDeps {
  readonly alarm: AlarmPort;
  readonly pages: () => Promise<Result<{ pages: ActivePage[]; dropped: number }>>;
  readonly receipts: ReceiptDeps | undefined;
}

/** Any page not yet acknowledged by anyone needs the alarm to keep going. A row that could not be read counts as unacknowledged. */
export function needsAlarm(pages: readonly ActivePage[], dropped = 0): boolean {
  return dropped > 0 || pages.some((p) => !p.acknowledged);
}

export interface SyncOptions {
  /** A page push just arrived on this phone: if the pages cannot be read, ring anyway. A poll or a screen open must not (an offline blip is not a page). */
  readonly assumePage: boolean;
}

/**
 * Starts or stops the repeats to match the pages the database shows. When the pages cannot be read: after a page push the repeats
 * are started (a missed real page is the worse mistake); otherwise they are left exactly as they are, so a connection blip neither
 * rings a phone with nothing waiting nor silences one that is ringing for a real page.
 */
export async function syncAlarm(deps: Pick<SurfaceDeps, "alarm" | "pages">, opts: SyncOptions = { assumePage: false }): Promise<"ringing" | "stopped" | "ringing_unverified" | "unchanged"> {
  const r = await deps.pages();
  if (!r.ok) {
    if (!opts.assumePage) return "unchanged";
    await startPageRepeats(deps.alarm, true);
    return "ringing_unverified";
  }
  if (needsAlarm(r.data.pages, r.data.dropped)) {
    await startPageRepeats(deps.alarm, opts.assumePage);
    return "ringing";
  }
  await stopPageRepeats(deps.alarm);
  return "stopped";
}

/**
 * A notification payload arrived (foreground, tap, background task or tray scan). If it is a page push: report the receipt first
 * (the thing the ladder waits for), then align the alarm. Anything else is ignored without touching the network.
 */
export async function handlePagePayload(payload: unknown, deps: SurfaceDeps, mode: "arrival" | "seen" | "receipt_only" = "arrival"): Promise<"ignored" | "handled"> {
  const push = readPagePush(payload);
  if (!push) return "ignored";
  await reportPageReceipt(push.notificationId, deps.receipts);
  // A test page proves the route and must never ring an alarm. "seen" is a tap, a replayed last tap or a tray scan: an old push says
  // nothing new about whether a page is waiting, so only the database's own answer may start or stop the alarm.
  if (mode === "receipt_only" || push.isTest) return "handled";
  await syncAlarm(deps, { assumePage: mode === "arrival" });
  return "handled";
}

/**
 * Pushes already sitting in the notification tray were shown to this clinician even if the app was not running to say so. Report
 * them (idempotent on the server). Covers a phone that showed the push while the app was closed.
 */
export async function recoverPresentedPages(presented: readonly unknown[], deps: SurfaceDeps): Promise<number> {
  let handled = 0;
  for (const n of presented) {
    if ((await handlePagePayload(n, deps, "receipt_only")) === "handled") handled += 1;
  }
  // one alignment for the whole tray, not one per notification; a push already in the tray is an old one, so the screen's read decides
  if (handled > 0) await syncAlarm(deps, { assumePage: false });
  return handled;
}


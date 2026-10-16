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

/** Any page not yet acknowledged by anyone needs the alarm to keep going. */
export function needsAlarm(pages: readonly ActivePage[]): boolean {
  return pages.some((p) => !p.acknowledged);
}

/**
 * Starts or stops the repeats to match the pages the database shows. When the pages cannot be read (offline) the repeats are
 * started: an alarm that rings a few extra times for a test page is a nuisance, a missed real page is not. Returns what it chose.
 */
export async function syncAlarm(deps: Pick<SurfaceDeps, "alarm" | "pages">): Promise<"ringing" | "stopped" | "ringing_unverified"> {
  const r = await deps.pages();
  if (!r.ok) {
    await startPageRepeats(deps.alarm);
    return "ringing_unverified";
  }
  if (needsAlarm(r.data.pages)) {
    await startPageRepeats(deps.alarm);
    return "ringing";
  }
  await stopPageRepeats(deps.alarm);
  return "stopped";
}

/**
 * A notification payload arrived (foreground, tap, background task or tray scan). If it is a page push: report the receipt first
 * (the thing the ladder waits for), then align the alarm. Anything else is ignored without touching the network.
 */
export async function handlePagePayload(payload: unknown, deps: SurfaceDeps): Promise<"ignored" | "handled"> {
  const push = readPagePush(payload);
  if (!push) return "ignored";
  await reportPageReceipt(push.notificationId, deps.receipts);
  await syncAlarm(deps);
  return "handled";
}

/**
 * Pushes already sitting in the notification tray were shown to this clinician even if the app was not running to say so. Report
 * them (idempotent on the server). Covers a phone that showed the push while the app was closed.
 */
export async function recoverPresentedPages(presented: readonly unknown[], deps: SurfaceDeps): Promise<number> {
  let handled = 0;
  for (const n of presented) {
    if ((await handlePagePayload(n, deps)) === "handled") handled += 1;
  }
  return handled;
}


import * as Sentry from "@sentry/nextjs";

/**
 * One read on an institution dashboard, kept apart from "nothing to show".
 *
 * Every loader behind the HMO and corporate dashboards throws when a read
 * fails. Settling each one here means a single failed read takes out its own
 * card, not the whole page, and the card can say so. `ok: false` is never the
 * same thing as an empty result (`ok: true, value: null`), which the loaders
 * return for "no enrolled people yet" or "below the small-group floor".
 */
export type Loaded<T> = { ok: true; value: T } | { ok: false };

export async function settleLoad<T>(label: string, run: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (err) {
    Sentry.captureException(err, { extra: { institutionLoad: label } });
    return { ok: false };
  }
}

/** The value of a settled read, or null when it failed. Pair with `failed` so the null is never read as "empty". */
export function loadedValue<T>(result: Loaded<T>): T | null {
  return result.ok ? result.value : null;
}

export function failed<T>(result: Loaded<T>): boolean {
  return !result.ok;
}

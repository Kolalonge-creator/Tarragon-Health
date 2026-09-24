import * as Sentry from "@sentry/nextjs";

/**
 * Runs best-effort, post-insert work (a red-flag assessment, a bookkeeping
 * refresh) without letting a genuine network/DB failure escape as an
 * uncaught exception. Several helpers across the codebase are documented
 * "never throws" but don't enforce that internally (assessBpControlBestEffort,
 * assessHeartRateBestEffort, assessGlucoseBestEffort — confirmed by reading
 * each), so every call site needs a wrapper like this one. First introduced
 * to stop those three exceptions from propagating out of four separate call
 * sites (apps/web/src/lib/wearables/ingest.ts and three /api/mobile|
 * integrations device-reading routes) and taking down more than the one
 * reading they were for — a same-shaped try/catch was hand-duplicated at
 * each site before this was extracted. A fifth, pre-existing call site
 * (`logVital`, apps/web/src/app/(dashboard)/patient/actions.ts) has its own
 * separate fix on another branch and does not use this helper — see that
 * branch's docs/OFFLINE_RESILIENCE_AUDIT.md §7.1 for the original finding
 * this generalises (not present on every branch; check before assuming it
 * exists here).
 *
 * Returns whether the work failed, rather than swallowing that fact,
 * because a caller doing SAFETY-critical work (as opposed to genuinely
 * inert bookkeeping) must be able to surface it — CLAUDE.md: "never
 * deprioritise or silently swallow an abnormal screening result event."
 * Sentry alone is not sufficient for that class of caller; a caller doing
 * inert bookkeeping may simply ignore the returned boolean, which still
 * gets a Sentry report either way.
 */
export async function runBestEffort(run: () => Promise<void>, extra: Record<string, unknown>): Promise<boolean> {
  try {
    await run();
    return false;
  } catch (err) {
    Sentry.captureException(err, { extra });
    return true;
  }
}

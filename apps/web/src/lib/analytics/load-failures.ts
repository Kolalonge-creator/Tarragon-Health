import { refreshQueryState } from "@/lib/queries/list-query-state";

/**
 * Which analytics figures on screen failed to load, worked out apart from
 * React so the rules can be tested without a QueryClient.
 *
 * Why this exists. Most analytics dashboards read their figures as
 * `data?.x ?? 0`, so a query that failed (a dropped connection, an RPC error,
 * or, since lib/analytics/answer.ts, a refused caller) renders as a row of
 * believable zeros. Fixing that tile by tile means editing every dashboard;
 * these pages all share one layout, so the layout says it once instead.
 *
 * It reuses the platform's existing vocabulary rather than adding a new one:
 * `refreshQueryState` already separates "never loaded" (loud, red) from "the
 * last refresh failed but the figures on screen are real" (softer, amber), and
 * this applies it to every query a page currently has mounted.
 */

/** The slice of a TanStack Query `Query` this needs. */
export interface QueryLike {
  queryKey: readonly unknown[];
  state: { status: string; data: unknown };
  getObserversCount(): number;
}

export type AnalyticsLoadState = "failed" | "stale" | "none";

/**
 * Pages that already say, in their own words and about their own figures, when
 * something did not load: the Overview (lib/analytics/overview-summary.ts, a
 * hint in each tile) and the Investor page (refreshQueryState with its own
 * LoadFailure and StaleDataNotice). A second, generic alert above them would
 * only say the same thing twice. That holds only while each page mounts just
 * the queries it reports on; self-reporting-pages.test.ts pins that, so a third
 * query added to either page fails a test instead of going unreported.
 */
export const SELF_REPORTING_PATHS: readonly string[] = ["/analytics", "/analytics/investor"];

export function pageReportsItsOwnFailures(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path = pathname.replace(/\/+$/, "") || "/";
  return SELF_REPORTING_PATHS.includes(path);
}

/**
 * A query that is in an error state on a page that is showing it. Queries that
 * failed on some other page and are only still in the cache do not count: they
 * have no observer, so nothing on the current page is waiting on them.
 */
export function isFailedAnalyticsQuery(q: QueryLike): boolean {
  return q.queryKey[0] === "analytics" && q.state.status === "error" && q.getObserversCount() > 0;
}

/**
 * The worst thing wrong with the figures on this page. "failed" means at least
 * one has nothing to show; "stale" means every failure still has the last good
 * figures on screen; "none" means nothing has failed.
 */
export function worstAnalyticsLoadState(queries: readonly QueryLike[]): AnalyticsLoadState {
  let worst: AnalyticsLoadState = "none";
  for (const q of queries) {
    if (!isFailedAnalyticsQuery(q)) continue;
    const state = refreshQueryState({
      isLoading: q.state.status === "pending",
      isError: true,
      hasData: q.state.data !== undefined,
    });
    if (state === "failed") return "failed";
    if (state === "stale") worst = "stale";
  }
  return worst;
}

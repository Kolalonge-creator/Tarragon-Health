import { statTileValue, type StatTileValueProps } from "@/components/ui/stat-tile-value";
import { refreshQueryState, type RefreshQueryState } from "@/lib/queries/list-query-state";

/**
 * The part of a TanStack Query result a dashboard summary needs, and the one
 * rule for a figure that has no data: it is unknown, and unknown is never
 * shown as 0, as an empty list or as "you're caught up".
 *
 * Several dashboards used to read `data?.x ?? 0`, so a query that was still
 * loading or had failed rendered as a quiet day. This is the shared vocabulary
 * a dashboard's pure summary module builds on, so the wording and the
 * loading / failed / stale split stay the same everywhere. It is kept free of
 * React so the summary modules can be unit-tested without a QueryClient.
 */
export interface QuerySlice<T> {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
}

export const LOADING_HINT = "Loading…";
export const NOT_LOADED_HINT = "Could not be loaded";

/**
 * loading: first read in flight. failed: the first read failed, nothing to
 * show. stale: a later refresh failed, the last good data is still there.
 * ready: read and current. A read that returned nothing (data `null` or `[]`)
 * still counts as having data.
 */
export function sliceState<T>(q: QuerySlice<T>): RefreshQueryState {
  return refreshQueryState({
    isLoading: q.isLoading,
    isError: q.isError,
    hasData: q.data !== undefined,
  });
}

/** What to show in place of a figure that has no data: loading, or could not load. */
export function unknownHint<T>(q: QuerySlice<T>): string {
  return q.isError ? NOT_LOADED_HINT : LOADING_HINT;
}

/** A stat tile for a figure: the read value, or the unknown hint. Never 0. */
export function sliceTile<T>(
  q: QuerySlice<T>,
  read: (data: T) => string | number | null
): StatTileValueProps {
  if (q.data !== undefined) return statTileValue(read(q.data), "Not recorded");
  return statTileValue(null, unknownHint(q));
}

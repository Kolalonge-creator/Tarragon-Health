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

/**
 * The fields of a TanStack `useQuery` result that `fromQueryResult` reads.
 */
export interface QueryResultLike<T> {
  data: T | undefined;
  isPending: boolean;
  isError: boolean;
}

/**
 * A `useQuery` result as a slice. `isPending` becomes `isLoading` on purpose:
 * TanStack's own `isLoading` is only true while a fetch is in flight, so a
 * first read that is paused (the browser is offline) has no data, is not
 * loading and has not failed, and a summary would call it "ready". `isPending`
 * is true for any query that has no data yet and has not errored, which is the
 * state "still waiting for the first answer".
 */
export function fromQueryResult<T>(q: QueryResultLike<T>): QuerySlice<T> {
  return { data: q.data, isLoading: q.isPending, isError: q.isError };
}

export const LOADING_HINT = "Loading…";
export const NOT_LOADED_HINT = "Could not be loaded";
export const NOT_RECORDED_HINT = "Not recorded";

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

/**
 * A stat tile for a figure: the read value, or the unknown hint. Never 0.
 * `whenNull` is what to say when the data was read but has no value for this
 * figure, as opposed to the data not having been read at all.
 */
export function sliceTile<T>(
  q: QuerySlice<T>,
  read: (data: T) => string | number | null,
  whenNull: string = NOT_RECORDED_HINT
): StatTileValueProps {
  if (q.data !== undefined) return statTileValue(read(q.data), whenNull);
  return statTileValue(null, unknownHint(q));
}

/** The same rule for a plain text row: the read value, `whenNull`, or the unknown hint. */
export function sliceText<T>(
  q: QuerySlice<T>,
  read: (data: T) => string | null,
  whenNull: string = NOT_RECORDED_HINT
): string {
  if (q.data !== undefined) return read(q.data) ?? whenNull;
  return unknownHint(q);
}

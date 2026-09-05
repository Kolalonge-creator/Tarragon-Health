/**
 * The four things a list query can be, kept apart from each other.
 *
 * Several patient-facing lists used to collapse all four into one branch
 * (`if (isLoading || isError || !data || data.length === 0) return null`),
 * which meant a failed read looked exactly like having nothing: a pending lab
 * request, a medicine order waiting to be paid for, an insurance claim, or
 * the list of people who currently hold access to the patient's record simply
 * vanished off the page with no explanation. The access one is the worst of
 * them, because you cannot take back access you cannot see.
 *
 * `error` is checked first: a query that failed is a failed query whatever
 * else is also true of it.
 */
export type ListQueryState = "loading" | "error" | "empty" | "ready";

export function listQueryState({
  isLoading,
  isError,
  count,
}: {
  isLoading: boolean;
  isError: boolean;
  /** Usually `data?.length`. Undefined/null is treated as nothing to show. */
  count: number | null | undefined;
}): ListQueryState {
  if (isError) return "error";
  if (isLoading) return "loading";
  if (count === null || count === undefined || count === 0) return "empty";
  return "ready";
}

/**
 * The same idea again, for a query that keeps refetching in the background.
 *
 * React Query retains the last successful `data` when a refetch fails and
 * flips `status` to "error", so a component branching on `isError` alone
 * throws away a screen's worth of known-good figures because one 60-second
 * poll timed out. That is its own kind of dishonesty: the numbers were true a
 * minute ago, and replacing them with a red block tells the reader less than
 * keeping them and saying when they were last confirmed.
 *
 * "failed" is the first-load failure and must stay loud. "stale" is the
 * softer, third state: show the data, mark it as possibly out of date.
 */
export type RefreshQueryState = "loading" | "failed" | "stale" | "ready";

export function refreshQueryState({
  isLoading,
  isError,
  hasData,
}: {
  isLoading: boolean;
  isError: boolean;
  /** `data !== undefined`. A successful read that returned nothing still counts. */
  hasData: boolean;
}): RefreshQueryState {
  if (isError) return hasData ? "stale" : "failed";
  if (isLoading) return "loading";
  return "ready";
}

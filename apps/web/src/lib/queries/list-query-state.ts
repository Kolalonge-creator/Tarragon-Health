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

/**
 * The server-rendered counterpart to listQueryState (./list-query-state.ts).
 *
 * A Server Component has no isLoading and no retained previous data: a
 * PostgREST call either came back or it didn't. What it does have is the same
 * failure mode, in a shape that is even easier to write by accident, because
 * the error is a property you simply don't destructure:
 *
 *     const { data } = await supabase.from("safeguarding_concerns").select();
 *     const rows = data ?? [];            // a failed read is now "no rows"
 *
 * There is no lint rule that catches that, and the result renders as an empty
 * worklist, a zero counter, or "Nothing waiting" — the false all-clear the
 * AI governance console named first: "a blank page reads as 'nothing to worry
 * about', which is the one wrong message it could send."
 *
 * `error` is checked before `count`, for the same reason listQueryState does:
 * a zero that came out of a failed query is an artefact of the failure, not a
 * fact about the organisation.
 */
export type ServerQueryState = "error" | "empty" | "ready";

export function serverQueryState({
  error,
  count,
}: {
  /** The `error` half of a Supabase result. Anything non-null means failure. */
  error: unknown;
  /** Usually `data?.length`, or a `count: "exact"` head query's count. */
  count: number | null | undefined;
}): ServerQueryState {
  if (error !== null && error !== undefined) return "error";
  if (count === null || count === undefined || count === 0) return "empty";
  return "ready";
}

/**
 * Did any of a page's parallel reads fail?
 *
 * Most of these boards fan out with `Promise.all` over six, ten, even a dozen
 * queries and then render one composed picture. If any single one of them
 * failed, every derived figure on the page is understated by an unknown
 * amount, so the honest unit is the page, not the individual tile.
 */
export function anyQueryFailed(results: readonly { error: unknown }[]): boolean {
  return results.some((r) => r.error !== null && r.error !== undefined);
}

/**
 * Which of them failed, by name, so the copy can say what is missing rather
 * than only that something is.
 */
export function failedQueryLabels(
  results: readonly { label: string; error: unknown }[]
): string[] {
  return results.filter((r) => r.error !== null && r.error !== undefined).map((r) => r.label);
}

/**
 * "escalations", "escalations and outreach", "escalations, outreach and
 * consults" — an English list for the sentence above, since a bare
 * comma-joined string reads like a machine dump in the middle of a paragraph.
 */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

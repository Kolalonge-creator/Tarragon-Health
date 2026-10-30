/**
 * What an analytics RPC's answer means, decided before it is parsed.
 *
 * Every analytics RPC is a SECURITY DEFINER function that answers a caller who
 * is not an analyst with an EMPTY answer rather than an error. For the RPCs
 * that return an object, that answer is exactly `{}`; every Zod schema in
 * ./schemas fills `{}` with zeros, so a refused call used to parse as a
 * perfectly healthy "nothing yet" and every dashboard showed it as real zeros.
 *
 * This is safe to reject because of how the two shapes differ, measured against
 * the live database on 2026-10-30 (all 32 object-returning RPCs, called as a
 * patient and as the analyst): a refused caller always got `{}`, and an
 * authorised caller always got an object with at least two keys, because each
 * is built with jsonb_build_object. The contract is pinned by
 * packages/db/tests/analytics_object_rpcs_refuse_with_empty_object.sql, so if
 * an RPC is ever changed to refuse in some other shape, that proof fails
 * instead of this guard going quietly blind.
 *
 * What it deliberately does NOT do: an array answer is passed through. About
 * seventeen RPCs return an array, and for them a refusal (`[]`) is identical
 * to a legitimately empty result (for example no finance inputs saved yet), so
 * nothing on the client can tell them apart. `analytics_audit_log` refuses with
 * the page shell `{ total: 0, rows: [] }`, which is likewise
 * indistinguishable from an empty audit window. The complete fix for those is
 * for the RPC to raise on refusal, which is a database change across the
 * console's functions and not something a client check can stand in for.
 */

export class AnalyticsRefusedError extends Error {
  constructor() {
    super(
      "The analytics service answered with an empty object, which it only does when it refuses a caller."
    );
    this.name = "AnalyticsRefusedError";
  }
}

/** A plain object with no keys: the answer a refused caller receives. */
export function isRefusedAnswer(data: unknown): boolean {
  return (
    typeof data === "object" &&
    data !== null &&
    !Array.isArray(data) &&
    Object.keys(data).length === 0
  );
}

/**
 * Parse an RPC answer, but never let a refusal through as zeros. A refusal
 * throws, so react-query reports it as an error (data stays undefined) instead
 * of caching a believable-looking set of zeros. Schema failures still throw
 * their own error unchanged.
 */
export function parseAnalyticsAnswer<T>(schema: { parse(data: unknown): T }, data: unknown): T {
  if (isRefusedAnswer(data)) throw new AnalyticsRefusedError();
  return schema.parse(data);
}

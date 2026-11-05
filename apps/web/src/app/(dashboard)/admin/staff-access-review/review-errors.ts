/**
 * What the review screen may say about a refused database call. The review functions raise plain sentences on purpose
 * (SQLSTATE P0001, or 42501 for "only an admin"); anything else is a raw database message and is replaced.
 */
export function safeReviewError(error: { message: string; code?: string }): string {
  if ((error.code === "P0001" || error.code === "42501") && error.message) return error.message;
  console.error("staff access review: unexpected database error", error.code ?? "no code", error.message);
  return "Something went wrong. Please try again.";
}

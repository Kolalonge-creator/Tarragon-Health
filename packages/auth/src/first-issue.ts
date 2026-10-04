import type { ZodError } from "zod";

/**
 * The first validation failure, plus which field caused it.
 *
 * Every server action here already did `parsed.error.issues[0]?.message`, but
 * threw the issue's `path` away — so the form could print a message and had
 * no idea which control to mark `aria-invalid`. Keeping the field name lets
 * the form point exactly one control at the error instead of marking all of
 * them (or, as before, none).
 *
 * `field` is the first path segment, which is what a form control is named
 * after; a nested or array path (none of the auth schemas have one today)
 * degrades to its top-level field rather than to nothing.
 */
export function firstIssue(
  error: ZodError,
  fallback: string
): { error: string; field?: string } {
  const issue = error.issues[0];
  if (!issue) return { error: fallback };
  const segment = issue.path[0];
  const field = typeof segment === "string" && segment.length > 0 ? segment : undefined;
  return { error: issue.message || fallback, ...(field ? { field } : {}) };
}

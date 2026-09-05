/**
 * Input handling for the unauthenticated "is my company covered?" checker
 * (eligibility-actions.ts). Kept in its own module rather than inline in the
 * action because a "use server" file may only export async functions, and
 * these two are worth unit-testing directly: they are the whole defence
 * between an anonymous form field and a service-role read of
 * public.organisations.
 */

/**
 * Turns a caller's typed company name into a literal search term.
 *
 * PostgREST's `ilike` filter passes the value straight into ILIKE and
 * additionally rewrites `*` into `%`, so `%`, `_`, `*` and `\` are operators
 * here, not text. Interpolated raw — as this checker did until 20260905 — a
 * company of `%%` matched EVERY active partner organisation, and the action
 * echoed the first one's real name back to an anonymous caller: a partner
 * directory, from two keystrokes.
 *
 * They are removed rather than backslash-escaped deliberately. No real
 * organisation name contains one, and removing them does not depend on
 * PostgREST's escape-character semantics being what we assume they are.
 */
export function toSearchTerm(raw: string): string {
  return raw.replace(/[%_*\\]/g, "").trim();
}

/**
 * At least four characters and at least three letters, counted AFTER
 * sanitising — enough that the term names something rather than trawling the
 * table. The old two-character floor was checked before sanitising, so `%%`
 * passed it.
 */
export function isSpecificEnough(term: string): boolean {
  return term.length >= 4 && (term.match(/\p{L}/gu)?.length ?? 0) >= 3;
}

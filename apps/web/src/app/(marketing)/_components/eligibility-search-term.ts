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
 * At least two characters and at least two letters, counted AFTER sanitising.
 *
 * The security fix here is the word AFTER: the original floor was two
 * characters checked on the RAW input, so `%%` cleared it and then matched
 * every active partner organisation. Counting the sanitised term closes that
 * without changing what a real person may type.
 *
 * The floor is deliberately back at two characters rather than the four this
 * check briefly used. Nigerian employers and HMOs really are three letters
 * long — GTB, UBA, AXA — and a four-character minimum did not make them
 * "less specific", it made them uncheckable: the form silently filed them as
 * a lead and told the caller their employer was not a partner. The letter
 * count is what carries the anti-trawling intent (`%%`, `12`, `**` all still
 * fail); the real defence against enumeration is that the response never
 * echoes the matched organisation's own name and that the action is rate
 * limited per IP and per phone number.
 */
export function isSpecificEnough(term: string): boolean {
  return term.length >= 2 && (term.match(/\p{L}/gu)?.length ?? 0) >= 2;
}

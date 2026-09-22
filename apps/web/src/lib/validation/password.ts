/**
 * The single source of truth for what a password has to be here.
 *
 * It lives in its own dependency-free module rather than in auth.ts so a
 * client form can show the rule before submit without pulling the whole
 * schema module (and its zod graph) into the bundle, and so the rule text
 * shown to the user, the Zod message, and the server-side message can never
 * drift apart. The provider's own wording ("Password should be at least 6
 * characters" — GoTrue's default minimum) used to leak through to users and
 * contradicted this number outright; see lib/auth/auth-error-message.ts.
 */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Minimal complexity requirement (2026-09-18 security audit — length alone
 * was the entire rule, which is thin next to an enterprise-grade baseline
 * like Epic MyChart or a well-funded fintech, both of which require a mix of
 * character classes). Deliberately kept to "a letter and a number" rather
 * than a heavier upper/lower/symbol mandate: NIST SP 800-63B and most current
 * guidance favour length + a breached-password check over composition rules,
 * which push users toward predictable substitutions (`Password1!`) without
 * meaningfully raising entropy. A real breached-password check (Supabase's
 * HIBP integration, "leaked password protection") is a project-level Auth
 * dashboard setting, not something this repo's migrations or code can
 * enable — flagged separately, not built here.
 *
 * Applied to NEW passwords only (signup, reset) — see auth.ts's
 * emailLoginSchema, which intentionally keeps only the length check so an
 * existing account's current password is never retroactively rejected by a
 * rule introduced after it was set.
 */
export const PASSWORD_COMPLEXITY_REGEX = /^(?=.*[A-Za-z])(?=.*\d).*$/;

/** Shown under a password field, before anything is submitted. */
export const PASSWORD_RULE_HINT = `At least ${PASSWORD_MIN_LENGTH} characters, including a letter and a number.`;

/** Shown when a password is rejected for being too short. */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;

/** Shown when a password is rejected for lacking a letter or a number. */
export const PASSWORD_TOO_WEAK_MESSAGE = "Password must include at least one letter and one number";

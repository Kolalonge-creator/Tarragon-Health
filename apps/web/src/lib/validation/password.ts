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

/** Shown under a password field, before anything is submitted. */
export const PASSWORD_RULE_HINT = `At least ${PASSWORD_MIN_LENGTH} characters.`;

/** Shown when a password is rejected for being too short. */
export const PASSWORD_TOO_SHORT_MESSAGE = `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;

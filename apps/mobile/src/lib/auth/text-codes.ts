/**
 * Whether the platform can send a texted one-time code. Mirrors apps/web/src/lib/auth/text-codes.ts: no SMS provider is live, so
 * the text-code routes (sign up, sign in and recover by phone) are hidden and email is the identity check. Set
 * EXPO_PUBLIC_TEXT_CODES_ENABLED=true at bundle time to bring them back once the Send SMS hook has a live provider.
 */
export const TEXT_CODES_ENABLED = process.env.EXPO_PUBLIC_TEXT_CODES_ENABLED === "true";

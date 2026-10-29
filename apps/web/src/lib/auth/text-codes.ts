/**
 * Whether the platform can send a texted one-time code. It cannot today: no SMS provider has ever been live (sms_delivery_log is empty,
 * the Termii sender ID is an unsubmitted draft and covers Nigeria only; paid SMS was ruled out, founder decision 2026-10-29). Until a
 * provider is connected the text-code routes (sign up, sign in and recover by phone, change the sign-in number) are hidden so nobody
 * is asked to wait for a code that will never arrive. Email is the identity check. Set NEXT_PUBLIC_TEXT_CODES_ENABLED=true to bring
 * them back once the Send SMS hook has a live provider.
 */
export const TEXT_CODES_ENABLED = process.env.NEXT_PUBLIC_TEXT_CODES_ENABLED === "true";

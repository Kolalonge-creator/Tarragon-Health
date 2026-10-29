/**
 * One-time code shapes. The two channels are NOT the same length on this project:
 *   - email codes are 8 digits (Authentication > Sign In / Providers > Email OTP length; confirmed live, see guest-checkout.ts),
 *   - SMS codes are 6 digits (supabase/config.toml [auth.sms] otp_length, and the Send SMS hook).
 * Email accepts exactly 6 or exactly 8 digits so that changing that dashboard setting either way never locks a person out (no setting sends 7); the code itself is still checked by Auth,
 * so a wrong-length code is simply refused there. Never hard-code a single length for an email code again without checking that setting.
 */
export const EMAIL_OTP_MAX_LENGTH = 8;
export const EMAIL_OTP_PATTERN = /^(\d{6}|\d{8})$/;
export const PHONE_OTP_PATTERN = /^\d{6}$/;

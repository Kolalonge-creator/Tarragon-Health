import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Applies the signup-time metadata `signUp()`/actions.ts carries on
 * `raw_user_meta_data` (phone/state/account_purpose/ref_code) to the new
 * profile, now that a session exists to act under RLS. Shared by every path
 * that can be the first place a freshly-signed-up user gets a session:
 * `/auth/callback` (email-confirmation link) and signup/actions.ts's own
 * redirect when confirmations are disabled and `signUp()` returns a session
 * immediately. Both must apply the same backfill — a user who never touches
 * `/auth/callback` still needs their phone/state/referral code honored.
 */
export async function backfillSignupMetadata(
  supabase: SupabaseClient<Database>,
  user: Pick<User, "id" | "user_metadata">
): Promise<void> {
  // Backfill profiles.phone from signup metadata (auth.users.phone is only
  // auto-populated for phone-identity signups — see the note in
  // apps/web/src/app/signup/actions.ts).
  const metadataPhone = user.user_metadata?.phone;
  const metadataState = user.user_metadata?.state;
  const backfill: { phone?: string; state?: string; receives_care?: boolean } = {};
  if (typeof metadataPhone === "string" && metadataPhone.length > 0) {
    backfill.phone = metadataPhone;
  }
  // Optional state chosen at signup (non-gating) — pre-fills profiles.state.
  if (typeof metadataState === "string" && metadataState.length > 0) {
    backfill.state = metadataState;
  }
  // Someone who arrived to pay for a relative's care, not to be treated. Only
  // ever narrows what we ask of them; becoming a patient later re-imposes
  // every consent, enforced by enforce_care_purpose_switch.
  if (user.user_metadata?.account_purpose === "support") {
    backfill.receives_care = false;
  }
  if (Object.keys(backfill).length > 0) {
    await supabase.from("profiles").update(backfill).eq("id", user.id);
  }

  // Auto-redeem a referral code carried from a shareable ?ref=CODE signup
  // link, now that a session exists (redeem_referral_code reads auth.uid()).
  // redeem_referral_code enforces its own rules (self-referral, 30-day
  // window, one code per account) and returns { ok:false, error } rather
  // than throwing for those — either way this must never block sign-in, so
  // failures are silently ignored here.
  const metadataRefCode = user.user_metadata?.ref_code;
  if (typeof metadataRefCode === "string" && metadataRefCode.length > 0) {
    await supabase.rpc("redeem_referral_code", { p_code: metadataRefCode });
  }
}

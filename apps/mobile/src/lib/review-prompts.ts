import * as StoreReview from "expo-store-review";
import { supabase } from "@/lib/supabase";

/**
 * Reputation & Review-Generation Engine (private.enqueue_reputation_review_prompt
 * on the DB side). Claims the oldest queued native-app-store review prompt
 * for the signed-in patient, if any, and invokes the native review API.
 *
 * "Shown" is the honest limit of what's measurable here: the OS decides
 * whether the prompt actually displays (Apple/Google both cap how often it
 * shows per user per year, opaque to the caller) and never reports back
 * whether a review was left — this function's job ends at asking, not at
 * confirming. No custom pre-prompt UI: Apple's guidelines disfavor gating
 * the native review request behind an app-authored "are you enjoying this?"
 * screen, so this calls requestReview() directly once a prompt is claimed.
 *
 * Same best-effort, never-blocks-the-app discipline as registerPushToken/
 * flushPendingVitals/syncThresholdsIfOnline in App.tsx's session-start
 * effect, which this is meant to sit alongside.
 */
export async function checkForPendingReviewPrompt(): Promise<void> {
  try {
    // Checked BEFORE claiming: the RPC marks the prompt 'shown' the instant
    // it claims one (deliberately atomic, to avoid two concurrent claims of
    // the same row), so claiming first and checking availability after would
    // record "shown" even on a run where requestReview() was never actually
    // callable (unsupported platform/environment) -- once claimed, this
    // patient's one prompt is spent and can't be re-queued.
    const available = await StoreReview.isAvailableAsync();
    if (!available) return;

    const { data, error } = await supabase.rpc("claim_pending_reputation_review_prompt");
    // `data` is truthy even when nothing was claimed: the DB function
    // returns SQL NULL for the composite type when no row matches, and
    // Postgres/PostgREST expand a NULL composite into a row of all-null
    // fields (confirmed live: `select * from claim_pending_...()` yields
    // one row with `id: null`, not zero rows) rather than a JSON `null` —
    // checking `!data` alone would call requestReview() on every session,
    // exactly the blanket "rate us" behaviour this feature must never be.
    if (error || !data?.id) return;

    await StoreReview.requestReview();
  } catch {
    // Best-effort only — never surfaces to the patient or blocks anything
    // else in the app from working.
  }
}

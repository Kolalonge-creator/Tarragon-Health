import { supabase } from "@/lib/supabase";
import { unregisterPushToken } from "@/lib/push-registration";

/**
 * Signs the person out of this phone. The push token is switched off first, while the session can still prove who owns the row, so
 * pushes for the leaving account stop arriving here. Every deliberate sign-out goes through this; forced ones (a session the server
 * rejected, a remote wipe) cannot call the server and rely on the next account taking the token over at registration.
 */
export async function signOutOfThisPhone(options?: { scope?: "global" | "local" | "others" }): Promise<void> {
  await unregisterPushToken();
  await supabase.auth.signOut(options);
}

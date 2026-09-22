"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LAST_ACTIVITY_COOKIE } from "@/lib/auth/idle-timeout";

// Server Action, not a form POST to a Route Handler — Next.js applies
// cookie mutations made via next/headers' cookies() reliably in this
// context (unlike a Route Handler returning a manually-constructed
// NextResponse.redirect(), which didn't reliably carry them; see the
// removed logic previously in app/auth/signout/route.ts) and a same-request
// redirect() here doesn't go through the browser's own POST/redirect
// method-preservation semantics at all.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  // Found in pre-merge review of the 2026-09-18 idle-timeout feature: this
  // used to leave th_last_seen in place. proxy.ts's idle-timeout check runs
  // on THIS request too (the caller is still authenticated for it), so it
  // freshly re-stamps the cookie to "now" at the exact moment of sign-out —
  // and since the cookie's own maxAge outlives the idle threshold by a
  // minute, a user who logs back in between 30 and 31 minutes after
  // signing out would find the STALE cookie from their sign-out already
  // reads as idle-expired, bouncing them straight back to
  // /login?reason=idle right after a fresh, valid sign-in. Deleting it here
  // means the very next authenticated request has no activity timestamp at
  // all — exactly the "fresh session, not yet stamped" case
  // isSessionIdle() already treats as not-idle.
  (await cookies()).delete(LAST_ACTIVITY_COOKIE);

  redirect("/login");
}

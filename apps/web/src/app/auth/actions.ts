"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  redirect("/login");
}

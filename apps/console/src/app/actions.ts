"use server";

import { redirect } from "next/navigation";
import { createClient } from "@tarragon/auth/supabase/server";

/**
 * Server Action rather than a Route Handler POST: cookie mutations made via
 * next/headers are applied reliably here (same reasoning as
 * apps/web/src/app/auth/actions.ts). Signs out THIS host's session only;
 * host-only cookies mean the main app's session is untouched.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

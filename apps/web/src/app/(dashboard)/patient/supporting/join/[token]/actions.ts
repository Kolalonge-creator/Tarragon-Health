"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isJoinToken, joinLandingPath } from "@/lib/care-circle/join-link";

const input = z.object({ token: z.string().max(128) });

/**
 * "Sign in with a different account" on a join link that was sent to another email or phone: sign out here, then back to the
 * signed-out landing for the SAME link, which offers sign-in and a supporter sign-up for the right contact. Only a well-formed token
 * is ever put back into a URL; anything else lands on the ordinary sign-in page.
 */
export async function signOutAndReturnToInvite(formData: FormData): Promise<never> {
  const parsed = input.safeParse({ token: formData.get("token") });
  const supabase = await createClient();
  await supabase.auth.signOut();
  if (!parsed.success || !isJoinToken(parsed.data.token)) redirect("/login");
  redirect(joinLandingPath(parsed.data.token));
}

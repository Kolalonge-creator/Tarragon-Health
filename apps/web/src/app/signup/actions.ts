"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { signupSchema } from "@/lib/validation/auth";

export type SignupActionState = { error?: string; success?: boolean } | undefined;

/**
 * Public self-serve signup always provisions a `patient` profile — this
 * matches `private.handle_new_user`'s default in
 * supabase/migrations/20260705000001_core_auth_multitenancy.sql. Role/org
 * assignment for staff is a server/admin-controlled operation, never a field
 * on this form.
 */
export async function signUp(
  _prevState: SignupActionState,
  formData: FormData
): Promise<SignupActionState> {
  const parsed = signupSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    countryCode: formData.get("countryCode"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL;
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // auth.users.phone is only set by phone-identity signup; carrying the
      // phone here lets /auth/callback backfill profiles.phone once the
      // user confirms and we have a session to update it under RLS.
      data: { full_name: parsed.data.fullName, phone: parsed.data.phone },
    },
  });
  if (error) {
    return { error: error.message };
  }

  return { success: true };
}

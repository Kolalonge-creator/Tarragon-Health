import { createClient, getCurrentUser } from "@/lib/supabase/server";

/** The signed-in caller's own profile row (RLS-scoped — no service role needed). */
export async function getCurrentProfile() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return profile;
}

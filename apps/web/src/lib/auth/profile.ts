import type { UserRole } from "@tarragon/shared";
import type { createClient } from "@/lib/supabase/server";

type AppSupabaseClient = Awaited<ReturnType<typeof createClient>>;

type ProfileRoleRow = {
  role: UserRole;
};

export async function fetchUserRole(
  supabase: AppSupabaseClient,
  userId: string,
): Promise<UserRole | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return (data as ProfileRoleRow).role;
}

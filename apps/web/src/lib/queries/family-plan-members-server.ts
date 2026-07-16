import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import type { FamilyPlanMember } from "./family-plan-members";

/**
 * Server Component equivalent of useFamilyPlanMembers() — same query,
 * callable from an async Server Component (e.g. /patient/parentcare)
 * rather than only from a client-side React Query hook.
 */
export async function getFamilyPlanMembersServer(
  supabase: SupabaseClient<Database>,
  ownerId: string
): Promise<FamilyPlanMember[]> {
  const { data, error } = await supabase
    .from("family_plan_members")
    .select("*, member:profiles!family_plan_members_member_id_fkey(full_name)")
    .eq("plan_owner_id", ownerId)
    .order("onboarded_at", { ascending: true });
  if (error) throw error;
  return data as FamilyPlanMember[];
}

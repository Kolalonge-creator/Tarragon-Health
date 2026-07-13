import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { AddFamilyPlanMemberInput } from "@/lib/validation/family-plan-members";

export type FamilyPlanMember = Tables<"family_plan_members"> & {
  member: { full_name: string | null } | null;
};

const QUERY_KEY = ["family-plan-members"];

async function getCallerProfile(): Promise<{ id: string; organisationId: string }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile?.organisation_id) {
    throw new Error("This account has no organisation on file");
  }
  return { id: user.id, organisationId: profile.organisation_id };
}

/** Every family_plan_members row this caller owns (as the Family Plan
 * subscriber) — RLS also lets a member see their own row, but this view is
 * for the plan owner managing their household. */
export function useFamilyPlanMembers() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("family_plan_members")
        .select("*, member:profiles!family_plan_members_member_id_fkey(full_name)")
        .eq("plan_owner_id", user.id)
        .order("onboarded_at", { ascending: true });
      if (error) throw error;
      return data as FamilyPlanMember[];
    },
  });
}

/**
 * Enrolls an existing patient (they must already have signed up — see
 * public.find_profile_by_phone) as a family member on the caller's Family
 * Plan subscription. The DB-level family_plan_members_validate_count
 * trigger (20260712201534) enforces the 4 (+ Extra Family Member add-ons)
 * cap — this mutation surfaces that error message as-is rather than
 * duplicating the limit check client-side.
 */
export function useAddFamilyPlanMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddFamilyPlanMemberInput) => {
      const supabase = createClient();
      const { id: ownerId, organisationId } = await getCallerProfile();

      const { data: found, error: lookupError } = await supabase
        .rpc("find_profile_by_phone", { lookup_phone: input.member_phone })
        .maybeSingle();
      if (lookupError) throw lookupError;
      if (!found) {
        throw new Error(
          "No Tarragon account found with that phone number — they need to sign up first.",
        );
      }
      if (found.id === ownerId) {
        throw new Error("You can't add yourself as a family member.");
      }

      const { data: planRow } = await supabase
        .from("subscriptions")
        .select("id, plan:subscription_plans!subscriptions_plan_id_fkey!inner(code)")
        .eq("subscriber_id", ownerId)
        .in("status", ["active", "trialing"])
        .eq("plan.code", "family")
        .maybeSingle();

      const { error } = await supabase.from("family_plan_members").insert({
        organisation_id: organisationId,
        plan_owner_id: ownerId,
        member_id: found.id,
        plan_id: planRow?.id ?? null,
        relationship: input.relationship,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

export function useRemoveFamilyPlanMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const supabase = createClient();
      const { error } = await supabase.from("family_plan_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

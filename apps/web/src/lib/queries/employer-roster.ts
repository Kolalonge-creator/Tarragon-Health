import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { RosterMemberInput } from "@/lib/validation/employer-roster";

export type RosterMember = Tables<"employer_roster_members">;

function rosterKey(organisationId: string) {
  return ["employer-roster", organisationId];
}

/**
 * Full-population employer enrolment (docs/FULL_SPECIFICATION_V4.md §2.4/§8)
 * — org staff's own roster, staff-only per employer_roster_members' RLS.
 */
export function useEmployerRoster(organisationId: string) {
  return useQuery({
    queryKey: rosterKey(organisationId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("employer_roster_members")
        .select("*")
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as RosterMember[];
    },
    enabled: !!organisationId,
  });
}

export function useAddRosterMember(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: RosterMemberInput) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error } = await supabase.from("employer_roster_members").insert({
        organisation_id: organisationId,
        phone: input.phone,
        full_name: input.full_name ?? null,
        added_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

/**
 * Tries to immediately attach a pending roster row to an existing patient
 * account (see public.claim_employer_roster_member) — a no-op (returns
 * false) if no matching self-serve signup exists yet; they'll be picked up
 * automatically at signup time instead (private.handle_new_user).
 */
export function useClaimRosterMember(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rosterId: string) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("claim_employer_roster_member", {
        target_roster_id: rosterId,
      });
      if (error) throw error;
      return data as boolean;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

export function useRemoveRosterMember(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rosterId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("employer_roster_members")
        .update({ status: "removed" })
        .eq("id", rosterId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

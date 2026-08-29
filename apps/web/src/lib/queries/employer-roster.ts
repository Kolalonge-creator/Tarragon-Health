import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import type { RosterMemberInput, BulkRosterRow } from "@/lib/validation/employer-roster";

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
        phone: input.phone ?? null,
        email: input.email ?? null,
        full_name: input.full_name ?? null,
        department_id: input.department_id ?? null,
        location_id: input.location_id ?? null,
        employment_status: input.employment_status ?? null,
        eligible_from: input.eligible_from ?? null,
        eligible_until: input.eligible_until ?? null,
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
 * Tries to immediately attach a pending/invited roster row to an existing
 * patient account (see public.claim_employer_roster_member) — a no-op
 * (returns false) if no matching self-serve signup exists yet; they'll be
 * picked up automatically at signup time instead (private.handle_new_user).
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

/** §26.17 departure — ends the employer relationship; the account and record
 * are untouched (see public.employer_mark_departed / the sync trigger). */
export function useMarkRosterMemberDeparted(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rosterId, reason }: { rosterId: string; reason?: string }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("employer_mark_departed", {
        p_roster_member_id: rosterId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

/** §26.4 email/SMS invitation. Returns the redeemable link's token — the
 * caller is responsible for getting it to the person (this RPC only issues
 * it; sending it is the notifications pipeline's job elsewhere). */
export function useInviteRosterMember(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rosterId, channel }: { rosterId: string; channel: "email" | "sms" }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("employer_invite_roster_member", {
        p_roster_member_id: rosterId,
        p_channel: channel,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

/** §26.4 bulk upload / HR integration / API — one server-side upsert call.
 * Returns per-row skip reasons so the admin can see exactly what didn't land. */
export function useBulkUpsertRoster(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rows: BulkRosterRow[]) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("employer_bulk_upsert_roster", {
        p_organisation_id: organisationId,
        p_rows: rows,
        p_channel: "bulk_upload",
      });
      if (error) throw error;
      return data as { inserted: number; updated: number; skipped: { row: number; reason: string }[] };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

/** Assigns (or clears, with null) a benefit package — the trigger that grants
 * the underlying subscription fires off this same update. */
export function useAssignBenefitPackage(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rosterId, packageId }: { rosterId: string; packageId: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("employer_roster_members")
        .update({ benefit_package_id: packageId })
        .eq("id", rosterId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: rosterKey(organisationId) });
    },
  });
}

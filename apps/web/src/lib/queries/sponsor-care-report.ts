import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Enums } from "@tarragon/shared";

/**
 * The sponsor's Care Report, and the patient's control over it.
 *
 * The product a sponsor is buying is not really a service for someone else. It
 * is evidence: proof the money reached care, which a bank transfer can never
 * give them. That is the whole reason this exists.
 *
 * The consent boundary is the design, not a constraint on it. The standing rule
 * is that a sponsor sees THAT they paid and THAT it was used, and nothing about
 * results. Activity counts go beyond that rule, so they are not granted by
 * default — public.sponsor_sharing_preferences defaults to 'none' and only the
 * patient can raise it. Buying a more expensive product does not buy more
 * visibility, and support cannot set it on a patient's behalf.
 *
 * Even at the most generous level the RPC returns no clinical VALUE: no blood
 * pressure figure, no glucose figure, no diagnosis, no medicine. If a future
 * change adds one, it is a disclosure the patient did not agree to.
 */

export type SponsorCareReport = {
  sharing_level: Enums<"sponsor_sharing_level">;
  since?: string;
  vouchers: {
    voucher_number: string;
    what: string | null;
    paid_kobo: number;
    status: string;
    activated_at: string | null;
    redeemed_at: string | null;
  }[];
  readings_logged?: number;
  last_clinical_review?: string | null;
  next_check_due?: string | null;
  monitoring_active_until?: string | null;
  note: string;
};

export function useSponsorCareReport(beneficiaryId: string | null) {
  return useQuery({
    queryKey: ["sponsor-care-report", beneficiaryId],
    enabled: !!beneficiaryId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("sponsor_care_report", {
        p_beneficiary: beneficiaryId!,
      });
      if (error) throw error;
      return data as unknown as SponsorCareReport;
    },
  });
}

/** What a given sponsor may see about me. Absent row means 'none'. */
export function useMySponsorSharing() {
  return useQuery({
    queryKey: ["sponsor-sharing", "mine"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("sponsor_sharing_preferences")
        .select("*, sponsor:profiles!sponsor_sharing_preferences_sponsor_id_fkey(full_name)");
      if (error) throw error;
      return data;
    },
  });
}

export function useSetSponsorSharing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      sponsorId,
      level,
    }: {
      organisationId: string;
      sponsorId: string;
      level: Enums<"sponsor_sharing_level">;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      // patient_id comes from the session, never from a prop: this is the row
      // that decides who may see someone's health activity, and it must not be
      // settable for anyone but yourself. The RLS policy enforces the same
      // thing, so this is defence in depth rather than the only check.
      const { error } = await supabase.from("sponsor_sharing_preferences").upsert(
        {
          organisation_id: organisationId,
          patient_id: user.id,
          sponsor_id: sponsorId,
          level,
          decided_at: new Date().toISOString(),
        },
        { onConflict: "patient_id,sponsor_id" }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sponsor-sharing", "mine"] });
    },
  });
}

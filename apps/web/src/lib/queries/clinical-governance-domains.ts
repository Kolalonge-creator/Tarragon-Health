import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type GovernanceDomain = Tables<"clinical_governance_domain_owners">["domain"];

export type GovernanceDomainOwner = Tables<"clinical_governance_domain_owners"> & {
  accountable_staff_record: { full_name: string; is_clinical_director: boolean } | null;
};

/** Spec §31.3's own list of areas a clinical governance function is responsible for. */
export const GOVERNANCE_DOMAINS: GovernanceDomain[] = [
  "clinical_standards",
  "patient_safety",
  "protocol_approval",
  "clinical_content",
  "escalation_policies",
  "incident_review",
  "quality_improvement",
  "ai_clinical_governance",
  "medication_safety",
  "referral_pathways",
];

export const GOVERNANCE_DOMAIN_LABEL: Record<GovernanceDomain, string> = {
  clinical_standards: "Clinical standards",
  patient_safety: "Patient safety",
  protocol_approval: "Protocol approval",
  clinical_content: "Clinical content",
  escalation_policies: "Escalation policies",
  incident_review: "Incident review",
  quality_improvement: "Quality improvement",
  ai_clinical_governance: "AI clinical governance",
  medication_safety: "Medication safety",
  referral_pathways: "Referral pathways",
};

const QUERY_KEY = ["clinical-governance-domain-owners"];

/** Every domain-owner row on file for the caller's org — RLS scopes it, no domain filter to get wrong. */
export function useGovernanceDomainOwners() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_governance_domain_owners")
        .select(
          "*, accountable_staff_record:clinical_staff!clinical_governance_domain_owners_accountable_staff_fkey(full_name, is_clinical_director)",
        )
        .order("domain", { ascending: true });
      if (error) throw error;
      return data as GovernanceDomainOwner[];
    },
  });
}

/**
 * Upserts one domain's owner. Not a plain insert: a domain already assigned
 * needs an UPDATE (the unique (organisation_id, domain) constraint rejects a
 * second insert outright), so this looks up any existing row first. Passing
 * null clears the assignment rather than deleting the row — an unassigned
 * domain stays visible as a gap, per the migration's own design.
 */
export function useSetGovernanceDomainOwner(organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      domain,
      accountableStaffId,
      notes,
    }: {
      domain: GovernanceDomain;
      accountableStaffId: string | null;
      notes?: string;
    }) => {
      const supabase = createClient();
      const { data: existing } = await supabase
        .from("clinical_governance_domain_owners")
        .select("id")
        .eq("organisation_id", organisationId)
        .eq("domain", domain)
        .maybeSingle();

      const { error } = existing
        ? await supabase
            .from("clinical_governance_domain_owners")
            .update({ accountable_staff: accountableStaffId, notes: notes ?? null })
            .eq("id", existing.id)
        : await supabase.from("clinical_governance_domain_owners").insert({
            organisation_id: organisationId,
            domain,
            accountable_staff: accountableStaffId,
            notes: notes ?? null,
          });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });
}

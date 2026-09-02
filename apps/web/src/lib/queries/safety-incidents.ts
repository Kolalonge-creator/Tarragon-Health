import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type SafetyIncident = Tables<"clinical_incident_reports"> & {
  patient: { full_name: string | null } | null;
};

const incidentsQueryKey = ["safety-incidents"];

/**
 * All clinical_incident_reports in the caller's org, newest first. RLS
 * (private.is_org_staff) is the real scope — same access any org staff
 * already has to file/read one, this is the first UI reading it (docs spec
 * §89.16; the table itself, and its attribution trigger, were built
 * 2026-08-26 with no console anywhere despite the migration's own comment
 * promising one).
 */
export function usePatientSafetyIncidents() {
  return useQuery({
    queryKey: incidentsQueryKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_incident_reports")
        .select("*, patient:profiles!clinical_incident_reports_patient_id_fkey(full_name)")
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as SafetyIncident[];
    },
  });
}

/**
 * Files a new incident/near-miss report. reported_by/reported_at/status are
 * all server-derived by private.enforce_clinical_incident_report_attribution
 * — nothing here is load-bearing for who filed it. Open to any org staff,
 * Care Coordinator included (CLAUDE.md's three Care-Coordinator write
 * restrictions — medications, escalation resolution, protocol signing —
 * don't cover filing a safety report; that's exactly the safety-culture
 * signal this table exists to capture).
 */
export function useFileSafetyIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      organisationId: string;
      patientId?: string;
      category: SafetyIncident["category"];
      severity: SafetyIncident["severity"];
      description: string;
      immediateActionTaken?: string;
      contributingFactors?: string;
      occurredAt?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("clinical_incident_reports").insert({
        organisation_id: input.organisationId,
        patient_id: input.patientId || null,
        category: input.category,
        severity: input.severity,
        description: input.description,
        immediate_action_taken: input.immediateActionTaken || null,
        contributing_factors: input.contributingFactors || null,
        occurred_at: input.occurredAt || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey });
    },
  });
}

/**
 * Moves a report into review, or closes it. private.
 * enforce_clinical_incident_report_attribution requires an active clinical-
 * tier caller (Care Coordinator excluded) for either transition, and
 * requires review_outcome + corrective_action to close — the DB rejects an
 * incomplete close outright, this is not just a form validation.
 */
export function useReviewSafetyIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      incidentId: string;
      status: "under_review" | "action_planned" | "closed";
      reviewOutcome?: string;
      correctiveAction?: string;
      rootCauseCategory?: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("clinical_incident_reports")
        .update({
          status: input.status,
          review_outcome: input.reviewOutcome || null,
          corrective_action: input.correctiveAction || null,
          root_cause_category: input.rootCauseCategory || null,
        })
        .eq("id", input.incidentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: incidentsQueryKey });
    },
  });
}

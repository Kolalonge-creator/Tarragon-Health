import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

/**
 * Pharmacy Engine spec §12.13/§12.16 (docs/PHARMACY_ENGINE_SPEC.md Phase 1
 * items 1-2) — a medication concern that should route to a clinician, and a
 * cost-affordability signal that should route to the care team. Both are
 * additive and routing-independent: they work the same whether the patient
 * got their medicine from a Tarragon-routed pharmacy (dormant) or one of
 * their own choosing (the live self-arranged path) — see the spec doc §1.
 */

export type AffordabilityReport = Tables<"medication_affordability_reports">;
export type DispenseFlag = Tables<"medication_dispense_flags">;

export type AffordabilityReportWithDetails = AffordabilityReport & {
  patient: { full_name: string | null } | null;
  medication: { drug_name: string } | null;
};

export type DispenseFlagWithDetails = DispenseFlag & {
  patient: { full_name: string | null } | null;
  medication: { drug_name: string } | null;
};

const AFFORDABILITY_OPEN_WORKLIST_KEY = ["medication-affordability-reports", "open-worklist"];
const DISPENSE_FLAGS_OPEN_WORKLIST_KEY = ["medication-dispense-flags", "open-worklist"];

function affordabilityReportsKey(patientId: string) {
  return ["medication-affordability-reports", patientId];
}

function dispenseFlagsKey(patientId: string) {
  return ["medication-dispense-flags", patientId];
}

/**
 * Patient-side: "I couldn't afford this" (§12.16). Writes straight through
 * the patient's own session — medication_affordability_reports_insert
 * already admits patient_id = auth.uid(), same pattern as
 * MedicationCollectionForm.
 */
export function useReportMedicationAffordability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      medicationId,
      note,
    }: {
      patientId: string;
      organisationId: string;
      medicationId: string | null;
      note: string | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("medication_affordability_reports").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        medication_id: medicationId,
        reported_by: patientId,
        note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: affordabilityReportsKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: AFFORDABILITY_OPEN_WORKLIST_KEY });
    },
  });
}

/**
 * Patient-side: raise a concern about a medication (§12.13). flag_type is
 * fixed to 'patient_query' here — the fuller taxonomy (prescription_issue/
 * interaction_concern/duplication/etc.) is for staff- or pharmacist-raised
 * flags, since those are clinical judgments a patient shouldn't self-assert.
 */
export function useReportMedicationConcern() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      patientId,
      organisationId,
      medicationId,
      note,
    }: {
      patientId: string;
      organisationId: string;
      medicationId: string;
      note: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("medication_dispense_flags").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        medication_id: medicationId,
        flag_type: "patient_query",
        note,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: dispenseFlagsKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: DISPENSE_FLAGS_OPEN_WORKLIST_KEY });
    },
  });
}

/** Staff worklist: open affordability reports, oldest first. */
export function useOpenAffordabilityReports() {
  return useQuery({
    queryKey: AFFORDABILITY_OPEN_WORKLIST_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_affordability_reports")
        .select(
          "*, patient:profiles!medication_affordability_reports_patient_id_fkey(full_name), medication:medications(drug_name)"
        )
        .neq("status", "resolved")
        .order("reported_at", { ascending: true });
      if (error) throw error;
      return data as AffordabilityReportWithDetails[];
    },
    refetchInterval: 60_000,
  });
}

/** Staff worklist: open medication concern/intervention flags, oldest first. */
export function useOpenDispenseFlags() {
  return useQuery({
    queryKey: DISPENSE_FLAGS_OPEN_WORKLIST_KEY,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("medication_dispense_flags")
        .select(
          "*, patient:profiles!medication_dispense_flags_patient_id_fkey(full_name), medication:medications(drug_name)"
        )
        .neq("status", "resolved")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as DispenseFlagWithDetails[];
    },
    refetchInterval: 60_000,
  });
}

/**
 * Resolve an affordability report — any org staff (clinician, care
 * coordinator, admin) per §12.16's own list of valid actions explicitly
 * including "care coordinator intervention". resolved_by/resolved_at are
 * server-stamped from the caller's session
 * (medication_affordability_reports_stamp_resolved_by) — never sent from
 * here.
 */
export function useResolveAffordabilityReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reportId,
      resolutionAction,
      resolutionNote,
    }: {
      reportId: string;
      resolutionAction: string;
      resolutionNote: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_affordability_reports")
        .update({
          status: "resolved",
          resolution_action: resolutionAction,
          resolution_note: resolutionNote,
        })
        .eq("id", reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AFFORDABILITY_OPEN_WORKLIST_KEY });
    },
  });
}

/**
 * Resolve a medication concern/intervention flag — clinical-tier gated at
 * the page level (isClinicalTier), same pattern as escalation claiming: a
 * Care Coordinator may raise a flag but not resolve one, since resolving it
 * is a clinical judgment (prescription/interaction/duplication concerns).
 * reviewed_by/reviewed_at are server-stamped from the caller's own active
 * clinical_staff row (medication_dispense_flags_stamp_reviewed_by) — never
 * sent from here, and the DB itself rejects the write if the caller has no
 * active clinical_staff row, independent of this page-level gate.
 */
export function useResolveDispenseFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      flagId,
      resolutionNote,
    }: {
      flagId: string;
      resolutionNote: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("medication_dispense_flags")
        .update({ status: "resolved", resolution_note: resolutionNote })
        .eq("id", flagId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISPENSE_FLAGS_OPEN_WORKLIST_KEY });
    },
  });
}

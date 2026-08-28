import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  writableTable,
  type MedicationSideEffectReportRow,
  type MedicationSideEffectSeverity,
  type MedicationSideEffectStatus,
} from "@/lib/supabase/pending-schema-overrides";
import type { MedicationSideEffectReportInput } from "@/lib/validation/medication-side-effects";

export type { MedicationSideEffectSeverity, MedicationSideEffectStatus };
export type MedicationSideEffectReport = MedicationSideEffectReportRow;

export type MedicationSideEffectReportWithContext = MedicationSideEffectReport & {
  medication: { drug_name: string } | null;
  patient: { full_name: string | null; patient_number: string | null } | null;
};

const REPORT_SELECT = "*, medication:medications(drug_name)";
const REPORT_WORKLIST_SELECT =
  "*, medication:medications(drug_name), patient:profiles!medication_side_effect_reports_patient_id_fkey(full_name, patient_number)";

const TABLE = "medication_side_effect_reports";

function patientReportsKey(patientId: string) {
  return ["medication-side-effect-reports", patientId];
}

/** A patient's own reported side effects, newest first. */
export function useMedicationSideEffectReports(patientId: string) {
  return useQuery({
    queryKey: patientReportsKey(patientId),
    queryFn: async () => {
      const { data, error } = await writableTable(TABLE)
        .select(REPORT_SELECT)
        .eq("patient_id", patientId)
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MedicationSideEffectReportWithContext[];
    },
    enabled: !!patientId,
  });
}

/**
 * Submit a side-effect report. reported_by is stamped server-side from
 * auth.uid() (private.stamp_side_effect_report_reporter) — never sent from
 * here. Moderate/severe severity raises a real clinician_alerts row
 * automatically (private.raise_side_effect_report_alert).
 */
export function useReportSideEffect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: MedicationSideEffectReportInput & { patientId: string; organisationId: string }
    ) => {
      const { patientId, organisationId, onset_date, ...rest } = input;
      const { error } = await writableTable(TABLE).insert({
        ...rest,
        onset_date: onset_date || null,
        patient_id: patientId,
        organisation_id: organisationId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: patientReportsKey(variables.patientId) });
      queryClient.invalidateQueries({ queryKey: ["medication-side-effect-reports", "org"] });
    },
  });
}

/** Org staff worklist — unreviewed ("new") side-effect reports, most recent first. */
export function useOrgSideEffectReports() {
  return useQuery({
    queryKey: ["medication-side-effect-reports", "org"],
    queryFn: async () => {
      const { data, error } = await writableTable(TABLE)
        .select(REPORT_WORKLIST_SELECT)
        .eq("status", "new")
        .order("severity", { ascending: false })
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MedicationSideEffectReportWithContext[];
    },
  });
}

/**
 * Review (mark reviewed/dismissed) a side-effect report. reviewed_by/
 * reviewed_at are stamped server-side (private.stamp_side_effect_report_review)
 * from the caller's own clinical_staff row — never sent from here.
 */
export function useReviewSideEffectReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      reportId,
      status,
      reviewNotes,
    }: {
      reportId: string;
      status: "reviewed" | "dismissed";
      reviewNotes: string | null;
    }) => {
      const { error } = await writableTable(TABLE)
        .update({ status, review_notes: reviewNotes })
        .eq("id", reportId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["medication-side-effect-reports"] });
    },
  });
}

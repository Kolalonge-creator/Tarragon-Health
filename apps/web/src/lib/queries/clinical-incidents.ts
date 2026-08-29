import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import {
  addIncidentDetail,
  fileIncidentReport,
  reviewIncidentReport,
} from "@/app/(dashboard)/clinician/incidents/actions";
import type {
  AddIncidentDetailInput,
  FileIncidentReportInput,
  ReviewIncidentReportInput,
} from "@/lib/validation/clinical-incidents";
import type {
  IncidentCategory,
  IncidentSeverity,
  IncidentStatus,
} from "@/lib/clinical/incident-governance";

/**
 * The clinical incident / near-miss log (spec §31.7–§31.11).
 *
 * Attribution joins follow the ReviewedByDoctor rule: every "reviewed by" /
 * "closed by" name is a real joined `clinical_staff` row or nothing at all —
 * null-gated at the render site, never a fallback string.
 */
/**
 * category/severity/status are CHECK constraints, not Postgres enums, so the
 * generated row type widens all three to bare `string` — overridden here to
 * the literal unions incident-governance.ts declares, so the log and the
 * safety dashboard can switch on them exhaustively instead of indexing a
 * Record with a plain string.
 */
export type ClinicalIncidentReport = Omit<
  Tables<"clinical_incident_reports">,
  "category" | "severity" | "status"
> & {
  category: IncidentCategory;
  severity: IncidentSeverity;
  status: IncidentStatus;
  reporter: { full_name: string; role: string } | null;
  patient: { full_name: string; patient_number: string | null } | null;
  reviewed_by_staff_record: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
  closed_by_staff_record: { full_name: string } | null;
};

const SELECT = [
  "*",
  "reporter:profiles!clinical_incident_reports_reported_by_fkey(full_name, role)",
  "patient:profiles!clinical_incident_reports_patient_id_fkey(full_name, patient_number)",
  "reviewed_by_staff_record:clinical_staff!clinical_incident_reports_reviewed_by_staff_fkey(full_name, credential_type, credential_number)",
  "closed_by_staff_record:clinical_staff!clinical_incident_reports_closed_by_staff_fkey(full_name)",
].join(", ");

export const clinicalIncidentsKey = ["clinical-incidents"] as const;

/**
 * Every report the caller's organisation can see — RLS (`private.is_org_staff`)
 * does the scoping, so there is no organisation filter here to get wrong.
 * Closed reports are included: the record that a near miss was looked at and
 * what changed as a result is the most useful thing in the log, not clutter to
 * be filtered away.
 */
export function useClinicalIncidents() {
  return useQuery({
    queryKey: clinicalIncidentsKey,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("clinical_incident_reports")
        .select(SELECT)
        .order("reported_at", { ascending: false });
      if (error) throw error;
      return data as unknown as ClinicalIncidentReport[];
    },
  });
}

export function useFileIncidentReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: FileIncidentReportInput) => {
      const result = await fileIncidentReport(input);
      if (result.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicalIncidentsKey });
    },
  });
}

export function useAddIncidentDetail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddIncidentDetailInput) => {
      const result = await addIncidentDetail(input);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicalIncidentsKey });
    },
  });
}

export function useReviewIncidentReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewIncidentReportInput) => {
      const result = await reviewIncidentReport(input);
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clinicalIncidentsKey });
    },
  });
}

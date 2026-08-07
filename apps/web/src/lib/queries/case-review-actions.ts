import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";
import {
  confirmCaseActionAction,
  dismissCaseActionAction,
  proposeCaseActionsAction,
} from "@/lib/case-cockpit/actions";
import type { ProposedPayload } from "@/lib/case-cockpit/propose";

/**
 * The signer's own record, joined for attribution display. Null-gated at the
 * render site: no staff row means no "Confirmed by" line, never a fallback
 * string (CLAUDE.md — the ReviewedByDoctor rule applies to every clinical
 * attribution, not just that one component).
 */
export type CaseReviewAction = Tables<"case_review_actions"> & {
  confirmed_by_staff_record: {
    full_name: string;
    credential_type: string | null;
    credential_number: string | null;
  } | null;
  dismissed_by_staff_record: { full_name: string } | null;
  protocol_version: { version_number: number; title: string } | null;
};

const SELECT =
  "*, confirmed_by_staff_record:clinical_staff!case_review_actions_confirmed_by_staff_fkey(full_name, credential_type, credential_number), dismissed_by_staff_record:clinical_staff!case_review_actions_dismissed_by_staff_fkey(full_name), protocol_version:protocol_versions!case_review_actions_protocol_version_id_fkey(version_number, title)";

export const caseActionsKey = (clinicianAlertId: string) => [
  "case-review-actions",
  clinicianAlertId,
];

/**
 * Live proposals plus the decided history for one case. 'superseded' rows are
 * excluded — they are bookkeeping from a re-run, never something a doctor
 * needs to see. Dismissed and confirmed rows ARE shown: the record of what a
 * doctor declined, and why, is as much a part of the case as what they did.
 */
export function useCaseReviewActions(clinicianAlertId: string) {
  return useQuery({
    queryKey: caseActionsKey(clinicianAlertId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("case_review_actions")
        .select(SELECT)
        .eq("clinician_alert_id", clinicianAlertId)
        .neq("status", "superseded")
        .order("proposed_at", { ascending: true });
      if (error) throw error;
      return data as CaseReviewAction[];
    },
    enabled: !!clinicianAlertId,
  });
}

export function useProposeCaseActions(clinicianAlertId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await proposeCaseActionsAction(clinicianAlertId);
      if (!result.success) throw new Error(result.message ?? "Could not refresh suggestions.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseActionsKey(clinicianAlertId) });
    },
  });
}

/**
 * Confirming touches the patient's record, so this invalidates the affected
 * downstream queries too — a confirmed refill that leaves a stale medication
 * list on screen would have the doctor doubting whether it saved.
 */
export function useConfirmCaseAction(clinicianAlertId: string, patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      actionId,
      modifiedPayload,
    }: {
      actionId: string;
      modifiedPayload?: ProposedPayload;
    }) => {
      const result = await confirmCaseActionAction(actionId, modifiedPayload);
      if (!result.success) throw new Error(result.message ?? "Could not confirm this action.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseActionsKey(clinicianAlertId) });
      queryClient.invalidateQueries({ queryKey: ["medications", patientId] });
      queryClient.invalidateQueries({ queryKey: ["lab-orders", patientId] });
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["escalation-notes"] });
    },
  });
}

export function useDismissCaseAction(clinicianAlertId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ actionId, reason }: { actionId: string; reason: string }) => {
      const result = await dismissCaseActionAction(actionId, reason);
      if (!result.success) throw new Error(result.message ?? "Could not dismiss this action.");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: caseActionsKey(clinicianAlertId) });
    },
  });
}

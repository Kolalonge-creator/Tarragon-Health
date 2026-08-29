import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { ReferralStatus, Tables } from "@tarragon/shared";

export type SpecialistConsultationDocument = Tables<"specialist_consultation_documents">;
export type SpecialistConsultationExtraction = Tables<"specialist_consultation_extractions">;
export type SpecialistReferralActionItem = Tables<"specialist_referral_action_items">;

export interface SpecialistConsultationDocumentWithExtraction extends SpecialistConsultationDocument {
  extraction: SpecialistConsultationExtraction | null;
}

/** Every uploaded report + its extraction draft/filed state for one referral —
 * spec §70.3, the review worklist on the referral detail page. */
export function useSpecialistConsultationDocuments(referralId: string | null) {
  return useQuery({
    queryKey: ["specialist-consultation-documents", referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const supabase = createClient();
      const { data: documents, error } = await supabase
        .from("specialist_consultation_documents")
        .select("*")
        .eq("referral_id", referralId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const { data: extractions } = await supabase
        .from("specialist_consultation_extractions")
        .select("*")
        .eq("referral_id", referralId as string);

      const byDocument = new Map((extractions ?? []).map((e) => [e.document_id, e]));
      return (documents ?? []).map((doc) => ({
        ...doc,
        extraction: byDocument.get(doc.id) ?? null,
      })) as SpecialistConsultationDocumentWithExtraction[];
    },
  });
}

export interface ActionItemWithLinkStatus extends SpecialistReferralActionItem {
  /** Read live off whichever downstream table this item routed to — never a
   * duplicated status column, see the migration header for why. Null only if
   * the linked row itself could not be found (should not happen in practice). */
  resolved: boolean | null;
}

/** Action items for one referral, each annotated with whether its routed
 * downstream task/prompt is resolved — spec §70.4/§70.6, and what
 * enforce_referral_closure itself checks before allowing "completed". */
export function useSpecialistReferralActionItems(referralId: string | null) {
  return useQuery({
    queryKey: ["specialist-referral-action-items", referralId],
    enabled: !!referralId,
    queryFn: async () => {
      const supabase = createClient();
      const { data: items, error } = await supabase
        .from("specialist_referral_action_items")
        .select("*")
        .eq("referral_id", referralId as string)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const outreachIds = (items ?? []).map((i) => i.linked_outreach_task_id).filter((v): v is string => !!v);
      const promptIds = (items ?? [])
        .map((i) => i.linked_care_plan_review_prompt_id)
        .filter((v): v is string => !!v);

      const [{ data: tasks }, { data: prompts }] = await Promise.all([
        outreachIds.length
          ? supabase.from("care_outreach_tasks").select("id, status").in("id", outreachIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        promptIds.length
          ? supabase.from("care_plan_review_prompts").select("id, status").in("id", promptIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
      ]);

      const taskStatus = new Map((tasks ?? []).map((t) => [t.id, t.status]));
      const promptStatus = new Map((prompts ?? []).map((p) => [p.id, p.status]));

      return (items ?? []).map((item) => {
        let resolved: boolean | null = null;
        if (item.linked_outreach_task_id) {
          const status = taskStatus.get(item.linked_outreach_task_id);
          resolved = status ? ["resolved", "dismissed"].includes(status) : null;
        } else if (item.linked_care_plan_review_prompt_id) {
          const status = promptStatus.get(item.linked_care_plan_review_prompt_id);
          resolved = status ? status !== "open" : null;
        }
        return { ...item, resolved } as ActionItemWithLinkStatus;
      });
    },
  });
}

export interface ConcurrentSpecialistReferral {
  id: string;
  specialist_type: string;
  status: string;
}

const ACTIVE_REFERRAL_STATUSES: ReferralStatus[] = [
  "pending_payment",
  "payment_confirmed",
  "pending",
  "waitlisted",
  "booked",
  "confirmed",
];

/** Spec §70.9 — other specialties this patient has concurrent, unresolved
 * referrals with, so a clinician sees the overlap ("Cardiology +
 * Endocrinology + Nephrology") rather than each referral looking isolated. */
export function useConcurrentSpecialistReferrals(patientId: string | null, excludeReferralId: string | null) {
  return useQuery({
    queryKey: ["specialist-referrals", "concurrent", patientId, excludeReferralId],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      let query = supabase
        .from("specialist_referrals")
        .select("id, specialist_type, status")
        .eq("patient_id", patientId as string)
        .in("status", ACTIVE_REFERRAL_STATUSES);
      if (excludeReferralId) query = query.neq("id", excludeReferralId);
      const { data, error } = await query;
      if (error) throw error;
      return data as ConcurrentSpecialistReferral[];
    },
  });
}

export interface SpecialistActionCounts {
  repeat_test: number;
  investigation: number;
  follow_up_appointment: number;
  medication_review: number;
  care_plan_review: number;
  other: number;
  /** Uploaded reports not yet filed (no confirmed extraction on the document). */
  pending_reports: number;
}

const EMPTY_COUNTS: SpecialistActionCounts = {
  repeat_test: 0,
  investigation: 0,
  follow_up_appointment: 0,
  medication_review: 0,
  care_plan_review: 0,
  other: 0,
  pending_reports: 0,
};

/** Spec §70.11 — "SPECIALIST ACTIONS" summary counts, org-wide, unresolved
 * only. Reads the same live-join-to-downstream-status logic as
 * useSpecialistReferralActionItems, just org-wide and pre-aggregated. */
export function useSpecialistActionCounts() {
  return useQuery({
    queryKey: ["specialist-action-counts"],
    queryFn: async () => {
      const supabase = createClient();
      const { data: items, error } = await supabase
        .from("specialist_referral_action_items")
        .select("action_type, linked_outreach_task_id, linked_care_plan_review_prompt_id");
      if (error) throw error;

      const outreachIds = (items ?? []).map((i) => i.linked_outreach_task_id).filter((v): v is string => !!v);
      const promptIds = (items ?? [])
        .map((i) => i.linked_care_plan_review_prompt_id)
        .filter((v): v is string => !!v);

      const [{ data: tasks }, { data: prompts }, { data: documents }, { data: extractions }] = await Promise.all([
        outreachIds.length
          ? supabase.from("care_outreach_tasks").select("id, status").in("id", outreachIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        promptIds.length
          ? supabase.from("care_plan_review_prompts").select("id, status").in("id", promptIds)
          : Promise.resolve({ data: [] as { id: string; status: string }[] }),
        supabase.from("specialist_consultation_documents").select("id"),
        supabase.from("specialist_consultation_extractions").select("document_id, status"),
      ]);

      const taskStatus = new Map((tasks ?? []).map((t) => [t.id, t.status]));
      const promptStatus = new Map((prompts ?? []).map((p) => [p.id, p.status]));

      const counts = { ...EMPTY_COUNTS };
      for (const item of items ?? []) {
        const resolved = item.linked_outreach_task_id
          ? ["resolved", "dismissed"].includes(taskStatus.get(item.linked_outreach_task_id) ?? "")
          : item.linked_care_plan_review_prompt_id
            ? promptStatus.get(item.linked_care_plan_review_prompt_id) !== "open"
            : false;
        if (!resolved) {
          const key = item.action_type as keyof typeof EMPTY_COUNTS;
          if (key in counts) counts[key] += 1;
        }
      }

      const extractionByDocument = new Map((extractions ?? []).map((e) => [e.document_id, e.status]));
      counts.pending_reports = (documents ?? []).filter(
        (d) => extractionByDocument.get(d.id) !== "confirmed",
      ).length;

      return counts;
    },
  });
}

export interface PastSpecialistConsultation {
  referral_id: string;
  referral_number: string | null;
  specialist_type: string;
  diagnosis: string | null;
  report_date: string | null;
  confirmed_at: string | null;
}

/** Spec §70.8 — specialist continuity: previous confirmed consultations for
 * this patient across EVERY referral, visible to Tarragon's own care team
 * only (specialists have no platform login, so there is no external party
 * to grant access to yet — see the migration series header). */
export function usePatientSpecialistConsultationHistory(patientId: string | null) {
  return useQuery({
    queryKey: ["specialist-consultation-history", patientId],
    enabled: !!patientId,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("specialist_consultation_extractions")
        .select("referral_id, diagnosis, report_date, confirmed_at, specialist_referrals(referral_number, specialist_type)")
        .eq("patient_id", patientId as string)
        .eq("status", "confirmed")
        .order("confirmed_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const referral = row.specialist_referrals as { referral_number?: string; specialist_type?: string } | null;
        return {
          referral_id: row.referral_id,
          referral_number: referral?.referral_number ?? null,
          specialist_type: referral?.specialist_type ?? "specialist",
          diagnosis: row.diagnosis,
          report_date: row.report_date,
          confirmed_at: row.confirmed_at,
        };
      }) as PastSpecialistConsultation[];
    },
  });
}

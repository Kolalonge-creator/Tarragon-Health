import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export const labResultConsultKeys = {
  price: ["lab-result-consult-price"] as const,
  orgRequests: ["lab-result-consult-requests", "org"] as const,
};

export type LabResultConsultRequest = Tables<"lab_result_consult_requests">;
export type LabResultConsultRequestWithPatient = LabResultConsultRequest & {
  patient: { full_name: string | null; patient_number: string | null } | null;
};

/**
 * The self-arranged lab-result consultation fee a patient would pay — org
 * override if one exists, else the platform default (₦10,000 at launch).
 * Mirrors useVideoVisitPrice's shape (consult-slots.ts) exactly: read-only,
 * shown before payment so the "pay to upload" prompt can quote a real
 * number instead of a vague "there's a fee."
 */
export function useLabResultConsultPrice() {
  return useQuery({
    queryKey: labResultConsultKeys.price,
    queryFn: async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from("profiles")
        .select("organisation_id")
        .eq("id", user.id)
        .single();
      const { data, error } = await supabase
        .from("lab_result_consult_prices")
        .select("organisation_id, amount_minor, currency, is_enabled")
        .eq("is_enabled", true);
      if (error) throw error;
      const rows = data ?? [];
      const override = rows.find(
        (r) => r.organisation_id !== null && r.organisation_id === profile?.organisation_id,
      );
      return override ?? rows.find((r) => r.organisation_id === null) ?? null;
    },
  });
}

/**
 * Doctor-side: paid lab-result consult requests waiting to be scheduled —
 * the queue the founder asked for ("doctors should be able to get queue of
 * the request pending"). Includes both payment_confirmed (patient paid but
 * hasn't uploaded yet) and document_uploaded (patient has uploaded) — a
 * doctor can pick a time for either, matching the founder's plain
 * description with no mention of the upload being a precondition. RLS
 * (lab_result_consult_requests_select) already scopes this to the caller's
 * own organisation via private.is_org_staff.
 */
export function useOrgLabResultConsultRequests() {
  return useQuery({
    queryKey: labResultConsultKeys.orgRequests,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("lab_result_consult_requests")
        .select(
          "*, patient:profiles!lab_result_consult_requests_patient_id_fkey(full_name, patient_number)",
        )
        .in("status", ["payment_confirmed", "document_uploaded"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as LabResultConsultRequestWithPatient[];
    },
  });
}

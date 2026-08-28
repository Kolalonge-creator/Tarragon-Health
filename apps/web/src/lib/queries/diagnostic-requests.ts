"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Database, Tables } from "@tarragon/shared";

export type DiagnosticServiceCatalogueItem = Tables<"diagnostic_service_catalogue">;
export type DiagnosticRequest = Tables<"diagnostic_requests">;

/** Active diagnostic_service_catalogue rows — the catalogue a clinician
 * picks from when creating a request (15.1). Global reference data, same
 * shape as useLabCatalogue. */
export function useDiagnosticServiceCatalogue() {
  return useQuery({
    queryKey: ["diagnostic-service-catalogue"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("diagnostic_service_catalogue")
        .select("*")
        .eq("is_active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data as DiagnosticServiceCatalogueItem[];
    },
  });
}

/** A patient's own diagnostic_requests, newest first. RLS
 * (patient_id = auth.uid() OR is_org_staff) does the scoping. */
export function usePatientDiagnosticRequests(patientId: string) {
  return useQuery({
    queryKey: ["diagnostic-requests", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("diagnostic_requests")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DiagnosticRequest[];
    },
    enabled: !!patientId,
  });
}

/**
 * A clinician creates a diagnostic request. Mirrors useOrderLabTest: checked
 * client-side for a friendlier error, but the real gate is
 * diagnostic_requests_insert RLS + derive_diagnostic_request_attribution —
 * this can never succeed for anyone without an active clinical_staff row,
 * whatever this check does.
 */
export function useCreateDiagnosticRequest(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      organisationId,
      modality,
      serviceName,
      indication,
      clinicalQuestion,
      relevantInformation,
      urgency,
      catalogueId,
    }: {
      organisationId: string;
      modality: Database["public"]["Enums"]["diagnostic_modality"];
      serviceName: string;
      indication: string;
      clinicalQuestion?: string;
      relevantInformation?: string;
      urgency: Database["public"]["Enums"]["diagnostic_urgency"];
      catalogueId?: string;
    }) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data: staff, error: staffError } = await supabase
        .from("clinical_staff")
        .select("id")
        .eq("profile_id", user.id)
        .eq("organisation_id", organisationId)
        .eq("active", true)
        .maybeSingle();
      if (staffError) throw staffError;
      if (!staff) {
        throw new Error(
          "You must be an active clinical_staff member of this organisation to order a diagnostic service",
        );
      }

      const { data, error } = await supabase
        .from("diagnostic_requests")
        .insert({
          organisation_id: organisationId,
          patient_id: patientId,
          // Overwritten server-side by derive_diagnostic_request_attribution.
          requested_by: user.id,
          catalogue_id: catalogueId ?? null,
          modality,
          service_name: serviceName,
          indication,
          clinical_question: clinicalQuestion ?? null,
          relevant_information: relevantInformation ?? null,
          urgency,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diagnostic-requests", patientId] });
    },
  });
}

/**
 * Patient booking preference (15.3) via the guarded RPC
 * set_diagnostic_request_booking_preference — mirrors
 * useRequestLabOrderPartnerVisit exactly, same "no fabricated slot grid"
 * posture.
 */
export function useSetDiagnosticBookingPreference(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      facilityId,
      facilityNameFreetext,
      scheduledDate,
      preferredTimeOfDay,
      insuranceCovered,
      insuranceNote,
    }: {
      requestId: string;
      facilityId?: string;
      facilityNameFreetext?: string;
      scheduledDate?: string;
      preferredTimeOfDay?: Database["public"]["Enums"]["lab_order_time_of_day"];
      insuranceCovered?: boolean;
      insuranceNote?: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("set_diagnostic_request_booking_preference", {
        p_request_id: requestId,
        p_facility_id: facilityId ?? undefined,
        p_facility_name_freetext: facilityNameFreetext ?? undefined,
        p_scheduled_date: scheduledDate ?? undefined,
        p_preferred_time_of_day: preferredTimeOfDay ?? undefined,
        p_insurance_covered: insuranceCovered ?? undefined,
        p_insurance_note: insuranceNote ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["diagnostic-requests", patientId] });
    },
  });
}

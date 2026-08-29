import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@tarragon/shared";

export type ConsentVersion = Tables<"consent_versions">;
export type PatientConsent = Tables<"patient_consents">;
export type ConsentType = PatientConsent["consent_type"];

/** The consent text every new patient must accept, one row per consent type. */
export function useCurrentConsentVersions() {
  return useQuery({
    queryKey: ["consent-versions", "current"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("consent_versions")
        .select("*")
        .eq("is_current", true)
        .order("consent_type", { ascending: true });
      if (error) throw error;
      return data as ConsentVersion[];
    },
  });
}

const patientConsentsKey = (patientId: string) => ["patient-consents", patientId];

/**
 * The caller's own recorded consents — every accepted/withdrawn event, oldest
 * first. Spec §31.15: consent obtained, purpose (consent_type), date
 * (accepted_at), version, and now withdrawal (action).
 */
export function usePatientConsents(patientId: string) {
  return useQuery({
    queryKey: patientConsentsKey(patientId),
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_consents")
        .select("*")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as PatientConsent[];
    },
    enabled: !!patientId,
  });
}

/**
 * Reduces the full event history down to current status per consent_type —
 * the most recent row wins, mirroring exactly what
 * private.has_required_consents (20260829092000) computes in the database.
 * Kept as a pure function so the two can be tested against the same cases.
 */
export function currentConsentStatus(
  events: PatientConsent[],
): Map<ConsentType, PatientConsent> {
  const latest = new Map<ConsentType, PatientConsent>();
  for (const event of events) {
    const existing = latest.get(event.consent_type);
    if (!existing || new Date(event.created_at) >= new Date(existing.created_at)) {
      latest.set(event.consent_type, event);
    }
  }
  return latest;
}

export function isCurrentlyWithdrawn(events: PatientConsent[], type: ConsentType): boolean {
  const status = currentConsentStatus(events).get(type);
  return status?.action === "withdrawn";
}

/**
 * Records a withdrawal. consent_version_id/version are best-effort here (the
 * currently-in-force acceptance's own values, already in hand from
 * usePatientConsents) but are NOT the source of truth — the DB trigger
 * (private.enforce_patient_consent_withdrawal) overwrites both from the
 * acceptance it independently looks up server-side, and rejects the insert
 * outright if there is no acceptance currently in force to withdraw. This
 * mutation never trusts its own inputs to actually land; it only supplies
 * them because the column is NOT NULL with no default.
 */
export function useWithdrawPatientConsent(patientId: string, organisationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      consentType,
      currentConsentVersionId,
      currentVersion,
    }: {
      consentType: ConsentType;
      currentConsentVersionId: string;
      currentVersion: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.from("patient_consents").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        consent_type: consentType,
        action: "withdrawn",
        consent_version_id: currentConsentVersionId,
        version: currentVersion,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patientConsentsKey(patientId) });
    },
  });
}

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

/**
 * Client side of the W-53 doctor-review gate (see `lib/clinical/doctor-review-claim.ts` for the server side and the reasoning). True only when
 * `public.patient_has_feature_access(patient, 'vitals_red_flag_doctor_escalation')` answers true. Loading, an error and an unauthorised ask
 * all read as NOT true, so a patient is never told a doctor is involved on the strength of nothing.
 */
export const doctorReviewKey = (patientId: string) => ["doctor-review", patientId];

export function useDoctorReview(patientId: string): boolean {
  const { data } = useQuery({
    queryKey: doctorReviewKey(patientId),
    queryFn: async () => {
      const { data: allowed, error } = await createClient().rpc("patient_has_feature_access", {
        p_patient_id: patientId,
        p_feature: "vitals_red_flag_doctor_escalation",
      });
      return !error && allowed === true;
    },
    enabled: !!patientId,
    staleTime: 5 * 60_000,
  });
  return data === true;
}

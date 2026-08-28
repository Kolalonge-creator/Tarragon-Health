import { useMutation } from "@tanstack/react-query";
import {
  callRpc,
  type MedicationSafetyAlertTypeCode,
} from "@/lib/supabase/pending-schema-overrides";

export type { MedicationSafetyAlertTypeCode };

/**
 * Persists a drug-safety finding (from lib/rules/drug-safety.ts) as a real
 * clinician_alerts row via public.raise_medication_safety_alert (13.9's
 * "clinician-raised only, no mechanism yet" generator gap — see
 * 20260828021620_medication_safety_manual_alert_rpc.sql). Advisory only: this
 * never blocks or reverses the prescription it's raised from, it just gives
 * a finding a persistent, trackable clinical task.
 */
export function useRaiseMedicationSafetyAlert() {
  return useMutation({
    mutationFn: async (input: {
      patientId: string;
      medicationId: string;
      typeCode: MedicationSafetyAlertTypeCode;
      severity: "contraindicated" | "caution";
      message: string;
    }) => {
      const { data, error } = await callRpc<string>("raise_medication_safety_alert", {
        p_patient_id: input.patientId,
        p_medication_id: input.medicationId,
        p_type_code: input.typeCode,
        p_severity: input.severity,
        p_message: input.message,
      });
      if (error) throw error;
      return data;
    },
  });
}

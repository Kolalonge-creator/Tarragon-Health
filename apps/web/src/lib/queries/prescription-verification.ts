import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type PrescriptionVerification = {
  drug_name: string;
  dose: string | null;
  frequency: string | null;
  route: string | null;
  quantity: string | null;
  duration_days: number | null;
  repeats_allowed: number;
  repeats_used: number;
  indication: string | null;
  instructions: string | null;
  status: string;
  signed_at: string;
  expires_at: string | null;
  version: number;
  prescriber_name: string;
  patient_name: string;
};

/**
 * §62.7 prescription verification, any pharmacy — public.verify_prescription()
 * (20260829011500_verify_prescription.sql). SECURITY DEFINER, restricted to
 * role=pharmacist and requires both the rx_number and the verification_code
 * printed/shown on the prescription; a wrong code or an unauthorised caller
 * gets zero rows back, never an error that would distinguish the two.
 */
export function useVerifyPrescription() {
  return useMutation({
    mutationFn: async ({
      rxNumber,
      verificationCode,
    }: {
      rxNumber: string;
      verificationCode: string;
    }) => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("verify_prescription", {
        p_rx_number: rxNumber,
        p_verification_code: verificationCode,
      });
      if (error) throw error;
      const result = (data as PrescriptionVerification[] | null)?.[0] ?? null;
      if (!result) {
        throw new Error("No matching prescription found — check the Rx number and code and try again.");
      }
      return result;
    },
  });
}

import { useMutation } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { loose } from "@/lib/clinician/loose-client";
import { deskVerifySchema, dispenseResultSchema, type DeskVerification, type DispenseResult } from "./model";

/**
 * S28 counter desk. Both calls run as the signed-in pharmacist through SECURITY DEFINER functions that check the pharmacy, the code and
 * the supply count in the database; an error is shown, never swallowed. A wrong code is an ANSWER (outcome wrong_code), not an error, so
 * the database keeps its count of wrong tries.
 */
export function useVerifyCollection() {
  return useMutation({
    mutationFn: async ({ prescription, code }: { prescription: string; code: string }): Promise<DeskVerification> => {
      const { data, error } = await loose(createClient()).rpc("pharmacist_verify_collection", { p_prescription: prescription, p_code: code });
      if (error) throw error;
      const parsed = deskVerifySchema.safeParse((data as unknown[] | null)?.[0]);
      if (!parsed.success) throw new Error("Unexpected answer from the server.");
      return parsed.data;
    },
  });
}

export function useDispensePrescription() {
  return useMutation({
    mutationFn: async (input: {
      prescription: string; code: string; quantity: string; partial: boolean; note: string; batch: string; expiry: string; registration: string; pharmacist: string;
    }): Promise<DispenseResult> => {
      const { data, error } = await loose(createClient()).rpc("pharmacist_dispense_prescription", {
        p_prescription: input.prescription,
        p_code: input.code,
        p_quantity: input.quantity.trim() || null,
        p_is_partial: input.partial,
        p_outstanding_note: input.partial ? input.note.trim() : null,
        p_batch: input.batch.trim() || null,
        p_expiry: input.expiry || null,
        p_registration: input.registration.trim(),
        p_pharmacist_name: input.pharmacist.trim(),
      });
      if (error) throw error;
      const parsed = dispenseResultSchema.safeParse((data as unknown[] | null)?.[0]);
      if (!parsed.success) throw new Error("Unexpected answer from the server.");
      return parsed.data;
    },
  });
}

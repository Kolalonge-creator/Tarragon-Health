import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { loose } from "@/lib/clinician/loose-client";
import { deskVerifySchema, dispenseResultSchema, pharmacyQuestionsSchema, type DeskVerification, type DispenseResult, type PharmacyQuestionRow } from "./model";

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

/** The questions this pharmacy asked on one of its own prescriptions, with the prescriber's fixed answer (S28c). */
export function usePrescriptionQuestions(prescription: string) {
  return useQuery({
    queryKey: ["pharmacy-questions", prescription],
    queryFn: async (): Promise<PharmacyQuestionRow[]> => {
      const { data, error } = await loose(createClient()).rpc("pharmacist_prescription_questions", { p_prescription: prescription });
      if (error) throw error;
      const parsed = pharmacyQuestionsSchema.safeParse(data);
      if (!parsed.success) throw new Error("Unexpected answer from the server.");
      return parsed.data;
    },
  });
}

/** One of the six fixed questions to the prescriber. No free text: the database refuses anything else. */
export function useAskPrescriber(prescription: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (question: string): Promise<void> => {
      const { error } = await loose(createClient()).rpc("pharmacist_ask_prescriber", { p_prescription: prescription, p_question: question });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pharmacy-questions", prescription] }),
  });
}

/** "We cannot supply this": a fixed notice. The patient is told neutrally and can choose another pharmacy. */
export function useReportOutOfStock(prescription: string) {
  return useMutation({
    mutationFn: async (): Promise<void> => {
      const { error } = await loose(createClient()).rpc("pharmacist_report_out_of_stock", { p_prescription: prescription });
      if (error) throw error;
    },
  });
}

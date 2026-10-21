"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { stockOutcomeSchema, type StockOutcome } from "./model";

const formSchema = z.object({ prescription: z.string().uuid(), answer: z.enum(["yes", "no"]) });

/**
 * S28e: the pharmacy's stock answer for one prescription sent to it: "we have this" (yes) or "we cannot supply this" (no). A yes or a no, nothing else:
 * no quantity and no price (OQ-283). Runs as the signed-in pharmacist; public.pharmacist_confirm_stock checks that the prescription was sent to THIS
 * pharmacy, refuses a controlled medicine, turns a no into the existing out-of-stock report (so the patient is told and can choose another pharmacy)
 * and audits it. The result rides in the address as a short code, never the patient or the medicine.
 */
export async function confirmStockAction(formData: FormData): Promise<void> {
  const parsed = formSchema.safeParse({ prescription: formData.get("prescription"), answer: formData.get("answer") });
  if (!parsed.success) return redirect("/pharmacist/prescriptions?s=failed");
  const { data, error } = await loose(await createClient()).rpc("pharmacist_confirm_stock", {
    p_prescription: parsed.data.prescription,
    p_in_stock: parsed.data.answer === "yes",
  });
  const outcome = stockOutcomeSchema.safeParse(data);
  const note: StockOutcome | "failed" = error || !outcome.success ? "failed" : outcome.data;
  return redirect(`/pharmacist/prescriptions?s=${note}`);
}

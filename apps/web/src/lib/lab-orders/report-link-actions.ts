"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { linkErrorMessage } from "@/lib/lab-orders/report-link";

const linkSchema = z.object({
  documentId: z.string().uuid(),
  // null records "this report answers no test request" (the automatic matcher then leaves it alone)
  labOrderId: z.string().uuid().nullable(),
  patientId: z.string().uuid().optional(),
});

export type LinkReportResult = { error?: string; success?: boolean; orderStatus?: string | null };

/**
 * Sets, changes or clears the test request a report answers. Runs on the caller's own session: the database function
 * (public.link_clinical_document_to_lab_order) decides who may link (the patient for their own document, or staff of the
 * patient's organisation), refuses another patient's or a cancelled request, and closes the request itself when the
 * linked report is already filed. Nothing here trusts the browser for any of that.
 */
export async function linkReportToLabOrder(input: {
  documentId: string;
  labOrderId: string | null;
  patientId?: string;
}): Promise<LinkReportResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in again to continue." };

  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return { error: "That request could not be read. Try again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_clinical_document_to_lab_order", {
    p_document: parsed.data.documentId,
    p_lab_order: parsed.data.labOrderId,
  });
  if (error) return { error: linkErrorMessage(error) };

  const result = (data ?? {}) as { order_status?: string | null };
  revalidatePath("/patient/labs");
  if (parsed.data.patientId) revalidatePath(`/clinician/patients/${parsed.data.patientId}`);
  return { success: true, orderStatus: result.order_status ?? null };
}

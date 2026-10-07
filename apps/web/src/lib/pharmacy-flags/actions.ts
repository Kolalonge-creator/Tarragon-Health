"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { flagFormSchema, REASON_MIN, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/pharmacist/prescriptions?n=${n}`);

/**
 * S36h: a partner pharmacy flags a problem on a prescription sent to it. Runs as the signed-in pharmacist (never the service role);
 * public.pharmacist_flag_prescription is the only writer and refuses any other pharmacy, any prescription not waiting at this pharmacy,
 * and a reason outside 10 to 500 characters. It never changes the prescription and never dispenses.
 */
export async function flagPrescriptionAction(formData: FormData): Promise<void> {
  const parsed = flagFormSchema.safeParse({
    prescription: formData.get("prescription"),
    kind: formData.get("kind"),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) {
    const reasonLen = String(formData.get("reason") ?? "").trim().length;
    return back(reasonLen < REASON_MIN || reasonLen > 500 ? "flag_reason" : "flag_failed");
  }
  const { error } = await loose(await createClient()).rpc("pharmacist_flag_prescription", {
    p_prescription: parsed.data.prescription,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
  });
  if (error) {
    if (error.message.includes("pharmacy_flag_not_open")) return back("flag_not_open");
    if (error.message.includes("pharmacy_flag_reason")) return back("flag_reason");
    return back("flag_failed");
  }
  return back("flagged");
}

"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { noticeForError, phoneTicketSchema, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/clinician/support-tickets?pn=${n}`);

/** Logs a phone call as a support ticket. Staff only (the database refuses anyone else); a call about symptoms or medicines also opens a clinical review item. */
export async function logPhoneTicketAction(formData: FormData): Promise<void> {
  const parsed = phoneTicketSchema.safeParse({
    phone: formData.get("phone"),
    subject: formData.get("subject"),
    description: formData.get("description"),
    priority: formData.get("priority") ?? "normal",
    clinical: formData.get("clinical") === "on",
  });
  if (!parsed.success) return back("bad_input");
  const { error } = await loose(await createClient()).rpc("log_phone_support_ticket", {
    p_patient_phone: parsed.data.phone,
    p_subject: parsed.data.subject,
    p_description: parsed.data.description,
    p_priority: parsed.data.priority,
    p_clinical_content: parsed.data.clinical,
  });
  if (error) return back(noticeForError(error.code));
  return back(parsed.data.clinical ? "logged_clinical" : "logged");
}

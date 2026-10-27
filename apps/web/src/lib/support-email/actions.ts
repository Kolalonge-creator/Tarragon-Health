"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { emailTicketSchema, noticeForError, type Notice } from "./model";

const back = (n: Notice): never => redirect(`/clinician/support-tickets?en=${n}`);

/** Logs a pasted email as a support ticket. Staff only (the database refuses anyone else); an email about symptoms or medicines also opens a clinical review item. */
export async function logEmailTicketAction(formData: FormData): Promise<void> {
  const parsed = emailTicketSchema.safeParse({
    email: formData.get("email"),
    sender: formData.get("sender"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    priority: formData.get("priority") ?? "normal",
    clinical: formData.get("clinical") === "on",
  });
  if (!parsed.success) return back("bad_input");
  const { error } = await loose(await createClient()).rpc("log_email_support_ticket", {
    p_patient_email: parsed.data.email,
    p_sender: parsed.data.sender,
    p_subject: parsed.data.subject,
    p_body: parsed.data.body,
    p_priority: parsed.data.priority,
    p_clinical_content: parsed.data.clinical,
  });
  if (error) return back(noticeForError(error.code));
  return back(parsed.data.clinical ? "logged_clinical" : "logged");
}

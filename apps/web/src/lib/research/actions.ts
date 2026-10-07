"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { createFormSchema, type Notice } from "./model";

const back = (path: string, n: Notice): never => redirect(`${path}?n=${n}`);
const deniedOrFailed = (e: { code?: string; message: string }): Notice => (e.code === "42501" || /not authorised/i.test(e.message) ? "denied" : "failed");

export async function createResearchProtocolAction(formData: FormData): Promise<void> {
  const parsed = createFormSchema.safeParse({
    title: formData.get("title"), question: formData.get("question"), method: formData.get("method"),
    recipient: formData.get("recipient"), recipient_type: formData.get("recipient_type"),
    ethics_ref: String(formData.get("ethics_ref") ?? ""), ethics_body: String(formData.get("ethics_body") ?? ""),
    ethics_date: String(formData.get("ethics_date") ?? ""), agreement: String(formData.get("agreement") ?? ""),
    fields: formData.getAll("fields").map(String),
  });
  if (!parsed.success) return back("/clinician/research", "failed");
  const v = parsed.data;
  const { error } = await loose(await createClient()).rpc("create_research_protocol", {
    p_title: v.title, p_question: v.question, p_allowed_fields: v.fields, p_de_identification_method: v.method,
    p_recipient_name: v.recipient, p_recipient_type: v.recipient_type,
    p_ethics_approval_ref: v.ethics_ref || null, p_ethics_body: v.ethics_body || null,
    p_ethics_approved_on: v.ethics_date || null, p_data_sharing_agreement_ref: v.agreement || null,
  });
  if (error) return back("/clinician/research", deniedOrFailed(error));
  return back("/clinician/research", "created");
}

export async function approveResearchProtocolAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back("/clinician/research", "failed");
  const { error } = await loose(await createClient()).rpc("approve_research_protocol", { p_id: id });
  if (error) return back("/clinician/research", deniedOrFailed(error));
  return back("/clinician/research", "approved");
}

export async function confirmResearchProtocolDpoAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return back("/admin/settings/research", "failed");
  const { error } = await loose(await createClient()).rpc("confirm_research_protocol_dpo", { p_id: id });
  if (error) return back("/admin/settings/research", deniedOrFailed(error));
  return back("/admin/settings/research", "approved");
}

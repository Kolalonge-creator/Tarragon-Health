"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { loadLetterConfig, SCOPE_CODES } from "@/lib/records-request/letter";

export type RecordsRequestActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: "invalid" | "not_signed_in" | "not_open" | "not_found" | "failed" };

const createSchema = z.object({
  facility: z.string().trim().min(2).max(160),
  contact: z.string().trim().max(200).optional(),
  scope: z.array(z.enum(SCOPE_CODES)).min(1).max(SCOPE_CODES.length),
  note: z.string().trim().max(500).optional(),
});
const idSchema = z.string().uuid();
const noteSchema = z.object({ id: z.string().uuid(), note: z.string().trim().max(500) });

/** Postgres error text for "the guard is off" (errcode 55000) and "no such request" (P0002), mapped to a calm result the screen can word. */
function mapError(error: { code?: string; message?: string }): RecordsRequestActionResult {
  if (error.code === "55000") return { ok: false, error: "not_open" };
  if (error.code === "P0002") return { ok: false, error: "not_found" };
  if (error.code === "22023") return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}

/** Prepares a request. The database refuses while the `records_request_letters` guard is off. Nothing is sent to anyone. */
export async function createRecordsRequestAction(input: {
  facility: string;
  contact?: string;
  scope: string[];
  note?: string;
}): Promise<RecordsRequestActionResult> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { letterVersionKey } = loadLetterConfig();
  const { data, error } = await supabase.rpc("create_records_request", {
    p_facility: parsed.data.facility,
    p_contact: parsed.data.contact ? parsed.data.contact : null,
    p_scope: parsed.data.scope,
    p_letter_version: letterVersionKey,
    p_note: parsed.data.note ? parsed.data.note : null,
  });
  if (error) return mapError(error);
  revalidatePath("/patient/records-requests");
  const id = (data as { id?: string } | null)?.id;
  return { ok: true, id };
}

/** The person says they handed the letter over. The reply date is the configured placeholder period, a reminder and not a legal deadline. */
export async function markRecordsRequestSentAction(id: string): Promise<RecordsRequestActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { responseDays } = loadLetterConfig();
  const { error } = await supabase.rpc("mark_records_request_sent", { p_id: id, p_response_days: responseDays });
  if (error) return mapError(error);
  revalidatePath("/patient/records-requests");
  revalidatePath(`/patient/records-requests/${id}`);
  return { ok: true, id };
}

export async function markRecordsRequestReceivedAction(id: string): Promise<RecordsRequestActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_records_request_received", { p_id: id });
  if (error) return mapError(error);
  revalidatePath("/patient/records-requests");
  revalidatePath(`/patient/records-requests/${id}`);
  return { ok: true, id };
}

export async function withdrawRecordsRequestAction(id: string): Promise<RecordsRequestActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_records_request", { p_id: id });
  if (error) return mapError(error);
  revalidatePath("/patient/records-requests");
  revalidatePath(`/patient/records-requests/${id}`);
  return { ok: true, id };
}

export async function setRecordsRequestNoteAction(input: { id: string; note: string }): Promise<RecordsRequestActionResult> {
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_records_request_note", { p_id: parsed.data.id, p_note: parsed.data.note ? parsed.data.note : null });
  if (error) return mapError(error);
  revalidatePath(`/patient/records-requests/${parsed.data.id}`);
  return { ok: true, id: parsed.data.id };
}

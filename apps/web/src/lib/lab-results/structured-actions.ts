"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Json } from "@tarragon/shared";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  attemptSchema,
  correctionSchema,
  describeLabError,
  disclosureSchema,
  LAB_RESULT_BUCKET,
  LAB_RESULT_EXT,
  refusalOf,
  releaseSchema,
  releasedResultsSchema,
  type ReleasedResultRow,
  reviewResultSchema,
  type ReviewResult,
  resultEntrySchema,
  toPanelUnits,
  validateLabResultFile,
  withholdSchema,
} from "@/lib/lab-results/structured";

export type LabActionState = { error?: string; success?: boolean } | undefined;

type StoredFile = { file_path: string; original_filename: string; mime_type: string; file_size_bytes: number };

/** Stores the file in the private bucket under the patient's folder. Only the server ever reads or signs it. */
async function storeFile(patientId: string, file: File): Promise<StoredFile | { error: string }> {
  const bad = validateLabResultFile(file);
  if (bad) return { error: bad };
  const path = `${patientId}/${randomUUID()}.${LAB_RESULT_EXT[file.type] ?? "bin"}`;
  const { error } = await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: "The file could not be stored. Please try again." };
  return { file_path: path, original_filename: file.name.slice(0, 200), mime_type: file.type, file_size_bytes: file.size };
}

async function removeFile(path: string): Promise<void> {
  await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).remove([path]);
}

/** A partner lab marks the sample collected (own provider's orders only; the database checks). */
export async function markOrderCollected(orderId: string): Promise<LabActionState> {
  if (!/^[0-9a-f-]{36}$/.test(orderId)) return { error: "That order could not be found." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("lab_partner_mark_collected", { p_order: orderId });
  if (error) return { error: describeLabError(error) };
  revalidatePath("/lab-partner/results");
  return { success: true };
}

/**
 * A partner lab submits structured values and, optionally, the report PDF. The partner sends analyte, value and unit
 * only: the database fixes the range and the flag, so a flag typed by the lab would have nowhere to go.
 */
export async function submitPartnerResult(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };

  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "The values could not be read. Please try again." };
  }
  const parsed = resultEntrySchema.safeParse({ orderId: String(formData.get("order_id") ?? ""), panel: String(formData.get("panel") ?? ""), items: itemsRaw });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const converted = toPanelUnits(parsed.data.items);
  if ("error" in converted) return { error: converted.error };

  const supabase = await createClient();
  const file = formData.get("file");
  let stored: StoredFile | null = null;
  if (file instanceof File && file.size > 0) {
    const { data: patientId } = await supabase.rpc("lab_partner_order_patient", { p_order_id: parsed.data.orderId });
    if (!patientId) return { error: "You do not have access to that." };
    const s = await storeFile(patientId, file);
    if ("error" in s) return { error: s.error };
    stored = s;
  }

  const { error } = await supabase.rpc("lab_partner_submit_result", {
    p_order: parsed.data.orderId,
    p_panel: parsed.data.panel,
    p_items: converted.items as unknown as Json,
    p_file: (stored ?? undefined) as unknown as Json,
  });
  if (error) {
    if (stored) await removeFile(stored.file_path);
    return { error: describeLabError(error) };
  }
  revalidatePath("/lab-partner/results");
  return { success: true };
}

/** A patient adds a result they already hold. It is held for the care team; nothing is read from it automatically. */
export async function addOwnLabResult(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Please choose a PDF, JPG or PNG." };
  const s = await storeFile(user.id, file);
  if ("error" in s) return { error: s.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("patient_add_lab_result", { p_file: s as unknown as Json });
  if (error) {
    await removeFile(s.file_path);
    return { error: describeLabError(error) };
  }
  revalidatePath("/patient/labs");
  return { success: true };
}

/** Signed link to a result file, only for the patient it belongs to and only when it has been released (or they added it). */
export async function getOwnResultFileUrl(resultId: string): Promise<{ url?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(resultId)) return { error: "Not found." };
  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("lab_result_file_path", { p_result: resultId });
  if (error || !path) return { error: "Not found." };
  const { data } = await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).createSignedUrl(path, 60);
  return data?.signedUrl ? { url: data.signedUrl } : { error: "Not found." };
}

/** A clinician opens the file of a result they are tied to. The audited read is the gate; this signs what it returned. */
export async function getReviewFileUrl(resultId: string): Promise<{ url?: string; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(resultId)) return { error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lab_result_for_review", { p_result: resultId, p_reason: "Opening the lab report file for review" });
  const path = (data as { file_path?: string | null } | null)?.file_path;
  if (error || refusalOf(data) || !path) return { error: "Not found." };
  const signed = await createServiceRoleClient().storage.from(LAB_RESULT_BUCKET).createSignedUrl(path, 60);
  return signed.data?.signedUrl ? { url: signed.data.signedUrl } : { error: "Not found." };
}

export async function releaseResult(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const parsed = releaseSchema.safeParse({ resultId: String(formData.get("result_id") ?? ""), note: String(formData.get("note") ?? "") || undefined });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_lab_result", { p_result: parsed.data.resultId, p_note: parsed.data.note });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

export async function withholdResult(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const parsed = withholdSchema.safeParse({ resultId: String(formData.get("result_id") ?? ""), reason: String(formData.get("reason") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withhold_lab_result", { p_result: parsed.data.resultId, p_reason: parsed.data.reason });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

export async function recordDisclosure(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const parsed = disclosureSchema.safeParse({
    resultId: String(formData.get("result_id") ?? ""),
    method: String(formData.get("method") ?? ""),
    attested: formData.get("attested") === "on" ? true : undefined,
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_lab_disclosure", {
    p_result: parsed.data.resultId,
    p_method: parsed.data.method,
    p_attested: true,
    p_note: parsed.data.note,
  });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

const READ_REASON = "Reviewing a lab result held for my review";

/** Opens one held result for the tied clinician. This is the audited read (INV-10): it happens on a click, once per open. */
export async function openLabResult(resultId: string): Promise<{ result?: ReviewResult; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(resultId)) return { error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lab_result_for_review", { p_result: resultId, p_reason: READ_REASON });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  const parsed = reviewResultSchema.safeParse(data);
  return parsed.success ? { result: parsed.data } : { error: "That result could not be read. Please try again." };
}

/** The senior clinician logs one try at reaching the patient. After the configured number, the CMO is told; nothing is ever released by default. */
export async function recordDisclosureAttempt(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const parsed = attemptSchema.safeParse({
    resultId: String(formData.get("result_id") ?? ""),
    outcome: String(formData.get("outcome") ?? ""),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_lab_disclosure_attempt", {
    p_result: parsed.data.resultId,
    p_outcome: parsed.data.outcome,
    p_note: parsed.data.note,
  });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

/** A senior clinician withdraws a released result (wrong patient, lab error). The patient gets a neutral notice. */
export async function withdrawResult(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const parsed = withholdSchema.safeParse({ resultId: String(formData.get("result_id") ?? ""), reason: String(formData.get("reason") ?? "") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_lab_result", { p_result: parsed.data.resultId, p_reason: parsed.data.reason });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  revalidatePath("/clinician/lab-results");
  return { success: true };
}

/** A partner lab sends a correction to a result it already sent. It goes through the same release rules as a new result. */
export async function submitPartnerCorrection(_prev: LabActionState, formData: FormData): Promise<LabActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  let itemsRaw: unknown;
  try {
    itemsRaw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "The values could not be read. Please try again." };
  }
  const parsed = correctionSchema.safeParse({
    orderId: String(formData.get("order_id") ?? ""),
    panel: String(formData.get("panel") ?? ""),
    items: itemsRaw,
    correctsResultId: String(formData.get("corrects_result_id") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const converted = toPanelUnits(parsed.data.items);
  if ("error" in converted) return { error: converted.error };

  const supabase = await createClient();
  const file = formData.get("file");
  let stored: StoredFile | null = null;
  if (file instanceof File && file.size > 0) {
    const { data: patientId } = await supabase.rpc("lab_partner_order_patient", { p_order_id: parsed.data.orderId });
    if (!patientId) return { error: "You do not have access to that." };
    const s = await storeFile(patientId, file);
    if ("error" in s) return { error: s.error };
    stored = s;
  }
  const { error } = await supabase.rpc("lab_partner_submit_correction", {
    p_order: parsed.data.orderId,
    p_corrects: parsed.data.correctsResultId,
    p_kind: parsed.data.kind,
    p_reason: parsed.data.reason,
    p_panel: parsed.data.panel,
    p_items: converted.items as unknown as Json,
    p_file: (stored ?? undefined) as unknown as Json,
  });
  if (error) {
    if (stored) await removeFile(stored.file_path);
    return { error: describeLabError(error) };
  }
  revalidatePath("/lab-partner/results");
  return { success: true };
}

/**
 * A Lab Liaison Officer, clinician or admin records a result file for a patient (the emailed-result path). It is stored privately and
 * recorded as a HELD result: the patient sees nothing and is told nothing until a clinician has reviewed it (INV-03). The older
 * path wrote a visible document and announced it at once.
 */
export async function submitTeamResult(patientId: string, labOrderId: string | undefined, file: File): Promise<LabActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Please sign in again." };
  if (!/^[0-9a-f-]{36}$/.test(patientId) || (labOrderId !== undefined && !/^[0-9a-f-]{36}$/.test(labOrderId))) return { error: "That patient could not be found." };
  const stored = await storeFile(patientId, file);
  if ("error" in stored) return { error: stored.error };
  const supabase = await createClient();
  const { error } = await supabase.rpc("team_submit_lab_result", {
    p_patient: patientId,
    p_order: (labOrderId ?? null) as unknown as string,
    p_panel: null as unknown as string,
    p_items: null as unknown as Json,
    p_file: stored as unknown as Json,
  });
  if (error) {
    await removeFile(stored.file_path);
    return { error: describeLabError(error) };
  }
  return { success: true };
}

/** A senior clinician lists a tied patient's released results, to withdraw one. A click, one audited read per open. */
export async function listReleasedLabResults(patientId: string): Promise<{ results?: ReleasedResultRow[]; error?: string }> {
  if (!/^[0-9a-f-]{36}$/.test(patientId)) return { error: "Not found." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("patient_released_lab_results", { p_patient: patientId, p_reason: "Looking for a released lab result to withdraw" });
  if (error) return { error: describeLabError(error) };
  const refused = refusalOf(data);
  if (refused) return { error: refused };
  if (data && typeof data === "object" && "error" in data && (data as { error: unknown }).error === "senior_only") {
    return { error: "Only a senior clinician can withdraw a released result." };
  }
  const parsed = releasedResultsSchema.safeParse(data);
  return parsed.success ? { results: parsed.data.results } : { error: "That list could not be read. Please try again." };
}

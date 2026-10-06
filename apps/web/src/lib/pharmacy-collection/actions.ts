"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/server";
import {
  collectionErrorKey,
  dispenseReasonText,
  parseDetail,
  parsePharmacyOptions,
  parseSendResult,
  staffErrorText,
  type PharmacyOption,
  type PharmacyPrescriptionDetail,
  type PrescriberOverview,
  parseOverview,
} from "@/lib/pharmacy-collection/collection";

/**
 * S28 server actions. Every one runs as the signed-in person on the normal server client: the database functions
 * check who is calling (the patient who owns the prescription, or a pharmacist at the pharmacy it was sent to), so
 * nothing here widens what a person can do and nothing uses the service role.
 */

const Id = z.string().uuid();
/** `beneficiaryId` is set only while acting for someone: the database checks the manage_pharmacy permission, this only passes it on. */
const SendInput = z.object({ prescriptionId: Id, partnerId: Id, consent: z.boolean(), beneficiaryId: Id.optional() });

export type OptionsResult = { ok: true; options: PharmacyOption[] } | { ok: false; key: MessageKey };
export type SendResult = { ok: true; code: string; pharmacyName: string } | { ok: false; key: MessageKey };

export async function loadPharmacyOptions(prescriptionId: unknown, beneficiaryId?: unknown): Promise<OptionsResult> {
  const id = Id.safeParse(prescriptionId);
  const who = beneficiaryId == null ? null : Id.safeParse(beneficiaryId);
  if (!id.success || (who && !who.success)) return { ok: false, key: "pharmacy.error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacies_for_prescription", {
    p_prescription: id.data,
    ...(who?.success ? { p_beneficiary: who.data } : {}),
  });
  if (error) return { ok: false, key: collectionErrorKey(error.message) };
  const options = parsePharmacyOptions(data);
  if (!options) return { ok: false, key: "pharmacy.error" };
  return { ok: true, options };
}

async function route(kind: "send" | "reroute", input: unknown): Promise<SendResult> {
  const parsed = SendInput.safeParse(input);
  if (!parsed.success) return { ok: false, key: "pharmacy.error" };
  // The tick-box is the consent: refuse here too so a missing tick never reaches the database as true.
  if (parsed.data.consent !== true) return { ok: false, key: "pharmacy.error.consent" };
  const supabase = await createClient();
  const args = {
    p_prescription: parsed.data.prescriptionId,
    p_partner: parsed.data.partnerId,
    p_consent: true,
    ...(parsed.data.beneficiaryId ? { p_beneficiary: parsed.data.beneficiaryId } : {}),
  };
  const { data, error } =
    kind === "send"
      ? await supabase.rpc("send_prescription_to_pharmacy", args)
      : await supabase.rpc("reroute_prescription_pharmacy", args);
  if (error) return { ok: false, key: collectionErrorKey(error.message) };
  const sent = parseSendResult(data);
  if (!sent) return { ok: false, key: "pharmacy.error" };
  revalidatePath("/patient/medications");
  return { ok: true, code: sent.code, pharmacyName: sent.pharmacyName };
}

export async function sendToPharmacy(input: unknown): Promise<SendResult> {
  return route("send", input);
}

export async function reroutePharmacy(input: unknown): Promise<SendResult> {
  return route("reroute", input);
}

export type WithdrawResult = { ok: true; key: MessageKey } | { ok: false; key: MessageKey };

/** "Take it back": consent to share is revocable. The pharmacy stops seeing the prescription at once. */
export async function withdrawFromPharmacy(prescriptionId: unknown, beneficiaryId?: unknown): Promise<WithdrawResult> {
  const id = Id.safeParse(prescriptionId);
  const who = beneficiaryId == null ? null : Id.safeParse(beneficiaryId);
  if (!id.success || (who && !who.success)) return { ok: false, key: "pharmacy.error" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("withdraw_prescription_from_pharmacy", {
    p_prescription: id.data,
    ...(who?.success ? { p_beneficiary: who.data } : {}),
  });
  if (error) return { ok: false, key: collectionErrorKey(error.message) };
  if (!z.object({ ok: z.literal(true) }).safeParse(data).success) return { ok: false, key: "pharmacy.error" };
  revalidatePath("/patient/medications");
  return { ok: true, key: "pharmacy.withdraw.done" };
}

// ---- Pharmacy staff ---------------------------------------------------------------------------------------------------------------------------

export type DetailResult = { ok: true; detail: PharmacyPrescriptionDetail } | { ok: false; error: string };

/** Opening a prescription is audited by the database (INV-10): this is called when the pharmacist clicks one, never in bulk. */
export async function openPharmacyPrescription(prescriptionId: unknown): Promise<DetailResult> {
  const id = Id.safeParse(prescriptionId);
  if (!id.success) return { ok: false, error: "That prescription could not be found at your pharmacy." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_prescription_detail", { p_prescription: id.data });
  if (error) return { ok: false, error: staffErrorText(error.message) };
  const detail = parseDetail(data);
  if (!detail) return { ok: false, error: "That prescription could not be read. Please try again." };
  return { ok: true, detail };
}

const DispenseInput = z.object({
  prescriptionId: Id,
  code: z.string().trim().min(4).max(20),
  pharmacistName: z.string().trim().min(2).max(120),
  registration: z.string().trim().max(40).optional(),
  quantity: z.string().trim().max(100).optional(),
  batchNumber: z.string().trim().min(1).max(60),
  batchExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  partial: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

export type StaffResult = { ok: true; partial?: boolean } | { ok: false; error: string };

export async function dispensePrescription(input: unknown): Promise<StaffResult> {
  const parsed = DispenseInput.safeParse(input);
  if (!parsed.success) {
    const missingBatch = parsed.error.issues.some((i) => i.path[0] === "batchNumber" || i.path[0] === "batchExpiry");
    return { ok: false, error: dispenseReasonText(missingBatch ? "batch_required" : "invalid") };
  }
  const d = parsed.data;
  if (d.partial && !d.note) return { ok: false, error: "Please say what is still outstanding." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pharmacy_mark_dispensed", {
    p_prescription: d.prescriptionId,
    p_collection_code: d.code,
    p_pharmacist_name: d.pharmacistName,
    ...(d.registration ? { p_pharmacist_registration: d.registration } : {}),
    ...(d.quantity ? { p_quantity_supplied: d.quantity } : {}),
    p_batch_number: d.batchNumber,
    p_batch_expiry: d.batchExpiry,
    p_is_partial: d.partial === true,
    ...(d.note ? { p_note: d.note } : {}),
  });
  if (error) return { ok: false, error: staffErrorText(error.message) };
  const result = z.object({ ok: z.boolean(), reason: z.string().optional(), partial: z.boolean().optional() }).safeParse(data);
  // An unreadable answer is never treated as "recorded".
  if (!result.success) return { ok: false, error: "That could not be recorded. Please try again." };
  if (!result.data.ok) return { ok: false, error: dispenseReasonText(result.data.reason) };
  revalidatePath("/pharmacist/prescriptions");
  return { ok: true, partial: result.data.partial === true };
}

const FlagInput = z.discriminatedUnion("kind", [
  z.object({ prescriptionId: Id, kind: z.literal("out_of_stock") }),
  z.object({ prescriptionId: Id, kind: z.literal("query_to_prescriber"), reason: z.enum(["dose_unclear", "strength_unavailable", "substitute_needed", "allergy_or_interaction", "details_do_not_match", "call_me"]) }),
]);

/** A question to the prescriber is one of a fixed list (no free text). Out of stock needs no reason. */
export async function flagPrescription(input: unknown): Promise<StaffResult> {
  const parsed = FlagInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: staffErrorText("reason_required") };
  const supabase = await createClient();
  const { error } = await supabase.rpc("pharmacy_flag_prescription", {
    p_prescription: parsed.data.prescriptionId,
    p_kind: parsed.data.kind,
    ...(parsed.data.kind === "query_to_prescriber" ? { p_reason: parsed.data.reason } : {}),
  });
  if (error) return { ok: false, error: staffErrorText(error.message) };
  revalidatePath("/pharmacist/prescriptions");
  return { ok: true };
}

// ---- The prescriber ---------------------------------------------------------------------------------------------------------------------------

export type OverviewResult = { ok: true; overview: PrescriberOverview } | { ok: false; error: string };

/** One audited read (INV-10): the pharmacy questions and where each prescription this clinician signed has got to. */
export async function loadPrescriberOverview(): Promise<OverviewResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("prescriber_pharmacy_overview");
  if (error) return { ok: false, error: staffErrorText(error.message) };
  const overview = parseOverview(data);
  if (!overview) return { ok: false, error: "That could not be read. Please try again." };
  return { ok: true, overview };
}

const AnswerInput = z.object({ questionId: Id, answer: z.enum(["keep_as_written", "new_prescription_coming", "patient_to_contact_us"]) });

export async function answerPharmacyQuestion(input: unknown): Promise<StaffResult> {
  const parsed = AnswerInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: staffErrorText("invalid_answer") };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("answer_pharmacy_question", { p_question: parsed.data.questionId, p_answer: parsed.data.answer });
  if (error) return { ok: false, error: staffErrorText(error.message) };
  const result = z.object({ ok: z.boolean(), reason: z.string().optional() }).safeParse(data);
  // An unreadable answer is never treated as "answered".
  if (!result.success) return { ok: false, error: "That could not be recorded. Please try again." };
  if (!result.data.ok) return { ok: false, error: result.data.reason === "already_answered" ? "That question has already been answered." : "That could not be recorded. Please try again." };
  revalidatePath("/clinician/pharmacy");
  return { ok: true };
}

import { z } from "zod";
import type { MessageKey } from "@tarragon/i18n";

/**
 * S28: what the pharmacy collection functions return, parsed. Anything unreadable becomes "no data" and is never
 * treated as good news (a malformed collection state must not look like "nothing to do").
 */

export const StockSchema = z.enum(["in_stock", "low_stock", "unavailable", "unknown"]);
export type Stock = z.infer<typeof StockSchema>;

const PharmacyOptionSchema = z.object({
  pharmacy_partner_id: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  area: z.string().nullable(),
  stock: StockSchema,
  is_preferred: z.boolean(),
});
export type PharmacyOption = z.infer<typeof PharmacyOptionSchema>;

export function parsePharmacyOptions(data: unknown): PharmacyOption[] | null {
  const parsed = z.array(PharmacyOptionSchema).safeParse(data);
  return parsed.success ? parsed.data : null;
}

const MyPharmacySchema = z.discriminatedUnion("sent", [
  z.object({ sent: z.literal(false), state: z.string() }),
  z.object({
    sent: z.literal(true),
    state: z.enum(["sent", "dispensed", "cancelled", "signed"]),
    pharmacy_name: z.string(),
    pharmacy_area: z.string().nullable().optional(),
    collection_code: z.string().nullable().optional(),
    needs_other_pharmacy: z.boolean(),
  }),
]);
export type MyPharmacy = z.infer<typeof MyPharmacySchema>;

export function parseMyPharmacy(data: unknown): MyPharmacy | null {
  const parsed = MyPharmacySchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const SendResultSchema = z.object({ collection_code: z.string().length(8), pharmacy_name: z.string() });
export function parseSendResult(data: unknown): { code: string; pharmacyName: string } | null {
  const parsed = SendResultSchema.safeParse(data);
  return parsed.success ? { code: parsed.data.collection_code, pharmacyName: parsed.data.pharmacy_name } : null;
}

/** The database raises a short code as its message; the screen shows plain words, never the code itself. */
export function collectionErrorKey(message: string | null | undefined): MessageKey {
  const m = message ?? "";
  if (m.includes("consent_required")) return "pharmacy.error.consent";
  if (m.includes("pharmacy_not_available") || m.includes("same_pharmacy")) return "pharmacy.error.unavailable";
  if (m.includes("prescription_not_current")) return "pharmacy.error.not_current";
  if (m.includes("not_permitted_for_this_person")) return "pharmacy.error.not_permitted";
  if (m.includes("prescription_not_waiting") || m.includes("prescription_not_sendable")) return "pharmacy.error.not_waiting";
  return "pharmacy.error";
}

/** A medicine line the patient already sees in her own record: the names only, never doses or reasons. */
export function medicineNames(items: unknown): string[] {
  const parsed = z.array(z.object({ drug_name: z.string() }).passthrough()).safeParse(items);
  return parsed.success ? parsed.data.map((i) => i.drug_name) : [];
}

// ---- The pharmacy side (staff screens, plain English like the other partner screens) -------------------------------------------------------

const DetailSchema = z.object({
  prescription_id: z.string().uuid(),
  collection_code: z.string().nullable(),
  state: z.enum(["sent", "dispensed"]),
  sent_at: z.string().nullable(),
  dispensed_at: z.string().nullable(),
  signed_at: z.string().nullable(),
  signed_by_name: z.string().nullable(),
  patient: z.object({ full_name: z.string().nullable(), age_years: z.number().nullable() }),
  allergies: z.array(z.object({ allergen: z.string(), reaction: z.string().nullable(), severity: z.string().nullable() })),
  items: z.array(
    z
      .object({
        drug_name: z.string(),
        dose: z.string().nullish(),
        frequency: z.string().nullish(),
        route: z.string().nullish(),
        duration_days: z.number().nullish(),
        quantity: z.string().nullish(),
        repeats_allowed: z.number().nullish(),
        instructions: z.string().nullish(),
        indication: z.string().nullish(),
      })
      .passthrough(),
  ),
  questions: z
    .array(
      z.object({
        asked_at: z.string(),
        reason_code: z.string(),
        answered_at: z.string().nullable(),
        answer_code: z.string().nullable(),
      }),
    )
    .default([]),
  supplies_recorded: z.number(),
  supplies_permitted: z.number(),
  is_test: z.boolean(),
});
export type PharmacyPrescriptionDetail = z.infer<typeof DetailSchema>;

export function parseDetail(data: unknown): PharmacyPrescriptionDetail | null {
  const parsed = DetailSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

const InboxRowSchema = z.object({
  prescription_id: z.string().uuid(),
  collection_code: z.string().nullable(),
  state: z.enum(["sent", "dispensed"]),
  sent_at: z.string().nullable(),
  dispensed_at: z.string().nullable(),
  first_name: z.string().nullable(),
  medicine_count: z.number().int().nonnegative(),
  has_open_flag: z.boolean(),
  is_test: z.boolean(),
});
export type InboxRow = z.infer<typeof InboxRowSchema>;

/** An unreadable inbox is a failed read, never an empty list: an empty list would read as "nothing is waiting". */
export function parseInbox(data: unknown): InboxRow[] | null {
  const parsed = z.array(InboxRowSchema).safeParse(data ?? []);
  return parsed.success ? parsed.data : null;
}

/**
 * The only questions a pharmacy can put to a prescriber, and the only answers back. A fixed list, no free text: the pharmacy and the
 * clinician do not chat (decision, S28). An answer never changes a signed prescription; a different medicine is a new signed one.
 */
export const QUESTION_REASONS: Record<string, string> = {
  dose_unclear: "The dose or directions are unclear",
  strength_unavailable: "The strength is not available",
  substitute_needed: "A substitute may be needed",
  allergy_or_interaction: "A possible allergy or interaction",
  details_do_not_match: "The details do not match the patient",
  call_me: "Please call the pharmacy",
};
export const ANSWER_TEXT: Record<string, string> = {
  keep_as_written: "Supply it as written",
  new_prescription_coming: "A new prescription is coming",
  patient_to_contact_us: "The patient will be asked to contact the care team",
};
export function questionText(code: string | null | undefined): string {
  return (code && QUESTION_REASONS[code]) || "A question from the pharmacy";
}
export function answerText(code: string | null | undefined): string {
  return (code && ANSWER_TEXT[code]) || "Answered";
}

const OverviewSchema = z.object({
  questions: z.array(
    z.object({
      question_id: z.string().uuid(),
      prescription_id: z.string().uuid(),
      asked_at: z.string(),
      pharmacy_name: z.string(),
      reason_code: z.string(),
      patient_name: z.string().nullable(),
      medicines: z.array(z.string()),
      answered_at: z.string().nullable(),
      answer_code: z.string().nullable(),
    }),
  ),
  collection: z.array(
    z.object({
      prescription_id: z.string().uuid(),
      state: z.enum(["sent", "dispensed"]),
      patient_name: z.string().nullable(),
      sent_at: z.string().nullable(),
      dispensed_at: z.string().nullable(),
      pharmacy_name: z.string(),
      medicines: z.array(z.string()),
    }),
  ),
});
export type PrescriberOverview = z.infer<typeof OverviewSchema>;

/** An unreadable overview is a failed read: an empty list would read as "no pharmacy has asked anything". */
export function parseOverview(data: unknown): PrescriberOverview | null {
  const parsed = OverviewSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export const DISPENSE_REASONS: Record<string, string> = {
  code_mismatch: "That code does not match. Check it with the patient and try again.",
  too_many_attempts: "Too many wrong codes. Please wait ten minutes, then try again.",
  not_waiting: "This prescription is no longer waiting at your pharmacy.",
  no_supply_available: "The permitted supplies for this prescription have already been recorded.",
  not_active: "This prescription is no longer active.",
  not_linked: "This prescription could not be matched to a medicine record. Please contact Tarragon Health.",
  invalid: "Please check the pharmacist name, registration, quantity and batch fields.",
  batch_required: "Please enter the batch number and its expiry date. They are your record of what was handed over.",
  batch_expired: "That batch has already expired, so it cannot be recorded as supplied.",
};

export function dispenseReasonText(reason: unknown): string {
  return (typeof reason === "string" && DISPENSE_REASONS[reason]) || "That could not be recorded. Please try again.";
}

export function staffErrorText(message: string | null | undefined): string {
  const m = message ?? "";
  if (m.includes("pharmacy_collection_off")) return "Pharmacy collection is not switched on yet.";
  if (m.includes("pharmacy_not_active")) return "Your pharmacy is not active for collection right now. Please contact Tarragon Health.";
  if (m.includes("prescription_not_found")) return "That prescription could not be found at your pharmacy.";
  if (m.includes("reason_required")) return "Please choose what you need to ask the prescriber.";
  if (m.includes("invalid_answer")) return "Please choose one of the answers.";
  if (m.includes("question_not_found")) return "That question could not be found.";
  if (m.includes("This is for clinicians")) return "This page is for clinicians.";
  return "That could not be done. Please try again.";
}

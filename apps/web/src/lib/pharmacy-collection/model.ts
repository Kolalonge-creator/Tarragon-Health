import { z } from "zod";

/**
 * S28: shapes and rules for choosing a pharmacy to collect from and for the counter desk. Pure: no I/O.
 * The database is the protection (only the owner chooses, only verified pharmacies, the code is checked and locked there); these checks
 * only give a clear message first.
 */
export const CHOOSE_ERRORS = ["pharmacy_not_available", "collection_already_started", "collection_not_open", "pharmacy_collection_off", "not_permitted_for_this_person"] as const;
export type ChooseError = (typeof CHOOSE_ERRORS)[number];

export const NOTICES = ["chosen", "new_code", "withdrawn", "failed", ...CHOOSE_ERRORS] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

/** Maps a database error message to the notice the patient sees; anything unknown is a plain failure that changed nothing. */
export function noticeForError(message: string | undefined): Notice {
  const hit = CHOOSE_ERRORS.find((e) => message?.includes(e));
  return hit ?? "failed";
}

/** `for` is the person a caregiver acts for (S28c): the database checks the pharmacy permission, tells the patient and records who acted. */
export const chooseFormSchema = z.object({
  prescription: z.string().uuid(),
  partner: z.string().uuid(),
  location: z.string().uuid(),
  for: z.string().uuid().optional(),
});
export const prescriptionOnlySchema = z.object({ prescription: z.string().uuid(), for: z.string().uuid().optional() });

export const pharmacyOptionSchema = z.object({
  partner_id: z.string().uuid(),
  partner_name: z.string(),
  location_id: z.string().uuid(),
  location_name: z.string(),
  state: z.string().nullable(),
  address: z.string().nullable(),
});
export type PharmacyOption = z.infer<typeof pharmacyOptionSchema>;
export const pharmacyOptionsSchema = z.array(pharmacyOptionSchema);

export const collectionSchema = z.object({
  state: z.string(),
  pharmacy_name: z.string().nullable(),
  location_name: z.string().nullable(),
  address: z.string().nullable(),
  code: z.string().nullable(),
  code_expires_at: z.string().nullable(),
  locked: z.boolean().nullable(),
  expired: z.boolean().nullable(),
  collected: z.boolean().nullable(),
  can_repeat: z.boolean().nullable(),
  other_pharmacy_needed: z.boolean().nullable(),
});
export type Collection = z.infer<typeof collectionSchema>;
export const collectionRowsSchema = z.array(collectionSchema);

/** What the patient screen should offer for a prescription in this state. */
export type CollectionView = "choose" | "code" | "collected" | "repeat" | "closed";
export function viewFor(c: Collection): CollectionView {
  // collected, and the medicine still permits another supply (a repeat): she can send it again, as a new send with a new code
  if ((c.collected || c.state === "dispensed") && c.can_repeat) return "repeat";
  if (c.collected || c.state === "dispensed") return "collected";
  if (c.state === "sent") return "code";
  if (c.state === "signed") return "choose";
  return "closed";
}

// ---- the counter desk (pharmacist) ----
export const DESK_OUTCOMES = ["ok", "not_found", "expired", "locked", "wrong_code", "already_collected"] as const;
export const DISPENSE_OUTCOMES = [
  "recorded", "partial_recorded", "not_found", "expired", "locked", "wrong_code", "already_collected",
  "invalid", "not_active", "no_supply_available", "no_medication", "batch_required", "batch_expired",
] as const;
export type DispenseOutcome = (typeof DISPENSE_OUTCOMES)[number];

export const deskVerifySchema = z.object({
  outcome: z.string(),
  patient_name: z.string().nullable(),
  patient_number: z.string().nullable(),
  items: z.array(z.record(z.string(), z.unknown())).nullable(),
  allergies: z.array(z.object({ allergen: z.string().nullable(), reaction: z.string().nullable(), severity: z.string().nullable() })).nullable(),
  supplies_dispensed: z.number(),
  supplies_permitted: z.number(),
  outstanding_note: z.string().nullable(),
});
export type DeskVerification = z.infer<typeof deskVerifySchema>;

export const dispenseResultSchema = z.object({ outcome: z.string(), supplies_dispensed: z.number(), supplies_permitted: z.number() });
export type DispenseResult = z.infer<typeof dispenseResultSchema>;

// Mirrors the database: a partial supply needs a written outstanding note of 5 to 300 characters; a pharmacist registration is 3 to 40 characters.
export const NOTE_MIN = 5;
export const NOTE_MAX = 300;
export const REG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /.\-]{1,38}[A-Za-z0-9]$/;

export function dispenseProblem(input: { partial: boolean; note: string; registration: string; pharmacist: string; batch?: string; expiry?: string }): "registration" | "pharmacist" | "note" | "batch" | null {
  if (!REG_PATTERN.test(input.registration.trim())) return "registration";
  // S28c: the batch and its expiry are the pharmacy's own record of what it handed over, required for any supply
  if (input.batch !== undefined && (input.batch.trim() === "" || !input.expiry)) return "batch";
  const who = input.pharmacist.trim().length;
  if (who < 2 || who > 120) return "pharmacist";
  const n = input.note.trim().length;
  if (input.partial && (n < NOTE_MIN || n > NOTE_MAX)) return "note";
  return null;
}

// ---- S28c: the questions a pharmacy may ask the prescriber, and the answers back. A fixed list, no free text: the pharmacy and the
// clinician do not chat. An answer never changes a signed prescription; a different medicine is a new signed one. ----
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
export const questionText = (code: string | null | undefined): string => (code && QUESTION_REASONS[code]) || "A question from the pharmacy";
export const answerText = (code: string | null | undefined): string => (code && ANSWER_TEXT[code]) || "Answered";

export const pharmacyQuestionsSchema = z.array(
  z.object({ asked_at: z.string(), question_code: z.string().nullable(), answered_at: z.string().nullable(), answer_code: z.string().nullable() }),
);
export type PharmacyQuestionRow = z.infer<typeof pharmacyQuestionsSchema>[number];

export const overviewSchema = z.object({
  questions: z.array(
    z.object({
      question_id: z.string().uuid(), prescription_id: z.string().uuid(), asked_at: z.string(), pharmacy_name: z.string(), reason_code: z.string(),
      patient_name: z.string().nullable(), medicines: z.array(z.string()), answered_at: z.string().nullable(), answer_code: z.string().nullable(),
    }),
  ),
  collection: z.array(
    z.object({
      prescription_id: z.string().uuid(), state: z.enum(["sent", "dispensed"]), patient_name: z.string().nullable(), sent_at: z.string().nullable(),
      dispensed_at: z.string().nullable(), pharmacy_name: z.string(), medicines: z.array(z.string()),
    }),
  ),
  earlier: z.array(
    z.object({
      flag_id: z.string().uuid(), patient_name: z.string().nullable(), pharmacy_name: z.string().nullable(), kind: z.string(), reason: z.string(),
      created_at: z.string(), items: z.array(z.record(z.string(), z.unknown())),
    }),
  ),
});
export type PrescriberOverview = z.infer<typeof overviewSchema>;
/** An unreadable overview is a failed read: an empty list would read as "no pharmacy has asked anything". */
export function parseOverview(data: unknown): PrescriberOverview | null {
  const parsed = overviewSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

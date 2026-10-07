import { z } from "zod";

/**
 * S28: shapes and rules for choosing a pharmacy to collect from and for the counter desk. Pure: no I/O.
 * The database is the protection (only the owner chooses, only verified pharmacies, the code is checked and locked there); these checks
 * only give a clear message first.
 */
export const CHOOSE_ERRORS = ["pharmacy_not_available", "collection_already_started", "collection_not_open"] as const;
export type ChooseError = (typeof CHOOSE_ERRORS)[number];

export const NOTICES = ["chosen", "new_code", "failed", ...CHOOSE_ERRORS] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

/** Maps a database error message to the notice the patient sees; anything unknown is a plain failure that changed nothing. */
export function noticeForError(message: string | undefined): Notice {
  const hit = CHOOSE_ERRORS.find((e) => message?.includes(e));
  return hit ?? "failed";
}

export const chooseFormSchema = z.object({
  prescription: z.string().uuid(),
  partner: z.string().uuid(),
  location: z.string().uuid(),
});
export const prescriptionOnlySchema = z.object({ prescription: z.string().uuid() });

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
});
export type Collection = z.infer<typeof collectionSchema>;
export const collectionRowsSchema = z.array(collectionSchema);

/** What the patient screen should offer for a prescription in this state. */
export type CollectionView = "choose" | "code" | "collected" | "closed";
export function viewFor(c: Collection): CollectionView {
  if (c.collected || c.state === "dispensed") return "collected";
  if (c.state === "sent") return "code";
  if (c.state === "signed") return "choose";
  return "closed";
}

// ---- S54 8.9: the price and stock comparison the patient sees before choosing ----
export const priceLineSchema = z.object({
  item: z.number(),
  drug: z.string(),
  pack: z.string().nullable(),
  price_kobo: z.number(),
  stock: z.string(),
  verified_batch: z.boolean(),
  strength_confirmed: z.boolean(),
});
export const priceRowSchema = z.object({
  partner_id: z.string().uuid(),
  partner_name: z.string(),
  location_id: z.string().uuid(),
  location_name: z.string(),
  state: z.string().nullable(),
  address: z.string().nullable(),
  items_total: z.number(),
  items_matched: z.number(),
  total_kobo: z.number(),
  all_in_stock: z.boolean(),
  any_low_stock: z.boolean(),
  all_verified_batch: z.boolean(),
  prices_updated_at: z.string().nullable(),
  lines: z.array(priceLineSchema),
});
export type PriceRow = z.infer<typeof priceRowSchema>;
export const priceRowsSchema = z.array(priceRowSchema);

/** Money is integer kobo everywhere; this is only for showing it. */
export function nairaFromKobo(kobo: number): string {
  const naira = Math.round(kobo) / 100;
  return `\u20A6${naira.toLocaleString("en-NG", { minimumFractionDigits: naira % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export type StockLabelKey = "pharmprice.in_stock" | "pharmprice.low_stock" | "pharmprice.unavailable" | "pharmprice.unknown_stock";
export function stockKey(stock: string): StockLabelKey {
  if (stock === "in_stock") return "pharmprice.in_stock";
  if (stock === "low_stock") return "pharmprice.low_stock";
  if (stock === "unavailable") return "pharmprice.unavailable";
  return "pharmprice.unknown_stock";
}

// ---- the counter desk (pharmacist) ----
export const DESK_OUTCOMES = ["ok", "not_found", "expired", "locked", "wrong_code", "already_collected"] as const;
export const DISPENSE_OUTCOMES = [
  "recorded", "partial_recorded", "not_found", "expired", "locked", "wrong_code", "already_collected",
  "invalid", "not_active", "no_supply_available", "no_medication",
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

export function dispenseProblem(input: { partial: boolean; note: string; registration: string; pharmacist: string }): "registration" | "pharmacist" | "note" | null {
  if (!REG_PATTERN.test(input.registration.trim())) return "registration";
  const who = input.pharmacist.trim().length;
  if (who < 2 || who > 120) return "pharmacist";
  const n = input.note.trim().length;
  if (input.partial && (n < NOTE_MIN || n > NOTE_MAX)) return "note";
  return null;
}

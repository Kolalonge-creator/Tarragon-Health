import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { collectionRowsSchema, pharmacyOptionsSchema, priceRowsSchema, suggestionRowsSchema, type Collection, type PharmacyOption, type PriceRow, type Suggestion } from "./model";

/** `off` means the go-live guard is closed (S37): a calm "not open yet" rather than a failure. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean; off?: boolean };

const beneficiary = (forWhom?: string) => (forWhom ? { p_beneficiary: forWhom } : {});
const failure = (error: { code?: string; message?: string }): { ok: false; denied: boolean; off: boolean } => ({
  ok: false,
  denied: error.code === "42501",
  off: (error.message ?? "").includes("pharmacy_collection_off"),
});

/** A failed read is a load failure the screen says so, never an empty list. `forWhom`: a caregiver acting for the patient. */
export async function loadCollection(prescription: string, forWhom?: string): Promise<Loaded<Collection | null>> {
  const { data, error } = await loose(await createClient()).rpc("patient_prescription_collection", { p_prescription: prescription, ...beneficiary(forWhom) });
  if (error) return failure(error);
  const parsed = collectionRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data[0] ?? null } : { ok: false, denied: false };
}

export async function loadPharmacies(prescription: string, forWhom?: string): Promise<Loaded<PharmacyOption[]>> {
  const { data, error } = await loose(await createClient()).rpc("patient_collection_pharmacies", { p_prescription: prescription, ...beneficiary(forWhom) });
  if (error) return failure(error);
  const parsed = pharmacyOptionsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** The comparison is a courtesy: if it fails the patient can still choose, so a failure is returned, never an empty table. */
export async function loadPriceCompare(prescription: string): Promise<Loaded<PriceRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("patient_price_compare", { p_prescription: prescription });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = priceRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** S54c: the pharmacy the care team suggested, if any. A failure is returned, never shown as "no suggestion". */
export async function loadSuggestion(prescription: string): Promise<Loaded<Suggestion | null>> {
  const { data, error } = await loose(await createClient()).rpc("patient_pharmacy_suggestion", { p_prescription: prescription });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = suggestionRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data[0] ?? null } : { ok: false, denied: false };
}

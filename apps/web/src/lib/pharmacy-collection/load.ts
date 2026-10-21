import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import {
  collectionRowsSchema, overviewItemsSchema, pharmacyOptionsSchema, priceRowsSchema, suggestionRowsSchema, visitMembersSchema,
  type Collection, type OverviewItem, type PharmacyOption, type PriceRow, type Suggestion, type VisitMember,
} from "./model";

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

/** S28e: her other waiting prescriptions, for the "send these together" tick boxes. A failed read just hides the ticks: she can still send this one. */
export async function loadOverview(forWhom?: string): Promise<Loaded<OverviewItem[]>> {
  const { data, error } = await loose(await createClient()).rpc("patient_collection_overview", { ...beneficiary(forWhom) });
  if (error) return failure(error);
  const parsed = overviewItemsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** S28e: the prescriptions sent in the same visit as this one (empty when it was sent on its own). A failure is returned, never shown as "only this one". */
export async function loadVisit(prescription: string, forWhom?: string): Promise<Loaded<VisitMember[]>> {
  const { data, error } = await loose(await createClient()).rpc("patient_collection_visit", { p_prescription: prescription, ...beneficiary(forWhom) });
  if (error) return failure(error);
  const parsed = visitMembersSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/**
 * OQ-276: whether the prescription names a controlled medicine, so the patient is told before choosing a pharmacy. Advisory only: the counter refuses it
 * either way, so a failed read shows no note rather than blocking the page.
 */
export async function loadHasControlledItem(prescription: string, forWhom?: string): Promise<boolean> {
  const { data, error } = await loose(await createClient()).rpc("patient_prescription_has_controlled_item", { p_prescription: prescription, ...beneficiary(forWhom) });
  return !error && data === true;
}

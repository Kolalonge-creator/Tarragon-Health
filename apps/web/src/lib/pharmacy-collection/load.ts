import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { collectionRowsSchema, pharmacyOptionsSchema, type Collection, type PharmacyOption } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean };

/** A failed read is a load failure the screen says so, never an empty list. */
export async function loadCollection(prescription: string): Promise<Loaded<Collection | null>> {
  const { data, error } = await loose(await createClient()).rpc("patient_prescription_collection", { p_prescription: prescription });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = collectionRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data[0] ?? null } : { ok: false, denied: false };
}

export async function loadPharmacies(prescription: string): Promise<Loaded<PharmacyOption[]>> {
  const { data, error } = await loose(await createClient()).rpc("patient_collection_pharmacies", { p_prescription: prescription });
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = pharmacyOptionsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { pharmacyPrescriptionRowsSchema, prescriberFlagRowsSchema, type PharmacyPrescriptionRow, type PrescriberFlagRow } from "./model";

export type Loaded<T> = { ok: true; data: T } | { ok: false; denied: boolean; off?: boolean };

/** A failed read is a load failure the screen says so, never an empty list. */
export async function loadPharmacyPrescriptions(): Promise<Loaded<PharmacyPrescriptionRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("pharmacist_prescriptions", {});
  // S28c: "off" means the go-live guard is closed: a calm "not open yet", not a failure
  if (error) return { ok: false, denied: error.code === "42501", off: (error.message ?? "").includes("pharmacy_collection_off") };
  const parsed = pharmacyPrescriptionRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

/** The prescriber's read of flags is a logged read (INV-10): this runs once per page view. */
export async function loadPrescriberFlags(): Promise<Loaded<PrescriberFlagRow[]>> {
  const { data, error } = await loose(await createClient()).rpc("clinician_pharmacy_flags", {});
  if (error) return { ok: false, denied: error.code === "42501" };
  const parsed = prescriberFlagRowsSchema.safeParse(data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, denied: false };
}

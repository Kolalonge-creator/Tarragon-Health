"use server";

import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { readMedicationPack, isPackVisionConfigured, type PackReading } from "./pack-vision";
import { checkPackAgainstPrescription, type PackCheckResult } from "./pack-check";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/heic"];

export type PackCheckActionResult =
  | { error: string }
  | { ok: true; reading: PackReading; check: PackCheckResult };

/**
 * A patient photographs a pack they just bought; we read it and compare it
 * against what they were prescribed.
 *
 * STATELESS ON PURPOSE. Nothing is stored: no image, no reading, no result.
 * A pack check is a moment's reassurance, not a clinical record, and creating a
 * permanent row of "patient photographed a box" would be new PHI for no benefit.
 * If the check finds a discrepancy the patient is pointed at their care team
 * through the existing in-app messaging, which IS on the record.
 *
 * Nothing here raises an alert automatically. A strength discrepancy read off a
 * photo is exactly the kind of judgement that must reach a human before it
 * becomes a clinical event.
 */
export async function checkMedicationPack(formData: FormData): Promise<PackCheckActionResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not signed in" };

  if (!isPackVisionConfigured()) {
    return { error: "Pack checking is not set up on this environment yet." };
  }

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Take or choose a photo of the pack." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That photo is too large. Try one under 8MB." };
  }
  if (!ALLOWED.includes(file.type)) {
    return { error: "Use a photo (JPEG, PNG, WEBP or HEIC)." };
  }

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const result = await readMedicationPack({ imageBase64, mediaType: file.type });

  if (!result.ok) {
    return {
      error:
        result.reason === "unavailable"
          ? "Pack checking is not set up on this environment yet."
          : "That photo could not be read. Try again in better light, straight on.",
    };
  }

  // The patient's own medicines, read through their own session.
  const supabase = await createClient();
  const { data: medications } = await supabase
    .from("medications")
    .select("id, drug_name, dose")
    .eq("patient_id", user.id)
    .eq("is_active", true);

  const check = checkPackAgainstPrescription(
    { drugName: result.reading.drug_name, strength: result.reading.strength },
    (medications ?? []).map((m) => ({ id: m.id, drugName: m.drug_name, dose: m.dose })),
  );

  return { ok: true, reading: result.reading, check };
}

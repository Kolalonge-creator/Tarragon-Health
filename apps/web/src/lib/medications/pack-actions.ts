"use server";

import { getCurrentUser, createClient } from "@/lib/supabase/server";
import { readMedicationPack, PACK_VISION_MODEL_ID, type PackReading } from "./pack-vision";
import { checkPackAgainstPrescription, type PackCheckResult } from "./pack-check";
import { AI_SYSTEMS, governedModelId, runGovernedAi } from "@/lib/ai-governance";

const MAX_BYTES = 8 * 1024 * 1024;
// HEIC/HEIF deliberately excluded: Anthropic's vision API only accepts
// jpeg/png/gif/webp, so a HEIC photo (the default iPhone camera format) was
// silently forwarded to readMedicationPack, always failed the model call,
// and surfaced as the generic "not available" fallback below — not a format
// problem the patient could tell from that message.
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

type PackReadingOutcome = { ok: true; reading: PackReading } | { ok: false };

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

  // No early "not configured" return: a missing ANTHROPIC_API_KEY must reach the governed run below, where
  // readMedicationPack answers `unavailable` and the audit row records a degraded fallback. An early return wrote
  // no audit row, so the ai_call_failures ops alert could not see a revoked or missing key.
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Take or choose a photo of the pack." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "That photo is too large. Try one under 8MB." };
  }
  if (file.type === "image/heic" || file.type === "image/heif") {
    return {
      error:
        "That photo format (HEIC) can't be read here. On iPhone, open Settings, then Camera, then Formats, and choose \"Most Compatible\", then take the photo again, or choose an existing JPEG or PNG photo instead.",
    };
  }
  if (!ALLOWED.includes(file.type)) {
    return { error: "Use a photo (JPEG, PNG or WEBP)." };
  }

  const imageBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  // The patient's own session — also what the AI-007 governance check and the
  // audit row are written through.
  const supabase = await createClient();

  // AI-007. Fallback is the path that has always existed and is never removed:
  // the patient reads the pack themselves and types the details in.
  const governed = await runGovernedAi<PackReadingOutcome>({
    supabase,
    systemCode: AI_SYSTEMS.medicationPackVision.code,
    inputCategory: "medication_pack_photo",
    subjectProfileId: user.id,
    run: async ({ config }) => {
      // The same id is sent and audited, so a drift shows up in ai_vendor_model_observations (40.19).
      const modelId = governedModelId(config, PACK_VISION_MODEL_ID);
      const read = await readMedicationPack({ imageBase64, mediaType: file.type, modelId });
      return {
        value: read.ok ? { ok: true as const, reading: read.reading } : { ok: false as const },
        modelIdentifier: modelId,
        // The pack check is stateless by design (see this function's
        // docstring), so the audit row records what was read at the level of
        // "a name and a strength", not the photo or the patient's medicines.
        // An unreadable photo is a legitimate answer (ok: true with an
        // unreadable_reason), recorded as a completed interaction. ok: false
        // means the model was not reached or failed (`unavailable` | `error`),
        // so it is a degraded fallback carrying the reason, which is what the
        // ai_call_failures ops alert counts.
        outputSummary: read.ok
          ? `read drug_name=${read.reading.drug_name ?? "none"}, strength=${read.reading.strength ?? "none"}`
          : "model_error",
        resultingAction: read.ok ? "pack_read_for_patient_confirmation" : "none",
        degradedReason: read.ok ? null : `vision_${read.reason}`,
      };
    },
    fallback: () => ({ ok: false as const }),
  });

  if (!governed.value.ok) {
    return {
      error:
        governed.fallbackReason === "kill_switch"
          ? "Pack checking is switched off just now. Check the pack against your prescription yourself, and message your care team if anything looks different."
          : governed.status === "fallback"
            ? "Pack checking is not available just now. Check the pack against your prescription yourself."
            : "That photo could not be read. Try again in better light, straight on.",
    };
  }

  const result = { ok: true as const, reading: governed.value.reading };
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

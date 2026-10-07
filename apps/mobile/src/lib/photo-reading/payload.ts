import type { CuffType, PhotoReadingKind } from "@tarragon/shared";
import type { PhotoCapturePayload } from "../api";
import { validateBpEntry, validateOtherEntry, type GlucoseUnit } from "../vitals-entry";

/**
 * S70 (18.3): turns what the patient confirmed on the photo screen into the payload the vitals API takes.
 *
 * The bounds are the manual-entry bounds (vitals-entry.ts), the same typo gates a typed reading meets, so a photo reading is no
 * more and no less plausible than a typed one. The payload carries `capture_method: "photo"` and nothing about the image.
 */
export interface PhotoFormInput {
  kind: PhotoReadingKind;
  systolic: string;
  diastolic: string;
  pulse: string;
  value: string;
  glucoseUnit: GlucoseUnit;
  glucoseContext: "fasting" | "pre_meal" | "post_meal" | "bedtime" | "night" | "random";
  cuffType?: CuffType;
  /** The patient's tick: "these numbers match my device's screen". No tick, no reading. */
  confirmedMatches: boolean;
}

export type PhotoPayloadResult =
  | { ok: true; payload: PhotoCapturePayload }
  | { ok: false; error: "not_confirmed" | "numbers" | "range" | "order" | "pulse_range" | "value_range" };

export function buildPhotoPayload(input: PhotoFormInput): PhotoPayloadResult {
  if (!input.confirmedMatches) return { ok: false, error: "not_confirmed" };

  if (input.kind === "blood_pressure") {
    const bp = validateBpEntry(input.systolic, input.diastolic);
    if (!bp.ok) return { ok: false, error: bp.error };
    return {
      ok: true,
      payload: {
        vital_type: "blood_pressure",
        systolic: bp.systolic,
        diastolic: bp.diastolic,
        ...(input.cuffType ? { cuff_type: input.cuffType } : {}),
        capture_method: "photo",
      },
    };
  }

  const type = input.kind;
  const entry = validateOtherEntry(type, input.value, input.glucoseUnit);
  if (!entry.ok) return { ok: false, error: entry.error === "number" ? "numbers" : "value_range" };
  const n = entry.value;
  switch (type) {
    case "glucose":
      return { ok: true, payload: { vital_type: "glucose", glucose_value: n, glucose_unit: input.glucoseUnit, glucose_context: input.glucoseContext, capture_method: "photo" } };
    case "weight":
      return { ok: true, payload: { vital_type: "weight", weight_kg: n, capture_method: "photo" } };
    case "temperature":
      return { ok: true, payload: { vital_type: "temperature", temperature_c: n, capture_method: "photo" } };
    case "spo2":
      return { ok: true, payload: { vital_type: "spo2", spo2_pct: n, capture_method: "photo" } };
    case "pulse":
      return { ok: true, payload: { vital_type: "pulse", pulse_bpm: n, capture_method: "photo" } };
  }
}

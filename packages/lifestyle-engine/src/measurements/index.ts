/**
 * Measurement ingestion — validation + the source-of-truth guard (spec §8).
 *
 * Plausibility ranges come straight from the signed pathways (spec §8.2).
 * Implausible values are REJECTED (ask to re-check), never silently dropped.
 */
import {
  measurementInputSchema,
  type MeasurementInput,
} from "../types/index";

export interface ValidationResult {
  ok: boolean;
  /** Machine reason key for a re-check prompt (never a clinical verdict). */
  reason?: string;
}

function num(json: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = json?.[key];
  return typeof v === "number" ? v : undefined;
}

/** Per-type plausibility (spec §8.2). Unknown types pass structurally. */
function plausible(m: MeasurementInput): ValidationResult {
  switch (m.type) {
    case "bp": {
      const sys = num(m.valueJson, "sys");
      const dia = num(m.valueJson, "dia");
      if (sys === undefined || dia === undefined) return { ok: false, reason: "bp_incomplete" };
      if (sys < 60 || sys > 260) return { ok: false, reason: "bp_sys_range" };
      if (dia < 30 || dia > 160) return { ok: false, reason: "bp_dia_range" };
      if (sys <= dia) return { ok: false, reason: "bp_sys_not_gt_dia" };
      return { ok: true };
    }
    case "glucose": {
      const v = m.valueNum;
      if (v === undefined) return { ok: false, reason: "glucose_missing" };
      if (v < 1 || v > 40) return { ok: false, reason: "glucose_range" };
      return { ok: true };
    }
    case "weight": {
      const v = m.valueNum;
      if (v === undefined) return { ok: false, reason: "weight_missing" };
      if (v < 25 || v > 400) return { ok: false, reason: "weight_range" };
      return { ok: true };
    }
    case "waist": {
      const v = m.valueNum;
      if (v === undefined) return { ok: false, reason: "waist_missing" };
      if (v < 30 || v > 250) return { ok: false, reason: "waist_range" };
      return { ok: true };
    }
    case "ketones": {
      const v = m.valueNum;
      if (v === undefined) return { ok: false, reason: "ketones_missing" };
      if (v < 0 || v > 8) return { ok: false, reason: "ketones_range" };
      return { ok: true };
    }
    case "mood": {
      const v = m.valueNum ?? num(m.valueJson, "scale");
      if (v === undefined) return { ok: true }; // free-form PHQ payloads allowed
      if (v < 1 || v > 5) return { ok: false, reason: "mood_range" };
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

/**
 * Validate an inbound measurement.
 *
 * HARD RULE (spec §4.3, CLAUDE.md): a measurement can never originate from
 * WhatsApp. The `source` enum excludes it at the type level; this is the
 * runtime backstop for untyped callers (e.g. a raw webhook body).
 */
export function validateMeasurement(raw: unknown): ValidationResult {
  const parsed = measurementInputSchema.safeParse(raw);
  if (!parsed.success) {
    // Defensive: reject anything claiming a whatsapp source with a clear reason.
    if (
      typeof raw === "object" &&
      raw !== null &&
      (raw as { source?: unknown }).source === "whatsapp"
    ) {
      return { ok: false, reason: "whatsapp_is_not_a_log_source" };
    }
    return { ok: false, reason: "schema_invalid" };
  }
  return plausible(parsed.data);
}

export { measurementInputSchema } from "../types/index";

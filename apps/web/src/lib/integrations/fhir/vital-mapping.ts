import type { Database } from "@tarragon/shared";

/**
 * The one place `vital_type -> vitals_readings column` is mapped. Both
 * parse-resource.ts (server-only, does the actual mapping when building
 * normalized_payload) and fhir-review-queue.tsx (a client component
 * rendering that payload) import this instead of each re-deriving the same
 * mapping independently — closes a /code-review high finding: a
 * hand-written duplicate in the UI would silently fall through to the
 * wrong field (or a default) the next time a vital_type is added here
 * without the UI copy being updated in lockstep. Lives in its own file
 * (rather than inside parse-resource.ts, which has `import "server-only"`)
 * so a client component can import it without pulling in a server-only
 * module.
 */
export const VITAL_TYPE_VALUE_FIELD: Partial<Record<Database["public"]["Enums"]["vital_type"], string>> = {
  glucose: "glucose_mmol_l",
  weight: "weight_kg",
  temperature: "temperature_c",
  spo2: "spo2_pct",
  waist_circumference: "waist_cm",
  pulse: "pulse_bpm",
};

import { z } from "zod";

/**
 * Shared pieces for structured lab results (S27): the file rule, the input schemas, the plain-words error mapping and
 * the narrow parsers for what the database functions return. No server-only imports, so the actions, the screens and
 * the tests read one definition.
 */

export const LAB_RESULT_BUCKET = "lab-results";
export const LAB_RESULT_FILE_ACCEPT = "application/pdf,image/jpeg,image/png";
const MAX_BYTES = 10 * 1024 * 1024;
const MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);
export const LAB_RESULT_EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

export function validateLabResultFile(file: { type: string; size: number }): string | null {
  if (!MIME.has(file.type)) return "Please choose a PDF, JPG or PNG.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_BYTES) return "That file is larger than 10 MB.";
  return null;
}

export const PANEL_CODES = ["essential", "annual_health_check"] as const;
export type PanelCode = (typeof PANEL_CODES)[number];
export const PANEL_LABEL: Record<PanelCode, string> = { essential: "Essential panel", annual_health_check: "Annual health check" };

const itemSchema = z
  .object({
    analyte_code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    value_numeric: z.number().finite().min(0).max(1_000_000).optional(),
    value_text: z.enum(["positive", "negative"]).optional(),
    unit: z.string().max(20).optional(),
  })
  .refine((i) => (i.value_numeric !== undefined) !== (i.value_text !== undefined), { message: "Each analyte needs exactly one value." });

export const resultEntrySchema = z.object({
  orderId: z.string().uuid(),
  panel: z.enum(PANEL_CODES),
  items: z.array(itemSchema).max(60),
});
export type ResultEntryItem = z.infer<typeof itemSchema>;

export const disclosureSchema = z.object({
  resultId: z.string().uuid(),
  method: z.enum(["in_person", "phone", "video"]),
  attested: z.literal(true, { message: "Please confirm you told the patient yourself." }),
  note: z.string().trim().max(500).optional(),
});

export const withholdSchema = z.object({
  resultId: z.string().uuid(),
  reason: z.string().trim().min(5, "Please give a reason.").max(500),
});

export const releaseSchema = z.object({ resultId: z.string().uuid(), note: z.string().trim().max(500).optional() });

export const panelDefinitionSchema = z.object({
  panel_code: z.string(),
  version: z.number(),
  analytes: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      kind: z.enum(["numeric", "qualitative"]),
      unit: z.string(),
      refLow: z.number().optional(),
      refHigh: z.number().optional(),
      criticalLow: z.number().optional(),
      criticalHigh: z.number().optional(),
      sensitive: z.boolean().optional(),
      optional: z.boolean().optional(),
    }),
  ),
});
export type PanelDefinition = z.infer<typeof panelDefinitionSchema>;

const myItemSchema = z.object({
  analyte_code: z.string(),
  value_numeric: z.number().nullable(),
  value_text: z.string().nullable(),
  unit: z.string(),
  ref_low: z.number().nullable(),
  ref_high: z.number().nullable(),
  flag: z.enum(["normal", "low", "high", "critical", "positive", "negative"]),
});
export const myLabResultsSchema = z.array(
  z.object({
    lab_result_id: z.string().uuid(),
    received_at: z.string(),
    panel_code: z.string().nullable(),
    own_upload: z.boolean(),
    status: z.enum(["released", "under_review", "care_team_will_contact"]),
    explain_allowed: z.boolean(),
    has_file: z.boolean(),
    items: z.array(myItemSchema),
  }),
);
export type MyLabResult = z.infer<typeof myLabResultsSchema>[number];

export const reviewResultSchema = z.object({
  lab_result_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  release_state: z.string(),
  release_reason: z.string().nullable(),
  panel_code: z.string().nullable(),
  received_at: z.string(),
  submitted_by_kind: z.string(),
  file_path: z.string().nullable(),
  items: z.array(myItemSchema.extend({ sensitive_positive: z.boolean() })),
});
export type ReviewResult = z.infer<typeof reviewResultSchema>;

/** Plain-words messages for the stable error codes the database raises. Anything unknown gets the generic line. */
const MESSAGES: Record<string, string> = {
  lab_unit_mismatch: "That unit does not match the panel. Enter the value in the unit shown.",
  lab_unknown_analyte: "That test is not part of this panel.",
  lab_value_missing: "A value is missing.",
  lab_value_not_recognised: "A screening result must be entered as positive or negative. Send an unclear one back for a new sample instead.",
  lab_value_out_of_bounds: "A value is outside what can be entered.",
  lab_duplicate_analyte: "A test was entered twice.",
  lab_result_already_received: "A result was already received for this order.",
  lab_order_not_payable_state: "This order is not ready for a result yet.",
  lab_order_not_collectable: "This order cannot be marked collected now.",
  lab_nothing_to_record: "Enter values or attach the report.",
  lab_result_not_awaiting_review: "This result is not waiting for review.",
  lab_result_not_for_disclosure: "This result does not need a personal disclosure.",
  lab_disclosure_needs_attestation: "Choose how you told the patient and confirm it.",
  lab_disclosure_needs_senior_clinician: "A senior clinician must record this disclosure.",
  lab_result_final: "This result is final and cannot be changed.",
};

export function describeLabError(error: { message?: string } | null | undefined, fallback = "That did not work. Please try again."): string {
  const m = error?.message ?? "";
  for (const [code, text] of Object.entries(MESSAGES)) if (m.includes(code)) return text;
  if (m.includes("Not permitted") || m.includes("Order not found")) return "You do not have access to that.";
  if (m.includes("A reason is required")) return "Please give a reason.";
  return fallback;
}

export function formatRange(low: number | null, high: number | null, unit: string): string {
  if (low !== null && high !== null) return `${low} to ${high} ${unit}`;
  if (high !== null) return `up to ${high} ${unit}`;
  if (low !== null) return `${low} or more ${unit}`;
  return "";
}

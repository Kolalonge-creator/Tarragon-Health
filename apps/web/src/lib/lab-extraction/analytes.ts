import { z } from "zod";

/**
 * The analytes extraction is allowed to propose.
 *
 * Deliberately exactly the ML AnalyteCode union (packages/shared/ml-client.ts)
 * — these are the codes the platform already stores in lab_analyte_readings and
 * already knows how to use: trends, CVD risk, HbA1c trajectory, the lipid card.
 * Proposing a code nothing downstream understands would put a number in front
 * of a clinician that goes nowhere.
 *
 * non_hdl_cholesterol is absent on purpose: it is DERIVED (Total minus HDL, see
 * lib/lipids/analytes.ts) and must never be read off a page, because a lab
 * printing its own non-HDL may have computed it from a different total.
 */
export const EXTRACTABLE_ANALYTE_CODES = [
  "hba1c",
  "fasting_glucose",
  "total_cholesterol",
  "hdl_cholesterol",
  "ldl_cholesterol",
  "triglycerides",
  "psa",
] as const;

export type ExtractableAnalyteCode = (typeof EXTRACTABLE_ANALYTE_CODES)[number];

export const EXTRACTABLE_ANALYTE_LABEL: Record<ExtractableAnalyteCode, string> = {
  hba1c: "HbA1c",
  fasting_glucose: "Fasting glucose",
  total_cholesterol: "Total cholesterol",
  hdl_cholesterol: "HDL cholesterol",
  ldl_cholesterol: "LDL cholesterol",
  triglycerides: "Triglycerides",
  psa: "PSA",
};

/**
 * The unit each analyte is STORED in, matching what submitScreeningResult
 * already writes so extracted values sit on the same axis as manually recorded
 * ones. Changing these silently rescales every existing chart.
 */
export const CANONICAL_UNIT: Record<ExtractableAnalyteCode, string> = {
  hba1c: "percent",
  fasting_glucose: "mg/dL",
  total_cholesterol: "mg/dL",
  hdl_cholesterol: "mg/dL",
  ldl_cholesterol: "mg/dL",
  triglycerides: "mg/dL",
  psa: "ng/mL",
};

/** Normalised form of whatever unit string a lab printed. */
function normaliseUnit(unit: string): string {
  return unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/µ/g, "u")
    .replace(/percent|per cent/g, "%");
}

/**
 * Convert a value as printed on a lab report into the platform's canonical
 * unit for that analyte.
 *
 * Conversion is done HERE, in deterministic, unit-tested TypeScript, and
 * explicitly NOT by the language model. The model's job is to read what is on
 * the page; arithmetic on a clinical value is not something to leave to a
 * probabilistic system. An unrecognised unit returns null so the value is
 * dropped rather than stored on the wrong scale — a wrong number in a trend is
 * far worse than a missing one.
 *
 * Factors: cholesterol mmol/L x 38.67, triglycerides mmol/L x 88.57, glucose
 * mmol/L x 18.016, HbA1c IFCC mmol/mol -> NGSP % via the master equation
 * (0.09148x + 2.152). PSA ng/mL and ug/L are the same quantity.
 */
export function toCanonicalUnit(
  code: ExtractableAnalyteCode,
  value: number,
  unit: string
): { value: number; unit: string } | null {
  if (!Number.isFinite(value)) return null;
  const u = normaliseUnit(unit);
  const canonical = CANONICAL_UNIT[code];
  const round = (v: number) => Math.round(v * 100) / 100;

  if (code === "hba1c") {
    if (u === "%" || u === "percent") return { value: round(value), unit: canonical };
    if (u === "mmol/mol") return { value: round(value * 0.09148 + 2.152), unit: canonical };
    return null;
  }

  if (code === "psa") {
    if (u === "ng/ml" || u === "ug/l") return { value: round(value), unit: canonical };
    return null;
  }

  if (u === "mg/dl") return { value: round(value), unit: canonical };
  if (u === "mmol/l") {
    const factor =
      code === "triglycerides" ? 88.57 : code === "fasting_glucose" ? 18.016 : 38.67;
    return { value: round(value * factor), unit: canonical };
  }
  return null;
}

/**
 * What the model is asked to return: values exactly as printed, plus the raw
 * text it read them from so a clinician can check the reading against the
 * document without hunting for it.
 */
export const extractedAnalyteSchema = z.object({
  code: z.enum(EXTRACTABLE_ANALYTE_CODES),
  value: z.number(),
  unit: z.string().min(1).max(20),
  source_text: z.string().max(200).optional(),
});

export const extractionResultSchema = z.object({
  /** ISO date the sample was collected/reported, if the document states one. */
  taken_on: z.string().max(40).optional(),
  analytes: z.array(extractedAnalyteSchema).max(20),
});

export type ExtractedAnalyte = z.infer<typeof extractedAnalyteSchema>;

/** A proposal after unit normalisation — what actually gets shown and stored. */
export interface ProposedReading {
  code: ExtractableAnalyteCode;
  label: string;
  value: number;
  unit: string;
  /** As printed on the document, kept so a clinician can sanity-check. */
  asPrinted: string;
  sourceText: string | null;
  takenOn: string | null;
}

/** ISO-8601 date (YYYY-MM-DD) or null. Anything else is not trusted as a date. */
export function normaliseTakenOn(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // A result dated in the future is a misread, not a real collection date.
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return trimmed.slice(0, 10);
}

/**
 * Turn the model's raw reading into storable proposals. Anything whose unit is
 * unrecognised is dropped, deliberately and silently from the model's point of
 * view — the clinician still sees the document itself, so a dropped value is
 * recoverable by hand, whereas a mis-scaled one is not.
 */
export function toProposedReadings(
  parsed: z.infer<typeof extractionResultSchema>
): ProposedReading[] {
  const takenOn = normaliseTakenOn(parsed.taken_on);
  const seen = new Set<string>();
  const out: ProposedReading[] = [];

  for (const analyte of parsed.analytes) {
    if (seen.has(analyte.code)) continue;
    const converted = toCanonicalUnit(analyte.code, analyte.value, analyte.unit);
    if (!converted) continue;
    seen.add(analyte.code);
    out.push({
      code: analyte.code,
      label: EXTRACTABLE_ANALYTE_LABEL[analyte.code],
      value: converted.value,
      unit: converted.unit,
      asPrinted: `${analyte.value} ${analyte.unit}`.trim(),
      sourceText: analyte.source_text ?? null,
      takenOn,
    });
  }
  return out;
}

import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  convertToCanonical,
  getAnalyte,
  resolveAnalyteCode,
  ANALYTE_CATALOGUE,
} from "./analyte-catalogue";

/**
 * Lab-report vision boundary — reads a photo or PDF of ANY lab report and
 * drafts the numeric results it contains.
 *
 * AI DRAFTS, NEVER DECIDES. Identical discipline to lib/case-briefs/generate.ts
 * and lib/patient-explainer/generate.ts: the output of this module is a DRAFT
 * that a clinician confirms on screen next to the original document. Nothing
 * here writes `lab_analyte_readings`, raises an alert, classifies a result, or
 * reaches a patient. It replaces twenty fields of typing with a ten-second
 * check — it does not replace the check.
 *
 * Never throws. On any failure (no key, timeout, malformed output, unreadable
 * document) it returns a definitive failure and the caller records a `failed`
 * extraction, leaving the existing manual-entry path completely intact.
 *
 * WHY IT MATTERS HERE: Nigeria has no lab-to-lab interchange standard. A
 * patient who uses any lab and uploads the result would otherwise create a
 * transcription job for a doctor — the wrong cost shape entirely. This turns
 * that job into a review.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_ID = "claude-sonnet-5";

/** What the model is asked to return, before any validation of our own. */
const rawRowSchema = z.object({
  /** Verbatim row label as printed, so a reviewer can match it against the page. */
  reported_label: z.string(),
  /** Our catalogue code when the model recognises it, else null. */
  code: z.string().nullable(),
  value: z.number(),
  unit: z.string().nullable(),
  /** Reference interval as printed, verbatim. Display only — never parsed for logic. */
  reported_range: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

const rawExtractionSchema = z.object({
  /** Collection/report date exactly as printed, ISO-8601 if the model can. */
  report_date: z.string().nullable(),
  lab_name: z.string().nullable(),
  /** Patient name as printed — used ONLY for the mismatch warning, never stored. */
  patient_name: z.string().nullable(),
  rows: z.array(rawRowSchema).max(60),
  /** Set when the image is too poor, cropped, or not a lab report at all. */
  unreadable_reason: z.string().nullable(),
});

export type ExtractedRowStatus =
  /** Resolved to a catalogue code, unit understood, value plausible. Ready to confirm. */
  | "ready"
  /** Recognised analyte but the printed unit is not one we can safely convert. */
  | "unknown_unit"
  /** Converted value falls outside the analyte's plausible band — likely a misread. */
  | "implausible"
  /** No catalogue code matched this row label. Surfaced, never guessed. */
  | "unmapped";

export interface ExtractedRow {
  reportedLabel: string;
  /** Null when status is 'unmapped'. */
  code: string | null;
  label: string | null;
  /** Value in the analyte's canonical unit when status is 'ready'; else as reported. */
  value: number;
  unit: string | null;
  canonicalUnit: string | null;
  /** True when the reported unit differed and we converted it. */
  converted: boolean;
  reportedRange: string | null;
  confidence: "low" | "medium" | "high";
  status: ExtractedRowStatus;
}

export interface LabReportExtraction {
  reportDate: string | null;
  labName: string | null;
  patientNameOnReport: string | null;
  rows: ExtractedRow[];
  unreadableReason: string | null;
}

export type LabReportExtractionResult =
  | { ok: true; extraction: LabReportExtraction }
  | { ok: false; reason: "unavailable" | "error" | "unsupported_type" };

export const EXTRACTABLE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isLabReportExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The closed vocabulary handed to the model. Giving it the exact code list plus
 * a couple of real aliases each is what keeps output on-vocabulary instead of
 * inventing "serum_creatinine" — and anything it still gets wrong is caught by
 * `resolveAnalyteCode` on the way back in.
 */
function vocabularyBlock(): string {
  return ANALYTE_CATALOGUE.map((a) => {
    const hints = a.aliases.slice(0, 4).join(", ");
    return `- ${a.code} (${a.label}; canonical unit ${a.canonicalUnit}; printed as: ${hints})`;
  }).join("\n");
}

const SYSTEM_PROMPT = [
  "You transcribe laboratory reports for a Nigerian digital health platform.",
  "",
  "Your ONLY job is faithful transcription. You are not interpreting anything.",
  "A doctor reviews everything you output, side by side with the original document.",
  "",
  "Rules, no exceptions:",
  "- Transcribe ONLY numeric results that are actually printed on the document.",
  "- Never infer, estimate, calculate, or carry over a value that is not printed. If a panel",
  "  lists a test with no result next to it, omit that row entirely.",
  "- Copy the value EXACTLY as printed, including decimal places. Do not round or convert.",
  "- Copy the unit EXACTLY as printed. If the unit appears only in a column header, apply that",
  "  header's unit to the rows under it. If you genuinely cannot tell, set unit to null.",
  "- Set `code` to the matching code from the vocabulary below, or null if no code fits.",
  "  Never invent a code that is not in the list.",
  "- `reported_label` must be the row's label copied verbatim from the page, so a human can",
  "  find it again.",
  "- `reported_range` is the reference interval as printed, verbatim, or null. Never invent one.",
  "- Set confidence to 'low' for any row where the print is unclear, smudged, cut off, or",
  "  handwritten. A low-confidence row is still useful; a wrong high-confidence row is not.",
  "- Ignore qualitative results (positive/negative/reactive), microscopy descriptions, and free",
  "  text comments. Numeric analytes only.",
  "- If the document is not a lab report, or is too blurred/cropped to transcribe safely, set",
  "  `unreadable_reason` and return an empty rows list.",
  "",
  "Vocabulary — the only permitted values for `code`:",
  vocabularyBlock(),
].join("\n");

/**
 * Turn one model row into a validated row, resolving the label against the
 * catalogue and converting the unit. Runs on EVERY row regardless of what the
 * model claimed, so a hallucinated code or a mismatched unit is caught here
 * rather than reaching the database.
 */
export function validateExtractedRow(raw: z.infer<typeof rawRowSchema>): ExtractedRow {
  // Trust our own alias resolution over the model's `code` when they disagree —
  // the label is verbatim from the page, the code is the model's judgement.
  const resolved = resolveAnalyteCode(raw.reported_label) ?? (raw.code && getAnalyte(raw.code) ? raw.code : null);

  const base = {
    reportedLabel: raw.reported_label,
    value: raw.value,
    unit: raw.unit,
    reportedRange: raw.reported_range,
    confidence: raw.confidence,
    converted: false,
  };

  if (!resolved) {
    return { ...base, code: null, label: null, canonicalUnit: null, status: "unmapped" };
  }

  const analyte = getAnalyte(resolved);
  if (!analyte) {
    return { ...base, code: null, label: null, canonicalUnit: null, status: "unmapped" };
  }

  const conversion = convertToCanonical(resolved, raw.value, raw.unit);
  if (!conversion.ok) {
    return {
      ...base,
      code: resolved,
      label: analyte.label,
      canonicalUnit: analyte.canonicalUnit,
      status: conversion.reason === "unknown_unit" ? "unknown_unit" : "implausible",
    };
  }

  return {
    ...base,
    code: resolved,
    label: analyte.label,
    value: conversion.value,
    canonicalUnit: analyte.canonicalUnit,
    converted: conversion.converted,
    status: "ready",
  };
}

/** Normalise a printed date to ISO yyyy-mm-dd, or null if it is not parseable. */
export function normaliseReportDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // A report dated in the future is a misread, not a result.
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Extract results from a base64-encoded lab report. Never throws.
 *
 * PDFs go through Anthropic's `document` content block (native PDF reading);
 * images through `image_url`. Both are sent inline as base64 — the document
 * never leaves this request, and nothing is persisted by this function.
 */
export async function extractLabReport(input: {
  fileBase64: string;
  mediaType: string;
  /** Optional hint shown to the model, e.g. the ordered panel's name. */
  contextHint?: string | null;
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic;
}): Promise<LabReportExtractionResult> {
  if (!input.model && !isLabReportExtractionConfigured()) {
    return { ok: false, reason: "unavailable" };
  }
  if (!(EXTRACTABLE_MIME_TYPES as readonly string[]).includes(input.mediaType)) {
    return { ok: false, reason: "unsupported_type" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model =
      input.model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 4000,
        // Same claude-*-5-generation workaround as case-briefs/meal-vision:
        // @langchain/anthropic@0.3.x unconditionally sends these, and this
        // model generation rejects them outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(rawExtractionSchema, {
      name: "lab_report_extraction",
    });

    const instruction = input.contextHint
      ? `Transcribe every numeric result on this lab report. The order it was booked under was: ${input.contextHint}. Transcribe what is actually on the page regardless — do not force the results to match that panel.`
      : "Transcribe every numeric result on this lab report.";

    const documentBlock =
      input.mediaType === "application/pdf"
        ? {
            type: "document" as const,
            source: {
              type: "base64" as const,
              media_type: "application/pdf" as const,
              data: input.fileBase64,
            },
          }
        : {
            type: "image_url" as const,
            image_url: { url: `data:${input.mediaType};base64,${input.fileBase64}` },
          };

    const raw = await structured.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage({ content: [{ type: "text", text: instruction }, documentBlock] }),
      ],
      { signal: controller.signal },
    );

    const parsed = rawExtractionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "error" };

    const rows = parsed.data.rows.map(validateExtractedRow);
    // Two rows for the same analyte on one report means the model read a
    // comparison/history column as a second result. Keep the first, drop the
    // rest — a duplicate silently doubling a trend is worse than a missing row.
    const seen = new Set<string>();
    const deduped = rows.filter((row) => {
      if (!row.code) return true;
      if (seen.has(row.code)) return false;
      seen.add(row.code);
      return true;
    });

    return {
      ok: true,
      extraction: {
        reportDate: normaliseReportDate(parsed.data.report_date),
        labName: parsed.data.lab_name?.trim() || null,
        patientNameOnReport: parsed.data.patient_name?.trim() || null,
        rows: deduped,
        unreadableReason: parsed.data.unreadable_reason?.trim() || null,
      },
    };
  } catch {
    // Timeout (AbortError), network failure, or malformed structured output.
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

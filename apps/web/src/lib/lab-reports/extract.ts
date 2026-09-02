import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  convertToCanonical,
  getAnalyte,
  getQualitativeAnalyte,
  resolveAnalyteCode,
  resolveQualitativeValue,
  ANALYTE_CATALOGUE,
  QUALITATIVE_CATALOGUE,
} from "./analyte-catalogue";
import {
  checkAgainstPrintedRange,
  checkConsistency,
  parsePrintedRange,
  type QcFlag,
} from "./qc";
import {
  hintsPromptBlock,
  labNameKey,
  layoutFingerprint,
  type TemplateHints,
} from "./corpus";

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
  /** Numeric result. Null on a qualitative row, which carries value_text instead. */
  value: z.number().nullable().optional(),
  /**
   * Non-numeric result exactly as printed ("AS", "+ve", "2+", "NOT SEEN").
   * Genotype, malaria films, serology and urine dipsticks have no number at
   * all, and they are among the most-ordered tests in Nigeria.
   */
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable(),
  /** Reference interval as printed, verbatim. Cross-checked, never trusted. */
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
  | "unmapped"
  /**
   * A qualitative analyte whose printed result the catalogue does not recognise
   * ("Hb A/S variant?", "see comment"). Surfaced for a human to read rather
   * than mapped to the nearest coded value — a wrong genotype is worse than a
   * missing one.
   */
  | "unreadable_value";

export interface ExtractedRow {
  reportedLabel: string;
  /** Null when status is 'unmapped'. */
  code: string | null;
  label: string | null;
  /**
   * Value in the analyte's canonical unit when status is 'ready'; else as
   * reported. Null on a qualitative row, which carries `valueText`.
   */
  value: number | null;
  /** Coded qualitative result ("AS", "positive", "2+"), or null. */
  valueText: string | null;
  unit: string | null;
  canonicalUnit: string | null;
  /** True when the reported unit differed and we converted it. */
  converted: boolean;
  reportedRange: string | null;
  confidence: "low" | "medium" | "high";
  status: ExtractedRowStatus;
  /**
   * Quality-control findings for this row, from qc.ts. Deterministic checks
   * that run over the model's output — never the model's own self-assessment.
   */
  flags: QcFlag[];
}

export interface LabReportExtraction {
  reportDate: string | null;
  labName: string | null;
  patientNameOnReport: string | null;
  rows: ExtractedRow[];
  unreadableReason: string | null;
  /** Folded laboratory name, for corpus matching. Null when none was printed. */
  labNameKey: string | null;
  /** Stable signature of this report's layout. See corpus.ts. */
  layoutFingerprint: string | null;
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

/**
 * The non-numeric vocabulary, listed separately and with its permitted results
 * spelled out. Genotype, malaria films, serology and urine dipsticks have no
 * number at all, and between them account for an enormous share of what a
 * Nigerian laboratory prints.
 */
function qualitativeVocabularyBlock(): string {
  return QUALITATIVE_CATALOGUE.map((a) => {
    const hints = a.aliases.slice(0, 4).join(", ");
    return `- ${a.code} (${a.label}; printed as: ${hints}; result is one of: ${a.values.join(", ")})`;
  }).join("\n");
}

const SYSTEM_PROMPT = [
  "You transcribe laboratory reports for a Nigerian digital health platform.",
  "",
  "Your ONLY job is faithful transcription. You are not interpreting anything.",
  "A doctor reviews everything you output, side by side with the original document.",
  "",
  "Rules, no exceptions:",
  "- Transcribe ONLY results that are actually printed on the document.",
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
  "  It is checked against the value, so transcribing it accurately matters as much as the result.",
  "- Set confidence to 'low' for any row where the print is unclear, smudged, cut off, or",
  "  handwritten. A low-confidence row is still useful; a wrong high-confidence row is not.",
  "- If the document is not a lab report, or is too blurred/cropped to transcribe safely, set",
  "  `unreadable_reason` and return an empty rows list.",
  "",
  "Numeric rows: put the number in `value` and leave `value_text` null.",
  "Non-numeric rows: leave `value` null and put the result in `value_text`, copied VERBATIM",
  "as printed — 'AS', '+ve', 'NOT SEEN', '2+', 'Non-reactive'. Do not translate it into a word",
  "you think is clearer; the exact wording is mapped to a stable code afterwards, and a phrase",
  "we do not recognise is shown to the doctor rather than guessed at.",
  "",
  "Microscopy descriptions, culture reports and free-text comments have no row of their own —",
  "omit them. A doctor reads those from the document itself.",
  "",
  "Numeric vocabulary — permitted values for `code`:",
  vocabularyBlock(),
  "",
  "Non-numeric vocabulary — permitted values for `code`, with the results each may take:",
  qualitativeVocabularyBlock(),
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
  const resolved =
    resolveAnalyteCode(raw.reported_label) ??
    (raw.code && (getAnalyte(raw.code) || getQualitativeAnalyte(raw.code)) ? raw.code : null);

  const flags: QcFlag[] = [];
  if (raw.confidence === "low") {
    flags.push({
      key: "low_confidence",
      message: "The print was unclear here. Check this one against the document.",
    });
  }

  const base = {
    reportedLabel: raw.reported_label,
    value: raw.value ?? null,
    valueText: raw.value_text?.trim() || null,
    unit: raw.unit,
    reportedRange: raw.reported_range,
    confidence: raw.confidence,
    converted: false,
    flags,
  };

  if (!resolved) {
    return { ...base, code: null, label: null, canonicalUnit: null, status: "unmapped" };
  }

  // -- Qualitative: genotype, malaria, serology, urine dipstick --------------
  const qualitative = getQualitativeAnalyte(resolved);
  if (qualitative) {
    const coded = base.valueText ? resolveQualitativeValue(resolved, base.valueText) : null;
    return {
      ...base,
      code: resolved,
      label: qualitative.label,
      value: null,
      valueText: coded ?? base.valueText,
      canonicalUnit: null,
      // Unrecognised wording is surfaced for a human, never mapped to the
      // nearest coded value.
      status: coded ? "ready" : "unreadable_value",
    };
  }

  const analyte = getAnalyte(resolved);
  if (!analyte) {
    return { ...base, code: null, label: null, canonicalUnit: null, status: "unmapped" };
  }

  // A numeric analyte with no number is not a result.
  if (raw.value === null || raw.value === undefined || !Number.isFinite(raw.value)) {
    return {
      ...base,
      code: resolved,
      label: analyte.label,
      canonicalUnit: analyte.canonicalUnit,
      status: "implausible",
    };
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

  // Cross-check the converted value against the range the lab printed beside
  // it, converted through the SAME unit rule so the two are comparable.
  const printed = parsePrintedRange(raw.reported_range);
  const convertBound = (bound: number | null): number | null => {
    if (bound === null) return null;
    const c = convertToCanonical(resolved, bound, raw.unit);
    return c.ok ? c.value : null;
  };
  flags.push(
    ...checkAgainstPrintedRange({
      value: conversion.value,
      reportedRange: raw.reported_range,
      canonicalRange: { min: convertBound(printed.min), max: convertBound(printed.max) },
      plausible: { min: analyte.plausible[0], max: analyte.plausible[1] },
      label: analyte.label,
    }),
  );

  return {
    ...base,
    code: resolved,
    label: analyte.label,
    value: conversion.value,
    valueText: null,
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
  /**
   * What the corpus has learned about this laboratory's stationery, when the
   * document was matched to a known template. Orientation for the model only —
   * hintsPromptBlock states explicitly that the page wins any disagreement.
   */
  templateHints?: TemplateHints | null;
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

    // "every result", not "every numeric result": this instruction is the last
    // thing the model reads and it overrode the system prompt's non-numeric
    // section, which is why genotype, malaria and blood group were silently
    // skipped on every report until the corpus harness caught it.
    const instruction = input.contextHint
      ? `Transcribe every result on this lab report, numeric and non-numeric alike. The order it was booked under was: ${input.contextHint}. Transcribe what is actually on the page regardless — do not force the results to match that panel.`
      : "Transcribe every result on this lab report, numeric and non-numeric alike.";

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

    // Learned hints are appended to the system prompt rather than replacing any
    // of it, so a laboratory we have never seen takes the exact path this
    // engine has always taken. They're a SEPARATE, uncached content block after
    // the cache breakpoint (not string-concatenated into one block) — the fixed
    // instructions + full analyte vocabulary above are identical on every call
    // regardless of which patient or laboratory, comfortably past Sonnet 5's
    // 1024-token cacheable-prefix minimum, so this keeps that reused ~90% of
    // the prompt cheap to re-send while the per-laboratory hints (which do vary
    // call to call) stay after the breakpoint, uncached. See "Shared prefix,
    // varying suffix" in Anthropic's prompt-caching docs — mixing the two into
    // one string would put per-call text ahead of the marker and invalidate the
    // cached vocabulary on every single request.
    const hints = hintsPromptBlock(input.templateHints);
    const systemContent = [
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      ...(hints ? [{ type: "text" as const, text: hints }] : []),
    ];

    const raw = await structured.invoke(
      [
        new SystemMessage({ content: systemContent }),
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

    // Cross-row consistency runs last, over the deduplicated set, because every
    // check it makes is about a RELATIONSHIP between rows and would misfire on
    // a duplicate. It attaches flags in place; it never removes a row.
    checkConsistency(deduped);

    const labName = parsed.data.lab_name?.trim() || null;
    const labKey = labNameKey(labName);

    return {
      ok: true,
      extraction: {
        reportDate: normaliseReportDate(parsed.data.report_date),
        labName,
        patientNameOnReport: parsed.data.patient_name?.trim() || null,
        rows: deduped,
        unreadableReason: parsed.data.unreadable_reason?.trim() || null,
        labNameKey: labKey,
        layoutFingerprint: layoutFingerprint(
          labKey,
          deduped.map((r) => r.reportedLabel),
        ),
      },
    };
  } catch {
    // Timeout (AbortError), network failure, or malformed structured output.
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

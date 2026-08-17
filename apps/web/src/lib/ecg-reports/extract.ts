import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import {
  convertToCanonical,
  getEcgParameter,
  resolveParameterCode,
  ECG_PARAMETER_CATALOGUE,
} from "./ecg-parameter-catalogue";
import {
  checkQtNotShorterThanQrs,
  checkQtcBazettConsistency,
  checkLooksTwelveLead,
  type QcFlag,
} from "./qc";

/**
 * 12-lead ECG vision boundary — reads a photo or PDF of a 12-lead ECG
 * printout and drafts the parameter block the cart already computed and
 * printed (heart rate, PR/QRS/QT/QTc, cardiac axis, and — kept separately
 * labelled — the cart's own printed rhythm statement if any).
 *
 * AI DRAFTS, NEVER DECIDES. Identical discipline to lib/lab-reports/extract.ts:
 * this transcribes numbers already printed by the ECG machine. It does not
 * read the waveform itself, does not compute anything the cart didn't already
 * compute, and never classifies a rhythm, an axis, or an interval as normal
 * or abnormal. Nothing here writes ecg_parameter_readings, raises an alert,
 * or reaches a patient — a clinician confirms every value on screen next to
 * the original tracing before any of it is filed.
 *
 * Never throws. On any failure (no key, timeout, malformed output, unreadable
 * document) it returns a definitive failure and the caller persists a
 * `failed` extraction, leaving manual entry via the existing
 * procedural_status flow completely intact.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_ID = "claude-sonnet-5";

const rawParameterSchema = z.object({
  /** Verbatim row/field label as printed, so a reviewer can match it against the page. */
  reported_label: z.string(),
  /** Our catalogue code when the model recognises it, else null. */
  code: z.string().nullable(),
  /** Numeric result. Null for the one text parameter (machine_rhythm_statement). */
  value: z.number().nullable().optional(),
  /** The machine's own printed rhythm statement, copied verbatim. Null for numeric rows. */
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

const rawExtractionSchema = z.object({
  /** Date the ECG was recorded, exactly as printed, ISO-8601 if the model can. */
  report_date: z.string().nullable(),
  /** Facility or device name as printed, if any. */
  facility_name: z.string().nullable(),
  /** Patient name as printed — used ONLY for the mismatch warning, never stored. */
  patient_name: z.string().nullable(),
  /** True if the image clearly shows a 12-lead layout (lead labels visible anywhere). */
  looks_twelve_lead: z.boolean(),
  parameters: z.array(rawParameterSchema).max(10),
  /** Set when the image is too poor, cropped, or not an ECG at all. */
  unreadable_reason: z.string().nullable(),
});

export type ExtractedParameterStatus =
  /** Resolved to a catalogue code, unit understood, value plausible. Ready to confirm. */
  | "ready"
  /** Recognised parameter but the printed unit is not one we can safely convert. */
  | "unknown_unit"
  /** Converted value falls outside the parameter's plausible band — likely a misread. */
  | "implausible"
  /** No catalogue code matched this row's label. Surfaced, never guessed. */
  | "unmapped";

export interface ExtractedParameter {
  reportedLabel: string;
  code: string | null;
  label: string | null;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  canonicalUnit: string | null;
  converted: boolean;
  confidence: "low" | "medium" | "high";
  status: ExtractedParameterStatus;
  flags: QcFlag[];
}

export interface EcgReportExtraction {
  reportDate: string | null;
  facilityName: string | null;
  patientNameOnReport: string | null;
  looksTwelveLead: boolean;
  parameters: ExtractedParameter[];
  unreadableReason: string | null;
}

export type EcgReportExtractionResult =
  | { ok: true; extraction: EcgReportExtraction }
  | { ok: false; reason: "unavailable" | "error" | "unsupported_type" };

export const EXTRACTABLE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isEcgReportExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function vocabularyBlock(): string {
  return ECG_PARAMETER_CATALOGUE.map((p) => {
    const hints = p.aliases.slice(0, 4).join(", ");
    const unitNote = p.canonicalUnit ? `; canonical unit ${p.canonicalUnit}` : "; text field, no unit";
    return `- ${p.code} (${p.label}${unitNote}; printed as: ${hints})`;
  }).join("\n");
}

const SYSTEM_PROMPT = [
  "You transcribe the printed parameter block on a 12-lead ECG report for a Nigerian digital",
  "health platform.",
  "",
  "Your ONLY job is faithful transcription of numbers and text the ECG machine ITSELF already",
  "printed. You are not interpreting the tracing, not diagnosing a rhythm, and not judging",
  "whether any value is normal or abnormal. A doctor reviews everything you output, side by",
  "side with the original tracing.",
  "",
  "Rules, no exceptions:",
  "- Transcribe ONLY parameters that are actually printed on the document. Never infer,",
  "  estimate, or calculate a value that is not printed — if the machine did not print a QTc,",
  "  do not compute one yourself.",
  "- Copy the value EXACTLY as printed, including decimal places. Do not round or convert.",
  "- Copy the unit EXACTLY as printed (ms, s, bpm, deg, °). If genuinely unclear, set unit to null.",
  "- Set `code` to the matching code from the vocabulary below, or null if no code fits.",
  "  Never invent a code that is not in the list.",
  "- `reported_label` must be the field's label copied verbatim from the page.",
  "- Set confidence to 'low' for any field where the print is unclear, smudged, or cut off.",
  "  A low-confidence field is still useful; a wrong high-confidence field is not.",
  "- Numeric parameters (heart_rate, pr_interval, qrs_duration, qt_interval, qtc_interval,",
  "  qrs_axis): put the number in `value`, leave `value_text` null.",
  "- machine_rhythm_statement, if the machine printed one (e.g. \"Normal sinus rhythm\", \"Sinus",
  "  tachycardia\", \"Possible left axis deviation\"): copy it VERBATIM into `value_text`, leave",
  "  `value` null. This is the MACHINE's own printed line, not your assessment — copy it exactly",
  "  even if you think it looks wrong, and never add a rhythm statement the machine did not print.",
  "- `looks_twelve_lead`: true only if you can see standard 12-lead labelling anywhere on the",
  "  page (lead names I, II, III, aVR, aVL, aVF, V1 through V6, or 12 distinct tracing strips).",
  "  A single continuous strip with no lead labels, or a Watch/KardiaMobile-style single-lead",
  "  printout, is false. When unsure, false — this platform only wants genuine 12-lead ECGs.",
  "- If the document is not an ECG at all, or is too blurred/cropped to transcribe safely, set",
  "  `unreadable_reason` and return an empty parameters list.",
  "",
  "Vocabulary — permitted values for `code`:",
  vocabularyBlock(),
].join("\n");

/**
 * Turn one model row into a validated parameter, resolving the label against
 * the catalogue and converting the unit. Runs on EVERY row regardless of
 * what the model claimed, so a hallucinated code or a mismatched unit is
 * caught here rather than reaching the database.
 */
export function validateExtractedParameter(
  raw: z.infer<typeof rawParameterSchema>,
): ExtractedParameter {
  const resolved =
    resolveParameterCode(raw.reported_label) ??
    (raw.code && getEcgParameter(raw.code) ? raw.code : null);

  const flags: QcFlag[] = [];
  if (raw.confidence === "low") {
    flags.push({
      key: "low_confidence",
      message: "The print was unclear here. Check this one against the tracing.",
    });
  }

  const base = {
    reportedLabel: raw.reported_label,
    unit: raw.unit,
    confidence: raw.confidence,
    converted: false,
    flags,
  };

  if (!resolved) {
    return { ...base, code: null, label: null, value: null, valueText: null, canonicalUnit: null, status: "unmapped" };
  }

  const param = getEcgParameter(resolved);
  if (!param) {
    return { ...base, code: null, label: null, value: null, valueText: null, canonicalUnit: null, status: "unmapped" };
  }

  // Text-only parameter (the machine's own rhythm statement) — transcribed
  // verbatim, never coded or judged.
  if (param.canonicalUnit === null) {
    const text = raw.value_text?.trim() || null;
    return {
      ...base,
      code: resolved,
      label: param.label,
      value: null,
      valueText: text,
      canonicalUnit: null,
      status: text ? "ready" : "unmapped",
    };
  }

  if (raw.value === null || raw.value === undefined || !Number.isFinite(raw.value)) {
    return {
      ...base,
      code: resolved,
      label: param.label,
      value: null,
      valueText: null,
      canonicalUnit: param.canonicalUnit,
      status: "implausible",
    };
  }

  const conversion = convertToCanonical(resolved, raw.value, raw.unit);
  if (!conversion.ok) {
    return {
      ...base,
      code: resolved,
      label: param.label,
      value: null,
      valueText: null,
      canonicalUnit: param.canonicalUnit,
      status: "unknown_unit",
    };
  }

  if (
    conversion.value < param.plausible![0] ||
    conversion.value > param.plausible![1]
  ) {
    return {
      ...base,
      code: resolved,
      label: param.label,
      value: conversion.value,
      valueText: null,
      canonicalUnit: param.canonicalUnit,
      converted: conversion.converted,
      status: "implausible",
    };
  }

  return {
    ...base,
    code: resolved,
    label: param.label,
    value: conversion.value,
    valueText: null,
    canonicalUnit: param.canonicalUnit,
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
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return parsed.toISOString().slice(0, 10);
}

function findValue(parameters: ExtractedParameter[], code: string): number | null {
  return parameters.find((p) => p.code === code && p.status === "ready")?.value ?? null;
}

/**
 * Extract parameters from a base64-encoded 12-lead ECG document. Never
 * throws. PDFs go through Anthropic's `document` content block; images
 * through `image_url`, both inline as base64 — the document never leaves
 * this request, and nothing is persisted by this function.
 */
export async function extractEcgReport(input: {
  fileBase64: string;
  mediaType: string;
  /** Optional hint shown to the model, e.g. the linked screen order's name. */
  contextHint?: string | null;
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic;
}): Promise<EcgReportExtractionResult> {
  if (!input.model && !isEcgReportExtractionConfigured()) {
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
        maxTokens: 2000,
        // Same claude-*-5-generation workaround as lib/lab-reports/extract.ts:
        // @langchain/anthropic@0.3.x unconditionally sends these, and this
        // model generation rejects them outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(rawExtractionSchema, {
      name: "ecg_report_extraction",
    });

    const instruction = input.contextHint
      ? `Transcribe the printed parameter block on this 12-lead ECG. This was uploaded against: ${input.contextHint}. Transcribe what is actually printed regardless.`
      : "Transcribe the printed parameter block on this 12-lead ECG.";

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

    const parameters = parsed.data.parameters.map(validateExtractedParameter);
    // Two rows for the same code means the model read a duplicate/history
    // field as a second result. Keep the first, drop the rest.
    const seen = new Set<string>();
    const deduped = parameters.filter((p) => {
      if (!p.code) return true;
      if (seen.has(p.code)) return false;
      seen.add(p.code);
      return true;
    });

    // Cross-parameter consistency, over the deduplicated set — a relationship
    // check would misfire on a duplicate row.
    const qtMs = findValue(deduped, "qt_interval");
    const qrsMs = findValue(deduped, "qrs_duration");
    const heartRate = findValue(deduped, "heart_rate");
    const qtcMs = findValue(deduped, "qtc_interval");
    const crossFlags = [
      ...checkQtNotShorterThanQrs(qtMs, qrsMs),
      ...checkQtcBazettConsistency(qtMs, heartRate, qtcMs),
    ];
    if (crossFlags.length > 0) {
      // Attach cross-parameter flags to every numeric row they're about,
      // rather than picking one arbitrarily — the reviewer sees the same
      // warning wherever they're looking.
      for (const p of deduped) {
        if (["qt_interval", "qrs_duration", "qtc_interval", "heart_rate"].includes(p.code ?? "")) {
          p.flags.push(...crossFlags);
        }
      }
    }

    return {
      ok: true,
      extraction: {
        reportDate: normaliseReportDate(parsed.data.report_date),
        facilityName: parsed.data.facility_name?.trim() || null,
        patientNameOnReport: parsed.data.patient_name?.trim() || null,
        looksTwelveLead: parsed.data.looks_twelve_lead,
        parameters: deduped,
        unreadableReason: parsed.data.unreadable_reason?.trim() || null,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Re-exported for the review UI: whether this extraction's 12-lead plausibility check passed. */
export function looksTwelveLeadFlags(looksTwelveLead: boolean): QcFlag[] {
  return checkLooksTwelveLead(looksTwelveLead);
}

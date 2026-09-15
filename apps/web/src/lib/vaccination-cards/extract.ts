import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * Vaccination card/record vision boundary — reads a photo or PDF of a paper
 * immunisation card, hospital record or school vaccination record, and
 * drafts the individual doses it can read (spec §43.12).
 *
 * AI DRAFTS, NEVER DECIDES — identical discipline to
 * lib/lab-reports/extract.ts and lib/ecg-reports/extract.ts: the output here
 * is a draft a human reviews next to the source image before anything is
 * filed. Nothing in this module writes vaccination_records.
 *
 * Considerably simpler than the lab-report engine: no unit conversion, no
 * numeric plausibility bands, no learned per-issuer template corpus — a
 * vaccination card has no equivalent of a lab's reference ranges or a
 * hundred-analyte panel. The one thing that genuinely needs a closed
 * vocabulary is the vaccine itself, so the model is handed the live
 * vaccination_catalog (not a hardcoded TS catalogue — the vaccine list is
 * data, per docs/FEATURE_SPEC.md's "adding a vaccine is a database insert").
 *
 * Never throws. On any failure (no key, timeout, malformed output, unreadable
 * document) it returns a definitive failure and the caller records a
 * `failed` extraction, leaving manual entry via LogVaccinationForm intact.
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_ID = "claude-sonnet-5";

export interface VaccinationCatalogueEntry {
  id: string;
  code: string;
  name: string;
}

/** What the model is asked to return, before any validation of our own. */
const rawRowSchema = z.object({
  /** Verbatim row/entry label as printed, so a reviewer can match it against the card. */
  reported_label: z.string(),
  /** Our catalogue code when the model recognises it, else null. Never invented. */
  code: z.string().nullable(),
  /** Date the dose was given, exactly as printed, ISO-8601 if the model can manage it. */
  date_administered: z.string().nullable(),
  /** Any dose/visit numbering printed next to the entry ("1st", "Booster", "3"), verbatim. */
  dose_number_hint: z.string().nullable().optional(),
  provider: z.string().nullable().optional(),
  batch_lot_number: z.string().nullable().optional(),
  confidence: z.enum(["low", "medium", "high"]),
});

const rawExtractionSchema = z.object({
  /** Name printed on the card — used ONLY for the mismatch warning, never stored. */
  card_holder_name: z.string().nullable(),
  rows: z.array(rawRowSchema).max(60),
  /** Set when the image is too poor, cropped, or not a vaccination record at all. */
  unreadable_reason: z.string().nullable(),
});

export type ExtractedCardRowStatus =
  /** Resolved to a catalogue vaccine with a parseable date. Ready to confirm. */
  | "ready"
  /** No catalogue vaccine matched this row's label. Surfaced, never guessed. */
  | "unmapped"
  /** A vaccine was recognised but the date could not be parsed as a real, past date. */
  | "unreadable_date";

export interface ExtractedCardRow {
  reportedLabel: string;
  /** Null when status is 'unmapped'. */
  vaccinationCatalogId: string | null;
  vaccineName: string | null;
  /** ISO yyyy-mm-dd when status is 'ready'; else null. */
  dateAdministered: string | null;
  doseNumberHint: string | null;
  provider: string | null;
  batchLotNumber: string | null;
  confidence: "low" | "medium" | "high";
  status: ExtractedCardRowStatus;
}

export interface VaccinationCardExtraction {
  cardHolderName: string | null;
  rows: ExtractedCardRow[];
  unreadableReason: string | null;
}

export type VaccinationCardExtractionResult =
  | { ok: true; extraction: VaccinationCardExtraction }
  | { ok: false; reason: "unavailable" | "error" | "unsupported_type" };

export const EXTRACTABLE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;

export function isVaccinationCardExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** The closed vocabulary handed to the model — the live catalogue, not a
 * hardcoded list, so a vaccine added to the database is immediately
 * recognisable without a code change. */
function vocabularyBlock(catalog: VaccinationCatalogueEntry[]): string {
  return catalog.map((c) => `- ${c.code} (${c.name})`).join("\n");
}

function buildSystemPrompt(catalog: VaccinationCatalogueEntry[]): string {
  return [
    "You transcribe paper vaccination cards, hospital immunisation records and school",
    "vaccination records for a Nigerian digital health platform.",
    "",
    "Your ONLY job is faithful transcription. You are not deciding what is due or missing.",
    "A person reviews everything you output, side by side with the original document.",
    "",
    "Rules, no exceptions:",
    "- Transcribe ONLY doses that are actually recorded on the document — one row per dose",
    "  entry, even if the same vaccine appears multiple times (e.g. Penta 1, 2 and 3 are",
    "  three separate rows).",
    "- Never infer, estimate, or invent a dose that is not printed. If a schedule grid shows",
    "  a vaccine with no date or tick next to it, omit that row entirely.",
    "- Set `code` to the matching code from the vocabulary below, or null if nothing fits.",
    "  Never invent a code that is not in the list.",
    "- `reported_label` must be the row's label copied verbatim from the page, so a human can",
    "  find it again.",
    "- Copy the date exactly as printed; if only a partial date is legible, still put what is",
    "  printed rather than guessing the rest.",
    "- `dose_number_hint`, `provider` and `batch_lot_number` are whatever the card actually",
    "  prints next to that row (a dose/visit number, a clinic/hospital name, a batch or lot",
    "  code) — leave any of them null rather than guessing.",
    "- Set confidence to 'low' for any row where the print is unclear, smudged, cut off, or",
    "  handwritten. A low-confidence row is still useful; a wrong high-confidence row is not.",
    "- If the document is not a vaccination record, or is too blurred/cropped to transcribe",
    "  safely, set `unreadable_reason` and return an empty rows list.",
    "",
    "Vaccine vocabulary — permitted values for `code`:",
    vocabularyBlock(catalog),
  ].join("\n");
}

/** Normalise a printed date to ISO yyyy-mm-dd, or null if unparseable or in the future. */
export function normaliseCardDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  // A dose dated in the future is a misread, not a real dose.
  if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return null;
  return parsed.toISOString().slice(0, 10);
}

/** Resolves a model-proposed code (or, failing that, the verbatim label) against
 * the live catalogue. Trusts our own lookup over the model's `code` claim when
 * they disagree — the label is verbatim from the page, the code is a judgement. */
export function resolveVaccinationCatalogEntry(
  reportedLabel: string,
  proposedCode: string | null,
  catalog: VaccinationCatalogueEntry[]
): VaccinationCatalogueEntry | null {
  const byCode = proposedCode ? catalog.find((c) => c.code === proposedCode) : undefined;
  if (byCode) return byCode;
  const normalisedLabel = reportedLabel.trim().toLowerCase();
  return catalog.find((c) => c.name.trim().toLowerCase() === normalisedLabel) ?? null;
}

/** Turns one model row into a validated row. Runs on EVERY row regardless of
 * what the model claimed, so a hallucinated code never reaches the database. */
export function validateExtractedCardRow(
  raw: z.infer<typeof rawRowSchema>,
  catalog: VaccinationCatalogueEntry[]
): ExtractedCardRow {
  const base = {
    reportedLabel: raw.reported_label,
    doseNumberHint: raw.dose_number_hint?.trim() || null,
    provider: raw.provider?.trim() || null,
    batchLotNumber: raw.batch_lot_number?.trim() || null,
    confidence: raw.confidence,
  };

  const entry = resolveVaccinationCatalogEntry(raw.reported_label, raw.code, catalog);
  if (!entry) {
    return { ...base, vaccinationCatalogId: null, vaccineName: null, dateAdministered: null, status: "unmapped" };
  }

  const dateAdministered = normaliseCardDate(raw.date_administered);
  if (!dateAdministered) {
    return {
      ...base,
      vaccinationCatalogId: entry.id,
      vaccineName: entry.name,
      dateAdministered: null,
      status: "unreadable_date",
    };
  }

  return {
    ...base,
    vaccinationCatalogId: entry.id,
    vaccineName: entry.name,
    dateAdministered,
    status: "ready",
  };
}

/**
 * Extract doses from a base64-encoded vaccination card/record. Never throws.
 *
 * PDFs go through Anthropic's `document` content block; images through
 * `image_url`. Both are sent inline as base64 — the document never leaves
 * this request, and nothing is persisted by this function.
 */
export async function extractVaccinationCard(input: {
  fileBase64: string;
  mediaType: string;
  catalog: VaccinationCatalogueEntry[];
  /** Injectable for tests; defaults to a real Claude client. */
  model?: ChatAnthropic;
}): Promise<VaccinationCardExtractionResult> {
  if (!input.model && !isVaccinationCardExtractionConfigured()) {
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
        // Same claude-*-5-generation workaround as lab-reports/ecg-reports:
        // @langchain/anthropic@0.3.x unconditionally sends these, and this
        // model generation rejects them outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(rawExtractionSchema, {
      name: "vaccination_card_extraction",
    });

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
        new SystemMessage(buildSystemPrompt(input.catalog)),
        new HumanMessage({
          content: [
            { type: "text", text: "Transcribe every dose recorded on this vaccination card or record." },
            documentBlock,
          ],
        }),
      ],
      { signal: controller.signal }
    );

    const parsed = rawExtractionSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "error" };

    const rows = parsed.data.rows.map((row) => validateExtractedCardRow(row, input.catalog));

    return {
      ok: true,
      extraction: {
        cardHolderName: parsed.data.card_holder_name?.trim() || null,
        rows,
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

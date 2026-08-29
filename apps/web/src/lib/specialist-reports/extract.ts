import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * Specialist-consultation-report vision boundary — reads a photo or PDF of a
 * specialist's written report and drafts its structured content.
 *
 * AI DRAFTS, NEVER DECIDES. Identical discipline to lib/lab-reports/extract.ts
 * and lib/ecg-reports/extract.ts: the output of this module is a DRAFT a
 * clinician reviews side by side with the original document, via
 * confirm_specialist_consultation_extraction. Nothing here writes to the
 * patient's record, creates a task, or touches the referral — it turns a
 * transcription job into a review.
 *
 * Never throws. On any failure (no key, timeout, malformed output, unreadable
 * document) it returns a definitive failure and the caller records a `failed`
 * extraction, leaving the existing manual treatment_plan_note path completely
 * intact (specialists have no platform login, so that manual path is not a
 * fallback being deprecated — it stays the way a phoned-in or lost report
 * still reaches the record).
 */

const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_ID = "claude-sonnet-5";

export const RECOMMENDATION_ACTION_TYPES = [
  "repeat_test",
  "investigation",
  "follow_up_appointment",
  "medication_review",
  "care_plan_review",
  "other",
] as const;

const recommendationSchema = z.object({
  /** What the specialist recommended, in the reviewer's own words is fine — this is a draft. */
  description: z.string(),
  /** Best-guess bucket for routing. Never trusted blindly — the reviewer picks the final one. */
  action_type: z.enum(RECOMMENDATION_ACTION_TYPES),
  /** Days from today the model thinks this is due, if the report gives a timeframe ("in 3 months" -> ~90). Null if no timeframe was stated. */
  suggested_due_days: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});

const rawExtractionSchema = z.object({
  report_date: z.string().nullable(),
  specialist_name: z.string().nullable(),
  facility_name: z.string().nullable(),
  /** Used ONLY for the mismatch warning, never stored as identity. */
  patient_name: z.string().nullable(),
  diagnosis: z.string().nullable(),
  recommendations: z.array(recommendationSchema).max(20),
  /** As printed — informational only, never filed to any prescribing table. */
  medications_mentioned: z.array(z.string()).max(30),
  investigations_mentioned: z.array(z.string()).max(20),
  /** Overall follow-up interval in days if the report states one plainly (e.g. "review in 6 months" -> 180). */
  follow_up_interval_days: z.number().nullable(),
  unreadable_reason: z.string().nullable(),
});

export type RecommendationActionType = (typeof RECOMMENDATION_ACTION_TYPES)[number];

export interface ExtractedRecommendation {
  description: string;
  actionType: RecommendationActionType;
  suggestedDueDays: number | null;
  confidence: "low" | "medium" | "high";
}

export interface SpecialistConsultationExtraction {
  reportDate: string | null;
  specialistName: string | null;
  facilityName: string | null;
  patientNameOnReport: string | null;
  diagnosis: string | null;
  recommendations: ExtractedRecommendation[];
  medicationsMentioned: string[];
  investigationsMentioned: string[];
  followUpIntervalDays: number | null;
  unreadableReason: string | null;
}

export type SpecialistReportExtractionResult =
  | { ok: true; extraction: SpecialistConsultationExtraction }
  | { ok: false; reason: "unavailable" | "error" | "unsupported_type" };

export const EXTRACTABLE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function isSpecialistReportExtractionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = [
  "You transcribe and structure specialist consultation reports for a Nigerian digital health platform.",
  "",
  "A doctor reviews everything you output, side by side with the original document, before any of it",
  "is filed against the patient's referral or turned into a task. Your job is faithful reading and",
  "sensible structuring — not clinical judgement.",
  "",
  "Rules, no exceptions:",
  "- diagnosis: the specialist's stated diagnosis or clinical impression, as written. Null if none is stated.",
  "- recommendations: one entry per distinct instruction the specialist gave (e.g. 'repeat HbA1c in 3",
  "  months', 'start on X', 'cardiology follow-up in 6 months', 'arrange an echocardiogram'). Pick the",
  "  closest action_type: repeat_test/investigation for a test or scan to redo or newly arrange,",
  "  follow_up_appointment for a specific future visit, medication_review for anything about starting,",
  "  stopping or adjusting a medication, care_plan_review for a general instruction to Tarragon's own",
  "  team without a specific test/visit, other for anything that doesn't fit. Never invent a",
  "  recommendation that is not actually written on the report.",
  "- suggested_due_days: only when the report states or clearly implies a timeframe ('in 3 months' ~90,",
  "  'in 2 weeks' ~14, 'in 6 months' ~180). Null if no timeframe is given — never guess one.",
  "- medications_mentioned / investigations_mentioned: copied as printed, informational only. These are",
  "  NOT the same as recommendations — a medication already being taken and merely mentioned is not a",
  "  new recommendation.",
  "- follow_up_interval_days: the specialist's own overall review interval if plainly stated (e.g. the",
  "  report closes with 'review in clinic in 6 months'). Null if not stated.",
  "- If the document is not a consultation report, or is too blurred/cropped to read safely, set",
  "  unreadable_reason and return empty arrays.",
  "- Set confidence per recommendation to 'low' for anything unclear, smudged, cut off, or handwritten.",
].join("\n");

/**
 * Extract structured content from a base64-encoded specialist report. Never throws.
 */
export async function extractSpecialistConsultationReport(input: {
  fileBase64: string;
  mediaType: string;
  /** Optional hint — the referral's specialist_type — shown to the model for context only. */
  contextHint?: string | null;
  model?: ChatAnthropic;
}): Promise<SpecialistReportExtractionResult> {
  if (!input.model && !isSpecialistReportExtractionConfigured()) {
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
        // Same claude-*-5-generation workaround as lab-reports/case-briefs:
        // @langchain/anthropic@0.3.x unconditionally sends these, and this
        // model generation rejects them outright.
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(rawExtractionSchema, {
      name: "specialist_consultation_extraction",
    });

    const instruction = input.contextHint
      ? `Read and structure this specialist consultation report. It follows a referral to: ${input.contextHint}. Transcribe what is actually on the page regardless of that expectation.`
      : "Read and structure this specialist consultation report.";

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

    return {
      ok: true,
      extraction: {
        reportDate: parsed.data.report_date,
        specialistName: parsed.data.specialist_name?.trim() || null,
        facilityName: parsed.data.facility_name?.trim() || null,
        patientNameOnReport: parsed.data.patient_name?.trim() || null,
        diagnosis: parsed.data.diagnosis?.trim() || null,
        recommendations: parsed.data.recommendations.map((r) => ({
          description: r.description,
          actionType: r.action_type,
          suggestedDueDays: r.suggested_due_days,
          confidence: r.confidence,
        })),
        medicationsMentioned: parsed.data.medications_mentioned,
        investigationsMentioned: parsed.data.investigations_mentioned,
        followUpIntervalDays: parsed.data.follow_up_interval_days,
        unreadableReason: parsed.data.unreadable_reason?.trim() || null,
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

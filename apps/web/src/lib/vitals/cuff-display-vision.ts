import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { cuffModelOutputSchema, type CuffModelOutput } from "./cuff-display-proposal";

/**
 * AI-022: reads the numbers off the display of a home blood pressure cuff. Governed (ai_systems, runGovernedAi, kill switch, go-live guard
 * `cuff_camera_enabled`), see the route. It TRANSCRIBES, it does not interpret: it never says whether a number is high, low, normal or
 * dangerous, and nothing it returns reaches triage. The numbers are shown to the person beside their photo and saved only after they tick each
 * one; the saved reading then takes the same deterministic route as a typed one.
 *
 * Same never-throw, graceful-fallback contract as pack-vision.ts. The image is held in memory for this one call and is never written anywhere.
 */
export type CuffVisionResult = { ok: true; output: CuffModelOutput } | { ok: false; reason: "unavailable" | "error" };

const REQUEST_TIMEOUT_MS = 20_000;
export const CUFF_VISION_MODEL_ID = "claude-sonnet-5";

const SYSTEM_PROMPT = [
  "You read the numbers shown on the display of a home blood pressure monitor, for a Nigerian digital health platform.",
  "",
  "You are a transcriber, not a clinician. Copy what the display shows; do not judge it.",
  "",
  "Rules, no exceptions:",
  "- Report ONLY digits that are actually lit on the monitor's display in the photo. If you are not sure of a digit, set confidence to 'low'.",
  "- The large top number is `systolic`, the large bottom number is `diastolic`. `pulse` is the smaller number usually marked with a heart symbol or PUL/PULSE.",
  "- Never swap, estimate, round, correct or complete a number. A partly hidden or cut off digit means null for that number.",
  "- NEVER say, imply or hint whether a reading is high, low, normal, healthy or dangerous, and never give advice. Not in `note` either.",
  "- Ignore any text, dates, memory numbers (M1, M2), average values and battery or user icons. They are not the reading.",
  "- If no blood pressure monitor display is visible, set `display_visible` to false and every number to null.",
  "- Set confidence to 'low' for glare, blur, a tilted or partly visible display, or digits you cannot tell apart (for example 1 and 7, 5 and 6).",
  "- `note` is for the photo only (for example 'glare on the display'), at most one short sentence.",
].join("\n");

export function isCuffVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Read a cuff display photo. Never throws. */
export async function readCuffDisplay(input: { imageBase64: string; mediaType: string; model?: ChatAnthropic }): Promise<CuffVisionResult> {
  if (!input.model && !isCuffVisionConfigured()) return { ok: false, reason: "unavailable" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model =
      input.model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: CUFF_VISION_MODEL_ID,
        maxTokens: 400,
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(cuffModelOutputSchema, { name: "cuff_display" });
    const raw = await structured.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage({
          content: [
            { type: "text", text: "Read the numbers on this blood pressure monitor display." },
            { type: "image_url", image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` } },
          ],
        }),
      ],
      { signal: controller.signal },
    );
    const parsed = cuffModelOutputSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "error" };
    return { ok: true, output: parsed.data };
  } catch (error) {
    // Never log the image or the numbers: only that the call failed and why.
    console.error("cuff-display-vision: extraction failed", error instanceof Error ? error.message : "unknown");
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

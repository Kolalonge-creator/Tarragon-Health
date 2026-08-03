import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

/**
 * Reads what is PRINTED on a medicine pack.
 *
 * Patients now buy from any pharmacy, so nobody on this platform sees the box.
 * This reads the box back: drug name, strength, form, manufacturer, and the
 * NAFDAC registration number if one is printed.
 *
 * ⚠️ IT NEVER JUDGES AUTHENTICITY, and the prompt forbids it explicitly. Tarragon
 * has no authority to declare a medicine genuine, and a false reassurance about
 * a counterfeit is a far worse outcome than no answer at all. What it reports is
 * what the pack SAYS. Whether that pack is real is NAFDAC's Mobile
 * Authentication Service to answer, and the UI points there.
 *
 * Same never-throw, graceful-fallback contract as meal-vision.ts.
 */

const packSchema = z.object({
  /** Generic (INN) name if printed, else whatever name is most prominent. */
  drug_name: z.string().nullable(),
  /** Brand name, when the pack shows one distinct from the generic. */
  brand_name: z.string().nullable(),
  /** Verbatim, e.g. "10mg", "500mg/5ml". */
  strength: z.string().nullable(),
  /** Tablet, capsule, syrup, injection, etc. */
  form: z.string().nullable(),
  manufacturer: z.string().nullable(),
  /** NAFDAC registration number as printed, e.g. "A4-1234". */
  nafdac_number: z.string().nullable(),
  expiry_printed: z.string().nullable(),
  /** Whether a MAS scratch panel is visible, so the UI can tailor its advice. */
  has_scratch_panel: z.boolean(),
  confidence: z.enum(["low", "medium", "high"]),
  /** Set when the photo is too poor or is not a medicine pack at all. */
  unreadable_reason: z.string().nullable(),
});

export type PackReading = z.infer<typeof packSchema>;

export type PackVisionResult =
  | { ok: true; reading: PackReading }
  | { ok: false; reason: "unavailable" | "error" };

const REQUEST_TIMEOUT_MS = 20_000;
const MODEL_ID = "claude-sonnet-5";

const SYSTEM_PROMPT = [
  "You read what is printed on a medicine pack, for a Nigerian digital health platform.",
  "",
  "You are a transcriber, not an authenticator. Read the pack; do not judge it.",
  "",
  "Rules, no exceptions:",
  "- Report ONLY text that is actually printed on the packaging in the photo.",
  "- NEVER say, imply, or hint at whether the medicine is genuine, counterfeit, safe, fake,",
  "  substandard, or approved. You have no way to know this from a photo, and a wrong",
  "  reassurance could seriously harm someone. Authenticity is NAFDAC's to answer, not yours.",
  "- Never comment on whether the patient should take the medicine.",
  "- Prefer the generic (INN) name for `drug_name`. If the pack shows a brand name too, put it",
  "  in `brand_name`. If only a brand name is printed, use it for `drug_name` as well.",
  "- Copy `strength` verbatim, including units, exactly as printed.",
  "- `nafdac_number` is the NAFDAC registration number printed on Nigerian packs, often in the",
  "  form 'A4-1234' or '04-5678'. Null if you cannot see one clearly.",
  "- `has_scratch_panel` is true only if you can actually see a scratch-off authentication panel.",
  "- Set confidence to 'low' if the photo is blurred, angled, partly obscured, or the print is",
  "  too small to be sure of.",
  "- If the photo is not a medicine pack, or is unreadable, set `unreadable_reason` and null the",
  "  other fields.",
].join("\n");

export function isPackVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Read a medicine pack photo. Never throws. */
export async function readMedicationPack(input: {
  imageBase64: string;
  mediaType: string;
  model?: ChatAnthropic;
}): Promise<PackVisionResult> {
  if (!input.model && !isPackVisionConfigured()) {
    return { ok: false, reason: "unavailable" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model =
      input.model ??
      new ChatAnthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: MODEL_ID,
        maxTokens: 700,
        invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
      });
    const structured = model.withStructuredOutput(packSchema, { name: "medication_pack" });

    const raw = await structured.invoke(
      [
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage({
          content: [
            { type: "text", text: "Read what is printed on this medicine pack." },
            {
              type: "image_url",
              image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` },
            },
          ],
        }),
      ],
      { signal: controller.signal },
    );

    const parsed = packSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: "error" };
    return { ok: true, reading: parsed.data };
  } catch {
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { summariseFoodReference } from "./nigerian-foods";

/**
 * Meal-photo vision boundary — estimates portions/carbs from a food photo,
 * grounded against a Nigerian food set.
 *
 * COACHING TELEMETRY ONLY. The estimate is never a clinical value: it never
 * feeds patient_risk_scores, escalation, or the abnormal-result pipeline, and
 * is never attributed to a doctor. Same never-throw, 5s-timeout, graceful-
 * fallback contract as packages/shared/ml-client.ts and lib/identity/provider.ts:
 * on any failure (no key, timeout, malformed output) it returns a definitive
 * fallback and the caller stores the entry with no estimate. Reuses the AI stack
 * already wired for the AI Coach (@langchain/anthropic + ANTHROPIC_API_KEY).
 */

export const mealEstimateItemSchema = z.object({
  name: z.string(),
  portion: z.string(),
  est_carbs_g: z.number(),
});

export const mealEstimateSchema = z.object({
  items: z.array(mealEstimateItemSchema).max(20),
  est_carbs_g: z.number(),
  est_calories: z.number(),
  confidence: z.enum(["low", "medium", "high"]),
  notes: z.string().nullable(),
});

export type MealEstimate = z.infer<typeof mealEstimateSchema>;

export type MealVisionResult =
  | { ok: true; estimate: MealEstimate }
  | { ok: false; reason: "unavailable" | "error" };

const REQUEST_TIMEOUT_MS = 5000;

const SYSTEM_PROMPT = [
  "You are a nutrition-coaching assistant for a Nigerian digital health platform.",
  "You estimate the food in a meal photo and its rough carbohydrate and calorie content.",
  "This is COACHING GUIDANCE ONLY, not a medical or diagnostic measurement — never phrase it as clinical advice.",
  "Prefer Nigerian dishes and portion norms. Use this reference for local staples' typical carbohydrate loads:",
  summariseFoodReference(),
  "Rules: identify each distinct food item you can see; give a plain-language portion (e.g. '1 medium plate', '2 wraps').",
  "Estimate total carbohydrate grams and total calories for the whole plate.",
  "Set confidence to 'low' when the photo is unclear, partial, or the food is unfamiliar.",
  "Do not invent foods you cannot see. If the image is not food, return an empty items list, zeros, and confidence 'low'.",
].join("\n");

function buildUserText(description?: string | null): string {
  const base =
    "Estimate the foods, total carbohydrate grams, and total calories in this meal photo.";
  if (description && description.trim().length > 0) {
    return `${base}\nThe patient described it as: ${description.trim()}`;
  }
  return base;
}

export function isMealVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Analyse a base64-encoded meal photo. Never throws. Returns `unavailable`
 * when no API key is configured (caller stores the entry with no estimate),
 * `error` on timeout / network / malformed output.
 */
export async function analyzeMealPhoto(input: {
  imageBase64: string;
  mediaType: string;
  description?: string | null;
}): Promise<MealVisionResult> {
  if (!isMealVisionConfigured()) {
    return { ok: false, reason: "unavailable" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      maxTokens: 700,
      // Same reason as the AI Coach: claude-sonnet-5 rejects
      // temperature/top_p/top_k — omit them entirely.
      invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
    });
    const structured = model.withStructuredOutput(mealEstimateSchema, {
      name: "meal_estimate",
    });
    const messages = [
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage({
        content: [
          { type: "text", text: buildUserText(input.description) },
          {
            type: "image_url",
            image_url: { url: `data:${input.mediaType};base64,${input.imageBase64}` },
          },
        ],
      }),
    ];
    const raw = await structured.invoke(messages, { signal: controller.signal });
    const parsed = mealEstimateSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, reason: "error" };
    }
    return { ok: true, estimate: parsed.data };
  } catch {
    // Timeout (AbortError), network failure, or malformed structured output.
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

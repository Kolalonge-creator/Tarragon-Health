import "server-only";
import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { MEAL_TYPES } from "@/lib/validation/nutrition";
import type { FoodCatalogueItem, FoodCostTier } from "./food-catalogue";
import type { CarePlanCondition } from "./condition-guidance";
import { validateMealPlan, type RawMealPlan, type ValidatedMealPlan } from "./meal-plan-validate";

/**
 * 7-day Nigerian meal planner (spec 19.8) — LLM boundary.
 *
 * Same never-throw, graceful-fallback contract as meal-vision.ts and
 * packages/shared/ml-client.ts, but sized for a much bigger generation (21+
 * meal slots across a week rather than one photo), so the token budget and
 * timeout are both larger. COACHING GUIDANCE ONLY — never a prescribed diet,
 * never fed to patient_risk_scores/escalation, never attributed to a doctor.
 *
 * CKD is refused here too, not just at the caller (defence in depth): CKD
 * nutrition genuinely needs individual lab-based balancing of sodium,
 * potassium and phosphorus, and a generated generic plan is exactly the
 * "overly restrictive generic recommendation" spec 19.6 rules out — those
 * patients are routed to the dietitian-referral pathway instead.
 */

const REQUEST_TIMEOUT_MS = 25000;

const mealPlanItemSchema = z.object({
  food_code: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  rationale: z.string().nullable(),
});

const mealPlanDaySchema = z.object({
  day: z.number().int().min(1).max(7),
  meals: z.object({
    breakfast: z.array(mealPlanItemSchema).max(6).optional(),
    lunch: z.array(mealPlanItemSchema).max(6).optional(),
    dinner: z.array(mealPlanItemSchema).max(6).optional(),
    snack: z.array(mealPlanItemSchema).max(6).optional(),
  }),
});

const mealPlanSchema = z.object({
  days: z.array(mealPlanDaySchema).length(7),
  summary: z.string(),
  notes: z.string().nullable(),
});

export type MealPlanGenerationResult =
  | { ok: true; plan: ValidatedMealPlan }
  | { ok: false; reason: "unavailable" | "error" | "ckd_not_offered" };

export function isMealPlanGenerationConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function summariseCatalogueForPrompt(catalogue: readonly FoodCatalogueItem[]): string {
  return catalogue
    .map((f) => {
      const alias = f.aliases.length ? ` (also: ${f.aliases.join(", ")})` : "";
      const units = f.portions.length ? f.portions.map((p) => p.unit).join("/") : "serving";
      return `${f.code} = ${f.name}${alias} [${f.category}, ${f.costTier} cost, portions: ${units}]`;
    })
    .join("\n");
}

function buildSystemPrompt(input: {
  catalogue: readonly FoodCatalogueItem[];
  conditions: readonly CarePlanCondition[];
  budgetTier: FoodCostTier | null;
}): string {
  const lines = [
    "You are a nutrition-coaching assistant for a Nigerian digital health platform, generating a realistic 7-day meal plan.",
    "This is COACHING GUIDANCE ONLY, never a prescribed or clinical diet — never phrase anything as treatment or a medical instruction.",
    "You MUST choose every item from the food_code values listed below — never invent a food_code that isn't in this list.",
    `Every day needs breakfast, lunch and dinner; snack is optional. Meal slots are exactly: ${MEAL_TYPES.join(", ")}.`,
    "For each item give: food_code, a quantity (a plain number), a unit from plate/cup/spoon/handful/piece/serving, and a short one-sentence plain-language rationale.",
    "Use 1-3 items per meal slot. Vary the dishes across the week — real Nigerian home cooking has natural variety, don't repeat the same combination every day.",
    "",
    "Food list (food_code = name (aliases) [category, cost tier, portion units]):",
    summariseCatalogueForPrompt(input.catalogue),
  ];

  if (input.conditions.includes("hypertension")) {
    lines.push(
      "",
      "The patient has hypertension: keep total sodium moderate across each day. Favour fresh ingredients over dried/smoked fish, stock cubes and processed items, and avoid stacking multiple high-sodium items (e.g. egusi soup AND suya AND dried fish) on the same day.",
    );
  }
  if (input.conditions.includes("diabetes")) {
    lines.push(
      "",
      "The patient has diabetes: keep carbohydrate portions moderate and pair starchy staples with protein/fibre rather than stacking multiple high-carb items in one meal. Favour variety in starch choice across the week over repeating the same one.",
    );
  }
  if (input.budgetTier === "budget") {
    lines.push(
      "",
      "The patient asked to keep this affordable — strongly prefer 'budget' cost-tier items; use 'mid' tier only when there's no reasonable budget alternative for that role on the plate.",
    );
  }

  lines.push(
    "",
    "Write `summary` as 2-3 warm, plain-language sentences about the plan's overall shape (never alarmist, never fear-based).",
    "Use `notes` (or null) for anything worth flagging — e.g. a preference you could only partly honour, given the food list.",
  );

  return lines.join("\n");
}

function buildUserPrompt(preferencesNote: string | null): string {
  const base = "Generate the 7-day meal plan now.";
  if (preferencesNote && preferencesNote.trim().length > 0) {
    return `${base}\nThe patient also said: "${preferencesNote.trim()}" — honour this where the food list allows; if you can't fully honour it, say so briefly in notes.`;
  }
  return base;
}

export async function generateMealPlan(input: {
  catalogue: FoodCatalogueItem[];
  conditions: CarePlanCondition[];
  budgetTier: FoodCostTier | null;
  preferencesNote: string | null;
}): Promise<MealPlanGenerationResult> {
  if (input.conditions.includes("ckd")) {
    return { ok: false, reason: "ckd_not_offered" };
  }
  if (!isMealPlanGenerationConfigured()) {
    return { ok: false, reason: "unavailable" };
  }
  if (input.catalogue.length === 0) {
    return { ok: false, reason: "error" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      maxTokens: 4000,
      // Same reason as meal-vision.ts / the AI Coach: claude-sonnet-5
      // rejects temperature/top_p/top_k — omit them entirely.
      invocationKwargs: { temperature: undefined, top_p: undefined, top_k: undefined },
    });
    const structured = model.withStructuredOutput(mealPlanSchema, { name: "meal_plan" });
    const messages = [
      new SystemMessage(buildSystemPrompt(input)),
      new HumanMessage(buildUserPrompt(input.preferencesNote)),
    ];
    const raw = await structured.invoke(messages, { signal: controller.signal });
    const parsed = mealPlanSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, reason: "error" };
    }
    const validated = validateMealPlan(parsed.data as RawMealPlan, input.catalogue);
    return { ok: true, plan: validated };
  } catch {
    // Timeout (AbortError), network failure, or malformed structured output.
    return { ok: false, reason: "error" };
  } finally {
    clearTimeout(timer);
  }
}

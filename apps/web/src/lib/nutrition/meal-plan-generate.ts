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

const REQUEST_TIMEOUT_MS = 40000;

const mealPlanItemSchema = z.object({
  food_code: z.string(),
  quantity: z.number().positive(),
  unit: z.string(),
  rationale: z.string().nullable(),
});

/**
 * Real finding (2026-09-16, AI-011 evaluation): `.optional()` alone accepts
 * a missing key but rejects an explicit `null` -- and the model reliably
 * writes `"snack": null` (a perfectly natural way to say "no snack today"),
 * which withStructuredOutput's schema validation then rejected outright,
 * throwing OUTPUT_PARSING_FAILURE and discarding the entire 7-day plan over
 * one slot on one day. Not an edge case: snack is optional by design (see
 * buildSystemPrompt below), so an empty snack day is the COMMON case, and
 * this made real generation fail far more often than it succeeded.
 * validateMealPlan() below already treats a missing/empty/null slot
 * identically (`if (!rawItems || rawItems.length === 0) continue`), so
 * `.nullable()` costs nothing downstream -- it only stops rejecting a
 * perfectly valid, common shape at the schema boundary.
 */
const optionalMealSlot = () => z.array(mealPlanItemSchema).max(6).nullable().optional();

const mealPlanDaySchema = z.object({
  day: z.number().int().min(1).max(7),
  meals: z.object({
    breakfast: optionalMealSlot(),
    lunch: optionalMealSlot(),
    dinner: optionalMealSlot(),
    snack: optionalMealSlot(),
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

/**
 * One real attempt at the model call. Never throws to its caller in the
 * "expected failure" sense -- OUTPUT_PARSING_FAILURE and a failed safeParse
 * both come back as `null`, same as a timeout/network error, so
 * generateMealPlan can decide whether to retry.
 */
async function attemptGeneration(input: {
  catalogue: FoodCatalogueItem[];
  conditions: CarePlanCondition[];
  budgetTier: FoodCostTier | null;
  preferencesNote: string | null;
}): Promise<ValidatedMealPlan | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const model = new ChatAnthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      // A full 7-day plan (up to 4 meal slots x up to 3 items x a rationale
      // sentence each) is a large structured generation -- headroom above
      // the original 4000 costs nothing and protects against a genuinely
      // large plan (many items per slot, a long preferencesNote) truncating
      // mid-object.
      maxTokens: 6000,
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
      console.error("meal-plan-generate: model output failed schema validation", parsed.error);
      return null;
    }
    return validateMealPlan(parsed.data as RawMealPlan, input.catalogue);
  } catch (error) {
    // Timeout (AbortError), network failure, or malformed structured output.
    // Real gap found during the AI-011 evaluation (2026-09-16): this used to
    // swallow the cause entirely, so a real production failure here was
    // undiagnosable -- the caller only ever saw reason: "error", never why.
    console.error("meal-plan-generate: generation attempt failed", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
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

  // Real finding (2026-09-16, AI-011 evaluation): claude-sonnet-5 tool-use
  // output for a payload this large (up to 84 items across 7 days) fails
  // AnthropicToolsOutputParser's own validation on a genuinely stochastic
  // basis -- observed roughly half of real, independent attempts against
  // the live catalogue, with no pattern tied to conditions/budget/prompt
  // content (the "days" field itself sometimes arrives as a malformed
  // string rather than an array, a tool-call-encoding issue on the
  // provider/library side, not a schema or prompt bug this codebase can
  // fix directly). One retry on a genuine failure raises the realistic
  // success rate from roughly 50% to roughly 75-90%+ without materially
  // changing worst-case latency for the common case (the first attempt
  // usually succeeds).
  const first = await attemptGeneration(input);
  const plan = first ?? (await attemptGeneration(input));
  if (!plan) {
    return { ok: false, reason: "error" };
  }
  return { ok: true, plan };
}

import type { Enums } from "@tarragon/shared";
import type { NutritionAnalysisResult } from "./nutrition-analysis";

/**
 * Condition-specific nutrition guidance (spec 19.6): hypertension focuses on
 * sodium and overall pattern; diabetes focuses on carbohydrate quality,
 * portion and overall pattern; CKD nutrition is genuinely complex and needs
 * a dietitian rather than a generic rule, so this deliberately never gives
 * CKD a numeric target — it always points toward professional input instead
 * (see referral-risk.ts). Coaching tone throughout: never "don't eat X",
 * matching the substitution engine's own framing.
 *
 * Pure module — conditions and the analysis to react to are passed in, so
 * this is unit-testable without touching Supabase.
 */

export type CarePlanCondition = Enums<"care_plan_condition">;

export interface NutritionGuidanceMessage {
  condition: CarePlanCondition | "general";
  tone: "watch" | "encourage";
  message: string;
}

// A single meal's sodium/carb "watch" threshold — a rough third of a
// whole-day target (WHO's <5g salt/day is ~2000mg sodium; a commonly used
// diabetes per-meal carb guide is 45-75g), not a precise clinical cutoff.
const SODIUM_MEAL_WATCH_MG = 700;
const CARBS_MEAL_WATCH_G = 75;

export function getConditionNutritionGuidance(
  conditions: readonly CarePlanCondition[],
  analysis: NutritionAnalysisResult | null,
): NutritionGuidanceMessage[] {
  const messages: NutritionGuidanceMessage[] = [];
  const has = (c: CarePlanCondition) => conditions.includes(c);

  if (has("ckd")) {
    messages.push({
      condition: "ckd",
      tone: "watch",
      message:
        "CKD nutrition often means balancing sodium, potassium and phosphorus together, which isn't something to guess at from a food description. A dietitian can build a plan around your own lab results — ask your care team about that referral.",
    });
  }

  if (has("hypertension")) {
    if (analysis && analysis.reliable && analysis.sodiumMg > SODIUM_MEAL_WATCH_MG) {
      messages.push({
        condition: "hypertension",
        tone: "watch",
        message:
          "This meal looks higher in sodium than we'd like for your blood pressure goals. No need to cut it out entirely — easing back on seasoning cubes, dried/smoked fish and fried sides, and leaning on fresh herbs and pepper for flavour, makes a real difference.",
      });
    } else {
      messages.push({
        condition: "hypertension",
        tone: "encourage",
        message:
          "For blood pressure, the overall pattern matters more than any single meal — more vegetables and fresh food, and going easy on salt, seasoning cubes and processed or dried proteins most days.",
      });
    }
  }

  if (has("diabetes")) {
    if (analysis && analysis.reliable && analysis.carbsG > CARBS_MEAL_WATCH_G) {
      messages.push({
        condition: "diabetes",
        tone: "watch",
        message:
          "This meal is quite carb-heavy. Consider a smaller portion of the starchy part (rice, swallow, etc.) and filling the rest of the plate with vegetables and protein — that tends to be gentler on blood sugar than the starch alone.",
      });
    } else {
      messages.push({
        condition: "diabetes",
        tone: "encourage",
        message:
          "For blood sugar, portion and pairing matter as much as the food itself — spreading carbs across the day and pairing them with protein, fibre or vegetables helps more than avoiding any one food.",
      });
    }
  }

  if (messages.length === 0) {
    messages.push({
      condition: "general",
      tone: "encourage",
      message:
        "A good everyday target: roughly half the plate vegetables, a quarter protein, a quarter starch — a flexible guide, not a rule for every single meal.",
    });
  }

  return messages;
}

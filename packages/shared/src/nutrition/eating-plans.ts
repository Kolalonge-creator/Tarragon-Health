/**
 * Healthier swaps and condition eating plans (v5 6.8 and 6.9), read from the SIGNED `nutrition_guidance_config`.
 *
 * Nothing here decides who may see a plan. `my_nutrition_guidance()` in the database does, and it answers "not signed yet" and "not for you"
 * identically (`unavailable`). Code here only refuses to use an answer it does not understand: anything unexpected is `unavailable`, the safe
 * direction, which the screens render as nothing at all.
 *
 * Wording rule: a swap is an idea, never a verdict. There is no "good food" or "bad food" field, and the reason is a plain sentence.
 */

export type SwapReasonKind = "less_salt" | "less_refined_carbohydrate" | "more_fibre" | "less_sugar" | "lighter_cooking";
export type PlanCode = "hypertension" | "diabetes" | "kidney" | "pregnancy" | "weight";
export type SwapAudience = "hypertension" | "diabetes" | "general";

const REASON_KINDS: readonly SwapReasonKind[] = ["less_salt", "less_refined_carbohydrate", "more_fibre", "less_sugar", "lighter_cooking"];
const PLAN_CODES: readonly PlanCode[] = ["hypertension", "diabetes", "kidney", "pregnancy", "weight"];
const AUDIENCES: readonly SwapAudience[] = ["hypertension", "diabetes", "general"];

export const REASON_KIND_LABEL: Record<SwapReasonKind, string> = {
  less_salt: "Less salt",
  less_refined_carbohydrate: "Less refined carbohydrate",
  more_fibre: "More fibre",
  less_sugar: "Less sugar",
  lighter_cooking: "Lighter cooking",
};

export interface FoodSwap {
  code: string;
  fromFoodCode: string;
  toFoodCodes: string[];
  reasonKind: SwapReasonKind;
  reason: string;
  audience: SwapAudience[];
}

export interface PlanTip {
  heading: string;
  body: string;
}

export interface EatingPlan {
  code: PlanCode;
  title: string;
  intro: string;
  tips: PlanTip[];
  careTeamPrompt: string;
}

export interface EatingGuidanceOk {
  state: "ok";
  configVersion: number;
  swaps: FoodSwap[];
  plans: EatingPlan[];
}

export type EatingGuidance = { state: "unavailable" } | EatingGuidanceOk;

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseSwap(raw: unknown): FoodSwap | null {
  if (!isRecord(raw)) return null;
  if (!isStr(raw.code) || !isStr(raw.from_food_code) || !isStr(raw.reason)) return null;
  if (!REASON_KINDS.includes(raw.reason_kind as SwapReasonKind)) return null;
  if (!Array.isArray(raw.to_food_codes) || raw.to_food_codes.length === 0 || !raw.to_food_codes.every(isStr)) return null;
  if (!Array.isArray(raw.for) || raw.for.length === 0) return null;
  const audience = raw.for.filter((a): a is SwapAudience => AUDIENCES.includes(a as SwapAudience));
  if (audience.length === 0) return null;
  return {
    code: raw.code,
    fromFoodCode: raw.from_food_code,
    toFoodCodes: raw.to_food_codes as string[],
    reasonKind: raw.reason_kind as SwapReasonKind,
    reason: raw.reason,
    audience,
  };
}

function parsePlan(raw: unknown): EatingPlan | null {
  if (!isRecord(raw)) return null;
  if (!PLAN_CODES.includes(raw.code as PlanCode)) return null;
  if (!isStr(raw.title) || !isStr(raw.intro) || !isStr(raw.care_team_prompt)) return null;
  if (!Array.isArray(raw.tips) || raw.tips.length === 0) return null;
  const tips: PlanTip[] = [];
  for (const t of raw.tips) {
    if (!isRecord(t) || !isStr(t.heading) || !isStr(t.body)) return null;
    tips.push({ heading: t.heading, body: t.body });
  }
  return { code: raw.code as PlanCode, title: raw.title, intro: raw.intro, tips, careTeamPrompt: raw.care_team_prompt };
}

/** Reads the JSON `my_nutrition_guidance()` returns. A malformed swap or plan makes the whole answer unavailable rather than showing half of it. */
export function parseEatingGuidance(raw: unknown): EatingGuidance {
  if (!isRecord(raw) || raw.state !== "ok") return { state: "unavailable" };
  if (typeof raw.config_version !== "number" || !Number.isFinite(raw.config_version)) return { state: "unavailable" };
  if (!Array.isArray(raw.swaps) || !Array.isArray(raw.plans)) return { state: "unavailable" };
  const swaps: FoodSwap[] = [];
  for (const s of raw.swaps) {
    const parsed = parseSwap(s);
    if (!parsed) return { state: "unavailable" };
    swaps.push(parsed);
  }
  const plans: EatingPlan[] = [];
  for (const p of raw.plans) {
    const parsed = parsePlan(p);
    if (!parsed) return { state: "unavailable" };
    plans.push(parsed);
  }
  if (swaps.length === 0 && plans.length === 0) return { state: "unavailable" };
  return { state: "ok", configVersion: raw.config_version, swaps, plans };
}

/**
 * Signed swaps for one food. A swap is offered when its audience list names one of the person's `concerns` (hypertension, diabetes); with
 * no concerns the "general" ones are offered. The order in the signed table is kept (a person reviewed that order).
 */
export function swapsForFood(swaps: readonly FoodSwap[], foodCode: string, concerns: readonly SwapAudience[]): FoodSwap[] {
  const wanted = new Set<SwapAudience>(concerns.length > 0 ? concerns : ["general"]);
  return swaps.filter((s) => s.fromFoodCode === foodCode && s.audience.some((a) => wanted.has(a)));
}

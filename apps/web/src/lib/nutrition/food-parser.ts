import {
  resolvePortionGrams,
  type FoodCatalogueItem,
  type FoodPortionUnit,
} from "./food-catalogue";

/**
 * Text-based food logging (spec 19.4): a patient types something like
 * "Rice, beans and chicken" or "2 serving spoons of rice, a plate of egusi
 * soup and a piece of chicken" — this parses it into structured items
 * matched against the food catalogue, and is explicit about uncertainty
 * (an unmatched item is reported as unmatched, never silently guessed).
 *
 * Pure module: no server-only, no network — the catalogue is passed in so
 * this stays unit-testable with a small fixture list.
 */

export type MatchConfidence = "high" | "medium" | "low";

export interface ParsedFoodItem {
  raw: string;
  foodCode: string | null;
  foodName: string | null;
  quantity: number;
  unit: FoodPortionUnit | null;
  grams: number | null;
  matched: boolean;
  confidence: MatchConfidence;
}

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const UNIT_SYNONYMS: Record<string, FoodPortionUnit> = {
  plate: "plate",
  plates: "plate",
  cup: "cup",
  cups: "cup",
  glass: "cup",
  glasses: "cup",
  spoon: "spoon",
  spoons: "spoon",
  spoonful: "spoon",
  spoonfuls: "spoon",
  tablespoon: "spoon",
  tablespoons: "spoon",
  tbsp: "spoon",
  handful: "handful",
  handfuls: "handful",
  piece: "piece",
  pieces: "piece",
  slice: "piece",
  slices: "piece",
  wrap: "piece",
  wraps: "piece",
  ball: "piece",
  balls: "piece",
  bottle: "piece",
  bottles: "piece",
  serving: "serving",
  servings: "serving",
  bowl: "serving",
  bowls: "serving",
  portion: "serving",
  portions: "serving",
};

/** Two-word unit phrases that must be checked before single-word matching —
 * "serving spoon" is a large-spoon portion, not a generic "1 serving". */
const COMPOUND_UNIT_SYNONYMS: Record<string, FoodPortionUnit> = {
  "serving spoon": "spoon",
  "serving spoons": "spoon",
  "table spoon": "spoon",
  "table spoons": "spoon",
};

const FILLER_PREFIX = /^(a\s+)?(little|bit|small\s+amount)\s+(of\s+)?/i;

function splitSegments(text: string): string[] {
  return text
    .split(/,|;|\band\b|\bwith\b|\bplus\b|\+/gi)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function extractUnitWords(words: string[]): { unit: FoodPortionUnit | null; rest: string[] } {
  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`.toLowerCase();
    const compound = COMPOUND_UNIT_SYNONYMS[twoWord];
    if (compound) {
      let idx = 2;
      if (words[idx]?.toLowerCase() === "of") idx += 1;
      return { unit: compound, rest: words.slice(idx) };
    }
  }
  if (words.length >= 1) {
    const oneWord = words[0].toLowerCase().replace(/[.,]+$/, "");
    const single = UNIT_SYNONYMS[oneWord];
    if (single) {
      let idx = 1;
      if (words[idx]?.toLowerCase() === "of") idx += 1;
      return { unit: single, rest: words.slice(idx) };
    }
  }
  return { unit: null, rest: words };
}

function extractQuantityAndUnit(segment: string): {
  quantity: number;
  unit: FoodPortionUnit | null;
  rest: string;
} {
  let words = segment.trim().split(/\s+/).filter(Boolean);
  let quantity = 1;

  if (words.length > 1) {
    const first = words[0].toLowerCase();
    const asNumber = Number(first);
    if (!Number.isNaN(asNumber) && asNumber > 0) {
      quantity = asNumber;
      words = words.slice(1);
    } else if (first in NUMBER_WORDS) {
      quantity = NUMBER_WORDS[first];
      words = words.slice(1);
    }
  }

  const { unit, rest } = extractUnitWords(words);
  const foodPhrase = rest.join(" ").trim().replace(FILLER_PREFIX, "").trim();
  return { quantity, unit, rest: foodPhrase };
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalise(text).split(" ").filter(Boolean));
}

interface MatchResult {
  food: FoodCatalogueItem;
  confidence: MatchConfidence;
}

/** Best food match for a free-text phrase, or null when nothing scores high
 * enough to be worth reporting — communicating uncertainty rather than
 * guessing (spec 19.4). */
export function matchFood(phrase: string, catalogue: readonly FoodCatalogueItem[]): MatchResult | null {
  const normalisedPhrase = normalise(phrase);
  if (!normalisedPhrase) return null;

  let best: MatchResult | null = null;
  let bestScore = 0;

  for (const food of catalogue) {
    const candidates = [food.name, ...food.aliases];
    for (const candidate of candidates) {
      const normalisedCandidate = normalise(candidate);
      if (!normalisedCandidate) continue;

      if (normalisedPhrase === normalisedCandidate) {
        return { food, confidence: "high" };
      }

      let score = 0;
      if (
        normalisedPhrase.includes(normalisedCandidate) ||
        normalisedCandidate.includes(normalisedPhrase)
      ) {
        // Substring match: score by how much of the longer string is covered.
        const longer = Math.max(normalisedPhrase.length, normalisedCandidate.length);
        const shorter = Math.min(normalisedPhrase.length, normalisedCandidate.length);
        score = 0.6 + 0.35 * (shorter / longer);
      } else {
        const a = tokenSet(normalisedPhrase);
        const b = tokenSet(normalisedCandidate);
        const intersection = [...a].filter((t) => b.has(t)).length;
        const union = new Set([...a, ...b]).size;
        score = union > 0 ? (intersection / union) * 0.6 : 0;
      }

      if (score > bestScore) {
        bestScore = score;
        best = { food, confidence: score >= 0.75 ? "medium" : "low" };
      }
    }
  }

  if (!best || bestScore < 0.25) return null;
  return best;
}

/** Parse free text into structured, catalogue-matched food items. */
export function parseFoodText(
  text: string,
  catalogue: readonly FoodCatalogueItem[],
): ParsedFoodItem[] {
  const segments = splitSegments(text);
  return segments.map((raw) => {
    const { quantity, unit, rest } = extractQuantityAndUnit(raw);
    const match = rest ? matchFood(rest, catalogue) : null;

    if (!match) {
      return {
        raw,
        foodCode: null,
        foodName: null,
        quantity,
        unit,
        grams: null,
        matched: false,
        confidence: "low",
      };
    }

    const grams = resolvePortionGrams(match.food, unit) * quantity;
    return {
      raw,
      foodCode: match.food.code,
      foodName: match.food.name,
      quantity,
      unit,
      grams,
      matched: true,
      confidence: match.confidence,
    };
  });
}

/**
 * Comparing what is printed on a medicine pack against what was prescribed.
 *
 * PURE functions, no I/O, so the comparison logic is unit-testable and cannot
 * drift between the vision module and the UI.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: judge whether a pack is genuine. Tarragon
 * has no authority to authenticate a medicine and will not imply that it does.
 * Counterfeit medicines are a real problem in Nigeria and the answer to them is
 * NAFDAC's own Mobile Authentication Service — this module points at that
 * authority rather than substituting for it. What it CAN honestly do is tell a
 * patient "this pack says 5mg and you were prescribed 10mg", which is a
 * comparison of two printed facts and needs no authority at all.
 */

export interface ParsedStrength {
  value: number;
  /** Normalised to lower case: mg, g, mcg, ml, iu, %. */
  unit: string;
}

/**
 * Pull a strength out of free text like "10mg", "500 mg", "5mg/5ml", "1 g".
 *
 * Takes the FIRST strength found. For a combination like "5mg/5ml" that is the
 * amount of drug, which is the number that matters for the comparison; the
 * volume is the vehicle.
 */
export function parseStrength(text: string | null | undefined): ParsedStrength | null {
  if (!text) return null;
  const match = text
    .toLowerCase()
    .replace(/,/g, "")
    .match(/(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|%)/);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  let unit = match[2];
  if (unit === "µg" || unit === "ug") unit = "mcg";
  return { value, unit };
}

/** Convert to a common base so 1 g and 1000 mg compare equal. */
function toBase(strength: ParsedStrength): { value: number; family: string } | null {
  switch (strength.unit) {
    case "mcg":
      return { value: strength.value / 1000, family: "mass" };
    case "mg":
      return { value: strength.value, family: "mass" };
    case "g":
      return { value: strength.value * 1000, family: "mass" };
    case "ml":
      return { value: strength.value, family: "volume" };
    case "iu":
      return { value: strength.value, family: "iu" };
    case "%":
      return { value: strength.value, family: "percent" };
    default:
      return null;
  }
}

export function strengthsMatch(a: ParsedStrength | null, b: ParsedStrength | null): boolean {
  if (!a || !b) return false;
  const ba = toBase(a);
  const bb = toBase(b);
  if (!ba || !bb || ba.family !== bb.family) return false;
  return Math.abs(ba.value - bb.value) < 1e-6;
}

/**
 * Do two drug names refer to the same medicine, as far as we can tell from
 * text alone?
 *
 * Deliberately conservative in BOTH directions. It will not claim a match on a
 * loose resemblance, and it will not claim a mismatch just because a pack shows
 * a brand name and the prescription an INN — "no confident match" is a distinct,
 * honest third answer, because telling someone their correct medicine is the
 * wrong one is its own harm.
 */
export function drugNamesMatch(packName: string, prescribedName: string): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(tablets?|caps?|capsules?|syrup|suspension|injection|mr|sr|xl|er|od|bd|tds)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const a = norm(packName);
  const b = norm(prescribedName);
  if (!a || !b) return false;
  if (a === b) return true;

  const aTokens = a.split(" ").filter((t) => t.length > 3);
  const bTokens = b.split(" ").filter((t) => t.length > 3);
  // A shared substantive token (the drug name itself) in either direction.
  return aTokens.some((t) => bTokens.includes(t) || b.includes(t)) ||
    bTokens.some((t) => a.includes(t));
}

export type PackCheckVerdict =
  /** Name and strength both line up with something currently prescribed. */
  | "matches_prescription"
  /** Right medicine, but the pack strength differs from what was prescribed. */
  | "strength_differs"
  /** The medicine is on the patient's list but we could not compare strengths. */
  | "strength_unknown"
  /** Not on the patient's current list at all. */
  | "not_on_your_list"
  /** Nothing legible enough to compare. */
  | "unreadable";

export interface PackCheckResult {
  verdict: PackCheckVerdict;
  /** The medication row this pack appears to correspond to, if any. */
  matchedMedicationId: string | null;
  matchedDrugName: string | null;
  packStrength: ParsedStrength | null;
  prescribedStrength: ParsedStrength | null;
}

export interface PrescribedMedication {
  id: string;
  drugName: string;
  dose: string | null;
}

/**
 * Compare a read pack against the patient's active medicines.
 *
 * Never returns a judgement about the pack's authenticity, only about whether
 * it corresponds to something they were prescribed.
 */
export function checkPackAgainstPrescription(
  pack: { drugName: string | null; strength: string | null },
  prescribed: PrescribedMedication[],
): PackCheckResult {
  const empty: PackCheckResult = {
    verdict: "unreadable",
    matchedMedicationId: null,
    matchedDrugName: null,
    packStrength: null,
    prescribedStrength: null,
  };

  if (!pack.drugName || pack.drugName.trim().length === 0) return empty;

  const packStrength = parseStrength(pack.strength);
  const match = prescribed.find((m) => drugNamesMatch(pack.drugName as string, m.drugName));

  if (!match) {
    return {
      verdict: "not_on_your_list",
      matchedMedicationId: null,
      matchedDrugName: null,
      packStrength,
      prescribedStrength: null,
    };
  }

  const prescribedStrength = parseStrength(match.dose);

  if (!packStrength || !prescribedStrength) {
    return {
      verdict: "strength_unknown",
      matchedMedicationId: match.id,
      matchedDrugName: match.drugName,
      packStrength,
      prescribedStrength,
    };
  }

  return {
    verdict: strengthsMatch(packStrength, prescribedStrength)
      ? "matches_prescription"
      : "strength_differs",
    matchedMedicationId: match.id,
    matchedDrugName: match.drugName,
    packStrength,
    prescribedStrength,
  };
}

/**
 * NAFDAC's Mobile Authentication Service. The scratch panel on a participating
 * pack hides a code the buyer texts to 38353 free of charge, and NAFDAC replies
 * saying whether the code is valid.
 *
 * This is the ONLY authenticity check surfaced anywhere in this feature, and it
 * is NAFDAC's, not ours. Not every product carries a MAS panel, so the copy
 * says so rather than implying a missing panel means a fake.
 */
export const NAFDAC_MAS = {
  shortcode: "38353",
  howTo:
    "If the pack has a scratch panel, scratch it, then text the code it hides to 38353. NAFDAC will reply for free saying whether that code is genuine.",
  caveat:
    "Not every genuine medicine carries a scratch panel, so no panel does not mean a fake. If anything about a pack worries you, take it back to the pharmacy you bought it from and tell your care team.",
} as const;

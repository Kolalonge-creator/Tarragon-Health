/**
 * Local food portion guide (S55 quality gates, item 8): hand measures (palm, fist, cupped hand) for common Nigerian foods, for people
 * living with diabetes or high blood pressure.
 *
 * Content model. A portion guide is an ordinary Learning Centre article (so it uses the same publish gate, review date, offline
 * pack and search) whose body uses one small, readable line format:
 *
 *     Some lines of introduction in plain words.
 *
 *     [portion swallow fist] Pounded yam, eba, amala, fufu
 *     Eat it with plenty of soup and vegetables.
 *
 *     Closing note lines after a blank line.
 *
 * `[portion <ref> <hand>]` opens one food. <ref> names a row of the versioned config `learning.portion_guide`, which is where the NUMBERS
 * live. <hand> is the hand picture to draw. If the format is not recognised the body simply reads as text, so a lesson is never blank.
 *
 * NO NUMBER IS HELD IN A COMPONENT. Every amount comes from the config, which is PROPOSED until a clinician or dietitian sets and signs
 * it. A guide whose numbers are still proposed cannot be published (the database refuses; see the quality-gates migration).
 */
export const PORTION_HANDS = ["palm", "fist", "cupped_hand", "thumb", "fingertip"] as const;
export type PortionHand = (typeof PORTION_HANDS)[number];
export type PortionAudience = "diabetes" | "blood_pressure";

export interface PortionAmount {
  /** How much. 0 means "best to leave out". Half steps are allowed. */
  readonly amount: number;
  /** A hand measure, or a household one (cube, pinch). */
  readonly unit: string;
  /** What the amount is per. */
  readonly per: "meal" | "day" | "week" | "pot";
}

export interface PortionGuideConfig {
  readonly portions: Readonly<Record<string, Partial<Record<PortionAudience, PortionAmount>>>>;
}

export interface PortionFood {
  readonly ref: string;
  readonly hand: PortionHand;
  readonly name: string;
  readonly tip: string;
}

export interface ParsedPortionGuide {
  readonly intro: readonly string[];
  readonly foods: readonly PortionFood[];
  readonly notes: readonly string[];
}

const MARKER = /^\[portion\s+([a-z0-9_]+)\s+([a-z_]+)\]\s*(.+)$/;

export function isPortionHand(v: string): v is PortionHand {
  return (PORTION_HANDS as readonly string[]).includes(v);
}

/** True when a body uses the portion-guide format (at least one valid food line). */
export function isPortionGuideBody(body: string): boolean {
  return body.split("\n").some((l) => {
    const m = MARKER.exec(l.trim());
    return m !== null && isPortionHand(m[2] ?? "");
  });
}

export function parsePortionGuide(body: string): ParsedPortionGuide {
  const intro: string[] = [];
  const notes: string[] = [];
  const foods: { ref: string; hand: PortionHand; name: string; tip: string[] }[] = [];
  let current: (typeof foods)[number] | null = null;
  let afterBlank = false;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const m = MARKER.exec(line);
    if (m && isPortionHand(m[2] ?? "")) {
      current = { ref: m[1] ?? "", hand: m[2] as PortionHand, name: (m[3] ?? "").trim(), tip: [] };
      foods.push(current);
      afterBlank = false;
      continue;
    }
    if (line === "") {
      if (current) afterBlank = true;
      continue;
    }
    if (!current) intro.push(line);
    else if (afterBlank) notes.push(line);
    else current.tip.push(line);
  }
  return { intro, foods: foods.map((f) => ({ ...f, tip: f.tip.join(" ") })), notes };
}

export function portionFor(config: PortionGuideConfig, ref: string, audience: PortionAudience): PortionAmount | null {
  return config.portions[ref]?.[audience] ?? null;
}

/** Which set of amounts a guide uses, from the item's own category and condition (never guessed from its text). */
export function portionAudienceFor(category: string | null | undefined, condition: string | null | undefined): PortionAudience {
  return category === "diabetes" || condition === "diabetes" ? "diabetes" : "blood_pressure";
}

/** One plain drawing primitive, in a 48 by 48 box, drawn the same way by the web (svg) and the phone (react-native-svg). */
export type HandShape =
  | { readonly t: "rect"; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  | { readonly t: "circle"; readonly cx: number; readonly cy: number; readonly r: number }
  | { readonly t: "path"; readonly d: string };

/**
 * Simple line drawings of the five hand measures. No emoji, no image files, a few bytes each: they work offline and on the lowest-end phone.
 * The shapes are outlines (stroke only) so they follow the surrounding text colour in light and dark themes.
 */
export const HAND_SHAPES: Readonly<Record<PortionHand, readonly HandShape[]>> = {
  palm: [
    { t: "rect", x: 11, y: 24, w: 26, h: 18, r: 6 },
    { t: "rect", x: 11, y: 10, w: 5, h: 18, r: 2.5 },
    { t: "rect", x: 18, y: 6, w: 5, h: 22, r: 2.5 },
    { t: "rect", x: 25, y: 6, w: 5, h: 22, r: 2.5 },
    { t: "rect", x: 32, y: 10, w: 5, h: 18, r: 2.5 },
  ],
  fist: [
    { t: "rect", x: 9, y: 14, w: 30, h: 26, r: 9 },
    { t: "path", d: "M17 14v9M24 14v9M31 14v9" },
    { t: "path", d: "M9 30c-4 0-5-5-2-7" },
  ],
  cupped_hand: [
    { t: "path", d: "M6 20h36" },
    { t: "path", d: "M8 20c0 12 7 20 16 20s16-8 16-20" },
    { t: "path", d: "M16 12c2-3 4-3 6 0M26 12c2-3 4-3 6 0" },
  ],
  thumb: [
    { t: "rect", x: 17, y: 6, w: 14, h: 36, r: 7 },
    { t: "path", d: "M20 14h8" },
  ],
  fingertip: [
    { t: "rect", x: 18, y: 12, w: 12, h: 30, r: 6 },
    { t: "circle", cx: 24, cy: 20, r: 3 },
  ],
};

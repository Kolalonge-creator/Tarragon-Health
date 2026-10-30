import type { GrowthBandResult } from "./growth-bands";

/**
 * Where a crisis leads on every child screen (S68b). The screen opens with "go to the nearest clinic now" and a call button, ABOVE any chart, any
 * band word and any other card, and the lead sits OUTSIDE the private lock so it can never be hidden behind it. The trigger is only what the
 * database has already decided: a severe acute nutrition class (MUAC in the red range, swelling of both feet, or severe weight-for-height).
 * This file adds no clinical rule and no number: the number to call is the crisis card's (`normaliseCrisisCard` / `CRISIS_CARD_OFFLINE`).
 */
export function childCrisisLead(result: GrowthBandResult | null): boolean {
  return result !== null && result.kind === "band" && result.crisis;
}

/**
 * What a screen shows when the growth read may have failed: a successful read decides; a failed or still-loading read falls back to the last known
 * crisis state, so a known crisis is never hidden by a bad signal. Pure, so phone and web share the rule and its tests.
 */
export function crisisToShow(readOk: boolean, computedFromRead: boolean, lastKnown: boolean): boolean {
  return readOk ? computedFromRead : lastKnown;
}

/** A safe `tel:` link, or null when the number is not plausible. Digits and a leading plus only: never anything a record could smuggle in. */
export function crisisCallHref(number: string): string | null {
  return /^\+?[0-9]{3,15}$/.test(number) ? `tel:${number}` : null;
}

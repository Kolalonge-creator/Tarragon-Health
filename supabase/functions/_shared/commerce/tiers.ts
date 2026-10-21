/**
 * The Evergreen ladder on the Membership screen, web and mobile (founder decision 2026-10-21, docs/DECISIONS.md). Pure logic, no
 * framework: which cards a person sees. Both paid tiers are a Member for every safety purpose; the one difference is the annual blood
 * panel. Prices are never decided here: they come from the catalogue the database serves, and the database prices every order.
 */
export const EVERGREEN_CODE = "membership_annual_no_panel";
export const EVERGREEN_PLUS_CODE = "membership_annual";
export const UPGRADE_CODE = "membership_upgrade_plus";

export type Tier = "evergreen" | "plus";
export const isTier = (v: unknown): v is Tier => v === "evergreen" || v === "plus";

interface HasCode {
  readonly code: string;
}

/** True once the database serves the Evergreen item (it does so only while the tier module is on and the item is active). */
export function ladderActive(items: readonly HasCode[]): boolean {
  return items.some((i) => i.code === EVERGREEN_CODE);
}

/** Whether the annual blood panel comes with this card; null for anything that is not a tier card. */
export function panelIncluded(code: string): boolean | null {
  if (code === EVERGREEN_CODE) return false;
  if (code === EVERGREEN_PLUS_CODE) return true;
  return null;
}

export interface TierContext {
  /** The signed-in person's current tier; null when Free. */
  readonly tier: Tier | null;
  readonly isMember: boolean;
  readonly inGrace: boolean;
  /** The order is for another person (Care Circle). The upgrade is never offered for someone else. */
  readonly forSomeoneElse: boolean;
}

export interface ArrangedItems<T extends HasCode> {
  readonly tierCards: readonly T[];
  readonly upgrade: T | null;
  readonly others: readonly T[];
}

export function arrangeItems<T extends HasCode>(items: readonly T[], ctx: TierContext): ArrangedItems<T> {
  if (!ladderActive(items)) {
    // Before the ladder is on the screen is exactly the single-Membership screen it always was.
    return { tierCards: [], upgrade: null, others: items.filter((i) => i.code !== UPGRADE_CODE) };
  }
  const memberNow = ctx.isMember && !ctx.inGrace && !ctx.forSomeoneElse;
  const cards = memberNow ? [] : items.filter((i) => i.code === EVERGREEN_CODE || i.code === EVERGREEN_PLUS_CODE);
  const tierCards = [...cards.filter((i) => i.code === EVERGREEN_CODE), ...cards.filter((i) => i.code === EVERGREEN_PLUS_CODE)];
  const upgrade = memberNow && ctx.tier === "evergreen" ? (items.find((i) => i.code === UPGRADE_CODE) ?? null) : null;
  const ladderCodes = new Set([EVERGREEN_CODE, EVERGREEN_PLUS_CODE, UPGRADE_CODE]);
  return { tierCards, upgrade, others: items.filter((i) => !ladderCodes.has(i.code)) };
}

/** Framing only: the yearly price spread over twelve months, rounded to the nearest naira, in kobo. The person still pays once. */
export function monthlyFramingKobo(yearlyKobo: number): number {
  return Math.round(yearlyKobo / 12 / 100) * 100;
}

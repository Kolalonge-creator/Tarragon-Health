/**
 * Pricing transparency (WP1): the "not included" list with prices, the monthly equivalent of a yearly price, and the notice that a price
 * is changing. The database decides every price; this file checks the SHAPE of what came back and does the one piece of arithmetic that
 * is display only. Money is integer kobo (INV-15). Labels are i18n KEYS, never English text.
 */

/** A yearly item is shown with a monthly equivalent. The registry entry `pricing.transparency` mirrors these and a test fails if they drift. */
export const ANNUAL_MONTHS = 12;
export const ANNUAL_DURATION_DAYS = { min: 360, max: 370 } as const;
/** An item lists at most this many things it does not include (the database enforces the same number). */
export const MAX_NOT_INCLUDED = 12;

/**
 * About how much a yearly price is each month, in whole naira, as integer kobo; null when no monthly line should be shown.
 * Rule: kobo / 12, rounded half up to the nearest whole naira (100 kobo), integer arithmetic only. It is never shown for an item that
 * is not a year long, when nothing is left to pay (Free, or a sponsor covers the price), or when the rounded figure would be zero.
 * It is ALWAYS shown with "billed once a year": this is a way to compare, not a payment plan, and no monthly payment exists.
 */
export function monthlyEquivalentKobo(amountDueKobo: number, durationDays: number | null): number | null {
  if (!Number.isSafeInteger(amountDueKobo) || amountDueKobo <= 0) return null;
  if (durationDays === null || !Number.isInteger(durationDays)) return null;
  if (durationDays < ANNUAL_DURATION_DAYS.min || durationDays > ANNUAL_DURATION_DAYS.max) return null;
  const nairaPerMonth = Math.floor((amountDueKobo + (ANNUAL_MONTHS * 100) / 2) / (ANNUAL_MONTHS * 100));
  return nairaPerMonth > 0 ? nairaPerMonth * 100 : null;
}

export interface NotIncludedEntry {
  /** An i18n key: the name of a catalogue item that is sold separately, or the words for something that is not sold here. */
  readonly labelKey: string;
  /** The catalogue code of an extra that can be bought; null for words only (for example medicines). */
  readonly extraCode: string | null;
  /** The price of the extra today, or null: the screen then says "Ask us". A price is never guessed. */
  readonly amountKobo: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const KEY = /^[a-z][a-z0-9_.]{2,100}$/;

/** Item code to the things it does not include. A bad entry is dropped on its own; a bad price becomes "Ask us", never a made-up number. */
export function parseNotIncluded(raw: unknown): Readonly<Record<string, readonly NotIncludedEntry[]>> {
  const out: Record<string, NotIncludedEntry[]> = {};
  if (!Array.isArray(raw)) return out;
  for (const row of raw) {
    if (!isRecord(row) || typeof row["code"] !== "string" || !Array.isArray(row["items"])) continue;
    const entries: NotIncludedEntry[] = [];
    for (const e of row["items"].slice(0, MAX_NOT_INCLUDED)) {
      if (!isRecord(e) || typeof e["label_key"] !== "string" || !KEY.test(e["label_key"])) continue;
      const amount = e["amount_kobo"];
      entries.push({
        labelKey: e["label_key"],
        extraCode: typeof e["extra_code"] === "string" ? e["extra_code"] : null,
        amountKobo: typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0 ? amount : null,
      });
    }
    out[row["code"]] = entries;
  }
  return out;
}

export interface PriceChangeNotice {
  readonly itemCode: string;
  readonly nameKey: string;
  /** The usual price when the person bought it. */
  readonly paidListKobo: number;
  readonly newKobo: number;
  /** ISO time the new price starts. */
  readonly newFrom: string;
  /** ISO time what they hold ends; the old price is honoured until then because it is already paid. */
  readonly endsAt: string;
}

const positiveKobo = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;

export function parsePriceChangeNotices(raw: unknown): PriceChangeNotice[] {
  if (!Array.isArray(raw)) return [];
  const out: PriceChangeNotice[] = [];
  for (const r of raw) {
    if (!isRecord(r)) continue;
    const { item_code, name_key, paid_list_kobo, new_kobo, new_from, ends_at } = r;
    if (typeof item_code !== "string" || typeof name_key !== "string" || !positiveKobo(paid_list_kobo) || !positiveKobo(new_kobo)) continue;
    if (typeof new_from !== "string" || typeof ends_at !== "string" || Number.isNaN(Date.parse(new_from)) || Number.isNaN(Date.parse(ends_at))) continue;
    if (paid_list_kobo === new_kobo) continue;
    out.push({ itemCode: item_code, nameKey: name_key, paidListKobo: paid_list_kobo, newKobo: new_kobo, newFrom: new_from, endsAt: ends_at });
  }
  return out;
}

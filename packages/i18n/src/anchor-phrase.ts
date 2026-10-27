import { DEFAULT_LOCALE, t, type Locale } from "./translate";
import type { MessageKey } from "./en";

/**
 * The plain words for a dose tied to a daily anchor (S08z): "with breakfast", "30 minutes after the morning prayer",
 * "on waking". Used by the Today list and by the reminder text. It names an event in the person's day, never a medicine,
 * a dose or a condition. The anchor ids are the ones packages/medicines defines; an id this build does not know is
 * returned as nothing (empty) rather than a raw key, so a newer server value can never show as gibberish.
 */
const KNOWN = new Set([
  "waking",
  "morning_prayer",
  "breakfast",
  "midday_prayer",
  "lunch",
  "afternoon_prayer",
  "evening_prayer",
  "dinner",
  "night_prayer",
  "bedtime",
]);

export function isKnownAnchor(anchor: string): boolean {
  return KNOWN.has(anchor);
}

/** "Breakfast", "Morning prayer": the label on a choice. */
export function anchorTitle(anchor: string, locale: Locale = DEFAULT_LOCALE): string {
  return KNOWN.has(anchor) ? t(`doseanchor.title.${anchor}` as MessageKey, locale) : "";
}

/** "with breakfast" (no offset), "30 minutes after breakfast", "30 minutes before the evening prayer". */
export function anchorPhrase(anchor: string, offsetMinutes: number, locale: Locale = DEFAULT_LOCALE): string {
  if (!KNOWN.has(anchor)) return "";
  if (!Number.isInteger(offsetMinutes) || offsetMinutes === 0) return t(`doseanchor.at.${anchor}` as MessageKey, locale);
  const name = t(`doseanchor.name.${anchor}` as MessageKey, locale);
  return t((offsetMinutes > 0 ? "doseanchor.after" : "doseanchor.before") as MessageKey, locale, { minutes: Math.abs(offsetMinutes), name });
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { logDose, type DoseChecklistItem, type LoggableStatus } from "./medications";
import { loadMedicineRules } from "./medicines-config";

/**
 * The catch-up sheet (S08b): when the app opens, doses from yesterday and today that
 * closed with no answer are listed so the patient can say what happened. Three honest
 * answers, no wrong one, and "Not now" is always allowed: a dismissed dose is remembered
 * and not asked about again (it still reads "no record yet" in the Today list).
 */
export type CatchUpChoice = "took" | "skipped" | "not_taken";

const DISMISSED_KEY = "catch-up:dismissed";
const LAST_OFFERED_KEY = "catch-up:last-offered";
const KEEP_DISMISSED = 200;

export const catchUpKey = (item: Pick<DoseChecklistItem, "medicationId" | "date" | "time">): string =>
  `${item.medicationId}|${item.date}|${item.time}`;

/** What to record for each answer. "I took it" is recorded as taken late: the time is not known, and late counts as taken. */
export function statusForChoice(choice: CatchUpChoice): LoggableStatus {
  if (choice === "took") return "delayed";
  if (choice === "skipped") return "skipped";
  return "missed";
}

/** The doses to ask about: not dismissed, oldest first, no more than the configured number. */
export function selectCatchUp(items: readonly DoseChecklistItem[], dismissed: ReadonlySet<string>): DoseChecklistItem[] {
  const max = loadMedicineRules().catchUpMaxItems;
  return items
    .filter((i) => !dismissed.has(catchUpKey(i)))
    .sort((a, b) => (a.dueAtMs ?? 0) - (b.dueAtMs ?? 0))
    .slice(0, max);
}

/** True when the sheet has not been offered within the configured gap, so it is never raised on every app open. */
export function mayOfferCatchUp(lastOfferedMs: number | null, nowMs: number): boolean {
  if (lastOfferedMs === null || !Number.isFinite(lastOfferedMs) || lastOfferedMs > nowMs) return true;
  return nowMs - lastOfferedMs >= loadMedicineRules().catchUpMinGapMinutes * 60_000;
}

export async function loadLastOffered(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_OFFERED_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export async function saveLastOffered(nowMs: number): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_OFFERED_KEY, String(nowMs));
  } catch {
    // Best effort: at worst the sheet may be offered a little sooner next time.
  }
}

export async function loadDismissed(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    // A failed read means the patient may be asked again, never that a dose is hidden.
    return new Set();
  }
}

export async function saveDismissed(keys: readonly string[]): Promise<void> {
  try {
    const existing = [...(await loadDismissed())];
    const merged = [...new Set([...existing, ...keys])].slice(-KEEP_DISMISSED);
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(merged));
  } catch {
    // Best effort: at worst the same dose is offered once more.
  }
}

/** Record one answer against the dose's own date. Sent at once, no undo hold. */
export function answerCatchUp(
  patientId: string,
  organisationId: string,
  item: DoseChecklistItem,
  choice: CatchUpChoice
): Promise<{ error?: string; synced?: boolean }> {
  return logDose(patientId, organisationId, item, statusForChoice(choice));
}

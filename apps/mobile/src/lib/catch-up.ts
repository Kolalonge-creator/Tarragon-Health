import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadCatchUpDoses, logDose, type DoseChecklistItem, type LoggableStatus } from "./medications";
import { recordSyncError } from "./sync-diagnostics";
import { loadMedicineRules } from "./medicines-config";
import { loadManagedDependants } from "./acting";

/**
 * The catch-up sheet (S08b): when the app opens, doses from yesterday and today that
 * closed with no answer are listed so the patient can say what happened. Three honest
 * answers, no wrong one, and "Not now" is always allowed: a dismissed dose is remembered
 * and not asked about again (it still reads "no record yet" in the Today list).
 */
export type CatchUpChoice = "took" | "skipped" | "not_taken";

/** A dose to ask about. `person` is set only for a dependant the device owner manages (OQ-76); it carries who to record the answer for. */
export type CatchUpItem = DoseChecklistItem & { person?: { profileId: string; organisationId: string; firstName: string } };

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
export function selectCatchUp<T extends DoseChecklistItem>(items: readonly T[], dismissed: ReadonlySet<string>): T[] {
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

export type CatchUpCheck =
  | { status: "skipped" }
  | { status: "none" }
  | { status: "show"; items: CatchUpItem[] }
  | { status: "failed"; error: string };

/** How long to wait before the next try after attempt number `attempt` (0 for the first) failed, or null once the tries are used up. */
export function retryDelayMs(attempt: number): number | null {
  const seconds = loadMedicineRules().catchUpRetrySeconds[attempt];
  return seconds === undefined ? null : seconds * 1000;
}

/**
 * One look for doses to ask about. A failed read is its own answer, never "nothing to catch up":
 * it is recorded in the sync diagnostics (so support can see it) and reported to the caller,
 * which tries again a few times and then waits for the next app open. The Today list stays correct
 * throughout, so the patient is not interrupted about it.
 */
export async function runCatchUpCheck(patientId: string, nowMs: number, recordFailure = true): Promise<CatchUpCheck> {
  if (!mayOfferCatchUp(await loadLastOffered(), nowMs)) return { status: "skipped" };
  const res = await loadCatchUpDoses(patientId, nowMs);
  if (!res.ok) {
    // Only the first failure of a run of retries is recorded: an offline phone would otherwise fill
    // the 50-entry diagnostics buffer and push out the Bluetooth and health-sync entries support needs.
    if (recordFailure) recordSyncError("catch_up", "read", res.error);
    return { status: "failed", error: res.error };
  }
  const all: CatchUpItem[] = [...res.data];
  // The dependants this person manages are asked about too; a dependant who cannot be read right now is skipped, never a reason to hide the rest.
  for (const dep of (await loadManagedDependants(patientId)) ?? []) {
    const depRes = await loadCatchUpDoses(dep.profileId, nowMs);
    if (!depRes.ok) {
      if (recordFailure) recordSyncError("catch_up", "read", depRes.error);
      continue;
    }
    for (const item of depRes.data) all.push({ ...item, person: { profileId: dep.profileId, organisationId: dep.organisationId, firstName: dep.firstName } });
  }
  const items = selectCatchUp(all, await loadDismissed());
  return items.length === 0 ? { status: "none" } : { status: "show", items };
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
  item: CatchUpItem,
  choice: CatchUpChoice
): Promise<{ error?: string; synced?: boolean }> {
  // A dependant's dose is recorded for the dependant, never under the guardian's own id.
  if (item.person) return logDose(item.person.profileId, item.person.organisationId, item, statusForChoice(choice));
  return logDose(patientId, organisationId, item, statusForChoice(choice));
}

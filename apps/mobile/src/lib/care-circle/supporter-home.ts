import { circleMonthlyLines, type Locale } from "@tarragon/i18n";
import type { ResultRow, SupportedPerson as CirclePerson, SupporterView } from "./parse";
import type { SupportedPerson as ManagedPerson } from "@/lib/acting";

/**
 * The supporter's home on the phone (supporter join path, 2026-11-03): one row per person, combining their Care Circle membership
 * and any account access they gave, so the same person never appears twice and "nobody yet" never sits beside somebody.
 */
export interface PersonRow {
  id: string;
  name: string;
  circle: CirclePerson | null;
  managed: ManagedPerson | null;
}

export function mergePeople(circle: readonly CirclePerson[], managed: readonly ManagedPerson[]): PersonRow[] {
  const rows = new Map<string, PersonRow>();
  for (const c of circle) rows.set(c.patientId, { id: c.patientId, name: c.name, circle: c, managed: null });
  for (const m of managed) {
    const existing = rows.get(m.profileId);
    if (existing) existing.managed = m;
    else rows.set(m.profileId, { id: m.profileId, name: m.fullName ?? "This person", circle: null, managed: m });
  }
  return [...rows.values()];
}

/** Every block SupporterBlocks can draw. A block added there must be added here and to hasSharedBlocks. */
export type SupporterBlockFields =
  | "adherence" | "bpTrend" | "appointments" | "monthly" | "doctorNote" | "investigations" | "results" | "weightTrend" | "planProgress";

/**
 * True when at least one health block would render. A person who shared only check-in requests or paying has none. The Care Circle
 * P2 blocks (tests, reviewed results, weight, yearly check-ups) count as soon as they are shared, even while empty, the same as the web.
 */
export function hasSharedBlocks(view: Pick<SupporterView, SupporterBlockFields>, locale: Locale): boolean {
  const monthly = (view.monthly ?? []).filter((r) => circleMonthlyLines(r, locale).length > 0);
  // a doctor's note the patient released counts too, or a page whose only shared item is that note would show the empty state
  return Boolean(view.adherence || view.bpTrend || view.appointments || monthly.length > 0 || view.doctorNote != null
    || view.investigations || view.results || view.weightTrend || view.planProgress);
}

/** One reviewed result's value as written on the web: the number and its unit, or the lab's own words when there is no number. */
export function resultValueText(r: Pick<ResultRow, "value" | "valueText" | "unit">): string {
  return r.value !== null ? `${r.value} ${r.unit}` : (r.valueText ?? "");
}

/** Care Circle P2 (spec 5.1): the person switcher appears only for someone who supports two or more people. */
export const showPersonSwitcher = (people: readonly unknown[]): boolean => people.length >= 2;

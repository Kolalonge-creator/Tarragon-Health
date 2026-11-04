import { circleMonthlyLines, type Locale } from "@tarragon/i18n";
import type { SupportedPerson as CirclePerson, SupporterView } from "./parse";
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

/** True when at least one health block would render. A person who shared only check-in requests or paying has none. */
export function hasSharedBlocks(view: Pick<SupporterView, "adherence" | "bpTrend" | "appointments" | "monthly" | "doctorNote">, locale: Locale): boolean {
  const monthly = (view.monthly ?? []).filter((r) => circleMonthlyLines(r, locale).length > 0);
  // a doctor's note the patient released counts too, or a page whose only shared item is that note would show the empty state
  return Boolean(view.adherence || view.bpTrend || view.appointments || monthly.length > 0 || view.doctorNote != null);
}

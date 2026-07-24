import type { Tables } from "@tarragon/shared";

/**
 * Computes per-vaccine due/overdue state from the vaccination_catalog +
 * vaccination_records the patient has on file (spec §3.5: "Auto-generates
 * the due/overdue state per profile"). Pure — no DB access — so callers can
 * re-run it on every render as records/profile change.
 *
 * recommended_age is deliberately data, not code (docs/FEATURE_SPEC.md §10 —
 * "Adding test #41 later is a database insert, not a re-architecture"), so
 * this reads whichever of the five shapes seed data uses rather than
 * switching on a hardcoded vaccine code:
 *   - { interval_years }        recurring (e.g. tetanus/Td, influenza)
 *   - { dose_schedule_months }  a dated series from the first dose (e.g. hep B)
 *   - { doses }                 a fixed dose count, no age gate (e.g. yellow fever)
 *   - { max_catch_up_age }      single dose, eligible only up to that age (e.g. HPV)
 *   - { min_age }               single dose, eligible only from that age (e.g. shingles)
 *   - { age_schedule_weeks, max_age_years?, sex? }  a DOB-anchored infant/child
 *     series (NPHCDA routine schedule) — each entry is the age in weeks at
 *     which that dose becomes due, anchored to the child's actual date of
 *     birth (not first-dose-date, unlike dose_schedule_months, since the NPI
 *     schedule is fixed to age, e.g. Penta at 6/10/14 weeks regardless of
 *     when a sibling dose happened). max_age_years keeps a childhood vaccine
 *     off every adult's card; catch-up beyond that window is a clinical
 *     decision, not an automatic one. Optional sex restricts to one sex
 *     (e.g. HPV girls-only).
 *
 * interval_years also accepts an optional anchor_fallback_code, so a
 * recurring booster can start counting from a dose logged under a DIFFERENT
 * catalog entry when it has none of its own. The tetanus/Td booster uses
 * this: most people's last tetanus-toxoid-containing dose was their
 * childhood Pentavalent series (child_penta), not something ever logged
 * under the tetanus_td_booster code — this is how "boost every 10 years
 * from your last childhood dose" is expressed without merging two
 * differently-named, differently-composed vaccines into one catalog row.
 */

export type VaccinationCatalogRow = Pick<
  Tables<"vaccination_catalog">,
  "id" | "code" | "name" | "recommended_age"
>;

export type VaccinationRecordRow = Pick<
  Tables<"vaccination_records">,
  "vaccination_catalog_id" | "dose_number" | "date_administered"
>;

export interface VaccinationProfile {
  ageYears: number | null;
  /** ISO date of birth, when known — needed for the DOB-anchored infant
   * schedule shape (age_schedule_weeks) to compute an exact due date;
   * ageYears alone can't distinguish week 6 from week 10. Falls back to a
   * coarse ageYears-derived gate when omitted, so existing adult-only
   * callers need no change. */
  dateOfBirth?: string | null;
  sex?: "male" | "female" | null;
}

export type VaccinationStatus = "not_yet_due" | "due" | "overdue" | "up_to_date" | "not_applicable";

export interface VaccinationStatusResult {
  catalogId: string;
  code: string;
  name: string;
  status: VaccinationStatus;
  dosesGiven: number;
  lastDoseDate: string | null;
  /** Only set when there's a concrete next date to show (due or overdue). */
  nextDueDate: string | null;
}

interface RecommendedAgeShape {
  interval_years?: number;
  /** Only consulted by the interval_years branch, and only when this entry
   * has no dose of its own on file — names another vaccination_catalog code
   * whose last logged dose should anchor this booster's first due date. */
  anchor_fallback_code?: string;
  dose_schedule_months?: number[];
  doses?: number;
  max_catch_up_age?: number;
  min_age?: number;
  age_schedule_weeks?: number[];
  max_age_years?: number;
  sex?: "male" | "female";
}

function parseRecommendedAge(value: unknown): RecommendedAgeShape {
  return value && typeof value === "object" ? (value as RecommendedAgeShape) : {};
}

/** Adds days to an ISO date. Used for the DOB-anchored infant schedule,
 * where a due date is an exact calendar day, not a month/year clamp. */
function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Adds months to an ISO date, clamping to the target month's last day
 * instead of letting short months roll over into the next one. */
function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const daysInTargetMonth = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, daysInTargetMonth));
  return date.toISOString().slice(0, 10);
}

function addYears(isoDate: string, years: number): string {
  return addMonths(isoDate, years * 12);
}

function todayISODate(today: Date): string {
  return today.toISOString().slice(0, 10);
}

function dueOrOverdue(dueDate: string, today: string): VaccinationStatus {
  return dueDate <= today ? (dueDate < today ? "overdue" : "due") : "up_to_date";
}

/**
 * Resolves anchor_fallback_code to the last dose date logged under that
 * OTHER catalog entry — e.g. lets the tetanus/Td booster start its 10-year
 * clock from a patient's last childhood Pentavalent dose instead of
 * requiring a dose logged under the tetanus_td_booster code itself. Returns
 * null if the code is unset, doesn't match any catalog entry, or has no
 * doses logged (all of which fall through to the caller's own "never had a
 * dose" handling).
 */
function resolveAnchorFallbackDate(
  fallbackCode: string | undefined,
  catalog: VaccinationCatalogRow[],
  records: VaccinationRecordRow[]
): string | null {
  if (!fallbackCode) return null;
  const fallbackEntry = catalog.find((c) => c.code === fallbackCode);
  if (!fallbackEntry) return null;
  const fallbackRecords = records
    .filter((r) => r.vaccination_catalog_id === fallbackEntry.id)
    .sort((a, b) => a.date_administered.localeCompare(b.date_administered));
  return fallbackRecords.at(-1)?.date_administered ?? null;
}

export function computeVaccinationStatuses(
  catalog: VaccinationCatalogRow[],
  records: VaccinationRecordRow[],
  profile: VaccinationProfile,
  today: Date = new Date()
): VaccinationStatusResult[] {
  const todayISO = todayISODate(today);

  return catalog.map((entry) => {
    const entryRecords = records
      .filter((r) => r.vaccination_catalog_id === entry.id)
      .sort((a, b) => a.date_administered.localeCompare(b.date_administered));
    const dosesGiven = entryRecords.length;
    const lastDoseDate = entryRecords.at(-1)?.date_administered ?? null;
    const firstDoseDate = entryRecords[0]?.date_administered ?? null;

    const recommendedAge = parseRecommendedAge(entry.recommended_age);
    const base = { catalogId: entry.id, code: entry.code, name: entry.name, dosesGiven, lastDoseDate };

    if (recommendedAge.interval_years !== undefined) {
      const anchorDate =
        lastDoseDate ?? resolveAnchorFallbackDate(recommendedAge.anchor_fallback_code, catalog, records);
      if (!anchorDate) {
        return { ...base, status: "due", nextDueDate: todayISO };
      }
      const nextDueDate = addYears(anchorDate, recommendedAge.interval_years);
      // lastDoseDate is overridden (not just base's own dosesGiven-derived
      // value) when the fallback supplied it, so a patient who's never had a
      // dose logged under THIS code still sees the real date their clock is
      // counting from, not "never".
      return { ...base, lastDoseDate: anchorDate, status: dueOrOverdue(nextDueDate, todayISO), nextDueDate };
    }

    if (recommendedAge.dose_schedule_months !== undefined) {
      const schedule = recommendedAge.dose_schedule_months;
      if (dosesGiven === 0) {
        return { ...base, status: "due", nextDueDate: todayISO };
      }
      if (dosesGiven < schedule.length && firstDoseDate) {
        const nextDueDate = addMonths(firstDoseDate, schedule[dosesGiven]);
        return { ...base, status: dueOrOverdue(nextDueDate, todayISO), nextDueDate };
      }
      return { ...base, status: "up_to_date", nextDueDate: null };
    }

    if (recommendedAge.doses !== undefined) {
      if (dosesGiven >= recommendedAge.doses) {
        return { ...base, status: "up_to_date", nextDueDate: null };
      }
      return { ...base, status: "due", nextDueDate: todayISO };
    }

    if (recommendedAge.max_catch_up_age !== undefined) {
      if (dosesGiven > 0) {
        return { ...base, status: "up_to_date", nextDueDate: null };
      }
      if (profile.ageYears === null) {
        return { ...base, status: "not_yet_due", nextDueDate: null };
      }
      if (profile.ageYears <= recommendedAge.max_catch_up_age) {
        return { ...base, status: "due", nextDueDate: todayISO };
      }
      return { ...base, status: "not_applicable", nextDueDate: null };
    }

    if (recommendedAge.min_age !== undefined) {
      if (dosesGiven > 0) {
        return { ...base, status: "up_to_date", nextDueDate: null };
      }
      if (profile.ageYears === null || profile.ageYears < recommendedAge.min_age) {
        return { ...base, status: "not_yet_due", nextDueDate: null };
      }
      return { ...base, status: "due", nextDueDate: todayISO };
    }

    if (recommendedAge.age_schedule_weeks !== undefined) {
      const schedule = recommendedAge.age_schedule_weeks;

      if (recommendedAge.sex && profile.sex && profile.sex !== recommendedAge.sex) {
        return { ...base, status: "not_applicable", nextDueDate: null };
      }
      if (dosesGiven >= schedule.length) {
        return { ...base, status: "up_to_date", nextDueDate: null };
      }
      // A still-due dose beyond the catch-up window is a clinical decision,
      // not an automatic one — same precedent as max_catch_up_age.
      if (
        recommendedAge.max_age_years !== undefined &&
        profile.ageYears !== null &&
        profile.ageYears > recommendedAge.max_age_years
      ) {
        return { ...base, status: "not_applicable", nextDueDate: null };
      }

      const dueWeek = schedule[dosesGiven];
      if (profile.dateOfBirth) {
        const nextDueDate = addDays(profile.dateOfBirth, dueWeek * 7);
        return { ...base, status: dueOrOverdue(nextDueDate, todayISO), nextDueDate };
      }
      // No DOB on file — can't compute an exact date, but still gate
      // coarsely off ageYears (1 year ≈ 52 weeks) rather than showing every
      // childhood dose as immediately "due".
      if (profile.ageYears === null) {
        return { ...base, status: "not_yet_due", nextDueDate: null };
      }
      return profile.ageYears * 52 >= dueWeek
        ? { ...base, status: "due", nextDueDate: todayISO }
        : { ...base, status: "not_yet_due", nextDueDate: null };
    }

    // Unrecognised/empty recommended_age shape — degrade gracefully rather
    // than crash: treat as a plain one-off with no age gate.
    return dosesGiven > 0
      ? { ...base, status: "up_to_date", nextDueDate: null }
      : { ...base, status: "due", nextDueDate: todayISO };
  });
}

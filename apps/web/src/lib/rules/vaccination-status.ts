import type { Tables } from "@tarragon/shared";

/**
 * Computes per-vaccine due/overdue state from the vaccination_catalog +
 * vaccination_records the patient has on file (spec §3.5: "Auto-generates
 * the due/overdue state per profile"). Pure — no DB access — so callers can
 * re-run it on every render as records/profile change.
 *
 * recommended_age is deliberately data, not code (docs/FEATURE_SPEC.md §10 —
 * "Adding test #41 later is a database insert, not a re-architecture"), so
 * this reads whichever of the four shapes seed data uses rather than
 * switching on a hardcoded vaccine code:
 *   - { interval_years }        recurring (e.g. tetanus/Td, influenza)
 *   - { dose_schedule_months }  a dated series from the first dose (e.g. hep B)
 *   - { doses }                 a fixed dose count, no age gate (e.g. yellow fever)
 *   - { max_catch_up_age }      single dose, eligible only up to that age (e.g. HPV)
 *   - { min_age }               single dose, eligible only from that age (e.g. shingles)
 *   - { age_schedule_weeks }    DOB-anchored series (NPHCDA childhood schedule:
 *                               BCG at 0w, penta at 6/10/14w, measles at 39w…),
 *                               optionally windowed by max_age_years
 * Any shape may additionally carry { sex: 'male'|'female' } to restrict
 * applicability (e.g. HPV for girls) — unknown/unset patient sex is treated
 * as applicable rather than silently hiding a vaccine.
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
  /** ISO date; required for the DOB-anchored age_schedule_weeks shape. */
  dateOfBirth?: string | null;
  sex?: string | null;
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
  dose_schedule_months?: number[];
  doses?: number;
  max_catch_up_age?: number;
  min_age?: number;
  age_schedule_weeks?: number[];
  max_age_years?: number;
  sex?: string;
}

function parseRecommendedAge(value: unknown): RecommendedAgeShape {
  return value && typeof value === "object" ? (value as RecommendedAgeShape) : {};
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

function addWeeks(isoDate: string, weeks: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + weeks * 7);
  return date.toISOString().slice(0, 10);
}

function todayISODate(today: Date): string {
  return today.toISOString().slice(0, 10);
}

function dueOrOverdue(dueDate: string, today: string): VaccinationStatus {
  return dueDate <= today ? (dueDate < today ? "overdue" : "due") : "up_to_date";
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

    // Sex restriction (e.g. HPV for girls): only excludes on a CONFIRMED
    // mismatch — unknown sex stays applicable.
    if (
      recommendedAge.sex &&
      profile.sex &&
      recommendedAge.sex !== profile.sex
    ) {
      return { ...base, status: "not_applicable", nextDueDate: null };
    }

    // DOB-anchored childhood series (NPHCDA): each dose due at a fixed age.
    if (recommendedAge.age_schedule_weeks !== undefined) {
      const schedule = recommendedAge.age_schedule_weeks;
      if (dosesGiven >= schedule.length) {
        return { ...base, status: "up_to_date", nextDueDate: null };
      }
      // The window has passed — catch-up beyond it is a clinical decision,
      // not an automatic "overdue" on every adult's card.
      if (
        recommendedAge.max_age_years !== undefined &&
        profile.ageYears !== null &&
        profile.ageYears > recommendedAge.max_age_years
      ) {
        return { ...base, status: "not_applicable", nextDueDate: null };
      }
      if (!profile.dateOfBirth) {
        return { ...base, status: "not_yet_due", nextDueDate: null };
      }
      const nextDueDate = addWeeks(profile.dateOfBirth, schedule[dosesGiven]);
      if (nextDueDate > todayISO) {
        return { ...base, status: "not_yet_due", nextDueDate };
      }
      return { ...base, status: dueOrOverdue(nextDueDate, todayISO), nextDueDate };
    }

    if (recommendedAge.interval_years !== undefined) {
      if (!lastDoseDate) {
        return { ...base, status: "due", nextDueDate: todayISO };
      }
      const nextDueDate = addYears(lastDoseDate, recommendedAge.interval_years);
      return { ...base, status: dueOrOverdue(nextDueDate, todayISO), nextDueDate };
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

    // Unrecognised/empty recommended_age shape — degrade gracefully rather
    // than crash: treat as a plain one-off with no age gate.
    return dosesGiven > 0
      ? { ...base, status: "up_to_date", nextDueDate: null }
      : { ...base, status: "due", nextDueDate: todayISO };
  });
}

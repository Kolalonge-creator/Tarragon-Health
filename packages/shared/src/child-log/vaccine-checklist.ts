import { doseTrust, type DoseTrust } from "../immunisation-card";
import { childLogSettings, type ChildLogSettings } from "./settings";

/**
 * The child's vaccine checklist (S68b), dose by dose, from the NPHCDA schedule that already lives in `vaccination_catalog.recommended_age`
 * (`age_schedule_weeks`, `max_age_years`, `sex`). Pure: no database, no QR code, no model. A dose is:
 *   done      a record exists for that dose number (and says how far it can be trusted, like the immunisation card);
 *   overdue   its date has passed and it is not done;
 *   due       its date is today or within the configured window (`child_log.settings.due_window_days`);
 *   upcoming  later than that.
 * A vaccine that does not apply (wrong sex, or past `max_age_years` with the dose still open) is left out: catching up after that age is a
 * care-team decision, not something this list decides. The list never says a child is "protected" or "unprotected".
 */
export interface ScheduleCatalogRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly recommended_age: unknown;
}

export interface ScheduleRecordRow {
  readonly vaccination_catalog_id: string;
  readonly dose_number: number;
  readonly date_administered: string;
  readonly verification_status: string;
}

export type ChecklistStatus = "done" | "due" | "overdue" | "upcoming";

export interface ChecklistDose {
  readonly code: string;
  readonly name: string;
  readonly doseNumber: number;
  readonly dueDate: string;
  readonly status: ChecklistStatus;
  readonly doneOn: string | null;
  readonly trust: DoseTrust | null;
}

interface ScheduleShape {
  readonly weeks: readonly number[];
  readonly maxAgeYears: number | null;
  readonly sex: string | null;
}

function scheduleOf(recommendedAge: unknown): ScheduleShape | null {
  if (typeof recommendedAge !== "object" || recommendedAge === null) return null;
  const r = recommendedAge as Record<string, unknown>;
  const weeks = r.age_schedule_weeks;
  if (!Array.isArray(weeks) || weeks.length === 0 || !weeks.every((w) => typeof w === "number" && Number.isFinite(w) && w >= 0)) return null;
  return {
    weeks: weeks as number[],
    maxAgeYears: typeof r.max_age_years === "number" ? r.max_age_years : null,
    sex: typeof r.sex === "string" ? r.sex : null,
  };
}

const DAY_MS = 86_400_000;
/** YYYY-MM-DD arithmetic in UTC so a phone's time zone never shifts a due date by a day. */
function addDays(isoDate: string, days: number): string {
  return new Date(Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) / DAY_MS);
}

const STATUS_RANK: Record<ChecklistStatus, number> = { overdue: 0, due: 1, upcoming: 2, done: 3 };

export function buildChildVaccineChecklist(
  input: {
    readonly dateOfBirth: string;
    readonly sex: "male" | "female" | null;
    /** Today, YYYY-MM-DD (Africa/Lagos). */
    readonly today: string;
    readonly catalog: readonly ScheduleCatalogRow[];
    readonly records: readonly ScheduleRecordRow[];
  },
  settings: ChildLogSettings = childLogSettings().settings,
): ChecklistDose[] {
  const ageYears = daysBetween(input.dateOfBirth, input.today) / 365.25;
  const out: ChecklistDose[] = [];
  for (const cat of input.catalog) {
    const sched = scheduleOf(cat.recommended_age);
    if (!sched) continue;
    if (sched.sex && input.sex !== sched.sex) continue;
    const mine = input.records.filter((r) => r.vaccination_catalog_id === cat.id && r.verification_status !== "rejected");
    sched.weeks.forEach((w, i) => {
      const doseNumber = i + 1;
      const dueDate = addDays(input.dateOfBirth, Math.round(w * 7));
      // Strictly by dose number. (An earlier version also counted by how many doses were on file, which marked a missing dose as done when a
      // record had a different number. vaccination_records is unique per profile, vaccine and dose number, so a second row with the same
      // number cannot exist, and a record whose number does not match this dose is not evidence that THIS dose was given.)
      const rec = mine.find((r) => r.dose_number === doseNumber);
      if (rec) {
        out.push({ code: cat.code, name: cat.name, doseNumber, dueDate, status: "done", doneOn: rec.date_administered, trust: doseTrust(rec.verification_status) });
        return;
      }
      if (sched.maxAgeYears !== null && ageYears > sched.maxAgeYears) return;
      const days = daysBetween(input.today, dueDate);
      const status: ChecklistStatus = days < 0 ? "overdue" : days <= settings.due_window_days ? "due" : "upcoming";
      out.push({ code: cat.code, name: cat.name, doseNumber, dueDate, status, doneOn: null, trust: null });
    });
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name) || a.doseNumber - b.doseNumber);
}

export interface ChecklistCounts {
  readonly done: number;
  readonly due: number;
  readonly overdue: number;
  readonly upcoming: number;
}

export function checklistCounts(doses: readonly ChecklistDose[]): ChecklistCounts {
  const c = { done: 0, due: 0, overdue: 0, upcoming: 0 };
  for (const d of doses) c[d.status] += 1;
  return c;
}

/** What needs attention first: overdue, then due, then the rest, each in date order. */
export function sortByAttention(doses: readonly ChecklistDose[]): ChecklistDose[] {
  return [...doses].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.dueDate.localeCompare(b.dueDate));
}

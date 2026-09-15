/**
 * Gestational-week estimate (Women's Health §44.6/44.7) — verbatim port of
 * apps/web/src/lib/rules/gestational-age.ts. Pure, no DB access. Naegele's
 * rule (LMP + 280 days = estimated due date) is a standard obstetric
 * estimate, not a clinical dating scan — never presented as confirmed
 * gestational age.
 */

const GESTATION_DAYS = 280;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
  const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
  return Math.round((to - from) / MS_PER_DAY);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface GestationalEstimateInput {
  lastMenstrualPeriodDate: string | null;
  estimatedDueDate: string | null;
  asOfDate?: string;
}

export interface GestationalEstimate {
  weeks: number;
  source: "lmp" | "due_date";
  estimatedDueDate: string;
}

export function computeGestationalEstimate(input: GestationalEstimateInput): GestationalEstimate | null {
  const asOf = input.asOfDate ?? new Date().toISOString().slice(0, 10);

  if (input.lastMenstrualPeriodDate) {
    const due = addDays(input.lastMenstrualPeriodDate, GESTATION_DAYS);
    const daysSinceLmp = daysBetween(input.lastMenstrualPeriodDate, asOf);
    const weeks = Math.max(0, Math.min(45, Math.floor(daysSinceLmp / 7)));
    return { weeks, source: "lmp", estimatedDueDate: due };
  }

  if (input.estimatedDueDate) {
    const daysUntilDue = daysBetween(asOf, input.estimatedDueDate);
    const weeks = Math.max(0, Math.min(45, Math.floor((GESTATION_DAYS - daysUntilDue) / 7)));
    return { weeks, source: "due_date", estimatedDueDate: input.estimatedDueDate };
  }

  return null;
}

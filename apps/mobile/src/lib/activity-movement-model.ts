import type { ActivityPayload } from "./outbox";
import { lagosLocalDate } from "./lagos-date";

/**
 * Pure rules for the Movement screen (S48b). Mirrors the web logWorkoutSchema / setWeeklyGoalSchema; the database CHECKs are the real bounds.
 * No I/O, so every branch is unit tested.
 */
export const ACTIVITY_KIND_CHOICES: { value: ActivityPayload["activity_kind"]; label: string }[] = [
  { value: "walking", label: "Walking" },
  { value: "running", label: "Running" },
  { value: "cycling", label: "Cycling" },
  { value: "dancing", label: "Dancing" },
  { value: "football", label: "Football" },
  { value: "farm_manual_work", label: "Farm or manual work" },
  { value: "chair_based", label: "Chair-based exercise" },
];

const KINDS = new Set<string>(ACTIVITY_KIND_CHOICES.map((c) => c.value));

export type ActivityEntryParse = { ok: true; payload: ActivityPayload } | { ok: false; error: string };

/** A decimal typed by hand: digits with at most one dot or comma. Plain loop on purpose (no backtracking pattern on user text). */
export function parseDecimal(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  let dots = 0;
  for (const ch of text) {
    if (ch === ".") dots += 1;
    else if (ch < "0" || ch > "9") return null;
  }
  if (dots > 1 || text === ".") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function parseActivityEntry(values: Record<string, string>, nowMs: number): ActivityEntryParse {
  const kind = values.kind?.trim() ?? "";
  if (!KINDS.has(kind)) return { ok: false, error: "Choose what you did." };
  const minutes = parseDecimal(values.minutes ?? "");
  if (minutes === null || !Number.isInteger(minutes) || minutes < 1 || minutes > 1000) {
    return { ok: false, error: "Enter how many minutes, as a whole number from 1 to 1000." };
  }
  let distance: number | null = null;
  if ((values.distance_km ?? "").trim() !== "") {
    const km = parseDecimal(values.distance_km ?? "");
    if (km === null || km > 1000) return { ok: false, error: "Enter the distance in kilometres, like 2.5, or leave it empty." };
    distance = Math.round(km * 1000);
  }
  return {
    ok: true,
    payload: { activity_kind: kind as ActivityPayload["activity_kind"], duration_minutes: minutes, distance_m: distance, logged_on: lagosLocalDate(nowMs) },
  };
}

export type WeeklyGoalParse = { ok: true; minutes: number } | { ok: false; error: string };

/** The weekly active-minutes goal; the bound is the minutes in a week (the database CHECK), not a clinical figure. */
export function parseWeeklyGoal(raw: string): WeeklyGoalParse {
  const n = parseDecimal(raw);
  if (n === null || !Number.isInteger(n) || n < 1 || n > 10080) return { ok: false, error: "Enter a whole number of minutes for the week, from 1 to 10080." };
  return { ok: true, minutes: n };
}

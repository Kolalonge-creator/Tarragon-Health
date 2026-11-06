/**
 * The Chief Medical Officer's oversight view on the clinician home (DW-14, 2026-11-06).
 *
 * Pure: it takes the same org-wide worklist rows every doctor's home already loads and answers the CMO's questions:
 * what is overdue, what nobody owns, and who is carrying how much. "Unknown is not zero": a figure built from a source that
 * failed to load is null, never 0.
 */
import { isOverdue, sortWorklist, type DoctorWorklistRow, type WorklistSource } from "./doctor-worklist";

export type OversightFigure = number | null;

export type DoctorLoad = {
  name: string;
  open: number;
  overdue: number;
};

export type CmoOversightView = {
  /** Team work (escalations and alerts; shared review queues are not owned by one doctor), overdue first, then by priority. */
  teamRows: DoctorWorklistRow[];
  /** All team rows, before the display limit. */
  teamTotal: number;
  overdue: OversightFigure;
  unassigned: OversightFigure;
  /** Per named owner, heaviest first (most overdue, then most open). */
  byDoctor: DoctorLoad[];
};

const TEAM_SOURCES: readonly WorklistSource[] = ["escalation", "alert"];

export function cmoOversightView(
  rows: readonly DoctorWorklistRow[],
  failedSources: readonly WorklistSource[],
  now: Date,
  limit = 10,
): CmoOversightView {
  const team = rows.filter((r) => TEAM_SOURCES.includes(r.source));
  const teamSourceFailed = failedSources.some((s) => TEAM_SOURCES.includes(s));

  const sorted = sortWorklist(team, now)
    .map((row, index) => ({ row, index, overdue: isOverdue(row, now) }))
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.index - b.index)
    .map(({ row }) => row);

  const loads = new Map<string, DoctorLoad>();
  for (const row of team) {
    if (row.unassigned) continue;
    const name = row.assignedName ?? "Another clinician";
    const load = loads.get(name) ?? { name, open: 0, overdue: 0 };
    load.open += 1;
    if (isOverdue(row, now)) load.overdue += 1;
    loads.set(name, load);
  }

  return {
    teamRows: sorted.slice(0, limit),
    teamTotal: sorted.length,
    overdue: teamSourceFailed ? null : team.filter((r) => isOverdue(r, now)).length,
    unassigned: teamSourceFailed ? null : team.filter((r) => r.unassigned).length,
    byDoctor: [...loads.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name)),
  };
}

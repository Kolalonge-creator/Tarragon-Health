/**
 * Deterministic pre-visit brief (S89). Pure: no model, no I/O, no clock beyond the `now` it is given.
 *
 * Every line is produced by plain code from rows already read through the audited, tie-gated paths, and every line carries the rows it
 * came from (`sources`), so a clinician can open the source instead of trusting a sentence. Where the record holds too little, a line
 * says "Not enough in the record" and gives the count; it never estimates, extrapolates or guesses. Nothing here scores, ranks or
 * decides anything clinical.
 *
 * Sensitive data (INV-10, INV-12): a row that matches a sensitive category (reproductive health, mental health, a sensitive positive
 * result) is dropped before any line is made unless the viewer's access for that category is confirmed. Access defaults to denied and
 * the number of rows dropped is never shown, because "3 hidden items" is itself a disclosure.
 *
 * Window sizes, the minimum count for a trend and the sensitive-term list come from the PROPOSED config key
 * `copilot.previsit_brief_rules`, passed in as `rules`; none is hard-coded here.
 */

export type SensitiveCategory = "reproductive_health" | "mental_health" | "sensitive_positive";
export type BriefAccess = Record<SensitiveCategory, boolean>;
/** Fail closed: nothing sensitive is shown unless access for that category is confirmed. */
export const NO_SENSITIVE_ACCESS: BriefAccess = { reproductive_health: false, mental_health: false, sensitive_positive: false };

export interface BriefRules {
  windowDays: number;
  minReadingsForTrend: number;
  maxReadingsRead: number;
  recentLabResultDays: number;
  refillOverdueDays: number;
  sensitiveTerms: Record<SensitiveCategory, readonly string[]>;
}

/** A read that may have been refused or failed. A refusal is "not available to you", never "none on file". */
export type Available<T> = { state: "ok"; rows: readonly T[] } | { state: "unavailable" };
export const ok = <T,>(rows: readonly T[]): Available<T> => ({ state: "ok", rows });
export const unavailable = <T,>(): Available<T> => ({ state: "unavailable" });

export interface BriefVitalsRow { id: string; taken_at: string; systolic: number | null; diastolic: number | null; glucose_mmol_l: number | null }
export interface BriefMedicationRow { id: string; drug_name: string; refill_date: string | null; updated_at: string }
export interface BriefTaskRow { id: string; title: string; status: string; due_at: string | null }
/** `patient_care_gaps` is a view with no row id: the key below is built from its columns. */
export interface BriefCareGapRow { gap_type: string | null; condition_or_type: string | null; opened_at: string | null }
export interface BriefCarePlanRow { id: string; condition: string; updated_at: string }
export interface BriefConsultationRow { id: string; status: string; scheduled_at: string | null; ended_at: string | null }

export interface BriefInput {
  now: Date;
  vitals: Available<BriefVitalsRow>;
  medications: Available<BriefMedicationRow>;
  tasks: Available<BriefTaskRow>;
  careGaps: Available<BriefCareGapRow>;
  carePlans: Available<BriefCarePlanRow>;
  consultations: Available<BriefConsultationRow>;
  access?: BriefAccess;
}

export type SourceKind = "vitals_reading" | "medication" | "care_task" | "care_gap" | "care_plan" | "consultation";

export interface SourceRef {
  kind: SourceKind;
  id: string;
  /** ISO timestamp of the row, if it has one. */
  at: string | null;
  /** The row's own content in a few words, as stored. */
  summary: string;
}

export type BriefLineKey =
  | "bp_trend"
  | "glucose_trend"
  | "adherence_gaps"
  | "open_tasks"
  | "care_gaps"
  | "abnormal_awaiting"
  | "last_plan_change"
  | "last_consultation";

export interface BriefLine {
  key: BriefLineKey;
  label: string;
  text: string;
  status: "ok" | "not_enough" | "unavailable";
  /** Empty only for a line that says nothing came from the record ("not enough", "not available to you"). */
  sources: SourceRef[];
}

export const NOT_ENOUGH = "Not enough in the record";
export const NOT_AVAILABLE = "Not available to you";
const DAY_MS = 86_400_000;
const UNACTIONED_ABNORMAL = "unactioned_abnormal";
const OPEN_TASK_STATUSES = new Set(["not_started", "scheduled", "in_progress", "missed"]);

export function sourceAnchor(ref: Pick<SourceRef, "kind" | "id">): string {
  return `source-${ref.kind}-${ref.id}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function gapKey(g: BriefCareGapRow): string {
  return `${g.gap_type ?? "gap"}:${g.condition_or_type ?? ""}:${g.opened_at ?? ""}`;
}

/** The sensitive category a piece of text falls in, or null. Matching is by substring so "pregnancy" and "pregnant" both hit "pregnan". */
export function sensitiveCategoryOf(text: string, terms: BriefRules["sensitiveTerms"]): SensitiveCategory | null {
  const t = ` ${text.toLowerCase()} `;
  for (const category of Object.keys(terms) as SensitiveCategory[]) {
    if (terms[category].some((term) => t.includes(term.toLowerCase()))) return category;
  }
  return null;
}

function visible(text: string, rules: BriefRules, access: BriefAccess): boolean {
  const category = sensitiveCategoryOf(text, rules.sensitiveTerms);
  return category === null || access[category] === true;
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" });

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function line(key: BriefLineKey, label: string, text: string, status: BriefLine["status"], sources: SourceRef[] = []): BriefLine {
  return { key, label, text, status, sources };
}

function gate<T>(a: Available<T>, key: BriefLineKey, label: string): BriefLine | null {
  return a.state === "unavailable" ? line(key, label, `${NOT_AVAILABLE}.`, "unavailable") : null;
}

function bpLine(input: BriefInput, rules: BriefRules): BriefLine {
  const label = "Blood pressure";
  const blocked = gate(input.vitals, "bp_trend", label);
  if (blocked) return blocked;
  const since = input.now.getTime() - rules.windowDays * DAY_MS;
  const rows = (input.vitals as { rows: readonly BriefVitalsRow[] }).rows
    .filter((r) => r.systolic !== null && r.diastolic !== null && new Date(r.taken_at).getTime() >= since)
    .sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1));
  if (rows.length < rules.minReadingsForTrend) {
    return line("bp_trend", label, `${NOT_ENOUGH}: ${rows.length} reading${rows.length === 1 ? "" : "s"} in the last ${rules.windowDays} days (at least ${rules.minReadingsForTrend} are needed to describe a trend).`, "not_enough", rows.map(bpSource));
  }
  const first = rows[0] as BriefVitalsRow;
  const last = rows[rows.length - 1] as BriefVitalsRow;
  const sys = rows.map((r) => r.systolic as number);
  const dia = rows.map((r) => r.diastolic as number);
  return line(
    "bp_trend",
    label,
    `${rows.length} readings in the last ${rules.windowDays} days. First ${first.systolic}/${first.diastolic} (${fmtDate(first.taken_at)}), latest ${last.systolic}/${last.diastolic} (${fmtDate(last.taken_at)}), mean ${round1(mean(sys))}/${round1(mean(dia))}.`,
    "ok",
    rows.map(bpSource),
  );
}

const bpSource = (r: BriefVitalsRow): SourceRef => ({ kind: "vitals_reading", id: r.id, at: r.taken_at, summary: `${r.systolic}/${r.diastolic} mmHg` });

function glucoseLine(input: BriefInput, rules: BriefRules): BriefLine {
  const label = "Blood glucose";
  const blocked = gate(input.vitals, "glucose_trend", label);
  if (blocked) return blocked;
  const since = input.now.getTime() - rules.windowDays * DAY_MS;
  const rows = (input.vitals as { rows: readonly BriefVitalsRow[] }).rows
    .filter((r) => r.glucose_mmol_l !== null && new Date(r.taken_at).getTime() >= since)
    .sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1));
  const src = (r: BriefVitalsRow): SourceRef => ({ kind: "vitals_reading", id: r.id, at: r.taken_at, summary: `${r.glucose_mmol_l} mmol/L` });
  if (rows.length < rules.minReadingsForTrend) {
    return line("glucose_trend", label, `${NOT_ENOUGH}: ${rows.length} reading${rows.length === 1 ? "" : "s"} in the last ${rules.windowDays} days (at least ${rules.minReadingsForTrend} are needed to describe a trend).`, "not_enough", rows.map(src));
  }
  const first = rows[0] as BriefVitalsRow;
  const last = rows[rows.length - 1] as BriefVitalsRow;
  const values = rows.map((r) => r.glucose_mmol_l as number);
  return line(
    "glucose_trend",
    label,
    `${rows.length} readings in the last ${rules.windowDays} days. First ${first.glucose_mmol_l} mmol/L (${fmtDate(first.taken_at)}), latest ${last.glucose_mmol_l} mmol/L (${fmtDate(last.taken_at)}), mean ${round1(mean(values))} mmol/L.`,
    "ok",
    rows.map(src),
  );
}

function adherenceLine(input: BriefInput, rules: BriefRules, access: BriefAccess): BriefLine {
  const label = "Adherence gaps";
  const meds = gate(input.medications, "adherence_gaps", label);
  if (meds) return meds;
  const medRows = (input.medications as { rows: readonly BriefMedicationRow[] }).rows.filter((m) => visible(m.drug_name, rules, access));
  const cutoff = input.now.getTime() - rules.refillOverdueDays * DAY_MS;
  const overdue = medRows.filter((m) => m.refill_date !== null && new Date(m.refill_date).getTime() < cutoff);
  const missedTasks =
    input.tasks.state === "ok" ? input.tasks.rows.filter((t) => t.status === "missed" && visible(t.title, rules, access)) : [];
  const sources: SourceRef[] = [
    ...overdue.map((m): SourceRef => ({ kind: "medication", id: m.id, at: m.refill_date, summary: `${m.drug_name}, refill due ${m.refill_date ? fmtDate(m.refill_date) : "unknown"}` })),
    ...missedTasks.map((t): SourceRef => ({ kind: "care_task", id: t.id, at: t.due_at, summary: `${t.title} (missed)` })),
  ];
  if (medRows.length === 0 && missedTasks.length === 0) return line("adherence_gaps", label, `${NOT_ENOUGH}: no active medicines or missed tasks on file.`, "not_enough");
  if (sources.length === 0) return line("adherence_gaps", label, "No overdue refills or missed tasks in the record.", "ok");
  const parts = [
    overdue.length > 0 ? `${overdue.length} refill${overdue.length === 1 ? "" : "s"} past due` : null,
    missedTasks.length > 0 ? `${missedTasks.length} missed task${missedTasks.length === 1 ? "" : "s"}` : null,
  ].filter((p): p is string => p !== null);
  return line("adherence_gaps", label, `${parts.join(" and ")}.`, "ok", sources);
}

function tasksLine(input: BriefInput, rules: BriefRules, access: BriefAccess): BriefLine {
  const label = "Open tasks";
  const blocked = gate(input.tasks, "open_tasks", label);
  if (blocked) return blocked;
  const open = (input.tasks as { rows: readonly BriefTaskRow[] }).rows
    .filter((t) => OPEN_TASK_STATUSES.has(t.status) && visible(t.title, rules, access))
    .sort((a, b) => (a.due_at ?? "9999") < (b.due_at ?? "9999") ? -1 : 1);
  if (open.length === 0) return line("open_tasks", label, "No open tasks in the record.", "ok");
  const overdue = open.filter((t) => t.due_at !== null && new Date(t.due_at).getTime() < input.now.getTime()).length;
  return line(
    "open_tasks",
    label,
    `${open.length} open task${open.length === 1 ? "" : "s"}${overdue > 0 ? `, ${overdue} past due` : ""}.`,
    "ok",
    open.map((t): SourceRef => ({ kind: "care_task", id: t.id, at: t.due_at, summary: t.title })),
  );
}

function gapsLines(input: BriefInput, rules: BriefRules, access: BriefAccess): [BriefLine, BriefLine] {
  const gapLabel = "Care gaps";
  const abnormalLabel = "Abnormal results awaiting action";
  const blocked = gate(input.careGaps, "care_gaps", gapLabel);
  if (blocked) return [blocked, line("abnormal_awaiting", abnormalLabel, `${NOT_AVAILABLE}.`, "unavailable")];
  const rows = (input.careGaps as { rows: readonly BriefCareGapRow[] }).rows.filter((g) => visible(`${g.gap_type ?? ""} ${g.condition_or_type ?? ""}`, rules, access));
  const src = (g: BriefCareGapRow): SourceRef => ({ kind: "care_gap", id: gapKey(g), at: g.opened_at, summary: `${(g.gap_type ?? "gap").replace(/_/g, " ")}${g.condition_or_type ? `: ${g.condition_or_type}` : ""}` });
  const abnormal = rows.filter((g) => g.gap_type === UNACTIONED_ABNORMAL);
  const other = rows.filter((g) => g.gap_type !== UNACTIONED_ABNORMAL);
  return [
    other.length === 0
      ? line("care_gaps", gapLabel, "No open care gaps in the record.", "ok")
      : line("care_gaps", gapLabel, `${other.length} open care gap${other.length === 1 ? "" : "s"}.`, "ok", other.map(src)),
    abnormal.length === 0
      ? line("abnormal_awaiting", abnormalLabel, "None awaiting action in the record.", "ok")
      : line("abnormal_awaiting", abnormalLabel, `${abnormal.length} abnormal result${abnormal.length === 1 ? "" : "s"} awaiting action.`, "ok", abnormal.map(src)),
  ];
}

function planChangeLine(input: BriefInput, rules: BriefRules, access: BriefAccess): BriefLine {
  const label = "Last plan change";
  if (input.carePlans.state === "unavailable" && input.medications.state === "unavailable") return line("last_plan_change", label, `${NOT_AVAILABLE}.`, "unavailable");
  const plans = input.carePlans.state === "ok" ? input.carePlans.rows.filter((p) => visible(p.condition, rules, access)) : [];
  const meds = input.medications.state === "ok" ? input.medications.rows.filter((m) => visible(m.drug_name, rules, access)) : [];
  const candidates: SourceRef[] = [
    ...plans.map((p): SourceRef => ({ kind: "care_plan", id: p.id, at: p.updated_at, summary: `${p.condition.replace(/_/g, " ")} care plan updated` })),
    ...meds.map((m): SourceRef => ({ kind: "medication", id: m.id, at: m.updated_at, summary: `${m.drug_name} record updated` })),
  ].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));
  const latest = candidates[0];
  if (!latest || latest.at === null) return line("last_plan_change", label, `${NOT_ENOUGH}: no care plan or medicine record on file.`, "not_enough");
  return line("last_plan_change", label, `${latest.summary} on ${fmtDate(latest.at)}.`, "ok", [latest]);
}

function consultationLine(input: BriefInput): BriefLine {
  const label = "Last consultation";
  const blocked = gate(input.consultations, "last_consultation", label);
  if (blocked) return blocked;
  const done = (input.consultations as { rows: readonly BriefConsultationRow[] }).rows
    .filter((c) => c.status === "completed")
    .sort((a, b) => ((a.ended_at ?? a.scheduled_at ?? "") < (b.ended_at ?? b.scheduled_at ?? "") ? 1 : -1));
  const last = done[0];
  const at = last ? (last.ended_at ?? last.scheduled_at) : null;
  if (!last || at === null) return line("last_consultation", label, `${NOT_ENOUGH}: no completed consultation on file.`, "not_enough");
  return line("last_consultation", label, `Video consultation on ${fmtDate(at)}.`, "ok", [{ kind: "consultation", id: last.id, at, summary: "Completed video consultation" }]);
}

export function buildPreVisitBrief(input: BriefInput, rules: BriefRules): BriefLine[] {
  const access = input.access ?? NO_SENSITIVE_ACCESS;
  const [gaps, abnormal] = gapsLines(input, rules, access);
  return [
    bpLine(input, rules),
    glucoseLine(input, rules),
    adherenceLine(input, rules, access),
    tasksLine(input, rules, access),
    gaps,
    abnormal,
    planChangeLine(input, rules, access),
    consultationLine(input),
  ];
}

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
 * the number of rows dropped is never shown, because "3 hidden items" is itself a disclosure. Classification prefers structured codes
 * (a care plan's condition, a consultation's context) and falls back to whole-word text matching; either signal saying "sensitive" wins.
 * A medicine or care plan that cannot be positively classified as non-sensitive is UNKNOWN and, like a sensitive row, is shown only to a
 * viewer with access to every sensitive category (fail closed). Because rows can be dropped, "last ..." lines say they are the most
 * recent among the records shown to the viewer.
 *
 * "None" and "unknown" are never mixed up: a refused read, a null date, or a cut-off fetch is said to be "Not available" or "older
 * readings not included", never turned into a count or a reassurance.
 *
 * Window sizes, the minimum count for a trend, the fetch limit and every term and code list come from the PROPOSED config key
 * `copilot.previsit_brief_rules`, passed in as `rules`; none is hard-coded here.
 */

import { textMatchesAny } from "@tarragon/clinical/text-match";

export type SensitiveCategory = "reproductive_health" | "mental_health" | "sensitive_positive";
export type BriefAccess = Record<SensitiveCategory, boolean>;
/** Fail closed: nothing sensitive is shown unless access for that category is confirmed. */
export const NO_SENSITIVE_ACCESS: BriefAccess = { reproductive_health: false, mental_health: false, sensitive_positive: false };

/** How a row classifies: a sensitive category, positively non-sensitive, or unknown (cannot be told). */
export type RowClass = SensitiveCategory | "non_sensitive" | "unknown";

export interface BriefRules {
  windowDays: number;
  minReadingsForTrend: number;
  /** Rows fetched per reading type inside the window. A type that returns this many has been cut off. */
  maxReadingsRead: number;
  recentLabResultDays: number;
  refillOverdueDays: number;
  sensitiveTerms: Record<SensitiveCategory, readonly string[]>;
  /** care_plans.condition code to a class. A code not listed is unknown. */
  carePlanConditionClass: Readonly<Record<string, RowClass>>;
  /** video_consultations.context code to a class. A code not listed is unknown. */
  consultationContextClass: Readonly<Record<string, RowClass>>;
  /** Medicines positively known to be non-sensitive. */
  nonSensitiveMedicationTerms: readonly string[];
}

/** A read that may have been refused or failed. A refusal is "not available to you", never "none on file". */
export type Available<T> = { state: "ok"; rows: readonly T[] } | { state: "unavailable" };
export const ok = <T,>(rows: readonly T[]): Available<T> => ({ state: "ok", rows });
export const unavailable = <T,>(): Available<T> => ({ state: "unavailable" });

export interface BriefVitalsRow { id: string; taken_at: string; systolic: number | null; diastolic: number | null; glucose_mmol_l: number | null }
export interface BriefMedicationRow {
  id: string;
  drug_name: string;
  /** Date-only (YYYY-MM-DD) as stored. Null means no refill date is recorded, which is unknown, not "nothing overdue". */
  refill_date: string | null;
  updated_at: string;
  /** Free-text indication, if the row has one; read for sensitive terms only. */
  indication?: string | null;
  /** Condition code of the linked care plan, if any (structured). */
  care_plan_condition?: string | null;
}
export interface BriefTaskRow { id: string; title: string; status: string; due_at: string | null }
/** `patient_care_gaps` is a view with no row id: the key below is built from its columns. */
export interface BriefCareGapRow { gap_type: string | null; condition_or_type: string | null; opened_at: string | null }
export interface BriefCarePlanRow { id: string; condition: string; updated_at: string }
export interface BriefConsultationRow {
  id: string;
  status: string;
  scheduled_at: string | null;
  ended_at: string | null;
  /** video_consultations.context code (structured). */
  context?: string | null;
}

export interface BriefInput {
  now: Date;
  /** Blood pressure readings, fetched by type for the window (newest first or any order). */
  bloodPressure: Available<BriefVitalsRow>;
  /** Glucose readings, fetched by type for the window. */
  glucose: Available<BriefVitalsRow>;
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
  /** ok: established from the record. not_enough: the record holds too little. unavailable: the read was refused or failed. unknown: part of the line could not be established. */
  status: "ok" | "not_enough" | "unavailable" | "unknown";
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

const CATEGORY_ORDER: readonly SensitiveCategory[] = ["reproductive_health", "mental_health", "sensitive_positive"];

/** Every sensitive category a piece of text falls in (whole-word matching, so "archive" does not hit "hiv"). */
export function sensitiveCategoriesOf(text: string, terms: BriefRules["sensitiveTerms"]): SensitiveCategory[] {
  return CATEGORY_ORDER.filter((c) => textMatchesAny(text, terms[c] ?? []));
}

/** The first sensitive category a piece of text falls in, or null. Prefer `sensitiveCategoriesOf` where more than one may apply. */
export function sensitiveCategoryOf(text: string, terms: BriefRules["sensitiveTerms"]): SensitiveCategory | null {
  return sensitiveCategoriesOf(text, terms)[0] ?? null;
}

/** What a row classified as: the sensitive categories it touches and whether it is unknown (could not be told apart from sensitive). */
export interface Classification {
  categories: readonly SensitiveCategory[];
  unknown: boolean;
}

export const hasFullAccess = (access: BriefAccess): boolean => CATEGORY_ORDER.every((c) => access[c] === true);

/** Shown when every category it touches is confirmed, and, if unknown, only when the viewer can see every sensitive category. */
export function canShow(c: Classification, access: BriefAccess): boolean {
  return c.categories.every((cat) => access[cat] === true) && (!c.unknown || hasFullAccess(access));
}

const isCategory = (v: RowClass | undefined): v is SensitiveCategory => v !== undefined && v !== "non_sensitive" && v !== "unknown";

/** Text-only classification (tasks, care gaps): sensitive terms decide; text that matches nothing is treated as not sensitive. */
export function classifyText(text: string, rules: BriefRules): Classification {
  return { categories: sensitiveCategoriesOf(text, rules.sensitiveTerms), unknown: false };
}

/** A care plan classifies by its condition code first; a code the config does not list, and text that matches nothing, make it unknown. */
export function classifyCarePlan(p: BriefCarePlanRow, rules: BriefRules): Classification {
  const structured = rules.carePlanConditionClass[p.condition];
  const categories = new Set<SensitiveCategory>(sensitiveCategoriesOf(p.condition.replace(/_/g, " "), rules.sensitiveTerms));
  if (isCategory(structured)) categories.add(structured);
  return { categories: [...categories], unknown: categories.size === 0 && structured !== "non_sensitive" };
}

/** A medicine is non-sensitive only when positively known: a care plan code or a listed name. Anything else is unknown (fail closed). */
export function classifyMedication(m: BriefMedicationRow, rules: BriefRules): Classification {
  const structured = m.care_plan_condition ? rules.carePlanConditionClass[m.care_plan_condition] : undefined;
  const categories = new Set<SensitiveCategory>(sensitiveCategoriesOf(`${m.drug_name} ${m.indication ?? ""}`, rules.sensitiveTerms));
  if (isCategory(structured)) categories.add(structured);
  const positive = structured === "non_sensitive" || textMatchesAny(m.drug_name, rules.nonSensitiveMedicationTerms);
  return { categories: [...categories], unknown: categories.size === 0 && !positive };
}

export function classifyConsultation(c: BriefConsultationRow, rules: BriefRules): Classification {
  const structured = c.context ? rules.consultationContextClass[c.context] : undefined;
  if (isCategory(structured)) return { categories: [structured], unknown: false };
  return { categories: [], unknown: structured !== "non_sensitive" };
}

function visible(text: string, rules: BriefRules, access: BriefAccess): boolean {
  return canShow(classifyText(text, rules), access);
}

/** Said on "last ..." lines when some rows may have been dropped, without hinting at whether any were. */
const scopeNote = (access: BriefAccess): string => (hasFullAccess(access) ? "" : " (the most recent among the records shown to you)");

const LAGOS = "Africa/Lagos";

/** The calendar date in Africa/Lagos as YYYY-MM-DD. Date-only fields are compared on this, never on a UTC instant. */
export function lagosDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: LAGOS });
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** A stored date as a Lagos calendar date, or null when it cannot be read. A date-only string is already a calendar date. */
function lagosDateOf(value: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : lagosDate(t);
}

const fmtDate = (iso: string): string => {
  const ymd = lagosDateOf(iso);
  if (ymd === null) return "an unreadable date";
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function line(key: BriefLineKey, label: string, text: string, status: BriefLine["status"], sources: SourceRef[] = []): BriefLine {
  return { key, label, text, status, sources };
}

function gate<T>(a: Available<T>, key: BriefLineKey, label: string): BriefLine | null {
  return a.state === "unavailable" ? line(key, label, `${NOT_AVAILABLE}.`, "unavailable") : null;
}

/** Readings of one type inside the window, oldest first. `truncated` is true when the fetch returned as many as the limit allows. */
function windowReadings(avail: { rows: readonly BriefVitalsRow[] }, has: (r: BriefVitalsRow) => boolean, input: BriefInput, rules: BriefRules) {
  const since = input.now.getTime() - rules.windowDays * DAY_MS;
  const rows = avail.rows
    .filter((r) => has(r) && new Date(r.taken_at).getTime() >= since)
    .sort((a, b) => (a.taken_at < b.taken_at ? -1 : 1));
  return { rows, truncated: rows.length >= rules.maxReadingsRead };
}

const thinText = (n: number, rules: BriefRules): string =>
  `${NOT_ENOUGH}: ${plural(n, "reading", "readings")} in the last ${rules.windowDays} days (at least ${rules.minReadingsForTrend} are needed to describe a trend).`;

function bpLine(input: BriefInput, rules: BriefRules): BriefLine {
  const label = "Blood pressure";
  const blocked = gate(input.bloodPressure, "bp_trend", label);
  if (blocked) return blocked;
  const { rows, truncated } = windowReadings(input.bloodPressure as { rows: readonly BriefVitalsRow[] }, (r) => r.systolic !== null && r.diastolic !== null, input, rules);
  if (rows.length < rules.minReadingsForTrend) return line("bp_trend", label, thinText(rows.length, rules), "not_enough", rows.map(bpSource));
  const first = rows[0] as BriefVitalsRow;
  const last = rows[rows.length - 1] as BriefVitalsRow;
  const meanText = `${round1(mean(rows.map((r) => r.systolic as number)))}/${round1(mean(rows.map((r) => r.diastolic as number)))}`;
  const text = truncated
    ? `Showing the latest ${rows.length} readings in the last ${rules.windowDays} days; older readings are not included. Earliest shown ${first.systolic}/${first.diastolic} (${fmtDate(first.taken_at)}), latest ${last.systolic}/${last.diastolic} (${fmtDate(last.taken_at)}), mean of these ${rows.length} ${meanText}.`
    : `${rows.length} readings in the last ${rules.windowDays} days. First ${first.systolic}/${first.diastolic} (${fmtDate(first.taken_at)}), latest ${last.systolic}/${last.diastolic} (${fmtDate(last.taken_at)}), mean ${meanText}.`;
  return line("bp_trend", label, text, "ok", rows.map(bpSource));
}

const bpSource = (r: BriefVitalsRow): SourceRef => ({ kind: "vitals_reading", id: r.id, at: r.taken_at, summary: `${r.systolic}/${r.diastolic} mmHg` });

function glucoseLine(input: BriefInput, rules: BriefRules): BriefLine {
  const label = "Blood glucose";
  const blocked = gate(input.glucose, "glucose_trend", label);
  if (blocked) return blocked;
  const { rows, truncated } = windowReadings(input.glucose as { rows: readonly BriefVitalsRow[] }, (r) => r.glucose_mmol_l !== null, input, rules);
  const src = (r: BriefVitalsRow): SourceRef => ({ kind: "vitals_reading", id: r.id, at: r.taken_at, summary: `${r.glucose_mmol_l} mmol/L` });
  if (rows.length < rules.minReadingsForTrend) return line("glucose_trend", label, thinText(rows.length, rules), "not_enough", rows.map(src));
  const first = rows[0] as BriefVitalsRow;
  const last = rows[rows.length - 1] as BriefVitalsRow;
  const m = round1(mean(rows.map((r) => r.glucose_mmol_l as number)));
  const text = truncated
    ? `Showing the latest ${rows.length} readings in the last ${rules.windowDays} days; older readings are not included. Earliest shown ${first.glucose_mmol_l} mmol/L (${fmtDate(first.taken_at)}), latest ${last.glucose_mmol_l} mmol/L (${fmtDate(last.taken_at)}), mean of these ${rows.length} ${m} mmol/L.`
    : `${rows.length} readings in the last ${rules.windowDays} days. First ${first.glucose_mmol_l} mmol/L (${fmtDate(first.taken_at)}), latest ${last.glucose_mmol_l} mmol/L (${fmtDate(last.taken_at)}), mean ${m} mmol/L.`;
  return line("glucose_trend", label, text, "ok", rows.map(src));
}

function adherenceLine(input: BriefInput, rules: BriefRules, access: BriefAccess): BriefLine {
  const label = "Adherence gaps";
  if (input.medications.state === "unavailable" && input.tasks.state === "unavailable") return line("adherence_gaps", label, `${NOT_AVAILABLE}.`, "unavailable");

  const positives: string[] = [];
  const known: string[] = [];
  const unknownNotes: string[] = [];
  const sources: SourceRef[] = [];
  let anyRecord = false;

  if (input.medications.state === "unavailable") {
    unknownNotes.push(`Refills: ${NOT_AVAILABLE}.`);
  } else {
    const medRows = input.medications.rows.filter((m) => canShow(classifyMedication(m, rules), access));
    // Refill dates are calendar dates: compare Africa/Lagos days, so a refill due today is not yet overdue at any hour.
    const today = dayNumber(lagosDate(input.now));
    const dated: { m: BriefMedicationRow; daysPast: number }[] = [];
    let undated = 0;
    for (const m of medRows) {
      const ymd = m.refill_date === null ? null : lagosDateOf(m.refill_date);
      if (ymd === null) undated += 1;
      else dated.push({ m, daysPast: today - dayNumber(ymd) });
    }
    const overdue = dated.filter((d) => d.daysPast > rules.refillOverdueDays);
    if (medRows.length > 0) anyRecord = true;
    if (overdue.length > 0) {
      positives.push(`${plural(overdue.length, "refill", "refills")} past due`);
      for (const { m } of overdue) sources.push({ kind: "medication", id: m.id, at: m.refill_date, summary: `${m.drug_name}, refill due ${fmtDate(m.refill_date as string)}` });
    } else if (dated.length > 0) known.push("No refills past due");
    else if (medRows.length === 0) known.push("No active medicines to show");
    if (undated > 0) unknownNotes.push(`No refill date is recorded for ${plural(undated, "medicine", "medicines")}, so refills for ${undated === 1 ? "it" : "them"} could not be checked.`);
  }

  if (input.tasks.state === "unavailable") {
    unknownNotes.push(`Missed tasks: ${NOT_AVAILABLE}.`);
  } else {
    const missed = input.tasks.rows.filter((t) => t.status === "missed" && visible(t.title, rules, access));
    if (missed.length > 0) {
      anyRecord = true;
      positives.push(`${plural(missed.length, "missed task", "missed tasks")}`);
      for (const t of missed) sources.push({ kind: "care_task", id: t.id, at: t.due_at, summary: `${t.title} (missed)` });
    } else known.push("No missed tasks");
  }

  if (unknownNotes.length === 0) {
    if (positives.length > 0) return line("adherence_gaps", label, `${positives.join(" and ")}.`, "ok", sources);
    if (!anyRecord) return line("adherence_gaps", label, `${NOT_ENOUGH}: no active medicines or missed tasks to show.`, "not_enough");
    return line("adherence_gaps", label, "No overdue refills or missed tasks in the record.", "ok");
  }
  const lead = positives.length > 0 ? [`${positives.join(" and ")}.`] : known.map((k) => `${k}.`);
  return line("adherence_gaps", label, [...lead, ...unknownNotes].join(" "), "unknown", sources);
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
  const partial = input.carePlans.state === "unavailable" || input.medications.state === "unavailable";
  const plans = input.carePlans.state === "ok" ? input.carePlans.rows.filter((p) => canShow(classifyCarePlan(p, rules), access)) : [];
  const meds = input.medications.state === "ok" ? input.medications.rows.filter((m) => canShow(classifyMedication(m, rules), access)) : [];
  const candidates: SourceRef[] = [
    ...plans.map((p): SourceRef => ({ kind: "care_plan", id: p.id, at: p.updated_at, summary: `${p.condition.replace(/_/g, " ")} care plan updated` })),
    ...meds.map((m): SourceRef => ({ kind: "medication", id: m.id, at: m.updated_at, summary: `${m.drug_name} record updated` })),
  ].sort((a, b) => ((a.at ?? "") < (b.at ?? "") ? 1 : -1));
  const latest = candidates[0];
  const unavailableNote = partial ? ` Part of the record is ${NOT_AVAILABLE.toLowerCase()}, so a later change may exist.` : "";
  if (!latest || latest.at === null) return line("last_plan_change", label, `${NOT_ENOUGH}: no care plan or medicine record to show.${unavailableNote}`, partial ? "unknown" : "not_enough");
  return line("last_plan_change", label, `${latest.summary} on ${fmtDate(latest.at)}${scopeNote(access)}.${unavailableNote}`, partial ? "unknown" : "ok", [latest]);
}

function consultationLine(input: BriefInput, rules: BriefRules, access: BriefAccess): BriefLine {
  const label = "Last consultation";
  const blocked = gate(input.consultations, "last_consultation", label);
  if (blocked) return blocked;
  const done = (input.consultations as { rows: readonly BriefConsultationRow[] }).rows
    .filter((c) => c.status === "completed" && canShow(classifyConsultation(c, rules), access))
    .sort((a, b) => ((a.ended_at ?? a.scheduled_at ?? "") < (b.ended_at ?? b.scheduled_at ?? "") ? 1 : -1));
  const last = done[0];
  const at = last ? (last.ended_at ?? last.scheduled_at) : null;
  if (!last || at === null) return line("last_consultation", label, `${NOT_ENOUGH}: no completed consultation to show.`, "not_enough");
  return line("last_consultation", label, `Video consultation on ${fmtDate(at)}${scopeNote(access)}.`, "ok", [{ kind: "consultation", id: last.id, at, summary: "Completed video consultation" }]);
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
    consultationLine(input, rules, access),
  ];
}

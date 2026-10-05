import type { DoseChecklistItem } from "./medications";
import type { Line } from "./home-model";
import { daysBetween, lagosLocalDate, lagosTimeToUtcMs } from "./lagos-date";
import type { SectionId } from "./sections";

/**
 * The Today list (S07): what is waiting for the patient today, built from her
 * own tasks (the patient_tasks view, mirrored on the phone) and today's dose
 * slots (already computed by lib/medications.ts, offline-capable). Pure: no
 * clock of its own, no network, no copy. The screen supplies `nowMs` and turns
 * each Line into words.
 *
 * Rules:
 * - Only what she can act on: open tasks, plus tasks done today so the list can
 *   say so. A task the care team closed, cancelled, marked missed or "unable" is
 *   not shown on Today (no shame state, and nothing here to act on).
 * - Dose slots are the one source for medicines. A stored take_medicine task is
 *   hidden so a medicine never appears twice (S08/OQ-56: slots are computed).
 *   Taken doses show as done; skipped or missed ones are simply not listed.
 * - "Overdue" is by Lagos calendar day, never by clock time. A task due today is
 *   "Due today" until the day ends; a dose slot whose time has passed says
 *   "Earlier today", not "late".
 * - A log_bp task due daily (or once) counts as done for display when a reading
 *   was logged today. A weekly or monthly one does not: one reading does not
 *   finish "three times a week". Display only; nothing is written here.
 * - Nothing is ranked by how the patient is doing, only by when it is due.
 */
export type TodayTaskKind = "log_bp" | "take_medicine" | "book_test" | "join_consultation" | "read_lesson";

export interface TodayTask {
  id: string;
  kind: string | null;
  title: string;
  priority: number | null;
  dueAt: string | null;
  recurrence: string | null;
  /** patient_tasks.state: open, done, cancelled, missed or unable. */
  state: string;
  updatedAt: string | null;
}

export type TodayStatus = "overdue" | "due" | "done";

export interface TodayItem {
  id: string;
  source: "task" | "dose";
  kind: TodayTaskKind | "other";
  /** Free text from the care team, or a translatable line when there is none. */
  title: { text: string } | { line: Line };
  due: Line;
  status: TodayStatus;
  /** Where tapping the item goes. */
  target: SectionId;
  dueAtMs: number | null;
}

export interface TodayList {
  /** Every open item, in order. */
  open: TodayItem[];
  /** The first few open items, for the card. */
  shownOpen: TodayItem[];
  /** How many open items are not shown. */
  moreCount: number;
  done: TodayItem[];
  total: number;
}

export interface TodayInput {
  nowMs: number;
  tasks: readonly TodayTask[];
  doses: readonly DoseChecklistItem[];
  bpLoggedToday: boolean;
  /** How many open items the card shows. */
  maxOpen?: number;
}

const KNOWN_KINDS: readonly TodayTaskKind[] = ["log_bp", "take_medicine", "book_test", "join_consultation", "read_lesson"];

const TARGET_FOR_KIND: Record<TodayTaskKind | "other", SectionId> = {
  log_bp: "vitals",
  take_medicine: "medications",
  book_test: "labs",
  join_consultation: "appointments",
  read_lesson: "learn",
  other: "care",
};

function asKind(kind: string | null): TodayTaskKind | "other" {
  return KNOWN_KINDS.find((k) => k === kind) ?? "other";
}

function taskDueLine(dueAtMs: number | null, today: string): { due: Line; overdue: boolean } {
  if (dueAtMs === null) return { due: { key: "today.due.anytime" }, overdue: false };
  const days = daysBetween(today, lagosLocalDate(dueAtMs));
  if (days < 0) return { due: { key: "today.due.overdue" }, overdue: true };
  if (days === 0) return { due: { key: "today.due.today" }, overdue: false };
  if (days === 1) return { due: { key: "today.due.tomorrow" }, overdue: false };
  return { due: { key: "today.due.in_days", params: { days } }, overdue: false };
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function buildTodayList(input: TodayInput): TodayList {
  const today = lagosLocalDate(input.nowMs);
  const open: TodayItem[] = [];
  const done: TodayItem[] = [];

  for (const t of input.tasks) {
    const kind = asKind(t.kind);
    if (kind === "take_medicine") continue; // dose slots are the one source for medicines
    const title = t.title.trim() ? { text: t.title.trim() } : { line: { key: `today.kind.${kind}` as Line["key"] } };
    const dueAtMs = parseMs(t.dueAt);
    const base = { id: `task:${t.id}`, source: "task" as const, kind, title, target: TARGET_FOR_KIND[kind], dueAtMs };

    const updatedMs = parseMs(t.updatedAt);
    if (t.state === "done") {
      if (updatedMs !== null && lagosLocalDate(updatedMs) === today) {
        done.push({ ...base, due: { key: "today.due.done" }, status: "done" });
      }
      continue;
    }
    if (t.state !== "open") continue;

    if (kind === "log_bp" && input.bpLoggedToday && (t.recurrence === null || t.recurrence === "daily")) {
      done.push({ ...base, due: { key: "today.due.logged" }, status: "done" });
      continue;
    }
    const { due, overdue } = taskDueLine(dueAtMs, today);
    open.push({ ...base, due, status: overdue ? "overdue" : "due" });
  }

  for (const d of input.doses) {
    if (d.status !== "pending" && d.status !== "taken") continue;
    // A stored time can carry seconds (08:00:00); only HH:MM is used.
    const time = /^\d{2}:\d{2}/.exec(d.time)?.[0] ?? d.time;
    const dueAtMs = lagosTimeToUtcMs(today, time);
    const base = {
      id: `dose:${d.medicationId}:${time}`,
      source: "dose" as const,
      kind: "take_medicine" as const,
      title: { line: { key: "today.dose" as const, params: { drug: d.drugName } } },
      target: TARGET_FOR_KIND.take_medicine,
      dueAtMs,
    };
    if (d.status === "taken") {
      done.push({ ...base, due: { key: "today.due.done" }, status: "done" });
    } else if (dueAtMs !== null && dueAtMs < input.nowMs) {
      open.push({ ...base, due: { key: "today.due.earlier", params: { time } }, status: "due" });
    } else {
      open.push({ ...base, due: { key: "today.due.at", params: { time } }, status: "due" });
    }
  }

  const rank = (i: TodayItem) => (i.status === "overdue" ? 0 : i.dueAtMs === null ? 3 : lagosLocalDate(i.dueAtMs) === today ? 1 : 2);
  const priorityOf = (i: TodayItem, tasks: readonly TodayTask[]) =>
    i.source === "task" ? (tasks.find((t) => `task:${t.id}` === i.id)?.priority ?? 2) : 2;
  open.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.dueAtMs ?? Infinity) - (b.dueAtMs ?? Infinity) ||
      priorityOf(a, input.tasks) - priorityOf(b, input.tasks) ||
      a.id.localeCompare(b.id),
  );
  done.sort((a, b) => a.id.localeCompare(b.id));

  const maxOpen = input.maxOpen ?? 5;
  return {
    open,
    shownOpen: open.slice(0, maxOpen),
    moreCount: Math.max(0, open.length - maxOpen),
    done,
    total: open.length + done.length,
  };
}

/** Rows from the patient_tasks view (or its mirror) into the model's task shape. Rows without an id or title text are dropped. */
export function toTodayTasks(
  rows: readonly {
    id?: string | null;
    kind?: string | null;
    title?: string | null;
    priority?: number | null;
    due_at?: string | null;
    recurrence?: string | null;
    state?: string | null;
    updated_at?: string | null;
  }[],
): TodayTask[] {
  const out: TodayTask[] = [];
  for (const r of rows) {
    if (!r.id || !r.state) continue;
    out.push({
      id: r.id,
      kind: r.kind ?? null,
      title: r.title ?? "",
      priority: r.priority ?? null,
      dueAt: r.due_at ?? null,
      recurrence: r.recurrence ?? null,
      state: r.state,
      updatedAt: r.updated_at ?? null,
    });
  }
  return out;
}

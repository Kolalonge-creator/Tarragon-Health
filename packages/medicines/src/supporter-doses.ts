/**
 * "Was today's dose taken" for a supporter (S08y, item 5).
 *
 * The database function `public.supporter_todays_doses` returns today's scheduled doses for a person who granted the
 * `medications` category, and nothing otherwise. This turns one row into the plain state a supporter reads. It never says
 * "missed": a dose with no record yet reads "no record yet" (the person may simply not have opened the app), which matches how
 * the person's own list reads it.
 */
export type SupporterDoseAnswer = "taken" | "delayed" | "skipped" | "not_available" | "missed" | "none";

export interface SupporterDoseRow {
  medicationId: string;
  name: string;
  /** Lagos wall clock, "HH:MM". */
  time: string;
  dueAtMs: number;
  answer: SupporterDoseAnswer;
}

export type SupporterDoseState = "taken" | "skipped" | "no_record_yet" | "not_due_yet";

export function supporterDoseState(row: SupporterDoseRow, nowMs: number): SupporterDoseState {
  if (row.answer === "taken" || row.answer === "delayed") return "taken";
  if (row.answer === "skipped" || row.answer === "not_available") return "skipped";
  return nowMs < row.dueAtMs ? "not_due_yet" : "no_record_yet";
}

export type SupporterDosesView = { status: "ok"; date: string; doses: SupporterDoseRow[] } | { status: "not_shared" } | { status: "closed" } | { status: "unreadable" };

const ANSWERS: readonly string[] = ["taken", "delayed", "skipped", "not_available", "missed", "none"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read the function's answer. Anything that is not exactly the shape we expect is "unreadable", which the screen shows as
 * "could not load", never as "nothing due today": a failed read must not look like reassurance.
 */
export function parseSupporterDoses(data: unknown): SupporterDosesView {
  if (!isRecord(data)) return { status: "unreadable" };
  if (data["status"] === "not_shared") return { status: "not_shared" };
  if (data["status"] === "closed") return { status: "closed" };
  const doses = data["doses"];
  if (data["status"] !== "ok" || typeof data["date"] !== "string" || !Array.isArray(doses)) return { status: "unreadable" };
  const out: SupporterDoseRow[] = [];
  for (const d of doses) {
    if (!isRecord(d)) return { status: "unreadable" };
    const dueAtMs = typeof d["due_at"] === "string" ? Date.parse(d["due_at"]) : NaN;
    if (
      typeof d["medication_id"] !== "string" ||
      typeof d["name"] !== "string" ||
      typeof d["time"] !== "string" ||
      Number.isNaN(dueAtMs) ||
      typeof d["answer"] !== "string" ||
      !ANSWERS.includes(d["answer"])
    ) {
      return { status: "unreadable" };
    }
    out.push({ medicationId: d["medication_id"], name: d["name"], time: d["time"], dueAtMs, answer: d["answer"] as SupporterDoseAnswer });
  }
  return { status: "ok", date: data["date"], doses: out };
}

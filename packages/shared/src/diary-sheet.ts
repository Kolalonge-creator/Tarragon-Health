import {
  confirmedRowsToReadings,
  diaryLimits,
  validateDiaryRow,
  type DiaryDraftRow,
  type DiaryLimits,
  type DiaryProblem,
} from "./diary-import";

/**
 * The paper diary sheet's own rules, with no screen in them (S07y): what is ready to save, what needs a change, what is still waiting for the person to
 * check, and what to do with the server's answer. Pure and client-safe: the web sheet, the phone sheet and their tests use it directly.
 */

export function isBlankRow(row: DiaryDraftRow): boolean {
  return row.date === "" && row.time === "" && row.systolic === "" && row.diastolic === "" && row.pulse === "" && row.glucose === "" && !row.suggested;
}

export interface SheetSummary {
  /** Rows confirmed and valid: these are what "Save" sends. */
  ready: DiaryDraftRow[];
  /** Rows with something to change, with the reasons, in the order they appear. A suggested row that is only waiting to be checked is NOT here. */
  blocked: { key: string; problems: DiaryProblem[] }[];
  /** Suggested rows the person has not checked yet. They are never saved. */
  unconfirmed: number;
  /** More rows than one save may carry. */
  tooMany: boolean;
}

export function summarise(rows: readonly DiaryDraftRow[], nowMs: number, limits: DiaryLimits = diaryLimits()): SheetSummary {
  const ready: DiaryDraftRow[] = [];
  const blocked: { key: string; problems: DiaryProblem[] }[] = [];
  let unconfirmed = 0;
  for (const row of rows) {
    if (isBlankRow(row)) continue;
    const v = validateDiaryRow(row, nowMs, limits);
    if (v.ok) {
      ready.push(row);
      continue;
    }
    const others = v.problems.filter((p) => p !== "not_confirmed");
    if (others.length > 0) blocked.push({ key: row.key, problems: others });
    // a suggested row that is complete but not checked is waiting for the person, not broken
    if (v.problems.includes("not_confirmed")) unconfirmed += 1;
  }
  return { ready, blocked, unconfirmed, tooMany: ready.length > limits.maxRows };
}

/** What a saved row's answer from the server means for the row left on screen. */
export type RowFeedback =
  | { kind: "problems"; problems: DiaryProblem[] }
  | { kind: "held" }
  | { kind: "failed" }
  | { kind: "closed" };

export interface SaveAnswer {
  status: "done";
  results: { key: string; status: "saved" | "duplicate" | "held" | "merged" | "refused" | "failed"; problems?: DiaryProblem[]; closed?: boolean }[];
  tooMany?: boolean;
}

export interface AppliedAnswer {
  /** The sheet after the save: saved rows are gone, everything else is still there to fix or retry. */
  rows: DiaryDraftRow[];
  feedback: Record<string, RowFeedback>;
  saved: number;
  /** Rows that matched a reading already in the record from a better source (a device): they leave the sheet too, and are told apart so the person knows why. */
  matched: number;
  notSaved: number;
}

/**
 * Applies the server's per-row answer. A row is removed only when the server says it is in the record ("saved", "duplicate" for a retry, or "merged" into a
 * reading already there from a better source); a held, refused or failed row stays, with the reason beside it, so nothing the person typed is lost by a failed save.
 */
export function applySaveAnswer(rows: readonly DiaryDraftRow[], sentKeys: ReadonlySet<string>, answer: SaveAnswer): AppliedAnswer {
  const feedback: Record<string, RowFeedback> = {};
  const removed = new Set<string>();
  let saved = 0;
  let matched = 0;
  let notSaved = 0;
  for (const r of answer.results) {
    if (r.status === "saved" || r.status === "duplicate") {
      removed.add(r.key);
      saved += 1;
      continue;
    }
    // The same reading is already in the record from a better source: nothing is lost, and retrying would only say so again, so the row leaves the sheet.
    if (r.status === "merged") {
      removed.add(r.key);
      matched += 1;
      continue;
    }
    notSaved += 1;
    if (r.closed) feedback[r.key] = { kind: "closed" };
    else if (r.status === "held") feedback[r.key] = { kind: "held" };
    else if (r.status === "refused" && r.problems && r.problems.length > 0) feedback[r.key] = { kind: "problems", problems: r.problems.filter((p) => p !== "not_confirmed") };
    else feedback[r.key] = { kind: "failed" };
  }
  // A row we sent that the server did not mention at all is not known to be saved: it stays, as a failure to retry.
  for (const key of sentKeys) {
    if (!removed.has(key) && !(key in feedback)) {
      feedback[key] = { kind: "failed" };
      notSaved += 1;
    }
  }
  return { rows: rows.filter((r) => !removed.has(r.key)), feedback, saved, matched, notSaved };
}

/** The same check the server runs, for the screen to say what it will do before it does it. */
export function wouldBeAccepted(rows: readonly DiaryDraftRow[], nowMs: number): number {
  return confirmedRowsToReadings(rows.filter((r) => !isBlankRow(r)), nowMs, diaryLimits()).readings.length;
}

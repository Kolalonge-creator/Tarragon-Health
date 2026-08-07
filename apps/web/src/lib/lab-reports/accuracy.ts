/**
 * Scoring an extraction against hand-keyed truth.
 *
 * WHY THIS EXISTS: everything else in this directory is testable without a
 * model — unit conversion, alias resolution, quality control, the reference
 * ranges. None of it answers the only question that matters commercially,
 * which is whether a vision model actually reads a creased photograph of a
 * Nigerian laboratory report correctly. That question can only be answered by
 * running real documents through the real engine and comparing the output
 * against values a human keyed in once. This module is the comparison.
 *
 * THE ASYMMETRY IS THE POINT. Not all failures are equal, and a single
 * accuracy percentage hides the distinction that the whole safety argument
 * rests on:
 *
 *   * a SPURIOUS reading (a value we produced that is not on the page) and a
 *     WRONG VALUE (a real analyte read incorrectly) are harmful. They put a
 *     number in front of a clinician that could be filed into a patient's
 *     permanent record. These are the numbers this engine exists to not
 *     produce.
 *   * a MISSED reading, or one correctly held back as unreadable, is merely
 *     unhelpful. The clinician still has the document and types it in, exactly
 *     as they did before this feature existed.
 *
 * So the headline number is not "accuracy". It is the harmful rate, and it
 * should be driven toward zero even at the cost of missing more.
 *
 * The `blocked` outcome deserves particular attention when reading a report:
 * it means the engine READ something for that analyte and then its own guards
 * (unknown unit, implausible value, unrecognised qualitative wording) refused
 * it. Those are the guards working. A case with many `blocked` outcomes and no
 * `wrong` ones is a good result, not a bad one.
 */

import { getAnalyte, getQualitativeAnalyte } from "./analyte-catalogue";

/** One hand-keyed truth entry. Values are in the analyte's CANONICAL unit. */
export interface ExpectedAnalyte {
  code: string;
  /** Canonical-unit numeric value, for a quantitative analyte. */
  value?: number;
  /** Coded result, for a qualitative one ("AS", "positive", "2+"). */
  valueText?: string;
  /**
   * Optionally, what the page actually printed. Not scored — recorded so a
   * failure can be diagnosed as a misread rather than a conversion bug.
   */
  printedValue?: number;
  printedUnit?: string;
}

export interface ExpectedReport {
  /** Laboratory name as printed, for grouping results by layout. */
  lab: string;
  /** Free-text description of the document: "phone photo, creased, glare". */
  notes?: string;
  reportDate?: string;
  analytes: ExpectedAnalyte[];
}

/** The subset of an extracted row this module needs. */
export interface ActualRow {
  code: string | null;
  value: number | null;
  valueText: string | null;
  status: string;
  reportedLabel: string;
}

export type Outcome =
  /** Extracted, ready to file, and matches the hand-keyed value. */
  | "correct"
  /** Extracted and ready to file, but the value is wrong. HARMFUL. */
  | "wrong"
  /** Extracted, but the engine's own guards held it back. Safe. */
  | "blocked"
  /** On the page and hand-keyed, but the engine did not produce it. Safe. */
  | "missed"
  /** Produced and ready to file, but not on the hand-keyed sheet. HARMFUL. */
  | "spurious";

export interface AnalyteScore {
  code: string;
  outcome: Outcome;
  expected: number | string | null;
  actual: number | string | null;
  /** Why, in one line, for the failure list a human reads. */
  detail?: string;
}

export interface CaseScore {
  caseId: string;
  lab: string;
  notes?: string;
  scores: AnalyteScore[];
  counts: Record<Outcome, number>;
}

/**
 * How close a numeric reading must be to count as correct.
 *
 * Half a percent, floored at one unit of the analyte's own reporting
 * precision. This tolerates the rounding that unit conversion introduces (a
 * cholesterol converted from mmol/L lands a hair off a hand-keyed mg/dL) while
 * still failing a genuinely different number — an 8 read as a 3 moves a value
 * far more than half a percent.
 */
export function matchesValue(expected: number, actual: number): boolean {
  const tolerance = Math.max(Math.abs(expected) * 0.005, 0.01);
  return Math.abs(expected - actual) <= tolerance;
}

/** Score one document's extraction against its hand-keyed truth. */
export function scoreCase(
  caseId: string,
  expected: ExpectedReport,
  actual: readonly ActualRow[],
): CaseScore {
  const scores: AnalyteScore[] = [];
  const seen = new Set<string>();

  for (const want of expected.analytes) {
    const row = actual.find((r) => r.code === want.code);
    if (row) seen.add(want.code);

    const wantValue = want.value ?? want.valueText ?? null;

    if (!row) {
      scores.push({
        code: want.code,
        outcome: "missed",
        expected: wantValue,
        actual: null,
        detail: "not read from the document at all",
      });
      continue;
    }

    if (row.status !== "ready") {
      scores.push({
        code: want.code,
        outcome: "blocked",
        expected: wantValue,
        actual: row.value ?? row.valueText,
        // Worth surfacing verbatim: this is the engine refusing its own
        // reading, and which guard fired says where to look.
        detail: `held back as "${row.status}" (read as "${row.reportedLabel}")`,
      });
      continue;
    }

    if (getQualitativeAnalyte(want.code)) {
      const ok = row.valueText === want.valueText;
      scores.push({
        code: want.code,
        outcome: ok ? "correct" : "wrong",
        expected: want.valueText ?? null,
        actual: row.valueText,
        detail: ok ? undefined : `read "${row.valueText}", should be "${want.valueText}"`,
      });
      continue;
    }

    if (want.value === undefined || row.value === null) {
      scores.push({
        code: want.code,
        outcome: "wrong",
        expected: wantValue,
        actual: row.value ?? row.valueText,
        detail: "numeric analyte with a non-numeric reading, or truth missing a value",
      });
      continue;
    }

    const ok = matchesValue(want.value, row.value);
    scores.push({
      code: want.code,
      outcome: ok ? "correct" : "wrong",
      expected: want.value,
      actual: row.value,
      detail: ok
        ? undefined
        : `read ${row.value}, should be ${want.value} ${getAnalyte(want.code)?.canonicalUnit ?? ""}`.trim(),
    });
  }

  // Anything the engine is ready to file that is NOT on the truth sheet. This
  // is the most dangerous category in the whole harness: a value nobody wrote
  // down, presented as filable.
  for (const row of actual) {
    if (!row.code || row.status !== "ready" || seen.has(row.code)) continue;
    scores.push({
      code: row.code,
      outcome: "spurious",
      expected: null,
      actual: row.value ?? row.valueText,
      detail: `not on the truth sheet (read from "${row.reportedLabel}")`,
    });
  }

  const counts: Record<Outcome, number> = {
    correct: 0, wrong: 0, blocked: 0, missed: 0, spurious: 0,
  };
  for (const s of scores) counts[s.outcome] += 1;

  return { caseId, lab: expected.lab, notes: expected.notes, scores, counts };
}

export interface CorpusReport {
  cases: CaseScore[];
  totals: Record<Outcome, number>;
  /** Of everything on the truth sheets, how much did we read correctly. */
  recall: number;
  /** Of everything we offered as filable, how much was right. */
  precision: number;
  /**
   * The headline safety number: filable readings that were wrong or invented,
   * as a share of everything offered as filable. Drive this to zero.
   */
  harmfulRate: number;
  /** Per-analyte breakdown, so effort goes where the failures actually are. */
  byAnalyte: { code: string; counts: Record<Outcome, number>; recall: number }[];
  /** Per-laboratory breakdown, which is what the template corpus is for. */
  byLab: { lab: string; counts: Record<Outcome, number>; recall: number }[];
}

function emptyCounts(): Record<Outcome, number> {
  return { correct: 0, wrong: 0, blocked: 0, missed: 0, spurious: 0 };
}

function recallOf(c: Record<Outcome, number>): number {
  const truth = c.correct + c.wrong + c.blocked + c.missed;
  return truth === 0 ? 0 : c.correct / truth;
}

/** Roll individual case scores into the report a human reads. */
export function aggregate(cases: readonly CaseScore[]): CorpusReport {
  const totals = emptyCounts();
  const byAnalyte = new Map<string, Record<Outcome, number>>();
  const byLab = new Map<string, Record<Outcome, number>>();

  for (const c of cases) {
    for (const s of c.scores) {
      totals[s.outcome] += 1;

      const a = byAnalyte.get(s.code) ?? emptyCounts();
      a[s.outcome] += 1;
      byAnalyte.set(s.code, a);

      const l = byLab.get(c.lab) ?? emptyCounts();
      l[s.outcome] += 1;
      byLab.set(c.lab, l);
    }
  }

  const offered = totals.correct + totals.wrong + totals.spurious;
  return {
    cases: [...cases],
    totals,
    recall: recallOf(totals),
    precision: offered === 0 ? 0 : totals.correct / offered,
    harmfulRate: offered === 0 ? 0 : (totals.wrong + totals.spurious) / offered,
    byAnalyte: [...byAnalyte.entries()]
      .map(([code, counts]) => ({ code, counts, recall: recallOf(counts) }))
      .sort((x, y) => x.recall - y.recall),
    byLab: [...byLab.entries()]
      .map(([lab, counts]) => ({ lab, counts, recall: recallOf(counts) }))
      .sort((x, y) => x.recall - y.recall),
  };
}

/** Render the report as plain text for a terminal or a CI log. */
export function formatReport(report: CorpusReport): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const t = report.totals;
  const lines: string[] = [];

  lines.push("LAB REPORT EXTRACTION — ACCURACY");
  lines.push("=".repeat(64));
  lines.push(`cases            ${report.cases.length}`);
  lines.push(`readings on page ${t.correct + t.wrong + t.blocked + t.missed}`);
  lines.push("");
  lines.push(`correct          ${t.correct}`);
  lines.push(`wrong            ${t.wrong}      <- harmful`);
  lines.push(`spurious         ${t.spurious}      <- harmful`);
  lines.push(`held back        ${t.blocked}      (guards fired; safe)`);
  lines.push(`missed           ${t.missed}      (safe)`);
  lines.push("");
  lines.push(`recall           ${pct(report.recall)}`);
  lines.push(`precision        ${pct(report.precision)}`);
  lines.push(`HARMFUL RATE     ${pct(report.harmfulRate)}   <- the number that matters`);

  if (report.byAnalyte.length > 0) {
    lines.push("");
    lines.push("Weakest analytes");
    lines.push("-".repeat(64));
    for (const a of report.byAnalyte.slice(0, 12)) {
      const c = a.counts;
      lines.push(
        `  ${a.code.padEnd(28)} recall ${pct(a.recall).padStart(6)}  ` +
          `ok ${c.correct} wrong ${c.wrong} held ${c.blocked} missed ${c.missed} spurious ${c.spurious}`,
      );
    }
  }

  if (report.byLab.length > 0) {
    lines.push("");
    lines.push("By laboratory");
    lines.push("-".repeat(64));
    for (const l of report.byLab) {
      lines.push(`  ${l.lab.padEnd(28)} recall ${pct(l.recall).padStart(6)}  wrong ${l.counts.wrong} spurious ${l.counts.spurious}`);
    }
  }

  const failures = report.cases.flatMap((c) =>
    c.scores
      .filter((s) => s.outcome === "wrong" || s.outcome === "spurious")
      .map((s) => `  [${c.caseId}] ${s.code}: ${s.detail ?? s.outcome}`),
  );
  if (failures.length > 0) {
    lines.push("");
    lines.push("Harmful readings — fix these first");
    lines.push("-".repeat(64));
    lines.push(...failures);
  }

  return lines.join("\n");
}

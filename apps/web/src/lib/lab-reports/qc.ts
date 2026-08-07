/**
 * Quality control over a machine reading of a lab report.
 *
 * A vision model reading a creased photo does not fail loudly. It fails by
 * returning a confident, well-formed, wrong number — a decimal point moved, a
 * reference range read as a result, a digit taken from the row above. Those are
 * the failures that matter, because a wrong number that looks right is the one
 * that reaches a trend chart and stays there.
 *
 * The catalogue already refuses an unknown unit and an implausible value. This
 * module adds the two checks that catch what those cannot:
 *
 *   1. THE LAB'S OWN PRINTED RANGE. Every report prints a reference interval
 *      next to the result. `extract.ts` transcribes it verbatim. If the value
 *      sits nowhere near the range the laboratory itself printed, either the
 *      value or the unit was misread. This is the most useful check available
 *      on a Nigerian report precisely because it needs no prior knowledge of
 *      the lab: the document carries its own answer key.
 *
 *   2. INTERNAL CONSISTENCY. An FBC is not seven independent numbers. PCV runs
 *      at about three times the haemoglobin, the differential sums to a
 *      hundred, direct bilirubin cannot exceed total, and a lipid panel obeys
 *      Friedewald. Each catches single-digit OCR errors that pass every
 *      per-row check, because each is only wrong in combination.
 *
 * Everything here is deterministic and pure, so the whole layer is testable
 * without a model, a network call, or a database. Nothing here drops a row —
 * dropping is the catalogue's job. These flags travel with the row to the
 * clinician's review screen, which is the only place a judgement is made.
 */

export interface QcFlag {
  /** Stable machine key, so the corpus can count flag types over time. */
  key:
    | "unit_mismatch_suspected"
    | "outside_printed_range"
    | "printed_range_unexpected"
    | "low_confidence"
    | "inconsistent_pcv_haemoglobin"
    | "inconsistent_differential"
    | "inconsistent_bilirubin"
    | "inconsistent_lipid_panel";
  message: string;
}

export interface ParsedRange {
  min: number | null;
  max: number | null;
}

/**
 * Pull numeric bounds out of a printed reference interval.
 *
 * Handles the forms Nigerian reports actually use: "70 - 110", "70–110" with an
 * en dash, "3.5 to 5.1", "< 200", "up to 40", "> 40", "0.5-1.2 mg/dL".
 * Returns nulls rather than guessing when the text is not a range at all
 * ("Negative", "Nil", "See comment"), and refuses a bare single number, which
 * is genuinely ambiguous about which side it bounds.
 */
export function parsePrintedRange(raw: string | null | undefined): ParsedRange {
  if (!raw) return { min: null, max: null };
  const text = raw.replace(/[–—]/g, "-").toLowerCase();

  // A "-" is a MINUS SIGN only when it does not follow a digit. In "70-110" and
  // "0.5-1.2" it is a separator, and reading it as a sign turns a perfectly
  // ordinary range into {min: -110, max: 70} — which then silently disables the
  // whole printed-range cross-check for every report that omits the spaces.
  const numbers = text.match(/(?<![\d.])-?\d+(?:\.\d+)?/g);
  if (!numbers) return { min: null, max: null };
  const values = numbers.map(Number).filter((n) => Number.isFinite(n));
  if (values.length === 0) return { min: null, max: null };

  const upperOnly = /(<|<=|less than|below|up to|max|upto)/.test(text);
  const lowerOnly = /(>|>=|greater than|above|over|at least|min)/.test(text);

  if (values.length === 1) {
    if (upperOnly) return { min: null, max: values[0]! };
    if (lowerOnly) return { min: values[0]!, max: null };
    return { min: null, max: null };
  }

  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0]!, max: sorted[sorted.length - 1]! };
}

/**
 * How far outside the laboratory's own printed range a value may sit before the
 * reading is suspected of a transcription error rather than of being a
 * genuinely extreme result.
 *
 * Generous on purpose. Real patients produce results many times the upper
 * limit: an ALT of 2,000 in acute hepatitis, a triglyceride of 3,000, a PSA of
 * 500 in metastatic disease. What this catches is the order-of-magnitude break
 * a unit misread produces — a cholesterol printed in mmol/L (5.2) recorded
 * against a printed range of 0-200, or the reverse.
 */
const RANGE_TOLERANCE = 8;

export interface RangeCheckInput {
  /** The value in canonical units, after conversion. */
  value: number;
  /** The reference interval as printed, verbatim. */
  reportedRange: string | null;
  /**
   * The same range converted into canonical units. The caller supplies this
   * because conversion needs the catalogue and the row's reported unit, both of
   * which it already has.
   */
  canonicalRange: ParsedRange;
  /** The analyte's plausible band, for the wrong-row check. */
  plausible: { min: number; max: number };
  label: string;
}

/**
 * Compare a value against the range the laboratory printed beside it.
 *
 * Note the deliberate asymmetry between the two findings this can produce.
 * `unit_mismatch_suspected` says WE are probably wrong. `outside_printed_range`
 * says the LAB considered this result abnormal — which is not an error at all,
 * and is surfaced because it is exactly what the reviewing clinician wants to
 * see first.
 */
export function checkAgainstPrintedRange(input: RangeCheckInput): QcFlag[] {
  const { value, reportedRange, canonicalRange, plausible, label } = input;
  const flags: QcFlag[] = [];
  const { min, max } = canonicalRange;
  if (min === null && max === null) return flags;

  const wayBelow = min !== null && min > 0 && value < min / RANGE_TOLERANCE;
  const wayAbove = max !== null && max > 0 && value > max * RANGE_TOLERANCE;

  if (wayBelow || wayAbove) {
    flags.push({
      key: "unit_mismatch_suspected",
      message: `${value} is far outside the range this lab printed beside it (${reportedRange}). The unit or the value may have been misread.`,
    });
  } else if ((min !== null && value < min) || (max !== null && value > max)) {
    flags.push({
      key: "outside_printed_range",
      message: `Outside the range this lab printed (${reportedRange}).`,
    });
  }

  // Does the printed range even belong to this analyte? A range picked up from
  // an adjacent row is a common misread on a dense FBC table.
  if ((max !== null && max > plausible.max) || (min !== null && min < plausible.min && min !== 0)) {
    flags.push({
      key: "printed_range_unexpected",
      message: `The range read beside ${label} (${reportedRange}) does not look like a ${label} range, and may have come from a neighbouring row.`,
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Cross-row consistency
// ---------------------------------------------------------------------------

/** The minimum a consistency check needs to know about a row. */
export interface ConsistencyRow {
  code: string | null;
  value: number | null;
  status: string;
  flags: QcFlag[];
}

function add(rows: ConsistencyRow[], code: string, flag: QcFlag): void {
  const target = rows.find((r) => r.code === code);
  if (target && !target.flags.some((f) => f.key === flag.key)) target.flags.push(flag);
}

/** Relative difference, guarding a zero divisor. */
function relDiff(a: number, b: number): number {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? 0 : Math.abs(a - b) / scale;
}

/**
 * Apply every cross-row check, attaching flags in place.
 *
 * Only rows that converted cleanly take part: an implausible or unmapped row
 * has no trustworthy number to reason about, and including one would produce a
 * consistency warning about a value we have already rejected.
 */
export function checkConsistency(rows: ConsistencyRow[]): void {
  const ready = rows.filter((r) => r.status === "ready" && r.value !== null);
  const valueOf = (code: string): number | null =>
    ready.find((r) => r.code === code)?.value ?? null;

  // PCV runs at roughly three times the haemoglobin. On an FBC table the two
  // sit adjacent and get swapped or misaligned.
  const hb = valueOf("haemoglobin");
  const pcv = valueOf("haematocrit");
  if (hb !== null && pcv !== null && hb > 0) {
    const ratio = pcv / hb;
    if (ratio < 2.2 || ratio > 3.8) {
      const flag: QcFlag = {
        key: "inconsistent_pcv_haemoglobin",
        message: `Haemoglobin ${hb} g/dL and PCV ${pcv}% do not agree — PCV normally runs at about three times the haemoglobin. One of the two is likely misread.`,
      };
      add(rows, "haemoglobin", flag);
      add(rows, "haematocrit", flag);
    }
  }

  // A white cell differential sums to 100%.
  const diffCodes = ["neutrophils_pct", "lymphocytes_pct", "eosinophils_pct", "monocytes_pct"];
  const present = diffCodes.filter((c) => valueOf(c) !== null);
  if (present.length >= 3) {
    const total = present.reduce((sum, c) => sum + (valueOf(c) ?? 0), 0);
    // Basophils are routinely omitted, so allow the sum to fall a little short
    // when not all four are present.
    if (total > 105 || (present.length === 4 && total < 90)) {
      const flag: QcFlag = {
        key: "inconsistent_differential",
        message: `The white cell differential adds up to ${Math.round(total)}%, which it should not. At least one percentage is misread.`,
      };
      for (const c of present) add(rows, c, flag);
    }
  }

  // Direct bilirubin is a fraction of total and cannot exceed it.
  const tbil = valueOf("total_bilirubin");
  const dbil = valueOf("direct_bilirubin");
  if (tbil !== null && dbil !== null && dbil > tbil * 1.05) {
    const flag: QcFlag = {
      key: "inconsistent_bilirubin",
      message: `Direct bilirubin (${dbil}) reads higher than total (${tbil}), which is not possible. The two are likely swapped.`,
    };
    add(rows, "total_bilirubin", flag);
    add(rows, "direct_bilirubin", flag);
  }

  // Friedewald: total cholesterol is approximately LDL + HDL + triglycerides/5.
  // The estimate only holds below a triglyceride of 400.
  const tc = valueOf("total_cholesterol");
  const ldl = valueOf("ldl_cholesterol");
  const hdl = valueOf("hdl_cholesterol");
  const tg = valueOf("triglycerides");
  if (tc !== null && ldl !== null && hdl !== null && tg !== null && tg < 400) {
    const implied = ldl + hdl + tg / 5;
    if (relDiff(implied, tc) > 0.2) {
      const flag: QcFlag = {
        key: "inconsistent_lipid_panel",
        message: `The lipid panel does not add up: LDL ${ldl} + HDL ${hdl} + triglycerides/5 comes to about ${Math.round(implied)}, against a printed total of ${tc}. One of the four is misread.`,
      };
      for (const c of ["total_cholesterol", "ldl_cholesterol", "hdl_cholesterol", "triglycerides"]) {
        add(rows, c, flag);
      }
    }
  }
}

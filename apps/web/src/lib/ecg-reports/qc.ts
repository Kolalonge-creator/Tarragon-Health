/**
 * Quality control over a machine reading of a 12-lead ECG's printed
 * parameter block. Mirrors lib/lab-reports/qc.ts's role and discipline:
 * everything here is deterministic and pure, catches the failure mode a
 * vision model doesn't fail loudly at (a confident, well-formed, WRONG
 * number — a digit transposed, ms read as seconds), and never drops or
 * reclassifies a value. Flags travel with the row to the clinician's review
 * screen, which is the only place a judgement is made.
 *
 * An ECG printout has no per-parameter "reference range" the way a lab
 * report does (a cart prints "QTc 428ms", not "QTc 428ms, normal 350-450"),
 * so the lab module's printed-range cross-check has no direct analogue here.
 * What DOES exist, and is exactly as strong a signal: the parameters are not
 * independent numbers. QT physically contains QRS, so QT can never be
 * shorter than QRS on a genuine reading. And QTc is not a separately measured
 * quantity — every cart derives it from QT and heart rate by a published
 * formula (Bazett, near-universal on stock 12-lead output), so a printed QTc
 * that doesn't match what Bazett's formula predicts from the printed QT and
 * heart rate means at least one of the three was misread.
 *
 * NEITHER CHECK IS A CLINICAL JUDGEMENT. "QTc looks internally inconsistent"
 * is not "QTc is prolonged" — the first is this module's job, the second is
 * never this module's (or this platform's) job at all.
 */

export interface QcFlag {
  key:
    | "low_confidence"
    | "qt_shorter_than_qrs"
    | "qtc_bazett_mismatch"
    | "not_twelve_lead_suspected";
  message: string;
}

/**
 * QT must be at least as long as QRS — the QRS complex is physically the
 * first part of the QT interval. A reading where QT < QRS means one of the
 * two was misread (most often ms vs. a truncated digit).
 */
export function checkQtNotShorterThanQrs(
  qtMs: number | null,
  qrsMs: number | null,
): QcFlag[] {
  if (qtMs === null || qrsMs === null) return [];
  if (qtMs < qrsMs) {
    return [
      {
        key: "qt_shorter_than_qrs",
        message: `Printed QT (${qtMs}ms) is shorter than printed QRS duration (${qrsMs}ms), which isn't physically possible — one of the two was likely misread.`,
      },
    ];
  }
  return [];
}

/**
 * How far the printed QTc may differ from the Bazett-recomputed value before
 * it's flagged as a likely misread rather than just rounding/formula-variant
 * noise (some carts compute Fridericia or Framingham instead of Bazett, which
 * diverge from Bazett by a few percent at heart rates away from 60bpm — the
 * tolerance is generous enough to absorb that and only catch genuine
 * transcription errors).
 */
const QTC_TOLERANCE_MS = 40;

/**
 * Recompute QTc via Bazett's formula (QTc = QT / sqrt(RR), RR in seconds =
 * 60 / heart rate) and compare against the printed QTc.
 */
export function checkQtcBazettConsistency(
  qtMs: number | null,
  heartRateBpm: number | null,
  printedQtcMs: number | null,
): QcFlag[] {
  if (qtMs === null || heartRateBpm === null || printedQtcMs === null) return [];
  if (heartRateBpm <= 0) return [];

  const rrSeconds = 60 / heartRateBpm;
  const bazettQtc = qtMs / Math.sqrt(rrSeconds);
  const diff = Math.abs(bazettQtc - printedQtcMs);

  if (diff > QTC_TOLERANCE_MS) {
    return [
      {
        key: "qtc_bazett_mismatch",
        message: `Printed QTc (${printedQtcMs}ms) doesn't match ${Math.round(bazettQtc)}ms, the Bazett-formula value expected from the printed QT (${qtMs}ms) and heart rate (${heartRateBpm}bpm). Check the QT, QTc, and heart rate against the tracing.`,
      },
    ];
  }
  return [];
}

/**
 * A genuine 12-lead printout's header always names at least a few of the
 * standard 12 leads (I, II, III, aVR, aVL, aVF, V1-V6). A document with none
 * of them mentioned anywhere the model looked is more likely a single-lead
 * strip (a Watch, KardiaMobile) than a 12-lead report — surfaced as a flag
 * for the reviewer, same "never silently extracted anyway" treatment as
 * unreadable_reason. This is a plausibility signal, not a guarantee in
 * either direction — see extract.ts's system prompt for how the model is
 * asked to judge it.
 */
export function checkLooksTwelveLead(leadsMentioned: boolean): QcFlag[] {
  if (leadsMentioned) return [];
  return [
    {
      key: "not_twelve_lead_suspected",
      message:
        "This document doesn't clearly show a 12-lead layout (leads I, II, III, aVR, aVL, aVF, V1-V6). Confirm it's a genuine 12-lead ECG before filing these parameters.",
    },
  ];
}

/**
 * The canonical ECG parameter catalogue — the vocabulary for
 * lib/ecg-reports/extract.ts, mirroring lib/lab-reports/analyte-catalogue.ts.
 *
 * WHY THIS EXISTS: virtually every 12-lead ECG cart computes and prints a
 * parameter block at the top of its output (heart rate, PR/QRS/QT/QTc,
 * cardiac axis), but every brand labels it slightly differently — "HR" vs
 * "Vent. Rate", "QTc" vs "QTcB". This catalogue resolves whatever the
 * printout calls it back to ONE stable code, the same "answer key on the
 * page itself" discipline the lab catalogue uses.
 *
 * NOT IN THIS FILE, DELIBERATELY: any clinical threshold ("QTc > 470ms is
 * prolonged"), any rhythm/diagnostic classification, and any notion of
 * "abnormal". `plausible` below is a MISREAD guard only — a value outside it
 * is more likely a transcription error than a real physiological reading —
 * never a clinical judgement. That stays entirely the reviewing clinician's
 * call, exactly like the lab catalogue's own refLow/refHigh fields are
 * "orientation only... never used to classify a result."
 *
 * ONE DELIBERATE NON-NUMERIC EXCEPTION: 'machine_rhythm_statement'. Many carts
 * also print their own rhythm line ("Normal sinus rhythm", "Sinus
 * tachycardia"). That is the machine's own output, not this platform's or an
 * AI's — extract.ts transcribes it verbatim, exactly like the lab pipeline
 * transcribes a qualitative result ("+ve", "Non-reactive") without judging
 * it, and every UI surface that renders it must label it "as printed by the
 * ECG machine" so it is never mistaken for a Tarragon- or clinician-authored
 * read. See ecg_parameter_readings' migration comment for the same rule at
 * the schema layer.
 */

export type EcgParameterGroup = "rate" | "interval" | "axis" | "machine_statement";

export interface EcgParameterDefinition {
  /** Stable code written to ecg_parameter_readings.code. Never rename. */
  code: string;
  label: string;
  group: EcgParameterGroup;
  /** The unit every stored numeric row uses for this code. Null for the one text-only code. */
  canonicalUnit: string | null;
  /**
   * Other units a cart may print, with the factor to multiply by to reach
   * canonicalUnit. Keys are lower-cased before lookup (normaliseUnit).
   */
  unitConversions?: Record<string, number>;
  /** Names/abbreviations seen on real 12-lead printouts. Matched case-insensitively. */
  aliases: string[];
  /** A plausible-value guard — see file header. Null for the text-only code. */
  plausible: [number, number] | null;
}

export const ECG_PARAMETER_CATALOGUE: readonly EcgParameterDefinition[] = [
  {
    code: "heart_rate",
    label: "Heart rate",
    group: "rate",
    canonicalUnit: "bpm",
    aliases: ["hr", "heart rate", "vent rate", "ventricular rate", "vent. rate", "rate"],
    plausible: [20, 300],
  },
  {
    code: "pr_interval",
    label: "PR interval",
    group: "interval",
    canonicalUnit: "ms",
    unitConversions: { s: 1000, sec: 1000, secs: 1000 },
    aliases: ["pr", "pr int", "pr interval", "p-r interval"],
    plausible: [50, 400],
  },
  {
    code: "qrs_duration",
    label: "QRS duration",
    group: "interval",
    canonicalUnit: "ms",
    unitConversions: { s: 1000, sec: 1000, secs: 1000 },
    aliases: ["qrs", "qrs dur", "qrs duration", "qrsd"],
    plausible: [40, 250],
  },
  {
    code: "qt_interval",
    label: "QT interval",
    group: "interval",
    canonicalUnit: "ms",
    unitConversions: { s: 1000, sec: 1000, secs: 1000 },
    // "qtc" is deliberately NOT an alias here — it is its own code below, and
    // resolveParameterCode prefers an exact/whole-word match so "QT" and
    // "QTc" never collide.
    aliases: ["qt", "qt int", "qt interval"],
    plausible: [200, 700],
  },
  {
    code: "qtc_interval",
    label: "QTc (corrected QT)",
    group: "interval",
    canonicalUnit: "ms",
    unitConversions: { s: 1000, sec: 1000, secs: 1000 },
    aliases: ["qtc", "qtcb", "qtc int", "qtc interval", "qtc bazett", "qtc (bazett)", "corrected qt"],
    plausible: [200, 700],
  },
  {
    code: "qrs_axis",
    label: "Cardiac (QRS) axis",
    group: "axis",
    canonicalUnit: "deg",
    aliases: ["axis", "qrs axis", "mean qrs axis", "frontal axis"],
    plausible: [-180, 180],
  },
  {
    code: "machine_rhythm_statement",
    label: "Machine rhythm statement (as printed by the ECG machine)",
    group: "machine_statement",
    canonicalUnit: null,
    aliases: ["rhythm", "interpretation", "machine interpretation", "computer interpretation"],
    plausible: null,
  },
] as const;

const BY_CODE = new Map(ECG_PARAMETER_CATALOGUE.map((p) => [p.code, p]));

export function getEcgParameter(code: string): EcgParameterDefinition | undefined {
  return BY_CODE.get(code);
}

export function isKnownEcgParameterCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** Lower-case, strip punctuation, collapse whitespace. */
function normaliseLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[._():/\\,;*#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Lower-case and strip spaces/dots so "S" and "s." both match. */
export function normaliseUnit(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toLowerCase().replace(/[.\s]+/g, "");
}

const ALIAS_INDEX: { alias: string; code: string }[] = ECG_PARAMETER_CATALOGUE.flatMap((p) =>
  p.aliases.map((alias) => ({ alias: normaliseLabel(alias), code: p.code })),
)
  // Longest alias first, so "qtc interval" is checked before "qt" and a "QTc"
  // row can never be mis-resolved to the "qt_interval" code.
  .sort((a, b) => b.alias.length - a.alias.length);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve a printed row label ("Vent. Rate", "QTc (Bazett)") to a catalogue
 * code, or null if nothing matches. Deliberately simpler than the lab
 * catalogue's resolver (no compact-label fallback) — the ECG vocabulary is a
 * handful of codes with well-known, non-overlapping aliases, so exact and
 * whole-word matching alone is enough and easier to verify by inspection.
 */
export function resolveParameterCode(reportedLabel: string): string | null {
  const label = normaliseLabel(reportedLabel);
  if (!label) return null;

  for (const entry of ALIAS_INDEX) {
    if (entry.alias === label) return entry.code;
  }
  for (const entry of ALIAS_INDEX) {
    const pattern = new RegExp(`(^|\\s)${escapeRegExp(entry.alias)}($|\\s)`);
    if (pattern.test(label)) return entry.code;
  }
  return null;
}

export type UnitConversion =
  | { ok: true; value: number; converted: boolean }
  | { ok: false; reason: "unknown_unit" };

/** Convert a printed numeric value to the parameter's canonical unit. */
export function convertToCanonical(
  code: string,
  value: number,
  reportedUnit: string | null | undefined,
): UnitConversion {
  const param = getEcgParameter(code);
  if (!param || !param.canonicalUnit) return { ok: false, reason: "unknown_unit" };

  const unit = normaliseUnit(reportedUnit);
  const canonical = normaliseUnit(param.canonicalUnit);

  if (!unit || unit === canonical) {
    return { ok: true, value, converted: false };
  }

  const factor = param.unitConversions?.[unit];
  if (factor === undefined) {
    // An unrecognised unit on a rate/axis parameter (which take no
    // conversions at all) always falls here — deliberately refused rather
    // than assumed to already be canonical.
    return { ok: false, reason: "unknown_unit" };
  }
  return { ok: true, value: value * factor, converted: true };
}

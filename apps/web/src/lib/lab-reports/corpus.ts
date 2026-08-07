import { createHash } from "crypto";

/**
 * The template corpus — the part of this engine that compounds.
 *
 * A prompt can be copied in an afternoon. What cannot be copied is a record of
 * how several hundred real Nigerian laboratories actually lay out a report:
 * that Synlab prints its reference interval in a third column, that a
 * particular hospital lab writes "PCV" where another writes "Packed Cell Vol",
 * that one analyser reports white cells per microlitre and another in 10^9/L.
 * Every upload a clinician confirms or corrects tells us one of those things.
 *
 * This module owns the identity half: deciding which laboratory and which
 * layout a document came from, so that what is learned about it can be
 * attached to something stable. Persistence lives in the migration
 * (lab_report_templates, lab_extraction_corrections) and the write path lives
 * in extraction-actions.ts.
 *
 * PRIVACY IS A DESIGN CONSTRAINT, NOT A DISCLAIMER.
 * lab_report_templates is deliberately organisation-less so the corpus can
 * compound across every upload on the platform — the same status as
 * public.screen_types and public.lab_providers. That is only defensible
 * because a row there cannot identify a person, so nothing in this module may
 * ever put a value, a date, a name or a document id into a fingerprint. The
 * fingerprint is built from ROW LABELS only — the words a laboratory prints on
 * its own stationery, which are identical for every patient it serves.
 */

/**
 * Fold a printed laboratory name into a stable matching key.
 *
 * Strips the corporate boilerplate that varies between a lab's letterhead, its
 * report footer and its stamp ("Synlab Nigeria Limited", "SYNLAB DIAGNOSTICS",
 * "Synlab") so all three land on the same key.
 */
export function labNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(
      /\b(laboratory|laboratories|labs?|diagnostics?|diagnostic|medical|services?|centre|center|hospital|clinic|nigeria|nigerian|nig|limited|ltd|plc|company|co)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  return key.length >= 2 ? key : null;
}

/**
 * A stable signature for a report's layout.
 *
 * Built from the set of row labels the model read, folded and sorted. Two
 * reports printed on the same laboratory's stationery for the same panel
 * collide here, which is what lets per-layout hints accumulate. Sorting means
 * the order rows were read in does not matter; folding means a stray comma or
 * a case change does not fork the template.
 *
 * Returns null when there is too little to go on — a fingerprint built from one
 * row would collide with every other single-row report and teach us nothing.
 */
export function layoutFingerprint(
  labKey: string | null,
  reportedLabels: readonly (string | null | undefined)[],
): string | null {
  const labels = Array.from(
    new Set(
      reportedLabels
        .map((l) =>
          (l ?? "")
            .toLowerCase()
            .replace(/[^a-z0-9\s]+/g, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter((l) => l.length > 1),
    ),
  ).sort();

  if (labels.length < 2) return null;

  const signature = `${labKey ?? "unknown"}|${labels.join("|")}`;
  return createHash("sha256").update(signature).digest("hex").slice(0, 32);
}

/**
 * Hints learned about a layout, fed back into the prompt on the next document
 * from the same stationery.
 *
 * Stored as jsonb on lab_report_templates.hints. Kept deliberately small and
 * declarative: a hint tells the model what this lab CALLS things and what units
 * it prints, never what values to expect. A hint that suggested an expected
 * value would be a way for the corpus to talk the model into a wrong reading.
 */
export interface TemplateHints {
  /** Row label as printed → catalogue code, confirmed by a clinician. */
  labelAliases?: Record<string, string>;
  /** Catalogue code → the unit this lab prints it in. */
  unitDefaults?: Record<string, string>;
  /** Free-text layout observations, e.g. "reference range is the third column". */
  notes?: string[];
}

/**
 * Render learned hints as a prompt fragment.
 *
 * Returns an empty string when there is nothing worth saying, so the prompt is
 * unchanged for a laboratory we have not seen before — which is the common case
 * early on, and must stay the well-tested path.
 */
export function hintsPromptBlock(hints: TemplateHints | null | undefined): string {
  if (!hints) return "";
  const parts: string[] = [];

  const aliases = Object.entries(hints.labelAliases ?? {}).slice(0, 40);
  if (aliases.length > 0) {
    parts.push(
      "Row labels previously confirmed on this laboratory's reports:",
      ...aliases.map(([label, code]) => `  "${label}" is ${code}`),
    );
  }

  const units = Object.entries(hints.unitDefaults ?? {}).slice(0, 40);
  if (units.length > 0) {
    parts.push(
      "Units this laboratory usually prints (still copy what is actually on the page):",
      ...units.map(([code, unit]) => `  ${code} in ${unit}`),
    );
  }

  const notes = (hints.notes ?? []).slice(0, 10);
  if (notes.length > 0) {
    parts.push("Layout notes for this report:", ...notes.map((n) => `  ${n}`));
  }

  if (parts.length === 0) return "";
  return [
    "",
    "What we have learned from previous reports on this laboratory's stationery.",
    "Treat this as orientation only. If the page disagrees with anything below, the page wins.",
    ...parts,
  ].join("\n");
}

/**
 * Build the hint updates a confirmation teaches us.
 *
 * Only CONFIRMED rows contribute, and only their label-to-code mapping and
 * printed unit — never a value. A row the clinician corrected still teaches the
 * label mapping (the model found the right row and misread the number), which
 * is why correction and acceptance both feed this.
 */
export function hintsFromConfirmedRows(
  rows: readonly {
    reportedLabel: string;
    code: string | null;
    unit: string | null;
    status: string;
  }[],
): TemplateHints {
  const labelAliases: Record<string, string> = {};
  const unitDefaults: Record<string, string> = {};

  for (const row of rows) {
    if (!row.code || row.status !== "ready") continue;
    const label = row.reportedLabel.trim();
    if (label.length > 1 && label.length <= 80) labelAliases[label] = row.code;
    const unit = row.unit?.trim();
    if (unit && unit.length <= 20) unitDefaults[row.code] = unit;
  }

  return { labelAliases, unitDefaults };
}

/** Merge freshly learned hints over stored ones, newest winning. */
export function mergeHints(
  stored: TemplateHints | null | undefined,
  learned: TemplateHints,
): TemplateHints {
  return {
    labelAliases: { ...(stored?.labelAliases ?? {}), ...(learned.labelAliases ?? {}) },
    unitDefaults: { ...(stored?.unitDefaults ?? {}), ...(learned.unitDefaults ?? {}) },
    notes: stored?.notes ?? [],
  };
}

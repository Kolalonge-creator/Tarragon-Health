/**
 * Where a blood pressure (or diary) reading was taken, as a LABEL on the ordinary reading (S07y). Pure and deterministic: no model, no clock, no network.
 *
 * `vitals_readings.entry_origin` is null for an ordinary reading. The two labels:
 *  - `pharmacy_machine`: taken at a pharmacy or clinic machine. A real cuff reading, shown and triaged like any other, but NOT a home reading: it is left out
 *    of the 7-day home average, the home-check protocol and the white-coat / masked comparison (docs/design/S07y-reading-labels-and-diary.md, OQ-S07YL-1 and 2).
 *  - `paper_diary`: copied from the person's own handwritten diary and confirmed by them. Shown and triaged like any other; never part of the signed 7-day
 *    protocol (OQ-S07YL-3).
 *
 * Both labels ride on `source = 'manual'`, so every safety trigger that keys on source still fires. This file is the TypeScript twin of the database rule
 * (private.hbpm_average, private.bp_window_stats, private.home_bp_assess) for code that computes an average itself, as `bp-estimate.ts` is for estimates.
 */
import { isEstimateBpSource } from "./bp-estimate";

export const ENTRY_ORIGINS = ["pharmacy_machine", "paper_diary"] as const;
export type EntryOrigin = (typeof ENTRY_ORIGINS)[number];

/** Longest place the person may name (the database check says 80). */
export const PLACE_LABEL_MAX = 80;

export function isEntryOrigin(value: unknown): value is EntryOrigin {
  return typeof value === "string" && (ENTRY_ORIGINS as readonly string[]).includes(value);
}

/**
 * The place the person typed, made safe to store: control characters removed, runs of space collapsed, at most PLACE_LABEL_MAX characters, and null when
 * nothing is left (the database refuses a blank place). It is a label for the person's own memory and is never used for any decision.
 */
export function cleanPlaceLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, PLACE_LABEL_MAX).trim();
  return cleaned === "" ? null : cleaned;
}

/** True when this blood pressure reading may feed a HOME average: not a wearable estimate and not taken at a pharmacy or clinic machine. */
export function isHomeBpReading(reading: { source?: string | null; entry_origin?: string | null; entryOrigin?: string | null }): boolean {
  if (isEstimateBpSource(reading.source)) return false;
  const origin = reading.entry_origin ?? reading.entryOrigin ?? null;
  return origin !== "pharmacy_machine";
}

/** Keeps the readings that may feed a home average. Order and the other fields are untouched. */
export function homeBpReadings<T extends { source?: string | null; entry_origin?: string | null; entryOrigin?: string | null }>(readings: readonly T[]): T[] {
  return readings.filter(isHomeBpReading);
}

/** The i18n key of the label shown beside a labelled reading, or null for an ordinary one (the words live in packages/i18n, never here). */
export function entryOriginLabelKey(origin: string | null | undefined): "reading.origin.pharmacy_machine" | "reading.origin.paper_diary" | null {
  if (origin === "pharmacy_machine") return "reading.origin.pharmacy_machine";
  if (origin === "paper_diary") return "reading.origin.paper_diary";
  return null;
}

/**
 * A labelled reading as an ordinary one. Used ONLY when the label's guard turned out to be closed at the moment of saving (a stale page, or a queued reading
 * that outlived the switch): the reading is still saved and triaged, because a dangerous value must never be lost to a go-live switch, and the setting is kept
 * in the note so the care team can still see it. With the guard off the system therefore behaves exactly as it did before the label existed. The note stays
 * within 500 characters.
 */
export function withoutPharmacyLabel<T extends { entry_origin?: string | null; place_label?: string | null; note?: string | null }>(
  row: T,
  notePrefix: string,
): Omit<T, "entry_origin" | "place_label" | "note"> & { entry_origin?: undefined; place_label?: undefined; note: string } {
  const place = cleanPlaceLabel(row.place_label);
  const lead = place ? `${notePrefix} (${place})` : notePrefix;
  const note = (row.note ? `${lead} ${row.note}` : lead).slice(0, 500);
  const { entry_origin: _origin, place_label: _place, note: _note, ...rest } = row;
  void _origin;
  void _place;
  void _note;
  return { ...rest, note } as Omit<T, "entry_origin" | "place_label" | "note"> & { entry_origin?: undefined; place_label?: undefined; note: string };
}

/**
 * True when a database error is the label guard's own refusal (the stamp trigger raises 55000 and names the guard in the message). 55000 is a generic code any
 * trigger can raise, so the code alone is never taken to mean "this feature is switched off".
 */
export function isLabelGuardRefusal(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return error?.code === "55000" && /\((pharmacy_bp_readings|paper_diary_entry)\)/.test(error.message ?? "");
}

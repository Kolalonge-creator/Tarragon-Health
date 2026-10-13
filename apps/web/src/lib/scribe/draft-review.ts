/**
 * The review step for an AI scribe draft. Pure: no clock, no I/O.
 *
 * Why it exists: published error studies of AI notes (see docs/research/S35.md) find omissions more common than
 * invented text, and omissions are harder to see because the note still reads well. A single "Use in note" button
 * invites a skim. So every section must be confirmed before the draft can be used: a filled section as "I have read
 * this", an empty one as "Nothing was discussed about this" (and it is flagged as a possible omission). Editing a
 * section clears its confirmation, so a clinician cannot confirm and then change the text unread.
 *
 * This does not decide anything clinical and writes nothing to the record (INV-11): "Use in note" still only fills the
 * note form, and the clinician still signs the note there.
 */

export const DRAFT_SECTION_KEYS = ["history", "examination", "assessment", "plan", "followUp", "patientSummary"] as const;
export type DraftSectionKey = (typeof DRAFT_SECTION_KEYS)[number];
export type DraftFields = Record<DraftSectionKey, string>;
export type Confirmations = Partial<Record<DraftSectionKey, true>>;

export function isEmptySection(text: string): boolean {
  return text.trim().length === 0;
}

/** The sections the model left empty, in display order: each is a possible omission. */
export function possibleOmissions(fields: DraftFields): DraftSectionKey[] {
  return DRAFT_SECTION_KEYS.filter((key) => isEmptySection(fields[key]));
}

/** Sections not yet confirmed. */
export function unconfirmed(confirmations: Confirmations): DraftSectionKey[] {
  return DRAFT_SECTION_KEYS.filter((key) => !confirmations[key]);
}

export function canUseDraft(confirmations: Confirmations): boolean {
  return unconfirmed(confirmations).length === 0;
}

/** Confirm or un-confirm one section. Returns a new object. */
export function setConfirmed(confirmations: Confirmations, key: DraftSectionKey, confirmed: boolean): Confirmations {
  const next = { ...confirmations };
  if (confirmed) next[key] = true;
  else delete next[key];
  return next;
}

/** An edit clears that section's confirmation (and only that section's). */
export function afterEdit(confirmations: Confirmations, key: DraftSectionKey): Confirmations {
  return setConfirmed(confirmations, key, false);
}

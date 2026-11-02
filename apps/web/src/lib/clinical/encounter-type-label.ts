/**
 * Readable labels for `clinical_encounter_notes.encounter_type` (the CHECK
 * list in 20260917031004_auto_generated_continuous_clinical_note.sql's
 * table definition). Shared by every staff surface that prints a note's
 * type, so a raw `video_consult` never reaches a screen with its underscore
 * swapped for a space.
 */
export const ENCOUNTER_TYPE_LABEL: Record<string, string> = {
  video_consult: "Video consult",
  async_consult: "Async consult",
  in_person: "In person",
  phone: "Phone",
  escalation_review: "Escalation review",
  other: "Other",
};

/** The label for a type, falling back to the raw value for one not in the map. */
export function encounterTypeLabel(encounterType: string): string {
  return ENCOUNTER_TYPE_LABEL[encounterType] ?? encounterType;
}

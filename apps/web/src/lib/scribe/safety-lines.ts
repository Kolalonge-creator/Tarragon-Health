/**
 * S64 (15.4): find the allergy and medicine lines in an AI scribe draft so the clinician reads them FIRST, before signing.
 *
 * Why: the published audits of ambient scribes put verified failures in about a third of notes, concentrated in allergy and
 * medicine lines (docs/design/S61-S65-build-plan.md section 4.3; the figure is unconfirmed, we read only the abstract). A note that
 * reads well can still have the wrong dose or a missing allergy, so those lines get their own explicit confirmation, enforced in the
 * database at signing (a draft from the scribe cannot be signed until confirm_scribe_safety_lines has been called, and any later edit
 * to the text clears it).
 *
 * Pure plain-text matching. It is deliberately generous (a false hit just shows one more line to read) and it never decides anything:
 * it only chooses what is shown first. It does not read the patient record; the clinician compares the lines with the record.
 */

export type SafetyLineKind = "allergy" | "medicine";

export interface SafetyLine {
  kind: SafetyLineKind;
  /** The draft section the line came from (history, assessment, plan and so on). */
  section: string;
  text: string;
}

const ALLERGY = /\b(allerg\w*|anaphyla\w*|intoleran\w*|hypersensitiv\w*|rash after|reaction to)\b/i;
const MEDICINE =
  /\b(medicin\w*|medicat\w*|tablets?|capsules?|syrup|inhalers?|injections?|insulin|dos(?:e|es|age|ing)|prescri\w*|drugs?|antibiotics?|paracetamol|ibuprofen|aspirin|amoxicillin|metformin|amlodipine|losartan|lisinopril|statins?|hctz|hydrochlorothiazide|artemether|lumefantrine|omeprazole|warfarin)\b|\d\s?(?:mg|mcg|ml|iu|units?)\b/i;

/** Splits on line breaks and on sentence ends, so one long paragraph still yields one line per statement. */
function toLines(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Allergy lines first, then medicine lines; a line that mentions both is shown once, as an allergy. Order within a kind follows the draft. */
export function extractSafetyLines(sections: Readonly<Record<string, string | undefined>>): SafetyLine[] {
  const allergy: SafetyLine[] = [];
  const medicine: SafetyLine[] = [];
  const seen = new Set<string>();
  for (const [section, text] of Object.entries(sections)) {
    if (!text) continue;
    for (const line of toLines(text)) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      if (ALLERGY.test(line)) {
        seen.add(key);
        allergy.push({ kind: "allergy", section, text: line });
      } else if (MEDICINE.test(line)) {
        seen.add(key);
        medicine.push({ kind: "medicine", section, text: line });
      }
    }
  }
  return [...allergy, ...medicine];
}

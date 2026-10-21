import { BLOOD_PROVENANCE, GENOTYPE_NOTE, type EmergencyClinicalFacts } from "./card";
import { MINIMAL_CHOICES, NOT_SHARED_TEXT, CARD_FIELDS, type CardField, type CardFieldChoices } from "./field-choices";

/**
 * The emergency card as a phone-wallpaper picture (LSI-1): the pure half. It decides WHAT the picture says. Nothing here draws or reads the
 * database, so the rules can be tested without an image renderer.
 *
 * Rules this file keeps, because they are the safety of the feature:
 *  - the picture shows only what the person chose on the card chooser; the "minimum" option can only NARROW that, never widen it;
 *  - a detail the person chose not to share is said to be "not shared", never "none recorded" (a stranger must not read it as "has none");
 *  - the same sensitive-medicine and sensitive-condition rules as the printed card apply, because the facts arrive already passed through
 *    `applyCardFieldChoices`; a withheld medicine is counted, never named;
 *  - a blood group the person only told us is marked patient-reported, never presented as a lab result;
 *  - the picture says anyone holding the phone can read it, and that it does not update itself.
 */

/** A modern phone, portrait: 1170 x 2532 (iPhone 14 at 3x). The clock and widgets sit in the top part of a lock screen, the flashlight and camera at the bottom. */
export const LOCK_SCREEN_IMAGE = {
  width: 1170,
  height: 2532,
  /** Pixels left empty at the top so the phone's clock and widgets do not cover the card. */
  topSafe: 760,
  /** Pixels left empty at the bottom for the flashlight and camera buttons. */
  bottomSafe: 330,
} as const;

/** A picture has a fixed height: a long list is cut to this many lines and says how many were left off (the printed card has the full list). */
export const MAX_ROW_LINES = { allergies: 8, medications: 7 } as const;

function capLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  return [...lines.slice(0, max - 1), `and ${lines.length - (max - 1)} more. See the printed card or ask the patient.`];
}

export interface LockScreenOptions {
  /** Put the plain-text QR on the picture. */
  includeQr: boolean;
  /** Narrow the picture to the usual minimum (blood group and genotype, allergies, emergency contact). */
  minimum: boolean;
}

export const DEFAULT_LOCK_SCREEN_OPTIONS: LockScreenOptions = { includeQr: true, minimum: true };

/**
 * The choices the picture uses. With `minimum` on, a field is shown only if the person chose it AND it is in the usual minimum, so the picture
 * can never show more than the card chooser allows. `lock_screen_opt_in` is carried through unchanged.
 */
export function lockScreenChoices(chosen: CardFieldChoices, minimum: boolean): CardFieldChoices {
  if (!minimum) return chosen;
  const out = { ...chosen } as CardFieldChoices;
  for (const f of CARD_FIELDS) out[f] = chosen[f] && MINIMAL_CHOICES[f];
  return out;
}

export interface LockScreenRow {
  key: string;
  label: string;
  /** One or more lines of text. */
  lines: string[];
  /** "alert" for a severe allergy; "caution" for a patient-reported blood group; "plain" otherwise. */
  tone: "plain" | "alert" | "caution";
}

export interface LockScreenModel {
  title: string;
  name: string;
  identity: string | null;
  rows: LockScreenRow[];
  /** Said once if anything was left off, never as "none recorded". Null when nothing was hidden. */
  notShared: string | null;
  footer: string[];
}

function age(dob: string): number | null {
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/**
 * `facts` must already have been passed through `applyCardFieldChoices` with the SAME choices as `hidden` (the caller does this once, so the
 * picture, the QR text and the printed card cannot disagree).
 */
export function buildLockScreenModel(facts: EmergencyClinicalFacts, hidden: readonly CardField[], savedOn: string): LockScreenModel {
  const isHidden = (f: CardField) => hidden.includes(f);
  const rows: LockScreenRow[] = [];

  // blood first: in Nigeria the genotype is often the most decision-changing line
  if (!isHidden("blood")) {
    if (facts.blood && (facts.blood.blood_group || facts.blood.genotype)) {
      const provenance = facts.blood.provenance ? BLOOD_PROVENANCE[facts.blood.provenance] : undefined;
      const note = facts.blood.genotype ? GENOTYPE_NOTE[facts.blood.genotype] : undefined;
      rows.push({
        key: "blood",
        label: "Blood",
        lines: [
          `${facts.blood.blood_group ?? "Group not recorded"}${facts.blood.genotype ? ` · Genotype ${facts.blood.genotype}` : ""}`,
          ...(note ? [note] : []),
          provenance ? provenance.label : "Source not recorded",
          "Always confirm by testing before transfusing.",
        ],
        tone: provenance?.tone === "unconfirmed" || !provenance ? "caution" : "plain",
      });
    } else {
      rows.push({ key: "blood", label: "Blood", lines: ["Not recorded."], tone: "plain" });
    }
  }

  if (!isHidden("allergies")) {
    const severe = facts.allergies.some((a) => a.severity === "severe");
    rows.push({
      key: "allergies",
      label: "Allergies",
      lines:
        facts.allergies.length === 0
          ? ["None recorded. That is not the same as none. Ask if you can."]
          : capLines(facts.allergies.map((a) => `${a.allergen}${a.severity ? ` · ${a.severity}` : ""}${a.reaction ? ` · ${a.reaction}` : ""}`), MAX_ROW_LINES.allergies),
      tone: severe ? "alert" : "plain",
    });
  }

  if (!isHidden("medications")) {
    const withheld = facts.medicines_not_shown && facts.medicines_not_shown > 0 ? facts.medicines_not_shown : 0;
    const lines = capLines(facts.medications.map((m) => `${m.drug_name}${m.dose ? ` · ${m.dose}` : ""}${m.frequency ? ` · ${m.frequency}` : ""}`), MAX_ROW_LINES.medications);
    if (withheld > 0) lines.push(withheld === 1 ? "1 medicine is not shown by the patient. Ask the patient or their family." : `${withheld} medicines are not shown by the patient. Ask the patient or their family.`);
    rows.push({ key: "medications", label: "Current medicines", lines: lines.length > 0 ? lines : ["None recorded."], tone: "plain" });
  }

  if (!isHidden("conditions")) {
    rows.push({
      key: "conditions",
      label: "Ongoing conditions",
      lines: facts.conditions.length > 0 ? [facts.conditions.map((c) => c.replace(/_/g, " ")).join(" · ")] : ["None recorded."],
      tone: "plain",
    });
  }

  if (!isHidden("emergency_contact")) {
    const c = facts.emergency_contact;
    rows.push({
      key: "emergency_contact",
      label: "Emergency contact",
      lines: c?.name ? [`${c.name}${c.relationship ? ` (${c.relationship})` : ""}`, ...(c.phone ? [c.phone] : [])] : ["None recorded."],
      tone: "plain",
    });
  }

  const identityBits: string[] = [];
  if (!isHidden("date_of_birth") && facts.date_of_birth) {
    const a = age(facts.date_of_birth);
    identityBits.push(`Born ${facts.date_of_birth}${a !== null ? ` (age ${a})` : ""}`);
  }
  if (!isHidden("sex") && facts.sex) identityBits.push(facts.sex);
  if (!isHidden("patient_number") && facts.patient_number) identityBits.push(facts.patient_number);

  return {
    title: "Emergency health card",
    name: facts.full_name ?? "Name not recorded",
    identity: identityBits.length > 0 ? identityBits.join(" · ") : null,
    rows,
    notShared: hidden.length > 0 ? NOT_SHARED_TEXT : null,
    footer: [`Saved ${savedOn}. This picture does not update itself.`, "Not a substitute for clinical assessment."],
  };
}

/** A name that says nothing about the person or what the card holds. */
export const LOCK_SCREEN_FILE_NAME = "emergency-card-lock-screen.png";

import type { EmergencyClinicalFacts } from "./card";

/**
 * The details a person chooses to put on their emergency card (S43, spec 2.7).
 * A stranger who finds a card, or a link, should see only what the person decided
 * was worth the risk. Mirrors public.emergency_card_fields; the live link applies
 * the same choices inside the database wrapper, so a hidden field cannot be read
 * around it. Pure and free of server-only code so it can be unit tested.
 */
export const CARD_FIELDS = [
  "date_of_birth",
  "sex",
  "patient_number",
  "allergies",
  "medications",
  "conditions",
  "blood",
  "emergency_contact",
] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export type CardFieldChoices = Record<CardField, boolean> & { lock_screen_opt_in: boolean };

/** What the card shows before the person has chosen anything: unchanged from before this feature. */
export const DEFAULT_CHOICES: CardFieldChoices = {
  date_of_birth: true,
  sex: true,
  patient_number: true,
  allergies: true,
  medications: true,
  conditions: true,
  blood: true,
  emergency_contact: true,
  lock_screen_opt_in: false,
};

/** The usual minimum: the three things that change what a stranger does in the first minutes. */
export const MINIMAL_CHOICES: CardFieldChoices = {
  date_of_birth: false,
  sex: false,
  patient_number: false,
  allergies: true,
  medications: false,
  conditions: false,
  blood: true,
  emergency_contact: true,
  lock_screen_opt_in: false,
};

export interface CardFieldsRow {
  show_date_of_birth: boolean;
  show_sex: boolean;
  show_patient_number: boolean;
  show_allergies: boolean;
  show_medications: boolean;
  show_conditions: boolean;
  show_blood: boolean;
  show_emergency_contact: boolean;
  lock_screen_opt_in: boolean;
}

export function choicesFromRow(row: CardFieldsRow | null | undefined): CardFieldChoices {
  if (!row) return DEFAULT_CHOICES;
  return {
    date_of_birth: row.show_date_of_birth,
    sex: row.show_sex,
    patient_number: row.show_patient_number,
    allergies: row.show_allergies,
    medications: row.show_medications,
    conditions: row.show_conditions,
    blood: row.show_blood,
    emergency_contact: row.show_emergency_contact,
    lock_screen_opt_in: row.lock_screen_opt_in,
  };
}

export function rowFromChoices(c: CardFieldChoices): CardFieldsRow {
  return {
    show_date_of_birth: c.date_of_birth,
    show_sex: c.sex,
    show_patient_number: c.patient_number,
    show_allergies: c.allergies,
    show_medications: c.medications,
    show_conditions: c.conditions,
    show_blood: c.blood,
    show_emergency_contact: c.emergency_contact,
    lock_screen_opt_in: c.lock_screen_opt_in,
  };
}

export function hiddenFields(c: CardFieldChoices): CardField[] {
  return CARD_FIELDS.filter((f) => !c[f]);
}

/** Removes what the person chose not to show. The name is always kept: a card with no name identifies no one. */
export function applyCardFieldChoices(facts: EmergencyClinicalFacts, c: CardFieldChoices): EmergencyClinicalFacts {
  return {
    ...facts,
    date_of_birth: c.date_of_birth ? facts.date_of_birth : null,
    sex: c.sex ? facts.sex : null,
    patient_number: c.patient_number ? facts.patient_number : null,
    emergency_contact: c.emergency_contact ? facts.emergency_contact : null,
    allergies: c.allergies ? facts.allergies : [],
    medications: c.medications ? facts.medications : [],
    conditions: c.conditions ? facts.conditions : [],
    blood: c.blood ? facts.blood : null,
  };
}

/** What a card says where the person chose not to share a detail. Never "None recorded": that reads as "has none". */
export const NOT_SHARED_TEXT = "Not shared by the patient. Ask the patient or their family.";

/** Narrows whatever list a payload or a row gave to the known field names. */
export function knownHiddenFields(value: unknown): CardField[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is CardField => typeof v === "string" && (CARD_FIELDS as readonly string[]).includes(v));
}

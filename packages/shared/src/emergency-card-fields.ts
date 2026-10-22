/**
 * The details a person chooses to put on their emergency card (S43, spec 2.7), shared by the web form, the printed card and the phone.
 * Mirrors public.emergency_card_fields; the live link applies the same choices inside the database wrapper, so a hidden field cannot be read
 * around it. Pure, so web and phone cannot drift on what is on by default.
 */
export const EMERGENCY_CARD_FIELDS = [
  "date_of_birth",
  "sex",
  "patient_number",
  "allergies",
  "medications",
  "conditions",
  "blood",
  "emergency_contact",
  "reproductive",
  "mental_health",
] as const;
export type EmergencyCardField = (typeof EMERGENCY_CARD_FIELDS)[number];

export type EmergencyCardChoices = Record<EmergencyCardField, boolean> & { lock_screen_opt_in: boolean };

/**
 * What the card shows before the person has chosen anything (S47, chat decision 2026-10-07). ON: blood group and genotype, allergies, current
 * medicines, emergency contacts (and the identity lines the card always carried). OFF until chosen: ongoing conditions or diagnoses, and
 * anything reproductive or mental health.
 */
export const EMERGENCY_DEFAULT_CHOICES: EmergencyCardChoices = {
  date_of_birth: true,
  sex: true,
  patient_number: true,
  allergies: true,
  medications: true,
  conditions: false,
  blood: true,
  emergency_contact: true,
  reproductive: false,
  mental_health: false,
  lock_screen_opt_in: false,
};

/** The usual minimum: the three things that change what a stranger does in the first minutes. */
export const EMERGENCY_MINIMAL_CHOICES: EmergencyCardChoices = {
  date_of_birth: false,
  sex: false,
  patient_number: false,
  allergies: true,
  medications: false,
  conditions: false,
  blood: true,
  emergency_contact: true,
  reproductive: false,
  mental_health: false,
  lock_screen_opt_in: false,
};

export interface EmergencyCardFieldsRow {
  show_date_of_birth: boolean;
  show_sex: boolean;
  show_patient_number: boolean;
  show_allergies: boolean;
  show_medications: boolean;
  show_conditions: boolean;
  show_blood: boolean;
  show_emergency_contact: boolean;
  show_reproductive: boolean;
  show_mental_health: boolean;
  lock_screen_opt_in: boolean;
}

/** The columns to read, in one place so a new field cannot be added to one side only. */
export const EMERGENCY_CARD_FIELDS_COLUMNS =
  "show_date_of_birth, show_sex, show_patient_number, show_allergies, show_medications, show_conditions, show_blood, show_emergency_contact, show_reproductive, show_mental_health, lock_screen_opt_in";

export function emergencyChoicesFromRow(row: EmergencyCardFieldsRow | null | undefined): EmergencyCardChoices {
  if (!row) return EMERGENCY_DEFAULT_CHOICES;
  return {
    date_of_birth: row.show_date_of_birth,
    sex: row.show_sex,
    patient_number: row.show_patient_number,
    allergies: row.show_allergies,
    medications: row.show_medications,
    conditions: row.show_conditions,
    blood: row.show_blood,
    emergency_contact: row.show_emergency_contact,
    reproductive: row.show_reproductive,
    mental_health: row.show_mental_health,
    lock_screen_opt_in: row.lock_screen_opt_in,
  };
}

export function emergencyRowFromChoices(c: EmergencyCardChoices): EmergencyCardFieldsRow {
  return {
    show_date_of_birth: c.date_of_birth,
    show_sex: c.sex,
    show_patient_number: c.patient_number,
    show_allergies: c.allergies,
    show_medications: c.medications,
    show_conditions: c.conditions,
    show_blood: c.blood,
    show_emergency_contact: c.emergency_contact,
    show_reproductive: c.reproductive,
    show_mental_health: c.mental_health,
    lock_screen_opt_in: c.lock_screen_opt_in,
  };
}

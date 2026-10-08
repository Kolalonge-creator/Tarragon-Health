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
  "reproductive",
  "mental_health",
] as const;
export type CardField = (typeof CARD_FIELDS)[number];

export type CardFieldChoices = Record<CardField, boolean> & { lock_screen_opt_in: boolean };

/**
 * What the card shows before the person has chosen anything (S47, chat decision 2026-10-07). ON: blood group and genotype, allergies, current medicines,
 * emergency contacts (and the identity lines the card always carried). OFF until chosen: ongoing conditions or diagnoses, and anything reproductive or mental
 * health. The live link (database wrapper), the printed page, the QR text and the phone's offline card all start from this, and a hidden detail is said to be
 * "not shared", never "none recorded".
 */
export const DEFAULT_CHOICES: CardFieldChoices = {
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
export const MINIMAL_CHOICES: CardFieldChoices = {
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

export interface CardFieldsRow {
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
    reproductive: row.show_reproductive,
    mental_health: row.show_mental_health,
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
    show_reproductive: c.reproductive,
    show_mental_health: c.mental_health,
    lock_screen_opt_in: c.lock_screen_opt_in,
  };
}

export function hiddenFields(c: CardFieldChoices): CardField[] {
  return CARD_FIELDS.filter((f) => !c[f]);
}

/**
 * Mirrors private.emergency_card_sensitive_condition (migration 20261008035104_s47_emergency_card_defaults.sql); a Jest test fails if the two lists differ.
 * A condition that looks reproductive or mental health is removed from a shown list unless its own switch is on.
 */
export const REPRODUCTIVE_PATTERN = /(pregnan|antenatal|postnatal|fertil|contracepti|menstru|menopaus|reproduct|obstetric|gynae|gynec)/i;
export const MENTAL_HEALTH_PATTERN = /(mental|depress|anxiet|psych|bipolar|schizo|suicid|self.?harm|ptsd|trauma|panic|mood)/i;

/** Mirrors private.emergency_card_sensitive_medicine: a contraceptive or an antidepressant gives a reproductive or mental health matter away like a condition does. */
export const REPRODUCTIVE_MEDICINE_PATTERN = /(contracept|levonorgestrel|norethisterone|ethinylestradiol|medroxyprogesterone|depo.?provera|misoprostol|mifepristone|clomiphene)/i;
export const MENTAL_HEALTH_MEDICINE_PATTERN = /(antidepress|sertraline|fluoxetine|citalopram|escitalopram|paroxetine|venlafaxine|mirtazapine|amitriptyline|lithium|risperidone|olanzapine|quetiapine|haloperidol|chlorpromazine|diazepam|lorazepam|alprazolam|clonazepam|bupropion)/i;

export function sensitiveMedicineKind(name: string): "reproductive" | "mental_health" | null {
  if (REPRODUCTIVE_MEDICINE_PATTERN.test(name)) return "reproductive";
  if (MENTAL_HEALTH_MEDICINE_PATTERN.test(name)) return "mental_health";
  return null;
}

export function filterSensitiveMedicines<T extends { drug_name: string }>(medicines: readonly T[], c: Pick<CardFieldChoices, "reproductive" | "mental_health">): T[] {
  return medicines.filter((m) => {
    const kind = sensitiveMedicineKind(m.drug_name);
    return kind === null || (kind === "reproductive" ? c.reproductive : c.mental_health);
  });
}

export function sensitiveConditionKind(text: string): "reproductive" | "mental_health" | null {
  if (REPRODUCTIVE_PATTERN.test(text)) return "reproductive";
  if (MENTAL_HEALTH_PATTERN.test(text)) return "mental_health";
  return null;
}

export function filterSensitiveConditions(conditions: readonly string[], c: Pick<CardFieldChoices, "reproductive" | "mental_health">): string[] {
  return conditions.filter((x) => {
    const kind = sensitiveConditionKind(x);
    return kind === null || (kind === "reproductive" ? c.reproductive : c.mental_health);
  });
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
    medications: c.medications ? filterSensitiveMedicines(facts.medications, c) : [],
    conditions: c.conditions ? filterSensitiveConditions(facts.conditions, c) : [],
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

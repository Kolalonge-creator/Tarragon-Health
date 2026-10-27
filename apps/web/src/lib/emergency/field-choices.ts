import type { EmergencyClinicalFacts } from "./card";

import {
  EMERGENCY_CARD_FIELDS,
  EMERGENCY_DEFAULT_CHOICES,
  EMERGENCY_MINIMAL_CHOICES,
  emergencyChoicesFromRow,
  emergencyRowFromChoices,
  type EmergencyCardChoices,
  type EmergencyCardField,
  type EmergencyCardFieldsRow,
} from "@tarragon/shared";

/**
 * The details a person chooses to put on their emergency card (S43, spec 2.7). The field list, the defaults, the one-tap minimum and the row
 * mapping live in @tarragon/shared so the phone shows exactly what this page does; the names below keep the old imports working.
 */
export const CARD_FIELDS = EMERGENCY_CARD_FIELDS;
export type CardField = EmergencyCardField;
export type CardFieldChoices = EmergencyCardChoices;
export type CardFieldsRow = EmergencyCardFieldsRow;
export const DEFAULT_CHOICES = EMERGENCY_DEFAULT_CHOICES;
export const MINIMAL_CHOICES = EMERGENCY_MINIMAL_CHOICES;
export const choicesFromRow = emergencyChoicesFromRow;
export const rowFromChoices = emergencyRowFromChoices;

export function hiddenFields(c: CardFieldChoices): CardField[] {
  return CARD_FIELDS.filter((f) => !c[f]);
}

/**
 * Mirrors private.emergency_card_sensitive_condition (migration 20261008035104_s47_emergency_card_defaults.sql); a Jest test fails if the two lists differ.
 * A condition that looks reproductive or mental health is removed from a shown list unless its own switch is on.
 */
export const REPRODUCTIVE_PATTERN = /(pregnan|antenatal|postnatal|fertil|contracepti|menstru|menopaus|reproduct|obstetric|gynae|gynec)/i;
export const MENTAL_HEALTH_PATTERN = /(mental|depress|anxiet|psych|bipolar|schizo|suicid|self.?harm|ptsd|trauma|panic|mood)/i;

/**
 * Mirrors private.emergency_card_sensitive_medicine: a contraceptive or an antidepressant gives a reproductive or mental health matter away like a condition does.
 * Deliberately NARROW (S47d review): only medicines that are almost only used for that purpose. A drug with other common uses (misoprostol, diazepam, lorazepam,
 * amitriptyline, lithium, mirtazapine, bupropion, haloperidol, chlorpromazine, alprazolam, clonazepam) is never hidden, because withholding it from a responder is
 * the greater risk. Whatever IS withheld is counted on the card, never named.
 */
export const REPRODUCTIVE_MEDICINE_PATTERN = /(contracept|levonorgestrel|norethisterone|ethinylestradiol|medroxyprogesterone|depo.?provera|mifepristone|clomiphene)/i;
export const MENTAL_HEALTH_MEDICINE_PATTERN = /(antidepress|sertraline|fluoxetine|citalopram|escitalopram|paroxetine|venlafaxine|risperidone|olanzapine|quetiapine)/i;

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
  const shownMedicines = c.medications ? filterSensitiveMedicines(facts.medications, c) : [];
  const withheld = c.medications ? facts.medications.length - shownMedicines.length : 0;
  return {
    ...facts,
    medicines_not_shown: withheld > 0 ? withheld : undefined,
    date_of_birth: c.date_of_birth ? facts.date_of_birth : null,
    sex: c.sex ? facts.sex : null,
    patient_number: c.patient_number ? facts.patient_number : null,
    emergency_contact: c.emergency_contact ? facts.emergency_contact : null,
    allergies: c.allergies ? facts.allergies : [],
    medications: shownMedicines,
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

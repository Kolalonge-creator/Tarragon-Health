/**
 * The Vitals screen builds some translation keys at run time (the level label, the
 * entry errors, the vital type names, the glucose contexts). TypeScript cannot check
 * those, so this proves every key the screen can ask for exists in both languages.
 */
import { en, type MessageKey } from "@tarragon/i18n";
import type { BpLevel } from "./bp-classification";
import { BP_CHECKLIST_SYMPTOMS } from "./bp-checklist";
import type { BpEntryError, OtherEntryError, OtherVitalType } from "./vitals-entry";

const LEVELS: BpLevel[] = ["green", "amber", "red", "emergency", "unknown"];
const BP_ERRORS: BpEntryError[] = ["numbers", "range", "order"];
const OTHER_ERRORS: OtherEntryError[] = ["number", "range_glucose_mmol", "range_glucose_mgdl", "range_weight", "range_temperature", "range_spo2", "range_pulse"];
const TYPES: OtherVitalType[] = ["glucose", "weight", "temperature", "spo2", "pulse"];
const CONTEXTS = ["random", "fasting", "pre_meal", "post_meal", "bedtime", "night"];

const keys: string[] = [
  "vitals.a11y.reading",
  ...LEVELS.map((l) => `vitals.level.${l}`),
  ...BP_ERRORS.map((e) => `vitals.error.${e}`),
  ...OTHER_ERRORS.map((e) => `vitals.other.error.${e}`),
  ...TYPES.map((t) => `vitals.type.${t}`),
  ...CONTEXTS.map((c) => `vitals.glucose.context.${c}`),
  // S07: the BP form builds these at run time (a pulse error, one label per checklist symptom).
  "vitals.error.pulse_number",
  "vitals.error.pulse_range",
  ...BP_CHECKLIST_SYMPTOMS.map((s) => `vitals.symptom.${s}`),
];

describe("Vitals screen dynamic translation keys", () => {
  it.each(keys)("%s exists in English", (key) => {
    expect(en[key as MessageKey]).toBeTruthy();
  });

  it("covers every error the entry validators can return", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
});

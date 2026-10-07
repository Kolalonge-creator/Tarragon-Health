/**
 * Photo reading capture (S70a, function 18.3). Pure logic for the on-device path: text recognition runs on the phone, this module turns the
 * recognised text into a DRAFT the person must check, and refuses to produce a reading until every number has been confirmed by them.
 *
 *  - No image is uploaded and no cloud vision model is involved (OQ-312). Any future server-side vision model would have to be registered in
 *    `ai_systems` and run through `runGovernedAi()`; nothing here does that.
 *  - Recognition of seven-segment displays is error-prone, so nothing is trusted: a draft number is a suggestion in an editable box, and a
 *    reading only exists once the person has confirmed every digit (`confirmedFields` must name every field).
 *  - The confirmed value goes through exactly the same deterministic triage as a typed one (it is stored with source "photo_confirmed").
 *  - A reading that fails the "impossible" check is returned as `held`, never as a saved reading.
 */
import { classifyPlausibility, type ImpossibleReason, type PlausibilityVital } from "./device-plausibility";

export type PhotoDeviceKind = "blood_pressure" | "glucose" | "weight" | "temperature" | "spo2";

export interface PhotoField {
  field: "systolic" | "diastolic" | "pulse_bpm" | "glucose_value" | "weight_value" | "temperature_c" | "spo2_pct";
  /** Text, so a half-typed or wrong value can sit in the box exactly as the person left it. */
  value: string;
  /** True when this number was read from the photo (a suggestion), false when the person had to type it. */
  suggested: boolean;
}

export interface PhotoDraft {
  deviceKind: PhotoDeviceKind;
  fields: PhotoField[];
  unit: "mmol_l" | "mg_dl" | "kg" | "lb" | "c" | "f" | null;
  /** True when the unit could not be read and the person must pick it. */
  needsUnit: boolean;
  warnings: string[];
}

const NUMBER = /\d{1,3}(?:[.,]\d{1,2})?/g;

function numbersIn(lines: readonly string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    for (const m of line.matchAll(NUMBER)) {
      const n = Number(m[0].replace(",", "."));
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

const text = (lines: readonly string[]): string => lines.join(" ").toLowerCase();
const str = (n: number): string => (Number.isInteger(n) ? String(n) : String(n));

/** Turn recognised lines into an editable draft. Never throws; a photo that yields nothing gives empty boxes the person types into. */
export function draftFromRecognisedText(deviceKind: PhotoDeviceKind, lines: readonly string[]): PhotoDraft {
  const t = text(lines);
  const nums = numbersIn(lines);
  const warnings: string[] = [];
  const empty = (field: PhotoField["field"]): PhotoField => ({ field, value: "", suggested: false });
  const sug = (field: PhotoField["field"], n: number | undefined): PhotoField =>
    n === undefined ? empty(field) : { field, value: str(n), suggested: true };

  switch (deviceKind) {
    case "blood_pressure": {
      const ints = nums.filter((n) => Number.isInteger(n) && n >= 20 && n <= 320);
      const [sys, dia, pulse] = ints;
      if (sys !== undefined && dia !== undefined && sys <= dia) warnings.push("The top number should be bigger than the bottom number. Please check both.");
      return {
        deviceKind,
        fields: [sug("systolic", sys), sug("diastolic", dia), sug("pulse_bpm", pulse)],
        unit: null,
        needsUnit: false,
        warnings,
      };
    }
    case "glucose": {
      const unit = /mg\s*\/?\s*dl/.test(t) ? "mg_dl" : /mmol/.test(t) ? "mmol_l" : null;
      const n = nums.find((x) => x > 0);
      return { deviceKind, fields: [sug("glucose_value", n)], unit, needsUnit: unit === null, warnings };
    }
    case "weight": {
      const unit = /\blb\b|lbs|pound/.test(t) ? "lb" : /\bkg\b/.test(t) ? "kg" : null;
      const n = nums.find((x) => x > 0);
      return { deviceKind, fields: [sug("weight_value", n)], unit, needsUnit: unit === null, warnings };
    }
    case "temperature": {
      const unit = /°?\s*f\b/.test(t) && !/°?\s*c\b/.test(t) ? "f" : /°?\s*c\b/.test(t) ? "c" : null;
      const n = nums.find((x) => x >= 25);
      return { deviceKind, fields: [sug("temperature_c", n)], unit, needsUnit: unit === null, warnings };
    }
    case "spo2": {
      const ints = nums.filter((n) => Number.isInteger(n));
      const spo2 = ints.find((n) => n >= 50 && n <= 100);
      const pulse = ints.find((n) => n !== spo2 && n >= 20 && n <= 250);
      return { deviceKind, fields: [sug("spo2_pct", spo2), sug("pulse_bpm", pulse)], unit: null, needsUnit: false, warnings };
    }
  }
}

export interface ConfirmInput {
  draft: PhotoDraft;
  /** What the boxes say now, keyed by field. A field missing here keeps the draft value. */
  edits: Partial<Record<PhotoField["field"], string>>;
  /** The fields the person has ticked as "I checked this number". EVERY field of the draft must be here. */
  confirmedFields: readonly PhotoField["field"][];
  unit?: PhotoDraft["unit"];
  glucoseContext?: "fasting" | "random" | "post_meal";
  cuffType?: "upper_arm" | "wrist" | "not_sure";
  ageYears?: number | null;
}

export type PhotoReadingPayload =
  | { vital_type: "blood_pressure"; systolic: number; diastolic: number; pulse_bpm?: number; cuff_type?: string }
  | { vital_type: "glucose"; glucose_mmol_l: number; glucose_context: "fasting" | "random" | "post_meal" }
  | { vital_type: "weight"; weight_kg: number }
  | { vital_type: "temperature"; temperature_c: number }
  | { vital_type: "spo2"; spo2_pct: number; pulse_bpm?: number };

export type ConfirmResult =
  | { ok: true; held: false; reading: PhotoReadingPayload; notes: string[] }
  | { ok: true; held: true; reasons: ImpossibleReason[]; notes: string[] }
  | { ok: false; error: string };

const MG_DL_PER_MMOL = 18.0182;

function parse(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = v.trim().replace(",", ".");
  if (s === "" || !/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * The only way a photo becomes a reading. Refuses unless every field of the draft is confirmed and a number. An impossible value comes back
 * `held`: it is not saved, and the screen asks the person to check the device or the number and enter it again.
 */
export function finalisePhotoReading(input: ConfirmInput): ConfirmResult {
  const { draft } = input;
  const notes: string[] = [];
  const val = (f: PhotoField["field"]): number | null => {
    const fromEdit = input.edits[f];
    const base = draft.fields.find((x) => x.field === f)?.value;
    return parse(fromEdit !== undefined ? fromEdit : base);
  };
  for (const f of draft.fields) {
    // pulse is optional on a BP or oximeter photo only if left blank AND not confirmed
    if (!input.confirmedFields.includes(f.field)) {
      if ((f.field === "pulse_bpm") && (val("pulse_bpm") === null)) continue;
      return { ok: false, error: "Please check every number and tick it before saving." };
    }
    if (val(f.field) === null && f.field !== "pulse_bpm") return { ok: false, error: "Please enter every number before saving." };
  }

  const unit = input.unit ?? draft.unit;
  let reading: PhotoReadingPayload;
  let vital: PlausibilityVital;
  const age = input.ageYears ?? null;
  switch (draft.deviceKind) {
    case "blood_pressure": {
      const systolic = val("systolic");
      const diastolic = val("diastolic");
      const pulse = val("pulse_bpm");
      if (systolic === null || diastolic === null) return { ok: false, error: "Please enter both blood pressure numbers." };
      reading = { vital_type: "blood_pressure", systolic, diastolic, ...(pulse !== null ? { pulse_bpm: pulse } : {}), ...(input.cuffType ? { cuff_type: input.cuffType } : {}) };
      vital = "blood_pressure";
      if (input.cuffType === "wrist") notes.push("Wrist cuffs can be less reliable. An upper-arm cuff gives a steadier reading.");
      break;
    }
    case "glucose": {
      const g = val("glucose_value");
      if (g === null) return { ok: false, error: "Please enter the number." };
      if (unit !== "mmol_l" && unit !== "mg_dl") return { ok: false, error: "Please choose the unit your device shows." };
      if (!input.glucoseContext) return { ok: false, error: "Please say when you took it: fasting, random or after a meal." };
      reading = { vital_type: "glucose", glucose_mmol_l: unit === "mg_dl" ? Math.round((g / MG_DL_PER_MMOL) * 10) / 10 : g, glucose_context: input.glucoseContext };
      vital = "glucose";
      break;
    }
    case "weight": {
      const w = val("weight_value");
      if (w === null) return { ok: false, error: "Please enter the number." };
      if (unit !== "kg" && unit !== "lb") return { ok: false, error: "Please choose kg or lb." };
      reading = { vital_type: "weight", weight_kg: unit === "lb" ? Math.round(w * 0.45359237 * 10) / 10 : w };
      vital = "weight";
      break;
    }
    case "temperature": {
      const c = val("temperature_c");
      if (c === null) return { ok: false, error: "Please enter the number." };
      if (unit !== "c" && unit !== "f") return { ok: false, error: "Please choose °C or °F." };
      reading = { vital_type: "temperature", temperature_c: unit === "f" ? Math.round(((c - 32) * 5) / 9 * 10) / 10 : c };
      vital = "temperature";
      break;
    }
    case "spo2": {
      const s = val("spo2_pct");
      const pulse = val("pulse_bpm");
      if (s === null) return { ok: false, error: "Please enter the number." };
      reading = { vital_type: "spo2", spo2_pct: s, ...(pulse !== null ? { pulse_bpm: pulse } : {}) };
      vital = "spo2";
      break;
    }
  }

  const check = classifyPlausibility({
    vitalType: vital,
    systolic: reading.vital_type === "blood_pressure" ? reading.systolic : null,
    diastolic: reading.vital_type === "blood_pressure" ? reading.diastolic : null,
    glucoseMmolL: reading.vital_type === "glucose" ? reading.glucose_mmol_l : null,
    weightKg: reading.vital_type === "weight" ? reading.weight_kg : null,
    temperatureC: reading.vital_type === "temperature" ? reading.temperature_c : null,
    spo2Pct: reading.vital_type === "spo2" ? reading.spo2_pct : null,
    pulseBpm: "pulse_bpm" in reading ? reading.pulse_bpm ?? null : null,
    ageYears: age,
  });
  if (check.class === "impossible") return { ok: true, held: true, reasons: check.reasons, notes };
  return { ok: true, held: false, reading, notes };
}

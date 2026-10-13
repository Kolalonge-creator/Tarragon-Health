/**
 * S70 (18.3): reading a device screen from a photo.
 *
 * WHAT THIS IS. A pure parsing layer. It takes lines of text that something on the phone has recognised in a photo of a
 * blood pressure monitor, glucometer, scale, thermometer or oximeter, and suggests numbers. It does not look at images,
 * calls no network and no language model. Recognition itself sits behind `ScreenTextRecognizer`, which the mobile app
 * implements with an on-device recogniser when one is installed in the build (none is, today: see docs/design/S70.md).
 *
 * WHAT IT NEVER DOES. It never decides a reading is right. Every suggestion is shown beside the photo with editable
 * fields and the patient confirms every number (CMO pack C4, OQ-312). A suggestion has at most "medium" confidence, so
 * no caller can treat it as a finished value. The saved reading goes through the same plausibility bounds and the same
 * triage as a typed one (INV-01: nothing here is in the triage path).
 */

export type PhotoReadingKind = "blood_pressure" | "glucose" | "weight" | "temperature" | "spo2" | "pulse";
export type CuffType = "upper_arm" | "wrist" | "not_sure";

/** The seam for text recognition. The photo never leaves the phone: an implementation must not upload the image. */
export interface ScreenTextRecognizer {
  readonly id: string;
  /** False when the build has no recogniser (Expo Go, or a build without the native module). The screen then falls back to typing. */
  isAvailable(): Promise<boolean>;
  /** Recognised text, one entry per line, top to bottom. May throw; callers treat a throw as "type it yourself". */
  recognize(imageUri: string): Promise<string[]>;
}

export type ParseNote =
  | "no_numbers_found"
  | "ambiguous_numbers"
  | "unit_unclear"
  | "converted_from_pounds"
  | "converted_from_fahrenheit"
  | "ocr_letters_corrected"
  | "order_guessed";

export interface ParsedScreenReading {
  kind: PhotoReadingKind;
  fields: {
    systolic?: number;
    diastolic?: number;
    pulse?: number;
    /** glucose in the unit below, weight in kg, temperature in degrees C, spo2 in percent, pulse in bpm. */
    value?: number;
  };
  glucoseUnit?: "mmol_l" | "mg_dl";
  /** "none" means nothing usable was found; the screen shows the photo and empty fields. Never "high": the patient confirms. */
  confidence: "none" | "low" | "medium";
  notes: ParseNote[];
  /** Always true. A parsed value is a suggestion, never a reading. */
  needsConfirmation: true;
}

const DIGIT_LOOKALIKES: Record<string, string> = { O: "0", o: "0", D: "0", I: "1", l: "1", L: "1", "|": "1", S: "5", s: "5", B: "8", Z: "2", z: "2" };

/**
 * Seven-segment and low-light recognition confuses a few letters with digits. A token is corrected only when most of its
 * characters are already digits, so the word "SYS" is left alone and "I28" becomes "128".
 */
export function correctDigitLookalikes(token: string): { text: string; changed: boolean } {
  const chars = [...token];
  const digits = chars.filter((c) => c >= "0" && c <= "9").length;
  const lookalikes = chars.filter((c) => c in DIGIT_LOOKALIKES).length;
  if (digits === 0 || lookalikes === 0 || digits < chars.length - lookalikes || digits + lookalikes !== chars.length) {
    return { text: token, changed: false };
  }
  return { text: chars.map((c) => DIGIT_LOOKALIKES[c] ?? c).join(""), changed: true };
}

interface Num {
  value: number;
  isDecimal: boolean;
  line: number;
}

function numbersIn(lines: string[], notes: Set<ParseNote>): Num[] {
  const out: Num[] = [];
  lines.forEach((raw, line) => {
    const tokens = raw.split(/[\s:=/\\]+/).filter(Boolean);
    for (const token of tokens) {
      const fixed = correctDigitLookalikes(token.replace(/,/g, "."));
      if (fixed.changed) notes.add("ocr_letters_corrected");
      const m = /^(\d{1,3}(?:\.\d{1,2})?)(?:[a-zA-Z%°]*)$/.exec(fixed.text);
      if (!m || m[1] === undefined) continue;
      out.push({ value: Number(m[1]), isDecimal: m[1].includes("."), line });
    }
  });
  return out;
}

function labelled(lines: string[], label: RegExp): number | undefined {
  for (const raw of lines) {
    const m = new RegExp(label.source + "[^0-9OILSBDZ]{0,8}([0-9OILSBDZ]{2,3})").exec(raw.toUpperCase().replace(/MMHG|KPA|\/?MIN|BPM/g, " "));
    if (m?.[1]) {
      const fixed = correctDigitLookalikes(m[1]);
      const n = Number(fixed.text);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

const inRange = (n: number, min: number, max: number) => n >= min && n <= max;

function empty(kind: PhotoReadingKind, notes: Set<ParseNote>): ParsedScreenReading {
  notes.add("no_numbers_found");
  return { kind, fields: {}, confidence: "none", notes: [...notes], needsConfirmation: true };
}

export function parseDeviceScreenText(lines: string[], kind: PhotoReadingKind): ParsedScreenReading {
  const notes = new Set<ParseNote>();
  const text = lines.join(" ");
  const nums = numbersIn(lines, notes);
  if (nums.length === 0) return empty(kind, notes);

  if (kind === "blood_pressure") {
    let systolic = labelled(lines, /SYS\w*/);
    let diastolic = labelled(lines, /DIA\w*/);
    let pulse = labelled(lines, /(?:PUL\w*|PR|HR)/);
    const labelledAll = systolic !== undefined && diastolic !== undefined;
    if (!labelledAll) {
      const ints = nums.filter((n) => !n.isDecimal).map((n) => n.value);
      const s = ints.find((v) => inRange(v, 60, 260));
      const d = s === undefined ? undefined : ints.slice(ints.indexOf(s) + 1).find((v) => inRange(v, 30, 160) && v < s);
      const p = d === undefined || s === undefined ? undefined : ints.slice(ints.indexOf(d, ints.indexOf(s) + 1) + 1).find((v) => inRange(v, 20, 300));
      systolic ??= s;
      diastolic ??= d;
      pulse ??= p;
      notes.add("order_guessed");
    }
    const ok =
      systolic !== undefined && diastolic !== undefined && inRange(systolic, 60, 260) && inRange(diastolic, 30, 160) && systolic > diastolic;
    if (!ok) {
      notes.add("ambiguous_numbers");
      return {
        kind,
        // Two numbers in the wrong order are not a partial answer, they are a wrong one: offer neither.
        fields:
          systolic !== undefined && diastolic !== undefined
            ? {}
            : { ...(systolic !== undefined && inRange(systolic, 60, 260) ? { systolic } : {}), ...(diastolic !== undefined && inRange(diastolic, 30, 160) ? { diastolic } : {}) },
        confidence: "low",
        notes: [...notes],
        needsConfirmation: true,
      };
    }
    const fields: ParsedScreenReading["fields"] = { systolic, diastolic };
    if (pulse !== undefined && inRange(pulse, 20, 300)) fields.pulse = pulse;
    return { kind, fields, confidence: labelledAll ? "medium" : "low", notes: [...notes], needsConfirmation: true };
  }

  if (kind === "glucose") {
    const mgdl = /mg\s*(?:\/\s*)?d/i.test(text);
    const mmol = /mmol/i.test(text);
    const candidates = nums.filter((n) => (mmol && !mgdl ? inRange(n.value, 1, 40) : mgdl && !mmol ? inRange(n.value, 18, 720) : inRange(n.value, 1, 720)));
    const pick = candidates[0];
    if (!pick) return empty(kind, notes);
    let unit: "mmol_l" | "mg_dl" | undefined = mmol && !mgdl ? "mmol_l" : mgdl && !mmol ? "mg_dl" : undefined;
    if (!unit) {
      if (pick.isDecimal && inRange(pick.value, 1, 40)) unit = "mmol_l";
      else if (!pick.isDecimal && pick.value > 40) unit = "mg_dl";
      else notes.add("unit_unclear");
    }
    return {
      kind,
      fields: { value: pick.value },
      ...(unit ? { glucoseUnit: unit } : {}),
      confidence: unit && (mmol || mgdl) ? "medium" : "low",
      notes: [...notes],
      needsConfirmation: true,
    };
  }

  if (kind === "weight") {
    const lb = /\blb\b|lbs|pound/i.test(text);
    const pick = nums.find((n) => inRange(lb ? n.value * 0.45359237 : n.value, 20, 300));
    if (!pick) return empty(kind, notes);
    if (lb) notes.add("converted_from_pounds");
    const value = lb ? Math.round(pick.value * 0.45359237 * 10) / 10 : pick.value;
    return { kind, fields: { value }, confidence: /kg|lb/i.test(text) ? "medium" : "low", notes: [...notes], needsConfirmation: true };
  }

  if (kind === "temperature") {
    const f = /°?\s?F\b/.test(text) && !/°?\s?C\b/.test(text);
    const pick = nums.find((n) => (f ? inRange(n.value, 86, 113) : inRange(n.value, 30, 45)));
    if (!pick) return empty(kind, notes);
    if (f) notes.add("converted_from_fahrenheit");
    const value = f ? Math.round(((pick.value - 32) * 5) / 9 * 10) / 10 : pick.value;
    return { kind, fields: { value }, confidence: /°|C\b|F\b/.test(text) ? "medium" : "low", notes: [...notes], needsConfirmation: true };
  }

  if (kind === "spo2") {
    const pick = nums.find((n) => !n.isDecimal && inRange(n.value, 50, 100));
    if (!pick) return empty(kind, notes);
    return { kind, fields: { value: pick.value }, confidence: /spo|%/i.test(text) ? "medium" : "low", notes: [...notes], needsConfirmation: true };
  }

  const pick = nums.find((n) => !n.isDecimal && inRange(n.value, 20, 300));
  if (!pick) return empty(kind, notes);
  return { kind, fields: { value: pick.value }, confidence: "low", notes: [...notes], needsConfirmation: true };
}

/**
 * The note shown when a reading is confirmed. Which cuff types draw the "less reliable" note is PROPOSED configuration
 * (`devices.photo_capture`); the caller passes it in so this file holds no clinical value. The wording is a CMO item.
 */
export function cuffReliabilityNote(cuff: CuffType | undefined, lessReliableTypes: readonly string[]): "less_reliable" | "prefer_upper_arm" | null {
  if (cuff === undefined) return null;
  if (lessReliableTypes.includes(cuff)) return "less_reliable";
  if (cuff === "not_sure") return "prefer_upper_arm";
  return null;
}

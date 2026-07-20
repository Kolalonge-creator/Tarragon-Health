import { mgDlToMmolL } from "@tarragon/shared";
import type { VitalsReadingInput } from "@/lib/validation/vitals";

export type CrosscheckDirection = "high" | "low";

export type VitalCrosscheck = {
  /** Which side of the normal band the value fell on. */
  direction: CrosscheckDirection;
  /** Warm, non-alarming prompt asking the patient to confirm the value. */
  message: string;
  /** Practical tips for taking a more accurate reading of this vital. */
  tips: string[];
};

const BP_TIPS = [
  "Sit and rest for 5 minutes first, with your feet flat on the floor and your back supported.",
  "Rest your arm on a table so the cuff sits level with your heart.",
  "Put the cuff on bare skin, not over clothing, and use the right cuff size.",
  "Avoid caffeine, food, or smoking for 30 minutes before measuring.",
  "Stay still and don't talk during the reading, then take a second reading after 1–2 minutes and compare.",
];

const GLUCOSE_TIPS = [
  "Wash and dry your hands first — food or sugar on your skin can throw the result off.",
  "Check the strips aren't expired and the meter is set up correctly.",
  "Make sure your meter's unit (mmol/L or mg/dL) matches the one you picked here.",
  "Use a fresh drop of blood and take the reading again to compare.",
];

const PULSE_TIPS = [
  "Sit and rest for 5 minutes before counting.",
  "Count the beats for a full 60 seconds.",
  "Don't measure right after activity, caffeine, or a strong emotion.",
];

const TEMPERATURE_TIPS = [
  "Wait 15–30 minutes after a hot or cold drink, a bath, or exercise.",
  "Use the same site each time (mouth, ear, or armpit) and follow the thermometer's instructions.",
  "Take the reading again to confirm.",
];

const SPO2_TIPS = [
  "Warm your hands first — cold fingers can give a falsely low reading.",
  "Remove nail polish or false nails and rest your hand still on a table.",
  "Wait for the number to settle for a few seconds before reading it.",
];

const WEIGHT_TIPS = [
  "Use the same scale on a hard, flat floor.",
  "Weigh yourself at the same time of day, ideally in the morning.",
  "Take the reading again to confirm.",
];

/** Convert the form's glucose input to the canonical mmol/L used for banding. */
function glucoseMmolL(value: number, unit: "mmol_l" | "mg_dl"): number {
  return unit === "mg_dl" ? mgDlToMmolL(value) : value;
}

function build(direction: CrosscheckDirection, label: string, tips: string[]): VitalCrosscheck {
  const side = direction === "high" ? "higher" : "lower";
  return {
    direction,
    message: `This ${label} looks ${side} than usual. Please double-check it before saving.`,
    tips,
  };
}

/**
 * Advisory "please double-check" band — deliberately NARROWER than the hard
 * physiological limits enforced by vitalsReadingSchema, and deliberately NOT a
 * blocker. Returns null when the reading sits inside the normal band.
 *
 * When it returns a crosscheck the patient must still be able to save the
 * reading as-is: a genuinely abnormal value (real hypertensive BP, real low
 * SpO2, a real hypo) must always reach the record so the escalation pipeline
 * fires. This only nudges the patient to confirm the number is real rather
 * than a mis-measurement or a typo inside the accepted range, and shows them
 * how to take a cleaner reading next time.
 */
export function crosscheckVital(input: VitalsReadingInput): VitalCrosscheck | null {
  switch (input.vital_type) {
    case "blood_pressure": {
      if (input.systolic > 160 || input.diastolic > 100) {
        return build("high", "blood pressure reading", BP_TIPS);
      }
      if (input.systolic < 90 || input.diastolic < 60) {
        return build("low", "blood pressure reading", BP_TIPS);
      }
      return null;
    }
    case "glucose": {
      const mmol = glucoseMmolL(input.glucose_value, input.glucose_unit);
      if (mmol > 11.1) return build("high", "glucose reading", GLUCOSE_TIPS);
      if (mmol < 3.9) return build("low", "glucose reading", GLUCOSE_TIPS);
      return null;
    }
    case "pulse": {
      if (input.pulse_bpm > 110) return build("high", "pulse", PULSE_TIPS);
      if (input.pulse_bpm < 50) return build("low", "pulse", PULSE_TIPS);
      return null;
    }
    case "temperature": {
      if (input.temperature_c > 37.8) return build("high", "temperature", TEMPERATURE_TIPS);
      if (input.temperature_c < 35.8) return build("low", "temperature", TEMPERATURE_TIPS);
      return null;
    }
    case "spo2": {
      if (input.spo2_pct < 94) return build("low", "oxygen level", SPO2_TIPS);
      return null;
    }
    case "weight": {
      if (input.weight_kg > 180) return build("high", "weight", WEIGHT_TIPS);
      if (input.weight_kg < 35) return build("low", "weight", WEIGHT_TIPS);
      return null;
    }
  }
}

import type { GlucoseUnit } from "@/lib/validation/vitals";

/**
 * Advisory "please cross-check this reading" layer for patient-entered vitals.
 *
 * This is deliberately SEPARATE from the hard validation bounds in
 * lib/validation/vitals.ts. Those bounds reject physically-impossible entries
 * outright; this layer sits *inside* them and only nudges. When a value is
 * plausible but unusual (very high/low, or a likely mis-type or bad-technique
 * reading), we ask the patient to double-check and show them how to take a
 * better reading — but we never block or discard it. A genuinely abnormal
 * reading a patient confirms must still be saved and flow through the normal
 * assessment/escalation logic (CLAUDE.md: never silently swallow an abnormal
 * result). The prompt is a confirmation, not a gate.
 */

export type ReadingCheckInput =
  | { vitalType: "blood_pressure"; systolic: number; diastolic: number }
  | { vitalType: "glucose"; value: number; unit: GlucoseUnit }
  | { vitalType: "weight"; weightKg: number }
  | { vitalType: "pulse"; pulseBpm: number }
  | { vitalType: "temperature"; temperatureC: number }
  | { vitalType: "spo2"; spo2Pct: number };

export type ReadingCheckResult =
  | { status: "ok" }
  | { status: "recheck"; heading: string; message: string; tips: readonly string[] };

/**
 * Expected/typical ranges. A value outside these (but still within the hard
 * validation bounds) triggers a cross-check prompt. These are intentionally
 * wide — they flag clearly-unusual values, not every out-of-target reading, to
 * keep the nudge low-noise for chronic patients whose numbers legitimately run
 * high.
 */
const EXPECTED = {
  systolic: { min: 90, max: 180 },
  diastolic: { min: 55, max: 110 },
  glucose_mmol_l: { min: 3.5, max: 20 },
  glucose_mg_dl: { min: 63, max: 360 },
  weight_kg: { min: 35, max: 200 },
  pulse_bpm: { min: 45, max: 130 },
  temperature_c: { min: 35.8, max: 39.5 },
  spo2_pct: { min: 92, max: 100 },
} as const;

const TIPS = {
  blood_pressure: [
    "Rest quietly for 5 minutes before measuring, and don't talk during the reading.",
    "Sit with your back supported, feet flat on the floor and legs uncrossed.",
    "Rest your arm on a table so the cuff is level with your heart, and use the right cuff size.",
    "Take two readings a minute apart and log the second one.",
  ],
  glucose: [
    "Wash and dry your hands first — food or cream on a finger can skew the result.",
    "Use a fresh lancet and make sure the drop of blood fully covers the strip.",
    "Check the strips aren't expired and the meter's unit (mmol/L or mg/dL) matches what you're entering.",
    "Note whether it was fasting, random or after a meal.",
  ],
  weight: [
    "Weigh on a hard, flat surface — not a rug or carpet.",
    "Use the same scale at a similar time of day, in light clothing.",
    "Double-check you're entering kilograms, not pounds.",
  ],
  pulse: [
    "Sit and rest for a few minutes first.",
    "Avoid caffeine, smoking or exercise just beforehand.",
    "Count the beats for a full 60 seconds.",
  ],
  temperature: [
    "Wait 15–30 minutes after eating, drinking or exercising.",
    "Follow your thermometer's instructions for where to place it and how long to wait.",
    "Check you're entering degrees Celsius.",
  ],
  spo2: [
    "Warm your hands and sit still — cold hands give low readings.",
    "Remove any nail polish or false nails from the finger you use.",
    "Let the number settle for several seconds before reading it.",
  ],
} as const;

const HEADING = "Let's double-check that reading";

function outsideMessage(
  label: string,
  num: number,
  display: string,
  range: { min: number; max: number }
): string | null {
  if (Number.isNaN(num)) return null;
  if (num < range.min) return `${label} of ${display} is lower than we usually see.`;
  if (num > range.max) return `${label} of ${display} is higher than we usually see.`;
  return null;
}

/**
 * Returns whether a freshly-entered reading is worth cross-checking. Callers
 * treat "recheck" as an "are you sure?" confirmation, never a rejection.
 */
export function checkVitalReading(input: ReadingCheckInput): ReadingCheckResult {
  switch (input.vitalType) {
    case "blood_pressure": {
      // A systolic at or below the diastolic is almost always a mis-type or
      // swapped pair — surface it before anything else.
      if (input.systolic <= input.diastolic) {
        return {
          status: "recheck",
          heading: HEADING,
          message: `Systolic (${input.systolic}) should be higher than diastolic (${input.diastolic}) — it looks like the two numbers may have been swapped.`,
          tips: TIPS.blood_pressure,
        };
      }
      const messages = [
        outsideMessage("A top number (systolic)", input.systolic, `${input.systolic}`, EXPECTED.systolic),
        outsideMessage("A bottom number (diastolic)", input.diastolic, `${input.diastolic}`, EXPECTED.diastolic),
      ].filter((m): m is string => m !== null);
      if (messages.length === 0) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message: messages.join(" "), tips: TIPS.blood_pressure };
    }
    case "glucose": {
      const range = input.unit === "mmol_l" ? EXPECTED.glucose_mmol_l : EXPECTED.glucose_mg_dl;
      const unitLabel = input.unit === "mmol_l" ? "mmol/L" : "mg/dL";
      const message = outsideMessage("A glucose", input.value, `${input.value} ${unitLabel}`, range);
      if (!message) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message, tips: TIPS.glucose };
    }
    case "weight": {
      const message = outsideMessage("A weight", input.weightKg, `${input.weightKg} kg`, EXPECTED.weight_kg);
      if (!message) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message, tips: TIPS.weight };
    }
    case "pulse": {
      const message = outsideMessage("A pulse", input.pulseBpm, `${input.pulseBpm} bpm`, EXPECTED.pulse_bpm);
      if (!message) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message, tips: TIPS.pulse };
    }
    case "temperature": {
      const message = outsideMessage("A temperature", input.temperatureC, `${input.temperatureC}°C`, EXPECTED.temperature_c);
      if (!message) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message, tips: TIPS.temperature };
    }
    case "spo2": {
      const message = outsideMessage("An oxygen level (SpO2)", input.spo2Pct, `${input.spo2Pct}%`, EXPECTED.spo2_pct);
      if (!message) return { status: "ok" };
      return { status: "recheck", heading: HEADING, message, tips: TIPS.spo2 };
    }
  }
}

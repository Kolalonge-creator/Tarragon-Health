import { classifyBpLevel, BP_LEVEL_LABEL } from "@/lib/rules/bp-classification";
import { classifySpo2Level, SPO2_LEVEL_LABEL } from "@/lib/rules/spo2-classification";
import { classifyPulseLevel, PULSE_LEVEL_LABEL } from "@/lib/rules/pulse-classification";
import { classifyTemperatureLevel, TEMPERATURE_LEVEL_LABEL } from "@/lib/rules/temperature-classification";
import type { VitalLevel } from "@/lib/rules/vital-level-style";

export interface ReadingStatusInput {
  vital_type: string;
  systolic?: number | null;
  diastolic?: number | null;
  spo2_pct?: number | null;
  pulse_bpm?: number | null;
  temperature_c?: number | null;
}

export interface ReadingStatusResult {
  level: Exclude<VitalLevel, "unknown">;
  /** The plain word shown next to the number. Comes from the existing per-vital label maps, never invented here. */
  word: string;
}

/**
 * Design principle 2: one place that turns a stored reading into its status (level + plain word).
 *
 * Presentation only. It calls the same per-vital classifiers the history already used (the TS mirrors of the authoritative database
 * classifiers) and reads the words from their existing label maps. It adds NO threshold and NO wording. Glucose is deliberately absent:
 * its single-reading classifier exists (`classifyLatestGlucoseLevel`) but no patient-facing word set has been signed, so a glucose reading
 * returns null here and the caller shows the number alone (see docs/design/design-principles-audit-2026-10.md and OQ-DP-01).
 */
export function readingStatus(reading: ReadingStatusInput): ReadingStatusResult | null {
  switch (reading.vital_type) {
    case "blood_pressure": {
      const level = classifyBpLevel(reading.systolic, reading.diastolic);
      return level === "unknown" ? null : { level, word: BP_LEVEL_LABEL[level] };
    }
    case "spo2": {
      const level = classifySpo2Level(reading.spo2_pct);
      return level === "unknown" ? null : { level, word: SPO2_LEVEL_LABEL[level] };
    }
    case "pulse": {
      const level = classifyPulseLevel(reading.pulse_bpm);
      return level === "unknown" ? null : { level, word: PULSE_LEVEL_LABEL[level] };
    }
    case "temperature": {
      const level = classifyTemperatureLevel(reading.temperature_c);
      return level === "unknown" ? null : { level, word: TEMPERATURE_LEVEL_LABEL[level] };
    }
    default:
      return null;
  }
}

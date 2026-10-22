import { describe, expect, it } from "@jest/globals";
import { readingStatus } from "./reading-status";
import { BP_LEVEL_LABEL } from "@/lib/rules/bp-classification";
import { SPO2_LEVEL_LABEL } from "@/lib/rules/spo2-classification";
import { PULSE_LEVEL_LABEL } from "@/lib/rules/pulse-classification";
import { TEMPERATURE_LEVEL_LABEL } from "@/lib/rules/temperature-classification";

describe("readingStatus (design principle 2: a number always has a word)", () => {
  it("uses the existing BP classifier and its existing words", () => {
    expect(readingStatus({ vital_type: "blood_pressure", systolic: 120, diastolic: 80 })).toEqual({ level: "green", word: BP_LEVEL_LABEL.green });
    expect(readingStatus({ vital_type: "blood_pressure", systolic: 140, diastolic: 80 })).toEqual({ level: "amber", word: BP_LEVEL_LABEL.amber });
    expect(readingStatus({ vital_type: "blood_pressure", systolic: 165, diastolic: 90 })).toEqual({ level: "red", word: BP_LEVEL_LABEL.red });
    expect(readingStatus({ vital_type: "blood_pressure", systolic: 205, diastolic: 90 })).toEqual({ level: "emergency", word: BP_LEVEL_LABEL.emergency });
  });

  it("covers oxygen, pulse and temperature with their existing label maps", () => {
    const spo2 = readingStatus({ vital_type: "spo2", spo2_pct: 98 });
    expect(spo2?.word).toBe(SPO2_LEVEL_LABEL[spo2!.level]);
    const pulse = readingStatus({ vital_type: "pulse", pulse_bpm: 72 });
    expect(pulse?.word).toBe(PULSE_LEVEL_LABEL[pulse!.level]);
    const temp = readingStatus({ vital_type: "temperature", temperature_c: 36.8 });
    expect(temp?.word).toBe(TEMPERATURE_LEVEL_LABEL[temp!.level]);
  });

  it("returns null (number shown alone) when the value is missing or the vital has no signed word set", () => {
    expect(readingStatus({ vital_type: "blood_pressure", systolic: null, diastolic: 80 })).toBeNull();
    expect(readingStatus({ vital_type: "glucose" })).toBeNull();
    expect(readingStatus({ vital_type: "weight" })).toBeNull();
  });

  it("never returns an empty word", () => {
    for (const r of [
      { vital_type: "blood_pressure", systolic: 118, diastolic: 76 },
      { vital_type: "spo2", spo2_pct: 88 },
      { vital_type: "pulse", pulse_bpm: 150 },
      { vital_type: "temperature", temperature_c: 39.5 },
    ]) {
      expect(readingStatus(r)?.word.trim().length).toBeGreaterThan(0);
    }
  });
});

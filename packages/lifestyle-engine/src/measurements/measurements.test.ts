import { describe, it, expect } from "@jest/globals";
import { validateMeasurement } from "./index";

const base = { unit: "x", takenAt: "2026-07-19T09:00:00.000Z", source: "app" as const };

describe("measurement validation (spec §8.2)", () => {
  it("accepts a plausible BP", () => {
    expect(
      validateMeasurement({ ...base, type: "bp", unit: "mmHg", valueJson: { sys: 122, dia: 80 } }).ok,
    ).toBe(true);
  });

  it("rejects sys <= dia", () => {
    const r = validateMeasurement({ ...base, type: "bp", unit: "mmHg", valueJson: { sys: 80, dia: 90 } });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("bp_sys_not_gt_dia");
  });

  it("rejects an implausible weight (never silently dropped)", () => {
    expect(validateMeasurement({ ...base, type: "weight", unit: "kg", valueNum: 900 }).ok).toBe(false);
  });

  it("HARD RULE: a whatsapp source is rejected", () => {
    const r = validateMeasurement({ ...base, source: "whatsapp", type: "weight", unit: "kg", valueNum: 80 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("whatsapp_is_not_a_log_source");
  });

  it("rejects a payload with neither valueNum nor valueJson", () => {
    expect(validateMeasurement({ ...base, type: "steps", unit: "steps" }).ok).toBe(false);
  });
});

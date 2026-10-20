import { en, type MessageKey } from "@tarragon/i18n";
import { observationLimit } from "@tarragon/shared";
import { buildLifestyleEntry, INHALER_REASONS, LIFESTYLE_KINDS } from "./lifestyle-entry";
import { BP_BOUNDS, GLUCOSE_BOUNDS, OTHER_VITAL_BOUNDS, validateOtherEntry } from "./vitals-entry";

describe("water, sleep, mood and inhaler entries (S47a)", () => {
  it("builds the payload the server route expects", () => {
    expect(buildLifestyleEntry("water_ml", "250")).toEqual({ ok: true, payload: { vital_type: "water_ml", water_ml: 250 }, warn: null });
    expect(buildLifestyleEntry("sleep_hours", "7,5")).toEqual({ ok: true, payload: { vital_type: "sleep_hours", sleep_hours: 7.5 }, warn: null });
    expect(buildLifestyleEntry("mood", "4")).toEqual({ ok: true, payload: { vital_type: "mood", mood: 4 }, warn: null });
    expect(buildLifestyleEntry("inhaler_use", "2", "before_exercise")).toEqual({
      ok: true,
      payload: { vital_type: "inhaler_use", puffs: 2, reason: "before_exercise" },
      warn: null,
    });
  });

  it("refuses an impossible number with a plain sentence that exists in English", () => {
    for (const [kind, raw] of [
      ["water_ml", "5000"],
      ["water_ml", "2.5"],
      ["sleep_hours", "30"],
      ["mood", "6"],
      ["mood", "2.5"],
      ["inhaler_use", "25"],
    ] as const) {
      const r = buildLifestyleEntry(kind, raw, "other");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(en[r.errorKey as MessageKey]).toBeTruthy();
    }
    const nan = buildLifestyleEntry("water_ml", "abc");
    expect(nan).toEqual({ ok: false, errorKey: "vitals.other.error.number" });
  });

  it("an unusual number asks for a second tap and is never refused", () => {
    const water = buildLifestyleEntry("water_ml", "2000");
    expect(water.ok && water.warn).toBe("observation.confirm.water_ml_high");
    const sleep = buildLifestyleEntry("sleep_hours", "1");
    expect(sleep.ok && sleep.warn).toBe("observation.confirm.sleep_hours_low");
    const puffs = buildLifestyleEntry("inhaler_use", "12", "other");
    expect(puffs.ok && puffs.warn).toBe("observation.confirm.inhaler_puffs_high");
  });

  it("the inhaler needs a reason, so a rescue dose is never confused with a routine one", () => {
    expect(buildLifestyleEntry("inhaler_use", "2")).toEqual({ ok: false, errorKey: "observation.inhaler.reason_required" });
  });

  it("every translation key the sheet can ask for exists", () => {
    const keys: string[] = [
      ...LIFESTYLE_KINDS.map((k) => `observation.type.${k}`),
      ...INHALER_REASONS.map((r) => `observation.inhaler.reason.${r}`),
      "observation.inhaler.reason_group",
      "observation.inhaler.reason_required",
      "observation.mood_label",
      "observation.mood_hint",
      "observation.confirm.water_ml_high",
      "observation.confirm.sleep_hours_low",
      "observation.confirm.sleep_hours_high",
      "observation.confirm.inhaler_puffs_high",
      "observation.range.water_ml",
      "observation.range.sleep_hours",
      "observation.range.mood",
      "observation.range.inhaler_puffs",
    ];
    for (const k of keys) expect(en[k as MessageKey]).toBeTruthy();
  });

  it("copy has no em dash", () => {
    for (const [key, value] of Object.entries(en)) {
      if (key.startsWith("observation.range.") || key.startsWith("observation.inhaler.") || key.startsWith("observation.changed.")) expect(value).not.toContain("—");
    }
  });
});

describe("the phone's typo gates follow the versioned config (S47a)", () => {
  it("BP, glucose and the other vitals read their bounds from observations.plausibility", () => {
    expect(BP_BOUNDS.systolic).toEqual({ min: observationLimit("systolic_mmhg").min, max: observationLimit("systolic_mmhg").max });
    expect(BP_BOUNDS.diastolic.max).toBe(observationLimit("diastolic_mmhg").max);
    expect(GLUCOSE_BOUNDS.mmol_l.max).toBe(observationLimit("glucose_mmol_l").max);
    expect(GLUCOSE_BOUNDS.mg_dl.max).toBe(observationLimit("glucose_mg_dl").max);
    expect(OTHER_VITAL_BOUNDS.weight.min).toBe(observationLimit("weight_kg").min);
    expect(OTHER_VITAL_BOUNDS.spo2.min).toBe(observationLimit("spo2_pct").min);
  });

  it("acceptance: an implausible glucose is rejected with a message, and a true severe low is still enterable", () => {
    const high = validateOtherEntry("glucose", "400", "mmol_l");
    expect(high).toEqual({ ok: false, error: "range_glucose_mmol" });
    expect(en["vitals.other.error.range_glucose_mmol"]).toContain("mg/dL");
    expect(validateOtherEntry("glucose", "0.4", "mmol_l")).toEqual({ ok: false, error: "range_glucose_mmol" });
    expect(validateOtherEntry("glucose", "1.5", "mmol_l")).toEqual({ ok: true, value: 1.5 });
  });
});

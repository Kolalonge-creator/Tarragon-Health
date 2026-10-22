import { describe, expect, it } from "@jest/globals";
import {
  DEFAULT_HOME_PINS,
  HOME_PIN_GROUP,
  HOME_PIN_KEYS,
  HOME_PIN_LABEL,
  HOME_PIN_VITAL_TYPE,
  HOME_PIN_VITAL_COLUMN,
  HOME_PIN_NEVER_FROM_WEARABLE,
  homePinVitalDisplay,
  isHomeValuePin,
  MAX_HOME_PINS,
  isHomeVitalPin,
  lockedHomePins,
  movePin,
  resolveHomePins,
  sanitizeHomePins,
  togglePin,
} from "./home-pins";

const NO_MEDS = { activeMedicationCount: 0 };
const ON_MEDS = { activeMedicationCount: 2 };

describe("catalogue", () => {
  it("has a group and a label for every key, and no duplicate keys", () => {
    expect(new Set(HOME_PIN_KEYS).size).toBe(HOME_PIN_KEYS.length);
    for (const key of HOME_PIN_KEYS) {
      expect(HOME_PIN_GROUP[key]).toBeDefined();
      expect(HOME_PIN_LABEL[key].length).toBeGreaterThan(0);
    }
  });

  it("defaults are real keys and start with vitals and medications", () => {
    for (const key of DEFAULT_HOME_PINS) expect(HOME_PIN_KEYS).toContain(key);
    expect(DEFAULT_HOME_PINS.every((k) => ["vitals", "medications"].includes(HOME_PIN_GROUP[k]))).toBe(true);
  });

  it("every vitals-group pin has a vital type, and only those", () => {
    for (const key of HOME_PIN_KEYS) {
      expect(isHomeVitalPin(key)).toBe(HOME_PIN_GROUP[key] === "vitals");
    }
    expect(Object.keys(HOME_PIN_VITAL_TYPE).sort()).toEqual(
      HOME_PIN_KEYS.filter((k) => HOME_PIN_GROUP[k] === "vitals").sort(),
    );
  });
});

describe("sanitizeHomePins", () => {
  it("drops unknown keys and duplicates, keeping the first", () => {
    expect(sanitizeHomePins(["bp", "nope", "glucose", "bp", 7, null])).toEqual(["bp", "glucose"]);
  });

  it("returns an empty list for anything that is not an array", () => {
    expect(sanitizeHomePins(null)).toEqual([]);
    expect(sanitizeHomePins("bp")).toEqual([]);
    expect(sanitizeHomePins({})).toEqual([]);
  });

  it("caps the list", () => {
    expect(sanitizeHomePins(HOME_PIN_KEYS).length).toBe(MAX_HOME_PINS);
  });
});

describe("resolveHomePins", () => {
  it("gives the defaults to someone who has never customised", () => {
    expect(resolveHomePins(null, NO_MEDS)).toEqual([...DEFAULT_HOME_PINS]);
    expect(resolveHomePins(undefined, NO_MEDS)).toEqual([...DEFAULT_HOME_PINS]);
  });

  it("uses the caller's defaults when nothing is saved, but never over a saved list", () => {
    expect(resolveHomePins(null, NO_MEDS, ["bp"])).toEqual(["bp"]);
    expect(resolveHomePins(["sleep"], NO_MEDS, ["bp"])).toEqual(["sleep"]);
    expect(resolveHomePins(null, ON_MEDS, ["bp"])).toEqual(["bp", "doses_today"]);
  });

  it("respects an empty saved list when nothing is locked", () => {
    expect(resolveHomePins([], NO_MEDS)).toEqual([]);
  });

  it("always brings back a locked pin that a saved list left out", () => {
    expect(resolveHomePins(["bp"], ON_MEDS)).toEqual(["bp", "doses_today"]);
    expect(resolveHomePins([], ON_MEDS)).toEqual(["doses_today"]);
  });

  it("does not duplicate a locked pin that is already there", () => {
    expect(resolveHomePins(["doses_today", "bp"], ON_MEDS)).toEqual(["doses_today", "bp"]);
  });

  it("brings back a monitored vital's pin that the saved list left out", () => {
    expect(resolveHomePins(["sleep"], { activeMedicationCount: 0, monitoredVitals: ["blood_pressure"] })).toEqual(["sleep", "bp"]);
    expect(resolveHomePins(null, { activeMedicationCount: 0, monitoredVitals: ["blood_pressure"] })).toEqual([...DEFAULT_HOME_PINS]);
  });

  it("keeps the locked pin even when the saved list is full", () => {
    const full = HOME_PIN_KEYS.filter((k) => k !== "doses_today").slice(0, MAX_HOME_PINS);
    const out = resolveHomePins(full, ON_MEDS);
    expect(out.length).toBe(MAX_HOME_PINS);
    expect(out).toContain("doses_today");
  });

  it("ignores junk in a saved list", () => {
    expect(resolveHomePins(["sleep", "wat"], NO_MEDS)).toEqual(["sleep"]);
  });
});

describe("lockedHomePins", () => {
  it("locks today's doses only for someone taking a medication", () => {
    expect(lockedHomePins(NO_MEDS)).toEqual([]);
    expect(lockedHomePins(ON_MEDS)).toEqual(["doses_today"]);
  });

  it("locks the tile for each vital the patient's programme monitors", () => {
    expect(lockedHomePins({ activeMedicationCount: 0, monitoredVitals: ["blood_pressure"] })).toEqual(["bp"]);
    expect(lockedHomePins({ activeMedicationCount: 0, monitoredVitals: ["glucose", "weight"] })).toEqual(["glucose", "weight"]);
  });

  it("combines programme vitals with today's doses", () => {
    expect(lockedHomePins({ activeMedicationCount: 1, monitoredVitals: ["blood_pressure"] })).toEqual(["bp", "doses_today"]);
  });

  it("ignores vitals that have no tile, and unknown values", () => {
    expect(lockedHomePins({ activeMedicationCount: 0, monitoredVitals: ["ketones", "mood", "nonsense"] })).toEqual([]);
  });
});

describe("togglePin", () => {
  it("adds at the end and removes", () => {
    expect(togglePin(["bp"], "sleep", [])).toEqual(["bp", "sleep"]);
    expect(togglePin(["bp", "sleep"], "bp", [])).toEqual(["sleep"]);
  });

  it("will not remove a locked pin", () => {
    expect(togglePin(["doses_today", "bp"], "doses_today", ["doses_today"])).toEqual(["doses_today", "bp"]);
  });

  it("will not go past the cap", () => {
    const full = HOME_PIN_KEYS.slice(0, MAX_HOME_PINS);
    const extra = HOME_PIN_KEYS[MAX_HOME_PINS];
    expect(extra).toBeDefined();
    expect(togglePin(full, extra!, [])).toEqual(full);
  });
});

describe("movePin", () => {
  it("swaps with its neighbour", () => {
    expect(movePin(["bp", "glucose", "sleep"], "glucose", "up")).toEqual(["glucose", "bp", "sleep"]);
    expect(movePin(["bp", "glucose", "sleep"], "glucose", "down")).toEqual(["bp", "sleep", "glucose"]);
  });

  it("leaves the list alone at either end or for an unknown pin", () => {
    expect(movePin(["bp", "glucose"], "bp", "up")).toEqual(["bp", "glucose"]);
    expect(movePin(["bp", "glucose"], "glucose", "down")).toEqual(["bp", "glucose"]);
    expect(movePin(["bp"], "sleep", "up")).toEqual(["bp"]);
  });
});

describe("homePinVitalDisplay", () => {
  it("shows weight and temperature to one decimal", () => {
    expect(homePinVitalDisplay("weight", 72)).toEqual({ value: "72.0", unit: "kg" });
    expect(homePinVitalDisplay("weight", 71.84)).toEqual({ value: "71.8", unit: "kg" });
    expect(homePinVitalDisplay("temperature", 36.65)).toEqual({ value: "36.7", unit: "\u00b0C" });
  });

  it("shows the other vitals as whole numbers with their unit", () => {
    expect(homePinVitalDisplay("pulse", 72.4)).toEqual({ value: "72", unit: "bpm" });
    expect(homePinVitalDisplay("spo2", 97)).toEqual({ value: "97", unit: "%" });
    expect(homePinVitalDisplay("waist", 88.2)).toEqual({ value: "88", unit: "cm" });
    expect(homePinVitalDisplay("peak_flow", 410)).toEqual({ value: "410", unit: "L/min" });
  });

  it("returns null rather than inventing a number", () => {
    expect(homePinVitalDisplay("weight", null)).toBeNull();
    expect(homePinVitalDisplay("weight", undefined)).toBeNull();
    expect(homePinVitalDisplay("pulse", "72")).toBeNull();
    expect(homePinVitalDisplay("pulse", Number.NaN)).toBeNull();
  });

  it("covers exactly the vitals pins that have a single value column", () => {
    const valuePins = HOME_PIN_KEYS.filter(isHomeValuePin).sort();
    expect(valuePins).toEqual(Object.keys(HOME_PIN_VITAL_COLUMN).sort());
    // blood pressure and glucose are read separately, so they are the only vitals pins left out
    expect(HOME_PIN_KEYS.filter((k) => HOME_PIN_GROUP[k] === "vitals" && !isHomeValuePin(k)).sort()).toEqual(["bp", "glucose"]);
  });

  it("never takes a wearable's estimate for pulse, oxygen or temperature", () => {
    expect([...HOME_PIN_NEVER_FROM_WEARABLE].sort()).toEqual(["pulse", "spo2", "temperature"]);
  });
});

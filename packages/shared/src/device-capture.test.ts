import { describe, expect, it } from "@jest/globals";
import { correctDigitLookalikes, cuffReliabilityNote, parseDeviceScreenText } from "./device-capture";

describe("photo reading: parsing recognised text", () => {
  it("reads a labelled blood pressure screen", () => {
    const r = parseDeviceScreenText(["SYS mmHg 128", "DIA mmHg 82", "PUL /min 71"], "blood_pressure");
    expect(r.fields).toEqual({ systolic: 128, diastolic: 82, pulse: 71 });
    expect(r.confidence).toBe("medium");
    expect(r.needsConfirmation).toBe(true);
  });
  it("guesses the order on an unlabelled screen and says so, at low confidence", () => {
    const r = parseDeviceScreenText(["142", "91", "66"], "blood_pressure");
    expect(r.fields).toEqual({ systolic: 142, diastolic: 91, pulse: 66 });
    expect(r.confidence).toBe("low");
    expect(r.notes).toContain("order_guessed");
  });
  it("corrects letters a seven-segment display is read as", () => {
    const r = parseDeviceScreenText(["SYS I28", "DIA 8Z", "PUL 7I"], "blood_pressure");
    expect(r.fields.systolic).toBe(128);
    expect(r.fields.diastolic).toBe(82);
    expect(r.notes).toContain("ocr_letters_corrected");
  });
  it("leaves words alone and never invents digits from them", () => {
    expect(correctDigitLookalikes("SYS")).toEqual({ text: "SYS", changed: false });
    expect(correctDigitLookalikes("I28")).toEqual({ text: "128", changed: true });
    expect(parseDeviceScreenText(["SYSTOLIC DIASTOLIC"], "blood_pressure").confidence).toBe("none");
  });
  it("does not accept a systolic that is not above the diastolic", () => {
    const r = parseDeviceScreenText(["SYS 80", "DIA 120"], "blood_pressure");
    expect(r.confidence).toBe("low");
    expect(r.notes).toContain("ambiguous_numbers");
    expect(r.fields.systolic).toBeUndefined();
  });
  it("returns nothing for text with no numbers, so the screen falls back to typing", () => {
    const r = parseDeviceScreenText(["Error", "Low battery"], "blood_pressure");
    expect(r.confidence).toBe("none");
    expect(r.fields).toEqual({});
    expect(r.notes).toContain("no_numbers_found");
  });
  it("reads glucose with an explicit unit at medium confidence", () => {
    const a = parseDeviceScreenText(["5.6", "mmol/L"], "glucose");
    expect(a.fields.value).toBe(5.6);
    expect(a.glucoseUnit).toBe("mmol_l");
    expect(a.confidence).toBe("medium");
    const b = parseDeviceScreenText(["104 mg/dL"], "glucose");
    expect(b.glucoseUnit).toBe("mg_dl");
    expect(b.fields.value).toBe(104);
  });
  it("guesses a glucose unit from the shape of the number and marks it low confidence", () => {
    expect(parseDeviceScreenText(["6.2"], "glucose")).toMatchObject({ glucoseUnit: "mmol_l", confidence: "low" });
    expect(parseDeviceScreenText(["112"], "glucose")).toMatchObject({ glucoseUnit: "mg_dl", confidence: "low" });
    const unclear = parseDeviceScreenText(["25"], "glucose");
    expect(unclear.notes).toContain("unit_unclear");
    expect(unclear.glucoseUnit).toBeUndefined();
  });
  it("converts pounds and Fahrenheit and records that it did", () => {
    const w = parseDeviceScreenText(["165.0 lb"], "weight");
    expect(w.fields.value).toBe(74.8);
    expect(w.notes).toContain("converted_from_pounds");
    const t = parseDeviceScreenText(["101.3 F"], "temperature");
    expect(t.fields.value).toBe(38.5);
    expect(t.notes).toContain("converted_from_fahrenheit");
  });
  it("reads oxygen and pulse, whole numbers only", () => {
    expect(parseDeviceScreenText(["SpO2 97 %"], "spo2").fields.value).toBe(97);
    expect(parseDeviceScreenText(["97.5"], "spo2").confidence).toBe("none");
    expect(parseDeviceScreenText(["72"], "pulse").fields.value).toBe(72);
  });
  it("every result needs the patient's confirmation and none claims high confidence", () => {
    const kinds = ["blood_pressure", "glucose", "weight", "temperature", "spo2", "pulse"] as const;
    for (const k of kinds) {
      const r = parseDeviceScreenText(["120", "80", "70", "mmol/L kg C %"], k);
      expect(r.needsConfirmation).toBe(true);
      expect(["none", "low", "medium"]).toContain(r.confidence);
    }
  });
});

describe("photo reading: cuff note", () => {
  it("uses the configured list, not a hard-coded cuff type", () => {
    expect(cuffReliabilityNote("wrist", ["wrist"])).toBe("less_reliable");
    expect(cuffReliabilityNote("wrist", [])).toBeNull();
    expect(cuffReliabilityNote("upper_arm", ["wrist"])).toBeNull();
    expect(cuffReliabilityNote("not_sure", ["wrist"])).toBe("prefer_upper_arm");
    expect(cuffReliabilityNote(undefined, ["wrist"])).toBeNull();
  });
});

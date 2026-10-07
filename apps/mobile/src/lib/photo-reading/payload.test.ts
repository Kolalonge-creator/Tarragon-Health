import { describe, expect, it } from "@jest/globals";
import { buildPhotoPayload, type PhotoFormInput } from "./payload";
import { getScreenTextRecognizer, recognizeScreenText, registerScreenTextRecognizer } from "./recognizer";

const base: PhotoFormInput = {
  kind: "blood_pressure",
  systolic: "128",
  diastolic: "82",
  pulse: "",
  value: "",
  glucoseUnit: "mmol_l",
  glucoseContext: "random",
  confirmedMatches: true,
};

describe("photo reading payload", () => {
  it("refuses to build anything until the patient has confirmed the numbers match the screen", () => {
    expect(buildPhotoPayload({ ...base, confirmedMatches: false })).toEqual({ ok: false, error: "not_confirmed" });
  });
  it("labels a confirmed blood pressure as a photo capture and keeps the cuff type", () => {
    const r = buildPhotoPayload({ ...base, cuffType: "wrist" });
    expect(r).toEqual({ ok: true, payload: { vital_type: "blood_pressure", systolic: 128, diastolic: 82, cuff_type: "wrist", capture_method: "photo" } });
  });
  it("applies the same bounds as typed entry", () => {
    expect(buildPhotoPayload({ ...base, systolic: "300" })).toEqual({ ok: false, error: "range" });
    expect(buildPhotoPayload({ ...base, systolic: "80", diastolic: "90" })).toEqual({ ok: false, error: "order" });
    expect(buildPhotoPayload({ ...base, systolic: "abc" })).toEqual({ ok: false, error: "numbers" });
    expect(buildPhotoPayload({ ...base, kind: "weight", value: "5" })).toEqual({ ok: false, error: "value_range" });
  });
  it("a crisis-range blood pressure is accepted, so it can reach the emergency path (it is never a typo gate)", () => {
    const r = buildPhotoPayload({ ...base, systolic: "215", diastolic: "125" });
    expect(r.ok).toBe(true);
  });
  it("builds each other kind with the photo label", () => {
    expect(buildPhotoPayload({ ...base, kind: "glucose", value: "6.1" })).toEqual({
      ok: true,
      payload: { vital_type: "glucose", glucose_value: 6.1, glucose_unit: "mmol_l", glucose_context: "random", capture_method: "photo" },
    });
    expect(buildPhotoPayload({ ...base, kind: "weight", value: "74.8" })).toMatchObject({ ok: true, payload: { vital_type: "weight", weight_kg: 74.8, capture_method: "photo" } });
    expect(buildPhotoPayload({ ...base, kind: "temperature", value: "37.2" })).toMatchObject({ ok: true, payload: { vital_type: "temperature", capture_method: "photo" } });
    expect(buildPhotoPayload({ ...base, kind: "spo2", value: "97" })).toMatchObject({ ok: true, payload: { vital_type: "spo2", capture_method: "photo" } });
    expect(buildPhotoPayload({ ...base, kind: "pulse", value: "72" })).toMatchObject({ ok: true, payload: { vital_type: "pulse", capture_method: "photo" } });
  });
  it("never puts the image or its location in the payload", () => {
    const r = buildPhotoPayload({ ...base });
    expect(JSON.stringify(r)).not.toMatch(/uri|file:|image|base64/i);
  });
});

describe("screen text recognizer seam", () => {
  it("is unavailable until one is registered, so the screen falls back to typing", async () => {
    registerScreenTextRecognizer(null);
    expect(getScreenTextRecognizer()).toBeNull();
    expect(await recognizeScreenText("file:///photo.jpg")).toEqual({ kind: "unavailable" });
  });
  it("returns recognised lines when a recognizer works", async () => {
    registerScreenTextRecognizer({ id: "test", isAvailable: async () => true, recognize: async () => ["SYS 128", "DIA 82"] });
    expect(await recognizeScreenText("file:///photo.jpg")).toEqual({ kind: "text", lines: ["SYS 128", "DIA 82"] });
    registerScreenTextRecognizer(null);
  });
  it("treats a throwing, unavailable or empty recognizer as 'type it yourself', never an error", async () => {
    registerScreenTextRecognizer({ id: "boom", isAvailable: async () => true, recognize: async () => { throw new Error("native crash"); } });
    expect(await recognizeScreenText("x")).toEqual({ kind: "unavailable" });
    registerScreenTextRecognizer({ id: "off", isAvailable: async () => false, recognize: async () => ["1"] });
    expect(await recognizeScreenText("x")).toEqual({ kind: "unavailable" });
    registerScreenTextRecognizer({ id: "empty", isAvailable: async () => true, recognize: async () => [] });
    expect(await recognizeScreenText("x")).toEqual({ kind: "unavailable" });
    registerScreenTextRecognizer(null);
  });
});

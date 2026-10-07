import { describe, expect, it } from "@jest/globals";
import { classifyPlausibility, isInformationalSpo2 } from "./device-plausibility";
import { rankOf, resolveDuplicate, sourceBadgeLabel, sourceClassOf, type DedupeReading } from "./device-dedupe";
import { evaluateCgmSustained, severeLowMessage, type CgmSample } from "./cgm-events";
import { draftFromRecognisedText, finalisePhotoReading } from "./photo-reading";
import { DeviceSourceRegistry, type DeviceSource } from "./device-source";

describe("plausibility: impossible is held, extreme-but-possible is not", () => {
  it.each([
    [{ vitalType: "blood_pressure", systolic: 320, diastolic: 90 }, "systolic_range"],
    [{ vitalType: "blood_pressure", systolic: 39, diastolic: 30 }, "systolic_range"],
    [{ vitalType: "blood_pressure", systolic: 120, diastolic: 201 }, "diastolic_range"],
    [{ vitalType: "blood_pressure", systolic: 90, diastolic: 90 }, "systolic_not_above_diastolic"],
    [{ vitalType: "pulse", pulseBpm: 19 }, "pulse_range"],
    [{ vitalType: "pulse", pulseBpm: 251 }, "pulse_range"],
    [{ vitalType: "spo2", spo2Pct: 49 }, "spo2_range"],
    [{ vitalType: "spo2", spo2Pct: 101 }, "spo2_range"],
    [{ vitalType: "temperature", temperatureC: 29.9 }, "temperature_range"],
    [{ vitalType: "temperature", temperatureC: 44.1 }, "temperature_range"],
    [{ vitalType: "weight", weightKg: 19, ageYears: 40 }, "weight_range"],
    [{ vitalType: "weight", weightKg: 401, ageYears: 40 }, "weight_range"],
    [{ vitalType: "glucose", glucoseMmolL: 1.0 }, "glucose_range"],
    [{ vitalType: "glucose", glucoseMmolL: 55.1 }, "glucose_range"],
  ] as const)("holds %j", (c, reason) => {
    const r = classifyPlausibility(c);
    expect(r.class).toBe("impossible");
    expect(r.reasons).toContain(reason);
    expect(r.configVersion).toBeGreaterThanOrEqual(1);
  });

  it.each([
    { vitalType: "blood_pressure", systolic: 270, diastolic: 130 }, // a real crisis, above the typed-entry limit, still saved and triaged
    { vitalType: "blood_pressure", systolic: 50, diastolic: 30 },
    { vitalType: "pulse", pulseBpm: 30 },
    { vitalType: "pulse", pulseBpm: 200 },
    { vitalType: "spo2", spo2Pct: 60 },
    { vitalType: "temperature", temperatureC: 31 },
    { vitalType: "temperature", temperatureC: 43 },
    { vitalType: "glucose", glucoseMmolL: 1.5 },
    { vitalType: "glucose", glucoseMmolL: 40 },
  ] as const)("does not hold the extreme but possible %j", (c) => {
    expect(classifyPlausibility(c).class).toBe("ok");
  });

  it("never holds a child's or an unknown-age weight", () => {
    expect(classifyPlausibility({ vitalType: "weight", weightKg: 12, ageYears: 2 }).class).toBe("ok");
    expect(classifyPlausibility({ vitalType: "weight", weightKg: 12 }).class).toBe("ok");
    expect(classifyPlausibility({ vitalType: "weight", weightKg: 12, ageYears: 18 }).class).toBe("impossible");
  });

  it("wrist and aggregator SpO2 is informational; a paired fingertip oximeter is not", () => {
    expect(isInformationalSpo2("wearable")).toBe(true);
    expect(isInformationalSpo2("apple_health")).toBe(true);
    expect(isInformationalSpo2("device")).toBe(false);
    expect(isInformationalSpo2("manual")).toBe(false);
    expect(isInformationalSpo2("photo_confirmed")).toBe(false);
  });
});

const bp = (over: Partial<DedupeReading>): DedupeReading => ({
  vitalType: "blood_pressure", source: "device", sourceKey: "cuff-1", takenAt: "2026-10-07T09:00:00Z", systolic: 128, diastolic: 82, ...over,
});

describe("de-duplication across sources", () => {
  it("classifies sources, with Apple Health and Health Connect as phone mirrors", () => {
    expect(sourceClassOf({ source: "device" })).toBe("ble_device");
    expect(sourceClassOf({ source: "wearable", provider: "oura" })).toBe("vendor_cloud");
    expect(sourceClassOf({ source: "wearable", provider: "apple_health" })).toBe("phone_mirror");
    expect(sourceClassOf({ source: "wearable", provider: "android_health_connect" })).toBe("phone_mirror");
    expect(sourceClassOf({ source: "cgm" })).toBe("vendor_cloud");
    expect(sourceClassOf({ source: "photo_confirmed" })).toBe("photo_confirmed");
    expect(sourceClassOf({ source: "fhir_import" })).toBeNull();
    expect(rankOf("ble_device")).toBeLessThan(rankOf("vendor_cloud"));
    expect(rankOf("vendor_cloud")).toBeLessThan(rankOf("phone_mirror"));
    expect(rankOf("phone_mirror")).toBeLessThan(rankOf("manual"));
  });

  it("a BLE cuff reading and the same reading mirrored by the phone are one reading, and the cuff wins", () => {
    const mirror = bp({ source: "wearable", provider: "apple_health", sourceKey: "conn-1", takenAt: "2026-10-07T09:04:00Z", systolic: 129, diastolic: 81 });
    const r = resolveDuplicate(mirror, bp({}));
    expect(r).toEqual({ duplicate: true, canonical: "b" });
    expect(resolveDuplicate(bp({}), mirror)).toEqual({ duplicate: true, canonical: "a" });
  });

  it("windows and tolerances are exact: BP 10 minutes and 3 mmHg, glucose 5 minutes and 0.3", () => {
    const base = bp({ source: "manual", sourceKey: "m" });
    expect(resolveDuplicate(base, bp({ takenAt: "2026-10-07T09:10:00Z" })).duplicate).toBe(true);
    expect(resolveDuplicate(base, bp({ takenAt: "2026-10-07T09:10:01Z" })).reason).toBe("outside_window");
    expect(resolveDuplicate(base, bp({ systolic: 131 })).duplicate).toBe(true);
    expect(resolveDuplicate(base, bp({ systolic: 132 })).reason).toBe("outside_tolerance");
    const g = (over: Partial<DedupeReading>): DedupeReading => ({ vitalType: "glucose", source: "device", sourceKey: "gm", takenAt: "2026-10-07T09:00:00Z", glucoseMmolL: 6.0, ...over });
    expect(resolveDuplicate(g({}), g({ source: "cgm", sourceKey: "dex", takenAt: "2026-10-07T09:05:00Z", glucoseMmolL: 6.3 })).duplicate).toBe(true);
    expect(resolveDuplicate(g({}), g({ source: "cgm", sourceKey: "dex", takenAt: "2026-10-07T09:05:01Z" })).reason).toBe("outside_window");
    expect(resolveDuplicate(g({}), g({ source: "cgm", sourceKey: "dex", glucoseMmolL: 6.4 })).reason).toBe("outside_tolerance");
  });

  it("never merges two readings from the same source (a CGM stream is many similar values on purpose)", () => {
    const a = { vitalType: "glucose", source: "cgm", sourceKey: "dex", takenAt: "2026-10-07T09:00:00Z", glucoseMmolL: 6.0 };
    const b = { ...a, takenAt: "2026-10-07T09:03:00Z", glucoseMmolL: 6.1 };
    expect(resolveDuplicate(a, b).reason).toBe("same_source");
  });

  it("never merges across a triage band, so the worse of two readings is never hidden", () => {
    const g = (v: number, over: Partial<DedupeReading> = {}): DedupeReading => ({ vitalType: "glucose", source: "device", sourceKey: "gm", takenAt: "2026-10-07T09:00:00Z", glucoseMmolL: v, ...over });
    expect(resolveDuplicate(g(2.9), g(3.1, { source: "cgm", sourceKey: "dex" })).reason).toBe("different_triage_band");
    const bandOf = (r: DedupeReading) => ((r.systolic ?? 0) >= 160 ? "red" : "green");
    const lo = bp({ source: "wearable", provider: "oura", sourceKey: "c", systolic: 159, diastolic: 90 });
    const hi = bp({ systolic: 161, diastolic: 92 });
    expect(resolveDuplicate(lo, hi, bandOf).reason).toBe("different_triage_band");
  });

  it("leaves temperature, imported records and other people's vitals alone", () => {
    expect(resolveDuplicate(bp({ vitalType: "temperature" }), bp({ vitalType: "temperature", source: "manual" })).duplicate).toBe(false);
    expect(resolveDuplicate(bp({ source: "fhir_import" }), bp({ source: "manual" })).reason).toBe("not_deduplicated_source");
  });

  it("labels every source", () => {
    expect(sourceBadgeLabel("photo_confirmed")).toBe("Photo, confirmed by you");
    expect(sourceBadgeLabel("wearable")).toBe("Wearable estimate");
    expect(sourceBadgeLabel("device")).toBe("From your device");
    expect(sourceBadgeLabel(undefined)).toBe("Typed by you");
    expect(sourceBadgeLabel("something_new")).toBe("Other source");
  });
});

const stream = (values: number[], stepMin = 5, start = Date.parse("2026-10-07T00:00:00Z")): CgmSample[] =>
  values.map((v, i) => ({ takenAt: new Date(start + i * stepMin * 60_000).toISOString(), mmolL: v }));

describe("CGM sustained-event rules", () => {
  it("severe low needs 15 minutes below 3.0 with no big gap; shows the safety message at once", () => {
    const s = stream([2.8, 2.7, 2.6, 2.5]); // 15 minutes
    expect(evaluateCgmSustained(s)[0]?.code).toBe("low_severe");
    expect(severeLowMessage(s)).toMatch(/call emergency services/);
    expect(severeLowMessage(stream([2.8, 2.7, 2.6]))).toBeNull(); // 10 minutes
  });
  it("the 3.9 rule needs a full hour, and a single recovery resets the run", () => {
    expect(evaluateCgmSustained(stream(Array(13).fill(3.5))).map((r) => r.code)).toContain("low");
    expect(evaluateCgmSustained(stream(Array(12).fill(3.5))).map((r) => r.code)).not.toContain("low");
    expect(evaluateCgmSustained(stream([3.5, 3.5, 3.5, 3.5, 4.2, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5])).map((r) => r.code)).not.toContain("low");
  });
  it("high needs 2 hours above 13.9", () => {
    expect(evaluateCgmSustained(stream(Array(25).fill(14.5))).map((r) => r.code)).toEqual(["high"]);
    expect(evaluateCgmSustained(stream(Array(24).fill(14.5)))).toEqual([]);
  });
  it("a sensor that went quiet proves nothing", () => {
    const a = stream([2.8], 5, Date.parse("2026-10-07T00:00:00Z"));
    const b = stream([2.8, 2.7], 5, Date.parse("2026-10-07T00:40:00Z"));
    expect(evaluateCgmSustained([...a, ...b])).toEqual([]);
  });
});

describe("photo capture: every number is confirmed by the person", () => {
  const lines = ["SYS", "128", "DIA", "82", "PUL", "71"];
  it("drafts suggestions from recognised text and marks them as suggestions", () => {
    const d = draftFromRecognisedText("blood_pressure", lines);
    expect(d.fields.map((f) => [f.field, f.value, f.suggested])).toEqual([["systolic", "128", true], ["diastolic", "82", true], ["pulse_bpm", "71", true]]);
  });
  it("warns when the top number is not above the bottom one", () => {
    expect(draftFromRecognisedText("blood_pressure", ["82", "128"]).warnings.length).toBe(1);
  });
  it("refuses to save until every field is ticked", () => {
    const d = draftFromRecognisedText("blood_pressure", lines);
    expect(finalisePhotoReading({ draft: d, edits: {}, confirmedFields: ["systolic", "diastolic"] }).ok).toBe(false);
    expect(finalisePhotoReading({ draft: d, edits: {}, confirmedFields: [] }).ok).toBe(false);
  });
  it("uses the corrected number, not the suggestion, and saves a confirmed reading", () => {
    const d = draftFromRecognisedText("blood_pressure", ["120", "80", "70"]);
    const r = finalisePhotoReading({ draft: d, edits: { systolic: "128" }, confirmedFields: ["systolic", "diastolic", "pulse_bpm"], cuffType: "wrist" });
    expect(r).toMatchObject({ ok: true, held: false, reading: { vital_type: "blood_pressure", systolic: 128, diastolic: 80, pulse_bpm: 70 } });
    expect(r.ok && r.notes[0]).toMatch(/Wrist cuffs/);
  });
  it("an impossible number is held, never saved", () => {
    const d = draftFromRecognisedText("blood_pressure", ["700", "80"]);
    const r = finalisePhotoReading({ draft: d, edits: {}, confirmedFields: ["systolic", "diastolic", "pulse_bpm"] });
    expect(r).toMatchObject({ ok: true, held: true });
  });
  it("an extreme but possible number is saved, to be triaged like a typed one", () => {
    const d = draftFromRecognisedText("blood_pressure", ["270", "130"]);
    expect(finalisePhotoReading({ draft: d, edits: {}, confirmedFields: ["systolic", "diastolic", "pulse_bpm"] })).toMatchObject({ ok: true, held: false });
  });
  it("converts mg/dL and pounds, and asks for a unit it could not read", () => {
    const g = draftFromRecognisedText("glucose", ["108"]);
    expect(g.needsUnit).toBe(true);
    expect(finalisePhotoReading({ draft: g, edits: {}, confirmedFields: ["glucose_value"], glucoseContext: "fasting" }).ok).toBe(false);
    expect(finalisePhotoReading({ draft: g, edits: {}, confirmedFields: ["glucose_value"], unit: "mg_dl", glucoseContext: "fasting" })).toMatchObject({ ok: true, held: false, reading: { glucose_mmol_l: 6 } });
    const w = draftFromRecognisedText("weight", ["154.3", "lb"]);
    expect(finalisePhotoReading({ draft: w, edits: {}, confirmedFields: ["weight_value"], ageYears: 40 })).toMatchObject({ reading: { weight_kg: 70 } });
  });
  it("a photo that yields nothing leaves empty boxes the person types into", () => {
    const d = draftFromRecognisedText("blood_pressure", ["no digits here"]);
    expect(d.fields.every((f) => f.value === "" && !f.suggested)).toBe(true);
    expect(finalisePhotoReading({ draft: d, edits: { systolic: "120", diastolic: "80" }, confirmedFields: ["systolic", "diastolic", "pulse_bpm"] }).ok).toBe(true);
  });
});

describe("DeviceSource registry", () => {
  const fake = (id: string): DeviceSource => ({
    id, kind: "vendor_cloud", goLiveKey: null,
    connect: async () => ({ ok: true, kind: "granted" }),
    sync: async () => ({ ok: true, readings: [] }),
    normalise: () => [],
    revoke: async () => ({ ok: true }),
  });
  it("registers once and rejects a duplicate id", () => {
    const reg = new DeviceSourceRegistry().register(fake("a"));
    expect(reg.get("a")?.id).toBe("a");
    expect(() => reg.register(fake("a"))).toThrow(/already registered/);
    expect(reg.list()).toHaveLength(1);
  });
});

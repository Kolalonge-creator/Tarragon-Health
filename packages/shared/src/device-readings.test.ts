import { describe, expect, it } from "@jest/globals";
import {
  base64ToBytes,
  decodeSFloat,
  parseBloodPressureMeasurement,
  parseGlucoseMeasurement,
} from "./device-readings";

/** Test-only inverse of decodeSFloat, so vectors are built from decimal
 * values instead of hand-derived hex — keeps the tests self-verifying. */
function encodeSFloat(mantissa: number, exponent: number): number {
  const mantissaBits = mantissa < 0 ? (mantissa + 0x1000) & 0xfff : mantissa & 0xfff;
  const exponentBits = exponent < 0 ? (exponent + 0x10) & 0xf : exponent & 0xf;
  return ((exponentBits & 0xf) << 12) | mantissaBits;
}

function le16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

describe("decodeSFloat", () => {
  it("round-trips positive and negative mantissas with a zero exponent", () => {
    expect(decodeSFloat(encodeSFloat(120, 0))).toBe(120);
    expect(decodeSFloat(encodeSFloat(-50, 0))).toBe(-50);
  });

  it("applies a negative exponent (e.g. 36.5 as mantissa 365 * 10^-1)", () => {
    expect(decodeSFloat(encodeSFloat(365, -1))).toBeCloseTo(36.5, 10);
  });

  it("returns NaN for the reserved NaN/NRes/reserved mantissas", () => {
    expect(decodeSFloat(0x07ff)).toBeNaN();
    expect(decodeSFloat(0x0800)).toBeNaN();
    expect(decodeSFloat(0x0801)).toBeNaN();
  });

  it("returns +/-Infinity for the reserved infinity mantissas", () => {
    expect(decodeSFloat(0x07fe)).toBe(Infinity);
    expect(decodeSFloat(0x0802)).toBe(-Infinity);
  });
});

describe("parseBloodPressureMeasurement", () => {
  it("parses mmHg with timestamp and pulse rate present", () => {
    const [sysLo, sysHi] = le16(encodeSFloat(120, 0));
    const [diaLo, diaHi] = le16(encodeSFloat(80, 0));
    const [mapLo, mapHi] = le16(encodeSFloat(93, 0));
    const [pulseLo, pulseHi] = le16(encodeSFloat(72, 0));
    const [yearLo, yearHi] = le16(2024);

    const flags = 0b00000110; // bit1 timestamp, bit2 pulse rate, bit0=0 (mmHg)
    const bytes = Uint8Array.from([
      flags,
      sysLo, sysHi,
      diaLo, diaHi,
      mapLo, mapHi,
      yearLo, yearHi, 3, 15, 8, 30, 0, // 2024-03-15 08:30:00
      pulseLo, pulseHi,
    ]);

    const reading = parseBloodPressureMeasurement(bytes);
    expect(reading).toEqual({
      systolic: 120,
      diastolic: 80,
      meanArterialPressure: 93,
      unit: "mmHg",
      pulseBpm: 72,
      timestamp: "2024-03-15T08:30:00.000Z",
    });
  });

  it("parses a minimal payload with no optional fields", () => {
    const [sysLo, sysHi] = le16(encodeSFloat(118, 0));
    const [diaLo, diaHi] = le16(encodeSFloat(76, 0));
    const [mapLo, mapHi] = le16(encodeSFloat(90, 0));
    const bytes = Uint8Array.from([0, sysLo, sysHi, diaLo, diaHi, mapLo, mapHi]);

    const reading = parseBloodPressureMeasurement(bytes);
    expect(reading.systolic).toBe(118);
    expect(reading.diastolic).toBe(76);
    expect(reading.unit).toBe("mmHg");
    expect(reading.pulseBpm).toBeUndefined();
    expect(reading.timestamp).toBeUndefined();
  });

  it("reports kPa when the units flag bit is set", () => {
    const [sysLo, sysHi] = le16(encodeSFloat(16, 0));
    const [diaLo, diaHi] = le16(encodeSFloat(11, 0));
    const [mapLo, mapHi] = le16(encodeSFloat(12, 0));
    const bytes = Uint8Array.from([0b00000001, sysLo, sysHi, diaLo, diaHi, mapLo, mapHi]);

    expect(parseBloodPressureMeasurement(bytes).unit).toBe("kPa");
  });

  it("throws when the systolic reading is the SFLOAT NaN sentinel", () => {
    const [naLo, naHi] = le16(0x07ff);
    const [diaLo, diaHi] = le16(encodeSFloat(80, 0));
    const [mapLo, mapHi] = le16(encodeSFloat(93, 0));
    const bytes = Uint8Array.from([0, naLo, naHi, diaLo, diaHi, mapLo, mapHi]);

    expect(() => parseBloodPressureMeasurement(bytes)).toThrow(/invalid/i);
  });
});

describe("parseGlucoseMeasurement", () => {
  it("parses a mol/L concentration into mmol/L", () => {
    // 5.5 mmol/L == 0.0055 mol/L == mantissa 55 * 10^-4
    const [concLo, concHi] = le16(encodeSFloat(55, -4));
    const [seqLo, seqHi] = le16(42);
    const [yearLo, yearHi] = le16(2024);

    const flags = 0b00000110; // bit1 concentration present, bit2 unit=mol/L
    const bytes = Uint8Array.from([
      flags,
      seqLo, seqHi,
      yearLo, yearHi, 3, 15, 8, 30, 0, // base time 2024-03-15 08:30:00
      concLo, concHi,
      0x11, // type-sample-location (capillary whole blood, finger) — not surfaced
    ]);

    const reading = parseGlucoseMeasurement(bytes);
    expect(reading.sequenceNumber).toBe(42);
    expect(reading.glucoseMmolL).toBeCloseTo(5.5, 2);
    expect(reading.timestamp).toBe("2024-03-15T08:30:00.000Z");
  });

  it("parses a kg/L concentration into mmol/L using the glucose molar mass", () => {
    // 0.0009 kg/L (~900 mg/L / 90 mg/dL) == mantissa 9 * 10^-4
    const [concLo, concHi] = le16(encodeSFloat(9, -4));
    const [seqLo, seqHi] = le16(7);
    const [yearLo, yearHi] = le16(2024);

    const flags = 0b00000010; // bit1 concentration present, bit2=0 -> unit kg/L
    const bytes = Uint8Array.from([
      flags,
      seqLo, seqHi,
      yearLo, yearHi, 3, 15, 8, 30, 0,
      concLo, concHi,
      0x11,
    ]);

    const reading = parseGlucoseMeasurement(bytes);
    // 0.0009 kg/L * 1e6 / 180.156 g/mol = 4.9957 mmol/L
    expect(reading.glucoseMmolL).toBeCloseTo(4.996, 1);
  });

  it("applies a negative time offset relative to base time", () => {
    const [concLo, concHi] = le16(encodeSFloat(55, -4));
    const [seqLo, seqHi] = le16(1);
    const [yearLo, yearHi] = le16(2024);
    const [offLo, offHi] = le16(0xffff - 59); // -60 minutes as sint16 two's complement

    const flags = 0b00000111; // time offset + concentration + mol/L unit
    const bytes = Uint8Array.from([
      flags,
      seqLo, seqHi,
      yearLo, yearHi, 3, 15, 8, 30, 0,
      offLo, offHi,
      concLo, concHi,
      0x11,
    ]);

    const reading = parseGlucoseMeasurement(bytes);
    expect(reading.timestamp).toBe("2024-03-15T07:30:00.000Z");
  });

  it("returns null glucoseMmolL when the concentration field is absent", () => {
    const [seqLo, seqHi] = le16(3);
    const [yearLo, yearHi] = le16(2024);
    const bytes = Uint8Array.from([0, seqLo, seqHi, yearLo, yearHi, 3, 15, 8, 30, 0]);

    expect(parseGlucoseMeasurement(bytes).glucoseMmolL).toBeNull();
  });
});

describe("base64ToBytes", () => {
  it("decodes a known base64 string", () => {
    // "AQIDBA==" is bytes [1, 2, 3, 4]
    expect(Array.from(base64ToBytes("AQIDBA=="))).toEqual([1, 2, 3, 4]);
  });

  it("round-trips through the same bytes a real BP payload would use", () => {
    const original = Uint8Array.from([0, 120, 0, 80, 0, 93, 0]);
    const base64 = Buffer.from(original).toString("base64");
    expect(Array.from(base64ToBytes(base64))).toEqual(Array.from(original));
  });
});

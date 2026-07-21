/**
 * Bluetooth SIG GATT parsers for clinical device ingestion (BP cuffs,
 * glucometers, weight scales, thermometers, pulse oximeters) — CLAUDE.md
 * "Device & Wearable Integration", clinical Bluetooth path. Pure decoding
 * logic, platform-agnostic (runs identically under Jest/node and inside the
 * Expo/Hermes runtime) so it can be unit tested without any real hardware
 * or a BLE library.
 *
 * Covers the standard GATT measurement characteristics: Blood Pressure
 * (0x2A35 / service 0x1810), Glucose (0x2A18 / 0x1808), Weight (0x2A9D /
 * 0x181D), Temperature (0x2A1C / 0x1809), and PLX Spot-Check (0x2A5E /
 * 0x1822). Values are IEEE 11073-20601 SFLOATs (or 32-bit FLOATs for
 * temperature), little-endian.
 */

export const BLE_SERVICE_UUID = {
  bloodPressure: "00001810-0000-1000-8000-00805f9b34fb",
  glucose: "00001808-0000-1000-8000-00805f9b34fb",
  weightScale: "0000181d-0000-1000-8000-00805f9b34fb",
  healthThermometer: "00001809-0000-1000-8000-00805f9b34fb",
  pulseOximeter: "00001822-0000-1000-8000-00805f9b34fb",
} as const;

export const BLE_CHARACTERISTIC_UUID = {
  bloodPressureMeasurement: "00002a35-0000-1000-8000-00805f9b34fb",
  glucoseMeasurement: "00002a18-0000-1000-8000-00805f9b34fb",
  weightMeasurement: "00002a9d-0000-1000-8000-00805f9b34fb",
  temperatureMeasurement: "00002a1c-0000-1000-8000-00805f9b34fb",
  plxSpotCheckMeasurement: "00002a5e-0000-1000-8000-00805f9b34fb",
} as const;

/** 1 lb in kg (exact avoirdupois definition) — Weight Measurement imperial conversion. */
const LB_TO_KG = 0.45359237;

/**
 * Glucose (C6H12O6) molar mass, g/mol — used only to convert a Glucose
 * Measurement characteristic's raw kg/L concentration into mmol/L when a
 * device reports in kg/L rather than mol/L (GATT spec 0x2A18, flags bit
 * 2). Kept as its own constant here (rather than importing
 * GLUCOSE_MMOL_TO_MGDL from ./index) so this module has no dependency on
 * the rest of the package and stays trivially unit-testable in isolation.
 */
const GLUCOSE_MOLAR_MASS_G_PER_MOL = 180.156;

const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Decode a base64 string (the shape react-native-ble-plx delivers
 * characteristic values in) into raw bytes, without depending on `atob` or
 * the Node `Buffer` global — both are unreliable to assume present across
 * Hermes/Jest, so this is a self-contained implementation.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/=+$/, "");
  const bytes: number[] = [];
  let buffer = 0;
  let bitsCollected = 0;
  for (const char of clean) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) continue;
    buffer = (buffer << 6) | value;
    bitsCollected += 6;
    if (bitsCollected >= 8) {
      bitsCollected -= 8;
      bytes.push((buffer >> bitsCollected) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] + (data[offset + 1] << 8);
}

/**
 * Decode an IEEE 11073-20601 16-bit SFLOAT: a 4-bit signed exponent (bits
 * 15-12) and a 12-bit signed mantissa (bits 11-0), value = mantissa *
 * 10^exponent. Returns null for the spec's reserved "not a number" /
 * "not at this resolution" sentinel mantissas (a device that genuinely
 * can't report a value uses these rather than omitting the field).
 */
export function decodeSFloat(raw: number): number {
  const mantissaRaw = raw & 0x0fff;
  const exponentRaw = (raw >> 12) & 0x0f;

  if (mantissaRaw === 0x07ff || mantissaRaw === 0x0800 || mantissaRaw === 0x0801) {
    return NaN; // NaN / NRes / reserved
  }
  if (mantissaRaw === 0x07fe) return Infinity;
  if (mantissaRaw === 0x0802) return -Infinity;

  const mantissa = mantissaRaw >= 0x0800 ? mantissaRaw - 0x1000 : mantissaRaw;
  const exponent = exponentRaw >= 0x08 ? exponentRaw - 0x10 : exponentRaw;
  return mantissa * Math.pow(10, exponent);
}

export interface BloodPressureReading {
  systolic: number;
  diastolic: number;
  meanArterialPressure: number;
  unit: "mmHg" | "kPa";
  pulseBpm?: number;
  /** ISO 8601, present only if the device includes a Time Stamp field. */
  timestamp?: string;
}

/**
 * Parse a Blood Pressure Measurement characteristic (0x2A35) payload per
 * the Bluetooth GATT spec's field layout:
 * Flags(1) | Systolic SFLOAT(2) | Diastolic SFLOAT(2) | MAP SFLOAT(2) |
 * [Time Stamp(7)] | [Pulse Rate SFLOAT(2)] | [User ID(1)] | [Measurement Status(2)]
 */
export function parseBloodPressureMeasurement(data: Uint8Array): BloodPressureReading {
  let offset = 0;
  const flags = data[offset++];
  const unit: "mmHg" | "kPa" = (flags & 0x01) === 0 ? "mmHg" : "kPa";
  const hasTimestamp = (flags & 0x02) !== 0;
  const hasPulseRate = (flags & 0x04) !== 0;
  const hasUserId = (flags & 0x08) !== 0;
  const hasMeasurementStatus = (flags & 0x10) !== 0;

  const systolic = decodeSFloat(readUint16LE(data, offset));
  offset += 2;
  const diastolic = decodeSFloat(readUint16LE(data, offset));
  offset += 2;
  const meanArterialPressure = decodeSFloat(readUint16LE(data, offset));
  offset += 2;

  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic) || !Number.isFinite(meanArterialPressure)) {
    throw new Error("Blood pressure measurement contains an invalid (NaN) reading");
  }

  let timestamp: string | undefined;
  if (hasTimestamp) {
    const year = readUint16LE(data, offset);
    offset += 2;
    const month = data[offset++];
    const day = data[offset++];
    const hours = data[offset++];
    const minutes = data[offset++];
    const seconds = data[offset++];
    timestamp = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)).toISOString();
  }

  let pulseBpm: number | undefined;
  if (hasPulseRate) {
    const pulse = decodeSFloat(readUint16LE(data, offset));
    offset += 2;
    pulseBpm = Number.isFinite(pulse) ? Math.round(pulse) : undefined;
  }

  if (hasUserId) offset += 1;
  if (hasMeasurementStatus) offset += 2;

  return {
    systolic: Math.round(systolic),
    diastolic: Math.round(diastolic),
    meanArterialPressure: Math.round(meanArterialPressure),
    unit,
    pulseBpm,
    timestamp,
  };
}

export interface GlucoseReading {
  sequenceNumber: number;
  /** null if the device omitted the concentration field entirely. */
  glucoseMmolL: number | null;
  /** ISO 8601, from Base Time (+ Time Offset if present). */
  timestamp: string;
}

/**
 * Parse a Glucose Measurement characteristic (0x2A18) payload:
 * Flags(1) | Sequence Number(2) | Base Time(7) | [Time Offset(2)] |
 * [Glucose Concentration SFLOAT(2) + Type-Sample-Location(1)] | [Sensor Status(2)]
 *
 * Note: this characteristic carries no fasting/random/post-meal context —
 * that's a clinical concept the device doesn't know, not a GATT field, so
 * the caller (mobile sync screen) must still ask the patient before
 * submitting the reading.
 */
export function parseGlucoseMeasurement(data: Uint8Array): GlucoseReading {
  let offset = 0;
  const flags = data[offset++];
  const hasTimeOffset = (flags & 0x01) !== 0;
  const hasConcentration = (flags & 0x02) !== 0;
  const unitIsMolPerL = (flags & 0x04) !== 0;
  const hasSensorStatus = (flags & 0x08) !== 0;

  const sequenceNumber = readUint16LE(data, offset);
  offset += 2;

  const year = readUint16LE(data, offset);
  offset += 2;
  const month = data[offset++];
  const day = data[offset++];
  const hours = data[offset++];
  const minutes = data[offset++];
  const seconds = data[offset++];
  let timestampMs = Date.UTC(year, month - 1, day, hours, minutes, seconds);

  if (hasTimeOffset) {
    const rawOffset = readUint16LE(data, offset);
    offset += 2;
    const offsetMinutes = rawOffset >= 0x8000 ? rawOffset - 0x10000 : rawOffset;
    timestampMs += offsetMinutes * 60 * 1000;
  }

  let glucoseMmolL: number | null = null;
  if (hasConcentration) {
    const concentration = decodeSFloat(readUint16LE(data, offset));
    offset += 2;
    offset += 1; // Type-Sample-Location byte — not surfaced (no context on this characteristic)
    if (Number.isFinite(concentration)) {
      glucoseMmolL = unitIsMolPerL
        ? concentration * 1000
        : (concentration * 1_000_000) / GLUCOSE_MOLAR_MASS_G_PER_MOL;
      glucoseMmolL = Math.round(glucoseMmolL * 100) / 100;
    }
  }

  if (hasSensorStatus) offset += 2;

  return {
    sequenceNumber,
    glucoseMmolL,
    timestamp: new Date(timestampMs).toISOString(),
  };
}

/** GATT Date Time field (7 bytes: year u16 LE, month, day, hours, minutes, seconds) → ISO 8601. */
function readDateTime(data: Uint8Array, offset: number): string {
  const year = readUint16LE(data, offset);
  const month = data[offset + 2];
  const day = data[offset + 3];
  const hours = data[offset + 4];
  const minutes = data[offset + 5];
  const seconds = data[offset + 6];
  return new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)).toISOString();
}

/**
 * Decode an IEEE 11073-20601 32-bit FLOAT (used by Temperature Measurement,
 * unlike the 16-bit SFLOAT everywhere else): an 8-bit signed exponent (byte
 * 3) and a 24-bit signed mantissa (bytes 0-2, little-endian), value =
 * mantissa * 10^exponent. Returns NaN/±Infinity for the spec's sentinel
 * mantissas, same contract as decodeSFloat.
 */
export function decodeFloatMed(data: Uint8Array, offset: number): number {
  const mantissaRaw = data[offset] + (data[offset + 1] << 8) + (data[offset + 2] << 16);
  const exponentRaw = data[offset + 3];

  if (mantissaRaw === 0x7fffff || mantissaRaw === 0x800000 || mantissaRaw === 0x800001) {
    return NaN; // NaN / NRes / reserved
  }
  if (mantissaRaw === 0x7ffffe) return Infinity;
  if (mantissaRaw === 0x800002) return -Infinity;

  const mantissa = mantissaRaw >= 0x800000 ? mantissaRaw - 0x1000000 : mantissaRaw;
  const exponent = exponentRaw >= 0x80 ? exponentRaw - 0x100 : exponentRaw;
  return mantissa * Math.pow(10, exponent);
}

export interface WeightReading {
  weightKg: number;
  /** ISO 8601, present only if the scale includes a Time Stamp field. */
  timestamp?: string;
}

/**
 * Parse a Weight Measurement characteristic (0x2A9D) payload per the GATT
 * Weight Scale Service spec:
 * Flags(1) | Weight uint16(2) | [Time Stamp(7)] | [User ID(1)] | [BMI(2) + Height(2)]
 *
 * Weight resolution is fixed by the spec's measurement units: 0.005 kg (SI)
 * or 0.01 lb (imperial) — imperial is converted to kg here so the platform
 * only ever sees kg (vitals_readings.weight_kg). The spec's 0xFFFF weight
 * means "measurement unsuccessful" and is rejected rather than decoded.
 */
export function parseWeightMeasurement(data: Uint8Array): WeightReading {
  let offset = 0;
  const flags = data[offset++];
  const isImperial = (flags & 0x01) !== 0;
  const hasTimestamp = (flags & 0x02) !== 0;

  const rawWeight = readUint16LE(data, offset);
  offset += 2;
  if (rawWeight === 0xffff) {
    throw new Error("Scale reported an unsuccessful measurement — step on again and retry");
  }

  const weightKg = isImperial ? rawWeight * 0.01 * LB_TO_KG : rawWeight * 0.005;

  let timestamp: string | undefined;
  if (hasTimestamp) {
    timestamp = readDateTime(data, offset);
    offset += 7;
  }
  // User ID and BMI/Height fields (if present) are not surfaced — the
  // platform derives BMI itself from the profile height.

  return {
    weightKg: Math.round(weightKg * 100) / 100,
    timestamp,
  };
}

export interface TemperatureReading {
  temperatureC: number;
  /** ISO 8601, present only if the thermometer includes a Time Stamp field. */
  timestamp?: string;
}

/**
 * Parse a Temperature Measurement characteristic (0x2A1C) payload per the
 * GATT Health Thermometer Service spec:
 * Flags(1) | Temperature FLOAT32(4) | [Time Stamp(7)] | [Temperature Type(1)]
 *
 * Fahrenheit readings are converted so the platform only sees Celsius
 * (vitals_readings.temperature_c).
 */
export function parseTemperatureMeasurement(data: Uint8Array): TemperatureReading {
  let offset = 0;
  const flags = data[offset++];
  const isFahrenheit = (flags & 0x01) !== 0;
  const hasTimestamp = (flags & 0x02) !== 0;

  const raw = decodeFloatMed(data, offset);
  offset += 4;
  if (!Number.isFinite(raw)) {
    throw new Error("Temperature measurement contains an invalid (NaN) reading");
  }
  const temperatureC = isFahrenheit ? ((raw - 32) * 5) / 9 : raw;

  let timestamp: string | undefined;
  if (hasTimestamp) {
    timestamp = readDateTime(data, offset);
    offset += 7;
  }

  return {
    temperatureC: Math.round(temperatureC * 10) / 10,
    timestamp,
  };
}

export interface SpO2Reading {
  spo2Pct: number;
  pulseBpm?: number;
  /** ISO 8601, present only if the oximeter includes a Timestamp field. */
  timestamp?: string;
}

/**
 * Parse a PLX Spot-Check Measurement characteristic (0x2A5E) payload per
 * the GATT Pulse Oximeter Service spec:
 * Flags(1) | SpO2 SFLOAT(2) | Pulse Rate SFLOAT(2) | [Timestamp(7)] |
 * [Measurement Status(2)] | [Device and Sensor Status(3)] | [Pulse Amplitude Index SFLOAT(2)]
 */
export function parsePlxSpotCheckMeasurement(data: Uint8Array): SpO2Reading {
  let offset = 0;
  const flags = data[offset++];
  const hasTimestamp = (flags & 0x01) !== 0;

  const spo2 = decodeSFloat(readUint16LE(data, offset));
  offset += 2;
  const pulse = decodeSFloat(readUint16LE(data, offset));
  offset += 2;

  if (!Number.isFinite(spo2)) {
    throw new Error("Pulse oximeter measurement contains an invalid (NaN) SpO2 reading");
  }

  let timestamp: string | undefined;
  if (hasTimestamp) {
    timestamp = readDateTime(data, offset);
    offset += 7;
  }
  // Measurement Status / Device and Sensor Status / Pulse Amplitude Index
  // (if present) follow — not surfaced.

  return {
    spo2Pct: Math.round(spo2),
    pulseBpm: Number.isFinite(pulse) ? Math.round(pulse) : undefined,
    timestamp,
  };
}

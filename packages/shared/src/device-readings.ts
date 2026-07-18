/**
 * Bluetooth SIG GATT parsers for clinical device ingestion (BP cuffs,
 * glucometers) — CLAUDE.md "Device & Wearable Integration", clinical
 * Bluetooth path. Pure decoding logic, platform-agnostic (runs identically
 * under Jest/node and inside the Expo/Hermes runtime) so it can be unit
 * tested without any real hardware or a BLE library.
 *
 * Covers the standard GATT characteristics a compliant BP cuff/glucometer
 * exposes: Blood Pressure Measurement (0x2A35) under the Blood Pressure
 * Service (0x1810), and Glucose Measurement (0x2A18) under the Glucose
 * Service (0x1808). Values are IEEE 11073-20601 SFLOATs, little-endian.
 */

export const BLE_SERVICE_UUID = {
  bloodPressure: "00001810-0000-1000-8000-00805f9b34fb",
  glucose: "00001808-0000-1000-8000-00805f9b34fb",
} as const;

export const BLE_CHARACTERISTIC_UUID = {
  bloodPressureMeasurement: "00002a35-0000-1000-8000-00805f9b34fb",
  glucoseMeasurement: "00002a18-0000-1000-8000-00805f9b34fb",
} as const;

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

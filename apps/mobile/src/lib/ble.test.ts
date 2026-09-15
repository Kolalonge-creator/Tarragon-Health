/**
 * ble.ts owns the wiring between a peripheral's advertised GATT service, the
 * device type the app treats it as, and the parser that decodes its
 * notifications. The bit-level decoding itself lives in @tarragon/shared and
 * is tested there (packages/shared/src/device-readings.test.ts) — what is
 * NOT tested anywhere else is this mapping, and getting it wrong is exactly
 * the silent failure mode that matters: a glucose payload decoded by the
 * blood-pressure parser produces a plausible-looking wrong number rather
 * than an error, and lands in the patient's record.
 *
 * None of this has ever run against real hardware (CLAUDE.md, Device &
 * Wearable Integration), so the native bridge is faked — see
 * src/test/mocks/react-native-ble-plx.ts.
 */
import { BLE_CHARACTERISTIC_UUID, BLE_SERVICE_UUID } from "@tarragon/shared";
import * as ble from "../test/mocks/react-native-ble-plx";
import { connectAndSubscribe, scanForClinicalDevices, type SupportedDeviceType } from "./ble";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";

function toBase64(bytes: number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString("base64");
}

function encodeSFloat(mantissa: number, exponent: number): number {
  const mantissaBits = mantissa < 0 ? (mantissa + 0x1000) & 0xfff : mantissa & 0xfff;
  return ((exponent < 0 ? (exponent + 0x10) & 0xf : exponent & 0xf) << 12) | mantissaBits;
}

function le16(value: number): [number, number] {
  return [value & 0xff, (value >> 8) & 0xff];
}

/** A minimal, spec-shaped 120/80 mmHg Blood Pressure Measurement. */
const BP_120_80 = toBase64([
  0,
  ...le16(encodeSFloat(120, 0)),
  ...le16(encodeSFloat(80, 0)),
  ...le16(encodeSFloat(93, 0)),
]);

describe("scanForClinicalDevices", () => {
  it("advertises for exactly the five supported standard GATT services", () => {
    scanForClinicalDevices(
      () => {},
      () => {}
    );
    expect(ble.state.scanServiceUuids?.slice().sort()).toEqual(Object.values(BLE_SERVICE_UUID).slice().sort());
  });

  const serviceCases: [string, string, SupportedDeviceType][] = [
    ["blood pressure", BLE_SERVICE_UUID.bloodPressure, "bp_cuff"],
    ["glucose", BLE_SERVICE_UUID.glucose, "glucometer"],
    ["weight scale", BLE_SERVICE_UUID.weightScale, "scale"],
    ["health thermometer", BLE_SERVICE_UUID.healthThermometer, "thermometer"],
    ["pulse oximeter", BLE_SERVICE_UUID.pulseOximeter, "pulse_oximeter"],
  ];

  it.each(serviceCases)("maps the %s service to %s", (_label, serviceUuid, expected) => {
    const found: SupportedDeviceType[] = [];
    scanForClinicalDevices(
      (_device, deviceType) => found.push(deviceType),
      () => {}
    );
    ble.__emitScanResult({ id: "dev-1", serviceUUIDs: [serviceUuid] });
    expect(found).toEqual([expected]);
  });

  it("matches an uppercase advertised UUID (some stacks report them uppercased)", () => {
    const found: SupportedDeviceType[] = [];
    scanForClinicalDevices(
      (_device, deviceType) => found.push(deviceType),
      () => {}
    );
    ble.__emitScanResult({ id: "dev-1", serviceUUIDs: [BLE_SERVICE_UUID.glucose.toUpperCase()] });
    expect(found).toEqual(["glucometer"]);
  });

  it("ignores a peripheral advertising nothing we can decode", () => {
    const found: SupportedDeviceType[] = [];
    scanForClinicalDevices(
      (_device, deviceType) => found.push(deviceType),
      () => {}
    );
    ble.__emitScanResult({ id: "headphones", serviceUUIDs: ["0000110b-0000-1000-8000-00805f9b34fb"] });
    ble.__emitScanResult({ id: "unknown", serviceUUIDs: null });
    expect(found).toEqual([]);
  });

  it("reports a missing native module (Expo Go) through onError instead of throwing", () => {
    ble.state.throwOnScan = true;
    const errors: Error[] = [];
    const stop = scanForClinicalDevices(
      () => {},
      (error) => errors.push(error)
    );
    expect(errors).toHaveLength(1);
    // The returned stop function must still be safe to call from an unmount.
    expect(() => stop()).not.toThrow();
  });

  it("stops the scan when the caller tears down, so the radio is not left running", () => {
    const stop = scanForClinicalDevices(
      () => {},
      () => {}
    );
    stop();
    expect(ble.state.scanStopped).toBe(true);
  });
});

describe("connectAndSubscribe", () => {
  const gattCases: [SupportedDeviceType, string, string][] = [
    ["bp_cuff", BLE_SERVICE_UUID.bloodPressure, BLE_CHARACTERISTIC_UUID.bloodPressureMeasurement],
    ["glucometer", BLE_SERVICE_UUID.glucose, BLE_CHARACTERISTIC_UUID.glucoseMeasurement],
    ["scale", BLE_SERVICE_UUID.weightScale, BLE_CHARACTERISTIC_UUID.weightMeasurement],
    ["thermometer", BLE_SERVICE_UUID.healthThermometer, BLE_CHARACTERISTIC_UUID.temperatureMeasurement],
    ["pulse_oximeter", BLE_SERVICE_UUID.pulseOximeter, BLE_CHARACTERISTIC_UUID.plxSpotCheckMeasurement],
  ];

  it.each(gattCases)(
    "subscribes a %s to its own measurement characteristic",
    async (deviceType, service, characteristic) => {
      await connectAndSubscribe(
        "dev-1",
        deviceType,
        () => {},
        () => {}
      );
      expect(ble.state.monitors.at(-1)).toMatchObject({ service, characteristic });
    }
  );

  it("decodes a notification with the parser for that device type", async () => {
    const readings: unknown[] = [];
    await connectAndSubscribe(
      "dev-1",
      "bp_cuff",
      (reading) => readings.push(reading),
      () => {}
    );
    ble.__emitNotification(BP_120_80);

    expect(readings).toEqual([
      {
        deviceType: "bp_cuff",
        systolic: 120,
        diastolic: 80,
        meanArterialPressure: 93,
        unit: "mmHg",
      },
    ]);
  });

  it("routes a decode failure to onError rather than throwing inside the BLE callback", async () => {
    const errors: Error[] = [];
    const readings: unknown[] = [];
    await connectAndSubscribe(
      "dev-1",
      "bp_cuff",
      (reading) => readings.push(reading),
      (error) => errors.push(error)
    );
    // The spec's SFLOAT "not a number" sentinel in the systolic field: a
    // device saying it could not produce a reading.
    ble.__emitNotification(toBase64([0, ...le16(0x07ff), ...le16(0), ...le16(0)]));

    expect(readings).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  /**
   * FINDING (defect in @tarragon/shared, not in this package — reported, not
   * fixed here).
   *
   * packages/shared/src/device-readings.ts's readUint16LE indexes past the
   * end of a short payload without checking, and `undefined << 8` is 0 in
   * JavaScript, so a TRUNCATED Blood Pressure Measurement decodes to a
   * plausible-shaped fabricated reading (1/0 mmHg here) instead of throwing.
   * ble.ts then hands that to onReading exactly as it would a real one.
   *
   * FIXED on this branch: readUint16LE in packages/shared now bounds-checks
   * and throws, so every profile refuses a short frame instead of inventing a
   * number. This test was written to document the defect and now asserts the
   * fix, which is the shape it should keep: the contract that matters is that
   * a truncated frame surfaces as an error and produces no reading at all.
   *
   * Relying on the server to catch it was never a fix. Server-side validation
   * rejected a systolic below 60, which made it a poison queue entry rather
   * than a bad clinical number (see offline-queue.test.ts's head-of-line
   * finding), and this branch deliberately widened those bands so that the
   * genuinely dangerous readings can get through. The backstop got looser at
   * exactly the moment it would have mattered.
   */
  it("refuses a truncated payload instead of fabricating a reading", async () => {
    const errors: Error[] = [];
    const readings: unknown[] = [];
    await connectAndSubscribe(
      "dev-1",
      "bp_cuff",
      (reading) => readings.push(reading),
      (error) => errors.push(error)
    );
    ble.__emitNotification(toBase64([0, 1])); // 2 bytes; a BP measurement needs at least 7

    expect(readings).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/too short/i);
  });

  it("bounds the connection with the native timeout rather than waiting forever", async () => {
    await connectAndSubscribe(
      "dev-1",
      "bp_cuff",
      () => {},
      () => {}
    );
    expect(ble.state.connectCalls).toEqual([{ id: "dev-1", timeout: 15_000 }]);
  });

  it("gives up on a peripheral that connects but stalls during service discovery", async () => {
    jest.useFakeTimers();
    try {
      ble.state.discoveryBehaviour = "hang";
      const promise = connectAndSubscribe(
        "dev-1",
        "bp_cuff",
        () => {},
        () => {}
      );
      const assertion = expect(promise).rejects.toThrow(/Discovering services timed out/);
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }

    // A half-open connection must be cancelled, or a retry is blocked by it.
    expect(ble.state.cancelledConnections).toEqual(["dev-1"]);
    expect(getRecentSyncDiagnostics().some((e) => e.source === "ble" && e.detail === "connect:bp_cuff")).toBe(true);
  });

  it("records why a connection failed instead of returning a silent empty result", async () => {
    ble.state.connectBehaviour = "reject";
    await expect(
      connectAndSubscribe(
        "dev-1",
        "glucometer",
        () => {},
        () => {}
      )
    ).rejects.toThrow("connect failed");
    expect(getRecentSyncDiagnostics().at(-1)).toMatchObject({ source: "ble", detail: "connect:glucometer" });
  });

  it("removes the subscription and drops the connection on teardown", async () => {
    const teardown = await connectAndSubscribe(
      "dev-1",
      "bp_cuff",
      () => {},
      () => {}
    );
    teardown();
    expect(ble.state.subscriptionsRemoved).toBe(1);
    expect(ble.state.cancelledConnections).toEqual(["dev-1"]);
  });
});

import { loadOfflineReconnectConfig } from "./offline-reconnect-config";
import { readPowerState, registerPowerReader, resetPowerPortForTests } from "./power-port";
import { isLowPower, UNKNOWN_POWER, workDecision, type PowerState, type WorkKind } from "./power-rules";

const LOW = 15;
const power = (p: Partial<PowerState>): PowerState => ({ ...UNKNOWN_POWER, ...p });
const decide = (work: WorkKind, p: PowerState, extra: { lowData?: boolean; connection?: "wifi" | "cellular" | "unknown" } = {}) =>
  workDecision({ work, power: p, lowBatteryPercent: LOW, lowData: extra.lowData ?? false, connection: extra.connection ?? "wifi" });

describe("isLowPower", () => {
  it("is low at or under the line when not charging", () => {
    expect(isLowPower(power({ batteryPercent: 15 }), LOW)).toBe(true);
    expect(isLowPower(power({ batteryPercent: 16 }), LOW)).toBe(false);
  });
  it("is low when the phone's battery saver is on, whatever the level", () => {
    expect(isLowPower(power({ batteryPercent: 80, batterySaver: true }), LOW)).toBe(true);
  });
  it("is never low while charging", () => {
    expect(isLowPower(power({ batteryPercent: 3, batterySaver: true, charging: true }), LOW)).toBe(false);
  });
  it("unknown is not low (the app behaves as it did before)", () => {
    expect(isLowPower(UNKNOWN_POWER, LOW)).toBe(false);
  });
});

describe("workDecision", () => {
  const critical = power({ batteryPercent: 2, batterySaver: true, charging: false });

  it.each(["save_entry", "send_urgent", "send_essential"] as const)("never delays %s, even at 2 percent with battery saver on and low-data on cellular", (work) => {
    expect(decide(work, critical, { lowData: true, connection: "cellular" })).toEqual({ action: "run" });
  });

  it("defers a bulk upload when low on power", () => {
    expect(decide("upload_bulk", critical)).toEqual({ action: "defer", reason: "low_power" });
  });

  it("runs it when power is fine or unknown", () => {
    expect(decide("upload_bulk", power({ batteryPercent: 60 }))).toEqual({ action: "run" });
    expect(decide("upload_bulk", UNKNOWN_POWER)).toEqual({ action: "run" });
  });

  it("defers a bulk upload in low-data mode unless on Wi-Fi; unknown connection counts as metered", () => {
    expect(decide("upload_bulk", UNKNOWN_POWER, { lowData: true, connection: "cellular" })).toEqual({ action: "defer", reason: "low_data" });
    expect(decide("upload_bulk", UNKNOWN_POWER, { lowData: true, connection: "unknown" })).toEqual({ action: "defer", reason: "low_data" });
    expect(decide("upload_bulk", UNKNOWN_POWER, { lowData: true, connection: "wifi" })).toEqual({ action: "run" });
    expect(decide("upload_bulk", UNKNOWN_POWER, { lowData: false, connection: "cellular" })).toEqual({ action: "run" });
  });

  it("low power wins the reason when both apply", () => {
    expect(decide("upload_bulk", critical, { lowData: true, connection: "cellular" })).toEqual({ action: "defer", reason: "low_power" });
  });
});

describe("power port", () => {
  beforeEach(() => resetPowerPortForTests());

  it("answers unknown until a native battery module registers a reader", async () => {
    await expect(readPowerState()).resolves.toEqual(UNKNOWN_POWER);
    registerPowerReader(async () => power({ batteryPercent: 9 }));
    await expect(readPowerState()).resolves.toEqual(power({ batteryPercent: 9 }));
  });

  it("a reader that throws is unknown, never an error", async () => {
    registerPowerReader(async () => {
      throw new Error("no module");
    });
    await expect(readPowerState()).resolves.toEqual(UNKNOWN_POWER);
  });
});

describe("offline.reconnect_power config", () => {
  it("loads the registry values with units converted", () => {
    const c = loadOfflineReconnectConfig();
    expect(c.reconnectFlushMinGapMs).toBe(20_000);
    expect(c.lowBatteryPercent).toBe(15);
    expect(c.version).toBe(1);
  });
});

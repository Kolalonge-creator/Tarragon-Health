import { registerPowerReader, readPowerState, resetPowerPortForTests } from "./power-port";
import { UNKNOWN_POWER, type PowerState } from "./power-rules";
import { enqueueDeviceReading, enqueueHealthSamplesPage } from "./offline-queue";
import { resetLowDataLoadedForTests, writeLowDataEnabled } from "./low-data";
import { currentBulkDeferral, getAllWaitingCount, reconnectFlush, resetReconnectFlushForTests, type ReconnectFlushDeps } from "./reconnect-flush";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";

jest.mock("./outbox", () => ({ flushOutbox: jest.fn(), getPendingCount: jest.fn().mockResolvedValue(0) }));
jest.mock("./api", () => ({ postDeviceReading: jest.fn(), postHealthSamples: jest.fn(), postPhotoReading: jest.fn() }));

let calls: string[];
let clock: number;

function deps(over: Partial<ReconnectFlushDeps> = {}): ReconnectFlushDeps {
  const rec = (name: string) => async () => {
    calls.push(name);
  };
  return {
    flushOutbox: rec("outbox"),
    flushDeviceReadings: rec("device"),
    flushPhotoReadings: rec("photo"),
    flushHealthSamples: rec("health"),
    readPower: async () => UNKNOWN_POWER,
    readConnection: async () => "wifi",
    isLowData: () => false,
    now: () => clock,
    minGapMs: 20_000,
    lowBatteryPercent: 15,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  clock = 1_000_000;
  resetReconnectFlushForTests();
  resetPowerPortForTests();
});

describe("reconnectFlush", () => {
  it("sends the outbox first, then the small queues, then the bulk health pages", async () => {
    const r = await reconnectFlush(deps());
    expect(calls).toEqual(["outbox", "device", "photo", "health"]);
    expect(r).toMatchObject({ ran: true, bulk: "sent", failedSteps: [], incomplete: false });
  });

  it("never runs two flushes at once: a second caller gets the run already in flight", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const d = deps({ flushOutbox: async () => { calls.push("outbox"); await gate; } });
    const first = reconnectFlush(d);
    const second = reconnectFlush(d);
    release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toBe(b);
    expect(calls.filter((c) => c === "outbox")).toHaveLength(1);
  });

  it("debounces: a second run inside the minimum gap does not start, one after it does", async () => {
    await reconnectFlush(deps());
    clock += 19_999;
    await expect(reconnectFlush(deps())).resolves.toEqual({ ran: false, skipped: "debounced", failedSteps: [] });
    expect(calls).toHaveLength(4);
    clock += 1;
    await expect(reconnectFlush(deps())).resolves.toMatchObject({ ran: true });
    expect(calls).toHaveLength(8);
  });

  it("when low on power it still sends the outbox and small queues, skips the bulk pages, and says why", async () => {
    const low: PowerState = { batteryPercent: 9, batterySaver: null, charging: false };
    const r = await reconnectFlush(deps({ readPower: async () => low }));
    expect(calls).toEqual(["outbox", "device", "photo"]);
    expect(r.bulk).toBe("deferred_low_power");
  });

  it("goes through a registered power reader, so a native battery module needs only registerPowerReader", async () => {
    registerPowerReader(async () => ({ batteryPercent: 4, batterySaver: null, charging: false }));
    const r = await reconnectFlush(deps({ readPower: readPowerState }));
    expect(r.bulk).toBe("deferred_low_power");
    expect(calls).not.toContain("health");
  });

  it("in low-data mode on cellular it sends the essentials and holds the bulk pages for Wi-Fi", async () => {
    const r = await reconnectFlush(deps({ isLowData: () => true, readConnection: async () => "cellular" }));
    expect(calls).toEqual(["outbox", "device", "photo"]);
    expect(r.bulk).toBe("deferred_low_data");
  });

  it("in low-data mode on Wi-Fi the bulk pages go", async () => {
    await reconnectFlush(deps({ isLowData: () => true, readConnection: async () => "wifi" }));
    expect(calls).toContain("health");
  });

  it("a failing step is recorded, named in the result, and does not stop the steps after it", async () => {
    const r = await reconnectFlush(
      deps({
        flushOutbox: async () => {
          throw new Error("boom");
        },
      })
    );
    expect(calls).toEqual(["device", "photo", "health"]);
    expect(r.failedSteps).toEqual(["outbox"]);
    expect(getRecentSyncDiagnostics().some((e) => e.detail === "reconnect:outbox")).toBe(true);
  });

  it("a run that did not get through does not hold off the next attempt (the watcher would not retry a good probe)", async () => {
    await reconnectFlush(deps({ flushOutbox: async () => ({ stoppedOffline: true }) }));
    clock += 1_000; // well inside the 20 second gap
    await expect(reconnectFlush(deps())).resolves.toMatchObject({ ran: true });
    clock += 1_000;
    // ...but a clean run does debounce.
    await expect(reconnectFlush(deps())).resolves.toMatchObject({ ran: false, skipped: "debounced" });
  });

  it("a step that threw does not hold off the next attempt either", async () => {
    await reconnectFlush(deps({ flushDeviceReadings: async () => { throw new Error("x"); } }));
    clock += 1_000;
    await expect(reconnectFlush(deps())).resolves.toMatchObject({ ran: true });
  });
});

describe("currentBulkDeferral", () => {
  const base = { readPower: async () => UNKNOWN_POWER, readConnection: async () => "wifi" as const, isLowData: () => false, lowBatteryPercent: 15 };

  it("is worked out from the phone as it is now: the reason goes when the cause does", async () => {
    const lowPower = { ...base, readPower: async () => ({ batteryPercent: 5, batterySaver: null, charging: false }) };
    expect(await currentBulkDeferral(lowPower)).toBe("low_power");
    expect(await currentBulkDeferral({ ...lowPower, readPower: async () => ({ batteryPercent: 5, batterySaver: null, charging: true }) })).toBeNull();
    expect(await currentBulkDeferral({ ...base, isLowData: () => true, readConnection: async () => "cellular" })).toBe("low_data");
    expect(await currentBulkDeferral({ ...base, isLowData: () => false, readConnection: async () => "cellular" })).toBeNull();
  });
});

describe("a flush that returns with nothing sent", () => {
  it("does not hold off the next attempt (the server or the network said no)", async () => {
    await reconnectFlush(deps({ flushDeviceReadings: async () => ({ flushed: 0, remaining: 3 }) }));
    clock += 1_000;
    await expect(reconnectFlush(deps())).resolves.toMatchObject({ ran: true });
  });
});

describe("getAllWaitingCount", () => {
  afterEach(async () => {
    await writeLowDataEnabled(false);
    resetLowDataLoadedForTests();
  });

  it("counts the small queues, and counts health pages only while they are not deliberately waiting", async () => {
    await enqueueDeviceReading({ seq: 1 });
    await enqueueHealthSamplesPage({ provider: "apple_health", samples: [] });
    expect(await getAllWaitingCount()).toBe(2);
    // Low-data mode with no Wi-Fi known: the health page waits on purpose, so it is no reason to probe the network.
    await writeLowDataEnabled(true);
    expect(await getAllWaitingCount()).toBe(1);
  });
});

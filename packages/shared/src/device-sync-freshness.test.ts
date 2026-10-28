import { describe, expect, it, jest } from "@jest/globals";
import { assessDeviceSync, loadDeviceSyncConfig, SYNC_CLOCK_SKEW_TOLERANCE_MS } from "./device-sync-freshness";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const CFG = { version: 1, staleAfterMs: 7 * DAY };
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("assessDeviceSync", () => {
  it("never synced says so, with no note (it may have just been paired)", () => {
    for (const v of [null, undefined, ""]) {
      expect(assessDeviceSync(v, NOW, CFG)).toEqual({ level: "never", label: { key: "devices.sync.never" }, showNote: false });
    }
  });

  it.each([
    [0, "devices.sync.just_now", undefined],
    [59_000, "devices.sync.just_now", undefined],
    [1 * MIN, "devices.sync.minute_one", 1],
    [59 * MIN, "devices.sync.minute_other", 59],
    [60 * MIN, "devices.sync.hour_one", 1],
    [23 * HOUR + 59 * MIN, "devices.sync.hour_other", 23],
    [24 * HOUR, "devices.sync.day_one", 1],
    [3 * DAY, "devices.sync.day_other", 3],
  ])("an age of %s ms reads as %s", (age, key, count) => {
    const r = assessDeviceSync(ago(age), NOW, CFG);
    expect(r.label.key).toBe(key);
    expect(r.label.params?.count).toBe(count);
    expect(r.showNote).toBe(false);
    expect(r.level).toBe("recent");
  });

  it("is quiet just under the line and adds the note at the line", () => {
    expect(assessDeviceSync(ago(7 * DAY - 1), NOW, CFG).showNote).toBe(false);
    const at = assessDeviceSync(ago(7 * DAY), NOW, CFG);
    expect(at.level).toBe("behind");
    expect(at.showNote).toBe(true);
    expect(at.label).toEqual({ key: "devices.sync.day_other", params: { count: 7 } });
  });

  it("an unreadable time is unknown, not recent", () => {
    expect(assessDeviceSync("not a date", NOW, CFG)).toMatchObject({ level: "unknown", showNote: true });
    expect(assessDeviceSync(ago(0), Number.NaN, CFG)).toMatchObject({ level: "unknown" });
  });

  it("a time in the future beyond the clock tolerance is unknown; inside it, 'just now'", () => {
    expect(assessDeviceSync(new Date(NOW + SYNC_CLOCK_SKEW_TOLERANCE_MS + 1000).toISOString(), NOW, CFG).level).toBe("unknown");
    const small = assessDeviceSync(new Date(NOW + 2 * MIN).toISOString(), NOW, CFG);
    expect(small.level).toBe("recent");
    expect(small.label.key).toBe("devices.sync.just_now");
  });

  it("reads its threshold from versioned configuration", () => {
    const c = loadDeviceSyncConfig();
    expect(c.version).toBeGreaterThanOrEqual(1);
    expect(c.staleAfterMs).toBe(7 * DAY);
  });
});

describe("a device with the wrong date", () => {
  it("still loads the configuration instead of throwing (the entry starts 2026-10-27, a phone may say 2025)", () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2025-01-01T00:00:00Z"));
    try {
      expect(() => loadDeviceSyncConfig()).not.toThrow();
      expect(assessDeviceSync(new Date("2025-01-01T00:00:00Z").toISOString(), Date.now()).level).toBe("recent");
    } finally {
      jest.useRealTimers();
    }
  });
});

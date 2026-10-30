import { describe, expect, it } from "@jest/globals";
import { CHECKIN_WINDOW_MAX_MINUTES, CHECKIN_WINDOW_MIN_MINUTES, HIDEABLE_CARDS, checkInSnoozeSeconds, restoreCheckInSnooze, hideOnDeviceKey, isHiddenOnDevice, setHiddenOnDevice } from "./hide-on-device";
import type { LockStorage } from "./controller";

function memory(): LockStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
}
const broken: LockStorage = {
  get: async () => { throw new Error("no storage"); },
  set: async () => { throw new Error("no storage"); },
  remove: async () => { throw new Error("no storage"); },
};

describe("hide on this phone", () => {
  it("covers exactly the four sensitive cards", () => {
    expect([...HIDEABLE_CARDS]).toEqual(["cycle", "pregnancy", "contraception", "growth"]);
  });
  it("hides and shows again, per account and per card", async () => {
    const s = memory();
    expect(await isHiddenOnDevice(s, "a1", "cycle")).toBe(false);
    expect(await setHiddenOnDevice(s, "a1", "cycle", true)).toBe(true);
    expect(await isHiddenOnDevice(s, "a1", "cycle")).toBe(true);
    expect(await isHiddenOnDevice(s, "a1", "growth")).toBe(false);
    expect(await isHiddenOnDevice(s, "a2", "cycle")).toBe(false);
    await setHiddenOnDevice(s, "a1", "cycle", false);
    expect(await isHiddenOnDevice(s, "a1", "cycle")).toBe(false);
    expect(s.data.size).toBe(0);
  });
  it("a storage failure never hides a card and says the save failed", async () => {
    expect(await isHiddenOnDevice(broken, "a1", "cycle")).toBe(false);
    expect(await setHiddenOnDevice(broken, "a1", "cycle", true)).toBe(false);
  });
  it("the key holds no condition word beyond the card id and never the data itself", () => {
    expect(hideOnDeviceKey("a1", "pregnancy")).toBe("hide_on_device:a1:pregnancy");
  });
});

describe("check-in snooze restore", () => {
  const now = 1_000_000_000;
  it("none without a deadline, snoozed before it, asked_again after it", () => {
    expect(restoreCheckInSnooze(null, now)).toBe("none");
    expect(restoreCheckInSnooze(now + 5_000, now)).toBe("snoozed");
    expect(restoreCheckInSnooze(now - 5_000, now)).toBe("asked_again");
  });
  it("a deadline older than the longest window is stale", () => {
    expect(restoreCheckInSnooze(now - (CHECKIN_WINDOW_MAX_MINUTES * 60_000 + 1), now)).toBe("none");
    expect(restoreCheckInSnooze(Number.NaN, now)).toBe("none");
  });
  it("sized against the shortest server window, the snooze is 15 seconds and never past half of any window", () => {
    expect(checkInSnoozeSeconds(CHECKIN_WINDOW_MIN_MINUTES)).toBe(15);
    for (const w of [1, 2, 5, 60]) expect(checkInSnoozeSeconds(w)).toBeLessThanOrEqual(w * 30);
  });
});

describe("check-in snooze", () => {
  it("is a quarter of the window with a floor, and never past half", () => {
    expect(checkInSnoozeSeconds(5)).toBe(75);
    expect(checkInSnoozeSeconds(0.2)).toBe(6);
    expect(checkInSnoozeSeconds(1)).toBe(15);
    expect(checkInSnoozeSeconds(0)).toBe(15);
    expect(checkInSnoozeSeconds(Number.NaN)).toBe(15);
  });
});

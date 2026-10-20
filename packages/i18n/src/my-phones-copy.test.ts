import { describe, expect, it } from "@jest/globals";
import { describePhone, type PhoneCopyInput } from "./my-phones-copy";

const base: PhoneCopyInput = {
  state: "active",
  platform: "android",
  lastCheckinAt: "2026-10-19T09:00:00Z",
  leaseExpiresAt: "2026-11-10T00:00:00Z",
  wipeConfirmedAt: null,
  unsentAtWipe: null,
  dangerAtWipe: null,
};

describe("describePhone", () => {
  it("names the phone by platform and shows when it last connected, in Lagos time", () => {
    const c = describePhone(base);
    expect(c.name).toBe("Android phone");
    expect(c.lastSeen).toMatch(/19 Oct 2026/);
    expect(c.lastSeen).toMatch(/10:00/); // 09:00 UTC is 10:00 in Lagos
    expect(describePhone({ ...base, platform: "ios" }).name).toBe("iPhone");
  });

  it("states the lost-phone promise the same way the wipe behaves: one last try, nothing quiet about urgent entries", () => {
    expect(describePhone({ ...base, state: "lost_reported" }).stateLine).toMatch(/clear it the next time it connects/);
    expect(describePhone({ ...base, state: "lease_lapsed" }).stateLine).toMatch(/unless something urgent is still waiting/);
  });

  it("after a clear, says how many entries had not been sent and flags urgent ones, counts only", () => {
    const c = describePhone({ ...base, state: "cleared", wipeConfirmedAt: "2026-10-19T12:00:00Z", unsentAtWipe: 3, dangerAtWipe: 1 });
    expect(c.clearedLines).toEqual([
      "3 entries had not been sent when it was cleared. Please log them again, or tell your care team.",
      "Urgent entries among them: 1. Please tell your care team directly.",
    ]);
  });

  it("says everything had reached us when nothing was unsent, and never reports more urgent than unsent", () => {
    expect(describePhone({ ...base, state: "cleared", wipeConfirmedAt: "2026-10-19T12:00:00Z", unsentAtWipe: 0, dangerAtWipe: 4 }).clearedLines).toEqual([
      "Everything on it had already reached us.",
    ]);
    const c = describePhone({ ...base, state: "cleared", wipeConfirmedAt: "2026-10-19T12:00:00Z", unsentAtWipe: 2, dangerAtWipe: 9 });
    expect(c.clearedLines[1]).toMatch(/^Urgent entries among them: 2/);
  });
});

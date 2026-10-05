import { describe, expect, it } from "@jest/globals";
import { diagnose, healthFromRow, makerGroup, type DeliveryHealth } from "./notification-diagnosis";

const H = (o: Partial<DeliveryHealth> = {}): DeliveryHealth => ({ pushSent: 10, pushDelivered: 10, pushOpened: 4, pushFailed: 0, tokenDead: 0, activePushDevices: 1, ...o });
const base = { os: "android", brand: "samsung", manufacturer: "samsung", permission: "granted" as const };

describe("makerGroup", () => {
  it("finds the Transsion brands whatever the case", () => {
    for (const b of ["TECNO", "Infinix", "itel", "TRANSSION"]) expect(makerGroup("android", b, null)).toBe("transsion");
    expect(makerGroup("android", null, "Tecno Mobile Limited")).toBe("transsion");
  });
  it("tells other Android, iOS and unknown platforms apart", () => {
    expect(makerGroup("android", "samsung", "samsung")).toBe("other_android");
    expect(makerGroup("android")).toBe("other_android");
    expect(makerGroup("ios")).toBe("ios");
    expect(makerGroup("web")).toBe("unknown");
  });
});

describe("diagnose", () => {
  it("permission off comes first and hides the registration finding", () => {
    expect(diagnose({ ...base, permission: "denied", health: H({ activePushDevices: 0 }) }).findings).toEqual(["permission_off"]);
  });
  it("flags a phone with no registered device", () => {
    expect(diagnose({ ...base, health: H({ activePushDevices: 0 }) }).findings).toEqual(["no_device_registered"]);
  });
  it("flags a dead token and failing receipts", () => {
    expect(diagnose({ ...base, health: H({ tokenDead: 1 }) }).findings).toContain("token_dead");
    expect(diagnose({ ...base, health: H({ pushFailed: 3 }) }).findings).toContain("receipts_failing");
    expect(diagnose({ ...base, health: H({ pushFailed: 1 }) }).findings).toEqual(["all_good"]);
  });
  it("many pushes and none opened points at the background limit, on a Tecno phone too", () => {
    const d = diagnose({ os: "android", brand: "TECNO", permission: "granted", health: H({ pushOpened: 0 }) });
    expect(d.maker).toBe("transsion");
    expect(d.findings).toEqual(["never_opened"]);
  });
  it("too few pushes is not a verdict", () => {
    expect(diagnose({ ...base, health: H({ pushSent: 2, pushOpened: 0 }) }).findings).toEqual(["not_enough_data"]);
    expect(diagnose({ ...base, health: null }).findings).toEqual(["not_enough_data"]);
  });
  it("a healthy phone is all good", () => {
    expect(diagnose({ ...base, health: H() }).findings).toEqual(["all_good"]);
  });
  it("an unanswered permission does not count as off", () => {
    expect(diagnose({ ...base, permission: "undetermined", health: H() }).findings).toEqual(["all_good"]);
  });
});

describe("healthFromRow", () => {
  it("reads bigint strings and a missing row", () => {
    expect(healthFromRow({ push_sent: "7", push_delivered: 6, push_opened: "0", push_failed: 1, token_dead: 0, active_push_devices: "1" }))
      .toEqual({ pushSent: 7, pushDelivered: 6, pushOpened: 0, pushFailed: 1, tokenDead: 0, activePushDevices: 1 });
    expect(healthFromRow(null)).toBeNull();
  });
});

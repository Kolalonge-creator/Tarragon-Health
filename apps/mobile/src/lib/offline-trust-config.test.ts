import { loadOfflineTrustConfig } from "./offline-trust-config";

describe("offline.trust config", () => {
  it("loads the registry values with units converted", () => {
    const c = loadOfflineTrustConfig();
    expect(c.deviceLeaseDays).toBe(30);
    expect(c.probeMinIntervalMs).toBe(60_000);
    expect(c.probeTimeoutMs).toBe(8_000);
    expect(c.leaseGraceHours).toBe(24);
    expect(c.version).toBe(1);
  });
});

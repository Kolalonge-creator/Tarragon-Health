import { computeMonitoringStatus } from "./patient-monitoring-status";

describe("computeMonitoringStatus", () => {
  it("is normal with no open alert and every vital in range", () => {
    expect(
      computeMonitoringStatus({
        hasOpenAlert: false,
        vitalLevels: ["green", "green", "unknown", "green"],
      })
    ).toBe("normal");
  });

  it("is exception when an open alert exists even if every vital reads green", () => {
    expect(
      computeMonitoringStatus({
        hasOpenAlert: true,
        vitalLevels: ["green", "green", "green", "green"],
      })
    ).toBe("exception");
  });

  it("is exception on a red or emergency vital reading even with no open alert — the Free-tier gap", () => {
    // A dangerous reading on a plan without vitals_red_flag_doctor_escalation
    // is still classified but never creates a clinician_alerts row — the
    // whole reason this doesn't key off hasOpenAlert alone.
    expect(
      computeMonitoringStatus({
        hasOpenAlert: false,
        vitalLevels: ["green", "red", "unknown", "green"],
      })
    ).toBe("exception");
    expect(
      computeMonitoringStatus({
        hasOpenAlert: false,
        vitalLevels: ["emergency", "green", "green", "green"],
      })
    ).toBe("exception");
  });

  it("stays normal on an amber-only reading with no open alert", () => {
    expect(
      computeMonitoringStatus({
        hasOpenAlert: false,
        vitalLevels: ["amber", "green", "unknown", "green"],
      })
    ).toBe("normal");
  });

  it("is normal when every vital is unknown (no readings logged) and there is no alert", () => {
    expect(
      computeMonitoringStatus({
        hasOpenAlert: false,
        vitalLevels: ["unknown", "unknown", "unknown", "unknown"],
      })
    ).toBe("normal");
  });
});

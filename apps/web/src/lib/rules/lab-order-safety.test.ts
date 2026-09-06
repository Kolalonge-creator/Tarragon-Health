import { duplicateInvestigationFindings, type RecentLabOrderInput } from "./lab-order-safety";

const NOW = new Date("2026-08-29T12:00:00Z");

function order(overrides: Partial<RecentLabOrderInput> = {}): RecentLabOrderInput {
  return {
    id: "order-1",
    testCodes: ["hba1c"],
    orderedAt: "2026-08-01T00:00:00Z",
    status: "resulted",
    panelBundleName: null,
    ...overrides,
  };
}

describe("duplicateInvestigationFindings", () => {
  it("fires when the same test was ordered within the window", () => {
    const findings = duplicateInvestigationFindings([order()], ["hba1c"], { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0].testCode).toBe("hba1c");
    expect(findings[0].severity).toBe("caution");
    expect(findings[0].message).toContain("already on file");
  });

  it("is 'info', not 'caution', when the prior order has no result yet", () => {
    const findings = duplicateInvestigationFindings(
      [order({ status: "processing" })],
      ["hba1c"],
      { now: NOW },
    );
    expect(findings[0].severity).toBe("info");
    expect(findings[0].message).toContain("still open");
  });

  it("does not fire for a test never ordered before", () => {
    const findings = duplicateInvestigationFindings([order()], ["lipid_panel"], { now: NOW });
    expect(findings).toHaveLength(0);
  });

  it("ignores an order outside the recency window", () => {
    const findings = duplicateInvestigationFindings(
      [order({ orderedAt: "2026-01-01T00:00:00Z" })],
      ["hba1c"],
      { now: NOW, windowDays: 90 },
    );
    expect(findings).toHaveLength(0);
  });

  it("respects a custom window", () => {
    const findings = duplicateInvestigationFindings(
      [order({ orderedAt: "2026-08-01T00:00:00Z" })],
      ["hba1c"],
      { now: NOW, windowDays: 7 },
    );
    expect(findings).toHaveLength(0);
  });

  it("ignores cancelled orders", () => {
    const findings = duplicateInvestigationFindings(
      [order({ status: "cancelled" })],
      ["hba1c"],
      { now: NOW },
    );
    expect(findings).toHaveLength(0);
  });

  it("matches within a multi-test bundle order", () => {
    const findings = duplicateInvestigationFindings(
      [order({ testCodes: ["hba1c", "lipid_panel", "kft"], panelBundleName: "Diabetes Panel" })],
      ["lipid_panel"],
      { now: NOW },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("Diabetes Panel");
  });

  it("checks every candidate code independently, one finding each", () => {
    const findings = duplicateInvestigationFindings(
      [order({ testCodes: ["hba1c"] }), order({ id: "order-2", testCodes: ["lipid_panel"] })],
      ["hba1c", "lipid_panel", "fbc"],
      { now: NOW },
    );
    expect(findings.map((f) => f.testCode).sort()).toEqual(["hba1c", "lipid_panel"]);
  });

  it("picks the most recent matching order when duplicates exist", () => {
    const older = order({ id: "older", orderedAt: "2026-07-01T00:00:00Z" });
    const newer = order({ id: "newer", orderedAt: "2026-08-15T00:00:00Z", status: "processing" });
    const findings = duplicateInvestigationFindings([older, newer], ["hba1c"], { now: NOW });
    expect(findings).toHaveLength(1);
    expect(findings[0].priorOrderId).toBe("newer");
  });

  it("never blocks — it only returns advisory findings, always an array", () => {
    const findings = duplicateInvestigationFindings([], [], { now: NOW });
    expect(findings).toEqual([]);
  });
});

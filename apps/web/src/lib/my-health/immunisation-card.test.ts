import { buildImmunisationCard, doseTrust } from "./immunisation-card";

const dose = (over: Partial<Parameters<typeof buildImmunisationCard>[0][number]>) => ({
  id: "r1",
  vaccine: "Yellow fever",
  doseNumber: 1,
  dateAdministered: "2024-05-01",
  provider: "Lagos clinic",
  verificationStatus: "verified",
  certificateSerial: "TH-VAX-1",
  ...over,
});

describe("immunisation card", () => {
  it("only a dose a doctor verified is called verified", () => {
    expect(doseTrust("verified")).toBe("verified");
    expect(doseTrust("pending_verification")).toBe("waiting");
    expect(doseTrust("self_reported")).toBe("self_reported");
    expect(doseTrust("anything else")).toBe("self_reported");
  });
  it("groups doses by vaccine, oldest first, and counts what is verified", () => {
    const card = buildImmunisationCard(
      [
        dose({ id: "b", vaccine: "Tetanus", dateAdministered: "2023-01-01" }),
        dose({ id: "a2", doseNumber: 2, dateAdministered: "2025-01-01", verificationStatus: "self_reported", certificateSerial: null }),
        dose({ id: "a1" }),
      ],
      [],
    );
    expect(card.vaccines.map((v) => v.vaccine)).toEqual(["Tetanus", "Yellow fever"]);
    expect(card.vaccines[1].doses.map((d) => d.id)).toEqual(["a1", "a2"]);
    expect(card.counts).toEqual({ total: 3, verified: 2, notVerified: 1, rejected: 0 });
  });
  it("a rejected certificate is not shown as a dose, but it is counted so a dose never just vanishes", () => {
    const card = buildImmunisationCard([dose({ verificationStatus: "rejected" })], []);
    expect(card.vaccines).toEqual([]);
    expect(card.counts.total).toBe(0);
    expect(card.counts.rejected).toBe(1);
  });
  it("the Tarragon serial only ever accompanies a verified dose", () => {
    const card = buildImmunisationCard([dose({ verificationStatus: "pending_verification", certificateSerial: "TH-VAX-9" })], []);
    expect(card.vaccines[0].doses[0].serial).toBeNull();
  });
  it("lists next doses by due date", () => {
    const card = buildImmunisationCard([], [
      { vaccine: "B", dueDate: "2027-02-01" },
      { vaccine: "A", dueDate: "2026-12-01" },
    ]);
    expect(card.next.map((n) => n.vaccine)).toEqual(["A", "B"]);
  });
});

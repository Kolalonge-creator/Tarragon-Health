import { buildImmunisationCard } from "./immunisation-card";
import { coverageInputSchema, toEmergencyCoverage } from "./emergency-coverage";
import { outsideRecordLabel } from "./outside-record";

describe("S09y shared rules", () => {
  it("cover: a member number may not carry punctuation attacks; both blank is valid (remove)", () => {
    expect(coverageInputSchema.safeParse({ scheme: "hmo", member_number: "REL/12345" }).success).toBe(true);
    expect(coverageInputSchema.safeParse({ scheme: "hmo", member_number: "1;--" }).success).toBe(false);
    expect(coverageInputSchema.safeParse({ scheme: "nhia", member_number: "", plan_name: "" }).success).toBe(true);
  });
  it("cover: nothing filled means nothing to show", () => {
    expect(toEmergencyCoverage({ scheme: "hmo", member_number: "", plan_name: null })).toBeNull();
  });
  it("outside record: checked only with a status, a reviewer and a time", () => {
    const base = { reviewerName: null, note: null };
    expect(outsideRecordLabel({ ...base, status: "verified", reviewedBy: "d", reviewedAt: "2026-10-01T00:00:00Z" }).kind).toBe("verified");
    expect(outsideRecordLabel({ ...base, status: "verified", reviewedBy: null, reviewedAt: "2026-10-01T00:00:00Z" }).kind).toBe("unchecked");
    expect(outsideRecordLabel({ ...base, status: undefined, reviewedBy: "d", reviewedAt: "2026-10-01T00:00:00Z" }).kind).toBe("unchecked");
  });
  it("immunisation: a rejected certificate is not a dose", () => {
    const card = buildImmunisationCard([{ id: "1", vaccine: "V", doseNumber: 1, dateAdministered: "2025-01-01", provider: null, verificationStatus: "rejected", certificateSerial: "S" }], []);
    expect(card.counts.total).toBe(0);
  });
});

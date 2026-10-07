import { asNotice, grantableCompetencies, grantsHistorySchema, isFailure, rosterSchema, sortRoster, type RosterRow } from "./model";

const base: RosterRow = {
  id: "11111111-1111-4111-8111-111111111111", full_name: "A", doctor_tier: "senior_medical_officer", employment_type: "employed", status: "active", active: true,
  level: 2, suspended_at: null, suspended_reason: null, license_expires_at: null, indemnity_expires_at: null, indemnity_required: false, eligible: true,
  is_self: false, competencies: [], pending_requests: [],
};

describe("roster model", () => {
  it("parses a roster row and refuses a malformed one", () => {
    expect(rosterSchema.safeParse([base]).success).toBe(true);
    expect(rosterSchema.safeParse([{ ...base, status: "gone" }]).success).toBe(false);
    expect(rosterSchema.safeParse([{ ...base, competencies: "x" }]).success).toBe(false);
  });
  it("puts requests waiting, then suspended, then ineligible first", () => {
    const rows: RosterRow[] = [
      { ...base, id: "a", full_name: "Zed" },
      { ...base, id: "b", full_name: "Yan", eligible: false },
      { ...base, id: "c", full_name: "Xia", status: "suspended", active: false },
      { ...base, id: "d", full_name: "Wes", pending_requests: [{ id: "22222222-2222-4222-8222-222222222222", kind: "reinstatement", competency_code: null, reason: "r", requested_at: "2026-10-06", requested_by_name: null, requested_by_me: false }] },
    ];
    expect(sortRoster(rows).map((r) => r.id)).toEqual(["d", "c", "b", "a"]);
  });
  it("offers only active competencies the clinician does not hold", () => {
    const all = [
      { code: "a", label: "A", requires_level: 1, is_active: true },
      { code: "b", label: "B", requires_level: 1, is_active: true },
      { code: "c", label: "C", requires_level: 2, is_active: false },
    ];
    expect(grantableCompetencies(all, { competencies: ["a"] }).map((c) => c.code)).toEqual(["b"]);
  });
  it("accepts only known notices and marks failures", () => {
    expect(asNotice("suspended")).toBe("suspended");
    expect(asNotice("<script>")).toBeNull();
    expect(isFailure("grant_failed")).toBe(true);
    expect(isFailure("granted")).toBe(false);
  });
  it("parses the grants history shape", () => {
    expect(grantsHistorySchema.safeParse({ current: [], history: [], audit: [] }).success).toBe(true);
    expect(grantsHistorySchema.safeParse({ current: [] }).success).toBe(false);
  });
});

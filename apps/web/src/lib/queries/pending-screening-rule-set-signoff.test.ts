import { pendingFromRows } from "./pending-screening-rule-set-signoff";

const rules = [{ code: "hba1c", frequencyMonths: 12 }];
const live = { id: "live", version: 3, is_active: true, approved_by: "staff", config: { rules } };
const pacing = { maxNewRequestsPerWeek: 3, priority: ["blood_pressure", "hba1c"] };
const names = { blood_pressure: "Blood Pressure Check", hba1c: "HbA1c" };

describe("pendingFromRows", () => {
  it("reports a draft with the same rules plus pacing as signable, with test names in the signed order", () => {
    const r = pendingFromRows([live, { id: "d4", version: 4, is_active: false, approved_by: null, config: { rules, pacing } }], names);
    expect(r).toMatchObject({ draftId: "d4", version: 4, liveVersion: 3, signable: true, failed: false });
    expect(r.pacing).toEqual({ maxNewRequestsPerWeek: 3, priority: [{ code: "blood_pressure", name: "Blood Pressure Check" }, { code: "hba1c", name: "HbA1c" }] });
  });

  it("does not offer a draft whose rules differ from the signed version", () => {
    const r = pendingFromRows([live, { id: "d4", version: 4, is_active: false, approved_by: null, config: { rules: [{ code: "other" }], pacing } }], names);
    expect(r.draftId).toBe("d4");
    expect(r.signable).toBe(false);
  });

  it("does not offer a draft with no readable pacing block", () => {
    for (const bad of [undefined, { maxNewRequestsPerWeek: 0, priority: [] }, { maxNewRequestsPerWeek: "3", priority: ["a"] }, { maxNewRequestsPerWeek: 3, priority: [1] }]) {
      const r = pendingFromRows([live, { id: "d4", version: 4, is_active: false, approved_by: null, config: { rules, pacing: bad } }], names);
      expect(r.signable).toBe(false);
      expect(r.pacing).toBeNull();
    }
  });

  it("ignores drafts older than the signed version, signed rows and active rows", () => {
    const r = pendingFromRows([live, { id: "old", version: 2, is_active: false, approved_by: null, config: { rules, pacing } }, { id: "signed", version: 4, is_active: false, approved_by: "staff", config: { rules, pacing } }], names);
    expect(r.draftId).toBeNull();
  });

  it("falls back to the test code when a name is missing", () => {
    const r = pendingFromRows([live, { id: "d4", version: 4, is_active: false, approved_by: null, config: { rules, pacing } }], {});
    expect(r.pacing?.priority[0]).toEqual({ code: "blood_pressure", name: "blood_pressure" });
  });
});
